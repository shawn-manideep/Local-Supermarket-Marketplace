import type { MasterProduct, Product } from "./api";

export function getExistingMasterProductIds(products: readonly Product[]) {
  return new Set(products.flatMap((product) => product.masterProductId ? [product.masterProductId] : []));
}

export function isEligibleMasterProduct(product: MasterProduct) {
  return product.isActive && product.canAddToStore !== false && product.exactIdentity !== false;
}

export function getSelectableMasterProducts(
  products: readonly MasterProduct[],
  existingIds: ReadonlySet<string>,
) {
  return products.filter((product) => isEligibleMasterProduct(product) && !existingIds.has(product.id));
}

export interface BulkAddResult {
  succeeded: string[];
  skipped: string[];
  failed: Array<{ id: string; message: string }>;
}

export async function processBulkAdd<T extends { reused?: boolean }>(
  ids: readonly string[],
  existingIds: ReadonlySet<string>,
  add: (id: string) => Promise<T>,
): Promise<BulkAddResult> {
  const result: BulkAddResult = { succeeded: [], skipped: [], failed: [] };
  const seen = new Set(existingIds);
  for (const id of ids) {
    if (seen.has(id)) {
      result.skipped.push(id);
      continue;
    }
    seen.add(id);
    try {
      const response = await add(id);
      if (response.reused) result.skipped.push(id);
      else result.succeeded.push(id);
    } catch (error) {
      result.failed.push({
        id,
        message: error instanceof Error ? error.message : "Unable to add this product.",
      });
    }
  }
  return result;
}
