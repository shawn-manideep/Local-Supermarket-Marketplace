/** Filters the already store-scoped product list without sorting or mutation. */
export function filterVendorProducts<T extends { name: string; brand?: string | null; categoryId: string | null }>(
  products: readonly T[], category: string, query: string,
): T[] {
  const search = query.trim().toLowerCase();
  return products.filter(product =>
    (category === "all" || (category === "uncategorized" ? product.categoryId === null : product.categoryId === category))
    && (!search || product.name.toLowerCase().includes(search) || (product.brand ?? "").toLowerCase().includes(search)));
}
