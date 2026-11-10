import { GetObjectCommand, PutObjectCommand, S3Client, type S3ClientConfig } from "@aws-sdk/client-s3";
import type { R2Config } from "./r2-config.js";
import { R2Error, type R2Transport } from "./r2-store.js";

/** Construction does not contact R2. No default credential chain or SDK retries. */
export function r2Transport(config: R2Config, requestHandler?: S3ClientConfig["requestHandler"]): R2Transport {
  const client = new S3Client({
    endpoint: config.endpoint, region: "auto", forcePathStyle: true,
    credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
    maxAttempts: 1, followRegionRedirects: false,
    requestChecksumCalculation: "WHEN_REQUIRED", responseChecksumValidation: "WHEN_REQUIRED",
    ...(requestHandler ? { requestHandler } : {}),
  });
  return async request => {
    try {
      if (request.kind === "put") {
        const m = request.metadata!;
        await client.send(new PutObjectCommand({
          Bucket: config.bucket, Key: request.key, Body: request.body,
          IfMatch: request.ifMatch, IfNoneMatch: request.ifNoneMatch,
          ContentType: m.mimeType, CacheControl: m.cacheControl,
          ContentDisposition: m.contentDisposition, ContentEncoding: m.contentEncoding,
          ContentLanguage: m.contentLanguage,
          Metadata: Object.fromEntries(Object.entries(m.custom).map(([k, v]) => [k, JSON.stringify(v)])),
        }), { abortSignal: request.signal });
        return {};
      }
      const result = await client.send(new GetObjectCommand({
        Bucket: config.bucket, Key: request.key,
      }), { abortSignal: request.signal });
      const body = result.Body;
      if (!body) throw new R2Error("INTEGRITY");
      const chunks: Buffer[] = [];
      let size = 0;
      const stop = () => { if ("destroy" in body && typeof body.destroy === "function") body.destroy(); };
      request.signal.addEventListener("abort", stop, { once: true });
      try {
        if (request.signal.aborted || (result.ContentLength ?? 0) > request.maxBytes) throw new R2Error("INTEGRITY");
        for await (const chunk of body as AsyncIterable<Uint8Array>) {
          if (request.signal.aborted) throw new R2Error("CANCELLED");
          size += chunk.length;
          if (size > request.maxBytes) throw new R2Error("INTEGRITY");
          chunks.push(Buffer.from(chunk));
        }
        return { body: Buffer.concat(chunks), etag: result.ETag };
      } finally {
        request.signal.removeEventListener("abort", stop);
        stop();
      }
    } catch (error) {
      if (error instanceof R2Error) throw error;
      const status = (error as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode;
      if (status === 404 && request.kind === "get" && (error as { name?: string })?.name === "NoSuchKey") {
        throw new R2Error("NOT_FOUND");
      }
      if (status === 412 || status === 409) throw new R2Error("CONFLICT");
      throw new R2Error(request.kind === "put" ? "UNKNOWN_OUTCOME" : "UNAVAILABLE");
    }
  };
}
