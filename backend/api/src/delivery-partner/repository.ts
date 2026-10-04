import { sql } from "drizzle-orm";
import { getDb } from "@workspace/db";
import { HttpError } from "../http.js";
import type { z } from "zod";
import type { partnerProvisionSchema } from "@workspace/validation";

export type ProvisionInput = z.infer<typeof partnerProvisionSchema>;
export type PartnerRecord = { id: string; username: string; displayName: string; contactNumber: string | null; status: "ACTIVE" | "INACTIVE"; createdAt: string; updatedAt: string };
type Database = Pick<ReturnType<typeof getDb>, "execute" | "transaction">;
const projection = sql`p.user_id AS id, n.normalized_username AS username, p.display_name AS "displayName",
  p.contact_number AS "contactNumber", p.status, p.created_at AS "createdAt", p.updated_at AS "updatedAt"`;

export function partnerRepository(db: Database = getDb()) {
  return {
    async identity(username: string) {
      const result = await db.execute(sql`SELECT n.user_id AS id, u.role FROM identity_usernames n
        JOIN user_profiles u ON u.id=n.user_id WHERE n.normalized_username=${username}`);
      return result.rows[0] as { id: string; role: string } | undefined;
    },
    async profile(id: string) {
      const result = await db.execute(sql`SELECT ${projection} FROM delivery_partner_profiles p
        JOIN identity_usernames n ON n.user_id=p.user_id JOIN user_profiles u ON u.id=p.user_id
        WHERE p.user_id=${id} AND u.role='delivery_partner'`);
      return result.rows[0] as PartnerRecord | undefined;
    },
    async list() {
      const result = await db.execute(sql`SELECT ${projection} FROM delivery_partner_profiles p
        JOIN identity_usernames n ON n.user_id=p.user_id JOIN user_profiles u ON u.id=p.user_id
        WHERE u.role='delivery_partner' ORDER BY p.created_at DESC`);
      return result.rows as PartnerRecord[];
    },
    async provision(input: ProvisionInput, createIdentity: () => Promise<string>) {
      return db.transaction(async tx => {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${"username:" + input.username},0))`);
        const exists = await tx.execute(sql`SELECT user_id FROM identity_usernames WHERE normalized_username=${input.username}`);
        if (exists.rows.length) throw new HttpError(409, "This username is already in use.", undefined, "USERNAME_TAKEN");
        const id = await createIdentity();
        // Supabase's existing trigger may already have created a customer shell.
        await tx.execute(sql`INSERT INTO user_profiles(id,role) VALUES(${id},'delivery_partner')
          ON CONFLICT(id) DO UPDATE SET role='delivery_partner',updated_at=now()`);
        await tx.execute(sql`DELETE FROM customers WHERE id=${id}`);
        await tx.execute(sql`INSERT INTO identity_usernames(user_id,normalized_username) VALUES(${id},${input.username})`);
        await tx.execute(sql`INSERT INTO delivery_partner_profiles(user_id,display_name,contact_number,status)
          VALUES(${id},${input.displayName},${input.contactNumber ?? null},${input.status})`);
        return id;
      }, { isolationLevel: "read committed" });
    },
    async cleanup(id: string) {
      await db.transaction(async tx => {
        await tx.execute(sql`DELETE FROM delivery_partner_profiles WHERE user_id=${id}`);
        await tx.execute(sql`DELETE FROM identity_usernames WHERE user_id=${id}`);
        await tx.execute(sql`DELETE FROM customers WHERE id=${id}`);
        await tx.execute(sql`DELETE FROM user_profiles WHERE id=${id}`);
      });
    },
    async status(id: string, status: "ACTIVE" | "INACTIVE") {
      const result = await db.execute(sql`UPDATE delivery_partner_profiles p SET status=${status},updated_at=clock_timestamp()
        WHERE p.user_id=${id} AND EXISTS(SELECT 1 FROM user_profiles u WHERE u.id=p.user_id AND u.role='delivery_partner') RETURNING p.user_id`);
      if (!result.rows.length) throw new HttpError(404, "Partner not found.");
      return this.profile(id);
    },
    async dashboard(id: string) {
      const result = await db.execute(sql`SELECT count(*)::integer AS total,
        count(*) FILTER(WHERE a.status='PENDING')::integer AS pending,
        count(*) FILTER(WHERE a.status='ASSIGNED')::integer AS assigned,
        count(*) FILTER(WHERE a.status IN ('PICKUP_PENDING','OUT_FOR_DELIVERY'))::integer AS "inProgress",
        count(*) FILTER(WHERE a.status='DELIVERED')::integer AS completed,
        count(*) FILTER(WHERE a.status='CANCELLED')::integer AS cancelled,
        count(*) FILTER(WHERE a.status='REJECTED')::integer AS rejected
        FROM delivery_assignments a JOIN delivery_partner_profiles p ON p.user_id=a.partner_user_id
        WHERE a.partner_user_id=${id} AND p.status='ACTIVE'
          AND a.created_at >= (date_trunc('day',now() AT TIME ZONE 'Asia/Kolkata') AT TIME ZONE 'Asia/Kolkata')`);
      return result.rows[0]!;
    },
    async deliveries(id: string) {
      const result = await db.execute(sql`SELECT a.id,a.status,a.created_at AS "createdAt",a.updated_at AS "updatedAt"
        FROM delivery_assignments a JOIN delivery_partner_profiles p ON p.user_id=a.partner_user_id
        WHERE a.partner_user_id=${id} AND p.status='ACTIVE' ORDER BY a.created_at DESC LIMIT 100`);
      return result.rows;
    },
  };
}
export type PartnerRepository = ReturnType<typeof partnerRepository>;
export function publicPartner({ id: _id, createdAt: _createdAt, updatedAt: _updatedAt, ...profile }: PartnerRecord) {
  return profile;
}