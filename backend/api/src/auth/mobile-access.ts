import { sql } from "drizzle-orm";
import { getDb } from "@workspace/db";
import { indianMobileSchema } from "@workspace/validation";
import { HttpError } from "../http.js";
import { supabasePartnerAuth, type PartnerAuthGateway } from "../delivery-partner/auth-service.js";

export type MobileRole = "customer" | "vendor" | "delivery_partner";
export type MobileAccount = {
  id: string;
  role: string | null;
  confirmed: boolean;
  customerStatus: string | null;
  storeId: string | null;
  storeStatus: string | null;
  partnerStatus: string | null;
};
export type MobileAccountFinder = (canonicalPhone: string) => Promise<MobileAccount[]>;

export const findMobileAccounts: MobileAccountFinder = async canonicalPhone => {
  // Only Auth phone is an identity. Contact/address/order fields are excluded.
  // Search all roles and confirmation states so ambiguous spellings fail closed.
  const result = await getDb().execute<MobileAccount>(sql`
    SELECT u.id,p.role::text AS role,
      (u.phone_confirmed_at IS NOT NULL) AS confirmed,
      c.status AS "customerStatus",s.id AS "storeId",
      s.status::text AS "storeStatus",d.status AS "partnerStatus"
    FROM auth.users u
    LEFT JOIN public.user_profiles p ON p.id=u.id
    LEFT JOIN public.customers c ON c.id=u.id
    LEFT JOIN public.stores s ON s.owner_user_id=u.id
    LEFT JOIN public.delivery_partner_profiles d ON d.user_id=u.id
    WHERE u.phone IN (${canonicalPhone},${canonicalPhone.slice(1)},${canonicalPhone.slice(3)})
    LIMIT 2`);
  return result.rows;
};

export async function verifiedMobileAccount(
  phone: string, role: MobileRole, find: MobileAccountFinder = findMobileAccounts,
) {
  if (!["customer", "vendor", "delivery_partner"].includes(role)) return null;
  const parsed = indianMobileSchema.safeParse(phone);
  if (!parsed.success) return null;
  const rows = await find(parsed.data);
  const account = rows.length === 1 ? rows[0] : undefined;
  if (!account?.confirmed || account.role !== role) return null;
  if (role === "customer" && !account.customerStatus) return null;
  if (role === "vendor" && !account.storeId) return null;
  if (role === "delivery_partner" && !account.partnerStatus) return null;
  return account;
}

export async function loginMobile(
  role: MobileRole, phone: string, password: string,
  find: MobileAccountFinder = findMobileAccounts,
  auth: Pick<PartnerAuthGateway, "signIn"> = supabasePartnerAuth(),
) {
  const account = await verifiedMobileAccount(phone, role, find);
  // Reuse password authentication against the existing UUID/email identity.
  // Unknown/unverified/wrong-role accounts also perform the gateway's dummy
  // sign-in, with the same outward error and no identity disclosure.
  const session = await auth.signIn(account?.id ?? null, password);
  if (!account || !session || session.userId !== account.id)
    throw new HttpError(401, "Invalid sign-in details.");
  // Recheck mapping/status after provider authentication to reject number or
  // role changes that occurred while authenticating.
  const current = await verifiedMobileAccount(phone, role, find);
  if (!current || current.id !== session.userId) throw new HttpError(401, "Invalid sign-in details.");
  if (role === "customer" && current.customerStatus !== "ACTIVE")
    throw new HttpError(403, "Your customer account is inactive.", undefined, "CUSTOMER_INACTIVE");
  if (role === "vendor" && current.storeStatus === "SUSPENDED")
    throw new HttpError(403, "Your store is suspended. Contact the platform administrator.", undefined, "STORE_SUSPENDED");
  if (role === "delivery_partner" && current.partnerStatus !== "ACTIVE")
    throw new HttpError(403, "Your delivery partner account is inactive. Contact an administrator.", undefined, "PARTNER_INACTIVE");
  return { session: { access_token: session.access_token, refresh_token: session.refresh_token } };
}
