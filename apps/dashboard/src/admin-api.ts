import { apiRequest } from "./api";
import type { OperatingHour, Store } from "./api";
import type { VendorDocumentStatus } from "../../../lib/api-client-react/src/generated/api.schemas";

export type AdminKind = "vendors" | "customers" | "delivery-partners";
export type AccountStatus = "ACTIVE" | "INACTIVE";
export type StoreStatus = "PENDING_APPROVAL" | "ACTIVE" | "SUSPENDED" | "REJECTED";
export type AdminRow = {
  id: string; displayName: string | null; email: string | null; username: string | null;
  status: string | null; createdAt: string; storeId: string | null; storeName: string | null;
  ownerName?: string | null; city?: string | null; locality?: string | null; pincode?: string | null;
};
export type AdminPage = { items: AdminRow[]; page: number; pageSize: number; total: number };
export type AdminDetail = AdminRow & {
  contactNumber: string | null; orderCount: number | null;
  activeAssignments: number; allowedStatuses: string[];
  store?: Store | null; hours?: OperatingHour[];
};
export type AdminDashboard = {
  totalCustomers: number; activeCustomers: number; inactiveCustomers: number;
  totalVendors: number; pendingVendors: number; activeVendors: number;
  totalDeliveryPartners: number; activeDeliveryPartners: number; inactiveDeliveryPartners: number;
};
export type AdminFilters = { page: number; pageSize: number; search: string; status: string };
export const getAdminDashboard = (token: string, signal?: AbortSignal) =>
  apiRequest<{ dashboard: AdminDashboard }>("/api/admin/dashboard", token, { signal });
export function listAdminAccounts(kind: AdminKind, token: string, filters: AdminFilters, signal?: AbortSignal) {
  const query = new URLSearchParams({ page: String(filters.page), pageSize: String(filters.pageSize) });
  if (filters.search.trim()) query.set("search", filters.search.trim());
  if (filters.status) query.set("status", filters.status);
  return apiRequest<AdminPage>(`/api/admin/${kind}?${query}`, token, { signal });
}
export const getAdminAccount = (kind: AdminKind, id: string, token: string, signal?: AbortSignal) =>
  apiRequest<{ account: AdminDetail }>(`/api/admin/${kind}/${encodeURIComponent(id)}`, token, { signal });
export const getAdminVendorDocuments = (vendorId: string, token: string, signal?: AbortSignal) =>
  apiRequest<VendorDocumentStatus>(`/api/admin/vendors/${encodeURIComponent(vendorId)}/documents`, token, { signal });
export const changeAdminStatus = (
  kind: AdminKind, id: string, status: string, token: string, confirmActiveAssignments = false,
) => apiRequest<unknown>(`/api/admin/${kind}/${encodeURIComponent(id)}/status`, token, {
  method: "PATCH", body: JSON.stringify({
    status, ...(kind === "delivery-partners" ? { confirmActiveAssignments } : {}),
  }),
});
export const createAdminPartner = (token: string, input: {
  username: string; password: string; displayName: string; contactNumber?: string; status: AccountStatus;
}) => apiRequest<{ partner: { id: string } }>("/api/admin/delivery-partners", token, {
  method: "POST", body: JSON.stringify(input),
});
export type AdminVendorInput = {
  username: string; password: string; name: string; ownerName: string; phone?: string | null;
  email?: string | null; description?: string | null; logoImageUrl?: string | null;
  addressLine1: string; addressLine2?: string | null; locality: string; city: string;
  state: string; pincode: string; deliveryFee?: number; minimumOrderValue?: number;
  hours?: Array<{ dayOfWeek: number; isClosed: boolean; opensAt?: string | null; closesAt?: string | null }>;
};
export type AdminVendorProfileInput = Omit<AdminVendorInput, "username" | "password">;
export const createAdminVendor = (token: string, input: AdminVendorInput) =>
  apiRequest<{ account: AdminDetail }>("/api/admin/vendors", token, { method: "POST", body: JSON.stringify(input) });
export const updateAdminVendor = (id: string, token: string, input: AdminVendorProfileInput) =>
  apiRequest<{ account: AdminDetail }>(`/api/admin/vendors/${encodeURIComponent(id)}`, token, { method: "PATCH", body: JSON.stringify(input) });