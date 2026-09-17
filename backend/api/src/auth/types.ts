import type { AppRole } from "@workspace/shared-types";
import type { Request } from "express";

export interface AuthContext {
  userId: string;
  role: AppRole;
  storeId: string | null;
}

export interface AuthenticatedRequest extends Request {
  auth?: AuthContext;
}