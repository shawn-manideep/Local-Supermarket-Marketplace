import express, { Router, type Request } from "express";
import { z } from "zod";
import { requireRole } from "../auth/index.js";
import type { AuthenticatedRequest } from "../auth/types.js";
import { asyncHandler, HttpError } from "../http.js";
import { applyCatalog, catalogHistory, downloadCatalog, previewCatalog } from "./excel-service.js";
import { MAX_UPLOAD_BYTES, XLSX_TYPE } from "./excel-security.js";

export const catalogExcelRouter = Router();
const base = "/api/admin/master-catalog/excel";
// Authenticate before buffering untrusted file bytes.
catalogExcelRouter.use(base, requireRole("admin"), (_request, response, next) => {
  response.setHeader("Cache-Control", "no-store");
  next();
});
const upload = express.raw({ type: XLSX_TYPE, limit: MAX_UPLOAD_BYTES });
const filenameSchema = z.string().trim().min(1).max(180).regex(/^[^/\\\x00-\x1f]+\.xlsx$/i);

function uploadedFile(request: Request) {
  const name = filenameSchema.safeParse(request.query.filename);
  if (!name.success) throw new HttpError(400, "Supply a valid .xlsx filename (maximum 180 characters)");
  if (!request.is(XLSX_TYPE) || !Buffer.isBuffer(request.body) || request.body.length === 0) {
    throw new HttpError(400, "Upload .xlsx bytes using the Excel workbook content type");
  }
  return { bytes: request.body as Buffer, filename: name.data };
}

function actor(request: Request) {
  const id = (request as AuthenticatedRequest).auth?.userId;
  if (!id) throw new HttpError(401, "Authentication required");
  return id;
}

catalogExcelRouter.get([base, `${base}/template`], asyncHandler(async (request, response) => {
  const template = request.path.endsWith("/template");
  const bytes = await downloadCatalog(template);
  response.setHeader("Content-Type", XLSX_TYPE);
  response.setHeader("Content-Disposition", `attachment; filename="master-catalog${template ? "-update-template" : ""}-${new Date().toISOString().slice(0, 10)}.xlsx"`);
  response.send(bytes);
}));

catalogExcelRouter.post(`${base}/preview`, upload, asyncHandler(async (request, response) => {
  const { bytes } = uploadedFile(request);
  response.json(await previewCatalog(bytes, actor(request)));
}));

catalogExcelRouter.post(`${base}/apply`, upload, asyncHandler(async (request, response) => {
  const { bytes, filename } = uploadedFile(request);
  if (request.header("X-Catalog-Confirm") !== "true") {
    throw new HttpError(400, "Explicit Admin confirmation is required. No changes were applied.");
  }
  response.json(await applyCatalog(bytes, actor(request), filename, request.header("X-Catalog-Preview") ?? ""));
}));

catalogExcelRouter.get(`${base}/history`, asyncHandler(async (request, response) => {
  const parsed = z.object({ page: z.coerce.number().int().min(1).max(10000).default(1) }).strict().safeParse(request.query);
  if (!parsed.success) throw new HttpError(400, "Invalid history page");
  response.json(await catalogHistory(parsed.data.page));
}));
