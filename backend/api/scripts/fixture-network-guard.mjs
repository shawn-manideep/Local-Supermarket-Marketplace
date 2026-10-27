// Local verification only. Never imported by the application or deployment.
import net from "node:net";
const local = host => ["localhost", "127.0.0.1", "::1", "[::1]"].includes(host);
const originalConnect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...originalArgs) {
  const args = Array.isArray(originalArgs[0]) ? originalArgs[0] : originalArgs;
  const options = args[0];
  const host = typeof options === "object" && options !== null
    ? options.host ?? "localhost" : typeof args[1] === "string" ? args[1] : "localhost";
  if (!local(host)) throw new Error("Fixture verification blocked a non-loopback connection.");
  return originalConnect.apply(this, originalArgs);
};
const originalFetch = globalThis.fetch;
globalThis.fetch = (input, init) => {
  const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
  if (!local(url.hostname)) throw new Error("Fixture verification blocked a non-loopback request.");
  return originalFetch(input, init);
};
