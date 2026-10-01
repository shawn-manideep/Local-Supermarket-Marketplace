import { createHash, randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import { createClient } from "@supabase/supabase-js";
import {
  carts,
  cartItems,
  categories,
  customerAddresses,
  customers,
  getDb,
  getPool,
  masterCategories,
  masterMappingAudit,
  masterProducts,
  orderItems,
  orderStatusHistory,
  orders,
  productVariants,
  products,
  storeServicePincodes,
  stores,
  userProfiles,
} from "@workspace/db";
import { and, desc, eq, inArray } from "drizzle-orm";
import test from "node:test";
import { createApp, observeIntegrationErrors, type IntegrationErrorDiagnostic } from "../app.js";

const integrationEnabled = process.env.RUN_MASTER_CATALOG_INTEGRATION === "1";
const customerSearchOnly = integrationEnabled && process.env.MASTER_CATALOG_SEARCH_ONLY === "1";

type Candidate = {
  id: string;
  email: string;
  metadata: Record<string, unknown>;
  role: "admin" | "vendor" | "customer";
  createdAt: string;
};

type Actor = {
  token: string;
  userId: string;
};

type HttpResult = {
  status: number;
  json: Record<string, unknown> | null;
};

type Snapshot = {
  name: string;
  table: any;
  ids: string[];
  hash: string;
};

class AcceptanceFailure extends Error {}

function verify(condition: unknown, message: string) {
  checkCount += 1;
  if (!condition) {
    failureCount += 1;
    assertionFailureCount += 1;
    throw new AcceptanceFailure(message);
  }
  assertionPassCount += 1;
}

let checkCount = 0;
let failureCount = 0;
let assertionFailureCount = 0;
let assertionPassCount = 0;

function resultObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

async function apiRequest(
  baseUrl: string,
  actor: Actor,
  path: string,
  options: { method?: string; body?: unknown } = {},
): Promise<HttpResult> {
  const response = await fetch(new URL(path, baseUrl), {
    method: options.method ?? "GET",
    headers: {
      Authorization: `Bearer ${actor.token}`,
      ...(options.body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  });
  const text = await response.text();
  let json: Record<string, unknown> | null = null;
  try {
    json = resultObject(JSON.parse(text));
  } catch {
    // Error responses are not included in acceptance output.
  }
  return { status: response.status, json };
}

function expectStatus(result: HttpResult, expected: number, label: string) {
  verify(
    result.status === expected,
    `${label}: expected HTTP ${expected}, received HTTP ${result.status}`,
  );
}

function verifyNoPrivateCatalogFields(value: unknown, label: string) {
  const forbidden = new Set(["sku", "externalCode", "stockQuantity", "createdAt", "updatedAt"]);
  const visit = (candidate: unknown): boolean => {
    if (Array.isArray(candidate)) return candidate.every(visit);
    if (!candidate || typeof candidate !== "object") return true;
    return Object.entries(candidate).every(([key, child]) =>
      !forbidden.has(key) && visit(child));
  };
  verify(visit(value), `${label}: customer response exposed an internal catalog field`);
}

function sanitizedDatabaseMessage(message: string | undefined) {
  if (!message) return "unavailable";
  return message
    .replace(/(?:postgres(?:ql)?|https?):\/\/[^\s"'`]+/gi, "[connection redacted]")
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[email redacted]")
    .replace(/\b[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}\b/gi, "[id redacted]")
    .replace(/\b(?:server|host(?:name)?|socket|database)\s+"[^"]+"/gi, "[connection detail redacted]")
    .replace(/\b(?:port)\s*[:=]?\s*\d+\b/gi, "[connection detail redacted]")
    .replace(/\b(?:password|secret|token|service[_ -]?role[_ -]?key|anon[_ -]?key)\b\s*[:=]\s*[^,\s;]+/gi, "[credential redacted]")
    .replace(/invalid input syntax for type ([^:]+):\s*("[^"]*"|'[^']*')/gi, "invalid input syntax for type $1: [value redacted]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 300);
}

function sanitizedPgCode(code: string | undefined) {
  return code && /^[0-9A-Z]{5}$/.test(code) ? code : "unavailable";
}

function stableHash(rows: Record<string, unknown>[]) {
  return createHash("sha256").update(JSON.stringify(rows)).digest("hex");
}

async function readRows(table: any, ids?: string[]) {
  if (ids && ids.length === 0) return [] as Record<string, unknown>[];
  const query = getDb().select().from(table);
  const rows = ids
    ? await query.where(inArray(table.id, ids)).orderBy(table.id)
    : await query.orderBy(table.id);
  return rows as Record<string, unknown>[];
}

async function snapshotExistingCommerce(): Promise<Snapshot[]> {
  const tables = [
    ["user profiles", userProfiles],
    ["customers", customers],
    ["customer addresses", customerAddresses],
    ["stores", stores],
    ["store service pincodes", storeServicePincodes],
    ["master categories", masterCategories],
    ["master products", masterProducts],
    ["store categories", categories],
    ["store products", products],
    ["product variants", productVariants],
    ["carts", carts],
    ["cart items", cartItems],
    ["orders", orders],
    ["order items", orderItems],
    ["order status history", orderStatusHistory],
    ["master mapping audit", masterMappingAudit],
  ] as const;

  try {
    const snapshots: Snapshot[] = [];
    for (const [name, table] of tables) {
      const rows = await readRows(table);
      snapshots.push({
        name,
        table,
        ids: rows.map((row) => String(row.id)),
        hash: stableHash(rows),
      });
    }
    return snapshots;
  } catch {
    throw new Error(
      "Could not snapshot existing commerce/catalog rows using the configured development database.",
    );
  }
}

async function verifySnapshotUnchanged(snapshots: Snapshot[]) {
  for (const snapshot of snapshots) {
    let current: Record<string, unknown>[];
    try {
      current = await readRows(snapshot.table, snapshot.ids);
    } catch {
      verify(false, `Could not re-read the baseline ${snapshot.name} snapshot`);
      return;
    }
    verify(
      current.length === snapshot.ids.length && stableHash(current) === snapshot.hash,
      `Pre-existing ${snapshot.name} rows changed during the acceptance run`,
    );
  }
}

function metadataText(candidate: Candidate) {
  return `${candidate.email} ${JSON.stringify(candidate.metadata)}`.toLocaleLowerCase("en");
}

function selectDedicatedAccounts(candidates: Candidate[]) {
  const isDevQaAccount = (candidate: Candidate) =>
    /(^|[^a-z0-9])(?:phase[\s_-]*12|qa|test|dev)(?:$|[^a-z0-9])/.test(metadataText(candidate));
  const byRole = (role: Candidate["role"]) => candidates
    .filter((candidate) => candidate.role === role)
    .sort((left, right) =>
      left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id));
  const preferLabel = (
    rows: Candidate[],
    pattern: RegExp,
    excluded: Set<string>,
  ) => {
    const eligible = rows.filter(isDevQaAccount);
    const labeled = eligible.find((row) => !excluded.has(row.id) && pattern.test(metadataText(row)));
    return labeled ?? eligible.find((row) => !excluded.has(row.id));
  };

  const admins = byRole("admin");
  const vendors = byRole("vendor");
  const customers = byRole("customer");
  const usedVendorIds = new Set<string>();
  const usedCustomerIds = new Set<string>();
  const admin = preferLabel(admins, /(^|[^a-z0-9])admin(?:$|[^a-z0-9])/, new Set());
  const vendorA = preferLabel(vendors, /vendor[\s_.-]*a(?:$|[^a-z0-9])|(^|[^a-z0-9])a[\s_.-]*vendor(?:$|[^a-z0-9])/, usedVendorIds);
  if (vendorA) usedVendorIds.add(vendorA.id);
  const vendorB = preferLabel(vendors, /vendor[\s_.-]*b(?:$|[^a-z0-9])|(^|[^a-z0-9])b[\s_.-]*vendor(?:$|[^a-z0-9])/, usedVendorIds);
  if (vendorB) usedVendorIds.add(vendorB.id);
  const customerA = preferLabel(customers, /customer[\s_.-]*a(?:$|[^a-z0-9])|(^|[^a-z0-9])a[\s_.-]*customer(?:$|[^a-z0-9])/, usedCustomerIds);
  if (customerA) usedCustomerIds.add(customerA.id);
  const customerB = preferLabel(customers, /customer[\s_.-]*b(?:$|[^a-z0-9])|(^|[^a-z0-9])b[\s_.-]*customer(?:$|[^a-z0-9])/, usedCustomerIds);

  const missing = [
    !admin && "admin",
    !vendorA && "vendor A",
    !vendorB && "vendor B",
    !customerA && "customer A",
    !customerB && "customer B",
  ].filter(Boolean);
  if (missing.length) {
    throw new Error(
      `Could not identify verified development QA ${missing.join(", ")} auth user(s) from role-specific QA/test/dev or PHASE12 email/metadata markers. Only explicitly QA-marked identities are eligible; no arbitrary users, account creation, or resets are used.`,
    );
  }
  return { admin: admin!, vendorA: vendorA!, vendorB: vendorB!, customerA: customerA!, customerB: customerB! };
}

async function discoverDedicatedAccounts(): Promise<Candidate[]> {
  try {
    const result = await getPool().query<{
      id: string;
      email: string;
      metadata: Record<string, unknown> | null;
      role: Candidate["role"];
      created_at: Date | string;
    }>(`
      SELECT u.id, u.email, u.raw_user_meta_data AS metadata,
             p.role::text AS role, u.created_at
      FROM auth.users AS u
      INNER JOIN public.user_profiles AS p ON p.id = u.id
      WHERE lower(coalesce(u.email, '') || ' ' || coalesce(u.raw_user_meta_data::text, '')) ~ 'phase[[:space:]_-]*12'
         OR (
           lower(coalesce(u.email, '') || ' ' || coalesce(u.raw_user_meta_data::text, '')) ~ 'qa|test|dev'
           AND (
             (p.role::text = 'admin' AND lower(coalesce(u.email, '') || ' ' || coalesce(u.raw_user_meta_data::text, '')) ~ 'admin')
             OR (p.role::text = 'vendor' AND lower(coalesce(u.email, '') || ' ' || coalesce(u.raw_user_meta_data::text, '')) ~ 'vendor[._ -]*[ab]')
             OR (p.role::text = 'customer' AND lower(coalesce(u.email, '') || ' ' || coalesce(u.raw_user_meta_data::text, '')) ~ 'customer[._ -]*[ab]')
           )
         )
      ORDER BY u.created_at ASC, u.id ASC
    `);
    return result.rows.map((row) => ({
      id: row.id,
      email: row.email,
      metadata: row.metadata ?? {},
      role: row.role,
      createdAt: new Date(row.created_at).toISOString(),
    }));
  } catch {
    throw new Error(
      "Could not discover development QA/PHASE12 auth users through auth.users joined to public.user_profiles; verify SUPABASE_DB_URL and database connectivity. No accounts were changed.",
    );
  }
}

async function signIn(
  supabaseUrl: string,
  anonKey: string,
  candidate: Candidate,
  password: string,
  passwordKey: string,
  accountLabel: string,
  serviceRoleKey?: string,
): Promise<Actor> {
  const client = createClient(supabaseUrl, anonKey, {
    auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false },
  });
  let safeReason = "Supabase authentication request failed";
  try {
    const { data, error } = await client.auth.signInWithPassword({
      email: candidate.email,
      password,
    });
    if (error) {
      const status = typeof error.status === "number" ? ` HTTP ${error.status}` : "";
      const code = typeof error.code === "string" && /^[a-z0-9_-]+$/i.test(error.code)
        ? ` (${error.code})`
        : "";
      safeReason = `Supabase rejected sign-in${status}${code}`;
      if (
        accountLabel === "vendor A" &&
        status === " HTTP 400" &&
        code === " (invalid_credentials)" &&
        serviceRoleKey
      ) {
        try {
          return await verifiedVendorAMagicLink(supabaseUrl, anonKey, serviceRoleKey, candidate);
        } catch (fallbackError) {
          safeReason = fallbackError instanceof Error
            ? fallbackError.message
            : "authorized existing-account magic-link fallback was rejected";
        }
      }
      throw new Error("authentication rejected");
    }
    if (!data.user || !data.session?.access_token || data.user.id !== candidate.id) {
      safeReason = "authenticated identity did not match the database-verified QA profile";
      throw new Error("identity mismatch");
    }
    return { token: data.session.access_token, userId: data.user.id };
  } catch {
    throw new Error(
      `${passwordKey} could not authenticate the selected verified development QA ${accountLabel} account (${safeReason}). Credentials were not reset and no account was created.`,
    );
  }
}

async function verifiedVendorAMagicLink(
  supabaseUrl: string,
  anonKey: string,
  serviceRoleKey: string,
  candidate: Candidate,
): Promise<Actor> {
  try {
    const prequeried = await getPool().query<{ id: string; email: string; role: string }>(`
      SELECT u.id, u.email, p.role::text AS role
      FROM auth.users AS u
      INNER JOIN public.user_profiles AS p ON p.id = u.id
      WHERE u.id = $1
        AND u.email = $2
        AND p.role::text = 'vendor'
        AND lower(coalesce(u.email, '') || ' ' || coalesce(u.raw_user_meta_data::text, '')) ~ 'qa|test|dev|phase[[:space:]_-]*12'
        AND lower(coalesce(u.email, '') || ' ' || coalesce(u.raw_user_meta_data::text, '')) ~ 'vendor[._ -]*a'
    `, [candidate.id, candidate.email]);
    if (
      prequeried.rows.length !== 1 ||
      prequeried.rows[0].id !== candidate.id ||
      prequeried.rows[0].email !== candidate.email ||
      prequeried.rows[0].role !== "vendor"
    ) {
      throw new Error("QA identity ID/email preflight mismatch; no provider session was requested");
    }

    const serviceClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false },
    });
    const lookup = await serviceClient.auth.admin.getUserById(candidate.id);
    if (
      lookup.error ||
      lookup.data.user?.id !== candidate.id ||
      lookup.data.user.email?.toLocaleLowerCase("en") !== candidate.email.toLocaleLowerCase("en")
    ) {
      throw new Error("Supabase existing-user ID/email verification rejected");
    }

    const generated = await serviceClient.auth.admin.generateLink({
      type: "magiclink",
      email: candidate.email,
    });
    if (
      generated.error ||
      generated.data.user.id !== candidate.id ||
      generated.data.user.email?.toLocaleLowerCase("en") !== candidate.email.toLocaleLowerCase("en") ||
      typeof generated.data.properties.hashed_token !== "string"
    ) {
      throw new Error("Supabase did not generate a magic link for the verified existing account");
    }

    const sessionClient = createClient(supabaseUrl, anonKey, {
      auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false },
    });
    const verified = await sessionClient.auth.verifyOtp({
      type: "magiclink",
      token_hash: generated.data.properties.hashed_token,
    });
    if (
      verified.error ||
      verified.data.user?.id !== candidate.id ||
      !verified.data.session?.access_token
    ) {
      throw new Error("Supabase did not return a short-lived session for the verified QA account");
    }

    process.stdout.write("Vendor A: one verified existing-account short-lived development magic-link session used.\n");
    return { token: verified.data.session.access_token, userId: verified.data.user.id };
  } catch (error) {
    if (error instanceof Error && error.message.includes("QA identity ID/email preflight mismatch")) {
      throw error;
    }
    throw new Error(
      "Authorized development magic-link fallback failed at provider or exact-identity verification; no password, account, profile, address, or store change was attempted.",
    );
  }
}

async function verifyDevelopmentQaFixtures(
  vendorAUserId: string,
  vendorBUserId: string,
  customerAUserId: string,
  customerBUserId: string,
): Promise<{ customerAPincode: string; customerBPincode: string }> {
  try {
    const [[storeA, storeB], [addressesA, addressesB]] = await Promise.all([
      getDb().select().from(stores).where(inArray(stores.ownerUserId, [vendorAUserId, vendorBUserId])),
      Promise.all([
        getDb().select().from(customerAddresses).where(eq(customerAddresses.customerId, customerAUserId)),
        getDb().select().from(customerAddresses).where(eq(customerAddresses.customerId, customerBUserId)),
      ]),
    ]);
    const byOwner = new Map([
      [storeA?.ownerUserId, storeA],
      [storeB?.ownerUserId, storeB],
    ]);
    const developmentStoreA = byOwner.get(vendorAUserId);
    const developmentStoreB = byOwner.get(vendorBUserId);
    const [pinsA, pinsB] = await Promise.all([
      developmentStoreA
        ? getDb().select().from(storeServicePincodes).where(eq(storeServicePincodes.storeId, developmentStoreA.id))
        : Promise.resolve([] as (typeof storeServicePincodes.$inferSelect)[]),
      developmentStoreB
        ? getDb().select().from(storeServicePincodes).where(eq(storeServicePincodes.storeId, developmentStoreB.id))
        : Promise.resolve([] as (typeof storeServicePincodes.$inferSelect)[]),
    ]);
    const validStoreA = developmentStoreA?.name === "Development Store A" &&
      developmentStoreA.status === "ACTIVE" &&
      pinsA.some((pin) => pin.pincode === "400001");
    const validStoreB = developmentStoreB?.name === "Development Store B" &&
      developmentStoreB.status === "ACTIVE" &&
      pinsB.some((pin) => pin.pincode === "560001");
    const validCustomerA = addressesA.some((address) => address.pincode === "400001");
    const validCustomerB = addressesB.some((address) => address.pincode === "560001");
    if (!validStoreA || !validStoreB || !validCustomerA || !validCustomerB) {
      throw new Error(
        "The selected QA-marked identities did not match the prior DEV QA fixture evidence (Customer A / Development Store A / 400001; Customer B / Development Store B / 560001). No accounts, addresses, stores, or service areas were changed.",
      );
    }
    verify(true, "read-only DB evidence matches the documented DEV QA customer/store ownership and saved pincodes");
    return { customerAPincode: "400001", customerBPincode: "560001" };
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("The selected QA-marked")) throw error;
    throw new Error(
      "Could not verify role-linked DEV QA store/address fixtures from the configured development database.",
    );
  }
}

function requirePayload<T>(result: HttpResult, key: string, label: string): T {
  const value = result.json?.[key];
  verify(value !== undefined && value !== null, `${label}: response omitted ${key}`);
  return value as T;
}

test("dev-only authenticated Master Catalog HTTP acceptance", {
  skip: integrationEnabled
    ? false
    : "Set RUN_MASTER_CATALOG_INTEGRATION=1 to run against verified development QA accounts.",
}, async () => {
  const searchOnly = customerSearchOnly;
  checkCount = 0;
  failureCount = 0;
  assertionFailureCount = 0;
  assertionPassCount = 0;

  let primaryFailure: unknown;
  let server: ReturnType<ReturnType<typeof createApp>["listen"]> | undefined;
  let removeIntegrationErrorObserver: (() => void) | undefined;
  let baseline: Snapshot[] = [];
  const createdMasterProductIds = new Set<string>();
  const createdStoreListings = new Map<string, { actor: Actor; productId: string }>();
  let createdCategoryId: string | undefined;
  let admin: Actor | undefined;
  let vendorA: Actor | undefined;
  let vendorB: Actor | undefined;
  let customerA: Actor | undefined;
  let customerB: Actor | undefined;
  let testPincodes: { customerAPincode: string; customerBPincode: string } | undefined;
  let mainMasterProductId: string | undefined;
  let referenceMasterProductId: string | undefined;
  let categoryName: string | undefined;
  let referenceName: string | undefined;
  let productName: string | undefined;
  let uniqueSuffix = "";

  try {
    const passwordKeys = [
      "PHASE12_ADMIN_PASSWORD",
      "PHASE12_VENDOR_A_PASSWORD",
      "PHASE12_VENDOR_B_PASSWORD",
      "PHASE12_CUSTOMER_A_PASSWORD",
      "PHASE12_CUSTOMER_B_PASSWORD",
    ] as const;
    const missingPasswords = passwordKeys.filter((key) => !process.env[key]);
    verify(
      missingPasswords.length === 0,
      `Missing required dedicated development password environment key(s): ${missingPasswords.join(", ")}`,
    );
    const supabaseUrl = process.env.SUPABASE_URL;
    const anonKey = process.env.SUPABASE_ANON_KEY;
    verify(Boolean(supabaseUrl && anonKey), "SUPABASE_URL and SUPABASE_ANON_KEY are required for authenticated HTTP verification");

    const accounts = selectDedicatedAccounts(await discoverDedicatedAccounts());
    testPincodes = await verifyDevelopmentQaFixtures(
      accounts.vendorA.id,
      accounts.vendorB.id,
      accounts.customerA.id,
      accounts.customerB.id,
    );
    const passwordMap = {
      admin: process.env.PHASE12_ADMIN_PASSWORD!,
      vendorA: process.env.PHASE12_VENDOR_A_PASSWORD!,
      vendorB: process.env.PHASE12_VENDOR_B_PASSWORD!,
      customerA: process.env.PHASE12_CUSTOMER_A_PASSWORD!,
      customerB: process.env.PHASE12_CUSTOMER_B_PASSWORD!,
    };
    const signInResults = await Promise.allSettled([
      signIn(supabaseUrl!, anonKey!, accounts.admin, passwordMap.admin, "PHASE12_ADMIN_PASSWORD", "admin"),
      signIn(
        supabaseUrl!,
        anonKey!,
        accounts.vendorA,
        passwordMap.vendorA,
        "PHASE12_VENDOR_A_PASSWORD",
        "vendor A",
        process.env.SUPABASE_SERVICE_ROLE_KEY,
      ),
      signIn(supabaseUrl!, anonKey!, accounts.vendorB, passwordMap.vendorB, "PHASE12_VENDOR_B_PASSWORD", "vendor B"),
      signIn(supabaseUrl!, anonKey!, accounts.customerA, passwordMap.customerA, "PHASE12_CUSTOMER_A_PASSWORD", "customer A"),
      signIn(supabaseUrl!, anonKey!, accounts.customerB, passwordMap.customerB, "PHASE12_CUSTOMER_B_PASSWORD", "customer B"),
    ]);
    const signInFailures = signInResults.flatMap((result) =>
      result.status === "rejected"
        ? [result.reason instanceof Error ? result.reason.message : "A dedicated QA auth request failed."]
        : []);
    if (signInFailures.length) {
      throw new Error(`Dedicated QA authentication blockers: ${signInFailures.join("; ")}`);
    }
    [admin, vendorA, vendorB, customerA, customerB] = signInResults.map((result) =>
      result.status === "fulfilled" ? result.value : undefined) as [Actor, Actor, Actor, Actor, Actor];
    verify(Boolean(customerB.token), "Dedicated development QA customer B did not receive an authenticated session");

    const vendorStores = await getDb().select().from(stores)
      .where(inArray(stores.ownerUserId, [vendorA.userId, vendorB.userId]));
    const storeA = vendorStores.find((store) => store.ownerUserId === vendorA!.userId)!;
    const storeB = vendorStores.find((store) => store.ownerUserId === vendorB!.userId)!;

    baseline = await snapshotExistingCommerce();
    const app = createApp();
    server = app.listen(0, "127.0.0.1");
    await new Promise<void>((resolve, reject) => {
      server!.once("listening", resolve);
      server!.once("error", reject);
    });
    const address = server.address() as AddressInfo;
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const customerSearchFailures: string[] = [];
    const pgDiagnostics: IntegrationErrorDiagnostic[] = [];
    let pgDiagnosticPrinted = false;
    removeIntegrationErrorObserver = observeIntegrationErrors((diagnostic) => {
      pgDiagnostics.push(diagnostic);
    });
    const customerRequest = async (actor: Actor, path: string, label: string) => {
      try {
        const result = await apiRequest(baseUrl, actor, path);
        if (result.status === 500 && !pgDiagnosticPrinted && pgDiagnostics.length) {
          const diagnostic = pgDiagnostics[0];
          process.stdout.write(
            `Sanitized customer query PG cause: code=${sanitizedPgCode(diagnostic.causeCode)} message=${sanitizedDatabaseMessage(diagnostic.causeMessage)}\n`,
          );
          pgDiagnosticPrinted = true;
        }
        expectStatus(result, 200, label);
        return result;
      } catch (error) {
        if (error instanceof AcceptanceFailure) {
          customerSearchFailures.push(error.message);
          return null;
        }
        throw error;
      }
    };
    const customerPayload = <T>(result: HttpResult, key: string, label: string): T | null => {
      try {
        return requirePayload<T>(result, key, label);
      } catch (error) {
        if (error instanceof AcceptanceFailure) {
          customerSearchFailures.push(error.message);
          return null;
        }
        throw error;
      }
    };
    const searchCustomerOffers = async (actor: Actor, pincode: string, label: string) => {
      const result = await customerRequest(
        actor,
        `/api/customer/products?pincode=${encodeURIComponent(pincode)}&search=${encodeURIComponent(uniqueSuffix)}`,
        label,
      );
      return result ? customerPayload<Array<Record<string, unknown>>>(result, "products", label) : null;
    };

    const uniqueId = randomUUID();
    uniqueSuffix = uniqueId;
    categoryName = `TEST Phase12 ${uniqueId} Grocery`;
    referenceName = `TEST Phase12 ${uniqueId} Reference Item`;
    productName = `TEST Phase12 ${uniqueId} Reviewed Item`;
    const categoryResult = await apiRequest(baseUrl, admin, "/api/admin/master-categories", {
      method: "POST",
      body: { name: categoryName },
    });
    expectStatus(categoryResult, 201, "admin creates test master category");
    const category = requirePayload<{ id: string }>(categoryResult, "category", "admin creates test master category");
    createdCategoryId = category.id;

    const canonicalInput = {
      masterCategoryId: createdCategoryId,
      name: productName,
      description: "Acceptance fixture product",
      image: null,
      brand: `Phase12-${uniqueId}`,
      attributes: { family: uniqueId, packRole: "retail product family" },
    };
    if (searchOnly) {
      const created = await apiRequest(baseUrl, admin, "/api/admin/master-products", {
        method: "POST",
        body: canonicalInput,
      });
      expectStatus(created, 201, "admin creates narrow customer-search master product");
      const masterProduct = requirePayload<{ id: string; name: string }>(created, "product", "narrow customer-search master product");
      mainMasterProductId = masterProduct.id;
      createdMasterProductIds.add(masterProduct.id);
    } else {
      const referenceResult = await apiRequest(baseUrl, admin, "/api/admin/master-products", {
        method: "POST",
        body: {
          masterCategoryId: createdCategoryId,
          name: referenceName,
          description: "Acceptance fixture reference",
          image: null,
          brand: `Phase12-${uniqueId}`,
          attributes: { family: uniqueId },
        },
      });
      expectStatus(referenceResult, 201, "admin creates canonical reference master product");
      const reference = requirePayload<{ id: string }>(referenceResult, "product", "admin creates canonical reference master product");
      referenceMasterProductId = reference.id;
      createdMasterProductIds.add(reference.id);

      const duplicateCheck = await apiRequest(baseUrl, vendorA, "/api/vendor/master-products/duplicate-check", {
        method: "POST",
        body: canonicalInput,
      });
      expectStatus(duplicateCheck, 200, "vendor performs global canonical duplicate check");
      const matches = requirePayload<Array<Record<string, unknown>>>(duplicateCheck, "matches", "duplicate check");
      verify(
        matches.some((match) => match.id === referenceMasterProductId),
        "duplicate check did not surface the existing related canonical candidate for review",
      );
      const reviewToken = duplicateCheck.json?.duplicateReviewToken;
      verify(typeof reviewToken === "string" && reviewToken.length >= 32, "duplicate check did not issue a canonical review token");

      const reviewedCreate = await apiRequest(baseUrl, vendorA, "/api/vendor/master-products", {
        method: "POST",
        body: { ...canonicalInput, confirmedNoMatch: true, duplicateReviewToken: reviewToken },
      });
      expectStatus(reviewedCreate, 201, "vendor creates canonical product after reviewed duplicate check");
      const masterProduct = requirePayload<{ id: string; name: string }>(reviewedCreate, "product", "reviewed canonical creation");
      mainMasterProductId = masterProduct.id;
      createdMasterProductIds.add(masterProduct.id);
      verify(masterProduct.name === productName, "reviewed creation did not preserve canonical product identity");

      for (const duplicateName of [productName, productName.toLocaleUpperCase("en")]) {
        const duplicate = await apiRequest(baseUrl, admin, "/api/admin/master-products", {
          method: "POST",
          body: { ...canonicalInput, name: duplicateName },
        });
        expectStatus(duplicate, 409, "admin exact/case-normalized canonical duplicate is rejected");
      }
      const reviewedExactDuplicateCheck = await apiRequest(
        baseUrl,
        vendorB,
        "/api/vendor/master-products/duplicate-check",
        { method: "POST", body: canonicalInput },
      );
      expectStatus(reviewedExactDuplicateCheck, 200, "second vendor reviews existing exact canonical product");
      const exactMatches = requirePayload<Array<Record<string, unknown>>>(
        reviewedExactDuplicateCheck,
        "matches",
        "exact duplicate review",
      );
      verify(
        exactMatches.some((match) => match.id === mainMasterProductId && match.exactIdentity === true),
        "exact canonical identity was not marked as a duplicate candidate",
      );
      const exactReviewToken = reviewedExactDuplicateCheck.json?.duplicateReviewToken;
      verify(typeof exactReviewToken === "string", "exact duplicate review did not issue a review token");
      const vendorExactDuplicate = await apiRequest(baseUrl, vendorB, "/api/vendor/master-products", {
        method: "POST",
        body: { ...canonicalInput, confirmedNoMatch: true, duplicateReviewToken: exactReviewToken },
      });
      expectStatus(vendorExactDuplicate, 409, "vendor canonical creation rejects an exact duplicate after review");

      const vendorSearch = await apiRequest(
        baseUrl,
        vendorA,
        `/api/vendor/master-products?search=${encodeURIComponent(uniqueSuffix)}`,
      );
      expectStatus(vendorSearch, 200, "vendor global master search without category filter");
      const vendorSearchProducts = requirePayload<Array<Record<string, unknown>>>(
        vendorSearch,
        "products",
        "global vendor search",
      );
      verify(
        vendorSearchProducts.some((item) => item.id === mainMasterProductId),
        "global vendor search did not find the test master product without a category filter",
      );
    }

    const addPath = `/api/vendor/master-products/${mainMasterProductId}/add-to-store`;
    const [addA1, addA2] = await Promise.all([
      apiRequest(baseUrl, vendorA, addPath, { method: "POST", body: {} }),
      apiRequest(baseUrl, vendorA, addPath, { method: "POST", body: {} }),
    ]);
    verify(
      [200, 201].includes(addA1.status) && [200, 201].includes(addA2.status),
      `concurrent vendor A additions should return HTTP 200/201, received ${addA1.status}/${addA2.status}`,
    );
    const listingA1 = requirePayload<Record<string, unknown>>(addA1, "product", "first concurrent vendor A addition");
    const listingA2 = requirePayload<Record<string, unknown>>(addA2, "product", "second concurrent vendor A addition");
    const listingAId = String(listingA1.id);
    verify(listingAId === listingA2.id, "concurrent vendor A add did not return one idempotent store listing");
    verify(addA1.status !== addA2.status, "concurrent vendor A adds did not distinguish created from reused listing");
    createdStoreListings.set(listingAId, { actor: vendorA, productId: listingAId });
    const initialVariantsA = listingA1.variants;
    verify(Array.isArray(initialVariantsA) && initialVariantsA.length === 0, "new vendor A listing synthesized a default selling variant");

    const addB = await apiRequest(baseUrl, vendorB, addPath, { method: "POST", body: {} });
    expectStatus(addB, 201, "vendor B adds the same master product to its own store");
    const listingB = requirePayload<Record<string, unknown>>(addB, "product", "vendor B addition");
    const listingBId = String(listingB.id);
    createdStoreListings.set(listingBId, { actor: vendorB, productId: listingBId });
    verify(listingBId !== listingAId, "vendor B listing was not isolated from vendor A's listing");
    verify(listingB.masterProductId === mainMasterProductId, "vendor B listing lost its master product relationship");
    verify(Array.isArray(listingB.variants) && listingB.variants.length === 0, "new vendor B listing synthesized a default selling variant");

    const vendorAvariants = [
      { name: "500 g pouch", quantityValue: 500, quantityUnit: "g", price: 42.5, stockQuantity: 18, availability: true, isActive: true, sku: null, externalCode: null, sortOrder: 0 },
      { name: "1 kg pouch", quantityValue: 1, quantityUnit: "kg", price: 79.25, stockQuantity: 12, availability: true, isActive: true, sku: null, externalCode: null, sortOrder: 1 },
      { name: "6-bottle pack", quantityValue: 6, quantityUnit: "bottle", price: 89.25, stockQuantity: 11, availability: true, isActive: true, sku: null, externalCode: null, sortOrder: 2 },
      { name: "12-bottle box", quantityValue: 12, quantityUnit: "box", price: 150.75, stockQuantity: 6, availability: true, isActive: true, sku: null, externalCode: null, sortOrder: 3 },
    ];
    if (searchOnly) {
      vendorAvariants.push({
        name: "Zero-stock acceptance pack",
        quantityValue: 1,
        quantityUnit: "pack",
        price: 1,
        stockQuantity: 0,
        availability: true,
        isActive: true,
        sku: null,
        externalCode: null,
        sortOrder: vendorAvariants.length,
      });
    }
    const vendorBvariants = [
      { name: "750 g pouch", quantityValue: 750, quantityUnit: "g", price: 63, stockQuantity: 7, availability: true, isActive: true, sku: null, externalCode: null, sortOrder: 0 },
      { name: "2 kg pouch", quantityValue: 2, quantityUnit: "kg", price: 159.5, stockQuantity: 5, availability: true, isActive: true, sku: null, externalCode: null, sortOrder: 1 },
      { name: "4-bottle pack", quantityValue: 4, quantityUnit: "bottle", price: 104.5, stockQuantity: 3, availability: true, isActive: true, sku: null, externalCode: null, sortOrder: 2 },
      { name: "24-bottle box", quantityValue: 24, quantityUnit: "box", price: 270, stockQuantity: 2, availability: true, isActive: true, sku: null, externalCode: null, sortOrder: 3 },
    ];
    const variantIdsByStore = new Map<string, string[]>();
    const commercialValuesByStore = new Map<string, Array<{ price: string; stockQuantity: number }>>();
    for (const [vendor, listingId, fixtures, label] of [
      [vendorA, listingAId, vendorAvariants, "vendor A"],
      [vendorB, listingBId, vendorBvariants, "vendor B"],
    ] as const) {
      const ids: string[] = [];
      const commercialValues: Array<{ price: string; stockQuantity: number }> = [];
      for (const fixture of fixtures) {
        const created = await apiRequest(baseUrl, vendor, `/api/vendor/products/${listingId}/variants`, {
          method: "POST",
          body: fixture,
        });
        expectStatus(created, 201, `${label} configures a real bottle/box selling variant`);
        const variant = requirePayload<{
          id: string;
          quantityUnit: string;
          price: string;
          stockQuantity: number;
        }>(created, "variant", `${label} variant creation`);
        ids.push(variant.id);
        verify(variant.quantityUnit === fixture.quantityUnit, `${label} did not preserve the ${fixture.quantityUnit} selling unit`);
        verify(
          variant.price === fixture.price.toFixed(2) && variant.stockQuantity === fixture.stockQuantity,
          `${label} did not persist its independently configured variant price and stock`,
        );
        commercialValues.push({ price: variant.price, stockQuantity: variant.stockQuantity });
      }
      variantIdsByStore.set(listingId, ids);
      commercialValuesByStore.set(listingId, commercialValues);
      const availability = await apiRequest(baseUrl, vendor, `/api/vendor/products/${listingId}/availability`, {
        method: "PATCH",
        body: { availability: true },
      });
      expectStatus(availability, 200, `${label} configures listing availability`);
      if (searchOnly) {
        const updated = requirePayload<Record<string, unknown>>(availability, "product", `${label} availability update`);
        verify(updated.availability === true, `${label} parent product availability was not enabled before activation`);
      }
      const activated = await apiRequest(baseUrl, vendor, `/api/vendor/products/${listingId}/activate`, { method: "POST" });
      expectStatus(activated, 200, `${label} activates configured store listing`);
      if (searchOnly) {
        const updated = requirePayload<Record<string, unknown>>(activated, "product", `${label} activation`);
        verify(updated.isActive === true, `${label} product was not active after activation`);
      }
    }
    verify(
      commercialValuesByStore.get(listingAId)!.some((variantA) =>
        commercialValuesByStore.get(listingBId)!.every((variantB) =>
          variantA.price !== variantB.price || variantA.stockQuantity !== variantB.stockQuantity)),
      "vendor A and B do not retain independent variant prices and stock quantities",
    );
    const vendorBVariantStateBefore = await getDb().select({
      id: productVariants.id,
      availability: productVariants.availability,
      isActive: productVariants.isActive,
      stockQuantity: productVariants.stockQuantity,
      price: productVariants.price,
    }).from(productVariants).where(eq(productVariants.productId, listingBId));
    vendorBVariantStateBefore.sort((left, right) => left.id.localeCompare(right.id));
    verify(
      vendorBVariantStateBefore.length === vendorBvariants.length &&
      vendorBVariantStateBefore.every((variant) => variant.availability === true),
      "vendor B test variants were not configured available before the unauthorized cross-store write",
    );
    const crossReadA = await apiRequest(baseUrl, vendorA, `/api/vendor/products/${listingBId}`);
    expectStatus(crossReadA, 404, "vendor A cannot read vendor B product");
    const crossWriteA = await apiRequest(baseUrl, vendorA, `/api/vendor/products/${listingBId}/availability`, {
      method: "PATCH",
      body: { availability: false },
    });
    expectStatus(crossWriteA, 404, "vendor A cannot change vendor B product availability");
    const vendorBVariantStateAfter = await getDb().select({
      id: productVariants.id,
      availability: productVariants.availability,
      isActive: productVariants.isActive,
      stockQuantity: productVariants.stockQuantity,
      price: productVariants.price,
    }).from(productVariants).where(eq(productVariants.productId, listingBId));
    vendorBVariantStateAfter.sort((left, right) => left.id.localeCompare(right.id));
    verify(
      JSON.stringify(vendorBVariantStateAfter) === JSON.stringify(vendorBVariantStateBefore),
      "unauthorized vendor A availability write changed vendor B variant availability, stock, price, activity, or identity",
    );
    const crossReadB = await apiRequest(baseUrl, vendorB, `/api/vendor/products/${listingAId}`);
    expectStatus(crossReadB, 404, "vendor B cannot read vendor A product");
    const roleDenied = await apiRequest(baseUrl, vendorA, "/api/admin/master-categories");
    expectStatus(roleDenied, 403, "vendor cannot access admin master catalog");
    const customerDenied = await apiRequest(baseUrl, customerA, "/api/vendor/master-categories");
    expectStatus(customerDenied, 403, "customer cannot access vendor master catalog");

    if (searchOnly) {
      const recordSearchCheck = (condition: unknown, label: string) => {
        checkCount += 1;
        if (condition) {
          assertionPassCount += 1;
        } else {
          assertionFailureCount += 1;
          failureCount += 1;
          customerSearchFailures.push(label);
        }
      };
      const requestStoreProducts = async (actor: Actor, storeId: string, pincode: string, label: string) => {
        const result = await customerRequest(
          actor,
          `/api/customer/stores/${storeId}/products?pincode=${encodeURIComponent(pincode)}&search=${encodeURIComponent(uniqueSuffix)}`,
          label,
        );
        return result
          ? customerPayload<Array<Record<string, unknown>>>(result, "products", label)
          : null;
      };
      const requestStoreProductDetail = async (
        actor: Actor,
        storeId: string,
        productId: string,
        pincode: string,
        label: string,
      ) => {
        const result = await customerRequest(
          actor,
          `/api/customer/stores/${storeId}/products/${productId}?pincode=${encodeURIComponent(pincode)}`,
          label,
        );
        return result
          ? customerPayload<Record<string, unknown>>(result, "product", label)
          : null;
      };
      const offersA = await searchCustomerOffers(
        customerA,
        testPincodes!.customerAPincode,
        "Customer A global offer search",
      );
      const offersB = await searchCustomerOffers(
        customerB,
        testPincodes!.customerBPincode,
        "Customer B global offer search",
      );
      const storeOffersA = await requestStoreProducts(
        customerA,
        storeA.id,
        testPincodes!.customerAPincode,
        "Customer A store-product search",
      );
      const storeOffersB = await requestStoreProducts(
        customerB,
        storeB.id,
        testPincodes!.customerBPincode,
        "Customer B store-product search",
      );
      const detailA = await requestStoreProductDetail(
        customerA,
        storeA.id,
        listingAId,
        testPincodes!.customerAPincode,
        "Customer A store-product detail",
      );
      const detailB = await requestStoreProductDetail(
        customerB,
        storeB.id,
        listingBId,
        testPincodes!.customerBPincode,
        "Customer B store-product detail",
      );

      const globalOfferA = offersA?.find((offer) => offer.id === listingAId && offer.storeId === storeA.id);
      const globalOfferB = offersB?.find((offer) => offer.id === listingBId && offer.storeId === storeB.id);
      const storeOfferA = storeOffersA?.find((offer) => offer.id === listingAId);
      const storeOfferB = storeOffersB?.find((offer) => offer.id === listingBId);
      recordSearchCheck(Boolean(globalOfferA && !offersA?.some((offer) => offer.id === listingBId)), "Customer A global search did not isolate the 400001 Store A offer");
      recordSearchCheck(Boolean(globalOfferB && !offersB?.some((offer) => offer.id === listingAId)), "Customer B global search did not isolate the 560001 Store B offer");
      recordSearchCheck(Boolean(storeOfferA && !storeOffersA?.some((offer) => offer.id === listingBId)), "Customer A store search did not return its own listing only");
      recordSearchCheck(Boolean(storeOfferB && !storeOffersB?.some((offer) => offer.id === listingAId)), "Customer B store search did not return its own listing only");
      recordSearchCheck(detailA?.id === listingAId, "Customer A detail route did not return the requested Store A listing");
      recordSearchCheck(detailB?.id === listingBId, "Customer B detail route did not return the requested Store B listing");

      for (const [product, label] of [
        [globalOfferA, "Customer A global offer"],
        [globalOfferB, "Customer B global offer"],
        [storeOfferA, "Customer A store offer"],
        [storeOfferB, "Customer B store offer"],
        [detailA, "Customer A detail"],
        [detailB, "Customer B detail"],
      ] as const) {
        if (!product) continue;
        try {
          verifyNoPrivateCatalogFields(product, label);
        } catch (error) {
          if (error instanceof AcceptanceFailure) customerSearchFailures.push(error.message);
          else throw error;
        }
      }

      const variantsA = globalOfferA && Array.isArray(globalOfferA.variants)
        ? globalOfferA.variants.map(resultObject)
        : [];
      const variantsB = globalOfferB && Array.isArray(globalOfferB.variants)
        ? globalOfferB.variants.map(resultObject)
        : [];
      recordSearchCheck(globalOfferA?.availability === true && globalOfferB?.availability === true, "Customer projections did not retain the explicitly enabled parent availability");
      recordSearchCheck(globalOfferA?.purchasable === true && globalOfferB?.purchasable === true, "Customer projections did not mark configured positive-stock listings purchasable");
      for (const [variants, fixtures, label] of [
        [variantsA, vendorAvariants, "Customer A"],
        [variantsB, vendorBvariants, "Customer B"],
      ] as const) {
        for (const fixture of fixtures) {
          const variant = variants.find((item) => item.name === fixture.name);
          const expectedPurchasable = fixture.stockQuantity > 0;
          recordSearchCheck(
            Boolean(variant) &&
            variant!.availability === true &&
            variant!.isActive === true &&
            variant!.purchasable === expectedPurchasable &&
            variant!.price === fixture.price.toFixed(2) &&
            variant!.quantityValue === fixture.quantityValue.toFixed(3) &&
            variant!.quantityUnit === fixture.quantityUnit,
            `${label} customer variant projection flags or commercial fields did not match its configured fixture`,
          );
        }
      }
      const priceSignatureA = variantsA.map((variant) => String(variant.price)).sort().join("|");
      const priceSignatureB = variantsB.map((variant) => String(variant.price)).sort().join("|");
      recordSearchCheck(priceSignatureA !== priceSignatureB, "Customer pincode projections did not preserve independent vendor pricing");
      recordSearchCheck(
        Boolean(detailA?.availability === true && detailA.purchasable === true) &&
        Boolean(detailB?.availability === true && detailB.purchasable === true),
        "Customer detail projections did not retain parent availability and purchasability",
      );

      const [parents, variants] = await Promise.all([
        getDb().select({
          id: products.id,
          availability: products.availability,
          isActive: products.isActive,
        }).from(products).where(inArray(products.id, [listingAId, listingBId])),
        getDb().select({
          productId: productVariants.productId,
          availability: productVariants.availability,
          isActive: productVariants.isActive,
          stockQuantity: productVariants.stockQuantity,
        }).from(productVariants).where(inArray(productVariants.productId, [listingAId, listingBId])),
      ]);
      const parentA = parents.find((parent) => parent.id === listingAId);
      const parentB = parents.find((parent) => parent.id === listingBId);
      const variantsForA = variants.filter((variant) => variant.productId === listingAId);
      const variantsForB = variants.filter((variant) => variant.productId === listingBId);
      const projectionFlags = {
        customerA: {
          parentAvailabilityTrue: parentA?.availability === true,
          parentActiveTrue: parentA?.isActive === true,
          activeAvailablePositiveStockVariant: variantsForA.some((variant) =>
            variant.isActive === true && variant.availability === true && variant.stockQuantity > 0),
          activeAvailableZeroStockVariant: variantsForA.some((variant) =>
            variant.isActive === true && variant.availability === true && variant.stockQuantity === 0),
          globalPurchasableTrue: globalOfferA?.purchasable === true,
          zeroStockVariantPurchasableFalse: variantsA.some((variant) =>
            variant.name === "Zero-stock acceptance pack" && variant.purchasable === false),
        },
        customerB: {
          parentAvailabilityTrue: parentB?.availability === true,
          parentActiveTrue: parentB?.isActive === true,
          activeAvailablePositiveStockVariant: variantsForB.some((variant) =>
            variant.isActive === true && variant.availability === true && variant.stockQuantity > 0),
          activeAvailableZeroStockVariant: variantsForB.some((variant) =>
            variant.isActive === true && variant.availability === true && variant.stockQuantity === 0),
          globalPurchasableTrue: globalOfferB?.purchasable === true,
          zeroStockVariantPurchasableFalse: true,
        },
      };
      process.stdout.write(`Sanitized customer projection flags: ${JSON.stringify(projectionFlags)}\n`);
      recordSearchCheck(
        projectionFlags.customerA.parentAvailabilityTrue &&
        projectionFlags.customerA.parentActiveTrue &&
        projectionFlags.customerA.activeAvailablePositiveStockVariant &&
        projectionFlags.customerA.zeroStockVariantPurchasableFalse &&
        projectionFlags.customerB.parentAvailabilityTrue &&
        projectionFlags.customerB.parentActiveTrue &&
        projectionFlags.customerB.activeAvailablePositiveStockVariant,
        "Read-only projection-state flags did not match the documented customer purchasability contract",
      );
      if (customerSearchFailures.length) {
        throw new AcceptanceFailure(`Narrow customer search checks failed: ${customerSearchFailures.join("; ")}`);
      }
    } else {
    const listA = await apiRequest(baseUrl, vendorA, "/api/vendor/products");
    expectStatus(listA, 200, "vendor A reads owned store products");
    const productsA = requirePayload<Array<Record<string, unknown>>>(listA, "products", "vendor A product list");
    verify(
      productsA.filter((item) => item.masterProductId === mainMasterProductId && item.isActive === true).length === 1,
      "vendor A does not have exactly one active listing for the master product",
    );
    const listB = await apiRequest(baseUrl, vendorB, "/api/vendor/products");
    expectStatus(listB, 200, "vendor B reads owned store products");
    const productsB = requirePayload<Array<Record<string, unknown>>>(listB, "products", "vendor B product list");
    verify(
      productsB.filter((item) => item.masterProductId === mainMasterProductId && item.isActive === true).length === 1,
      "vendor B does not have exactly one active listing for the master product",
    );

    const mappingReason = "PHASE12 acceptance mapping audit check";
    const mapping = await apiRequest(baseUrl, admin, `/api/admin/products/${listingAId}/master-mapping`, {
      method: "PATCH",
      body: { masterProductId: referenceMasterProductId, reason: mappingReason },
    });
    expectStatus(mapping, 200, "admin corrects mapping on its generated listing");
    const mappingProduct = requirePayload<Record<string, unknown>>(mapping, "product", "admin mapping correction");
    verify(mappingProduct.masterProductId === referenceMasterProductId, "admin mapping response did not apply the requested identity");
    const firstAudit = await getDb().select().from(masterMappingAudit)
      .where(eq(masterMappingAudit.productId, listingAId))
      .orderBy(desc(masterMappingAudit.createdAt))
      .limit(1);
    verify(
      firstAudit[0]?.previousMasterProductId === mainMasterProductId &&
      firstAudit[0]?.masterProductId === referenceMasterProductId &&
      firstAudit[0]?.actorUserId === admin.userId &&
      firstAudit[0]?.reason === mappingReason,
      "admin mapping correction did not persist previous/current identity, actor, and reason in its audit record",
    );
    const restoreMapping = await apiRequest(baseUrl, admin, `/api/admin/products/${listingAId}/master-mapping`, {
      method: "PATCH",
      body: { masterProductId: mainMasterProductId, reason: "PHASE12 acceptance restores generated listing mapping" },
    });
    expectStatus(restoreMapping, 200, "admin restores generated listing mapping");
    const restoredProduct = requirePayload<Record<string, unknown>>(restoreMapping, "product", "restored admin mapping");
    verify(restoredProduct.masterProductId === mainMasterProductId, "generated listing was not restored to its canonical master identity");

    const deactivateA = await apiRequest(baseUrl, vendorA, `/api/vendor/products/${listingAId}/deactivate`, { method: "POST" });
    expectStatus(deactivateA, 200, "vendor A removes listing by deactivation");
    const readdA = await apiRequest(baseUrl, vendorA, addPath, { method: "POST", body: {} });
    expectStatus(readdA, 200, "vendor A re-adds existing master listing");
    const readdedProduct = requirePayload<Record<string, unknown>>(readdA, "product", "vendor A re-add");
    verify(readdedProduct.id === listingAId, "re-adding after deactivation created a different store product ID");
    const readdedVariants = readdedProduct.variants;
    verify(
      Array.isArray(readdedVariants) &&
      readdedVariants.length === vendorAvariants.length &&
      variantIdsByStore.get(listingAId)!.every((id) =>
        readdedVariants.some((variant) => resultObject(variant).id === id)),
      "re-adding the same listing did not preserve its existing variant identities",
    );
    const reactivateA = await apiRequest(baseUrl, vendorA, `/api/vendor/products/${listingAId}/activate`, { method: "POST" });
    expectStatus(reactivateA, 200, "vendor A activates the retained listing");

    const offersA = await searchCustomerOffers(customerA, testPincodes!.customerAPincode, "Customer A global search uses owned saved pincode without category filter");
    const offersB = await searchCustomerOffers(customerB, testPincodes!.customerBPincode, "Customer B global search uses owned saved pincode without category filter");
    if (offersA && offersB) {
      const offerA = offersA.find((offer) => offer.storeId === storeA.id && offer.id === listingAId);
      const offerB = offersB.find((offer) => offer.storeId === storeB.id && offer.id === listingBId);
      verify(Boolean(offerA && !offersA.some((offer) => offer.id === listingBId)), "Customer A did not receive only the applicable Store A offer at 400001");
      verify(Boolean(offerB && !offersB.some((offer) => offer.id === listingAId)), "Customer B did not receive only the applicable Store B offer at 560001");
      verify(offerA!.purchasable === true && offerB!.purchasable === true, "customer search did not mark configured in-stock offers as purchasable");
      verifyNoPrivateCatalogFields(offerA, "vendor A customer offer");
      verifyNoPrivateCatalogFields(offerB, "vendor B customer offer");
      const publicVariantsA = offerA!.variants as Array<Record<string, unknown>>;
      const publicVariantsB = offerB!.variants as Array<Record<string, unknown>>;
      for (const [offersForStore, fixtures, label] of [
        [publicVariantsA, vendorAvariants, "vendor A"],
        [publicVariantsB, vendorBvariants, "vendor B"],
      ] as const) {
        verify(offersForStore.length === fixtures.length, `${label} customer offer omitted or added a selling variant`);
        for (const fixture of fixtures) {
          const variant = offersForStore.find((item) => item.name === fixture.name);
          verify(Boolean(variant), `${label} customer offer omitted ${fixture.name}`);
          verify(
            variant!.price === fixture.price.toFixed(2) &&
            variant!.quantityValue === fixture.quantityValue.toFixed(3) &&
            variant!.quantityUnit === fixture.quantityUnit &&
            variant!.purchasable === true,
            `${label} customer offer did not preserve its independent price, count, unit, and availability`,
          );
        }
      }
      verify(
        !offersA.some((offer) => offer.storeId !== storeA.id) &&
        !offersB.some((offer) => offer.storeId !== storeB.id),
        "customer global discovery returned an offer from a store outside the saved-pincode-eligible DEV QA store",
      );
    }

    const archiveMaster = await apiRequest(baseUrl, admin, `/api/admin/master-products/${mainMasterProductId}/archive`, {
      method: "POST",
    });
    expectStatus(archiveMaster, 200, "admin archives generated master product");
    const blockedByProductArchive = await apiRequest(baseUrl, vendorB, addPath, { method: "POST", body: {} });
    expectStatus(blockedByProductArchive, 404, "archived master product blocks new vendor selection");
    const archivedProductOffersA = await searchCustomerOffers(
      customerA,
      testPincodes!.customerAPincode,
      "Customer A search remains available after master product archive",
    );
    const archivedProductOffersB = await searchCustomerOffers(
      customerB,
      testPincodes!.customerBPincode,
      "Customer B search remains available after master product archive",
    );
    if (archivedProductOffersA && archivedProductOffersB) {
      verify(
        archivedProductOffersA.some((offer) => offer.id === listingAId) &&
        !archivedProductOffersA.some((offer) => offer.id === listingBId) &&
        archivedProductOffersB.some((offer) => offer.id === listingBId) &&
        !archivedProductOffersB.some((offer) => offer.id === listingAId),
        "archiving a master product removed existing store selling eligibility",
      );
    }

    const unarchiveMaster = await apiRequest(baseUrl, admin, `/api/admin/master-products/${mainMasterProductId}/unarchive`, {
      method: "POST",
    });
    expectStatus(unarchiveMaster, 200, "admin unarchives generated master product for category lifecycle check");
    const archiveCategory = await apiRequest(baseUrl, admin, `/api/admin/master-categories/${createdCategoryId}/archive`, {
      method: "POST",
    });
    expectStatus(archiveCategory, 200, "admin archives generated master category");
    const blockedByCategoryArchive = await apiRequest(baseUrl, vendorB, addPath, { method: "POST", body: {} });
    expectStatus(blockedByCategoryArchive, 404, "archived master category blocks new vendor selection");
    const archivedCategoryOffersA = await searchCustomerOffers(
      customerA,
      testPincodes!.customerAPincode,
      "Customer A search remains available after master category archive",
    );
    const archivedCategoryOffersB = await searchCustomerOffers(
      customerB,
      testPincodes!.customerBPincode,
      "Customer B search remains available after master category archive",
    );
    if (archivedCategoryOffersA && archivedCategoryOffersB) {
      verify(
        archivedCategoryOffersA.some((offer) => offer.id === listingAId) &&
        !archivedCategoryOffersA.some((offer) => offer.id === listingBId) &&
        archivedCategoryOffersB.some((offer) => offer.id === listingBId) &&
        !archivedCategoryOffersB.some((offer) => offer.id === listingAId),
        "archiving a master category removed existing store selling eligibility",
      );
    }

    const absentDeleteProduct = await apiRequest(
      baseUrl,
      admin,
      `/api/admin/master-products/${randomUUID()}`,
      { method: "DELETE" },
    );
    expectStatus(absentDeleteProduct, 404, "master product physical delete endpoint is absent");
    const absentDeleteCategory = await apiRequest(
      baseUrl,
      admin,
      `/api/admin/master-categories/${randomUUID()}`,
      { method: "DELETE" },
    );
    expectStatus(absentDeleteCategory, 404, "master category physical delete endpoint is absent");
    if (customerSearchFailures.length) {
      throw new AcceptanceFailure(`Customer discovery checks failed: ${customerSearchFailures.join("; ")}`);
    }
    }
  } catch (error) {
    primaryFailure = error;
    if (!(error instanceof AcceptanceFailure)) failureCount += 1;
  } finally {
    const baseAddress = server?.address();
    const baseUrl = baseAddress && typeof baseAddress !== "string"
      ? `http://127.0.0.1:${baseAddress.port}`
      : undefined;
    if (baseUrl) {
      if (admin && uniqueSuffix) {
        try {
          if (createdCategoryNameMissing(createdCategoryId, categoryName)) {
            const result = await apiRequest(baseUrl, admin, "/api/admin/master-categories");
            if (result.status === 200) {
              const categories = result.json?.categories;
              if (Array.isArray(categories)) {
                for (const candidate of categories) {
                  const row = resultObject(candidate);
                  if (row.name === categoryName && typeof row.id === "string") {
                    createdCategoryId = row.id;
                  }
                }
              }
            }
          }
          const result = await apiRequest(
            baseUrl,
            admin,
            `/api/admin/master-products?search=${encodeURIComponent(uniqueSuffix)}&page=1&pageSize=100`,
          );
          if (result.status === 200 && Array.isArray(result.json?.products)) {
            for (const candidate of result.json.products) {
              const row = resultObject(candidate).product;
              const product = resultObject(row);
              if (
                typeof product.id === "string" &&
                (product.name === productName || product.name === referenceName)
              ) {
                createdMasterProductIds.add(product.id);
              }
            }
          }
        } catch {
          failureCount += 1;
          primaryFailure ??= new Error("Cleanup could not discover generated test master catalog records through admin read APIs.");
        }
      }
      if (createdMasterProductIds.size && vendorA && vendorB) {
        for (const actor of [vendorA, vendorB]) {
          try {
            const result = await apiRequest(baseUrl, actor, "/api/vendor/products");
            if (result.status === 200 && Array.isArray(result.json?.products)) {
              for (const candidate of result.json.products) {
                const row = resultObject(candidate);
                if (
                  typeof row.id === "string" &&
                  typeof row.masterProductId === "string" &&
                  createdMasterProductIds.has(row.masterProductId)
                ) {
                  createdStoreListings.set(row.id, { actor, productId: row.id });
                }
              }
            }
          } catch {
            failureCount += 1;
            primaryFailure ??= new Error("Cleanup could not discover generated test vendor listings through vendor read APIs.");
          }
        }
      }
      for (const { actor, productId } of createdStoreListings.values()) {
        try {
          const result = await apiRequest(baseUrl, actor, `/api/vendor/products/${productId}/deactivate`, {
            method: "POST",
          });
          if (result.status !== 200) {
            failureCount += 1;
            primaryFailure ??= new Error(
              `Cleanup could not deactivate a generated vendor listing through the approved API (HTTP ${result.status}).`,
            );
          }
        } catch {
          failureCount += 1;
          primaryFailure ??= new Error("Cleanup could not reach the vendor listing deactivation API.");
        }
      }
      for (const masterProductId of createdMasterProductIds) {
        try {
          const result = await apiRequest(baseUrl, admin!, `/api/admin/master-products/${masterProductId}/archive`, {
            method: "POST",
          });
          if (result.status !== 200) {
            failureCount += 1;
            primaryFailure ??= new Error(
              `Cleanup could not archive a generated master product through the approved API (HTTP ${result.status}).`,
            );
          }
        } catch {
          failureCount += 1;
          primaryFailure ??= new Error("Cleanup could not reach the master product archive API.");
        }
      }
      if (createdCategoryId) {
        try {
          const result = await apiRequest(baseUrl, admin!, `/api/admin/master-categories/${createdCategoryId}/archive`, {
            method: "POST",
          });
          if (result.status !== 200) {
            failureCount += 1;
            primaryFailure ??= new Error(
              `Cleanup could not archive the generated master category through the approved API (HTTP ${result.status}).`,
            );
          }
        } catch {
          failureCount += 1;
          primaryFailure ??= new Error("Cleanup could not reach the master category archive API.");
        }
      }
    }
    if (server) {
      await new Promise<void>((resolve, reject) => {
        server!.close((error) => error ? reject(error) : resolve());
      }).catch(() => {
        failureCount += 1;
        primaryFailure ??= new Error("Could not close the in-process acceptance HTTP server.");
      });
    }
    removeIntegrationErrorObserver?.();

    if (baseline.length) {
      try {
        await verifySnapshotUnchanged(baseline);
      } catch {
        failureCount += 1;
        primaryFailure ??= new Error("Could not verify the pre-existing commerce snapshot.");
      }
    }
    if (createdMasterProductIds.size || createdCategoryId) {
      try {
        const activeProducts = createdMasterProductIds.size
          ? await getDb().select({ id: masterProducts.id }).from(masterProducts)
            .where(and(inArray(masterProducts.id, [...createdMasterProductIds]), eq(masterProducts.isActive, true)))
          : [];
        const activeCategories = createdCategoryId
          ? await getDb().select({ id: masterCategories.id }).from(masterCategories)
            .where(and(eq(masterCategories.id, createdCategoryId), eq(masterCategories.isActive, true)))
          : [];
        const activeListings = createdStoreListings.size
          ? await getDb().select({ id: products.id }).from(products)
            .where(and(inArray(products.id, [...createdStoreListings.keys()]), eq(products.isActive, true)))
          : [];
        if (activeProducts.length || activeCategories.length || activeListings.length) {
          failureCount += 1;
          primaryFailure ??= new Error(
            "Cleanup verification found active PHASE12 acceptance catalog records; generated records were not hard-deleted.",
          );
        } else if (createdMasterProductIds.size || createdCategoryId) {
          checkCount += 1;
          assertionPassCount += 1;
        }
      } catch {
        failureCount += 1;
        primaryFailure ??= new Error("Could not verify that generated PHASE12 catalog records are inactive.");
      }
    }
    process.stdout.write(
      `Master Catalog acceptance assertions: ${assertionPassCount} passed; ${assertionFailureCount} failed; ${checkCount} checked. Overall failures including cleanup: ${failureCount}.\n`,
    );
  }

  if (primaryFailure) {
    throw primaryFailure;
  }
});

function createdCategoryNameMissing(categoryId: string | undefined, name: string | undefined) {
  return Boolean(name) && !categoryId;
}