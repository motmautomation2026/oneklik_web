import type { Request, Response } from "express";
import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { enforceAccountStatus } from "../middleware/accountStatus.js";
import { supabaseAdmin } from "../lib/supabaseAdmin.js";
import { ensureInvoicePdf, renderInvoiceDocument, type InvoiceRow } from "../lib/issueInvoice.js";

const router = Router();

router.get("/invoices", requireAuth, enforceAccountStatus({ allowFrozen: true }), async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const limit = Math.min(Number(req.query.limit ?? 50) || 50, 100);
  const offset = Math.max(Number(req.query.offset ?? 0) || 0, 0);

  const { data, error } = await supabaseAdmin
    .from("invoices")
    .select(
      "id, invoice_number, receipt_number, invoice_date, issued_at, status, document_type, taxable_value_minor, cgst_minor, sgst_minor, igst_minor, total_minor, currency, payment_id, supply_type, financial_year, due_date",
    )
    .eq("user_id", userId)
    .order("issued_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) {
    req.log.error({ err: error }, "failed to list invoices");
    return res.status(500).json({ error: "Could not load invoices" });
  }

  return res.json({ invoices: data ?? [] });
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

  return res.json({ invoice: data });
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

  const html = renderInvoiceDocument(data as InvoiceRow, req.user!.email ?? null);
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
    const { path } = await ensureInvoicePdf(invoice);
    const { data: signed, error: signError } = await supabaseAdmin.storage
      .from("invoices")
      .createSignedUrl(path, 60);

    if (signError || !signed?.signedUrl) {
      req.log.error({ err: signError }, "failed to sign invoice PDF URL");
      return res.status(500).json({ error: "Could not prepare PDF download" });
    }

    return res.json({
      url: signed.signedUrl,
      filename: `${invoice.invoice_number}.pdf`,
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
