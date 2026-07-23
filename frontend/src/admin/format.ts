const inrFormatter = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});
const numberFormatter = new Intl.NumberFormat("en-IN");

export function formatInrFromMinorUnits(minorUnits: number): string {
  return inrFormatter.format(minorUnits / 100);
}

export function formatNumber(value: number): string {
  return numberFormatter.format(value);
}

export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}
