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

interface CanonicalDraft {
  masterCategoryId: string;
  name: string;
  description: string;
  image: string;
  brand: string;
  attributesText: string;
}

const freshDraft: CanonicalDraft = {
  masterCategoryId: "",
  name: "",
  description: "",
  image: "",
  brand: "",
  attributesText: "",
};

function canonicalBody(draft: CanonicalDraft) {
  let attributes: Record<string, string> = {};
  const raw = draft.attributesText.trim();
  if (raw) {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)
      || Object.values(parsed).some((value) => typeof value !== "string")) {
      throw new Error("Attributes must be a JSON object with text values.");
    }
    attributes = parsed as Record<string, string>;
  }
  return {
    masterCategoryId: draft.masterCategoryId,
    name: draft.name.trim(),
    ...(draft.description.trim() && { description: draft.description.trim() }),
    ...(draft.image.trim() && { image: draft.image.trim() }),
    ...(draft.brand.trim() && { brand: draft.brand.trim() }),
    attributes,
  };
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
  const [createOpen, setCreateOpen] = useState(false);
  const [draft, setDraft] = useState<CanonicalDraft>(freshDraft);
  const [matches, setMatches] = useState<MasterProduct[]>([]);
  const [reviewToken, setReviewToken] = useState("");
  const [confirmedNone, setConfirmedNone] = useState(false);
  const [checking, setChecking] = useState(false);
  const [creating, setCreating] = useState(false);

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
    if (categoryId) query.set("categoryId", categoryId);
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

  const clearReview = () => {
    setMatches([]);
    setReviewToken("");
    setConfirmedNone(false);
  };

  const updateDraft = (patch: Partial<CanonicalDraft>) => {
    setDraft((current) => ({ ...current, ...patch }));
    clearReview();
  };

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
        : `${listing.name} was added as an unavailable draft. Add a real selling option before publishing.`,
        "success");
    } catch (error) {
      onMessage(error instanceof Error ? error.message : "Unable to add this product.", "error");
    } finally {
      setBusyId("");
    }
  };

  const checkDuplicates = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setChecking(true);
    clearReview();
    try {
      const body = canonicalBody(draft);
      const response = await apiRequest<{ matches: MasterProduct[]; duplicateReviewToken: string }>(
        "/api/vendor/master-products/duplicate-check",
        token,
        { method: "POST", body: JSON.stringify(body) },
      );
      setMatches(response.matches);
      setReviewToken(response.duplicateReviewToken);
      setConfirmedNone(response.matches.length === 0);
    } catch (error) {
      onMessage(error instanceof Error ? error.message : "Could not check for similar products.", "error");
    } finally {
      setChecking(false);
    }
  };

  const createMissingProduct = async () => {
    if (!reviewToken || !confirmedNone || creating) return;
    setCreating(true);
    try {
      const body = canonicalBody(draft);
      const response = await apiRequest<{ product: MasterProduct }>(
        "/api/vendor/master-products",
        token,
        {
          method: "POST",
          body: JSON.stringify({ ...body, confirmedNoMatch: true, duplicateReviewToken: reviewToken }),
        },
      );
      clearReview();
      setCreateOpen(false);
      setDraft(freshDraft);
      await addMasterProduct(response.product.id);
      setPage(1);
      setReloadKey((current) => current + 1);
    } catch (error) {
      clearReview();
      onMessage(error instanceof Error
        ? `${error.message} Please review duplicates again before creating.`
        : "Unable to create the product. Please review duplicates again.", "error");
    } finally {
      setCreating(false);
    }
  };

  return (
    <section className="vendor-card vendor-master-catalog" aria-labelledby="master-catalog-title">
      <div className="vendor-card-heading vendor-master-heading">
        <div>
          <p className="vendor-eyebrow">Shared grocery identity</p>
          <h2 className="vendor-title-md" id="master-catalog-title">Master Catalog</h2>
          <p className="vendor-text-muted">Search first; category is only a filter. Selling units, price, and stock stay yours.</p>
        </div>
        <button className="vendor-primary-button" type="button" onClick={() => { setCreateOpen((open) => !open); clearReview(); }}>
          {createOpen ? "Close request form" : "Can’t find a product?"}
        </button>
      </div>
      <div className="vendor-master-search">
        <label className="vendor-label" htmlFor="master-product-search">Search all groceries</label>
        <input id="master-product-search" className="vendor-input" type="search" placeholder="Try rice, milk, brand, or product detail" value={searchText} onChange={(event) => setSearchText(event.target.value)} />
        <label className="vendor-label" htmlFor="master-category-filter">Category filter <span className="vendor-text-muted vendor-font-normal">optional</span></label>
        <select id="master-category-filter" className="vendor-select" value={categoryId} onChange={(event) => { setCategoryId(event.target.value); setPage(1); }}>
          <option value="">Every category</option>
          {categories.filter((category) => category.isActive).map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
        </select>
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
                  <span className="vendor-master-category">{product.categoryName ?? categories.find((item) => item.id === product.masterCategoryId)?.name ?? "Grocery"}</span>
                  <h3>{product.name}</h3>
                  {product.brand && <strong className="vendor-master-brand">{product.brand}</strong>}
                  {product.description && <p>{product.description}</p>}
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
          <strong>No matching groceries</strong>
          <span>Try a broader search, or request a canonical product after checking for duplicates.</span>
        </div>
      )}

      {createOpen && (
        <form className="vendor-master-request" onSubmit={checkDuplicates}>
          <div>
            <p className="vendor-eyebrow">Add to shared catalog</p>
            <h3 className="vendor-subtitle">Describe the grocery, not the pack size</h3>
            <p className="vendor-text-muted">A product request creates a platform-wide identity. Set your own unit and commercial details after adding it.</p>
          </div>
          <div className="vendor-two-column">
            <label className="vendor-label">Master category
              <select className="vendor-select" required value={draft.masterCategoryId} onChange={(event) => updateDraft({ masterCategoryId: event.target.value })}>
                <option value="">Choose a category</option>
                {categories.filter((category) => category.isActive).map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
              </select>
            </label>
            <label className="vendor-label">Canonical product name
              <input className="vendor-input" required maxLength={180} value={draft.name} onChange={(event) => updateDraft({ name: event.target.value })} />
            </label>
          </div>
          <div className="vendor-two-column">
            <label className="vendor-label">Brand <span className="vendor-text-muted vendor-font-normal">optional</span>
              <input className="vendor-input" maxLength={120} value={draft.brand} onChange={(event) => updateDraft({ brand: event.target.value })} />
            </label>
            <label className="vendor-label">Image URL <span className="vendor-text-muted vendor-font-normal">optional</span>
              <input className="vendor-input" type="url" value={draft.image} onChange={(event) => updateDraft({ image: event.target.value })} />
            </label>
          </div>
          <label className="vendor-label">Description <span className="vendor-text-muted vendor-font-normal">optional</span>
            <textarea className="vendor-textarea" rows={2} value={draft.description} onChange={(event) => updateDraft({ description: event.target.value })} />
          </label>
          <label className="vendor-label">Discovery attributes <span className="vendor-text-muted vendor-font-normal">optional JSON object; text values only</span>
            <textarea className="vendor-textarea" rows={2} placeholder={'{"type":"whole grain"}'} value={draft.attributesText} onChange={(event) => updateDraft({ attributesText: event.target.value })} />
          </label>
          <div className="vendor-form-actions">
            <button className="vendor-primary-button" type="submit" disabled={checking || creating}>{checking ? "Checking catalog…" : "Check for duplicates"}</button>
          </div>
          {reviewToken && (
            <div className="vendor-duplicate-review" role="status">
              {matches.length ? (
                <>
                  <h4>Possible matches · choose one if it is right</h4>
                  {matches.map((match) => {
                    const categoryIsActive = match.categoryIsActive
                      ?? categories.find((category) => category.id === match.masterCategoryId)?.isActive
                      ?? true;
                    const canUse = match.canAddToStore ?? (match.isActive && categoryIsActive);
                    return (
                      <div className="vendor-match-row vendor-match-detail" key={match.id}>
                        <div className="vendor-match-copy">
                          <strong>{match.name}{match.exactIdentity ? " · Exact identity" : ""}</strong>
                          {match.brand && <small>Brand: {match.brand}</small>}
                          <small>Category: {match.categoryName ?? categories.find((category) => category.id === match.masterCategoryId)?.name ?? "Unknown"} · {categoryIsActive ? "Active" : "Archived"}</small>
                          {Object.entries(match.attributes ?? {}).length > 0 && (
                            <dl className="vendor-match-attributes">
                              {Object.entries(match.attributes).map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{value}</dd></div>)}
                            </dl>
                          )}
                          {!canUse && (
                            <p className="vendor-match-archived" role="note">
                              {match.exactIdentity
                                ? "An exact match exists, but it is archived. Ask a platform admin to restore the product and its category before using it."
                                : `Unavailable for new store selection: ${!match.isActive ? "product archived" : "category archived"}. Ask a platform admin to restore it.`}
                            </p>
                          )}
                        </div>
                        {canUse && <button className="vendor-secondary-button vendor-compact-button" type="button" onClick={() => { setCreateOpen(false); void addMasterProduct(match.id); }}>Use this product</button>}
                      </div>
                    );
                  })}
                  <label className="vendor-master-confirm">
                    <input type="checkbox" checked={confirmedNone} onChange={(event) => setConfirmedNone(event.target.checked)} />
                    None of these is the product I need
                  </label>
                </>
              ) : <p>No likely match found. Confirm this is a genuinely different grocery before adding it.</p>}
              <button className="vendor-primary-button" type="button" disabled={!confirmedNone || creating} onClick={() => void createMissingProduct()}>
                {creating ? "Creating…" : "Confirm no suitable match & create"}
              </button>
            </div>
          )}
        </form>
      )}
    </section>
  );
}