import assert from "node:assert/strict";
import test from "node:test";
import { canTransitionStoreStatus } from "./status.js";

test("allows only the Phase 3 store status transitions", () => {
  assert.equal(canTransitionStoreStatus("PENDING_APPROVAL", "ACTIVE"), true);
  assert.equal(canTransitionStoreStatus("PENDING_APPROVAL", "REJECTED"), true);
  assert.equal(canTransitionStoreStatus("ACTIVE", "SUSPENDED"), true);
  assert.equal(canTransitionStoreStatus("SUSPENDED", "ACTIVE"), true);
  assert.equal(canTransitionStoreStatus("ACTIVE", "REJECTED"), false);
  assert.equal(canTransitionStoreStatus("REJECTED", "ACTIVE"), false);
});