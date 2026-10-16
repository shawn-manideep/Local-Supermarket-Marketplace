import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { addressFromPhotonFeature, coordinatesForForm, validCoordinates } from "./StoreLocationMap";
import { parseServerEvents } from "./refresh-event-stream";
import { FssaiExpiryStatus } from "./FssaiExpiryStatus";
import { StoreProfileFields } from "./StoreProfileFields";

test("server-event parser handles split frames, CRLF, comments, and multiple data lines", () => {
  const first = parseServerEvents("event: refresh\r\ndata: {\"ok\":true}\r\n\r\n: heartbeat\n\nevent: update\ndata: first\ndata: second\n\npending");
  assert.deepEqual(first.events, [
    { event: "refresh", data: "{\"ok\":true}" },
    { event: "update", data: "first\nsecond" },
  ]);
  assert.equal(first.remainder, "pending");
  const next = parseServerEvents(`${first.remainder}\nevent: refresh\ndata: {}\n\n`);
  assert.deepEqual(next.events, [{ event: "refresh", data: "{}" }]);
  assert.equal(next.remainder, "");
});

test("map coordinate serialization keeps an unset pin empty and preserves real values", () => {
  assert.deepEqual(coordinatesForForm(null), { latitude: "", longitude: "" });
  assert.deepEqual(coordinatesForForm({ latitude: 17.4431, longitude: 78.3915 }), { latitude: 17.4431, longitude: 78.3915 });
  assert.equal(validCoordinates(null, null), false);
  assert.equal(validCoordinates(17.4431, 78.3915), true);
  assert.equal(validCoordinates(91, 78), false);
  assert.equal(validCoordinates(17, 181), false);
});

test("FSSAI summary renders unknown, valid, and expired status without fabricating missing dates", () => {
  const unknown = renderToStaticMarkup(createElement(FssaiExpiryStatus, {
    value: { expiryDate: null, status: "DATE_REQUIRED", daysRemaining: null },
  }));
  assert.match(unknown, /Expiry date required/);
  assert.match(unknown, /status is unknown/);
  assert.doesNotMatch(unknown, /202\d/);
  const valid = renderToStaticMarkup(createElement(FssaiExpiryStatus, {
    value: { expiryDate: "2030-04-16", status: "VALID", daysRemaining: 221 },
  }));
  assert.match(valid, /VALID/);
  assert.match(valid, /16 April 2030/);
  assert.match(valid, /221 days remaining/);
  const expired = renderToStaticMarkup(createElement(FssaiExpiryStatus, {
    value: { expiryDate: "2025-02-01", status: "EXPIRED", daysRemaining: -1 },
  }));
  assert.match(expired, /role="alert"/);
  assert.match(expired, /Expired · compliance action required/);
});

test("Photon reverse lookup maps detected address components into existing store fields", () => {
  assert.deepEqual(addressFromPhotonFeature({ properties: {
    name: "Green Heights", housenumber: "12-4", street: "Main Road", suburb: "Jubilee Hills",
    city: "Hyderabad", state: "Telangana", postcode: "500033",
  } }), {
    label: "Green Heights, 12-4 Main Road, Jubilee Hills, Hyderabad, Telangana, 500033",
    addressLine1: "12-4 Main Road",
    addressLine2: "Green Heights",
    locality: "Jubilee Hills",
    city: "Hyderabad",
    state: "Telangana",
    pincode: "500033",
  });
});

test("Admin keeps map editing while Vendor location uses manual address fields and click-triggered detection", async () => {
  const [fields, map, vendorLocation] = await Promise.all([
    readFile(new URL("./StoreProfileFields.tsx", import.meta.url), "utf8"),
    readFile(new URL("./StoreLocationMap.tsx", import.meta.url), "utf8"),
    readFile(new URL("./vendor-store-location.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(fields, /<StoreLocationMap latitude=\{values\.latitude\} longitude=\{values\.longitude\} editable=\{!disabled\}/);
  assert.doesNotMatch(fields, /field\("Latitude"|field\("Longitude"/);
  assert.match(map, /name="latitude" value=\{hidden\.latitude\}/);
  assert.match(map, /name="longitude" value=\{hidden\.longitude\}/);
  assert.match(map, /draggable: true/);
  assert.match(map, /MAP_PROVIDER\.tiles/);
  assert.match(map, /MAP_PROVIDER\.attribution/);
  assert.match(map, /new URL\(MAP_PROVIDER\.reverse\)/);
  assert.match(map, /url\.searchParams\.set\("q", query\.trim\(\)\)/);
  assert.match(map, /role="search"/);
  assert.doesNotMatch(map, /<form/);
  assert.match(fields, /vendor \? <VendorStoreLocation values=\{values\} disabled=\{disabled\}/);
  assert.match(vendorLocation, /Use Current Location/);
  assert.match(vendorLocation, /onClick=\{detectLocation\}/);
  assert.match(vendorLocation, /onBusyChange\?\.\(true\)/);
  assert.match(vendorLocation, /name=\{name\}/);
  assert.match(vendorLocation, /reverseGeocodeAddress\(detected, controller\.signal\)/);
  assert.doesNotMatch(vendorLocation, /<StoreLocationMap|type="number"/);
  assert.match(vendorLocation, /window\.isSecureContext/);
  const vendorHtml = renderToStaticMarkup(createElement(StoreProfileFields, { variant: "vendor" }));
  assert.match(vendorHtml, /Use Current Location/);
  assert.match(vendorHtml, /name="addressLine1"/);
  assert.match(vendorHtml, /name="addressLine2"/);
  assert.match(vendorHtml, /name="pincode"/);
  assert.doesNotMatch(vendorHtml, /lb-location-map|store-location-search/);
});

test("vendor compliance and persistent notification UI use server status and generated feed contracts", async () => {
  const [vendor, documents, admin] = await Promise.all([
    readFile(new URL("./VendorStorePanel.tsx", import.meta.url), "utf8"),
    readFile(new URL("./VendorDocumentsPanel.tsx", import.meta.url), "utf8"),
    readFile(new URL("./admin/AdminVendorDocuments.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(vendor, /\/api\/vendor\/notifications/);
  assert.match(vendor, /\/api\/vendor\/notifications\/\$\{encodeURIComponent\(notification\.id\)\}\/read/);
  assert.doesNotMatch(vendor, /seenOrderIds/);
  assert.match(vendor, /documentStatus\?\.fssai\?\.status === "EXPIRED"/);
  assert.match(documents, /\/api\/vendor\/documents\/\$\{encodeURIComponent\(documentId\)\}\/expiry/);
  assert.match(documents, /type="date"/);
  assert.match(documents, /expiryDisabled: verification === "SUBMITTED"/);
  assert.match(admin, /\/api\/admin\/vendors\/\$\{encodeURIComponent\(vendorId\)\}\/notifications/);
  assert.match(admin, /does not prove browser delivery/);
  assert.match(admin, /\/documents\/\$\{encodeURIComponent\(documentId\)\}\/expiry/);
  assert.match(admin, /View order details/);
  assert.match(admin, /onViewOrder\(notice\.orderId!\)/);
});

test("vendor assignment UI is read-only and partner offers use claim polling", async () => {
  const [orders, partner, vendor, stream] = await Promise.all([
    readFile(new URL("./OrderOperations.tsx", import.meta.url), "utf8"),
    readFile(new URL("./DeliveryPartnerPortal.tsx", import.meta.url), "utf8"),
    readFile(new URL("./VendorStorePanel.tsx", import.meta.url), "utf8"),
    readFile(new URL("./refresh-event-stream.ts", import.meta.url), "utf8"),
  ]);
  const panel = orders.slice(orders.indexOf("function VendorDeliveryAssignmentPanel"), orders.indexOf("function AdminSummaryTiles"));
  assert.doesNotMatch(panel, /delivery-partners|partnerId|method:\s*"POST"|<select/);
  assert.match(panel, /awaiting the first eligible partner to claim this order/);
  assert.match(partner, /\/api\/delivery-partner\/available-deliveries/);
  assert.match(partner, /\/claim/);
  assert.match(partner, /Another partner claimed this delivery first/);
  assert.match(partner, /OFFER_POLL_MS = 12_000/);
  assert.match(vendor, /runRefreshEventStream\("\/api\/vendor\/events"/);
  assert.match(partner, /runRefreshEventStream\("\/api\/delivery-partner\/events"/);
  assert.match(stream, /credentials: "same-origin"/);
  assert.match(stream, /apiAuthorizationHeaders\(token/);
  assert.match(stream, /reader\.read\(\)/);
  assert.match(stream, /retryDelay = Math\.min\(retryDelay \* 2, 30_000\)/);
  assert.doesNotMatch(stream, /[?&]token=/);
});
