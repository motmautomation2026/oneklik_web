export function formatMoney(minorUnits: number, currency = "INR"): string {
  const value = minorUnits / 100;
  try {
    return new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value);
  } catch {
    return `${currency} ${value.toFixed(2)}`;
  }
}

export function taxPercentLabel(taxRateBps: number): string {
  const pct = taxRateBps / 100;
  return Number.isInteger(pct) ? `${pct}%` : `${pct}%`;
}
