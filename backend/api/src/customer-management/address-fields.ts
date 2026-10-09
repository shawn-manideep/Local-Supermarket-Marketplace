import { HttpError } from "../http.js";

type AddressParts = {
  line1?: string; line2?: string | null; houseNumber?: string | null;
  buildingName?: string | null; landmark?: string | null; locality?: string | null;
};
const structured = ["houseNumber", "buildingName", "landmark", "locality"] as const;

/** Keep legacy lines readable to all existing consumers without parsing old data. */
export function addressWriteFields<T extends AddressParts>(
  input: T, existing?: AddressParts,
): Omit<T, keyof AddressParts> & AddressParts {
  if (structured.some(key => input[key] !== undefined)) {
    const houseNumber = input.houseNumber ?? existing?.houseNumber ?? input.line1 ?? existing?.line1;
    if (!houseNumber?.trim()) throw new HttpError(400, "House Number / Flat Number is required.");
    const buildingName = input.buildingName === undefined ? existing?.buildingName ?? null : input.buildingName;
    const landmark = input.landmark === undefined ? existing?.landmark ?? null : input.landmark;
    const locality = input.locality === undefined
      ? existing?.locality ?? (!existing?.houseNumber ? existing?.line2 : null) ?? null : input.locality;
    return { ...input, houseNumber, buildingName, landmark, locality,
      line1: houseNumber, line2: [buildingName, landmark, locality].filter(Boolean).join(", ") || null };
  }
  if (input.line1 !== undefined || input.line2 !== undefined) {
    return { ...input, houseNumber: null, buildingName: null, landmark: null, locality: null };
  }
  return input;
}
