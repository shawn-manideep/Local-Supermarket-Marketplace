import assert from "node:assert/strict";
import test from "node:test";
import { createElement, useEffect, useState } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { LanguageProvider, useLanguageScope, useTranslation } from "../src/provider";
import type { LanguageStorage } from "../src/preference";
import { LanguageSelector } from "../../../apps/dashboard/src/LanguageSelector";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

test("live language and account changes rerender text without remounting or resetting child state", async () => {
  const values = new Map<string, string>();
  const storage: LanguageStorage = {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value); },
  };
  let mounts = 0, unmounts = 0;
  let choose!: ReturnType<typeof useTranslation>["setLanguage"];
  function Screen({ account }: { account: string | null }) {
    useLanguageScope(account);
    const { t, setLanguage } = useTranslation();
    choose = setLanguage;
    const [draft, setDraft] = useState("unsaved form");
    const [cartCount] = useState(3);
    const [destination] = useState("cart");
    useEffect(() => { mounts++; return () => { unmounts++; }; }, []);
    return createElement("section", { "data-cart-count": cartCount, "data-destination": destination },
      createElement("p", null, t("customer.language")),
      createElement("input", { value: draft, onChange: (value: string) => setDraft(value) }));
  }
  const tree = (account: string | null) => createElement(LanguageProvider,
    { storage, storageKeyPrefix: "test-language" }, createElement(Screen, { account }));
  let renderer!: ReactTestRenderer;
  await act(async () => { renderer = create(tree(null)); });
  await act(async () => { renderer.root.findByType("input").props.onChange("edited draft"); });
  await act(async () => { await choose("te"); });
  assert.equal(renderer.root.findByType("p").children.join(""), "ప్రాధాన్య భాష");
  assert.equal(renderer.root.findByType("input").props.value, "edited draft");
  assert.equal(renderer.root.findByType("section").props["data-cart-count"], 3);
  assert.equal(renderer.root.findByType("section").props["data-destination"], "cart");
  assert.equal(mounts, 1); assert.equal(unmounts, 0);
  await act(async () => { renderer.update(tree("a")); });
  assert.equal(renderer.root.findByType("p").children.join(""), "Preferred language");
  assert.equal(renderer.root.findByType("input").props.value, "edited draft");
  await act(async () => { await choose("te"); });
  await act(async () => { renderer.update(tree("b")); });
  assert.equal(renderer.root.findByType("p").children.join(""), "Preferred language");
  await act(async () => { renderer.update(tree("a")); });
  assert.equal(renderer.root.findByType("p").children.join(""), "ప్రాధాన్య భాష");
  assert.equal(mounts, 1); assert.equal(unmounts, 0);
  await act(async () => { renderer.unmount(); });
  assert.equal(unmounts, 1);
});

test("the real dashboard selector switches text and selected state without submitting a parent form", async () => {
  const values = new Map<string, string>();
  const storage: LanguageStorage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value); } };
  let mounts = 0;
  function Form() {
    useLanguageScope(null);
    const [draft] = useState("preserved");
    useEffect(() => { mounts++; }, []);
    return createElement("form", null, createElement("input", { value: draft }),
      createElement(LanguageSelector, { labelKey: "auth.language" }));
  }
  let renderer!: ReactTestRenderer;
  await act(async () => { renderer = create(createElement(LanguageProvider, { storage, storageKeyPrefix: "selector" }, createElement(Form))); });
  const telugu = () => renderer.root.findAllByType("button").find(button => button.props.lang === "te")!;
  assert.equal(telugu().props.type, "button");
  assert.equal(telugu().props["aria-pressed"], false);
  await act(async () => { await telugu().props.onClick(); });
  assert.equal(telugu().props["aria-pressed"], true);
  assert.equal(renderer.root.findByType("section").props.lang, "te");
  assert.equal(renderer.root.findAllByType("span")[0].children.join(""), "సైన్-ఇన్ భాష");
  assert.equal(renderer.root.findByType("input").props.value, "preserved");
  assert.equal(mounts, 1);
  await act(async () => { renderer.unmount(); });
});
