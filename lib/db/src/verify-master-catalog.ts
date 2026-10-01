/**
 * Migration integrity verification. Baselines contain counts and hashes only,
 * never customer data, identities, credentials, or order snapshots.
 * Run with the existing DB connection; test writes are always rolled back.
 */
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { getPool } from "./index.js";

const baselinePath = "/tmp/master-catalog-migration-baseline.json";
const preservedTables = [
  "categories", "products", "product_variants",
  "carts", "cart_items", "orders", "order_items", "order_status_history",
] as const;

async function snapshot() {
  const result: Record<string, { count: number; fingerprint: string }> = {};
  for (const table of preservedTables) {
    const { rows } = await getPool().query(
      `SELECT count(*)::integer AS count,
       md5(coalesce(string_agg(
         (to_jsonb(t) - 'master_product_id' - 'master_category_id')::text,
         ',' ORDER BY t.id
       ), '')) AS fingerprint FROM public.${table} t`,
    );
    result[table] = rows[0];
  }
  return result;
}

async function databaseChecks() {
  const client = await getPool().connect();
  let passed = 0;
  async function mustFail(query: string, params: unknown[] = []) {
    await client.query("SAVEPOINT expected_failure");
    let failed = false;
    try { await client.query(query, params); } catch { failed = true; }
    await client.query("ROLLBACK TO SAVEPOINT expected_failure");
    assert.equal(failed, true, "Expected database protection to reject the operation");
    passed++;
  }
  try {
    await client.query("BEGIN");
    const category = (await client.query(
      "INSERT INTO public.master_categories (name) VALUES ('Transaction-only migration check') RETURNING id",
    )).rows[0];
    const product = (await client.query(
      "INSERT INTO public.master_products (master_category_id,name) VALUES ($1,'Transaction-only family') RETURNING id",
      [category.id],
    )).rows[0];
    passed += 2;
    await mustFail("DELETE FROM public.master_products WHERE id=$1", [product.id]);
    await mustFail("DELETE FROM public.master_categories WHERE id=$1", [category.id]);
    await client.query("UPDATE public.master_products SET is_active=false WHERE id=$1", [product.id]);
    await client.query("UPDATE public.master_categories SET is_active=false WHERE id=$1", [category.id]);
    assert.equal((await client.query("SELECT is_active FROM public.master_products WHERE id=$1", [product.id])).rows[0].is_active, false);
    assert.equal((await client.query("SELECT is_active FROM public.master_categories WHERE id=$1", [category.id])).rows[0].is_active, false);
    passed += 2;
    const columns = (await client.query(
      "SELECT table_name,is_nullable FROM information_schema.columns WHERE table_schema='public' AND ((table_name='products' AND column_name='master_product_id') OR (table_name='categories' AND column_name='master_category_id'))",
    )).rows;
    assert.equal(columns.length, 2);
    assert.ok(columns.every((column) => column.is_nullable === "YES"));
    passed++;
    const units = (await client.query(
      "SELECT enumlabel FROM pg_enum JOIN pg_type ON pg_type.oid=enumtypid WHERE typname='quantity_unit'",
    )).rows.map((row) => row.enumlabel);
    for (const unit of ["g", "kg", "ml", "l", "piece", "pack", "dozen", "bottle", "box"]) assert.ok(units.includes(unit));
    passed++;
    const rls = (await client.query(
      "SELECT relname,relrowsecurity FROM pg_class WHERE oid IN ('public.master_products'::regclass,'public.master_categories'::regclass,'public.master_mapping_audit'::regclass)",
    )).rows;
    assert.equal(rls.length, 3);
    assert.ok(rls.every((table) => table.relrowsecurity));
    passed++;
    for (const table of ["master_products", "master_categories", "master_mapping_audit"]) {
      const { rows } = await client.query(
        "SELECT has_table_privilege('authenticated',$1,'INSERT') AS insert, has_table_privilege('authenticated',$1,'UPDATE') AS update, has_table_privilege('authenticated',$1,'DELETE') AS delete",
        [`public.${table}`],
      );
      assert.deepEqual(rows[0], { insert: false, update: false, delete: false });
      passed++;
    }
    for (const [table, column] of [
      ["products", "stock_quantity"], ["products", "sku"], ["products", "external_code"],
      ["products", "created_at"], ["product_variants", "stock_quantity"],
      ["product_variants", "sku"], ["product_variants", "external_code"], ["product_variants", "updated_at"],
    ]) {
      assert.equal((await client.query(
        "SELECT has_column_privilege('authenticated',$1,$2,'SELECT') AS allowed",
        [`public.${table}`, column],
      )).rows[0].allowed, false);
      passed++;
    }
    // RLS hides even active master-only inventory from direct customer access.
    const customer = (await client.query("SELECT id FROM public.user_profiles WHERE role='customer' LIMIT 1")).rows[0];
    if (customer) {
      await client.query("SELECT set_config('request.jwt.claim.sub',$1,true)", [customer.id]);
      await client.query("SET LOCAL ROLE authenticated");
      assert.equal((await client.query("SELECT count(*)::integer AS count FROM public.master_products")).rows[0].count, 0);
      passed++;
      await client.query("RESET ROLE");
    }
    process.stdout.write(`Database protections: ${passed} checks passed (all test writes rolled back).\n`);
  } finally {
    await client.query("ROLLBACK");
    client.release();
  }
}

try {
  const mode = process.argv[2];
  if (mode === "before") {
    await writeFile(baselinePath, JSON.stringify(await snapshot()));
    process.stdout.write("Pre-migration counts/hash baseline captured for eight preserved commerce tables.\n");
  } else if (mode === "after") {
    const before = JSON.parse(await readFile(baselinePath, "utf8"));
    assert.deepEqual(await snapshot(), before, "Existing commerce records changed during migration");
    process.stdout.write("Migration preservation: all eight original table counts and fingerprints match.\n");
    await databaseChecks();
    assert.deepEqual(await snapshot(), before, "Verification changed existing commerce records");
  } else {
    throw new Error("Specify before or after; run before prior to applying the migration.");
  }
} catch (error) {
  // Avoid dumping DB error objects, query parameters or connection details.
  process.stderr.write(`Master Catalog verification failed: ${error instanceof assert.AssertionError ? error.message : "database operation failed; check connection and migration state"}\n`);
  process.exitCode = 1;
} finally {
  await getPool().end();
}