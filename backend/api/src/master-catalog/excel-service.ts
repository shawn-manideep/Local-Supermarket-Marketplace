import { asc, count, desc, eq, sql } from "drizzle-orm";
import { catalogImportEvents, getDb, masterCategories, masterProducts } from "@workspace/db";
import { HttpError } from "../http.js";
import { withMasterCatalogWriteLock } from "./duplicate-review.js";
import { createPreviewToken, digest, MAX_CATALOG_ROWS, verifyPreviewToken } from "./excel-security.js";
import { exportWorkbook, snapshotRevision, validateWorkbook, type CatalogSnapshot, type ImportPlan } from "./excel-workbook.js";

type Database = ReturnType<typeof getDb>;
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type Executor = Database | Transaction;

export function normalizeCatalogHistoryTimestamp(value: Date | string | null | undefined): Date | null {
  return value == null ? null : value instanceof Date ? value : new Date(value);
}

export async function readCatalogSnapshot(executor: Executor): Promise<CatalogSnapshot> {
  const categories = await executor.select().from(masterCategories).orderBy(asc(masterCategories.id)).limit(MAX_CATALOG_ROWS + 1);
  const products = await executor.select().from(masterProducts).orderBy(asc(masterProducts.id)).limit(MAX_CATALOG_ROWS + 1);
  if (categories.length > MAX_CATALOG_ROWS || products.length > MAX_CATALOG_ROWS) {
    throw new HttpError(413, "Catalog exceeds 10,000 records per sheet; Excel management is unavailable at this size");
  }
  return { categories, products };
}

function publicPlan(plan: ImportPlan) {
  return { valid: plan.valid, errors: plan.errors, warnings: plan.warnings, summary: plan.summary, changes: plan.changes };
}

export async function downloadCatalog(template = false) {
  const snapshot = await getDb().transaction(readCatalogSnapshot, { isolationLevel: "repeatable read", accessMode: "read only" });
  return exportWorkbook(snapshot, template);
}

export async function previewCatalog(bytes: Buffer, actor: string) {
  const snapshot = await getDb().transaction(readCatalogSnapshot, { isolationLevel: "repeatable read", accessMode: "read only" });
  const plan = await validateWorkbook(bytes, snapshot);
  if (!plan.valid) return publicPlan(plan);
  const preview = createPreviewToken(actor, plan.revision, bytes);
  return { ...publicPlan(plan), previewToken: preview.token, expiresAt: preview.expiresAt };
}

export async function applyCatalog(bytes: Buffer, actor: string, filename: string, token: string) {
  const claims = verifyPreviewToken(token, actor, bytes);
  return getDb().transaction(transaction => withMasterCatalogWriteLock(transaction, async () => {
    // Also serialize with older category-create paths and direct canonical writes.
    // These locks cover canonical tables only; never lock vendor inventory or orders.
    await transaction.execute(sql`LOCK TABLE public.master_categories, public.master_products IN SHARE ROW EXCLUSIVE MODE`);
    const snapshot = await readCatalogSnapshot(transaction);
    if (claims.revision !== snapshotRevision(snapshot)) {
      throw new HttpError(409, "Catalog changed after preview. Download fresh data and validate again. No changes were applied.");
    }
    const plan = await validateWorkbook(bytes, snapshot);
    if (!plan.valid) throw new HttpError(400, "Workbook validation failed. No changes were applied.", plan.errors);
    if (!plan.changes.length) throw new HttpError(400, "No canonical changes to apply");
    const updatedAt = new Date();
    for (const { id, name, isActive } of plan.categoryUpdates) {
      await transaction.update(masterCategories).set({ name, isActive, updatedAt }).where(eq(masterCategories.id, id));
    }
    for (const { id, masterCategoryId, name, brand, description, image, isActive } of plan.productUpdates) {
      await transaction.update(masterProducts).set({
        masterCategoryId, name, brand, description, image, isActive, updatedAt,
      }).where(eq(masterProducts.id, id));
    }
    const [event] = await transaction.insert(catalogImportEvents).values({
      actorUserId: actor, filename, workbookHash: digest(bytes), ...plan.summary,
    }).returning({ version: catalogImportEvents.version });
    return { applied: true as const, summary: plan.summary, version: event.version };
  }));
}

export async function catalogHistory(page: number) {
  const database = getDb();
  const pageSize = 20;
  const [history, [{ total }], [{ products }], [{ categories }], [latest], timestamps] = await Promise.all([
    database.execute<{
      version: number; createdAt: Date; actorUserId: string; actorLabel: string; filename: string;
      added: number; updated: number; archived: number; unchanged: number; result: "APPLIED";
    }>(sql`
      SELECT e.version, e.created_at AS "createdAt", e.actor_user_id AS "actorUserId",
        coalesce(u.email, 'Admin (account unavailable)') AS "actorLabel", e.filename,
        e.added,e.updated,e.archived,e.unchanged,e.result
      FROM public.catalog_import_events e LEFT JOIN auth.users u ON u.id=e.actor_user_id
      ORDER BY e.version DESC LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}
    `),
    database.select({ total: count() }).from(catalogImportEvents),
    database.select({ products: count() }).from(masterProducts),
    database.select({ categories: count() }).from(masterCategories),
    database.select().from(catalogImportEvents).orderBy(desc(catalogImportEvents.version)).limit(1),
    database.execute<{ lastUpdated: Date | string | null }>(sql`
      SELECT greatest((SELECT max(updated_at) FROM public.master_categories),
        (SELECT max(updated_at) FROM public.master_products)) AS "lastUpdated"
    `),
  ]);
  // Only attribute the current timestamp to an importer when it matches that
  // import; subsequent existing-form edits must not be misattributed.
  // Raw SQL results do not use the schema column's Date mapper.
  const lastUpdated = normalizeCatalogHistoryTimestamp(timestamps.rows[0]?.lastUpdated);
  const importerIsLatest = latest && lastUpdated && Math.abs(lastUpdated.getTime() - latest.createdAt.getTime()) < 1000;
  const latestLabel = importerIsLatest
    ? (await database.execute<{ label: string }>(sql`SELECT coalesce(email, 'Admin (account unavailable)') AS label FROM auth.users WHERE id=${latest.actorUserId}`)).rows[0]?.label ?? "Admin (account unavailable)"
    : null;
  return {
    history: history.rows,
    pagination: { page, pageSize, total },
    catalog: { products, categories, lastUpdated: lastUpdated?.toISOString() ?? null, updatedBy: latestLabel },
  };
}
