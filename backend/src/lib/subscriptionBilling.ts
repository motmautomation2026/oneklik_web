import { findPack, type CreditPack } from "./creditPacks.js";

export const PLAN_RANKS: Record<string, number> = {
  starter: 1,
  growth: 2,
  business: 3,
};

export function planRank(planId: string): number {
  return PLAN_RANKS[planId] ?? 0;
}

export function isUpgradeOrSame(fromPlanId: string, toPlanId: string): boolean {
  return planRank(toPlanId) >= planRank(fromPlanId);
}

export function resolveMonthlyPlan(packId: string): CreditPack | undefined {
  return findPack(packId);
}

export type SubscriptionStatus = "active" | "past_due" | "expired" | "cancelled";

export interface SubscriptionRow {
  id: string;
  user_id: string;
  plan_id: string;
  status: SubscriptionStatus;
  current_period_id: string | null;
  current_period_start: string;
  current_period_end: string;
  grace_ends_at: string;
  pending_plan_id: string | null;
  last_payment_id: string | null;
}

export interface CompleteSubscriptionResult {
  ok: boolean;
  reason?: string;
  already_applied?: boolean;
  topup?: boolean;
  change_type?: string;
  period_id?: string;
  credits_granted?: number;
  rollover_credits?: number;
  credits_expired?: number;
  skipped?: boolean;
}

export function daysUntil(iso: string, now = new Date()): number {
  const target = new Date(iso).getTime();
  const diff = target - now.getTime();
  return Math.ceil(diff / (24 * 60 * 60 * 1000));
}

export function isInGrace(sub: Pick<SubscriptionRow, "current_period_end" | "grace_ends_at">, now = new Date()): boolean {
  const t = now.getTime();
  return t > new Date(sub.current_period_end).getTime() && t <= new Date(sub.grace_ends_at).getTime();
}

export function isPastGrace(sub: Pick<SubscriptionRow, "grace_ends_at">, now = new Date()): boolean {
  return now.getTime() > new Date(sub.grace_ends_at).getTime();
}
