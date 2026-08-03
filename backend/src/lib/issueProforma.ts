import { supabaseAdmin } from "./supabaseAdmin.js";
import { amountInWords, computeTax } from "./gst.js";
import { indianFinancialYear, istCalendarDate } from "./indianFinancialYear.js";
import { loadSellerSnapshot, proformaSeries } from "./sellerIdentity.js";
import { INVOICE_TEMPLATE_VERSION } from "./invoiceHtml.js";
import { findPack } from "./creditPacks.js";
import type { BillingProfileRow, PackSnapshotRow } from "./issueInvoice.js";

/**
 * If more than one open proforma exists for a period (rare race), keep one and
 * void the extras so Billing never shows two "Payment due" docs.
 * No schema / payment changes — soft heal only.
 */
async function collapseExtraOpenProformas(args: {
  periodId: string;
  keepId: string;
  log?: { warn: (obj: unknown, msg?: string) => void; error: (obj: unknown, msg?: string) => void };
}): Promise<void> {
  const { data: extras, error } = await supabaseAdmin
    .from("invoices")
    .select("id")
    .eq("subscription_period_id", args.periodId)
    .eq("document_type", "proforma_invoice")
    .eq("status", "issued")
    .is("payment_id", null)
    .neq("id", args.keepId);

  if (error) {
    args.log?.warn({ err: error, periodId: args.periodId }, "failed listing extra open proformas");
    return;
  }
  if (!extras?.length) return;

  const { error: voidError } = await supabaseAdmin
    .from("invoices")
    .update({
      status: "void",
      related_tax_invoice_id: args.keepId,
      updated_at: new Date().toISOString(),
    })
    .in(
      "id",
      extras.map((r) => r.id as string),
    )
    .eq("document_type", "proforma_invoice")
    .eq("status", "issued");

  if (voidError) {
    args.log?.error({ err: voidError, periodId: args.periodId }, "failed voiding extra open proformas");
  } else {
    args.log?.warn(
      { periodId: args.periodId, keepId: args.keepId, voided: extras.length },
      "collapsed duplicate open proformas for period",
    );
  }
}

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
    await collapseExtraOpenProformas({
      periodId: args.periodId,
      keepId: existingPeriod.proforma_id as string,
      log: args.log,
    });
    return { proformaId: existingPeriod.proforma_id as string };
  }

  // Soft heal: an open PI may exist even if period.proforma_id was never set.
  const { data: strayOpen } = await supabaseAdmin
    .from("invoices")
    .select("id")
    .eq("subscription_period_id", args.periodId)
    .eq("document_type", "proforma_invoice")
    .eq("status", "issued")
    .is("payment_id", null)
    .order("issued_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (strayOpen?.id) {
    const keepId = strayOpen.id as string;
    await supabaseAdmin
      .from("subscription_periods")
      .update({ proforma_id: keepId, updated_at: new Date().toISOString() })
      .eq("id", args.periodId)
      .is("proforma_id", null);
    await collapseExtraOpenProformas({ periodId: args.periodId, keepId, log: args.log });
    return { proformaId: keepId };
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

  await collapseExtraOpenProformas({
    periodId: args.periodId,
    keepId: proformaId as string,
    log: args.log,
  });

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

/**
 * Resolve open proforma for a renewing period (ending period), if any.
 */
export async function findOpenProformaIdForPeriod(periodId: string): Promise<string | null> {
  const { data: period } = await supabaseAdmin
    .from("subscription_periods")
    .select("proforma_id")
    .eq("id", periodId)
    .maybeSingle();

  let proformaId = period?.proforma_id as string | null | undefined;

  // Fallback: row may have subscription_period_id even if period.proforma_id was never set.
  if (!proformaId) {
    const { data: byPeriod } = await supabaseAdmin
      .from("invoices")
      .select("id")
      .eq("subscription_period_id", periodId)
      .eq("document_type", "proforma_invoice")
      .eq("status", "issued")
      .is("payment_id", null)
      .maybeSingle();
    proformaId = (byPeriod?.id as string | undefined) ?? null;
  }

  if (!proformaId) return null;

  const { data: inv } = await supabaseAdmin
    .from("invoices")
    .select("id, status, document_type, payment_id, total_minor, line_items")
    .eq("id", proformaId)
    .maybeSingle();

  if (!inv) return null;
  if (inv.document_type === "proforma_invoice" && inv.status === "issued" && !inv.payment_id) {
    await collapseExtraOpenProformas({ periodId, keepId: inv.id as string });
    return inv.id as string;
  }
  return null;
}

/** True when open proforma totals match what was actually charged. */
export async function openProformaMatchesPayment(args: {
  proformaId: string;
  packSnapshot: PackSnapshotRow;
}): Promise<boolean> {
  const { data: inv } = await supabaseAdmin
    .from("invoices")
    .select("id, total_minor, line_items, document_type, status")
    .eq("id", args.proformaId)
    .maybeSingle();

  if (!inv || inv.document_type !== "proforma_invoice" || inv.status !== "issued") {
    return false;
  }
  if (Number(inv.total_minor) !== Number(args.packSnapshot.total_minor)) {
    return false;
  }
  const lineCredits = (inv.line_items as Array<Record<string, unknown>> | null)?.[0]?.credits;
  if (typeof lineCredits === "number" && lineCredits !== args.packSnapshot.credits) {
    return false;
  }
  return true;
}

/**
 * Void an open proforma that was superseded by a separately issued tax invoice.
 * Keeps payment_id null (DB constraint) and links related_tax_invoice_id for audit.
 */
export async function supersedeOpenProforma(args: {
  proformaId: string;
  taxInvoiceId: string;
  log?: { warn: (obj: unknown, msg?: string) => void; error: (obj: unknown, msg?: string) => void };
}): Promise<void> {
  if (args.proformaId === args.taxInvoiceId) return;

  const { error } = await supabaseAdmin
    .from("invoices")
    .update({
      status: "void",
      related_tax_invoice_id: args.taxInvoiceId,
      updated_at: new Date().toISOString(),
    })
    .eq("id", args.proformaId)
    .eq("document_type", "proforma_invoice")
    .eq("status", "issued");

  if (error) {
    args.log?.error({ err: error, proformaId: args.proformaId }, "failed to supersede open proforma");
  }
}

/** Close any open proforma for a renewed period once a tax invoice exists. */
export async function closeOpenProformaForPeriod(args: {
  periodId: string;
  taxInvoiceId: string;
  log?: { warn: (obj: unknown, msg?: string) => void; error: (obj: unknown, msg?: string) => void };
}): Promise<void> {
  const proformaId = await findOpenProformaIdForPeriod(args.periodId);
  if (!proformaId) return;
  await supersedeOpenProforma({
    proformaId,
    taxInvoiceId: args.taxInvoiceId,
    log: args.log,
  });
}

/**
 * Heal orphans: open proformas for periods that were already paid/renewed.
 * Matches via renews_period_id OR a successor period that has a successful payment + tax invoice.
 */
export async function repairOrphanProformasForUser(
  userId: string,
  log?: { warn: (obj: unknown, msg?: string) => void; error: (obj: unknown, msg?: string) => void },
): Promise<number> {
  const candidates = new Map<string, string>(); // proformaId -> periodId

  const { data: openRows, error } = await supabaseAdmin
    .from("invoices")
    .select("id, subscription_period_id")
    .eq("user_id", userId)
    .eq("document_type", "proforma_invoice")
    .eq("status", "issued")
    .is("payment_id", null);

  if (error) {
    log?.error({ err: error, userId }, "failed to list open proformas for repair");
    return 0;
  }

  for (const row of openRows ?? []) {
    const periodId = row.subscription_period_id as string | null;
    if (periodId) candidates.set(row.id as string, periodId);
  }

  const { data: periods } = await supabaseAdmin
    .from("subscription_periods")
    .select("id, proforma_id")
    .eq("user_id", userId)
    .not("proforma_id", "is", null);

  for (const period of periods ?? []) {
    const proformaId = period.proforma_id as string;
    if (candidates.has(proformaId)) continue;
    const { data: inv } = await supabaseAdmin
      .from("invoices")
      .select("id, status, document_type, payment_id")
      .eq("id", proformaId)
      .maybeSingle();
    if (
      inv &&
      inv.document_type === "proforma_invoice" &&
      inv.status === "issued" &&
      !inv.payment_id
    ) {
      candidates.set(proformaId, period.id as string);
    }
  }

  let closed = 0;
  for (const [proformaId, periodId] of candidates) {
    const taxInvoiceId = await findTaxInvoiceThatSettledPeriod(periodId);
    if (!taxInvoiceId) continue;

    const { data: updated, error: updateError } = await supabaseAdmin
      .from("invoices")
      .update({
        status: "void",
        related_tax_invoice_id: taxInvoiceId,
        updated_at: new Date().toISOString(),
      })
      .eq("id", proformaId)
      .eq("document_type", "proforma_invoice")
      .eq("status", "issued")
      .select("id");

    if (updateError) {
      log?.error({ err: updateError, proformaId }, "failed to supersede open proforma");
      continue;
    }
    if (updated?.length) closed += 1;
  }

  if (closed > 0) {
    log?.warn({ userId, closed }, "repaired orphan open proformas");
  }

  return closed;
}

/**
 * Find the tax invoice that settled a period: direct renew payment, or payment on the next period.
 */
async function findTaxInvoiceThatSettledPeriod(periodId: string): Promise<string | null> {
  const { data: directPay } = await supabaseAdmin
    .from("payments")
    .select("id")
    .eq("renews_period_id", periodId)
    .eq("status", "success")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (directPay?.id) {
    const taxId = await taxInvoiceIdForPayment(directPay.id as string);
    if (taxId) return taxId;
  }

  const { data: period } = await supabaseAdmin
    .from("subscription_periods")
    .select("id, subscription_id, period_end")
    .eq("id", periodId)
    .maybeSingle();

  if (!period?.subscription_id) return null;

  // Next period starts at/after this period's end when renew succeeds.
  const { data: successor } = await supabaseAdmin
    .from("subscription_periods")
    .select("id, payment_id")
    .eq("subscription_id", period.subscription_id)
    .gte("period_start", period.period_end)
    .neq("id", periodId)
    .not("payment_id", "is", null)
    .order("period_start", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (successor?.payment_id) {
    return taxInvoiceIdForPayment(successor.payment_id as string);
  }

  return null;
}

async function taxInvoiceIdForPayment(paymentId: string): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from("invoices")
    .select("id")
    .eq("payment_id", paymentId)
    .eq("document_type", "tax_invoice")
    .maybeSingle();
  return (data?.id as string | undefined) ?? null;
}

/**
 * Convert open INV proforma into paid tax invoice + RCP on the same row.
 * Idempotent via fn_finalize_proforma_payment.
 * After a successful same-row finalize, stamp Date Paid to now (IST) so the
 * document does not keep the earlier proforma issue date.
 */
export async function finalizeProformaPayment(args: {
  proformaId: string;
  paymentId: string;
  paymentSnapshot: Record<string, unknown>;
  log?: { warn: (obj: unknown, msg?: string) => void; error: (obj: unknown, msg?: string) => void };
}): Promise<{ invoiceId: string } | { skipped: true; reason: string }> {
  const { data: invoiceId, error } = await supabaseAdmin.rpc("fn_finalize_proforma_payment", {
    p_proforma_id: args.proformaId,
    p_payment_id: args.paymentId,
    p_payment_snapshot: args.paymentSnapshot,
  });

  if (error || !invoiceId) {
    args.log?.error(
      { err: error, proformaId: args.proformaId, paymentId: args.paymentId },
      "fn_finalize_proforma_payment failed",
    );
    return { skipped: true, reason: error?.message ?? "fn_finalize_proforma_payment returned no id" };
  }

  const resolvedId = invoiceId as string;

  // Same-row finalize keeps the old issued_at (and whatever seller_snapshot was
  // frozen when the proforma was first issued, possibly long before this
  // payment) — correct Date Paid and refresh the seller snapshot in-app only.
  if (resolvedId === args.proformaId) {
    const paidAt = new Date();
    const { error: dateError } = await supabaseAdmin
      .from("invoices")
      .update({
        invoice_date: istCalendarDate(paidAt),
        issued_at: paidAt.toISOString(),
        updated_at: paidAt.toISOString(),
        seller_snapshot: loadSellerSnapshot().seller,
      })
      .eq("id", resolvedId)
      .eq("document_type", "tax_invoice")
      .eq("payment_id", args.paymentId);

    if (dateError) {
      args.log?.warn(
        { err: dateError, invoiceId: resolvedId, paymentId: args.paymentId },
        "failed to stamp payment date on finalized proforma",
      );
    }
  }

  return { invoiceId: resolvedId };
}

/** Build a pack snapshot from live plan for proforma (not for tax invoice). */
export function packSnapshotFromPlan(
  packId: string,
  tax: {
    taxableMinor: number;
    taxTotalMinor: number;
    cgstMinor: number;
    sgstMinor: number;
    igstMinor: number;
    totalMinor: number;
    supplyType: string;
  },
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
