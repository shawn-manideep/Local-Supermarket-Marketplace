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
const nullablePhoneSchema = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? null : value),
  phoneSchema.nullable(),
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

const catalogNameSchema = z.string().trim().min(1);
const catalogTextSchema = z.string().trim().nullable().optional();
const catalogCodeSchema = z.string().trim().min(1).nullable().optional();
const catalogUuidSchema = z.string().uuid();
function normalizeNumericInput(value: unknown) {
  if (typeof value === "number") return value;
  if (typeof value === "string" && value.trim() !== "") return Number(value);
  return value;
}

const stockQuantitySchema = z.preprocess(
  normalizeNumericInput,
  z.number().finite().int().min(0).max(2_147_483_647),
);
const catalogPriceSchema = z.preprocess(
  normalizeNumericInput,
  z
    .number()
    .finite()
    .min(0)
    .max(9_999_999_999.99)
    .refine(
      (value) => Math.abs(value * 100 - Math.round(value * 100)) < 1e-8,
      "Must have at most two decimal places",
    ),
);

export const categoryIdParamSchema = z.object({
  categoryId: catalogUuidSchema,
}).strict();

export const productIdParamSchema = z.object({
  productId: catalogUuidSchema,
}).strict();

export const categoryQuerySchema = z.object({
  categoryId: catalogUuidSchema.optional(),
}).strict();

export const categoryCreateSchema = z.object({
  name: catalogNameSchema,
}).strict();

export const categoryUpdateSchema = z.object({
  name: catalogNameSchema,
}).strict();

const productFieldsSchema = {
  name: catalogNameSchema,
  description: catalogTextSchema,
  sku: catalogCodeSchema,
  externalCode: catalogCodeSchema,
  price: catalogPriceSchema,
  availability: z.boolean(),
  stockQuantity: stockQuantitySchema,
  imageUrl: z.string().trim().url().max(2_048).nullable().optional(),
  categoryId: catalogUuidSchema.nullable().optional(),
} as const;

export const productCreateSchema = z.object({
  name: productFieldsSchema.name,
  description: productFieldsSchema.description,
  sku: productFieldsSchema.sku,
  externalCode: productFieldsSchema.externalCode,
  price: productFieldsSchema.price,
  availability: productFieldsSchema.availability.optional(),
  stockQuantity: productFieldsSchema.stockQuantity.optional(),
  imageUrl: productFieldsSchema.imageUrl,
  categoryId: productFieldsSchema.categoryId,
}).strict();

export const productUpdateSchema = z.object({
  name: productFieldsSchema.name.optional(),
  description: productFieldsSchema.description,
  sku: productFieldsSchema.sku,
  externalCode: productFieldsSchema.externalCode,
  price: productFieldsSchema.price.optional(),
  availability: productFieldsSchema.availability.optional(),
  stockQuantity: productFieldsSchema.stockQuantity.optional(),
  imageUrl: productFieldsSchema.imageUrl,
  categoryId: productFieldsSchema.categoryId,
})
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one permitted product field is required",
  });

export const productAvailabilitySchema = z.object({
  availability: z.boolean(),
}).strict();

export const productPriceSchema = z.object({
  price: catalogPriceSchema,
}).strict();

export const productStockQuantitySchema = z.object({
  stockQuantity: stockQuantitySchema,
}).strict();

export const productCategorySchema = z.object({
  categoryId: catalogUuidSchema.nullable(),
}).strict();

const customerText = (maximum: number) => z.string().trim().min(1).max(maximum);

export const customerProfileUpdateSchema = z
  .object({
    fullName: customerText(120).nullable().optional(),
    phone: nullablePhoneSchema.optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one permitted profile field is required",
  });

export const customerAddressIdParamSchema = z.object({
  addressId: z.string().uuid(),
}).strict();

const customerAddressFields = {
  label: customerText(60).nullable().optional(),
  recipientName: customerText(120),
  phone: phoneSchema,
  line1: customerText(240),
  line2: customerText(240).nullable().optional(),
  city: customerText(120),
  state: customerText(120),
  pincode: z.string().trim().regex(/^[1-9]\d{5}$/, "Use a valid six-digit Indian pincode"),
  isDefault: z.boolean(),
} as const;

export const customerAddressCreateSchema = z.object({
  label: customerAddressFields.label,
  recipientName: customerAddressFields.recipientName,
  phone: customerAddressFields.phone,
  line1: customerAddressFields.line1,
  line2: customerAddressFields.line2,
  city: customerAddressFields.city,
  state: customerAddressFields.state,
  pincode: customerAddressFields.pincode,
  isDefault: customerAddressFields.isDefault.optional(),
}).strict();

export const customerAddressUpdateSchema = z
  .object({
    label: customerAddressFields.label,
    recipientName: customerAddressFields.recipientName.optional(),
    phone: customerAddressFields.phone.optional(),
    line1: customerAddressFields.line1.optional(),
    line2: customerAddressFields.line2,
    city: customerAddressFields.city.optional(),
    state: customerAddressFields.state.optional(),
    pincode: customerAddressFields.pincode.optional(),
    isDefault: customerAddressFields.isDefault.optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one permitted address field is required",
  });

export const customerStoreIdParamSchema = z.object({
  storeId: z.string().uuid(),
}).strict();

export const customerStoreProductParamSchema = z.object({
  storeId: z.string().uuid(),
  productId: z.string().uuid(),
}).strict();

export const customerDiscoveryQuerySchema = z.object({
  pincode: z.string().trim().regex(/^[1-9]\d{5}$/, "Use a valid six-digit Indian pincode"),
}).strict();

export const customerCatalogQuerySchema = customerDiscoveryQuerySchema.extend({
  categoryId: z.string().uuid().optional(),
}).strict();

const cartQuantitySchema = z.coerce.number().int().min(1).max(999);

export const customerCartItemCreateSchema = z.object({
  productId: z.string().uuid(),
  quantity: cartQuantitySchema,
  confirmStoreSwitch: z.boolean().optional(),
}).strict();

export const customerCartItemIdParamSchema = z.object({
  itemId: z.string().uuid(),
}).strict();

export const customerCartItemUpdateSchema = z.object({
  quantity: z.coerce.number().int().min(0).max(999),
}).strict();

export const customerCheckoutValidationSchema = z.object({
  addressId: z.string().uuid(),
  paymentMethod: z.literal("COD"),
}).strict();

export const customerOrderCreateSchema = z.object({
  addressId: z.string().uuid(),
  paymentMethod: z.literal("COD"),
}).strict();

export const customerOrderIdParamSchema = z.object({
  orderId: z.string().uuid(),
}).strict();

export const vendorOrderActionSchema = z.object({
  action: z.enum(["ACCEPT", "PREPARE", "READY", "OUT_FOR_DELIVERY", "DELIVER", "REJECT"]),
  note: z.string().trim().max(500).optional(),
}).strict();

const orderStatusFilterSchema = z.enum([
  "ALL", "PLACED", "ACCEPTED", "PREPARING", "READY", "OUT_FOR_DELIVERY",
  "DELIVERED", "REJECTED", "CANCELLED",
]);
const orderListQueryBase = {
  status: orderStatusFilterSchema.optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
};
export const vendorOrderQuerySchema = z.object({
  status: orderStatusFilterSchema.optional(),
  page: orderListQueryBase.page,
  pageSize: orderListQueryBase.pageSize,
}).strict();
export const adminOrderQuerySchema = z.object({
  ...orderListQueryBase,
  storeId: z.string().uuid().optional(),
}).strict().refine(
  (value) => !value.from || !value.to || Date.parse(value.from) <= Date.parse(value.to),
  { message: "from must be before to", path: ["to"] },
).refine(
  (value) =>
    !value.from ||
    !value.to ||
    Date.parse(value.to) - Date.parse(value.from) <= 366 * 24 * 60 * 60 * 1000,
  { message: "Date range must not exceed 366 days", path: ["to"] },
);