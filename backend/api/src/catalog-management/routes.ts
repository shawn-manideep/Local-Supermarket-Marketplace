import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { Router, type Request, type Response } from "express";
import { assertOwnProductImage } from "../product-images/validation.js";
import {
  categoryCreateSchema,
  categoryIdParamSchema,
  categoryQuerySchema,
  categoryUpdateSchema,
  productAvailabilitySchema,
  productCategorySchema,
  productIdParamSchema,
  productPriceSchema,
  productStockQuantitySchema,
  productVariantCreateSchema,
  productVariantBatchUpdateSchema,
  productVariantIdParamSchema,
  productVariantUpdateSchema,
  productUpdateSchema,
  formatVariantName,
  sortVariantsForDisplay,
} from "@workspace/validation";
import { categories, getDb, masterProducts, productVariants, products } from "@workspace/db";
import { requireRole } from "../auth/index.js";
import type { AuthenticatedRequest } from "../auth/types.js";
import { asyncHandler, HttpError, isUniqueViolation, validationDetails } from "../http.js";
import { withMasterCatalogWriteLock } from "../master-catalog/duplicate-review.js";
import { categoryOwnershipPredicate, productOwnershipPredicate } from "./ownership.js";
import { requireCatalogDocuments } from "../vendor-documents/service.js";

export const catalogManagementRouter = Router();
catalogManagementRouter.use(["/api/vendor/products", "/api/vendor/categories"], (request, response, next) => {
  // There are deliberately no hard-delete endpoints. Preserve their 404
  // behavior, and gate every supported catalog mutation including child routes.
  if (!["POST", "PATCH", "PUT"].includes(request.method)) { next(); return; }
  requireRole("vendor")(request, response, error => {
    if (error) { next(error); return; }
    requireCatalogDocuments(request, response, next);
  });
});
catalogManagementRouter.get("/api/vendor/product-matches", requireRole("vendor"), asyncHandler(async (request, response) => {
  const { localProductMatches } = await import("./local-products.js");
  const name = typeof request.query.name === "string" ? request.query.name.trim() : "";
  const brand = typeof request.query.brand === "string" ? request.query.brand.trim() : null;
  const categoryId = typeof request.query.categoryId === "string" && request.query.categoryId ? request.query.categoryId : null;
  if (!name || name.length > 200 || (brand?.length ?? 0) > 200 ||
      (categoryId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(categoryId))) throw new HttpError(400, "Invalid product identity");
  response.json({ matches: await localProductMatches(vendorStoreId(request), name, brand, categoryId) });
}));

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

export async function updateOwnedProductAndChildren<T>(
  updateOwnedProduct: () => Promise<T | undefined>,
  updateChildren: () => Promise<void>,
) {
  const product = await updateOwnedProduct();
  if (!product) throw productNotFound();
  await updateChildren();
  return product;
}

export function ensureBatchVariantIdsBelongToProduct(
  submittedIds: readonly string[],
  existingIds: readonly string[],
) {
  const ownedIds = new Set(existingIds);
  if (submittedIds.some((id) => !ownedIds.has(id))) {
    throw new HttpError(404, "Variant not found in vendor product");
  }
}

export function ensureBatchVariantExpectedVersionsCurrent(
  variants: readonly { id?: string; expectedUpdatedAt?: string }[],
  existingById: ReadonlyMap<string, { updatedAt: Date }>,
) {
  for (const variant of variants) {
    if (!variant.id || variant.expectedUpdatedAt === undefined) continue;
    const existing = existingById.get(variant.id);
    if (!existing) throw new HttpError(404, "Variant not found in vendor product");
    if (Date.parse(variant.expectedUpdatedAt) !== existing.updatedAt.getTime()) {
      throw new HttpError(409, "Catalog changed. Refresh the catalog and try again.");
    }
  }
}

export function ensurePublishedBatchVariantsHavePositivePrices(
  variants: readonly { id?: string; isActive?: boolean; price: number }[],
  existingById: ReadonlyMap<string, { isActive: boolean }>,
  mustRemainPurchasable: boolean,
) {
  if (!mustRemainPurchasable) return;
  for (const variant of variants) {
    const isActive = variant.isActive ?? (variant.id ? existingById.get(variant.id)?.isActive : undefined) ?? true;
    if (isActive && variant.price <= 0) {
      throw new HttpError(400, "Active selling variants need a price greater than zero");
    }
  }
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

async function variantsForProducts(productIds: string[], activeOnly = false) {
  if (!productIds.length) return new Map<string, (typeof productVariants.$inferSelect)[]>();
  const conditions = [inArray(productVariants.productId, productIds)];
  if (activeOnly) conditions.push(eq(productVariants.isActive, true));
  const rows = await getDb().select().from(productVariants).where(and(...conditions))
    .orderBy(asc(productVariants.sortOrder), asc(productVariants.createdAt));
  const byProduct = new Map<string, typeof rows>();
  for (const variant of rows) {
    const existing = byProduct.get(variant.productId) ?? [];
    existing.push(variant);
    byProduct.set(variant.productId, existing);
  }
  return byProduct;
}

function productWithMasterFallback(
  product: typeof products.$inferSelect,
  master: typeof masterProducts.$inferSelect | undefined,
) {
  if (!master) return { ...product, brand: product.brand };
  return {
    ...product,
    name: master.name,
    description: product.description ?? master.description,
    imageUrl: product.imageUrl ?? master.image,
    descriptionOverride: product.description,
    imageOverride: product.imageUrl,
    brand: master.brand,
    masterCategoryId: master.masterCategoryId,
    attributes: master.attributes,
  };
}

async function productWithVariants(product: typeof products.$inferSelect) {
  const byProduct = await variantsForProducts([product.id]);
  const [master] = product.masterProductId
    ? await getDb().select().from(masterProducts).where(eq(masterProducts.id, product.masterProductId)).limit(1)
    : [];
  return { ...productWithMasterFallback(product, master), variants: byProduct.get(product.id) ?? [] };
}

async function applyProductVariantDisplayOrder(
  transaction: { select: (...args: any[]) => any; update: (...args: any[]) => any },
  productId: string,
) {
  const variants: (typeof productVariants.$inferSelect)[] = await transaction.select().from(productVariants)
    .where(eq(productVariants.productId, productId));
  const ordered = sortVariantsForDisplay(variants);
  for (const [sortOrder, variant] of ordered.entries()) {
    if (variant.sortOrder !== sortOrder) {
      await transaction.update(productVariants).set({ sortOrder, updatedAt: new Date() })
        .where(and(
          eq(productVariants.id, variant.id),
          eq(productVariants.productId, productId),
        ));
    }
  }
}

async function assertProductCanBeActivated(
  transaction: { select: (...args: any[]) => any },
  storeId: string,
  product: typeof products.$inferSelect,
) {
  if (!product.masterProductId) return;
  const activeVariants = await transaction.select({
    id: productVariants.id,
    quantityValue: productVariants.quantityValue,
    price: productVariants.price,
  })
    .from(productVariants)
    .where(and(
      eq(productVariants.productId, product.id),
      eq(productVariants.isActive, true),
    ));
  const configuredVariants = activeVariants.filter((variant: { quantityValue: string; price: string }) =>
    Number(variant.quantityValue) > 0 && Number(variant.price) > 0);
  if (!configuredVariants.length) {
    throw new HttpError(409, "Configure at least one active selling variant with a price before activating this listing");
  }
  if (configuredVariants.length !== activeVariants.length) {
    throw new HttpError(409, "Every active selling variant needs a valid quantity and price before publishing");
  }
  const [duplicate] = await transaction.select({ id: products.id }).from(products)
    .where(and(
      eq(products.storeId, storeId),
      eq(products.masterProductId, product.masterProductId),
      eq(products.isActive, true),
      sql`${products.id} <> ${product.id}`,
    )).limit(1);
  if (duplicate) {
    throw new HttpError(409, "Another active listing for this Master Product already exists in this store");
  }
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
    const byProduct = await variantsForProducts(productList.map((product) => product.id));
    const linkedIds = productList.flatMap((product) => product.masterProductId ? [product.masterProductId] : []);
    const masters = linkedIds.length
      ? await getDb().select().from(masterProducts).where(inArray(masterProducts.id, linkedIds))
      : [];
    const masterById = new Map(masters.map((master) => [master.id, master]));
    response.json({
      products: productList.map((product) => ({
        ...productWithMasterFallback(product, masterById.get(product.masterProductId ?? "")),
        variants: byProduct.get(product.id) ?? [],
      })),
    });
  }),
);

catalogManagementRouter.get(
  "/api/vendor/products/:productId",
  requireRole("vendor"),
  asyncHandler(async (request, response) => {
    response.json({ product: await productWithVariants(await requireProductInStore(vendorStoreId(request), productId(request))) });
  }),
);

catalogManagementRouter.post(
  "/api/vendor/products",
  requireRole("vendor"),
  asyncHandler(async (request, response) => {
    const { createLocalProduct } = await import("./local-products.js");
    const product = await createLocalProduct(vendorStoreId(request), request.body);
    response.status(201).json({ product: await productWithVariants(product) });
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
    const { price, ...otherUpdates } = parsed.data;
    assertOwnProductImage(parsed.data.imageUrl, storeId);
    const updates = {
      ...otherUpdates,
      ...(price === undefined ? {} : { price: price.toFixed(2) }),
      updatedAt: new Date(),
    };
    try {
      const product = await getDb().transaction(async (transaction) =>
        withMasterCatalogWriteLock(transaction, async () => {
          const [existing] = await transaction.select().from(products)
            .where(productOwnershipPredicate(storeId, id)).limit(1);
          if (!existing) throw productNotFound();
          if (existing.masterProductId && parsed.data.name !== undefined) {
            const [master] = await transaction.select({ name: masterProducts.name })
              .from(masterProducts).where(eq(masterProducts.id, existing.masterProductId)).limit(1);
            if (parsed.data.name !== master?.name) {
              throw new HttpError(409, "The name of a Master Catalog product is canonical and cannot be changed by a vendor");
            }
          }
          const existingVariants = await transaction.select().from(productVariants)
            .where(eq(productVariants.productId, id));
          if (
            existing.isActive &&
            price !== undefined &&
            price <= 0 &&
            existingVariants.some((variant) => variant.isActive)
          ) {
            throw new HttpError(400, "Active selling variants need a price greater than zero");
          }
          if ((price !== undefined || parsed.data.stockQuantity !== undefined) && existingVariants.length > 1) {
            throw new HttpError(409, "Update price and stock on individual variants when a product has multiple active variants");
          }
          if (parsed.data.categoryId) {
            const [category] = await transaction.select().from(categories)
              .where(categoryOwnershipPredicate(storeId, parsed.data.categoryId)).limit(1);
            if (!category) throw categoryNotFound();
          }
          const [updated] = await transaction.update(products).set(updates)
            .where(productOwnershipPredicate(storeId, id)).returning();
          if (existingVariants.length === 1 && (price !== undefined || parsed.data.stockQuantity !== undefined)) {
            await transaction.update(productVariants).set({
              ...(price === undefined ? {} : { price: price.toFixed(2) }),
              ...(parsed.data.stockQuantity === undefined ? {} : { stockQuantity: parsed.data.stockQuantity }),
              updatedAt: new Date(),
            }).where(eq(productVariants.id, existingVariants[0].id));
          }
          return updated;
        }),
      );
      response.json({ product: await productWithVariants(product) });
    } catch (error) {
      uniqueError(error, "That SKU or external code already exists in this store");
    }
  }),
);

catalogManagementRouter.put(
  "/api/vendor/products/:productId/variants/batch",
  requireRole("vendor"),
  asyncHandler(async (request, response) => {
    const parsed = productVariantBatchUpdateSchema.safeParse(request.body);
    if (!parsed.success) {
      sendValidationError(response, parsed.error);
      return;
    }
    const id = productId(request);
    const storeId = vendorStoreId(request);
    try {
      const product = await getDb().transaction(async (transaction) =>
        withMasterCatalogWriteLock(transaction, async () => {
          const [ownedProduct] = await transaction.select().from(products)
            .where(productOwnershipPredicate(storeId, id)).limit(1);
          if (!ownedProduct) throw productNotFound();
          const existingVariants = await transaction.select().from(productVariants)
            .where(eq(productVariants.productId, id)).for("update");
          const existingById = new Map(existingVariants.map((variant) => [variant.id, variant]));
          ensureBatchVariantIdsBelongToProduct(
            parsed.data.variants.flatMap((variant) => variant.id ? [variant.id] : []),
            existingVariants.map((variant) => variant.id),
          );
          ensureBatchVariantExpectedVersionsCurrent(parsed.data.variants, existingById);

          ensurePublishedBatchVariantsHavePositivePrices(
            parsed.data.variants,
            existingById,
            parsed.data.publish === true || ownedProduct.isActive,
          );

          for (const [variantIndex, variant] of parsed.data.variants.entries()) {
            const existing = variant.id ? existingById.get(variant.id) : undefined;
            const commonValues = {
              ...(!existing ||
                Number(existing.quantityValue) !== Number(variant.quantityValue) ||
                existing.quantityUnit !== variant.quantityUnit
                ? { name: formatVariantName(variant.quantityValue, variant.quantityUnit) }
                : {}),
              quantityValue: Number(variant.quantityValue).toFixed(3),
              quantityUnit: variant.quantityUnit,
              price: variant.price.toFixed(2),
              stockQuantity: variant.stockQuantity,
              availability: variant.availability,
              ...(variant.isActive === undefined
                ? (existing ? {} : { isActive: true })
                : { isActive: variant.isActive }),
              ...(variant.sku === undefined ? {} : { sku: variant.sku }),
              ...(variant.externalCode === undefined ? {} : { externalCode: variant.externalCode }),
              updatedAt: new Date(),
            };
            if (existing) {
              await transaction.update(productVariants).set(commonValues)
                .where(and(
                  eq(productVariants.id, existing.id),
                  eq(productVariants.productId, id),
                ));
            } else {
              await transaction.insert(productVariants).values({
                ...commonValues,
                name: formatVariantName(variant.quantityValue, variant.quantityUnit),
                productId: id,
                sku: variant.sku ?? null,
                externalCode: variant.externalCode ?? null,
                sortOrder: existingVariants.length + variantIndex,
              });
            }
          }

          await applyProductVariantDisplayOrder(transaction, id);
          if (parsed.data.publish) {
            await assertProductCanBeActivated(transaction, storeId, ownedProduct);
            const [published] = await transaction.update(products).set({
              isActive: true,
              availability: true,
              updatedAt: new Date(),
            }).where(productOwnershipPredicate(storeId, id)).returning();
            return published;
          }
          return ownedProduct;
        }),
      );
      response.json({ product: await productWithVariants(product) });
    } catch (error) {
      uniqueError(error, "That SKU or external code already exists for this product");
    }
  }),
);

catalogManagementRouter.post(
  "/api/vendor/products/:productId/variants",
  requireRole("vendor"),
  asyncHandler(async (request, response) => {
    const parsed = productVariantCreateSchema.safeParse(request.body);
    if (!parsed.success) {
      sendValidationError(response, parsed.error);
      return;
    }
    const id = productId(request);
    const storeId = vendorStoreId(request);
    try {
      const variant = await getDb().transaction(async (transaction) =>
        withMasterCatalogWriteLock(transaction, async () => {
          const [product] = await transaction.select().from(products)
            .where(productOwnershipPredicate(storeId, id)).limit(1);
          if (!product) throw productNotFound();
          if (product.isActive && parsed.data.isActive && parsed.data.price <= 0) {
            throw new HttpError(400, "Active selling variants need a price greater than zero");
          }
          const existingVariants = await transaction.select({ id: productVariants.id })
            .from(productVariants).where(eq(productVariants.productId, id));
          const [created] = await transaction.insert(productVariants).values({
            ...parsed.data,
            name: formatVariantName(parsed.data.quantityValue, parsed.data.quantityUnit),
            productId: id,
            quantityValue: Number(parsed.data.quantityValue).toFixed(3),
            price: parsed.data.price.toFixed(2),
            sortOrder: existingVariants.length,
          }).returning();
          await applyProductVariantDisplayOrder(transaction, id);
          const [orderedVariant] = await transaction.select().from(productVariants)
            .where(and(eq(productVariants.id, created.id), eq(productVariants.productId, id))).limit(1);
          return orderedVariant;
        }),
      );
      response.status(201).json({ variant });
    } catch (error) {
      uniqueError(error, "That SKU or external code already exists for this product");
    }
  }),
);

catalogManagementRouter.patch(
  "/api/vendor/products/:productId/variants/:variantId",
  requireRole("vendor"),
  asyncHandler(async (request, response) => {
    const params = productVariantIdParamSchema.safeParse(request.params);
    if (!params.success) throw new HttpError(400, "Invalid product or variant ID", validationDetails(params.error));
    const parsed = productVariantUpdateSchema.safeParse(request.body);
    if (!parsed.success) {
      sendValidationError(response, parsed.error);
      return;
    }
    const storeId = vendorStoreId(request);
    const {
      price,
      quantityValue,
      name: _ignoredName,
      sortOrder: _ignoredSortOrder,
      ...otherUpdates
    } = parsed.data;
    try {
      const variant = await getDb().transaction(async (transaction) =>
        withMasterCatalogWriteLock(transaction, async () => {
          const [product] = await transaction.select().from(products)
            .where(productOwnershipPredicate(storeId, params.data.productId)).limit(1);
          if (!product) throw productNotFound();
          const [existing] = await transaction.select().from(productVariants)
            .where(and(
              eq(productVariants.id, params.data.variantId),
              eq(productVariants.productId, params.data.productId),
            )).limit(1);
          if (!existing) throw new HttpError(404, "Variant not found in vendor product");
          const quantityOrUnitChanged = quantityValue !== undefined || parsed.data.quantityUnit !== undefined;
          const nextQuantity = quantityValue ?? existing.quantityValue;
          const nextUnit = parsed.data.quantityUnit ?? existing.quantityUnit;
          const nextActive = parsed.data.isActive ?? existing.isActive;
          const nextPrice = price ?? Number(existing.price);
          if (product.isActive && nextActive && nextPrice <= 0) {
            throw new HttpError(400, "Active selling variants need a price greater than zero");
          }
          const [updated] = await transaction.update(productVariants).set({
            ...otherUpdates,
            ...(price === undefined ? {} : { price: price.toFixed(2) }),
            ...(quantityValue === undefined ? {} : { quantityValue: Number(quantityValue).toFixed(3) }),
            ...(quantityOrUnitChanged ? { name: formatVariantName(nextQuantity, nextUnit) } : {}),
            updatedAt: new Date(),
          }).where(and(
            eq(productVariants.id, params.data.variantId),
            eq(productVariants.productId, params.data.productId),
          )).returning();
          if (quantityOrUnitChanged) {
            await applyProductVariantDisplayOrder(transaction, params.data.productId);
            const [orderedVariant] = await transaction.select().from(productVariants)
              .where(and(
                eq(productVariants.id, updated.id),
                eq(productVariants.productId, params.data.productId),
              )).limit(1);
            return orderedVariant;
          }
          return updated;
        }),
      );
      response.json({ variant });
    } catch (error) {
      uniqueError(error, "That SKU or external code already exists for this product");
    }
  }),
);

async function setVariantActive(request: Request, response: Response, isActive: boolean) {
  const parsed = productVariantIdParamSchema.safeParse(request.params);
  if (!parsed.success) throw new HttpError(400, "Invalid product or variant ID", validationDetails(parsed.error));
  const storeId = vendorStoreId(request);
  const variant = await getDb().transaction(async (transaction) =>
    withMasterCatalogWriteLock(transaction, async () => {
      const [product] = await transaction.select().from(products)
        .where(productOwnershipPredicate(storeId, parsed.data.productId)).limit(1);
      if (!product) throw productNotFound();
      if (isActive && product.isActive) {
        const [existing] = await transaction.select({
          id: productVariants.id,
          quantityValue: productVariants.quantityValue,
          price: productVariants.price,
        }).from(productVariants)
          .where(and(
            eq(productVariants.id, parsed.data.variantId),
            eq(productVariants.productId, parsed.data.productId),
          )).limit(1);
        if (!existing) throw new HttpError(404, "Variant not found in vendor product");
        if (Number(existing.quantityValue) <= 0 || Number(existing.price) <= 0) {
          throw new HttpError(409, "Configure a valid quantity and positive price before activating this variant");
        }
      }
      const [updated] = await transaction.update(productVariants)
        .set({ isActive, updatedAt: new Date() })
        .where(and(
          eq(productVariants.id, parsed.data.variantId),
          eq(productVariants.productId, parsed.data.productId),
        )).returning();
      if (!updated) throw new HttpError(404, "Variant not found in vendor product");
      return updated;
    }),
  );
  response.json({ variant });
}

catalogManagementRouter.post(
  "/api/vendor/products/:productId/variants/:variantId/activate",
  requireRole("vendor"),
  asyncHandler((request, response) => setVariantActive(request, response, true)),
);
catalogManagementRouter.post(
  "/api/vendor/products/:productId/variants/:variantId/deactivate",
  requireRole("vendor"),
  asyncHandler((request, response) => setVariantActive(request, response, false)),
);

async function setProductActive(request: Request, response: Response, isActive: boolean) {
  const storeId = vendorStoreId(request);
  const id = productId(request);
  const product = await getDb().transaction(async (transaction) =>
    withMasterCatalogWriteLock(transaction, async () => {
      const [existing] = await transaction.select().from(products)
        .where(productOwnershipPredicate(storeId, id)).limit(1);
      if (!existing) throw productNotFound();
      if (isActive) await assertProductCanBeActivated(transaction, storeId, existing);
      const [updated] = await transaction.update(products)
        .set({ isActive, updatedAt: new Date() })
        .where(productOwnershipPredicate(storeId, id))
        .returning();
      return updated;
    }),
  );
  response.json({ product: await productWithVariants(product) });
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
  const storeId = vendorStoreId(request);
  const id = productId(request);
  const product = await getDb().transaction(async (transaction) => {
    return updateOwnedProductAndChildren(
      async () => {
        const [updated] = await transaction.update(products)
          .set({ [field]: parsed.data![field], updatedAt: new Date() })
          .where(productOwnershipPredicate(storeId, id))
          .returning();
        return updated;
      },
      async () => {
        if (field === "availability") {
          await transaction.update(productVariants)
            .set({ availability: parsed.data![field] as boolean, updatedAt: new Date() })
            .where(eq(productVariants.productId, id));
        }
      },
    );
  });
  response.json({ product: await productWithVariants(product) });
}

catalogManagementRouter.patch("/api/vendor/products/:productId/availability", requireRole("vendor"), asyncHandler((request, response) => updateProductField(request, response, productAvailabilitySchema, "availability")));
catalogManagementRouter.patch("/api/vendor/products/:productId/price", requireRole("vendor"), asyncHandler(async (request, response) => {
  const parsed = productPriceSchema.safeParse(request.body);
  if (!parsed.success) { sendValidationError(response, parsed.error); return; }
  const storeId = vendorStoreId(request);
  const id = productId(request);
  const product = await getDb().transaction(async (transaction) =>
    withMasterCatalogWriteLock(transaction, async () => {
      const [existing] = await transaction.select().from(products)
        .where(productOwnershipPredicate(storeId, id)).limit(1);
      if (!existing) throw productNotFound();
      const variants = await transaction.select().from(productVariants)
        .where(eq(productVariants.productId, id));
      if (variants.length > 1) throw new HttpError(409, "Update price on individual variants when a product has multiple variants");
      if (existing.isActive && parsed.data.price <= 0 && variants.some((variant) => variant.isActive)) {
        throw new HttpError(400, "Active selling variants need a price greater than zero");
      }
      const [updated] = await transaction.update(products).set({ price: parsed.data.price.toFixed(2), updatedAt: new Date() })
        .where(productOwnershipPredicate(storeId, id)).returning();
      if (variants.length === 1) await transaction.update(productVariants)
        .set({ price: parsed.data.price.toFixed(2), updatedAt: new Date() })
        .where(eq(productVariants.id, variants[0].id));
      return updated;
    }),
  );
  response.json({ product: await productWithVariants(product) });
}));
catalogManagementRouter.patch("/api/vendor/products/:productId/stock-quantity", requireRole("vendor"), asyncHandler(async (request, response) => {
  const parsed = productStockQuantitySchema.safeParse(request.body);
  if (!parsed.success) { sendValidationError(response, parsed.error); return; }
  const storeId = vendorStoreId(request);
  const id = productId(request);
  const product = await getDb().transaction(async (transaction) => {
    const [owned] = await transaction.select().from(products)
      .where(productOwnershipPredicate(storeId, id)).limit(1).for("update");
    if (!owned) throw new HttpError(404, "Product not found");
    const variants = await transaction.select().from(productVariants)
      .where(eq(productVariants.productId, id)).orderBy(asc(productVariants.id)).for("update");
    if (variants.length > 1) throw new HttpError(409, "Update stock on individual variants when a product has multiple variants");
    const [updated] = await transaction.update(products).set({ stockQuantity: parsed.data.stockQuantity, updatedAt: new Date() })
      .where(productOwnershipPredicate(storeId, id)).returning();
    if (variants.length === 1) await transaction.update(productVariants)
      .set({ stockQuantity: parsed.data.stockQuantity, updatedAt: new Date() })
      .where(eq(productVariants.id, variants[0].id));
    return updated;
  });
  response.json({ product: await productWithVariants(product) });
}));
catalogManagementRouter.patch("/api/vendor/products/:productId/category", requireRole("vendor"), asyncHandler(async (request, response) => {
  const parsed = productCategorySchema.safeParse(request.body);
  if (!parsed.success) { sendValidationError(response, parsed.error); return; }
  const storeId = vendorStoreId(request);
  if (parsed.data.categoryId) await requireCategoryInStore(storeId, parsed.data.categoryId);
  const [product] = await getDb().update(products).set({ categoryId: parsed.data.categoryId, updatedAt: new Date() }).where(productOwnershipPredicate(storeId, productId(request))).returning();
  if (!product) throw productNotFound();
   response.json({ product: await productWithVariants(product) });
}));