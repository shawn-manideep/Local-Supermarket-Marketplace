import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
const commerceTables = [
  "customer_addresses", "stores", "store_service_pincodes", "carts",
  "cart_items", "orders", "order_items", "order_status_history",
];
const catalogTables = [
  "master_categories", "master_products", "categories", "products", "product_variants",
];
export function originFromEnv() {
  const domain = process.env.REPLIT_DEV_DOMAIN?.trim();
  if (!domain) throw new Error("managed development domain is unavailable");
  const parsed = new URL(/^https?:\/\//i.test(domain) ? domain : `https://${domain}`);
  if (parsed.protocol !== "https:" || /localhost|127\.0\.0\.1/i.test(parsed.hostname)) {
    throw new Error("managed development origin is not an HTTPS workspace domain");
  }
  return parsed.origin;
}
export function makePool(root) {
  if (!process.env.SUPABASE_DB_URL) throw new Error("development database is unavailable");
  const require = createRequire(path.join(root, "lib/db/package.json"));
  const { Pool } = require("pg");
  return new Pool({ connectionString: process.env.SUPABASE_DB_URL, max: 1, connectionTimeoutMillis: 6000, query_timeout: 10000, statement_timeout: 10000 });
}
const candidateText = (candidate) => `${candidate.email} ${JSON.stringify(candidate.metadata ?? {})}`.toLowerCase();
export async function discoverAccounts(pool) {
  const { rows } = await pool.query(`SELECT u.id, u.email, coalesce(u.raw_user_meta_data, '{}'::jsonb) AS metadata,
    p.role::text AS role FROM auth.users u INNER JOIN public.user_profiles p ON p.id = u.id
    WHERE lower(coalesce(u.email, '') || ' ' || coalesce(u.raw_user_meta_data::text, ''))
      ~ 'phase[[:space:]_-]*12|qa|test|dev' ORDER BY u.created_at ASC, u.id ASC`);
  const choose = (role, marker) => {
    const eligible = rows.filter((row) => row.role === role);
    const account = eligible.find((row) => marker.test(candidateText(row))) ??
      (eligible.length === 1 ? eligible[0] : undefined);
    if (!account) throw new Error("dedicated QA role identity could not be identified");
    return account;
  };
  return {
    admin: choose("admin", /(^|[^a-z0-9])admin(?:$|[^a-z0-9])/),
    vendorB: choose("vendor", /vendor[\s_.-]*b(?:$|[^a-z0-9])|(^|[^a-z0-9])b[\s_.-]*vendor(?:$|[^a-z0-9])/),
    customerB: choose("customer", /customer[\s_.-]*b(?:$|[^a-z0-9])|(^|[^a-z0-9])b[\s_.-]*customer(?:$|[^a-z0-9])/),
  };
}
export async function verifyFixtures(pool, accounts) {
  const [stores, addresses] = await Promise.all([
    pool.query("SELECT id, name, status FROM public.stores WHERE owner_user_id = $1", [accounts.vendorB.id]),
    pool.query("SELECT pincode FROM public.customer_addresses WHERE customer_id = $1", [accounts.customerB.id]),
  ]);
  if (stores.rows.length !== 1 || stores.rows[0].name !== "Development Store B" || stores.rows[0].status !== "ACTIVE") {
    throw new Error("QA vendor store fixture did not match the documented active Store B");
  }
  const service = await pool.query("SELECT 1 FROM public.store_service_pincodes WHERE store_id = $1 AND pincode = '560001'", [stores.rows[0].id]);
  if (!service.rowCount || !addresses.rows.some((row) => row.pincode === "560001")) {
    throw new Error("QA Customer B / Store B saved-pincode fixture did not match");
  }
  return { storeId: stores.rows[0].id, storeName: stores.rows[0].name };
}
export async function snapshotCommerce(pool) {
  return snapshotTables(pool, commerceTables);
}
export async function snapshotCatalog(pool) {
  return snapshotTables(pool, catalogTables);
}
export async function snapshotTables(pool, tables) {
  const snapshots = new Map();
  for (const table of tables) {
    const { rows } = await pool.query(`SELECT id::text, to_jsonb(t)::text AS row FROM public.${table} t ORDER BY id`);
    snapshots.set(table, new Map(rows.map((row) => [row.id, row.row])));
  }
  return snapshots;
}
export function originalRowsUnchanged(before, after, allowedChanges = new Map()) {
  return [...before].every(([table, rows]) => {
    const current = after.get(table);
    if (!current) return false;
    const allowed = allowedChanges.get(table) ?? new Set();
    return [...rows].every(([id, data]) => allowed.has(id) || current.get(id) === data);
  });
}
export function originalRowsChangedOnlyIn(beforeRows, afterRows, allowedFieldsById) {
  return [...beforeRows].every(([id, beforeText]) => {
    const afterText = afterRows.get(id);
    if (!afterText) return false;
    const allowedFields = allowedFieldsById.get(id) ?? new Set();
    if (!allowedFields.size) return beforeText === afterText;
    let before, after;
    try {
      before = JSON.parse(beforeText);
      after = JSON.parse(afterText);
    } catch {
      return false;
    }
    const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
    for (const key of keys) {
      if (allowedFields.has(key)) continue;
      if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) return false;
    }
    return true;
  });
}
export async function eligibleStoreIds(pool, pincode) {
  const { rows } = await pool.query(
    `SELECT s.id::text AS id
     FROM public.stores s
     INNER JOIN public.store_service_pincodes sp ON sp.store_id = s.id
     WHERE s.status = 'ACTIVE' AND sp.pincode = $1
     ORDER BY s.id`,
    [pincode],
  );
  return new Set(rows.map((row) => row.id));
}
export async function discoverPriorHarnessMasters(pool, storeId) {
  const { rows } = await pool.query(
    `SELECT m.id::text AS id, m.name, m.is_active AS is_active,
            EXISTS (
              SELECT 1 FROM public.products p
              WHERE p.master_product_id = m.id AND p.store_id = $1
            ) AS has_store_b_mapping
     FROM public.master_products m
     WHERE m.master_category_id IS NULL
       AND m.name ~* '^Qorvellan [0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       AND lower(coalesce(m.brand, '')) = lower('Xylomarven ' || substring(m.name FROM 11))
       AND lower(coalesce(m.description, '')) = lower('Zethricwall ' || substring(m.name FROM 11))
       AND lower(coalesce(m.attributes->>'details', '')) =
           lower('Trinquillion ' || substring(m.name FROM 11))
     ORDER BY m.created_at, m.id`,
    [storeId],
  );
  return rows;
}
export function record(checks, name, passed) {
  checks.push({ name, passed: Boolean(passed) });
  if (!passed) throw new Error(name);
}
export const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
export const quote = (value) => JSON.stringify(value);
export async function inputValue(browser, page, selector) {
  return browser.evaluate(page, `document.querySelector(${quote(selector)})?.value ?? null`);
}
export async function searchVendor(browser, page, query) {
  await browser.fillSelector(page, "#master-product-search", query);
  await browser.wait(page, `document.querySelector('#master-product-search')?.value === ${quote(query)}`, 5000);
  await wait(700);
  const ready = await browser.wait(page, `!document.querySelector('.vendor-master-skeleton') &&
    !document.querySelector('[aria-label="Loading master catalog"]') &&
    (document.querySelectorAll('[data-testid^="card-master-product-"]').length > 0 ||
     document.querySelector('.vendor-master-catalog .vendor-empty-state'))`, 15000);
  await wait(200);
  const result = await browser.evaluate(page, `(() => ({
    count: document.querySelectorAll('[data-testid^="card-master-product-"]').length,
    category: document.querySelector('#master-category-filter')?.value ?? null,
    pagination: document.querySelector('.vendor-master-pagination')?.innerText ?? '',
    names: Array.from(document.querySelectorAll('[data-testid^="card-master-product-"] h3'))
      .map(element => element.innerText.trim()),
  }))()`);
  return { ready, ...result };
}
export async function findButtonPoint(browser, page, text, scopeExpression) {
  const expression = `Array.from((${scopeExpression}).querySelectorAll('button,[role="button"]'))
    .find(e => (e.innerText || e.getAttribute('aria-label') || '').trim() === ${quote(text)})`;
  return browser.rect(page, expression, true);
}
export async function readOnlyPreflight(chromePath, root) {
  const result = {
    mode: "read-only preflight", browserExecutableAvailable: false,
    managedHttpsOriginAvailable: false, databaseFixturesVerified: false,
    configuredQaPasswords: {
      admin: Boolean(process.env.ADMIN_PASSWORD || process.env.PHASE12_ADMIN_PASSWORD),
      vendorB: Boolean(process.env.VENDOR_B_PASSWORD || process.env.PHASE12_VENDOR_B_PASSWORD),
      customerB: Boolean(process.env.CUSTOMER_B_PASSWORD || process.env.PHASE12_CUSTOMER_B_PASSWORD),
    },
  };
  try { await import("node:fs/promises").then(({ access }) => access(chromePath)); result.browserExecutableAvailable = true; } catch {}
  try { originFromEnv(); result.managedHttpsOriginAvailable = true; } catch {}
  let pool;
  try {
      pool = makePool(root);
    await verifyFixtures(pool, await discoverAccounts(pool));
    result.databaseFixturesVerified = true;
  } catch {
    result.databaseFixturesVerified = false;
  } finally {
    if (pool) await Promise.race([pool.end().catch(() => {}), new Promise((resolve) => setTimeout(resolve, 2000))]);
  }
  process.stdout.write(`${JSON.stringify(result)}\n`);
}
export class BrowserCDP {
  constructor(executable, userDataDir) {
    const env = Object.fromEntries(
      Object.entries(process.env).filter(([key]) =>
        !/(PASS(?:WORD)?|SECRET|TOKEN|(?:^|_)KEY(?:_|$)|CREDENTIAL|SUPABASE|DATABASE_URL|SERVICE_ROLE|ANON|AUTH)/i.test(key)),
    );
    this.child = spawn(executable, [
      "--headless=new", "--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage",
      "--no-first-run", "--no-default-browser-check", "--remote-debugging-pipe",
      `--user-data-dir=${userDataDir}`, "about:blank",
    ], { stdio: ["ignore", "ignore", "ignore", "pipe", "pipe"], env });
    this.nextId = 0;
    this.pending = new Map();
    this.handlers = new Map();
    this.buffer = "";
    this.child.stdio[4].setEncoding("utf8");
    this.child.stdio[4].on("data", (chunk) => this.read(chunk));
    this.child.on("error", () => this.failAll("process error"));
    this.child.on("exit", () => this.failAll("process exited"));
    this.child.stdio[4].on("error", () => this.failAll("debug pipe error"));
    this.child.stdio[4].on("close", () => this.failAll("debug pipe closed"));
  }
  read(chunk) {
    this.buffer += chunk;
    let split;
    while ((split = this.buffer.indexOf("\0")) >= 0) {
      const line = this.buffer.slice(0, split);
      this.buffer = this.buffer.slice(split + 1);
      let message;
      try { message = JSON.parse(line); } catch { continue; }
      if (message.id) {
        const pending = this.pending.get(message.id);
        if (!pending) continue;
        this.pending.delete(message.id);
        message.error ? pending.reject(new Error(`Chrome DevTools ${pending.method} request failed.`)) : pending.resolve(message.result);
      } else {
        for (const handler of this.handlers.get(`${message.sessionId ?? ""}:${message.method}`) ?? []) {
          try { handler(message.params ?? {}); } catch { /* Browser event observers stay isolated. */ }
        }
      }
    }
  }
  failAll(reason) {
    for (const request of this.pending.values()) request.reject(new Error(`Chrome DevTools ${request.method} ${reason}.`));
    this.pending.clear();
  }
  send(method, params = {}, sessionId, timeoutMs = 15000) {
    const id = ++this.nextId;
    const message = { id, method, params, ...(sessionId ? { sessionId } : {}) };
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.pending.delete(id)) reject(new Error(`Chrome DevTools ${method} timed out.`));
      }, timeoutMs);
      this.pending.set(id, {
        method,
        resolve: (result) => { clearTimeout(timer); resolve(result); },
        reject: (error) => { clearTimeout(timer); reject(error); },
      });
      try {
        this.child.stdio[3].write(`${JSON.stringify(message)}\0`, (error) => {
          if (!error) return;
          this.pending.delete(id);
          clearTimeout(timer);
          reject(new Error(`Chrome DevTools ${method} pipe is unavailable.`));
        });
      } catch {
        this.pending.delete(id);
        clearTimeout(timer);
        reject(new Error(`Chrome DevTools ${method} pipe is unavailable.`));
      }
    });
  }
  on(sessionId, method, handler) {
    const key = `${sessionId ?? ""}:${method}`;
    this.handlers.set(key, [...(this.handlers.get(key) ?? []), handler]);
  }
  async context(url, width = 1440, height = 1000, preload = "") {
    const { browserContextId } = await this.send("Target.createBrowserContext", { disposeOnDetach: true });
    const { targetId } = await this.send("Target.createTarget", { url: "about:blank", browserContextId });
    const { sessionId } = await this.send("Target.attachToTarget", { targetId, flatten: true });
    const page = { browserContextId, targetId, sessionId };
    this.on(sessionId, "Page.javascriptDialogOpening", () => {
      void this.send("Page.handleJavaScriptDialog", { accept: true }, sessionId).catch(() => {});
    });
    await this.send("Page.enable", {}, sessionId);
    await this.send("Runtime.enable", {}, sessionId);
    await this.send("Emulation.setDeviceMetricsOverride", {
      width, height, deviceScaleFactor: 1, mobile: false,
    }, sessionId);
    if (preload) await this.send("Page.addScriptToEvaluateOnNewDocument", { source: preload }, sessionId);
    await this.send("Page.navigate", { url }, sessionId);
    return page;
  }
  async evaluate(page, expression) {
    const result = await this.send("Runtime.evaluate", {
      expression, awaitPromise: true, returnByValue: true, userGesture: true,
    }, page.sessionId);
    if (result.exceptionDetails) throw new Error("Browser page evaluation failed.");
    return result.result?.value;
  }
  async wait(page, expression, timeout = 20000) {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      if (await this.evaluate(page, expression)) return true;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    return false;
  }
  async rect(page, expression, scroll = false) {
    if (scroll) await this.evaluate(page, `(() => { const e = ${expression}; e?.scrollIntoView({ behavior: "instant", block: "center", inline: "nearest" }); return !!e; })()`);
    return this.evaluate(page, `(() => {
      const e = ${expression};
      if (!e) return null;
      const r = e.getBoundingClientRect();
      return r.width && r.height ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null;
    })()`);
  }
  async clickAt(page, point) {
    if (!point) throw new Error("Expected browser control was not visible.");
    await this.send("Input.dispatchMouseEvent", { type: "mousePressed", x: point.x, y: point.y, button: "left", clickCount: 1 }, page.sessionId);
    await this.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: point.x, y: point.y, button: "left", clickCount: 1 }, page.sessionId);
  }

  async clickSelector(page, selector) {
    await this.clickAt(page, await this.rect(page, `document.querySelector(${JSON.stringify(selector)})`, true));
  }
  async clickText(page, text, scope = "document") {
    const find = `Array.from((${scope}).querySelectorAll('button,[role="button"],[role="tab"],input[type="submit"]'))
      .find(e => (e.innerText || e.value || e.getAttribute('aria-label') || '').trim() === ${JSON.stringify(text)})`;
    await this.clickAt(page, await this.rect(page, find, true));
  }
  async key(page, key, modifiers = 0) {
    const codes = {
      Enter: 13, Tab: 9, Home: 36, End: 35, ArrowDown: 40, ArrowUp: 38,
      Escape: 27, Backspace: 8, Delete: 46,
    };
    const code = codes[key] ?? (key.length === 1 ? key.toUpperCase().charCodeAt(0) : 0);
    await this.send("Input.dispatchKeyEvent", {
      type: "keyDown", key, code: codes[key] ? key : key.length === 1 ? `Key${key.toUpperCase()}` : key,
      windowsVirtualKeyCode: code, ...(key.length === 1 && !modifiers ? { text: key } : {}), modifiers,
    }, page.sessionId);
    await this.send("Input.dispatchKeyEvent", {
      type: "keyUp", key, code: codes[key] ? key : key.length === 1 ? `Key${key.toUpperCase()}` : key,
      windowsVirtualKeyCode: code, modifiers,
    }, page.sessionId);
  }
  async fillSelector(page, selector, value) {
    await this.clickSelector(page, selector);
    const focused = await this.evaluate(page, `(() => {
      const e = document.querySelector(${JSON.stringify(selector)});
      if (!e || e.disabled) return false;
      e.focus({ preventScroll: true });
      return document.activeElement === e;
    })()`);
    if (!focused) throw new Error("Expected browser input could not receive focus.");
    await this.key(page, "a", 2);
    if (value === "") await this.key(page, "Backspace");
    else await this.send("Input.insertText", { text: value }, page.sessionId);
  }

  async selectSelector(page, selector, value) {
    const point = await this.rect(page, `document.querySelector(${quote(selector)})`, true);
    if (!point) throw new Error("Expected select control was not visible.");
    await this.clickAt(page, point);
    const index = await this.evaluate(page, `(() => {
      const control = document.querySelector(${quote(selector)});
      return control ? Array.from(control.options).findIndex(option => option.value === ${quote(value)}) : -1;
    })()`);
    if (index < 0) throw new Error("Expected select option was not present.");
    await this.key(page, "Home");
    for (let offset = 0; offset < index; offset += 1) await this.key(page, "ArrowDown");
    await this.key(page, "Enter");
  }

  async fillLabel(page, label, value) {
    const expr = `Array.from(document.querySelectorAll('label')).find(e => e.innerText.trim().startsWith(${JSON.stringify(label)}))?.querySelector('input,textarea,select')`;
    const point = await this.rect(page, expr, true);
    if (!point) throw new Error("Expected labeled form control was not visible.");
    const selector = await this.evaluate(page, `(() => {
      const el = ${expr}; if (!el) return null;
      return Array.from(document.querySelectorAll('input,textarea,select')).indexOf(el);
    })()`);
    const actual = `Array.from(document.querySelectorAll('input,textarea,select'))[${selector}]`;
    await this.clickAt(page, point);
    const tag = await this.evaluate(page, `${actual}.tagName`);
    if (tag === "SELECT") {
      const index = await this.evaluate(page, `Array.from(${actual}.options).findIndex(o => o.value === ${JSON.stringify(value)})`);
      if (index < 0) throw new Error("Expected select option was not present.");
      await this.key(page, "Home");
      for (let i = 0; i < index; i += 1) await this.key(page, "ArrowDown");
      await this.key(page, "Enter");
      return;
    }
    await this.key(page, "a", 2);
    await this.send("Input.insertText", { text: value }, page.sessionId);
  }

  async screenshot(page, filePath, fullPage = false) {
    const result = await this.send("Page.captureScreenshot", {
      format: "png", fromSurface: true, captureBeyondViewport: fullPage,
    }, page.sessionId);
    const { writeFile } = await import("node:fs/promises");
    await writeFile(filePath, Buffer.from(result.data, "base64"));
  }
  async close() {
    try { this.child.kill("SIGTERM"); } catch { /* Already closed. */ }
    await Promise.race([new Promise((resolve) => this.child.once("exit", resolve)), new Promise((resolve) => setTimeout(resolve, 1500))]);
    if (this.child.exitCode === null) {
      try { this.child.kill("SIGKILL"); } catch { /* Process already exited. */ }
      await Promise.race([new Promise((resolve) => this.child.once("exit", resolve)), new Promise((resolve) => setTimeout(resolve, 500))]);
    }
  }
}