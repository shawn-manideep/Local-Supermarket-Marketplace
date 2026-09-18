import { and, asc, eq } from "drizzle-orm";
import { Router, type Request, type Response } from "express";
import {
  customerAddressCreateSchema,
  customerAddressIdParamSchema,
  customerAddressUpdateSchema,
  customerProfileUpdateSchema,
} from "@workspace/validation";
import { customerAddresses, customers, getDb } from "@workspace/db";
import { requireRole } from "../auth/index.js";
import type { AuthenticatedRequest } from "../auth/types.js";
import { asyncHandler, HttpError, validationDetails } from "../http.js";

export const customerManagementRouter = Router();

function customerId(request: Request) {
  const id = (request as AuthenticatedRequest).auth?.userId;
  if (!id) throw new HttpError(401, "Authentication required");
  return id;
}

function addressId(request: Request) {
  const parsed = customerAddressIdParamSchema.safeParse(request.params);
  if (!parsed.success) {
    throw new HttpError(400, "Invalid address ID", validationDetails(parsed.error));
  }
  return parsed.data.addressId;
}

function sendValidationError(response: Response, error: { issues: unknown }) {
  response.status(400).json({ error: "Validation failed", details: error.issues });
}

function addressOwnership(customerIdValue: string, addressIdValue: string) {
  return and(
    eq(customerAddresses.customerId, customerIdValue),
    eq(customerAddresses.id, addressIdValue),
  );
}

customerManagementRouter.get(
  "/api/customer/profile",
  requireRole("customer"),
  asyncHandler(async (request, response) => {
    const [profile] = await getDb()
      .select()
      .from(customers)
      .where(eq(customers.id, customerId(request)))
      .limit(1);
    if (!profile) throw new HttpError(404, "Customer profile not found");
    response.json({ profile });
  }),
);

customerManagementRouter.patch(
  "/api/customer/profile",
  requireRole("customer"),
  asyncHandler(async (request, response) => {
    const parsed = customerProfileUpdateSchema.safeParse(request.body);
    if (!parsed.success) {
      sendValidationError(response, parsed.error);
      return;
    }
    const [profile] = await getDb()
      .update(customers)
      .set({ ...parsed.data, updatedAt: new Date() })
      .where(eq(customers.id, customerId(request)))
      .returning();
    if (!profile) throw new HttpError(404, "Customer profile not found");
    response.json({ profile });
  }),
);

customerManagementRouter.get(
  "/api/customer/addresses",
  requireRole("customer"),
  asyncHandler(async (request, response) => {
    const addresses = await getDb()
      .select()
      .from(customerAddresses)
      .where(eq(customerAddresses.customerId, customerId(request)))
      .orderBy(asc(customerAddresses.createdAt));
    response.json({ addresses });
  }),
);

customerManagementRouter.get(
  "/api/customer/addresses/:addressId",
  requireRole("customer"),
  asyncHandler(async (request, response) => {
    const [address] = await getDb()
      .select()
      .from(customerAddresses)
      .where(addressOwnership(customerId(request), addressId(request)))
      .limit(1);
    if (!address) throw new HttpError(404, "Customer address not found");
    response.json({ address });
  }),
);

customerManagementRouter.post(
  "/api/customer/addresses",
  requireRole("customer"),
  asyncHandler(async (request, response) => {
    const parsed = customerAddressCreateSchema.safeParse(request.body);
    if (!parsed.success) {
      sendValidationError(response, parsed.error);
      return;
    }
    const ownerId = customerId(request);
    const address = await getDb().transaction(async (transaction) => {
      if (parsed.data.isDefault) {
        await transaction
          .update(customerAddresses)
          .set({ isDefault: false, updatedAt: new Date() })
          .where(eq(customerAddresses.customerId, ownerId));
      }
      const [created] = await transaction
        .insert(customerAddresses)
        .values({ ...parsed.data, customerId: ownerId })
        .returning();
      return created;
    });
    response.status(201).json({ address });
  }),
);

customerManagementRouter.patch(
  "/api/customer/addresses/:addressId",
  requireRole("customer"),
  asyncHandler(async (request, response) => {
    const parsed = customerAddressUpdateSchema.safeParse(request.body);
    if (!parsed.success) {
      sendValidationError(response, parsed.error);
      return;
    }
    const ownerId = customerId(request);
    const id = addressId(request);
    const address = await getDb().transaction(async (transaction) => {
      const [existing] = await transaction
        .select({ id: customerAddresses.id })
        .from(customerAddresses)
        .where(addressOwnership(ownerId, id))
        .limit(1);
      if (!existing) return null;
      if (parsed.data.isDefault) {
        await transaction
          .update(customerAddresses)
          .set({ isDefault: false, updatedAt: new Date() })
          .where(eq(customerAddresses.customerId, ownerId));
      }
      const [updated] = await transaction
        .update(customerAddresses)
        .set({ ...parsed.data, updatedAt: new Date() })
        .where(addressOwnership(ownerId, id))
        .returning();
      return updated;
    });
    if (!address) throw new HttpError(404, "Customer address not found");
    response.json({ address });
  }),
);

customerManagementRouter.delete(
  "/api/customer/addresses/:addressId",
  requireRole("customer"),
  asyncHandler(async (request, response) => {
    const [deleted] = await getDb()
      .delete(customerAddresses)
      .where(addressOwnership(customerId(request), addressId(request)))
      .returning({ id: customerAddresses.id });
    if (!deleted) throw new HttpError(404, "Customer address not found");
    response.status(204).send();
  }),
);