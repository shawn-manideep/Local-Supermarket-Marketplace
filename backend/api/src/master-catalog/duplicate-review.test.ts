import assert from "node:assert/strict";
import test from "node:test";
import {
  canonicalIdentity,
  createDuplicateReviewToken,
  isNewMasterCategoryAssignment,
  reviewedCandidateProof,
  verifyDuplicateReviewToken,
  withMasterCatalogWriteLock,
  type CanonicalProductInput,
} from "./duplicate-review.js";

const canonicalProduct: CanonicalProductInput = {
  masterCategoryId: "11111111-1111-4111-8111-111111111111",
  name: "  Basmati   Rice ",
  description: "Premium rice",
  image: null,
  brand: "  Example Brand ",
  attributes: { grade: "  Extra Long ", variety: "Traditional" },
};

test("canonical identity normalizes whitespace and case and distinguishes product attributes", () => {
  assert.equal(canonicalIdentity(canonicalProduct), canonicalIdentity({
    ...canonicalProduct,
    name: "basmati rice",
    brand: "example brand",
    attributes: { variety: "traditional", grade: "extra long" },
  }));
  assert.equal(canonicalIdentity(canonicalProduct), canonicalIdentity({
    ...canonicalProduct,
    masterCategoryId: "22222222-2222-4222-8222-222222222222",
  }));
  assert.notEqual(canonicalIdentity(canonicalProduct), canonicalIdentity({
    ...canonicalProduct,
    attributes: { ...canonicalProduct.attributes, grade: "short grain" },
  }));
});

test("unchanged category assignments do not require an archived category to be active", () => {
  const archivedCategoryId = "44444444-4444-4444-8444-444444444444";
  assert.equal(isNewMasterCategoryAssignment(archivedCategoryId, archivedCategoryId), false);
  assert.equal(isNewMasterCategoryAssignment(archivedCategoryId, undefined), false);
  assert.equal(isNewMasterCategoryAssignment(archivedCategoryId, "55555555-5555-4555-8555-555555555555"), true);
  assert.equal(isNewMasterCategoryAssignment(null, undefined), false);
  assert.equal(isNewMasterCategoryAssignment(null, null), false);
  assert.equal(isNewMasterCategoryAssignment(null, archivedCategoryId), true);
});

test("duplicate review token is bound to canonical input, candidates, signature, and expiry", () => {
  const token = createDuplicateReviewToken(canonicalProduct, ["second", "first"], {
    now: 1_000,
    secret: "unit-test-signing-secret",
  });
  assert.equal(verifyDuplicateReviewToken(token, canonicalProduct, ["first", "second"], {
    now: 2_000,
    secret: "unit-test-signing-secret",
  }), true);
  assert.equal(verifyDuplicateReviewToken(token, { ...canonicalProduct, name: "Different" }, ["first", "second"], {
    now: 2_000,
    secret: "unit-test-signing-secret",
  }), false);
  assert.equal(verifyDuplicateReviewToken(token, canonicalProduct, ["first"], {
    now: 2_000,
    secret: "unit-test-signing-secret",
  }), false);
  assert.equal(verifyDuplicateReviewToken(token, canonicalProduct, ["first", "second"], {
    now: 301_000,
    secret: "unit-test-signing-secret",
  }), false);
  assert.equal(verifyDuplicateReviewToken(`${token}tampered`, canonicalProduct, ["first", "second"], {
    now: 2_000,
    secret: "unit-test-signing-secret",
  }), false);
});

test("reviewed-candidate proof changes when candidate content changes without changing its ID", () => {
  const candidate = {
    id: "33333333-3333-4333-8333-333333333333",
    masterCategoryId: canonicalProduct.masterCategoryId,
    name: canonicalProduct.name,
    description: canonicalProduct.description ?? null,
    image: canonicalProduct.image ?? null,
    brand: canonicalProduct.brand ?? null,
    attributes: canonicalProduct.attributes,
    isActive: true,
    categoryName: "Rice",
    categoryIsActive: true,
  };
  assert.notEqual(
    reviewedCandidateProof(candidate),
    reviewedCandidateProof({ ...candidate, name: "Different product" }),
  );
  assert.notEqual(
    reviewedCandidateProof(candidate),
    reviewedCandidateProof({ ...candidate, categoryIsActive: false }),
  );
  assert.notEqual(
    reviewedCandidateProof(candidate),
    reviewedCandidateProof({ ...candidate, attributes: { grade: "Short grain" } }),
  );
});

test("pending candidate proof binds NULL category and status while retaining archived candidates", () => {
  const pendingCandidate = {
    id: "33333333-3333-4333-8333-333333333333",
    masterCategoryId: null,
    name: "Pending product",
    description: null,
    image: null,
    brand: null,
    attributes: {},
    isActive: true,
    categoryName: null,
    categoryIsActive: null,
  };
  const proof = reviewedCandidateProof(pendingCandidate);
  assert.notEqual(
    proof,
    reviewedCandidateProof({ ...pendingCandidate, masterCategoryId: canonicalProduct.masterCategoryId }),
  );
  assert.notEqual(
    proof,
    reviewedCandidateProof({ ...pendingCandidate, categoryIsActive: false }),
  );
  assert.notEqual(
    proof,
    reviewedCandidateProof({ ...pendingCandidate, isActive: false }),
  );
});

test("duplicate-review token normalizes omitted category to NULL and binds that pending input", () => {
  const pendingProduct: CanonicalProductInput = { ...canonicalProduct, masterCategoryId: null };
  const omittedCategory = {
    ...pendingProduct,
    masterCategoryId: undefined as unknown as null,
  };
  const token = createDuplicateReviewToken(omittedCategory, [], {
    now: 1_000,
    secret: "unit-test-signing-secret",
  });
  assert.equal(verifyDuplicateReviewToken(token, pendingProduct, [], {
    now: 2_000,
    secret: "unit-test-signing-secret",
  }), true);
  assert.equal(verifyDuplicateReviewToken(token, canonicalProduct, [], {
    now: 2_000,
    secret: "unit-test-signing-secret",
  }), false);
});

test("catalog write helper acquires the shared advisory lock before concurrent mutations proceed", async () => {
  let queue = Promise.resolve();
  let active = 0;
  let maximumConcurrent = 0;
  let lockCalls = 0;
  const mutate = async () => {
    let release = () => {};
    await withMasterCatalogWriteLock({
      async execute(query) {
        assert.ok(query.queryChunks.length > 0);
        lockCalls += 1;
        const previous = queue;
        queue = new Promise<void>((resolve) => { release = resolve; });
        await previous;
      },
    }, async () => {
      active += 1;
      maximumConcurrent = Math.max(maximumConcurrent, active);
      try {
        await new Promise((resolve) => setTimeout(resolve, 5));
      } finally {
        active -= 1;
        release();
      }
    });
  };

  await Promise.all([mutate(), mutate(), mutate()]);
  assert.equal(maximumConcurrent, 1);
  assert.equal(lockCalls, 3);
});