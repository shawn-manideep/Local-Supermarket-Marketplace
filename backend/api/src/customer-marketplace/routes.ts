import { and, asc, count, eq, ilike, inArray, isNull, or, sql } from "drizzle-orm";
import { Router, type Request } from "express";
import { z } from "zod";
import {
  customerStoreIdParamSchema,
  customerStoreProductParamSchema,
} from "@workspace/validation";
import {
  categories,
  customerAddresses,
  getDb,
  masterProducts,
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
  masterProductId: products.masterProductId,
  name: sql<string>`coalesce(${masterProducts.name}, ${products.name})`.as("name"),
  description: sql<string | null>`coalesce(${products.description}, ${masterProducts.description})`.as("description"),
  price: products.price, availability: products.availability,
  imageUrl: sql<string | null>`coalesce(${products.imageUrl}, ${masterProducts.image})`.as("imageUrl"),
  brand: masterProducts.brand, categoryName: categories.name,
};
export const customerProductQuerySchema = z.object({
  pincode: z.string().trim().regex(/^[1-9]\d{5}$/, "Use a valid six-digit Indian pincode"),
  search: z.string().trim().max(120).optional(),
  categoryId: z.string().uuid().optional(),
  page: z.coerce.number().int().min(1).max(100_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(24),
}).strict();

const customerVariantFields = {
  id: productVariants.id, productId: productVariants.productId,
  name: productVariants.name, quantityValue: productVariants.quantityValue,
  quantityUnit: productVariants.quantityUnit, price: productVariants.price,
  availability: productVariants.availability, isActive: productVariants.isActive,
  sortOrder: productVariants.sortOrder,
  purchasable: sql<boolean>`${productVariants.isActive} = true AND ${productVariants.availability} = true AND ${productVariants.stockQuantity} > 0`,
};

type PublicProduct = {
  id: string;
  storeId: string;
  categoryId: string | null;
  masterProductId: string | null;
  name: string;
  description: string | null;
  price: string;
  availability: boolean;
  imageUrl: string | null;
  brand: string | null;
  categoryName: string | null;
};
type PublicVariant = {
  id: string;
  productId: string;
  name: string;
  quantityValue: string;
  quantityUnit: string;
  price: string;
  availability: boolean;
  isActive: boolean;
  sortOrder: number;
  purchasable: boolean;
};

function customerId(request: Request) {
  const id = (request as AuthenticatedRequest).auth?.userId;
  if (!id) throw new HttpError(401, "Authentication required");
  return id;
}

async function discoveryContext(request: Request) {
  const parsed = customerProductQuerySchema.safeParse(request.query);
  if (!parsed.success) throw new HttpError(400, "Invalid discovery query", validationDetails(parsed.error));
  const [address] = await getDb().select({ id: customerAddresses.id }).from(customerAddresses)
    .where(and(eq(customerAddresses.customerId, customerId(request)), eq(customerAddresses.pincode, parsed.data.pincode))).limit(1);
  if (!address) throw new HttpError(404, "No saved customer address uses this pincode");
  return parsed.data;
}

function searchPattern(search: string | undefined) {
  if (!search) return undefined;
  return `%${search.replace(/[\\%_]/g, "\\$&")}%`;
}

async function customerVariantsFor(productIds: string[]) {
  if (!productIds.length) return [] as PublicVariant[];
  const variants = await getDb().select(customerVariantFields).from(productVariants)
    .where(and(inArray(productVariants.productId, productIds), eq(productVariants.isActive, true)))
    .orderBy(asc(productVariants.sortOrder), asc(productVariants.createdAt));
  return variants as PublicVariant[];
}

function addCustomerVariants<T extends PublicProduct>(list: T[], variants: PublicVariant[]) {
  const variantsByProduct = new Map<string, PublicVariant[]>();
  for (const variant of variants) {
    const items = variantsByProduct.get(variant.productId) ?? [];
    items.push(variant);
    variantsByProduct.set(variant.productId, items);
  }
  return list.map((product) => {
    const productVariants = variantsByProduct.get(product.id) ?? [];
    return {
      ...product,
      purchasable: product.availability && productVariants.some((variant) => variant.purchasable),
      variants: productVariants,
    };
  });
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
  const pattern = searchPattern(query.search);
  if (pattern) conditions.push(or(
    ilike(masterProducts.name, pattern),
    ilike(products.name, pattern),
    ilike(masterProducts.brand, pattern),
    ilike(categories.name, pattern),
    sql`${masterProducts.attributes}::text ILIKE ${pattern}`,
  )!);
  const db = getDb();
  const [countResult] = await db.select({ total: count() }).from(products)
    .leftJoin(categories, and(eq(categories.id, products.categoryId), eq(categories.storeId, products.storeId)))
    .leftJoin(masterProducts, eq(masterProducts.id, products.masterProductId))
    .where(and(...conditions));
  const list = await db.select(publicProduct).from(products)
    .leftJoin(categories, and(eq(categories.id, products.categoryId), eq(categories.storeId, products.storeId)))
    .leftJoin(masterProducts, eq(masterProducts.id, products.masterProductId))
    .where(and(...conditions))
    .orderBy(asc(sql<string>`coalesce(${masterProducts.name}, ${products.name})`))
    .limit(query.pageSize)
    .offset((query.page - 1) * query.pageSize);
  const variants = await customerVariantsFor(list.map((item) => item.id));
  response.json({
    products: addCustomerVariants(list as PublicProduct[], variants),
    pagination: { page: query.page, pageSize: query.pageSize, total: countResult?.total ?? 0 },
  });
}));

customerMarketplaceRouter.get("/api/customer/products", requireRole("customer"), asyncHandler(async (request, response) => {
  const query = await discoveryContext(request);
  const conditions = [
    eq(products.isActive, true),
    eq(stores.status, "ACTIVE"),
    eq(storeServicePincodes.pincode, query.pincode),
    or(isNull(products.categoryId), eq(categories.isActive, true))!,
  ];
  if (query.categoryId) conditions.push(or(
    eq(products.categoryId, query.categoryId),
    eq(categories.masterCategoryId, query.categoryId),
    eq(masterProducts.masterCategoryId, query.categoryId),
  )!);
  const pattern = searchPattern(query.search);
  if (pattern) conditions.push(or(
    ilike(masterProducts.name, pattern),
    ilike(products.name, pattern),
    ilike(masterProducts.brand, pattern),
    ilike(categories.name, pattern),
    sql`${masterProducts.attributes}::text ILIKE ${pattern}`,
  )!);
  const db = getDb();
  const [countResult] = await db.select({ total: count() }).from(products)
    .innerJoin(stores, eq(stores.id, products.storeId))
    .innerJoin(storeServicePincodes, eq(storeServicePincodes.storeId, stores.id))
    .leftJoin(categories, and(eq(categories.id, products.categoryId), eq(categories.storeId, products.storeId)))
    .leftJoin(masterProducts, eq(masterProducts.id, products.masterProductId))
    .where(and(...conditions));
  const list = await db.select({
    ...publicProduct,
    storeName: stores.name,
  }).from(products)
    .innerJoin(stores, eq(stores.id, products.storeId))
    .innerJoin(storeServicePincodes, eq(storeServicePincodes.storeId, stores.id))
    .leftJoin(categories, and(eq(categories.id, products.categoryId), eq(categories.storeId, products.storeId)))
    .leftJoin(masterProducts, eq(masterProducts.id, products.masterProductId))
    .where(and(...conditions))
    .orderBy(asc(sql<string>`coalesce(${masterProducts.name}, ${products.name})`), asc(stores.name))
    .limit(query.pageSize)
    .offset((query.page - 1) * query.pageSize);
  const variants = await customerVariantsFor(list.map((item) => item.id));
  response.json({
    products: addCustomerVariants(list as PublicProduct[], variants).map((item, index) => ({
      ...item,
      storeName: list[index].storeName,
    })),
    pagination: { page: query.page, pageSize: query.pageSize, total: countResult?.total ?? 0 },
  });
}));

customerMarketplaceRouter.get("/api/customer/stores/:storeId/products/:productId", requireRole("customer"), asyncHandler(async (request, response) => {
  const parsed = customerStoreProductParamSchema.safeParse(request.params);
  if (!parsed.success) throw new HttpError(400, "Invalid store or product ID", validationDetails(parsed.error));
  const { pincode } = await discoveryContext(request);
  await visibleStore(parsed.data.storeId, pincode);
  const [product] = await getDb().select(publicProduct).from(products)
    .leftJoin(categories, and(eq(categories.id, products.categoryId), eq(categories.storeId, products.storeId)))
    .leftJoin(masterProducts, eq(masterProducts.id, products.masterProductId))
    .where(and(eq(products.id, parsed.data.productId), eq(products.storeId, parsed.data.storeId), eq(products.isActive, true), or(isNull(products.categoryId), eq(categories.isActive, true))!)).limit(1);
  if (!product) throw new HttpError(404, "Product not available in this store");
  const variants = await customerVariantsFor([product.id]);
  response.json({ product: addCustomerVariants([product as PublicProduct], variants)[0] });
}));