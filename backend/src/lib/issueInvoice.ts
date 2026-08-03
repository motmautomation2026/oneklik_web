import { createHash } from "node:crypto";
import { supabaseAdmin } from "./supabaseAdmin.js";
import { amountInWords, computeTax } from "./gst.js";
import { formatIstLongDate, indianFinancialYear, istCalendarDate } from "./indianFinancialYear.js";
import { invoiceSeries, loadSellerSnapshot, type SellerSnapshot } from "./sellerIdentity.js";
import { INVOICE_TEMPLATE_VERSION, renderInvoiceHtml, type InvoiceRenderModel } from "./invoiceHtml.js";
import { renderInvoicePdf } from "./invoicePdf.js";
import { renderPaymentReceiptHtml, type PaymentReceiptRenderModel } from "./receiptHtml.js";
import { renderPaymentReceiptPdf } from "./receiptPdf.js";
import {
  closeOpenProformaForPeriod,
  finalizeProformaPayment,
  findOpenProformaIdForPeriod,
  openProformaMatchesPayment,
  supersedeOpenProforma,
} from "./issueProforma.js";

export interface BillingProfileRow {
  legal_name: string;
  entity_type: "business" | "individual";
  gstin: string | null;
  address_line1: string;
  address_line2: string | null;
  city: string;
  state_code: string;
  state_name: string;
  postal_code: string;
  country: string;
}

export interface PackSnapshotRow {
  id: string;
  name: string;
  credits: number;
  currency: string;
  price_minor_units: number;
  tax_rate_bps: number;
  is_tax_inclusive: boolean;
  sac_code: string;
  taxable_value_minor: number;
  tax_minor: number;
  cgst_minor: number;
  sgst_minor: number;
  igst_minor: number;
  total_minor: number;
  supply_type: "intra_state" | "inter_state";
}

export interface InvoiceRow {
  id: string;
  user_id: string;
  payment_id: string | null;
  invoice_number: string;
  receipt_number: string | null;
  financial_year: string;
  series: string;
  invoice_date: string;
  due_date?: string | null;
  issued_at: string;
  document_type: string;
  status: string;
  seller_snapshot: SellerSnapshot;
  buyer_snapshot: Record<string, unknown>;
  line_items: Array<Record<string, unknown>>;
  payment_snapshot: Record<string, unknown>;
  taxable_value_minor: number;
  cgst_minor: number;
  sgst_minor: number;
  igst_minor: number;
  total_minor: number;
  tax_rate_bps: number;
  place_of_supply_state_code: string;
  place_of_supply_state_name: string;
  supply_type: "intra_state" | "inter_state";
  amount_in_words: string;
  currency: string;
  template_version: number;
  pdf_storage_path: string | null;
  pdf_sha256: string | null;
  related_tax_invoice_id?: string | null;
  subscription_period_id?: string | null;
}

function formatMoneyMinor(minor: number, currency = "INR"): string {
  const abs = Math.abs(minor) / 100;
  try {
    return new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(abs);
  } catch {
    return `${currency} ${abs.toFixed(2)}`;
  }
}

function rateLabel(bps: number): string {
  const pct = bps / 100;
  return Number.isInteger(pct) ? `${pct}%` : `${pct}%`;
}

function halfRateLabel(bps: number): string {
  const pct = bps / 200;
  return Number.isInteger(pct) ? `${pct}%` : `${pct}%`;
}

function buyerAddressLines(buyer: Record<string, unknown>): string[] {
  const lines: string[] = [];
  if (typeof buyer.address_line1 === "string") lines.push(buyer.address_line1);
  if (typeof buyer.address_line2 === "string" && buyer.address_line2.trim()) lines.push(buyer.address_line2);
  const city = typeof buyer.city === "string" ? buyer.city : "";
  const state = typeof buyer.state_name === "string" ? buyer.state_name : "";
  const postal = typeof buyer.postal_code === "string" ? buyer.postal_code : "";
  const cityLine = [city, state, postal].filter(Boolean).join(", ");
  if (cityLine) lines.push(cityLine);
  if (typeof buyer.country === "string") lines.push(buyer.country === "IN" ? "India" : buyer.country);
  return lines;
}

function sellerAddressLines(seller: SellerSnapshot): string[] {
  // Prefer the explicit address lines so a GSTIN registration state that
  // differs from the printed address (e.g. MH GSTIN + AP address) does not
  // rewrite the address block on the invoice.
  const lines: string[] = [seller.address_line1];
  if (seller.address_line2?.trim()) lines.push(seller.address_line2);
  lines.push(seller.country === "IN" ? "India" : seller.country);
  return lines;
}

function paymentMethodLabel(snapshot: Record<string, unknown>): string {
  const raw = typeof snapshot.method === "string" ? snapshot.method.trim().toLowerCase() : "";
  // Placeholders from repair/backfill paths — gateway is always Razorpay.
  if (!raw || raw === "unknown" || raw === "null" || raw === "undefined") {
    return "Razorpay";
  }
  if (raw === "upi") {
    const vpa = typeof snapshot.vpa === "string" ? snapshot.vpa : null;
    return vpa ? `UPI (${vpa}) / Razorpay` : "UPI / Razorpay";
  }
  if (raw === "card") {
    const network = typeof snapshot.card_network === "string" ? snapshot.card_network : "Card";
    const last4 = typeof snapshot.card_last4 === "string" ? snapshot.card_last4 : null;
    return last4 ? `${network} •••• ${last4} / Razorpay` : `${network} / Razorpay`;
  }
  if (raw === "netbanking") {
    const bank = typeof snapshot.bank === "string" ? snapshot.bank : null;
    return bank ? `Netbanking (${bank}) / Razorpay` : "Netbanking / Razorpay";
  }
  if (raw === "wallet") return "Wallet / Razorpay";
  if (raw === "emi") return "EMI / Razorpay";
  return "Razorpay";
}

export function invoiceToRenderModel(invoice: InvoiceRow, buyerEmail?: string | null): InvoiceRenderModel {
  const seller = invoice.seller_snapshot;
  const buyer = invoice.buyer_snapshot;
  const half = halfRateLabel(invoice.tax_rate_bps);
  const full = rateLabel(invoice.tax_rate_bps);
  const isProforma = invoice.document_type === "proforma_invoice";
  const moneyLabel = formatMoneyMinor(invoice.total_minor, invoice.currency);

  const totals: InvoiceRenderModel["totals"] = [
    { label: "Subtotal", amount_label: formatMoneyMinor(invoice.taxable_value_minor, invoice.currency) },
  ];
  if (invoice.supply_type === "intra_state") {
    totals.push({ label: `CGST (${half})`, amount_label: formatMoneyMinor(invoice.cgst_minor, invoice.currency) });
    totals.push({ label: `SGST (${half})`, amount_label: formatMoneyMinor(invoice.sgst_minor, invoice.currency) });
  } else {
    totals.push({ label: `IGST (${full})`, amount_label: formatMoneyMinor(invoice.igst_minor, invoice.currency) });
  }
  totals.push({
    label: "Total",
    amount_label: moneyLabel,
    bold: true,
  });
  totals.push({
    label: isProforma ? "Amount due" : "Amount paid",
    amount_label: moneyLabel,
    bold: true,
  });

  const lineItems = (invoice.line_items ?? []).map((li) => {
    const description =
      typeof li.description === "string"
        ? li.description
        : typeof li.name === "string"
          ? li.name
          : "Monthly plan";
    const credits = typeof li.credits === "number" ? li.credits : null;
    const desc =
      credits && !description.toLowerCase().includes("credit")
        ? `${description} (${credits.toLocaleString("en-IN")} Credits)`
        : description;
    const unit = typeof li.unit_price_minor === "number" ? li.unit_price_minor : invoice.taxable_value_minor;
    const amount = typeof li.amount_minor === "number" ? li.amount_minor : invoice.taxable_value_minor;
    return {
      description: desc,
      sac_code: typeof li.sac_code === "string" ? li.sac_code : null,
      qty: typeof li.qty === "number" ? li.qty : 1,
      unit_price_label: formatMoneyMinor(unit, invoice.currency),
      amount_label: formatMoneyMinor(amount, invoice.currency),
    };
  });

  const issuedAt = new Date(invoice.issued_at);
  const dateLabel = formatIstLongDate(issuedAt);
  const dueLabel = invoice.due_date ? formatIstLongDate(new Date(`${invoice.due_date}T00:00:00+05:30`)) : null;
  const emailFromBuyer = typeof buyer.email === "string" ? buyer.email : null;

  let statusLabel = "PAID";
  if (isProforma) {
    if (invoice.status === "void" || invoice.status === "cancelled") statusLabel = "VOID";
    else if (invoice.status === "paid") statusLabel = "PAID";
    else statusLabel = "PAYMENT DUE";
  }

  return {
    document_title: isProforma ? "Pro Forma Invoice" : "Tax Invoice",
    invoice_number: invoice.invoice_number,
    receipt_number: invoice.receipt_number,
    invoice_date_label: dateLabel,
    paid_on_label: dateLabel,
    due_date_label: dueLabel,
    status: statusLabel,
    note: isProforma
      ? "Pro forma — not a tax invoice until payment is received"
      : invoice.buyer_snapshot.entity_type === "business"
        ? "Business Purchase"
        : null,
    place_of_supply: `${invoice.place_of_supply_state_name} (${invoice.place_of_supply_state_code})`,
    seller: {
      legal_name: seller.legal_name,
      gstin: seller.gstin,
      address_lines: sellerAddressLines(seller),
      billing_email: seller.billing_email,
      phone: seller.phone,
    },
    buyer: {
      legal_name: typeof buyer.legal_name === "string" ? buyer.legal_name : "Customer",
      company:
        typeof buyer.company === "string"
          ? buyer.company
          : buyer.entity_type === "business" && typeof buyer.legal_name === "string"
            ? buyer.legal_name
            : null,
      gstin: typeof buyer.gstin === "string" ? buyer.gstin : null,
      address_lines: buyerAddressLines(buyer),
      email: emailFromBuyer ?? buyerEmail ?? null,
    },
    amount_paid_label: moneyLabel,
    amount_due_label: moneyLabel,
    currency: invoice.currency,
    line_items: lineItems.length
      ? lineItems
      : [
          {
            description: "Monthly plan",
            sac_code: null,
            qty: 1,
            unit_price_label: formatMoneyMinor(invoice.taxable_value_minor, invoice.currency),
            amount_label: formatMoneyMinor(invoice.taxable_value_minor, invoice.currency),
          },
        ],
    totals,
    payment_history: isProforma
      ? []
      : [
          {
            method: paymentMethodLabel(invoice.payment_snapshot ?? {}),
            date_label: dateLabel,
            amount_label: moneyLabel,
            receipt_number: invoice.receipt_number ?? invoice.invoice_number,
          },
        ],
    amount_in_words: invoice.amount_in_words,
    reverse_charge: "No",
    is_proforma: isProforma,
  };
}

export function invoiceToReceiptModel(invoice: InvoiceRow, buyerEmail?: string | null): PaymentReceiptRenderModel {
  const buyer = invoice.buyer_snapshot;
  const emailFromBuyer = typeof buyer.email === "string" ? buyer.email : null;
  const moneyLabel = formatMoneyMinor(invoice.total_minor, invoice.currency);
  const paidAt = new Date(invoice.issued_at);
  const li = invoice.line_items?.[0];
  const description =
    typeof li?.description === "string"
      ? li.description
      : typeof li?.name === "string"
        ? li.name
        : "Monthly plan";

  const city = typeof buyer.city === "string" ? buyer.city : "";
  const state = typeof buyer.state_name === "string" ? buyer.state_name : "";
  const location = [city, state, "India"].filter(Boolean).join(", ");

  const snap = invoice.payment_snapshot ?? {};
  const txn =
    (typeof snap.razorpay_payment_id === "string" && snap.razorpay_payment_id) ||
    (typeof snap.payment_id === "string" && snap.payment_id) ||
    null;

  return {
    invoice_number: invoice.invoice_number,
    receipt_number: invoice.receipt_number ?? invoice.invoice_number,
    transaction_id: txn,
    date_paid_label: formatIstLongDate(paidAt),
    status: "PAID",
    buyer_name: typeof buyer.legal_name === "string" ? buyer.legal_name : "Customer",
    buyer_location: location || null,
    buyer_email: emailFromBuyer ?? buyerEmail ?? null,
    description,
    amount_paid_label: moneyLabel,
    payment_method: paymentMethodLabel(snap),
    seller_name: invoice.seller_snapshot?.legal_name ?? "Quick ICP",
    seller_support_email: invoice.seller_snapshot?.billing_email ?? "support@quickicp.demo",
  };
}

export type DocumentView = "proforma" | "receipt" | "invoice";

export function resolveDocumentView(invoice: InvoiceRow, requested?: string | null): DocumentView {
  const q = (requested ?? "").toLowerCase();
  if (invoice.document_type === "proforma_invoice") {
    return "proforma";
  }
  if (q === "proforma") return "proforma";
  if (q === "invoice") return "invoice";
  return "receipt";
}

export function renderInvoiceDocument(
  invoice: InvoiceRow,
  buyerEmail?: string | null,
  view?: DocumentView,
): string {
  const resolved = view ?? resolveDocumentView(invoice);
  if (resolved === "receipt") {
    return renderPaymentReceiptHtml(invoiceToReceiptModel(invoice, buyerEmail));
  }
  // Proforma view of a finalized tax invoice: temporarily present as proforma layout
  if (resolved === "proforma" && invoice.document_type === "tax_invoice") {
    return renderInvoiceHtml(
      invoiceToRenderModel({ ...invoice, document_type: "proforma_invoice", status: "paid" }, buyerEmail),
    );
  }
  return renderInvoiceHtml(invoiceToRenderModel(invoice, buyerEmail));
}

/**
 * Issue a billing document for a successful payment.
 * If an open INV proforma exists for renews_period_id, finalize that row (attach RCP).
 * Otherwise allocate a new INV+RCP via fn_issue_invoice (initial / early renew).
 * Always closes any leftover open proforma so the hub never keeps "Payment due".
 */
export async function issueDocumentForPayment(args: {
  paymentId: string;
  userId: string;
  packSnapshot: PackSnapshotRow;
  paymentSnapshot: Record<string, unknown>;
  renewsPeriodId?: string | null;
  buyerEmail?: string | null;
  log?: { warn: (obj: unknown, msg?: string) => void; error: (obj: unknown, msg?: string) => void };
}): Promise<{ invoiceId: string } | { skipped: true; reason: string }> {
  // Idempotent: payment already has a tax invoice — still close any orphan PI.
  const { data: existing } = await supabaseAdmin
    .from("invoices")
    .select("id")
    .eq("payment_id", args.paymentId)
    .eq("document_type", "tax_invoice")
    .maybeSingle();
  if (existing?.id) {
    if (args.renewsPeriodId) {
      await closeOpenProformaForPeriod({
        periodId: args.renewsPeriodId,
        taxInvoiceId: existing.id as string,
        log: args.log,
      });
    }
    return { invoiceId: existing.id as string };
  }

  if (args.renewsPeriodId) {
    const proformaId = await findOpenProformaIdForPeriod(args.renewsPeriodId);
    if (proformaId) {
      // Plan switch: do not turn an old-plan proforma into the paid tax invoice.
      const matches = await openProformaMatchesPayment({
        proformaId,
        packSnapshot: args.packSnapshot,
      });
      if (!matches) {
        args.log?.warn(
          { proformaId, paymentId: args.paymentId },
          "open proforma does not match payment — issuing fresh tax invoice",
        );
        const issued = await issueInvoiceForPayment(args);
        if ("invoiceId" in issued) {
          await supersedeOpenProforma({
            proformaId,
            taxInvoiceId: issued.invoiceId,
            log: args.log,
          });
        }
        return issued;
      }

      const finalized = await finalizeProformaPayment({
        proformaId,
        paymentId: args.paymentId,
        paymentSnapshot: args.paymentSnapshot,
        log: args.log,
      });
      if ("invoiceId" in finalized) {
        // Finalize may have returned an already-issued INV for this payment (race).
        // Ensure the open PI is not left as Payment due.
        if (finalized.invoiceId !== proformaId) {
          await supersedeOpenProforma({
            proformaId,
            taxInvoiceId: finalized.invoiceId,
            log: args.log,
          });
        }
        return finalized;
      }

      // RPC missing / failed — issue a separate tax invoice, then void the PI.
      args.log?.warn(
        { proformaId, paymentId: args.paymentId, reason: finalized.reason },
        "finalize failed; issuing tax invoice and superseding proforma",
      );
      const issued = await issueInvoiceForPayment(args);
      if ("invoiceId" in issued) {
        await supersedeOpenProforma({
          proformaId,
          taxInvoiceId: issued.invoiceId,
          log: args.log,
        });
      }
      return issued;
    }
  }

  return issueInvoiceForPayment(args);
}

/**
 * Issue a tax invoice for a successful payment.
 * Safe to call after credits are granted. Returns null (with reason) instead
 * of throwing when prerequisites are missing — webhook must still ACK 200.
 */
export async function issueInvoiceForPayment(args: {
  paymentId: string;
  userId: string;
  packSnapshot: PackSnapshotRow;
  paymentSnapshot: Record<string, unknown>;
  buyerEmail?: string | null;
  log?: { warn: (obj: unknown, msg?: string) => void; error: (obj: unknown, msg?: string) => void };
}): Promise<{ invoiceId: string } | { skipped: true; reason: string }> {
  const sellerLoad = loadSellerSnapshot();
  const seller = sellerLoad.seller;

  const { data: billing, error: billingError } = await supabaseAdmin
    .from("billing_profiles")
    .select(
      "legal_name, entity_type, gstin, address_line1, address_line2, city, state_code, state_name, postal_code, country",
    )
    .eq("user_id", args.userId)
    .maybeSingle();

  if (billingError || !billing) {
    return { skipped: true, reason: "billing profile missing — cannot issue tax invoice" };
  }

  const profile = billing as BillingProfileRow;
  const pack = args.packSnapshot;
  const now = new Date();
  const fy = indianFinancialYear(now);
  const series = invoiceSeries();

  // Recompute CGST/SGST vs IGST with the real seller state. The charged total
  // was already frozen on the payment; only the line split may change.
  let tax;
  try {
    tax = computeTax({
      amountMinor: pack.taxable_value_minor,
      taxRateBps: pack.tax_rate_bps,
      isTaxInclusive: false,
      sellerStateCode: seller.state_code,
      buyerStateCode: profile.state_code,
    });
  } catch (err) {
    args.log?.error({ err, paymentId: args.paymentId }, "tax recompute failed at invoice issue");
    return { skipped: true, reason: "tax recompute failed" };
  }

  if (tax.totalMinor !== pack.total_minor) {
    args.log?.error(
      { expected: pack.total_minor, got: tax.totalMinor, paymentId: args.paymentId },
      "invoice tax total drifted from payment — refusing to issue",
    );
    return { skipped: true, reason: "tax total mismatch with payment snapshot" };
  }

  const buyerSnapshot = {
    ...profile,
    email: args.buyerEmail ?? null,
  };

  const lineItems = [
    {
      description: `${pack.name} (${pack.credits.toLocaleString("en-IN")} Credits)`,
      name: pack.name,
      credits: pack.credits,
      sac_code: pack.sac_code,
      qty: 1,
      unit_price_minor: tax.taxableMinor,
      amount_minor: tax.taxableMinor,
      tax_rate_bps: pack.tax_rate_bps,
    },
  ];

  const { data: invoiceId, error } = await supabaseAdmin.rpc("fn_issue_invoice", {
    p_payment_id: args.paymentId,
    p_user_id: args.userId,
    p_financial_year: fy.key,
    p_series: series,
    p_fy_label: fy.label,
    p_invoice_date: istCalendarDate(now),
    p_seller_snapshot: seller,
    p_buyer_snapshot: buyerSnapshot,
    p_line_items: lineItems,
    p_payment_snapshot: args.paymentSnapshot,
    p_taxable_value_minor: tax.taxableMinor,
    p_cgst_minor: tax.cgstMinor,
    p_sgst_minor: tax.sgstMinor,
    p_igst_minor: tax.igstMinor,
    p_total_minor: tax.totalMinor,
    p_tax_rate_bps: pack.tax_rate_bps,
    p_place_of_supply_state_code: profile.state_code,
    p_place_of_supply_state_name: profile.state_name,
    p_supply_type: tax.supplyType,
    p_amount_in_words: amountInWords(tax.totalMinor, pack.currency),
    p_currency: pack.currency,
    p_template_version: INVOICE_TEMPLATE_VERSION,
  });

  if (error || !invoiceId) {
    args.log?.error({ err: error, paymentId: args.paymentId }, "fn_issue_invoice failed");
    return { skipped: true, reason: error?.message ?? "fn_issue_invoice returned no id" };
  }

  // Mark as paid (fn_issue_invoice historically used status issued)
  const { error: paidError } = await supabaseAdmin
    .from("invoices")
    .update({ status: "paid", updated_at: new Date().toISOString() })
    .eq("id", invoiceId)
    .eq("document_type", "tax_invoice");

  if (paidError) {
    args.log?.error(
      { err: paidError, invoiceId, paymentId: args.paymentId },
      "failed to mark invoice as paid",
    );
  }

  return { invoiceId: invoiceId as string };
}

export async function ensureInvoicePdf(
  invoice: InvoiceRow,
  view?: DocumentView,
): Promise<{ path: string; sha256: string; filename: string }> {
  const resolved = view ?? resolveDocumentView(invoice);
  let pdf: Buffer;
  let filename: string;

  if (resolved === "receipt") {
    pdf = await renderPaymentReceiptPdf(invoiceToReceiptModel(invoice));
    filename = `${invoice.receipt_number ?? invoice.invoice_number}-receipt.pdf`;
  } else if (resolved === "proforma") {
    const model =
      invoice.document_type === "tax_invoice"
        ? invoiceToRenderModel({ ...invoice, document_type: "proforma_invoice", status: "paid" })
        : invoiceToRenderModel(invoice);
    pdf = await renderInvoicePdf(model);
    filename = `${invoice.invoice_number}-proforma.pdf`;
  } else {
    pdf = await renderInvoicePdf(invoiceToRenderModel(invoice));
    filename = `${invoice.invoice_number}.pdf`;
  }

  const sha256 = createHash("sha256").update(pdf).digest("hex");
  const path = `${invoice.user_id}/${invoice.financial_year}/${filename}`;

  const { error: uploadError } = await supabaseAdmin.storage.from("invoices").upload(path, pdf, {
    contentType: "application/pdf",
    upsert: true,
  });
  if (uploadError) {
    throw new Error(`Failed to store invoice PDF: ${uploadError.message}`);
  }

  // Only cache default path on the row for the primary paid receipt / unpaid proforma
  if (
    (resolved === "receipt" && invoice.document_type === "tax_invoice") ||
    (resolved === "proforma" && invoice.document_type === "proforma_invoice")
  ) {
    await supabaseAdmin
      .from("invoices")
      .update({ pdf_storage_path: path, pdf_sha256: sha256, updated_at: new Date().toISOString() })
      .eq("id", invoice.id);
  }

  return { path, sha256, filename };
}
