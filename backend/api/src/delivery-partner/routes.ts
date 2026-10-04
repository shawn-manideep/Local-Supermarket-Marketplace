import { Router } from "express";
import { z } from "zod";
import { partnerLoginSchema, partnerProvisionSchema, partnerStatusSchema } from "@workspace/validation";
import { requireRole } from "../auth/middleware.js";
import type { AuthenticatedRequest } from "../auth/types.js";
import { asyncHandler, HttpError, validationDetails } from "../http.js";
import { partnerRepository, publicPartner } from "./repository.js";
import { loginPartner, provisionPartner, supabasePartnerAuth } from "./auth-service.js";
import { requireDeliveryPartner } from "./middleware.js";

export const deliveryPartnerRouter = Router();
deliveryPartnerRouter.use("/api/delivery-partner", (_req, res, next) => { res.setHeader("Cache-Control", "no-store"); next(); });
deliveryPartnerRouter.use("/api/admin/delivery-partners", (_req, res, next) => { res.setHeader("Cache-Control", "no-store"); next(); });
deliveryPartnerRouter.post("/api/delivery-partner/login", asyncHandler(async (req, res) => {
  const input = partnerLoginSchema.safeParse(req.body);
  if (!input.success) throw new HttpError(401, "Invalid username or password.");
  res.json(await loginPartner(partnerRepository(), supabasePartnerAuth(), input.data.username, input.data.password));
}));
deliveryPartnerRouter.get("/api/delivery-partner/me", requireDeliveryPartner(), asyncHandler(async (req, res) => {
  const id = (req as AuthenticatedRequest).auth!.userId;
  const profile = await partnerRepository().profile(id);
  if (!profile || profile.status !== "ACTIVE") throw new HttpError(403, "Your delivery partner account is inactive.", undefined, "PARTNER_INACTIVE");
  res.json({ partner: publicPartner(profile) });
}));
deliveryPartnerRouter.get("/api/delivery-partner/dashboard", requireDeliveryPartner(), asyncHandler(async (req, res) => {
  res.json({ summary: await partnerRepository().dashboard((req as AuthenticatedRequest).auth!.userId) });
}));
deliveryPartnerRouter.get("/api/delivery-partner/deliveries", requireDeliveryPartner(), asyncHandler(async (req, res) => {
  res.json({ deliveries: await partnerRepository().deliveries((req as AuthenticatedRequest).auth!.userId) });
}));
deliveryPartnerRouter.get("/api/admin/delivery-partners", requireRole("admin"), asyncHandler(async (_req, res) => {
  res.json({ partners: await partnerRepository().list() });
}));
deliveryPartnerRouter.post("/api/admin/delivery-partners", requireRole("admin"), asyncHandler(async (req, res) => {
  const input = partnerProvisionSchema.safeParse(req.body);
  if (!input.success) throw new HttpError(400, "Invalid partner details.", validationDetails(input.error));
  res.status(201).json({ partner: await provisionPartner(partnerRepository(), supabasePartnerAuth(), input.data) });
}));
deliveryPartnerRouter.patch("/api/admin/delivery-partners/:partnerId/status", requireRole("admin"), asyncHandler(async (req, res) => {
  const id = z.string().uuid().safeParse(req.params.partnerId);
  const input = partnerStatusSchema.safeParse(req.body);
  if (!id.success || !input.success) throw new HttpError(400, "Invalid partner status update.");
  res.json({ partner: await partnerRepository().status(id.data, input.data.status) });
}));