import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const source = async (name: string): Promise<string> =>
  (await readFile(new URL(name, import.meta.url))).toString("utf8");

test("order queues expose the complete date-range choices in Admin and Vendor views", async () => {
  const orders = await source("./OrderOperations.tsx");
  const options = orders.match(/const dateFilterOptions:[\s\S]*?\n\];/)?.[0];
  assert.ok(options, "date filter choices are defined");
  const labels = [...options.matchAll(/\["[A-Z_]+", "([^"]+)"\]/g)].map((match) => match[1]);
  assert.deepEqual(labels, [
    "Recent Orders",
    "Last 1 Week",
    "Last 15 Days",
    "Last 30 Days",
    "Custom Date Range",
    "All Orders",
  ]);
  assert.equal((orders.match(/dateFilterOptions\.map/g) ?? []).length, 2);
});

test("bank account entry is Vendor-scoped while full account reveal is explicit and Admin-only", async () => {
  const [vendor, admin] = await Promise.all([
    source("./VendorDocumentsPanel.tsx"),
    source("./admin/AdminVendorDocuments.tsx"),
  ]);
  assert.match(vendor, /apiRequest<BankResponse>\("\/api\/vendor\/bank-details"/);
  assert.match(vendor, /name="accountNumber" type="password"/);
  assert.match(vendor, /bank\.bankDetails\.maskedAccountNumber/);
  assert.doesNotMatch(vendor, /bank(?:\?\.bankDetails)?\.accountNumber/);
  assert.doesNotMatch(vendor, /\/api\/admin/);

  assert.match(admin, /useState\(false\)/);
  assert.match(admin, /bank-details\$\{revealBank \? "\?reveal=true" : ""\}/);
  assert.match(admin, /revealBank \? bankStatus\.bankDetails\.accountNumber \?\? bankStatus\.bankDetails\.maskedAccountNumber : bankStatus\.bankDetails\.maskedAccountNumber/);
  assert.match(admin, /Reveal full account number \(authorized admin view\)/);
});
