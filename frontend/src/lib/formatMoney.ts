export function formatMoney(
  minorUnits: number,
  currency = "INR",
  options?: { trimTrailingZeros?: boolean },
): string {
  const value = minorUnits / 100;
  const trim = options?.trimTrailingZeros ?? false;
  const minimumFractionDigits = trim && Number.isInteger(value) ? 0 : 2;
  try {
    return new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency,
      minimumFractionDigits,
      maximumFractionDigits: 2,
    }).format(value);
  } catch {
    return `${currency} ${trim && Number.isInteger(value) ? value.toFixed(0) : value.toFixed(2)}`;
  }
}

export function taxPercentLabel(taxRateBps: number): string {
  const pct = taxRateBps / 100;
  return Number.isInteger(pct) ? `${pct}%` : `${pct}%`;
}
