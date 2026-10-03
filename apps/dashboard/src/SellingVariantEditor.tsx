import { useLayoutEffect, useRef, useState } from "react";
import { formatQuantity, formatVariantName, formatPrice } from "@workspace/validation/variant-formatting";
import {
  ApiRequestError,
  apiRequest,
  type Product,
  type ProductVariant,
  type VariantQuantityUnit,
  type VendorProductVariantBatchInput,
  type VendorProductVariantsBatchInput,
  type VendorProductVariantsBatchResponse,
} from "./api";

interface SellingVariantEditorProps {
  token: string;
  product: Product;
  onProductUpdated: (product: Product) => void;
  onMessage: (message: string, kind?: "success" | "error") => void;
}

interface SellingVariantDraft {
  id?: string;
  expectedUpdatedAt: string;
  quantityValue: string;
  quantityUnit: VariantQuantityUnit | "";
  price: string;
  stockQuantity: string;
  availability: boolean;
  isActive: boolean;
  sku: string;
  externalCode: string;
}

type VariantField = "quantity" | "unit" | "price" | "stock";
type VariantFieldErrors = Partial<Record<VariantField, string>>;

const quantityUnits: Array<{ value: VariantQuantityUnit; label: string }> = [
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

function draftFromVariant(variant: ProductVariant): SellingVariantDraft {
  return {
    id: variant.id,
    expectedUpdatedAt: variant.updatedAt,
    quantityValue: formatQuantity(variant.quantityValue),
    quantityUnit: variant.quantityUnit,
    price: formatPrice(variant.price),
    stockQuantity: String(variant.stockQuantity),
    availability: variant.availability,
    isActive: variant.isActive,
    sku: variant.sku ?? "",
    externalCode: variant.externalCode ?? "",
  };
}

function sortedProductVariants(product: Product) {
  return [...(product.variants ?? [])]
    .sort((left, right) => left.sortOrder - right.sortOrder);
}

interface SavedVariantBaseline {
  signature: string;
  drafts: SellingVariantDraft[];
}

function createSavedVariantBaseline(product: Product): SavedVariantBaseline {
  const savedVariants = sortedProductVariants(product);
  return {
    signature: JSON.stringify({
      productId: product.id,
      variants: savedVariants.map((variant) => ({
        id: variant.id,
        quantityValue: variant.quantityValue,
        quantityUnit: variant.quantityUnit,
        price: variant.price,
        stockQuantity: variant.stockQuantity,
        availability: variant.availability,
        isActive: variant.isActive,
        sku: variant.sku,
        externalCode: variant.externalCode,
        sortOrder: variant.sortOrder,
        updatedAt: variant.updatedAt,
      })),
    }),
    drafts: savedVariants.map(draftFromVariant),
  };
}

function draftStateSignature(drafts: SellingVariantDraft[]) {
  return JSON.stringify(drafts.map((draft) => ({
    id: draft.id ?? null,
    quantityValue: draft.quantityValue,
    quantityUnit: draft.quantityUnit,
    price: draft.price,
    stockQuantity: draft.stockQuantity,
    availability: draft.availability,
    isActive: draft.isActive,
    sku: draft.sku,
    externalCode: draft.externalCode,
  })));
}

function formatVariantLabel(quantityValue: string, quantityUnit: VariantQuantityUnit | "") {
  if (!quantityValue || !quantityUnit) return "Your selling option";
  const numericQuantity = Number(quantityValue);
  if (!Number.isFinite(numericQuantity) || numericQuantity <= 0) return "Your selling option";
  return formatVariantName(quantityValue, quantityUnit);
}

function getFieldErrors(draft: SellingVariantDraft): VariantFieldErrors {
  const quantity = Number(draft.quantityValue);
  const price = Number(draft.price);
  const stock = Number(draft.stockQuantity);
  const errors: VariantFieldErrors = {};

  if (!draft.quantityValue.trim() || !Number.isFinite(quantity) || quantity <= 0) {
    errors.quantity = "Enter a quantity greater than zero.";
  } else if (Math.abs(quantity * 1_000 - Math.round(quantity * 1_000)) >= 1e-8) {
    errors.quantity = "Use at most three decimal places for quantity.";
  }
  if (!draft.quantityUnit) errors.unit = "Choose a unit.";
  if (
    !draft.price.trim()
    || !Number.isFinite(price)
    || (draft.isActive ? price <= 0 : price < 0)
  ) {
    errors.price = draft.isActive
      ? "Enter a price greater than ₹0."
      : "Enter a price of ₹0 or more.";
  } else if (Math.abs(price * 100 - Math.round(price * 100)) >= 1e-8) {
    errors.price = "Use at most two decimal places for price.";
  }
  if (
    !draft.stockQuantity.trim()
    || !Number.isFinite(stock)
    || stock < 0
    || !Number.isInteger(stock)
  ) {
    errors.stock = "Enter a whole stock quantity of 0 or more.";
  }
  return errors;
}

function toBatchInput(draft: SellingVariantDraft): VendorProductVariantBatchInput {
  return {
    ...(draft.id ? { id: draft.id, expectedUpdatedAt: draft.expectedUpdatedAt } : {}),
    quantityValue: String(Number(draft.quantityValue)),
    quantityUnit: draft.quantityUnit as VariantQuantityUnit,
    price: Number(draft.price).toFixed(2),
    stockQuantity: Number(draft.stockQuantity),
    availability: draft.availability,
    isActive: draft.isActive,
    sku: draft.sku.trim() || null,
    externalCode: draft.externalCode.trim() || null,
  };
}

function describeValidationError(index: number, errors: VariantFieldErrors) {
  const fields = [
    errors.quantity,
    errors.unit,
    errors.price,
    errors.stock,
  ].filter(Boolean);
  return fields.length ? `Variant ${index + 1}: ${fields.join(" ")}` : "";
}

export function SellingVariantEditor({
  token,
  product,
  onProductUpdated,
  onMessage,
}: SellingVariantEditorProps) {
  const initialBaseline = createSavedVariantBaseline(product);
  const [variants, setVariants] = useState<SellingVariantDraft[]>(() => initialBaseline.drafts);
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [isStale, setIsStale] = useState(false);
  const baselineRef = useRef(initialBaseline);
  const variantsRef = useRef(variants);
  variantsRef.current = variants;
  const productBaselineSignature = createSavedVariantBaseline(product).signature;
  const previousProductBaselineRef = useRef(productBaselineSignature);

  useLayoutEffect(() => {
    if (previousProductBaselineRef.current === productBaselineSignature) return;
    previousProductBaselineRef.current = productBaselineSignature;

    const currentDrafts = variantsRef.current;
    const savedDrafts = baselineRef.current.drafts;
    if (draftStateSignature(currentDrafts) !== draftStateSignature(savedDrafts)) {
      setIsStale(true);
      return;
    }

    const nextBaseline = createSavedVariantBaseline(product);
    baselineRef.current = nextBaseline;
    variantsRef.current = nextBaseline.drafts;
    setVariants(nextBaseline.drafts);
    setIsStale(false);
    setSaveError("");
  }, [product, productBaselineSignature]);
  const hasUnsavedChanges = draftStateSignature(variants) !== draftStateSignature(baselineRef.current.drafts);
  const staleDetected = isStale || (
    productBaselineSignature !== baselineRef.current.signature && hasUnsavedChanges
  );

  const reloadSavedVariants = async () => {
    if (busy) return;
    setBusy(true);
    setSaveError("");
    try {
      const response = await apiRequest<VendorProductVariantsBatchResponse>(
        `/api/vendor/products/${product.id}`,
        token,
      );
      if (!Array.isArray(response.product.variants)) {
        throw new Error("The saved listing did not include its selling variants. Reload the listing to confirm the current values.");
      }
      const nextBaseline = createSavedVariantBaseline(response.product);
      baselineRef.current = nextBaseline;
      variantsRef.current = nextBaseline.drafts;
      setVariants(nextBaseline.drafts);
      setIsStale(false);
      onProductUpdated(response.product);
      onMessage("Saved selling variants reloaded.", "success");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to reload saved selling variants.";
      setSaveError(message);
      onMessage(message, "error");
    } finally {
      setBusy(false);
    }
  };

  const variantErrors = variants.map(getFieldErrors);
  const hasRows = variants.length > 0;
  const allRowsValid = hasRows && variantErrors.every((errors) => Object.keys(errors).length === 0);
  const activeRows = variants.filter((variant) => variant.isActive);
  const hasAvailableActiveVariant = activeRows.some((variant) => variant.availability);
  const canPublish = hasAvailableActiveVariant && allRowsValid;
  const validationReasons = variants.flatMap((_, index) => {
    const message = describeValidationError(index, variantErrors[index]);
    return message ? [message] : [];
  });
  if (!activeRows.length) validationReasons.unshift("Activate at least one selling variant before publishing.");
  else if (!hasAvailableActiveVariant) {
    validationReasons.unshift('Turn on "Available to customers" for at least one active selling variant before publishing.');
  }
  if (!hasRows) validationReasons.unshift("Add at least one selling variant.");

  const updateVariant = (index: number, patch: Partial<SellingVariantDraft>) => {
    setVariants((current) => current.map((variant, variantIndex) => (
      variantIndex === index ? { ...variant, ...patch } : variant
    )));
    setSaveError("");
  };

  const saveVariants = async (publish: boolean) => {
    if (busy || staleDetected || (publish ? !canPublish : !allRowsValid)) return;
    setBusy(true);
    setSaveError("");
    try {
      const body: VendorProductVariantsBatchInput = {
        variants: variants.map(toBatchInput),
        publish,
      };
      const response = await apiRequest<VendorProductVariantsBatchResponse>(
        `/api/vendor/products/${product.id}/variants/batch`,
        token,
        {
          method: "PUT",
          body: JSON.stringify(body),
        },
      );
      if (!Array.isArray(response.product.variants)) {
        throw new Error("The saved listing did not include its updated selling variants. Reload the listing to confirm the changes.");
      }
      const nextBaseline = createSavedVariantBaseline(response.product);
      baselineRef.current = nextBaseline;
      variantsRef.current = nextBaseline.drafts;
      setVariants(nextBaseline.drafts);
      setIsStale(false);
      onProductUpdated(response.product);
      onMessage(publish ? "Listing published." : "Selling variants saved.", "success");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to save selling variants.";
      if (error instanceof ApiRequestError && error.status === 409) {
        setIsStale(true);
        setSaveError(message);
        onMessage(`${message} Reload saved variants before trying again.`, "error");
        return;
      }
      setSaveError(message);
      onMessage(message, "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="vendor-card vendor-selling-variant-editor" aria-label={`${product.name} selling variants`}>
      <div className="vendor-card-heading">
        <div>
          <h3 className="vendor-subtitle">Configure selling variants</h3>
          <p className="vendor-text-muted">
            Set the quantity, price, stock, and availability for each option you sell.
            {product.isActive ? " Changes are saved together." : " The listing stays unavailable until you publish it."}
          </p>
        </div>
      </div>

      {(product.variants?.length ?? 0) > 0 && (
        <div className="vendor-saved-variants" aria-label="Saved selling variants">
          <h4 className="vendor-subtitle">Saved selling options</h4>
          {[...(product.variants ?? [])]
            .sort((left, right) => left.sortOrder - right.sortOrder)
            .map((variant) => {
              const state = !variant.isActive
                ? "Inactive"
                : !variant.availability
                  ? "Unavailable"
                  : variant.stockQuantity === 0
                    ? "Out of stock"
                    : "Available";
              return (
                <div className="vendor-saved-variant-row" key={variant.id}>
                  <strong>{formatVariantName(variant.quantityValue, variant.quantityUnit)}</strong>
                  <span>₹{formatPrice(variant.price)}</span>
                  <span>{variant.stockQuantity} in stock</span>
                  <span className={`vendor-status-badge ${state === "Available" ? "vendor-status-active" : "vendor-status-inactive"}`}>
                    {state}
                  </span>
                </div>
              );
            })}
        </div>
      )}

      {variants.length === 0 ? (
        <div className="vendor-empty-state vendor-compact">
          <strong>No selling variants yet</strong>
          <span>Add an option such as 500 g or 1 kg to configure this listing.</span>
        </div>
      ) : (
        <div className="vendor-selling-variant-list">
          {variants.map((variant, index) => {
            const fieldErrors = variantErrors[index];
            const label = formatVariantLabel(variant.quantityValue, variant.quantityUnit);
            const fieldId = (suffix: string) => `selling-variant-${index}-${suffix}`;
            return (
              <article
                className={`vendor-selling-variant-row ${variant.isActive ? "" : "is-inactive"}`}
                data-testid="selling-variant-row"
                key={variant.id ?? `draft-${index}`}
              >
                <div className="vendor-selling-variant-heading">
                  <div>
                    <span className="vendor-text-muted">Variant {index + 1}</span>
                    <strong>{label}</strong>
                  </div>
                  <div className="vendor-row-actions">
                    {variant.id && (
                      <button
                        className="vendor-text-button"
                        data-testid="selling-variant-toggle-active"
                        disabled={busy}
                        onClick={() => updateVariant(index, { isActive: !variant.isActive })}
                        type="button"
                      >
                        {variant.isActive ? "Deactivate" : "Activate"}
                      </button>
                    )}
                    {!variant.id && (
                      <button
                        className="vendor-text-button"
                        data-testid="selling-variant-remove-draft"
                        disabled={busy}
                        onClick={() => {
                          setVariants((current) => current.filter((_, rowIndex) => rowIndex !== index));
                          setSaveError("");
                        }}
                        type="button"
                      >
                        Remove
                      </button>
                    )}
                  </div>
                </div>

                <div className="vendor-selling-variant-fields">
                  <label className="vendor-label" htmlFor={fieldId("quantity")}>
                    Quantity
                    <input
                      aria-describedby={fieldErrors.quantity ? fieldId("quantity-error") : undefined}
                      aria-invalid={Boolean(fieldErrors.quantity)}
                      className="vendor-input"
                      data-testid="selling-variant-quantity"
                      disabled={busy}
                      id={fieldId("quantity")}
                      min="0.001"
                      onChange={(event) => updateVariant(index, { quantityValue: event.target.value })}
                      onBlur={() => updateVariant(index, { quantityValue: formatQuantity(variant.quantityValue) })}
                      placeholder="e.g. 500"
                      required
                      step="any"
                      type="number"
                      value={variant.quantityValue}
                    />
                    {fieldErrors.quantity && <span className="vendor-variant-field-error" id={fieldId("quantity-error")}>{fieldErrors.quantity}</span>}
                  </label>

                  <label className="vendor-label" htmlFor={fieldId("unit")}>
                    Unit
                    <select
                      aria-describedby={fieldErrors.unit ? fieldId("unit-error") : undefined}
                      aria-invalid={Boolean(fieldErrors.unit)}
                      className="vendor-select"
                      data-testid="selling-variant-unit"
                      disabled={busy}
                      id={fieldId("unit")}
                      onChange={(event) => updateVariant(index, { quantityUnit: event.target.value as VariantQuantityUnit | "" })}
                      required
                      value={variant.quantityUnit}
                    >
                      <option value="">Select unit</option>
                      {quantityUnits.map((unit) => <option key={unit.value} value={unit.value}>{unit.label}</option>)}
                    </select>
                    {fieldErrors.unit && <span className="vendor-variant-field-error" id={fieldId("unit-error")}>{fieldErrors.unit}</span>}
                  </label>

                  <label className="vendor-label" htmlFor={fieldId("price")}>
                    Price (₹)
                    <input
                      aria-describedby={fieldErrors.price ? fieldId("price-error") : undefined}
                      aria-invalid={Boolean(fieldErrors.price)}
                      className="vendor-input"
                      data-testid="selling-variant-price"
                      disabled={busy}
                      id={fieldId("price")}
                      min={variant.isActive ? "0.01" : "0"}
                      onChange={(event) => updateVariant(index, { price: event.target.value })}
                      onBlur={() => {
                        if (!getFieldErrors(variant).price) {
                          updateVariant(index, { price: formatPrice(variant.price) });
                        }
                      }}
                      placeholder="e.g. 40"
                      required
                      step="0.01"
                      type="number"
                      value={variant.price}
                    />
                    {fieldErrors.price && <span className="vendor-variant-field-error" id={fieldId("price-error")}>{fieldErrors.price}</span>}
                  </label>

                  <label className="vendor-label" htmlFor={fieldId("stock")}>
                    Stock
                    <input
                      aria-describedby={fieldErrors.stock ? fieldId("stock-error") : fieldId("stock-help")}
                      aria-invalid={Boolean(fieldErrors.stock)}
                      className="vendor-input"
                      data-testid="selling-variant-stock"
                      disabled={busy}
                      id={fieldId("stock")}
                      min="0"
                      onChange={(event) => updateVariant(index, { stockQuantity: event.target.value })}
                      placeholder="0"
                      required
                      step="1"
                      type="number"
                      value={variant.stockQuantity}
                    />
                    {fieldErrors.stock
                      ? <span className="vendor-variant-field-error" id={fieldId("stock-error")}>{fieldErrors.stock}</span>
                      : <span className="vendor-text-muted vendor-variant-field-hint" id={fieldId("stock-help")}>0 is allowed.</span>}
                  </label>
                </div>

                <label className="vendor-selling-availability" htmlFor={fieldId("availability")}>
                  <input
                    checked={variant.availability}
                    data-testid="selling-variant-availability"
                    disabled={busy}
                    id={fieldId("availability")}
                    onChange={(event) => updateVariant(index, { availability: event.target.checked })}
                    type="checkbox"
                  />
                  <span>Available to customers</span>
                </label>
                {!variant.isActive && <p className="vendor-variant-inactive-note">This option is inactive and will not be shown for sale.</p>}

                <details className="vendor-variant-advanced" open={Boolean(variant.sku || variant.externalCode)}>
                  <summary>Optional store codes</summary>
                  <div className="vendor-two-column">
                    <label className="vendor-label" htmlFor={fieldId("sku")}>
                      SKU <span className="vendor-text-muted vendor-font-normal">optional</span>
                      <input
                        className="vendor-input"
                        data-testid="selling-variant-sku"
                        disabled={busy}
                        id={fieldId("sku")}
                        onChange={(event) => updateVariant(index, { sku: event.target.value })}
                        value={variant.sku}
                      />
                    </label>
                    <label className="vendor-label" htmlFor={fieldId("external-code")}>
                      External code <span className="vendor-text-muted vendor-font-normal">optional</span>
                      <input
                        className="vendor-input"
                        data-testid="selling-variant-external-code"
                        disabled={busy}
                        id={fieldId("external-code")}
                        onChange={(event) => updateVariant(index, { externalCode: event.target.value })}
                        value={variant.externalCode}
                      />
                    </label>
                  </div>
                </details>
              </article>
            );
          })}
        </div>
      )}

      <button
        className="vendor-secondary-button vendor-add-variant-button"
        data-testid="add-selling-variant"
        disabled={busy}
        onClick={() => {
          setVariants((current) => [...current, {
            expectedUpdatedAt: "",
            quantityValue: "",
            quantityUnit: "",
            price: "",
            stockQuantity: "0",
            availability: true,
            isActive: true,
            sku: "",
            externalCode: "",
          }]);
          setSaveError("");
        }}
        type="button"
      >
        + Add Another Variant
      </button>

      {staleDetected && (
        <div className="vendor-variant-save-error" role="alert">
          <strong>Catalog selling variants changed since these edits were loaded.</strong>
          <span> Reload saved variants to discard local changes and continue safely.</span>
          <button
            className="vendor-text-button"
            data-testid="reload-saved-variants"
            disabled={busy}
            onClick={() => void reloadSavedVariants()}
            type="button"
          >
            {busy ? "Reloading…" : "Reload saved variants / Discard changes"}
          </button>
        </div>
      )}
      {validationReasons.length > 0 && (
        <div className="vendor-variant-validation" role="status">
          <strong>Complete the selling variant details before publishing.</strong>
          <ul>
            {validationReasons.map((reason) => <li key={reason}>{reason}</li>)}
          </ul>
          {allRowsValid && <p>You can still save these variants without publishing.</p>}
        </div>
      )}
      {saveError && <div className="vendor-variant-save-error" role="alert">{saveError}</div>}

      <div className="vendor-form-actions vendor-selling-variant-actions">
        <button
          className="vendor-secondary-button"
          data-testid="save-variants"
          disabled={busy || staleDetected || !allRowsValid}
          onClick={() => void saveVariants(false)}
          type="button"
        >
          {busy ? "Saving…" : "Save Variants"}
        </button>
        <button
          className="vendor-primary-button"
          data-testid="publish-listing"
          disabled={busy || staleDetected || !canPublish}
          onClick={() => void saveVariants(true)}
          type="button"
        >
          {busy ? "Saving…" : "Publish Listing"}
        </button>
      </div>
    </section>
  );
}