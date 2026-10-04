import { apiRequest } from "./api";

export type AdminKind = "vendors" | "customers" | "delivery-partners";
export type AccountStatus = "ACTIVE" | "INACTIVE";
export type StoreStatus = "PENDING_APPROVAL" | "ACTIVE" | "SUSPENDED" | "REJECTED";
export type AdminRow = {
  id: string; displayName: string | null; email: string | null; username: string | null;
  status: string | null; createdAt: string; storeId: string | null; storeName: string | null;
};
export type AdminPage = { items: AdminRow[]; page: number; pageSize: number; total: number };
export type AdminDetail = AdminRow & {
  contactNumber: string | null; orderCount: number | null;
  activeAssignments: number; allowedStatuses: string[];
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