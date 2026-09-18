import express, { type NextFunction, type Request, type Response } from "express";
import { HttpError } from "./http.js";
import { storeManagementRouter } from "./store-management/index.js";

const app = express();
const port = Number(process.env.PORT ?? 5000);

app.use(express.json());

app.get("/health", (_request, response) => {
  response.json({ status: "ok" });
});

app.use(storeManagementRouter);

app.use(
  (
    error: unknown,
    _request: Request,
    response: Response,
    _next: NextFunction,
  ) => {
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

app.listen(port, "0.0.0.0", () => {
  process.stdout.write(`API listening on port ${port}\n`);
});