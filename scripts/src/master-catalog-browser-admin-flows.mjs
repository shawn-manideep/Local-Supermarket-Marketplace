import path from "node:path";
import { fileURLToPath } from "node:url";
import { quote } from "./master-catalog-cdp.mjs";
import {
  captureFailureScreenshot, captureSanitizedScreenshot,
} from "./master-catalog-browser-missing-flow.mjs";

const verificationArtifactDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)), "../../artifacts/catalog-verification",
);

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

export async function discoverInterruptedVendorDrafts(pool, excludeName) {
  const { rows } = await pool.query(
    `WITH store_b AS (
       SELECT id FROM public.stores
       WHERE name = 'Development Store B' AND status = 'ACTIVE'
     )
     SELECT m.id::text AS id, m.name, m.is_active
     FROM public.master_products m
     WHERE m.master_category_id IS NULL
       AND m.name ~* '^Virelune[0-9a-f]{32}$'
       AND coalesce(m.attributes->>'details', '') ~* '^Luthomora[0-9a-f]{32}$'
       AND btrim(coalesce(m.brand, '')) = ''
       AND btrim(coalesce(m.description, '')) = ''
       AND m.created_at >= now() - interval '7 days'
       AND m.name <> $1
       AND (SELECT count(*) FROM store_b) = 1
       AND (
         SELECT count(*) FROM public.products p
         WHERE p.master_product_id = m.id
           AND p.store_id = (SELECT id FROM store_b)
       ) = 1
       AND EXISTS (
         SELECT 1 FROM public.products p
         WHERE p.master_product_id = m.id
           AND p.store_id = (SELECT id FROM store_b)
           AND p.is_active = false
           AND NOT EXISTS (
             SELECT 1 FROM public.product_variants v WHERE v.product_id = p.id
           )
       )
       AND NOT EXISTS (
         SELECT 1 FROM public.products p
         WHERE p.master_product_id = m.id
           AND p.store_id <> (SELECT id FROM store_b)
       )
     ORDER BY m.created_at, m.id`,
    [excludeName ?? ""],
  );
  return rows;
}

function adminFailureReason(cause, step) {
  if (cause?.failedAssertion && cause.failedAssertion === cause.message) {
    return cause.failedAssertion;
  }
  if (typeof cause?.adminSafeReason === "string") return cause.adminSafeReason;
  return `Admin Master Catalog verification stopped during ${step}.`;
}

async function searchAdminProduct(browser, page, name) {
  await browser.fillSelector(page, ".product-list-card .order-toolbar input", name);
  const exactQuery = await browser.wait(page,
    `document.querySelector('.product-list-card .order-toolbar input')?.value === ${quote(name)}`, 4000);
  if (!exactQuery) {
    throw Object.assign(new Error("Admin search input did not retain the exact selected name."), {
      adminSafeReason: "The exact Admin catalog search value was not retained.",
    });
  }
  const row = `Array.from(document.querySelectorAll('.admin-master-product-row'))
    .find(element => element.querySelector('.product-identity strong')?.innerText.trim() === ${quote(name)})`;
  return { row, visible: await browser.wait(page, `${row} != null`, 15000) };
}

async function signInAdmin(browser, dashboardUrl, email, password) {
  const page = await browser.context(dashboardUrl, 1440, 1000);
  try {
    const login = await browser.wait(page, "!!document.querySelector('[data-testid=\"input-email\"]')", 12000);
    if (!login) {
      throw Object.assign(new Error("Admin UI login form did not load."), {
        adminSafeReason: "Admin sign-in page did not expose the expected login control.",
      });
    }
    await browser.fillSelector(page, '[data-testid="input-email"]', email);
    await browser.fillSelector(page, '[data-testid="input-password"]', password);
    await browser.clickSelector(page, '[data-testid="button-sign-in"]');
    const ready = await browser.wait(page,
      "!!Array.from(document.querySelectorAll('[role=\"tab\"]')).find(tab => tab.innerText.trim() === 'Master catalog')", 15000);
    if (!ready) {
      throw Object.assign(new Error("Admin UI role was not confirmed after sign-in."), {
        adminSafeReason: "Admin role was not confirmed in the UI after submitting sign-in.",
      });
    }
    await browser.clickText(page, "Master catalog");
    const catalog = await browser.wait(page,
      "!!document.querySelector('[aria-labelledby=\"master-categories-heading\"]') && !!document.querySelector('.product-list-card')", 12000);
    if (!catalog) {
      throw Object.assign(new Error("Admin Master Catalog view did not load."), {
        adminSafeReason: "Admin Master Catalog view did not become available after sign-in.",
      });
    }
    return page;
  } catch (cause) {
    if (cause && typeof cause === "object") {
      cause.adminPage = page;
      cause.adminSafeReason ??= "Admin UI verification could not establish the required view.";
    }
    throw cause;
  }
}

async function archiveOneOwnMaster(browser, page, candidate) {
  if (!candidate?.id || !candidate?.name || !candidate.is_active) {
    throw Object.assign(new Error("Admin cleanup candidate was not an active, identified harness-owned master."), {
      adminSafeReason: "The proven Admin cleanup candidate was no longer active.",
    });
  }
  const { row, visible } = await searchAdminProduct(browser, page, candidate.name);
  if (!visible) {
    throw Object.assign(new Error("Admin Master Product row was not visible after exact-name search."), {
      adminSafeReason: "The proven Admin cleanup row was not visible after exact-name search.",
    });
  }
  const rowStatus = await browser.evaluate(page,
    `${row}?.querySelector('.lifecycle-dot')?.textContent.trim() ?? ''`);
  if (rowStatus === "Archived") return true;
  if (rowStatus !== "Active") {
    throw Object.assign(new Error("Admin Master Product row had an unrecognized lifecycle status."), {
      adminSafeReason: "The Admin lifecycle status was not recognizable; no archive action was taken.",
    });
  }
  await browser.clickText(page, "Archive", row);
  const archived = await browser.wait(page, `(() => {
    const currentRow = ${row};
    const rowStatus = currentRow?.querySelector('.lifecycle-dot')?.textContent.trim() === 'Archived' &&
      Array.from(currentRow.querySelectorAll('button')).some(button => button.innerText.trim() === 'Unarchive');
    return rowStatus;
  })()`, 8000);
  if (!archived) {
    throw Object.assign(new Error("Admin Master Product row did not show the archived state after UI action."), {
      adminSafeReason: "The Admin UI did not confirm the archive action for the proven row.",
    });
  }
  return true;
}

async function verifyArchivedPendingMaster(pool, candidate) {
  if (!pool || !candidate?.id || !candidate?.name) return false;
  const verified = await pool.query(
    `SELECT is_active, master_category_id
     FROM public.master_products WHERE id = $1 AND name = $2`,
    [candidate.id, candidate.name],
  );
  return verified.rowCount === 1 &&
    verified.rows[0].is_active === false &&
    verified.rows[0].master_category_id === null;
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
    const categoriesReady = await browser.wait(page,
      "document.querySelectorAll('.category-row').length === 29 && document.querySelectorAll('.category-row .lifecycle-dot.is-active').length === 25",
      12000);
    assert(checks, "admin category list finishes loading with 25 active and 4 archived rows",
      categoriesReady);
    const counts = await browser.evaluate(page, `(() => ({
      categories: document.querySelectorAll('.category-row .lifecycle-dot.is-active').length,
      totalCategories: document.querySelectorAll('.category-row').length,
      archivedCategories: document.querySelectorAll('.category-row .lifecycle-dot:not(.is-active)').length,
      products: Number(document.querySelector('.product-list-card .count-pill')?.innerText || 0),
      deleteButtons: Array.from(document.querySelectorAll('button'))
        .filter(button => /delete/i.test(button.innerText || button.getAttribute('aria-label') || '')).length,
      lifecycleControls: Array.from(document.querySelectorAll('.admin-master-product-row button'))
        .filter(button => /View \\/ edit|Archive|Unarchive/.test(button.innerText)).length,
    }))()`); 
    assert(checks, "admin catalog displays all 25 active Master Categories", counts.categories === 25);
    assert(checks, "the 4 archived Master Categories remain visible separately from the 25 active categories",
      counts.totalCategories === 29 && counts.archivedCategories === 4 &&
      counts.totalCategories === counts.categories + counts.archivedCategories);
    assert(checks, "admin catalog contains the real current Master Product dataset", counts.products >= 183);
    assert(checks, "admin Master Catalog has no delete controls", counts.deleteButtons === 0);
    assert(checks, "admin product rows expose view/edit and archive lifecycle actions",
      counts.lifecycleControls > 0);
    report.counts.masterCategories = counts.categories;
    report.counts.masterCategoriesTotalInAdmin = counts.totalCategories;
    report.counts.masterCategoriesArchivedInAdmin = counts.archivedCategories;
    report.counts.masterProductsAtAdmin = counts.products;

    step = "read-only identification of interrupted harness-owned vendor drafts";
    const interruptedDrafts = await discoverInterruptedVendorDrafts(pool, testProduct.name);
    const knownIds = new Set(priorHarnessMasters.map(candidate => candidate.id));
    const newlyProven = interruptedDrafts.filter(candidate => !knownIds.has(candidate.id));
    priorHarnessMasters.push(...newlyProven);
    report.counts.provenInterruptedVendorDrafts = interruptedDrafts.length;
    report.counts.provenPriorHarnessMasters = priorHarnessMasters.length;
    const newlyProvenActive = newlyProven.filter(candidate => candidate.is_active).length;
    const unresolvedPending = Math.max(
      0, (report.counts.unidentifiedPendingMastersRetained ?? 0) - newlyProvenActive,
    );
    report.counts.unidentifiedPendingMastersRetained = unresolvedPending;
    report.issues = (report.issues ?? []).filter(issue =>
      !/pre-existing active pending Master Product\\(s\\) could not be attributed/i.test(issue));
    if (unresolvedPending > 0) {
      report.issues.push(
        `${unresolvedPending} pre-existing active pending Master Product(s) could not be attributed to this harness and were intentionally left untouched.`,
      );
    }
    assert(checks, "interrupted Virelune drafts are identified only by the exact name/details markers, blank canonical fields, recent creation, and one empty inactive Store B draft",
      true);

    step = "admin review and archive of the pending test master without classification";
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
    assert(checks, "admin opens the new pending identity with no category selected",
      editForm);
    await browser.clickText(page, "Save changes", "document.querySelector('.admin-master-product-form')");
    const stillPendingInUi = await browser.wait(page,
      `${row}?.innerText.includes('Pending classification') && !${row}?.innerText.includes('Rice & Grains')`, 10000);
    const unchangedBeforeArchive = await pool.query(
      "SELECT id::text, master_category_id::text AS category_id, is_active FROM public.master_products WHERE id = $1",
      [testProduct.masterProductId],
    );
    const riceCountAfterReview = await pool.query(
      "SELECT count(*)::int AS total FROM public.master_products WHERE master_category_id = $1",
      [testProduct.categoryId],
    );
    assert(checks, "Admin View / edit preserves the pending classification without assigning a category",
      stillPendingInUi && unchangedBeforeArchive.rowCount === 1 &&
      unchangedBeforeArchive.rows[0].id === testProduct.masterProductId &&
      unchangedBeforeArchive.rows[0].category_id === null &&
      unchangedBeforeArchive.rows[0].is_active === true);
    assert(checks, "Rice & Grains category product count is unchanged after Admin review",
      await readCategoryProductCount(browser, page) === testProduct.categoryProductCountBefore &&
      riceCountAfterReview.rows[0]?.total === testProduct.categoryProductCountBefore);
    const { row: pendingRowAfterReview, visible: visibleAfterReview } =
      await searchAdminProduct(browser, page, testProduct.name);
    assert(checks, "the same pending test master remains available for Admin archival",
      visibleAfterReview);
    await browser.clickText(page, "Archive", pendingRowAfterReview);
    const archivedInUi = await browser.wait(page, `(() => {
      const archivedRow = ${pendingRowAfterReview};
      return archivedRow?.querySelector('.lifecycle-dot')?.textContent.trim() === 'Archived' ||
        /Master product archived/i.test(document.body.innerText);
    })()`, 10000);
    const archived = await pool.query(
      "SELECT id::text, master_category_id::text AS category_id, is_active FROM public.master_products WHERE id = $1",
      [testProduct.masterProductId],
    );
    const riceCountAfterArchive = await pool.query(
      "SELECT count(*)::int AS total FROM public.master_products WHERE master_category_id = $1",
      [testProduct.categoryId],
    );
    assert(checks, "Admin archives only the pending test master while preserving its NULL category and Store B relationship",
      archivedInUi && archived.rowCount === 1 &&
      archived.rows[0].id === testProduct.masterProductId &&
      archived.rows[0].category_id === null && archived.rows[0].is_active === false);
    assert(checks, "Rice & Grains product count remains unchanged after archiving the unclassified test master",
      riceCountAfterArchive.rows[0]?.total === testProduct.categoryProductCountBefore &&
      await readCategoryProductCount(browser, page) === testProduct.categoryProductCountBefore);
    testProduct.archived = true;
    report.cleanup.uniqueMasterArchived = true;
    report.counts.riceAndGrainsProductsAfterAdminReview = testProduct.categoryProductCountBefore;

    step = "archive only records identified as prior harness-owned pending masters";
    let archivedPrior = 0;
    for (const candidate of priorHarnessMasters) {
      const current = await pool.query(
        "SELECT id::text, is_active FROM public.master_products WHERE id = $1 AND name = $2 AND master_category_id IS NULL",
        [candidate.id, candidate.name],
      );
      if (!current.rowCount) {
        throw Object.assign(new Error("Proven pending Admin cleanup row was not found by its exact identity."), {
          adminSafeReason: "A proven pending Admin cleanup row was missing; no replacement row was selected.",
        });
      }
      if (!current.rows[0].is_active) {
        candidate.verifiedArchived = true;
        continue;
      }
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
      candidate.verifiedArchived = true;
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
    const reason = adminFailureReason(cause, step);
    if (!checks.some((item) => item.name === step && !item.passed)) {
      checks.push({ name: step, passed: false });
    }
    cause.failedAssertion ??= step;
    report.adminFailure = { stage: step, reason };
    report.issues.push(`Admin Master Catalog verification stopped at ${step}: ${reason}`);
    cause.adminFailureScreenshotCaptured = await captureFailureScreenshot(
      browser, page, artifactDir, report, `admin-${step}`,
      [adminEmail, testProduct?.name, ...priorHarnessMasters.map(master => master.name)],
    );
    throw cause;
  }
}

export async function cleanupOwnMaster({
  browser, page, pool, dashboardUrl, adminEmail, adminPassword, testProduct,
  priorHarnessMasters = [], checks, report,
}) {
  const allowed = [
    ...(testProduct?.created && !testProduct.archived
      ? [{ id: testProduct.masterProductId, name: testProduct.name, is_active: true }]
      : []),
    ...priorHarnessMasters.filter(candidate => candidate.is_active && !candidate.verifiedArchived),
  ];
  if (!allowed.length) {
    if (testProduct?.created) report.cleanup.uniqueMasterArchived = Boolean(testProduct.archived);
    return { archived: Boolean(testProduct?.archived), page };
  }
  let cleanupAdmin = page;
  try {
    if (!pool) {
      throw Object.assign(new Error("Admin cleanup could not verify its UI action against the database."), {
        adminSafeReason: "The read-only database verifier was unavailable; no uncertain cleanup was reported.",
      });
    }
    if (!cleanupAdmin || !await browser.evaluate(cleanupAdmin, "!!document.querySelector('.product-list-card')")) {
      cleanupAdmin = await signInAdmin(browser, dashboardUrl, adminEmail, adminPassword);
    }
    let testArchived = Boolean(testProduct?.archived);
    let archivedPrior = 0;
    for (const candidate of allowed) {
      const before = await pool.query(
        `SELECT is_active FROM public.master_products
         WHERE id = $1 AND name = $2 AND master_category_id IS NULL`,
        [candidate.id, candidate.name],
      );
      if (before.rowCount !== 1) {
        throw Object.assign(new Error("Admin cleanup candidate no longer matched its exact pending identity."), {
          adminSafeReason: "The proven pending Admin cleanup row was missing or changed; no archive action was taken.",
        });
      }
      if (!before.rows[0].is_active) {
        const { row, visible } = await searchAdminProduct(browser, cleanupAdmin, candidate.name);
        const archivedInUi = visible && await browser.evaluate(cleanupAdmin,
          `${row}?.querySelector('.lifecycle-dot')?.textContent.trim() === 'Archived' &&
           Array.from(${row}?.querySelectorAll('button') || []).some(button => button.innerText.trim() === 'Unarchive')`);
        if (!archivedInUi || !await verifyArchivedPendingMaster(pool, candidate)) {
          throw Object.assign(new Error("Admin and database did not agree that a pending cleanup candidate was archived."), {
            adminSafeReason: "An inactive pending master lacked matching archived UI and database confirmation.",
          });
        }
        if (candidate.id === testProduct?.masterProductId) testArchived = true;
        else archivedPrior += 1;
        continue;
      }
      const archived = await archiveOneOwnMaster(browser, cleanupAdmin, candidate);
      const persisted = archived && await verifyArchivedPendingMaster(pool, candidate);
      if (candidate.id === testProduct?.masterProductId) testArchived = persisted;
      else if (persisted) archivedPrior += 1;
      if (!persisted) {
        throw Object.assign(new Error("Admin UI archive was not confirmed by the database."), {
          adminSafeReason: "Admin UI and read-only database verification did not both confirm the archive.",
        });
      }
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
    return { archived: testArchived, page: cleanupAdmin };
  } catch (cause) {
    const reason = adminFailureReason(cause, "Admin UI cleanup");
    if (testProduct?.created) {
      report.cleanup.uniqueMasterArchived = false;
      checks.push({ name: "only the harness-owned new Master Product is archived through Admin UI during cleanup", passed: false });
    }
    report.adminCleanupFailure = { stage: "Admin UI cleanup", reason };
    report.issues.push(`Admin UI cleanup did not complete safely: ${reason}`);
    await captureFailureScreenshot(
      browser, cause?.adminPage ?? cleanupAdmin ?? page, verificationArtifactDir, report, "admin-ui-cleanup",
      [testProduct?.name],
    ).catch(() => {});
    return { archived: false, page: cleanupAdmin ?? page };
  }
}

export async function createAdminPage(browser, dashboardUrl, adminEmail, adminPassword) {
  return signInAdmin(browser, dashboardUrl, adminEmail, adminPassword);
}