/**
 * Hardcoded seller identity for GST tax invoices.
 *
 * GSTIN 27AWYPK0264G1Z6 is registered in Maharashtra (27) — checksum-verified.
 * Address below is the Pune (Wagholi) registered address, matching that state.
 */
export interface SellerSnapshot {
  legal_name: string;
  gstin: string;
  address_line1: string;
  address_line2: string | null;
  city: string;
  state_code: string;
  state_name: string;
  postal_code: string;
  country: string;
  billing_email: string | null;
  phone: string | null;
  pan: string | null;
}

const HARDCODED_SELLER: SellerSnapshot = {
  legal_name: "Quick ICP",
  gstin: "27AWYPK0264G1Z6",
  address_line1: "FIRST FLOOR, Reality Warehousing Pvt Ltd, GAT NO.-1337/1, Pune Nagar Road",
  address_line2: "Above Reliance Smart, Wagholi, Pune",
  city: "Pune",
  // Tax place-of-supply / CGST-SGST vs IGST follows the GSTIN registration state.
  state_code: "27",
  state_name: "Maharashtra",
  postal_code: "412207",
  country: "IN",
  billing_email: "billing@quickicp.demo",
  phone: "+91 99999 00000",
  pan: "AWYPK0264G",
};

export function loadSellerSnapshot(): { ok: true; seller: SellerSnapshot } {
  return { ok: true, seller: HARDCODED_SELLER };
}

export function invoiceSeries(): string {
  return "INV";
}

/** Pro formas reserve a real INV number (same series as tax invoices). */
export function proformaSeries(): string {
  return "INV";
}

export function isSellerConfigured(): boolean {
  return true;
}
