import type { Request, Response } from "express";
import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { enforceAccountStatus } from "../middleware/accountStatus.js";
import { supabaseAdmin } from "../lib/supabaseAdmin.js";
import {
  ensureInvoicePdf,
  renderInvoiceDocument,
  resolveDocumentView,
  type InvoiceRow,
} from "../lib/issueInvoice.js";
import { repairOrphanProformasForUser } from "../lib/issueProforma.js";
import { buildRepairPaymentSnapshot } from "../lib/razorpayPaymentSnapshot.js";

const router = Router();

async function enrichThinPaymentSnapshot(
  invoice: Record<string, unknown>,
  log: { warn: (obj: unknown, msg?: string) => void },
): Promise<Record<string, unknown>> {
  if (invoice.document_type !== "tax_invoice" || !invoice.payment_id) return invoice;

  const snap = (invoice.payment_snapshot ?? {}) as Record<string, unknown>;
  const methodMissing = !snap.method || snap.method === "unknown";
  if (!methodMissing) return invoice;

  const { data: payment } = await supabaseAdmin
    .from("payments")
    .select("gateway_capture_id, gateway_payment_id")
    .eq("id", invoice.payment_id as string)
    .maybeSingle();

  const captureId = (payment?.gateway_capture_id as string | null) ?? null;
  if (!captureId) return invoice;

  try {
    const enrichedSnap = await buildRepairPaymentSnapshot({
      gatewayCaptureId: captureId,
      gatewayOrderId: (payment?.gateway_payment_id as string | null) ?? null,
    });
    const payment_snapshot = { ...snap, ...enrichedSnap };
    await supabaseAdmin
      .from("invoices")
      .update({ payment_snapshot, updated_at: new Date().toISOString() })
      .eq("id", invoice.id);
    return { ...invoice, payment_snapshot };
  } catch (err) {
    log.warn({ err, invoiceId: invoice.id }, "failed to enrich invoice payment_snapshot");
    return invoice;
  }
}

router.get("/invoices", requireAuth, enforceAccountStatus({ allowFrozen: true }), async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const limit = Math.min(Number(req.query.limit ?? 50) || 50, 100);
  const offset = Math.max(Number(req.query.offset ?? 0) || 0, 0);

  // Close any PI left open after a successful renew (heals the Payment-due ghost row).
  try {
    await repairOrphanProformasForUser(userId, req.log);
  } catch (err) {
    req.log.warn({ err, userId }, "orphan proforma repair on invoice list failed");
  }

  // Hub history SoT: tax invoices / receipts (+ credit notes). Open proforma is only
  // included when it is still the payable document for the *current* subscription period.
  let currentOpenProformaId: string | null = null;
  const { data: sub } = await supabaseAdmin
    .from("subscriptions")
    .select("current_period_id")
    .eq("user_id", userId)
    .maybeSingle();

  if (sub?.current_period_id) {
    const { data: period } = await supabaseAdmin
      .from("subscription_periods")
      .select("proforma_id")
      .eq("id", sub.current_period_id as string)
      .maybeSingle();

    if (period?.proforma_id) {
      const { data: pf } = await supabaseAdmin
        .from("invoices")
        .select("id, status, document_type")
        .eq("id", period.proforma_id as string)
        .maybeSingle();
      if (pf?.document_type === "proforma_invoice" && pf.status === "issued") {
        currentOpenProformaId = pf.id as string;
      }
    }
  }

  const { data, error } = await supabaseAdmin
    .from("invoices")
    .select(
      "id, invoice_number, receipt_number, invoice_date, issued_at, status, document_type, taxable_value_minor, cgst_minor, sgst_minor, igst_minor, total_minor, currency, payment_id, supply_type, financial_year, due_date, line_items, related_tax_invoice_id",
    )
    .eq("user_id", userId)
    .order("issued_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) {
    req.log.error({ err: error }, "failed to list invoices");
    return res.status(500).json({ error: "Could not load invoices" });
  }

  const invoices = (data ?? []).filter((row) => {
    if (row.document_type === "tax_invoice" || row.document_type === "credit_note") return true;
    if (row.document_type === "proforma_invoice") {
      // Historical / orphan PIs never appear as Payment due in history.
      return currentOpenProformaId !== null && row.id === currentOpenProformaId && row.status === "issued";
    }
    return false;
  });

  return res.json({ invoices });
});

router.get("/invoices/:id", requireAuth, enforceAccountStatus({ allowFrozen: true }), async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const { data, error } = await supabaseAdmin
    .from("invoices")
    .select("*")
    .eq("id", req.params.id)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    req.log.error({ err: error }, "failed to load invoice");
    return res.status(500).json({ error: "Could not load invoice" });
  }
  if (!data) {
    return res.status(404).json({ error: "Invoice not found" });
  }

  const invoice = await enrichThinPaymentSnapshot(data as Record<string, unknown>, req.log);
  return res.json({ invoice });
});

router.get("/invoices/:id/html", requireAuth, enforceAccountStatus({ allowFrozen: true }), async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const { data, error } = await supabaseAdmin
    .from("invoices")
    .select("*")
    .eq("id", req.params.id)
    .eq("user_id", userId)
    .maybeSingle();

  if (error || !data) {
    return res.status(404).json({ error: "Invoice not found" });
  }

  const invoice = data as InvoiceRow;
  const view = resolveDocumentView(invoice, typeof req.query.view === "string" ? req.query.view : null);
  const html = renderInvoiceDocument(invoice, req.user!.email ?? null, view);
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "private, no-store");
  return res.send(html);
});

router.get("/invoices/:id/pdf", requireAuth, enforceAccountStatus({ allowFrozen: true }), async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const { data, error } = await supabaseAdmin
    .from("invoices")
    .select("*")
    .eq("id", req.params.id)
    .eq("user_id", userId)
    .maybeSingle();

  if (error || !data) {
    return res.status(404).json({ error: "Invoice not found" });
  }

  try {
    const invoice = data as InvoiceRow;
    const view = resolveDocumentView(invoice, typeof req.query.view === "string" ? req.query.view : null);
    const { path, filename } = await ensureInvoicePdf(invoice, view);
    const { data: signed, error: signError } = await supabaseAdmin.storage
      .from("invoices")
      .createSignedUrl(path, 60);

    if (signError || !signed?.signedUrl) {
      req.log.error({ err: signError }, "failed to sign invoice PDF URL");
      return res.status(500).json({ error: "Could not prepare PDF download" });
    }

    return res.json({
      url: signed.signedUrl,
      filename,
      view,
      expires_in: 60,
    });
  } catch (err) {
    req.log.error({ err }, "invoice PDF generation failed");
    return res.status(503).json({
      error: "PDF generation is temporarily unavailable. You can still view the invoice in the app.",
    });
  }
});

export default router;
