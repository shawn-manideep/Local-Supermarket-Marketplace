import { useEffect, useMemo, useState } from "react";
import { apiRequest, type Category, type Product } from "./api";

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
    description: product.description ?? "",
    sku: product.sku ?? "",
    externalCode: product.externalCode ?? "",
    price: product.price,
    stockQuantity: String(product.stockQuantity),
    imageUrl: product.imageUrl ?? "",
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

  const visibleProducts = useMemo(
    () =>
      categoryFilter === "all"
        ? products
        : categoryFilter === "uncategorized"
          ? products.filter((product) => product.categoryId === null)
          : products.filter((product) => product.categoryId === categoryFilter),
    [categoryFilter, products],
  );

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
          ? current.map((item) => (item.id === product.id ? product : item))
          : [...current, product],
      ),
    );
  };

  const [categoryAddBusy, setCategoryAddBusy] = useState(false);
  const [categoryEditBusy, setCategoryEditBusy] = useState(false);
  const [categoryToggleBusyId, setCategoryToggleBusyId] = useState("");
  const [productSaveBusy, setProductSaveBusy] = useState(false);
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
    if (productSaveBusy) return;
    setProductSaveBusy(true);
    const body = {
      name: productDraft.name,
      description: productDraft.description.trim() || null,
      sku: productDraft.sku.trim() || null,
      externalCode: productDraft.externalCode.trim() || null,
      price: Number(productDraft.price),
      availability: productDraft.availability,
      stockQuantity: Number(productDraft.stockQuantity),
      imageUrl: productDraft.imageUrl.trim() || null,
      categoryId: productDraft.categoryId || null,
    };

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
      setProductSaveBusy(false);
    }
  };

  const toggleProductActive = async (product: Product) => {
    if (productToggleBusyId) return;
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

  return (
    <div className="vendor-catalog-section">
      <div className="vendor-section-header vendor-catalog-header">
        <div>
          <h2 className="vendor-title">Catalog Management</h2>
          <p className="vendor-text-muted">Manage your store categories and product inventory.</p>
        </div>
        <div className="vendor-catalog-summary">
          <span><strong>{categories.length}</strong> Categories</span>
          <span><strong>{products.length}</strong> Products</span>
        </div>
      </div>

      <div className="vendor-card vendor-category-panel">
        <div className="vendor-card-heading">
          <div>
            <h3 className="vendor-subtitle">Categories</h3>
            <p className="vendor-text-muted">Organize products without sharing records across stores.</p>
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
              <h3 className="vendor-subtitle">Products</h3>
              <p className="vendor-text-muted">Manage your inventory, pricing, and availability.</p>
            </div>
            <label className="vendor-filter-label">
              Filter:
              <select className="vendor-select" onChange={(event) => setCategoryFilter(event.target.value)} value={categoryFilter}>
                <option value="all">All Products</option>
                <option value="uncategorized">Uncategorized</option>
                {categories.map((category) => (
                  <option key={category.id} value={category.id}>{category.name}</option>
                ))}
              </select>
            </label>
          </div>
          {visibleProducts.length === 0 ? (
            <div className="vendor-empty-state vendor-compact">
              <strong>No products found</strong>
              <span>Add a product below or adjust your category filter.</span>
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
                <div className={`vendor-product-row ${product.isActive ? "" : "inactive"}`} key={product.id}>
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
                  <div className="vendor-product-metric"><strong>₹{product.price}</strong></div>
                  <div className="vendor-product-metric"><strong>{product.stockQuantity}</strong></div>
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
                      className={product.isActive ? "vendor-danger-button vendor-compact-button" : "vendor-primary-button vendor-compact-button"}
                      disabled={productToggleBusyId === product.id}
                      onClick={() => toggleProductActive(product)}
                    >
                      {productToggleBusyId === product.id ? "Working..." : product.isActive ? "Deactivate" : "Activate"}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <form className="vendor-card vendor-form-card vendor-product-form" onSubmit={saveProduct}>
          <div className="vendor-card-heading">
            <div>
              <h3 className="vendor-subtitle">{editingProductId ? "Edit Product" : "Create Product"}</h3>
              <p className="vendor-text-muted">Fill out the product details below.</p>
            </div>
            {editingProductId && (
              <button type="button" className="vendor-text-button" onClick={resetProductForm}>Cancel Edit</button>
            )}
          </div>
          <label className="vendor-label">
            Product Name
            <input
              className="vendor-input"
              disabled={productSaveBusy}
              onChange={(event) => setProductDraft((draft) => ({ ...draft, name: event.target.value }))}
              required
              value={productDraft.name}
            />
          </label>
          <div className="vendor-two-column">
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
          </div>
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
              SKU <span className="vendor-text-muted vendor-font-normal">(Optional)</span>
              <input
                className="vendor-input"
                disabled={productSaveBusy}
                onChange={(event) => setProductDraft((draft) => ({ ...draft, sku: event.target.value }))}
                value={productDraft.sku}
              />
            </label>
            <label className="vendor-label">
              External Code <span className="vendor-text-muted vendor-font-normal">(Optional)</span>
              <input
                className="vendor-input"
                disabled={productSaveBusy}
                onChange={(event) => setProductDraft((draft) => ({ ...draft, externalCode: event.target.value }))}
                value={productDraft.externalCode}
              />
            </label>
          </div>
          <label className="vendor-label">
            Image URL <span className="vendor-text-muted vendor-font-normal">(Optional)</span>
            <input
              className="vendor-input"
              disabled={productSaveBusy}
              onChange={(event) => setProductDraft((draft) => ({ ...draft, imageUrl: event.target.value }))}
              type="url"
              value={productDraft.imageUrl}
            />
          </label>
          <label className="vendor-label">
            Description <span className="vendor-text-muted vendor-font-normal">(Optional)</span>
            <textarea
              className="vendor-textarea"
              disabled={productSaveBusy}
              onChange={(event) => setProductDraft((draft) => ({ ...draft, description: event.target.value }))}
              rows={3}
              value={productDraft.description}
            />
          </label>
          
          <div className="vendor-form-actions" style={{ marginTop: '8px' }}>
             <button className="vendor-primary-button" type="submit" disabled={productSaveBusy}>
               {productSaveBusy ? "Saving..." : editingProductId ? "Save Product Changes" : "Create Product"}
             </button>
          </div>
        </form>
      </div>
    </div>
  );
}