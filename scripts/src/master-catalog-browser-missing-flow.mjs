import { randomUUID } from "node:crypto";
import path from "node:path";
import { quote } from "./master-catalog-cdp.mjs";

function assert(checks, name, passed) {
  checks.push({ name, passed: Boolean(passed) });
  if (!passed) {
    const error = new Error(name);
    error.failedAssertion = name;
    throw error;
  }
  return Boolean(passed);
}

async function redactScreenshotState(browser, page, privateText = []) {
  return browser.evaluate(page, `(() => {
    const fields = Array.from(document.querySelectorAll('input,textarea'));
    const originalFields = [];
    fields.forEach((field, index) => {
      if (field.type === 'password' || field.type === 'email' ||
          /username|email/i.test([
            field.autocomplete, field.name, field.id,
            field.getAttribute('data-testid'), field.getAttribute('aria-label'),
          ].filter(Boolean).join(' '))) {
        originalFields.push([index, field.value]);
        field.value = '';
      }
      if (/selling-variant-[0-9]+-(?:sku|external-code)/i.test(field.getAttribute('data-testid') || '')) {
        originalFields.push([index, field.value]);
        field.value = '[redacted vendor code]';
      }
    });
    const privateValues = ${quote(privateText)}.filter(Boolean);
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const originalText = [];
    let node;
    let index = 0;
    while ((node = walker.nextNode())) {
      const original = node.nodeValue;
      let redacted = original;
      for (const value of privateValues) {
        if (redacted.includes(value)) redacted = redacted.split(value).join('[QA test product]');
      }
      redacted = redacted.replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[redacted account]');
      if (redacted !== original) {
        originalText.push([index, original]);
        node.nodeValue = redacted;
      }
      index += 1;
    }
    fields.forEach((field, fieldIndex) => {
      for (const value of privateValues) {
        if (!field.value.includes(value)) continue;
        if (!originalFields.some(([savedIndex]) => savedIndex === fieldIndex)) {
          originalFields.push([fieldIndex, field.value]);
        }
        field.value = '[QA test product]';
      }
      if (/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i.test(field.value)) {
        if (!originalFields.some(([savedIndex]) => savedIndex === fieldIndex)) {
          originalFields.push([fieldIndex, field.value]);
        }
        field.value = field.value.replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[redacted account]');
      }
    });
    return { fields: originalFields, text: originalText };
  })()`);
}

async function restoreScreenshotState(browser, page, original) {
  if (!original) return;
  await browser.evaluate(page, `(() => {
    const saved = ${quote(original)};
    const fields = Array.from(document.querySelectorAll('input,textarea'));
    for (const [index, value] of saved.fields || []) {
      if (fields[index]) fields[index].value = value;
    }
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let node;
    let index = 0;
    while ((node = walker.nextNode())) {
      const previous = (saved.text || []).find(([savedIndex]) => savedIndex === index);
      if (previous) node.nodeValue = previous[1];
      index += 1;
    }
  })()`);
}

export async function captureSanitizedScreenshot(browser, page, artifactDir, report, filename, privateText = [], fullPage = false) {
  const original = await redactScreenshotState(browser, page, privateText);
  try {
    await browser.screenshot(page, path.join(artifactDir, filename), fullPage);
  } finally {
    await restoreScreenshotState(browser, page, original);
  }
  if (!report.screenshots.includes(filename)) report.screenshots.push(filename);
}

export async function captureFailureScreenshot(browser, page, artifactDir, report, stageName, privateText = []) {
  if (!browser || !page) return false;
  try {
    const filename = `failure-${stageName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}.png`;
    await captureSanitizedScreenshot(browser, page, artifactDir, report, filename, privateText);
    return true;
  } catch {
    return false;
  }
}

export async function cleanupOwnListing(browser, page, name) {
  if (!browser || !page || !name) return false;
  try {
    const row = `Array.from(document.querySelectorAll('.vendor-product-row')).find(e => e.querySelector('.vendor-product-identity-text strong')?.innerText.trim() === ${quote(name)})`;
    if (!await browser.evaluate(page, `${row} != null`)) return false;
    if (await browser.evaluate(page, `${row}?.innerText.includes('Deactivate') ?? false`)) {
      await browser.clickText(page, "Deactivate", row);
    }
    return await browser.wait(page, `${row}?.innerText.includes('Configure & publish') ?? false`, 6000);
  } catch {
    return false;
  }
}

export const privacyProbe = `(() => {
  const originalFetch = window.fetch;
  window.__catalogVerificationPayloads = [];
  window.__catalogVerificationCartWrites = 0;
  window.fetch = async function(...args) {
    const response = await originalFetch.apply(this, args);
    try {
      const request = args[0];
      const url = new URL(typeof request === 'string' ? request : request.url, location.href);
      const method = String(args[1]?.method || request?.method || 'GET').toUpperCase();
      if (/^\\/api\\/customer\\/(?:cart|checkout|orders)(?:\\/|$)/.test(url.pathname) && method !== 'GET') {
        window.__catalogVerificationCartWrites += 1;
      }
      if (method === 'GET' && (
        url.pathname === '/api/customer/products' ||
        /^\\/api\\/customer\\/stores\\/[^/]+\\/products(?:\\/|$)/.test(url.pathname)
      )) {
        const payload = await response.clone().json();
        window.__catalogVerificationPayloads.push({ path: url.pathname, payload });
      }
    } catch {}
    return response;
  };
})();`;

async function clickMissingProductButton(browser, page) {
  const expression = `Array.from(document.querySelectorAll('button')).find(e =>
    /can't find|can’t find|add new product/i.test((e.innerText || '').trim()))`;
  await browser.clickAt(page, await browser.rect(page, expression, true));
}

async function findReview(browser, page, expectedText, timeout = 15000) {
  return browser.wait(page, `(() => {
    const review = document.querySelector('.vendor-duplicate-review,[data-testid="duplicate-review"]');
    return !!review && review.innerText.toLowerCase().includes(${quote(expectedText.toLowerCase())});
  })()`, timeout);
}

export async function runVendorMissingProductFlow({
  browser, page, pool, storeId, artifactDir, report, checks, onStage = () => {},
}) {
  const suffix = randomUUID().replaceAll("-", "");
  const result = {
    created: false,
    name: `Virelune${suffix}`,
    details: `Luthomora${randomUUID().replaceAll("-", "")}`,
    masterProductId: "",
    categoryId: "",
    archived: false,
    storeListingCreated: false,
  };
  let step = "missing product search";
  try {
    onStage(step);
    await browser.fillSelector(page, "#master-product-search", result.name);
    const noSearchMatch = await browser.wait(page, `!document.querySelector('.vendor-master-skeleton') &&
       Array.from(document.querySelectorAll('.vendor-empty-state strong'))
         .some(element => element.innerText.trim() === 'No matching product found.')`, 12000);
    const noResultCount = await browser.evaluate(page,
      "document.querySelectorAll('[data-testid^=\"card-master-product-\"]').length");
    assert(checks, "a fresh unlisted product search returns no Master Catalog match", noSearchMatch && noResultCount === 0);

    step = "missing product form review";
    onStage(step);
    await clickMissingProductButton(browser, page);
    const formVisible = await browser.wait(page,
      "!!document.querySelector('.vendor-master-request')", 8000);
    const formProof = formVisible ? await browser.evaluate(page, `(() => {
      const form = document.querySelector('.vendor-master-request');
      const labels = Array.from(form.querySelectorAll('label')).map(label => label.innerText.trim());
      const name = Array.from(form.querySelectorAll('label')).find(label => /^Product Name/i.test(label.innerText))?.querySelector('input');
      const hasNormalFields = ['Product Name', 'Brand', 'Product Details', 'Description']
        .every(label => labels.some(item => item.toLowerCase().startsWith(label.toLowerCase()))) &&
        labels.some(item => /^Image URL/i.test(item));
      const jargon = /canonical identity|platform identity|discovery json|json attributes|\bjson\b/i.test(form.innerText);
      return {
        requiredName: !!name?.required,
        hasNormalFields,
        categoryControls: form.querySelectorAll('select').length,
        jsonControls: Array.from(form.querySelectorAll('input,textarea')).filter(control =>
          /json|attribute/i.test([
            control.getAttribute('aria-label'), control.name, control.placeholder,
          ].filter(Boolean).join(' '))).length,
        jargon,
      };
    })()`) : {};
    assert(checks, "Add New Product uses ordinary grocery fields with no category or JSON input",
      formVisible && formProof.requiredName && formProof.hasNormalFields &&
      formProof.categoryControls === 0 && formProof.jsonControls === 0 && !formProof.jargon);

    step = "global duplicate prevention";
    onStage(step);
    await browser.fillLabel(page, "Product Name", "Basmati Rice");
    await browser.clickText(page, "Check for duplicates");
    const duplicateReady = await findReview(browser, page, "basmati rice", 15000);
    const duplicateProof = duplicateReady ? await browser.evaluate(page, `(() => {
      const panel = document.querySelector('.vendor-duplicate-review,[data-testid="duplicate-review"]');
      const text = panel?.innerText || '';
      const exact = /Basmati Rice\\s*[·•]\\s*Exact match/i.test(text) ||
        /Basmati Rice[\\s\\S]{0,100}Exact match/i.test(text);
      const confirmation = panel?.querySelector('input[type="checkbox"]');
      const create = Array.from(panel?.querySelectorAll('button') || []).find(button =>
        /confirm no match|create/i.test(button.innerText));
      const optionalFieldsBlank = Array.from(document.querySelectorAll('.vendor-master-request label'))
        .filter(label => /^(Brand|Product Details)/i.test(label.innerText.trim()))
        .every(label => !label.querySelector('input')?.value);
      return {
        exact,
        duplicateCannotBeConfirmedAsNew: !confirmation && create?.disabled === true &&
          /exact match already exists|duplicate cannot be added|duplicates cannot be created/i.test(text),
        optionalFieldsBlank,
      };
    })()`) : {};
    assert(checks, "global duplicate review identifies the seeded exact Basmati Rice identity",
      duplicateReady && duplicateProof.exact && duplicateProof.optionalFieldsBlank);
    assert(checks, "an exact existing product cannot be confirmed as a duplicate new identity",
      duplicateProof.duplicateCannotBeConfirmedAsNew);
    await captureSanitizedScreenshot(
      browser, page, artifactDir, report, "vendor-basmati-duplicate-review.png",
    );

    step = "unique product duplicate confirmation";
    onStage(step);
    await browser.fillLabel(page, "Product Name", result.name);
    await browser.fillLabel(page, "Product Details", result.details);
    await browser.clickText(page, "Check for duplicates");
    const noMatchReady = await findReview(browser, page, "not already in the catalog", 15000);
    const review = noMatchReady ? await browser.evaluate(page, `(() => {
      const panel = document.querySelector('.vendor-duplicate-review,[data-testid="duplicate-review"]');
      const checkbox = panel?.querySelector('input[type="checkbox"]');
      const confirm = Array.from(panel?.querySelectorAll('button') || []).find(button =>
        /confirm no match.*create/i.test(button.innerText));
      const label = checkbox?.closest('label')?.innerText || '';
      return {
        checked: checkbox?.checked ?? null,
        disabled: confirm?.disabled ?? null,
        correctPrompt: /I checked the results and this product is not already in the catalog/i.test(label),
        noMatchMessage: /No matching product found/i.test(panel?.innerText || ''),
      };
    })()`) : {};
    if (noMatchReady) {
      await captureSanitizedScreenshot(
        browser, page, artifactDir, report, "vendor-missing-no-match-review.png",
        [result.name, result.details],
      );
    }
    assert(checks, "global name-and-details duplicate review returns the explicit no-match message",
      noMatchReady && review.noMatchMessage);
    assert(checks, "explicit no-match confirmation uses the required user-facing wording and starts unchecked",
      review.correctPrompt && review.checked === false);
    assert(checks, "new product creation stays disabled until explicit no-match confirmation",
      review.disabled === true);

    step = "missing product creation through the vendor UI";
    onStage(step);
    const category = await pool.query(
      "SELECT id::text FROM public.master_categories WHERE name = 'Rice & Grains' AND is_active = true ORDER BY id LIMIT 1",
    );
    assert(checks, "active Rice & Grains category is available for later admin classification", category.rowCount === 1);
    result.categoryId = category.rows[0].id;
    const categoryCount = await pool.query(
      "SELECT count(*)::int AS total FROM public.master_products WHERE master_category_id = $1",
      [result.categoryId],
    );
    result.categoryProductCountBefore = categoryCount.rows[0].total;
    const checkbox = ".vendor-duplicate-review input[type=checkbox],[data-testid=duplicate-review] input[type=checkbox]";
    const checkboxPoint = await browser.rect(page,
      `document.querySelector(${quote(checkbox)})`, true);
    await browser.clickAt(page, checkboxPoint);
    const checked = await browser.evaluate(page,
      `document.querySelector(${quote(checkbox)})?.checked === true`);
    assert(checks, "vendor explicitly confirms that the product is not already in the catalog", checked);
    result.created = true;
    await browser.clickText(page, "Confirm no match & create");

    const configSelector = `section.vendor-selling-variant-editor[aria-label=${quote(`${result.name} selling variants`)}]`;
    const openedConfiguration = await browser.wait(page,
      `!!document.querySelector(${quote(configSelector)})`, 15000);
    assert(checks, "new product creation immediately opens its store configuration without category selection",
      openedConfiguration);
    result.storeListingCreated = openedConfiguration;
    const pendingVendorCard = await browser.wait(page, `Array.from(document.querySelectorAll('[data-testid^="card-master-product-"]'))
      .some(element => element.querySelector('h3')?.innerText.trim() === ${quote(result.name)} &&
        element.querySelector('.vendor-master-category')?.innerText.trim() === 'New product')`, 12000);
    assert(checks, "vendor Master Catalog labels an unclassified family New product",
      pendingVendorCard);

    const persisted = await pool.query(
      `SELECT m.id::text AS master_id, m.master_category_id::text AS category_id,
              m.is_active AS master_active, p.id::text AS listing_id,
              p.is_active AS listing_active
       FROM public.master_products m
       LEFT JOIN public.products p ON p.master_product_id = m.id AND p.store_id = $2
       WHERE m.name = $1
       ORDER BY p.created_at`,
      [result.name, storeId],
    );
    assert(checks, "UI-created master is pending classification and mapped to one unavailable store draft",
      persisted.rowCount === 1 && persisted.rows[0].master_id && persisted.rows[0].category_id === null &&
      persisted.rows[0].master_active === true && persisted.rows[0].listing_id &&
      persisted.rows[0].listing_active === false);
    result.masterProductId = persisted.rows[0].master_id;
    const variants = await pool.query(
      "SELECT count(*)::int AS total FROM public.product_variants WHERE product_id = $1",
      [persisted.rows[0].listing_id],
    );
    const emptyEditor = await browser.evaluate(page,
      `${quote(configSelector)} && document.querySelector(${quote(configSelector)})?.querySelectorAll('[data-testid="selling-variant-row"]').length === 0`);
    assert(checks, "new store draft starts with zero selling variants and is immediately configurable",
      variants.rows[0]?.total === 0 && emptyEditor);
    report.counts.uniquePendingMasterCreated = 1;
    return result;
  } catch (cause) {
    if (!checks.some((item) => item.name === step && !item.passed)) {
      checks.push({ name: step, passed: false });
    }
    cause.failedAssertion ??= step;
    cause.testProduct = result;
    throw cause;
  }
}