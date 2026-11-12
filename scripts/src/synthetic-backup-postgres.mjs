import { spawn } from "node:child_process";
import { mkdtemp, rm, statfs } from "node:fs/promises";
import { isDeepStrictEqual } from "node:util";
import { generateSyntheticBackupKey, sealSyntheticPackage, verifySyntheticPackage, assertSyntheticMemoryBudget } from "./synthetic-backup-crypto.mjs";

const BIN = "/nix/store/269nimkimaaivb4z46bjc1rnjv9jpc0l-postgresql-17.6/bin";
const ENV = Object.freeze({
  PATH: "/usr/bin:/bin", LANG: "C", LC_ALL: "C", PGPASSFILE: "/dev/null", PGSERVICEFILE: "/dev/null",
  HOME: "/nonexistent", PGSYSCONFDIR: "/nonexistent", PGCONNECT_TIMEOUT: "3",
  PGOPTIONS: "-c statement_timeout=10000 -c idle_in_transaction_session_timeout=10000",
});
const USER = "synthetic_backup_owner", PORT = "55440", LIMIT = 32 * 1024 * 1024;
const DATABASES = ["postgres", "synthetic_backup_source", "synthetic_backup_restore"];
const contexts = new WeakMap();
const fail = code => { throw new Error(code); };
let memoryReserved = false;
function reserveMemory() {
  if (memoryReserved) fail("SYNTHETIC_MEMORY_BUSY");
  memoryReserved = true;
  return () => { memoryReserved = false; };
}

export function assertSyntheticDiskBudget(availableBytes) {
  if (typeof availableBytes !== "bigint" || availableBytes < 256n * 1024n * 1024n) fail("INSUFFICIENT_DISK_SPACE");
}
export function assertSyntheticLocalTarget(target) {
  if (!target || typeof target.host !== "string" ||
    !/^\/tmp\/alb-synthetic-backup-[A-Za-z0-9]+$/.test(target.host) ||
    !DATABASES.includes(target.database) || target.user !== USER || String(target.port) !== PORT ||
    target.ssl !== false) fail("NON_SYNTHETIC_TARGET_REFUSED");
}
function command(name, args, input, statusOnly = false) {
  if (!["initdb", "pg_ctl", "pg_dump", "pg_restore", "psql"].includes(name)) fail("TOOL_REFUSED");
  assertSyntheticMemoryBudget(input?.length ?? 0);
  return new Promise((resolve, reject) => {
    const child = spawn(`${BIN}/${name}`, args, { env: ENV, stdio: ["pipe", "pipe", "pipe"] });
    const output = []; let size = 0, rejected = false, outcome;
    const stop = () => {
      if (!rejected) { rejected = true; child.kill("SIGKILL"); }
    };
    const timer = setTimeout(stop, 30000);
    child.stdout.on("data", bytes => {
      size += bytes.length;
      try { assertSyntheticMemoryBudget(size + (input?.length ?? 0)); }
      catch { bytes.fill(0); stop(); return; }
      if (rejected || size > LIMIT) { bytes.fill(0); stop(); } else output.push(bytes);
    });
    child.stderr.on("data", bytes => { bytes.fill(0); }); // Never expose tool text.
    child.on("error", stop);
    child.stdin.on("error", () => {}); // Exit status determines success, never EPIPE alone.
    child.on("close", code => {
      clearTimeout(timer);
      if (statusOnly && !rejected && (code === 0 || code === 3)) {
        output.forEach(bytes => bytes.fill(0));
        resolve(code);
        return;
      }
      if (!rejected && code === 0) {
        outcome = ["psql", "pg_dump"].includes(name) ? Buffer.concat(output, size) : Buffer.alloc(0);
      }
      output.forEach(bytes => bytes.fill(0));
      // Settle only after close: killing a process is not confirmation of exit.
      if (!outcome) reject(new Error("SYNTHETIC_TOOL_FAILED"));
      else resolve(outcome);
    });
    child.stdin.end(input);
  });
}
async function query(context, database, sql) {
  const target = { host: context.directory, database, user: USER, port: PORT, ssl: false };
  assertSyntheticLocalTarget(target);
  let input, output;
  try {
    input = Buffer.from(`DO $$ BEGIN
      IF current_database() <> '${database}' OR current_user <> '${USER}' OR inet_server_addr() IS NOT NULL
      THEN RAISE EXCEPTION 'SYNTHETIC_IDENTITY_REFUSED'; END IF; END $$;
      SELECT json_build_object('db',current_database(),'role',current_user,'address',inet_server_addr());\n${sql}`);
    output = await command("psql", [...pgArgs(context, database), "-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1"], input);
    const lines = output.toString("utf8").trim().split("\n");
    const identity = JSON.parse(lines.shift());
    if (identity.db !== database || identity.role !== USER || identity.address !== null) fail("NON_SYNTHETIC_TARGET_REFUSED");
    return lines;
  } catch { fail("SYNTHETIC_QUERY_FAILED"); }
  finally { input?.fill(0); output?.fill(0); }
}
function contextFor(handle) {
  const context = contexts.get(handle);
  if (!context || context.closed || context.closing || context.cleanupPending || context.quarantined) fail("UNKNOWN_OR_CLOSED_SANDBOX");
  return context;
}
const FIXTURE = `
CREATE SCHEMA auth_fixture; CREATE SCHEMA app_fixture; CREATE SCHEMA storage_fixture;
CREATE TYPE app_fixture.account_role AS ENUM ('customer','vendor');
CREATE TABLE auth_fixture.users(id uuid PRIMARY KEY,email text NOT NULL);
CREATE TABLE auth_fixture.identities(id uuid PRIMARY KEY,user_id uuid REFERENCES auth_fixture.users(id),provider text NOT NULL);
CREATE TABLE app_fixture.profiles(id uuid PRIMARY KEY REFERENCES auth_fixture.users(id),role app_fixture.account_role NOT NULL);
CREATE TABLE app_fixture.catalog(id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,owner_id uuid REFERENCES app_fixture.profiles(id),
  label text NOT NULL,nullable_value text,created_at timestamptz NOT NULL,attributes jsonb NOT NULL);
CREATE INDEX catalog_label_idx ON app_fixture.catalog(label);
CREATE TABLE storage_fixture.objects(id uuid PRIMARY KEY,owner_id uuid REFERENCES auth_fixture.users(id),name text NOT NULL,bytes bigint NOT NULL);
CREATE FUNCTION app_fixture.signup() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN INSERT INTO app_fixture.profiles VALUES(NEW.id,'customer'); RETURN NEW; END $$;
CREATE TRIGGER on_synthetic_signup AFTER INSERT ON auth_fixture.users FOR EACH ROW EXECUTE FUNCTION app_fixture.signup();
ALTER TABLE app_fixture.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY synthetic_profile_read ON app_fixture.profiles FOR SELECT USING (true);
INSERT INTO auth_fixture.users VALUES('00000000-0000-4000-8000-000000000001','synthetic@example.invalid');
INSERT INTO auth_fixture.identities VALUES('00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000001','synthetic');
INSERT INTO app_fixture.catalog(owner_id,label,nullable_value,created_at,attributes) VALUES
 ('00000000-0000-4000-8000-000000000001','తెలుగు synthetic',NULL,'2026-11-01T01:02:03.123456Z',
 '{"big":123456789012345678901234567890,"fraction":0.000000000000000000000001234567890,"nested":[null,"123",{},[]]}'::jsonb),
 ('00000000-0000-4000-8000-000000000001','empty text','','2026-11-01T01:02:03.654321Z','{}');
INSERT INTO storage_fixture.objects VALUES('00000000-0000-4000-8000-000000000003',
 '00000000-0000-4000-8000-000000000001','synthetic-object',24);
`;
const SNAPSHOT = `
SELECT jsonb_build_object(
 'users',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM auth_fixture.users t),
 'identities',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM auth_fixture.identities t),
 'profiles',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM app_fixture.profiles t),
 'catalog',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM app_fixture.catalog t),
 'objects',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM storage_fixture.objects t),
 'columns',(SELECT jsonb_agg(to_jsonb(t) ORDER BY table_schema,table_name,ordinal_position)
 FROM (SELECT table_schema,table_name,column_name,ordinal_position,data_type,is_nullable,column_default,is_identity,identity_generation
 FROM information_schema.columns WHERE table_schema IN ('app_fixture','auth_fixture','storage_fixture')) t),
 'constraints',(SELECT jsonb_agg(to_jsonb(t) ORDER BY schema,name)
 FROM (SELECT n.nspname AS schema,c.conname AS name,pg_get_constraintdef(c.oid) AS definition FROM pg_constraint c
 JOIN pg_namespace n ON n.oid=c.connamespace WHERE n.nspname IN ('app_fixture','auth_fixture','storage_fixture')) t),
 'indexes',(SELECT jsonb_agg(to_jsonb(t) ORDER BY schemaname,indexname)
 FROM (SELECT schemaname,tablename,indexname,indexdef FROM pg_indexes WHERE schemaname IN ('app_fixture','auth_fixture','storage_fixture')) t),
 'functions',(SELECT jsonb_agg(to_jsonb(t) ORDER BY name)
 FROM (SELECT p.proname AS name,pg_get_functiondef(p.oid) AS definition FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='app_fixture') t),
 'triggers',(SELECT jsonb_agg(pg_get_triggerdef(t.oid) ORDER BY t.tgname) FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
 JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('app_fixture','auth_fixture','storage_fixture') AND NOT t.tgisinternal),
 'policies',(SELECT jsonb_agg(to_jsonb(t) ORDER BY policyname) FROM (SELECT schemaname,tablename,policyname,permissive,roles,cmd,qual,with_check FROM pg_policies WHERE schemaname='app_fixture') t),
 'rls',(SELECT jsonb_agg(jsonb_build_array(c.relname,c.relrowsecurity,c.relforcerowsecurity) ORDER BY c.relname)
 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='app_fixture' AND c.relkind='r'),
 'enum',(SELECT jsonb_agg(e.enumlabel ORDER BY e.enumsortorder) FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid
 JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname='app_fixture'),
 'sequence',(SELECT jsonb_build_object('last_value',last_value,'is_called',is_called) FROM app_fixture.catalog_id_seq)
)::text AS snapshot`;
async function snapshot(context, database) {
  const result = (await query(context, database, SNAPSHOT)).at(-1);
  if (!result || Buffer.byteLength(result) > 1024 * 1024) fail("SNAPSHOT_SIZE_LIMIT");
  return result;
}
function pgArgs(context, database) { return ["-h", context.directory, "-p", PORT, "-U", USER, "-d", database, "--no-password"]; }

// pg_identify_object covers dependency-tracked functions, types, operators,
// collations, relations, and other namespaced objects, not just pg_class rows.
const EMPTY_DESTINATION = `
SELECT NOT (
 EXISTS (SELECT 1 FROM pg_namespace WHERE nspname NOT IN ('pg_catalog','information_schema','pg_toast','public'))
 OR EXISTS (SELECT 1 FROM pg_depend d
   CROSS JOIN LATERAL pg_identify_object(d.classid,d.objid,d.objsubid) i
   WHERE i.schema = 'public')
 OR EXISTS (SELECT 1 FROM pg_extension WHERE extname <> 'plpgsql')
 OR EXISTS (SELECT 1 FROM pg_event_trigger)
 OR EXISTS (SELECT 1 FROM pg_foreign_server)
 OR EXISTS (SELECT 1 FROM pg_publication)
 OR EXISTS (SELECT 1 FROM pg_default_acl)
 OR EXISTS (SELECT 1 FROM pg_largeobject_metadata)
) AS empty;`;

async function ensureStopped(context) {
  if (!context.startAttempted) return;
  // A failed start may still have launched a postmaster. status exit code 3,
  // specifically, confirms there is no running server; other errors fail closed.
  try {
    await command("pg_ctl", ["-D", `${context.directory}/data`, "-m", "immediate", "-w", "stop"]);
  } catch {
    if (!await serverStopped(context)) fail("SYNTHETIC_CLEANUP_FAILED");
  }
  if (!await serverStopped(context)) fail("SYNTHETIC_CLEANUP_FAILED");
  // Keep startAttempted until removal succeeds: every cleanup retry must
  // reconfirm stopped status, including retries following a removal failure.
}
async function serverStopped(context) {
  const code = await command("pg_ctl", ["-D", `${context.directory}/data`, "status"], undefined, true);
  return code === 3;
}

export async function createSyntheticSandbox() {
  const stats = await statfs("/tmp", { bigint: true });
  assertSyntheticDiskBudget(stats.bavail * stats.bsize);
  const directory = await mkdtemp("/tmp/alb-synthetic-backup-");
  const context = { directory, startAttempted: false, closed: false, restoreAttempted: false };
  const handle = Object.freeze({ syntheticOnly: true });
  contexts.set(handle, context);
  try {
    await command("initdb", ["-D", `${directory}/data`, "-U", USER, "-A", "trust", "--no-locale", "--encoding=UTF8"]);
    context.startAttempted = true;
    await command("pg_ctl", ["-D", `${directory}/data`, "-l", `${directory}/server.log`, "-o", `-p ${PORT} -h '' -k ${directory}`, "-w", "start"]);
    await query(context, "postgres", "CREATE DATABASE synthetic_backup_source;\nCREATE DATABASE synthetic_backup_restore;");
    await query(context, "synthetic_backup_source", FIXTURE);
    return handle;
  } catch {
    try { await closeSyntheticSandbox(handle); }
    catch {
      // Preserve a cleanup-only capability, never a usable database target.
      const error = new Error("SYNTHETIC_SETUP_CLEANUP_REQUIRED");
      error.cleanupHandle = handle;
      throw error;
    }
    fail("SYNTHETIC_SETUP_FAILED");
  }
}
export async function closeSyntheticSandbox(handle) {
  const context = contexts.get(handle);
  if (!context || context.closed) return;
  if (context.closing) fail("SYNTHETIC_CLEANUP_BUSY");
  if (context.active) fail("SYNTHETIC_OPERATION_ACTIVE");
  context.closing = true;
  context.cleanupPending = true;
  try {
    await ensureStopped(context);
    await rm(context.directory, { recursive: true, force: true });
    context.closed = true;
  } catch { fail("SYNTHETIC_CLEANUP_FAILED"); }
  finally {
    context.closing = false; // Stop/removal failures remain retryable.
  }
}
export async function captureSyntheticBackup(handle) {
  const context = contextFor(handle);
  const release = reserveMemory();
  context.active = true;
  let archive, files, key;
  try {
    key = generateSyntheticBackupKey();
    const before = await snapshot(context, "synthetic_backup_source");
    archive = await command("pg_dump", [...pgArgs(context, "synthetic_backup_source"), "--format=custom"]);
    const versionBytes = await command("pg_dump", ["--version"]);
    const version = versionBytes.toString("utf8").trim();
    versionBytes.fill(0);
    files = Buffer.from("synthetic file bytes only");
    const pkg = sealSyntheticPackage({ archive, files, key, summary: {
      toolVersion: version, nodeVersion: process.version, snapshot: before,
      counts: { users: 1, identities: 1, profiles: 1, catalog: 2, objects: 1 },
    } });
    return { package: pkg, key };
  } catch { key?.fill(0); fail("SYNTHETIC_CAPTURE_FAILED"); }
  finally { archive?.fill(0); files?.fill(0); context.active = false; release(); }
}
export async function restoreSyntheticBackup(handle, pkg, key, expectedBackupSetId) {
  if (contexts.get(handle)?.restoreAttempted) fail("RESTORE_ALREADY_ATTEMPTED");
  const context = contextFor(handle);
  if (context.active) fail("SYNTHETIC_OPERATION_ACTIVE");
  const release = reserveMemory();
  context.restoreAttempted = true; // Reserve synchronously, before ANY asynchronous work.
  context.active = true;
  let verified;
  try {
    verified = verifySyntheticPackage(pkg, key, expectedBackupSetId);
    const empty = (await query(context, "synthetic_backup_restore", EMPTY_DESTINATION)).at(-1);
    if (empty !== "t") fail("RESTORE_DESTINATION_NOT_EMPTY");
    await command("pg_restore", [...pgArgs(context, "synthetic_backup_restore"), "--exit-on-error", "--single-transaction", "--no-owner"], verified.archive);
    const actual = await snapshot(context, "synthetic_backup_restore");
    if (!isDeepStrictEqual(actual, verified.manifest.summary.snapshot) ||
      verified.files.toString("utf8") !== "synthetic file bytes only") fail("RESTORE_COMPARISON_FAILED");
    return Object.freeze({ status: "VERIFIED_SYNTHETIC_RESTORE", catalogRows: 2, fileComponents: 1 });
  } catch { context.quarantined = true; fail("SYNTHETIC_RESTORE_FAILED_NO_RETRY"); }
  finally { verified?.archive.fill(0); verified?.files.fill(0); context.active = false; release(); }
}
