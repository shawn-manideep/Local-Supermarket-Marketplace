import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { customerCatalogQuerySchema, customerDiscoveryQuerySchema } from "@workspace/validation";
import { operatingStatus } from "./operating-status.js";

test("discovery validates Indian pincodes and optional category IDs", () => {
  assert.equal(customerDiscoveryQuerySchema.safeParse({ pincode: "560001" }).success, true);
  assert.equal(customerDiscoveryQuerySchema.safeParse({ pincode: "000001" }).success, false);
  assert.equal(customerCatalogQuerySchema.safeParse({ pincode: "560001", categoryId: "bad" }).success, false);
});

test("operating status separates weekly schedule from approval status", () => {
  const mondayAtTenInIndia = new Date("2026-09-21T04:30:00.000Z");
  assert.equal(operatingStatus([{ dayOfWeek: 1, opensAt: "09:00:00", closesAt: "18:00:00", isClosed: false }], mondayAtTenInIndia), "OPEN");
  assert.equal(operatingStatus([{ dayOfWeek: 1, opensAt: "11:00:00", closesAt: "18:00:00", isClosed: false }], mondayAtTenInIndia), "CLOSED");
  assert.equal(operatingStatus([{ dayOfWeek: 1, opensAt: null, closesAt: null, isClosed: true }], mondayAtTenInIndia), "CLOSED");
});

test("customer marketplace RLS uses non-recursive eligibility helpers", async () => {
  const migration = await readFile(
    new URL("../../../../database/migrations/0001_customer_marketplace_read_policies.sql", import.meta.url),
    "utf8",
  );
  assert.match(migration, /SECURITY DEFINER/);
  assert.match(migration, /SET search_path = public/);
  assert.match(migration, /USING \(public\.customer_can_access_store\(id\)\)/);
  assert.doesNotMatch(migration, /stores_customer_discovery_select[\\s\\S]*?JOIN public\.store_service_pincodes/);
});