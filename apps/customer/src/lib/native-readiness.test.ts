import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";
import { nativeConfigurationIssues, isPublicSupabaseKey } from "./native-readiness.mjs";
import { CUSTOMER_NATIVE_AUTH_REDIRECT, parseNativeAuthCallback } from "./native-auth";

// Synthetic values are unit-test inputs only; never application configuration.
const publicConfig = {
  apiUrl: "https://api.example.com",
  supabaseUrl: "https://example.supabase.co",
  anonKey: "sb_publishable_unit_test",
};
const jwt = (role: string) => `header.${Buffer.from(JSON.stringify({ role })).toString("base64url")}.signature`;

test("native configuration accepts public HTTPS and only public Supabase key types", () => {
  assert.deepEqual(nativeConfigurationIssues(publicConfig), []);
  assert.equal(isPublicSupabaseKey(jwt("anon")), true);
  for (const key of [jwt("service_role"), jwt("authenticated"), "sb_secret_unit_test", "", undefined]) {
    assert.equal(isPublicSupabaseKey(key), false);
    assert.ok(nativeConfigurationIssues({ ...publicConfig, anonKey: key }).length);
  }
});

test("native configuration rejects missing, local, temporary, credentialed and non-HTTPS endpoints", () => {
  for (const apiUrl of [undefined, "", "/api", "http://api.example.com", "https://localhost",
    "https://127.0.0.1", "https://10.1.2.3", "https://192.168.1.2", "https://172.16.1.1",
    "https://[::1]", "https://workspace.replit.dev", "https://workspace.repl.co",
    "https://user:password@api.example.com", "https://api.example.com?token=sensitive"]) {
    const issues = nativeConfigurationIssues({ ...publicConfig, apiUrl });
    assert.ok(issues.length, String(apiUrl));
    assert.doesNotMatch(JSON.stringify(issues), /sensitive|user:password/);
  }
  assert.ok(nativeConfigurationIssues({ ...publicConfig, supabaseUrl: "https://example.supabase.co/auth" }).length);
});

test("the preview check fails closed without public variables and never consumes server credentials", () => {
  const result = spawnSync(process.execPath, [new URL("../../scripts/check-native-config.mjs", import.meta.url).pathname], {
    env: {
      PATH: process.env.PATH,
      SUPABASE_URL: "must-not-be-used",
      SUPABASE_ANON_KEY: "must-not-be-used",
      FRESH_SUPABASE_URL: "must-not-be-used",
      SUPABASE_SERVICE_ROLE_KEY: "never-print-this",
    },
    encoding: "utf8",
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /NOT READY/);
  assert.doesNotMatch(result.stdout + result.stderr, /must-not-be-used|never-print-this/);
});

test("only the exact native callback route accepts complete signup/recovery pairs", () => {
  for (const kind of ["signup", "recovery"] as const) {
    assert.deepEqual(parseNativeAuthCallback(`${CUSTOMER_NATIVE_AUTH_REDIRECT}#type=${kind}&access_token=access&refresh_token=refresh`),
      { kind, access_token: "access", refresh_token: "refresh" });
  }
  for (const url of ["https://untrusted.example/auth/callback", "other-app://auth/callback",
    "apnalocalbasket-customer://other/callback", "apnalocalbasket-customer://auth/other"]) {
    assert.equal(parseNativeAuthCallback(url), null);
  }
});

test("invalid, expired, duplicate and unsupported native callbacks never yield tokens", () => {
  for (const suffix of ["", "?code=pkce-code", "#error=access_denied&error_description=private",
    "#type=recovery&access_token=access", "#type=recovery&access_token=&refresh_token=refresh",
    "#type=magiclink&access_token=access&refresh_token=refresh",
    "#type=recovery&type=signup&access_token=access&refresh_token=refresh",
    "#type=recovery&access_token=one&access_token=two&refresh_token=refresh"]) {
    assert.deepEqual(parseNativeAuthCallback(CUSTOMER_NATIVE_AUTH_REDIRECT + suffix), { kind: "invalid" });
  }
});

test("native callback wiring keeps role/password ownership gates and the web recovery path", () => {
  const app = readFileSync(new URL("../../App.tsx", import.meta.url), "utf8");
  const reset = readFileSync(new URL("../components/AuthControls.tsx", import.meta.url), "utf8");
  assert.match(app, /Linking\.getInitialURL\(\)/);
  assert.match(app, /Linking\.addEventListener\("url"/);
  assert.match(app, /linkSubscription\.remove\(\)/);
  assert.match(app, /Platform\.OS === "web" \|\| nativeConfigurationError \|\| !supabaseConfigured\) return/);
  assert.match(app, /emailRedirectTo: CUSTOMER_NATIVE_AUTH_REDIRECT/);
  assert.match(app, /nativeRecoveryPending\.current/);
  assert.match(app, /window\.history\.replaceState/);
  assert.match(reset, /isPasswordOwner\(profile\.auth, before\.session\.user\.id, "customer"\)/);
});
