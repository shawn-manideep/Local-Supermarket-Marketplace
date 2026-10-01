import {
  eligibleStoreIds, quote, wait,
} from "./master-catalog-cdp.mjs";
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

async function clickOption(browser, page, expression) {
  const point = await browser.rect(page, expression, true);
  await browser.clickAt(page, point);
}

export async function runCustomerVariantFlow({
  browser, page, pool, customerPassword, customerEmail, targetName, storeName,
  artifactDir, report, checks,
}) {
  let step = "Customer B normal UI sign-in";
  try {
    const signInLoaded = await browser.wait(page,
      "Array.from(document.querySelectorAll('input')).some(input => input.getAttribute('aria-label') === 'Email address')", 12000);
    assert(checks, "Customer B normal UI sign-in form is loaded", signInLoaded);
    await browser.fillSelector(page, 'input[aria-label="Email address"]', customerEmail);
    await browser.fillSelector(page, 'input[aria-label="Password"]', customerPassword);
    await browser.clickText(page, "Sign in");
    const marketplaceLoaded = await browser.wait(page, `!!document.querySelector('input[aria-label="Search products across nearby stores"]') &&
      document.body.innerText.includes('560001')`, 15000);
    assert(checks, "Customer B is signed in with the saved 560001 delivery location", marketplaceLoaded);

    step = "Customer B global rice search and eligible-store filtering";
    await browser.fillSelector(page, 'input[aria-label="Search products across nearby stores"]', "rice");
    const resultState = await browser.wait(page, `document.body.innerText.includes('matching store offers') ||
      document.body.innerText.includes('No products found')`, 12000);
    await wait(500);
    assert(checks, "Customer B global search opens without requiring a category selection", resultState);
    const eligible = await eligibleStoreIds(pool, "560001");
    const riceSearch = await browser.evaluate(page, `(() => {
      const payloads = window.__catalogVerificationPayloads || [];
      const products = payloads.flatMap(item => item.payload?.products ?? []);
      return {
        payloadCount: payloads.length,
        offerCount: products.length,
        storeIds: [...new Set(products.map(product => product.storeId).filter(Boolean))],
        pincodeInUi: document.body.innerText.includes('560001'),
      };
    })()`);
    const eligibleOnly = riceSearch.payloadCount > 0 && riceSearch.offerCount > 0 &&
      riceSearch.storeIds.length > 0 &&
      riceSearch.storeIds.every(id => eligible.has(id));
    assert(checks, "global rice offers are restricted to database-eligible active stores serving 560001",
      eligibleOnly && riceSearch.pincodeInUi);

    let targetCard = await browser.evaluate(page, `Array.from(document.querySelectorAll('[role="button"]'))
      .find(element => element.innerText.includes(${quote(targetName)}) &&
        element.innerText.includes(${quote(storeName)})) != null`);
    if (!targetCard) {
      await browser.fillSelector(page, 'input[aria-label="Search products across nearby stores"]', targetName);
      const exactResults = await browser.wait(page, `document.body.innerText.includes('matching store offers') ||
        document.body.innerText.includes('No products found')`, 12000);
      await wait(500);
      targetCard = exactResults && await browser.evaluate(page, `Array.from(document.querySelectorAll('[role="button"]'))
        .some(element => element.innerText.includes(${quote(targetName)}) &&
          element.innerText.includes(${quote(storeName)}))`);
    }
    assert(checks, "the configured Store B master-linked rice offer appears in Customer B global search",
      Boolean(targetCard));
    const offerSearch = await browser.evaluate(page, `(() => {
      const payloads = window.__catalogVerificationPayloads || [];
      const products = payloads.flatMap(item => item.payload?.products ?? []);
      const forbidden = key => {
        const normalized = key.toLowerCase().replace(/[_-]/g, '');
        return normalized.includes('masterproductid') ||
          normalized === 'sku' || normalized.endsWith('sku') ||
          normalized.includes('externalcode') ||
          normalized === 'stock' || normalized.includes('stockquantity') ||
          ['createdat', 'updatedat', 'deletedat', 'archivedat', 'timestamp', 'lastmodifiedat'].includes(normalized);
      };
      const clean = value => Array.isArray(value) ? value.every(clean) :
        !value || typeof value !== 'object' ? true :
          Object.entries(value).every(([key, child]) => !forbidden(key) && clean(child));
      return {
        payloadCount: payloads.length,
        offers: products.length,
        targetOffer: products.some(product => product.name === ${quote(targetName)} &&
          product.storeName === ${quote(storeName)}),
        privateFieldsAbsent: payloads.length > 0 && payloads.every(item => clean(item.payload)),
        pincodeInUi: document.body.innerText.includes('560001'),
        storeIds: [...new Set(products.map(product => product.storeId).filter(Boolean))],
        cartWrites: window.__catalogVerificationCartWrites ?? 0,
      };
    })()`);
    assert(checks, "customer product-search payloads omit master IDs, SKU, external code, exact stock and timestamps",
      offerSearch.payloadCount > 0 && offerSearch.privateFieldsAbsent);
    assert(checks, "received global offers are all from the independently computed eligible-store set",
      offerSearch.storeIds.length > 0 && offerSearch.storeIds.every(id => eligible.has(id)));
    assert(checks, "Customer B can search and receive an offer without setting a category",
      offerSearch.targetOffer && offerSearch.pincodeInUi);
    report.counts.customerRiceOffers = riceSearch.offerCount;
    report.counts.eligibleStoresAtSavedPincode = eligible.size;

    step = "customer multi-variant detail and disabled purchase states";
    const cardExpression = `Array.from(document.querySelectorAll('[role="button"]'))
      .find(element => element.innerText.includes(${quote(targetName)}) &&
        element.innerText.includes(${quote(storeName)}))`;
    await clickOption(browser, page, cardExpression);
    const detailLoaded = await browser.wait(page,
      `Array.from(document.querySelectorAll('[role="radio"]')).length === 4`, 12000);
    assert(checks, "customer product detail presents exactly four quantity options for one product",
      detailLoaded);
    const detail = await browser.evaluate(page, `(() => {
      const options = Array.from(document.querySelectorAll('[role="radio"]'));
      return {
        count: options.length,
        labels: options.map(option => (option.getAttribute('aria-label') || option.innerText || '').trim()),
        disabled: options.map(option => option.getAttribute('aria-disabled') === 'true' ||
          option.disabled === true || option.getAttribute('data-disabled') === 'true'),
        selected: options.map(option => option.getAttribute('aria-checked') === 'true' ||
          option.getAttribute('aria-selected') === 'true' ||
          option.getAttribute('data-selected') === 'true'),
        productVisible: document.body.innerText.includes(${quote(targetName)}),
      };
    })()`);
    const contains = (needle) => detail.labels.some(label => label.toLowerCase().includes(needle.toLowerCase()));
    assert(checks, "customer sees generated 500 g, 1 kg, 2 kg, and 5 kg price labels",
      detail.count === 4 && ["500 g", "1 kg", "2 kg", "5 kg"].every(contains) &&
      ["₹40", "₹75", "₹145", "₹350"].every(contains));
    const outOfStockIndex = detail.labels.findIndex(label =>
      label.includes("2 kg") && /out of stock/i.test(label));
    const unavailableIndex = detail.labels.findIndex(label =>
      label.includes("5 kg") && /unavailable/i.test(label));
    assert(checks, "zero-stock and unavailable choices are visibly marked and disabled",
      outOfStockIndex >= 0 && unavailableIndex >= 0 &&
      detail.disabled[outOfStockIndex] && detail.disabled[unavailableIndex]);
    const available500gIndex = detail.labels.findIndex(label =>
      label.includes("500 g") && /available/i.test(label));
    assert(checks, "an available variant remains selectable", available500gIndex >= 0 &&
      !detail.disabled[available500gIndex]);
    const radioExpression = `Array.from(document.querySelectorAll('[role="radio"]'))
      .find(option => (option.getAttribute('aria-label') || option.innerText).includes('500 g'))`;
    await clickOption(browser, page, radioExpression);
    const chosenAvailable = await browser.wait(page, `(() => {
      const option = Array.from(document.querySelectorAll('[role="radio"]'))
        .find(item => (item.getAttribute('aria-label') || item.innerText).includes('500 g'));
      return option?.getAttribute('aria-checked') === 'true' ||
        option?.getAttribute('aria-selected') === 'true' ||
        option?.getAttribute('data-selected') === 'true';
    })()`, 5000);
    assert(checks, "customer selects an available 500 g option before any purchase action",
      chosenAvailable);
    await clickOption(browser, page, `Array.from(document.querySelectorAll('[role="radio"]'))
      .find(option => (option.getAttribute('aria-label') || option.innerText).includes('2 kg'))`);
    await clickOption(browser, page, `Array.from(document.querySelectorAll('[role="radio"]'))
      .find(option => (option.getAttribute('aria-label') || option.innerText).includes('5 kg'))`);
    const unavailableNotSelected = await browser.evaluate(page, `(() => {
      const options = Array.from(document.querySelectorAll('[role="radio"]'));
      const selected = options.find(option => option.getAttribute('aria-checked') === 'true' ||
        option.getAttribute('aria-selected') === 'true' || option.getAttribute('data-selected') === 'true');
      const selectedLabel = selected?.getAttribute('aria-label') || selected?.innerText || '';
      return /500 g/.test(selectedLabel) && !/2 kg|5 kg/.test(selectedLabel);
    })()`);
    assert(checks, "out-of-stock and unavailable variants cannot be selected for purchase",
      unavailableNotSelected);
    const noCartWrites = await browser.evaluate(page,
      "(window.__catalogVerificationCartWrites ?? 0) === 0");
    assert(checks, "customer verification performs no cart, checkout, order, or stock mutation",
      noCartWrites);
    const finalPayloads = await browser.evaluate(page, `(() => {
      const payloads = window.__catalogVerificationPayloads || [];
      const forbidden = key => {
        const normalized = key.toLowerCase().replace(/[_-]/g, '');
        return normalized.includes('masterproductid') || normalized === 'sku' ||
          normalized.endsWith('sku') || normalized.includes('externalcode') ||
          normalized === 'stock' || normalized.includes('stockquantity') ||
          ['createdat', 'updatedat', 'deletedat', 'archivedat', 'timestamp', 'lastmodifiedat'].includes(normalized);
      };
      const clean = value => Array.isArray(value) ? value.every(clean) :
        !value || typeof value !== 'object' ? true :
          Object.entries(value).every(([key, child]) => !forbidden(key) && clean(child));
      return {
        count: payloads.length,
        privateFieldsAbsent: payloads.length > 0 && payloads.every(item => clean(item.payload)),
        cartWrites: window.__catalogVerificationCartWrites ?? 0,
        privateFieldsAbsentFromUi: !/\\bSKU\\b|external code|exact stock|master product id|created at|updated at/i.test(document.body.innerText),
      };
    })()`);
    assert(checks, "global search and product-detail API payloads both omit customer-private fields",
      finalPayloads.privateFieldsAbsent && finalPayloads.privateFieldsAbsentFromUi &&
      finalPayloads.cartWrites === 0);
    await captureSanitizedScreenshot(
      browser, page, artifactDir, report, "customer-four-variants-availability.png",
    );
    report.counts.customerProductDetailOptions = detail.count;
    report.counts.customerPayloadsChecked = finalPayloads.count;
  } catch (cause) {
    if (!checks.some((item) => item.name === step && !item.passed)) {
      checks.push({ name: step, passed: false });
    }
    cause.failedAssertion ??= step;
    throw cause;
  }
}