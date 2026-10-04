import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { getSupabasePublicConfig } from "../auth/config.js";
import { HttpError } from "../http.js";
import type { PartnerRepository, ProvisionInput } from "./repository.js";

export interface PartnerAuthGateway {
  create(password: string): Promise<string>;
  activate(id: string): Promise<void>;
  remove(id: string): Promise<void>;
  signIn(id: string | null, password: string): Promise<{ userId: string; access_token: string; refresh_token: string } | null>;
}
// Fresh non-persisting clients: never share a user's password session between requests.
export function supabasePartnerAuth(): PartnerAuthGateway {
  const config = getSupabasePublicConfig();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new HttpError(503, "Partner account service is not configured.");
  const options = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };
  const admin = createClient(config.SUPABASE_URL, key, options);
  return {
    async create(password) {
      const { data, error } = await admin.auth.admin.createUser({
        email: `partner-${randomUUID()}@accounts.localbasket.invalid`,
        password, email_confirm: true, ban_duration: "876000h",
      });
      if (error || !data.user) throw new HttpError(502, "Partner authentication account could not be created.");
      return data.user.id;
    },
    async activate(id) {
      const { error } = await admin.auth.admin.updateUserById(id, { ban_duration: "none" });
      if (error) throw new HttpError(502, "Partner authentication account could not be enabled.");
    },
    async remove(id) {
      const { error } = await admin.auth.admin.deleteUser(id);
      if (error) throw new HttpError(503, "Partner account cleanup could not be completed.");
    },
    async signIn(id, password) {
      const identity = id ? await admin.auth.admin.getUserById(id) : null;
      const email = identity?.data.user?.email ?? `unknown-${randomUUID()}@accounts.localbasket.invalid`;
      const auth = createClient(config.SUPABASE_URL, config.SUPABASE_ANON_KEY, options);
      const { data, error } = await auth.auth.signInWithPassword({ email, password });
      if (error || !data.session || !data.user || data.user.id !== id) return null;
      return { userId: data.user.id, access_token: data.session.access_token, refresh_token: data.session.refresh_token };
    },
  };
}
export async function provisionPartner(repo: PartnerRepository, auth: PartnerAuthGateway, input: ProvisionInput) {
  let createdId: string | undefined;
  try {
    const id = await repo.provision(input, async () => {
      createdId = await auth.create(input.password);
      return createdId;
    });
    await auth.activate(id);
    const profile = await repo.profile(id);
    if (!profile) throw new HttpError(502, "Partner profile could not be verified.");
    return profile;
  } catch (error) {
    if (createdId) {
      // Identity stays banned until all DB records commit. Rollback/compensation
      // removes both the Auth identity and the trigger-created application shell.
      let removed = false;
      for (let attempt = 0; attempt < 2 && !removed; attempt++) {
        try { await auth.remove(createdId); removed = true; } catch { /* Retry the external cleanup once. */ }
      }
      try { await repo.cleanup(createdId); } catch {
        throw new HttpError(503, "Account provisioning failed and cleanup needs administrator attention.");
      }
      if (!removed) throw new HttpError(503, "Account provisioning failed; an unlinked authentication identity needs administrator cleanup.");
    }
    const failure = typeof error === "object" && error !== null && "cause" in error ? error.cause : error;
    if (typeof failure === "object" && failure !== null && "code" in failure && failure.code === "23505"
      && "constraint" in failure && failure.constraint === "identity_usernames_normalized_username_key") {
      throw new HttpError(409, "This username is already in use.", undefined, "USERNAME_TAKEN");
    }
    throw error;
  }
}
export async function loginPartner(repo: PartnerRepository, auth: PartnerAuthGateway, username: string, password: string) {
  const identity = await repo.identity(username);
  const session = await auth.signIn(identity?.role === "delivery_partner" ? identity.id : null, password);
  if (!session) throw new HttpError(401, "Invalid username or password.");
  const profile = await repo.profile(session.userId);
  if (!profile) throw new HttpError(401, "Invalid username or password.");
  if (profile.status !== "ACTIVE") throw new HttpError(403, "Your delivery partner account is inactive. Contact an administrator.", undefined, "PARTNER_INACTIVE");
  return { session: { access_token: session.access_token, refresh_token: session.refresh_token } };
}