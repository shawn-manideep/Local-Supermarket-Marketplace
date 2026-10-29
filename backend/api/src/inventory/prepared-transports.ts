import { PROJECTIONS, NAMESPACES, InventoryFailure, type ListedObject, type Row, type Table } from "./contracts.js";
import { consumePreparedApproval, ORIGINAL_INVENTORY_PROJECT, type PreparedBinding } from "./prepared-approval.js";
import { exactKeys, plainArray, plainData } from "./policy.js";
import { checkObject, checkRow } from "./reconcile.js";
import { createRestrictedReaders, type RestrictedReadPorts } from "./restricted-readers.js";

export interface VerifiedConnectionPlan {
  project: typeof ORIGINAL_INVENTORY_PROJECT;
  host: "aws-0-ap-south-1.pooler.supabase.com";
  port: 5432;
  database: "postgres";
  role: string;
  tls: { rejectUnauthorized: true };
  connectTimeoutMs: number;
}
/** Trusted mock ports for preparation. No implementation opens sockets or loads
 * credentials. A future connector must enforce plan identity/TLS/cancellation.
 */
export interface PreparedDatabasePort {
  connect(plan: VerifiedConnectionPlan, signal: AbortSignal): Promise<void>;
  query(statement: { text: string; values: readonly unknown[]; signal: AbortSignal }): Promise<{ rows: readonly unknown[] }>;
  /** Cancel/settle, rollback or discard, then release. No acknowledgement on failure. */
  cancelAndClose(): Promise<void>;
}
export interface PreparedMetadataPort {
  readonly identity: string;
  list(request: { prefix: string; maxResults: number; pageToken?: string;
    fields: readonly string[]; signal: AbortSignal }): Promise<unknown>;
  cancelAndClose(): Promise<void>;
}
const invalid = (): never => { throw new InventoryFailure("INVALID_SOURCE_METADATA"); };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const metadataFields = Object.freeze(["name", "generation", "metageneration", "size",
  "contentType", "timeCreated", "updated", "crc32c", "md5Hash", "cacheControl",
  "contentDisposition", "contentEncoding", "contentLanguage", "metadata.visibility"]);
const timestampColumns = new Set(["updated_at", "uploaded_at", "captured_at"]);
function projection(table: Table) {
  return PROJECTIONS[table].map(column => timestampColumns.has(column)
    ? `to_char("${column}" AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "${column}"`
    : `"${column}"`).join(", ");
}

/** Consume approval BEFORE any port call. Returns only bounded read capabilities,
 * not raw ports, SQL execution, configuration or an approved live entrypoint.
 */
export function constructPreparedInventory(capability: object, database: PreparedDatabasePort, storage: PreparedMetadataPort) {
  const binding = consumePreparedApproval(capability);
  if (storage.identity !== binding.storageIdentity) return invalid();
  let connected = false, connectAttempted = false, closed = false, queryCount = 0;
  const timeLeft = binding.expiresAt - Date.now();
  if (timeLeft < 1) return invalid();
  const policy = { ...binding.policy, limits: { ...binding.policy.limits,
    maxDurationMs: Math.min(binding.policy.limits.maxDurationMs, timeLeft),
    maxDbDurationMs: Math.min(binding.policy.limits.maxDbDurationMs, timeLeft) } };
  const plan: VerifiedConnectionPlan = Object.freeze({
    project: ORIGINAL_INVENTORY_PROJECT, host: "aws-0-ap-south-1.pooler.supabase.com",
    port: 5432, database: "postgres", role: binding.databaseRole,
    tls: Object.freeze({ rejectUnauthorized: true }),
    connectTimeoutMs: Math.min(5000, policy.limits.requestTimeoutMs),
  });
  async function query(text: string, values: readonly unknown[], signal: AbortSignal) {
    if (closed || signal.aborted || Date.now() >= binding.expiresAt) throw new InventoryFailure("TIMEOUT");
    // Reserve one operation for cancellation/rollback/discard acknowledgement.
    if (queryCount >= policy.limits.maxDbRequests - 1) throw new InventoryFailure("BUDGET_EXCEEDED");
    queryCount++;
    return database.query({ text, values, signal });
  }
  const ports: RestrictedReadPorts = {
    async databasePage(request) {
      if (!connected) {
        // Connect attempts and every preflight SQL request consume the same budget.
        if (queryCount >= policy.limits.maxDbRequests - 1) throw new InventoryFailure("BUDGET_EXCEEDED");
        queryCount++;
        connectAttempted = true;
        await database.connect(plan, request.signal);
        await query("BEGIN READ ONLY", [], request.signal);
        await query("SELECT set_config('statement_timeout',$1,true), set_config('lock_timeout',$2,true), set_config('idle_in_transaction_session_timeout',$3,true)",
          [String(policy.limits.requestTimeoutMs), String(Math.min(1000, policy.limits.requestTimeoutMs)),
            String(policy.limits.requestTimeoutMs)], request.signal);
        const identity = await query("SELECT current_database() AS database_name, current_user AS role_name, current_setting('transaction_read_only') AS read_only",
          [], request.signal);
        const rows = plainArray(identity.rows, 1);
        if (rows.length !== 1) return invalid();
        const value = plainData(rows[0]);
        exactKeys(value, ["database_name", "role_name", "read_only"]);
        if (value.database_name !== "postgres" || value.role_name !== binding.databaseRole || value.read_only !== "on") return invalid();
        connected = true;
      }
      if (!Object.hasOwn(PROJECTIONS, request.table) ||
          request.columns.join("|") !== PROJECTIONS[request.table].join("|") ||
          (request.cursor !== undefined && !uuid.test(request.cursor))) return invalid();
      const result = await query(`SELECT ${projection(request.table)} FROM "${request.table}" WHERE ($1::uuid IS NULL OR "id" > $1::uuid) ORDER BY "id" ASC LIMIT $2`,
        [request.cursor ?? null, request.limit], request.signal);
      const rows = plainArray(result.rows, request.limit).map(row => checkRow(request.table, row as Row));
      let last = request.cursor;
      for (const row of rows) {
        if (typeof row.id !== "string" || !uuid.test(row.id) || (last !== undefined && row.id <= last)) return invalid();
        last = row.id;
      }
      return { items: rows, changed: false,
        ...(rows.length === request.limit && last ? { nextCursor: last } : {}) };
    },
    async metadataPage(request) {
      if (closed || request.signal.aborted || Date.now() >= binding.expiresAt) throw new InventoryFailure("TIMEOUT");
      if (!NAMESPACES.includes(request.namespace)) return invalid();
      const root = ["vendor-documents", "delivery-photos"].includes(request.namespace) ? binding.privateRoot : binding.publicRoot;
      const logicalPrefix = `${root}/${request.namespace}/`;
      const prefix = logicalPrefix.slice(binding.storageIdentity.length + 1);
      const response = plainData(await storage.list({ prefix, maxResults: request.limit,
        pageToken: request.cursor, fields: metadataFields, signal: request.signal }));
      exactKeys(response, response.nextPageToken === undefined ? ["items"] : ["items", "nextPageToken"]);
      const items = plainArray(response.items, request.limit).map(raw => mapMetadata(raw, binding, request.namespace));
      if (response.nextPageToken !== undefined && (typeof response.nextPageToken !== "string" ||
          !response.nextPageToken || response.nextPageToken.length > 1024)) return invalid();
      return { items, changed: false, ...(response.nextPageToken === undefined ? {} : { nextCursor: response.nextPageToken as string }) };
    },
    async cancelAndClose() {
      closed = true;
      if (connectAttempted) queryCount++;
      // Both cleanup paths are attempted, even if one rejects. The wrapper bounds
      // acknowledgement time and refuses reuse when actual termination is unknown.
      const outcomes = await Promise.allSettled([
        Promise.resolve().then(() => database.cancelAndClose()),
        Promise.resolve().then(() => storage.cancelAndClose()),
      ]);
      if (outcomes.some(outcome => outcome.status === "rejected")) throw new Error("INVENTORY_CLEANUP_UNCONFIRMED");
    },
  };
  const readers = createRestrictedReaders(policy, ports, {
    publicRoot: binding.publicRoot, privateRoot: binding.privateRoot,
  });
  return Object.freeze({ ...readers, transportSummary: () => Object.freeze({
    databaseOperations: queryCount, closed,
  }) });
}

function mapMetadata(raw: unknown, binding: PreparedBinding, namespace: typeof NAMESPACES[number]): ListedObject {
  const value = plainData(raw);
  const required = ["name", "generation", "metageneration", "size", "contentType", "timeCreated", "updated"];
  const optional = ["crc32c", "md5Hash", "cacheControl", "contentDisposition", "contentEncoding", "contentLanguage", "metadata"];
  if (required.some(key => !Object.hasOwn(value, key)) ||
      Object.keys(value).some(key => ![...required, ...optional].includes(key)) ||
      typeof value.name !== "string" || value.name.startsWith("/") ||
      (typeof value.size !== "string" && typeof value.size !== "number") ||
      !/^(0|[1-9]\d*)$/.test(String(value.size))) return invalid();
  let visibility: unknown;
  if (value.metadata !== undefined) {
    const metadata = plainData(value.metadata);
    exactKeys(metadata, ["visibility"]);
    visibility = metadata.visibility;
  }
  const object = { key: `${binding.storageIdentity}/${value.name}`, generation: value.generation,
    metageneration: value.metageneration, size: Number(value.size), contentType: value.contentType,
    created: value.timeCreated, updated: value.updated,
    ...Object.fromEntries(optional.filter(key => key !== "metadata" && value[key] !== undefined).map(key => [key, value[key]])),
    ...(visibility === undefined ? {} : { visibility }),
  } as ListedObject;
  checkObject(object, namespace, binding);
  return object;
}
