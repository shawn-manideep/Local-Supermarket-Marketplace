import { Router } from "express";
import { requireAuth } from "./middleware.js";
import type { AuthenticatedRequest } from "./types.js";

export const authRouter = Router();

authRouter.get("/api/auth/me", requireAuth(), (request, response) => {
  const auth = (request as AuthenticatedRequest).auth;
  response.json({ auth });
});