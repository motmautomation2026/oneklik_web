/**
 * Hardcoded seller identity for GST tax invoices.
 *
 * Note: GSTIN 27AWYPK0264G1Z6 is registered in Maharashtra (27). The business
 * address below is in Andhra Pradesh. Tax CGST/SGST vs IGST uses the GSTIN
 * state code (27). The printed address lines use the address as provided.
 * Confirm with your CA if the registration state should be updated.
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
  legal_name: "One-Klik",
  gstin: "27AWYPK0264G1Z6",
  address_line1: "DOOR NO 22-6-280 BHARATHPET 6TH LINE, WARD-43 VILLAGE GUNTUR MANDAL, GUNTUR DISTRICT",
  address_line2: "GUNTUR, Andhra Pradesh, 522002",
  city: "GUNTUR",
  // Tax place-of-supply / CGST-SGST vs IGST follows the GSTIN registration state.
  state_code: "27",
  state_name: "Maharashtra",
  postal_code: "522002",
  country: "IN",
  billing_email: "billing@oneklik.demo",
  phone: "+91 99999 00000",
  pan: "AWYPK0264G",
};

export function loadSellerSnapshot(): { ok: true; seller: SellerSnapshot } {
  return { ok: true, seller: HARDCODED_SELLER };
}

export function invoiceSeries(): string {
  return "INV";
}

export function isSellerConfigured(): boolean {
  return true;
}
