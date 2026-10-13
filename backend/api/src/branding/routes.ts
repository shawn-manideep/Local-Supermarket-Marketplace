import express, { Router, type RequestHandler } from "express";
import { requireRole } from "../auth/index.js";
import type { AuthenticatedRequest } from "../auth/types.js";
import { asyncHandler, HttpError } from "../http.js";
import { brandingStorage } from "./storage.js";
import { MAX_LOGO_BYTES, validateLogo } from "./validation.js";

export function createBrandingRouter(authorizeAdmin: RequestHandler = requireRole("admin"), storage = brandingStorage) {
  const router = Router();
  const config = async () => {
    const metadata = await storage.metadata();
    return { logoUrl: metadata ? "/api/branding/logo" : null, revision: metadata?.revision ?? null };
  };
  router.get("/api/branding", asyncHandler(async (_request, response) => {
    response.setHeader("Cache-Control", "no-store");
    try { response.json(await config()); }
    catch { throw new HttpError(503, "Application branding is temporarily unavailable."); }
  }));
  router.get("/api/branding/logo", asyncHandler(async (_request, response) => {
    const metadata = await storage.metadata();
    if (!metadata) throw new HttpError(404, "No application logo configured.");
    const image = await storage.get();
    if (!["image/png", "image/jpeg"].includes(image.mimeType)) throw new HttpError(404, "Application logo unavailable.");
    response.setHeader("Content-Type", image.mimeType);
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Content-Security-Policy", "sandbox");
    response.send(image.bytes);
  }));
  router.post("/api/admin/branding/logo", authorizeAdmin,
    express.raw({ type: ["image/png", "image/jpeg"], limit: MAX_LOGO_BYTES }),
    asyncHandler(async (request, response) => {
      if ((request as AuthenticatedRequest).auth?.role !== "admin") throw new HttpError(403, "Administrator access required.");
      const name = typeof request.query.fileName === "string" ? request.query.fileName : "";
      const mimeType = request.get("content-type")?.split(";")[0] ?? "";
      const bytes = Buffer.isBuffer(request.body) ? request.body : Buffer.alloc(0);
      validateLogo(name, mimeType, bytes);
      try { await storage.put(bytes, mimeType); }
      catch { throw new HttpError(503, "Logo upload failed. The active logo has not been replaced."); }
      response.setHeader("Cache-Control", "no-store");
      response.status(200).json(await config());
    }));
  return router;
}
export const brandingRouter = createBrandingRouter();
