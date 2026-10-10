import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { addressStreetLines, deliveryLocationLabel, formatAddress } from "./address-format";

test("delivery header prefers house/flat, then building, then PIN without guessing legacy address text", () => {
  const address = { label: "Home", city: "Hyderabad", pincode: "505327" };
  assert.equal(deliveryLocationLabel({ ...address, houseNumber: "Flat 302", buildingName: "Green Heights" }), "Home • Flat 302");
  assert.equal(deliveryLocationLabel({ ...address, houseNumber: "  Flat 302  ", buildingName: "Green Heights" }), "Home • Flat 302");
  assert.equal(deliveryLocationLabel({ ...address, houseNumber: null, buildingName: "Green Heights" }), "Home • Green Heights");
  assert.equal(deliveryLocationLabel({ ...address, houseNumber: "  ", buildingName: "  Green Heights  " }), "Home • Green Heights");
  assert.equal(deliveryLocationLabel({ ...address, houseNumber: null, buildingName: null }), "Home • 505327");
  assert.equal(deliveryLocationLabel({ ...address, houseNumber: "", buildingName: "  " }), "Home • 505327");
  assert.equal(deliveryLocationLabel(address), "Home • 505327");
  assert.equal(deliveryLocationLabel({ ...address, label: null, buildingName: "Green Heights" }), "Hyderabad • Green Heights");
});

test("shared House/Flat field preserves explicit labels and never guesses a label for bare numbers", () => {
  const address = { label: "Home", city: "Hyderabad", pincode: "505327", buildingName: "Green Heights" };
  assert.equal(deliveryLocationLabel({ ...address, houseNumber: "501" }), "Home • 501");
  assert.equal(deliveryLocationLabel({ ...address, houseNumber: "  501  " }), "Home • 501");
  assert.equal(deliveryLocationLabel({ ...address, houseNumber: "12-4" }), "Home • 12-4");
  assert.equal(deliveryLocationLabel({ ...address, houseNumber: "Flat 501" }), "Home • Flat 501");
  assert.equal(deliveryLocationLabel({ ...address, houseNumber: "House 12-4" }), "Home • House 12-4");
  assert.equal(deliveryLocationLabel({ ...address, houseNumber: "" }), "Home • Green Heights");
  assert.equal(deliveryLocationLabel({ ...address, houseNumber: null, buildingName: null }), "Home • 505327");
});

test("Home delivery header keeps selection and arrow while bounding long location text", async () => {
  const screen = await readFile(new URL("../MarketplaceScreen.tsx", import.meta.url), "utf8");
  assert.match(screen, /onPress=\{openAddresses\} style=\{styles\.locationRow\}/);
  assert.match(screen, /⌖  Delivering to/);
  assert.match(screen, /numberOfLines=\{1\} ellipsizeMode="tail">\{activeAddress \? deliveryLocationLabel\(activeAddress\)/);
  assert.match(screen, /locationText: \{ flexShrink: 1, minWidth: 0 \}/);
  assert.match(screen, /<Text style=\{\{ color: colors\.accent, fontSize: 12 \}\}>▼<\/Text>/);
});

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
