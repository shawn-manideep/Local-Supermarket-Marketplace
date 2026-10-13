import { useEffect, useMemo, useRef, useState } from "react";
import { apiRequest, type MasterCategory, type MasterProduct, type Product } from "./api";
import { getExistingMasterProductIds, getSelectableMasterProducts, isEligibleMasterProduct, processBulkAdd, type BulkAddResult } from "./vendor-master-bulk";
import { SellingVariantEditor } from "./SellingVariantEditor";

interface Props {
  token: string;
  products: Product[];
  storeInlineActive: boolean;
  onAdded: (product: Product) => void;
  onListingConfigured: () => void;
  onMessage: (message: string, kind?: "success" | "error") => void;
}

interface PageResult {
  products: MasterProduct[];
  pagination: { page: number; pageSize: number; total: number };
}

const emptyBulkResult: BulkAddResult = { succeeded: [], skipped: [], failed: [] };

export function VendorMasterCatalogPanel({ token, products, storeInlineActive, onAdded, onListingConfigured, onMessage }: Props) {
  const [categories, setCategories] = useState<MasterCategory[]>([]);
  const [searchText, setSearchText] = useState("");
  const [search, setSearch] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [page, setPage] = useState(1);
  const [reloadKey, setReloadKey] = useState(0);
  const [pageData, setPageData] = useState<PageResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [selectedExistingIds, setSelectedExistingIds] = useState<string[]>([]);
  const [confirming, setConfirming] = useState(false);
  const [bulkResult, setBulkResult] = useState<BulkAddResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [mountedListingIds, setMountedListingIds] = useState<string[]>([]);
  const [expandedListingIds, setExpandedListingIds] = useState<string[]>([]);
  const [masterNames, setMasterNames] = useState<Record<string, string>>({});
  const busyRef = useRef(false);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setSearch(searchText.trim());
      setPage(1);
    }, 250);
    return () => window.clearTimeout(timeout);
  }, [searchText]);

  useEffect(() => {
    setSelectedIds([]);
    setSelectedExistingIds([]);
    setConfirming(false);
    setBulkResult(null);
  }, [search, categoryId]);

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

  const existingIds = useMemo(() => getExistingMasterProductIds(products), [products]);
  const totalPages = Math.max(1, Math.ceil((pageData?.pagination.total ?? 0) / (pageData?.pagination.pageSize ?? 12)));
  const currentSelectable = useMemo(
    () => getSelectableMasterProducts(pageData?.products ?? [], existingIds),
    [pageData, existingIds],
  );
  const listingByMasterId = useMemo(
    () => new Map(products.flatMap((product) => product.masterProductId ? [[product.masterProductId, product] as const] : [])),
    [products],
  );
  const selectedCount = selectedIds.length;

  const addMasterProduct = async (masterProductId: string) => {
    if (existingIds.has(masterProductId)) return null;
    const response = await apiRequest<{ product: Product; reused: boolean }>(
      `/api/vendor/master-products/${masterProductId}/add-to-store`,
      token,
      { method: "POST", body: JSON.stringify({}) },
    );
    const listing = { ...response.product, masterProductId: response.product.masterProductId ?? masterProductId };
    onAdded(listing);
    return response;
  };

  const selectAllEligible = async () => {
    if (busyRef.current || loading || !pageData) return;
    busyRef.current = true;
    setBusy(true);
    try {
      const allProducts = [...pageData.products];
      for (let nextPage = 2; nextPage <= totalPages; nextPage += 1) {
        const query = new URLSearchParams({ page: String(nextPage), pageSize: String(pageData.pagination.pageSize || 12) });
        if (search) query.set("search", search);
        if (categoryId && !search) query.set("categoryId", categoryId);
        const response = await apiRequest<PageResult>(`/api/vendor/master-products?${query.toString()}`, token);
        allProducts.push(...response.products);
      }
      setMasterNames((current) => ({ ...current, ...Object.fromEntries(allProducts.map((product) => [product.id, product.name])) }));
      const eligible = getSelectableMasterProducts(allProducts, existingIds);
      setSelectedIds(eligible.map((product) => product.id));
      setSelectedExistingIds(allProducts.filter((product) => existingIds.has(product.id)).map((product) => product.id));
      setBulkResult(null);
      setConfirming(false);
    } catch (error) {
      onMessage(error instanceof Error ? error.message : "Unable to select eligible catalog products.", "error");
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const toggleSelection = (id: string, checked: boolean) => {
    setSelectedIds((current) => checked
      ? current.includes(id) ? current : [...current, id]
      : current.filter((item) => item !== id));
    setSelectedExistingIds([]);
    setBulkResult(null);
    setConfirming(false);
  };

  const runBulkAdd = async (ids: string[], retryOnly = false, includeKnownSkips = false) => {
    if (busyRef.current || ids.length === 0) return;
    busyRef.current = true;
    setBusy(true);
    setConfirming(false);
    const operationResult = await processBulkAdd(ids, existingIds, async (id) => {
      const response = await addMasterProduct(id);
      return { reused: response?.reused ?? false };
    });
    const result = includeKnownSkips
      ? { ...operationResult, skipped: [...new Set([...selectedExistingIds, ...operationResult.skipped])] }
      : operationResult;
    setBulkResult((previous) => retryOnly && previous
      ? {
        succeeded: [...previous.succeeded, ...result.succeeded],
        skipped: [...previous.skipped, ...result.skipped],
        failed: result.failed,
      }
      : result);
    const complete = retryOnly && bulkResult
      ? { succeeded: [...bulkResult.succeeded, ...result.succeeded], skipped: [...bulkResult.skipped, ...result.skipped], failed: result.failed }
      : result;
    if (complete.succeeded.length || complete.skipped.length) {
      setSelectedIds((current) => current.filter((id) => !complete.succeeded.includes(id) && !complete.skipped.includes(id)));
    }
    onMessage(
      `Bulk add finished: ${complete.succeeded.length} added, ${complete.skipped.length} skipped, ${complete.failed.length} failed.${complete.failed.length ? ` Retry is available for ${complete.failed.length} failed product${complete.failed.length === 1 ? "" : "s"}.` : ""}`,
      complete.failed.length ? "error" : "success",
    );
    if (complete.failed.length) {
      setBulkResult((previous) => previous ? {
        ...previous,
        failed: previous.failed.map((failure) => ({
          ...failure,
          message: `${masterNames[failure.id] ?? pageData?.products.find((product) => product.id === failure.id)?.name ?? failure.id}: ${failure.message}`,
        })),
      } : previous);
    }
    busyRef.current = false;
    setBusy(false);
  };

  const toggleListingEditor = (listingId: string) => {
    const isExpanded = expandedListingIds.includes(listingId);
    if (storeInlineActive && isExpanded) {
      onListingConfigured();
      return;
    }
    onListingConfigured();
    setMountedListingIds((current) => current.includes(listingId) ? current : [...current, listingId]);
    setExpandedListingIds((current) => isExpanded
      ? current.filter((id) => id !== listingId)
      : [...current, listingId]);
  };

  const formatResultNames = (ids: string[]) => ids.map((id) => masterNames[id] ?? pageData?.products.find((product) => product.id === id)?.name ?? id);

  return (
    <section className="vendor-card vendor-master-catalog" aria-labelledby="master-catalog-title">
      <div className="vendor-card-heading vendor-master-heading">
        <div>
          <p className="vendor-eyebrow">Shared grocery catalog</p>
          <h2 className="vendor-title-md" id="master-catalog-title">Master Catalog</h2>
          <p className="vendor-text-muted">Choose shared products, then set your own selling units, prices, and stock in each store-local listing.</p>
        </div>
        <p className="vendor-text-muted">Shared products are maintained by Admin. Contact Admin if a product is missing.</p>
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
          {searchText.trim() ? "Search covers all categories. Clear search to browse by category." : "Search covers all categories. Category is only used when browsing."}
        </p>
      </div>

      <div className="vendor-master-bulk-bar">
        <div>
          <strong>{selectedCount} eligible product{selectedCount === 1 ? "" : "s"} selected</strong>
            <span className="vendor-text-muted"> Additions create unpublished store drafts. Selling unit, pack, price, and stock must be entered separately. {selectedExistingIds.length > 0 ? `${selectedExistingIds.length} matching listing${selectedExistingIds.length === 1 ? " is" : "s are"} already in My Store and will be skipped.` : ""}</span>
        </div>
        <div className="vendor-row-actions">
          <button className="vendor-secondary-button vendor-compact-button" type="button" disabled={busy || loading || !pageData?.pagination.total} onClick={() => void selectAllEligible()}>
            {busy ? "Working…" : "Select all eligible results"}
          </button>
          <button className="vendor-primary-button vendor-compact-button" type="button" disabled={busy || selectedCount === 0} onClick={() => setConfirming(true)}>
            Add Selected
          </button>
        </div>
      </div>
      {confirming && (
        <div className="vendor-master-confirmation" role="group" aria-label="Confirm bulk add">
          <div><strong>Add {selectedCount} product{selectedCount === 1 ? "" : "s"} to My Store?</strong><span> This creates unpublished drafts only. {selectedExistingIds.length} already-present listing{selectedExistingIds.length === 1 ? " will" : "s will"} be skipped. Configure an exact selling quantity/unit, price, and stock for each new listing before it can be published.</span></div>
          <div className="vendor-row-actions">
            <button className="vendor-primary-button vendor-compact-button" type="button" disabled={busy} onClick={() => void runBulkAdd(selectedIds, false, true)}>Confirm add</button>
            <button className="vendor-secondary-button vendor-compact-button" type="button" disabled={busy} onClick={() => setConfirming(false)}>Cancel</button>
          </div>
        </div>
      )}
      {bulkResult && (
        <div className="vendor-master-bulk-result" role="status" aria-live="polite">
          <strong>Bulk add report</strong>
          <span>{bulkResult.succeeded.length} added · {bulkResult.skipped.length} skipped · {bulkResult.failed.length} failed</span>
          {bulkResult.succeeded.length > 0 && <span>Added: {formatResultNames(bulkResult.succeeded).join(", ")}</span>}
          {bulkResult.skipped.length > 0 && <span>Skipped (already listed or reused): {formatResultNames(bulkResult.skipped).join(", ")}</span>}
          {bulkResult.failed.length > 0 && (
            <>
              <span>Failed: {bulkResult.failed.map((item) => item.message).join("; ")}</span>
              <button className="vendor-secondary-button vendor-compact-button" type="button" disabled={busy} onClick={() => void runBulkAdd(bulkResult.failed.map((item) => item.id), true)}>Retry failed only</button>
            </>
          )}
        </div>
      )}

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
            {pageData.products.map((product) => {
              const listing = listingByMasterId.get(product.id);
              const eligible = isEligibleMasterProduct(product) && !listing;
              const selected = selectedIds.includes(product.id);
              return (
                <article className="vendor-master-product" key={product.id} data-testid={`card-master-product-${product.id}`}>
                  {product.image ? <img className="vendor-master-image" src={product.image} alt="" /> : <div className="vendor-master-image vendor-master-monogram" aria-hidden="true">{product.name.slice(0, 1).toUpperCase()}</div>}
                  <div className="vendor-master-product-copy">
                    <span className="vendor-master-category">{product.masterCategoryId === null ? "New product" : product.categoryName ?? categories.find((item) => item.id === product.masterCategoryId)?.name ?? "Unknown category"}</span>
                    <h3>{product.name}</h3>
                    {product.brand && <strong className="vendor-master-brand">{product.brand}</strong>}
                    {product.description && <p>{product.description}</p>}
                    {product.attributes?.details && <p>{product.attributes.details}</p>}
                    {!eligible && !listing && <span className="vendor-master-ineligible">{product.canAddToStore === false ? "Not currently available to add" : product.exactIdentity === false ? "Catalog identity needs review" : "Inactive catalog product"}</span>}
                  </div>
                  <div className="vendor-master-card-actions">
                    {listing ? (
                      <>
                        <span className="vendor-master-already-listed">Already in My Store</span>
                        <button className="vendor-secondary-button vendor-compact-button" type="button" aria-expanded={expandedListingIds.includes(listing.id) && !storeInlineActive} onClick={() => toggleListingEditor(listing.id)}>
                          {expandedListingIds.includes(listing.id) && !storeInlineActive ? "Hide selling options" : `Configure selling options (${listing.variants?.length ?? 0})`}
                        </button>
                      </>
                    ) : (
                      <>
                        <label className="vendor-master-select">
                          <input type="checkbox" aria-label={`Select ${product.name}`} checked={selected} disabled={!eligible || busy} onChange={(event) => toggleSelection(product.id, event.target.checked)} />
                          <span>Select</span>
                        </label>
                        <button className="vendor-secondary-button vendor-compact-button" type="button" disabled={!eligible || busy} onClick={() => void runBulkAdd([product.id])}>
                          {busy ? "Adding…" : "Add to My Store"}
                        </button>
                      </>
                    )}
                  </div>
                  {listing && mountedListingIds.includes(listing.id) && (
                    <div className="vendor-master-inline-editor" hidden={!expandedListingIds.includes(listing.id) || storeInlineActive}>
                      <SellingVariantEditor token={token} product={listing} idPrefix="master" onProductUpdated={onAdded} onMessage={onMessage} />
                    </div>
                  )}
                </article>
              );
            })}
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
