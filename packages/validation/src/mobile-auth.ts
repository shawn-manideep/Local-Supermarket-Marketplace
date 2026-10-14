import { z } from "zod";

// A login identifier, not proof of ownership. Only Auth-confirmed numbers may
// be resolved by the server. Do not normalize arbitrary punctuation/countries.
export const indianMobileSchema = z.string().trim()
  .regex(/^(?:\+91)?[6-9]\d{9}$/, "Enter a valid 10-digit Indian mobile number, optionally prefixed with +91.")
  .transform(value => value.startsWith("+91") ? value : `+91${value}`);

export const mobileLoginSchema = z.object({
  mobileNumber: indianMobileSchema,
  password: z.string().min(1).max(128),
}).strict();
