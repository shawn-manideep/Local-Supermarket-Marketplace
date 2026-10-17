import { assertApiOnlyTarget } from "./target-guard.js";

export const API_ONLY_STATEMENT_TIMEOUT_MS = 60_000;
export const API_ONLY_QUERY_TIMEOUT_MS = 65_000;

export function apiOnlyPoolOptions(connectionTimeoutMillis: number) {
  return {
    connectionTimeoutMillis,
    statement_timeout: API_ONLY_STATEMENT_TIMEOUT_MS,
    query_timeout: API_ONLY_QUERY_TIMEOUT_MS,
  };
}

export interface ReadOnlyIdentityClient {
  query(config: {
    text: string;
    query_timeout: number;
  }): Promise<{ rows: Array<Record<string, unknown>> }>;
  release(): void;
}

export async function verifyReadOnlyDatabaseIdentity(
  client: ReadOnlyIdentityClient,
): Promise<void> {
  let transactionStarted = false;
  try {
    await client.query({ text: "BEGIN READ ONLY", query_timeout: 5_000 });
    transactionStarted = true;
    const result = await client.query({
      text: "SELECT current_database() AS database_name",
      query_timeout: 5_000,
    });
    if (result.rows[0]?.database_name !== "postgres") {
      throw new Error("unexpected database name");
    }
  } catch {
    throw new Error("API-only startup refused: read-only database identity could not be verified.");
  } finally {
    if (transactionStarted) {
      await client
        .query({ text: "ROLLBACK", query_timeout: 5_000 })
        .catch(() => undefined);
    }
    client.release();
  }
}

export async function verifyApiOnlyDatabaseIdentity(
  connectionTimeoutMillis: number,
): Promise<void> {
  let client: ReadOnlyIdentityClient;
  try {
    const { getPool } = await import("@workspace/db");
    client = await getPool(apiOnlyPoolOptions(connectionTimeoutMillis)).connect();
  } catch {
    throw new Error("API-only startup refused: isolated database connection could not be established.");
  }
  await verifyReadOnlyDatabaseIdentity(client);
}

export async function loadApiOnlyApp<T>(
  env: NodeJS.ProcessEnv,
  verifyDatabase: (connectionTimeoutMillis: number) => Promise<void>,
  loadApp: () => Promise<T>,
): Promise<T> {
  const connectionTimeoutMillis = assertApiOnlyTarget(env);
  await verifyDatabase(connectionTimeoutMillis);
  return loadApp();
}
