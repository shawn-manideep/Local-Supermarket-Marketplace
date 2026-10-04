import assert from "node:assert/strict";
import test from "node:test";
import { assertDevelopmentTarget } from "./dev-test-account.js";

const env = {
  NODE_ENV: "development",
  SUPABASE_URL: "https://gkwcolipeavxnuzqlamb.supabase.co",
  SUPABASE_DB_URL: "postgresql://postgres.gkwcolipeavxnuzqlamb:unused@aws-0-test.pooler.supabase.com:6543/postgres",
  SUPABASE_ANON_KEY: "unused-test-key",
  SUPABASE_SERVICE_ROLE_KEY: "unused-test-key",
};
test("development command accepts only explicitly enabled allowlisted Auth and DB targets", () => {
  assert.doesNotThrow(() => assertDevelopmentTarget(env));
  assert.doesNotThrow(() => assertDevelopmentTarget({ ...env, REPLIT_ENVIRONMENT: "production" }));
  assert.doesNotThrow(() => assertDevelopmentTarget({ ...env, SUPABASE_DB_URL: "postgresql://postgres:unused@db.gkwcolipeavxnuzqlamb.supabase.co:5432/postgres" }));
  for (const changes of [
    { NODE_ENV: "production" }, { NODE_ENV: undefined }, { REPLIT_DEPLOYMENT: "1" },
    { SUPABASE_URL: "https://another.supabase.co" },
    { SUPABASE_URL: `${env.SUPABASE_URL}/other` },
    { SUPABASE_DB_URL: "postgresql://postgres.other:unused@aws-0-test.pooler.supabase.com/postgres" },
    { SUPABASE_DB_URL: "postgresql://postgres.gkwcolipeavxnuzqlamb:unused@evil.example/postgres" },
    { SUPABASE_DB_URL: `${env.SUPABASE_DB_URL}?host=evil.example` },
    { SUPABASE_SERVICE_ROLE_KEY: undefined },
  ]) assert.throws(() => assertDevelopmentTarget({ ...env, ...changes }));
});