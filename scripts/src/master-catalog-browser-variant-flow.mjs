import {
  findButtonPoint, inputValue, quote, wait,
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

async function readyForVendorResults(browser, page) {
  await wait(650);
  return browser.wait(page, `!document.querySelector('.vendor-master-skeleton') &&
    !document.querySelector('[aria-label="Loading master catalog"]') &&
    (document.querySelectorAll('[data-testid^="card-master-product-"]').length > 0 ||
     !!document.querySelector('.vendor-master-catalog .vendor-empty-state'))`, 15000);
}

async function searchVendor(browser, page, query) {
  await browser.fillSelector(page, "#master-product-search", query);
  const ready = await readyForVendorResults(browser, page);
  const result = await browser.evaluate(page, `(() => ({
    count: document.querySelectorAll('[data-testid^="card-master-product-"]').length,
    category: document.querySelector('#master-category-filter')?.value ?? null,
    page: document.querySelector('.vendor-master-pagination')?.innerText ?? '',
    cards: Array.from(document.querySelectorAll('[data-testid^="card-master-product-"]'))
      .map(element => ({
        name: element.querySelector('h3')?.innerText.trim() ?? '',
        id: (element.getAttribute('data-testid') || '').replace('card-master-product-', ''),
      })),
    exactNames: Array.from(document.querySelectorAll('[data-testid^="card-master-product-"] h3'))
      .map(element => element.innerText.trim()),
  }))()`);
  return { ready, ...result };
}

async function verifyBrowsePagination(browser, page, paginationText) {
  const pageCount = Number(paginationText.match(/page\s+1\s+of\s+(\d+)/i)?.[1] ?? 1);
  if (pageCount <= 1) return true;
  const next = `Array.from(document.querySelectorAll('.vendor-master-pagination button'))
    .find(button => button.innerText.trim() === 'Next')`;
  await browser.clickAt(page, await browser.rect(page, next, true));
  const advanced = await browser.wait(page,
    "document.querySelector('.vendor-master-pagination')?.innerText.match(/page\\s+2\\s+of/i) != null", 10000);
  const filterUnchanged = await inputValue(browser, page, "#master-category-filter") === "";
  const previous = `Array.from(document.querySelectorAll('.vendor-master-pagination button'))
    .find(button => button.innerText.trim() === 'Previous')`;
  await browser.clickAt(page, await browser.rect(page, previous, true));
  const returned = await browser.wait(page,
    "document.querySelector('.vendor-master-pagination')?.innerText.match(/page\\s+1\\s+of/i) != null", 10000);
  return advanced && filterUnchanged && returned;
}

async function changeRow(browser, page, index, field, value) {
  const selector = `#selling-variant-${index}-${field}`;
  if (field === "unit") await browser.selectSelector(page, selector, value);
  else await browser.fillSelector(page, selector, value);
}

async function appendVariant(browser, page, index, quantity, unit, price, stock) {
  await browser.clickSelector(page, '[data-testid="add-selling-variant"]');
  await changeRow(browser, page, index, "quantity", quantity);
  await changeRow(browser, page, index, "unit", unit);
  await changeRow(browser, page, index, "price", price);
  await changeRow(browser, page, index, "stock", String(stock));
}

async function persistVariants(browser, page, expectedMessage = "Selling variants saved.") {
  const saveButton = '[data-testid="save-variants"]';
  const enabled = await browser.evaluate(page, `document.querySelector(${quote(saveButton)})?.disabled === false`);
  if (!enabled) throw new Error("Valid selling variant edits did not enable saving.");
  await browser.clickSelector(page, saveButton);
  return browser.wait(page, `document.body.innerText.includes(${quote(expectedMessage)})`, 12000);
}

async function readPersistedListing(pool, storeId, masterName) {
  const masters = await pool.query(
    "SELECT id::text FROM public.master_products WHERE name = $1 ORDER BY id",
    [masterName],
  );
  if (masters.rowCount !== 1) return { masterCount: masters.rowCount, listingCount: 0, variants: [], masterId: "" };
  const masterId = masters.rows[0].id;
  const listings = await pool.query(
    `SELECT id::text, master_product_id::text, is_active, availability
     FROM public.products WHERE store_id = $1 AND master_product_id = $2 ORDER BY id`,
    [storeId, masterId],
  );
  if (listings.rowCount !== 1) {
    return { masterCount: masters.rowCount, listingCount: listings.rowCount, variants: [], masterId };
  }
  const variants = await pool.query(
    `SELECT id::text, name, quantity_value::text, quantity_unit::text, price::text,
            stock_quantity, availability, is_active, sort_order, sku, external_code
     FROM public.product_variants WHERE product_id = $1 ORDER BY sort_order, id`,
    [listings.rows[0].id],
  );
  return {
    masterCount: masters.rowCount,
    listingCount: listings.rowCount,
    masterId,
    productId: listings.rows[0].id,
    active: listings.rows[0].is_active,
    available: listings.rows[0].availability,
    variants: variants.rows,
  };
}

function matchesFourVariants(rows) {
  const expected = [
    ["500 g", "500", "g", "40.00", 20, true],
    ["1 kg", "1", "kg", "75.00", 30, true],
    ["2 kg", "2", "kg", "145.00", 15, true],
    ["5 kg", "5", "kg", "350.00", 10, true],
  ];
  return rows.length === expected.length && rows.every((row, index) => {
    const [name, quantity, unit, price, stock, available] = expected[index];
    return row.name === name && Number(row.quantity_value) === Number(quantity) &&
      row.quantity_unit === unit && Number(row.price) === Number(price) &&
      row.stock_quantity === stock && row.availability === available &&
      row.is_active === true && row.sort_order === index;
  });
}

export async function runVendorVariantFlow({
  browser, page, pool, storeId, storeName, artifactDir, report, checks, onStage = () => {},
}) {
  const result = {
    created: false,
    name: "",
    masterProductId: "",
    productId: "",
    deactivated: false,
  };
  let step = "choose an unlisted real rice master";
  try {
    onStage(step);
    const owned = await pool.query(
      "SELECT name, master_product_id::text AS master_id FROM public.products WHERE store_id = $1 ORDER BY name",
      [storeId],
    );
    const ownedNames = new Set(owned.rows.map((row) => row.name));
    const ownedMasterIds = new Set(owned.rows.map((row) => row.master_id).filter(Boolean));
    const sona = await searchVendor(browser, page, "Sona Masuri Rice");
    const sonaCard = sona.cards.find(card => /^Sona\s*Masuri\s*Rice$/i.test(card.name));
    let targetName = sonaCard && !ownedNames.has(sonaCard.name) &&
      !ownedMasterIds.has(sonaCard.id) ? sonaCard.name : "";
    let targetMasterId = targetName ? sonaCard.id : "";
    if (!targetName) {
      const rice = await searchVendor(browser, page, "rice");
      assert(checks, "real rice Master Catalog search remains global and category-unfiltered",
        rice.ready && rice.count > 0 && rice.category === "");
       const paginationPreserved = await verifyBrowsePagination(browser, page, rice.page);
      assert(checks, "vendor pagination preserves the active browse filter and returns to its original page",
        paginationPreserved);
      const riceCandidate = rice.cards.find(card =>
        /rice$/i.test(card.name) &&
        !ownedNames.has(card.name) && !ownedMasterIds.has(card.id));
      targetName = riceCandidate?.name ?? "";
      targetMasterId = riceCandidate?.id ?? "";
      const nextButton = `Array.from(document.querySelectorAll('.vendor-master-pagination button'))
        .find(button => button.innerText.trim() === 'Next')`;
      let pageNumber = 1;
      while (!targetName && pageNumber < 5) {
        const canAdvance = await browser.evaluate(page, `${nextButton} && !${nextButton}.disabled`);
        if (!canAdvance) break;
        await browser.clickAt(page, await browser.rect(page, nextButton, true));
        pageNumber += 1;
        const advanced = await browser.wait(page, `document.querySelector('.vendor-master-pagination')?.innerText.includes(${quote(`page ${pageNumber} of`)})`, 10000);
        if (!advanced) break;
        await browser.wait(page,
          "!document.querySelector('.vendor-master-skeleton') && !document.querySelector('[aria-label=\"Loading master catalog\"]')", 10000);
        const cards = await browser.evaluate(page, `Array.from(document.querySelectorAll('[data-testid^="card-master-product-"]'))
          .map(element => ({
            name: element.querySelector('h3')?.innerText.trim() ?? '',
            id: (element.getAttribute('data-testid') || '').replace('card-master-product-', ''),
          }))`);
        const candidate = cards.find(card => /rice$/i.test(card.name) &&
          !ownedNames.has(card.name) && !ownedMasterIds.has(card.id));
        targetName = candidate?.name ?? "";
        targetMasterId = candidate?.id ?? "";
      }
    } else {
      await searchVendor(browser, page, "Sona Masuri Rice");
    }
    assert(checks, "an unlisted real seeded rice identity is available without modifying existing store products",
      Boolean(targetName && targetMasterId) && !ownedNames.has(targetName) &&
      !ownedMasterIds.has(targetMasterId));
    result.name = targetName;
    result.masterProductId = targetMasterId;

    const categoryBeforeSearch = await inputValue(browser, page, "#master-category-filter");
    assert(checks, "Master Catalog category filter is optional and initially unselected",
      categoryBeforeSearch === "");
    // Pagination may still be settling after a search. Navigate to the exact
    // chosen identity, then prove the live card's ID and name before adding.
    await browser.fillSelector(page, "#master-product-search", targetName);
    const card = `document.querySelector('[data-testid="card-master-product-${targetMasterId}"]')`;
    const liveCard = await browser.wait(page,
      `${card}?.querySelector('h3')?.textContent.trim() === ${quote(targetName)}`, 15000);
    assert(checks, "the chosen unlisted rice identity is visible in the live catalog before adding it",
      liveCard);
    const addPoint = await findButtonPoint(browser, page, "Add to My Store", card);
    await browser.clickAt(page, addPoint);
    result.created = true;
    const editor = `section.vendor-selling-variant-editor[aria-label=${quote(`${targetName} selling variants`)}]`;
    const open = await browser.wait(page, `!!document.querySelector(${quote(editor)})`, 12000);
    assert(checks, "Add to My Store opens one linked store configuration rather than creating pack-size products", open);
    const initialRows = await browser.evaluate(page,
      `${quote(editor)} && document.querySelector(${quote(editor)})?.querySelectorAll('[data-testid="selling-variant-row"]').length`);
    assert(checks, "new seeded master listing starts with no invented selling variants", initialRows === 0);

    step = "validate publish rules in the vendor selling-variant editor";
    onStage(step);
    const editorProof = await browser.evaluate(page, `(() => {
      const root = document.querySelector(${quote(editor)});
      return {
        heading: /configure selling variants/i.test(root?.innerText || ''),
        noManualNameOrOrder: !/variant name|display order/i.test(root?.innerText || '') &&
          !Array.from(root?.querySelectorAll('label') || []).some(label => /variant name|display order/i.test(label.innerText)),
      };
    })()`);
    assert(checks, "selling-variant editor has no manual variant-name or display-order field",
      editorProof.heading && editorProof.noManualNameOrOrder);

    await browser.clickSelector(page, '[data-testid="add-selling-variant"]');
    const initialUnit = await inputValue(browser, page, "#selling-variant-0-unit");
    assert(checks, "new selling option requires an explicitly selected unit instead of defaulting to pack",
      initialUnit === "");
    const optionalCodes = await browser.evaluate(page, `(() => {
      const sku = document.querySelector('#selling-variant-0-sku');
      const external = document.querySelector('#selling-variant-0-external-code');
      return !!sku && !!external && !sku.required && !external.required;
    })()`);
    assert(checks, "variant SKU and external code remain optional vendor-only fields", optionalCodes);
    await changeRow(browser, page, 0, "quantity", "1");
    await changeRow(browser, page, 0, "unit", "kg");
    await changeRow(browser, page, 0, "price", "0");
    await changeRow(browser, page, 0, "stock", "0");
    const invalidPrice = await browser.evaluate(page, `(() => {
      const price = document.querySelector('#selling-variant-0-price');
      const publish = document.querySelector('[data-testid="publish-listing"]');
      const message = document.querySelector('#selling-variant-0-price-error')?.innerText || '';
      return {
        invalid: price?.getAttribute('aria-invalid') === 'true' || price?.validity?.rangeUnderflow === true,
        publishDisabled: publish?.disabled === true,
        clearReason: /price.*greater than|price.*required/i.test(message),
      };
    })()`);
    assert(checks, "invalid zero price disables Publish Listing with a clear reason",
      invalidPrice.invalid && invalidPrice.publishDisabled && invalidPrice.clearReason);
    await changeRow(browser, page, 0, "price", "75");
    const stockZeroPublishEnabled = await browser.evaluate(page, `(() => {
      const publish = document.querySelector('[data-testid="publish-listing"]');
      const stock = document.querySelector('#selling-variant-0-stock');
      return publish?.disabled === false && stock?.value === '0' &&
        stock?.getAttribute('aria-invalid') !== 'true';
    })()`);
    assert(checks, "valid 1 kg selling option can publish at ₹75 with zero stock",
      stockZeroPublishEnabled);
    await captureSanitizedScreenshot(
      browser, page, artifactDir, report, "vendor-zero-stock-publish-enabled.png",
    );
    await browser.clickSelector(page, '[data-testid="publish-listing"]');
    const rowExpression = `Array.from(document.querySelectorAll('.vendor-product-row'))
      .find(element => element.querySelector('.vendor-product-identity-text strong')?.innerText.trim() === ${quote(targetName)})`;
    const published = await browser.wait(page, `${rowExpression}?.innerText.includes('Deactivate')`, 12000);
    assert(checks, "vendor UI publishes the configured zero-stock listing without stock deduction",
      published);
    const zeroStock = await pool.query(
      `SELECT v.stock_quantity, p.is_active, p.master_product_id::text AS master_id
       FROM public.products p
       INNER JOIN public.product_variants v ON v.product_id = p.id
       WHERE p.store_id = $1 AND p.master_product_id = $2 AND v.name = '1 kg'`,
      [storeId, targetMasterId],
    );
    assert(checks, "published zero-stock variant persists under the same master-linked store listing",
      zeroStock.rowCount === 1 && zeroStock.rows[0].stock_quantity === 0 && zeroStock.rows[0].is_active);

    step = "configure four persisted grocery selling variants";
    onStage(step);
    await appendVariant(browser, page, 1, "500", "g", "40", 20);
    await appendVariant(browser, page, 2, "2", "kg", "145", 15);
    await appendVariant(browser, page, 3, "5", "kg", "350", 10);
    await changeRow(browser, page, 0, "stock", "30");
    const saveComplete = await persistVariants(browser, page);
    assert(checks, "all four valid selling variants save through the normal vendor interface",
      saveComplete);
    const parentAvailable = await browser.evaluate(page,
      `${rowExpression}?.querySelector('input[type="checkbox"]')?.checked ?? false`);
    if (!parentAvailable) {
      await browser.clickAt(page, await browser.rect(page,
        `${rowExpression}?.querySelector('input[type="checkbox"]')`, true));
    }
    assert(checks, "published Store B listing is enabled for customer discovery",
      await browser.wait(page, `${rowExpression}?.querySelector('input[type="checkbox"]')?.checked === true`, 6000));

    step = "reload and verify listing persistence and system ordering";
    onStage(step);
    await browser.send("Page.reload", { ignoreCache: true }, page.sessionId);
    // Avoid matching the old document's Catalog button while the reload is
    // starting and then clicking a document whose context has been destroyed.
    await wait(750);
    const dashboardReloaded = await browser.wait(page,
      "!!Array.from(document.querySelectorAll('button')).find(button => button.innerText.trim() === 'Catalog')", 15000);
    assert(checks, "vendor authenticated catalog survives page reload", dashboardReloaded);
    await browser.clickText(page, "Catalog");
    const persistedRowExpression = `Array.from(document.querySelectorAll('.vendor-product-row'))
      .find(element => element.querySelector('.vendor-product-identity-text strong')?.innerText.trim() === ${quote(targetName)})`;
    const rowLoaded = await browser.wait(page, `${persistedRowExpression} != null`, 12000);
    assert(checks, "one store listing is rehydrated after browser reload", rowLoaded);
    const variantsButton = `Array.from((${persistedRowExpression}).querySelectorAll('button'))
      .find(button => /^(?:Selling )?variants\\s*\\(4\\)$/i.test(button.textContent.trim()))`;
    await browser.clickAt(page, await browser.rect(page, variantsButton, true));
    const editorReloaded = await browser.wait(page, `!!document.querySelector(${quote(editor)})`, 8000);
    assert(checks, "all selling variants reopen under the same reloaded store listing", editorReloaded);
    const saved = await readPersistedListing(pool, storeId, targetName);
    result.masterProductId = saved.masterId;
    result.productId = saved.productId;
    const dbFourRows = saved.masterCount === 1 && saved.listingCount === 1 &&
      saved.active && saved.available && matchesFourVariants(saved.variants);
    assert(checks, "read-only persistence confirms one Master Product, one listing, four auto-named logically sorted variants",
      dbFourRows);
    const uiFourRows = await browser.evaluate(page, `(() => {
      const root = document.querySelector(${quote(editor)});
      const rows = Array.from(root?.querySelectorAll('[data-testid="selling-variant-row"]') || []);
      const labels = rows.map(row => row.querySelector('.vendor-selling-variant-heading strong')?.innerText.trim());
      return rows.length === 4 && JSON.stringify(labels) === JSON.stringify(['500 g', '1 kg', '2 kg', '5 kg']);
    })()`);
    assert(checks, "vendor sees auto-generated names in logical quantity order after reload", uiFourRows);
    report.counts.configuredVariants = saved.variants.length;
    report.counts.masterListingsForConfiguredProduct = saved.listingCount;
    await captureSanitizedScreenshot(
      browser, page, artifactDir, report, "vendor-four-variants-one-listing.png", [], true,
    );

    step = "vendor UI availability and stock edit for customer proof";
    onStage(step);
    const oneKilogramRow = "Array.from(document.querySelectorAll('[data-testid=\"selling-variant-row\"]'))[1]";
    const advanced = await browser.rect(page, `${oneKilogramRow}?.querySelector('summary')`, true);
    await browser.clickAt(page, advanced);
    await browser.fillSelector(page, "#selling-variant-1-sku", "QA-PRIVATE-SKU");
    await browser.fillSelector(page, "#selling-variant-1-external-code", "QA-PRIVATE-EXT");
    const codesEdited = await browser.evaluate(page, `document.querySelector('#selling-variant-1-sku')?.value === 'QA-PRIVATE-SKU' &&
      document.querySelector('#selling-variant-1-external-code')?.value === 'QA-PRIVATE-EXT'`);
    assert(checks, "vendor can add optional internal variant codes without changing the shared product identity",
      codesEdited);
    const codesSaved = await persistVariants(browser, page);
    const codesPersisted = await pool.query(
      `SELECT sku, external_code FROM public.product_variants
       WHERE product_id = $1 AND name = '1 kg'`,
      [result.productId],
    );
    assert(checks, "optional variant codes persist only on the vendor selling option",
      codesSaved && codesPersisted.rowCount === 1 &&
      codesPersisted.rows[0].sku === "QA-PRIVATE-SKU" &&
      codesPersisted.rows[0].external_code === "QA-PRIVATE-EXT");
    await changeRow(browser, page, 2, "stock", "0");
    const unavailable = await browser.evaluate(page,
      "document.querySelector('#selling-variant-3-availability')?.checked === true");
    if (unavailable) await browser.clickSelector(page, "#selling-variant-3-availability");
    const savedUnavailable = await persistVariants(browser, page);
    assert(checks, "vendor UI saves 2 kg as out of stock and 5 kg as unavailable",
      savedUnavailable);
    const temporary = await pool.query(
      `SELECT v.name, v.stock_quantity, v.availability
       FROM public.product_variants v WHERE v.product_id = $1 ORDER BY v.sort_order, v.id`,
      [result.productId],
    );
    assert(checks, "read-only database confirms temporary 2 kg stock-zero and 5 kg unavailable states",
      temporary.rowCount === 4 && temporary.rows[2].name === "2 kg" &&
      temporary.rows[2].stock_quantity === 0 && temporary.rows[2].availability === true &&
      temporary.rows[3].name === "5 kg" && temporary.rows[3].availability === false);
    result.deactivated = false;
    result.storeName = storeName;
    return result;
  } catch (cause) {
    if (!checks.some((item) => item.name === step && !item.passed)) {
      checks.push({ name: step, passed: false });
    }
    cause.failedAssertion ??= step;
    cause.listingProduct = result;
    throw cause;
  }
}

export async function restoreVendorVariants(browser, page, listing, pool, checks) {
  if (!listing?.created || !listing.productId) return false;
  const editor = `section.vendor-selling-variant-editor[aria-label=${quote(`${listing.name} selling variants`)}]`;
  const open = await browser.wait(page, `!!document.querySelector(${quote(editor)})`, 6000);
  if (!open) return false;
  await changeRow(browser, page, 2, "stock", "15");
  const unavailable = await browser.evaluate(page,
    "document.querySelector('#selling-variant-3-availability')?.checked === false");
  if (unavailable) await browser.clickSelector(page, "#selling-variant-3-availability");
  const saved = await persistVariants(browser, page);
  const persisted = await pool.query(
    `SELECT count(*)::int AS total
     FROM public.product_variants
     WHERE product_id = $1 AND (
       (name = '2 kg' AND stock_quantity = 15 AND availability = true) OR
       (name = '5 kg' AND stock_quantity = 10 AND availability = true)
     )`,
    [listing.productId],
  );
  const restored = saved && persisted.rows[0]?.total === 2;
  assert(checks, "vendor UI restores temporary stock and availability after customer proof", restored);
  return restored;
}