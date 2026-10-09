import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { addressStreetLines, formatAddress } from "./address-format";

test("legacy addresses retain both original address lines", () => {
  assert.deepEqual(addressStreetLines({
    line1: "Plot 18", line2: "Pragathi Nagar", houseNumber: null, buildingName: null,
    landmark: null, locality: null, city: "Hyderabad", state: "Telangana", pincode: "500090",
  }), ["Plot 18, Pragathi Nagar", "Hyderabad, Telangana, 500090"]);
});

test("structured addresses format their fields without repeating legacy line text", () => {
  assert.equal(formatAddress({
    line1: "Flat 302", line2: "Green Heights Apartments, Near ABC School",
    houseNumber: "Flat 302", buildingName: "Green Heights Apartments", landmark: "Near ABC School",
    locality: "Pragathi Nagar", city: "Hyderabad", state: "Telangana", pincode: "500090",
  }), "Flat 302, Green Heights Apartments, Near ABC School, Pragathi Nagar\nHyderabad, Telangana, 500090");
});

test("null locality on a structured address never falls back to duplicated legacy line2", () => {
  assert.deepEqual(addressStreetLines({
    line1: "Flat 302", line2: "Green Heights Apartments, Near ABC School",
    houseNumber: "Flat 302", buildingName: "Green Heights Apartments", landmark: null,
    locality: null, city: "Hyderabad", state: "Telangana", pincode: "500090",
  }), ["Flat 302, Green Heights Apartments", "Hyderabad, Telangana, 500090"]);
});

test("bottom navigation labels Reorder while retaining its existing orders screen key", async () => {
  const app = await readFile(new URL("../../App.tsx", import.meta.url), "utf8");
  assert.match(app, /const navItems: Array<"home" \| "orders" \| "account"> = \[\s*"home",\s*"orders",\s*"account",\s*\]/);
  assert.match(app, /item === "orders" \? "Reorder"/);
  assert.match(app, /setScreen\(item\)/);
});
