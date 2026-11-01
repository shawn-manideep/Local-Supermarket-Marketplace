import assert from "node:assert/strict";
import test from "node:test";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { syntheticExternalEnv } from "../storage/fixtures/fake-gcs.js";
import { syntheticSupabaseEnv } from "../storage/fixtures/fake-supabase-storage.js";
import {
  API_ONLY_QUERY_TIMEOUT_MS,
  API_ONLY_STATEMENT_TIMEOUT_MS,
  apiOnlyPoolOptions,
  loadApiOnlyApp,
  verifyReadOnlyDatabaseIdentity,
  type ReadOnlyIdentityClient,
} from "./startup.js";
import {
  API_ONLY_TARGET_PROFILES,
  assertApiOnlyTarget,
  type ApiOnlyTargetProfile,
} from "./target-guard.js";

function jwt(ref: string, role = "anon") {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({ ref, role })).toString("base64url");
  return `${header}.${payload}.synthetic-signature`;
}

test("Supabase prototype preserves target/TLS/key guards and always refuses live startup", () => {
  const valid: NodeJS.ProcessEnv = { ...validEnv("isolated-native-preview"), ...syntheticSupabaseEnv() };
  assert.throws(() => assertApiOnlyTarget(valid), /Supabase Storage live operations are disabled/);
  assert.throws(() => assertApiOnlyTarget({ ...valid, SUPABASE_STORAGE_BUCKET: undefined }), /Invalid offline Supabase/);
  assert.throws(() => assertApiOnlyTarget({ ...valid, API_ONLY_TARGET_PROFILE: "original-customer-apk" }),
    /SUPABASE_URL does not match/);
  assert.throws(() => assertApiOnlyTarget({ ...valid, SUPABASE_ANON_KEY: jwt("wrong") }), /API key/);
  assert.throws(() => assertApiOnlyTarget({ ...valid, SESSION_SECRET: undefined }), /signing secrets/);
  assert.throws(() => assertApiOnlyTarget({
    ...valid, SUPABASE_DB_URL: valid.SUPABASE_DB_URL!.replace("verify-full", "disable"),
  }), /TLS/);
});

function validEnv(
  targetProfile: ApiOnlyTargetProfile = "isolated-native-preview",
): NodeJS.ProcessEnv {
  const profile = API_ONLY_TARGET_PROFILES[targetProfile];
  return {
    API_ONLY_TARGET_PROFILE: targetProfile,
    API_OBJECT_STORAGE_PROVIDER: "replit-app-storage",
    SUPABASE_URL: profile.supabaseUrl,
    SUPABASE_ANON_KEY: jwt(profile.projectRef, "anon"),
    SUPABASE_SERVICE_ROLE_KEY: jwt(profile.projectRef, "service_role"),
    SUPABASE_DB_URL: `postgresql://${profile.databaseUsername}:synthetic-password@${profile.databaseHost}:${profile.databasePort}/postgres?sslmode=verify-full&connect_timeout=${profile.connectTimeoutSeconds}`,
    SESSION_SECRET: "synthetic-session-secret-with-more-than-32-characters",
    MASTER_CATALOG_REVIEW_TOKEN_SECRET: "synthetic-master-catalog-secret-with-more-than-32-characters",
    API_ONLY_EXPECTED_DB_HOST: profile.databaseHost,
    API_ONLY_EXPECTED_DB_USERNAME: profile.databaseUsername,
    API_ONLY_EXPECTED_DB_PORT: profile.databasePort,
    API_ONLY_EXPECTED_DB_MODE: profile.databaseMode,
    PRIVATE_OBJECT_DIR: "private",
    PUBLIC_OBJECT_SEARCH_PATHS: "public",
  };
}

test("API-only guard accepts only the two fixed project profiles and explicit SDK mode", () => {
  assert.equal(assertApiOnlyTarget(validEnv("isolated-native-preview")), 10_000);
  assert.equal(assertApiOnlyTarget(validEnv("original-customer-apk")), 10_000);
  assert.throws(
    () => assertApiOnlyTarget({ ...validEnv(), API_OBJECT_STORAGE_PROVIDER: undefined }),
    /explicitly select replit-app-storage/,
  );
});

test("original Supabase target is accepted only by its explicitly named profile", () => {
  const original = validEnv("original-customer-apk");
  assert.equal(assertApiOnlyTarget(original), 10_000);

  assert.throws(
    () => assertApiOnlyTarget({ ...original, API_ONLY_TARGET_PROFILE: "isolated-native-preview" }),
    /SUPABASE_URL does not match/,
  );
  assert.throws(
    () => assertApiOnlyTarget({ ...original, API_ONLY_TARGET_PROFILE: "unapproved-profile" }),
    /code-defined target profile/,
  );
  assert.throws(
    () => {
      const missing = { ...original };
      delete missing.API_ONLY_TARGET_PROFILE;
      assertApiOnlyTarget(missing);
    },
    /code-defined target profile/,
  );
});

test("external GCS requires complete explicit configuration without weakening original DB and auth guards", () => {
  const valid = { ...validEnv("original-customer-apk"), ...syntheticExternalEnv() };
  assert.equal(assertApiOnlyTarget(valid), 10_000);
  for (const key of ["EXTERNAL_GCS_RUNTIME_APPROVAL", "EXTERNAL_GCS_BUCKET", "EXTERNAL_GCS_PRIVATE_KEY"]) {
    const invalid = { ...valid };
    delete invalid[key];
    assert.throws(() => assertApiOnlyTarget(invalid), /External GCS/);
  }
  assert.throws(() => assertApiOnlyTarget({ ...valid, SUPABASE_URL: "https://other.invalid" }), /SUPABASE_URL/);
  assert.throws(() => assertApiOnlyTarget({ ...valid, SUPABASE_ANON_KEY: jwt("other") }), /API key/);
  assert.throws(() => assertApiOnlyTarget({ ...valid, SESSION_SECRET: undefined }), /signing secrets/);
  assert.throws(() => assertApiOnlyTarget({ ...valid, SUPABASE_DB_URL: valid.SUPABASE_DB_URL!.replace("verify-full", "disable") }), /TLS/);
});

test("target profiles reject cross-project URL and key claims", () => {
  const original = validEnv("original-customer-apk");
  const isolated = validEnv("isolated-native-preview");

  assert.throws(
    () => assertApiOnlyTarget({ ...original, SUPABASE_URL: isolated.SUPABASE_URL }),
    /SUPABASE_URL does not match/,
  );
  assert.throws(
    () => assertApiOnlyTarget({ ...original, SUPABASE_ANON_KEY: isolated.SUPABASE_ANON_KEY }),
    /API key does not match/,
  );
  assert.throws(
    () => assertApiOnlyTarget({
      ...original,
      SUPABASE_SERVICE_ROLE_KEY: jwt(
        API_ONLY_TARGET_PROFILES["original-customer-apk"].projectRef,
        "anon",
      ),
    }),
    /API key does not match/,
  );
  assert.throws(
    () => assertApiOnlyTarget({ ...isolated, SUPABASE_URL: original.SUPABASE_URL }),
    /SUPABASE_URL does not match/,
  );
});

test("original database host, username, port, and mode are fixed by its profile", () => {
  const original = validEnv("original-customer-apk");
  const connection = new URL(original.SUPABASE_DB_URL!);

  const wrongHost = new URL(connection);
  wrongHost.hostname = "aws-1-ap-south-1.pooler.supabase.com";
  assert.throws(
    () => assertApiOnlyTarget({ ...original, SUPABASE_DB_URL: wrongHost.toString() }),
    /does not match the selected target profile endpoint/,
  );

  const wrongUser = new URL(connection);
  wrongUser.username = "postgres.otherproject";
  assert.throws(
    () => assertApiOnlyTarget({ ...original, SUPABASE_DB_URL: wrongUser.toString() }),
    /does not match the selected target profile endpoint/,
  );

  const wrongPort = new URL(connection);
  wrongPort.port = "6543";
  assert.throws(
    () => assertApiOnlyTarget({ ...original, SUPABASE_DB_URL: wrongPort.toString() }),
    /does not match the selected target profile endpoint/,
  );
  const missingPort = new URL(connection);
  missingPort.port = "";
  assert.throws(
    () => assertApiOnlyTarget({ ...original, SUPABASE_DB_URL: missingPort.toString() }),
    /does not match the selected target profile endpoint/,
  );
  assert.throws(
    () => assertApiOnlyTarget({ ...original, API_ONLY_EXPECTED_DB_MODE: "direct" }),
    /metadata does not match/,
  );
  assert.throws(
    () => assertApiOnlyTarget({ ...original, API_ONLY_EXPECTED_DB_HOST: "other.pooler.supabase.com" }),
    /metadata does not match/,
  );
});
test("isolated preview database host, username, port, and mode are fixed by its profile", () => {
  const isolated = validEnv("isolated-native-preview");
  const connection = new URL(isolated.SUPABASE_DB_URL!);

  const wrongHost = new URL(connection);
  wrongHost.hostname = "aws-1-ap-south-1.pooler.supabase.com";
  assert.throws(
    () => assertApiOnlyTarget({ ...isolated, SUPABASE_DB_URL: wrongHost.toString() }),
    /does not match the selected target profile endpoint/,
  );

  const wrongUser = new URL(connection);
  wrongUser.username = "postgres.gkwcolipeavxnuzqlamb";
  assert.throws(
    () => assertApiOnlyTarget({ ...isolated, SUPABASE_DB_URL: wrongUser.toString() }),
    /does not match the selected target profile endpoint/,
  );

  const wrongPort = new URL(connection);
  wrongPort.port = "6543";
  assert.throws(
    () => assertApiOnlyTarget({ ...isolated, SUPABASE_DB_URL: wrongPort.toString() }),
    /does not match the selected target profile endpoint/,
  );

  const missingPort = new URL(connection);
  missingPort.port = "";
  assert.throws(
    () => assertApiOnlyTarget({ ...isolated, SUPABASE_DB_URL: missingPort.toString() }),
    /does not match the selected target profile endpoint/,
  );

  assert.throws(
    () => assertApiOnlyTarget({ ...isolated, API_ONLY_EXPECTED_DB_MODE: "direct" }),
    /metadata does not match/,
  );

  assert.throws(
    () => assertApiOnlyTarget({ ...isolated, API_ONLY_EXPECTED_DB_HOST: "other.pooler.supabase.com" }),
    /metadata does not match/,
  );
});


test("validated connect_timeout is applied through pg's connectionTimeoutMillis option", () => {
  const connectionString = validEnv().SUPABASE_DB_URL!;
  const connectionTimeoutMillis = assertApiOnlyTarget(validEnv());

  // The installed driver ignores connect_timeout in the URL. Without the
  // explicit PoolConfig option, its client has no connection timeout.
  const urlOnlyPool = new pg.Pool({ connectionString });
  const urlOnlyClient = new pg.Client({ connectionString });
  assert.equal(
    (urlOnlyPool as unknown as { options: { connectionTimeoutMillis?: number } })
      .options.connectionTimeoutMillis,
    undefined,
  );
  assert.equal(
    (urlOnlyClient as unknown as { _connectionTimeoutMillis: number })
      ._connectionTimeoutMillis,
    0,
  );

  const boundedPool = new pg.Pool({ connectionString, connectionTimeoutMillis });
  const boundedClient = new pg.Client({
    connectionString,
    connectionTimeoutMillis,
  });
  assert.equal(
    (boundedPool as unknown as { options: { connectionTimeoutMillis: number } })
      .options.connectionTimeoutMillis,
    10_000,
  );
  assert.equal(
    (boundedClient as unknown as { _connectionTimeoutMillis: number })
      ._connectionTimeoutMillis,
    10_000,
  );
});

test("API-only pool applies server statement and client query timeouts; default pool options remain unset", () => {
  const connectionString = validEnv().SUPABASE_DB_URL!;
  const options = apiOnlyPoolOptions(assertApiOnlyTarget(validEnv()));
  const defaultPool = new pg.Pool({ connectionString });
  const apiOnlyPool = new pg.Pool({ connectionString, ...options });
  const apiOnlyClient = new pg.Client({ connectionString, ...options });
  const connectionParameters = (apiOnlyClient as unknown as {
    connectionParameters: { statement_timeout: number; query_timeout: number };
  }).connectionParameters;

  assert.equal(defaultPool.options.statement_timeout, undefined);
  assert.equal(defaultPool.options.query_timeout, undefined);
  assert.equal(apiOnlyPool.options.connectionTimeoutMillis, 10_000);
  assert.equal(apiOnlyPool.options.statement_timeout, API_ONLY_STATEMENT_TIMEOUT_MS);
  assert.equal(apiOnlyPool.options.query_timeout, API_ONLY_QUERY_TIMEOUT_MS);
  assert.equal(connectionParameters.statement_timeout, 60_000);
  assert.equal(connectionParameters.query_timeout, 65_000);
});

test("a statement-timeout error rolls back and releases the transaction client without retry", async () => {
  const statements: string[] = [];
  let released = 0;
  let timedOutStatementCount = 0;
  const timeoutError = Object.assign(
    new Error("canceling statement due to statement timeout"),
    { code: "57014" },
  );
  const client = {
    async query(config: string | { text?: string }) {
      const text = typeof config === "string" ? config : config.text ?? "";
      statements.push(text);
      if (text === "SELECT timeout_probe") {
        timedOutStatementCount += 1;
        throw timeoutError;
      }
      return { rows: [], rowCount: 0 };
    },
    release() {
      released += 1;
    },
  };
  class FakePool {
    async connect() {
      return client;
    }
  }
  const database = drizzle(new FakePool() as unknown as pg.Pool);

  await assert.rejects(
    database.transaction(async (transaction) => {
      await transaction.execute(sql.raw("SELECT timeout_probe"));
    }),
    (error: unknown) =>
      error instanceof Error &&
      (error.cause as { code?: string } | undefined)?.code === "57014",
  );
  assert.deepEqual(statements, [
    "begin",
    "SELECT timeout_probe",
    "rollback",
  ]);
  assert.equal(timedOutStatementCount, 1, "timed-out writes or statements must not be retried");
  assert.equal(released, 1);
});

test("API-only guard rejects unverified TLS, endpoint overrides, and unbounded connects", () => {
  const original = validEnv("original-customer-apk");
  const cases = [
    "postgresql://postgres.gkwcolipeavxnuzqlamb:synthetic-password@aws-0-ap-south-1.pooler.supabase.com:5432/postgres?sslmode=require&connect_timeout=10",
    "postgresql://postgres.gkwcolipeavxnuzqlamb:synthetic-password@aws-0-ap-south-1.pooler.supabase.com:5432/postgres?sslmode=verify-full&connect_timeout=9",
    "postgresql://postgres.gkwcolipeavxnuzqlamb:synthetic-password@aws-0-ap-south-1.pooler.supabase.com:5432/postgres?sslmode=verify-full&connect_timeout=30",
    "postgresql://postgres.gkwcolipeavxnuzqlamb:synthetic-password@aws-0-ap-south-1.pooler.supabase.com:5432/postgres?sslmode=verify-full&connect_timeout=10&host=evil.example",
  ];
  for (const SUPABASE_DB_URL of cases) {
    assert.throws(() => assertApiOnlyTarget({ ...original, SUPABASE_DB_URL }));
  }
  assert.throws(
    () => assertApiOnlyTarget({ ...original, SUPABASE_DB_URL: undefined }),
    /SUPABASE_DB_URL is required/,
  );
});

test("API-only guard requires explicit isolated storage namespaces and signing secrets", () => {
  assert.throws(
    () => assertApiOnlyTarget({ ...validEnv(), PRIVATE_OBJECT_DIR: "bucket/private" }),
    /private\/ and public\//,
  );
  assert.throws(
    () => assertApiOnlyTarget({ ...validEnv(), SESSION_SECRET: undefined }),
    /Dedicated server-side signing secrets/,
  );
});

test("startup rejects invalid configuration before loading the API app", async () => {
  let loadCalls = 0;
  await assert.rejects(
    loadApiOnlyApp(
      { ...validEnv(), SUPABASE_URL: "https://unverified.example" },
      async () => undefined,
      async () => {
        loadCalls += 1;
        return "loaded";
      },
    ),
    /does not match the selected API-only target profile/,
  );
  assert.equal(loadCalls, 0);

  let identityChecks = 0;
  const loaded = await loadApiOnlyApp(
    validEnv(),
    async (connectionTimeoutMillis) => {
      identityChecks += 1;
      assert.equal(connectionTimeoutMillis, 10_000);
    },
    async () => {
      loadCalls += 1;
      return "loaded";
    },
  );
  assert.equal(loaded, "loaded");
  assert.equal(loadCalls, 1);
  assert.equal(identityChecks, 1);

  await assert.rejects(
    loadApiOnlyApp(
      validEnv(),
      async (_connectionTimeoutMillis) => {
        throw new Error("synthetic database connection failure");
      },
      async () => {
        loadCalls += 1;
        return "should not load";
      },
    ),
    /synthetic database connection failure/,
  );
  assert.equal(loadCalls, 1);
});

test("startup identity check uses only a bounded read-only transaction and always releases", async () => {
  const statements: string[] = [];
  let released = false;
  const client: ReadOnlyIdentityClient = {
    async query({ text, query_timeout }) {
      assert.equal(query_timeout, 5_000);
      statements.push(text);
      return {
        rows: text.startsWith("SELECT") ? [{ database_name: "postgres" }] : [],
      };
    },
    release() {
      released = true;
    },
  };

  await verifyReadOnlyDatabaseIdentity(client);
  assert.deepEqual(statements, [
    "BEGIN READ ONLY",
    "SELECT current_database() AS database_name",
    "ROLLBACK",
  ]);
  assert.equal(released, true);

  const wrongDatabaseClient: ReadOnlyIdentityClient = {
    async query({ text }) {
      return { rows: text.startsWith("SELECT") ? [{ database_name: "protected" }] : [] };
    },
    release() {},
  };
  await assert.rejects(
    verifyReadOnlyDatabaseIdentity(wrongDatabaseClient),
    /read-only database identity could not be verified/,
  );
});
