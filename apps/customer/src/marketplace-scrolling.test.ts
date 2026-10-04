import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { customerWebShellBounds, webViewportFlex } from "./lib/viewport-layout";

const read = (path: string) => readFile(new URL(path, import.meta.url), "utf8");

test("existing Customer web shell is height-bounded at desktop, tablet and mobile dimensions", () => {
  for (const [width, height] of [[1440, 900], [1024, 768], [390, 844]]) {
    const bounds = customerWebShellBounds(height);
    assert.equal(bounds.height, height, `viewport ${width} x ${height}`);
    assert.equal(bounds.maxHeight, height);
    assert.equal(bounds.flexBasis, 0);
    assert.equal(bounds.flexShrink, 1);
    assert.equal(bounds.minHeight, 0);
    assert.equal(bounds.minWidth, 0);
  }
});

test("web viewport uses remaining flex space, not the product list's intrinsic height", () => {
  assert.deepEqual(webViewportFlex, { flexGrow: 1, flexShrink: 1, flexBasis: 0, minHeight: 0, minWidth: 0 });
  assert.equal("overflow" in webViewportFlex, false);
  assert.equal("height" in webViewportFlex, false);
});

test("Customer shell and every marketplace ancestor use the bounded web layout", async () => {
  const app = await read("../App.tsx");
  const marketplace = await read("./MarketplaceScreen.tsx");
  assert.match(app, /useWindowDimensions\(\)/);
  assert.match(app, /Platform\.OS === "web" && customerWebShellBounds\(viewportHeight\)/);
  assert.match(app, /styles\.content, commonStyles\.viewport/);
  assert.match(app, /display: screen === "home" \? "flex" : "none" \}, commonStyles\.viewport/);
  assert.match(marketplace, /<View style=\{\[\{ flex: 1 \}, commonStyles\.viewport\]\}>\s*\{content\}/);
});

test("Home, search, catalog and Details bound their existing ScrollView without nesting another vertical owner", async () => {
  const marketplace = await read("./MarketplaceScreen.tsx");
  const details = await read("./components/ShoppingProductDetails.tsx");
  for (const key of ['key="global-product-search"', 'key="store-discovery"', 'key={`store-${store.id}-${categoryId}`}']) {
    assert.ok(marketplace.includes(`<ScrollView ${key} style={commonStyles.viewport} contentContainerStyle={commonStyles.page}>`));
  }
  assert.match(details, /<ScrollView style=\{commonStyles\.viewport\} contentContainerStyle=/);
  assert.equal((marketplace.match(/<ScrollView /g) ?? []).length, 6);
  assert.match(marketplace, /<ScrollView horizontal showsHorizontalScrollIndicator=\{false\}/);
  assert.doesNotMatch(marketplace, /overflow:\s*["']hidden["'][\s\S]{0,30}\{content\}/);
});

test("web bounds leave native styling and the existing page padding untouched", async () => {
  const theme = await read("./theme.ts");
  assert.match(theme, /viewport: Platform\.OS === "web" \? webViewportFlex : \{\}/);
  assert.match(theme, /page: \{[\s\S]*?flexGrow: 1/);
  const padding = Number(theme.match(/paddingBottom: (\d+)/)?.[1]);
  const marketplace = await read("./MarketplaceScreen.tsx");
  const bar = marketplace.match(/stickyCart: \{([^\n]+)\}/)?.[1] ?? "";
  const barHeight = Number(bar.match(/minHeight: (\d+)/)?.[1]);
  const barBottom = Number(bar.match(/bottom: (\d+)/)?.[1]);
  assert.ok(padding >= barHeight + barBottom + 16, "last product clears the existing basket overlay");
  assert.match(marketplace, /cartUnits > 0 && !cartSummaryError/);
  assert.match(marketplace, /onPress=\{openCart\} style=\{styles\.stickyCart\}/);
});