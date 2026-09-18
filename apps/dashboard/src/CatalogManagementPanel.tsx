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

  const addCategory = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    try {
      const response = await apiRequest<{ category: Category }>(
        "/api/vendor/categories",
        token,
        { method: "POST", body: JSON.stringify({ name: categoryName }) },
      );
      upsertCategory(response.category);
      setCategoryName("");
      onMessage("Category created.");
    } catch (error) {
      onMessage(error instanceof Error ? error.message : "Unable to create category.", "error");
    }
  };

  const saveCategory = async (categoryId: string) => {
    try {
      const response = await apiRequest<{ category: Category }>(
        `/api/vendor/categories/${categoryId}`,
        token,
        { method: "PATCH", body: JSON.stringify({ name: editingCategoryName }) },
      );
      upsertCategory(response.category);
      setEditingCategoryId("");
      onMessage("Category updated.");
    } catch (error) {
      onMessage(error instanceof Error ? error.message : "Unable to update category.", "error");
    }
  };

  const toggleCategory = async (category: Category) => {
    if (
      category.isActive &&
      !window.confirm("Deactivate this category? Its products will remain intact.")
    ) {
      return;
    }
    const action = category.isActive ? "deactivate" : "activate";
    try {
      const response = await apiRequest<{ category: Category }>(
        `/api/vendor/categories/${category.id}/${action}`,
        token,
        { method: "POST" },
      );
      upsertCategory(response.category);
      onMessage(`Category ${action}d.`);
    } catch (error) {
      onMessage(error instanceof Error ? error.message : "Unable to update category.", "error");
    }
  };

  const resetProductForm = () => {
    setEditingProductId("");
    setProductDraft(emptyProductDraft);
  };

  const saveProduct = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
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
      onMessage(editingProductId ? "Product updated." : "Product created.");
    } catch (error) {
      onMessage(error instanceof Error ? error.message : "Unable to save product.", "error");
    }
  };

  const toggleProductActive = async (product: Product) => {
    if (
      product.isActive &&
      !window.confirm("Deactivate this product? It will remain stored for historical references.")
    ) {
      return;
    }
    const action = product.isActive ? "deactivate" : "activate";
    try {
      const response = await apiRequest<{ product: Product }>(
        `/api/vendor/products/${product.id}/${action}`,
        token,
        { method: "POST" },
      );
      upsertProduct(response.product);
      onMessage(`Product ${action}d.`);
    } catch (error) {
      onMessage(error instanceof Error ? error.message : "Unable to update product.", "error");
    }
  };

  const toggleAvailability = async (product: Product) => {
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
      );
    } catch (error) {
      onMessage(error instanceof Error ? error.message : "Unable to update availability.", "error");
    }
  };

  return (
    <section className="catalog-section">
      <div className="section-heading catalog-heading">
        <div>
          <p className="eyebrow">Store-owned catalog</p>
          <h2>Categories and products</h2>
          <p className="muted">
            Manage this store’s independent catalog. Deactivation never deletes historical records.
          </p>
        </div>
        <div className="catalog-summary" aria-label="Catalog summary">
          <span><strong>{categories.length}</strong> categories</span>
          <span><strong>{products.length}</strong> products</span>
        </div>
      </div>

      {loading ? (
        <div className="empty-state"><strong>Loading catalog…</strong></div>
      ) : (
        <>
          <div className="catalog-grid">
            <div className="card category-panel">
              <div className="card-heading">
                <div>
                  <h3>Categories</h3>
                  <p className="muted">Organize products without sharing records across stores.</p>
                </div>
                <span className="count-pill">{categories.length}</span>
              </div>
              <form className="inline-form" onSubmit={addCategory}>
                <input
                  aria-label="Category name"
                  onChange={(event) => setCategoryName(event.target.value)}
                  placeholder="New category"
                  required
                  value={categoryName}
                />
                <button className="secondary-button" type="submit">Add</button>
              </form>
              <div className="category-list">
                {categories.length === 0 ? (
                  <div className="empty-state compact">
                    <strong>No categories yet</strong>
                    <span>Products can still be created without a category.</span>
                  </div>
                ) : categories.map((category) => (
                  <div className="category-row" key={category.id}>
                    {editingCategoryId === category.id ? (
                      <input
                        aria-label={`Edit ${category.name}`}
                        autoFocus
                        onChange={(event) => setEditingCategoryName(event.target.value)}
                        value={editingCategoryName}
                      />
                    ) : (
                      <div>
                        <strong>{category.name}</strong>
                        <span className={`lifecycle-dot ${category.isActive ? "is-active" : ""}`}>
                          {category.isActive ? "Active" : "Inactive"}
                        </span>
                      </div>
                    )}
                    <div className="row-actions">
                      {editingCategoryId === category.id ? (
                        <>
                          <button className="text-button" onClick={() => saveCategory(category.id)}>Save</button>
                          <button className="text-button" onClick={() => setEditingCategoryId("")}>Cancel</button>
                        </>
                      ) : (
                        <>
                          <button
                            className="text-button"
                            onClick={() => {
                              setEditingCategoryId(category.id);
                              setEditingCategoryName(category.name);
                            }}
                          >
                            Edit
                          </button>
                          <button
                            className={category.isActive ? "danger-button compact-button" : "secondary-button compact-button"}
                            onClick={() => toggleCategory(category)}
                          >
                            {category.isActive ? "Deactivate" : "Activate"}
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <form className="card form-card product-form" onSubmit={saveProduct}>
              <div className="card-heading">
                <div>
                  <h3>{editingProductId ? "Edit product" : "Add product"}</h3>
                  <p className="muted">SKU and external code are optional and store-specific.</p>
                </div>
                {editingProductId && (
                  <button className="text-button" onClick={resetProductForm} type="button">Cancel</button>
                )}
              </div>
              <label>
                Product name
                <input
                  onChange={(event) => setProductDraft((draft) => ({ ...draft, name: event.target.value }))}
                  required
                  value={productDraft.name}
                />
              </label>
              <div className="two-column">
                <label>
                  Price (₹)
                  <input
                    inputMode="decimal"
                    min="0"
                    onChange={(event) => setProductDraft((draft) => ({ ...draft, price: event.target.value }))}
                    required
                    step="0.01"
                    type="number"
                    value={productDraft.price}
                  />
                </label>
                <label>
                  Stock quantity
                  <input
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
              <label>
                Category
                <select
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
              <div className="two-column">
                <label>
                  SKU
                  <input
                    onChange={(event) => setProductDraft((draft) => ({ ...draft, sku: event.target.value }))}
                    value={productDraft.sku}
                  />
                </label>
                <label>
                  External code
                  <input
                    onChange={(event) => setProductDraft((draft) => ({ ...draft, externalCode: event.target.value }))}
                    value={productDraft.externalCode}
                  />
                </label>
              </div>
              <label>
                Image URL
                <input
                  onChange={(event) => setProductDraft((draft) => ({ ...draft, imageUrl: event.target.value }))}
                  type="url"
                  value={productDraft.imageUrl}
                />
              </label>
              <label>
                Description
                <textarea
                  onChange={(event) => setProductDraft((draft) => ({ ...draft, description: event.target.value }))}
                  rows={3}
                  value={productDraft.description}
                />
              </label>
              <label className="switch-label product-availability-field">
                <input
                  checked={productDraft.availability}
                  onChange={(event) => setProductDraft((draft) => ({ ...draft, availability: event.target.checked }))}
                  type="checkbox"
                />
                Temporarily available for sale
              </label>
              <button className="primary-button" type="submit">
                {editingProductId ? "Save product" : "Add product"}
              </button>
            </form>
          </div>

          <div className="card product-list-card">
            <div className="card-heading product-list-heading">
              <div>
                <h3>Products</h3>
                <p className="muted">Active status and temporary availability are managed separately.</p>
              </div>
              <label className="filter-label">
                Filter by category
                <select onChange={(event) => setCategoryFilter(event.target.value)} value={categoryFilter}>
                  <option value="all">All products</option>
                  <option value="uncategorized">Uncategorized</option>
                  {categories.map((category) => (
                    <option key={category.id} value={category.id}>{category.name}</option>
                  ))}
                </select>
              </label>
            </div>
            {visibleProducts.length === 0 ? (
              <div className="empty-state compact">
                <strong>No products in this view</strong>
                <span>Add a product or choose another category.</span>
              </div>
            ) : (
              <div className="product-table">
                {visibleProducts.map((product) => (
                  <article className={`product-row ${product.isActive ? "" : "inactive"}`} key={product.id}>
                    <div className="product-identity">
                      {product.imageUrl ? (
                        <img alt="" src={product.imageUrl} />
                      ) : (
                        <div className="product-placeholder" aria-hidden="true">
                          {product.name.slice(0, 1).toUpperCase()}
                        </div>
                      )}
                      <div>
                        <strong>{product.name}</strong>
                        <span>{product.categoryId ? categoryNames.get(product.categoryId) ?? "Unknown category" : "Uncategorized"}</span>
                        {(product.sku || product.externalCode) && (
                          <small>{product.sku ? `SKU ${product.sku}` : `Code ${product.externalCode}`}</small>
                        )}
                      </div>
                    </div>
                    <div className="product-metric">
                      <span>Price</span>
                      <strong>₹{product.price}</strong>
                    </div>
                    <div className="product-metric">
                      <span>Stock</span>
                      <strong>{product.stockQuantity}</strong>
                    </div>
                    <div className="product-state">
                      <span className={`status ${product.isActive ? "status-active" : "status-rejected"}`}>
                        {product.isActive ? "Active" : "Inactive"}
                      </span>
                      {product.isActive && (
                        <button
                          className={`availability-badge ${product.availability ? "available" : "unavailable"}`}
                          onClick={() => toggleAvailability(product)}
                        >
                          {product.availability ? "Available" : "Unavailable"}
                        </button>
                      )}
                    </div>
                    <div className="row-actions product-actions">
                      <button
                        className="text-button"
                        onClick={() => {
                          setEditingProductId(product.id);
                          setProductDraft(draftFromProduct(product));
                          document.querySelector(".product-form")?.scrollIntoView({ behavior: "smooth" });
                        }}
                      >
                        Edit
                      </button>
                      <button
                        className={product.isActive ? "danger-button compact-button" : "secondary-button compact-button"}
                        onClick={() => toggleProductActive(product)}
                      >
                        {product.isActive ? "Deactivate" : "Activate"}
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </section>
  );
}