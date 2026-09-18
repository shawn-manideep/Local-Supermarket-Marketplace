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
  categoryId: string | null;
  name: string;
  description: string | null;
  sku: string | null;
  externalCode: string | null;
  price: string;
  availability: boolean;
  stockQuantity: number;
  imageUrl: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

interface ApiErrorPayload {
  error?: string;
  details?: Array<{ path?: Array<string | number>; message?: string }>;
}

export async function apiRequest<T>(
  path: string,
  token: string,
  init: RequestInit = {},
): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  if (token.trim()) {
    headers.set("Authorization", `Bearer ${token.trim()}`);
  }

  const response = await fetch(path, { ...init, headers });
  const payload = response.status === 204
    ? undefined
    : await response.json().catch(() => undefined) as ApiErrorPayload | T | undefined;

  if (!response.ok) {
    const errorPayload = payload as ApiErrorPayload | undefined;
    const detail = errorPayload?.details?.[0]?.message;
    throw new Error(detail ?? errorPayload?.error ?? `Request failed (${response.status})`);
  }

  return payload as T;
}

export function timeInputValue(value: string | null) {
  return value ? value.slice(0, 5) : "";
}