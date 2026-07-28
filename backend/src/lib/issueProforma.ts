import { supabaseAdmin } from "./supabaseAdmin.js";
import { amountInWords, computeTax } from "./gst.js";
import { indianFinancialYear, istCalendarDate } from "./indianFinancialYear.js";
import { loadSellerSnapshot, proformaSeries } from "./sellerIdentity.js";
import { INVOICE_TEMPLATE_VERSION } from "./invoiceHtml.js";
import { findPack } from "./creditPacks.js";
import type { BillingProfileRow, PackSnapshotRow } from "./issueInvoice.js";

export async function issueProformaForPeriod(args: {
  userId: string;
  periodId: string;
  planId: string;
  periodEndIso: string;
  graceEndsIso: string;
  log?: { warn: (obj: unknown, msg?: string) => void; error: (obj: unknown, msg?: string) => void };
}): Promise<{ proformaId: string } | { skipped: true; reason: string }> {
  const pack = findPack(args.planId);
  if (!pack) {
    return { skipped: true, reason: `unknown plan ${args.planId}` };
  }

  const { data: existingPeriod } = await supabaseAdmin
    .from("subscription_periods")
    .select("proforma_id")
    .eq("id", args.periodId)
    .maybeSingle();

  if (existingPeriod?.proforma_id) {
    return { proformaId: existingPeriod.proforma_id as string };
  }

  const seller = loadSellerSnapshot().seller;

  const { data: billing, error: billingError } = await supabaseAdmin
    .from("billing_profiles")
    .select(
      "legal_name, entity_type, gstin, address_line1, address_line2, city, state_code, state_name, postal_code, country",
    )
    .eq("user_id", args.userId)
    .maybeSingle();

  if (billingError || !billing) {
    return { skipped: true, reason: "billing profile missing" };
  }

  const profile = billing as BillingProfileRow;
  let tax;
  try {
    tax = computeTax({
      amountMinor: pack.priceMinorUnits,
      taxRateBps: pack.taxRateBps,
      isTaxInclusive: pack.isTaxInclusive,
      sellerStateCode: seller.state_code,
      buyerStateCode: profile.state_code,
    });
  } catch (err) {
    args.log?.error({ err, periodId: args.periodId }, "proforma tax compute failed");
    return { skipped: true, reason: "tax compute failed" };
  }

  const now = new Date();
  const fy = indianFinancialYear(now);
  const dueDate = istCalendarDate(new Date(args.periodEndIso));
  const payBy = istCalendarDate(new Date(args.graceEndsIso));

  const lineItems = [
    {
      description: `${pack.name} (${pack.credits.toLocaleString("en-IN")} Credits / month)`,
      name: pack.name,
      credits: pack.credits,
      sac_code: pack.sacCode,
      qty: 1,
      unit_price_minor: tax.taxableMinor,
      amount_minor: tax.taxableMinor,
      tax_rate_bps: pack.taxRateBps,
    },
  ];

  const buyerSnapshot = { ...profile, email: null };

  const { data: proformaId, error } = await supabaseAdmin.rpc("fn_issue_proforma", {
    p_user_id: args.userId,
    p_subscription_period_id: args.periodId,
    p_financial_year: fy.key,
    p_series: proformaSeries(),
    p_fy_label: fy.label,
    p_invoice_date: istCalendarDate(now),
    p_due_date: dueDate,
    p_seller_snapshot: seller,
    p_buyer_snapshot: buyerSnapshot,
    p_line_items: lineItems,
    p_taxable_value_minor: tax.taxableMinor,
    p_cgst_minor: tax.cgstMinor,
    p_sgst_minor: tax.sgstMinor,
    p_igst_minor: tax.igstMinor,
    p_total_minor: tax.totalMinor,
    p_tax_rate_bps: pack.taxRateBps,
    p_place_of_supply_state_code: profile.state_code,
    p_place_of_supply_state_name: profile.state_name,
    p_supply_type: tax.supplyType,
    p_amount_in_words: amountInWords(tax.totalMinor, pack.currency),
    p_currency: pack.currency,
    p_template_version: INVOICE_TEMPLATE_VERSION,
  });

  if (error || !proformaId) {
    args.log?.error({ err: error, periodId: args.periodId }, "fn_issue_proforma failed");
    return { skipped: true, reason: error?.message ?? "fn_issue_proforma returned no id" };
  }

  // Attach pay-by hint in payment_snapshot for rendering (non-legal metadata).
  await supabaseAdmin
    .from("invoices")
    .update({
      payment_snapshot: {
        pay_by_date: payBy,
        due_date: dueDate,
        document_kind: "proforma",
      },
      updated_at: new Date().toISOString(),
    })
    .eq("id", proformaId);

  return { proformaId: proformaId as string };
}

export async function markProformaPaidForPeriod(
  periodId: string,
  taxInvoiceId: string,
  log?: { warn: (obj: unknown, msg?: string) => void; error: (obj: unknown, msg?: string) => void },
): Promise<void> {
  const { data: period, error } = await supabaseAdmin
    .from("subscription_periods")
    .select("proforma_id")
    .eq("id", periodId)
    .maybeSingle();

  if (error) {
    log?.error({ err: error, periodId }, "failed to load period for proforma mark paid");
    return;
  }

  // Also try previous period's proforma (renew pays for next; proforma was on ending period).
  let proformaId = period?.proforma_id as string | null | undefined;

  if (!proformaId) {
    // Pro forma is issued against the period that is ending (renews_period), not the new one.
    // Look up via invoices linked to any period for this user that is still issued.
    const { data: sub } = await supabaseAdmin
      .from("subscription_periods")
      .select("id, subscription_id")
      .eq("id", periodId)
      .maybeSingle();

    if (sub?.subscription_id) {
      const { data: prior } = await supabaseAdmin
        .from("subscription_periods")
        .select("proforma_id")
        .eq("subscription_id", sub.subscription_id)
        .not("proforma_id", "is", null)
        .order("period_end", { ascending: false })
        .limit(5);

      const open = (prior ?? []).find((p) => p.proforma_id);
      // Prefer linking the most recent unpaid proforma
      if (open?.proforma_id) {
        const { data: inv } = await supabaseAdmin
          .from("invoices")
          .select("id, status")
          .eq("id", open.proforma_id)
          .eq("document_type", "proforma_invoice")
          .maybeSingle();
        if (inv && inv.status === "issued") {
          proformaId = inv.id as string;
        }
      }
    }
  }

  if (!proformaId) return;

  const { error: updateError } = await supabaseAdmin
    .from("invoices")
    .update({
      status: "paid",
      related_tax_invoice_id: taxInvoiceId,
      updated_at: new Date().toISOString(),
    })
    .eq("id", proformaId)
    .eq("document_type", "proforma_invoice");

  if (updateError) {
    log?.error({ err: updateError, proformaId }, "failed to mark proforma paid");
  }
}

/** Build a pack snapshot from live plan for proforma (not for tax invoice). */
export function packSnapshotFromPlan(
  packId: string,
  tax: { taxableMinor: number; taxTotalMinor: number; cgstMinor: number; sgstMinor: number; igstMinor: number; totalMinor: number; supplyType: string },
): PackSnapshotRow | null {
  const pack = findPack(packId);
  if (!pack) return null;
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
    supply_type: tax.supplyType as "intra_state" | "inter_state",
  };
}
