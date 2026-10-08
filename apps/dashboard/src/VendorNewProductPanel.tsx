import { useEffect, useMemo, useState } from "react";
import { formatPrice, formatQuantity } from "@workspace/validation/variant-formatting";
import { ApiRequestError, apiRequest, type Category, type Product, type VariantQuantityUnit } from "./api";
import { isAllowedProductImageReference, VendorProductImageInput } from "./VendorProductImageInput";

interface Props {
  token: string;
  categories: Category[];
  onAdded: (product: Product) => void;
  onMessage: (message: string, kind?: "success" | "error") => void;
}

interface DraftVariant {
  quantityValue: string;
  quantityUnit: VariantQuantityUnit;
  price: string;
  stockQuantity: string;
  availability: boolean;
  isActive: boolean;
  sku: string;
  externalCode: string;
}

interface ProductMatch {
  id: string;
  name: string;
  brand: string | null;
  categoryName: string | null;
  image: string | null;
  exactIdentity: boolean;
  canAddToStore: boolean;
}

const units: Array<{ value: VariantQuantityUnit; label: string }> = [
  { value: "g", label: "g" },
  { value: "kg", label: "kg" },
  { value: "ml", label: "ml" },
  { value: "l", label: "L" },
  { value: "piece", label: "piece" },
  { value: "pack", label: "pack" },
  { value: "dozen", label: "dozen" },
  { value: "bottle", label: "bottle" },
  { value: "box", label: "box" },
];

const newVariant = (): DraftVariant => ({
  quantityValue: "",
  quantityUnit: "g",
  price: "",
  stockQuantity: "0",
  availability: true,
  isActive: true,
  sku: "",
  externalCode: "",
});

export function VendorNewProductPanel({ token, categories, onAdded, onMessage }: Props) {
  const [name, setName] = useState("");
  const [brand, setBrand] = useState("");
  const [description, setDescription] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [requestedCategoryName, setRequestedCategoryName] = useState("");
  const [sku, setSku] = useState("");
  const [externalCode, setExternalCode] = useState("");
  const [availability, setAvailability] = useState(true);
  const [variants, setVariants] = useState<DraftVariant[]>([newVariant()]);
  const [matches, setMatches] = useState<ProductMatch[]>([]);
  const [checkedIdentity, setCheckedIdentity] = useState("");
  const [checking, setChecking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [imageUploading, setImageUploading] = useState(false);
  const [busyMatchId, setBusyMatchId] = useState("");
  const [confirmSimilar, setConfirmSimilar] = useState(false);
  const [error, setError] = useState("");

  const identity = useMemo(() => JSON.stringify([
    name.trim(), brand.trim(), categoryId,
  ]), [name, brand, categoryId]);

  useEffect(() => {
    setMatches([]);
    setCheckedIdentity("");
    setConfirmSimilar(false);
  }, [identity]);

  const checkMatches = async () => {
    if (!name.trim()) {
      setError("Enter a product name before checking the Master Catalog.");
      return [] as ProductMatch[];
    }
    setChecking(true);
    setError("");
    try {
      const query = new URLSearchParams({ name: name.trim() });
      if (brand.trim()) query.set("brand", brand.trim());
      if (categoryId) query.set("categoryId", categoryId);
      const response = await apiRequest<{ matches: ProductMatch[] }>(
        `/api/vendor/product-matches?${query.toString()}`,
        token,
      );
      setMatches(response.matches ?? []);
      setCheckedIdentity(identity);
      setConfirmSimilar(false);
      return response.matches ?? [];
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Unable to check the Master Catalog.";
      setError(message);
      onMessage(message, "error");
      return null;
    } finally {
      setChecking(false);
    }
  };

  const useExistingProduct = async (match: ProductMatch) => {
    if (!match.canAddToStore || busyMatchId || saving) return;
    setBusyMatchId(match.id);
    try {
      const response = await apiRequest<{ product: Product; reused?: boolean }>(
        `/api/vendor/master-products/${match.id}/add-to-store`,
        token,
        { method: "POST", body: JSON.stringify({}) },
      );
      onAdded({ ...response.product, masterProductId: response.product.masterProductId ?? match.id });
      onMessage(`${response.product.name} was added to My Store.`, "success");
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Unable to add the existing product.";
      onMessage(message, "error");
    } finally {
      setBusyMatchId("");
    }
  };

  const updateVariant = (index: number, patch: Partial<DraftVariant>) => {
    setVariants((current) => current.map((variant, row) => row === index ? { ...variant, ...patch } : variant));
  };

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (saving || imageUploading) return;
    if (!isAllowedProductImageReference(imageUrl)) {
      setError("Product image URLs must use HTTP or HTTPS.");
      return;
    }
    const validVariants = variants.filter((variant) => {
      const quantity = Number(variant.quantityValue);
      const price = Number(variant.price);
      const stock = Number(variant.stockQuantity);
      return Number.isFinite(quantity) && quantity > 0
        && Number.isFinite(price) && price >= 0
        && Number.isInteger(stock) && stock >= 0;
    });
    if (validVariants.length !== variants.length || !variants.some((variant) => Number(variant.price) > 0)) {
      setError("Add at least one complete selling option with a price greater than ₹0.");
      return;
    }
    let currentMatches = matches;
    if (checkedIdentity !== identity) {
      const result = await checkMatches();
      if (!result) return;
      currentMatches = result;
    }
    const exactMatch = currentMatches.find((match) => match.exactIdentity);
    if (exactMatch) {
      setError("An exact product identity already exists. Use the existing Master Catalog product instead.");
      return;
    }
    const similarMatches = currentMatches.filter((match) => !match.exactIdentity);
    if (similarMatches.length && !confirmSimilar) {
      setError("Review similar catalog products and choose Continue with New Product to confirm.");
      return;
    }

    setSaving(true);
    setError("");
    try {
      const response = await apiRequest<{ product: Product }>(
        "/api/vendor/products",
        token,
        {
          method: "POST",
          body: JSON.stringify({
            name: name.trim(),
            brand: brand.trim() || null,
            description: description.trim() || null,
            imageUrl: imageUrl.trim() || null,
            categoryId: categoryId || null,
            ...(requestedCategoryName.trim() ? { requestedCategoryName: requestedCategoryName.trim() } : {}),
            sku: sku.trim() || null,
            externalCode: externalCode.trim() || null,
            availability,
            isActive: true,
            price: Number(validVariants[0].price),
            stockQuantity: Number(validVariants[0].stockQuantity),
            variants: validVariants.map((variant) => ({
              quantityValue: String(Number(variant.quantityValue)),
              quantityUnit: variant.quantityUnit,
              price: Number(variant.price),
              stockQuantity: Number(variant.stockQuantity),
              availability: variant.availability,
              isActive: variant.isActive,
              ...(variant.sku.trim() ? { sku: variant.sku.trim() } : {}),
              ...(variant.externalCode.trim() ? { externalCode: variant.externalCode.trim() } : {}),
            })),
            confirmSimilar: Boolean(similarMatches.length && confirmSimilar),
          }),
        },
      );
      onAdded(response.product);
      onMessage(`${response.product.name} was added to My Store.`, "success");
    } catch (cause) {
      const message = cause instanceof ApiRequestError && cause.status === 409
        ? `${cause.message} Check the Master Catalog matches before continuing.`
        : cause instanceof Error ? cause.message : "Unable to add this product.";
      setError(message);
      if (cause instanceof ApiRequestError && cause.status === 409) {
        setCheckedIdentity("");
        setConfirmSimilar(false);
        void checkMatches();
      }
      onMessage(message, "error");
    } finally {
      setSaving(false);
    }
  };

  const exactMatch = matches.find((match) => match.exactIdentity);
  const similarMatches = matches.filter((match) => !match.exactIdentity);
  const currentCheckIsValid = checkedIdentity === identity;

  return (
    <section className="vendor-card vendor-new-product-panel" aria-labelledby="new-vendor-product-title">
      <div className="vendor-card-heading">
        <div>
          <p className="vendor-eyebrow">Store-specific listing</p>
          <h3 className="vendor-subtitle" id="new-vendor-product-title">Add New Product</h3>
          <p className="vendor-text-muted">This product is created for your store only. It will not be added to the shared Master Catalog.</p>
        </div>
      </div>
      <form className="vendor-new-product-form" onSubmit={submit}>
        <label className="vendor-label">
          Product name
          <input className="vendor-input" value={name} onChange={(event) => setName(event.target.value)} required disabled={saving} />
        </label>
        <div className="vendor-two-column">
          <label className="vendor-label">
            Brand <span className="vendor-text-muted vendor-font-normal">(Optional)</span>
            <input className="vendor-input" value={brand} onChange={(event) => setBrand(event.target.value)} disabled={saving} />
          </label>
          <label className="vendor-label">
            Category
            <select className="vendor-select" value={categoryId} onChange={(event) => { setCategoryId(event.target.value); if (event.target.value) setRequestedCategoryName(""); }} disabled={saving}>
              <option value="">Uncategorized</option>
              {categories.map((category) => <option key={category.id} value={category.id}>{category.name}{category.isActive ? "" : " (inactive)"}</option>)}
            </select>
          </label>
        </div>
        <label className="vendor-label">
          Category not available? Request a new category <span className="vendor-text-muted vendor-font-normal">(Optional; reviewed separately)</span>
          <input className="vendor-input" value={requestedCategoryName} onChange={(event) => setRequestedCategoryName(event.target.value)} placeholder="Choose Uncategorized to request a category" disabled={saving || Boolean(categoryId)} />
        </label>
        <label className="vendor-label">
          Description <span className="vendor-text-muted vendor-font-normal">(Optional)</span>
          <textarea className="vendor-textarea" rows={3} value={description} onChange={(event) => setDescription(event.target.value)} disabled={saving} />
        </label>
        <VendorProductImageInput token={token} imageUrl={imageUrl} onChange={setImageUrl} onUploadingChange={setImageUploading} disabled={saving} />
        <div className="vendor-two-column">
          <label className="vendor-label">
            Store SKU <span className="vendor-text-muted vendor-font-normal">(Optional)</span>
            <input className="vendor-input" value={sku} onChange={(event) => setSku(event.target.value)} disabled={saving} />
          </label>
          <label className="vendor-label">
            External code <span className="vendor-text-muted vendor-font-normal">(Optional)</span>
            <input className="vendor-input" value={externalCode} onChange={(event) => setExternalCode(event.target.value)} disabled={saving} />
          </label>
        </div>
        <label className="vendor-selling-availability">
          <input type="checkbox" checked={availability} onChange={(event) => setAvailability(event.target.checked)} disabled={saving} />
          <span>Available to customers</span>
        </label>

        <div className="vendor-new-variants">
          <div className="vendor-card-heading vendor-new-variants-heading">
            <div>
              <h4 className="vendor-subtitle">Selling options</h4>
              <p className="vendor-text-muted">Set a quantity, unit, price, and stock for each option.</p>
            </div>
          </div>
          {variants.map((variant, index) => (
            <fieldset className="vendor-new-variant" key={index} disabled={saving}>
              <legend>Selling option {index + 1}</legend>
              <div className="vendor-new-variant-fields">
                <label className="vendor-label">
                  Quantity
                  <input className="vendor-input" type="number" min="0.001" step="any" required value={variant.quantityValue} onChange={(event) => updateVariant(index, { quantityValue: event.target.value })} onBlur={() => updateVariant(index, { quantityValue: formatQuantity(variant.quantityValue) })} />
                </label>
                <label className="vendor-label">
                  Unit
                  <select className="vendor-select" value={variant.quantityUnit} onChange={(event) => updateVariant(index, { quantityUnit: event.target.value as VariantQuantityUnit })}>
                    {units.map((unit) => <option key={unit.value} value={unit.value}>{unit.label}</option>)}
                  </select>
                </label>
                <label className="vendor-label">
                  Price (₹)
                  <input className="vendor-input" type="number" min="0" step="0.01" required value={variant.price} onChange={(event) => updateVariant(index, { price: event.target.value })} onBlur={() => { if (variant.price && Number.isFinite(Number(variant.price))) updateVariant(index, { price: formatPrice(variant.price) }); }} />
                </label>
                <label className="vendor-label">
                  Stock
                  <input className="vendor-input" type="number" min="0" step="1" required value={variant.stockQuantity} onChange={(event) => updateVariant(index, { stockQuantity: event.target.value })} />
                </label>
              </div>
              <div className="vendor-new-variant-footer">
                <label className="vendor-selling-availability">
                  <input type="checkbox" checked={variant.availability} onChange={(event) => updateVariant(index, { availability: event.target.checked })} />
                  <span>Available</span>
                </label>
                <details className="vendor-variant-advanced">
                  <summary>Optional variant codes</summary>
                  <div className="vendor-two-column">
                    <label className="vendor-label">SKU<input className="vendor-input" value={variant.sku} onChange={(event) => updateVariant(index, { sku: event.target.value })} /></label>
                    <label className="vendor-label">External code<input className="vendor-input" value={variant.externalCode} onChange={(event) => updateVariant(index, { externalCode: event.target.value })} /></label>
                  </div>
                </details>
                {variants.length > 1 && <button type="button" className="vendor-text-button" onClick={() => setVariants((current) => current.filter((_, row) => row !== index))}>Remove option</button>}
              </div>
            </fieldset>
          ))}
          <button type="button" className="vendor-secondary-button vendor-add-variant-button" disabled={saving} onClick={() => setVariants((current) => [...current, newVariant()])}>+ Add Another Variant</button>
        </div>

        <div className="vendor-duplicate-check">
          <div>
            <strong>Check the Master Catalog</strong>
            <p className="vendor-text-muted">We’ll look for the same product before creating a store-specific listing.</p>
          </div>
          <button type="button" className="vendor-secondary-button" onClick={() => void checkMatches()} disabled={checking || saving || !name.trim()}>{checking ? "Checking…" : "Check for matches"}</button>
        </div>
        {currentCheckIsValid && exactMatch && (
          <div className="vendor-duplicate-review" role="alert">
            <strong>An exact product identity exists in the Master Catalog.</strong>
            <MatchCard match={exactMatch} onUse={() => void useExistingProduct(exactMatch)} busy={busyMatchId === exactMatch.id} disabled={!exactMatch.canAddToStore || Boolean(busyMatchId) || saving} />
            {!exactMatch.canAddToStore && <p className="vendor-match-archived">This catalog item cannot currently be added to your store.</p>}
          </div>
        )}
        {currentCheckIsValid && !exactMatch && similarMatches.length > 0 && (
          <div className="vendor-duplicate-review" role="status">
            <strong>Similar product found in Master Catalog.</strong>
            {similarMatches.map((match) => <MatchCard key={match.id} match={match} onUse={() => void useExistingProduct(match)} busy={busyMatchId === match.id} disabled={!match.canAddToStore || Boolean(busyMatchId) || saving} />)}
            <div className="vendor-row-actions vendor-similar-actions">
              <button type="button" className="vendor-secondary-button" onClick={() => setConfirmSimilar(false)} disabled={saving}>Review matches</button>
              <button type="button" className="vendor-primary-button" onClick={() => { setConfirmSimilar(true); setError(""); }} disabled={saving}>Continue with New Product</button>
            </div>
            {confirmSimilar && <p className="vendor-text-muted">You confirmed that this is a different product. Submit to create it for your store.</p>}
          </div>
        )}
        {error && <div className="vendor-variant-save-error" role="alert">{error}</div>}
        <div className="vendor-form-actions">
          <button type="submit" className="vendor-primary-button" disabled={saving || imageUploading || checking || Boolean(exactMatch && currentCheckIsValid) || Boolean(similarMatches.length && currentCheckIsValid && !confirmSimilar)}>
            {imageUploading ? "Uploading image…" : saving ? "Adding product…" : "Add to My Store"}
          </button>
        </div>
      </form>
    </section>
  );
}

function MatchCard({ match, onUse, busy, disabled }: { match: ProductMatch; onUse: () => void; busy: boolean; disabled: boolean }) {
  return (
    <div className="vendor-match-row vendor-match-detail">
      {match.image ? <img className="vendor-match-image" src={match.image} alt="" /> : <span className="vendor-match-image vendor-match-monogram" aria-hidden="true">{match.name.slice(0, 1).toUpperCase()}</span>}
      <span className="vendor-match-copy">
        <strong>{match.name}</strong>
        {match.brand && <small>{match.brand}</small>}
        {match.categoryName && <small>{match.categoryName}</small>}
      </span>
      <button type="button" className="vendor-secondary-button vendor-compact-button" onClick={onUse} disabled={disabled}>{busy ? "Adding…" : "Use Existing Product"}</button>
    </div>
  );
}
