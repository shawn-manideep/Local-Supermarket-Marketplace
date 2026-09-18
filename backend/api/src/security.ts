import type { NextFunction, Request, Response } from "express";

type Bucket = { count: number; resetAt: number };
const WINDOW_MS = 60_000;
const READ_LIMIT = 300;
const GENERAL_LIMIT = 60;
const ORDER_LIMIT = 10;
const MAX_KEYS = 10_000;

export function createApiRateLimit() {
  const buckets = new Map<string, Bucket>();

  return function apiRateLimit(request: Request, response: Response, next: NextFunction) {
    if (!request.path.startsWith("/api/")) {
      next();
      return;
    }
    const now = Date.now();
    if (buckets.size >= MAX_KEYS) {
      for (const [key, bucket] of buckets) {
        if (bucket.resetAt <= now || buckets.size >= MAX_KEYS) buckets.delete(key);
        if (buckets.size < MAX_KEYS) break;
      }
    }
    const identity = request.ip || request.socket.remoteAddress || "unknown";
    const isMutation = ["POST", "PATCH", "PUT", "DELETE"].includes(request.method);
    const scope = request.method === "POST" && request.path === "/api/customer/orders"
      ? "orders"
      : isMutation ? "mutations" : "reads";
    const key = `${identity}:${scope}`;
    const limit = scope === "orders" ? ORDER_LIMIT : scope === "mutations" ? GENERAL_LIMIT : READ_LIMIT;
    const bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      buckets.set(key, { count: 1, resetAt: now + WINDOW_MS });
      next();
      return;
    }
    if (bucket.count >= limit) {
      response.setHeader("Retry-After", Math.ceil((bucket.resetAt - now) / 1000));
      response.status(429).json({ error: "Too many requests" });
      return;
    }
    bucket.count += 1;
    next();
  };
}