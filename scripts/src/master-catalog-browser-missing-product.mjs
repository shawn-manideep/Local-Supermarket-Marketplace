import { randomUUID } from "node:crypto";
import path from "node:path";
import { quote } from "./master-catalog-cdp.mjs";
function check(checks, name, passed) {
  checks.push({ name, passed: Boolean(passed) });
  if (!passed) {
    const error = new Error(name);
    error.failedAssertion = name;
    throw error;
  }
  return Boolean(passed);
}
export async function cleanupOwnListing(browser, page, name) {
  try {
    const row = `Array.from(document.querySelectorAll('.vendor-product-row')).find(e => e.querySelector('.vendor-product-identity-text strong')?.innerText.trim() === ${quote(name)})`;
    if (!await browser.evaluate(page, `${row} != null`)) return false;
    if (await browser.evaluate(page, `${row}?.innerText.includes('Deactivate') ?? false`)) await browser.clickText(page, "Deactivate", row);
    return browser.wait(page, `${row}?.innerText.includes('Publish listing')`, 12000);
  } catch { return false; }
}
export const privacyProbe = `(() => {
  const original = window.fetch;
  window.__catalogVerificationPayloads = [];
  window.fetch = async function(...args) {
    const response = await original.apply(this, args);
    try {
      const url = new URL(typeof args[0] === 'string' ? args[0] : args[0].url, location.href);
      if (url.pathname.startsWith('/api/customer/products') ||
          /^\\/api\\/customer\\/stores\\/[^/]+\\/products(?:\\/|$)/.test(url.pathname)) {
        window.__catalogVerificationPayloads.push({ path: url.pathname, payload: await response.clone().json() });
      }
    } catch {}
    return response;
  };
})();`;

export async function captureFailureScreenshot(browser, page, artifactDir, report, step) {
  if (!page) return false;
  try {
    await browser.evaluate(page, `(() => {
      for (const field of document.querySelectorAll('input,textarea')) {
        if (field.type === 'password' || field.type === 'email' || field.autocomplete.includes('username') || field.tagName === 'TEXTAREA') field.value = '';
      }
    })()`);
    const name = `failure-${step.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}.png`;
    await browser.screenshot(page, path.join(artifactDir, name));
    report.screenshots.push(name);
    return true;
  } catch { return false; }
}

async function capture(browser, page, artifactDir, report, name, fullPage = false) {
  report.screenshots.push(name);
  await browser.screenshot(page, path.join(artifactDir, name), fullPage);
}

async function closeRequestForm(browser, page) {
  try { await browser.clickText(page, "Close form"); } catch { /* The form may already be closed. */ }
}

export async function runVendorMissingProductFlow({
  browser, page, pool, storeId, artifactDir, report, checks, onStage = () => {},
}) {
  const result = { created: false, name: "", masterProductId: "", categoryId: "", archived: false };
  let step = "vendor request form verification";
  try {
    onStage(step);
    await browser.clickText(page, "Can’t find your product?");
    const formProof = await browser.evaluate(page, `(() => {
      const form = document.querySelector('.vendor-master-request');
      const labels = Array.from(form?.querySelectorAll('label') ?? []).map(e => e.innerText.trim());
      const name = Array.from(form?.querySelectorAll('label') ?? []).find(e => e.innerText.trim().startsWith('Product Name'))?.querySelector('input');
      return {
        visible: !!form,
        requiredName: !!name?.required,
        fields: ['Product Name','Brand','Product Details','Description','Image URL'].every(want => labels.some(label => label.startsWith(want))),
        categorySelects: form?.querySelectorAll('select').length ?? -1,
        jsonText: /JSON|attributes/i.test(form?.innerText ?? ''),
        browseFilterEmpty: document.querySelector('#master-category-filter')?.value === '',
      };
    })()`);
    if (formProof.visible) await capture(browser, page, artifactDir, report, "vendor-missing-product-request-form.png");
    check(checks, "vendor request form uses normal fields with no category or JSON input", formProof.visible && formProof.requiredName && formProof.fields && formProof.categorySelects === 0 && !formProof.jsonText && formProof.browseFilterEmpty);

    step = "global Basmati Rice duplicate review";
    onStage(step);
    await browser.fillLabel(page, "Product Name", "Basmati Rice");
    await browser.clickText(page, "Check for duplicates");
    const basmatiReady = await browser.wait(page, "!!document.querySelector('.vendor-duplicate-review')", 20000);
    const basmati = basmatiReady ? await browser.evaluate(page, `(() => {
      const review = document.querySelector('.vendor-duplicate-review');
      const text = review?.innerText ?? '';
      const exact = /Basmati Rice\\s*[·•]\\s*Exact match/i.test(text) || /Basmati Rice[\\s\\S]{0,80}Exact match/i.test(text);
      const create = Array.from(review?.querySelectorAll('button') ?? []).find(e => /Confirm no match & create/i.test(e.innerText));
      const cannotCreate = !review?.querySelector('.vendor-master-confirm input[type="checkbox"]') &&
        /exact match already exists|duplicate cannot be added|duplicates cannot be created/i.test(text) && create?.disabled === true;
      const optionalBlank = Array.from(document.querySelectorAll('.vendor-master-request label')).filter(e => /^(Brand|Product Details)/.test(e.innerText.trim())).every(e => !e.querySelector('input')?.value);
      return { hasCandidate: /Basmati Rice/i.test(text), exact, cannotCreate, optionalBlank };
    })()`) : {};
    if (basmatiReady) await capture(browser, page, artifactDir, report, "vendor-basmati-duplicate-review.png");
    const exactSeed = Boolean(basmati.hasCandidate && basmati.exact && basmati.optionalBlank);
    check(checks, "global duplicate review finds seeded Basmati Rice with brand and details blank", exactSeed);
    check(checks, "exact Basmati identity cannot be confirmed as a new product", Boolean(basmati.cannotCreate));
    if (!basmatiReady || !basmati.exact || !basmati.cannotCreate) {
      await closeRequestForm(browser, page);
      return result;
    }

    step = "unique pending-product duplicate review";
    onStage(step);
    const suffix = randomUUID();
    result.name = `Qorvellan ${suffix}`;
    const riceCategory = await pool.query(
      "SELECT id FROM public.master_categories WHERE name = 'Rice & Grains' AND is_active = true ORDER BY id LIMIT 1",
    );
    if (!riceCategory.rowCount) {
      check(checks, "active Rice & Grains category is available for admin review", false);
      return result;
    }
    result.categoryId = riceCategory.rows[0].id;
    const categoryBefore = await pool.query(
      "SELECT count(*)::int AS total FROM public.master_products WHERE master_category_id = $1",
      [result.categoryId],
    );
    result.categoryProductCountBefore = categoryBefore.rows[0].total;
    await browser.fillLabel(page, "Product Name", result.name);
    await browser.fillLabel(page, "Brand", `Xylomarven ${suffix}`);
    await browser.fillLabel(page, "Product Details", `Trinquillion ${suffix}`);
    await browser.fillLabel(page, "Description", `Zethricwall ${suffix}`);
    await browser.clickText(page, "Check for duplicates");
    const noMatchReady = await browser.wait(page, "!!document.querySelector('.vendor-duplicate-review')", 20000);
    if (!noMatchReady) {
      check(checks, "unique product receives the global no-match review", false);
      await closeRequestForm(browser, page);
      return result;
    }
    const review = await browser.evaluate(page, `(() => {
      const panel = document.querySelector('.vendor-duplicate-review');
      const checkbox = panel?.querySelector('.vendor-master-confirm input[type="checkbox"]');
      const confirm = Array.from(panel?.querySelectorAll('button') ?? []).find(e => /Confirm no match & create/i.test(e.innerText));
      return { none: /No matching product found/i.test(panel?.innerText ?? ''), checked: checkbox?.checked ?? null, disabled: confirm?.disabled ?? null };
    })()`);
    await capture(browser, page, artifactDir, report, "vendor-missing-no-match-review.png");
    check(checks, "unique product has no global matches after duplicate review", review.none);
    if (!review.none) {
      await closeRequestForm(browser, page);
      return result;
    }
    if (review.checked !== false) {
      check(checks, "explicit no-match checkbox starts unchecked", false);
      await closeRequestForm(browser, page);
      return result;
    }
    check(checks, "explicit no-match checkbox starts unchecked", true);
    check(checks, "create action remains disabled until explicit no-match confirmation", review.disabled === true);
    if (review.disabled !== true) {
      await closeRequestForm(browser, page);
      return result;
    }
    step = "unique pending-product UI creation";
    onStage(step);
    await browser.clickSelector(page, ".vendor-master-confirm input[type=checkbox]");
    const explicit = await browser.evaluate(page, "document.querySelector('.vendor-master-confirm input[type=checkbox]')?.checked === true");
    if (!check(checks, "vendor explicitly checks the no-match confirmation", explicit)) return result;
    await browser.clickText(page, "Confirm no match & create");
    const created = await browser.wait(page,
      `document.body.innerText.includes(${quote(`${result.name} was added to My Store. Configure at least one selling option before publishing.`)})`, 20000);
    if (!created) {
      check(checks, "unique master identity and unavailable store draft were created through UI", false);
      return result;
    }
    result.created = true;
    report.counts.uniquePendingMasterCreated = 1;
    check(checks, "unique master identity and unavailable store draft were created through UI", true);

    const masters = await pool.query(
      "SELECT id, master_category_id, is_active FROM public.master_products WHERE name = $1 ORDER BY id",
      [result.name],
    );
    if (masters.rowCount !== 1) throw new Error("unique master row did not persist");
    result.masterProductId = masters.rows[0].id;
    const listings = await pool.query(
      "SELECT id, is_active, master_product_id FROM public.products WHERE store_id = $1 AND master_product_id = $2",
      [storeId, result.masterProductId],
    );
    const variants = listings.rowCount
      ? await pool.query("SELECT id FROM public.product_variants WHERE product_id = $1", [listings.rows[0].id])
      : { rowCount: 0, rows: [] };
    check(checks, "new master is pending classification and active", masters.rows[0].master_category_id === null && masters.rows[0].is_active);
    check(checks, "new pending master has one linked inactive Store B draft and zero variants",
      listings.rowCount === 1 && listings.rows[0].is_active === false && variants.rowCount === 0);
    await browser.fillSelector(page, "#master-product-search", result.name);
    await browser.wait(page, `Array.from(document.querySelectorAll('[data-testid^="card-master-product-"] h3')).some(e => e.innerText.trim() === ${quote(result.name)})`, 15000);
    const pendingUi = await browser.evaluate(page, `Array.from(document.querySelectorAll('[data-testid^="card-master-product-"]')).find(e => e.querySelector('h3')?.innerText.trim() === ${quote(result.name)})?.innerText.match(/New product/i) != null`);
    check(checks, "vendor Master Catalog shows the pending family as New product", pendingUi);
    await capture(browser, page, artifactDir, report, "vendor-missing-product-pending.png");
    return result;
  } catch (cause) {
    if (!checks.some((item) => item.name === step && !item.passed)) checks.push({ name: step, passed: false });
    if (cause && typeof cause === "object") {
      cause.testProduct = result;
      cause.failedAssertion ??= step;
    }
    throw cause;
  }
}
