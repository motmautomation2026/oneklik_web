import type { Request, Response } from "express";
import { Router } from "express";
import express from "express";
import crypto from "node:crypto";
import { supabaseAdmin } from "../lib/supabaseAdmin.js";

const router = Router();

interface RazorpayPaymentEntity {
  id: string;
  order_id: string;
  status: string;
}

interface RazorpayWebhookBody {
  event: string;
  payload: {
    payment?: { entity: RazorpayPaymentEntity };
  };
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
      .select("id, user_id, status, credits_promised")
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
          .update({ status: "success", updated_at: new Date().toISOString() })
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
