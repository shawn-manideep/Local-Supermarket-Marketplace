import { Router } from "express";
import { z } from "zod";
import { partnerLoginSchema, partnerProvisionSchema } from "@workspace/validation";
import { requireRole } from "../auth/middleware.js";
import type { AuthenticatedRequest } from "../auth/types.js";
import { asyncHandler, HttpError, validationDetails } from "../http.js";
import { partnerRepository, publicPartner } from "./repository.js";
import { loginPartner, provisionPartner, supabasePartnerAuth } from "./auth-service.js";
import { requireDeliveryPartner } from "./middleware.js";
import { deliveryWorkflow } from "./workflow.js";
import { adminManagement, managementQuery, partnerManagementStatusInput } from "../admin-management/service.js";

export const deliveryPartnerRouter = Router();
deliveryPartnerRouter.get("/api/delivery-partner/available-deliveries",requireDeliveryPartner(),asyncHandler(async(req,res) => {
  res.setHeader("Cache-Control","private, no-store");
  res.json({deliveries:await deliveryWorkflow().available((req as AuthenticatedRequest).auth!.userId)});
}));
deliveryPartnerRouter.post("/api/delivery-partner/orders/:orderId/claim",requireDeliveryPartner(),asyncHandler(async(req,res) => {
  const body = z.object({}).strict().safeParse(req.body ?? {});
  if (!body.success) throw new HttpError(400,"No partner identifier or assignment override is permitted.");
  res.setHeader("Cache-Control","private, no-store");
  res.json({assignment:await deliveryWorkflow().claim((req as AuthenticatedRequest).auth!.userId,identifier(req.params.orderId))});
}));
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
  res.json({ summary: await deliveryWorkflow().dashboard((req as AuthenticatedRequest).auth!.userId) });
}));
deliveryPartnerRouter.get("/api/delivery-partner/deliveries", requireDeliveryPartner(), asyncHandler(async (req, res) => {
  res.json({ deliveries: await deliveryWorkflow().own((req as AuthenticatedRequest).auth!.userId) });
}));
const identifier = (value: unknown) => {
  const id = z.string().uuid().safeParse(value);
  if (!id.success) throw new HttpError(400, "Invalid delivery identifier.", undefined, "INVALID_ASSIGNMENT");
  return id.data;
};
deliveryPartnerRouter.get("/api/vendor/delivery-partners", requireRole("vendor"), asyncHandler(async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.json({ partners: await deliveryWorkflow().eligible((req as AuthenticatedRequest).auth!) });
}));
deliveryPartnerRouter.get("/api/vendor/orders/:orderId/delivery", requireRole("vendor"), asyncHandler(async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.json({ assignment: await deliveryWorkflow().vendorRead((req as AuthenticatedRequest).auth!, identifier(req.params.orderId)) });
}));
deliveryPartnerRouter.post("/api/vendor/orders/:orderId/delivery", requireRole("vendor"), asyncHandler(async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  // Keep the legacy URL explicitly denied rather than allowing a stale client
  // to bypass first-eligible-partner claims. Historic pending duties are retained.
  throw new HttpError(403, "Manual Vendor assignment is disabled. The first eligible active Partner to accept is assigned automatically.",
    undefined, "AUTOMATIC_ASSIGNMENT_REQUIRED");
}));
deliveryPartnerRouter.get("/api/delivery-partner/deliveries/:assignmentId", requireDeliveryPartner(), asyncHandler(async (req, res) => {
  res.json({ assignment: await deliveryWorkflow().own((req as AuthenticatedRequest).auth!.userId, identifier(req.params.assignmentId)) });
}));
deliveryPartnerRouter.post("/api/delivery-partner/deliveries/:assignmentId/actions", requireDeliveryPartner(), asyncHandler(async (req, res) => {
  const input = z.object({ action: z.enum(["ACCEPT","REJECT","PICKUP","START","DELIVER"]) }).strict().safeParse(req.body);
  if (!input.success) throw new HttpError(400, "Invalid delivery action.", undefined, "INVALID_DELIVERY_TRANSITION");
  res.json({ assignment: await deliveryWorkflow().action((req as AuthenticatedRequest).auth!.userId, identifier(req.params.assignmentId), input.data.action) });
}));
deliveryPartnerRouter.get("/api/admin/delivery-partners", requireRole("admin"), asyncHandler(async (req, res) => {
  const query = managementQuery.safeParse(req.query);
  if (!query.success) throw new HttpError(400, "Invalid management query", validationDetails(query.error));
  const result = await adminManagement().list("delivery-partners", query.data);
  // Preserve the previous administrative envelope for existing callers.
  res.json({ ...result, partners: result.items });
}));
deliveryPartnerRouter.get("/api/admin/delivery-partners/:partnerId", requireRole("admin"), asyncHandler(async (req, res) => {
  const id = z.string().uuid().safeParse(req.params.partnerId);
  if (!id.success) throw new HttpError(400, "Invalid partner ID");
  res.json({ account: await adminManagement().detail("delivery-partners", id.data) });
}));
deliveryPartnerRouter.post("/api/admin/delivery-partners", requireRole("admin"), asyncHandler(async (req, res) => {
  const input = partnerProvisionSchema.safeParse(req.body);
  if (!input.success) throw new HttpError(400, "Invalid partner details.", validationDetails(input.error));
  res.status(201).json({ partner: await provisionPartner(partnerRepository(), supabasePartnerAuth(), input.data, (req as AuthenticatedRequest).auth!.userId) });
}));
deliveryPartnerRouter.patch("/api/admin/delivery-partners/:partnerId/status", requireRole("admin"), asyncHandler(async (req, res) => {
  const id = z.string().uuid().safeParse(req.params.partnerId);
  const input = partnerManagementStatusInput.safeParse(req.body);
  if (!id.success || !input.success) throw new HttpError(400, "Invalid partner status update.");
  res.json({ partner: await partnerRepository().status(id.data, input.data.status, {
    actorId: (req as AuthenticatedRequest).auth!.userId,
    confirmActiveAssignments: input.data.confirmActiveAssignments,
  }) });
}));