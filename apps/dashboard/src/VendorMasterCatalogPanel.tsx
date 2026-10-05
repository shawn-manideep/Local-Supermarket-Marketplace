import { useEffect, useMemo, useState } from "react";
import { apiRequest, type MasterCategory, type MasterProduct, type Product } from "./api";

interface Props {
  token: string;
  onAdded: (product: Product) => void;
  onMessage: (message: string, kind?: "success" | "error") => void;
}

interface PageResult {
  products: MasterProduct[];
  pagination: { page: number; pageSize: number; total: number };
}

export function VendorMasterCatalogPanel({ token, onAdded, onMessage }: Props) {
  const [categories, setCategories] = useState<MasterCategory[]>([]);
  const [searchText, setSearchText] = useState("");
  const [search, setSearch] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [page, setPage] = useState(1);
  const [reloadKey, setReloadKey] = useState(0);
  const [pageData, setPageData] = useState<PageResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [busyId, setBusyId] = useState("");

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setSearch(searchText.trim());
      setPage(1);
    }, 250);
    return () => window.clearTimeout(timeout);
  }, [searchText]);

  useEffect(() => {
    let active = true;
    apiRequest<{ categories: MasterCategory[] }>("/api/vendor/master-categories", token)
      .then((response) => { if (active) setCategories(response.categories); })
      .catch((error) => { if (active) onMessage(error instanceof Error ? error.message : "Unable to load catalog categories.", "error"); });
    return () => { active = false; };
  }, [token, onMessage]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setLoadError("");
    const query = new URLSearchParams({ page: String(page), pageSize: "12" });
    if (search) query.set("search", search);
    if (categoryId && !search) query.set("categoryId", categoryId);
    apiRequest<PageResult>(`/api/vendor/master-products?${query.toString()}`, token)
      .then((response) => { if (active) setPageData(response); })
      .catch((error) => {
        if (!active) return;
        setLoadError(error instanceof Error ? error.message : "Unable to load the master catalog.");
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [token, search, categoryId, page, reloadKey]);

  const totalPages = useMemo(
    () => Math.max(1, Math.ceil((pageData?.pagination.total ?? 0) / (pageData?.pagination.pageSize ?? 12))),
    [pageData],
  );

  const addMasterProduct = async (masterProductId: string) => {
    if (busyId) return;
    setBusyId(masterProductId);
    try {
      const response = await apiRequest<{ product: Product; reused: boolean }>(
        `/api/vendor/master-products/${masterProductId}/add-to-store`,
        token,
        { method: "POST", body: JSON.stringify({}) },
      );
      const listing = { ...response.product, masterProductId: response.product.masterProductId ?? masterProductId };
      onAdded(listing);
      onMessage(response.reused
        ? `${listing.name} is already in My Store. Its existing listing is ready to configure.`
        : `${listing.name} was added to My Store. Configure at least one selling option before publishing.`,
        "success");
    } catch (error) {
      onMessage(error instanceof Error ? error.message : "Unable to add this product.", "error");
    } finally {
      setBusyId("");
    }
  };

  return (
    <section className="vendor-card vendor-master-catalog" aria-labelledby="master-catalog-title">
      <div className="vendor-card-heading vendor-master-heading">
        <div>
          <p className="vendor-eyebrow">Shared grocery catalog</p>
          <h2 className="vendor-title-md" id="master-catalog-title">Master Catalog</h2>
          <p className="vendor-text-muted">Find products by name, brand, or details. Choose a category when browsing, and set your own selling units, prices, and stock.</p>
        </div>
        <p className="vendor-text-muted">Master products are maintained by Admin. Contact Admin if a product is missing.</p>
      </div>
      <div className="vendor-master-search">
        <label className="vendor-label" htmlFor="master-product-search">Search Products</label>
        <input id="master-product-search" className="vendor-input" type="search" placeholder="Try rice, milk, a brand, or product detail" value={searchText} onChange={(event) => { setSearchText(event.target.value); setCategoryId(""); }} />
        <label className="vendor-label" htmlFor="master-category-filter">Browse by category <span className="vendor-text-muted vendor-font-normal">optional</span></label>
        <select id="master-category-filter" className="vendor-select" disabled={Boolean(searchText.trim())} value={categoryId} onChange={(event) => { setCategoryId(event.target.value); setPage(1); }}>
          <option value="">All categories</option>
          {categories.filter((category) => category.isActive).map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
        </select>
        <p className="vendor-text-muted vendor-master-search-help">
          {searchText.trim()
            ? "Search covers all categories. Clear search to browse by category."
            : "Search covers all categories. Category is only used when browsing."}
        </p>
      </div>

      {loadError ? (
        <div className="vendor-empty-state vendor-compact" role="alert">
          <strong>Catalog could not load</strong><span>{loadError}</span>
          <button className="vendor-secondary-button" type="button" onClick={() => setReloadKey((current) => current + 1)}>Retry</button>
        </div>
      ) : loading ? (
        <div className="vendor-master-skeleton" aria-label="Loading master catalog"><i /><i /><i /></div>
      ) : pageData?.products.length ? (
        <>
          <div className="vendor-master-grid">
            {pageData.products.map((product) => (
              <article className="vendor-master-product" key={product.id} data-testid={`card-master-product-${product.id}`}>
                {product.image ? <img className="vendor-master-image" src={product.image} alt="" /> : <div className="vendor-master-image vendor-master-monogram" aria-hidden="true">{product.name.slice(0, 1).toUpperCase()}</div>}
                <div className="vendor-master-product-copy">
                  <span className="vendor-master-category">{product.masterCategoryId === null ? "New product" : product.categoryName ?? categories.find((item) => item.id === product.masterCategoryId)?.name ?? "Unknown category"}</span>
                  <h3>{product.name}</h3>
                  {product.brand && <strong className="vendor-master-brand">{product.brand}</strong>}
                  {product.description && <p>{product.description}</p>}
                  {product.attributes?.details && <p>{product.attributes.details}</p>}
                </div>
                <button className="vendor-secondary-button" type="button" disabled={Boolean(busyId)} onClick={() => void addMasterProduct(product.id)}>
                  {busyId === product.id ? "Adding…" : "Add to My Store"}
                </button>
              </article>
            ))}
          </div>
          <div className="vendor-master-pagination">
            <span className="vendor-text-muted">{pageData.pagination.total} shared products · page {page} of {totalPages}</span>
            <div className="vendor-row-actions">
              <button className="vendor-secondary-button vendor-compact-button" type="button" disabled={page <= 1 || loading} onClick={() => setPage((current) => current - 1)}>Previous</button>
              <button className="vendor-secondary-button vendor-compact-button" type="button" disabled={page >= totalPages || loading} onClick={() => setPage((current) => current + 1)}>Next</button>
            </div>
          </div>
        </>
      ) : (
        <div className="vendor-empty-state vendor-compact">
          <strong>No matching product found.</strong>
          <span>Try a broader search, or contact Admin to add the missing product to the platform catalog.</span>
        </div>
      )}

    </section>
  );
}