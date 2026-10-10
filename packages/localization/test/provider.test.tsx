import assert from "node:assert/strict";
import test from "node:test";
import { createElement, useEffect, useState } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { LanguageProvider, useLanguageScope, useTranslation } from "../src/provider";
import type { LanguageStorage } from "../src/preference";
import { localizeCustomerMessage } from "../src/customer-message";
import { translate } from "../src/translation";

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
    const [selectedAddress] = useState("original-address");
    const [orderStatus] = useState("PLACED");
    const [message] = useState("Use a valid six-digit Indian pincode");
    useEffect(() => { mounts++; return () => { unmounts++; }; }, []);
    return createElement("section", { "data-cart-count": cartCount, "data-destination": destination, "data-address": selectedAddress, "data-order-status": orderStatus },
      createElement("p", null, t("customer.language")),
      createElement("output", null, localizeCustomerMessage(message, t)),
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
  assert.equal(renderer.root.findByType("section").props["data-address"], "original-address");
  assert.equal(renderer.root.findByType("section").props["data-order-status"], "PLACED");
  assert.equal(renderer.root.findByType("output").children.join(""), translate("te", "service.pincode"));
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

