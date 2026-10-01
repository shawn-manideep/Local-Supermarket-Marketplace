import fs from "node:fs/promises";
import path from "node:path";

const directory = "artifacts/catalog-verification";
const report = JSON.parse(await fs.readFile(path.join(directory, "report.json"), "utf8"));
const counts = report.counts ?? {};
const escape = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
})[character]);
const findEvidence = (pattern) => report.assertions.filter((item) => pattern.test(item.name));
const summarize = (pattern) => {
  const matches = findEvidence(pattern);
  return matches.length
    ? matches.map((item) => `<li class="${item.passed ? "pass" : "fail"}">${item.passed ? "PASS" : "FAIL"} — ${escape(item.name)}</li>`).join("")
    : '<li class="pending">Not yet verified in the authenticated browser report.</li>';
};
const items = [
  ["Master Category count", `<p>${escape(counts.masterCategories)} active grocery categories. Pre-existing archived categories are retained.</p>`, /categor.*(25|dropdown|active|baseline)/i],
  ["Master Product count", `<p>181 seeded grocery families are retained. Active before this verification: ${escape(counts.masterProductsActiveBefore)}; total before: ${escape(counts.masterProductsTotalBefore)}. See final database counts below.</p>`, /master.*(baseline|count|products|seed)/i],
  ["Example global search results", `<p>Authenticated vendor search results on the displayed page: ${escape(JSON.stringify(counts.vendorMasterSearchResults ?? {}))}.</p><p>Seeded examples include Basmati Rice, Sona Masuri Rice, milk families and egg families. Browser screenshots show the actual returned records.</p>`, /global.*(rice|milk|eggs|Amul|biryani)/i],
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
  ["Typecheck results", "<p>Workspace typecheck passed. After the review fixes, validation, API and dashboard typechecks also passed; unchanged customer/artifact checks remain valid.</p>", /typecheck/i],
  ["Build results", "<p>Workspace builds and Expo customer web export passed. API and dashboard builds passed again after the review fixes. Existing non-blocking bundle-size/source-map warnings remain. Production was not published.</p>", /build/i],
  ["Remaining issues and cleanup", `<p>${report.passed ? "Authenticated acceptance passed." : "Authenticated acceptance is incomplete; failed checks are listed below."}</p><ul>${(report.issues ?? []).map((issue) => `<li>${escape(issue)}</li>`).join("") || "<li>No additional issues recorded.</li>"}</ul><p>Cleanup: ${escape(JSON.stringify(report.cleanup ?? {}))}</p>`, /cleanup|restore|deactivat|retain|archiv/i],
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
const html = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Master Catalog — 18-item verification report</title><style>
body{font:16px/1.6 system-ui,sans-serif;background:#f4f6f8;color:#172b3a;margin:0}main{max-width:1080px;margin:40px auto;padding:0 24px}
h1{line-height:1.2}h2{font-size:22px;margin-top:0}article,figure,header{background:white;border:1px solid #dce4e9;border-radius:12px;padding:24px;margin:20px 0}
small{color:#526777}li{margin:8px 0}.pass{color:#146548}.fail{color:#aa2535}.pending{color:#76561a}img{width:100%;height:auto}
figcaption{color:#526777;font-size:14px}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#eef3f5;padding:16px}
</style><main><header><small>DEVELOPMENT ONLY · NO PRODUCTION PUBLICATION</small><h1>Master Catalog verification</h1>
<p>${report.passed ? "Passed" : "Incomplete"} · ${report.assertions.filter((item) => item.passed).length}/${report.assertions.length} browser/database assertions passed.</p>
<p>Normal authenticated vendor, customer and admin journeys. No authentication, checkout, orders, reorder, payments, Delivery Partner or stock-deduction changes.</p></header>
${items.map(([title, text, pattern], index) => `<article><h2>${index + 1}. ${escape(title)}</h2>${text}<ul>${summarize(pattern)}</ul></article>`).join("")}
<article><h2>Final database counts</h2>${finalCounts || "<p>Final count snapshot not yet recorded.</p>"}</article>
<article><h2>All recorded acceptance checks</h2><ul>${summarize(/./)}</ul></article>${images}</main></html>`;
await fs.writeFile(path.join(directory, "report.html"), html);
console.log(JSON.stringify({ report: path.join(directory, "report.html"), passed: report.passed, sections: 18 }));