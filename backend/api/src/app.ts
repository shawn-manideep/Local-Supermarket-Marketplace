import express, { type NextFunction, type Request, type Response } from "express";
import { authRouter, requireRole } from "./auth/index.js";
import { catalogManagementRouter } from "./catalog-management/index.js";
import { masterCatalogRouter } from "./master-catalog/index.js";
import { customerManagementRouter } from "./customer-management/index.js";
import { customerMarketplaceRouter } from "./customer-marketplace/index.js";
import { customerSavedRouter } from "./customer-saved/routes.js";
import { customerSettingsRouter } from "./customer-settings/routes.js";
import { productImagesRouter } from "./product-images/routes.js";
import { customerCartRouter } from "./customer-cart/index.js";
import { HttpError } from "./http.js";
import { storeManagementRouter } from "./store-management/index.js";
import { ordersRouter } from "./orders/index.js";
import { deliveryPartnerRouter } from "./delivery-partner/routes.js";
import { createApiRateLimit } from "./security.js";
import { adminManagementRouter } from "./admin-management/routes.js";
import { catalogExcelRouter } from "./master-catalog/excel-routes.js";
import { vendorDocumentsRouter } from "./vendor-documents/routes.js";
import { brandingRouter } from "./branding/routes.js";
import { bankDetailsRouter } from "./vendor-documents/bank-details.js";
import { pickupPhotosRouter } from "./delivery-partner/photos.js";
import { reportsRouter } from "./orders/reports.js";
import { requireCatalogDocuments } from "./vendor-documents/service.js";

export type IntegrationErrorDiagnostic = {
  causeCode?: string;
  causeMessage?: string;
};

let integrationErrorObserver: ((diagnostic: IntegrationErrorDiagnostic) => void) | undefined;

export function observeIntegrationErrors(
  observer: (diagnostic: IntegrationErrorDiagnostic) => void,
) {
  if (process.env.RUN_MASTER_CATALOG_INTEGRATION !== "1") {
    throw new Error("Integration error observation requires RUN_MASTER_CATALOG_INTEGRATION=1.");
  }
  integrationErrorObserver = observer;
  return () => {
    if (integrationErrorObserver === observer) integrationErrorObserver = undefined;
  };
}

function isMalformedJsonError(error: unknown) {
  return (
    error instanceof SyntaxError &&
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    (error as { status?: number }).status === 400 &&
    "type" in error &&
    (error as { type?: string }).type === "entity.parse.failed"
  );
}

function isBodyTooLargeError(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "type" in error &&
    (error as { type?: string }).type === "entity.too.large"
  );
}

function getAllowedOrigins() {
  return new Set(
    (process.env.CORS_ALLOWED_ORIGINS ?? "")
      .split(",")
      .map((origin) => origin.trim())
      .filter(Boolean),
  );
}

function createCorsMiddleware() {
  const allowedOrigins = getAllowedOrigins();

  return (request: Request, response: Response, next: NextFunction) => {
    const origin = request.header("origin");
    if (!origin) {
      next();
      return;
    }

    response.vary("Origin");
    if (!allowedOrigins.has(origin)) {
      response.status(403).json({ error: "Origin is not allowed" });
      return;
    }

    response.setHeader("Access-Control-Allow-Origin", origin);
    response.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type, X-Catalog-Preview, X-Catalog-Confirm");
    response.setHeader(
      "Access-Control-Allow-Methods",
      "GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS",
    );

    if (request.method === "OPTIONS") {
      response.sendStatus(204);
      return;
    }

    next();
  };
}

export function createApp() {
  const app = express();

  app.set("trust proxy", 1);
  app.use(createCorsMiddleware());
  app.use(createApiRateLimit());
  app.use(express.json({ limit: "100kb" }));

  app.get(["/health", "/api/health"], (_request, response) => {
    response.json({ status: "ok" });
  });

  app.use(authRouter);
  // Cover read/write and nested catalog/image/import routes before any router
  // can answer them. Profile, compliance submissions and existing orders stay usable.
  app.use(["/api/vendor/products","/api/vendor/categories","/api/vendor/product-matches",
    "/api/vendor/master-products","/api/vendor/master-categories","/api/vendor/master-brands",
    "/api/vendor/catalog"],requireRole("vendor"),requireCatalogDocuments);
  app.use(brandingRouter);
  app.use(catalogExcelRouter);
  app.use(adminManagementRouter);
  app.use(deliveryPartnerRouter);
  app.use(pickupPhotosRouter);
  app.use(storeManagementRouter);
  app.use(vendorDocumentsRouter);
  app.use(bankDetailsRouter);
  app.use(catalogManagementRouter);
  app.use(masterCatalogRouter);
  app.use(customerManagementRouter);
  app.use(customerMarketplaceRouter);
  app.use(customerSavedRouter);
  app.use(customerSettingsRouter);
  app.use(productImagesRouter);
  app.use(customerCartRouter);
  // Reports precede parameterized order-detail routes (report.pdf is not a UUID).
  app.use(reportsRouter);
  app.use(ordersRouter);

  app.use(
    (
      error: unknown,
      _request: Request,
      response: Response,
      _next: NextFunction,
    ) => {
      if (isMalformedJsonError(error)) {
        response.status(400).json({ error: "Malformed JSON body" });
        return;
      }
      if (isBodyTooLargeError(error)) {
        response.status(413).json({ error: "Request body is too large" });
        return;
      }

      if (error instanceof HttpError) {
        response.status(error.statusCode).json({
          error: error.message,
          ...(error.code ? { code: error.code } : {}),
          ...(error.details ? { details: error.details } : {}),
        });
        return;
      }

      if (process.env.RUN_MASTER_CATALOG_INTEGRATION === "1" && integrationErrorObserver) {
        const cause = typeof error === "object" && error !== null && "cause" in error
          ? (error as { cause?: unknown }).cause
          : error;
        if (typeof cause === "object" && cause !== null) {
          const diagnostic: IntegrationErrorDiagnostic = {};
          const code = "code" in cause ? (cause as { code?: unknown }).code : undefined;
          const message = "message" in cause ? (cause as { message?: unknown }).message : undefined;
          if (typeof code === "string") diagnostic.causeCode = code;
          if (typeof message === "string") diagnostic.causeMessage = message;
          integrationErrorObserver(diagnostic);
        }
      }

      const detail = error instanceof Error ? error.stack ?? error.message : String(error);
      process.stderr.write(
        `${_request.path.includes("/bank-details") ? "Bank request failed (sensitive details withheld)" : process.env.NODE_ENV === "development" ? detail : "Unhandled request error"}\n`,
      );
      response.status(500).json({ error: "Internal server error" });
    },
  );

  return app;
}