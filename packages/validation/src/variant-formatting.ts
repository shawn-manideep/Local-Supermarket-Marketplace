/**
 * Display-only formatting. Never converts units or modifies stored values.
 * Decimal strings retain their precision; only redundant zeroes are removed.
 */
export function formatQuantity(value: number | string): string {
  const raw = String(value).trim();
  if (!raw || !Number.isFinite(Number(raw))) return raw;
  if (!/^[+-]?\d+(?:\.\d+)?$/.test(raw)) return String(Number(raw));
  return raw
    .replace(/(\.\d*?)0+$/, "$1")
    .replace(/\.$/, "")
    .replace(/^([+-]?)0+(?=\d)/, "$1");
}

export function formatVariantName(quantityValue: number | string, quantityUnit: string): string {
  const quantity = Number(quantityValue);
  const unit = quantityUnit === "l" ? "L" : quantityUnit;
  const plurals: Record<string, string> = {
    piece: "pieces",
    pack: "packs",
    bottle: "bottles",
    box: "boxes",
  };
  return `${formatQuantity(quantityValue)} ${quantity !== 1 ? plurals[quantityUnit] ?? unit : unit}`;
}

/** Currency display only. Whole rupees omit .00; fractional rupees retain two digits. */
export function formatPrice(value: number | string): string {
  const raw = String(value).trim();
  if (!raw || !Number.isFinite(Number(raw))) return raw;
  const amount = Number(raw);
  return amount.toFixed(Number.isInteger(amount) ? 0 : 2);
}