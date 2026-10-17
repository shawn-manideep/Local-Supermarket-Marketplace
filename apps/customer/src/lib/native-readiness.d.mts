export const DEFAULT_CUSTOMER_NATIVE_BUILD_PROFILE: string;
export const CUSTOMER_NATIVE_BUILD_TARGETS: Readonly<Record<string, {
  projectRef: string;
  supabaseUrl: string;
}>>;
export function isPublicSupabaseKey(key: unknown, expectedProjectRef: string): boolean;
export function nativeConfigurationIssues(config: {
  apiUrl?: string;
  supabaseUrl?: string;
  anonKey?: string;
  profile?: string | null;
}): string[];
