export function isVerifiedVendorSignup(user: {
  id: string;
  email_confirmed_at?: string | null;
  user_metadata?: { vendor_signup?: unknown };
}, authenticatedUserId: string) {
  return user.id === authenticatedUserId && Boolean(user.email_confirmed_at)
    && user.user_metadata?.vendor_signup === true;
}

export function isUnusedSignupShell(shell: {
  role?: string;
  status?: string;
  username_id?: unknown;
} | undefined, hasCustomerActivity: boolean) {
  return shell?.role === "customer" && shell.status === "ACTIVE"
    && !shell.username_id && !hasCustomerActivity;
}
