export const API_ONLY_PROJECT_REF = "nrnigsznectrgbgafwme";
export const PROTECTED_PROJECT_REF = "gkwcolipeavxnuzqlamb";

const directDatabaseHost = `db.${API_ONLY_PROJECT_REF}.supabase.co`;

function fail(message: string): never {
  throw new Error(`API-only startup refused: ${message}`);
}

function readJwtClaims(token: string, expectedRole: "anon" | "service_role") {
  const parts = token.split(".");
  if (parts.length !== 3) fail("Supabase project key format is not verifiable.");
  let claims: unknown;
  try {
    claims = JSON.parse(Buffer.from(parts[1]!, "base64url").toString("utf8"));
  } catch {
    return fail("Supabase project key claims are not verifiable.");
  }
  if (
    typeof claims !== "object" ||
    claims === null ||
    !("ref" in claims) ||
    claims.ref !== API_ONLY_PROJECT_REF ||
    !("role" in claims) ||
    claims.role !== expectedRole
  ) {
    return fail("Supabase API key does not identify the isolated project.");
  }
}

function exactHttpsProjectUrl(value: string | undefined) {
  if (!value) fail("SUPABASE_URL is required.");
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return fail("SUPABASE_URL is invalid.");
  }
  if (
    url.protocol !== "https:" ||
    url.hostname !== `${API_ONLY_PROJECT_REF}.supabase.co` ||
    url.port ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    fail("SUPABASE_URL is not the allowlisted isolated project.");
  }
}

export function assertApiOnlyTarget(env: NodeJS.ProcessEnv): number {
  if (env.API_OBJECT_STORAGE_PROVIDER !== "replit-app-storage") {
    fail("API_OBJECT_STORAGE_PROVIDER must explicitly select replit-app-storage.");
  }

  exactHttpsProjectUrl(env.SUPABASE_URL);

  if (!env.SUPABASE_ANON_KEY || !env.SUPABASE_SERVICE_ROLE_KEY) {
    fail("The isolated project's Supabase API keys are required.");
  }
  readJwtClaims(env.SUPABASE_ANON_KEY, "anon");
  readJwtClaims(env.SUPABASE_SERVICE_ROLE_KEY, "service_role");
  if (
    !env.SESSION_SECRET ||
    env.SESSION_SECRET.length < 32 ||
    !env.MASTER_CATALOG_REVIEW_TOKEN_SECRET ||
    env.MASTER_CATALOG_REVIEW_TOKEN_SECRET.length < 32
  ) {
    fail("Dedicated server-side signing secrets of at least 32 characters are required.");
  }

  const expectedHost = env.API_ONLY_EXPECTED_DB_HOST?.toLowerCase();
  const expectedUser = env.API_ONLY_EXPECTED_DB_USERNAME;
  const expectedPort = env.API_ONLY_EXPECTED_DB_PORT;
  const expectedMode = env.API_ONLY_EXPECTED_DB_MODE;
  const connectionString = env.SUPABASE_DB_URL;
  if (!expectedHost || !expectedUser || !expectedPort || !expectedMode || !connectionString) {
    fail("Owner-confirmed database endpoint settings and SUPABASE_DB_URL are required.");
  }
  if (
    expectedHost.includes(PROTECTED_PROJECT_REF) ||
    expectedUser.includes(PROTECTED_PROJECT_REF) ||
    connectionString.includes(PROTECTED_PROJECT_REF)
  ) {
    fail("The protected project is not an allowed API-only target.");
  }
  if (!/^\d{1,5}$/.test(expectedPort) || Number(expectedPort) < 1 || Number(expectedPort) > 65535) {
    fail("API_ONLY_EXPECTED_DB_PORT is invalid.");
  }

  let databaseUrl: URL;
  try {
    databaseUrl = new URL(connectionString);
  } catch {
    return fail("SUPABASE_DB_URL is invalid.");
  }
  const databaseUser = decodeURIComponent(databaseUrl.username);
  const databasePort = databaseUrl.port || "5432";
  const isDirectTarget = expectedHost === directDatabaseHost && expectedMode === "direct";
  const isOwnerConfirmedSessionPooler =
    expectedHost.endsWith(".pooler.supabase.com") &&
    expectedMode === "session" &&
    expectedUser.split(".").includes(API_ONLY_PROJECT_REF);

  if (
    !["postgres:", "postgresql:"].includes(databaseUrl.protocol) ||
    databaseUrl.hostname.toLowerCase() !== expectedHost ||
    databaseUser !== expectedUser ||
    databasePort !== expectedPort ||
    (!isDirectTarget && !isOwnerConfirmedSessionPooler) ||
    databaseUrl.pathname !== "/postgres" ||
    databaseUrl.hash ||
    !databaseUrl.password
  ) {
    fail("SUPABASE_DB_URL does not match the owner-confirmed isolated endpoint.");
  }

  const queryKeys = [...databaseUrl.searchParams.keys()];
  if (
    queryKeys.some((key) => !["sslmode", "sslrootcert", "connect_timeout"].includes(key)) ||
    databaseUrl.searchParams.getAll("sslmode").length !== 1 ||
    databaseUrl.searchParams.get("sslmode") !== "verify-full" ||
    databaseUrl.searchParams.getAll("connect_timeout").length !== 1 ||
    databaseUrl.searchParams.getAll("sslrootcert").length > 1
  ) {
    fail("SUPABASE_DB_URL must use certificate- and hostname-verified TLS without host overrides.");
  }
  const connectTimeout = databaseUrl.searchParams.get("connect_timeout");
  if (
    !connectTimeout ||
    !/^\d+$/.test(connectTimeout) ||
    Number(connectTimeout) < 1 ||
    Number(connectTimeout) > 30
  ) {
    fail("SUPABASE_DB_URL must set a bounded connection timeout (1–30 seconds).");
  }

  if (
    databaseUrl.searchParams.has("host") ||
    databaseUrl.searchParams.has("port") ||
    databaseUrl.searchParams.has("user") ||
    databaseUrl.searchParams.has("password")
  ) {
    fail("SUPABASE_DB_URL connection overrides are not allowed.");
  }

  if (
    env.PRIVATE_OBJECT_DIR?.replace(/^\/+|\/+$/g, "") !== "private" ||
    env.PUBLIC_OBJECT_SEARCH_PATHS?.split(",").map((value) => value.trim()).filter(Boolean).join(",") !== "public"
  ) {
    fail("API-only App Storage must use the isolated private/ and public/ namespaces.");
  }

  // node-postgres does not translate the libpq-style connect_timeout URL
  // parameter into PoolConfig.connectionTimeoutMillis. Return it explicitly
  // so the API-only startup path can pass the validated value to pg.
  return Number(connectTimeout) * 1_000;
}
