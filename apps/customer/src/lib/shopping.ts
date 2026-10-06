export function matchingCustomerStores<T extends { name: string }>(eligibleStores: readonly T[], search: string): T[] {
  const query = search.trim().toLocaleLowerCase("en");
  return query ? eligibleStores.filter(store => store.name.toLocaleLowerCase("en").includes(query)) : [];
}

import { formatPrice } from "@workspace/validation/variant-formatting";
import type { CustomerProduct, CustomerProductVariant } from "./api";

export function activeVariants(product: CustomerProduct) {
  return [...(product.variants ?? [])].filter(variant => variant.isActive)
    .sort((left, right) => left.sortOrder - right.sortOrder);
}

/** Stock remains private: the API's purchase flags are authoritative. */
export function canPurchaseVariant(product: CustomerProduct, variant: CustomerProductVariant) {
  return variant.productId === product.id && product.availability && product.purchasable && variant.isActive
    && variant.availability && variant.purchasable && Number.isFinite(Number(variant.price)) && Number(variant.price) > 0;
}

export function initialVariantId(product: CustomerProduct) {
  const variants = activeVariants(product);
  return variants.length === 1 && canPurchaseVariant(product, variants[0]) ? variants[0].id : "";
}

/** Refreshes may clear a choice, but must never substitute a different option. */
export function retainedVariantId(product: CustomerProduct, selectedId: string) {
  return activeVariants(product).some(variant => variant.id === selectedId && canPurchaseVariant(product, variant))
    ? selectedId : "";
}

/** Re-read the exact listing before submission; the cart API still owns final validation. */
export async function freshCartSelection(
  listing: CustomerProduct,
  selectedId: string,
  loadListing: () => Promise<CustomerProduct>,
) {
  const product = await loadListing();
  if (product.id !== listing.id || product.storeId !== listing.storeId) {
    throw new Error("This store listing is currently unavailable.");
  }
  const variant = activeVariants(product).find(option => option.id === selectedId);
  if (!variant || !canPurchaseVariant(product, variant)) {
    throw new Error("Sorry, this option is no longer available. Please select another option.");
  }
  return { product, variant };
}

export function variantAvailabilityLabel(product: CustomerProduct, variant: CustomerProductVariant) {
  if (!product.availability || !variant.isActive || !variant.availability || Number(variant.price) <= 0) {
    return "Currently unavailable";
  }
  return canPurchaseVariant(product, variant) ? "Available" : "Out of stock";
}

export function productAvailabilityLabel(product: CustomerProduct) {
  if (!product.availability) return "Currently unavailable";
  if (product.purchasable) return "Available";
  return activeVariants(product).some(variant => variant.availability && Number(variant.price) > 0)
    ? "Out of stock" : "Currently unavailable";
}

export function productPriceLabel(product: CustomerProduct, selected?: CustomerProductVariant) {
  if (selected) return Number(selected.price) > 0 ? `₹${formatPrice(selected.price)}` : "Price unavailable";
  const variants = activeVariants(product).filter(variant => Number(variant.price) > 0);
  const purchasable = variants.filter(variant => canPurchaseVariant(product, variant));
  const candidates = purchasable.length ? purchasable : variants;
  const cheapest = [...candidates].sort((a, b) => Number(a.price) - Number(b.price))[0];
  return cheapest ? `${variants.length > 1 ? "From " : ""}₹${formatPrice(cheapest.price)}` : "No selling options";
}

export function discoveryQuery(pincode: string, search: string, categoryId = "", page = 1) {
  const query = new URLSearchParams({ pincode, page: String(page), pageSize: "24" });
  if (search.trim()) query.set("search", search.trim());
  if (categoryId) query.set("categoryId", categoryId);
  return query.toString();
}

export function cartItemInput(product: CustomerProduct, variant: CustomerProductVariant, quantity: number, confirmStoreSwitch = false) {
  if (!product.variants?.some(option => option.id === variant.id && canPurchaseVariant(product, option))
    || !canPurchaseVariant(product, variant)) {
    throw new Error("This option is currently unavailable.");
  }
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 999) {
    throw new Error("Choose a quantity between 1 and 999.");
  }
  // Never submit a client-owned price, stock, or store; the API derives them.
  return { productId: product.id, variantId: variant.id, quantity, confirmStoreSwitch };
}

/** Never show unknown database or API diagnostics to shoppers. */
export function shoppingError(reason: unknown, fallback = "We couldn't complete that request. Please try again.") {
  const message = reason instanceof Error ? reason.message : "";
  const code = reason && typeof reason === "object" && "code" in reason ? reason.code : null;
  if (["OUT_OF_STOCK", "INSUFFICIENT_STOCK", "VARIANT_UNAVAILABLE", "INVALID_QUANTITY", "IDEMPOTENCY_CONFLICT", "ORDER_ALREADY_PROCESSED"].includes(String(code))) return message || fallback;
  if (message === "Sorry, this option is no longer available. Please select another option.") return message;
  if (/sign in|authentication/i.test(message)) return "Please sign in again to continue shopping.";
  if (/stock/i.test(message)) return "That quantity is no longer available. Try fewer items or another option.";
  if (/store.*(unavailable|not available)/i.test(message)) return "This store is not available for your delivery address.";
  if (/saved.*(address|pincode)/i.test(message)) return "Choose a saved delivery address to shop nearby stores.";
  if (/unavailable|not available/i.test(message)) return "This product or option is currently unavailable.";
  if (message === "Choose a quantity between 1 and 999.") return message;
  if (/network|failed to fetch/i.test(message)) return "Couldn't connect. Check your connection and try again.";
  return fallback;
}