import express, { type NextFunction, type Request, type Response } from "express";
import { catalogManagementRouter } from "./catalog-management/index.js";
import { customerManagementRouter } from "./customer-management/index.js";
import { customerMarketplaceRouter } from "./customer-marketplace/index.js";
import { HttpError } from "./http.js";
import { storeManagementRouter } from "./store-management/index.js";

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

export function createApp() {
  const app = express();

  app.use(express.json());

  app.get("/health", (_request, response) => {
    response.json({ status: "ok" });
  });

  app.use(storeManagementRouter);
  app.use(catalogManagementRouter);
  app.use(customerManagementRouter);
  app.use(customerMarketplaceRouter);

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

      if (error instanceof HttpError) {
        response.status(error.statusCode).json({
          error: error.message,
          ...(error.details ? { details: error.details } : {}),
        });
        return;
      }

      process.stderr.write(
        `${error instanceof Error ? error.stack ?? error.message : String(error)}\n`,
      );
      response.status(500).json({ error: "Internal server error" });
    },
  );

  return app;
}