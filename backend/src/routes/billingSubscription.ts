import type { Request, Response } from "express";
import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { enforceAccountStatus } from "../middleware/accountStatus.js";
import { supabaseAdmin } from "../lib/supabaseAdmin.js";
import { ensureSubscriptionCreditState } from "../lib/ensureSubscription.js";
import { findPack, packPricingView } from "../lib/creditPacks.js";
import { repairOrphanProformasForUser } from "../lib/issueProforma.js";

const router = Router();

router.get("/billing/subscription", requireAuth, enforceAccountStatus({ allowFrozen: true }), async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const sub = await ensureSubscriptionCreditState(userId, req.log);

  try {
    await repairOrphanProformasForUser(userId, req.log);
  } catch (err) {
    req.log.warn({ err, userId }, "orphan proforma repair on subscription load failed");
  }

  if (!sub) {
    return res.json({ subscription: null });
  }

  const plan = findPack(sub.plan_id);
  const pendingPlanId = sub.pending_plan_id || sub.plan_id;
  const pendingPlan = findPack(pendingPlanId);

  let proforma: { id: string; invoice_number: string; status: string; due_date: string | null } | null = null;
  if (sub.current_period_id) {
    const { data: period } = await supabaseAdmin
      .from("subscription_periods")
      .select("proforma_id")
      .eq("id", sub.current_period_id)
      .maybeSingle();

    if (period?.proforma_id) {
      const { data: inv } = await supabaseAdmin
        .from("invoices")
        .select("id, invoice_number, status, due_date")
        .eq("id", period.proforma_id)
        .maybeSingle();
      if (inv) {
        // Only surface open (payable) proformas on the subscription card / Pay now CTA.
        if ((inv.status as string) === "issued") {
          proforma = {
            id: inv.id as string,
            invoice_number: inv.invoice_number as string,
            status: inv.status as string,
            due_date: (inv.due_date as string | null) ?? null,
          };
        }
      }
    }
  }

  return res.json({
    subscription: {
      id: sub.id,
      plan_id: sub.plan_id,
      plan: plan ? packPricingView(plan) : null,
      status: sub.status,
      current_period_id: sub.current_period_id,
      current_period_start: sub.current_period_start,
      current_period_end: sub.current_period_end,
      grace_ends_at: sub.grace_ends_at,
      pending_plan_id: pendingPlanId,
      pending_plan: pendingPlan ? packPricingView(pendingPlan) : null,
      proforma,
    },
  });
});

router.post("/billing/pending-plan", requireAuth, enforceAccountStatus(), async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const body = (req.body ?? {}) as { plan_id?: string };
  const plan = typeof body.plan_id === "string" ? findPack(body.plan_id) : undefined;
  if (!plan) {
    return res.status(400).json({ error: "Unknown plan" });
  }

  const { data: sub, error } = await supabaseAdmin
    .from("subscriptions")
    .select("id, status")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    req.log.error({ err: error }, "failed to load subscription for pending plan");
    return res.status(500).json({ error: "Could not update plan" });
  }
  if (!sub) {
    return res.status(404).json({ error: "No active subscription" });
  }
  if (sub.status === "expired" || sub.status === "cancelled") {
    return res.status(409).json({ error: "Subscribe again by purchasing a monthly plan" });
  }

  const { error: updateError } = await supabaseAdmin
    .from("subscriptions")
    .update({ pending_plan_id: plan.id, updated_at: new Date().toISOString() })
    .eq("id", sub.id);

  if (updateError) {
    req.log.error({ err: updateError }, "failed to set pending plan");
    return res.status(500).json({ error: "Could not update plan" });
  }

  return res.json({ ok: true, pending_plan_id: plan.id });
});

export default router;
