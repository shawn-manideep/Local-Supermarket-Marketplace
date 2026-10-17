export function isPublicSupabaseKey(key: unknown): boolean;
export function nativeConfigurationIssues(config: {
  apiUrl?: string;
  supabaseUrl?: string;
  anonKey?: string;
}): string[];
