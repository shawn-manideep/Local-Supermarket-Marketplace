export function keepVendorProfile(
  profile: { userId: string; role: string } | null,
  nextUserId: string | undefined,
): boolean {
  return Boolean(nextUserId && profile?.role === "vendor" && profile.userId === nextUserId);
}

export function isCurrentSessionFailure(failedToken: string, currentToken: string | undefined): boolean {
  return Boolean(currentToken && failedToken === currentToken);
}

export function keepVerifiedPortalOnTransientCheckFailure(
  profileUserId: string | undefined,
  sessionUserId: string,
  status: number | undefined,
): boolean {
  return profileUserId === sessionUserId && status !== 401 && status !== 403;
}
