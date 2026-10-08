export * from "./generated/api";
export * from "./generated/types";
// Orval emits identically named path/body validators and input types.
export { GetCustomerDeliverySlotsParams, SubmitVendorDocumentsBody } from "./generated/api";
export type {
  GetCustomerDeliverySlotsParams as CustomerDeliverySlotsQueryInput,
  SubmitVendorDocumentsBody as VendorDocumentSubmissionInput,
} from "./generated/types";
// Orval names both the path schema and query type "PreviewCustomerReorderParams".
// Keep the path validator under that name, and provide a distinct query-input type.
export { PreviewCustomerReorderParams } from "./generated/api";
export type { PreviewCustomerReorderParams as ReorderPreviewQueryInput } from "./generated/types";
// Separate Orval's document path validator from the filename query-input type.
export { UploadVendorDocumentParams } from "./generated/api";
export type { UploadVendorDocumentParams as VendorDocumentUploadQueryInput } from "./generated/types";
export { SaveCustomerItemBody, ChangeCustomerPasswordBody } from "./generated/api";
export type { SaveCustomerItemBody as SaveCustomerItemInput, ChangeCustomerPasswordBody as ChangeCustomerPasswordInput } from "./generated/types";
