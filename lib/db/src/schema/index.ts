import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  time,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const appRoleEnum = pgEnum("app_role", ["customer", "vendor", "admin"]);
export const storeStatusEnum = pgEnum("store_status", [
  "PENDING_APPROVAL",
  "ACTIVE",
  "SUSPENDED",
  "REJECTED",
]);
export const cartStatusEnum = pgEnum("cart_status", [
  "ACTIVE",
  "ABANDONED",
  "CONVERTED",
]);
export const orderStatusEnum = pgEnum("order_status", [
  "PLACED",
  "ACCEPTED",
  "PREPARING",
  "READY",
  "OUT_FOR_DELIVERY",
  "DELIVERED",
  "REJECTED",
  "CANCELLED",
]);
export const deliveryTypeEnum = pgEnum("delivery_type", [
  "vendor_staff",
  "platform_partner",
]);
export const paymentMethodEnum = pgEnum("payment_method", ["COD"]);
export const quantityUnitEnum = pgEnum("quantity_unit", [
  "g",
  "kg",
  "ml",
  "l",
  "piece",
  "pack",
  "dozen",
]);

const createdAt = () =>
  timestamp("created_at", { withTimezone: true }).defaultNow().notNull();
const updatedAt = () =>
  timestamp("updated_at", { withTimezone: true }).defaultNow().notNull();

export const userProfiles = pgTable("user_profiles", {
  id: uuid("id").primaryKey(),
  role: appRoleEnum("role").notNull().default("customer"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const customers = pgTable("customers", {
  id: uuid("id")
    .primaryKey()
    .references(() => userProfiles.id, { onDelete: "cascade" }),
  fullName: text("full_name"),
  phone: text("phone"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const customerAddresses = pgTable(
  "customer_addresses",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "cascade" }),
    label: text("label"),
    recipientName: text("recipient_name").notNull(),
    phone: text("phone").notNull(),
    line1: text("line1").notNull(),
    line2: text("line2"),
    city: text("city").notNull(),
    state: text("state").notNull(),
    pincode: text("pincode").notNull(),
    isDefault: boolean("is_default").notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    index("customer_addresses_customer_id_idx").on(table.customerId),
  ],
);

export const stores = pgTable(
  "stores",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ownerUserId: uuid("owner_user_id")
      .notNull()
      .references(() => userProfiles.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    description: text("description"),
    logoImageUrl: text("logo_image_url"),
    phone: text("phone"),
    deliveryFee: numeric("delivery_fee", { precision: 12, scale: 2 })
      .notNull()
      .default("0"),
    minimumOrderValue: numeric("minimum_order_value", {
      precision: 12,
      scale: 2,
    })
      .notNull()
      .default("0"),
    commissionRate: numeric("commission_rate", {
      precision: 5,
      scale: 2,
    }),
    status: storeStatusEnum("status").notNull().default("PENDING_APPROVAL"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex("stores_owner_user_id_uidx").on(table.ownerUserId),
  ],
);

export const storeServicePincodes = pgTable(
  "store_service_pincodes",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    storeId: uuid("store_id")
      .notNull()
      .references(() => stores.id, { onDelete: "cascade" }),
    pincode: text("pincode").notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex("store_service_pincodes_store_pincode_uidx").on(
      table.storeId,
      table.pincode,
    ),
    index("store_service_pincodes_store_id_idx").on(table.storeId),
  ],
);

export const storeOperatingHours = pgTable(
  "store_operating_hours",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    storeId: uuid("store_id")
      .notNull()
      .references(() => stores.id, { onDelete: "cascade" }),
    dayOfWeek: integer("day_of_week").notNull(),
    opensAt: time("opens_at"),
    closesAt: time("closes_at"),
    isClosed: boolean("is_closed").notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex("store_operating_hours_store_day_uidx").on(
      table.storeId,
      table.dayOfWeek,
    ),
  ],
);

export const categories = pgTable(
  "categories",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    storeId: uuid("store_id")
      .notNull()
      .references(() => stores.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex("categories_store_name_uidx").on(table.storeId, table.name),
    uniqueIndex("categories_store_id_uidx").on(table.storeId, table.id),
    index("categories_store_id_idx").on(table.storeId),
  ],
);

export const products = pgTable(
  "products",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    storeId: uuid("store_id")
      .notNull()
      .references(() => stores.id, { onDelete: "restrict" }),
    categoryId: uuid("category_id"),
    name: text("name").notNull(),
    description: text("description"),
    sku: text("sku"),
    externalCode: text("external_code"),
    price: numeric("price", { precision: 12, scale: 2 }).notNull(),
    availability: boolean("availability").notNull().default(true),
    stockQuantity: integer("stock_quantity").notNull().default(0),
    imageUrl: text("image_url"),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    foreignKey({
      columns: [table.storeId, table.categoryId],
      foreignColumns: [categories.storeId, categories.id],
      name: "products_store_category_fk",
    }),
    uniqueIndex("products_store_sku_uidx").on(table.storeId, table.sku),
    uniqueIndex("products_store_external_code_uidx").on(
      table.storeId,
      table.externalCode,
    ),
    index("products_store_id_idx").on(table.storeId),
    index("products_category_id_idx").on(table.categoryId),
  ],
);

export const productVariants = pgTable(
  "product_variants",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    quantityValue: numeric("quantity_value", {
      precision: 12,
      scale: 3,
    }).notNull(),
    quantityUnit: quantityUnitEnum("quantity_unit").notNull(),
    price: numeric("price", { precision: 12, scale: 2 }).notNull(),
    stockQuantity: integer("stock_quantity").notNull().default(0),
    availability: boolean("availability").notNull().default(true),
    isActive: boolean("is_active").notNull().default(true),
    sku: text("sku"),
    externalCode: text("external_code"),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex("product_variants_product_id_id_uidx").on(
      table.productId,
      table.id,
    ),
    uniqueIndex("product_variants_product_sku_uidx").on(
      table.productId,
      table.sku,
    ),
    uniqueIndex("product_variants_product_external_code_uidx").on(
      table.productId,
      table.externalCode,
    ),
    index("product_variants_product_sort_idx").on(
      table.productId,
      table.sortOrder,
      table.id,
    ),
    index("product_variants_active_idx").on(
      table.productId,
      table.isActive,
      table.availability,
    ),
    check(
      "product_variants_quantity_value_positive_check",
      sql`${table.quantityValue} > 0`,
    ),
    check(
      "product_variants_price_nonnegative_check",
      sql`${table.price} >= 0`,
    ),
    check(
      "product_variants_stock_quantity_nonnegative_check",
      sql`${table.stockQuantity} >= 0`,
    ),
  ],
);

export const carts = pgTable(
  "carts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "restrict" }),
    storeId: uuid("store_id")
      .notNull()
      .references(() => stores.id, { onDelete: "restrict" }),
    status: cartStatusEnum("status").notNull().default("ACTIVE"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    index("carts_customer_id_idx").on(table.customerId),
    index("carts_store_id_idx").on(table.storeId),
  ],
);

export const cartItems = pgTable(
  "cart_items",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    cartId: uuid("cart_id")
      .notNull()
      .references(() => carts.id, { onDelete: "cascade" }),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "restrict" }),
    variantId: uuid("variant_id").notNull(),
    quantity: integer("quantity").notNull().default(1),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    foreignKey({
      columns: [table.productId, table.variantId],
      foreignColumns: [productVariants.productId, productVariants.id],
      name: "cart_items_product_variant_fk",
    }).onDelete("restrict"),
    uniqueIndex("cart_items_cart_variant_uidx").on(
      table.cartId,
      table.variantId,
    ),
    index("cart_items_product_id_idx").on(table.productId),
  ],
);

export const orders = pgTable(
  "orders",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "restrict" }),
    storeId: uuid("store_id")
      .notNull()
      .references(() => stores.id, { onDelete: "restrict" }),
    status: orderStatusEnum("status").notNull().default("PLACED"),
    deliveryType: deliveryTypeEnum("delivery_type")
      .notNull()
      .default("vendor_staff"),
    paymentMethod: paymentMethodEnum("payment_method")
      .notNull()
      .default("COD"),
    subtotal: numeric("subtotal", { precision: 12, scale: 2 }).notNull(),
    deliveryFeeSnapshot: numeric("delivery_fee_snapshot", {
      precision: 12,
      scale: 2,
    }).notNull(),
    totalAmount: numeric("total_amount", {
      precision: 12,
      scale: 2,
    }).notNull(),
    commissionRateSnapshot: numeric("commission_rate_snapshot", {
      precision: 5,
      scale: 2,
    }),
    commissionAmountSnapshot: numeric("commission_amount_snapshot", {
      precision: 12,
      scale: 2,
    }),
    deliveryAddressSnapshot: jsonb("delivery_address_snapshot").notNull(),
    deliveryContactName: text("delivery_contact_name").notNull(),
    deliveryContactPhone: text("delivery_contact_phone").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    index("orders_customer_id_idx").on(table.customerId),
    uniqueIndex("orders_customer_id_id_uidx").on(table.customerId, table.id),
    index("orders_store_id_idx").on(table.storeId),
    index("orders_status_idx").on(table.status),
    index("orders_customer_newest_idx").on(
      table.customerId,
      table.createdAt.desc(),
      table.id.desc(),
    ),
    index("orders_store_status_newest_idx").on(
      table.storeId,
      table.status,
      table.createdAt.desc(),
      table.id.desc(),
    ),
  ],
);

export const orderItems = pgTable(
  "order_items",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    productId: uuid("product_id").references(() => products.id, {
      onDelete: "set null",
    }),
    variantId: uuid("variant_id"),
    productNameSnapshot: text("product_name_snapshot").notNull(),
    variantNameSnapshot: text("variant_name_snapshot").notNull(),
    variantQuantityValueSnapshot: numeric("variant_quantity_value_snapshot", {
      precision: 12,
      scale: 3,
    }).notNull(),
    variantQuantityUnitSnapshot: quantityUnitEnum(
      "variant_quantity_unit_snapshot",
    ).notNull(),
    productPriceSnapshot: numeric("product_price_snapshot", {
      precision: 12,
      scale: 2,
    }).notNull(),
    quantity: integer("quantity").notNull(),
    subtotal: numeric("subtotal", { precision: 12, scale: 2 }).notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    foreignKey({
      columns: [table.productId, table.variantId],
      foreignColumns: [productVariants.productId, productVariants.id],
      name: "order_items_product_variant_fk",
    }).onDelete("restrict"),
    check(
      "order_items_variant_requires_product_check",
      sql`${table.variantId} IS NULL OR ${table.productId} IS NOT NULL`,
    ),
    index("order_items_order_id_idx").on(table.orderId),
    index("order_items_product_id_idx").on(table.productId),
  ],
);

export const orderStatusHistory = pgTable(
  "order_status_history",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    status: orderStatusEnum("status").notNull(),
    note: text("note"),
    changedBy: uuid("changed_by").references(() => userProfiles.id, {
      onDelete: "set null",
    }),
    createdAt: createdAt(),
  },
  (table) => [
    index("order_status_history_order_id_idx").on(table.orderId),
  ],
);

export const customerRepeatRequests = pgTable(
  "customer_repeat_requests",
  {
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "restrict" }),
    idempotencyKey: uuid("idempotency_key").notNull(),
    sourceOrderId: uuid("source_order_id").notNull(),
    addressId: uuid("address_id").notNull(),
    confirmStoreSwitch: boolean("confirm_store_switch")
      .notNull()
      .default(false),
    response: jsonb("response")
      .$type<Record<string, unknown>>()
      .notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    foreignKey({
      columns: [table.customerId, table.sourceOrderId],
      foreignColumns: [orders.customerId, orders.id],
      name: "customer_repeat_requests_customer_order_fk",
    }).onDelete("restrict"),
    uniqueIndex("customer_repeat_requests_customer_key_uidx").on(
      table.customerId,
      table.idempotencyKey,
    ),
    index("customer_repeat_requests_source_order_idx").on(table.sourceOrderId),
  ],
);