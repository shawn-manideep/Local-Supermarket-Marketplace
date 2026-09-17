import {
  supabasePublicConfigSchema,
  supabaseServerConfigSchema,
  type SupabasePublicConfig,
  type SupabaseServerConfig,
} from "@workspace/validation";

function formatConfigError(
  scope: string,
  issues: Array<{ path: PropertyKey[]; message: string }>,
) {
  const details = issues
    .map((issue) => `${String(issue.path.join("."))}: ${issue.message}`)
    .join(", ");
  return new Error(`Invalid ${scope} configuration${details ? ` (${details})` : ""}`);
}

export function getSupabasePublicConfig(): SupabasePublicConfig {
  const result = supabasePublicConfigSchema.safeParse({
    SUPABASE_URL: process.env.SUPABASE_URL,
    SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY,
  });

  if (!result.success) {
    throw formatConfigError("Supabase public", result.error.issues);
  }

  return result.data;
}

export function getSupabaseServerConfig(): SupabaseServerConfig {
  const result = supabaseServerConfigSchema.safeParse({
    SUPABASE_URL: process.env.SUPABASE_URL,
    SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY,
    SUPABASE_DB_URL: process.env.SUPABASE_DB_URL,
  });

  if (!result.success) {
    throw formatConfigError("Supabase server", result.error.issues);
  }

  return result.data;
}