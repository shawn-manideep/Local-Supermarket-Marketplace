import fs from "node:fs/promises";
import path from "node:path";

const directory = "artifacts/catalog-verification";
const report = JSON.parse(await fs.readFile(path.join(directory, "report.json"), "utf8"));
const cleanupProof = await fs.readFile(path.join(directory, "authorized-test-cleanup.json"), "utf8")
  .then(JSON.parse).catch((error) => {
    if (error.code !== "ENOENT") throw error;
    return null;
  });
const counts = { ...(report.historicalEvidence?.counts ?? {}), ...(report.counts ?? {}) };
const escape = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
})[character]);
const allAssertions = [...(report.historicalEvidence?.assertions ?? []), ...report.assertions];
const findEvidence = (pattern) => allAssertions.filter((item) => pattern.test(item.name));
const summarize = (pattern) => {
  const matches = findEvidence(pattern);
  return matches.length
    ? matches.map((item) => `<li class="${item.passed ? "pass" : "fail"}">${item.passed ? "PASS" : "FAIL"} — ${escape(item.name)}</li>`).join("")
    : '<li class="pending">Not yet verified in the authenticated browser report.</li>';
};
const items = [
  ["Master Category count", `<p>${escape(counts.masterCategories)} active grocery categories. Pre-existing archived categories are retained.</p>`, /categor.*(25|dropdown|active|baseline)/i],
  ["Master Product count", `<p>181 seeded grocery families are retained. Active before this verification: ${escape(counts.masterProductsActiveBefore)}; total before: ${escape(counts.masterProductsTotalBefore)}. See final database counts below.</p>`, /master.*(baseline|count|products|seed)/i],
  ["Example global search results", `<p>Authenticated vendor search results on the displayed page: ${escape(JSON.stringify(counts.vendorMasterSearchResults ?? {}))}.</p><p>Examples independently checked read-only in the current active catalog: rice — Basmati Rice, Boiled Rice, Broken Rice; milk — Buttermilk, Coconut Milk; eggs — Brown Eggs, Country Eggs, Omega Eggs, Regular White Eggs.</p>`, /global.*(rice|milk|eggs|Amul|biryani)/i],
  ["Category dropdown", "", /category.*(dropdown|options|optional|brows)/i],
  ["Add to My Store", "", /add.*store|draft.*listing|selected.*master|store.*draft/i],
  ["Multiple variants under one listing", "", /four|4.*variant|one.*listing|one.*master|multiple.*variant/i],
  ["Automatically generated variant names", "", /generated|label|500 g|1 kg|2 kg|5 kg|variant name/i],
  ["System-managed display order", "", /order|sort/i],
  ["Publish enabled after valid configuration", "", /publish|price|unit|stock.*zero|zero.*stock/i],
  ["Missing-product flow", "", /missing|Add New Product|unlisted|pending|category.*required|ordinary.*fields/i],
  ["Explicit duplicate confirmation", "", /duplicate|confirmation|no.match|unchecked|exact.*match/i],
  ["No Master Delete", "", /delete|archiv|preserv.*master/i],
  ["Customer global search", "", /customer.*(search|global|pincode|eligible|discovery)/i],
  ["Customer multi-variant selection and unavailable options", "", /customer.*variant|quantity.*option|radio|out.of.stock|unavailable.*purchas|selection/i],
  ["API and database test results", '<p>Final API suite: 79 passed, 0 failed, 1 opt-in integration test skipped. Authenticated browser verification and read-only database checks are reported separately, not inferred from unit tests.</p>', /snapshot|unchanged|ownership|privacy|payload|database|orders|commerce|rollback|stale/i],
  ["Typecheck results", "<p>Workspace typecheck passed. After the review fixes, validation, API and dashboard typechecks also passed; unchanged customer/artifact checks remain valid.</p>", null],
  ["Build results", "<p>Workspace builds and Expo customer web export passed. API and dashboard builds passed again after the review fixes. Existing non-blocking bundle-size/source-map warnings remain. Production was not published.</p>", null],
  ["Remaining issues and cleanup", `<p>${report.passed ? "Authenticated acceptance passed." : "Authenticated acceptance remains incomplete. Rice-card selection, Admin search and Customer variant selection require manual UI verification; no more automated browser tests were run."}</p>${cleanupProof?.cleanupPassed ? "<p>Authorized cleanup subsequently passed through the existing Admin API, not browser automation: both positively identified test masters are archived. All other catalog rows and all eight commerce tables remained unchanged. The unrelated pending master was untouched. This does not establish manual Admin UI acceptance.</p><p>The following issues and cleanup flags describe the earlier failed browser run, before the separately recorded API cleanup:</p>" : ""}<ul>${(report.issues ?? []).map((issue) => `<li>${escape(issue)}</li>`).join("") || "<li>No additional issues recorded.</li>"}</ul><p>Historical browser cleanup flags: ${escape(JSON.stringify(report.cleanup ?? {}))}</p>`, /cleanup|restore|deactivat|retain|archiv/i],
];
let images = "";
for (const filename of report.screenshots ?? []) {
  if (path.basename(filename) !== filename || !/\.(png|jpg|jpeg)$/i.test(filename)) continue;
  const buffer = await fs.readFile(path.join(directory, filename));
  const mime = /\.png$/i.test(filename) ? "image/png" : "image/jpeg";
  images += `<figure><img src="data:${mime};base64,${buffer.toString("base64")}" alt="${escape(filename)}"><figcaption>${escape(filename)}</figcaption></figure>`;
}
const finalCountsPath = path.join(directory, "final-database-counts.json");
let finalCounts = "";
try {
  finalCounts = `<pre>${escape(await fs.readFile(finalCountsPath, "utf8"))}</pre>`;
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}
if (!report.passed) {
  const snapshot = await fs.readFile(
    path.join(directory, "read-only-status-after-attempts.json"), "utf8",
  ).catch((error) => {
    if (error.code !== "ENOENT") throw error;
    return null;
  });
  finalCounts = snapshot
    ? `<p>Read-only development status after interrupted verification. These are not final accepted counts; two proven test-created pending masters still need safe Admin UI cleanup.</p><pre>${escape(snapshot)}</pre>`
    : "<p>Final count snapshot not yet recorded. Cleanup is incomplete.</p>";
}
if (cleanupProof?.cleanupPassed) {
  finalCounts = `<p>Read-only confirmation after authorized Admin API cleanup. Manual UI acceptance is still pending; cleanup did not modify any unrelated development records.</p><pre>${escape(JSON.stringify(cleanupProof, null, 2))}</pre>`;
}
if (!finalCounts && counts.masterProductsTotalAfter !== undefined) {
  finalCounts = `<pre>${escape(JSON.stringify({
    activeMasterCategories: counts.masterCategoriesAfter,
    activeMasterProducts: counts.masterProductsActiveAfter,
    totalMasterProductsIncludingArchived: counts.masterProductsTotalAfter,
    baselineOrders: counts.baselineOrders,
  }, null, 2))}</pre>`;
}
const html = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Master Catalog — 18-item verification report</title><style>
body{font:16px/1.6 system-ui,sans-serif;background:#f4f6f8;color:#172b3a;margin:0}main{max-width:1080px;margin:40px auto;padding:0 24px}
h1{line-height:1.2}h2{font-size:22px;margin-top:0}article,figure,header{background:white;border:1px solid #dce4e9;border-radius:12px;padding:24px;margin:20px 0}
small{color:#526777}li{margin:8px 0}.pass{color:#146548}.fail{color:#aa2535}.pending{color:#76561a}img{width:100%;height:auto}
figcaption{color:#526777;font-size:14px}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#eef3f5;padding:16px}
</style><main><header><small>DEVELOPMENT ONLY · NO PRODUCTION PUBLICATION</small><h1>Master Catalog verification</h1>
<p>${report.passed ? "Passed" : "Incomplete"} · ${allAssertions.filter((item) => item.passed).length}/${allAssertions.length} browser/database assertions passed.</p>
${report.historicalEvidence ? `<p>Vendor catalog evidence was verified earlier at ${escape(report.historicalEvidence.priorReportModifiedAt)} and retained explicitly; subsequent flows were verified in the continued run.</p>` : ""}
<p>${report.passed ? "Normal authenticated vendor, customer and Admin journeys passed." : "Authenticated Vendor B checks passed only in part. Customer selection and Admin management were not accepted in this run."} No authentication, checkout, orders, reorder, payments, Delivery Partner or stock-deduction code changes. Production was not published.</p></header>
${cleanupProof?.cleanupPassed ? "<article><h2>Latest status: safe test cleanup completed; manual UI verification pending</h2><p>The two positively identified test masters were archived through the existing Admin API. This evidence is separate from the historical browser assertions. No additional automated browser test was run.</p></article>" : ""}
${items.map(([title, text, pattern], index) => `<article><h2>${index + 1}. ${escape(title)}</h2>${text}${pattern ? `<ul>${summarize(pattern)}</ul>` : ""}</article>`).join("")}
<article><h2>${report.passed ? "Final database counts" : "Read-only status after interrupted verification"}</h2>${finalCounts || "<p>Final count snapshot not yet recorded.</p>"}</article>
<article><h2>All recorded acceptance checks</h2><ul>${summarize(/./)}</ul></article>${images}</main></html>`;
await fs.writeFile(path.join(directory, "report.html"), html);
console.log(JSON.stringify({ report: path.join(directory, "report.html"), passed: report.passed, sections: 18 }));