import { Router } from "express";
import { requireAuth } from "./middleware.js";
import { vendorLoginSchema } from "@workspace/validation/vendor-profile";
import { asyncHandler, HttpError, validationDetails } from "../http.js";
import { loginVendor } from "../admin-management/vendor-profile.js";
import type { AuthenticatedRequest } from "./types.js";

export const authRouter = Router();
authRouter.post("/api/vendor/login", asyncHandler(async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  const input = vendorLoginSchema.safeParse(req.body);
  if (!input.success) throw new HttpError(400, "Invalid vendor credentials", validationDetails(input.error));
  res.json(await loginVendor(input.data.username, input.data.password));
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