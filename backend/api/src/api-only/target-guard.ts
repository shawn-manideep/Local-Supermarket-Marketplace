export const API_ONLY_TARGET_PROFILES = {
  "original-customer-apk": {
    projectRef: "gkwcolipeavxnuzqlamb",
    supabaseUrl: "https://gkwcolipeavxnuzqlamb.supabase.co",
    databaseHost: "aws-0-ap-south-1.pooler.supabase.com",
    databaseUsername: "postgres.gkwcolipeavxnuzqlamb",
    databasePort: "5432",
    databaseName: "postgres",
    databaseMode: "session",
    connectTimeoutSeconds: 10,
  },
  "isolated-native-preview": {
    projectRef: "nrnigsznectrgbgafwme",
    supabaseUrl: "https://nrnigsznectrgbgafwme.supabase.co",
    databaseHost: "db.nrnigsznectrgbgafwme.supabase.co",
    databaseUsername: "postgres",
    databasePort: "5432",
    databaseName: "postgres",
    databaseMode: "direct",
    connectTimeoutSeconds: 10,
  },
} as const;

export type ApiOnlyTargetProfile = keyof typeof API_ONLY_TARGET_PROFILES;

function fail(message: string): never {
  throw new Error(`API-only startup refused: ${message}`);
}

function readJwtClaims(
  token: string,
  expectedProjectRef: string,
  expectedRole: "anon" | "service_role",
) {
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
    claims.ref !== expectedProjectRef ||
    !("role" in claims) ||
    claims.role !== expectedRole
  ) {
    return fail("Supabase API key does not match the selected API-only target profile.");
  }
}

function exactHttpsProjectUrl(value: string | undefined, expectedUrl: string) {
  if (!value) fail("SUPABASE_URL is required.");
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return fail("SUPABASE_URL is invalid.");
  }
  if (
    url.protocol !== "https:" ||
    url.origin !== expectedUrl ||
    url.port ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    fail("SUPABASE_URL does not match the selected API-only target profile.");
  }
}

export function assertApiOnlyTarget(env: NodeJS.ProcessEnv): number {
  const requestedProfile = env.API_ONLY_TARGET_PROFILE;
  if (
    !requestedProfile ||
    !Object.hasOwn(API_ONLY_TARGET_PROFILES, requestedProfile)
  ) {
    fail("API_ONLY_TARGET_PROFILE must select a code-defined target profile.");
  }
  const profile =
    API_ONLY_TARGET_PROFILES[requestedProfile as ApiOnlyTargetProfile];
  const profileHasValidEndpoint =
    (profile.databaseMode === "session" &&
      profile.databaseHost === "aws-0-ap-south-1.pooler.supabase.com" &&
      profile.databaseUsername === `postgres.${profile.projectRef}`) ||
    (profile.databaseMode === "direct" &&
      profile.databaseHost === `db.${profile.projectRef}.supabase.co` &&
      profile.databaseUsername === "postgres");
  if (!profileHasValidEndpoint) {
    fail("The selected code-defined profile has an invalid database endpoint.");
  }

  if (env.API_OBJECT_STORAGE_PROVIDER !== "replit-app-storage") {
    fail("API_OBJECT_STORAGE_PROVIDER must explicitly select replit-app-storage.");
  }

  exactHttpsProjectUrl(env.SUPABASE_URL, profile.supabaseUrl);

  if (!env.SUPABASE_ANON_KEY || !env.SUPABASE_SERVICE_ROLE_KEY) {
    fail("The selected project's Supabase API keys are required.");
  }
  readJwtClaims(env.SUPABASE_ANON_KEY, profile.projectRef, "anon");
  readJwtClaims(env.SUPABASE_SERVICE_ROLE_KEY, profile.projectRef, "service_role");
  if (
    !env.SESSION_SECRET ||
    env.SESSION_SECRET.length < 32 ||
    !env.MASTER_CATALOG_REVIEW_TOKEN_SECRET ||
    env.MASTER_CATALOG_REVIEW_TOKEN_SECRET.length < 32
  ) {
    fail("Dedicated server-side signing secrets of at least 32 characters are required.");
  }

  const connectionString = env.SUPABASE_DB_URL;
  if (!connectionString) {
    fail("SUPABASE_DB_URL is required.");
  }

  // These legacy settings are no longer authoritative. If present, they must
  // agree with the selected code-defined profile.
  const suppliedEndpointMetadata: Array<[string | undefined, string]> = [
    [env.API_ONLY_EXPECTED_DB_HOST?.toLowerCase(), profile.databaseHost],
    [env.API_ONLY_EXPECTED_DB_USERNAME, profile.databaseUsername],
    [env.API_ONLY_EXPECTED_DB_PORT, profile.databasePort],
    [env.API_ONLY_EXPECTED_DB_MODE, profile.databaseMode],
  ];
  if (suppliedEndpointMetadata.some(([supplied, expected]) =>
    supplied !== undefined && supplied !== expected
  )) {
    fail("Owner-confirmed database metadata does not match the selected target profile.");
  }

  let databaseUrl: URL;
  try {
    databaseUrl = new URL(connectionString);
  } catch {
    return fail("SUPABASE_DB_URL is invalid.");
  }
  const databaseUser = decodeURIComponent(databaseUrl.username);
  const databasePort = databaseUrl.port;

  if (
    !["postgres:", "postgresql:"].includes(databaseUrl.protocol) ||
    databaseUrl.hostname.toLowerCase() !== profile.databaseHost ||
    databaseUser !== profile.databaseUsername ||
    databasePort !== profile.databasePort ||
    databaseUrl.pathname !== `/${profile.databaseName}` ||
    databaseUrl.hash ||
    !databaseUrl.password
  ) {
    fail("SUPABASE_DB_URL does not match the selected target profile endpoint.");
  }

  const queryKeys = [...databaseUrl.searchParams.keys()];
  if (
    queryKeys.some((key) => !["sslmode", "sslrootcert", "connect_timeout"].includes(key)) ||
    databaseUrl.searchParams.getAll("sslmode").length !== 1 ||
    databaseUrl.searchParams.get("sslmode") !== "verify-full" ||
    databaseUrl.searchParams.getAll("connect_timeout").length !== 1 ||
    databaseUrl.searchParams.getAll("sslrootcert").length > 1 ||
    (databaseUrl.searchParams.has("sslrootcert") &&
      !databaseUrl.searchParams.get("sslrootcert"))
  ) {
    fail("SUPABASE_DB_URL must use certificate- and hostname-verified TLS without host overrides.");
  }
  const connectTimeout = databaseUrl.searchParams.get("connect_timeout");
  if (!connectTimeout || !/^\d+$/.test(connectTimeout) ||
    Number(connectTimeout) !== profile.connectTimeoutSeconds
  ) {
    fail("SUPABASE_DB_URL must use the selected profile's bounded connection timeout.");
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
