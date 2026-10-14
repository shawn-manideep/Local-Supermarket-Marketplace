import type { AddressInput, CustomerAddress } from "./api";
import { isLegacyAddress } from "./address-format";

export const blankAddress: AddressInput = {
  label: null,
  recipientName: "",
  phone: "",
  line1: "",
  line2: null,
  houseNumber: "",
  buildingName: null,
  landmark: null,
  locality: null,
  city: "",
  state: "",
  pincode: "",
  isDefault: false,
};

export function editableAddress(address: AddressInput | CustomerAddress): AddressInput {
  const legacy = isLegacyAddress(address);
  const houseNumber = legacy ? address.line1 : address.houseNumber ?? "";
  const locality = legacy ? address.line2 : address.locality ?? null;
  return {
    label: address.label,
    recipientName: address.recipientName,
    phone: address.phone,
    line1: houseNumber,
    line2: locality,
    houseNumber,
    buildingName: address.buildingName ?? null,
    landmark: address.landmark ?? null,
    locality,
    city: address.city,
    state: address.state,
    pincode: address.pincode,
    isDefault: address.isDefault,
  };
}

export function validateAddressInput(draft: AddressInput): string | null {
  if (!draft.recipientName || !draft.phone || !draft.houseNumber?.trim() || !draft.city || !draft.state || !draft.pincode) {
    return "Please fill all required fields.";
  }
  if (!/^[6-9]\d{9}$/.test(draft.phone)) return "Please enter a valid 10-digit Indian mobile number.";
  return null;
}

export function normalizeAddressInput(draft: AddressInput): AddressInput {
  const houseNumber = draft.houseNumber?.trim() ?? "";
  const locality = draft.locality?.trim() ?? "";
  return {
    ...editableAddress(draft),
    line1: houseNumber,
    line2: locality || null,
    houseNumber,
    buildingName: draft.buildingName?.trim() || null,
    landmark: draft.landmark?.trim() || null,
    locality: locality || null,
  };
}
