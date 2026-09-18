export function moneyToCents(value: string) {
  if (!/^\d+(?:\.\d{1,2})?$/.test(value)) throw new Error("Invalid database money value");
  const [whole, decimal = ""] = value.split(".");
  return BigInt(whole) * 100n + BigInt(decimal.padEnd(2, "0"));
}

export function centsToMoney(value: bigint) {
  return `${value / 100n}.${String(value % 100n).padStart(2, "0")}`;
}