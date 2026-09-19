import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";

const webRoot = path.resolve(process.argv[2] ?? "/tmp/phase12-customer-web");
const port = Number(process.env.PORT ?? 8082);
const backendOrigin = process.env.PREVIEW_BACKEND_ORIGIN ?? "http://127.0.0.1:5000";

const contentTypes = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".ico", "image/x-icon"],
  [".jpeg", "image/jpeg"],
  [".jpg", "image/jpeg"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
  [".webp", "image/webp"],
]);

async function proxyApi(request, response) {
  const chunks = [];
  for await (const chunk of request) {
    chunks.push(chunk);
  }

  const headers = new Headers();
  for (const [name, value] of Object.entries(request.headers)) {
    if (
      value &&
      !["connection", "content-length", "host", "origin"].includes(name.toLowerCase())
    ) {
      headers.set(name, Array.isArray(value) ? value.join(", ") : value);
    }
  }

  const hasBody = request.method !== "GET" && request.method !== "HEAD";
  const upstream = await fetch(`${backendOrigin}${request.url}`, {
    method: request.method,
    headers,
    body: hasBody && chunks.length ? Buffer.concat(chunks) : undefined,
  });

  response.statusCode = upstream.status;
  upstream.headers.forEach((value, name) => {
    if (!["content-encoding", "content-length", "transfer-encoding"].includes(name)) {
      response.setHeader(name, value);
    }
  });
  response.end(Buffer.from(await upstream.arrayBuffer()));
}

async function serveStatic(request, response) {
  const requestPath = new URL(request.url ?? "/", "http://preview.local").pathname;
  const candidate = path.resolve(webRoot, `.${requestPath === "/" ? "/index.html" : requestPath}`);
  const filePath = candidate.startsWith(`${webRoot}${path.sep}`) ? candidate : "";

  let resolved = filePath;
  try {
    if (!resolved || !(await stat(resolved)).isFile()) {
      resolved = path.join(webRoot, "index.html");
    }
    const body = await readFile(resolved);
    response.statusCode = 200;
    response.setHeader(
      "Content-Type",
      contentTypes.get(path.extname(resolved).toLowerCase()) ?? "application/octet-stream",
    );
    response.end(body);
  } catch {
    response.statusCode = 404;
    response.setHeader("Content-Type", "application/json; charset=utf-8");
    response.end(JSON.stringify({ error: "Preview asset not found" }));
  }
}

createServer((request, response) => {
  const handler = request.url?.startsWith("/api/") ? proxyApi : serveStatic;
  void handler(request, response).catch(() => {
    if (!response.headersSent) {
      response.statusCode = 502;
      response.setHeader("Content-Type", "application/json; charset=utf-8");
    }
    response.end(JSON.stringify({ error: "Preview service unavailable" }));
  });
}).listen(port, "0.0.0.0", () => {
  process.stdout.write(`Customer Web preview listening on port ${port}\n`);
});