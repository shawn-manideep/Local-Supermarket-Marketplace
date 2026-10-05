import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { getDb, stores, storeOperatingHours } from "@workspace/db";
import type { z } from "zod";
import type { vendorProvisionSchema, vendorProfileUpdateSchema } from "@workspace/validation/vendor-profile";
import { HttpError } from "../http.js";
import { supabasePartnerAuth, type PartnerAuthGateway } from "../delivery-partner/auth-service.js";
import { partnerRepository } from "../delivery-partner/repository.js";
import { adminManagement } from "./service.js";

type Database = ReturnType<typeof getDb>;
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type ProfileInput = z.infer<typeof vendorProfileUpdateSchema>;
type ProvisionInput = z.infer<typeof vendorProvisionSchema>;
function storeValues({ hours: _hours, ...input }: ProfileInput) {
  return {
    ...input,
    deliveryFee: input.deliveryFee === undefined ? undefined : input.deliveryFee.toFixed(2),
    minimumOrderValue: input.minimumOrderValue === undefined ? undefined : input.minimumOrderValue.toFixed(2),
  };
}
async function updateHours(tx: Transaction, storeId: string, hours: ProfileInput["hours"]) {
  // Patch specified days only; omitted days and delivery areas stay unchanged.
  for (const h of hours ?? []) {
    const values = {
      storeId, dayOfWeek: h.dayOfWeek, isClosed: h.isClosed,
      opensAt: h.isClosed ? null : h.opensAt!, closesAt: h.isClosed ? null : h.closesAt!,
    };
    await tx.insert(storeOperatingHours).values(values).onConflictDoUpdate({
      target: [storeOperatingHours.storeId, storeOperatingHours.dayOfWeek],
      set: { ...values, updatedAt: new Date() },
    });
  }
}
async function cleanupVendor(db: Database, id: string) {
  await db.transaction(async tx => {
    // This ID is a newly created Auth identity, never an existing vendor.
    // RESTRICT constraints deliberately fail if operational data somehow exists.
    await tx.execute(sql`DELETE FROM platform_management_events WHERE target_type='store'
      AND action='vendor_created' AND target_id IN (SELECT id FROM stores WHERE owner_user_id=${id})`);
    await tx.delete(stores).where(eq(stores.ownerUserId, id));
    await tx.execute(sql`DELETE FROM identity_usernames WHERE user_id=${id}`);
    await tx.execute(sql`DELETE FROM customers WHERE id=${id}`);
    await tx.execute(sql`DELETE FROM user_profiles WHERE id=${id}`);
  });
}
function underlying(error: unknown): unknown {
  return typeof error === "object" && error !== null && "cause" in error ? underlying(error.cause) : error;
}
export async function provisionVendor(
  input: ProvisionInput, actorId: string, db = getDb(), auth: PartnerAuthGateway = supabasePartnerAuth(),
) {
  let createdId: string | undefined;
  try {
    const id = await db.transaction(async tx => {
      // Same advisory lock namespace and unique constraint as partner creation.
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${"username:" + input.username},0))`);
      const exists = await tx.execute(sql`SELECT user_id FROM identity_usernames WHERE normalized_username=${input.username}`);
      if (exists.rows.length) throw new HttpError(409, "This username is already in use.", undefined, "USERNAME_TAKEN");
      createdId = await auth.create(input.password, input.email ?? `vendor-${randomUUID()}@accounts.localbasket.invalid`);
      await tx.execute(sql`INSERT INTO user_profiles(id,role) VALUES(${createdId},'vendor')
        ON CONFLICT(id) DO UPDATE SET role='vendor',updated_at=now()`);
      await tx.execute(sql`DELETE FROM customers WHERE id=${createdId}`);
      await tx.execute(sql`INSERT INTO identity_usernames(user_id,normalized_username) VALUES(${createdId},${input.username})`);
      const { username: _username, password: _password, ...profile } = input;
      const [store] = await tx.insert(stores).values({
        ...storeValues(profile), name: input.name, ownerUserId: createdId, status: "PENDING_APPROVAL",
      }).returning({ id: stores.id });
      await updateHours(tx, store.id, input.hours);
      await tx.execute(sql`INSERT INTO platform_management_events(actor_user_id,action,target_type,target_id,next_status)
        VALUES(${actorId},'vendor_created','store',${store.id},'PENDING_APPROVAL')`);
      return createdId;
    });
    // Verify the complete profile before allowing the new identity to sign in.
    const result = await adminManagement(db).detail("vendors", id);
    await auth.activate(id);
    return result;
  } catch (error) {
    if (createdId) {
      try { await cleanupVendor(db, createdId); } catch {
        throw new HttpError(503, "Vendor provisioning failed; cleanup requires administrator attention.");
      }
      let removed = false;
      for (let attempt = 0; attempt < 2 && !removed; attempt++) {
        try { await auth.remove(createdId); removed = true; } catch { /* Retry external compensation once. */ }
      }
      if (!removed) throw new HttpError(503, "Vendor provisioning failed; a disabled authentication identity requires administrator cleanup.");
    }
    const failure = underlying(error);
    if (typeof failure === "object" && failure !== null && "code" in failure && failure.code === "23505") {
      throw new HttpError(409, "This vendor identity is already in use.");
    }
    throw error;
  }
}
export async function updateVendorProfile(id: string, input: ProfileInput, actorId: string, db = getDb()) {
  await db.transaction(async tx => {
    const current = await tx.execute<{ id: string; status: string }>(sql`SELECT s.id,s.status FROM stores s JOIN user_profiles p ON p.id=s.owner_user_id
      WHERE p.id=${id} AND p.role='vendor' FOR UPDATE OF s`);
    const storeId = current.rows[0]?.id;
    if (!storeId) throw new HttpError(404, "Vendor store not found");
    await tx.update(stores).set({ ...storeValues(input), updatedAt: new Date() }).where(eq(stores.id, storeId));
    await updateHours(tx, storeId, input.hours);
    await tx.execute(sql`INSERT INTO platform_management_events(actor_user_id,action,target_type,target_id,next_status)
      VALUES(${actorId},'vendor_profile_updated','store',${storeId},${current.rows[0].status})`);
  });
  return adminManagement(db).detail("vendors", id);
}
export async function loginVendor(username: string, password: string, db = getDb(), auth = supabasePartnerAuth()) {
  const identity = await partnerRepository(db).identity(username);
  const session = await auth.signIn(identity?.role === "vendor" ? identity.id : null, password);
  if (!session) throw new HttpError(401, "Invalid username or password.");
  const [store] = await db.select({ status: stores.status }).from(stores).where(eq(stores.ownerUserId, session.userId)).limit(1);
  if (!store) throw new HttpError(401, "Invalid username or password.");
  // Match the existing vendor access rule. Pending vendors can complete their
  // profile; discovery still requires ACTIVE through the unchanged marketplace.
  if (store.status === "SUSPENDED") throw new HttpError(403, "Your store is suspended. Contact the platform administrator.", undefined, "STORE_SUSPENDED");
  return { session: { access_token: session.access_token, refresh_token: session.refresh_token } };
}
