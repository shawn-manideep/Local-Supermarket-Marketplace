import assert from "node:assert/strict";
import test from "node:test";
import { translate } from "../src/translation";
import { createLanguagePreference, languagePreferenceKey, type LanguageStorage } from "../src/preference";

function memory() {
  const values = new Map<string, string>();
  const storage: LanguageStorage = {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value); },
  };
  return { storage, values };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

test("English is the default and missing Telugu translations fall back to English", async () => {
  const { storage } = memory();
  const state = createLanguagePreference(storage, "customer");
  assert.equal(state.getSnapshot().language, "en");
  await state.switchScope(null);
  assert.deepEqual(state.getSnapshot(), { language: "en", ready: true, storageError: null });
  assert.equal(translate("te", "common.englishFallback"), "English fallback");
});

test("Telugu lookup and interpolation preserve dynamic content literally", () => {
  assert.equal(translate("te", "common.language"), "భాష");
  assert.equal(translate("te", "common.greeting", { name: "Apna Local Basket $& {name}" }), "నమస్కారం, Apna Local Basket $& {name}!");
  assert.equal(translate("en", "common.greeting", { name: 501 }), "Hello, 501!");
  assert.equal(translate("te", "common.greeting"), "నమస్కారం, {name}!");
});

test("preferences save and load after reopening without touching other storage keys", async () => {
  const { storage, values } = memory();
  values.set("auth-session", "untouched");
  const state = createLanguagePreference(storage, "customer-language");
  await state.switchScope("account-a");
  await state.setLanguage("te");
  const reopened = createLanguagePreference(storage, "customer-language");
  await reopened.switchScope("account-a");
  assert.equal(reopened.getSnapshot().language, "te");
  assert.equal(values.get("auth-session"), "untouched");
});

test("invalid stored values safely default to English", async () => {
  for (const value of ["fr", "TE", '"te"', "", "undefined"]) {
    const { storage, values } = memory();
    values.set(languagePreferenceKey("language", null), value);
    const state = createLanguagePreference(storage, "language");
    await state.switchScope(null);
    assert.equal(state.getSnapshot().language, "en");
    assert.equal(state.getSnapshot().ready, true);
  }
});

test("load failure exposes an error and keeps English usable", async () => {
  const state = createLanguagePreference({
    getItem: () => { throw new Error("blocked"); }, setItem() {},
  }, "language");
  await state.switchScope(null);
  assert.deepEqual(state.getSnapshot(), { language: "en", ready: true, storageError: "load" });
});

test("save failure keeps the live selection and exposes an error; successful retry clears it", async () => {
  let fail = true;
  const state = createLanguagePreference({
    getItem: () => null, setItem: async () => { if (fail) throw new Error("quota"); },
  }, "language");
  await state.switchScope(null);
  await state.setLanguage("te");
  assert.deepEqual(state.getSnapshot(), { language: "te", ready: true, storageError: "save" });
  fail = false;
  await state.setLanguage("te");
  assert.equal(state.getSnapshot().storageError, null);
});

test("signed-out and different accounts have independent preferences", async () => {
  const { storage, values } = memory();
  const state = createLanguagePreference(storage, "language");
  await state.switchScope(null); await state.setLanguage("te");
  await state.switchScope("a"); assert.equal(state.getSnapshot().language, "en");
  await state.setLanguage("te");
  await state.switchScope("b"); assert.equal(state.getSnapshot().language, "en");
  await state.setLanguage("en");
  await state.switchScope("a"); assert.equal(state.getSnapshot().language, "te");
  await state.switchScope(null); assert.equal(state.getSnapshot().language, "te");
  assert.equal(values.size, 3);
  assert.notEqual(languagePreferenceKey("language", null), languagePreferenceKey("language", "signed-out"));
});

test("independent Customer preference namespaces do not collide", async () => {
  const { storage } = memory();
  const customer = createLanguagePreference(storage, "customer-language:v1");
  const otherNamespace = createLanguagePreference(storage, "customer-language:v2");
  await customer.switchScope("a"); await customer.setLanguage("te");
  await otherNamespace.switchScope("a");
  assert.equal(otherNamespace.getSnapshot().language, "en");
});

test("a delayed read cannot overwrite a user's current choice", async () => {
  const read = deferred<string | null>();
  const { storage, values } = memory();
  const state = createLanguagePreference({ ...storage, getItem: () => read.promise }, "language");
  const loading = state.switchScope(null);
  await state.setLanguage("te");
  read.resolve("en"); await loading;
  assert.equal(state.getSnapshot().language, "te");
  assert.equal(values.get(languagePreferenceKey("language", null)), "te");
});

test("switching accounts ignores an old hydration result", async () => {
  const oldRead = deferred<string | null>();
  const state = createLanguagePreference({
    getItem: key => key.endsWith("account:a") ? oldRead.promise : "en", setItem() {},
  }, "language");
  const old = state.switchScope("a");
  await state.switchScope("b");
  oldRead.resolve("te"); await old;
  assert.equal(state.getSnapshot().language, "en");
});

test("outdated failed reads cannot publish errors after account switching", async () => {
  const oldRead = deferred<string | null>();
  const state = createLanguagePreference({
    getItem: key => key.endsWith("account:a") ? oldRead.promise : "te", setItem() {},
  }, "language");
  const old = state.switchScope("a");
  // Allow the first getItem to start before rejecting its deferred promise.
  await Promise.resolve();
  await state.switchScope("b");
  oldRead.reject(new Error("old read")); await old;
  assert.deepEqual(state.getSnapshot(), { language: "te", ready: true, storageError: null });
});

test("slow saves remain ordered and reopening restores the latest choice", async () => {
  const first = deferred<void>();
  const { storage, values } = memory();
  let calls = 0;
  const state = createLanguagePreference({
    ...storage, setItem: async (key, value) => {
      if (++calls === 1) await first.promise;
      values.set(key, value);
    },
  }, "language");
  await state.switchScope("a");
  const one = state.setLanguage("te");
  const two = state.setLanguage("en");
  assert.equal(state.getSnapshot().language, "en");
  first.resolve(); await Promise.all([one, two]); await state.settled();
  const reopened = createLanguagePreference(storage, "language");
  await reopened.switchScope("a");
  assert.equal(reopened.getSnapshot().language, "en");
  assert.equal(calls, 2);
});

test("a pending account save stays scoped even when another account becomes active", async () => {
  const save = deferred<void>();
  const { storage, values } = memory();
  const state = createLanguagePreference({
    ...storage, setItem: async (key, value) => { await save.promise; values.set(key, value); },
  }, "language");
  await state.switchScope("a");
  const writing = state.setLanguage("te");
  await state.switchScope("b");
  assert.equal(state.getSnapshot().language, "en");
  save.resolve(); await writing;
  assert.equal(state.getSnapshot().language, "en");
  assert.equal(values.get(languagePreferenceKey("language", "a")), "te");
  assert.equal(values.has(languagePreferenceKey("language", "b")), false);
  await state.switchScope("a");
  assert.equal(state.getSnapshot().language, "te");
});

test("a save failing after leaving and returning to the same account still reports its error", async () => {
  const save = deferred<void>();
  const state = createLanguagePreference({
    getItem: () => null, setItem: () => save.promise,
  }, "language");
  await state.switchScope("a");
  const writing = state.setLanguage("te");
  await state.switchScope("b");
  await state.switchScope("a");
  save.reject(new Error("quota")); await writing;
  assert.deepEqual(state.getSnapshot(), { language: "te", ready: true, storageError: "save" });
});

test("an older failed save cannot mark a newer identical choice as failed", async () => {
  const save = deferred<void>();
  let calls = 0;
  const state = createLanguagePreference({
    getItem: () => null, setItem: () => ++calls === 1 ? save.promise : undefined,
  }, "language");
  await state.switchScope("a");
  const first = state.setLanguage("te");
  const second = state.setLanguage("te");
  await state.switchScope("b"); await state.switchScope("a");
  save.reject(new Error("old failure")); await Promise.all([first, second]);
  assert.deepEqual(state.getSnapshot(), { language: "te", ready: true, storageError: null });
});
