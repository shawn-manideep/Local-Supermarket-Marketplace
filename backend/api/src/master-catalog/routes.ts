import { and, asc, count, desc, eq, ilike, isNull, or, sql } from "drizzle-orm";
import { Router, type Request, type Response } from "express";
import {
  addMasterProductToStoreSchema,
  adminMasterRecordIdParamSchema,
  adminMasterCatalogQuerySchema,
  masterCatalogCanonicalProductSchema,
  masterCatalogQuerySchema,
  masterCategoryCreateSchema,
  masterCategoryUpdateSchema,
  masterProductAdminUpdateSchema,
  masterProductDuplicateCheckSchema,
  masterProductIdParamSchema,
  masterProductMappingUpdateSchema,
  productIdParamSchema,
} from "@workspace/validation";
import {
  categories,
  getDb,
  masterCategories,
  masterMappingAudit,
  masterProducts,
  productVariants,
  products,
} from "@workspace/db";
import { requireRole } from "../auth/index.js";
import type { AuthenticatedRequest } from "../auth/types.js";
import { asyncHandler, HttpError, isUniqueViolation, validationDetails } from "../http.js";
import { requireCatalogDocuments } from "../vendor-documents/service.js";
import {
  canonicalIdentity,
  createDuplicateReviewToken,
  isNewMasterCategoryAssignment,
  normalizeIdentityText,
  reviewedCandidateProof,
  withMasterCatalogWriteLock,
  type CanonicalProductInput,
} from "./duplicate-review.js";

export const masterCatalogRouter = Router();

type MasterProductRow = typeof masterProducts.$inferSelect;
type CanonicalInput = CanonicalProductInput;
type CatalogMatchRow = {
  product: MasterProductRow;
  categoryName: string | null;
  categoryIsActive: boolean | null;
};
type SelectExecutor = { select: (...args: any[]) => any };

export function shouldApplyVendorMasterCategoryFilter(search?: string) {
  return !search?.trim();
}

function sendValidationError(response: Response, error: { issues: unknown }) {
  response.status(400).json({ error: "Validation failed", details: error.issues });
}

function vendorStoreId(request: Request) {
  const storeId = (request as AuthenticatedRequest).auth?.storeId;
  if (!storeId) throw new HttpError(404, "Vendor store not found");
  return storeId;
}

function actorUserId(request: Request) {
  const userId = (request as AuthenticatedRequest).auth?.userId;
  if (!userId) throw new HttpError(401, "Authentication required");
  return userId;
}

function categoryNotFound() {
  return new HttpError(404, "Master category not found");
}

function productNotFound() {
  return new HttpError(404, "Master product not found");
}

function parseId<T extends { id: string }>(
  request: Request,
  schema: { safeParse: (value: unknown) => { success: boolean; data?: T; error?: { issues: unknown } } },
  message: string,
) {
  const parsed = schema.safeParse(request.params);
  if (!parsed.success) throw new HttpError(400, message, parsed.error?.issues);
  return parsed.data!.id;
}

function masterProductId(request: Request) {
  const parsed = masterProductIdParamSchema.safeParse(request.params);
  if (!parsed.success) throw new HttpError(400, "Invalid master product ID", validationDetails(parsed.error));
  return parsed.data.masterProductId;
}

function adminMasterId(request: Request) {
  return parseId(request, adminMasterRecordIdParamSchema, "Invalid master record ID");
}

function toCanonicalInput(
  input: CanonicalInput,
): CanonicalInput {
  return {
    ...input,
    attributes: input.attributes ?? {},
  };
}

function normalizedSearchTerms(product: CanonicalInput) {
  return [...new Set([
    product.name,
    ...(product.brand ? [product.brand] : []),
    ...Object.values(product.attributes ?? {}),
  ].flatMap((value) => normalizeIdentityText(value).split(/\s+/)).filter((value) => value.length > 1))].slice(0, 24);
}

export async function findLikelyMatches(product: CanonicalInput, database: SelectExecutor = getDb()) {
  const terms = normalizedSearchTerms(product);
  const conditions = terms.map((term) => {
    const pattern = `%${term}%`;
    return or(
      ilike(masterProducts.name, pattern),
      ilike(masterProducts.brand, pattern),
      ilike(masterProducts.description, pattern),
      sql`${masterProducts.attributes}::text ILIKE ${pattern}`,
    )!;
  });
  const [rows, exactRows]: [CatalogMatchRow[], CatalogMatchRow[]] = await Promise.all([
    terms.length
      ? database.select({
        product: masterProducts,
        categoryName: masterCategories.name,
        categoryIsActive: masterCategories.isActive,
      }).from(masterProducts)
        .leftJoin(masterCategories, eq(masterProducts.masterCategoryId, masterCategories.id))
        .where(or(...conditions))
        .orderBy(desc(masterProducts.isActive), asc(masterProducts.name), asc(masterProducts.id))
      : Promise.resolve([]),
    findExactIdentityMatches(product, database),
  ]);
  const byId = new Map<string, CatalogMatchRow>();
  for (const row of [...rows, ...exactRows]) byId.set(row.product.id, row);
  return [...byId.values()];
}

async function findExactIdentityMatches(product: CanonicalInput, database: SelectExecutor = getDb()) {
  const rows: CatalogMatchRow[] = await database.select({
    product: masterProducts,
    categoryName: masterCategories.name,
    categoryIsActive: masterCategories.isActive,
  }).from(masterProducts)
    .leftJoin(masterCategories, eq(masterProducts.masterCategoryId, masterCategories.id));
  return rows.filter((row: CatalogMatchRow) => canonicalIdentity({
    masterCategoryId: row.product.masterCategoryId,
    name: row.product.name,
    brand: row.product.brand,
    attributes: row.product.attributes ?? {},
  }) === canonicalIdentity(product));
}

export function candidateMatches(rows: CatalogMatchRow[], product: CanonicalInput) {
  return rows.map(({ product: match, categoryName, categoryIsActive }) => ({
    id: match.id,
    masterCategoryId: match.masterCategoryId,
    categoryName,
    classificationLabel: categoryName ?? "Pending classification",
    categoryIsActive,
    canAddToStore: match.isActive && (match.masterCategoryId === null || categoryIsActive === true),
    name: match.name,
    description: match.description,
    image: match.image,
    brand: match.brand,
    attributes: match.attributes,
    isActive: match.isActive,
    exactIdentity: canonicalIdentity({
      masterCategoryId: match.masterCategoryId,
      name: match.name,
      brand: match.brand,
      attributes: match.attributes ?? {},
    }) === canonicalIdentity(product),
  }));
}

async function requireActiveMasterCategory(categoryId: string, transaction?: SelectExecutor) {
  const database = transaction ?? getDb();
  const [category] = await database.select().from(masterCategories)
    .where(and(eq(masterCategories.id, categoryId), eq(masterCategories.isActive, true)))
    .limit(1);
  if (!category) throw categoryNotFound();
  return category;
}

async function requireActiveMasterProduct(masterProductId: string, transaction?: SelectExecutor) {
  const database = transaction ?? getDb();
  const [product] = await database.select({
    product: masterProducts,
    categoryActive: masterCategories.isActive,
  }).from(masterProducts)
    .leftJoin(masterCategories, eq(masterProducts.masterCategoryId, masterCategories.id))
    .where(and(
      eq(masterProducts.id, masterProductId),
      eq(masterProducts.isActive, true),
      or(isNull(masterProducts.masterCategoryId), eq(masterCategories.isActive, true)),
    ))
    .limit(1);
  if (!product) throw productNotFound();
  return product.product;
}

async function ownedLocalCategory(storeId: string, categoryId: string | null | undefined, transaction: {
  select: (...args: any[]) => any;
}) {
  if (!categoryId) return null;
  const [category] = await transaction.select().from(categories)
    .where(and(eq(categories.id, categoryId), eq(categories.storeId, storeId)))
    .limit(1);
  if (!category) throw new HttpError(404, "Category not found in vendor store");
  return category;
}

async function listVendorProducts(query: {
  search?: string;
  categoryId?: string;
  page: number;
  pageSize: number;
}) {
  const conditions = [
    eq(masterProducts.isActive, true),
    or(isNull(masterProducts.masterCategoryId), eq(masterCategories.isActive, true))!,
  ];
  if (query.categoryId && shouldApplyVendorMasterCategoryFilter(query.search)) {
    conditions.push(eq(masterProducts.masterCategoryId, query.categoryId));
  }
  if (query.search) {
    const pattern = `%${query.search.trim()}%`;
    conditions.push(or(
      ilike(masterProducts.name, pattern),
      ilike(masterProducts.brand, pattern),
      ilike(masterProducts.description, pattern),
      sql`${masterProducts.attributes}::text ILIKE ${pattern}`,
    )!);
  }
  const where = and(...conditions);
  const database = getDb();
  const [rows, [totalRow]] = await Promise.all([
    database.select({
      product: masterProducts,
      categoryName: masterCategories.name,
    }).from(masterProducts)
      .leftJoin(masterCategories, eq(masterProducts.masterCategoryId, masterCategories.id))
      .where(where)
      .orderBy(asc(masterProducts.name), asc(masterProducts.id))
      .limit(query.pageSize)
      .offset((query.page - 1) * query.pageSize),
    database.select({ total: count() }).from(masterProducts)
      .leftJoin(masterCategories, eq(masterProducts.masterCategoryId, masterCategories.id))
      .where(where),
  ]);
  return {
    products: rows.map(({ product, categoryName }) => ({
      ...product,
      categoryName,
      classificationLabel: categoryName ?? "Pending classification",
    })),
    pagination: { page: query.page, pageSize: query.pageSize, total: totalRow.total },
  };
}

function vendorResponseProduct(
  product: typeof products.$inferSelect,
  master: MasterProductRow | undefined,
) {
  if (!master) return { ...product, brand: null };
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

async function vendorProductWithVariants(product: typeof products.$inferSelect) {
  const database = getDb();
  const [master] = product.masterProductId
    ? await database.select().from(masterProducts).where(eq(masterProducts.id, product.masterProductId)).limit(1)
    : [];
  const variants = await database.select().from(productVariants)
    .where(eq(productVariants.productId, product.id))
    .orderBy(asc(productVariants.sortOrder), asc(productVariants.createdAt));
  return { ...vendorResponseProduct(product, master), variants };
}

masterCatalogRouter.get(
  "/api/vendor/master-categories",
  requireRole("vendor"),
  asyncHandler(async (_request, response) => {
    const categoryList = await getDb().select({
      category: masterCategories,
      productCount: count(masterProducts.id),
    }).from(masterCategories)
      .leftJoin(masterProducts, and(
        eq(masterProducts.masterCategoryId, masterCategories.id),
        eq(masterProducts.isActive, true),
      ))
      .where(eq(masterCategories.isActive, true))
      .groupBy(masterCategories.id)
      .orderBy(asc(masterCategories.name), asc(masterCategories.id));
    response.json({
      categories: categoryList.map(({ category, productCount }) => ({ ...category, productCount })),
    });
  }),
);

masterCatalogRouter.get(
  "/api/vendor/master-products",
  requireRole("vendor"),
  asyncHandler(async (request, response) => {
    const parsed = masterCatalogQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      sendValidationError(response, parsed.error);
      return;
    }
    response.json(await listVendorProducts(parsed.data));
  }),
);

masterCatalogRouter.get(
  "/api/vendor/master-products/:masterProductId",
  requireRole("vendor"),
  asyncHandler(async (request, response) => {
    const [row] = await getDb().select({
      product: masterProducts,
      categoryName: masterCategories.name,
    }).from(masterProducts)
      .leftJoin(masterCategories, eq(masterProducts.masterCategoryId, masterCategories.id))
      .where(and(
        eq(masterProducts.id, masterProductId(request)),
        eq(masterProducts.isActive, true),
        or(isNull(masterProducts.masterCategoryId), eq(masterCategories.isActive, true)),
      )).limit(1);
    if (!row) throw productNotFound();
    response.json({ product: {
      ...row.product,
      categoryName: row.categoryName,
      classificationLabel: row.categoryName ?? "Pending classification",
    } });
  }),
);

masterCatalogRouter.post(
  "/api/vendor/master-products/duplicate-check",
  requireRole("vendor"),
  asyncHandler(async (request, response) => {
    const parsed = masterProductDuplicateCheckSchema.safeParse(request.body);
    if (!parsed.success) {
      sendValidationError(response, parsed.error);
      return;
    }
    const canonicalProduct = toCanonicalInput(parsed.data);
    if (canonicalProduct.masterCategoryId) {
      const category = await getDb().select({ isActive: masterCategories.isActive })
        .from(masterCategories).where(eq(masterCategories.id, canonicalProduct.masterCategoryId)).limit(1);
      if (!category[0]?.isActive) throw categoryNotFound();
    }
    const matches = await findLikelyMatches(canonicalProduct);
    response.json({
      matches: candidateMatches(matches, canonicalProduct),
      duplicateReviewToken: createDuplicateReviewToken(
        canonicalProduct,
        matches.map(({ product, categoryName, categoryIsActive }) => reviewedCandidateProof({
          ...product,
          categoryName,
          categoryIsActive,
        })),
      ),
    });
  }),
);

masterCatalogRouter.post(
  "/api/vendor/master-products",
  requireRole("vendor"),
  asyncHandler(async () => {
    throw new HttpError(403, "Only Admin can create master products. Select an active product from the Master Catalog.");
  }),
);

masterCatalogRouter.post(
  "/api/vendor/master-products/:masterProductId/add-to-store",
  requireRole("vendor"),
  requireCatalogDocuments,
  asyncHandler(async (request, response) => {
    const params = masterProductIdParamSchema.safeParse(request.params);
    if (!params.success) throw new HttpError(400, "Invalid master product ID", validationDetails(params.error));
    const parsed = addMasterProductToStoreSchema.safeParse(request.body);
    if (!parsed.success) {
      sendValidationError(response, parsed.error);
      return;
    }
    const storeId = vendorStoreId(request);
    const masterProductId = params.data.masterProductId;
    const result = await getDb().transaction(async (transaction) =>
      withMasterCatalogWriteLock(transaction, async () => {
        const master = await requireActiveMasterProduct(masterProductId, transaction);
        const localCategory = await ownedLocalCategory(storeId, parsed.data.categoryId, transaction);
        const existing = await transaction.select().from(products)
          .where(and(eq(products.storeId, storeId), eq(products.masterProductId, masterProductId)))
          .orderBy(desc(products.isActive), asc(products.createdAt), asc(products.id));
        if (existing.length) {
          return { product: existing[0], reused: true };
        }
        const [created] = await transaction.insert(products).values({
          storeId,
          categoryId: localCategory?.id ?? null,
          masterProductId: master.id,
          name: master.name,
          description: null,
          imageUrl: null,
          sku: null,
          externalCode: null,
          price: "0.00",
          availability: false,
          stockQuantity: 0,
          isActive: false,
        }).returning();
        return { product: created, reused: false };
      }),
    );
    response.status(result.reused ? 200 : 201).json({
      product: await vendorProductWithVariants(result.product),
      reused: result.reused,
    });
  }),
);

masterCatalogRouter.post(
  "/api/admin/master-categories",
  requireRole("admin"),
  asyncHandler(async (request, response) => {
    const parsed = masterCategoryCreateSchema.safeParse(request.body);
    if (!parsed.success) {
      sendValidationError(response, parsed.error);
      return;
    }
    const [category] = await getDb().insert(masterCategories).values({ name: parsed.data.name }).returning();
    response.status(201).json({ category });
  }),
);

masterCatalogRouter.get(
  "/api/admin/master-categories",
  requireRole("admin"),
  asyncHandler(async (_request, response) => {
    const categoryList = await getDb().select({
      category: masterCategories,
      productCount: count(masterProducts.id),
    }).from(masterCategories)
      .leftJoin(masterProducts, eq(masterProducts.masterCategoryId, masterCategories.id))
      .groupBy(masterCategories.id)
      .orderBy(asc(masterCategories.name), asc(masterCategories.id));
    response.json({
      categories: categoryList.map(({ category, productCount }) => ({ ...category, productCount })),
    });
  }),
);

masterCatalogRouter.get(
  "/api/admin/master-products",
  requireRole("admin"),
  asyncHandler(async (request, response) => {
    const parsed = adminMasterCatalogQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      sendValidationError(response, parsed.error);
      return;
    }
    const conditions = [];
    if (parsed.data.status !== "all") conditions.push(eq(masterProducts.isActive, parsed.data.status === "active"));
    if (parsed.data.categoryId) conditions.push(eq(masterProducts.masterCategoryId, parsed.data.categoryId));
    if (parsed.data.search) {
      const pattern = `%${parsed.data.search.trim()}%`;
      conditions.push(or(
        ilike(masterProducts.name, pattern),
        ilike(masterProducts.brand, pattern),
        ilike(masterProducts.description, pattern),
        sql`${masterProducts.attributes}::text ILIKE ${pattern}`,
      )!);
    }
    const where = conditions.length ? and(...conditions) : undefined;
    const database = getDb();
    const [rows, [totalRow]] = await Promise.all([
      database.select({
        product: masterProducts,
        categoryName: masterCategories.name,
      }).from(masterProducts)
        .leftJoin(masterCategories, eq(masterProducts.masterCategoryId, masterCategories.id))
        .where(where)
        .orderBy(asc(masterProducts.name), asc(masterProducts.id))
        .limit(parsed.data.pageSize)
        .offset((parsed.data.page - 1) * parsed.data.pageSize),
      database.select({ total: count() }).from(masterProducts).where(where),
    ]);
    response.json({
      products: rows.map(({ product, categoryName }) => ({
        ...product,
        categoryName,
        classificationLabel: categoryName ?? "Pending classification",
      })),
      pagination: { page: parsed.data.page, pageSize: parsed.data.pageSize, total: totalRow.total },
    });
  }),
);

masterCatalogRouter.post(
  "/api/admin/master-products",
  requireRole("admin"),
  asyncHandler(async (request, response) => {
    const parsed = masterCatalogCanonicalProductSchema.safeParse(request.body);
    if (!parsed.success) {
      sendValidationError(response, parsed.error);
      return;
    }
    const productInput = toCanonicalInput(parsed.data);
    try {
      const product = await getDb().transaction(async (transaction) =>
        withMasterCatalogWriteLock(transaction, async () => {
          if (!productInput.masterCategoryId) throw categoryNotFound();
          await requireActiveMasterCategory(productInput.masterCategoryId, transaction);
          const [exact] = await findExactIdentityMatches(productInput, transaction);
          if (exact) throw new HttpError(409, "An identical master product already exists, including archived products");
          const [created] = await transaction.insert(masterProducts).values({
            masterCategoryId: productInput.masterCategoryId,
            name: productInput.name,
            description: productInput.description ?? null,
            image: productInput.image ?? null,
            brand: productInput.brand ?? null,
            attributes: productInput.attributes ?? {},
          }).returning();
          return created;
        }),
      );
      response.status(201).json({ product });
    } catch (error) {
      if (isUniqueViolation(error)) throw new HttpError(409, "That master product already exists");
      throw error;
    }
  }),
);

masterCatalogRouter.patch(
  "/api/admin/master-categories/:id",
  requireRole("admin"),
  asyncHandler(async (request, response) => {
    const id = adminMasterId(request);
    const parsed = masterCategoryUpdateSchema.safeParse(request.body);
    if (!parsed.success) {
      sendValidationError(response, parsed.error);
      return;
    }
    const category = await getDb().transaction(async (transaction) =>
      withMasterCatalogWriteLock(transaction, async () => {
        const [updated] = await transaction.update(masterCategories)
          .set({ name: parsed.data.name, updatedAt: new Date() })
          .where(eq(masterCategories.id, id)).returning();
        return updated;
      }),
    );
    if (!category) throw categoryNotFound();
    response.json({ category });
  }),
);

masterCatalogRouter.patch(
  "/api/admin/master-products/:id",
  requireRole("admin"),
  asyncHandler(async (request, response) => {
    const id = adminMasterId(request);
    const parsed = masterProductAdminUpdateSchema.safeParse(request.body);
    if (!parsed.success) {
      sendValidationError(response, parsed.error);
      return;
    }
    const update = {
      ...parsed.data,
      updatedAt: new Date(),
    };
    const product = await getDb().transaction(async (transaction) =>
      withMasterCatalogWriteLock(transaction, async () => {
        const [existing] = await transaction.select().from(masterProducts)
          .where(eq(masterProducts.id, id)).limit(1);
        if (!existing) throw productNotFound();
        if (
          parsed.data.masterCategoryId &&
          isNewMasterCategoryAssignment(existing.masterCategoryId, parsed.data.masterCategoryId)
        ) {
          await requireActiveMasterCategory(parsed.data.masterCategoryId, transaction);
        }
        const nextCanonical: CanonicalInput = {
          masterCategoryId: parsed.data.masterCategoryId === undefined
            ? existing.masterCategoryId
            : parsed.data.masterCategoryId,
          name: parsed.data.name ?? existing.name,
          description: parsed.data.description === undefined ? existing.description : parsed.data.description,
          image: parsed.data.image === undefined ? existing.image : parsed.data.image,
          brand: parsed.data.brand === undefined ? existing.brand : parsed.data.brand,
          attributes: parsed.data.attributes ?? existing.attributes ?? {},
        };
        const identityChanged = canonicalIdentity(nextCanonical) !== canonicalIdentity({
          masterCategoryId: existing.masterCategoryId,
          name: existing.name,
          brand: existing.brand,
          attributes: existing.attributes ?? {},
        });
        if (identityChanged) {
          const exactMatches = await findExactIdentityMatches(nextCanonical, transaction);
          if (exactMatches.some((match) => match.product.id !== id)) {
            throw new HttpError(409, "An identical master product already exists, including archived products");
          }
        }
        const [updated] = await transaction.update(masterProducts).set(update)
          .where(eq(masterProducts.id, id)).returning();
        return updated;
      }),
    );
    response.json({ product });
  }),
);

async function setMasterCategoryActive(request: Request, response: Response, isActive: boolean) {
  const id = adminMasterId(request);
  const updated = await getDb().transaction(async (transaction) =>
    withMasterCatalogWriteLock(transaction, async () => {
      const [category] = await transaction.update(masterCategories)
        .set({ isActive, updatedAt: new Date() })
        .where(eq(masterCategories.id, id)).returning();
      return category;
    }),
  );
  if (!updated) throw categoryNotFound();
  response.json({ category: updated });
}

async function setMasterProductActive(request: Request, response: Response, isActive: boolean) {
  const id = adminMasterId(request);
  const updated = await getDb().transaction(async (transaction) =>
    withMasterCatalogWriteLock(transaction, async () => {
      const [product] = await transaction.update(masterProducts)
        .set({ isActive, updatedAt: new Date() })
        .where(eq(masterProducts.id, id)).returning();
      return product;
    }),
  );
  if (!updated) throw productNotFound();
  response.json({ product: updated });
}

masterCatalogRouter.post("/api/admin/master-categories/:id/archive", requireRole("admin"), asyncHandler((request, response) => setMasterCategoryActive(request, response, false)));
masterCatalogRouter.post("/api/admin/master-categories/:id/unarchive", requireRole("admin"), asyncHandler((request, response) => setMasterCategoryActive(request, response, true)));
masterCatalogRouter.post("/api/admin/master-products/:id/archive", requireRole("admin"), asyncHandler((request, response) => setMasterProductActive(request, response, false)));
masterCatalogRouter.post("/api/admin/master-products/:id/unarchive", requireRole("admin"), asyncHandler((request, response) => setMasterProductActive(request, response, true)));

masterCatalogRouter.patch(
  "/api/admin/products/:productId/master-mapping",
  requireRole("admin"),
  asyncHandler(async (request, response) => {
    const productParams = productIdParamSchema.safeParse(request.params);
    const parsed = masterProductMappingUpdateSchema.safeParse(request.body);
    if (!productParams.success) throw new HttpError(400, "Invalid product ID", validationDetails(productParams.error));
    if (!parsed.success) {
      sendValidationError(response, parsed.error);
      return;
    }
    const productIdParsed = productParams.data.productId;
    const result = await getDb().transaction(async (transaction) =>
      withMasterCatalogWriteLock(transaction, async () => {
        const [ownedProduct] = await transaction.select().from(products)
          .where(eq(products.id, productIdParsed)).limit(1);
        if (!ownedProduct) throw new HttpError(404, "Product not found");
        const [master] = await transaction.select().from(masterProducts)
          .where(eq(masterProducts.id, parsed.data.masterProductId)).limit(1);
        if (!master) throw productNotFound();
        if (ownedProduct.masterProductId === master.id) {
          throw new HttpError(409, "Product is already mapped to that master product");
        }
        const [updated] = await transaction.update(products)
          .set({ masterProductId: master.id, updatedAt: new Date() })
          .where(eq(products.id, productIdParsed)).returning();
        await transaction.insert(masterMappingAudit).values({
          productId: ownedProduct.id,
          previousMasterProductId: ownedProduct.masterProductId,
          masterProductId: master.id,
          actorUserId: actorUserId(request),
          reason: parsed.data.reason,
        });
        return { product: updated, master };
      }),
    );
    response.json({ product: vendorResponseProduct(result.product, result.master) });
  }),
);
