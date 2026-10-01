export { masterCatalogRouter } from "./routes.js";
export {
  canonicalIdentity,
  createDuplicateReviewToken,
  isNewMasterCategoryAssignment,
  normalizeIdentityText,
  reviewedCandidateProof,
  verifyDuplicateReviewToken,
  withMasterCatalogWriteLock,
} from "./duplicate-review.js";