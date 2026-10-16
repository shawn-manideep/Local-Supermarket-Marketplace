import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { getDb } from "@workspace/db";
import { z } from "zod";
import { usernameSchema, partnerLoginSchema, RECOVERY_CONFIRMATION, indianMobileSchema } from "@workspace/validation";
import { partnerRepository } from "../delivery-partner/repository.js";
import { supabasePartnerAuth, type PartnerAuthGateway } from "../delivery-partner/auth-service.js";
import { getSupabasePublicConfig } from "./config.js";
import { HttpError } from "../http.js";
import { verifiedMobileAccount } from "./mobile-access.js";

export const RECOVERY_MESSAGE = RECOVERY_CONFIRMATION;
export const recoveryInput = z.object({
  role: z.enum(["customer", "vendor", "delivery_partner", "admin"]),
  identity: z.string().min(1).max(254),
  identityType: z.enum(["mobile", "legacy"]).optional(),
}).strict().refine(input => input.identityType !== "mobile"
  || (input.role !== "admin" && indianMobileSchema.safeParse(input.identity).success),
  "Enter a valid mobile number for a supported portal.");
export type RecoveryInput = z.infer<typeof recoveryInput>;
export type RecoveryIdentity = { id: string; role: string; email: string };
export interface RecoveryGateway {
  find(input: RecoveryInput): Promise<RecoveryIdentity | null>;
  send(email: string, redirectTo: string): Promise<void>;
}

export function recoveryGateway(): RecoveryGateway {
  return {
    async find(input) {
      if (input.identityType === "mobile") {
        if (input.role === "admin") return null;
        const account = await verifiedMobileAccount(input.identity, input.role);
        if (!account) return null;
        const phone = indianMobileSchema.parse(input.identity);
        const result = await getDb().execute<RecoveryIdentity>(sql`
          SELECT u.id,p.role::text AS role,u.email FROM auth.users u
          JOIN public.user_profiles p ON p.id=u.id
          WHERE u.id=${account.id} AND p.role::text=${input.role}
          AND u.phone_confirmed_at IS NOT NULL
          AND u.phone IN (${phone},${phone.slice(1)},${phone.slice(3)}) LIMIT 1`);
        return result.rows[0] ?? null;
      }
      const useEmail = input.role === "admin" || (input.role === "vendor" && input.identity.includes("@"));
      const username = usernameSchema.safeParse(input.identity);
      if (!useEmail && !username.success) return null;
      const result = await getDb().execute<RecoveryIdentity>(sql`
        SELECT u.id, p.role::text AS role, u.email
        FROM auth.users u JOIN public.user_profiles p ON p.id=u.id
        LEFT JOIN public.identity_usernames n ON n.user_id=u.id
        WHERE p.role::text=${input.role} AND ${useEmail
          ? sql`lower(u.email)=lower(${input.identity.trim()})`
          : sql`n.normalized_username=${username.success ? username.data : ""}`}
        LIMIT 1`);
      return result.rows[0] ?? null;
    },
    async send(email, redirectTo) {
      const config = getSupabasePublicConfig();
      const client = createClient(config.SUPABASE_URL, config.SUPABASE_ANON_KEY, {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      });
      // Provider results and the underlying contact never leave this boundary.
      await client.auth.resetPasswordForEmail(email, { redirectTo });
    },
  };
}

export async function requestRecovery(input: RecoveryInput, redirectTo: string, gateway = recoveryGateway()) {
  try {
    const account = await gateway.find(input);
    const email = account?.role === input.role && !account.email.endsWith("@accounts.localbasket.invalid")
      ? account.email : `unknown-${randomUUID()}@accounts.localbasket.invalid`;
    // Same provider call and outward response for unknown/wrong-role identities.
    await gateway.send(email, redirectTo);
  } catch {
    // Do not turn provider/account differences into an enumeration endpoint.
  }
  return { message: RECOVERY_MESSAGE };
}

export async function loginCustomer(
  username: string, password: string,
  repo: Pick<ReturnType<typeof partnerRepository>, "identity"> = partnerRepository(),
  auth: Pick<PartnerAuthGateway, "signIn"> = supabasePartnerAuth(),
) {
  const identity = await repo.identity(username);
  const session = await auth.signIn(identity?.role === "customer" ? identity.id : null, password);
  if (!session || identity?.role !== "customer" || session.userId !== identity.id) throw new HttpError(401, "Invalid username or password.");
  return { session: { access_token: session.access_token, refresh_token: session.refresh_token } };
}
export { partnerLoginSchema as customerLoginSchema };

export function recoveryRedirect(role: RecoveryInput["role"], origin: string) {
  const path = role === "customer" ? "/customer/" : role === "admin"
    ? "/admin" : role === "delivery_partner" ? "/delivery/login" : "/vendor/login";
  return `${origin}${path}?recovery=1`;
}
