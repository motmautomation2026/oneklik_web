export type SupplyType = "intra_state" | "inter_state";

export interface TaxLineInput {
  /** Taxable (exclusive) amount in minor units, or gross if isTaxInclusive. */
  amountMinor: number;
  taxRateBps: number;
  isTaxInclusive?: boolean;
}

export interface TaxBreakdown {
  taxableMinor: number;
  taxTotalMinor: number;
  cgstMinor: number;
  sgstMinor: number;
  igstMinor: number;
  totalMinor: number;
  supplyType: SupplyType;
  taxRateBps: number;
}

const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;

export function gstinIsValid(gstin: string): boolean {
  return GSTIN_RE.test(gstin.trim().toUpperCase());
}

/** Half-up rounding to the nearest integer (paisa). */
export function roundHalfUp(n: number): number {
  return Math.sign(n) * Math.floor(Math.abs(n) + 0.5);
}

function exclusiveFromInclusive(grossMinor: number, rateBps: number): { taxable: number; tax: number } {
  if (rateBps === 0) return { taxable: grossMinor, tax: 0 };
  const taxable = roundHalfUp((grossMinor * 10000) / (10000 + rateBps));
  const tax = grossMinor - taxable;
  return { taxable, tax };
}

/**
 * Compute GST for a single line (or a pack treated as one line).
 * No price or rate literals live here — callers pass pack values.
 */
export function computeTax(input: {
  amountMinor: number;
  taxRateBps: number;
  isTaxInclusive?: boolean;
  sellerStateCode: string;
  buyerStateCode: string;
}): TaxBreakdown {
  const { amountMinor, taxRateBps, isTaxInclusive = false, sellerStateCode, buyerStateCode } = input;

  if (!Number.isInteger(amountMinor) || amountMinor < 0) {
    throw new Error("amountMinor must be a non-negative integer (paise)");
  }
  if (!Number.isInteger(taxRateBps) || taxRateBps < 0 || taxRateBps > 10000) {
    throw new Error("taxRateBps must be an integer between 0 and 10000");
  }

  let taxableMinor: number;
  let taxTotalMinor: number;

  if (isTaxInclusive) {
    const parts = exclusiveFromInclusive(amountMinor, taxRateBps);
    taxableMinor = parts.taxable;
    taxTotalMinor = parts.tax;
  } else {
    taxableMinor = amountMinor;
    taxTotalMinor = roundHalfUp((taxableMinor * taxRateBps) / 10000);
  }

  const supplyType: SupplyType = sellerStateCode === buyerStateCode ? "intra_state" : "inter_state";

  let cgstMinor = 0;
  let sgstMinor = 0;
  let igstMinor = 0;

  if (supplyType === "intra_state") {
    cgstMinor = Math.floor(taxTotalMinor / 2);
    sgstMinor = taxTotalMinor - cgstMinor;
  } else {
    igstMinor = taxTotalMinor;
  }

  const totalMinor = taxableMinor + taxTotalMinor;

  if (cgstMinor + sgstMinor + igstMinor !== taxTotalMinor) {
    throw new Error("tax parts do not sum to tax total");
  }
  if (taxableMinor + taxTotalMinor !== totalMinor) {
    throw new Error("taxable + tax does not equal total");
  }

  return {
    taxableMinor,
    taxTotalMinor,
    cgstMinor,
    sgstMinor,
    igstMinor,
    totalMinor,
    supplyType,
    taxRateBps,
  };
}

const ONES = [
  "",
  "One",
  "Two",
  "Three",
  "Four",
  "Five",
  "Six",
  "Seven",
  "Eight",
  "Nine",
  "Ten",
  "Eleven",
  "Twelve",
  "Thirteen",
  "Fourteen",
  "Fifteen",
  "Sixteen",
  "Seventeen",
  "Eighteen",
  "Nineteen",
];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

function twoDigits(n: number): string {
  if (n < 20) return ONES[n] ?? "";
  const t = Math.floor(n / 10);
  const o = n % 10;
  return `${TENS[t]}${o ? ` ${ONES[o]}` : ""}`.trim();
}

function threeDigits(n: number): string {
  const h = Math.floor(n / 100);
  const rest = n % 100;
  if (h === 0) return twoDigits(rest);
  return `${ONES[h]} Hundred${rest ? ` ${twoDigits(rest)}` : ""}`.trim();
}

/** Indian numbering: crore / lakh / thousand. Input is whole rupees (not paise). */
function rupeesToWords(rupees: number): string {
  if (rupees === 0) return "Zero";
  if (rupees < 0) return `Minus ${rupeesToWords(-rupees)}`;

  const crore = Math.floor(rupees / 10000000);
  const lakh = Math.floor((rupees % 10000000) / 100000);
  const thousand = Math.floor((rupees % 100000) / 1000);
  const hundred = rupees % 1000;

  const parts: string[] = [];
  if (crore) parts.push(`${threeDigits(crore)} Crore`);
  if (lakh) parts.push(`${threeDigits(lakh)} Lakh`);
  if (thousand) parts.push(`${threeDigits(thousand)} Thousand`);
  if (hundred) parts.push(threeDigits(hundred));
  return parts.join(" ").replace(/\s+/g, " ").trim();
}

/** Amount in words for invoice footer. `minorUnits` is paise. */
export function amountInWords(minorUnits: number, currency = "INR"): string {
  const abs = Math.abs(Math.trunc(minorUnits));
  const rupees = Math.floor(abs / 100);
  const paise = abs % 100;
  const prefix = currency === "INR" ? "Indian Rupees" : currency;
  let words = `${prefix} ${rupeesToWords(rupees)}`;
  if (paise > 0) {
    words += ` and ${twoDigits(paise)} Paise`;
  }
  return `${words} Only`;
}
