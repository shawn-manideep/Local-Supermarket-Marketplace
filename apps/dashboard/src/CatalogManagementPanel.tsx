import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { filterVendorProducts } from "./vendor-product-search";
import { formatPrice } from "@workspace/validation/variant-formatting";
import { apiRequest, type Category, type Product } from "./api";
import { SellingVariantEditor } from "./SellingVariantEditor";
import { VendorMasterCatalogPanel } from "./VendorMasterCatalogPanel";
import { VendorNewProductPanel } from "./VendorNewProductPanel";
import { isAllowedProductImageReference, VendorProductImageInput } from "./VendorProductImageInput";

interface CatalogManagementPanelProps {
  token: string;
  storeId: string;
  onMessage: (message: string, kind?: "success" | "error") => void;
}

interface ProductDraft {
  name: string;
  description: string;
  sku: string;
  externalCode: string;
  price: string;
  stockQuantity: string;
  imageUrl: string;
  categoryId: string;
  availability: boolean;
}

const emptyProductDraft: ProductDraft = {
  name: "",
  description: "",
  sku: "",
  externalCode: "",
  price: "0.00",
  stockQuantity: "0",
  imageUrl: "",
  categoryId: "",
  availability: true,
};

function draftFromProduct(product: Product): ProductDraft {
  return {
    name: product.name,
    description: product.masterProductId
      ? product.descriptionOverride ?? ""
      : product.description ?? "",
    sku: product.sku ?? "",
    externalCode: product.externalCode ?? "",
    price: product.price,
    stockQuantity: String(product.stockQuantity),
    imageUrl: product.masterProductId
      ? product.imageOverride ?? ""
      : product.imageUrl ?? "",
    categoryId: product.categoryId ?? "",
    availability: product.availability,
  };
}

function sortByName<T extends { name: string }>(items: T[]) {
  return [...items].sort((left, right) => left.name.localeCompare(right.name));
}

export function CatalogManagementPanel({
  token,
  storeId,
  onMessage,
}: CatalogManagementPanelProps) {
  const [categories, setCategories] = useState<Category[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [categoryName, setCategoryName] = useState("");
  const [editingCategoryId, setEditingCategoryId] = useState("");
  const [editingCategoryName, setEditingCategoryName] = useState("");
  const [productDraft, setProductDraft] = useState<ProductDraft>(emptyProductDraft);
  const [editingProductId, setEditingProductId] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [productSearch, setProductSearch] = useState("");
  const [expandedVariantProductId, setExpandedVariantProductId] = useState("");
  const [mountedVariantProductIds, setMountedVariantProductIds] = useState<string[]>([]);
  const [addProductMode, setAddProductMode] = useState<"choose" | "master" | "new">("choose");
  const productSaveBusyRef = useRef(false);

  useEffect(() => {
    let current = true;
    setCategories([]);
    setProducts([]);
    setLoading(true);
    setEditingCategoryId("");
    setEditingProductId("");
    setProductDraft(emptyProductDraft);
    setCategoryFilter("all");

    void Promise.all([
      apiRequest<{ categories: Category[] }>("/api/vendor/categories", token),
      apiRequest<{ products: Product[] }>("/api/vendor/products", token),
    ])
      .then(([categoryResponse, productResponse]) => {
        if (!current) return;
        setCategories(sortByName(categoryResponse.categories));
        setProducts(sortByName(productResponse.products));
      })
      .catch((error) => {
        if (!current) return;
        onMessage(
          error instanceof Error ? error.message : "Unable to load catalog.",
          "error",
        );
      })
      .finally(() => {
        if (current) setLoading(false);
      });

    return () => {
      current = false;
    };
  }, [storeId, token]);

  const categoryNames = useMemo(
    () => new Map(categories.map((category) => [category.id, category.name])),
    [categories],
  );

  const visibleProducts = useMemo(() => filterVendorProducts(products, categoryFilter, productSearch),
    [categoryFilter, productSearch, products]);
  const currentEditingProduct = products.find((product) => product.id === editingProductId);
  const editingMappedProduct = Boolean(currentEditingProduct?.masterProductId);

  const upsertCategory = (category: Category) => {
    setCategories((current) =>
      sortByName(
        current.some((item) => item.id === category.id)
          ? current.map((item) => (item.id === category.id ? category : item))
          : [...current, category],
      ),
    );
  };

  const upsertProduct = (product: Product) => {
    setProducts((current) =>
      sortByName(
        current.some((item) => item.id === product.id)
          ? current.map((item) => (
            item.id === product.id
              ? { ...item, ...product, variants: product.variants ?? item.variants }
              : item
          ))
          : [...current, product],
      ),
    );
  };

  const [categoryAddBusy, setCategoryAddBusy] = useState(false);
  const [categoryEditBusy, setCategoryEditBusy] = useState(false);
  const [categoryToggleBusyId, setCategoryToggleBusyId] = useState("");
  const [productSaveBusy, setProductSaveBusy] = useState(false);
  const [imageUploading, setImageUploading] = useState(false);
  const [productToggleBusyId, setProductToggleBusyId] = useState("");
  const [availabilityBusyId, setAvailabilityBusyId] = useState("");

  const addCategory = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!categoryName.trim() || categoryAddBusy) return;
    setCategoryAddBusy(true);
    try {
      const response = await apiRequest<{ category: Category }>(
        "/api/vendor/categories",
        token,
        { method: "POST", body: JSON.stringify({ name: categoryName.trim() }) },
      );
      upsertCategory(response.category);
      setCategoryName("");
      onMessage("Category created.", "success");
    } catch (error) {
      onMessage(error instanceof Error ? error.message : "Unable to create category.", "error");
    } finally {
      setCategoryAddBusy(false);
    }
  };

  const saveCategory = async (categoryId: string) => {
    if (categoryEditBusy) return;
    setCategoryEditBusy(true);
    try {
      const response = await apiRequest<{ category: Category }>(
        `/api/vendor/categories/${categoryId}`,
        token,
        { method: "PATCH", body: JSON.stringify({ name: editingCategoryName.trim() }) },
      );
      upsertCategory(response.category);
      setEditingCategoryId("");
      onMessage("Category updated.", "success");
    } catch (error) {
      onMessage(error instanceof Error ? error.message : "Unable to update category.", "error");
    } finally {
      setCategoryEditBusy(false);
    }
  };

  const toggleCategory = async (category: Category) => {
    if (categoryToggleBusyId) return;
    if (
      category.isActive &&
      !window.confirm("Deactivate this category? Its products will remain intact.")
    ) {
      return;
    }
    setCategoryToggleBusyId(category.id);
    const action = category.isActive ? "deactivate" : "activate";
    try {
      const response = await apiRequest<{ category: Category }>(
        `/api/vendor/categories/${category.id}/${action}`,
        token,
        { method: "POST" },
      );
      upsertCategory(response.category);
      onMessage(`Category ${action}d.`, "success");
    } catch (error) {
      onMessage(error instanceof Error ? error.message : "Unable to update category.", "error");
    } finally {
      setCategoryToggleBusyId("");
    }
  };

  const resetProductForm = () => {
    setEditingProductId("");
    setProductDraft(emptyProductDraft);
  };

  const saveProduct = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (productSaveBusyRef.current || imageUploading) return;
    if (!isAllowedProductImageReference(productDraft.imageUrl)) {
      onMessage("Product image URLs must use HTTP or HTTPS.", "error");
      return;
    }
    const editedProduct = products.find((product) => product.id === editingProductId);
    const hasMultipleVariants = (editedProduct?.variants?.length ?? 0) > 1;
    const body: Record<string, unknown> = editedProduct?.masterProductId
      ? {
        ...(productDraft.description.trim() !== (editedProduct.descriptionOverride ?? "")
          ? { description: productDraft.description.trim() || null }
          : {}),
        ...(productDraft.imageUrl.trim() !== (editedProduct.imageOverride ?? "")
          ? { imageUrl: productDraft.imageUrl.trim() || null }
          : {}),
        ...(productDraft.sku.trim() !== (editedProduct.sku ?? "")
          ? { sku: productDraft.sku.trim() || null }
          : {}),
        ...(productDraft.externalCode.trim() !== (editedProduct.externalCode ?? "")
          ? { externalCode: productDraft.externalCode.trim() || null }
          : {}),
        ...(productDraft.availability !== editedProduct.availability
          ? { availability: productDraft.availability }
          : {}),
        ...((productDraft.categoryId || null) !== editedProduct.categoryId
          ? { categoryId: productDraft.categoryId || null }
          : {}),
      }
      : {
        name: productDraft.name,
        description: productDraft.description.trim() || null,
        sku: productDraft.sku.trim() || null,
        externalCode: productDraft.externalCode.trim() || null,
        availability: productDraft.availability,
        imageUrl: productDraft.imageUrl.trim() || null,
        categoryId: productDraft.categoryId || null,
        ...(!hasMultipleVariants && {
          price: Number(productDraft.price),
          stockQuantity: Number(productDraft.stockQuantity),
        }),
      };

    if (Object.keys(body).length === 0) {
      onMessage("No store listing changes to save.", "success");
      resetProductForm();
      return;
    }
    productSaveBusyRef.current = true;
    setProductSaveBusy(true);

    try {
      const response = await apiRequest<{ product: Product }>(
        editingProductId
          ? `/api/vendor/products/${editingProductId}`
          : "/api/vendor/products",
        token,
        {
          method: editingProductId ? "PATCH" : "POST",
          body: JSON.stringify(body),
        },
      );
      upsertProduct(response.product);
      resetProductForm();
      onMessage(editingProductId ? "Product updated." : "Product created.", "success");
    } catch (error) {
      onMessage(error instanceof Error ? error.message : "Unable to save product.", "error");
    } finally {
      productSaveBusyRef.current = false;
      setProductSaveBusy(false);
    }
  };

  const toggleProductActive = async (product: Product) => {
    if (productToggleBusyId) return;
    if (!product.isActive && product.masterProductId) {
      setExpandedVariantProductId(product.id);
      setMountedVariantProductIds((current) => current.includes(product.id) ? current : [...current, product.id]);
      return;
    }
    if (
      product.isActive &&
      !window.confirm("Deactivate this product? It will remain stored for historical references.")
    ) {
      return;
    }
    setProductToggleBusyId(product.id);
    const action = product.isActive ? "deactivate" : "activate";
    try {
      const response = await apiRequest<{ product: Product }>(
        `/api/vendor/products/${product.id}/${action}`,
        token,
        { method: "POST" },
      );
      upsertProduct(response.product);
      onMessage(`Product ${action}d.`, "success");
    } catch (error) {
      onMessage(error instanceof Error ? error.message : "Unable to update product.", "error");
    } finally {
      setProductToggleBusyId("");
    }
  };

  const toggleAvailability = async (product: Product) => {
    if (availabilityBusyId) return;
    setAvailabilityBusyId(product.id);
    try {
      const response = await apiRequest<{ product: Product }>(
        `/api/vendor/products/${product.id}/availability`,
        token,
        {
          method: "PATCH",
          body: JSON.stringify({ availability: !product.availability }),
        },
      );
      upsertProduct(response.product);
      onMessage(
        response.product.availability
          ? "Product is available."
          : "Product marked temporarily unavailable.",
        "success"
      );
    } catch (error) {
      onMessage(error instanceof Error ? error.message : "Unable to update availability.", "error");
    } finally {
      setAvailabilityBusyId("");
    }
  };

  if (loading) {
    return <div className="vendor-loading">Loading catalog environment...</div>;
  }

  const handleMasterProductAdded = (product: Product) => {
    upsertProduct(product);
    setCategoryFilter("all");
    setExpandedVariantProductId("");
  };

  return (
    <div className="vendor-catalog-section">
      <div className="vendor-section-header vendor-catalog-header">
        <div>
          <h2 className="vendor-title">My Store Products</h2>
          <p className="vendor-text-muted">Manage the products you sell, including their prices, stock, selling options, and availability.</p>
        </div>
        <div className="vendor-catalog-summary">
          <span><strong>{categories.length}</strong> Store categories</span>
          <span><strong>{products.length}</strong> My Store products</span>
        </div>
      </div>

      <section className="vendor-card vendor-add-product-chooser" aria-labelledby="add-product-title">
        <div className="vendor-card-heading">
          <div>
            <h3 className="vendor-subtitle" id="add-product-title">+ Add Product</h3>
            <p className="vendor-text-muted">Choose a shared catalog item or create a store-only product.</p>
          </div>
          {addProductMode !== "choose" && (
            <button type="button" className="vendor-text-button" onClick={() => setAddProductMode("choose")}>Back to options</button>
          )}
        </div>
        <div className="vendor-add-product-options">
          <button type="button" className={`vendor-add-product-option ${addProductMode === "master" ? "selected" : ""}`} aria-pressed={addProductMode === "master"} onClick={() => setAddProductMode("master")}>
            <strong>Select from Master Catalog</strong>
            <span>Choose an approved shared product and configure its store listing.</span>
          </button>
          <button type="button" className={`vendor-add-product-option ${addProductMode === "new" ? "selected" : ""}`} aria-pressed={addProductMode === "new"} onClick={() => setAddProductMode("new")}>
            <strong>Add New Product</strong>
            <span>Create a product visible only in your store.</span>
          </button>
        </div>
      </section>
      {addProductMode === "master" && (
        <VendorMasterCatalogPanel
          token={token}
          products={products}
          storeInlineActive={Boolean(expandedVariantProductId)}
          onAdded={handleMasterProductAdded}
          onListingConfigured={() => setExpandedVariantProductId("")}
          onMessage={onMessage}
        />
      )}
      {addProductMode === "new" && (
        <VendorNewProductPanel
          token={token}
          categories={categories}
          onAdded={(product) => {
            upsertProduct(product);
            setAddProductMode("choose");
            setCategoryFilter("all");
            setExpandedVariantProductId(product.id);
          }}
          onMessage={onMessage}
        />
      )}

      <div className="vendor-card vendor-category-panel">
        <div className="vendor-card-heading">
          <div>
            <h3 className="vendor-subtitle">Store Categories</h3>
            <p className="vendor-text-muted">Use categories to organize products in your store.</p>
          </div>
        </div>
        <form className="vendor-inline-form" onSubmit={addCategory}>
          <input
            className="vendor-input"
            aria-label="Category name"
            onChange={(event) => setCategoryName(event.target.value)}
            placeholder="Create a new category"
            required
            value={categoryName}
          />
          <button className="vendor-primary-button" type="submit" disabled={categoryAddBusy}>
            {categoryAddBusy ? "Adding..." : "Add Category"}
          </button>
        </form>
        <div className="vendor-category-grid">
          {categories.length === 0 ? (
            <div className="vendor-empty-state vendor-compact">
              <span>No categories created yet. Products can still be created without a category.</span>
            </div>
          ) : categories.map((category) => (
            <div className={`vendor-category-card ${category.isActive ? "" : "inactive"}`} key={category.id}>
              {editingCategoryId === category.id ? (
                <div className="vendor-category-edit-mode">
                  <input
                    className="vendor-input"
                    aria-label={`Edit ${category.name}`}
                    autoFocus
                    disabled={categoryEditBusy}
                    onChange={(event) => setEditingCategoryName(event.target.value)}
                    value={editingCategoryName}
                  />
                  <div className="vendor-row-actions">
                    <button type="button" className="vendor-primary-button vendor-compact-button" disabled={categoryEditBusy} onClick={() => saveCategory(category.id)}>{categoryEditBusy ? "Saving" : "Save"}</button>
                    <button type="button" className="vendor-secondary-button vendor-compact-button" disabled={categoryEditBusy} onClick={() => setEditingCategoryId("")}>Cancel</button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="vendor-category-info">
                    <strong>{category.name}</strong>
                    <span className={`vendor-status-badge vendor-status-${category.isActive ? "active" : "inactive"}`}>
                      {category.isActive ? "Active" : "Inactive"}
                    </span>
                  </div>
                  <div className="vendor-row-actions">
                    <button type="button" className="vendor-text-button" disabled={categoryToggleBusyId === category.id} onClick={() => { setEditingCategoryId(category.id); setEditingCategoryName(category.name); }}>Edit</button>
                    <button type="button" className="vendor-text-button" disabled={categoryToggleBusyId === category.id} onClick={() => toggleCategory(category)}>
                      {categoryToggleBusyId === category.id ? "Working..." : category.isActive ? "Deactivate" : "Activate"}
                    </button>
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="vendor-catalog-layout">
        <div className="vendor-card vendor-product-list-card">
          <div className="vendor-card-heading vendor-product-list-heading">
            <div>
              <h3 className="vendor-subtitle">My Store Products</h3>
              <p className="vendor-text-muted">Manage your products and each selling option's price, stock, and availability.</p>
            </div>
            <div className="vendor-catalog-filter-controls">
            <label className="vendor-catalog-filter">
              <span>Search Products</span>
              <input className="vendor-input" type="search" value={productSearch} onChange={(event) => setProductSearch(event.target.value)} placeholder="Search by name or brand" aria-label="Search my store products by name or brand" />
            </label>
            <label className="vendor-catalog-filter">
              <span>Browse by Category</span>
              <select className="vendor-select" onChange={(event) => setCategoryFilter(event.target.value)} value={categoryFilter}>
                <option value="all">All Products</option>
                <option value="uncategorized">Uncategorized</option>
                {categories.map((category) => (
                  <option key={category.id} value={category.id}>{category.name}</option>
                ))}
              </select>
            </label>
            </div>
          </div>
          {visibleProducts.length === 0 ? (
            <div className="vendor-empty-state vendor-compact">
              <strong>No products found</strong>
              <span>Find a shared grocery above or adjust your category filter.</span>
            </div>
          ) : (
            <div className="vendor-product-table">
              <div className="vendor-product-table-header">
                <div>Product</div>
                <div>Price</div>
                <div>Stock</div>
                <div>Availability</div>
                <div>Actions</div>
              </div>
              {visibleProducts.map((product) => (
                <Fragment key={product.id}>
                <div className={`vendor-product-row ${product.isActive ? "" : "inactive"}`}>
                  <div className="vendor-product-identity">
                    {product.imageUrl ? (
                      <img alt={product.name} src={product.imageUrl} />
                    ) : (
                      <div className="vendor-product-placeholder" aria-hidden="true">
                        {product.name.slice(0, 1).toUpperCase()}
                      </div>
                    )}
                    <div className="vendor-product-identity-text">
                      <strong>{product.name}</strong>
                      <span>{product.categoryId ? categoryNames.get(product.categoryId) ?? "Unknown" : "Uncategorized"}</span>
                    </div>
                  </div>
                   <div className="vendor-product-metric"><strong>{product.masterProductId ? "See variants" : `₹${formatPrice(product.price)}`}</strong></div>
                   <div className="vendor-product-metric"><strong>{product.masterProductId ? "Varies by option" : product.stockQuantity}</strong></div>
                  <div className="vendor-product-state">
                    {!product.isActive ? (
                       <span className="vendor-status-badge vendor-status-inactive">Inactive</span>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                        <label className="vendor-toggle-switch vendor-small" aria-label={`Set ${product.name} availability`}>
                          <input
                            checked={product.availability}
                            onChange={() => toggleAvailability(product)}
                            type="checkbox"
                            disabled={availabilityBusyId === product.id}
                          />
                          <div className="vendor-toggle-slider"></div>
                          <span className="vendor-text-muted" style={{ fontSize: "12px", marginLeft: "4px" }}>
                            {product.availability ? "Available" : "Unavailable"}
                          </span>
                        </label>
                      </div>
                    )}
                  </div>
                  <div className="vendor-row-actions vendor-product-actions">
                    <button
                      type="button"
                      className="vendor-secondary-button vendor-compact-button"
                      disabled={productToggleBusyId === product.id}
                      onClick={() => {
                        setEditingProductId(product.id);
                        setProductDraft(draftFromProduct(product));
                        document.querySelector(".vendor-product-form")?.scrollIntoView({ behavior: "smooth", block: "center" });
                      }}
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      className="vendor-secondary-button vendor-compact-button"
                      aria-expanded={expandedVariantProductId === product.id}
                      onClick={() => {
                        setMountedVariantProductIds((current) => current.includes(product.id) ? current : [...current, product.id]);
                        setExpandedVariantProductId((current) => current === product.id ? "" : product.id);
                      }}
                    >
                      {expandedVariantProductId === product.id ? "Hide variants" : `Selling variants (${product.variants?.length ?? 0})`}
                    </button>
                    <button
                      type="button"
                      className={product.isActive ? "vendor-danger-button vendor-compact-button" : "vendor-primary-button vendor-compact-button"}
                      disabled={productToggleBusyId === product.id}
                      onClick={() => toggleProductActive(product)}
                    >
                       {productToggleBusyId === product.id ? "Working..." : product.isActive ? "Deactivate" : product.masterProductId ? "Configure & publish" : "Activate"}
                    </button>
                  </div>
                </div>
                {mountedVariantProductIds.includes(product.id) && (
                  <div className="vendor-product-inline-editor" hidden={expandedVariantProductId !== product.id}>
                    <SellingVariantEditor
                      token={token}
                      product={product}
                      idPrefix="store"
                      onProductUpdated={upsertProduct}
                      onMessage={onMessage}
                    />
                  </div>
                )}
                </Fragment>
              ))}
            </div>
          )}
        </div>

        {editingProductId && (
        <form className="vendor-card vendor-form-card vendor-product-form" onSubmit={saveProduct}>
          <div className="vendor-card-heading">
            <div>
              <h3 className="vendor-subtitle">Edit {editingMappedProduct ? "Store Listing" : "Product"}</h3>
              <p className="vendor-text-muted">{editingMappedProduct ? "Shared product details stay the same for everyone. Blank store details use the shared catalog; store codes remain separate from selling option codes." : "Product details remain editable. Once selling options exist, each one controls its own price and stock."}</p>
            </div>
            {editingProductId && (
              <button type="button" className="vendor-text-button" onClick={resetProductForm}>Cancel Edit</button>
            )}
          </div>
          <label className="vendor-label">
            Product Name
            <input
              className="vendor-input"
              disabled={productSaveBusy || editingMappedProduct}
              onChange={(event) => setProductDraft((draft) => ({ ...draft, name: event.target.value }))}
              required
              value={productDraft.name}
            />
          </label>
          {!editingMappedProduct && <div className="vendor-two-column">
            <label className="vendor-label">
              Price (₹)
              <input
                className="vendor-input"
                disabled={productSaveBusy}
                inputMode="decimal"
                min="0"
                onChange={(event) => setProductDraft((draft) => ({ ...draft, price: event.target.value }))}
                required
                step="0.01"
                type="number"
                value={productDraft.price}
              />
            </label>
            <label className="vendor-label">
              Stock Quantity
              <input
                className="vendor-input"
                disabled={productSaveBusy}
                inputMode="numeric"
                min="0"
                onChange={(event) => setProductDraft((draft) => ({ ...draft, stockQuantity: event.target.value }))}
                required
                step="1"
                type="number"
                value={productDraft.stockQuantity}
              />
            </label>
          </div>}
          <label className="vendor-label">
            Category
            <select
              className="vendor-select"
              disabled={productSaveBusy}
              onChange={(event) => setProductDraft((draft) => ({ ...draft, categoryId: event.target.value }))}
              value={productDraft.categoryId}
            >
              <option value="">Uncategorized</option>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}{category.isActive ? "" : " (inactive)"}
                </option>
              ))}
            </select>
          </label>
          <div className="vendor-two-column">
            <label className="vendor-label">
              {editingMappedProduct ? "Store listing SKU" : "SKU"} <span className="vendor-text-muted vendor-font-normal">(Optional)</span>
              <input
                className="vendor-input"
                disabled={productSaveBusy}
                onChange={(event) => setProductDraft((draft) => ({ ...draft, sku: event.target.value }))}
                value={productDraft.sku}
              />
            </label>
            <label className="vendor-label">
              {editingMappedProduct ? "Store listing external code" : "External Code"} <span className="vendor-text-muted vendor-font-normal">(Optional)</span>
              <input
                className="vendor-input"
                disabled={productSaveBusy}
                onChange={(event) => setProductDraft((draft) => ({ ...draft, externalCode: event.target.value }))}
                value={productDraft.externalCode}
              />
            </label>
          </div>
          <VendorProductImageInput
            key={editingProductId}
            token={token}
            productId={editingProductId}
            imageUrl={productDraft.imageUrl}
            onChange={(imageUrl) => setProductDraft((draft) => ({ ...draft, imageUrl }))}
            onUploadingChange={setImageUploading}
            disabled={productSaveBusy}
          />
          <label className="vendor-label">
            {editingMappedProduct ? "Store description override (blank inherits catalog description)" : "Description"} <span className="vendor-text-muted vendor-font-normal">(Optional)</span>
            <textarea
              className="vendor-textarea"
              disabled={productSaveBusy}
              onChange={(event) => setProductDraft((draft) => ({ ...draft, description: event.target.value }))}
              rows={3}
              value={productDraft.description}
            />
          </label>
          
          <div className="vendor-form-actions" style={{ marginTop: '8px' }}>
              <button className="vendor-primary-button" type="submit" disabled={productSaveBusy || imageUploading}>
                {imageUploading ? "Uploading image…" : productSaveBusy ? "Saving..." : "Save Store Listing"}
             </button>
          </div>
        </form>
        )}
      </div>
    </div>
  );
}