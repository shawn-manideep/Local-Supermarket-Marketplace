import { randomUUID } from "node:crypto";
import express, { Router } from "express";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { categories, getDb, products, stores } from "@workspace/db";
import { requireRole } from "../auth/index.js";
import type { AuthenticatedRequest } from "../auth/types.js";
import { asyncHandler, HttpError } from "../http.js";
import { requireCatalogDocuments } from "../vendor-documents/service.js";
import { productImageStorage } from "./storage.js";
import { MAX_PRODUCT_IMAGE_BYTES, validateProductImage } from "./validation.js";

export const productImagesRouter = Router();
productImagesRouter.post("/api/vendor/product-images", requireRole("vendor"), requireCatalogDocuments,
  express.raw({ type: ["image/jpeg", "image/png", "image/webp"], limit: MAX_PRODUCT_IMAGE_BYTES }),
  asyncHandler(async (request, response) => {
    const storeId = (request as AuthenticatedRequest).auth?.storeId;
    if (!storeId) throw new HttpError(404, "Vendor store not found");
    if (request.query.productId !== undefined) {
      const id = z.string().uuid().safeParse(request.query.productId);
      if (!id.success) throw new HttpError(400, "Invalid product ID");
      const [product] = await getDb().select({ id: products.id }).from(products)
        .where(and(eq(products.id, id.data), eq(products.storeId, storeId))).limit(1);
      if (!product) throw new HttpError(404, "Product not found");
    }
    const fileName = typeof request.query.fileName === "string" ? request.query.fileName : "";
    const mimeType = request.get("content-type")?.split(";")[0] ?? "";
    const bytes = Buffer.isBuffer(request.body) ? request.body : Buffer.alloc(0);
    validateProductImage(fileName, mimeType, bytes);
    const imageId = randomUUID();
    try { await productImageStorage.put(storeId, imageId, bytes, mimeType); }
    catch { throw new HttpError(503, "Image upload failed. Please try again."); }
    response.setHeader("Cache-Control", "no-store");
    response.status(201).json({ imageUrl: `/api/product-images/${storeId}/${imageId}` });
  }));
productImagesRouter.get("/api/product-images/:storeId/:imageId", asyncHandler(async (request, response, next) => {
  const params = z.object({ storeId: z.string().uuid(), imageId: z.string().uuid() }).safeParse(request.params);
  if (!params.success) throw new HttpError(404, "Image not found");
  const { storeId, imageId } = params.data;
  const reference = `/api/product-images/${storeId}/${imageId}`;
  const [published] = await getDb().select({ id: products.id }).from(products)
    .innerJoin(stores, eq(stores.id, products.storeId))
    .leftJoin(categories, and(eq(categories.id, products.categoryId), eq(categories.storeId, products.storeId)))
    .where(and(eq(products.storeId, storeId), eq(products.imageUrl, reference),
      eq(products.isActive, true), eq(stores.status, "ACTIVE"),
      sql`(${products.categoryId} IS NULL OR ${categories.isActive}=true)`)).limit(1);
  if (!published) {
    await new Promise<void>((resolve, reject) => {
      requireRole("vendor")(request, response, error => error ? reject(error) : resolve());
      response.once("finish", resolve);
    });
    if (response.headersSent) return;
    if ((request as AuthenticatedRequest).auth?.storeId !== storeId) throw new HttpError(404, "Image not found");
  }
  try {
    const image = await productImageStorage.get(storeId, imageId);
    response.setHeader("Content-Type", image.mimeType);
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Content-Security-Policy", "sandbox");
    response.send(image.bytes);
  } catch { next(new HttpError(404, "Image not found")); }
}));
