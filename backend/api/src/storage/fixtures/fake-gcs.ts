import type { GcsClient } from "../external-gcs.js";
import type { ObjectWriteMetadata } from "../object-store.js";

export interface FixtureObject {
  bytes: Buffer;
  metadata: ObjectWriteMetadata;
  generation: string;
}

/** In-memory SDK double. No credentials, environment access, network or files. */
export class FakeGcs implements GcsClient {
  readonly objects = new Map<string, FixtureObject>();
  readonly versions = new Map<string, FixtureObject>();
  readonly operations: Array<{ operation: string; key: string; generation?: string | 0 }> = [];
  private sequence = 0;
  failure?: { operation: string; code: number; message?: string };
  /** Lost response AFTER commit; fixture only, never installed in runtime clients. */
  afterCommitFailure?: "write" | "delete";
  beforeSave?: () => void;
  beforeDownload?: () => void;

  private fail(operation: string) {
    if (this.failure?.operation === operation) {
      const failure = this.failure;
      this.failure = undefined;
      throw Object.assign(new Error(failure.message ?? "Synthetic storage fault"), { code: failure.code });
    }
  }
  seed(key: string, bytes: Buffer, metadata: ObjectWriteMetadata) {
    const object = { bytes: Buffer.from(bytes), metadata: structuredClone(metadata), generation: String(++this.sequence) };
    this.objects.set(key, object);
    this.versions.set(`${key}@${object.generation}`, object);
  }
  bucket(_name: string): ReturnType<GcsClient["bucket"]> {
    return { file: (key, options) => ({
      getMetadata: async () => {
        this.operations.push({ operation: "head", key });
        this.fail("head");
        const value = this.objects.get(key);
        if (!value) throw { code: 404 };
        return [{ generation: value.generation, contentType: value.metadata.mimeType,
          cacheControl: value.metadata.cacheControl, metadata: structuredClone(value.metadata.custom),
          ...(value.metadata.contentDisposition === undefined ? {} : { contentDisposition: value.metadata.contentDisposition }),
          ...(value.metadata.contentEncoding === undefined ? {} : { contentEncoding: value.metadata.contentEncoding }),
          ...(value.metadata.contentLanguage === undefined ? {} : { contentLanguage: value.metadata.contentLanguage }) }];
      },
      download: async () => {
        this.operations.push({ operation: "read", key, generation: options?.generation });
        this.fail("read");
        const hook = this.beforeDownload;
        this.beforeDownload = undefined;
        hook?.();
        const value = options?.generation
          ? this.versions.get(`${key}@${options.generation}`) : this.objects.get(key);
        if (!value) throw { code: 404 };
        return [Buffer.from(value.bytes)];
      },
      save: async (bytes, saveOptions) => {
        this.operations.push({ operation: "write", key, generation: saveOptions.preconditionOpts.ifGenerationMatch });
        this.fail("write");
        const hook = this.beforeSave;
        this.beforeSave = undefined;
        hook?.();
        const current = this.objects.get(key);
        const expected = saveOptions.preconditionOpts.ifGenerationMatch;
        if (expected === 0 ? current !== undefined : current?.generation !== expected) throw { code: 412 };
        this.seed(key, bytes, { mimeType: saveOptions.metadata.contentType,
          cacheControl: saveOptions.metadata.cacheControl, custom: saveOptions.metadata.metadata,
          ...(saveOptions.metadata.contentDisposition === undefined ? {} : { contentDisposition: saveOptions.metadata.contentDisposition }),
          ...(saveOptions.metadata.contentEncoding === undefined ? {} : { contentEncoding: saveOptions.metadata.contentEncoding }),
          ...(saveOptions.metadata.contentLanguage === undefined ? {} : { contentLanguage: saveOptions.metadata.contentLanguage }) });
        if (this.afterCommitFailure === "write") {
          this.afterCommitFailure = undefined;
          throw { code: 503 };
        }
      },
      delete: async deleteOptions => {
        this.operations.push({ operation: "delete", key, generation: deleteOptions.ifGenerationMatch });
        this.fail("delete");
        const current = this.objects.get(key);
        if (!current) throw { code: 404 };
        if (current.generation !== deleteOptions.ifGenerationMatch) throw { code: 412 };
        this.objects.delete(key);
        if (this.afterCommitFailure === "delete") {
          this.afterCommitFailure = undefined;
          throw { code: 503 };
        }
      },
    }) };
  }
}

export function syntheticExternalEnv(): NodeJS.ProcessEnv {
  return {
    API_OBJECT_STORAGE_PROVIDER: "external-gcs",
    EXTERNAL_GCS_RUNTIME_APPROVAL: "approved-for-runtime",
    EXTERNAL_GCS_PROJECT_ID: "synthetic-project",
    EXTERNAL_GCS_BUCKET: "synthetic-destination",
    EXTERNAL_GCS_CLIENT_EMAIL: "fixture@synthetic-project.iam.gserviceaccount.com",
    // Deliberately NOT a usable key. Only pure configuration shape checks use it.
    EXTERNAL_GCS_PRIVATE_KEY: "-----BEGIN PRIVATE KEY-----\nSYNTHETIC-NOT-A-CREDENTIAL\n-----END PRIVATE KEY-----",
    EXTERNAL_GCS_PRIVATE_REFERENCE_ROOT: "/synthetic-source/private",
    EXTERNAL_GCS_PUBLIC_REFERENCE_ROOT: "/synthetic-source/public",
    PRIVATE_OBJECT_DIR: "/synthetic-source/private",
    PUBLIC_OBJECT_SEARCH_PATHS: "/synthetic-source/public",
  };
}
