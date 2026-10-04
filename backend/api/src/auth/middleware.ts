import { createClient } from "@supabase/supabase-js";
import type { NextFunction, Request, RequestHandler, Response } from "express";
import { eq } from "drizzle-orm";
import { HttpError } from "../http.js";
import type { AppRole } from "@workspace/shared-types";
import { getSupabasePublicConfig } from "./config.js";
import type { AuthContext, AuthenticatedRequest } from "./types.js";

let supabase: ReturnType<typeof createClient> | undefined;

function getVerifier() {
  if (!supabase) {
    const config = getSupabasePublicConfig();
    supabase = createClient(config.SUPABASE_URL, config.SUPABASE_ANON_KEY, {
      auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false },
    });
  }
  return supabase;
}

function getBearerToken(request: Request) {
  const header = request.header("authorization");
  if (!header?.startsWith("Bearer ")) {
    return null;
  }

  const token = header.slice("Bearer ".length).trim();
  return token || null;
}

async function resolveAuthContext(token: string): Promise<AuthContext | null> {
  const {
    data: { user },
    error,
  } = await getVerifier().auth.getUser(token);

  if (error || !user) {
    return null;
  }

  const { customers, getDb, stores, userProfiles } = await import("@workspace/db");
  const db = getDb();
  const [profile] = await db
    .select({ role: userProfiles.role })
    .from(userProfiles)
    .where(eq(userProfiles.id, user.id))
    .limit(1);

  if (!profile) {
    return null;
  }

  if (profile.role === "customer") {
    const [customer] = await db.select({ status: customers.status }).from(customers)
      .where(eq(customers.id, user.id)).limit(1);
    if (!customer || customer.status !== "ACTIVE") {
      throw new HttpError(403, "Your customer account is inactive.", undefined, "CUSTOMER_INACTIVE");
    }
  }

  let storeId: string | null = null;
  if (profile.role === "vendor") {
    const [store] = await db
      .select({ id: stores.id, status: stores.status })
      .from(stores)
      .where(eq(stores.ownerUserId, user.id))
      .limit(1);
    storeId = store?.id ?? null;
    if (store?.status === "SUSPENDED" && profile.role === "vendor") {
      throw new HttpError(403, "Your store is suspended. Contact the platform administrator.", undefined, "STORE_SUSPENDED");
    }
  }

  return {
    userId: user.id,
    role: profile.role as AppRole,
    storeId,
  };
}

export function requireAuth(): RequestHandler {
  return async (
    request: Request,
    response: Response,
    next: NextFunction,
  ) => {
    const token = getBearerToken(request);
    if (!token) {
      response.status(401).json({ error: "Authentication required" });
      return;
    }

    try {
      const context = await resolveAuthContext(token);
      if (!context) {
        response.status(401).json({ error: "Invalid authentication token" });
        return;
      }

      const authenticatedRequest = request as AuthenticatedRequest;
      authenticatedRequest.auth = context;
      next();
    } catch (error) {
      next(error);
    }
  };
}

export function requireRole(...roles: AppRole[]): RequestHandler {
  const authenticate = requireAuth();

  return (request, response, next) => {
    authenticate(request, response, (error?: unknown) => {
      if (error) {
        next(error);
        return;
      }
      const authenticatedRequest = request as AuthenticatedRequest;
      if (!authenticatedRequest.auth || !roles.includes(authenticatedRequest.auth.role)) {
        response.status(403).json({ error: "Insufficient permissions" });
        return;
      }

      next();
    });
  };
}