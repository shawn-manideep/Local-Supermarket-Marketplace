import { useEffect, useMemo, useRef, useState } from "react";
import { apiRequest, type Category, type Product, type ProductVariant, type VariantQuantityUnit } from "./api";
import { VendorMasterCatalogPanel } from "./VendorMasterCatalogPanel";

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

interface VariantDraft {
  name: string;
  quantityValue: string;
  quantityUnit: VariantQuantityUnit;
  price: string;
  stockQuantity: string;
  availability: boolean;
  sku: string;
  externalCode: string;
  sortOrder: string;
}

const emptyVariantDraft: VariantDraft = {
  name: "",
  quantityValue: "1",
  quantityUnit: "pack",
  price: "0.00",
  stockQuantity: "0",
  availability: true,
  sku: "",
  externalCode: "",
  sortOrder: "0",
};

function draftFromVariant(variant: ProductVariant): VariantDraft {
  return {
    name: variant.name,
    quantityValue: variant.quantityValue,
    quantityUnit: variant.quantityUnit,
    price: variant.price,
    stockQuantity: String(variant.stockQuantity),
    availability: variant.availability,
    sku: variant.sku ?? "",
    externalCode: variant.externalCode ?? "",
    sortOrder: String(variant.sortOrder),
  };
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
  const [expandedVariantProductId, setExpandedVariantProductId] = useState("");
  const [editingVariantId, setEditingVariantId] = useState("");
  const [variantDraft, setVariantDraft] = useState<VariantDraft>(emptyVariantDraft);
  const [variantSaveBusy, setVariantSaveBusy] = useState(false);
  const [variantActionBusyId, setVariantActionBusyId] = useState("");
  const variantSaveBusyRef = useRef(false);
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

  const visibleProducts = useMemo(
    () =>
      categoryFilter === "all"
        ? products
        : categoryFilter === "uncategorized"
          ? products.filter((product) => product.categoryId === null)
          : products.filter((product) => product.categoryId === categoryFilter),
    [categoryFilter, products],
  );
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

  const upsertVariant = (productId: string, variant: ProductVariant) => {
    setProducts((current) => current.map((product) => {
      if (product.id !== productId) return product;
      const variants = product.variants ?? [];
      return {
        ...product,
        variants: variants.some((item) => item.id === variant.id)
          ? variants.map((item) => item.id === variant.id ? variant : item)
          : [...variants, variant],
      };
    }));
  };

  const [categoryAddBusy, setCategoryAddBusy] = useState(false);
  const [categoryEditBusy, setCategoryEditBusy] = useState(false);
  const [categoryToggleBusyId, setCategoryToggleBusyId] = useState("");
  const [productSaveBusy, setProductSaveBusy] = useState(false);
  const [productToggleBusyId, setProductToggleBusyId] = useState("");
  const [availabilityBusyId, setAvailabilityBusyId] = useState("");

  const resetVariantForm = () => {
    setEditingVariantId("");
    setVariantDraft(emptyVariantDraft);
  };

  const saveVariant = async (event: React.FormEvent<HTMLFormElement>, productId: string) => {
    event.preventDefault();
    if (variantSaveBusyRef.current) return;
    variantSaveBusyRef.current = true;
    setVariantSaveBusy(true);
    const body = {
      name: variantDraft.name.trim(),
      quantityValue: String(Number(variantDraft.quantityValue)),
      quantityUnit: variantDraft.quantityUnit,
      price: String(Number(variantDraft.price).toFixed(2)),
      stockQuantity: Number(variantDraft.stockQuantity),
      availability: variantDraft.availability,
      sku: variantDraft.sku.trim() || null,
      externalCode: variantDraft.externalCode.trim() || null,
      sortOrder: Number(variantDraft.sortOrder),
    };
    try {
      const response = await apiRequest<{ variant: ProductVariant }>(
        editingVariantId
          ? `/api/vendor/products/${productId}/variants/${editingVariantId}`
          : `/api/vendor/products/${productId}/variants`,
        token,
        {
          method: editingVariantId ? "PATCH" : "POST",
          body: JSON.stringify(body),
        },
      );
      upsertVariant(productId, response.variant);
      resetVariantForm();
      onMessage(editingVariantId ? "Variant updated." : "Variant created.", "success");
    } catch (error) {
      onMessage(error instanceof Error ? error.message : "Unable to save variant.", "error");
    } finally {
      variantSaveBusyRef.current = false;
      setVariantSaveBusy(false);
    }
  };

  const toggleVariantActive = async (productId: string, variant: ProductVariant) => {
    if (variantActionBusyId) return;
    const action = variant.isActive ? "deactivate" : "activate";
    setVariantActionBusyId(variant.id);
    try {
      const response = await apiRequest<{ variant: ProductVariant }>(
        `/api/vendor/products/${productId}/variants/${variant.id}/${action}`,
        token,
        { method: "POST" },
      );
      upsertVariant(productId, response.variant);
      onMessage(`Variant ${action}d.`, "success");
    } catch (error) {
      onMessage(error instanceof Error ? error.message : "Unable to update variant.", "error");
    } finally {
      setVariantActionBusyId("");
    }
  };

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
    if (productSaveBusyRef.current) return;
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
    if (!product.isActive && product.masterProductId && !(product.variants ?? []).some((variant) => variant.isActive)) {
      onMessage("Add and save a real selling variant before activating this listing.", "error");
      setExpandedVariantProductId(product.id);
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
    setExpandedVariantProductId(product.id);
    setEditingVariantId("");
    setVariantDraft(emptyVariantDraft);
    if (product.masterProductId) {
      setEditingProductId(product.id);
      setProductDraft(draftFromProduct(product));
    }
    window.setTimeout(() => {
      document.querySelector(`[aria-label="${CSS.escape(product.name)} variants"]`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 60);
  };

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

      <VendorMasterCatalogPanel token={token} onAdded={handleMasterProductAdded} onMessage={onMessage} />

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
              <p className="vendor-text-muted">Legacy product price and stock remain for compatibility; active variants are authoritative for sellable price and inventory.</p>
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
                      className="vendor-secondary-button vendor-compact-button"
                      aria-expanded={expandedVariantProductId === product.id}
                      onClick={() => {
                        setExpandedVariantProductId((current) => current === product.id ? "" : product.id);
                        resetVariantForm();
                      }}
                    >
                      {expandedVariantProductId === product.id ? "Hide variants" : `Variants (${product.variants?.length ?? 0})`}
                    </button>
                    <button
                      type="button"
                      className={product.isActive ? "vendor-danger-button vendor-compact-button" : "vendor-primary-button vendor-compact-button"}
                      disabled={productToggleBusyId === product.id}
                      onClick={() => toggleProductActive(product)}
                    >
                       {productToggleBusyId === product.id ? "Working..." : product.isActive ? "Deactivate" : product.masterProductId ? "Publish listing" : "Activate"}
                    </button>
                  </div>
                </div>
              ))}
              {expandedVariantProductId && (() => {
                const selectedProduct = visibleProducts.find((item) => item.id === expandedVariantProductId);
                if (!selectedProduct) return null;
                const orderedVariants = [...(selectedProduct.variants ?? [])]
                  .sort((left, right) => left.sortOrder - right.sortOrder);
                return (
                  <section className="vendor-card" aria-label={`${selectedProduct.name} variants`} style={{ marginTop: 18, padding: 18 }}>
                    <div className="vendor-card-heading">
                      <div>
                        <h3 className="vendor-subtitle">Sellable variants · {selectedProduct.name}</h3>
                        <p className="vendor-text-muted">Each variant owns its customer-facing price, stock, and availability.</p>
                      </div>
                    </div>
                    {orderedVariants.length === 0 ? (
                      <div className="vendor-empty-state vendor-compact">
                        <strong>No variants listed yet</strong>
                         <span>This listing has no sellable options yet. Create the actual unit your store sells.</span>
                      </div>
                    ) : (
                      <div style={{ display: "grid", gap: 8, marginBottom: 18 }}>
                        {orderedVariants.map((variant) => (
                          <div key={variant.id} style={{ alignItems: "center", background: "var(--bg-page)", border: "1px solid var(--border-light)", borderRadius: 10, display: "flex", flexWrap: "wrap", gap: "8px 18px", justifyContent: "space-between", padding: "12px 14px" }}>
                            <div style={{ display: "grid", gap: 3, minWidth: 130 }}>
                              <strong>{variant.name}</strong>
                              <span className="vendor-text-muted">{variant.quantityValue} {variant.quantityUnit} · order {variant.sortOrder}</span>
                            </div>
                            <strong>₹{variant.price}</strong>
                            <span>{variant.stockQuantity} in stock</span>
                            <span className={`vendor-status-badge vendor-status-${variant.isActive ? "active" : "inactive"}`}>
                              {!variant.isActive ? "Inactive" : variant.availability ? "Available" : "Unavailable"}
                            </span>
                            <div className="vendor-row-actions">
                              <button
                                type="button"
                                className="vendor-text-button"
                                disabled={variantSaveBusy || Boolean(variantActionBusyId)}
                                onClick={() => {
                                  setEditingVariantId(variant.id);
                                  setVariantDraft(draftFromVariant(variant));
                                }}
                              >Edit</button>
                              <button
                                type="button"
                                className="vendor-text-button"
                                disabled={variantActionBusyId === variant.id || Boolean(variantActionBusyId)}
                                onClick={() => toggleVariantActive(selectedProduct.id, variant)}
                              >
                                {variantActionBusyId === variant.id ? "Working..." : variant.isActive ? "Deactivate" : "Activate"}
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                    <form onSubmit={(event) => saveVariant(event, selectedProduct.id)} style={{ borderTop: "1px solid var(--border-light)", display: "grid", gap: 14, paddingTop: 18 }}>
                      <div className="vendor-card-heading" style={{ marginBottom: 0 }}>
                        <div>
                          <h4 className="vendor-subtitle">{editingVariantId ? "Edit variant" : "Add a variant"}</h4>
                          <p className="vendor-text-muted">Name it for shoppers; keep quantity and unit as separate values.</p>
                        </div>
                        {editingVariantId && <button type="button" className="vendor-text-button" disabled={variantSaveBusy} onClick={resetVariantForm}>Cancel edit</button>}
                      </div>
                      <div className="vendor-two-column">
                        <label className="vendor-label">Variant name
                          <input className="vendor-input" required maxLength={120} disabled={variantSaveBusy} value={variantDraft.name} onChange={(event) => setVariantDraft((draft) => ({ ...draft, name: event.target.value }))} placeholder="e.g. Family pack" />
                        </label>
                        <div className="vendor-two-column">
                          <label className="vendor-label">Quantity value
                            <input className="vendor-input" required min="0.001" step="any" type="number" disabled={variantSaveBusy} value={variantDraft.quantityValue} onChange={(event) => setVariantDraft((draft) => ({ ...draft, quantityValue: event.target.value }))} />
                          </label>
                          <label className="vendor-label">Unit
                            <select className="vendor-select" disabled={variantSaveBusy} value={variantDraft.quantityUnit} onChange={(event) => setVariantDraft((draft) => ({ ...draft, quantityUnit: event.target.value as VariantQuantityUnit }))}>
                               <option value="g">g</option><option value="kg">kg</option><option value="ml">ml</option><option value="l">l</option><option value="piece">piece</option><option value="pack">pack</option><option value="dozen">dozen</option><option value="bottle">bottle</option><option value="box">box</option>
                            </select>
                          </label>
                        </div>
                      </div>
                      <div className="vendor-two-column">
                        <label className="vendor-label">Price (₹)
                          <input className="vendor-input" required min="0" step="0.01" type="number" disabled={variantSaveBusy} value={variantDraft.price} onChange={(event) => setVariantDraft((draft) => ({ ...draft, price: event.target.value }))} />
                        </label>
                        <label className="vendor-label">Stock quantity
                          <input className="vendor-input" required min="0" step="1" type="number" disabled={variantSaveBusy} value={variantDraft.stockQuantity} onChange={(event) => setVariantDraft((draft) => ({ ...draft, stockQuantity: event.target.value }))} />
                        </label>
                      </div>
                      <div className="vendor-two-column">
                        <label className="vendor-label">Variant SKU <span className="vendor-text-muted vendor-font-normal">(Optional)</span>
                          <input className="vendor-input" disabled={variantSaveBusy} value={variantDraft.sku} onChange={(event) => setVariantDraft((draft) => ({ ...draft, sku: event.target.value }))} />
                        </label>
                        <label className="vendor-label">Variant external code <span className="vendor-text-muted vendor-font-normal">(Optional)</span>
                          <input className="vendor-input" disabled={variantSaveBusy} value={variantDraft.externalCode} onChange={(event) => setVariantDraft((draft) => ({ ...draft, externalCode: event.target.value }))} />
                        </label>
                      </div>
                      <div className="vendor-two-column" style={{ alignItems: "end" }}>
                        <label className="vendor-label">Display order
                          <input className="vendor-input" required min="0" step="1" type="number" disabled={variantSaveBusy} value={variantDraft.sortOrder} onChange={(event) => setVariantDraft((draft) => ({ ...draft, sortOrder: event.target.value }))} />
                        </label>
                        <label className="vendor-label" style={{ alignItems: "center", display: "flex", flexDirection: "row", gap: 9, padding: "12px 0" }}>
                          <input type="checkbox" style={{ accentColor: "var(--primary)", width: 18 }} checked={variantDraft.availability} disabled={variantSaveBusy} onChange={(event) => setVariantDraft((draft) => ({ ...draft, availability: event.target.checked }))} />
                          Available to customers
                        </label>
                      </div>
                      <div className="vendor-form-actions">
                        <button className="vendor-primary-button" type="submit" disabled={variantSaveBusy || variantActionBusyId !== ""}>
                          {variantSaveBusy ? "Saving..." : editingVariantId ? "Save variant" : "Add variant"}
                        </button>
                      </div>
                    </form>
                  </section>
                );
              })()}
            </div>
          )}
        </div>

        {editingProductId && (
        <form className="vendor-card vendor-form-card vendor-product-form" onSubmit={saveProduct}>
          <div className="vendor-card-heading">
            <div>
              <h3 className="vendor-subtitle">Edit {editingMappedProduct ? "Store Listing" : "Legacy Product"}</h3>
              <p className="vendor-text-muted">{editingMappedProduct ? "Master name and brand stay canonical. Blank presentation overrides inherit the shared catalog; your store listing codes remain independent from variant codes." : "Legacy product details remain editable. Once variants exist, each variant controls its own customer price and stock."}</p>
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
          <label className="vendor-label">
            {editingMappedProduct ? "Store image override (blank inherits catalog image)" : "Image URL"} <span className="vendor-text-muted vendor-font-normal">(Optional)</span>
            <input
              className="vendor-input"
              disabled={productSaveBusy}
              onChange={(event) => setProductDraft((draft) => ({ ...draft, imageUrl: event.target.value }))}
              type="url"
              value={productDraft.imageUrl}
            />
          </label>
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
              <button className="vendor-primary-button" type="submit" disabled={productSaveBusy}>
                {productSaveBusy ? "Saving..." : "Save Store Listing"}
             </button>
          </div>
        </form>
        )}
      </div>
    </div>
  );
}