import path from "node:path";
import { quote } from "./master-catalog-cdp.mjs";
import { captureSanitizedScreenshot } from "./master-catalog-browser-missing-flow.mjs";

function assert(checks, name, passed) {
  checks.push({ name, passed: Boolean(passed) });
  if (!passed) {
    const error = new Error(name);
    error.failedAssertion = name;
    throw error;
  }
  return Boolean(passed);
}

async function readCategoryProductCount(browser, page) {
  return browser.evaluate(page, `(() => {
    const row = Array.from(document.querySelectorAll('.category-row'))
      .find(element => element.querySelector('strong')?.innerText.trim() === 'Rice & Grains');
    return Number(row?.innerText.match(/(\\d+) master products/i)?.[1] ?? -1);
  })()`);
}

async function searchAdminProduct(browser, page, name) {
  await browser.fillSelector(page, ".order-toolbar input", name);
  const row = `Array.from(document.querySelectorAll('.admin-master-product-row'))
    .find(element => element.querySelector('.product-identity strong')?.innerText.trim() === ${quote(name)})`;
  return { row, visible: await browser.wait(page, `${row} != null`, 10000) };
}

async function signInAdmin(browser, dashboardUrl, email, password) {
  const page = await browser.context(dashboardUrl, 1440, 1000);
  const login = await browser.wait(page, "!!document.querySelector('[data-testid=\"input-email\"]')", 12000);
  if (!login) throw new Error("Admin UI login form did not load.");
  await browser.fillSelector(page, '[data-testid="input-email"]', email);
  await browser.fillSelector(page, '[data-testid="input-password"]', password);
  await browser.clickSelector(page, '[data-testid="button-sign-in"]');
  const ready = await browser.wait(page,
    "!!Array.from(document.querySelectorAll('[role=\"tab\"]')).find(tab => tab.innerText.trim() === 'Master catalog')", 15000);
  if (!ready) throw new Error("Admin UI session did not load.");
  await browser.clickText(page, "Master catalog");
  const catalog = await browser.wait(page,
    "!!document.querySelector('[aria-labelledby=\"master-categories-heading\"]') && !!document.querySelector('.product-list-card')", 12000);
  if (!catalog) throw new Error("Admin Master Catalog view did not load.");
  return page;
}

async function archiveOneOwnMaster(browser, page, candidate) {
  if (!candidate?.id || !candidate?.name || !candidate.is_active) return false;
  const { row, visible } = await searchAdminProduct(browser, page, candidate.name);
  if (!visible) return false;
  const rowActive = await browser.evaluate(page, `${row}?.querySelector('.lifecycle-dot')?.innerText.trim() === 'Active'`);
  if (!rowActive) return true;
  await browser.clickText(page, "Archive", row);
  return browser.wait(page, `${row}?.innerText.includes('Archived') && ${row}?.innerText.includes('Unarchive')`, 8000);
}

export async function runAdminMasterCatalogFlow({
  browser, page, pool, testProduct, priorHarnessMasters, dashboardUrl, adminEmail, adminPassword,
  artifactDir, report, checks,
}) {
  let step = "admin Master Catalog safety view";
  try {
    const loaded = await browser.wait(page,
      "!!document.querySelector('[aria-labelledby=\"master-categories-heading\"]') && !!document.querySelector('.product-list-card')", 12000);
    assert(checks, "admin Master Catalog management view is loaded", loaded);
    const counts = await browser.evaluate(page, `(() => ({
      categories: Number(document.querySelector('[aria-labelledby="master-categories-heading"] .count-pill')?.innerText || 0),
      products: Number(document.querySelector('.product-list-card .count-pill')?.innerText || 0),
      deleteButtons: Array.from(document.querySelectorAll('button'))
        .filter(button => /delete/i.test(button.innerText || button.getAttribute('aria-label') || '')).length,
      lifecycleControls: Array.from(document.querySelectorAll('.admin-master-product-row button'))
        .filter(button => /View \\/ edit|Archive|Unarchive/.test(button.innerText)).length,
    }))()`); 
    assert(checks, "admin catalog displays all 25 active Master Categories", counts.categories === 25);
    assert(checks, "admin catalog contains the real current Master Product dataset", counts.products >= 183);
    assert(checks, "admin Master Catalog has no delete controls", counts.deleteButtons === 0);
    assert(checks, "admin product rows expose view/edit and archive lifecycle actions",
      counts.lifecycleControls > 0);
    report.counts.masterCategories = counts.categories;
    report.counts.masterProductsAtAdmin = counts.products;

    step = "admin classification and archival of the UI-created pending master";
    const pending = await pool.query(
      `SELECT id::text, master_category_id::text AS category_id, is_active
       FROM public.master_products WHERE id = $1`,
      [testProduct.masterProductId],
    );
    assert(checks, "newly created Master Product is the same pending active row tracked read-only",
      pending.rowCount === 1 && pending.rows[0].category_id === null && pending.rows[0].is_active === true);
    const { row, visible } = await searchAdminProduct(browser, page, testProduct.name);
    assert(checks, "Admin Pending classification row is found by the harness-owned exact name", visible);
    const pendingLabel = await browser.evaluate(page,
      `${row}?.innerText.includes('Pending classification') ?? false`);
    assert(checks, "new missing-product identity appears in admin as Pending classification",
      pendingLabel);
    const rowCategoryBefore = await readCategoryProductCount(browser, page);
    assert(checks, "Rice & Grains admin product count is available before classification",
      rowCategoryBefore === testProduct.categoryProductCountBefore);
    await browser.clickText(page, "View / edit", row);
    const editForm = await browser.wait(page, `document.querySelector('.admin-master-product-form select')?.value === '' &&
      document.querySelector('.admin-master-product-form input')?.value === ${quote(testProduct.name)}`, 8000);
    assert(checks, "admin opens the new pending identity without changing its master record",
      editForm);
    await browser.selectSelector(page, ".admin-master-product-form select", testProduct.categoryId);
    await browser.clickText(page, "Save changes", "document.querySelector('.admin-master-product-form')");
    const assignedInUi = await browser.wait(page,
      `${row}?.innerText.includes('Rice & Grains') && !${row}?.innerText.includes('Pending classification')`, 10000);
    assert(checks, "admin UI assigns the pending master to active Rice & Grains",
      assignedInUi && await readCategoryProductCount(browser, page) === testProduct.categoryProductCountBefore + 1);
    const classified = await pool.query(
      "SELECT id::text, master_category_id::text AS category_id, is_active FROM public.master_products WHERE id = $1",
      [testProduct.masterProductId],
    );
    assert(checks, "admin classification retains the same Master Product ID and activates the category mapping",
      classified.rowCount === 1 && classified.rows[0].id === testProduct.masterProductId &&
      classified.rows[0].category_id === testProduct.categoryId && classified.rows[0].is_active === true);
    await browser.clickText(page, "Archive", row);
    const archivedInUi = await browser.wait(page,
      `${row}?.innerText.includes('Archived') && ${row}?.innerText.includes('Unarchive')`, 8000);
    const archived = await pool.query(
      "SELECT master_category_id::text AS category_id, is_active FROM public.master_products WHERE id = $1",
      [testProduct.masterProductId],
    );
    assert(checks, "admin archives only the new test master while preserving its category and relationships",
      archivedInUi && archived.rowCount === 1 && archived.rows[0].category_id === testProduct.categoryId &&
      archived.rows[0].is_active === false);
    testProduct.archived = true;
    report.cleanup.uniqueMasterArchived = true;
    report.counts.riceAndGrainsProductsAfterClassification = testProduct.categoryProductCountBefore + 1;

    step = "archive only records identified as prior harness-owned pending masters";
    let archivedPrior = 0;
    for (const candidate of priorHarnessMasters) {
      const current = await pool.query(
        "SELECT id::text, is_active FROM public.master_products WHERE id = $1 AND name = $2 AND master_category_id IS NULL",
        [candidate.id, candidate.name],
      );
      if (!current.rowCount || !current.rows[0].is_active) continue;
      const archivedByUi = await archiveOneOwnMaster(browser, page, candidate);
      assert(checks, "a prior harness-owned pending master is archived only through Admin UI",
        archivedByUi);
      const verified = await pool.query(
        "SELECT is_active, master_category_id FROM public.master_products WHERE id = $1",
        [candidate.id],
      );
      assert(checks, "prior harness cleanup preserves the pending master row without deletion",
        verified.rowCount === 1 && verified.rows[0].is_active === false &&
        verified.rows[0].master_category_id === null);
      archivedPrior += 1;
    }
    report.cleanup.priorHarnessMastersArchived = archivedPrior;
    report.counts.priorHarnessMasterCandidates = priorHarnessMasters.length;
    report.counts.priorHarnessMastersArchived = archivedPrior;
    const deletesAfter = await browser.evaluate(page,
      "Array.from(document.querySelectorAll('button')).filter(button => /delete/i.test(button.innerText || button.getAttribute('aria-label') || '')).length");
    assert(checks, "Admin Master Categories and Master Products expose no DELETE buttons",
      deletesAfter === 0);
    report.screenshots.push("admin-master-catalog-lifecycle.png");
    await captureSanitizedScreenshot(
      browser, page, artifactDir, report, "admin-master-catalog-lifecycle.png",
      [testProduct.name, ...priorHarnessMasters.map(master => master.name)],
      true,
    );
    return { page, archivedPrior };
  } catch (cause) {
    if (!checks.some((item) => item.name === step && !item.passed)) {
      checks.push({ name: step, passed: false });
    }
    cause.failedAssertion ??= step;
    throw cause;
  }
}

export async function cleanupOwnMaster({
  browser, page, dashboardUrl, adminEmail, adminPassword, testProduct,
  priorHarnessMasters = [], checks, report,
}) {
  const allowed = [
    ...(testProduct?.created && !testProduct.archived
      ? [{ id: testProduct.masterProductId, name: testProduct.name, is_active: true }]
      : []),
    ...priorHarnessMasters.filter(candidate => candidate.is_active),
  ];
  if (!allowed.length) {
    if (testProduct?.created) report.cleanup.uniqueMasterArchived = Boolean(testProduct.archived);
    return { archived: Boolean(testProduct?.archived), page };
  }
  try {
    let admin = page;
    if (!admin || !await browser.evaluate(admin, "!!document.querySelector('.product-list-card')")) {
      admin = await signInAdmin(browser, dashboardUrl, adminEmail, adminPassword);
    }
    let testArchived = Boolean(testProduct?.archived);
    let archivedPrior = 0;
    for (const candidate of allowed) {
      const current = await browser.evaluate(admin,
        `Array.from(document.querySelectorAll('.admin-master-product-row')).find(element =>
          element.querySelector('.product-identity strong')?.innerText.trim() === ${quote(candidate.name)})?.innerText.includes('Unarchive') ?? false`);
      if (current) {
        if (candidate.id === testProduct?.masterProductId) testArchived = true;
        else archivedPrior += 1;
        continue;
      }
      const archived = await archiveOneOwnMaster(browser, admin, candidate);
      if (candidate.id === testProduct?.masterProductId) testArchived = archived;
      else if (archived) archivedPrior += 1;
    }
    if (testProduct?.created) {
      testProduct.archived = testArchived;
      report.cleanup.uniqueMasterArchived = testArchived;
      checks.push({ name: "only the harness-owned new Master Product is archived through Admin UI during cleanup", passed: testArchived });
    }
    report.cleanup.priorHarnessMastersArchived = Math.max(
      report.cleanup.priorHarnessMastersArchived ?? 0, archivedPrior,
    );
    report.counts.priorHarnessMastersArchived =
      report.cleanup.priorHarnessMastersArchived;
    return { archived: testArchived, page: admin };
  } catch {
    if (testProduct?.created) {
      report.cleanup.uniqueMasterArchived = false;
      checks.push({ name: "only the harness-owned new Master Product is archived through Admin UI during cleanup", passed: false });
    }
    return { archived: false, page };
  }
}

export async function createAdminPage(browser, dashboardUrl, adminEmail, adminPassword) {
  return signInAdmin(browser, dashboardUrl, adminEmail, adminPassword);
}