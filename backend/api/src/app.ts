import express, { type NextFunction, type Request, type Response } from "express";
import { authRouter } from "./auth/index.js";
import { catalogManagementRouter } from "./catalog-management/index.js";
import { customerManagementRouter } from "./customer-management/index.js";
import { customerMarketplaceRouter } from "./customer-marketplace/index.js";
import { customerCartRouter } from "./customer-cart/index.js";
import { HttpError } from "./http.js";
import { storeManagementRouter } from "./store-management/index.js";
import { ordersRouter } from "./orders/index.js";
import { createApiRateLimit } from "./security.js";

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
    response.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
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

  app.get("/health", (_request, response) => {
    response.json({ status: "ok" });
  });

  app.use(authRouter);
  app.use(storeManagementRouter);
  app.use(catalogManagementRouter);
  app.use(customerManagementRouter);
  app.use(customerMarketplaceRouter);
  app.use(customerCartRouter);
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
          ...(error.details ? { details: error.details } : {}),
        });
        return;
      }

      const detail = error instanceof Error ? error.stack ?? error.message : String(error);
      process.stderr.write(
        `${process.env.NODE_ENV === "development" ? detail : "Unhandled request error"}\n`,
      );
      response.status(500).json({ error: "Internal server error" });
    },
  );

  return app;
}