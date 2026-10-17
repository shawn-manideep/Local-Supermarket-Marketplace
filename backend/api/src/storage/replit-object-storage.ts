import type { Client } from "@replit/object-storage";

export type ReplitObjectStorageClient = Pick<
  Client,
  "uploadFromBytes" | "downloadAsBytes" | "delete" | "exists"
>;

export interface ReplitObjectStore {
  put(objectName: string, bytes: Buffer): Promise<void>;
  get(objectName: string): Promise<Buffer>;
  getOptional(objectName: string): Promise<Buffer | null>;
  delete(objectName: string): Promise<void>;
}

function safeObjectName(objectName: string) {
  const parts = objectName.split("/");
  if (
    objectName.startsWith("/") ||
    objectName.includes("\\") ||
    objectName.includes("\0") ||
    parts.some((part) => !part || part === "." || part === ".." || !/^[\w.-]+$/.test(part))
  ) {
    throw new Error("Invalid App Storage object path.");
  }
  return objectName;
}

function requireSuccess<T>(result: { ok: boolean; value?: T }, operation: string): T {
  if (!result.ok) throw new Error(`Replit App Storage ${operation} failed.`);
  return result.value as T;
}

export function createReplitObjectStore(client: ReplitObjectStorageClient): ReplitObjectStore {
  return {
    async put(objectName, bytes) {
      const result = await client.uploadFromBytes(safeObjectName(objectName), bytes, {
        compress: false,
      });
      requireSuccess(result, "upload");
    },
    async get(objectName) {
      const result = await client.downloadAsBytes(safeObjectName(objectName), {
        decompress: false,
      });
      const [bytes] = requireSuccess(result, "download");
      return Buffer.from(bytes);
    },
    async getOptional(objectName) {
      const result = await client.exists(safeObjectName(objectName));
      if (!requireSuccess(result, "lookup")) return null;
      return this.get(objectName);
    },
    async delete(objectName) {
      const result = await client.delete(safeObjectName(objectName), { ignoreNotFound: true });
      requireSuccess(result, "delete");
    },
  };
}

let storePromise: Promise<ReplitObjectStore> | undefined;

export function getReplitObjectStore(): Promise<ReplitObjectStore> {
  storePromise ??= import("@replit/object-storage").then(({ Client }) =>
    createReplitObjectStore(new Client()),
  );
  return storePromise;
}

function normalizePrefix(prefix: string | undefined) {
  if (!prefix) throw new Error("App Storage prefix is not configured.");
  return prefix.replace(/^\/+|\/+$/g, "");
}

function resolvePrivateObjectName(ref: string, area: string, directory: string | undefined) {
  const prefix = normalizePrefix(directory);
  const objectName = safeObjectName(ref.replace(/^\/+/, ""));
  if (!objectName.startsWith(`${prefix}/${area}/`)) {
    throw new Error("Private object reference is outside its allowed namespace.");
  }
  return objectName;
}

function resolvePublicPrefix(searchPaths: string | undefined) {
  const prefix = searchPaths?.split(",").map((value) => value.trim()).find(Boolean);
  return normalizePrefix(prefix);
}

function safeSegment(value: string) {
  if (!/^[\w.-]+$/.test(value) || value === "." || value === "..") {
    throw new Error("Invalid App Storage object identifier.");
  }
  return value;
}

export function createPrivateObjectStorageAdapter(
  area: "vendor-documents" | "delivery-photos",
  store: ReplitObjectStore,
  getDirectory: () => string | undefined,
) {
  return {
    async put(ref: string, bytes: Buffer) {
      await store.put(resolvePrivateObjectName(ref, area, getDirectory()), bytes);
    },
    async get(ref: string) {
      return store.get(resolvePrivateObjectName(ref, area, getDirectory()));
    },
    async discard(ref: string) {
      await store.delete(resolvePrivateObjectName(ref, area, getDirectory()));
    },
  };
}

export function createProductImageStorageAdapter(
  store: ReplitObjectStore,
  getSearchPaths: () => string | undefined,
) {
  function keys(storeId: string, imageId: string) {
    const prefix = resolvePublicPrefix(getSearchPaths());
    const base = `${prefix}/product-images/${safeSegment(storeId)}/${safeSegment(imageId)}`;
    return { image: safeObjectName(base), metadata: safeObjectName(`${base}.metadata.json`) };
  }

  return {
    async put(storeId: string, imageId: string, bytes: Buffer, mimeType: string) {
      const names = keys(storeId, imageId);
      await store.put(names.image, bytes);
      try {
        await store.put(names.metadata, Buffer.from(JSON.stringify({ mimeType }), "utf8"));
      } catch (error) {
        await store.delete(names.image).catch(() => undefined);
        throw error;
      }
    },
    async get(storeId: string, imageId: string) {
      const names = keys(storeId, imageId);
      const bytes = await store.get(names.image);
      const metadataBytes = await store.getOptional(names.metadata);
      let mimeType = "application/octet-stream";
      if (metadataBytes) {
        try {
          const parsed: unknown = JSON.parse(metadataBytes.toString("utf8"));
          if (
            typeof parsed === "object" &&
            parsed !== null &&
            "mimeType" in parsed &&
            typeof parsed.mimeType === "string"
          ) {
            mimeType = parsed.mimeType;
          }
        } catch {
          // Retain the existing octet-stream fallback for absent or invalid metadata.
        }
      }
      return { bytes, mimeType };
    },
    async discard(storeId: string, imageId: string) {
      const names = keys(storeId, imageId);
      await store.delete(names.image);
      await store.delete(names.metadata);
    },
  };
}

interface BrandingManifest {
  revision: string;
  mimeType: string;
  objectName: string;
}

function parseBrandingManifest(
  bytes: Buffer,
  expectedPrefix: string,
): BrandingManifest {
  const parsed: unknown = JSON.parse(bytes.toString("utf8"));
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !("revision" in parsed) ||
    typeof parsed.revision !== "string" ||
    !/^[0-9a-f-]{36}$/i.test(parsed.revision) ||
    !("mimeType" in parsed) ||
    typeof parsed.mimeType !== "string" ||
    !["image/png", "image/jpeg"].includes(parsed.mimeType) ||
    !("objectName" in parsed) ||
    typeof parsed.objectName !== "string" ||
    !parsed.objectName.startsWith(`${expectedPrefix}/application-branding/active-logo/versions/`)
  ) {
    throw new Error("Application branding metadata is invalid.");
  }
  return parsed as BrandingManifest;
}

export function createBrandingStorageAdapter(
  store: ReplitObjectStore,
  getSearchPaths: () => string | undefined,
  createRevision: () => string,
) {
  function names() {
    const prefix = resolvePublicPrefix(getSearchPaths());
    return {
      prefix,
      manifest: safeObjectName(`${prefix}/application-branding/active-logo.manifest.json`),
    };
  }

  async function readManifest(): Promise<BrandingManifest | null> {
    const { prefix, manifest } = names();
    const bytes = await store.getOptional(manifest);
    return bytes ? parseBrandingManifest(bytes, prefix) : null;
  }

  return {
    async metadata() {
      const current = await readManifest();
      return current ? { revision: current.revision, mimeType: current.mimeType } : null;
    },
    async put(bytes: Buffer, mimeType: string) {
      if (!["image/png", "image/jpeg"].includes(mimeType)) {
        throw new Error("Unsupported application branding image type.");
      }
      const { prefix, manifest } = names();
      const revision = createRevision();
      if (!/^[0-9a-f-]{36}$/i.test(revision)) {
        throw new Error("Invalid application branding revision.");
      }
      const objectName = safeObjectName(
        `${prefix}/application-branding/active-logo/versions/${revision}`,
      );
      await store.put(objectName, bytes);
      try {
        await store.put(
          manifest,
          Buffer.from(JSON.stringify({ revision, mimeType, objectName }), "utf8"),
        );
      } catch (error) {
        await store.delete(objectName).catch(() => undefined);
        throw error;
      }
    },
    async get() {
      const current = await readManifest();
      if (!current) throw new Error("No application logo configured.");
      return {
        bytes: await store.get(current.objectName),
        mimeType: current.mimeType,
      };
    },
  };
}
