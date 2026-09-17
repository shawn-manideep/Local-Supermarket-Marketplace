import { z } from "zod";

export const supabasePublicConfigSchema = z.object({
  SUPABASE_URL: z.string().url(),
  SUPABASE_ANON_KEY: z.string().min(1),
});

export const supabaseServerConfigSchema = supabasePublicConfigSchema.extend({
  SUPABASE_DB_URL: z.string().min(1),
});

export type SupabasePublicConfig = z.infer<typeof supabasePublicConfigSchema>;
export type SupabaseServerConfig = z.infer<typeof supabaseServerConfigSchema>;