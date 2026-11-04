import assert from "node:assert/strict";
import { after, before, test, mock } from "node:test";
import { createServer, type Server } from "node:http";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import * as recovery from "./account-access.js";

// Only the side-effect boundary is doubled. Both actual proxy implementations,
// Express CORS, recovery validation, throttling and responses execute unchanged.
// No account lookup, provider configuration or reset delivery can occur.
const calls: Array<{ input: recovery.RecoveryInput; redirect: string }> = [];
mock.module(new URL("./account-access.ts", import.meta.url).href, {
  exports: {
    ...recovery,
    requestRecovery: async (input: recovery.RecoveryInput, redirect: string) => {
      calls.push({ input, redirect });
      return { message: recovery.RECOVERY_MESSAGE };
    },
  },
});
const { createApp } = await import("../app.js");
const approved = "https://approved-preview.example.test";
const rejected = "https://unapproved.example.test";
const forwarded: Array<{ path: string; origin: string | undefined }> = [];
let previousOrigins: string | undefined;
let directory: string;
let api: Server | undefined;
let dashboard: Server | undefined;
let customer: ChildProcess | undefined;
let vite: { close(): Promise<void> } | undefined;
let apiBase: string;
let customerBase: string;
let dashboardBase: string;

async function listen(server: Server) {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  return `http://127.0.0.1:${address.port}`;
}

before(async () => {
  // Synthetic configuration in this isolated test process only, restored below.
  previousOrigins = process.env.CORS_ALLOWED_ORIGINS;
  process.env.CORS_ALLOWED_ORIGINS = approved;
  directory = await mkdtemp(join(tmpdir(), "alb-recovery-proxy-"));
  const app = createApp();
  api = createServer((request, response) => {
    forwarded.push({ path: request.url ?? "", origin: request.headers.origin });
    app(request, response);
  });
  apiBase = await listen(api);

  await writeFile(join(directory, "index.html"), "<html>Offline recovery fixture</html>");
  const reservation = createServer();
  const reservedBase = await listen(reservation);
  const port = new URL(reservedBase).port;
  await new Promise<void>(resolve => reservation.close(() => resolve()));
  customer = spawn(process.execPath, [
    new URL("../../../../scripts/src/customer-web-preview.mjs", import.meta.url).pathname,
    directory,
  ], {
    env: { PORT: port, BASE_PATH: "/customer/", PREVIEW_BACKEND_ORIGIN: apiBase },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let ready = false;
  customer.stdout!.on("data", chunk => { ready ||= chunk.toString().includes("Customer Web preview listening"); });
  customer.stderr!.on("data", () => {}); // Never forward raw runtime diagnostics.
  for (let i = 0; i < 150 && !ready && customer.exitCode === null; i++) await delay(25);
  assert.ok(ready, "Customer fixture must start");
  customerBase = reservedBase;

  const dashboardPackage = new URL("../../../../apps/dashboard/package.json", import.meta.url);
  const require = createRequire(dashboardPackage);
  const { createServer: createViteServer } = await import(pathToFileURL(require.resolve("vite")).href);
  const configUrl = new URL("../../../../apps/dashboard/vite.config.ts", import.meta.url);
  const { default: config } = await import(configUrl.href);
  const server = await createViteServer({
    configFile: false, root: directory, appType: "custom",
    optimizeDeps: { noDiscovery: true, include: [] },
    server: {
      middlewareMode: true, hmr: false, watch: null,
      proxy: { "/api": { ...config.server.proxy["/api"], target: apiBase } },
    },
  });
  vite = server;
  dashboard = createServer(server.middlewares);
  dashboardBase = await listen(dashboard);
});

after(async () => {
  try {
    if (customer && customer.exitCode === null) {
      const exited = once(customer, "exit");
      customer.kill();
      await exited;
    }
    for (const server of [dashboard, api]) {
      server?.closeAllConnections();
      if (server?.listening) await new Promise<void>(resolve => server.close(() => resolve()));
    }
    await vite?.close();
  } finally {
    if (directory) await rm(directory, { recursive: true, force: true });
    if (previousOrigins === undefined) delete process.env.CORS_ALLOWED_ORIGINS;
    else process.env.CORS_ALLOWED_ORIGINS = previousOrigins;
    mock.restoreAll();
  }
});

const input = (role: recovery.RecoveryInput["role"]) => ({ role, identity: "fixture_user" });
async function send(base: string, body: unknown, origin?: string, path = "/api/auth/recovery") {
  return fetch(`${base}${path}`, {
    method: "POST", headers: { "Content-Type": "application/json", ...(origin === undefined ? {} : { Origin: origin }) },
    body: JSON.stringify(body), signal: AbortSignal.timeout(5_000),
  });
}
async function accepted(base: string, body: recovery.RecoveryInput, origin?: string, path?: string) {
  const count = calls.length;
  const response = await send(base, body, origin, path);
  assert.equal(response.status, 202);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), { message: recovery.RECOVERY_MESSAGE });
  assert.equal(calls.length, count + 1);
  assert.deepEqual(calls.at(-1)!.input, body);
  assert.equal(forwarded.at(-1)!.origin, origin);
}

test("Customer web recovery preserves its approved browser Origin without becoming native", async () => {
  await accepted(customerBase, input("customer"), approved);
  assert.equal(calls.at(-1)!.redirect, `${approved}/customer/?recovery=1`);
});

for (const [role, path] of [["vendor", "/vendor/login"], ["delivery_partner", "/delivery/login"]] as const) {
  test(`${role} web recovery traverses the actual Dashboard proxy with its approved Origin`, async () => {
    await accepted(dashboardBase, input(role), approved);
    assert.equal(calls.at(-1)!.redirect, `${approved}${path}?recovery=1`);
  });
}

test("both proxies preserve unapproved/null Origins for rejection and never invent a missing Origin", async () => {
  for (const base of [customerBase, dashboardBase]) {
    for (const origin of [rejected, "null", undefined]) {
      const count = calls.length;
      const response = await send(base, input("customer"), origin);
      assert.equal(response.status, 403);
      assert.deepEqual(await response.json(), { error: "Origin is not allowed" });
      assert.equal(calls.length, count, "denial must occur before any recovery side effect");
      assert.equal(forwarded.at(-1)!.origin, origin);
    }
  }
});

test("recovery query, trailing slash and case variants preserve the browser Origin", async () => {
  for (const [base, role] of [[customerBase, "customer"], [dashboardBase, "vendor"]] as const) {
    for (const path of ["/api/auth/recovery?source=fixture", "/api/auth/recovery/", "/api/AUTH/RECOVERY"]) {
      await accepted(base, input(role), approved, path);
    }
  }
});

test("native Customer recovery retains its fixed callback and cannot relax other portal or Origin checks", async () => {
  await accepted(apiBase, { ...input("customer"), client: "customer_native" });
  assert.equal(calls.at(-1)!.redirect, "apnalocalbasket-customer://auth/callback");
  for (const role of ["vendor", "delivery_partner", "admin"] as const) {
    const count = calls.length;
    const response = await send(apiBase, { ...input(role), client: "customer_native" });
    assert.equal(response.status, 400);
    await response.arrayBuffer();
    assert.equal(calls.length, count);
  }
  const count = calls.length;
  const response = await send(apiBase, { ...input("customer"), client: "customer_native" }, rejected);
  assert.equal(response.status, 403);
  await response.arrayBuffer();
  assert.equal(calls.length, count);
});

test("non-recovery login forwarding and recovery lookalikes retain existing proxy behavior", async () => {
  for (const base of [customerBase, dashboardBase]) {
    const response = await send(base, {}, rejected, "/api/customer/login");
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), { error: "Invalid username or password." });
    assert.equal(forwarded.at(-1)!.origin, undefined);
    const count = calls.length;
    const lookalike = await send(base, input("customer"), rejected, "/api/auth/recovery-extra");
    assert.equal(lookalike.status, 404);
    await lookalike.arrayBuffer();
    assert.equal(forwarded.at(-1)!.origin, undefined);
    assert.equal(calls.length, count);
  }
});
