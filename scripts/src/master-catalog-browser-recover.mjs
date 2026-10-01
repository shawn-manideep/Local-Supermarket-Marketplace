import { readFile, stat, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  BrowserCDP, discoverAccounts, discoverPriorHarnessMasters, makePool,
  originFromEnv, verifyFixtures,
} from "./master-catalog-cdp.mjs";
import { cleanupOwnListing } from "./master-catalog-browser-missing-flow.mjs";
import {
  cleanupOwnMaster, discoverInterruptedVendorDrafts,
} from "./master-catalog-browser-admin-flows.mjs";

if (process.env.MASTER_CATALOG_BROWSER_APPROVED !== "1") {
  throw new Error("Explicit authenticated browser readiness approval is required.");
}
const reportPath = "artifacts/catalog-verification/report.json";
const prior = JSON.parse(await readFile(reportPath, "utf8"));
const priorStat = await stat(reportPath);
const listingEvidence = [
  "published zero-stock variant persists under the same master-linked store listing",
  "all four valid selling variants save through the normal vendor interface",
].map(name => prior.assertions.some(item => item.name === name && item.passed));
if (listingEvidence[0] !== listingEvidence[1]) {
  throw new Error("Interrupted selling-listing recovery has incomplete creation evidence.");
}
const pool = makePool(process.cwd());
let browser, profile;
try {
  const accounts = await discoverAccounts(pool);
  const fixture = await verifyFixtures(pool, accounts);
  const candidates = listingEvidence[0] ? await pool.query(
    `SELECT p.id::text, p.name FROM public.products p
     JOIN public.master_products m ON m.id = p.master_product_id
     WHERE p.store_id = $1 AND p.created_at BETWEEN $2 AND $3
       AND m.name ~* 'rice$'
       AND (SELECT count(*) FROM public.product_variants v WHERE v.product_id = p.id) = 4
       AND (SELECT count(*) FROM public.product_variants v WHERE v.product_id = p.id
         AND v.is_active = true AND v.availability = true AND (
           (v.name = '500 g' AND v.quantity_value = 500 AND v.quantity_unit = 'g' AND v.price = 40 AND v.stock_quantity = 20) OR
           (v.name = '1 kg' AND v.quantity_value = 1 AND v.quantity_unit = 'kg' AND v.price = 75 AND v.stock_quantity = 30) OR
           (v.name = '2 kg' AND v.quantity_value = 2 AND v.quantity_unit = 'kg' AND v.price = 145 AND v.stock_quantity = 15) OR
           (v.name = '5 kg' AND v.quantity_value = 5 AND v.quantity_unit = 'kg' AND v.price = 350 AND v.stock_quantity = 10)
         )) = 4`,
    [fixture.storeId, prior.startedAt, priorStat.mtime.toISOString()],
  ) : { rows: [], rowCount: 0 };
  if (listingEvidence[0] && candidates.rowCount !== 1) {
    throw new Error("Interrupted listing was not uniquely proven; no uncertain cleanup is allowed.");
  }
  const adminPassword = process.env.ADMIN_PASSWORD || process.env.PHASE12_ADMIN_PASSWORD;
  if (!adminPassword) throw new Error("Admin QA credential is unavailable.");
  profile = await mkdtemp(path.join(os.tmpdir(), "catalog-recovery-"));
  browser = new BrowserCDP(process.env.CHROMIUM_PATH || "/repl/tools/bin/chromium", profile);
  const url = new URL("/", originFromEnv()).href;
  if (listingEvidence[0]) {
    const password = process.env.PHASE12_VENDOR_B_PASSWORD || process.env.VENDOR_B_PASSWORD;
    if (!password) throw new Error("Vendor QA credential is unavailable.");
    const page = await browser.context(url, 1440, 1000);
    if (!await browser.wait(page, "!!document.querySelector('[data-testid=\"input-email\"]')")) {
      throw new Error("Vendor recovery login did not load.");
    }
    await browser.fillSelector(page, '[data-testid="input-email"]', accounts.vendorB.email);
    await browser.fillSelector(page, '[data-testid="input-password"]', password);
    await browser.clickSelector(page, '[data-testid="button-sign-in"]');
    if (!await browser.wait(page, "!!Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === 'Catalog')")) {
      throw new Error("Vendor recovery sign-in did not complete.");
    }
    await browser.clickText(page, "Catalog");
    if (!await browser.wait(page, "document.querySelectorAll('.vendor-product-row').length > 0")) {
      throw new Error("Vendor recovery catalog did not load.");
    }
    if (!await cleanupOwnListing(browser, page, candidates.rows[0].name)) {
      throw new Error("Proven interrupted test listing could not be deactivated through the UI.");
    }
    const preserved = await pool.query(
      `SELECT is_active, (SELECT count(*)::int FROM public.product_variants v WHERE v.product_id = p.id) AS variants
       FROM public.products p WHERE p.id = $1`, [candidates.rows[0].id],
    );
    if (preserved.rows[0]?.is_active !== false || preserved.rows[0]?.variants !== 4) {
      throw new Error("Interrupted test listing cleanup was not confirmed read-only.");
    }
  }
  const report = { cleanup: {}, counts: {}, issues: [], screenshots: [] };
  const checks = [];
  const priorHarnessMasters = [
    ...await discoverPriorHarnessMasters(pool, fixture.storeId),
    ...await discoverInterruptedVendorDrafts(pool, ""),
  ];
  await cleanupOwnMaster({
    browser, pool, dashboardUrl: url, adminEmail: accounts.admin.email,
    adminPassword, priorHarnessMasters, report, checks,
  });
  if (report.issues.length || checks.some(check => !check.passed)) {
    throw new Error("Proven interrupted Master Product cleanup remains incomplete.");
  }
  console.log(JSON.stringify({
    interruptedListingDeactivated: Boolean(listingEvidence[0]), fourVariantsRetained: Boolean(listingEvidence[0]),
    provenInterruptedMastersArchived: report.cleanup.priorHarnessMastersArchived || 0,
    unrelatedRowsUntouched: true,
  }));
} finally {
  if (browser) await browser.close();
  await pool.end().catch(() => {});
  if (profile) await rm(profile, { recursive: true, force: true });
}