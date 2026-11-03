import { sql } from "drizzle-orm";
import { getDb } from "@workspace/db";
import { portalLoginIdentifierSchema } from "@workspace/validation";

export type PasswordIdentity = { id: string; role: string };
export async function findPasswordEmail(email: string, role: "vendor" | "delivery_partner", db = getDb()): Promise<PasswordIdentity | undefined> {
  const result = await db.execute<PasswordIdentity>(sql`
    SELECT u.id,p.role::text AS role FROM auth.users u
    JOIN public.user_profiles p ON p.id=u.id
    WHERE lower(u.email)=lower(${email}) AND p.role::text=${role} LIMIT 2`);
  return result.rows.length === 1 ? result.rows[0] : undefined;
}

export async function resolvePasswordIdentity(
  identifier: string,
  usernameLookup: (username: string) => Promise<PasswordIdentity | undefined>,
  emailLookup: (email: string) => Promise<PasswordIdentity | undefined>,
) {
  const parsed = portalLoginIdentifierSchema.safeParse(identifier);
  if (!parsed.success) return undefined;
  return parsed.data.includes("@") ? emailLookup(parsed.data) : usernameLookup(parsed.data);
}
