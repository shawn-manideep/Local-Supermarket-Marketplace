import assert from "node:assert/strict";
import test from "node:test";
import { normalizeCatalogHistoryTimestamp } from "./excel-service.js";

test("history normalizes raw PostgreSQL timestamps before ISO serialization and importer comparison", () => {
  const timestamp = normalizeCatalogHistoryTimestamp("2026-10-05 14:16:23.339496+00");
  assert.equal(timestamp?.toISOString(), "2026-10-05T14:16:23.339Z");
  const importerTimestamp = new Date("2026-10-05T14:16:23.339Z");
  assert.equal(timestamp?.getTime(), importerTimestamp.getTime());
});

test("history preserves mapped Date values and handles empty catalog timestamps", () => {
  const date = new Date("2026-10-05T14:16:23.000Z");
  assert.equal(normalizeCatalogHistoryTimestamp(date), date);
  assert.equal(normalizeCatalogHistoryTimestamp(null), null);
  assert.equal(normalizeCatalogHistoryTimestamp(undefined), null);
});
