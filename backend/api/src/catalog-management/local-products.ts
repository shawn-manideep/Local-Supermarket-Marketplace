import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { categories, getDb, masterCategories, products, productVariants } from "@workspace/db";
import { productCreateSchema, productVariantCreateSchema, formatVariantName, sortVariantsForDisplay } from "@workspace/validation";
import { HttpError, isUniqueViolation } from "../http.js";
import { candidateMatches, findLikelyMatches } from "../master-catalog/routes.js";
import { normalizeIdentityText, withMasterCatalogWriteLock } from "../master-catalog/duplicate-review.js";

export const localProductCreateSchema = productCreateSchema.extend({
  brand: z.string().trim().max(200).nullable().optional(),
  requestedCategoryName: z.string().trim().min(1).max(120).optional(),
  isActive: z.boolean().optional().default(true),
  variants: z.array(productVariantCreateSchema).min(1).max(50),
  confirmSimilar: z.boolean().optional().default(false),
}).strict();

export async function localProductMatches(
  storeId: string, name: string, brand: string | null, categoryId: string | null,
  database: { select: (...args: any[]) => any } = getDb(),
) {
  let categoryName: string | null = null;
  let mappedCategoryId: string | null = null;
  if (categoryId) {
    const [category] = await database.select().from(categories)
      .where(and(eq(categories.id, categoryId), eq(categories.storeId, storeId)));
    if (!category) throw new HttpError(404, "Category not found in vendor store");
    categoryName = category.name;
    mappedCategoryId = category.masterCategoryId;
  }
  const canonicalCategories = categoryName
    ? await database.select().from(masterCategories) : [];
  const canonicalCategory = canonicalCategories.find((row: { name: string }) =>
    normalizeIdentityText(row.name) === normalizeIdentityText(categoryName));
  const input = { name, brand, masterCategoryId: mappedCategoryId ?? canonicalCategory?.id ?? null, attributes: {} };
  const matches = candidateMatches(await findLikelyMatches(input, database), input);
  // Without an explicit canonical attributes editor, a name/brand match is
  // conservatively exact when category is unknown, rather than manufacture an identity.
  return matches.map(match => ({
    ...match,
    exactIdentity: match.exactIdentity || (
      normalizeIdentityText(match.name) === normalizeIdentityText(name) &&
      normalizeIdentityText(match.brand) === normalizeIdentityText(brand) &&
      (input.masterCategoryId ? match.masterCategoryId === input.masterCategoryId :
        !categoryName || normalizeIdentityText(match.categoryName) === normalizeIdentityText(categoryName))
    ),
  })).sort((left, right) => Number(right.exactIdentity) - Number(left.exactIdentity)).slice(0, 100);
}

export async function createLocalProduct(storeId: string, body: unknown) {
  const parsed = localProductCreateSchema.safeParse(body);
  if (!parsed.success) throw new HttpError(400, "Validation failed", parsed.error.issues);
  const input = parsed.data;
  if (input.categoryId && input.requestedCategoryName) throw new HttpError(400, "Choose an existing category or request a missing category");
  if (input.variants.some(variant => variant.isActive && variant.price <= 0)) {
    throw new HttpError(400, "Active selling variants need a price greater than zero");
  }
  if (input.isActive && !input.variants.some(variant => variant.isActive && variant.price > 0)) {
    throw new HttpError(400, "Configure an active selling variant before publishing");
  }
  return getDb().transaction(transaction => withMasterCatalogWriteLock(transaction, async () => {
    const matches = await localProductMatches(storeId, input.name, input.brand ?? null, input.categoryId ?? null, transaction);
    if (matches.some(match => match.exactIdentity)) {
      throw new HttpError(409, "This product already exists in Master Catalog. Use Existing Product.", { matches }, "EXACT_MASTER_PRODUCT");
    }
    if (matches.length && !input.confirmSimilar) {
      throw new HttpError(409, "Similar product found in Master Catalog.", { matches }, "SIMILAR_MASTER_PRODUCT");
    }
    const existing = await transaction.select().from(products).where(eq(products.storeId, storeId));
    if (existing.some(row => normalizeIdentityText(row.name) === normalizeIdentityText(input.name) &&
      normalizeIdentityText(row.brand) === normalizeIdentityText(input.brand) &&
      row.categoryId === (input.categoryId ?? null))) {
      throw new HttpError(409, "A product with this identity already exists in your store");
    }
    const variants = sortVariantsForDisplay(input.variants.map((variant, index) => ({
      ...variant, sortOrder: index, createdAt: new Date(),
    })));
    const first = variants.find(variant => variant.isActive) ?? variants[0]!;
    const [created] = await transaction.insert(products).values({
      storeId, masterProductId: null, name: input.name, brand: input.brand || null,
      categoryId: input.categoryId ?? null, requestedCategoryName: input.requestedCategoryName ?? null,
      description: input.description ?? null, imageUrl: input.imageUrl ?? null,
      sku: input.sku ?? null, externalCode: input.externalCode ?? null,
      price: first.price.toFixed(2), stockQuantity: first.stockQuantity,
      availability: input.availability ?? true, isActive: input.isActive,
    }).returning();
    await transaction.insert(productVariants).values(variants.map((variant, sortOrder) => ({
      productId: created!.id, name: formatVariantName(variant.quantityValue, variant.quantityUnit),
      quantityValue: variant.quantityValue, quantityUnit: variant.quantityUnit, price: variant.price.toFixed(2),
      stockQuantity: variant.stockQuantity, availability: variant.availability, isActive: variant.isActive,
      sku: variant.sku ?? null, externalCode: variant.externalCode ?? null, sortOrder,
    })));
    return created!;
  })).catch((error: unknown) => {
    const cause = typeof error === "object" && error !== null && "cause" in error
      ? (error as { cause: unknown }).cause : error;
    if (isUniqueViolation(cause)) throw new HttpError(409, "A listing or selling variant with this SKU or external code already exists");
    throw error;
  });
}
