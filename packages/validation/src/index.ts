import { z } from "zod";

export const supabasePublicConfigSchema = z.object({
  SUPABASE_URL: z.string().url(),
  SUPABASE_ANON_KEY: z.string().min(1),
});

export const supabaseServerConfigSchema = supabasePublicConfigSchema.extend({
  SUPABASE_DB_URL: z.string().min(1),
});

export type SupabasePublicConfig = z.infer<typeof supabasePublicConfigSchema>;
export type SupabaseServerConfig = z.infer<typeof supabaseServerConfigSchema>;

const moneySchema = z
  .coerce
  .number()
  .finite()
  .min(0)
  .max(1_000_000)
  .refine(
    (value) => Math.abs(value * 100 - Math.round(value * 100)) < 1e-8,
    "Must have at most two decimal places",
  );

const optionalMoneySchema = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
  moneySchema.optional(),
);

const phoneSchema = z
  .string()
  .trim()
  .regex(
    /^(?:(?:\+|00)91[- ]?|91[- ]?)?[6-9]\d{9}$/,
    "Use a valid Indian phone number",
  );

export const storeUpdateSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    description: z.string().trim().max(2_000).nullable().optional(),
    logoImageUrl: z.string().url().max(2_048).nullable().optional(),
    phone: phoneSchema.nullable().optional(),
    deliveryFee: optionalMoneySchema,
    minimumOrderValue: optionalMoneySchema,
  })
  .strict();

export const servicePincodeSchema = z.object({
  pincode: z.string().trim().regex(/^[1-9]\d{5}$/, "Use a valid six-digit Indian pincode"),
}).strict();

const timeSchema = z
  .string()
  .regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/, "Use 24-hour HH:MM format");

export const operatingHoursSchema = z
  .object({
    isClosed: z.boolean(),
    opensAt: timeSchema.nullable().optional(),
    closesAt: timeSchema.nullable().optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.isClosed) {
      if (value.opensAt != null || value.closesAt != null) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["isClosed"],
          message: "Closed days must not include opening or closing times",
        });
      }
      return;
    }

    if (!value.opensAt || !value.closesAt) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["opensAt"],
        message: "Opening and closing times are required for an open day",
      });
      return;
    }

    if (value.opensAt >= value.closesAt) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["closesAt"],
        message: "Closing time must be later than opening time",
      });
    }
  });

export const storeIdParamSchema = z.object({
  storeId: z.string().uuid(),
});

export const dayOfWeekParamSchema = z.object({
  dayOfWeek: z.coerce.number().int().min(0).max(6),
});

export const commissionRateSchema = z.preprocess(
  (value) => (value === "" ? null : value),
  z.union([
    moneySchema.refine((rate) => rate <= 100, "Must be between 0 and 100"),
    z.null(),
  ]),
);

export const commissionRateUpdateSchema = z.object({
  commissionRate: commissionRateSchema,
}).strict();