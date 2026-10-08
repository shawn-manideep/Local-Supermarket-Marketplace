import type {
  DocumentVerificationState, VendorCurrentDocument, VendorDocumentSummary,
  VendorDocumentType, VendorDocumentStatus as SharedVendorDocumentStatus,
} from "../../../lib/api-client-react/src/generated/api.schemas";

export type DocumentVerificationStatus = DocumentVerificationState;
export type CurrentDocumentVerificationStatus = NonNullable<VendorCurrentDocument["verificationStatus"]>;
export type VendorDocumentTypeName = VendorDocumentType;
export type VendorDocumentCurrent = VendorCurrentDocument;
export type VendorDocumentItem = VendorDocumentSummary;
export type VendorDocumentStatus = SharedVendorDocumentStatus;
