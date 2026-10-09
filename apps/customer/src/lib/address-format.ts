import type { CustomerAddress, CustomerOrderAddressSnapshot } from "./api";

type AddressShape = Pick<CustomerAddress, "line1" | "line2" | "city" | "state" | "pincode"> &
  Partial<Pick<CustomerAddress, "houseNumber" | "buildingName" | "landmark" | "locality">>;

export function addressStreetLines(address: AddressShape | CustomerOrderAddressSnapshot): string[] {
  const streetParts = isLegacyAddress(address)
    ? [address.line1, address.line2]
    : [address.houseNumber, address.buildingName, address.landmark, address.locality];
  const street = streetParts
    .map((part) => part?.trim())
    .filter((part): part is string => !!part);
  return [street.join(", "), [address.city, address.state, address.pincode].filter(Boolean).join(", ")].filter(Boolean);
}

export function isLegacyAddress(address: AddressShape | CustomerOrderAddressSnapshot): boolean {
  return [address.houseNumber, address.buildingName, address.landmark, address.locality]
    .every((part) => part === null || part === undefined);
}

export function formatAddress(address: AddressShape | CustomerOrderAddressSnapshot): string {
  return addressStreetLines(address).join("\n");
}
