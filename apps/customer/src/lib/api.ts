import { supabase } from "./supabase";
import { setAuthTokenGetter, setBaseUrl } from "@workspace/api-client-react";
import { Platform } from "react-native";
import { nativeConfigurationIssues } from "./native-readiness.mjs";
export type { CustomerShoppingCategory } from "../../../../lib/api-client-react/src/generated/api.schemas";

export type CustomerDeliveryMode = "INSTANT" | "SCHEDULED";
export interface CustomerCheckoutSubmission {
  cartId: string;
  addressId: string;
  paymentMethod: "COD";
  idempotencyKey: string;
  deliveryMode: CustomerDeliveryMode;
  scheduledStartAt?: string;
  scheduledEndAt?: string;
}

export interface CustomerDeliverySlot {
  startAt: string;
  endAt: string;
}

export interface CustomerDeliverySlotsResponse {
  timeZone: "Asia/Kolkata";
  operatingStatus: "OPEN" | "CLOSED";
  slots: CustomerDeliverySlot[];
  nextOpeningAt?: string | null;
  scheduledDeliveryAvailable?: boolean;
}

export class CustomerRequestError extends Error {
  constructor(message: string, public readonly status: number, public readonly code?: string) {
    super(message);
    this.name = "CustomerRequestError";
  }
}

export interface CustomerProfile {
  id: string;
  fullName: string | null;
  phone: string | null;
}

export interface CustomerAddress {
  id: string;
  label: string | null;
  recipientName: string;
  phone: string;
  line1: string;
  line2: string | null;
  houseNumber?: string | null;
  buildingName?: string | null;
  landmark?: string | null;
  locality?: string | null;
  city: string;
  state: string;
  pincode: string;
  isDefault: boolean;
}

export type AddressInput = Omit<CustomerAddress, "id" | "houseNumber" | "buildingName" | "landmark" | "locality"> & {
  houseNumber: string;
  buildingName: string | null;
  landmark: string | null;
  locality: string | null;
};

export interface OperatingHour {
  dayOfWeek: number;
  opensAt: string | null;
  closesAt: string | null;
  isClosed: boolean;
}

export interface CustomerStore {
  id: string;
  name: string;
  locality?: string | null;
  city?: string | null;
  state?: string | null;
  pincode?: string | null;
  description: string | null;
  logoImageUrl: string | null;
  phone: string | null;
  deliveryFee: string;
  minimumOrderValue: string;
  operatingStatus: "OPEN" | "CLOSED";
  operatingHours: OperatingHour[];
  nextOpeningAt?: string | null;
  scheduledDeliveryAvailable?: boolean;
  timeZone?: "Asia/Kolkata";
}

export interface CustomerCategory {
  id: string;
  storeId: string;
  name: string;
}

export interface CustomerProduct {
  id: string;
  storeId: string;
  storeName?: string;
  categoryId: string | null;
  name: string;
  description: string | null;
  brand: string | null;
  categoryName: string | null;
  price: string;
  availability: boolean;
  purchasable: boolean;
  imageUrl: string | null;
  variants?: CustomerProductVariant[];
}

export interface CustomerProductPagination {
  page: number;
  pageSize: number;
  total: number;
}

export interface CustomerProductSearchResponse {
  products: CustomerProduct[];
  pagination: CustomerProductPagination;
}

export type CustomerQuantityUnit = "g" | "kg" | "ml" | "l" | "piece" | "pack" | "dozen" | "bottle" | "box";
export interface CustomerProductVariant {
  id: string;
  productId: string;
  name: string;
  quantityValue: string;
  quantityUnit: CustomerQuantityUnit;
  price: string;
  availability: boolean;
  isActive: boolean;
  sortOrder: number;
  purchasable: boolean;
}

export interface CustomerCartItem {
  id: string;
  productId: string;
  variantId: string;
  variantName: string;
  quantityValue: string;
  quantityUnit: CustomerQuantityUnit;
  name: string;
  imageUrl: string | null;
  quantity: number;
  unitPrice: string;
  lineSubtotal: string;
  availability: boolean;
  purchasable: boolean;
  unavailableReason?: "VARIANT_UNAVAILABLE" | "OUT_OF_STOCK" | "INSUFFICIENT_STOCK" | null;
}

export interface CustomerCart {
  id: string;
  storeId: string;
  storeName: string;
  status: "ACTIVE";
  items: CustomerCartItem[];
  subtotal: string;
  deliveryFee: string;
  handlingFee?: string;
  minimumOrderValue: string;
  total: string;
  checkoutReady: boolean;
  operatingStatus: "OPEN" | "CLOSED";
  instantDeliveryAvailable?: boolean;
  scheduledDeliveryAvailable?: boolean;
}

export type CustomerOrderStatus = "PLACED" | "ACCEPTED" | "PREPARING" | "READY" | "OUT_FOR_DELIVERY" | "DELIVERED" | "REJECTED" | "CANCELLED";
export interface CustomerOrderSummary {
  id: string;
  storeId: string;
  storeName: string;
  status: CustomerOrderStatus;
  totalAmount: string;
  createdAt: string;
  deliveryMode: CustomerDeliveryMode;
  scheduledStartAt: string | null;
  scheduledEndAt: string | null;
  itemSummary: Array<{
    productNameSnapshot: string;
    variantNameSnapshot?: string | null;
    quantity: number;
  }>;
}
export interface CustomerOrderItem {
  id: string;
  variantId: string | null;
  variantNameSnapshot: string | null;
  variantQuantityValueSnapshot: string | null;
  variantQuantityUnitSnapshot: CustomerQuantityUnit | null;
  productNameSnapshot: string;
  productPriceSnapshot: string;
  quantity: number;
  subtotal: string;
}
export interface CustomerOrderStatusHistory {
  id: string;
  status: CustomerOrderStatus;
  note: string | null;
  createdAt: string;
}
export interface CustomerOrderAddressSnapshot {
  label: string | null;
  recipientName: string;
  phone: string;
  line1: string;
  line2: string | null;
  houseNumber?: string | null;
  buildingName?: string | null;
  landmark?: string | null;
  locality?: string | null;
  city: string;
  state: string;
  pincode: string;
}
export interface CustomerOrderDetail extends CustomerOrderSummary {
  items: CustomerOrderItem[];
  subtotal: string;
  deliveryFeeSnapshot: string;
  handlingFeeSnapshot?: string;
  deliveryAddressSnapshot: CustomerOrderAddressSnapshot;
  paymentMethod: "COD";
  deliveryType: string;
  deliveryContactName: string;
  deliveryContactPhone: string;
  statusHistory: CustomerOrderStatusHistory[];
  updatedAt: string;
}

export interface RepeatOrderPreviewItem {
  orderItemId: string;
  productName: string;
  variantNameSnapshot: string | null;
  quantity: number;
  currentUnitPrice: string | null;
  available: boolean;
  reason: string | null;
}

export interface RepeatOrderPreview {
  storeAvailable: boolean;
  storeSwitchRequired: boolean;
  storeName: string;
  existingStoreName: string | null;
  items: RepeatOrderPreviewItem[];
  canAddCount: number;
}

export interface RepeatOrderResult {
  cart: CustomerCart | null;
  added: RepeatOrderPreviewItem[];
  unavailable: RepeatOrderPreviewItem[];
  addedCount: number;
}

const domain = process.env.EXPO_PUBLIC_DOMAIN;
const apiUrl = (
  process.env.EXPO_PUBLIC_API_URL ??
  (domain ? `https://${domain}` : "")
).replace(/\/+$/, "");
// Web retains its existing same-origin transport. Native requests must never
// silently resolve relative URLs or ship a privileged Supabase credential.
export const nativeConfigurationError = Platform.OS === "web" ? "" : nativeConfigurationIssues({
  apiUrl,
  supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL,
  anonKey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
}).join(" ");
setBaseUrl(apiUrl || null);
setAuthTokenGetter(async () => {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
});

/** Resolve managed, root-relative product images against the configured API origin. */
export function customerImageUri(imageUrl: string | null | undefined): string | undefined {
  if (!imageUrl) return undefined;
  if (/^https?:\/\//i.test(imageUrl)) return imageUrl;
  return `${apiUrl}${imageUrl.startsWith("/") ? imageUrl : `/${imageUrl}`}`;
}

export async function customerApi<T>(path: string, init: RequestInit = {}): Promise<T> {
  if (nativeConfigurationError) throw new Error(nativeConfigurationError);
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Please sign in again.");
  const response = await fetch(`${apiUrl}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...init.headers,
    },
  });
  if (response.status === 204) return undefined as T;
  const payload = await response.json().catch(() => undefined) as
    | T
    | { error?: string; details?: Array<{ message?: string }> }
    | undefined;
  if (!response.ok) {
    const error = payload as { error?: string; code?: string; details?: Array<{ message?: string }> } | undefined;
    throw new CustomerRequestError(error?.details?.[0]?.message ?? error?.error ?? "Unable to complete request.", response.status, error?.code);
  }
  return payload as T;
}