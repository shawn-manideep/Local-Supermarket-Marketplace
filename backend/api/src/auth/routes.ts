import { Router } from "express";
import { requireAuth } from "./middleware.js";
import { vendorLoginSchema } from "@workspace/validation/vendor-profile";
import { asyncHandler, HttpError, validationDetails } from "../http.js";
import { loginVendor } from "../admin-management/vendor-profile.js";
import type { AuthenticatedRequest } from "./types.js";
import { customerLoginSchema, loginCustomer, recoveryInput, recoveryRedirect, requestRecovery, RECOVERY_MESSAGE } from "./account-access.js";
import { registerVendor } from "./vendor-registration.js";

export const authRouter = Router();
const recoveryAttempts = new Map<string, { count: number; until: number }>();
authRouter.post("/api/customer/login", asyncHandler(async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  const input = customerLoginSchema.safeParse(req.body);
  if (!input.success) throw new HttpError(401, "Invalid username or password.");
  res.json(await loginCustomer(input.data.username, input.data.password));
}));

authRouter.post("/api/auth/recovery", asyncHandler(async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  const input = recoveryInput.safeParse(req.body);
  if (!input.success) throw new HttpError(400, "Enter a valid recovery identity.");
  const origins = (process.env.CORS_ALLOWED_ORIGINS ?? "").split(",").map(value => value.trim()).filter(Boolean);
  const origin = req.header("origin") ?? "";
  if (!origins.includes(origin)) throw new HttpError(403, "Origin is not allowed");
  const now = Date.now();
  for (const [key, entry] of recoveryAttempts) if (entry.until < now) recoveryAttempts.delete(key);
  const key = `${req.ip ?? req.socket.remoteAddress}:${input.data.role}`;
  const attempts = recoveryAttempts.get(key) ?? { count: 0, until: now + 15 * 60_000 };
  if (++attempts.count > 5 || recoveryAttempts.size > 10_000) {
    res.setHeader("Retry-After", "900");
    throw new HttpError(429, "Please wait before requesting more reset instructions.");
  }
  recoveryAttempts.set(key, attempts);
  // Do not make response timing depend on whether the provider delivers mail.
  // requestRecovery handles every lookup/provider failure internally.
  void requestRecovery(input.data, recoveryRedirect(input.data.role, origin));
  await new Promise(resolve => setTimeout(resolve, 1200));
  res.status(202).json({ message: RECOVERY_MESSAGE });
}));
authRouter.post("/api/vendor/login", asyncHandler(async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  const input = vendorLoginSchema.safeParse(req.body);
  if (!input.success) throw new HttpError(400, "Invalid vendor credentials", validationDetails(input.error));
  res.json(await loginVendor(input.data.username, input.data.password));
}));

authRouter.post("/api/vendor/register", requireAuth(), asyncHandler(async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.status(201).json(await registerVendor(req as AuthenticatedRequest));
}));

authRouter.get("/api/auth/me", requireAuth(), async (request, response, next) => {
  const auth = (request as AuthenticatedRequest).auth;
  if (auth?.role === "delivery_partner") {
    try {
      const { partnerRepository } = await import("../delivery-partner/repository.js");
      const profile = await partnerRepository().profile(auth.userId);
      if (!profile || profile.status !== "ACTIVE") {
        response.setHeader("Cache-Control", "no-store");
        response.status(403).json({ error: "Your delivery partner account is inactive. Contact an administrator.", code: "PARTNER_INACTIVE" });
        return;
      }
    } catch (error) { next(error); return; }
  }
  response.json({ auth });
});