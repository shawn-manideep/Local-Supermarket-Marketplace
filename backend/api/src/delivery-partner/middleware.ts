import type { RequestHandler } from "express";
import { requireAuth } from "../auth/middleware.js";
import type { AuthenticatedRequest } from "../auth/types.js";
import { partnerRepository, type PartnerRecord } from "./repository.js";

export function requireDeliveryPartner(
  authenticate: RequestHandler = requireAuth(),
  lookup: (id: string) => Promise<PartnerRecord | undefined> = id => partnerRepository().profile(id),
): RequestHandler {
  return (req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    authenticate(req, res, error => {
      if (error) { next(error); return; }
      const context = (req as AuthenticatedRequest).auth;
      if (!context || context.role !== "delivery_partner") {
        res.status(403).json({ error: "Delivery partner access required." }); return;
      }
      void lookup(context.userId).then(profile => {
        if (!profile) { res.status(403).json({ error: "Delivery partner profile is unavailable." }); return; }
        if (profile.status !== "ACTIVE") {
          res.status(403).json({ error: "Your delivery partner account is inactive. Contact an administrator.", code: "PARTNER_INACTIVE" }); return;
        }
        next();
      }).catch(next);
    });
  };
}