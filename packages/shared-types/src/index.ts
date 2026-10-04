export const APP_ROLES = ["customer", "vendor", "admin", "delivery_partner"] as const;

export type AppRole = (typeof APP_ROLES)[number];