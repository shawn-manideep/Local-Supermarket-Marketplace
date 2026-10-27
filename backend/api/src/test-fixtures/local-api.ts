// Disposable local integration harness. Never imported by application entrypoints.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import net from "node:net";
import { randomUUID } from "node:crypto";
import type { Server } from "node:http";
import pg from "pg";
import { approvedFixtureBank, approvedFixtureDocuments } from "../test-fixture-compliance.js";

const exec = promisify(execFile);
const binary = "/nix/store/269nimkimaaivb4z46bjc1rnjv9jpc0l-postgresql-17.6/bin";

export async function localApiFixture() {
  const directory = await mkdtemp(`${tmpdir()}/offline-api-regression-`);
  const socket = net.createServer();
  await new Promise<void>(resolve => socket.listen(0, "127.0.0.1", resolve));
  const port = (socket.address() as net.AddressInfo).port;
  await new Promise<void>(resolve => socket.close(() => resolve()));
  const env = { PATH: process.env.PATH, PGHOST: "127.0.0.1", PGPORT: String(port),
    PGUSER: "offline_fixture", PGDATABASE: "postgres" };
  const saved = Object.fromEntries(["SUPABASE_DB_URL", "SUPABASE_URL", "SUPABASE_ANON_KEY"]
    .map(key => [key, process.env[key]]));
  const originalFetch = globalThis.fetch;
  let server: Server | undefined;
  let started = false;
  let appLoaded = false;
  const pool = new pg.Pool({ host: "127.0.0.1", port, user: "offline_fixture", database: "postgres", ssl: false });
  const customer = randomUUID(), admin = randomUUID();
  const vendors = [randomUUID(), randomUUID()], stores = [randomUUID(), randomUUID()];
  const products = [randomUUID(), randomUUID()], variants = [randomUUID(), randomUUID()];
  async function close() {
    globalThis.fetch = originalFetch;
    if (server) await new Promise<void>((resolve, reject) => server!.close(error => error ? reject(error) : resolve()));
    if (appLoaded) { const { getPool } = await import("@workspace/db"); await getPool().end(); }
    await pool.end();
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    if (started) await exec(`${binary}/pg_ctl`, ["-D", `${directory}/data`, "-m", "immediate", "-w", "stop"], { env });
    await rm(directory, { recursive: true, force: true });
  }
  try {
    await exec(`${binary}/initdb`, ["-D", `${directory}/data`, "--auth=trust", "--no-locale", "-U", "offline_fixture"], { env });
    await exec(`${binary}/pg_ctl`, ["-D", `${directory}/data`, "-l", `${directory}/postgres.log`,
      "-o", `-h 127.0.0.1 -k ${directory} -p ${port}`, "-w", "start"], { env });
    started = true;
    await pool.query(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS; CREATE ROLE postgres SUPERUSER;
      CREATE SCHEMA auth; GRANT USAGE ON SCHEMA auth TO authenticated;
      CREATE TABLE auth.users(id uuid PRIMARY KEY,email text,raw_user_meta_data jsonb DEFAULT '{}',created_at timestamptz DEFAULT now());
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
        SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;`);
    const migrations = new URL("../../../../database/migrations/", import.meta.url);
    for (const file of (await readdir(migrations)).filter(name => /^\d{4}_.*\.sql$/.test(name)).sort())
      await pool.query(await readFile(new URL(file, migrations), "utf8"));
    for (const [id, role] of [[customer, "customer"], [admin, "admin"], ...vendors.map(id => [id, "vendor"])]) {
      await pool.query("INSERT INTO auth.users(id,email) VALUES($1,$2)", [id, `${id}@fixture.invalid`]);
      await pool.query("UPDATE user_profiles SET role=$2::app_role WHERE id=$1", [id, role]);
      if (role !== "customer") await pool.query("DELETE FROM customers WHERE id=$1", [id]);
    }
    for (let i = 0; i < stores.length; i++) {
      await pool.query("INSERT INTO stores(id,owner_user_id,name,status) VALUES($1,$2,'Offline Fixture','ACTIVE')", [stores[i], vendors[i]]);
      await approvedFixtureBank(pool, stores[i]!, admin);
      await approvedFixtureDocuments(pool, stores[i]!, admin);
      await pool.query("INSERT INTO products(id,store_id,name,price,stock_quantity,is_active) VALUES($1,$2,'Fixture Product',35,10,true)", [products[i], stores[i]]);
      await pool.query(`INSERT INTO product_variants(id,product_id,name,quantity_value,quantity_unit,price,stock_quantity)
        VALUES($1,$2,'One kg',1,'kg',35,10)`, [variants[i], products[i]]);
    }
    process.env.SUPABASE_DB_URL = `postgresql://offline_fixture@127.0.0.1:${port}/postgres`;
    process.env.SUPABASE_URL = "https://offline-fixture.example.invalid";
    process.env.SUPABASE_ANON_KEY = "synthetic-key";
    const actors: string[] = [customer, admin, ...vendors];
    globalThis.fetch = async (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url !== "https://offline-fixture.example.invalid/auth/v1/user") return originalFetch(input, init);
      const id = new Headers(init?.headers).get("authorization")?.replace("Bearer ", "");
      return id && actors.includes(id)
        ? Response.json({ id, email: `${id}@fixture.invalid` })
        : Response.json({ message: "Invalid token" }, { status: 401 });
    };
    const { createApp } = await import("../app.js");
    appLoaded = true;
    server = createApp().listen(0, "127.0.0.1");
    await new Promise<void>((resolve, reject) => { server!.once("listening", resolve); server!.once("error", reject); });
    const base = `http://127.0.0.1:${(server.address() as net.AddressInfo).port}`;
    async function request(path: string, actor?: string, body?: unknown, method = body === undefined ? "GET" : "POST") {
      return originalFetch(base + path, { method, headers: { ...(actor ? { Authorization: `Bearer ${actor}` } : {}),
        ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    }
    async function order(storeIndex: number, status = "PLACED", at = "2026-10-14T10:00:00+05:30", deducted = false) {
      const id = randomUUID();
      await pool.query(`INSERT INTO orders(id,customer_id,store_id,status,subtotal,delivery_fee_snapshot,handling_fee_snapshot,total_amount,inventory_state,
        delivery_contact_name,delivery_contact_phone,delivery_address_snapshot,created_at)
        VALUES($1,$2,$3,$4,70,0,0,70,$5,'Fixture Customer','9876543210','{"pincode":"500090"}',$6)`,
      [id, customer, stores[storeIndex], status, deducted ? "DEDUCTED" : "NONE", at]);
      await pool.query(`INSERT INTO order_items(order_id,product_id,variant_id,product_name_snapshot,
        product_price_snapshot,quantity,subtotal,variant_name_snapshot,variant_quantity_value_snapshot,variant_quantity_unit_snapshot)
        VALUES($1,$2,$3,'Fixture Product',35,2,70,'One kg',1,'kg')`, [id, products[storeIndex], variants[storeIndex]]);
      return id;
    }
    return { pool, customer, admin, vendors, stores, products, variants, request, order, close };
  } catch (error) {
    await close();
    throw error;
  }
}
