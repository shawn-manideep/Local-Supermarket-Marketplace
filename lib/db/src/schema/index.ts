import { sql } from "drizzle-orm";
export { catalogImportEvents } from "./catalog-imports.js";

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

export const appRoleEnum = pgEnum("app_role", ["customer", "vendor", "admin", "delivery_partner"]);
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
  "bottle",
  "box",
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
  status: text("status").notNull().default("ACTIVE"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, table => [check("customer_access_status_check", sql`${table.status} IN ('ACTIVE','INACTIVE')`)]);

export const platformManagementEvents = pgTable("platform_management_events", {
  id: uuid("id").defaultRandom().primaryKey(),
  actorUserId: uuid("actor_user_id").notNull(),
  action: text("action").notNull(),
  targetType: text("target_type").notNull(),
  targetId: uuid("target_id").notNull(),
  previousStatus: text("previous_status"),
  nextStatus: text("next_status").notNull(),
  createdAt: createdAt(),
}, table => [
  check("platform_management_events_target_type_check", sql`${table.targetType} IN ('store','customer','delivery_partner')`),
  index("management_events_target_idx").on(table.targetType, table.targetId, table.createdAt),
]);

export const identityUsernames = pgTable("identity_usernames", {
  userId: uuid("user_id").primaryKey().references(() => userProfiles.id, { onDelete: "cascade" }),
  normalizedUsername: text("normalized_username").notNull().unique(),
  createdAt: createdAt(), updatedAt: updatedAt(),
});
export const deliveryPartnerProfiles = pgTable("delivery_partner_profiles", {
  userId: uuid("user_id").primaryKey().references(() => userProfiles.id, { onDelete: "cascade" }),
  displayName: text("display_name").notNull(),
  contactNumber: text("contact_number"),
  status: text("status").notNull().default("ACTIVE"),
  createdAt: createdAt(), updatedAt: updatedAt(),
}, table => [check("delivery_partner_status_check", sql`${table.status} IN ('ACTIVE','INACTIVE')`)]);

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
    ownerName: text("owner_name"),
    documentsRequired: boolean("documents_required").notNull().default(true),
    email: text("email"),
    addressLine1: text("address_line_1"),
    addressLine2: text("address_line_2"),
    locality: text("locality"),
    city: text("city"),
    state: text("state"),
    pincode: text("pincode"),
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
    check("stores_physical_pincode_check", sql`${table.pincode} IS NULL OR ${table.pincode} ~ '^[1-9][0-9]{5}$'`),
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

export const masterCategories = pgTable(
  "master_categories",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: text("name").notNull(),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [index("master_categories_active_name_idx").on(table.isActive, table.name)],
);

export const masterProducts = pgTable(
  "master_products",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    masterCategoryId: uuid("master_category_id")
      .references(() => masterCategories.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    description: text("description"),
    image: text("image"),
    brand: text("brand"),
    attributes: jsonb("attributes").$type<Record<string, string>>().notNull().default({}),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    index("master_products_category_idx").on(table.masterCategoryId),
    index("master_products_active_name_idx").on(table.isActive, table.name),
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
    masterCategoryId: uuid("master_category_id")
      .references(() => masterCategories.id, { onDelete: "restrict" }),
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
    masterProductId: uuid("master_product_id")
      .references(() => masterProducts.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    brand: text("brand"),
    requestedCategoryName: text("requested_category_name"),
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
    index("products_master_product_idx").on(table.masterProductId),
  ],
);

export const masterMappingAudit = pgTable(
  "master_mapping_audit",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    productId: uuid("product_id").notNull().references(() => products.id, { onDelete: "restrict" }),
    previousMasterProductId: uuid("previous_master_product_id")
      .references(() => masterProducts.id, { onDelete: "restrict" }),
    masterProductId: uuid("master_product_id").notNull()
      .references(() => masterProducts.id, { onDelete: "restrict" }),
    actorUserId: uuid("actor_user_id").notNull().references(() => userProfiles.id, { onDelete: "restrict" }),
    reason: text("reason").notNull(),
    createdAt: createdAt(),
  },
  (table) => [index("master_mapping_audit_product_idx").on(table.productId, table.createdAt)],
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
    inventoryState: text("inventory_state").notNull().default("NONE"),
    checkoutKey: uuid("checkout_key"),
    checkoutCartId: uuid("checkout_cart_id"),
    checkoutAddressId: uuid("checkout_address_id"),
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
    uniqueIndex("orders_customer_checkout_key_uidx").on(table.customerId, table.checkoutKey),
    uniqueIndex("orders_checkout_cart_uidx").on(table.checkoutCartId),
    check("orders_inventory_state_check", sql`${table.inventoryState} IN ('NONE', 'DEDUCTED', 'RESTORED')`),
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

export const deliveryAssignments = pgTable("delivery_assignments", {
  id: uuid("id").primaryKey().defaultRandom(),
  orderId: uuid("order_id").notNull().references(() => orders.id, { onDelete: "restrict" }),
  partnerUserId: uuid("partner_user_id").notNull().references(() => deliveryPartnerProfiles.userId, { onDelete: "restrict" }),
  status: text("status").notNull().default("PENDING"),
  assignedAt: timestamp("assigned_at", { withTimezone: true }).notNull().defaultNow(),
  acceptedAt: timestamp("accepted_at", { withTimezone: true }),
  rejectedAt: timestamp("rejected_at", { withTimezone: true }),
  pickedUpAt: timestamp("picked_up_at", { withTimezone: true }),
  deliveredAt: timestamp("delivered_at", { withTimezone: true }),
  createdAt: createdAt(), updatedAt: updatedAt(),
}, table => [
  check("delivery_assignment_state", sql`${table.status} IN ('PENDING','ACCEPTED','REJECTED','PICKED_UP','OUT_FOR_DELIVERY','DELIVERED','CANCELLED')`),
  check("delivery_assignment_timestamps", sql`
    (${table.status} <> 'REJECTED' OR ${table.rejectedAt} IS NOT NULL)
    AND (${table.status} NOT IN ('ACCEPTED','PICKED_UP','OUT_FOR_DELIVERY','DELIVERED') OR ${table.acceptedAt} IS NOT NULL)
    AND (${table.status} NOT IN ('PICKED_UP','OUT_FOR_DELIVERY','DELIVERED') OR ${table.pickedUpAt} IS NOT NULL)
    AND (${table.status} <> 'DELIVERED' OR ${table.deliveredAt} IS NOT NULL)
    AND (${table.acceptedAt} IS NULL OR ${table.acceptedAt} >= ${table.assignedAt})
    AND (${table.rejectedAt} IS NULL OR ${table.rejectedAt} >= ${table.assignedAt})
    AND (${table.pickedUpAt} IS NULL OR ${table.pickedUpAt} >= ${table.acceptedAt})
    AND (${table.deliveredAt} IS NULL OR ${table.deliveredAt} >= ${table.pickedUpAt})`),
  uniqueIndex("delivery_one_active_assignment").on(table.orderId).where(sql`${table.status} IN ('PENDING','ACCEPTED','PICKED_UP','OUT_FOR_DELIVERY')`),
  index("delivery_assignments_order_time").on(table.orderId, table.assignedAt.desc()),
  index("delivery_assignments_partner_created_idx").on(table.partnerUserId, table.createdAt),
]);