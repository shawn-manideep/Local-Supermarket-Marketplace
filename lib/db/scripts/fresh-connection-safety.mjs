// Connection/session safeguards only. No migration imports, CLI or DDL/DML.
import { checkServerIdentity } from "node:tls";
import { X509Certificate } from "node:crypto";
import { openSync, fstatSync, readFileSync, closeSync } from "node:fs";

export const protectedProject = "gkwcolipeavxnuzqlamb";
export class ConnectionSafetyRefusal extends Error {}
export function assertSafe(condition, code) {
  if (!condition) throw new ConnectionSafetyRefusal(code);
}

export function verifiedTlsOptions(host, env) {
  let ca;
  const path = env.FRESH_DB_CA_CERT_PATH;
  const pin = env.FRESH_DB_CA_SHA256;
  if (path || pin) {
    assertSafe(typeof path === "string" && path.length > 0 && typeof pin === "string"
      && /^(?:[a-f0-9]{64}|(?:[a-f0-9]{2}:){31}[a-f0-9]{2})$/i.test(pin),
    "CA_PATH_AND_SHA256_REQUIRED");
    let fd;
    try {
      fd = openSync(path, "r");
      const file = fstatSync(fd);
      assertSafe(file.isFile() && file.size > 0 && file.size <= 65536, "INVALID_CA_FILE");
      ca = readFileSync(fd, "utf8");
      assertSafe(!/PRIVATE KEY/.test(ca)
        && (ca.match(/-----BEGIN CERTIFICATE-----/g) || []).length === 1, "PUBLIC_CA_ONLY");
      const cert = new X509Certificate(ca);
      assertSafe(cert.ca && cert.subject === cert.issuer && cert.verify(cert.publicKey),
        "INVALID_ROOT_CA");
      assertSafe(Date.parse(cert.validFrom) <= Date.now() && Date.parse(cert.validTo) > Date.now(),
        "CA_NOT_CURRENTLY_VALID");
      assertSafe(cert.fingerprint256.replaceAll(":", "").toLowerCase()
        === pin.replaceAll(":", "").toLowerCase(), "CA_FINGERPRINT_MISMATCH");
    } catch (error) {
      if (error instanceof ConnectionSafetyRefusal) throw error;
      throw new ConnectionSafetyRefusal("CA_FILE_UNREADABLE_OR_INVALID");
    } finally {
      if (fd !== undefined) closeSync(fd);
    }
  }
  return Object.freeze({
    ...(ca ? { ca } : {}),
    rejectUnauthorized: true,
    checkServerIdentity,
    servername: host,
  });
}

export function assertVerifiedClientTls(client, host) {
  const ssl = client.connectionParameters?.ssl;
  const stream = client.connection?.stream;
  assertSafe(ssl?.rejectUnauthorized === true && ssl.checkServerIdentity === checkServerIdentity
    && !client.connectionParameters.connectionString, "CLIENT_TLS_CONFIGURATION_UNSAFE");
  assertSafe(stream?.encrypted === true && stream.authorized === true, "CLIENT_TLS_NOT_VERIFIED");
  let hostnameError;
  try {
    hostnameError = checkServerIdentity(host, stream.getPeerCertificate());
  } catch {
    throw new ConnectionSafetyRefusal("CLIENT_TLS_HOSTNAME_NOT_VERIFIED");
  }
  assertSafe(!hostnameError, "CLIENT_TLS_HOSTNAME_NOT_VERIFIED");
}

export function inspectBackendTls(mode, backendTls, acknowledgedPoolerBoundary) {
  assertSafe(typeof backendTls === "boolean", "BACKEND_TLS_NOT_INSPECTABLE");
  if (mode === "direct") {
    assertSafe(backendTls === true, "DIRECT_DATABASE_TLS_REQUIRED");
    return { mode, backendTls, upstreamEncryptionVerified: true };
  }
  assertSafe(mode === "session-pooler" && acknowledgedPoolerBoundary === true,
    "POOLER_TLS_BOUNDARY_ACK_REQUIRED");
  // pg_stat_ssl describes the pooler's upstream connection, NOT the verified
  // external TLS socket. Never claim upstream encryption when it reports false.
  return { mode, backendTls, upstreamEncryptionVerified: backendTls };
}

const settingsQuery = `SELECT
  current_setting('transaction_read_only') AS read_only,
  current_setting('default_transaction_read_only') AS default_read_only,
  current_setting('statement_timeout') AS statement_timeout,
  current_setting('lock_timeout') AS lock_timeout,
  current_setting('idle_in_transaction_session_timeout') AS idle_timeout`;

async function applyLimits(client, scope, readOnly) {
  assertSafe(typeof readOnly === "boolean" && ["SESSION", "LOCAL"].includes(scope),
    "INVALID_SESSION_SETTINGS");
  // Values and statements are fixed, not interpolated from arguments/Secrets.
  await client.query(readOnly
    ? `SET ${scope} statement_timeout = '15s'`
    : `SET ${scope} statement_timeout = '30s'`);
  await client.query(`SET ${scope} lock_timeout = '3s'`);
  await client.query(`SET ${scope} idle_in_transaction_session_timeout = '20s'`);
}

export async function verifySessionLimits(client, readOnly, inTransaction = false) {
  const { rows: [settings] } = await client.query(settingsQuery);
  assertSafe(settings && settings.default_read_only === (readOnly ? "on" : "off")
    && settings.statement_timeout === (readOnly ? "15s" : "30s")
    && settings.lock_timeout === "3s" && settings.idle_timeout === "20s"
    && (!inTransaction || settings.read_only === (readOnly ? "on" : "off")),
  "SESSION_LIMITS_NOT_APPLIED");
  return settings;
}

export async function configureBoundedSession(client, readOnly) {
  assertSafe(typeof readOnly === "boolean", "INVALID_SESSION_SETTINGS");
  await client.query(readOnly
    ? "SET SESSION default_transaction_read_only = on"
    : "SET SESSION default_transaction_read_only = off");
  await applyLimits(client, "SESSION", readOnly);
  return verifySessionLimits(client, readOnly);
}

export async function beginBoundedTransaction(client, readOnly) {
  assertSafe(typeof readOnly === "boolean", "INVALID_SESSION_SETTINGS");
  await client.query(readOnly ? "BEGIN READ ONLY" : "BEGIN READ WRITE");
  try {
    await applyLimits(client, "LOCAL", readOnly);
    return await verifySessionLimits(client, readOnly, true);
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  }
}
