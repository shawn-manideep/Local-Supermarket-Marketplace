import { and, asc, eq } from "drizzle-orm";
import { Router, type Request, type Response } from "express";
import {
  categoryCreateSchema,
  categoryIdParamSchema,
  categoryQuerySchema,
  categoryUpdateSchema,
  productAvailabilitySchema,
  productCategorySchema,
  productCreateSchema,
  productIdParamSchema,
  productPriceSchema,
  productStockQuantitySchema,
  productUpdateSchema,
} from "@workspace/validation";
import { categories, getDb, products } from "@workspace/db";
import { requireRole } from "../auth/index.js";
import type { AuthenticatedRequest } from "../auth/types.js";
import { asyncHandler, HttpError, isUniqueViolation, validationDetails } from "../http.js";
import { categoryOwnershipPredicate, productOwnershipPredicate } from "./ownership.js";

export const catalogManagementRouter = Router();

function vendorStoreId(request: Request) {
  const storeId = (request as AuthenticatedRequest).auth?.storeId;
  if (!storeId) throw new HttpError(404, "Vendor store not found");
  return storeId;
}

function sendValidationError(response: Response, error: { issues: unknown }) {
  response.status(400).json({ error: "Validation failed", details: error.issues });
}

function categoryNotFound() {
  return new HttpError(404, "Category not found in vendor store");
}

function productNotFound() {
  return new HttpError(404, "Product not found in vendor store");
}

async function requireCategoryInStore(storeId: string, categoryId: string) {
  const [category] = await getDb()
    .select()
    .from(categories)
    .where(categoryOwnershipPredicate(storeId, categoryId))
    .limit(1);
  if (!category) throw categoryNotFound();
  return category;
}

async function requireProductInStore(storeId: string, productId: string) {
  const [product] = await getDb()
    .select()
    .from(products)
    .where(productOwnershipPredicate(storeId, productId))
    .limit(1);
  if (!product) throw productNotFound();
  return product;
}

function categoryId(request: Request) {
  const parsed = categoryIdParamSchema.safeParse(request.params);
  if (!parsed.success) throw new HttpError(400, "Invalid category ID", validationDetails(parsed.error));
  return parsed.data.categoryId;
}

function productId(request: Request) {
  const parsed = productIdParamSchema.safeParse(request.params);
  if (!parsed.success) throw new HttpError(400, "Invalid product ID", validationDetails(parsed.error));
  return parsed.data.productId;
}

function uniqueError(error: unknown, message: string) {
  if (isUniqueViolation(error)) throw new HttpError(409, message);
  throw error;
}

catalogManagementRouter.get(
  "/api/vendor/categories",
  requireRole("vendor"),
  asyncHandler(async (request, response) => {
    const storeId = vendorStoreId(request);
    const categoryList = await getDb()
      .select()
      .from(categories)
      .where(eq(categories.storeId, storeId))
      .orderBy(asc(categories.name))
      .limit(100);
    response.json({ categories: categoryList });
  }),
);

catalogManagementRouter.get(
  "/api/vendor/categories/:categoryId",
  requireRole("vendor"),
  asyncHandler(async (request, response) => {
    response.json({ category: await requireCategoryInStore(vendorStoreId(request), categoryId(request)) });
  }),
);

catalogManagementRouter.post(
  "/api/vendor/categories",
  requireRole("vendor"),
  asyncHandler(async (request, response) => {
    const parsed = categoryCreateSchema.safeParse(request.body);
    if (!parsed.success) {
      sendValidationError(response, parsed.error);
      return;
    }
    try {
      const [category] = await getDb().insert(categories).values({
        storeId: vendorStoreId(request),
        name: parsed.data.name,
      }).returning();
      response.status(201).json({ category });
    } catch (error) {
      uniqueError(error, "A category with that name already exists in this store");
    }
  }),
);

catalogManagementRouter.patch(
  "/api/vendor/categories/:categoryId",
  requireRole("vendor"),
  asyncHandler(async (request, response) => {
    const parsed = categoryUpdateSchema.safeParse(request.body);
    if (!parsed.success) {
      sendValidationError(response, parsed.error);
      return;
    }
    const storeId = vendorStoreId(request);
    await requireCategoryInStore(storeId, categoryId(request));
    try {
      const [category] = await getDb().update(categories)
        .set({ name: parsed.data.name, updatedAt: new Date() })
        .where(categoryOwnershipPredicate(storeId, categoryId(request)))
        .returning();
      response.json({ category });
    } catch (error) {
      uniqueError(error, "A category with that name already exists in this store");
    }
  }),
);

async function setCategoryActive(request: Request, response: Response, isActive: boolean) {
  const storeId = vendorStoreId(request);
  const [category] = await getDb().update(categories)
    .set({ isActive, updatedAt: new Date() })
    .where(categoryOwnershipPredicate(storeId, categoryId(request)))
    .returning();
  if (!category) throw categoryNotFound();
  response.json({ category });
}

catalogManagementRouter.post("/api/vendor/categories/:categoryId/activate", requireRole("vendor"), asyncHandler((request, response) => setCategoryActive(request, response, true)));
catalogManagementRouter.post("/api/vendor/categories/:categoryId/deactivate", requireRole("vendor"), asyncHandler((request, response) => setCategoryActive(request, response, false)));

catalogManagementRouter.get(
  "/api/vendor/products",
  requireRole("vendor"),
  asyncHandler(async (request, response) => {
    const parsed = categoryQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      sendValidationError(response, parsed.error);
      return;
    }
    const storeId = vendorStoreId(request);
    const conditions = [eq(products.storeId, storeId)];
    if (parsed.data.categoryId) {
      await requireCategoryInStore(storeId, parsed.data.categoryId);
      conditions.push(eq(products.categoryId, parsed.data.categoryId));
    }
    const productList = await getDb().select().from(products).where(and(...conditions)).orderBy(asc(products.name)).limit(100);
    response.json({ products: productList });
  }),
);

catalogManagementRouter.get(
  "/api/vendor/products/:productId",
  requireRole("vendor"),
  asyncHandler(async (request, response) => {
    response.json({ product: await requireProductInStore(vendorStoreId(request), productId(request)) });
  }),
);

catalogManagementRouter.post(
  "/api/vendor/products",
  requireRole("vendor"),
  asyncHandler(async (request, response) => {
    const parsed = productCreateSchema.safeParse(request.body);
    if (!parsed.success) {
      sendValidationError(response, parsed.error);
      return;
    }
    const storeId = vendorStoreId(request);
    if (parsed.data.categoryId) await requireCategoryInStore(storeId, parsed.data.categoryId);
    try {
      const [product] = await getDb().insert(products).values({
        storeId,
        categoryId: parsed.data.categoryId ?? null,
        name: parsed.data.name,
        description: parsed.data.description ?? null,
        sku: parsed.data.sku ?? null,
        externalCode: parsed.data.externalCode ?? null,
        price: parsed.data.price.toFixed(2),
        availability: parsed.data.availability ?? true,
        stockQuantity: parsed.data.stockQuantity ?? 0,
        imageUrl: parsed.data.imageUrl ?? null,
      }).returning();
      response.status(201).json({ product });
    } catch (error) {
      uniqueError(error, "That SKU or external code already exists in this store");
    }
  }),
);

catalogManagementRouter.patch(
  "/api/vendor/products/:productId",
  requireRole("vendor"),
  asyncHandler(async (request, response) => {
    const parsed = productUpdateSchema.safeParse(request.body);
    if (!parsed.success) {
      sendValidationError(response, parsed.error);
      return;
    }
    const storeId = vendorStoreId(request);
    const id = productId(request);
    await requireProductInStore(storeId, id);
    if (parsed.data.categoryId) await requireCategoryInStore(storeId, parsed.data.categoryId);
    const { price, ...otherUpdates } = parsed.data;
    const updates = {
      ...otherUpdates,
      ...(price === undefined ? {} : { price: price.toFixed(2) }),
      updatedAt: new Date(),
    };
    try {
      const [product] = await getDb().update(products).set(updates).where(productOwnershipPredicate(storeId, id)).returning();
      response.json({ product });
    } catch (error) {
      uniqueError(error, "That SKU or external code already exists in this store");
    }
  }),
);

async function setProductActive(request: Request, response: Response, isActive: boolean) {
  const storeId = vendorStoreId(request);
  const [product] = await getDb().update(products)
    .set({ isActive, updatedAt: new Date() })
    .where(productOwnershipPredicate(storeId, productId(request)))
    .returning();
  if (!product) throw productNotFound();
  response.json({ product });
}

catalogManagementRouter.post("/api/vendor/products/:productId/activate", requireRole("vendor"), asyncHandler((request, response) => setProductActive(request, response, true)));
catalogManagementRouter.post("/api/vendor/products/:productId/deactivate", requireRole("vendor"), asyncHandler((request, response) => setProductActive(request, response, false)));

async function updateProductField<T extends Record<string, unknown>>(
  request: Request,
  response: Response,
  schema: { safeParse: (value: unknown) => { success: boolean; data?: T; error?: { issues: unknown } } },
  field: keyof T,
) {
  const parsed = schema.safeParse(request.body);
  if (!parsed.success) {
    sendValidationError(response, parsed.error!);
    return;
  }
  const [product] = await getDb().update(products)
    .set({ [field]: parsed.data![field], updatedAt: new Date() })
    .where(productOwnershipPredicate(vendorStoreId(request), productId(request)))
    .returning();
  if (!product) throw productNotFound();
  response.json({ product });
}

catalogManagementRouter.patch("/api/vendor/products/:productId/availability", requireRole("vendor"), asyncHandler((request, response) => updateProductField(request, response, productAvailabilitySchema, "availability")));
catalogManagementRouter.patch("/api/vendor/products/:productId/price", requireRole("vendor"), asyncHandler(async (request, response) => {
  const parsed = productPriceSchema.safeParse(request.body);
  if (!parsed.success) { sendValidationError(response, parsed.error); return; }
  const [product] = await getDb().update(products).set({ price: parsed.data.price.toFixed(2), updatedAt: new Date() }).where(productOwnershipPredicate(vendorStoreId(request), productId(request))).returning();
  if (!product) throw productNotFound();
  response.json({ product });
}));
catalogManagementRouter.patch("/api/vendor/products/:productId/stock-quantity", requireRole("vendor"), asyncHandler((request, response) => updateProductField(request, response, productStockQuantitySchema, "stockQuantity")));
catalogManagementRouter.patch("/api/vendor/products/:productId/category", requireRole("vendor"), asyncHandler(async (request, response) => {
  const parsed = productCategorySchema.safeParse(request.body);
  if (!parsed.success) { sendValidationError(response, parsed.error); return; }
  const storeId = vendorStoreId(request);
  if (parsed.data.categoryId) await requireCategoryInStore(storeId, parsed.data.categoryId);
  const [product] = await getDb().update(products).set({ categoryId: parsed.data.categoryId, updatedAt: new Date() }).where(productOwnershipPredicate(storeId, productId(request))).returning();
  if (!product) throw productNotFound();
  response.json({ product });
}));