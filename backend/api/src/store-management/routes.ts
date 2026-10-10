import { and, desc, eq } from "drizzle-orm";
import { Router, type Request, type Response } from "express";
import {
  commissionRateUpdateSchema,
  dayOfWeekParamSchema,
  operatingHoursSchema,
  servicePincodeSchema,
  storeIdParamSchema,
  storeUpdateSchema,
} from "@workspace/validation";
import {
  getDb,
  stores,
  storeOperatingHours,
  storeServicePincodes,
} from "@workspace/db";
import { requireRole } from "../auth/index.js";
import type { AuthenticatedRequest } from "../auth/types.js";
import { asyncHandler, HttpError, isUniqueViolation, validationDetails } from "../http.js";
import { type StoreStatus } from "./status.js";
import { changeStoreStatus } from "./admin-status.js";

export const storeManagementRouter = Router();

function vendorStoreId(request: Request) {
  const storeId = (request as AuthenticatedRequest).auth?.storeId;
  if (!storeId) {
    throw new HttpError(404, "Vendor store not found");
  }
  return storeId;
}

function requireUuidParam(request: Request) {
  const result = storeIdParamSchema.safeParse(request.params);
  if (!result.success) {
    throw new HttpError(400, "Invalid store ID", validationDetails(result.error));
  }
  return result.data.storeId;
}

function sendValidationError(response: Response, error: { issues: unknown }) {
  response.status(400).json({
    error: "Validation failed",
    details: error.issues,
  });
}

async function getStore(storeId: string) {
  const [store] = await getDb()
    .select()
    .from(stores)
    .where(eq(stores.id, storeId))
    .limit(1);
  if (!store) {
    throw new HttpError(404, "Store not found");
  }
  return store;
}

storeManagementRouter.get(
  "/api/vendor/store",
  requireRole("vendor"),
  asyncHandler(async (request, response) => {
    response.json({ store: await getStore(vendorStoreId(request)) });
  }),
);

storeManagementRouter.patch(
  "/api/vendor/store",
  requireRole("vendor"),
  asyncHandler(async (request, response) => {
    const parsed = storeUpdateSchema.safeParse(request.body);
    if (!parsed.success) {
      sendValidationError(response, parsed.error);
      return;
    }

    const updates = parsed.data;
    if (Object.keys(updates).length === 0) {
      throw new HttpError(400, "At least one permitted store field is required");
    }

    const dbUpdates = {
      ...updates,
      updatedAt: new Date(),
      deliveryFee:
        updates.deliveryFee === undefined
          ? undefined
          : updates.deliveryFee.toFixed(2),
      handlingFee: updates.handlingFee === undefined ? undefined : updates.handlingFee.toFixed(2),
      minimumOrderValue:
        updates.minimumOrderValue === undefined
          ? undefined
          : updates.minimumOrderValue.toFixed(2),
    };

    const [store] = await getDb()
      .update(stores)
      .set(dbUpdates)
      .where(eq(stores.id, vendorStoreId(request)))
      .returning();
    if (!store) {
      throw new HttpError(404, "Store not found");
    }
    response.json({ store });
  }),
);

storeManagementRouter.get(
  "/api/vendor/store/pincodes",
  requireRole("vendor"),
  asyncHandler(async (request, response) => {
    const pincodes = await getDb()
      .select()
      .from(storeServicePincodes)
      .where(eq(storeServicePincodes.storeId, vendorStoreId(request)))
      .limit(100);
    response.json({ pincodes });
  }),
);

storeManagementRouter.post(
  "/api/vendor/store/pincodes",
  requireRole("vendor"),
  asyncHandler(async (request, response) => {
    const parsed = servicePincodeSchema.safeParse(request.body);
    if (!parsed.success) {
      sendValidationError(response, parsed.error);
      return;
    }

    try {
      const [pincode] = await getDb()
        .insert(storeServicePincodes)
        .values({
          storeId: vendorStoreId(request),
          pincode: parsed.data.pincode,
        })
        .returning();
      response.status(201).json({ pincode });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new HttpError(409, "That service pincode already exists");
      }
      throw error;
    }
  }),
);

storeManagementRouter.delete(
  "/api/vendor/store/pincodes/:pincode",
  requireRole("vendor"),
  asyncHandler(async (request, response) => {
    const parsed = servicePincodeSchema.safeParse({ pincode: request.params.pincode });
    if (!parsed.success) {
      sendValidationError(response, parsed.error);
      return;
    }

    const [deleted] = await getDb()
      .delete(storeServicePincodes)
      .where(
        and(
          eq(storeServicePincodes.storeId, vendorStoreId(request)),
          eq(storeServicePincodes.pincode, parsed.data.pincode),
        ),
      )
      .returning();
    if (!deleted) {
      throw new HttpError(404, "Service pincode not found");
    }
    response.status(204).send();
  }),
);

storeManagementRouter.get(
  "/api/vendor/store/hours",
  requireRole("vendor"),
  asyncHandler(async (request, response) => {
    const hours = await getDb()
      .select()
      .from(storeOperatingHours)
      .where(eq(storeOperatingHours.storeId, vendorStoreId(request)))
      .orderBy(storeOperatingHours.dayOfWeek)
      .limit(100);
    response.json({ hours });
  }),
);

storeManagementRouter.put(
  "/api/vendor/store/hours/:dayOfWeek",
  requireRole("vendor"),
  asyncHandler(async (request, response) => {
    const day = dayOfWeekParamSchema.safeParse(request.params);
    if (!day.success) {
      sendValidationError(response, day.error);
      return;
    }
    const parsed = operatingHoursSchema.safeParse(request.body);
    if (!parsed.success) {
      sendValidationError(response, parsed.error);
      return;
    }

    const storeId = vendorStoreId(request);
    const values = {
      storeId,
      dayOfWeek: day.data.dayOfWeek,
      opensAt: parsed.data.isClosed ? null : parsed.data.opensAt,
      closesAt: parsed.data.isClosed ? null : parsed.data.closesAt,
      isClosed: parsed.data.isClosed,
    };
    const db = getDb();
    const [existing] = await db
      .select({ id: storeOperatingHours.id })
      .from(storeOperatingHours)
      .where(
        and(
          eq(storeOperatingHours.storeId, storeId),
          eq(storeOperatingHours.dayOfWeek, day.data.dayOfWeek),
        ),
      )
      .limit(1);

    const [hours] = existing
      ? await db
          .update(storeOperatingHours)
          .set(values)
          .where(eq(storeOperatingHours.id, existing.id))
          .returning()
      : await db.insert(storeOperatingHours).values(values).returning();

    response.json({ hours });
  }),
);

storeManagementRouter.get(
  "/api/admin/stores",
  requireRole("admin"),
  asyncHandler(async (_request, response) => {
    const storeList = await getDb()
      .select()
      .from(stores)
      .orderBy(desc(stores.createdAt))
      .limit(100);
    response.json({ stores: storeList });
  }),
);

storeManagementRouter.get(
  "/api/admin/stores/:storeId",
  requireRole("admin"),
  asyncHandler(async (request, response) => {
    response.json({ store: await getStore(requireUuidParam(request)) });
  }),
);

async function transitionStoreStatus(
  request: Request,
  response: Response,
  nextStatus: StoreStatus,
) {
  const storeId = requireUuidParam(request);
  const actorId = (request as AuthenticatedRequest).auth!.userId;
  const updatedStore = await changeStoreStatus(storeId, nextStatus, actorId);
  response.json({ store: updatedStore });
}

storeManagementRouter.post(
  "/api/admin/stores/:storeId/approve",
  requireRole("admin"),
  asyncHandler((request, response) =>
    transitionStoreStatus(request, response, "ACTIVE"),
  ),
);

storeManagementRouter.post(
  "/api/admin/stores/:storeId/reject",
  requireRole("admin"),
  asyncHandler((request, response) =>
    transitionStoreStatus(request, response, "REJECTED"),
  ),
);

storeManagementRouter.post(
  "/api/admin/stores/:storeId/suspend",
  requireRole("admin"),
  asyncHandler((request, response) =>
    transitionStoreStatus(request, response, "SUSPENDED"),
  ),
);

storeManagementRouter.post(
  "/api/admin/stores/:storeId/reactivate",
  requireRole("admin"),
  asyncHandler((request, response) =>
    transitionStoreStatus(request, response, "ACTIVE"),
  ),
);

storeManagementRouter.patch(
  "/api/admin/stores/:storeId/commission-rate",
  requireRole("admin"),
  asyncHandler(async (request, response) => {
    const parsed = commissionRateUpdateSchema.safeParse(request.body);
    if (!parsed.success) {
      sendValidationError(response, parsed.error);
      return;
    }

    const [store] = await getDb()
      .update(stores)
      .set({
        commissionRate:
          parsed.data.commissionRate === null
            ? null
            : parsed.data.commissionRate.toFixed(2),
      })
      .where(eq(stores.id, requireUuidParam(request)))
      .returning();
    if (!store) {
      throw new HttpError(404, "Store not found");
    }
    response.json({ store });
  }),
);