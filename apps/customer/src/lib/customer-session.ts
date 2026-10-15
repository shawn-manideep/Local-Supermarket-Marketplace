export function retainVerifiedCustomerAccess(
  verifiedUserId: string | null,
  sessionUserId: string,
  status: number | undefined,
): boolean {
  return verifiedUserId === sessionUserId && status !== 401 && status !== 403;
}
