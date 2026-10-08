import { createClient } from "@supabase/supabase-js";
import { sql } from "drizzle-orm";
import { Router } from "express";
import { z } from "zod";
import { getDb } from "@workspace/db";
import { resetPasswordSchema } from "@workspace/validation";
import { requireRole } from "../auth/index.js";
import { getSupabasePublicConfig } from "../auth/config.js";
import type { AuthenticatedRequest } from "../auth/types.js";
import { asyncHandler, HttpError, validationDetails } from "../http.js";

export const customerSettingsRouter = Router();
export const changePasswordInput = z.object({
  currentPassword: z.string().min(1).max(128), newPassword: resetPasswordSchema, confirmPassword: resetPasswordSchema,
}).strict().refine(input => input.newPassword === input.confirmPassword, { message: "Passwords must match.", path: ["confirmPassword"] });
export function maskEmail(value: string | null) {
  if (!value) return null;
  const at = value.lastIndexOf("@");
  if (at < 1) return null;
  return `${value.slice(0, Math.min(2, at))}***${value.slice(at)}`;
}
interface PasswordAuth {
  signInWithPassword(input: { email: string; password: string }): Promise<{ data: { user: { id: string } | null; session: unknown }; error: { code?: string } | null }>;
  updateUser(input: { password: string }): Promise<{ error: unknown }>;
  signOut(input: { scope: "local" }): Promise<unknown>;
}
export async function changeVerifiedPassword(auth: PasswordAuth, userId: string, email: string, currentPassword: string, newPassword: string) {
  const login = await auth.signInWithPassword({ email, password: currentPassword });
  if (login.error) {
    if (login.error.code === "invalid_credentials") throw new HttpError(400, "Current password is incorrect.");
    throw new HttpError(503, "Unable to verify your current password. Please try again.");
  }
  try {
    if (!login.data.session || login.data.user?.id !== userId) throw new HttpError(403, "Unable to verify your account.");
    const updated = await auth.updateUser({ password: newPassword });
    if (updated.error) throw new HttpError(400, "Password could not be changed. Check the password policy and try again.");
  } finally {
    // Sign out only this temporary verification session, not other user sessions.
    await auth.signOut({ scope: "local" }).catch(() => undefined);
  }
}
export const passwordProvider = {
  async change(userId: string, email: string, currentPassword: string, newPassword: string) {
    const config = getSupabasePublicConfig();
    const client = createClient(config.SUPABASE_URL, config.SUPABASE_ANON_KEY, {
      auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false },
    });
    await changeVerifiedPassword(client.auth, userId, email, currentPassword, newPassword);
  },
};
async function account(userId: string) {
  const result = await getDb().execute<{
    username: string | null; email: string | null; fullName: string | null; phone: string | null;
  }>(sql`SELECT n.normalized_username AS username,u.email,c.full_name AS "fullName",c.phone
    FROM public.customers c JOIN auth.users u ON u.id=c.id
    LEFT JOIN public.identity_usernames n ON n.user_id=c.id WHERE c.id=${userId}`);
  if (!result.rows[0]) throw new HttpError(404, "Customer account not found");
  return result.rows[0];
}
customerSettingsRouter.get("/api/customer/account-settings", requireRole("customer"), asyncHandler(async (request, response) => {
  const record = await account((request as AuthenticatedRequest).auth!.userId);
  response.setHeader("Cache-Control", "private, no-store");
  response.json({ account: { username: record.username, registeredEmail: maskEmail(record.email), fullName: record.fullName, phone: record.phone } });
}));
const attempts = new Map<string, { count: number; until: number }>();
customerSettingsRouter.post("/api/customer/account-settings/password", requireRole("customer"), asyncHandler(async (request, response) => {
  response.setHeader("Cache-Control", "no-store");
  const parsed = changePasswordInput.safeParse(request.body);
  if (!parsed.success) throw new HttpError(400, "Invalid password change", validationDetails(parsed.error));
  const userId = (request as AuthenticatedRequest).auth!.userId;
  const now = Date.now();
  for (const [id, entry] of attempts) if (entry.until < now) attempts.delete(id);
  const entry = attempts.get(userId) ?? { count: 0, until: now + 15 * 60_000 };
  if (entry.count >= 5 || attempts.size >= 10_000) {
    response.setHeader("Retry-After", "900"); throw new HttpError(429, "Please wait before trying another password change.");
  }
  entry.count++; attempts.set(userId, entry);
  const record = await account(userId);
  if (!record.email) throw new HttpError(400, "Account recovery contact is unavailable.");
  await passwordProvider.change(userId, record.email, parsed.data.currentPassword, parsed.data.newPassword);
  attempts.delete(userId);
  response.json({ message: "Password changed successfully." });
}));
