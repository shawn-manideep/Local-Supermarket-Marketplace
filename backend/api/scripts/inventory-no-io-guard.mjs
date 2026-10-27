// Synthetic inventory verification only: deny even loopback, DNS and credentials.
import net from "node:net";
import tls from "node:tls";
import http from "node:http";
import https from "node:https";
import http2 from "node:http2";
import dgram from "node:dgram";
import dns from "node:dns";
import fs from "node:fs";
import fsp from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";

const denied = () => { throw new Error("Inventory fixture I/O denied."); };
net.Socket.prototype.connect = denied;
tls.connect = denied;
http.request = http.get = https.request = https.get = denied;
http2.connect = denied;
dgram.createSocket = denied;
globalThis.fetch = denied;
for (const name of ["lookup", "resolve", "resolve4", "resolve6", "reverse"]) {
  dns[name] = denied;
  dns.promises[name] = denied;
}
// Module loading is allowed; conventional credential/config file locations are not.
const privatePath = value => /(?:^|[/\\])(?:\.env(?:\.[^/\\]*)?|\.aws|\.config[/\\]gcloud|application_default_credentials\.json|credentials(?:\.json)?)(?:[/\\]|$)/i
  .test(String(value));
for (const target of [fs, fsp]) for (const name of ["readFile", "readFileSync", "open", "openSync", "createReadStream"]) {
  if (typeof target[name] !== "function") continue;
  const original = target[name];
  target[name] = function (path, ...args) {
    if (privatePath(path)) return denied();
    return original.call(this, path, ...args);
  };
}
syncBuiltinESMExports();
