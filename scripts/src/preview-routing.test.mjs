import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";

const source = path => readFile(new URL(`../../${path}`, import.meta.url), "utf8");

test("development web previews use the managed API port and isolate native build variables", async () => {
  const [customer, dashboard, manifest] = await Promise.all([
    source("scripts/src/customer-web-preview.mjs"),
    source("apps/dashboard/vite.config.ts"),
    source("artifacts/marketplace-customer/.replit-artifact/artifact.toml"),
  ]);
  assert.match(customer, /process\.env\.PREVIEW_BACKEND_ORIGIN \?\? "http:\/\/127\.0\.0\.1:8080"/);
  assert.match(dashboard, /process\.env\.PREVIEW_BACKEND_ORIGIN \?\? "http:\/\/127\.0\.0\.1:8080"/);
  const development = manifest.split("[services.development]")[1].split("[services.production]")[0];
  assert.match(development, /EXPO_PUBLIC_API_URL= EXPO_PUBLIC_DOMAIN= EXPO_PUBLIC_SUPABASE_URL=\$SUPABASE_URL EXPO_PUBLIC_SUPABASE_ANON_KEY=\$SUPABASE_ANON_KEY/);
  assert.match(development, /expo export --clear --platform web/);
  assert.match(development, /PORT=\$PORT BASE_PATH=\$BASE_PATH/);
});

test("Customer preview serves its base path, proxies API status/payloads and cleans up offline fixtures", { timeout: 15_000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), "alb-preview-fixture-"));
  const upstream = createServer(async (request, response) => {
    const recovery = request.url.startsWith("/api/auth/recovery");
    assert.equal(request.headers.origin, recovery ? "https://offline.invalid" : undefined);
    if (request.url === "/api/health") {
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify({ status: "ok", fixture: true }));
    } else {
      let body = "";
      for await (const chunk of request) body += chunk;
      assert.equal(request.method, "POST");
      if (recovery) {
        assert.equal(request.url, "/api/auth/recovery/?source=fixture");
        assert.deepEqual(JSON.parse(body), { role: "customer", identity: "fixture_user" });
        response.writeHead(202, { "Content-Type": "application/json", "Cache-Control": "no-store" });
        response.end(JSON.stringify({ message: "Offline recovery fixture" }));
      } else {
        assert.equal(request.url, "/api/customer/login");
        assert.deepEqual(JSON.parse(body), { username: "fixture_user", password: "fixture-password" });
        response.writeHead(401, { "Content-Type": "application/json", "Cache-Control": "no-store" });
        response.end(JSON.stringify({ error: "Invalid username or password." }));
      }
    }
  });
  let child;
  try {
    await writeFile(join(root, "index.html"), "<html><body>Offline preview fixture</body></html>");
    upstream.listen(0, "127.0.0.1");
    await once(upstream, "listening");
    const reserved = createServer();
    reserved.listen(0, "127.0.0.1");
    await once(reserved, "listening");
    const port = reserved.address().port;
    await new Promise(resolve => reserved.close(resolve));
    child = spawn(process.execPath, [new URL("./customer-web-preview.mjs", import.meta.url).pathname, root], {
      env: { PATH: process.env.PATH, PORT: String(port), BASE_PATH: "/customer/", PREVIEW_BACKEND_ORIGIN: `http://127.0.0.1:${upstream.address().port}` },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let ready = false;
    child.stdout.on("data", chunk => { ready ||= chunk.toString().includes("Customer Web preview listening"); });
    // Drain stderr without leaking any raw runtime output.
    child.stderr.on("data", () => {});
    for (let attempt = 0; attempt < 100 && !ready && child.exitCode === null; attempt++) await delay(25);
    assert.equal(ready, true, "offline preview fixture must start");
    const origin = `http://127.0.0.1:${port}`;
    const page = await fetch(`${origin}/customer/`, { signal: AbortSignal.timeout(2_000) });
    assert.equal(page.status, 200);
    assert.match(await page.text(), /Offline preview fixture/);
    const health = await fetch(`${origin}/api/health`, { signal: AbortSignal.timeout(2_000) });
    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), { status: "ok", fixture: true });
    const denied = await fetch(`${origin}/api/customer/login`, {
      method: "POST", headers: { "Content-Type": "application/json", Origin: "https://offline.invalid" },
      body: JSON.stringify({ username: "fixture_user", password: "fixture-password" }),
      signal: AbortSignal.timeout(2_000),
    });
    assert.equal(denied.status, 401);
    assert.equal(denied.headers.get("cache-control"), "no-store");
    assert.deepEqual(await denied.json(), { error: "Invalid username or password." });
    const recovery = await fetch(`${origin}/api/auth/recovery/?source=fixture`, {
      method: "POST", headers: { "Content-Type": "application/json", Origin: "https://offline.invalid" },
      body: JSON.stringify({ role: "customer", identity: "fixture_user" }),
      signal: AbortSignal.timeout(2_000),
    });
    assert.equal(recovery.status, 202);
    assert.equal(recovery.headers.get("cache-control"), "no-store");
    assert.deepEqual(await recovery.json(), { message: "Offline recovery fixture" });
    upstream.closeAllConnections();
    await new Promise(resolve => upstream.close(resolve));
    const unavailable = await fetch(`${origin}/api/health`, { signal: AbortSignal.timeout(2_000) });
    assert.equal(unavailable.status, 502);
    assert.deepEqual(await unavailable.json(), { error: "Preview service unavailable" });
  } finally {
    if (child && child.exitCode === null) {
      const exited = once(child, "exit");
      child.kill();
      await exited;
    }
    upstream.closeAllConnections();
    if (upstream.listening) await new Promise(resolve => upstream.close(resolve));
    await rm(root, { recursive: true, force: true });
  }
});
