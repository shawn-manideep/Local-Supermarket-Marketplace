import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema/index.js";

const { Pool } = pg;
let pool: pg.Pool | undefined;

export function getPool() {
  if (pool) {
    return pool;
  }

  const connectionString = process.env.SUPABASE_DB_URL;
  if (!connectionString) {
    throw new Error(
      "SUPABASE_DB_URL must be set before accessing the Supabase database.",
    );
  }

  pool = new Pool({ connectionString });
  return pool;
}

export function getDb() {
  return drizzle(getPool(), { schema });
}

export * from "./schema/index.js";
