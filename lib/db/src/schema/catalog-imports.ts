import { sql } from "drizzle-orm";
import { check, integer, pgTable, serial, text, timestamp, uuid } from "drizzle-orm/pg-core";

// Audit metadata only. Canonical records remain in the original master tables.
// Actor UUID deliberately survives account deletion, just like platform events.
export const catalogImportEvents = pgTable("catalog_import_events", {
  version: serial("version").primaryKey(),
  actorUserId: uuid("actor_user_id").notNull(),
  filename: text("filename").notNull(),
  workbookHash: text("workbook_hash").notNull(),
  added: integer("added").notNull().default(0),
  updated: integer("updated").notNull(),
  archived: integer("archived").notNull(),
  unchanged: integer("unchanged").notNull(),
  result: text("result").notNull().default("APPLIED"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, table => [
  check("catalog_import_counts_check", sql`${table.added} = 0 AND ${table.updated} >= 0 AND ${table.archived} >= 0 AND ${table.unchanged} >= 0`),
  check("catalog_import_result_check", sql`${table.result} = 'APPLIED'`),
]);
