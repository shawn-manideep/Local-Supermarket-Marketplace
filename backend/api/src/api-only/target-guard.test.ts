import assert from "node:assert/strict";
import test from "node:test";
import pg from "pg";
import {
  loadApiOnlyApp,
  verifyReadOnlyDatabaseIdentity,
  type ReadOnlyIdentityClient,
} from "./startup.js";
import {
  API_ONLY_PROJECT_REF,
  assertApiOnlyTarget,
  PROTECTED_PROJECT_REF,
} from "./target-guard.js";

function jwt(ref = API_ONLY_PROJECT_REF, role = "anon") {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({ ref, role })).toString("base64url");
  return `${header}.${payload}.synthetic-signature`;
}

function validEnv(): NodeJS.ProcessEnv {
  const host = `db.${API_ONLY_PROJECT_REF}.supabase.co`;
  return {
    API_OBJECT_STORAGE_PROVIDER: "replit-app-storage",
    SUPABASE_URL: `https://${API_ONLY_PROJECT_REF}.supabase.co`,
    SUPABASE_ANON_KEY: jwt(API_ONLY_PROJECT_REF, "anon"),
    SUPABASE_SERVICE_ROLE_KEY: jwt(API_ONLY_PROJECT_REF, "service_role"),
    SUPABASE_DB_URL: `postgresql://postgres:synthetic-password@${host}:5432/postgres?sslmode=verify-full&connect_timeout=10`,
    SESSION_SECRET: "synthetic-session-secret-with-more-than-32-characters",
    MASTER_CATALOG_REVIEW_TOKEN_SECRET: "synthetic-master-catalog-secret-with-more-than-32-characters",
    API_ONLY_EXPECTED_DB_HOST: host,
    API_ONLY_EXPECTED_DB_USERNAME: "postgres",
    API_ONLY_EXPECTED_DB_PORT: "5432",
    API_ONLY_EXPECTED_DB_MODE: "direct",
    PRIVATE_OBJECT_DIR: "private",
    PUBLIC_OBJECT_SEARCH_PATHS: "public",
  };
}

test("API-only guard accepts only the isolated project and explicit SDK mode", () => {
  assert.equal(assertApiOnlyTarget(validEnv()), 10_000);
  assert.throws(
    () => assertApiOnlyTarget({ ...validEnv(), API_OBJECT_STORAGE_PROVIDER: undefined }),
    /explicitly select replit-app-storage/,
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

test("API-only guard rejects protected or mismatched Supabase projects", () => {
  assert.throws(
    () =>
      assertApiOnlyTarget({
        ...validEnv(),
        SUPABASE_URL: `https://${PROTECTED_PROJECT_REF}.supabase.co`,
      }),
    /not the allowlisted isolated project/,
  );
  assert.throws(
    () => assertApiOnlyTarget({ ...validEnv(), SUPABASE_ANON_KEY: jwt(PROTECTED_PROJECT_REF) }),
    /API key does not identify the isolated project/,
  );
  assert.throws(
    () =>
      assertApiOnlyTarget({
        ...validEnv(),
        SUPABASE_DB_URL: `postgresql://postgres:synthetic-password@db.${PROTECTED_PROJECT_REF}.supabase.co:5432/postgres?sslmode=verify-full&connect_timeout=10`,
        API_ONLY_EXPECTED_DB_HOST: `db.${PROTECTED_PROJECT_REF}.supabase.co`,
      }),
    /protected project/,
  );
});

test("API-only guard rejects unverified TLS, endpoint overrides, and unbounded connects", () => {
  const cases = [
    "postgresql://postgres:synthetic-password@db.nrnigsznectrgbgafwme.supabase.co:5432/postgres?sslmode=require&connect_timeout=10",
    "postgresql://postgres:synthetic-password@db.nrnigsznectrgbgafwme.supabase.co:5432/postgres?sslmode=verify-full&connect_timeout=60",
    "postgresql://postgres:synthetic-password@db.nrnigsznectrgbgafwme.supabase.co:5432/postgres?sslmode=verify-full&connect_timeout=10&host=evil.example",
  ];
  for (const SUPABASE_DB_URL of cases) {
    assert.throws(() => assertApiOnlyTarget({ ...validEnv(), SUPABASE_DB_URL }));
  }
  assert.throws(
    () =>
      assertApiOnlyTarget({
        ...validEnv(),
        API_ONLY_EXPECTED_DB_HOST: "unverified.example",
        API_ONLY_EXPECTED_DB_MODE: "direct",
      }),
    /owner-confirmed isolated endpoint/,
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
    /not the allowlisted isolated project/,
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
