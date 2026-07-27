import { computeTax, type TaxBreakdown } from "./gst.js";

export interface CreditPack {
  id: string;
  credits: number;
  /** Taxable (exclusive) price in paise. Never store rupees as a float. */
  priceMinorUnits: number;
  currency: string;
  /** Basis points — 1800 = 18%. Per pack, not a global constant. */
  taxRateBps: number;
  isTaxInclusive: boolean;
  sacCode: string;
  comingSoon: boolean;
  /** Display name for invoice line items. */
  name: string;
}

/**
 * Pack catalog lives in code (MVP). Change a number here and redeploy —
 * already-issued invoices keep their snapshotted amounts and are unaffected.
 */
export const CREDIT_PACKS: CreditPack[] = [
  {
    id: "starter",
    name: "Starter Credits Pack",
    credits: 4000,
    priceMinorUnits: 600_000, // ₹6,000.00
    currency: "INR",
    taxRateBps: 1800,
    isTaxInclusive: false,
    sacCode: "998313",
    comingSoon: false,
  },
  {
    id: "growth",
    name: "Growth Credits Pack",
    credits: 12000,
    priceMinorUnits: 1_700_000, // ₹17,000.00
    currency: "INR",
    taxRateBps: 1800,
    isTaxInclusive: false,
    sacCode: "998313",
    comingSoon: false,
  },
  {
    id: "business",
    name: "Business Credits Pack",
    credits: 20000,
    priceMinorUnits: 2_800_000, // ₹28,000.00
    currency: "INR",
    taxRateBps: 1800,
    isTaxInclusive: false,
    sacCode: "998313",
    comingSoon: false,
  },
];

export function findPack(id: string): CreditPack | undefined {
  const pack = CREDIT_PACKS.find((p) => p.id === id && !p.comingSoon);
  if (!pack) return undefined;
  if (!Number.isInteger(pack.priceMinorUnits) || pack.priceMinorUnits <= 0) {
    return undefined;
  }
  return pack;
}

/** Pack money fields for the API — client never computes tax. */
export interface PackPricingView {
  id: string;
  name: string;
  credits: number;
  currency: string;
  comingSoon: boolean;
  price_minor_units: number;
  tax_rate_bps: number;
  is_tax_inclusive: boolean;
  sac_code: string;
  /** Illustrative exclusive→tax→total using seller=buyer same state (CGST+SGST). */
  tax_minor_units: number;
  total_minor_units: number;
  /** Backward-compatible whole-rupee display of the exclusive price. */
  priceInr: number;
}

/**
 * Pricing preview for the packs list. Uses a same-state split so the UI can
 * show "price + GST = total" without knowing the buyer's state yet. Checkout
 * recomputes with the real buyer state for the Razorpay charge.
 */
export function packPricingView(pack: CreditPack): PackPricingView {
  const tax = computeTax({
    amountMinor: pack.priceMinorUnits,
    taxRateBps: pack.taxRateBps,
    isTaxInclusive: pack.isTaxInclusive,
    sellerStateCode: "00",
    buyerStateCode: "00",
  });

  return {
    id: pack.id,
    name: pack.name,
    credits: pack.credits,
    currency: pack.currency,
    comingSoon: pack.comingSoon,
    price_minor_units: pack.isTaxInclusive ? tax.taxableMinor : pack.priceMinorUnits,
    tax_rate_bps: pack.taxRateBps,
    is_tax_inclusive: pack.isTaxInclusive,
    sac_code: pack.sacCode,
    tax_minor_units: tax.taxTotalMinor,
    total_minor_units: tax.totalMinor,
    priceInr: Math.round((pack.isTaxInclusive ? tax.taxableMinor : pack.priceMinorUnits) / 100),
  };
}

export function computePackTax(
  pack: CreditPack,
  sellerStateCode: string,
  buyerStateCode: string,
): TaxBreakdown {
  return computeTax({
    amountMinor: pack.priceMinorUnits,
    taxRateBps: pack.taxRateBps,
    isTaxInclusive: pack.isTaxInclusive,
    sellerStateCode,
    buyerStateCode,
  });
}

export function packSnapshot(pack: CreditPack, tax: TaxBreakdown) {
  return {
    id: pack.id,
    name: pack.name,
    credits: pack.credits,
    currency: pack.currency,
    price_minor_units: pack.priceMinorUnits,
    tax_rate_bps: pack.taxRateBps,
    is_tax_inclusive: pack.isTaxInclusive,
    sac_code: pack.sacCode,
    taxable_value_minor: tax.taxableMinor,
    tax_minor: tax.taxTotalMinor,
    cgst_minor: tax.cgstMinor,
    sgst_minor: tax.sgstMinor,
    igst_minor: tax.igstMinor,
    total_minor: tax.totalMinor,
    supply_type: tax.supplyType,
  };
}
