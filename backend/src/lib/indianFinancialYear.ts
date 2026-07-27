const IST = "Asia/Kolkata";

function istParts(date: Date): { year: number; month: number; day: number } {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: IST,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = fmt.formatToParts(date);
  const year = Number(parts.find((p) => p.type === "year")?.value);
  const month = Number(parts.find((p) => p.type === "month")?.value);
  const day = Number(parts.find((p) => p.type === "day")?.value);
  if (!year || !month || !day) {
    throw new Error("failed to derive IST calendar date");
  }
  return { year, month, day };
}

/** Calendar date in IST as YYYY-MM-DD (for invoice_date). */
export function istCalendarDate(date: Date = new Date()): string {
  const { year, month, day } = istParts(date);
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/**
 * Indian financial year for a moment in time.
 * FY runs 1 Apr → 31 Mar in Asia/Kolkata.
 * `label` is the starting calendar year used in invoice numbers (e.g. "2026" for FY 2026-27).
 * `key` is the full key stored on counters/invoices (e.g. "2026-27").
 */
export function indianFinancialYear(date: Date = new Date()): { key: string; label: string } {
  const { year, month } = istParts(date);
  const startYear = month >= 4 ? year : year - 1;
  const endYearShort = String((startYear + 1) % 100).padStart(2, "0");
  return {
    key: `${startYear}-${endYearShort}`,
    label: String(startYear),
  };
}

/** Human-readable paid-on date, e.g. "27 July 2026", in IST. */
export function formatIstLongDate(date: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: IST,
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(date);
}
