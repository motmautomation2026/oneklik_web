import type { Request, Response } from "express";
import { Router } from "express";
import express from "express";
import crypto from "node:crypto";
import { supabaseAdmin } from "../lib/supabaseAdmin.js";
import { razorpay } from "../lib/razorpay.js";
import { issueInvoiceForPayment, type PackSnapshotRow } from "../lib/issueInvoice.js";

const router = Router();

interface RazorpayPaymentEntity {
  id: string;
  order_id: string;
  status: string;
  method?: string;
  bank?: string;
  vpa?: string;
  card?: { network?: string; last4?: string };
  acquirer_data?: { rrn?: string; auth_code?: string };
  email?: string;
  contact?: string;
  fee?: number;
  tax?: number;
  amount?: number;
  currency?: string;
}

interface RazorpayWebhookBody {
  event: string;
  payload: {
    payment?: { entity: RazorpayPaymentEntity };
  };
}

function buildPaymentSnapshot(entity: RazorpayPaymentEntity): Record<string, unknown> {
  return {
    razorpay_payment_id: entity.id,
    order_id: entity.order_id,
    method: entity.method ?? null,
    bank: entity.bank ?? null,
    vpa: entity.vpa ?? null,
    card_network: entity.card?.network ?? null,
    card_last4: entity.card?.last4 ?? null,
    rrn: entity.acquirer_data?.rrn ?? null,
    auth_code: entity.acquirer_data?.auth_code ?? null,
    email: entity.email ?? null,
    contact: entity.contact ?? null,
    fee: entity.fee ?? null,
    tax: entity.tax ?? null,
    amount: entity.amount ?? null,
    currency: entity.currency ?? null,
  };
}

async function enrichPaymentEntity(entity: RazorpayPaymentEntity): Promise<RazorpayPaymentEntity> {
  try {
    const fetched = (await razorpay.payments.fetch(entity.id)) as RazorpayPaymentEntity;
    return { ...entity, ...fetched, id: entity.id, order_id: entity.order_id };
  } catch {
    return entity;
  }
}

// Razorpay calls this directly — no user session, so it's authenticated by
// verifying the HMAC signature instead of requireAuth. That verification
// needs the *exact raw bytes* Razorpay signed, which is why this route uses
// express.raw() instead of the app-wide express.json() (JSON-parsing first
// would lose the original byte sequence the signature was computed over).
router.post(
  "/payments/razorpay-webhook",
  express.raw({ type: "application/json" }),
  async (req: Request, res: Response) => {
    const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;
    if (!webhookSecret) {
      req.log.error("RAZORPAY_WEBHOOK_SECRET not configured");
      return res.status(500).send("webhook not configured");
    }

    const rawBody = req.body as Buffer;
    const signature = req.header("x-razorpay-signature");

    if (!signature) {
      return res.status(400).send("missing signature");
    }

    const expectedSignature = crypto.createHmac("sha256", webhookSecret).update(rawBody).digest("hex");

    // Constant-time compare — a plain === check on a signature is itself a
    // timing-attack surface.
    const signatureValid =
      expectedSignature.length === signature.length &&
      crypto.timingSafeEqual(Buffer.from(expectedSignature), Buffer.from(signature));

    if (!signatureValid) {
      req.log.error("razorpay webhook signature mismatch");
      return res.status(400).send("invalid signature");
    }

    let body: RazorpayWebhookBody;
    try {
      body = JSON.parse(rawBody.toString("utf8"));
    } catch {
      return res.status(400).send("invalid json");
    }

    const paymentEntity = body.payload?.payment?.entity;
    if (!paymentEntity) {
      // Not a payment event we care about (e.g. refund/dispute) — ack it so
      // Razorpay doesn't retry forever, just don't act on it yet.
      return res.status(200).send("ignored");
    }

    const { data: payment, error: fetchError } = await supabaseAdmin
      .from("payments")
      .select("id, user_id, status, credits_promised, pack_snapshot, taxable_value_minor, tax_minor")
      .eq("gateway", "razorpay")
      .eq("gateway_payment_id", paymentEntity.order_id)
      .maybeSingle();

    if (fetchError || !payment) {
      req.log.error({ err: fetchError, orderId: paymentEntity.order_id }, "webhook for unknown payment order");
      // Still 200 — a 4xx/5xx here just makes Razorpay retry a payment we
      // will never be able to match.
      return res.status(200).send("unknown order");
    }

    if (body.event === "payment.captured") {
      if (payment.status !== "success") {
        await supabaseAdmin
          .from("payments")
          .update({
            status: "success",
            gateway_capture_id: paymentEntity.id,
            updated_at: new Date().toISOString(),
          })
          .eq("id", payment.id);
      } else {
        await supabaseAdmin
          .from("payments")
          .update({
            gateway_capture_id: paymentEntity.id,
            updated_at: new Date().toISOString(),
          })
          .eq("id", payment.id);
      }

      // fn_grant_credits is idempotent on (type='purchase', reference_id) —
      // a replayed webhook for the same payment is a safe no-op here, this
      // was proven against real duplicate calls back in Week 1.
      const { error: grantError } = await supabaseAdmin.rpc("fn_grant_credits", {
        p_user_id: payment.user_id,
        p_amount: payment.credits_promised,
        p_type: "purchase",
        p_reference_id: payment.id,
        p_reason_code: "razorpay_payment_captured",
      });

      if (grantError) {
        req.log.error({ err: grantError }, "fn_grant_credits failed for captured payment");
        return res.status(500).send("grant failed");
      }

      // Invoice is best-effort AFTER credits. Failure must not fail the webhook.
      const packSnapshot = payment.pack_snapshot as PackSnapshotRow | null;
      if (packSnapshot && typeof packSnapshot.total_minor === "number") {
        try {
          const enriched = await enrichPaymentEntity(paymentEntity);
          const result = await issueInvoiceForPayment({
            paymentId: payment.id as string,
            userId: payment.user_id as string,
            packSnapshot,
            paymentSnapshot: buildPaymentSnapshot(enriched),
            buyerEmail: enriched.email ?? null,
            log: req.log,
          });
          if ("skipped" in result) {
            req.log.warn({ paymentId: payment.id, reason: result.reason }, "invoice not issued");
          }
        } catch (err) {
          req.log.error({ err, paymentId: payment.id }, "invoice issuance threw after credit grant");
        }
      } else {
        // Pre-invoicing payment rows (or in-flight checkouts from before deploy)
        // still grant credits; invoices start for new checkouts that freeze pack_snapshot.
        req.log.info({ paymentId: payment.id }, "skipping invoice — no pack_snapshot on payment");
      }
    } else if (body.event === "payment.failed") {
      if (payment.status !== "success") {
        await supabaseAdmin
          .from("payments")
          .update({ status: "failed", updated_at: new Date().toISOString() })
          .eq("id", payment.id);
      }
    }

    return res.status(200).send("ok");
  },
);

export default router;
