import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { StoreProfileFields } from "./StoreProfileFields";
import { WeeklyHoursFields, readWeeklyHours } from "./WeeklyHoursFields";
import type { OperatingHour } from "./api";

test("shared store form renders all owner and address controls with required markers", () => {
  const html = renderToStaticMarkup(createElement(StoreProfileFields, { values: { city: "Hyderabad", locality: "Pragathi Nagar", pincode: "500090" } }));
  for (const name of ["name", "ownerName", "phone", "email", "description", "logoImageUrl", "addressLine1", "addressLine2", "locality", "city", "state", "pincode"]) {
    assert.ok(html.includes(`name="${name}"`), `missing ${name}`);
  }
  for (const name of ["name", "ownerName", "addressLine1", "locality", "city", "state", "pincode"]) {
    const input = html.match(new RegExp(`<input[^>]*name="${name}"[^>]*>`))?.[0];
    assert.ok(input?.includes('required=""'), `${name} must be required`);
  }
  assert.match(html, /\* Required/);
  assert.ok(html.includes('value="Hyderabad"') && html.includes('value="500090"'));
});
test("vendor store form excludes Admin-only commercial controls and preserves owner/address limits", () => {
  const html = renderToStaticMarkup(createElement(StoreProfileFields, { variant: "vendor" }));
  assert.doesNotMatch(html, /name="(?:deliveryFee|handlingFee|minimumOrderValue)"/);
  assert.ok(html.match(/<input[^>]*name="ownerName"[^>]*>/)?.[0].includes('maxLength="100"'));
  assert.ok(html.match(/<input[^>]*name="addressLine1"[^>]*>/)?.[0].includes('maxLength="250"'));
  assert.match(html, /pattern="\[1-9\]\[0-9\]\{5\}"/);
  assert.doesNotMatch(html, /name="(?:price|stock|sku|variants|username|password|status|ownerUserId)"/);
});
test("Admin fee controls reload saved amounts and default to zero while remaining absent for Vendors", () => {
  const vendor = renderToStaticMarkup(createElement(StoreProfileFields, { variant: "vendor", values: { handlingFee: "8.50" } }));
  assert.doesNotMatch(vendor, /name="(?:deliveryFee|handlingFee|minimumOrderValue)"/);
  const admin = renderToStaticMarkup(createElement(StoreProfileFields, { variant: "admin", values: { handlingFee: "8.50" } }));
  for (const name of ["deliveryFee", "handlingFee", "minimumOrderValue"]) {
    const input = admin.match(new RegExp(`<input[^>]*name="${name}"[^>]*>`))?.[0];
    assert.ok(input, `Admin must have ${name}`);
    for (const constraint of ['min="0"', 'max="1000000"', 'step="0.01"']) assert.ok(input.includes(constraint));
  }
  assert.match(admin, /name="handlingFee"[^>]*value="8.50"/);
  const empty = renderToStaticMarkup(createElement(StoreProfileFields, { variant: "admin" }));
  assert.match(empty, /name="handlingFee"[^>]*value="0.00"/);
  assert.match(empty, /Handling fee/);
});
test("weekly hours preserve saved days and serialize closed days with null times", () => {
  const hours: OperatingHour[] = [{ id: "qa", storeId: "qa", dayOfWeek: 1, isClosed: false, opensAt: "08:30:00", closesAt: "20:15:00", createdAt: "", updatedAt: "" }];
  const html = renderToStaticMarkup(createElement(WeeklyHoursFields, { hours }));
  assert.match(html, /name="hoursOpen_1" checked=""/);
  assert.match(html, /value="08:30"/);
  assert.match(html, /value="20:15"/);
  const form = new FormData();
  form.set("hoursOpen_1", "on"); form.set("hoursOpensAt_1", "08:30"); form.set("hoursClosesAt_1", "20:15");
  const result = readWeeklyHours(form);
  assert.equal(result.length, 7);
  assert.deepEqual(result[1], { dayOfWeek: 1, isClosed: false, opensAt: "08:30", closesAt: "20:15" });
  assert.deepEqual(result[0], { dayOfWeek: 0, isClosed: true, opensAt: null, closesAt: null });
});
test("Admin vendor provisioning reads passwords from transient refs, checks confirmation and clears credentials", () => {
  const source = String(readFileSync(new URL("./admin/AdminPortal.tsx", import.meta.url), "utf8"));
  const start = source.indexOf("function VendorProvisionForm");
  const end = source.indexOf("function ProvisionForm", start + 1);
  const form = source.slice(start, end);
  assert.ok(start >= 0 && end > start);
  assert.match(form, /passwordRef.*useRef/);
  assert.match(form, /password !== confirmPassword/);
  assert.match(form, /clearSecrets\(\)/);
  assert.doesNotMatch(form, /\[password,\s*setPassword\]|localStorage|sessionStorage|console\./);
  assert.match(source, /updateAdminVendor/);
  assert.match(source, /hours: readWeeklyHours\(form\)/);
  assert.match(source, /storeUpdateSchema\.shape\.phone/);
});
test("vendor username login feeds the existing Supabase session while email login remains unchanged", () => {
  const source = String(readFileSync(new URL("./App.tsx", import.meta.url), "utf8"));
  assert.match(source, /\/api\/vendor\/login/);
  assert.match(source, /supabase\.auth\.setSession/);
  assert.match(source, /supabase\.auth\.signInWithPassword/);
  assert.match(source, /username: email,/);
  assert.doesNotMatch(source, /username: email\.trim/);
  assert.match(source, /!adminMode/);
});
test("required fields use stable module-level components instead of nested component definitions", () => {
  const source = String(readFileSync(new URL("./StoreProfileFields.tsx", import.meta.url), "utf8"));
  assert.ok(source.indexOf("function ProfileField") < source.indexOf("export function StoreProfileFields"));
  assert.doesNotMatch(source.slice(source.indexOf("export function StoreProfileFields")), /function ProfileField|const Field/);
});
