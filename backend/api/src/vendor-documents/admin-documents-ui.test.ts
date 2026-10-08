import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const ui = () => readFile(new URL("../../../../apps/dashboard/src/admin/AdminVendorDocuments.tsx", import.meta.url), "utf8");
test("Admin Vendor detail mounts an account-keyed read-only document section only for Vendors", async () => {
  const portal = await readFile(new URL("../../../../apps/dashboard/src/admin/AdminPortal.tsx", import.meta.url), "utf8");
  assert.match(portal, /kind === "vendors" && <AdminVendorDocuments key=\{account.id\} vendorId=\{account.id\}/);
  const panel = await ui();
  for (const label of ["Vendor Documents", "Mandatory Documents", "Optional Documents", "Not uploaded", "Uploaded", "informational, not an approval decision"])
    assert.ok(panel.includes(label), label);
  assert.match(panel, /status\?\.mandatoryCount/);
  assert.doesNotMatch(panel, /canManageCatalog|Approve Document|Reject Document|type="file"|object_ref|objectRef/);
});
test("Admin metadata uses existing API client and binary reads preserve same-origin credentials", async () => {
  const client = await readFile(new URL("../../../../apps/dashboard/src/admin-api.ts", import.meta.url), "utf8");
  assert.match(client, /getAdminVendorDocuments/);
  assert.match(client, /apiRequest<VendorDocumentStatus>/);
  const panel = await ui();
  assert.match(panel, /credentials: "same-origin"/);
  assert.match(panel, /headers: apiAuthorizationHeaders\(token\)/);
  assert.match(panel, /apiUrl\(`/);
  assert.match(panel, /encodeURIComponent\(vendorId\)/);
  assert.match(panel, /encodeURIComponent\(current.id\)/);
});
test("Sensitive preview uses ephemeral blob URLs, no opener, cleanup and current-version refresh", async () => {
  const panel = await ui();
  for (const token of ["popup.opener = null", "URL.createObjectURL", "URL.revokeObjectURL", "controller.signal.aborted",
    "response.status === 404", 'window.addEventListener("focus"', 'document.addEventListener("visibilitychange"',
    "window.clearInterval", "popup.close()", 'mime === "image/webp"']) assert.ok(panel.includes(token), token);
  assert.doesNotMatch(panel, /localStorage|sessionStorage|dangerouslySetInnerHTML|publicUrl|signedUrl/);
});
test("Admin document cards have shared-theme shrinking and stacked mobile controls", async () => {
  const css = await readFile(new URL("../../../../apps/dashboard/src/admin/admin.css", import.meta.url), "utf8");
  assert.match(css, /\.lb-admin-doc-row/);
  assert.match(css, /overflow-wrap:\s*anywhere/);
  assert.match(css, /@media/);
  assert.match(css, /\.lb-admin-doc-view/);
  const panel = await ui();
  assert.match(panel, /aria-label=\{`View current/);
  assert.match(panel, /role="alert"/);
});
