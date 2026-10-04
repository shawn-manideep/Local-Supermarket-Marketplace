export type StoreStatus =
  | "PENDING_APPROVAL"
  | "ACTIVE"
  | "SUSPENDED"
  | "REJECTED";

export interface Store {
  id: string;
  ownerUserId: string;
  name: string;
  description: string | null;
  logoImageUrl: string | null;
  phone: string | null;
  deliveryFee: string;
  minimumOrderValue: string;
  commissionRate: string | null;
  status: StoreStatus;
  createdAt: string;
  updatedAt: string;
}

export interface ServicePincode {
  id: string;
  storeId: string;
  pincode: string;
  createdAt: string;
}

export interface OperatingHour {
  id: string;
  storeId: string;
  dayOfWeek: number;
  opensAt: string | null;
  closesAt: string | null;
  isClosed: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Category {
  id: string;
  storeId: string;
  name: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Product {
  id: string;
  storeId: string;
  masterProductId?: string | null;
  categoryId: string | null;
  name: string;
  description: string | null;
  descriptionOverride?: string | null;
  sku: string | null;
  externalCode: string | null;
  price: string;
  availability: boolean;
  stockQuantity: number;
  imageUrl: string | null;
  imageOverride?: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  variants?: ProductVariant[];
}

export type VariantQuantityUnit = "g" | "kg" | "ml" | "l" | "piece" | "pack" | "dozen" | "bottle" | "box";

export interface MasterCategory {
  id: string;
  name: string;
  isActive: boolean;
  productCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface MasterProduct {
  id: string;
  masterCategoryId: string | null;
  name: string;
  description: string | null;
  image: string | null;
  brand: string | null;
  attributes: Record<string, string>;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  categoryName?: string | null;
  categoryIsActive?: boolean | null;
  canAddToStore?: boolean;
  exactIdentity?: boolean;
}

export interface VendorMasterProductCreateInput {
  name: string;
  description?: string;
  image?: string;
  brand?: string;
  attributes: Record<string, string>;
}

export interface ProductVariant {
  id: string;
  productId: string;
  name: string;
  quantityValue: string;
  quantityUnit: VariantQuantityUnit;
  price: string;
  stockQuantity: number;
  availability: boolean;
  isActive: boolean;
  sku: string | null;
  externalCode: string | null;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface VendorProductVariantBatchInput {
  id?: string;
  expectedUpdatedAt?: string;
  quantityValue: string;
  quantityUnit: VariantQuantityUnit;
  price: string;
  stockQuantity: number;
  availability: boolean;
  isActive?: boolean;
  sku?: string | null;
  externalCode?: string | null;
}

export interface VendorProductVariantsBatchInput {
  variants: VendorProductVariantBatchInput[];
  publish?: boolean;
}

export interface VendorProductVariantsBatchResponse {
  product: Product;
}

export type OrderStatus =
  | "PLACED"
  | "ACCEPTED"
  | "PREPARING"
  | "READY"
  | "OUT_FOR_DELIVERY"
  | "DELIVERED"
  | "REJECTED"
  | "CANCELLED";

export interface OrderSummary {
  id: string;
  storeId: string;
  storeName: string;
  status: OrderStatus;
  deliveryType: string;
  paymentMethod: string;
  totalAmount: string | number;
  deliveryContactName: string;
  deliveryAddressSnapshot: {
    label: string | null;
    recipientName: string;
    phone: string;
    line1: string;
    line2: string | null;
    city: string;
    state: string;
    pincode: string;
  };
  itemCount: number;
  createdAt: string;
}

export interface OrderItemSnapshot {
  id: string;
  variantId?: string | null;
  variantNameSnapshot?: string | null;
  variantQuantityValueSnapshot?: string | null;
  variantQuantityUnitSnapshot?: string | null;
  productNameSnapshot: string;
  productPriceSnapshot: string;
  quantity: number;
  subtotal: string;
}

export interface OrderDetail {
  id: string;
  storeId: string;
  storeName: string;
  status: OrderStatus;
  deliveryType: string;
  paymentMethod: string;
  subtotal: string | number;
  deliveryFeeSnapshot: string | number;
  totalAmount: string | number;
  deliveryAddressSnapshot: OrderSummary["deliveryAddressSnapshot"];
  deliveryContactName: string;
  deliveryContactPhone: string;
  createdAt: string;
  updatedAt: string;
  commissionRateSnapshot?: string | number | null;
  commissionAmountSnapshot?: string | number | null;
  items: OrderItemSnapshot[];
  statusHistory: Array<{ status: OrderStatus | string; createdAt: string; note?: string | null }>;
}

export interface OrderListEnvelope {
  orders: OrderSummary[];
  counts: Record<string, number>;
  pagination: { page: number; pageSize: number; total: number };
}

export interface VendorDeliveryPartner {
  /** Opaque selection key. Never render this value. */
  id: string;
  displayName: string;
  status: "ACTIVE" | "INACTIVE";
}

interface ApiErrorPayload {
  error?: string;
  details?: Array<{ path?: Array<string | number>; message?: string }>;
}

export class ApiRequestError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "ApiRequestError";
  }
}

export async function apiRequest<T>(
  path: string,
  token: string,
  init: RequestInit = {},
): Promise<T> {
  const apiOrigin = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/+$/, "") ?? "";
  const headers = new Headers(init.headers);
  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  if (token.trim()) {
    headers.set("Authorization", `Bearer ${token.trim()}`);
  }

  const response = await fetch(`${apiOrigin}${path}`, { ...init, headers });
  const payload = response.status === 204
    ? undefined
    : await response.json().catch(() => undefined) as ApiErrorPayload | T | undefined;

  if (!response.ok) {
    const errorPayload = payload as ApiErrorPayload | undefined;
    const detail = errorPayload?.details?.[0]?.message;
    throw new ApiRequestError(
      detail ?? errorPayload?.error ?? `Request failed (${response.status})`,
      response.status,
    );
  }

  return payload as T;
}

export function timeInputValue(value: string | null) {
  return value ? value.slice(0, 5) : "";
}