import { Router } from "express";
import { requireRole } from "../auth/middleware.js";
import { vendorProvisionSchema, vendorProfileUpdateSchema } from "@workspace/validation/vendor-profile";
import { provisionVendor, updateVendorProfile } from "./vendor-profile.js";
import type { AuthenticatedRequest } from "../auth/types.js";
import { asyncHandler, HttpError, validationDetails } from "../http.js";
import {
  accountStatusInput, adminManagement, managementId, managementQuery, vendorStatusInput,
} from "./service.js";
export const adminManagementRouter = Router();
adminManagementRouter.use("/api/admin", (_req, res, next) => { res.setHeader("Cache-Control", "no-store"); next(); });
adminManagementRouter.get("/api/admin/dashboard", requireRole("admin"), asyncHandler(async (_req, res) => {
  res.json({ dashboard: await adminManagement().dashboard() });
}));
adminManagementRouter.post("/api/admin/vendors", requireRole("admin"), asyncHandler(async (req, res) => {
  const input = vendorProvisionSchema.safeParse(req.body);
  if (!input.success) throw new HttpError(400, "Invalid vendor profile", validationDetails(input.error));
  res.status(201).json({ account: await provisionVendor(input.data, (req as AuthenticatedRequest).auth!.userId) });
}));
adminManagementRouter.patch("/api/admin/vendors/:id", requireRole("admin"), asyncHandler(async (req, res) => {
  const id = managementId.safeParse(req.params.id);
  if (!id.success) throw new HttpError(400, "Invalid account ID");
  const input = vendorProfileUpdateSchema.safeParse(req.body);
  if (!input.success) throw new HttpError(400, "Invalid vendor profile", validationDetails(input.error));
  res.json({ account: await updateVendorProfile(id.data, input.data, (req as AuthenticatedRequest).auth!.userId) });
}));
for (const kind of ["vendors", "customers"] as const) {
  adminManagementRouter.get(`/api/admin/${kind}`, requireRole("admin"), asyncHandler(async (req, res) => {
    const query = managementQuery.safeParse(req.query);
    if (!query.success) throw new HttpError(400, "Invalid management query", validationDetails(query.error));
    res.json(await adminManagement().list(kind, query.data));
  }));
  adminManagementRouter.get(`/api/admin/${kind}/:id`, requireRole("admin"), asyncHandler(async (req, res) => {
    const id = managementId.safeParse(req.params.id);
    if (!id.success) throw new HttpError(400, "Invalid account ID");
    res.json({ account: await adminManagement().detail(kind, id.data) });
  }));
  adminManagementRouter.patch(`/api/admin/${kind}/:id/status`, requireRole("admin"), asyncHandler(async (req, res) => {
    const id = managementId.safeParse(req.params.id);
    if (!id.success) throw new HttpError(400, "Invalid account ID");
    const actorId = (req as AuthenticatedRequest).auth!.userId;
    if (kind === "vendors") {
      const input = vendorStatusInput.safeParse(req.body);
      if (!input.success) throw new HttpError(400, "Invalid store status");
      res.json({ store: await adminManagement().vendorStatus(id.data, input.data.status, actorId) });
    } else {
      const input = accountStatusInput.safeParse(req.body);
      if (!input.success) throw new HttpError(400, "Invalid customer status");
      res.json({ customer: await adminManagement().customerStatus(id.data, input.data.status, actorId) });
    }
  }));
}