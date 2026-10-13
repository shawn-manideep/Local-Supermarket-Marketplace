import { sql } from "drizzle-orm";
import { getDb } from "@workspace/db";
import { vendorRegistrationSchema } from "@workspace/validation/vendor-profile";
import { getSupabasePublicConfig } from "./config.js";
import { HttpError, validationDetails } from "../http.js";
import type { AuthenticatedRequest } from "./types.js";
import { createClient } from "@supabase/supabase-js";
import { isUnusedSignupShell, isVerifiedVendorSignup } from "./vendor-registration-guards.js";

// A public Supabase sign-up creates a customer shell. Only a verified, unused
// vendor-signup shell can be converted, never an operational customer account.
export async function registerVendor(request: AuthenticatedRequest) {
  const input = vendorRegistrationSchema.safeParse(request.body);
  if (!input.success) throw new HttpError(400, "Check the vendor registration details.", validationDetails(input.error));
  if (!request.auth || !["customer", "vendor"].includes(request.auth.role)) throw new HttpError(403, "This account cannot be registered as a new vendor.");
  const token = request.header("authorization")?.slice("Bearer ".length).trim();
  const config = getSupabasePublicConfig();
  const verifier = createClient(config.SUPABASE_URL, config.SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { data, error } = await verifier.auth.getUser(token);
  if (error || !data.user || !isVerifiedVendorSignup(data.user, request.auth.userId))
    throw new HttpError(403, "Verify your vendor sign-up email before completing registration.");
  const id = request.auth.userId;
  const db = getDb();
  try {
    return await db.transaction(async tx => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${id},0))`);
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`${id}:addresses`},0))`);
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${"username:" + input.data.username},0))`);
      const retry = await tx.execute<{ storeId: string; status: "PENDING_APPROVAL" | "ACTIVE" | "SUSPENDED" | "REJECTED"; username: string }>(sql`
        SELECT s.id AS "storeId",s.status::text AS status,n.normalized_username AS username
        FROM stores s JOIN user_profiles p ON p.id=s.owner_user_id
        JOIN identity_usernames n ON n.user_id=p.id
        WHERE p.id=${id} AND p.role='vendor' LIMIT 1`);
      if (retry.rows[0]) {
        if (retry.rows[0].username !== input.data.username) throw new HttpError(409, "Registration is already complete under a different username.");
        return { storeId: retry.rows[0].storeId, status: retry.rows[0].status };
      }
      if (request.auth!.role !== "customer") throw new HttpError(403, "This account cannot be registered as a new vendor.");
      const existing = await tx.execute(sql`SELECT user_id FROM identity_usernames WHERE normalized_username=${input.data.username}`);
      if (existing.rows.length) throw new HttpError(409, "This username is already in use.", undefined, "USERNAME_TAKEN");
      const shell = await tx.execute(sql`SELECT p.role::text AS role, c.status, n.user_id AS username_id
        FROM user_profiles p JOIN customers c ON c.id=p.id
        LEFT JOIN identity_usernames n ON n.user_id=p.id
        WHERE p.id=${id} FOR UPDATE OF p,c`);
      const activity = await tx.execute(sql`SELECT
        EXISTS(SELECT 1 FROM customer_addresses WHERE customer_id=${id})
        OR EXISTS(SELECT 1 FROM carts WHERE customer_id=${id})
        OR EXISTS(SELECT 1 FROM orders WHERE customer_id=${id}) AS used`);
      if (!isUnusedSignupShell(shell.rows[0] as { role?: string; status?: string; username_id?: unknown } | undefined, Boolean(activity.rows[0]?.used)))
        throw new HttpError(403, "An existing customer account cannot be converted to a vendor.");
      await tx.execute(sql`INSERT INTO identity_usernames(user_id,normalized_username) VALUES(${id},${input.data.username})`);
      const store = await tx.execute<{ id: string }>(sql`INSERT INTO stores
        (owner_user_id,name,owner_name,email,phone,address_line_1,locality,city,state,pincode,status,documents_required)
        VALUES(${id},${input.data.name},${input.data.ownerName},${data.user.email},
          ${input.data.phone},${input.data.addressLine1},${input.data.locality},
          ${input.data.city},${input.data.state},${input.data.pincode},'PENDING_APPROVAL',true)
        RETURNING id`);
      await tx.execute(sql`UPDATE user_profiles SET role='vendor',updated_at=now() WHERE id=${id} AND role='customer'`);
      await tx.execute(sql`INSERT INTO platform_management_events(actor_user_id,action,target_type,target_id,next_status)
        VALUES(${id},'vendor_self_registered','store',${store.rows[0].id},'PENDING_APPROVAL')`);
      return { storeId: store.rows[0].id, status: "PENDING_APPROVAL" as const };
    });
  } catch (error) {
    if (error instanceof HttpError) throw error;
    const cause = typeof error === "object" && error !== null && "cause" in error ? error.cause : error;
    if (typeof cause === "object" && cause !== null && "code" in cause && cause.code === "23505")
      throw new HttpError(409, "This vendor identity is already in use.");
    throw error;
  }
}
