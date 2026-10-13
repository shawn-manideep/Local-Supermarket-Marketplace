export function keepVendorProfile(
  profile: { userId: string; role: string } | null,
  nextUserId: string | undefined,
): boolean {
  return Boolean(nextUserId && profile?.role === "vendor" && profile.userId === nextUserId);
}

export function isCurrentSessionFailure(failedToken: string, currentToken: string | undefined): boolean {
  return Boolean(currentToken && failedToken === currentToken);
}
