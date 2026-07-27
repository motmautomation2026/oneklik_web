import type { Request, Response } from "express";
import { Router } from "express";
import { randomUUID } from "node:crypto";
import { requireAuth } from "../middleware/auth.js";
import { enforceAccountStatus } from "../middleware/accountStatus.js";
import { supabaseAdmin } from "../lib/supabaseAdmin.js";
import { razorpay, RAZORPAY_KEY_ID } from "../lib/razorpay.js";
import { CREDIT_PACKS, computePackTax, findPack, packPricingView, packSnapshot } from "../lib/creditPacks.js";
import { loadSellerSnapshot } from "../lib/sellerIdentity.js";
import { issueInvoiceForPayment, type PackSnapshotRow } from "../lib/issueInvoice.js";

const router = Router();

router.get("/payments/packs", requireAuth, enforceAccountStatus({ allowFrozen: true }), (_req: Request, res: Response) => {
  return res.json({
    packs: CREDIT_PACKS.map(packPricingView),
  });
});

router.post("/payments/checkout", requireAuth, enforceAccountStatus(), async (req: Request, res: Response) => {
  const body = (req.body ?? {}) as { pack_id?: string };
  const pack = typeof body.pack_id === "string" ? findPack(body.pack_id) : undefined;

  if (!pack) {
    return res.status(400).json({ error: "Unknown or unavailable credit pack" });
  }

  const userId = req.user!.id;

  const { data: billing, error: billingError } = await supabaseAdmin
    .from("billing_profiles")
    .select("state_code, legal_name, gstin")
    .eq("user_id", userId)
    .maybeSingle();

  if (billingError) {
    req.log.error({ err: billingError }, "failed to load billing profile for checkout");
    return res.status(500).json({ error: "Could not start checkout" });
  }

  if (!billing?.state_code || !billing.legal_name) {
    return res.status(409).json({
      error: "Add billing details before purchasing credits",
      code: "billing_profile_required",
    });
  }

  // Charge total = taxable + GST is identical for CGST+SGST and IGST.
  // Seller state only affects the invoice tax-line split (hardcoded identity).
  const sellerStateCode = loadSellerSnapshot().seller.state_code;
  const buyerStateCode = billing.state_code as string;

  let tax;
  try {
    tax = computePackTax(pack, sellerStateCode, buyerStateCode);
  } catch (err) {
    req.log.error({ err }, "tax computation failed");
    return res.status(500).json({ error: "Could not calculate tax" });
  }

  const amountMinorUnits = tax.totalMinor;
  const idempotencyKey = randomUUID();
  const snapshot = packSnapshot(pack, tax);

  const { data: payment, error: paymentError } = await supabaseAdmin
    .from("payments")
    .insert({
      user_id: userId,
      gateway: "razorpay",
      status: "initiated",
      credits_promised: pack.credits,
      amount_minor_units: amountMinorUnits,
      currency: pack.currency,
      idempotency_key: idempotencyKey,
      pack_id: pack.id,
      pack_snapshot: snapshot,
      taxable_value_minor: tax.taxableMinor,
      tax_minor: tax.taxTotalMinor,
    })
    .select("id")
    .single();

  if (paymentError || !payment) {
    req.log.error({ err: paymentError }, "failed to create payments row");
    return res.status(500).json({ error: "Could not start checkout" });
  }

  const paymentId = payment.id as string;

  try {
    const order = await razorpay.orders.create({
      amount: amountMinorUnits,
      currency: pack.currency,
      receipt: paymentId,
      notes: {
        payment_id: paymentId,
        user_id: userId,
        pack_id: pack.id,
        taxable_value_minor: String(tax.taxableMinor),
        tax_minor: String(tax.taxTotalMinor),
      },
    });

    // Keep gateway_payment_id = order.id so the existing webhook matcher
    // continues to work. Also store gateway_order_id explicitly.
    await supabaseAdmin
      .from("payments")
      .update({
        status: "pending",
        gateway_payment_id: order.id,
        gateway_order_id: order.id,
      })
      .eq("id", paymentId);

    const email = req.user!.email ?? undefined;
    const contact =
      typeof (req.user as { phone?: string } | undefined)?.phone === "string"
        ? (req.user as { phone?: string }).phone
        : undefined;

    return res.json({
      payment_id: paymentId,
      order_id: order.id,
      amount: amountMinorUnits,
      currency: pack.currency,
      key_id: RAZORPAY_KEY_ID,
      prefill: {
        name: billing.legal_name as string,
        email,
        contact,
      },
    });
  } catch (err) {
    req.log.error({ err }, "razorpay order creation failed");
    await supabaseAdmin
      .from("payments")
      .update({ status: "failed", updated_at: new Date().toISOString() })
      .eq("id", paymentId);
    return res.status(502).json({ error: "Could not reach payment gateway" });
  }
});

// Polled by the frontend after the checkout modal closes — the webhook is
// normally what flips status to "success". Invoice issuance also runs in the
// webhook, but local/dev webhooks often hit production instead of this process.
// If payment is already success and still has no invoice, repair it here so
// polling after checkout still produces a tax invoice.
router.get("/payments/:id/status", requireAuth, enforceAccountStatus({ allowFrozen: true }), async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const { data: payment, error } = await supabaseAdmin
    .from("payments")
    .select("id, status, credits_promised, pack_snapshot, gateway_capture_id, gateway_payment_id")
    .eq("id", req.params.id)
    .eq("user_id", userId)
    .maybeSingle();

  if (error || !payment) {
    return res.status(404).json({ error: "Payment not found" });
  }

  let invoiceId: string | null = null;
  let invoiceNumber: string | null = null;

  const { data: existingInvoice } = await supabaseAdmin
    .from("invoices")
    .select("id, invoice_number")
    .eq("payment_id", payment.id)
    .maybeSingle();

  if (existingInvoice) {
    invoiceId = existingInvoice.id as string;
    invoiceNumber = existingInvoice.invoice_number as string;
  } else if (payment.status === "success") {
    const pack = payment.pack_snapshot as PackSnapshotRow | null;
    if (pack && typeof pack.total_minor === "number") {
      try {
        const result = await issueInvoiceForPayment({
          paymentId: payment.id as string,
          userId,
          packSnapshot: pack,
          paymentSnapshot: {
            order_id: payment.gateway_payment_id,
            razorpay_payment_id: payment.gateway_capture_id,
            method: null,
            source: "status_poll_repair",
          },
          buyerEmail: req.user!.email ?? null,
          log: req.log,
        });
        if ("invoiceId" in result) {
          invoiceId = result.invoiceId;
          const { data: issued } = await supabaseAdmin
            .from("invoices")
            .select("invoice_number")
            .eq("id", result.invoiceId)
            .maybeSingle();
          invoiceNumber = (issued?.invoice_number as string | undefined) ?? null;
        } else {
          req.log.warn({ paymentId: payment.id, reason: result.reason }, "invoice repair skipped on status poll");
        }
      } catch (err) {
        req.log.error({ err, paymentId: payment.id }, "invoice repair threw on status poll");
      }
    }
  }

  return res.json({
    id: payment.id,
    status: payment.status,
    credits_promised: payment.credits_promised,
    invoice_id: invoiceId,
    invoice_number: invoiceNumber,
  });
});

export default router;
