import { createClient } from "@supabase/supabase-js";
import { getPool } from "@workspace/db";
import { partnerProvisionSchema } from "@workspace/validation";
import { pathToFileURL } from "node:url";
import { partnerRepository } from "./repository.js";
import { provisionPartner, supabasePartnerAuth } from "./auth-service.js";

const PROJECT = "gkwcolipeavxnuzqlamb";
const USERNAME = "deliverytest1";
const DISPLAY_NAME = "Test Delivery Partner";
const MARKER = "phase6_development_test_account";

export function parseTestAccountCommand(args: string[]) {
  const commands = args[0] === "--" ? args.slice(1) : args;
  if (commands.length !== 1 || !["provision", "verify", "cleanup"].includes(commands[0]!)) {
    throw new Error("Use exactly one command: provision, verify or cleanup.");
  }
  return commands[0]!;
}

// Check both independent connection targets before creating clients or opening DB connections.
export function assertDevelopmentTarget(env: NodeJS.ProcessEnv) {
  // REPLIT_ENVIRONMENT describes the platform environment and is "production"
  // even in this workspace. REPLIT_DEPLOYMENT is the documented published-app flag.
  if (env.NODE_ENV !== "development" || env.REPLIT_DEPLOYMENT === "1") {
    throw new Error("Refusing to run outside an explicitly enabled development environment.");
  }
  let authUrl: URL, dbUrl: URL;
  try {
    authUrl = new URL(env.SUPABASE_URL ?? "");
    dbUrl = new URL(env.SUPABASE_DB_URL ?? "");
  } catch {
    throw new Error("Development connection configuration is missing or invalid.");
  }
  if (authUrl.protocol !== "https:" || authUrl.hostname !== `${PROJECT}.supabase.co`
    || authUrl.port || authUrl.username || authUrl.password || authUrl.search || authUrl.hash
    || !["", "/"].includes(authUrl.pathname)) {
    throw new Error("Refusing a non-allowlisted development Auth target.");
  }
  const direct = dbUrl.hostname === `db.${PROJECT}.supabase.co` && dbUrl.username === "postgres";
  const pooled = dbUrl.hostname.endsWith(".pooler.supabase.com") && dbUrl.username === `postgres.${PROJECT}`;
  if (!["postgres:", "postgresql:"].includes(dbUrl.protocol) || (!direct && !pooled)
    || dbUrl.pathname !== "/postgres" || dbUrl.hash
    || [...dbUrl.searchParams].some(([key, value]) => key !== "sslmode" || !["require", "verify-full"].includes(value))) {
    throw new Error("Refusing a non-allowlisted development database target.");
  }
  if (!env.SUPABASE_ANON_KEY || !env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("Development Supabase credentials are not configured.");
  }
}

async function run(command: string | undefined) {
  assertDevelopmentTarget(process.env);
  if (!["provision", "verify", "cleanup"].includes(command ?? "")) {
    throw new Error("Use provision, verify or cleanup.");
  }
  const admin = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const pool = getPool(), repo = partnerRepository(), auth = supabasePartnerAuth();
  const lock = await pool.connect();
  try {
    await lock.query("SELECT pg_advisory_lock(hashtextextended($1,0))", [`phase6-development-test:${USERNAME}`]);
    async function markedRemnants() {
      const ids: string[] = [];
      for (let page = 1; ; page++) {
        const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 100 });
        if (error) throw new Error("Could not verify development Auth ownership.");
        for (const user of data.users) {
          if (user.app_metadata?.[MARKER] === USERNAME && user.app_metadata?.phase6_development_project === PROJECT) ids.push(user.id);
        }
        if (data.users.length < 100) break;
      }
      return ids;
    }
    async function verified() {
      const identity = await repo.identity(USERNAME);
      if (!identity) return undefined;
      if (identity.role !== "delivery_partner") throw new Error("Username belongs to another role; refusing to modify it.");
      const profile = await repo.profile(identity.id);
      if (!profile || profile.username !== USERNAME || profile.displayName !== DISPLAY_NAME) {
        throw new Error("Existing account does not match the test profile; refusing to modify it.");
      }
      const { data, error } = await admin.auth.admin.getUserById(identity.id);
      if (error || !data.user || data.user.id !== identity.id) throw new Error("Auth identity verification failed.");
      // Also proves that the independently configured Auth and database targets agree.
      const counts = await pool.query(`SELECT
        (SELECT count(*)::integer FROM auth.users WHERE id=$1) AS auth_count,
        (SELECT count(*)::integer FROM public.identity_usernames WHERE normalized_username=$2 AND user_id=$1) AS username_count,
        (SELECT count(*)::integer FROM public.delivery_partner_profiles WHERE user_id=$1) AS profile_count`,
      [identity.id, USERNAME]);
      const count = counts.rows[0];
      if (count.auth_count !== 1 || count.username_count !== 1 || count.profile_count !== 1) {
        throw new Error("Account consistency or uniqueness verification failed.");
      }
      return { identity, profile, user: data.user };
    }

    let account = await verified();
    if (command === "cleanup") {
      if (!account) {
        // Recover only a positively marked Auth-only remnant after a previous interrupted cleanup.
        const remnants = await markedRemnants();
        if (remnants.length > 1) throw new Error("Multiple marked remnants found; refusing ambiguous cleanup.");
        for (const id of remnants) {
          const related = await pool.query(`SELECT
            EXISTS(SELECT 1 FROM public.user_profiles WHERE id=$1) OR
            EXISTS(SELECT 1 FROM public.identity_usernames WHERE user_id=$1) OR
            EXISTS(SELECT 1 FROM public.delivery_partner_profiles WHERE user_id=$1) OR
            EXISTS(SELECT 1 FROM public.delivery_assignments WHERE partner_user_id=$1) AS present`, [id]);
          if (related.rows[0].present) throw new Error("Remnant has application records; manual review required.");
          await auth.remove(id);
        }
        console.log("Development test account is absent; cleanup complete.");
        return;
      }
      if (account.user.app_metadata?.[MARKER] !== USERNAME
        || account.user.app_metadata?.phase6_development_project !== PROJECT) {
        throw new Error("Cleanup requires this command's ownership marker; refusing to delete an unmarked account.");
      }
      const assignments = await pool.query("SELECT count(*)::integer AS count FROM public.delivery_assignments WHERE partner_user_id=$1", [account.identity.id]);
      if (assignments.rows[0].count !== 0) throw new Error("Account has delivery records; refusing to delete operational data.");
      // No password, token, technical email or identity ID is printed.
      await auth.remove(account.identity.id);
      await repo.cleanup(account.identity.id);
      if (await repo.identity(USERNAME)) throw new Error("Cleanup verification failed.");
      const remaining = await pool.query(`SELECT
        EXISTS(SELECT 1 FROM auth.users WHERE id=$1) OR
        EXISTS(SELECT 1 FROM public.user_profiles WHERE id=$1) OR
        EXISTS(SELECT 1 FROM public.identity_usernames WHERE user_id=$1) OR
        EXISTS(SELECT 1 FROM public.delivery_partner_profiles WHERE user_id=$1) OR
        EXISTS(SELECT 1 FROM public.delivery_assignments WHERE partner_user_id=$1) AS present`, [account.identity.id]);
      if (remaining.rows[0].present) throw new Error("Cleanup incomplete; administrator review required.");
      console.log("Removed only the marked development test account and its application records.");
      return;
    }
    if (!account && command === "provision") {
      if ((await markedRemnants()).length) throw new Error("A marked authentication remnant exists; cleanup/review it before provisioning again.");
      const input = partnerProvisionSchema.safeParse({
        username: USERNAME, displayName: DISPLAY_NAME, status: "ACTIVE", contactNumber: null,
        password: process.env.PHASE6_DELIVERY_TEST_PASSWORD,
      });
      if (!input.success) throw new Error("Set a secure PHASE6_DELIVERY_TEST_PASSWORD secret satisfying the existing password rules (8–128 characters).");
      const create = auth.create;
      auth.create = async password => {
        const id = await create(password);
        const { error } = await admin.auth.admin.updateUserById(id, {
          app_metadata: { [MARKER]: USERNAME, phase6_development_project: PROJECT },
        });
        if (error) {
          await auth.remove(id);
          await repo.cleanup(id);
          throw new Error("Development ownership marker could not be recorded.");
        }
        return id;
      };
      await provisionPartner(repo, auth, input.data);
      account = await verified();
    }
    if (!account || account.profile.status !== "ACTIVE") {
      throw new Error("An ACTIVE development test partner was not found; refusing automatic status changes.");
    }
    console.log("Verified deliverytest1: Supabase Auth exists; role=DELIVERY_PARTNER; global username unique; profile=Test Delivery Partner; status=ACTIVE.");
    console.log("Existing matching accounts are reused without changing credentials. No assignment records are created.");
  } finally {
    await lock.query("SELECT pg_advisory_unlock(hashtextextended($1,0))", [`phase6-development-test:${USERNAME}`]).catch(() => undefined);
    lock.release();
    await pool.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  Promise.resolve().then(() => run(parseTestAccountCommand(process.argv.slice(2)))).catch(() => {
    // Suppress external SDK/SQL errors: they may include connection details or sensitive request data.
    console.error("Development test-account command failed safely. Check development configuration, account ownership/status and required Secrets; no credentials are logged.");
    process.exitCode = 1;
  });
}