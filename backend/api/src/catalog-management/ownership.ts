import { and, eq } from "drizzle-orm";
import { categories, products } from "@workspace/db";

export function categoryOwnershipPredicate(storeId: string, categoryId: string) {
  return and(eq(categories.storeId, storeId), eq(categories.id, categoryId));
}

export function productOwnershipPredicate(storeId: string, productId: string) {
  return and(eq(products.storeId, storeId), eq(products.id, productId));
}