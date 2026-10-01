import { access, mkdir, mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  BrowserCDP, discoverAccounts, discoverPriorHarnessMasters, inputValue,
  eligibleStoreIds, makePool, originFromEnv, originalRowsChangedOnlyIn,
  originalRowsUnchanged, quote, readOnlyPreflight,
  record, searchVendor, snapshotCatalog, snapshotCommerce, verifyFixtures, wait,
} from "./master-catalog-cdp.mjs";
import {
  captureFailureScreenshot, captureSanitizedScreenshot, cleanupOwnListing,
  privacyProbe, runVendorMissingProductFlow,
} from "./master-catalog-browser-missing-flow.mjs";
import { cleanupOwnMaster, createAdminPage, runAdminMasterCatalogFlow } from "./master-catalog-browser-admin-flows.mjs";
import { restoreVendorVariants, runVendorVariantFlow } from "./master-catalog-browser-variant-flow.mjs";
import { runCustomerVariantFlow } from "./master-catalog-browser-customer-flow.mjs";
import { writeSanitizedReport, dispatch } from "./master-catalog-browser-runtime.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const artifactDir = path.join(root, "artifacts/catalog-verification");
const chromePath = process.env.CHROMIUM_PATH ?? "/repl/tools/bin/chromium";
const previousScreenshotProductName = "Qorvellan 9bd2ea60-d50d-4bee-a183-c0116e5db2fe";
const expectedCategoryCount = 25;
const resumeAfterVendorCatalog = process.argv.includes("--resume-after-vendor-catalog");
const lastReusableCatalogAssertion =
  "global product search clears or ignores a previously chosen category";

function cleanArtifactDirectory(keptScreenshots = new Set()) {
  return readdir(artifactDir, { withFileTypes: true }).then(async entries => {
    await Promise.all(entries
      .filter(entry => entry.isFile() && (
        entry.name === "report.json" ||
        (/\.png$/i.test(entry.name) && !keptScreenshots.has(entry.name))
      ))
      .map(entry => rm(path.join(artifactDir, entry.name), { force: true })));
  }).catch(() => {});
}

async function loadPriorCatalogEvidence() {
  const reportPath = path.join(artifactDir, "report.json");
  let priorReport;
  let reportStat;
  try {
    [priorReport, reportStat] = await Promise.all([
      readFile(reportPath, "utf8").then(JSON.parse),
      stat(reportPath),
    ]);
  } catch {
    throw new Error("--resume-after-vendor-catalog requires a readable prior catalog verification report.");
  }

  const assertions = Array.isArray(priorReport.assertions) ? priorReport.assertions : [];
  const lastIndex = assertions.findIndex(item => item.name === lastReusableCatalogAssertion);
  const retainedAssertions = lastIndex >= 0 ? assertions.slice(0, lastIndex + 1) : [];
  if (retainedAssertions.length !== 24 || retainedAssertions.some(item => item.passed !== true)) {
    throw new Error("--resume-after-vendor-catalog requires all 24 earlier vendor catalog assertions to have passed.");
  }

  const screenshots = [];
  for (const name of Array.isArray(priorReport.screenshots) ? priorReport.screenshots : []) {
    if (typeof name !== "string" || path.basename(name) !== name ||
        !/^vendor-(?:master-catalog|catalog).*\.png$/i.test(name)) continue;
    try {
      await access(path.join(artifactDir, name));
      screenshots.push(name);
    } catch {
      // Keep only files that are actually present as prior-run evidence.
    }
  }

  return {
    assertions: retainedAssertions.map(item => ({ name: item.name, passed: true })),
    counts: { ...(priorReport.counts ?? {}) },
    screenshots,
    priorReportModifiedAt: reportStat.mtime.toISOString(),
  };
}

async function selectRiceCategory(browser, page) {
  return browser.evaluate(page, `(() => {
    const select = document.querySelector('#master-category-filter');
    const option = Array.from(select?.options || []).find(item => item.textContent.trim() === 'Rice & Grains');
    return option?.value ?? null;
  })()`);
}

async function vendorCategoryAndPaginationChecks(browser, page, checks) {
  const pages = await browser.evaluate(page,
    "document.querySelector('.vendor-master-pagination')?.innerText.match(/page\\s+1\\s+of\\s+(\\d+)/i)?.[1] ?? '1'");
  const totalPages = Number(pages);
  if (totalPages > 1) {
    const next = `Array.from(document.querySelectorAll('.vendor-master-pagination button'))
      .find(button => button.innerText.trim() === 'Next')`;
    await browser.clickAt(page, await browser.rect(page, next, true));
    const pageTwo = await browser.wait(page,
      "document.querySelector('.vendor-master-pagination')?.innerText.match(/page\\s+2\\s+of/i) != null", 10000);
    record(checks, "vendor catalog pagination advances to the next real page", pageTwo);
    const filterRetained = await inputValue(browser, page, "#master-category-filter") === "";
    record(checks, "vendor catalog pagination preserves the all-category browse state", filterRetained);
    const previous = `Array.from(document.querySelectorAll('.vendor-master-pagination button'))
      .find(button => button.innerText.trim() === 'Previous')`;
    await browser.clickAt(page, await browser.rect(page, previous, true));
    record(checks, "vendor catalog returns to the first browse page without losing catalog results",
      await browser.wait(page,
        "document.querySelector('.vendor-master-pagination')?.innerText.match(/page\\s+1\\s+of/i) != null", 10000));
  } else {
    record(checks, "vendor Master Catalog renders the current browse page controls", totalPages === 1);
  }
}

async function run() {
  if (process.env.MASTER_CATALOG_BROWSER_APPROVED !== "1") {
    throw new Error("Explicit main-agent readiness approval is required before authenticated browser execution.");
  }
  const priorCatalogEvidence = resumeAfterVendorCatalog
    ? await loadPriorCatalogEvidence()
    : null;
  await mkdir(artifactDir, { recursive: true });
  await cleanArtifactDirectory(new Set(priorCatalogEvidence?.screenshots ?? []));
  const checks = [];
  const report = {
    title: "Master Catalog authenticated browser verification",
    passed: false,
    startedAt: new Date().toISOString(),
    assertions: checks,
    counts: {},
    screenshots: [...(priorCatalogEvidence?.screenshots ?? [])],
    issues: [],
    cleanup: {
      ownStoreListingDeactivated: false,
      ownListingVariantsRetained: false,
      uniqueMasterArchived: false,
      priorHarnessMastersArchived: 0,
    },
  };
  if (priorCatalogEvidence) {
    report.historicalEvidence = {
      mode: "prior vendor catalog pass retained; not rerun in this continuation",
      priorReportModifiedAt: priorCatalogEvidence.priorReportModifiedAt,
      assertionCount: priorCatalogEvidence.assertions.length,
      assertions: priorCatalogEvidence.assertions,
      counts: priorCatalogEvidence.counts,
      screenshots: priorCatalogEvidence.screenshots,
      note: "These assertions and artifacts are historical evidence from the prior authenticated run. They are not counted as current assertions.",
    };
    report.counts.historicalVendorCatalogAssertions =
      priorCatalogEvidence.assertions.length;
  }
  let pool, browser, profileDir, accounts, fixture, baselineCommerce, baselineCatalog;
  let origin, vendorPage, customerPage, adminPage, failurePage;
  let vendorPassword, customerPassword, adminPassword;
  let missingProduct, configuredListing, priorHarnessMasters = [];
  let activeStage = "managed HTTPS development environment preflight";
  let reportWrittenBeforeClose = false;
  const privateScreenshotText = [];
  const stage = (name) => {
    activeStage = name;
    process.stdout.write(`${JSON.stringify({ stage: name })}\n`);
  };

  try {
    stage("managed HTTPS origin preflight");
    origin = originFromEnv();
    stage("QA credential availability preflight");
    vendorPassword = process.env.PHASE12_VENDOR_B_PASSWORD || process.env.VENDOR_B_PASSWORD;
    customerPassword = process.env.CUSTOMER_B_PASSWORD || process.env.PHASE12_CUSTOMER_B_PASSWORD;
    adminPassword = process.env.ADMIN_PASSWORD || process.env.PHASE12_ADMIN_PASSWORD;
    if (!vendorPassword || !customerPassword || !adminPassword) {
      throw new Error("required QA role passwords are unavailable");
    }
    stage("managed browser executable preflight");
    await access(chromePath);
    stage("bounded development database pool initialization");
    pool = makePool(root);
    stage("read-only QA role, store, and saved-address fixtures");
    accounts = await discoverAccounts(pool);
    fixture = await verifyFixtures(pool, accounts);
    privateScreenshotText.push(accounts.vendorB.email, accounts.customerB.email, accounts.admin.email);
    record(checks, "QA-marked admin, Vendor B, Customer B, active Store B, and saved pincode fixtures verified read-only", true);

    stage("read-only prior-harness fixture identification");
    priorHarnessMasters = await discoverPriorHarnessMasters(pool, fixture.storeId);
    const knownPrior = priorHarnessMasters.some(master => master.name === previousScreenshotProductName);
    report.counts.provenPriorHarnessMasters = priorHarnessMasters.length;
    report.counts.knownScreenshotHarnessMasterFound = Number(knownPrior);
    record(checks, "only masters matching the exact randomized legacy harness name and matching brand/details/description markers are cleanup candidates",
      true);
    const seedCounts = await pool.query(
      `SELECT
         (SELECT count(*)::int FROM public.master_categories WHERE is_active = true) AS active_categories,
         (SELECT count(*)::int FROM public.master_products WHERE is_active = true) AS active_masters,
         (SELECT count(*)::int FROM public.master_products) AS total_masters,
         (SELECT count(*)::int FROM public.master_products WHERE is_active = true AND master_category_id IS NULL)
           AS active_pending_masters`,
    );
    report.counts.masterCategories = seedCounts.rows[0].active_categories;
    report.counts.masterProductsActiveBefore = seedCounts.rows[0].active_masters;
    report.counts.masterProductsTotalBefore = seedCounts.rows[0].total_masters;
    record(checks, "read-only Master Catalog baseline has 25 active categories and the current 183 active / 190 total master products",
      seedCounts.rows[0].active_categories === 25 &&
      seedCounts.rows[0].active_masters === 183 &&
      seedCounts.rows[0].total_masters === 190);
    const unidentifiedPending = Math.max(
      0, seedCounts.rows[0].active_pending_masters - priorHarnessMasters.length,
    );
    report.counts.unidentifiedPendingMastersRetained = unidentifiedPending;
    if (unidentifiedPending > 0) {
      report.issues.push(
        `${unidentifiedPending} pre-existing active pending Master Product(s) could not be attributed to this harness and were intentionally left untouched.`,
      );
    }
    record(checks, "unattributed pre-existing pending masters are retained without blocking feature verification",
      true);
    baselineCommerce = await snapshotCommerce(pool);
    baselineCatalog = await snapshotCatalog(pool);
    report.counts.baselineOrders = baselineCommerce.get("orders")?.size ?? 0;
    record(checks, "read-only baseline contains the documented 18 existing orders",
      report.counts.baselineOrders === 18);
    record(checks, "eight commerce tables and five Master/store-catalog tables are snapshotted read-only",
      baselineCommerce.size === 8 && baselineCatalog.size === 5);

    stage("bounded Chrome DevTools startup");
    profileDir = await mkdtemp(path.join(os.tmpdir(), "master-catalog-cdp-"));
    browser = new BrowserCDP(chromePath, profileDir);
    const dashboardUrl = new URL("/", origin).href;
    const customerUrl = new URL("/customer/", origin).href;
    const eligibleIds = await eligibleStoreIds(pool, "560001");
    record(checks, "read-only eligible-store set exists for Customer B saved pincode 560001",
      eligibleIds.size > 0 && eligibleIds.has(fixture.storeId));

    stage("Vendor B normal UI sign-in");
    vendorPage = await browser.context(dashboardUrl, 1440, 1000);
    failurePage = vendorPage;
    const vendorLogin = await browser.wait(vendorPage,
      "!!document.querySelector('[data-testid=\"input-email\"]')", 12000);
    record(checks, "Vendor B dashboard login form is loaded", vendorLogin);
    await browser.fillSelector(vendorPage, '[data-testid="input-email"]', accounts.vendorB.email);
    await browser.fillSelector(vendorPage, '[data-testid="input-password"]', vendorPassword);
    await browser.clickSelector(vendorPage, '[data-testid="button-sign-in"]');
    const vendorReady = await browser.wait(vendorPage,
      "!!Array.from(document.querySelectorAll('button')).find(button => button.innerText.trim() === 'Catalog')", 15000);
    record(checks, "Vendor B normal UI session reaches the dashboard", vendorReady);
    await browser.clickText(vendorPage, "Catalog");
    const catalogLoaded = await browser.wait(vendorPage,
      "!!document.querySelector('#master-product-search') && !!document.querySelector('#master-category-filter')", 12000);
    record(checks, "vendor Master Catalog shows real search and optional category controls", catalogLoaded);

    if (priorCatalogEvidence) {
      stage("resume after Vendor Master Catalog; retain prior authenticated catalog evidence");
    } else {
      stage("Vendor B active Master Category options and global search");
      const categoriesReady = await browser.wait(vendorPage,
        "Array.from(document.querySelectorAll('#master-category-filter option')).filter(option => option.value).length === 25", 25000);
      const categoryCount = await browser.evaluate(vendorPage,
        "Array.from(document.querySelectorAll('#master-category-filter option')).filter(option => option.value).length");
      record(checks, "vendor category dropdown contains all 25 active Master Categories after asynchronous load", categoriesReady && categoryCount === 25);
      record(checks, "vendor category filter is initially optional and unselected",
        await inputValue(browser, vendorPage, "#master-category-filter") === "");
      const initialResults = await searchVendor(browser, vendorPage, "rice");
      record(checks, "initial vendor catalog displays actual Master Products for rice",
        initialResults.ready && initialResults.count > 0);
      await vendorCategoryAndPaginationChecks(browser, vendorPage, checks);
      const searches = {};
      for (const term of ["rice", "milk", "eggs", "Amul", "biryani"]) {
        stage(`Vendor B global ${term} search`);
        const result = await searchVendor(browser, vendorPage, term);
        searches[term] = result.count;
        record(checks, `vendor global search returns real products for ${term} without category selection`,
          result.ready && result.count > 0 && await inputValue(browser, vendorPage, "#master-category-filter") === "");
      }
      const riceCategoryId = await selectRiceCategory(browser, vendorPage);
      record(checks, "the active Rice & Grains category is available for optional browsing", Boolean(riceCategoryId));
      await browser.fillSelector(vendorPage, "#master-product-search", "");
      await browser.wait(vendorPage,
        "!document.querySelector('.vendor-master-skeleton') && document.querySelector('#master-product-search')?.value === ''", 12000);
      await wait(500);
      await browser.selectSelector(vendorPage, "#master-category-filter", riceCategoryId);
      await wait(500);
      const categoryBrowseReady = await browser.wait(vendorPage,
        `!document.querySelector('.vendor-master-skeleton') &&
         document.querySelector('#master-category-filter')?.value === ${quote(riceCategoryId)} &&
         document.querySelectorAll('[data-testid^="card-master-product-"]').length > 0`, 12000);
      record(checks, "vendor can browse real Master Products by an optional active category",
        categoryBrowseReady && await inputValue(browser, vendorPage, "#master-category-filter") === riceCategoryId);
      const globalFromCategory = await searchVendor(browser, vendorPage, "Amul");
      record(checks, "global product search clears or ignores a previously chosen category",
        globalFromCategory.ready && globalFromCategory.count > 0 &&
        await inputValue(browser, vendorPage, "#master-category-filter") === "");
      await searchVendor(browser, vendorPage, "rice");
      report.counts.vendorMasterSearchResults = searches;
      report.counts.vendorMasterCategoryOptions = categoryCount;
      await captureInitialVendorScreenshot(
        browser, vendorPage, artifactDir, report, privateScreenshotText,
      );
    }

    stage("vendor global duplicate review and missing-product flow");
    missingProduct = await runVendorMissingProductFlow({
      browser, page: vendorPage, pool, storeId: fixture.storeId,
      artifactDir, report, checks, onStage: stage,
    });
    if (missingProduct?.name) privateScreenshotText.push(missingProduct.name, missingProduct.details);

    stage("Vendor B add-to-store and multi-variant selling configuration");
    configuredListing = await runVendorVariantFlow({
      browser, page: vendorPage, pool, storeId: fixture.storeId, storeName: fixture.storeName,
      artifactDir, report, checks, onStage: stage,
    });
    if (configuredListing?.name) privateScreenshotText.push(configuredListing.name);

    stage("Customer B normal UI sign-in and global marketplace search");
    customerPage = await browser.context(customerUrl, 440, 1000, privacyProbe);
    failurePage = customerPage;
    await runCustomerVariantFlow({
      browser, page: customerPage, pool,
      customerPassword, customerEmail: accounts.customerB.email,
      targetName: configuredListing.name, storeName: fixture.storeName,
      artifactDir, report, checks,
    });
    const variantsRestored = await restoreVendorVariants(browser, vendorPage, configuredListing, pool, checks);
    record(checks, "temporary customer-proof variant states are restored before cleanup", variantsRestored);

    stage("Admin normal UI sign-in and safe Master Catalog lifecycle");
    adminPage = await createAdminPage(
      browser, dashboardUrl, accounts.admin.email, adminPassword,
    );
    failurePage = adminPage;
    await runAdminMasterCatalogFlow({
      browser, page: adminPage, pool, testProduct: missingProduct, priorHarnessMasters,
      dashboardUrl, adminEmail: accounts.admin.email, adminPassword,
      artifactDir, report, checks,
    });
    const pendingDraft = await pool.query(
      `SELECT p.id::text, p.is_active,
              (SELECT count(*)::int FROM public.product_variants v WHERE v.product_id = p.id) AS variant_count
       FROM public.products p
       WHERE p.store_id = $1 AND p.master_product_id = $2`,
      [fixture.storeId, missingProduct.masterProductId],
    );
    const pendingDraftSafe = pendingDraft.rowCount === 1 &&
      pendingDraft.rows[0].is_active === false && pendingDraft.rows[0].variant_count === 0;
    record(checks, "newly classified and archived test master keeps its original inactive Store B draft with no variants",
      pendingDraftSafe);
    report.cleanup.uniqueMasterArchived = Boolean(missingProduct.archived);

    stage("deactivate only the harness-created store listing after proof");
    const ownListingInactive = await cleanupOwnListing(browser, vendorPage, configuredListing.name);
    const retainedListing = await pool.query(
      `SELECT p.is_active,
              (SELECT count(*)::int FROM public.product_variants v WHERE v.product_id = p.id) AS variant_count
       FROM public.products p WHERE p.id = $1 AND p.store_id = $2 AND p.master_product_id = $3`,
      [configuredListing.productId, fixture.storeId, configuredListing.masterProductId],
    );
    const retained = retainedListing.rowCount === 1 &&
      retainedListing.rows[0].is_active === false && retainedListing.rows[0].variant_count === 4;
    record(checks, "only the newly created test listing is deactivated while its four variants remain stored",
      ownListingInactive && retained);
    report.cleanup.ownStoreListingDeactivated = ownListingInactive;
    report.cleanup.ownListingVariantsRetained = retained;

    stage("pre-existing database baseline preservation");
    const afterCommerce = await snapshotCommerce(pool);
    const afterCatalog = await snapshotCatalog(pool);
    const commerceUnchanged = originalRowsUnchanged(baselineCommerce, afterCommerce);
    const nonMasterCatalogBefore = new Map(
      [...baselineCatalog].filter(([table]) => table !== "master_products"),
    );
    const catalogUnchanged = originalRowsUnchanged(nonMasterCatalogBefore, afterCatalog);
    const priorMasterFieldsPreserved = originalRowsChangedOnlyIn(
      baselineCatalog.get("master_products"),
      afterCatalog.get("master_products"),
      new Map(priorHarnessMasters.map(master => [
        master.id,
        new Set(["is_active", "updated_at"]),
      ])),
    );
    record(checks, "all pre-existing rows in the eight commerce tables remain unchanged",
      commerceUnchanged);
    record(checks, "all pre-existing store categories, products, and variants remain unchanged",
      catalogUnchanged);
    record(checks, "all seed Master Products remain unchanged; only the known prior-harness archive statuses may change",
      priorMasterFieldsPreserved);
    report.counts.baselineCommerceTables = baselineCommerce.size;
    report.counts.baselineCatalogTables = baselineCatalog.size;
    const finalMasterCounts = await pool.query(
      `SELECT
         (SELECT count(*)::int FROM public.master_categories WHERE is_active = true) AS active_categories,
         (SELECT count(*)::int FROM public.master_products WHERE is_active = true) AS active_masters,
         (SELECT count(*)::int FROM public.master_products) AS total_masters`,
    );
    report.counts.masterCategoriesAfter = finalMasterCounts.rows[0].active_categories;
    report.counts.masterProductsActiveAfter = finalMasterCounts.rows[0].active_masters;
    report.counts.masterProductsTotalAfter = finalMasterCounts.rows[0].total_masters;
    const expectedActiveAfter = seedCounts.rows[0].active_masters -
      priorHarnessMasters.filter(master => master.is_active).length;
    record(checks, "Master Category seeds and expected archived catalog counts remain intact",
      finalMasterCounts.rows[0].active_categories === expectedCategoryCount &&
      finalMasterCounts.rows[0].active_masters === expectedActiveAfter &&
      finalMasterCounts.rows[0].total_masters === seedCounts.rows[0].total_masters + 1);
    report.passed = checks.every(item => item.passed) &&
      report.cleanup.ownStoreListingDeactivated &&
      report.cleanup.ownListingVariantsRetained &&
      report.cleanup.uniqueMasterArchived;
  } catch (error) {
    if (error?.testProduct) {
      missingProduct = error.testProduct;
      privateScreenshotText.push(missingProduct.name, missingProduct.details);
    }
    if (error?.listingProduct) {
      configuredListing = error.listingProduct;
      privateScreenshotText.push(configuredListing.name);
    }
    report.passed = false;
    const lastFailure = [...checks].reverse().find(check => !check.passed);
    const failureName = error?.failedAssertion ?? lastFailure?.name ?? activeStage;
    if (!checks.some(check => check.name === failureName && !check.passed)) {
      checks.push({ name: failureName, passed: false });
    }
    await captureFailureScreenshot(
      browser, failurePage, artifactDir, report, failureName,
      privateScreenshotText,
    );
    await writeSanitizedReport(artifactDir, report, checks);
    reportWrittenBeforeClose = true;
  } finally {
    if (browser) {
      try {
        if (vendorPage && missingProduct?.created && missingProduct.storeListingCreated) {
          await cleanupOwnListing(browser, vendorPage, missingProduct.name);
        }
        if (vendorPage && configuredListing?.created) {
          const listingInactive = await cleanupOwnListing(browser, vendorPage, configuredListing.name);
          report.cleanup.ownStoreListingDeactivated ||= listingInactive;
          if (listingInactive && configuredListing.productId) {
            const retained = await pool.query(
              "SELECT count(*)::int AS total FROM public.product_variants WHERE product_id = $1",
              [configuredListing.productId],
            );
            report.cleanup.ownListingVariantsRetained ||= retained.rows[0]?.total === 4;
          }
        }
      } catch {}
      try {
        if (missingProduct?.created || priorHarnessMasters.some(master => master.is_active)) {
          if (pool && missingProduct?.created && !missingProduct.masterProductId) {
            const discovered = await pool.query(
              "SELECT id::text FROM public.master_products WHERE name = $1 ORDER BY id",
              [missingProduct.name],
            );
            if (discovered.rowCount === 1) missingProduct.masterProductId = discovered.rows[0].id;
          }
          const cleanup = await cleanupOwnMaster({
            browser,
            page: adminPage,
            dashboardUrl: origin ? new URL("/", origin).href : "",
            adminEmail: accounts?.admin.email,
            adminPassword,
            testProduct: missingProduct,
            priorHarnessMasters,
            checks,
            report,
          });
          adminPage = cleanup.page;
        }
      } catch {}
      if (!missingProduct?.created) report.cleanup.uniqueMasterArchived = true;
      await browser.close();
    }
    if (pool) await Promise.race([pool.end().catch(() => {}), wait(1500)]);
    if (profileDir) await rm(profileDir, { recursive: true, force: true }).catch(() => {});
  }
  report.passed = report.passed && checks.every(item => item.passed) &&
    report.cleanup.ownStoreListingDeactivated &&
    report.cleanup.ownListingVariantsRetained &&
    report.cleanup.uniqueMasterArchived;
  if (!reportWrittenBeforeClose) await writeSanitizedReport(artifactDir, report, checks);
  process.stdout.write(`${await writeSanitizedReport(artifactDir, report, checks)}\n`);
  if (!report.passed) process.exitCode = 1;
}

async function captureInitialVendorScreenshot(browser, page, directory, report, privateText) {
  const name = "vendor-master-catalog-rice.png";
  await captureSanitizedScreenshot(browser, page, directory, report, name, privateText);
}

await dispatch(process.argv, {
  run,
  preflight: readOnlyPreflight,
  root,
  chromePath,
});