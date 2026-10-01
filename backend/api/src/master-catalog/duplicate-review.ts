import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { sql, type SQL } from "drizzle-orm";

const REVIEW_TOKEN_TTL_MS = 5 * 60 * 1_000;
const MASTER_CATALOG_WRITE_LOCK_NAMESPACE = "master-catalog:serialized-writes:v1";

export type CanonicalProductInput = {
  masterCategoryId: string | null;
  name: string;
  description?: string | null;
  image?: string | null;
  brand?: string | null;
  attributes: Record<string, string>;
};

type ReviewTokenPayload = {
  version: 1;
  canonicalDigest: string;
  reviewedCandidatesDigest: string;
  reviewedCandidateCount: number;
  issuedAt: number;
  expiresAt: number;
  nonce: string;
};

export function normalizeIdentityText(value: string | null | undefined) {
  return (value ?? "").normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("en");
}

export function isNewMasterCategoryAssignment(
  currentCategoryId: string | null,
  requestedCategoryId: string | null | undefined,
) {
  return requestedCategoryId !== undefined && requestedCategoryId !== currentCategoryId;
}

export function canonicalIdentity(product: CanonicalProductInput) {
  const attributes = Object.fromEntries(
    Object.entries(product.attributes ?? {})
      .map(([key, value]) => [normalizeIdentityText(key), normalizeIdentityText(value)] as const)
      .sort(([left], [right]) => left.localeCompare(right)),
  );
  return JSON.stringify({
    name: normalizeIdentityText(product.name),
    brand: normalizeIdentityText(product.brand),
    attributes,
  });
}

function canonicalReviewInput(product: CanonicalProductInput) {
  const attributes = Object.fromEntries(
    Object.entries(product.attributes ?? {})
      .map(([key, value]) => [key.trim(), value.trim()] as const)
      .sort(([left], [right]) => left.localeCompare(right)),
  );
  return JSON.stringify({
    masterCategoryId: product.masterCategoryId ?? null,
    name: product.name,
    description: product.description ?? null,
    image: product.image ?? null,
    brand: product.brand ?? null,
    attributes,
  });
}

export function reviewedCandidateProof(candidate: {
  id: string;
  masterCategoryId: string | null;
  name: string;
  description: string | null;
  image: string | null;
  brand: string | null;
  attributes: Record<string, string> | null;
  isActive: boolean;
  categoryName: string | null;
  categoryIsActive: boolean | null;
}) {
  const attributes = Object.fromEntries(
    Object.entries(candidate.attributes ?? {}).sort(([left], [right]) => left.localeCompare(right)),
  );
  const reviewedContent = JSON.stringify({
    id: candidate.id,
    masterCategoryId: candidate.masterCategoryId,
    name: candidate.name,
    description: candidate.description,
    image: candidate.image,
    brand: candidate.brand,
    attributes,
    isActive: candidate.isActive,
    categoryName: candidate.categoryName,
    categoryIsActive: candidate.categoryIsActive,
  });
  return `${candidate.id}:${createHash("sha256").update(reviewedContent).digest("hex")}`;
}

function signingSecret(explicitSecret?: string) {
  const secret = explicitSecret ?? process.env.MASTER_CATALOG_REVIEW_TOKEN_SECRET ?? process.env.SUPABASE_DB_URL;
  if (!secret) {
    throw new Error(
      "MASTER_CATALOG_REVIEW_TOKEN_SECRET or SUPABASE_DB_URL is required for duplicate-review tokens.",
    );
  }
  return secret;
}

function signature(encodedPayload: string, secret?: string) {
  return createHmac("sha256", signingSecret(secret)).update(encodedPayload).digest("base64url");
}

function candidateSetDigest(reviewedCandidateIds: string[]) {
  const candidates = [...new Set(reviewedCandidateIds)].sort();
  return {
    digest: createHash("sha256").update(JSON.stringify(candidates)).digest("hex"),
    count: candidates.length,
  };
}

export function createDuplicateReviewToken(
  product: CanonicalProductInput,
  reviewedCandidateIds: string[],
  options: { now?: number; secret?: string } = {},
) {
  const issuedAt = options.now ?? Date.now();
  const candidates = candidateSetDigest(reviewedCandidateIds);
  const payload: ReviewTokenPayload = {
    version: 1,
    canonicalDigest: createHmac("sha256", "master-catalog-canonical-input-v1")
      .update(canonicalReviewInput(product))
      .digest("hex"),
    reviewedCandidatesDigest: candidates.digest,
    reviewedCandidateCount: candidates.count,
    issuedAt,
    expiresAt: issuedAt + REVIEW_TOKEN_TTL_MS,
    nonce: randomBytes(16).toString("base64url"),
  };
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${encodedPayload}.${signature(encodedPayload, options.secret)}`;
}

export function verifyDuplicateReviewToken(
  token: string,
  product: CanonicalProductInput,
  currentCandidateIds: string[],
  options: { now?: number; secret?: string } = {},
) {
  const [encodedPayload, providedSignature, extra] = token.split(".");
  if (!encodedPayload || !providedSignature || extra !== undefined) return false;

  let expectedSignature: string;
  try {
    expectedSignature = signature(encodedPayload, options.secret);
  } catch {
    return false;
  }
  const expectedBuffer = Buffer.from(expectedSignature);
  const providedBuffer = Buffer.from(providedSignature);
  if (
    expectedBuffer.length !== providedBuffer.length ||
    !timingSafeEqual(expectedBuffer, providedBuffer)
  ) {
    return false;
  }

  let payload: ReviewTokenPayload;
  try {
    payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8")) as ReviewTokenPayload;
  } catch {
    return false;
  }
  if (
    payload.version !== 1 ||
    typeof payload.canonicalDigest !== "string" ||
    typeof payload.reviewedCandidatesDigest !== "string" ||
    !Number.isInteger(payload.reviewedCandidateCount) ||
    !Number.isFinite(payload.expiresAt) ||
    payload.expiresAt <= (options.now ?? Date.now())
  ) {
    return false;
  }

  const digest = createHmac("sha256", "master-catalog-canonical-input-v1")
    .update(canonicalReviewInput(product))
    .digest("hex");
  if (digest !== payload.canonicalDigest) return false;

  const current = candidateSetDigest(currentCandidateIds);
  return payload.reviewedCandidateCount === current.count &&
    payload.reviewedCandidatesDigest === current.digest;
}

export interface AdvisoryLockExecutor {
  execute(query: SQL): Promise<unknown>;
}

export async function withMasterCatalogWriteLock<T>(
  transaction: AdvisoryLockExecutor,
  operation: () => Promise<T>,
) {
  await transaction.execute(sql`
    SELECT pg_advisory_xact_lock(hashtextextended(${MASTER_CATALOG_WRITE_LOCK_NAMESPACE}, 0))
  `);
  return operation();
}