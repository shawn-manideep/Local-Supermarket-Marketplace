import { sql } from "drizzle-orm";
import { getDb, stores, storeOperatingHours } from "@workspace/db";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { HttpError } from "../http.js";
import { canTransitionStoreStatus, STORE_STATUSES, type StoreStatus } from "../store-management/status.js";
import { changeStoreStatus } from "../store-management/admin-status.js";

export type ManagementKind = "vendors" | "customers" | "delivery-partners";
export const managementQuery = z.object({
  page: z.coerce.number().int().min(1).max(100000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().trim().max(120).default(""),
  status: z.string().max(30).optional(),
}).strict();
export type ManagementQuery = z.infer<typeof managementQuery>;
export const accountStatusInput = z.object({ status: z.enum(["ACTIVE", "INACTIVE"]) }).strict();
export const vendorStatusInput = z.object({ status: z.enum(STORE_STATUSES) }).strict();
export const partnerManagementStatusInput = accountStatusInput.extend({ confirmActiveAssignments: z.boolean().optional() }).strict();
export const managementId = z.string().uuid();

// Fixed joins/projections only. Authentication details are never selected.
const vendorFrom = sql`FROM user_profiles p JOIN auth.users u ON u.id=p.id
  LEFT JOIN stores s ON s.owner_user_id=p.id LEFT JOIN identity_usernames n ON n.user_id=p.id`;
const customerFrom = sql`FROM user_profiles p JOIN auth.users u ON u.id=p.id JOIN customers c ON c.id=p.id
  LEFT JOIN identity_usernames n ON n.user_id=p.id`;
const partnerFrom = sql`FROM user_profiles p JOIN auth.users u ON u.id=p.id JOIN delivery_partner_profiles d ON d.user_id=p.id
  JOIN identity_usernames n ON n.user_id=p.id`;
const joins = { vendors: vendorFrom, customers: customerFrom, "delivery-partners": partnerFrom };
const role = { vendors: "vendor", customers: "customer", "delivery-partners": "delivery_partner" };
const name = {
  vendors: sql`coalesce(s.owner_name,u.raw_user_meta_data->>'display_name',u.raw_user_meta_data->>'full_name',s.name)`,
  customers: sql`c.full_name`,
  "delivery-partners": sql`d.display_name`,
};
const status = { vendors: sql`s.status::text`, customers: sql`c.status`, "delivery-partners": sql`d.status` };
const projection = (kind: ManagementKind) => sql`p.id, ${name[kind]} AS "displayName",
  ${kind === "delivery-partners" ? sql`null::text` : kind === "vendors"
    ? sql`coalesce(s.email,CASE WHEN u.email LIKE '%@accounts.localbasket.invalid' THEN null ELSE u.email END)` : sql`u.email`} AS email,
  n.normalized_username AS username, ${status[kind]} AS status, p.created_at AS "createdAt",
  ${kind === "vendors" ? sql`s.id` : sql`null::uuid`} AS "storeId",
  ${kind === "vendors" ? sql`s.name` : sql`null::text`} AS "storeName"
  ${kind === "vendors" ? sql`,s.owner_name AS "ownerName",s.city,s.locality,s.pincode` : sql``}`;

export function adminManagement(db = getDb()) {
  return {
    async dashboard() {
      const result = await db.execute(sql`SELECT
        (SELECT count(*)::integer FROM user_profiles WHERE role='customer') AS "totalCustomers",
        (SELECT count(*)::integer FROM customers c JOIN user_profiles p ON p.id=c.id WHERE p.role='customer' AND c.status='ACTIVE') AS "activeCustomers",
        (SELECT count(*)::integer FROM customers c JOIN user_profiles p ON p.id=c.id WHERE p.role='customer' AND c.status='INACTIVE') AS "inactiveCustomers",
        (SELECT count(*)::integer FROM user_profiles WHERE role='vendor') AS "totalVendors",
        (SELECT count(*)::integer FROM stores s JOIN user_profiles p ON p.id=s.owner_user_id WHERE p.role='vendor' AND s.status='PENDING_APPROVAL') AS "pendingVendors",
        (SELECT count(*)::integer FROM stores s JOIN user_profiles p ON p.id=s.owner_user_id WHERE p.role='vendor' AND s.status='ACTIVE') AS "activeVendors",
        (SELECT count(*)::integer FROM delivery_partner_profiles d JOIN user_profiles p ON p.id=d.user_id WHERE p.role='delivery_partner') AS "totalDeliveryPartners",
        (SELECT count(*)::integer FROM delivery_partner_profiles d JOIN user_profiles p ON p.id=d.user_id WHERE p.role='delivery_partner' AND d.status='ACTIVE') AS "activeDeliveryPartners",
        (SELECT count(*)::integer FROM delivery_partner_profiles d JOIN user_profiles p ON p.id=d.user_id WHERE p.role='delivery_partner' AND d.status='INACTIVE') AS "inactiveDeliveryPartners"`);
      return result.rows[0]!;
    },
    async list(kind: ManagementKind, filters: ManagementQuery) {
      const allowed = kind === "vendors" ? STORE_STATUSES : ["ACTIVE", "INACTIVE"];
      if (filters.status && !allowed.includes(filters.status as StoreStatus)) throw new HttpError(400, "Invalid status filter");
      const pattern = `%${filters.search.replace(/[\\%_]/g, "\\$&")}%`;
      const searchClause = filters.search ? sql`AND (${name[kind]} ILIKE ${pattern}
        OR n.normalized_username ILIKE ${pattern}
        ${kind !== "delivery-partners" ? sql`OR u.email ILIKE ${pattern}` : sql``}
        ${kind === "vendors" ? sql`OR s.name ILIKE ${pattern} OR s.city ILIKE ${pattern} OR s.locality ILIKE ${pattern} OR s.pincode ILIKE ${pattern}` : sql``})` : sql``;
      const where = sql`WHERE p.role::text=${role[kind]} ${searchClause}
        ${filters.status ? sql`AND ${status[kind]}=${filters.status}` : sql``}`;
      // One snapshot for count + page, deterministic tie-breaker for pagination.
      return db.transaction(async tx => {
        const count = await tx.execute(sql`SELECT count(*)::integer AS total ${joins[kind]} ${where}`);
        const result = await tx.execute(sql`SELECT ${projection(kind)} ${joins[kind]} ${where}
          ORDER BY p.created_at DESC,p.id LIMIT ${filters.pageSize} OFFSET ${(filters.page - 1) * filters.pageSize}`);
        return { items: result.rows, page: filters.page, pageSize: filters.pageSize, total: count.rows[0]!.total };
      }, { isolationLevel: "repeatable read", accessMode: "read only" });
    },
    async detail(kind: ManagementKind, id: string) {
      const result = await db.execute(sql`SELECT ${projection(kind)},
        ${kind === "customers" ? sql`c.phone` : kind === "delivery-partners" ? sql`d.contact_number` : sql`s.phone`} AS "contactNumber",
        ${kind === "customers" ? sql`(SELECT count(*)::integer FROM orders o WHERE o.customer_id=p.id)` : sql`null::integer`} AS "orderCount",
        ${kind === "delivery-partners" ? sql`(SELECT count(*)::integer FROM delivery_assignments a WHERE a.partner_user_id=p.id AND a.status IN ('PENDING','ACCEPTED','PICKED_UP','OUT_FOR_DELIVERY'))` : sql`0`} AS "activeAssignments"
        ${joins[kind]} WHERE p.id=${id} AND p.role::text=${role[kind]}`);
      const row = result.rows[0];
      if (!row) throw new HttpError(404, "Account not found");
      const allowedStatuses = kind === "vendors"
        ? STORE_STATUSES.filter(next => row.status && canTransitionStoreStatus(row.status as StoreStatus, next))
        : [row.status === "ACTIVE" ? "INACTIVE" : "ACTIVE"];
      if (kind === "vendors") {
        const [store] = await db.select().from(stores).where(eq(stores.ownerUserId, id)).limit(1);
        const hours = store ? await db.select().from(storeOperatingHours).where(eq(storeOperatingHours.storeId, store.id)) : [];
        return { ...row, allowedStatuses, store: store ?? null, hours };
      }
      return { ...row, allowedStatuses };
    },
    async vendorStatus(id: string, nextStatus: StoreStatus, actorId: string) {
      const result = await db.execute(sql`SELECT s.id FROM stores s JOIN user_profiles p ON p.id=s.owner_user_id WHERE p.id=${id} AND p.role='vendor'`);
      if (!result.rows[0]) throw new HttpError(404, "Vendor store not found");
      return changeStoreStatus(String(result.rows[0].id), nextStatus, actorId, db);
    },
    async customerStatus(id: string, nextStatus: "ACTIVE" | "INACTIVE", actorId: string) {
      return db.transaction(async tx => {
        const result = await tx.execute(sql`SELECT c.id,c.status FROM customers c JOIN user_profiles p ON p.id=c.id
          WHERE c.id=${id} AND p.role='customer' FOR UPDATE OF c`);
        if (!result.rows[0]) throw new HttpError(404, "Customer not found");
        await tx.execute(sql`SELECT set_config('app.admin_actor_id',${actorId},true)`);
        if (result.rows[0].status !== nextStatus) {
          await tx.execute(sql`UPDATE customers SET status=${nextStatus} WHERE id=${id}`);
        }
        return { id, status: nextStatus };
      });
    },
  };
}