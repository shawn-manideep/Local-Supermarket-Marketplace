import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";

export const SOURCE_PROJECT = "gkwcolipeavxnuzqlamb";
export const DESTINATION_PROJECT = "nrnigsznectrgbgafwme";
export const COLUMNS = Object.freeze({
  master_categories: Object.freeze(["id", "name", "is_active", "created_at", "updated_at"]),
  master_products: Object.freeze(["id", "master_category_id", "name", "description", "image", "brand", "attributes", "is_active", "created_at", "updated_at"]),
});
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const timestamp = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;
const error = code => new Error(code);
function requireThat(value, code) { if (!value) throw error(code); }
function plain(value) {
  return value !== null && typeof value === "object" &&
    [Object.prototype, null].includes(Object.getPrototypeOf(value)) && !Array.isArray(value);
}
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (plain(value)) return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical(value[k])}`).join(",")}}`;
  requireThat(value === null || typeof value === "string" || typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value) && Number.isSafeInteger(value)), "INVALID_JSON");
  return JSON.stringify(value);
}
function digest(value) { return createHash("sha256").update(canonical(value)).digest("hex"); }
function keys(value, expected) {
  requireThat(plain(value) && isDeepStrictEqual(Object.keys(value).sort(), [...expected].sort()), "INVALID_FIELDS");
}
function validateRows(table, rows) {
  requireThat(Array.isArray(rows), "INVALID_ROWS");
  const ids = new Set();
  for (const row of rows) {
    keys(row, COLUMNS[table]);
    requireThat(uuid.test(row.id), "INVALID_UUID");
    requireThat(!ids.has(row.id), "DUPLICATE_UUID"); ids.add(row.id);
    requireThat(typeof row.name === "string" && row.name.trim().length >= 1 &&
      row.name.trim().length <= (table === "master_categories" ? 120 : 200), "INVALID_NAME");
    requireThat(typeof row.is_active === "boolean", "INVALID_ACTIVE_STATE");
    for (const field of ["created_at", "updated_at"]) {
      requireThat(typeof row[field] === "string" && timestamp.test(row[field]) &&
        Number.isFinite(Date.parse(row[field])) &&
        new Date(row[field]).toISOString().slice(0, 19) === row[field].slice(0, 19), "INVALID_TIMESTAMP");
    }
    if (table === "master_products") {
      requireThat(row.master_category_id === null || uuid.test(row.master_category_id), "INVALID_CATEGORY_UUID");
      for (const field of ["description", "image", "brand"]) {
        requireThat(row[field] === null || typeof row[field] === "string", "INVALID_NULLABLE_TEXT");
      }
      requireThat(plain(row.attributes), "INVALID_ATTRIBUTES");
      canonical(row.attributes);
    }
  }
  return ids;
}
function validateData(data) {
  keys(data, Object.keys(COLUMNS));
  const ids = validateRows("master_categories", data.master_categories);
  validateRows("master_products", data.master_products);
  requireThat(data.master_categories.length === 63 && data.master_products.length === 687, "UNAPPROVED_COUNTS");
  for (const row of data.master_products) {
    requireThat(row.master_category_id === null || ids.has(row.master_category_id), "INVALID_CATEGORY_REFERENCE");
  }
}
function sortedData(data) {
  return Object.fromEntries(Object.keys(COLUMNS).map(table =>
    [table, [...data[table]].sort((a, b) => a.id.localeCompare(b.id))]));
}

/** In-memory only: this is not an encrypted export or a source-authentication proof. */
export function createPackage({ sourceProject, destinationProject, data }) {
  requireThat(sourceProject === SOURCE_PROJECT && destinationProject === DESTINATION_PROJECT, "TARGET_REFUSED");
  validateData(data);
  const payload = { version: 1, sourceProject, destinationProject, data: sortedData(data) };
  // Detached snapshot prevents subsequent caller mutation from altering the package.
  return JSON.parse(JSON.stringify({ ...payload, sha256: digest(payload) }));
}
export function validatePackage(value) {
  keys(value, ["version", "sourceProject", "destinationProject", "data", "sha256"]);
  requireThat(value.version === 1 && value.sourceProject === SOURCE_PROJECT &&
    value.destinationProject === DESTINATION_PROJECT, "TARGET_REFUSED");
  validateData(value.data);
  const { sha256, ...payload } = value;
  requireThat(typeof sha256 === "string" && /^[a-f0-9]{64}$/.test(sha256) &&
    sha256 === digest(payload), "PACKAGE_INTEGRITY_FAILURE");
  return JSON.parse(JSON.stringify(value));
}

function selectSql(table) {
  return `SELECT ${COLUMNS[table].map(column => ["created_at", "updated_at"].includes(column)
    ? `to_char(${column} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS ${column}`
    : column).join(",")} FROM public.${table} ORDER BY id`;
}
async function readData(client) {
  const data = {};
  for (const table of Object.keys(COLUMNS)) data[table] = (await client.query(selectSql(table))).rows;
  return data;
}

/**
 * OFFLINE REHEARSAL ONLY. Takes an already connected, dedicated disposable-local
 * pg client. No environment access, driver import, credentials or live adapter.
 * The project descriptors are package boundaries, NOT live identity verification.
 */
export async function rehearseRecovery({ client, package: input, destinationProject }) {
  const pkg = validatePackage(input);
  requireThat(destinationProject === DESTINATION_PROJECT, "TARGET_REFUSED");
  const parameters = client?.connectionParameters;
  requireThat(typeof parameters?.host === "string" &&
    /^\/tmp\/alb-catalog-rehearsal-[A-Za-z0-9]+$/.test(parameters.host) &&
    parameters.database === "alb_catalog_rehearsal" && parameters.user === "alb_rehearsal", "OFFLINE_CLIENT_REQUIRED");
  let began = false, commitAttempted = false;
  let failure;
  try {
    await client.query("BEGIN");
    began = true;
    await client.query("SET LOCAL statement_timeout = '10s'");
    await client.query("SET LOCAL lock_timeout = '1s'");
    await client.query("SET LOCAL idle_in_transaction_session_timeout = '10s'");
    const identity = (await client.query("SELECT current_database() AS db, current_user AS role, inet_server_addr() AS address")).rows[0];
    requireThat(identity?.db === "alb_catalog_rehearsal" && identity.role === "alb_rehearsal" && identity.address === null, "OFFLINE_CLIENT_REQUIRED");
    const lock = await client.query("SELECT pg_try_advisory_xact_lock(180812, 750) AS acquired");
    requireThat(lock.rows[0]?.acquired === true, "RECOVERY_BUSY");
    await client.query("LOCK TABLE public.master_categories, public.master_products IN SHARE ROW EXCLUSIVE MODE");
    const before = await readData(client);
    requireThat(Object.values(before).every(rows => rows.length === 0), "DESTINATION_NOT_EMPTY");
    for (const table of Object.keys(COLUMNS)) {
      const columns = COLUMNS[table];
      const sql = `INSERT INTO public.${table} (${columns.join(",")}) VALUES (${columns.map((_, i) => `$${i + 1}`).join(",")})`;
      for (const row of pkg.data[table]) {
        await client.query(sql, columns.map(column => column === "attributes" ? JSON.stringify(row[column]) : row[column]));
      }
    }
    const actual = await readData(client);
    requireThat(isDeepStrictEqual(sortedData(actual), sortedData(pkg.data)), "PRECOMMIT_COMPARISON_FAILURE");
    commitAttempted = true;
    await client.query("COMMIT");
  } catch {
    failure = error(commitAttempted ? "UNKNOWN_COMMIT_OUTCOME" : "RECOVERY_ABORTED");
    if (began && !commitAttempted) {
      try { await client.query("ROLLBACK"); } catch { /* Never replace the original failure. */ }
    }
  } finally {
    try { await client.end(); } catch {
      if (!failure) failure = error("COMMITTED_CLEANUP_FAILED");
    }
  }
  if (failure) throw failure;
  return Object.freeze({ status: "COMMITTED", categories: 63, products: 687 });
}
