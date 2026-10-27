import type { Storage } from "@google-cloud/storage";
import { ObjectStoreError, safeObjectKey, type ObjectMetadata, type ObjectStore } from "./object-store.js";
import { externalGcsConfig } from "./external-gcs-config.js";

interface GcsMetadata {
  generation?: string | number;
  contentType?: string;
  cacheControl?: string;
  metadata?: Record<string, string | number | boolean | null>;
  contentDisposition?: string;
  contentEncoding?: string;
  contentLanguage?: string;
}

/** Small SDK seam so fixtures never instantiate a Google client. */
export interface GcsClient {
  bucket(name: string): {
    file(key: string, options?: { generation?: string }): {
      getMetadata(): Promise<[GcsMetadata, ...unknown[]]>;
      download(options: { validation: "crc32c" }): Promise<[Buffer, ...unknown[]]>;
      save(bytes: Buffer, options: {
        resumable: false;
        validation: "crc32c";
        metadata: {
          contentType: string; cacheControl: string; metadata: ObjectMetadata["custom"];
          contentDisposition?: string; contentEncoding?: string; contentLanguage?: string;
        };
        preconditionOpts: { ifGenerationMatch: string | 0 };
      }): Promise<unknown>;
      delete(options: { ifGenerationMatch: string }): Promise<unknown>;
    };
  };
}

function errorCode(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error
    ? Number(error.code) : undefined;
}
function sanitized(error: unknown): never {
  throw new ObjectStoreError(errorCode(error) === 412 ? "conflict" : "unavailable");
}
function revision(value: string | number | undefined) {
  if (typeof value !== "string" || !/^[1-9]\d*$/.test(value)) {
    throw new ObjectStoreError("unavailable");
  }
  return value;
}

export function createGcsObjectStore(client: GcsClient, bucketName: string): ObjectStore {
  const bucket = client.bucket(bucketName);
  const file = (key: string) => bucket.file(safeObjectKey(key));
  return {
    async head(key) {
      try {
        const [meta] = await file(key).getMetadata();
        return {
          generation: revision(meta.generation),
          mimeType: meta.contentType ?? "application/octet-stream",
          cacheControl: meta.cacheControl ?? "no-store",
          custom: { ...meta.metadata },
          ...(meta.contentDisposition === undefined ? {} : { contentDisposition: meta.contentDisposition }),
          ...(meta.contentEncoding === undefined ? {} : { contentEncoding: meta.contentEncoding }),
          ...(meta.contentLanguage === undefined ? {} : { contentLanguage: meta.contentLanguage }),
        };
      } catch (error) {
        if (errorCode(error) === 404) return null;
        return sanitized(error);
      }
    },
    async read(key) {
      const metadata: ObjectMetadata | null = await this.head(key);
      if (!metadata) throw new ObjectStoreError("not-found");
      try {
        // Pin bytes to the metadata revision; never mix a newer body with old MIME.
        const [bytes] = await bucket.file(safeObjectKey(key), { generation: metadata.generation })
          .download({ validation: "crc32c" });
        return { bytes, metadata };
      } catch (error) {
        return sanitized(error);
      }
    },
    async write(key, bytes, metadata, generation) {
      if (generation !== 0) revision(generation);
      try {
        await file(key).save(bytes, {
          resumable: false, validation: "crc32c",
          metadata: { contentType: metadata.mimeType, cacheControl: metadata.cacheControl,
            metadata: { ...metadata.custom },
            ...(metadata.contentDisposition === undefined ? {} : { contentDisposition: metadata.contentDisposition }),
            ...(metadata.contentEncoding === undefined ? {} : { contentEncoding: metadata.contentEncoding }),
            ...(metadata.contentLanguage === undefined ? {} : { contentLanguage: metadata.contentLanguage }) },
          preconditionOpts: { ifGenerationMatch: generation },
        });
      } catch (error) { sanitized(error); }
    },
    async remove(key, generation) {
      revision(generation);
      try { await file(key).delete({ ifGenerationMatch: generation }); }
      catch (error) {
        if (errorCode(error) !== 404) sanitized(error);
      }
    },
  };
}

/** Lazy and explicit: never fall back to ADC, sidecar credentials, or an emulator. */
export async function externalGcsObjectStore(env: NodeJS.ProcessEnv): Promise<ObjectStore> {
  const config = externalGcsConfig(env);
  const { Storage: GoogleStorage } = await import("@google-cloud/storage");
  const client: Storage = new GoogleStorage({
    projectId: config.projectId,
    apiEndpoint: "https://storage.googleapis.com",
    universeDomain: "googleapis.com",
    credentials: { client_email: config.clientEmail, private_key: config.privateKey },
    retryOptions: { autoRetry: false },
  });
  return createGcsObjectStore(client, config.bucket);
}
