import { and, asc, eq, inArray, isNull, or } from "drizzle-orm";
import { Router, type Request } from "express";
import {
  customerCatalogQuerySchema,
  customerStoreIdParamSchema,
  customerStoreProductParamSchema,
} from "@workspace/validation";
import {
  categories,
  customerAddresses,
  getDb,
  productVariants,
  products,
  storeOperatingHours,
  storeServicePincodes,
  stores,
} from "@workspace/db";
import { requireRole } from "../auth/index.js";
import type { AuthenticatedRequest } from "../auth/types.js";
import { asyncHandler, HttpError, validationDetails } from "../http.js";
import { operatingStatus } from "./operating-status.js";

export const customerMarketplaceRouter = Router();
const publicStore = {
  id: stores.id, name: stores.name, description: stores.description,
  logoImageUrl: stores.logoImageUrl, phone: stores.phone,
  deliveryFee: stores.deliveryFee, minimumOrderValue: stores.minimumOrderValue,
};
const publicProduct = {
  id: products.id, storeId: products.storeId, categoryId: products.categoryId,
  name: products.name, description: products.description, price: products.price,
  availability: products.availability, imageUrl: products.imageUrl,
};

function customerId(request: Request) {
  const id = (request as AuthenticatedRequest).auth?.userId;
  if (!id) throw new HttpError(401, "Authentication required");
  return id;
}

async function discoveryContext(request: Request) {
  const parsed = customerCatalogQuerySchema.safeParse(request.query);
  if (!parsed.success) throw new HttpError(400, "Invalid discovery query", validationDetails(parsed.error));
  const [address] = await getDb().select({ id: customerAddresses.id }).from(customerAddresses)
    .where(and(eq(customerAddresses.customerId, customerId(request)), eq(customerAddresses.pincode, parsed.data.pincode))).limit(1);
  if (!address) throw new HttpError(404, "No saved customer address uses this pincode");
  return parsed.data;
}

async function visibleStore(storeId: string, pincode: string) {
  const [store] = await getDb().select(publicStore).from(stores)
    .innerJoin(storeServicePincodes, and(eq(storeServicePincodes.storeId, stores.id), eq(storeServicePincodes.pincode, pincode)))
    .where(and(eq(stores.id, storeId), eq(stores.status, "ACTIVE"))).limit(1);
  if (!store) throw new HttpError(404, "Store not available for this pincode");
  return store;
}

async function hoursFor(storeId: string) {
  return getDb().select({
    dayOfWeek: storeOperatingHours.dayOfWeek, opensAt: storeOperatingHours.opensAt,
    closesAt: storeOperatingHours.closesAt, isClosed: storeOperatingHours.isClosed,
  }).from(storeOperatingHours).where(eq(storeOperatingHours.storeId, storeId)).orderBy(asc(storeOperatingHours.dayOfWeek));
}

customerMarketplaceRouter.get("/api/customer/stores", requireRole("customer"), asyncHandler(async (request, response) => {
  const { pincode } = await discoveryContext(request);
  const rows = await getDb().select(publicStore).from(stores)
    .innerJoin(storeServicePincodes, and(eq(storeServicePincodes.storeId, stores.id), eq(storeServicePincodes.pincode, pincode)))
    .where(eq(stores.status, "ACTIVE")).orderBy(asc(stores.name)).limit(100);
  const storeIds = rows.map((store) => store.id);
  const allHours = storeIds.length
    ? await getDb().select({
      storeId: storeOperatingHours.storeId, dayOfWeek: storeOperatingHours.dayOfWeek,
      opensAt: storeOperatingHours.opensAt, closesAt: storeOperatingHours.closesAt,
      isClosed: storeOperatingHours.isClosed,
    }).from(storeOperatingHours).where(inArray(storeOperatingHours.storeId, storeIds))
      .orderBy(asc(storeOperatingHours.dayOfWeek))
    : [];
  const hoursByStore = new Map<string, typeof allHours>();
  for (const hour of allHours) {
    const existing = hoursByStore.get(hour.storeId) ?? [];
    existing.push(hour);
    hoursByStore.set(hour.storeId, existing);
  }
  const results = rows.map((store) => {
    const hours = (hoursByStore.get(store.id) ?? []).map(({ storeId: _storeId, ...hour }) => hour);
    return { ...store, operatingStatus: operatingStatus(hours), operatingHours: hours };
  });
  response.json({ stores: results });
}));

customerMarketplaceRouter.get("/api/customer/stores/:storeId", requireRole("customer"), asyncHandler(async (request, response) => {
  const parsed = customerStoreIdParamSchema.safeParse(request.params);
  if (!parsed.success) throw new HttpError(400, "Invalid store ID", validationDetails(parsed.error));
  const { pincode } = await discoveryContext(request);
  const store = await visibleStore(parsed.data.storeId, pincode);
  const hours = await hoursFor(store.id);
  response.json({ store: { ...store, operatingStatus: operatingStatus(hours), operatingHours: hours } });
}));

customerMarketplaceRouter.get("/api/customer/stores/:storeId/categories", requireRole("customer"), asyncHandler(async (request, response) => {
  const parsed = customerStoreIdParamSchema.safeParse(request.params);
  if (!parsed.success) throw new HttpError(400, "Invalid store ID", validationDetails(parsed.error));
  const { pincode } = await discoveryContext(request);
  await visibleStore(parsed.data.storeId, pincode);
  const list = await getDb().select({ id: categories.id, storeId: categories.storeId, name: categories.name })
     .from(categories).where(and(eq(categories.storeId, parsed.data.storeId), eq(categories.isActive, true))).orderBy(asc(categories.name)).limit(100);
  response.json({ categories: list });
}));

customerMarketplaceRouter.get("/api/customer/stores/:storeId/products", requireRole("customer"), asyncHandler(async (request, response) => {
  const parsed = customerStoreIdParamSchema.safeParse(request.params);
  if (!parsed.success) throw new HttpError(400, "Invalid store ID", validationDetails(parsed.error));
  const query = await discoveryContext(request);
  await visibleStore(parsed.data.storeId, query.pincode);
  if (query.categoryId) {
    const [category] = await getDb().select({ id: categories.id }).from(categories)
      .where(and(eq(categories.id, query.categoryId), eq(categories.storeId, parsed.data.storeId), eq(categories.isActive, true))).limit(1);
    if (!category) throw new HttpError(404, "Category not available in this store");
  }
  const conditions = [
    eq(products.storeId, parsed.data.storeId), eq(products.isActive, true),
    or(isNull(products.categoryId), eq(categories.isActive, true))!,
  ];
  if (query.categoryId) conditions.push(eq(products.categoryId, query.categoryId));
  const list = await getDb().select(publicProduct).from(products)
    .leftJoin(categories, and(eq(categories.id, products.categoryId), eq(categories.storeId, products.storeId)))
   .where(and(...conditions)).orderBy(asc(products.name)).limit(100);
  const variants = list.length
    ? await getDb().select({
      id: productVariants.id, productId: productVariants.productId,
      name: productVariants.name, quantityValue: productVariants.quantityValue,
      quantityUnit: productVariants.quantityUnit, price: productVariants.price,
      stockQuantity: productVariants.stockQuantity, availability: productVariants.availability,
      isActive: productVariants.isActive,
      sku: productVariants.sku, externalCode: productVariants.externalCode,
      sortOrder: productVariants.sortOrder, createdAt: productVariants.createdAt,
      updatedAt: productVariants.updatedAt,
    }).from(productVariants)
      .where(and(inArray(productVariants.productId, list.map((product) => product.id)), eq(productVariants.isActive, true)))
      .orderBy(asc(productVariants.sortOrder), asc(productVariants.createdAt))
    : [];
  const variantsByProduct = new Map<string, typeof variants>();
  for (const variant of variants) {
    const items = variantsByProduct.get(variant.productId) ?? [];
    items.push(variant);
    variantsByProduct.set(variant.productId, items);
  }
  response.json({ products: list.map((product) => ({ ...product, variants: variantsByProduct.get(product.id) ?? [] })) });
}));

customerMarketplaceRouter.get("/api/customer/stores/:storeId/products/:productId", requireRole("customer"), asyncHandler(async (request, response) => {
  const parsed = customerStoreProductParamSchema.safeParse(request.params);
  if (!parsed.success) throw new HttpError(400, "Invalid store or product ID", validationDetails(parsed.error));
  const { pincode } = await discoveryContext(request);
  await visibleStore(parsed.data.storeId, pincode);
  const [product] = await getDb().select(publicProduct).from(products)
    .leftJoin(categories, and(eq(categories.id, products.categoryId), eq(categories.storeId, products.storeId)))
    .where(and(eq(products.id, parsed.data.productId), eq(products.storeId, parsed.data.storeId), eq(products.isActive, true), or(isNull(products.categoryId), eq(categories.isActive, true))!)).limit(1);
  if (!product) throw new HttpError(404, "Product not available in this store");
  const variants = await getDb().select({
    id: productVariants.id, productId: productVariants.productId,
    name: productVariants.name, quantityValue: productVariants.quantityValue,
    quantityUnit: productVariants.quantityUnit, price: productVariants.price,
    stockQuantity: productVariants.stockQuantity, availability: productVariants.availability,
    isActive: productVariants.isActive,
    sku: productVariants.sku, externalCode: productVariants.externalCode,
    sortOrder: productVariants.sortOrder, createdAt: productVariants.createdAt,
    updatedAt: productVariants.updatedAt,
  }).from(productVariants)
    .where(and(eq(productVariants.productId, product.id), eq(productVariants.isActive, true)))
    .orderBy(asc(productVariants.sortOrder), asc(productVariants.createdAt));
  response.json({ product: { ...product, variants } });
}));