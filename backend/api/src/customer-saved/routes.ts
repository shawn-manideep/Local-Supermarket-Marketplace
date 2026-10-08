import { Router, type Request } from "express";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import {
  categories, customerAddresses, customerSavedItems, getDb, masterProducts,
  products, stores, storeServicePincodes, storeOperatingHours,
} from "@workspace/db";
import { requireRole } from "../auth/index.js";
import type { AuthenticatedRequest } from "../auth/types.js";
import { asyncHandler, HttpError, validationDetails } from "../http.js";
import { addCustomerVariants, customerVariantsFor, publicProduct } from "../customer-marketplace/routes.js";
import { operatingStatus } from "../customer-marketplace/operating-status.js";

export const customerSavedRouter = Router();
const pincode = z.string().regex(/^[1-9]\d{5}$/);
const saveInput = z.object({ productId: z.string().uuid(), pincode }).strict();
const listInput = z.object({ pincode: pincode.optional() }).strict();
function owner(request: Request) {
  const id = (request as AuthenticatedRequest).auth?.userId;
  if (!id) throw new HttpError(401, "Authentication required");
  return id;
}
async function ownPincode(customerId: string, code: string | undefined) {
  if (!code) return;
  const [address] = await getDb().select({ id: customerAddresses.id }).from(customerAddresses)
    .where(and(eq(customerAddresses.customerId, customerId), eq(customerAddresses.pincode, code))).limit(1);
  if (!address) throw new HttpError(404, "No saved customer address uses this pincode");
}
customerSavedRouter.get("/api/customer/saved-items", requireRole("customer"), asyncHandler(async (request, response) => {
  const query = listInput.safeParse(request.query);
  if (!query.success) throw new HttpError(400, "Invalid saved items query", validationDetails(query.error));
  const customerId = owner(request);
  await ownPincode(customerId, query.data.pincode);
  const db = getDb();
  const rows = await db.select({
    product: { ...publicProduct, brand: sql<string | null>`coalesce(${masterProducts.brand},${products.brand})` },
    savedAt: customerSavedItems.createdAt, storeName: stores.name, storeStatus: stores.status,
    productActive: products.isActive, categoryActive: categories.isActive, servesPincode: storeServicePincodes.pincode,
  }).from(customerSavedItems).innerJoin(products, eq(products.id, customerSavedItems.productId))
    .innerJoin(stores, eq(stores.id, products.storeId))
    .leftJoin(masterProducts, eq(masterProducts.id, products.masterProductId))
    .leftJoin(categories, and(eq(categories.id, products.categoryId), eq(categories.storeId, products.storeId)))
    .leftJoin(storeServicePincodes, and(eq(storeServicePincodes.storeId, products.storeId), eq(storeServicePincodes.pincode, query.data.pincode ?? "")))
    .where(eq(customerSavedItems.customerId, customerId)).orderBy(desc(customerSavedItems.createdAt));
  const variants = await customerVariantsFor(rows.map(row => row.product.id));
  const enriched = addCustomerVariants(rows.map(row => row.product), variants);
  const storeIds = [...new Set(rows.map(row => row.product.storeId))];
  const hours = storeIds.length ? await db.select().from(storeOperatingHours).where(inArray(storeOperatingHours.storeId, storeIds)) : [];
  response.setHeader("Cache-Control", "private, no-store");
  response.json({ items: rows.map((row, i) => {
    const visible = row.productActive && row.storeStatus === "ACTIVE" &&
      (row.product.categoryId === null || row.categoryActive === true) && Boolean(row.servesPincode);
    const open = operatingStatus(hours.filter(hour => hour.storeId === row.product.storeId)) === "OPEN";
    const available = visible && open && enriched[i].purchasable;
    return {
      productId: row.product.id, storeId: row.product.storeId, storeName: row.storeName, savedAt: row.savedAt,
      available, unavailableReason: available ? null : !query.data.pincode
        ? "Choose a delivery address to check availability."
        : !visible ? "This product is not currently available for your address."
        : !open ? "This store is currently closed." : "This product is currently unavailable.",
      product: {
        ...enriched[i], storeName: row.storeName, imageUrl: visible ? enriched[i].imageUrl : null,
        availability: visible && row.product.availability, purchasable: available,
        variants: enriched[i].variants.map(variant => ({ ...variant, purchasable: available && variant.purchasable })),
      },
    };
  }) });
}));
customerSavedRouter.post("/api/customer/saved-items", requireRole("customer"), asyncHandler(async (request, response) => {
  const parsed = saveInput.safeParse(request.body);
  if (!parsed.success) throw new HttpError(400, "Invalid saved item", validationDetails(parsed.error));
  const customerId = owner(request);
  await ownPincode(customerId, parsed.data.pincode);
  const [product] = await getDb().select({ id: products.id }).from(products)
    .innerJoin(stores, eq(stores.id, products.storeId))
    .innerJoin(storeServicePincodes, and(eq(storeServicePincodes.storeId, products.storeId), eq(storeServicePincodes.pincode, parsed.data.pincode)))
    .leftJoin(categories, and(eq(categories.id, products.categoryId), eq(categories.storeId, products.storeId)))
    .where(and(eq(products.id, parsed.data.productId), eq(products.isActive, true), eq(stores.status, "ACTIVE"),
      sql`(${products.categoryId} IS NULL OR ${categories.isActive}=true)`)).limit(1);
  if (!product) throw new HttpError(404, "Product not available for this address");
  const inserted = await getDb().insert(customerSavedItems).values({ customerId, productId: product.id })
    .onConflictDoNothing().returning({ productId: customerSavedItems.productId });
  response.status(inserted.length ? 201 : 200).json({ saved: true, productId: product.id });
}));
customerSavedRouter.delete("/api/customer/saved-items/:productId", requireRole("customer"), asyncHandler(async (request, response) => {
  const parsed = z.string().uuid().safeParse(request.params.productId);
  if (!parsed.success) throw new HttpError(400, "Invalid product ID");
  await getDb().delete(customerSavedItems).where(and(
    eq(customerSavedItems.customerId, owner(request)), eq(customerSavedItems.productId, parsed.data)));
  response.sendStatus(204);
}));
