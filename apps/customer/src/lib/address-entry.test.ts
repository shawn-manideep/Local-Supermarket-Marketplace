import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { blankAddress, normalizeAddressInput, validateAddressInput } from "./address-entry";

test("shared structured address validation preserves checkout requirements", () => {
  assert.equal(validateAddressInput(blankAddress), "Please fill all required fields.");
  const complete = {
    ...blankAddress,
    recipientName: "Ananya Rao",
    phone: "9876543210",
    houseNumber: " Flat 302 ",
    city: "Hyderabad",
    state: "Telangana",
    pincode: "500090",
  };
  assert.equal(validateAddressInput(complete), null);
  assert.equal(validateAddressInput({ ...complete, phone: "1234567890" }), "Please enter a valid 10-digit Indian mobile number.");
});

test("shared address normalizer keeps structured and legacy fields aligned without changing default state", () => {
  const normalized = normalizeAddressInput({
    ...blankAddress,
    recipientName: "Ananya Rao",
    phone: "9876543210",
    houseNumber: " Flat 302 ",
    buildingName: " Green Heights ",
    landmark: " Near ABC School ",
    locality: " Pragathi Nagar ",
    city: "Hyderabad",
    state: "Telangana",
    pincode: "500090",
  });
  assert.equal(normalized.houseNumber, "Flat 302");
  assert.equal(normalized.line1, "Flat 302");
  assert.equal(normalized.line2, "Pragathi Nagar");
  assert.equal(normalized.locality, "Pragathi Nagar");
  assert.equal(normalized.buildingName, "Green Heights");
  assert.equal(normalized.landmark, "Near ABC School");
  assert.equal(normalized.isDefault, false);
});

test("checkout creates, refreshes, and selects only the newly returned address", async () => {
  const checkout = await readFile(new URL("../CartScreen.tsx", import.meta.url), "utf8");
  assert.match(checkout, /t\("\+ Add New Address"\)/);
  assert.match(checkout, /customerApi<\{ address: CustomerAddress \}>\("\/api\/customer\/addresses"/);
  assert.match(checkout, /method: "POST"/);
  assert.match(checkout, /customerApi<\{ addresses: CustomerAddress\[\] \}>\("\/api\/customer\/addresses"\)/);
  assert.match(checkout, /setAddressId\(created\.id\)/);
  assert.match(checkout, /isDefault: false/);
  assert.match(checkout, /customerApi<\{ order: \{ id: string \} \}>\("\/api\/customer\/orders"/);
});
