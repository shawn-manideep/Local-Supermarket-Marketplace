import assert from "node:assert/strict";
import { getDb, getPool, masterCategories, masterProducts } from "@workspace/db";
import { sql } from "drizzle-orm";
import {
  canonicalIdentity,
  normalizeIdentityText,
  withMasterCatalogWriteLock,
} from "./duplicate-review.js";
import {
  INITIAL_MASTER_CATEGORY_NAMES,
  INITIAL_MASTER_PRODUCTS,
  type InitialMasterCategoryName,
  type InitialMasterProduct,
} from "./initial-data.js";

const DEV_PROJECT_REF = "gkwcolipeavxnuzqlamb";
const BASELINE_ORDER_COUNT = 18;
const BASELINE_ORDERS_FINGERPRINT = "aab10b2826492feb48c8e29be9cea98f";
const COMMERCE_TABLES = [
  "categories",
  "products",
  "product_variants",
  "carts",
  "cart_items",
  "orders",
  "order_items",
  "order_status_history",
] as const;

type CommerceTable = (typeof COMMERCE_TABLES)[number];
type SnapshotRow = { table_name: CommerceTable; row_count: number; fingerprint: string };
type Snapshot = Record<CommerceTable, { count: number; fingerprint: string }>;
type ExistingCategory = { id: string; name: string; isActive: boolean };
type ExistingProduct = {
  id: string;
  masterCategoryId: string;
  name: string;
  brand: string | null;
  attributes: Record<string, string> | null;
  isActive: boolean;
};
type SeedDisposition = "inserted" | "reused" | "archived";
type Counts = { inserted: number; reused: number; archived: number };
type CategoryReport = {
  categoryName: InitialMasterCategoryName;
  category: Counts;
  products: Counts & { blockedByArchivedCategory: number };
  seedTotal: number;
};
type SeedReport = {
  mode: "dry-run" | "apply";
  categories: Counts;
  products: Counts & { blockedByArchivedCategory: number };
  seedTotal: number;
  perCategory: CategoryReport[];
  newMasterProducts: string[];
  needsAdminRestore: { categories: number; products: number };
};

const COMMERCE_SNAPSHOT_QUERY = `
  SELECT table_name, row_count, fingerprint
  FROM (
    SELECT 'categories'::text AS table_name, count(*)::integer AS row_count,
      md5(coalesce(string_agg(row_to_json(t)::text, ',' ORDER BY t.id), '')) AS fingerprint
    FROM public.categories AS t
    UNION ALL
    SELECT 'products', count(*)::integer,
      md5(coalesce(string_agg(row_to_json(t)::text, ',' ORDER BY t.id), ''))
    FROM public.products AS t
    UNION ALL
    SELECT 'product_variants', count(*)::integer,
      md5(coalesce(string_agg(row_to_json(t)::text, ',' ORDER BY t.id), ''))
    FROM public.product_variants AS t
    UNION ALL
    SELECT 'carts', count(*)::integer,
      md5(coalesce(string_agg(row_to_json(t)::text, ',' ORDER BY t.id), ''))
    FROM public.carts AS t
    UNION ALL
    SELECT 'cart_items', count(*)::integer,
      md5(coalesce(string_agg(row_to_json(t)::text, ',' ORDER BY t.id), ''))
    FROM public.cart_items AS t
    UNION ALL
    SELECT 'orders', count(*)::integer,
      md5(coalesce(string_agg(t.id::text || row_to_json(t)::text, '' ORDER BY t.id), ''))
    FROM public.orders AS t
    UNION ALL
    SELECT 'order_items', count(*)::integer,
      md5(coalesce(string_agg(row_to_json(t)::text, ',' ORDER BY t.id), ''))
    FROM public.order_items AS t
    UNION ALL
    SELECT 'order_status_history', count(*)::integer,
      md5(coalesce(string_agg(row_to_json(t)::text, ',' ORDER BY t.id), ''))
    FROM public.order_status_history AS t
  ) AS commerce_snapshot
  ORDER BY table_name
`;

function parseArguments(arguments_: string[]) {
  let apply = false;
  let projectRef: string | undefined;
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (argument === "--apply") {
      if (apply) throw new Error("Use --apply only once.");
      apply = true;
    } else if (argument === "--project-ref") {
      if (projectRef) throw new Error("Use --project-ref only once.");
      projectRef = arguments_[index + 1];
      index += 1;
      if (!projectRef) throw new Error("--project-ref requires a value.");
    } else if (argument.startsWith("--project-ref=")) {
      if (projectRef) throw new Error("Use --project-ref only once.");
      projectRef = argument.slice("--project-ref=".length);
    } else {
      throw new Error("Unsupported seed-runner argument.");
    }
  }

  if (apply && projectRef !== DEV_PROJECT_REF) {
    throw new Error(`Applying requires --project-ref ${DEV_PROJECT_REF}.`);
  }
  if (!apply && projectRef) {
    throw new Error("--project-ref is only accepted together with --apply.");
  }
  if (apply) {
    const configuredUrl = process.env.SUPABASE_URL;
    if (!configuredUrl) throw new Error("SUPABASE_URL is required before applying.");
    let configuredProjectRef: string | undefined;
    try {
      const host = new URL(configuredUrl).hostname;
      if (host.endsWith(".supabase.co")) configuredProjectRef = host.slice(0, -".supabase.co".length);
    } catch {
      throw new Error("SUPABASE_URL is not a valid Supabase project URL.");
    }
    if (configuredProjectRef !== projectRef) {
      throw new Error("The --project-ref does not match the configured SUPABASE_URL.");
    }
  }
  return { apply };
}

function asSnapshot(rows: SnapshotRow[]): Snapshot {
  const snapshot = Object.fromEntries(
    rows.map((row) => [row.table_name, { count: Number(row.row_count), fingerprint: row.fingerprint }]),
  ) as Snapshot;
  if (COMMERCE_TABLES.some((table) => !snapshot[table])) {
    throw new Error("The commerce preservation snapshot was incomplete.");
  }
  return snapshot;
}

async function captureCommerceSnapshot(executor?: any): Promise<Snapshot> {
  const result = executor
    ? await executor.execute(sql.raw(COMMERCE_SNAPSHOT_QUERY)) as { rows: SnapshotRow[] }
    : await getPool().query<SnapshotRow>(COMMERCE_SNAPSHOT_QUERY);
  return asSnapshot(result.rows);
}

function assertDevelopmentBaseline(snapshot: Snapshot) {
  const orders = snapshot.orders;
  if (
    orders.count !== BASELINE_ORDER_COUNT ||
    orders.fingerprint !== BASELINE_ORDERS_FINGERPRINT
  ) {
    throw new Error("The connected database does not match the verified DEV orders baseline; no catalog writes were made.");
  }
}

function assertPreservedCommerce(before: Snapshot, after: Snapshot) {
  for (const table of COMMERCE_TABLES) {
    if (
      before[table].count !== after[table].count ||
      before[table].fingerprint !== after[table].fingerprint
    ) {
      throw new Error("The eight-table commerce preservation check failed.");
    }
  }
}

function blankCounts(): Counts {
  return { inserted: 0, reused: 0, archived: 0 };
}

function identityFor(product: Pick<InitialMasterProduct, "name" | "brand" | "attributes">) {
  return canonicalIdentity({
    masterCategoryId: "",
    name: product.name,
    brand: product.brand,
    attributes: product.attributes,
  });
}

function categoryStates(categories: ExistingCategory[]) {
  const states = new Map<string, { active?: ExistingCategory; archived?: ExistingCategory }>();
  for (const category of categories) {
    const key = normalizeIdentityText(category.name);
    const state = states.get(key) ?? {};
    if (category.isActive) state.active ??= category;
    else state.archived ??= category;
    states.set(key, state);
  }
  return states;
}

function productStates(products: ExistingProduct[], categories: ExistingCategory[]) {
  const categoryActive = new Map(categories.map((category) => [category.id, category.isActive]));
  const states = new Map<string, { active?: ExistingProduct; archived?: ExistingProduct }>();
  for (const existing of products) {
    const key = identityFor({
      name: existing.name,
      brand: existing.brand,
      attributes: existing.attributes ?? {},
    });
    const state = states.get(key) ?? {};
    if (existing.isActive && categoryActive.get(existing.masterCategoryId) === true) {
      state.active ??= existing;
    } else {
      state.archived ??= existing;
    }
    states.set(key, state);
  }
  return states;
}

function newReport(apply: boolean): SeedReport {
  return {
    mode: apply ? "apply" : "dry-run",
    categories: blankCounts(),
    products: { ...blankCounts(), blockedByArchivedCategory: 0 },
    seedTotal: INITIAL_MASTER_PRODUCTS.length,
    perCategory: INITIAL_MASTER_CATEGORY_NAMES.map((categoryName) => ({
      categoryName,
      category: blankCounts(),
      products: { ...blankCounts(), blockedByArchivedCategory: 0 },
      seedTotal: INITIAL_MASTER_PRODUCTS.filter((item) => item.categoryName === categoryName).length,
    })),
    newMasterProducts: [],
    needsAdminRestore: { categories: 0, products: 0 },
  };
}

function incrementDisposition(counts: Counts, disposition: SeedDisposition) {
  counts[disposition] += 1;
}

async function readMasterRows(executor: any) {
  const categories = await executor.select({
    id: masterCategories.id,
    name: masterCategories.name,
    isActive: masterCategories.isActive,
  }).from(masterCategories).orderBy(masterCategories.id) as ExistingCategory[];
  const products = await executor.select({
    id: masterProducts.id,
    masterCategoryId: masterProducts.masterCategoryId,
    name: masterProducts.name,
    brand: masterProducts.brand,
    attributes: masterProducts.attributes,
    isActive: masterProducts.isActive,
  }).from(masterProducts).orderBy(masterProducts.id) as ExistingProduct[];
  return { categories, products };
}

async function seedCatalog(executor: any, apply: boolean): Promise<SeedReport> {
  const report = newReport(apply);
  const perCategory = new Map(report.perCategory.map((entry) => [entry.categoryName, entry]));
  const { categories: existingCategories, products: existingProducts } = await readMasterRows(executor);
  const categoryState = categoryStates(existingCategories);

  for (const categoryName of INITIAL_MASTER_CATEGORY_NAMES) {
    const state = categoryState.get(normalizeIdentityText(categoryName));
    let disposition: SeedDisposition;
    if (state?.active) {
      disposition = "reused";
    } else if (state?.archived) {
      disposition = "archived";
      report.needsAdminRestore.categories += 1;
    } else {
      disposition = "inserted";
      const plannedCategory: ExistingCategory = {
        id: `seed:${normalizeIdentityText(categoryName)}`,
        name: categoryName,
        isActive: true,
      };
      if (apply) {
        const [inserted] = await executor.insert(masterCategories)
          .values({ name: categoryName })
          .returning({ id: masterCategories.id, name: masterCategories.name });
        plannedCategory.id = inserted.id;
      }
      categoryState.set(normalizeIdentityText(categoryName), { active: plannedCategory });
      existingCategories.push(plannedCategory);
    }
    incrementDisposition(report.categories, disposition);
    incrementDisposition(perCategory.get(categoryName)!.category, disposition);
  }

  const productState = productStates(existingProducts, existingCategories);
  for (const seedProduct of INITIAL_MASTER_PRODUCTS) {
    const category = categoryState.get(normalizeIdentityText(seedProduct.categoryName));
    const identity = identityFor(seedProduct);
    const matches = productState.get(identity);
    const categoryReport = perCategory.get(seedProduct.categoryName)!;
    let disposition: SeedDisposition | "blocked";

    if (matches?.active) {
      disposition = "reused";
    } else if (matches?.archived) {
      disposition = "archived";
      report.needsAdminRestore.products += 1;
    } else if (!category?.active) {
      disposition = "blocked";
      categoryReport.products.blockedByArchivedCategory += 1;
      report.products.blockedByArchivedCategory += 1;
    } else {
      disposition = "inserted";
      if (apply) {
        const [inserted] = await executor.insert(masterProducts).values({
          masterCategoryId: category.active.id,
          name: seedProduct.name,
          description: seedProduct.description,
          image: null,
          brand: seedProduct.brand,
          attributes: {},
        }).returning({ id: masterProducts.id });
        productState.set(identity, {
          active: {
            id: inserted.id,
            masterCategoryId: category.active.id,
            name: seedProduct.name,
            brand: seedProduct.brand,
            attributes: {},
            isActive: true,
          },
        });
        report.newMasterProducts.push(seedProduct.name);
      } else {
        report.newMasterProducts.push(seedProduct.name);
      }
    }

    if (disposition !== "blocked") {
      incrementDisposition(report.products, disposition);
      incrementDisposition(categoryReport.products, disposition);
    }
  }
  return report;
}

async function main() {
  const { apply } = parseArguments(process.argv.slice(2));
  const database = getDb();
  const pool = getPool();

  const before = await captureCommerceSnapshot();
  assertDevelopmentBaseline(before);

  let report: SeedReport;
  if (apply) {
    report = await database.transaction((transaction) =>
      withMasterCatalogWriteLock(transaction, async () => {
        const seeded = await seedCatalog(transaction, true);
        assertPreservedCommerce(before, await captureCommerceSnapshot(transaction));
        return seeded;
      }),
    );
  } else {
    report = await seedCatalog(database, false);
  }

  const after = await captureCommerceSnapshot();
  assertPreservedCommerce(before, after);
  assert.equal(report.seedTotal, INITIAL_MASTER_PRODUCTS.length);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  await pool.end();
}

main().catch(async (error: unknown) => {
  const safeMessage = error instanceof Error &&
    (error.message.startsWith("Applying requires") ||
      error.message.startsWith("SUPABASE_URL") ||
      error.message.startsWith("The --project-ref") ||
      error.message.startsWith("--project-ref") ||
      error.message.startsWith("Unsupported") ||
      error.message.startsWith("Use --apply") ||
      error.message.startsWith("The connected database") ||
      error.message.startsWith("The eight-table") ||
      error.message.startsWith("The commerce preservation") ||
      error.message.startsWith("The connected database"))
    ? error.message
    : "Seed failed; no database diagnostics or existing catalog rows were printed.";
  process.stderr.write(`Initial master catalog seed failed: ${safeMessage}\n`);
  process.exitCode = 1;
  try {
    await getPool().end();
  } catch {
    // A missing connection setting is reported without exposing connection details.
  }
});