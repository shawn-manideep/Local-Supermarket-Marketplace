import assert from "node:assert/strict";
import { test } from "node:test";
import { readdir, readFile, mkdtemp, rm, statfs } from "node:fs/promises";
import { spawn } from "node:child_process";
import vm from "node:vm";
import { EventEmitter } from "node:events";
import { generateSyntheticBackupKey, sealSyntheticPackage, verifySyntheticPackage,
  assertSyntheticMemoryBudget } from "./synthetic-backup-crypto.mjs";
import {
  assertSyntheticDiskBudget, assertSyntheticLocalTarget, createSyntheticSandbox,
  closeSyntheticSandbox, captureSyntheticBackup, restoreSyntheticBackup,
} from "./synthetic-backup-postgres.mjs";

function sample() {
  const key = generateSyntheticBackupKey();
  return { key, pkg: sealSyntheticPackage({
    archive: Buffer.from("synthetic archive"), files: Buffer.from("synthetic files"), key,
  }) };
}
function clone(pkg) {
  return {
    ...pkg,
    components: pkg.components.map(part => ({ ...part, nonce: Buffer.from(part.nonce),
      tag: Buffer.from(part.tag), ciphertext: Buffer.from(part.ciphertext) })),
    ...(pkg.manifest ? { manifest: { ...pkg.manifest, nonce: Buffer.from(pkg.manifest.nonce),
      tag: Buffer.from(pkg.manifest.tag), ciphertext: Buffer.from(pkg.manifest.ciphertext) } } : {}),
  };
}
function wipe(verified) { verified.archive.fill(0); verified.files.fill(0); }

test("AES-256-GCM roundtrip authenticates manifest, component hashes and independent nonces", () => {
  const { key, pkg } = sample();
  try {
    assert.equal(key.length, 32);
    assert.equal("key" in pkg, false);
    assert.equal(new Set([...pkg.components, pkg.manifest].map(p => p.nonce.toString("hex"))).size, 3);
    for (const part of [...pkg.components, pkg.manifest]) {
      assert.equal(part.nonce.length, 12); assert.equal(part.tag.length, 16);
    }
    const verified = verifySyntheticPackage(pkg, key, pkg.backupSetId);
    assert.equal(verified.archive.toString(), "synthetic archive");
    assert.equal(verified.files.toString(), "synthetic files");
    assert.equal(verified.manifest.inventory.length, 2);
    wipe(verified);
  } finally { key.fill(0); }
});
test("wrong and missing keys are refused without releasing decrypted components", () => {
  const { key, pkg } = sample(), wrong = generateSyntheticBackupKey();
  try {
    assert.throws(() => verifySyntheticPackage(pkg), /BACKUP_KEY_REQUIRED/);
    assert.throws(() => verifySyntheticPackage(pkg, wrong, pkg.backupSetId), /PACKAGE_AUTHENTICATION_FAILED/);
  } finally { key.fill(0); wrong.fill(0); }
});
test("corrupted ciphertext and authentication tags are rejected", () => {
  const { key, pkg } = sample();
  try {
    for (const name of ["ciphertext", "tag"]) {
      const changed = clone(pkg); changed.components[0][name][0] ^= 1;
      assert.throws(() => verifySyntheticPackage(changed, key, pkg.backupSetId), /INTEGRITY|AUTHENTICATION/);
    }
  } finally { key.fill(0); }
});
test("missing, duplicate and reordered components are refused", () => {
  const { key, pkg } = sample();
  try {
    const missing = clone(pkg); missing.components.pop();
    const duplicate = clone(pkg); duplicate.components[1] = duplicate.components[0];
    const reordered = clone(pkg); reordered.components.reverse();
    for (const changed of [missing, duplicate, reordered]) {
      assert.throws(() => verifySyntheticPackage(changed, key, pkg.backupSetId), /INVALID/);
    }
  } finally { key.fill(0); }
});
test("manifest tampering and backup-set metadata substitution are rejected", () => {
  const { key, pkg } = sample();
  try {
    const tampered = clone(pkg); tampered.manifest.ciphertext[0] ^= 1;
    assert.throws(() => verifySyntheticPackage(tampered, key, pkg.backupSetId), /AUTHENTICATION/);
    const substituted = clone(pkg); substituted.backupSetId = "00000000-0000-4000-8000-000000000000";
    assert.throws(() => verifySyntheticPackage(substituted, key, pkg.backupSetId), /UNEXPECTED_BACKUP_ID/);
    assert.throws(() => verifySyntheticPackage(substituted, key, substituted.backupSetId), /AUTHENTICATION/);
  } finally { key.fill(0); }
});
test("component substitution across separately encrypted backup sets is rejected", () => {
  const first = sample(), second = sample();
  try {
    const changed = clone(first.pkg); changed.components[1] = second.pkg.components[1];
    assert.throws(() => verifySyntheticPackage(changed, first.key, first.pkg.backupSetId), /INTEGRITY|AUTHENTICATION/);
  } finally { first.key.fill(0); second.key.fill(0); }
});
test("incomplete package creation is never accepted as a completed backup", () => {
  const key = generateSyntheticBackupKey();
  try {
    const pkg = sealSyntheticPackage({ archive: Buffer.from("partial"), files: Buffer.alloc(0), key, interrupted: true });
    assert.equal(pkg.state, "incomplete");
    assert.throws(() => verifySyntheticPackage(pkg, key, pkg.backupSetId), /INCOMPLETE/);
  } finally { key.fill(0); }
});
test("nonce reuse, oversized components and insufficient disk budget fail closed", () => {
  const { key, pkg } = sample();
  try {
    const changed = clone(pkg); changed.components[1].nonce = changed.components[0].nonce;
    assert.throws(() => verifySyntheticPackage(changed, key, pkg.backupSetId), /NONCE_REUSE/);
    assert.throws(() => sealSyntheticPackage({ archive: Buffer.alloc(32 * 1024 * 1024 + 1),
      files: Buffer.alloc(0), key }), /SIZE_LIMIT/);
    assert.throws(() => assertSyntheticDiskBudget(0n), /INSUFFICIENT_DISK_SPACE/);
    assert.throws(() => assertSyntheticDiskBudget(255n * 1024n * 1024n), /INSUFFICIENT_DISK_SPACE/);
    assert.doesNotThrow(() => assertSyntheticDiskBudget(256n * 1024n * 1024n));
  } finally { key.fill(0); }
});
test("only fixed local Unix-socket synthetic database targets pass validation", () => {
  const target = { host: "/tmp/alb-synthetic-backup-Abc123", database: "synthetic_backup_restore",
    user: "synthetic_backup_owner", port: "55440", ssl: false };
  assert.doesNotThrow(() => assertSyntheticLocalTarget(target));
  for (const change of [
    { host: "127.0.0.1" }, { host: "example.supabase.co" }, { host: "/tmp/unrelated" },
    { host: "/tmp/alb-synthetic-backup-Abc123/../other" }, { database: "postgresql://remote" },
    { database: "production" }, { user: "postgres" }, { ssl: true }, { port: 5432 },
  ]) assert.throws(() => assertSyntheticLocalTarget({ ...target, ...change }), /REFUSED/);
});
test("complete synthetic pg_dump/encryption/authentication/restore preserves schema, records and types", async () => {
  const before = (await readdir("/tmp")).filter(name => name.startsWith("alb-synthetic-backup-")).sort();
  let sandbox, key;
  try {
    sandbox = await createSyntheticSandbox();
    const captured = await captureSyntheticBackup(sandbox); key = captured.key;
    const expectedId = captured.package.backupSetId; // Capture-time receipt, not selected inside verification.
    const result = await restoreSyntheticBackup(sandbox, captured.package, key, expectedId);
    assert.deepEqual(result, { status: "VERIFIED_SYNTHETIC_RESTORE", catalogRows: 2, fileComponents: 1 });
    await assert.rejects(restoreSyntheticBackup(sandbox, captured.package, key, expectedId), /ALREADY_ATTEMPTED/);
  } finally { key?.fill(0); if (sandbox) await closeSyntheticSandbox(sandbox); }
  const after = (await readdir("/tmp")).filter(name => name.startsWith("alb-synthetic-backup-")).sort();
  assert.deepEqual(after, before);
});
test("authenticated but invalid archive fails restoration once and the cluster is cleaned up", async () => {
  const before = (await readdir("/tmp")).filter(name => name.startsWith("alb-synthetic-backup-")).sort();
  let sandbox;
  const key = generateSyntheticBackupKey();
  try {
    sandbox = await createSyntheticSandbox();
    const pkg = sealSyntheticPackage({ archive: Buffer.from("not a PostgreSQL archive"),
      files: Buffer.from("synthetic file bytes only"), key, summary: {} });
    await assert.rejects(restoreSyntheticBackup(sandbox, pkg, key, pkg.backupSetId), e =>
      e.message === "SYNTHETIC_RESTORE_FAILED_NO_RETRY" && !e.cause);
    await assert.rejects(restoreSyntheticBackup(sandbox, pkg, key, pkg.backupSetId), /ALREADY_ATTEMPTED/);
  } finally { key.fill(0); if (sandbox) await closeSyntheticSandbox(sandbox); }
  assert.deepEqual((await readdir("/tmp")).filter(name => name.startsWith("alb-synthetic-backup-")).sort(), before);
});
test("runner has no environment credential loader, network target or live restore interface", async () => {
  const source = await readFile(new URL("./synthetic-backup-postgres.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(source, /process\.env|SUPABASE_|DATABASE_URL|FRESH_DB|fetch\(|console\./);
  assert.match(source, /-h ''/);
  assert.match(source, /PGPASSFILE: "\/dev\/null"/);
  assert.doesNotMatch(source, /new Client|createRequire/);
  assert.match(source, /"-X", "-q", "-A", "-t"/);
  await assert.rejects(captureSyntheticBackup({ syntheticOnly: true }), /UNKNOWN_OR_CLOSED/);
});

// Evaluate the actual module implementation with fake OS dependencies.
// No environment mutation, pg client construction, subprocess or connection occurs.
async function harness(overrides = {}) {
  const source = await readFile(new URL("./synthetic-backup-postgres.mjs", import.meta.url), "utf8");
  const calls = [], timers = new Set(), removed = [];
  const directory = "/tmp/alb-synthetic-backup-Fake12";
  let running = false;
  const fakeProcess = { version: "synthetic-node", env: {
    PGPASSWORD: "fabricated-password", PGOPTIONS: "fabricated-options",
    PGHOST: "remote.invalid", PGDATABASE: "remote", PGUSER: "remote",
    PGSERVICE: "remote", PGSSLMODE: "require", PGPASSFILE: "/fabricated/credentials",
  } };
  const globals = {
    Buffer, isDeepStrictEqual: (a, b) => a === b,
    generateSyntheticBackupKey, sealSyntheticPackage, verifySyntheticPackage, assertSyntheticMemoryBudget,
    process: fakeProcess,
    statfs: async () => ({ bavail: 1024n ** 3n, bsize: 1n }),
    mkdtemp: async () => directory,
    rm: async (...args) => { removed.push(args); },
    setTimeout: callback => { timers.add(callback); return callback; },
    clearTimeout: callback => timers.delete(callback),
    spawn: (path, args, options) => {
      const child = new EventEmitter();
      child.stdout = new EventEmitter(); child.stderr = new EventEmitter();
      child.kill = () => { queueMicrotask(() => child.emit("close", null)); };
      child.stdin = new EventEmitter();
      child.stdin.end = input => {
        calls.push({ path, args, options, input: input?.toString("utf8") });
        queueMicrotask(() => {
          let code = 0, text = "";
          if (args.at(-1) === "start") running = true;
          if (args.at(-1) === "stop") running = false;
          if (args.at(-1) === "status") code = running ? 0 : 3;
          if (path.endsWith("/psql")) {
            const db = args[args.indexOf("-d") + 1];
            text = JSON.stringify({ db, role: "synthetic_backup_owner", address: null }) + "\n";
            text += input.toString().includes("AS empty") ? "t\n" : '"snapshot"\n';
          }
          if (path.endsWith("/pg_dump")) text = args.includes("--version") ? "pg_dump synthetic" : "archive";
          if (text) child.stdout.emit("data", Buffer.from(text));
          child.emit("close", code);
        });
      };
      return child;
    },
    ...overrides,
  };
  const transformed = source.replace(/^import .*;\n/gm, "").replace(/\bexport /g, "");
  const api = vm.runInNewContext(`${transformed}\n({
    command, query, contexts, EMPTY_DESTINATION, createSyntheticSandbox,
    closeSyntheticSandbox, captureSyntheticBackup, restoreSyntheticBackup
  })`, globals);
  return { ...api, calls, timers, removed, fakeProcess, directory };
}

test("fabricated hostile ambient settings never reach local tools; no driver or real connection is used", async () => {
  const h = await harness();
  const before = JSON.stringify(h.fakeProcess.env);
  const handle = await h.createSyntheticSandbox();
  await h.closeSyntheticSandbox(handle);
  assert.equal(JSON.stringify(h.fakeProcess.env), before);
  for (const { args, options } of h.calls) {
    assert.equal(options.env.PGPASSWORD, undefined);
    assert.equal(options.env.PGSERVICE, undefined);
    assert.equal(options.env.PGHOST, undefined);
    assert.equal(options.env.PGPASSFILE, "/dev/null");
    assert.equal(options.env.PGOPTIONS, "-c statement_timeout=10000 -c idle_in_transaction_session_timeout=10000");
    assert.ok(!args.includes("remote.invalid"));
  }
  assert.ok(h.calls.some(c => c.path.endsWith("/psql") && c.args.includes("-X")));
});

test("timeout kills the tool but does not settle until confirmed close, and clears output", async () => {
  let child, killed = false;
  const chunk = Buffer.from("synthetic plaintext");
  const h = await harness({ spawn: () => {
    child = new EventEmitter(); child.stdout = new EventEmitter(); child.stderr = new EventEmitter();
    child.stdin = new EventEmitter(); child.stdin.end = () => {};
    child.kill = () => { killed = true; };
    return child;
  } });
  let settled = false;
  const promise = h.command("pg_dump", []).finally(() => { settled = true; });
  const rejected = assert.rejects(promise, /SYNTHETIC_TOOL_FAILED/);
  child.stdout.emit("data", chunk);
  [...h.timers][0]();
  await Promise.resolve();
  assert.equal(killed, true); assert.equal(settled, false);
  child.emit("close", null);
  await rejected;
  assert.ok(chunk.every(byte => byte === 0));
});

test("ambiguous startup timeout stops and confirms the server before directory removal", async () => {
  let stopped = false, confirmed = false, removed = false, killed = false;
  const h = await harness({
    spawn: (path, args) => {
      const child = new EventEmitter(); child.stdout = new EventEmitter(); child.stderr = new EventEmitter();
      child.stdin = new EventEmitter();
      child.kill = () => { killed = true; queueMicrotask(() => child.emit("close", null)); };
      child.stdin.end = () => queueMicrotask(() => {
        if (args.at(-1) === "start") {
          // Model a postmaster already running while pg_ctl is still waiting.
          [...h.timers][0]();
          return;
        }
        if (args.at(-1) === "stop") stopped = true;
        if (args.at(-1) === "status") {
          confirmed = stopped;
          child.emit("close", stopped ? 3 : 0);
        } else child.emit("close", 0);
      });
      return child;
    },
    rm: async () => { assert.equal(confirmed, true); removed = true; },
  });
  await assert.rejects(h.createSyntheticSandbox(), /SYNTHETIC_SETUP_FAILED/);
  assert.equal(killed, true);
  assert.equal(removed, true);
});

async function lifecycleHarness(fakeCommand, remove = async () => {}) {
  const source = await readFile(new URL("./synthetic-backup-postgres.mjs", import.meta.url), "utf8");
  const globals = {
    Buffer, generateSyntheticBackupKey, sealSyntheticPackage, verifySyntheticPackage, assertSyntheticMemoryBudget,
    process: { version: "synthetic" }, isDeepStrictEqual: (a, b) => a === b,
    statfs: async () => ({ bavail: 1024n ** 3n, bsize: 1n }),
    mkdtemp: async () => "/tmp/alb-synthetic-backup-Fake12", rm: remove, fakeCommand,
  };
  const transformed = source.replace(/^import .*;\n/gm, "").replace(/\bexport /g, "");
  return vm.runInNewContext(`${transformed}\ncommand = fakeCommand;
    ({createSyntheticSandbox,closeSyntheticSandbox,restoreSyntheticBackup,captureSyntheticBackup,
      contexts,EMPTY_DESTINATION,query})`, globals);
}

test("stop failure preserves a cleanup-only handle and allows retry without removing a running cluster", async () => {
  let allowStop = false, removed = 0;
  const h = await lifecycleHarness(async (name, args) => {
    if (args.at(-1) === "start") throw new Error("ambiguous");
    if (args.at(-1) === "stop" && !allowStop) throw new Error("stop failure");
    if (args.at(-1) === "status") return allowStop ? 3 : 0;
    return Buffer.alloc(0);
  }, async () => { removed++; });
  let handle;
  await assert.rejects(h.createSyntheticSandbox(), error => {
    assert.equal(error.message, "SYNTHETIC_SETUP_CLEANUP_REQUIRED");
    handle = error.cleanupHandle; return true;
  });
  assert.equal(removed, 0);
  await assert.rejects(h.captureSyntheticBackup(handle), /UNKNOWN_OR_CLOSED/);
  allowStop = true;
  await h.closeSyntheticSandbox(handle);
  assert.equal(removed, 1);
});

test("removal failure remains retryable after a confirmed stop", async () => {
  let removals = 0;
  const h = await lifecycleHarness(async (name, args) => {
    if (args.at(-1) === "start") throw new Error("ambiguous");
    if (args.at(-1) === "status") return 3;
    return Buffer.alloc(0);
  }, async () => { if (++removals === 1) throw new Error("disk failure"); });
  let handle;
  await assert.rejects(h.createSyntheticSandbox(), error => { handle = error.cleanupHandle; return true; });
  await h.closeSyntheticSandbox(handle);
  assert.equal(removals, 2);
});

test("valid older package, missing expected identity and unsupported version are rejected", () => {
  const first = sample(), second = sample();
  try {
    assert.throws(() => verifySyntheticPackage(first.pkg, first.key), /EXPECTED_BACKUP_ID_REQUIRED/);
    assert.throws(() => verifySyntheticPackage(first.pkg, first.key, second.pkg.backupSetId), /UNEXPECTED_BACKUP_ID/);
    const changed = clone(first.pkg); changed.version = 2;
    assert.throws(() => verifySyntheticPackage(changed, first.key, first.pkg.backupSetId), /INVALID_PACKAGE/);
  } finally { first.key.fill(0); second.key.fill(0); }
});

test("aggregate budget rejects individually permitted components before encryption or decryption", () => {
  assert.throws(() => assertSyntheticMemoryBudget(32 * 1024 * 1024), /AGGREGATE_MEMORY_BUDGET/);
  assert.doesNotThrow(() => assertSyntheticMemoryBudget(1024, 1024));
  const key = generateSyntheticBackupKey();
  const archive = Buffer.alloc(16 * 1024 * 1024), files = Buffer.alloc(16 * 1024 * 1024);
  try {
    assert.throws(() => sealSyntheticPackage({ archive, files, key }), /AGGREGATE_MEMORY_BUDGET/);
    const pkg = sealSyntheticPackage({ archive: Buffer.from("small"), files: Buffer.alloc(0), key });
    pkg.components[0].ciphertext = archive;
    pkg.components[1].ciphertext = files;
    assert.throws(() => verifySyntheticPackage(pkg, key, pkg.backupSetId), /AGGREGATE_MEMORY_BUDGET/);
  } finally { key.fill(0); archive.fill(0); files.fill(0); }
});

test("tool chunks are cleared on success, failure and aggregate-memory refusal", async () => {
  for (const mode of ["success", "failure", "budget"]) {
    const chunk = mode === "budget" ? Buffer.alloc(30 * 1024 * 1024, 1) : Buffer.from("synthetic bytes");
    const h = await harness({ spawn: () => {
      const child = new EventEmitter(); child.stdout = new EventEmitter(); child.stderr = new EventEmitter();
      child.stdin = new EventEmitter();
      child.kill = () => queueMicrotask(() => child.emit("close", null));
      child.stdin.end = () => queueMicrotask(() => {
        child.stdout.emit("data", chunk);
        if (mode !== "budget") child.emit("close", mode === "success" ? 0 : 1);
      });
      return child;
    } });
    if (mode === "success") {
      const result = await h.command("pg_dump", []);
      assert.equal(result.toString(), "synthetic bytes");
      result.fill(0);
    } else await assert.rejects(h.command("pg_dump", []), /SYNTHETIC_TOOL_FAILED/);
    assert.ok(chunk.every(byte => byte === 0), mode);
  }
});

test("actual empty-target query refuses schemas, functions, types, relations and other user objects", async () => {
  const h = await harness({ spawn, mkdtemp, rm, statfs, setTimeout, clearTimeout });
  let handle;
  try {
    handle = await h.createSyntheticSandbox();
    const context = h.contexts.get(handle);
    const inspect = async () => (await h.query(context, "synthetic_backup_restore", h.EMPTY_DESTINATION)).at(-1);
    assert.equal(await inspect(), "t");
    const cases = [
      ["CREATE SCHEMA synthetic_extra", "DROP SCHEMA synthetic_extra"],
      ["CREATE FUNCTION public.synthetic_extra() RETURNS int LANGUAGE sql AS 'SELECT 1'", "DROP FUNCTION public.synthetic_extra()"],
      ["CREATE TYPE public.synthetic_extra AS ENUM ('fixture')", "DROP TYPE public.synthetic_extra"],
      ["CREATE DOMAIN public.synthetic_extra AS int", "DROP DOMAIN public.synthetic_extra"],
      ["CREATE TABLE public.synthetic_extra(id int)", "DROP TABLE public.synthetic_extra"],
      ["CREATE SEQUENCE public.synthetic_extra", "DROP SEQUENCE public.synthetic_extra"],
      ["CREATE VIEW public.synthetic_extra AS SELECT 1 AS id", "DROP VIEW public.synthetic_extra"],
    ];
    for (const [create, drop] of cases) {
      await h.query(context, "synthetic_backup_restore", create);
      assert.equal(await inspect(), "f", create);
      await h.query(context, "synthetic_backup_restore", drop);
      assert.equal(await inspect(), "t", drop);
    }
  } finally { if (handle) await h.closeSyntheticSandbox(handle); }
});

test("concurrent restoration reserves synchronously; exactly one pg_restore executes", async () => {
  let restores = 0, unblock;
  const barrier = new Promise(resolve => { unblock = resolve; });
  const h = await lifecycleHarness(async (name, args, input) => {
    if (name === "psql") {
      const db = args[args.indexOf("-d") + 1];
      return Buffer.from(JSON.stringify({ db, role: "synthetic_backup_owner", address: null }) + "\n" +
        (input.toString().includes("AS empty") ? "t\n" : '"snapshot"\n'));
    }
    if (name === "pg_restore") { restores++; await barrier; }
    return Buffer.alloc(0);
  });
  const handle = Object.freeze({});
  h.contexts.set(handle, { directory: "/tmp/alb-synthetic-backup-Fake12" });
  const key = generateSyntheticBackupKey();
  const pkg = sealSyntheticPackage({ archive: Buffer.from("archive"), files: Buffer.from("synthetic file bytes only"),
    key, summary: { snapshot: '"snapshot"' } });
  try {
    const first = h.restoreSyntheticBackup(handle, pkg, key, pkg.backupSetId);
    await assert.rejects(h.restoreSyntheticBackup(handle, pkg, key, pkg.backupSetId), /ALREADY_ATTEMPTED/);
    // Let the first invocation reach the blocked restore.
    for (let i = 0; i < 20 && restores === 0; i++) await Promise.resolve();
    assert.equal(restores, 1);
    unblock();
    assert.equal((await first).status, "VERIFIED_SYNTHETIC_RESTORE");
  } finally { unblock(); key.fill(0); }
});

test("nonempty destination and failed post-restore comparison quarantine the target without retry", async () => {
  for (const empty of [false, true]) {
    let restores = 0;
    const h = await lifecycleHarness(async (name, args, input) => {
      if (name === "psql") {
        const db = args[args.indexOf("-d") + 1];
        return Buffer.from(JSON.stringify({ db, role: "synthetic_backup_owner", address: null }) + "\n" +
          (input.toString().includes("AS empty") ? `${empty ? "t" : "f"}\n` : '"different"\n'));
      }
      if (name === "pg_restore") restores++;
      return Buffer.alloc(0);
    });
    const handle = Object.freeze({});
    h.contexts.set(handle, { directory: "/tmp/alb-synthetic-backup-Fake12" });
    const key = generateSyntheticBackupKey();
    const pkg = sealSyntheticPackage({ archive: Buffer.from("archive"), files: Buffer.from("synthetic file bytes only"),
      key, summary: { snapshot: '"expected"' } });
    try {
      await assert.rejects(h.restoreSyntheticBackup(handle, pkg, key, pkg.backupSetId), /FAILED_NO_RETRY/);
      assert.equal(restores, empty ? 1 : 0);
      assert.equal(h.contexts.get(handle).quarantined, true);
      await assert.rejects(h.captureSyntheticBackup(handle), /UNKNOWN_OR_CLOSED/);
      await assert.rejects(h.restoreSyntheticBackup(handle, pkg, key, pkg.backupSetId), /ALREADY_ATTEMPTED/);
    } finally { key.fill(0); }
  }
});
