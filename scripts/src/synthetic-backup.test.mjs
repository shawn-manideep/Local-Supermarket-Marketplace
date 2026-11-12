import assert from "node:assert/strict";
import { test } from "node:test";
import { readdir, readFile } from "node:fs/promises";
import { generateSyntheticBackupKey, sealSyntheticPackage, verifySyntheticPackage } from "./synthetic-backup-crypto.mjs";
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
    const verified = verifySyntheticPackage(pkg, key);
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
    assert.throws(() => verifySyntheticPackage(pkg, wrong), /PACKAGE_AUTHENTICATION_FAILED/);
  } finally { key.fill(0); wrong.fill(0); }
});
test("corrupted ciphertext and authentication tags are rejected", () => {
  const { key, pkg } = sample();
  try {
    for (const name of ["ciphertext", "tag"]) {
      const changed = clone(pkg); changed.components[0][name][0] ^= 1;
      assert.throws(() => verifySyntheticPackage(changed, key), /INTEGRITY|AUTHENTICATION/);
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
      assert.throws(() => verifySyntheticPackage(changed, key), /INVALID/);
    }
  } finally { key.fill(0); }
});
test("manifest tampering and backup-set metadata substitution are rejected", () => {
  const { key, pkg } = sample();
  try {
    const tampered = clone(pkg); tampered.manifest.ciphertext[0] ^= 1;
    assert.throws(() => verifySyntheticPackage(tampered, key), /AUTHENTICATION/);
    const substituted = clone(pkg); substituted.backupSetId = "00000000-0000-4000-8000-000000000000";
    assert.throws(() => verifySyntheticPackage(substituted, key), /AUTHENTICATION/);
  } finally { key.fill(0); }
});
test("component substitution across separately encrypted backup sets is rejected", () => {
  const first = sample(), second = sample();
  try {
    const changed = clone(first.pkg); changed.components[1] = second.pkg.components[1];
    assert.throws(() => verifySyntheticPackage(changed, first.key), /INTEGRITY|AUTHENTICATION/);
  } finally { first.key.fill(0); second.key.fill(0); }
});
test("incomplete package creation is never accepted as a completed backup", () => {
  const key = generateSyntheticBackupKey();
  try {
    const pkg = sealSyntheticPackage({ archive: Buffer.from("partial"), files: Buffer.alloc(0), key, interrupted: true });
    assert.equal(pkg.state, "incomplete");
    assert.throws(() => verifySyntheticPackage(pkg, key), /INCOMPLETE/);
  } finally { key.fill(0); }
});
test("nonce reuse, oversized components and insufficient disk budget fail closed", () => {
  const { key, pkg } = sample();
  try {
    const changed = clone(pkg); changed.components[1].nonce = changed.components[0].nonce;
    assert.throws(() => verifySyntheticPackage(changed, key), /NONCE_REUSE/);
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
    const result = await restoreSyntheticBackup(sandbox, captured.package, key);
    assert.deepEqual(result, { status: "VERIFIED_SYNTHETIC_RESTORE", catalogRows: 2, fileComponents: 1 });
    await assert.rejects(restoreSyntheticBackup(sandbox, captured.package, key), /ALREADY_ATTEMPTED/);
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
    await assert.rejects(restoreSyntheticBackup(sandbox, pkg, key), e =>
      e.message === "SYNTHETIC_RESTORE_FAILED_NO_RETRY" && !e.cause);
    await assert.rejects(restoreSyntheticBackup(sandbox, pkg, key), /ALREADY_ATTEMPTED/);
  } finally { key.fill(0); if (sandbox) await closeSyntheticSandbox(sandbox); }
  assert.deepEqual((await readdir("/tmp")).filter(name => name.startsWith("alb-synthetic-backup-")).sort(), before);
});
test("runner has no environment credential loader, network target or live restore interface", async () => {
  const source = await readFile(new URL("./synthetic-backup-postgres.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(source, /process\.env|SUPABASE_|DATABASE_URL|FRESH_DB|fetch\(|console\./);
  assert.match(source, /-h ''/);
  assert.match(source, /PGPASSFILE: "\/dev\/null"/);
  assert.match(source, /password: ""/);
  await assert.rejects(captureSyntheticBackup({ syntheticOnly: true }), /UNKNOWN_OR_CLOSED/);
});
