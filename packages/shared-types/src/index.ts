export const APP_ROLES = ["customer", "vendor", "admin"] as const;

export type AppRole = (typeof APP_ROLES)[number];