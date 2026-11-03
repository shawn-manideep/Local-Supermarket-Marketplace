import assert from "node:assert/strict";
import test from "node:test";
import { signInTelugu, translateSignIn } from "./sign-in-language";
import { readFile } from "node:fs/promises";

test("all sign-in labels and errors have English and Telugu translations without translating unknown data", () => {
  for (const [english, telugu] of Object.entries(signInTelugu)) {
    assert.equal(translateSignIn("en", english), english);
    assert.equal(translateSignIn("te", english), telugu);
    assert.match(telugu, /[\u0C00-\u0C7F]/);
  }
  assert.equal(translateSignIn("te", "private-user-entered-name"), "private-user-entered-name");
});

test("language selection and password reveal do not replace identity/password state or touch auth storage", async () => {
  const language = await readFile(new URL("./sign-in-language.tsx", import.meta.url), "utf8");
  const controls = await readFile(new URL("./AuthControls.tsx", import.meta.url), "utf8");
  assert.match(language, /useState<"en" \| "te">\("en"\)/);
  assert.doesNotMatch(language, /localStorage|sessionStorage|supabase|access_token|location\.reload/);
  assert.match(controls, /language === "te" \? signInTelugu\[visible \? "Hide password" : "Show password"\]/);
  assert.match(controls, /type=\{visibility\.inputType\}/);
  assert.match(controls, /setVisible\(value => !value\)/);
});
