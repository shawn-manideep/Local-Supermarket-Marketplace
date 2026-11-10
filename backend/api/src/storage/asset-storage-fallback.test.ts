import assert from "node:assert/strict";
import test from "node:test";
import { SupabaseStorageError } from "./supabase-storage.js";
import {
  readWithNotFoundFallback,
  discardFromOwningStore,
  writeToSelectedStore,
} from "./asset-storage-fallback.js";

test("read uses Supabase when the object exists", async () => {
  let legacyCalled = false;
  const result = await readWithNotFoundFallback(
    async () => "supabase-data",
    async () => {
      legacyCalled = true;
      return "replit-data";
    },
  );

  assert.equal(result, "supabase-data");
  assert.equal(legacyCalled, false);
});

test("read falls back to Replit only when Supabase returns NOT_FOUND", async () => {
  let legacyCalled = false;
  const result = await readWithNotFoundFallback(
    async () => {
      throw new SupabaseStorageError("NOT_FOUND");
    },
    async () => {
      legacyCalled = true;
      return "replit-data";
    },
  );

  assert.equal(result, "replit-data");
  assert.equal(legacyCalled, true);
});

test("read propagates Supabase UNAVAILABLE without falling back", async () => {
  let legacyCalled = false;

  await assert.rejects(
    readWithNotFoundFallback(
      async () => {
        throw new SupabaseStorageError("UNAVAILABLE");
      },
      async () => {
        legacyCalled = true;
        return "replit-data";
      },
    ),
    error => error instanceof SupabaseStorageError && error.code === "UNAVAILABLE",
  );

  assert.equal(legacyCalled, false);
});

test("read propagates unexpected errors without falling back", async () => {
  let legacyCalled = false;
  const failure = new Error("unexpected failure");

  await assert.rejects(
    readWithNotFoundFallback(
      async () => { throw failure; },
      async () => {
        legacyCalled = true;
        return "replit-data";
      },
    ),
    error => error === failure,
  );

  assert.equal(legacyCalled, false);
});

test("delete removes the object from Supabase when Supabase owns it", async () => {
  const calls: string[] = [];

  await discardFromOwningStore(
    async () => true,
    async () => { calls.push("supabase"); },
    async () => { calls.push("replit"); },
  );

  assert.deepEqual(calls, ["supabase"]);
});

test("delete removes the object from Replit when Supabase does not own it", async () => {
  const calls: string[] = [];

  await discardFromOwningStore(
    async () => false,
    async () => { calls.push("supabase"); },
    async () => { calls.push("replit"); },
  );

  assert.deepEqual(calls, ["replit"]);
});

test("delete does not fall back when Supabase ownership check fails", async () => {
  const calls: string[] = [];

  await assert.rejects(
    discardFromOwningStore(
      async () => { throw new SupabaseStorageError("UNAVAILABLE"); },
      async () => { calls.push("supabase"); },
      async () => { calls.push("replit"); },
    ),
    error => error instanceof SupabaseStorageError && error.code === "UNAVAILABLE",
  );

  assert.deepEqual(calls, []);
});

test("upload writes to Supabase when the asset provider is enabled", async () => {
  const calls: string[] = [];

  await writeToSelectedStore(
    true,
    async () => { calls.push("supabase"); },
    async () => { calls.push("legacy"); },
  );

  assert.deepEqual(calls, ["supabase"]);
});

test("upload preserves the existing provider when the asset provider is unset", async () => {
  const calls: string[] = [];

  await writeToSelectedStore(
    false,
    async () => { calls.push("supabase"); },
    async () => { calls.push("legacy"); },
  );

  assert.deepEqual(calls, ["legacy"]);
});

test("upload errors propagate without switching providers", async () => {
  const calls: string[] = [];
  const failure = new SupabaseStorageError("UNAVAILABLE");

  await assert.rejects(
    writeToSelectedStore(
      true,
      async () => { calls.push("supabase"); throw failure; },
      async () => { calls.push("legacy"); },
    ),
    error => error === failure,
  );

  assert.deepEqual(calls, ["supabase"]);
});
