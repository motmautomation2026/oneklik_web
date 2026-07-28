import { supabaseAdmin } from "./supabaseAdmin.js";
import type { CompleteSubscriptionResult, SubscriptionRow } from "./subscriptionBilling.js";
import { issueProformaForPeriod } from "./issueProforma.js";

const THREE_DAYS_MS = 3 * 24 * 60 * 60 * 1000;

async function ensureProformaForCurrentPeriod(
  row: SubscriptionRow,
  log?: { warn: (obj: unknown, msg?: string) => void; error: (obj: unknown, msg?: string) => void },
): Promise<void> {
  if (!row.current_period_id) return;
  if (row.status === "expired" || row.status === "cancelled") return;

  const now = Date.now();
  const periodEnd = new Date(row.current_period_end).getTime();
  const graceEnd = new Date(row.grace_ends_at).getTime();

  // Issue when approaching due (T-3), or already past due but still in grace.
  const approachingDue = now < periodEnd && periodEnd - now <= THREE_DAYS_MS;
  const inGraceOrPastDue = now >= periodEnd && now <= graceEnd;
  const markedPastDue = row.status === "past_due";

  if (!approachingDue && !inGraceOrPastDue && !markedPastDue) return;

  const { data: period } = await supabaseAdmin
    .from("subscription_periods")
    .select("id, proforma_id")
    .eq("id", row.current_period_id)
    .maybeSingle();

  if (!period || period.proforma_id) return;

  const planId = row.pending_plan_id || row.plan_id;
  const result = await issueProformaForPeriod({
    userId: row.user_id,
    periodId: period.id as string,
    planId,
    periodEndIso: row.current_period_end,
    graceEndsIso: row.grace_ends_at,
    log,
  });
  if ("skipped" in result) {
    log?.warn({ userId: row.user_id, reason: result.reason }, "lazy proforma skipped");
  }
}

/**
 * Lazy billing maintenance for one user — no cron required.
 * Runs on Plans page, Billing, checkout, and credit holds.
 */
export async function ensureSubscriptionCreditState(
  userId: string,
  log?: { warn: (obj: unknown, msg?: string) => void; error: (obj: unknown, msg?: string) => void },
): Promise<SubscriptionRow | null> {
  const { data: sub, error } = await supabaseAdmin
    .from("subscriptions")
    .select(
      "id, user_id, plan_id, status, current_period_id, current_period_start, current_period_end, grace_ends_at, pending_plan_id, last_payment_id",
    )
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    log?.error({ err: error, userId }, "failed to load subscription for ensure");
    return null;
  }
  if (!sub) return null;

  const row = sub as SubscriptionRow;
  const now = Date.now();
  const periodEnd = new Date(row.current_period_end).getTime();
  const graceEnd = new Date(row.grace_ends_at).getTime();

  if (row.status === "active" && now > periodEnd && now <= graceEnd) {
    const { error: pastDueError } = await supabaseAdmin.rpc("fn_mark_subscription_past_due", {
      p_subscription_id: row.id,
    });
    if (pastDueError) {
      log?.warn({ err: pastDueError, subscriptionId: row.id }, "mark past_due failed");
    } else {
      row.status = "past_due";
    }
  }

  // Pro forma after past_due marking so grace / past_due users get a payable document.
  await ensureProformaForCurrentPeriod(row, log);

  if (row.current_period_id && now > graceEnd && row.status !== "expired") {
    const { data, error: expireError } = await supabaseAdmin.rpc("fn_expire_subscription_period", {
      p_period_id: row.current_period_id,
    });
    if (expireError) {
      log?.error({ err: expireError, periodId: row.current_period_id }, "expire subscription period failed");
    } else {
      const result = data as { ok?: boolean; credits_expired?: number } | null;
      if (result?.ok) {
        row.status = "expired";
      }
    }
  }

  return row;
}

export async function completeSubscriptionPayment(
  paymentId: string,
  log?: { warn: (obj: unknown, msg?: string) => void; error: (obj: unknown, msg?: string) => void },
): Promise<CompleteSubscriptionResult> {
  const { data, error } = await supabaseAdmin.rpc("fn_complete_subscription_payment", {
    p_payment_id: paymentId,
  });

  if (error) {
    log?.error({ err: error, paymentId }, "fn_complete_subscription_payment failed");
    return { ok: false, reason: error.message };
  }

  const result = (data ?? { ok: false, reason: "empty_rpc_result" }) as CompleteSubscriptionResult;
  if (!result.ok) {
    log?.warn({ paymentId, result }, "subscription payment completion returned not ok");
  }
  return result;
}

export async function getSubscriptionForUser(userId: string): Promise<SubscriptionRow | null> {
  const { data } = await supabaseAdmin
    .from("subscriptions")
    .select(
      "id, user_id, plan_id, status, current_period_id, current_period_start, current_period_end, grace_ends_at, pending_plan_id, last_payment_id",
    )
    .eq("user_id", userId)
    .maybeSingle();
  return (data as SubscriptionRow | null) ?? null;
}
