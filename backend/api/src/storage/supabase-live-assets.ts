import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { referenceRoot, safeObjectKey } from "./object-store.js";
import {
  supabaseStorageConfig,
  snapshotSupabaseStorageConfig,
  type SupabaseStorageConfig,
} from "./supabase-storage-config.js";
import { SupabaseStorageError } from "./supabase-storage.js";
import { validateLiveAssetBytes } from "./live-asset-validation.js";
import { createSupabaseVendorDocuments, documentFetch } from "./supabase-vendor-documents.js";

type StorageClient = Pick<SupabaseClient, "storage">;

function failure(error: unknown, mutation = false): never {
  let status: number | undefined;
  let errorCode: string | undefined;

  try {
    if (typeof error === "object" && error !== null) {
      const value = error as Record<string, unknown>;

      if (typeof value.status === "number") {
        status = value.status;
      }

      if (value.code !== undefined) {
        errorCode = String(value.code);
      }
    }
  } catch {
    // Never expose provider error details.
  }

  if (status === 409 || status === 412) {
    throw new SupabaseStorageError("CONFLICT");
  }

  if (status === 404 && errorCode === "NoSuchKey") {
    throw new SupabaseStorageError("NOT_FOUND");
  }

  if (mutation && (status === undefined || status >= 500)) {
    throw new SupabaseStorageError("UNKNOWN_OUTCOME");
  }

  throw new SupabaseStorageError("UNAVAILABLE");
}

function privateKey(
  config: SupabaseStorageConfig,
  ref: string,
  area: "vendor-documents" | "delivery-photos",
) {
  try {
    const value = referenceRoot(ref);
    const prefix = `${config.privateRoot}/${area}/`;
    if (!value.startsWith(prefix)) throw new Error();
    const parts = value.slice(prefix.length).split("/");
    if (
      parts.length !== 2 ||
      parts.some((part) => !/^[a-zA-Z0-9_-]{1,128}$/.test(part))
    ) {
      throw new Error();
    }
    return safeObjectKey(value);
  } catch {
    throw new SupabaseStorageError("INVALID_INPUT");
  }
}

function productKey(
  config: SupabaseStorageConfig,
  storeId: string,
  imageId: string,
) {
  if (
    ![storeId, imageId].every((value) => /^[a-zA-Z0-9_-]{1,128}$/.test(value))
  ) {
    throw new SupabaseStorageError("INVALID_INPUT");
  }
  return safeObjectKey(
    `${config.publicRoot}/product-images/${storeId}/${imageId}`,
  );
}

export function createSupabaseLiveAssets(
  client: StorageClient,
  input: SupabaseStorageConfig,
  documentClientForSignal: (signal: AbortSignal) => StorageClient = () => client,
) {
  const config = snapshotSupabaseStorageConfig(input);
  const bucket = client.storage.from(config.bucket);

  async function upload(
    key: string,
    bytes: Buffer,
    mimeType: string,
    visibility: "private" | "api-mediated",
  ) {
    try {
      validateLiveAssetBytes(bytes, mimeType);
      const { error } = await bucket.upload(key, Buffer.from(bytes), {
        upsert: false,
        contentType: mimeType,
        cacheControl: "0",
        metadata: { visibility },
      });
      if (error) failure(error, true);
    } catch (error) {
      if (error instanceof SupabaseStorageError) throw error;
      failure(error, true);
    }
  }

  async function download(key: string) {
    try {
      const { data, error } = await bucket.download(key);
      if (error || !data) failure(error ?? new Error(), false);
      const bytes = Buffer.from(await data.arrayBuffer());
      const mimeType = data.type;
      validateLiveAssetBytes(bytes, mimeType);
      return { bytes, mimeType };
    } catch (error) {
      if (error instanceof SupabaseStorageError) throw error;
      failure(error, false);
    }
  }

  async function has(key: string): Promise<boolean> {
    try {
      const { data, error } = await bucket.info(key);

      if (!error) return data !== null;

      const value = error as unknown as Record<string, unknown>;
      if (value.status === 404 && value.code === "NoSuchKey") {
        return false;
      }

      failure(error, false);
    } catch (error) {
      if (error instanceof SupabaseStorageError) throw error;
      failure(error, false);
    }
  }

  async function remove(key: string) {
    try {
      const { error } = await bucket.remove([key]);
      if (error) failure(error, true);
    } catch (error) {
      if (error instanceof SupabaseStorageError) throw error;
      failure(error, true);
    }
  }

  function privateArea(area: "vendor-documents" | "delivery-photos") {
    return {
      async put(ref: string, bytes: Buffer, mimeType: string) {
        const allowed =
          area === "delivery-photos"
            ? ["image/png", "image/jpeg"]
            : ["image/png", "image/jpeg", "application/pdf"];
        if (!allowed.includes(mimeType))
          throw new SupabaseStorageError("INVALID_INPUT");
        return upload(
          privateKey(config, ref, area),
          bytes,
          mimeType,
          "private",
        );
      },
      async get(ref: string) {
        return (await download(privateKey(config, ref, area))).bytes;
      },
      async discard(ref: string) {
        return remove(privateKey(config, ref, area));
      },
      async has(ref: string) {
        return has(privateKey(config, ref, area));
      },
    };
  }

  return {
    documents: createSupabaseVendorDocuments(documentClientForSignal, config),
    photos: privateArea("delivery-photos"),
    products: {
      async put(
        storeId: string,
        imageId: string,
        bytes: Buffer,
        mimeType: string,
      ) {
        if (!["image/png", "image/jpeg", "image/webp"].includes(mimeType)) {
          throw new SupabaseStorageError("INVALID_INPUT");
        }
        return upload(
          productKey(config, storeId, imageId),
          bytes,
          mimeType,
          "api-mediated",
        );
      },
      async get(storeId: string, imageId: string) {
        return download(productKey(config, storeId, imageId));
      },
      async discard(storeId: string, imageId: string) {
        return remove(productKey(config, storeId, imageId));
      },
      async has(storeId: string, imageId: string) {
        return has(productKey(config, storeId, imageId));
      },
    },
  };
}

let liveAssets: ReturnType<typeof createSupabaseLiveAssets> | undefined;

export function getSupabaseLiveAssets() {
  if (liveAssets) return liveAssets;

  const config = supabaseStorageConfig(process.env);
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) throw new SupabaseStorageError("LIVE_OPERATIONS_DISABLED");

  const client = createClient(
    `https://${config.projectRef}.supabase.co`,
    serviceKey,
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    },
  );

  // Isolated per-operation clients prevent document cancellation from affecting
  // product images, delivery photos or another concurrent document operation.
  liveAssets = createSupabaseLiveAssets(client, config, signal => createClient(
    `https://${config.projectRef}.supabase.co`,
    serviceKey,
    {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: { fetch: documentFetch(signal) },
    },
  ));
  return liveAssets;
}
