import { useCallback, useEffect, useState } from "react";
import { AdminCatalogExcelPanel } from "./AdminCatalogExcelPanel";
import { apiRequest, type MasterCategory, type MasterProduct, type Product } from "./api";

interface Props {
  token: string;
  onMessage: (message: string, kind?: "success" | "error") => void;
}

interface ProductsPage {
  products: MasterProduct[];
  pagination: { page: number; pageSize: number; total: number };
}

interface ProductDraft {
  masterCategoryId: string;
  name: string;
  description: string;
  image: string;
  brand: string;
  attributes: string;
}

const emptyProduct: ProductDraft = {
  masterCategoryId: "",
  name: "",
  description: "",
  image: "",
  brand: "",
  attributes: "{}",
};

export function AdminMasterCatalogPanel({ token, onMessage }: Props) {
  const [categories, setCategories] = useState<MasterCategory[]>([]);
  const [productsPage, setProductsPage] = useState<ProductsPage | null>(null);
  const [search, setSearch] = useState("");
  const [productStatus, setProductStatus] = useState("active");
  const [productCategory, setProductCategory] = useState("");
  const [categorySearch, setCategorySearch] = useState("");
  const [categoryStatus, setCategoryStatus] = useState("active");
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [categoryName, setCategoryName] = useState("");
  const [editingCategory, setEditingCategory] = useState("");
  const [categoryBusy, setCategoryBusy] = useState(false);
  const [draft, setDraft] = useState<ProductDraft>(emptyProduct);
  const [editingProductId, setEditingProductId] = useState("");
  const [editingOriginalCategoryId, setEditingOriginalCategoryId] = useState<string | null>(null);
  const [productBusy, setProductBusy] = useState(false);
  const [rowBusy, setRowBusy] = useState("");
  const [mappingProductId, setMappingProductId] = useState("");
  const [mappingMasterId, setMappingMasterId] = useState("");
  const [mappingReason, setMappingReason] = useState("");
  const [mappingBusy, setMappingBusy] = useState(false);
  const loadCategories = useCallback(async () => {
    const response = await apiRequest<{ categories: MasterCategory[] }>("/api/admin/master-categories", token);
    setCategories(response.categories);
  }, [token]);

  const loadProducts = useCallback(async () => {
    setLoading(true);
    setError("");
    const query = new URLSearchParams({ page: String(page), pageSize: "20" });
    query.set("status", productStatus);
    if (productCategory) query.set("categoryId", productCategory);
    if (search.trim()) query.set("search", search.trim());
    try {
      const response = await apiRequest<ProductsPage>(`/api/admin/master-products?${query.toString()}`, token);
      setProductsPage(response);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to load master products.");
    } finally {
      setLoading(false);
    }
  }, [page, search, productStatus, productCategory, token]);
  const refreshAfterImport = useCallback(() => {
    void loadCategories();
    void loadProducts();
  }, [loadCategories, loadProducts]);

  useEffect(() => {
    let alive = true;
    apiRequest<{ categories: MasterCategory[] }>("/api/admin/master-categories", token)
      .then((response) => { if (alive) setCategories(response.categories); })
      .catch((reason) => { if (alive) onMessage(reason instanceof Error ? reason.message : "Unable to load master categories.", "error"); });
    return () => { alive = false; };
  }, [token, onMessage]);

  useEffect(() => { void loadProducts(); }, [loadProducts]);

  const editProduct = (product: MasterProduct) => {
    setEditingProductId(product.id);
    setEditingOriginalCategoryId(product.masterCategoryId);
    setDraft({
      masterCategoryId: product.masterCategoryId ?? "",
      name: product.name,
      description: product.description ?? "",
      image: product.image ?? "",
      brand: product.brand ?? "",
      attributes: JSON.stringify(product.attributes ?? {}, null, 2),
    });
    document.querySelector(".admin-master-product-form")?.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  const saveCategory = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!categoryName.trim() || categoryBusy) return;
    setCategoryBusy(true);
    try {
      if (editingCategory) {
        const response = await apiRequest<{ category: MasterCategory }>(`/api/admin/master-categories/${editingCategory}`, token, {
          method: "PATCH", body: JSON.stringify({ name: categoryName.trim() }),
        });
        setCategories((items) => items.map((item) => item.id === response.category.id ? { ...item, ...response.category } : item));
        onMessage("Master category updated.", "success");
      } else {
        const response = await apiRequest<{ category: MasterCategory }>("/api/admin/master-categories", token, {
          method: "POST", body: JSON.stringify({ name: categoryName.trim() }),
        });
        setCategories((items) => [...items, { ...response.category, productCount: 0 }].sort((a, b) => a.name.localeCompare(b.name)));
        onMessage("Master category created.", "success");
      }
      setCategoryName("");
      setEditingCategory("");
    } catch (reason) {
      onMessage(reason instanceof Error ? reason.message : "Unable to save master category.", "error");
    } finally {
      setCategoryBusy(false);
    }
  };

  const toggleCategory = async (category: MasterCategory) => {
    setRowBusy(category.id);
    const action = category.isActive ? "archive" : "unarchive";
    try {
      const response = await apiRequest<{ category: MasterCategory }>(`/api/admin/master-categories/${category.id}/${action}`, token, { method: "POST" });
      setCategories((items) => items.map((item) => item.id === category.id ? { ...item, ...response.category } : item));
      onMessage(`Master category ${category.isActive ? "archived" : "restored"}. Existing relationships were retained.`, "success");
    } catch (reason) {
      onMessage(reason instanceof Error ? reason.message : "Unable to update category status.", "error");
    } finally {
      setRowBusy("");
    }
  };

  const saveProduct = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (productBusy) return;
    setProductBusy(true);
    try {
      const parsed: unknown = JSON.parse(draft.attributes || "{}");
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)
        || Object.values(parsed).some((value) => typeof value !== "string")) {
        throw new Error("Attributes must be a JSON object with text values.");
      }
      const categoryId = draft.masterCategoryId || null;
      const body = {
        ...(!editingProductId || categoryId !== editingOriginalCategoryId
          ? { masterCategoryId: draft.masterCategoryId }
          : {}),
        name: draft.name.trim(),
        description: draft.description.trim() || null,
        image: draft.image.trim() || null,
        brand: draft.brand.trim() || null,
        attributes: parsed as Record<string, string>,
      };
      const response = await apiRequest<{ product: MasterProduct }>(
        editingProductId ? `/api/admin/master-products/${editingProductId}` : "/api/admin/master-products",
        token,
        { method: editingProductId ? "PATCH" : "POST", body: JSON.stringify(body) },
      );
      setProductsPage((current) => current ? {
        ...current,
        products: current.products.some((item) => item.id === response.product.id)
          ? current.products.map((item) => item.id === response.product.id ? response.product : item)
          : [response.product, ...current.products],
      } : current);
      setDraft(emptyProduct);
      setEditingProductId("");
      setEditingOriginalCategoryId(null);
      onMessage(editingProductId ? "Master product updated." : "Master product created.", "success");
      void loadCategories();
      void loadProducts();
    } catch (reason) {
      onMessage(reason instanceof Error ? reason.message : "Unable to save master product.", "error");
    } finally {
      setProductBusy(false);
    }
  };

  const toggleProduct = async (product: MasterProduct) => {
    setRowBusy(product.id);
    const action = product.isActive ? "archive" : "unarchive";
    try {
      const response = await apiRequest<{ product: MasterProduct }>(`/api/admin/master-products/${product.id}/${action}`, token, { method: "POST" });
      setProductsPage((current) => current ? {
        ...current,
        products: current.products.map((item) => item.id === product.id ? response.product : item),
      } : current);
      onMessage(`Master product ${product.isActive ? "archived" : "restored"}. Existing store listings remain unchanged.`, "success");
      void loadProducts();
    } catch (reason) {
      onMessage(reason instanceof Error ? reason.message : "Unable to update product status.", "error");
    } finally {
      setRowBusy("");
    }
  };

  const correctMapping = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (mappingBusy) return;
    setMappingBusy(true);
    try {
      const response = await apiRequest<{ product: Product }>(`/api/admin/products/${mappingProductId}/master-mapping`, token, {
        method: "PATCH",
        body: JSON.stringify({ masterProductId: mappingMasterId, reason: mappingReason.trim() }),
      });
      onMessage(`Product mapping corrected for listing ${response.product.id}. Historical order snapshots were not changed.`, "success");
      setMappingProductId("");
      setMappingMasterId("");
      setMappingReason("");
    } catch (reason) {
      onMessage(reason instanceof Error ? reason.message : "Unable to correct product mapping.", "error");
    } finally {
      setMappingBusy(false);
    }
  };

  const totalPages = Math.max(1, Math.ceil((productsPage?.pagination.total ?? 0) / (productsPage?.pagination.pageSize ?? 20)));
  const visibleCategories = categories.filter((category) =>
    category.name.toLocaleLowerCase().includes(categorySearch.trim().toLocaleLowerCase())
    && (categoryStatus === "all" || category.isActive === (categoryStatus === "active")));

  return (
    <section className="management-section admin-master-catalog" aria-label="Master catalog administration">
      <AdminCatalogExcelPanel token={token} onApplied={refreshAfterImport} />
      <div className="section-heading">
        <div>
          <p className="eyebrow">Platform catalog</p>
          <h2>Master Catalog · Platform identities</h2>
          <p className="muted">Manage platform-wide shared grocery identities and taxonomy. Archive instead of deleting; store-owned listings and historical orders remain independent.</p>
        </div>
        <button className="secondary-button" type="button" disabled={loading} onClick={() => { void loadCategories(); void loadProducts(); }}>Refresh catalog</button>
      </div>

      <div className="catalog-grid">
        <section className="card" aria-labelledby="master-categories-heading">
          <div className="card-heading"><div><h3 id="master-categories-heading">Platform Master Categories</h3><p className="muted">Admin-owned taxonomy. Archived categories remain available for review and restoration.</p></div><span className="count-pill">{visibleCategories.length}</span></div>
          <form className="inline-form" onSubmit={saveCategory}>
            <input aria-label="Master category name" required maxLength={100} placeholder="Category name" value={categoryName} onChange={(event) => setCategoryName(event.target.value)} />
            <button className="primary-button" type="submit" disabled={categoryBusy}>{categoryBusy ? "Saving…" : editingCategory ? "Save" : "Add category"}</button>
            {editingCategory && <button className="text-button" type="button" onClick={() => { setEditingCategory(""); setCategoryName(""); }}>Cancel</button>}
          </form>
          <div className="order-toolbar">
            <label>Search categories<input type="search" placeholder="Category name" value={categorySearch} onChange={(event) => setCategorySearch(event.target.value)} /></label>
            <label>Category status<select value={categoryStatus} onChange={(event) => setCategoryStatus(event.target.value)}><option value="active">Active</option><option value="archived">Archived</option><option value="all">All statuses</option></select></label>
          </div>
          <div className="category-list">
            {visibleCategories.length === 0 ? <div className="empty-state compact"><strong>No categories match</strong><span>Create your own category or change the search/status filter.</span></div> : visibleCategories.map((category) => (
              <div className="category-row" key={category.id}>
                <div><strong>{category.name}</strong><span>{category.productCount} master products</span><span className={`lifecycle-dot ${category.isActive ? "is-active" : ""}`}>{category.isActive ? "Active" : "Archived"}</span></div>
                <div className="row-actions">
                  <button className="text-button" type="button" onClick={() => { setEditingCategory(category.id); setCategoryName(category.name); }}>Edit</button>
                  <button className={category.isActive ? "danger-button compact-button" : "secondary-button compact-button"} type="button" disabled={rowBusy === category.id} onClick={() => void toggleCategory(category)}>{rowBusy === category.id ? "Working…" : category.isActive ? "Archive" : "Unarchive"}</button>
                </div>
              </div>
            ))}
          </div>
        </section>

        <form className="card form-card admin-master-product-form" onSubmit={saveProduct}>
          <div className="card-heading"><div><h3>{editingProductId ? "View / edit master product" : "Create master product"}</h3><p className="muted">Canonical identity only. Price, stock, and sellable unit belong to each store. Pending products can be reviewed here and assigned an active category.</p></div>{editingProductId && <button className="text-button" type="button" onClick={() => { setEditingProductId(""); setEditingOriginalCategoryId(null); setDraft(emptyProduct); }}>Cancel edit</button>}</div>
          <label>Master category<select required={!editingProductId} value={draft.masterCategoryId} onChange={(event) => setDraft((current) => ({ ...current, masterCategoryId: event.target.value }))}>
            {editingProductId && editingOriginalCategoryId === null
              ? <option value="">Pending classification (no category assigned)</option>
              : <option value="">Select a category</option>}
            {categories.filter((category) => category.isActive || (editingProductId && category.id === editingOriginalCategoryId)).map((category) => <option key={category.id} value={category.id}>{category.name}{category.isActive ? "" : " (Archived — existing products only)"}</option>)}
          </select></label>
          <label>Canonical name<input required maxLength={180} value={draft.name} onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} /></label>
          <label>Brand<input maxLength={120} value={draft.brand} onChange={(event) => setDraft((current) => ({ ...current, brand: event.target.value }))} /></label>
          <label>Image URL<input type="url" value={draft.image} onChange={(event) => setDraft((current) => ({ ...current, image: event.target.value }))} /></label>
          <label>Description<textarea rows={2} value={draft.description} onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))} /></label>
          <label>Discovery attributes <span className="muted">JSON object with string values</span><textarea rows={3} value={draft.attributes} onChange={(event) => setDraft((current) => ({ ...current, attributes: event.target.value }))} /></label>
          <button className="primary-button" type="submit" disabled={productBusy || (!editingProductId && categories.filter((category) => category.isActive).length === 0)}>{productBusy ? "Saving…" : editingProductId ? "Save changes" : "Create master product"}</button>
        </form>
      </div>

      <section className="card product-list-card" aria-labelledby="master-products-heading">
        <div className="card-heading"><div><h3 id="master-products-heading">Platform Master Products</h3><p className="muted">Global searchable platform identities. Pending classification is a valid temporary state; pack size is configured as a store variant.</p></div><span className="count-pill">{productsPage?.pagination.total ?? 0}</span></div>
        <div className="order-toolbar">
          <label>Search catalog<input type="search" placeholder="Name, brand, or discovery detail" value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} /></label>
          <label>Product status<select value={productStatus} onChange={(event) => { setProductStatus(event.target.value); setPage(1); }}><option value="active">Active</option><option value="archived">Archived</option><option value="all">All statuses</option></select></label>
          <label>Product category<select value={productCategory} onChange={(event) => { setProductCategory(event.target.value); setPage(1); }}><option value="">All categories, including pending</option>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}{category.isActive ? "" : " (Archived)"}</option>)}</select></label>
        </div>
        {error ? <div className="empty-state compact" role="alert"><strong>Unable to load products</strong><span>{error}</span><button className="secondary-button" type="button" onClick={() => void loadProducts()}>Retry</button></div>
          : loading ? <div className="vendor-master-skeleton" aria-label="Loading master products"><i /><i /><i /></div>
            : !productsPage?.products.length ? <div className="empty-state compact"><strong>No products match</strong><span>Try a different search or create a canonical master product.</span></div>
              : <div className="admin-master-product-list">{productsPage.products.map((product) => (
                <article className="admin-master-product-row" key={product.id} data-testid={`row-master-product-${product.id}`}>
                  <div className="product-identity">
                    {product.image ? <img src={product.image} alt="" /> : <div className="product-placeholder" aria-hidden="true">{product.name.slice(0, 1).toUpperCase()}</div>}
                    <div><strong>{product.name}</strong><span>{product.brand || "Unbranded"} · {product.masterCategoryId === null ? "Pending classification" : product.categoryName ?? categories.find((category) => category.id === product.masterCategoryId)?.name ?? "Unknown category"}</span></div>
                  </div>
                  <span className={`lifecycle-dot ${product.isActive ? "is-active" : ""}`}>{product.isActive ? "Active" : "Archived"}</span>
                  <div className="row-actions">
                    <button className="secondary-button compact-button" type="button" onClick={() => editProduct(product)}>View / edit</button>
                    <button className={product.isActive ? "danger-button compact-button" : "secondary-button compact-button"} type="button" disabled={rowBusy === product.id} onClick={() => void toggleProduct(product)}>{rowBusy === product.id ? "Working…" : product.isActive ? "Archive" : "Unarchive"}</button>
                  </div>
                </article>
              ))}</div>}
        <div className="order-pagination">
          <button className="secondary-button" type="button" disabled={page <= 1 || loading} onClick={() => setPage((current) => current - 1)}>Previous</button>
          <span className="muted">Page {page} of {totalPages}</span>
          <button className="secondary-button" type="button" disabled={page >= totalPages || loading} onClick={() => setPage((current) => current + 1)}>Next</button>
        </div>
      </section>

      <form className="card mapping-correction-form" onSubmit={correctMapping}>
        <div className="card-heading"><div><h3>Correct a legacy mapping</h3><p className="muted">Use only for clerical correction. This changes identity mapping, never historical snapshots.</p></div></div>
        <div className="two-column">
          <label>Store product ID<input required value={mappingProductId} onChange={(event) => setMappingProductId(event.target.value)} placeholder="Listing UUID" /></label>
          <label>Correct master product<select required value={mappingMasterId} onChange={(event) => setMappingMasterId(event.target.value)}><option value="">Select master identity</option>{(productsPage?.products ?? []).map((product) => <option key={product.id} value={product.id}>{product.name}{product.brand ? ` · ${product.brand}` : ""}</option>)}</select></label>
        </div>
        <label>Audit reason<textarea required minLength={8} value={mappingReason} onChange={(event) => setMappingReason(event.target.value)} /></label>
        <button className="secondary-button" type="submit" disabled={mappingBusy}>{mappingBusy ? "Recording correction…" : "Save audited mapping correction"}</button>
      </form>
    </section>
  );
}