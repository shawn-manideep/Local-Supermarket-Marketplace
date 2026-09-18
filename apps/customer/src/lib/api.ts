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
  categoryId: string | null;
  name: string;
  description: string | null;
  price: string;
  availability: boolean;
  imageUrl: string | null;
}

export interface CustomerCartItem {
  id: string;
  productId: string;
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