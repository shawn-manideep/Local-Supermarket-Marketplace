import { pgTable, uuid, text, date, timestamp, index } from "drizzle-orm/pg-core";
import { orders, stores } from "./index.js";

/** API-only private notification metadata. Delivery is in-app polling, not push. */
export const vendorNotifications = pgTable("vendor_notifications", {
  id: uuid("id").primaryKey().defaultRandom(),
  storeId: uuid("store_id").notNull().references(() => stores.id),
  kind: text("kind").notNull(),
  dedupKey: text("dedup_key").notNull().unique(),
  message: text("message").notNull(),
  orderId: uuid("order_id").references(() => orders.id),
  // vendor_documents remains a private raw-SQL relation as in its existing service.
  documentId: uuid("document_id"),
  expiryDate: date("expiry_date", { mode: "string" }),
  milestone: text("milestone"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  readAt: timestamp("read_at", { withTimezone: true }),
}, table => [index("vendor_notifications_feed").on(table.storeId, table.createdAt)]);
