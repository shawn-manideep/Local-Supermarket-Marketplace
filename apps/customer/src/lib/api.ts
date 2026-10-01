import { supabase } from "./supabase";

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
  city: string;
  state: string;
  pincode: string;
  isDefault: boolean;
}

export type AddressInput = Omit<CustomerAddress, "id">;

export interface OperatingHour {
  dayOfWeek: number;
  opensAt: string | null;
  closesAt: string | null;
  isClosed: boolean;
}

export interface CustomerStore {
  id: string;
  name: string;
  description: string | null;
  logoImageUrl: string | null;
  phone: string | null;
  deliveryFee: string;
  minimumOrderValue: string;
  operatingStatus: "OPEN" | "CLOSED";
  operatingHours: OperatingHour[];
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
}

export interface CustomerCart {
  id: string;
  storeId: string;
  storeName: string;
  status: "ACTIVE";
  items: CustomerCartItem[];
  subtotal: string;
  deliveryFee: string;
  minimumOrderValue: string;
  total: string;
  checkoutReady: boolean;
}

export type CustomerOrderStatus = "PLACED" | "ACCEPTED" | "PREPARING" | "READY" | "OUT_FOR_DELIVERY" | "DELIVERED" | "REJECTED" | "CANCELLED";
export interface CustomerOrderSummary {
  id: string;
  storeId: string;
  storeName: string;
  status: CustomerOrderStatus;
  totalAmount: string;
  createdAt: string;
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
  city: string;
  state: string;
  pincode: string;
}
export interface CustomerOrderDetail extends CustomerOrderSummary {
  items: CustomerOrderItem[];
  subtotal: string;
  deliveryFeeSnapshot: string;
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
  variantNameSnapshot: string;
  quantity: number;
  currentUnitPrice: string | null;
  available: boolean;
  reason: string | null;
}

export interface RepeatOrderPreview {
  storeAvailable: boolean;
  storeSwitchRequired: boolean;
  items: RepeatOrderPreviewItem[];
  canAddCount: number;
}

export interface RepeatOrderResult {
  cart: CustomerCart | null;
  unavailable: RepeatOrderPreviewItem[];
  addedCount: number;
}

const domain = process.env.EXPO_PUBLIC_DOMAIN;
const apiUrl = (
  process.env.EXPO_PUBLIC_API_URL ??
  (domain ? `https://${domain}` : "")
).replace(/\/+$/, "");

export async function customerApi<T>(path: string, init: RequestInit = {}): Promise<T> {
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
    const error = payload as { error?: string; details?: Array<{ message?: string }> } | undefined;
    throw new Error(error?.details?.[0]?.message ?? error?.error ?? "Unable to complete request.");
  }
  return payload as T;
}