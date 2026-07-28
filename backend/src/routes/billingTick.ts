import type { Request, Response } from "express";
import { Router } from "express";
import { supabaseAdmin } from "../lib/supabaseAdmin.js";
import { issueProformaForPeriod } from "../lib/issueProforma.js";

const router = Router();

/**
 * OPTIONAL daily sweep. Not required for production — billing already
 * self-heals per user via ensureSubscriptionCreditState (Plans page,
 * checkout, credit holds). Keep this only if you later want a VPS cron.
 * Header: Authorization: Bearer <CRON_SECRET>
 */
router.post("/internal/billing-tick", async (req: Request, res: Response) => {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return res.status(503).json({
      error: "cron not configured — optional; app uses lazy billing without CRON_SECRET",
    });
  }

  const auth = req.header("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token || token !== secret) {
    return res.status(401).json({ error: "unauthorized" });
  }

  const now = new Date();
  const summary = {
    past_due: 0,
    expired: 0,
    proformas: 0,
    proforma_skipped: 0,
    errors: 0,
  };

  // Mark past_due
  const { data: activeSubs, error: activeError } = await supabaseAdmin
    .from("subscriptions")
    .select("id, current_period_end, grace_ends_at, status")
    .eq("status", "active")
    .lt("current_period_end", now.toISOString())
    .gte("grace_ends_at", now.toISOString());

  if (activeError) {
    req.log.error({ err: activeError }, "billing-tick failed loading active subs");
    summary.errors += 1;
  } else {
    for (const sub of activeSubs ?? []) {
      const { error } = await supabaseAdmin.rpc("fn_mark_subscription_past_due", {
        p_subscription_id: sub.id,
      });
      if (error) {
        req.log.error({ err: error, subscriptionId: sub.id }, "mark past_due failed");
        summary.errors += 1;
      } else {
        summary.past_due += 1;
      }
    }
  }

  // Expire past grace
  const { data: dueExpire, error: expireListError } = await supabaseAdmin
    .from("subscriptions")
    .select("id, current_period_id, status")
    .in("status", ["active", "past_due"])
    .lt("grace_ends_at", now.toISOString());

  if (expireListError) {
    req.log.error({ err: expireListError }, "billing-tick failed loading expire candidates");
    summary.errors += 1;
  } else {
    for (const sub of dueExpire ?? []) {
      if (!sub.current_period_id) continue;
      const { data, error } = await supabaseAdmin.rpc("fn_expire_subscription_period", {
        p_period_id: sub.current_period_id,
      });
      if (error) {
        req.log.error({ err: error, periodId: sub.current_period_id }, "expire period failed");
        summary.errors += 1;
      } else if ((data as { ok?: boolean } | null)?.ok) {
        summary.expired += 1;
      }
    }
  }

  // Pro formas for periods ending within 3 days (and not yet issued)
  const inThreeDays = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);
  const { data: renewing, error: renewError } = await supabaseAdmin
    .from("subscriptions")
    .select("id, user_id, plan_id, pending_plan_id, current_period_id, current_period_end, grace_ends_at, status")
    .in("status", ["active", "past_due"])
    .gte("current_period_end", now.toISOString())
    .lte("current_period_end", inThreeDays.toISOString());

  if (renewError) {
    req.log.error({ err: renewError }, "billing-tick failed loading proforma candidates");
    summary.errors += 1;
  } else {
    for (const sub of renewing ?? []) {
      if (!sub.current_period_id) continue;

      const { data: period } = await supabaseAdmin
        .from("subscription_periods")
        .select("id, proforma_id, plan_id")
        .eq("id", sub.current_period_id)
        .maybeSingle();

      if (!period || period.proforma_id) continue;

      const planId = (sub.pending_plan_id as string | null) || (sub.plan_id as string);
      const result = await issueProformaForPeriod({
        userId: sub.user_id as string,
        periodId: period.id as string,
        planId,
        periodEndIso: sub.current_period_end as string,
        graceEndsIso: sub.grace_ends_at as string,
        log: req.log,
      });

      if ("proformaId" in result) {
        summary.proformas += 1;
      } else {
        summary.proforma_skipped += 1;
        req.log.warn({ periodId: period.id, reason: result.reason }, "proforma skipped");
      }
    }
  }

  req.log.info({ summary }, "billing-tick completed");
  return res.json({ ok: true, summary, at: now.toISOString() });
});

export default router;
