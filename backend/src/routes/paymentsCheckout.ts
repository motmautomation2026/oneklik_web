import type { Request, Response } from "express";
import { Router } from "express";
import { randomUUID } from "node:crypto";
import { requireAuth } from "../middleware/auth.js";
import { enforceAccountStatus } from "../middleware/accountStatus.js";
import { supabaseAdmin } from "../lib/supabaseAdmin.js";
import { razorpay, RAZORPAY_KEY_ID } from "../lib/razorpay.js";
import { CREDIT_PACKS, findPack } from "../lib/creditPacks.js";

const router = Router();

router.get("/payments/packs", requireAuth, enforceAccountStatus({ allowFrozen: true }), (_req: Request, res: Response) => {
  return res.json({ packs: CREDIT_PACKS });
});

router.post("/payments/checkout", requireAuth, enforceAccountStatus(), async (req: Request, res: Response) => {
  const body = (req.body ?? {}) as { pack_id?: string };
  const pack = typeof body.pack_id === "string" ? findPack(body.pack_id) : undefined;

  if (!pack) {
    return res.status(400).json({ error: "Unknown or unavailable credit pack" });
  }

  const userId = req.user!.id;
  const amountMinorUnits = pack.priceInr * 100; // paise
  const idempotencyKey = randomUUID();

  const { data: payment, error: paymentError } = await supabaseAdmin
    .from("payments")
    .insert({
      user_id: userId,
      gateway: "razorpay",
      status: "initiated",
      credits_promised: pack.credits,
      amount_minor_units: amountMinorUnits,
      currency: "INR",
      idempotency_key: idempotencyKey,
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
      currency: "INR",
      receipt: paymentId,
      notes: { payment_id: paymentId, user_id: userId, pack_id: pack.id },
    });

    await supabaseAdmin
      .from("payments")
      .update({ status: "pending", gateway_payment_id: order.id })
      .eq("id", paymentId);

    return res.json({
      payment_id: paymentId,
      order_id: order.id,
      amount: amountMinorUnits,
      currency: "INR",
      key_id: RAZORPAY_KEY_ID,
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
// the only thing that ever actually flips this to "success" server-side,
// never the client-side Razorpay callback (that can be faked/interrupted).
router.get("/payments/:id/status", requireAuth, enforceAccountStatus({ allowFrozen: true }), async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const { data: payment, error } = await supabaseAdmin
    .from("payments")
    .select("id, status, credits_promised")
    .eq("id", req.params.id)
    .eq("user_id", userId)
    .maybeSingle();

  if (error || !payment) {
    return res.status(404).json({ error: "Payment not found" });
  }

  return res.json(payment);
});

export default router;
