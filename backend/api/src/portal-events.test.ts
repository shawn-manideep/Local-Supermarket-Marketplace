import { test } from "node:test";
import assert from "node:assert/strict";
import { eventApplies } from "./portal-events.js";
test("live refresh hints stay scoped to owning Vendor and active Partner route", () => {
  const payload = JSON.stringify({kind:"NEW_ORDER",storeId:"own-store"});
  assert.equal(eventApplies(payload,"vendor","own-store"),true);
  assert.equal(eventApplies(payload,"vendor","other-store"),false);
  assert.equal(eventApplies(payload,"vendor",null),false);
  assert.equal(eventApplies(payload,"delivery_partner",null),false);
  assert.equal(eventApplies('{"kind":"DELIVERY_OFFERS"}',"delivery_partner",null),true);
  assert.equal(eventApplies('{"kind":"DELIVERY_OFFERS"}',"vendor","own-store"),false);
  assert.equal(eventApplies("invalid","vendor","own-store"),false);
});
