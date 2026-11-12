import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from "node:crypto";

const VERSION = 1;
const NAMES = ["database", "synthetic-files"];
const LIMIT = 32 * 1024 * 1024;
const MANIFEST_LIMIT = 2 * 1024 * 1024;
export const SYNTHETIC_MEMORY_BUDGET = 192 * 1024 * 1024;
/** Conservative per-operation envelope, including copies, strings and tool buffers. */
export function assertSyntheticMemoryBudget(componentBytes, metadataBytes = 0) {
  if (!Number.isSafeInteger(componentBytes) || componentBytes < 0 ||
      !Number.isSafeInteger(metadataBytes) || metadataBytes < 0 ||
      16 * 1024 * 1024 + 6 * componentBytes + 8 * metadataBytes > SYNTHETIC_MEMORY_BUDGET) {
    throw new Error("AGGREGATE_MEMORY_BUDGET");
  }
}
const fail = code => { throw new Error(code); };
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
function validKey(key) {
  if (!Buffer.isBuffer(key) || key.length !== 32) fail("BACKUP_KEY_REQUIRED");
}
function aad(id, name, index) {
  return Buffer.from(JSON.stringify({ version: VERSION, backupSetId: id, component: name, index }));
}
function encrypt(bytes, key, id, name, index, used) {
  if (!Buffer.isBuffer(bytes) || bytes.length > LIMIT) fail("COMPONENT_SIZE_LIMIT");
  const nonce = randomBytes(12);
  if (used.has(nonce.toString("hex"))) fail("NONCE_COLLISION");
  used.add(nonce.toString("hex"));
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  cipher.setAAD(aad(id, name, index));
  const ciphertext = cipher.update(bytes);
  cipher.final(); // GCM has no padded final block; avoid copying the payload.
  return { name, index, nonce, tag: cipher.getAuthTag(), ciphertext };
}
function decrypt(part, key, id) {
  let tentative;
  try {
    const cipher = createDecipheriv("aes-256-gcm", key, part.nonce);
    cipher.setAAD(aad(id, part.name, part.index));
    cipher.setAuthTag(part.tag);
    tentative = cipher.update(part.ciphertext);
    cipher.final(); // Nothing is returned to a consumer before this succeeds.
    const authenticated = tentative;
    tentative = undefined; // Transfer ownership; the consumer must clear this buffer.
    return authenticated;
  } catch {
    fail("PACKAGE_AUTHENTICATION_FAILED");
  } finally { tentative?.fill(0); }
}
function validPart(part, name, index) {
  if (!part || part.name !== name || part.index !== index ||
      !Buffer.isBuffer(part.nonce) || part.nonce.length !== 12 ||
      !Buffer.isBuffer(part.tag) || part.tag.length !== 16 ||
      !Buffer.isBuffer(part.ciphertext) || part.ciphertext.length > LIMIT) fail("INVALID_COMPONENT");
}
export function generateSyntheticBackupKey() { return randomBytes(32); }

/** In-memory synthetic package only. Key is intentionally NOT part of the result. */
export function sealSyntheticPackage({ archive, files, key, summary = {}, interrupted = false }) {
  validKey(key);
  if (![archive, files].every(bytes => Buffer.isBuffer(bytes) && bytes.length <= LIMIT)) fail("COMPONENT_SIZE_LIMIT");
  const summaryText = JSON.stringify(summary);
  const summaryBytes = Buffer.byteLength(summaryText);
  if (summaryBytes > MANIFEST_LIMIT - 4096) fail("MANIFEST_SIZE_LIMIT");
  assertSyntheticMemoryBudget(archive.length + files.length, summaryBytes + 4096);
  const backupSetId = randomUUID(), used = new Set(), components = [];
  const inventory = [];
  for (const [index, bytes] of [archive, files].entries()) {
    const name = NAMES[index];
    const part = encrypt(bytes, key, backupSetId, name, index, used);
    components.push(part);
    inventory.push({ name, index, bytes: bytes.length, sha256: hash(bytes), ciphertextSha256: hash(part.ciphertext) });
  }
  const result = { version: VERSION, backupSetId, state: "incomplete", components };
  if (interrupted) return result;
  const manifest = Buffer.from(JSON.stringify({
    version: VERSION, backupSetId, syntheticOnly: true, source: "synthetic_backup_source",
    createdAt: new Date().toISOString(), inventory, summary: JSON.parse(summaryText),
  }));
  try { result.manifest = encrypt(manifest, key, backupSetId, "manifest", 2, used); }
  finally { manifest.fill(0); }
  result.state = "complete";
  return result;
}

/** All parts must authenticate and match the encrypted manifest before release. */
export function verifySyntheticPackage(pkg, key, expectedBackupSetId) {
  validKey(key);
  if (typeof expectedBackupSetId !== "string" ||
      !/^[a-f0-9-]{36}$/.test(expectedBackupSetId)) fail("EXPECTED_BACKUP_ID_REQUIRED");
  if (pkg?.backupSetId !== expectedBackupSetId) fail("UNEXPECTED_BACKUP_ID");
  if (!pkg || pkg.version !== VERSION || pkg.state !== "complete" ||
    typeof pkg.backupSetId !== "string" || !/^[a-f0-9-]{36}$/.test(pkg.backupSetId) ||
    !Array.isArray(pkg.components) || pkg.components.length !== 2) fail("INCOMPLETE_OR_INVALID_PACKAGE");
  pkg.components.forEach((part, index) => validPart(part, NAMES[index], index));
  validPart(pkg.manifest, "manifest", 2);
  if (pkg.manifest.ciphertext.length > MANIFEST_LIMIT) fail("MANIFEST_SIZE_LIMIT");
  assertSyntheticMemoryBudget(pkg.components.reduce((sum, part) => sum + part.ciphertext.length, 0),
    pkg.manifest.ciphertext.length);
  const nonces = [...pkg.components, pkg.manifest].map(part => part.nonce.toString("hex"));
  if (new Set(nonces).size !== nonces.length) fail("NONCE_REUSE");
  const plaintext = [];
  let manifestBytes;
  try {
    manifestBytes = decrypt(pkg.manifest, key, expectedBackupSetId);
    const manifest = JSON.parse(manifestBytes.toString("utf8"));
    if (manifest.version !== VERSION || manifest.backupSetId !== pkg.backupSetId ||
      manifest.syntheticOnly !== true || manifest.source !== "synthetic_backup_source" ||
      !Array.isArray(manifest.inventory) || manifest.inventory.length !== 2) fail("INVALID_MANIFEST");
    for (const [index, part] of pkg.components.entries()) {
      const expected = manifest.inventory[index];
      if (expected.name !== part.name || expected.index !== index ||
        expected.ciphertextSha256 !== hash(part.ciphertext)) fail("COMPONENT_INTEGRITY_FAILURE");
      const bytes = decrypt(part, key, expectedBackupSetId);
      plaintext.push(bytes);
      if (bytes.length !== expected.bytes || hash(bytes) !== expected.sha256) fail("COMPONENT_INTEGRITY_FAILURE");
    }
    return { manifest, archive: plaintext[0], files: plaintext[1] };
  } catch (e) {
    plaintext.forEach(bytes => bytes.fill(0));
    // Never propagate JSON parser excerpts or underlying crypto errors.
    const allowed = ["PACKAGE_AUTHENTICATION_FAILED", "COMPONENT_INTEGRITY_FAILURE", "INVALID_MANIFEST"];
    fail(allowed.includes(e.message) ? e.message : "INVALID_MANIFEST");
  } finally { manifestBytes?.fill(0); }
}
