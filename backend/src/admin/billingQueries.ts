import { supabaseAdmin } from "../lib/supabaseAdmin.js";
import { CREDIT_PACKS, findPack } from "../lib/creditPacks.js";
import type { InvoiceRow } from "../lib/issueInvoice.js";
import type {
  AdminBillingProfileSummary,
  AdminInvoiceRow,
  AdminSubscriptionRow,
  AdminSubscriptionSummary,
  PaginatedSubscriptions,
  PlanMixEntry,
  SubscriptionStatus,
  SubscriptionsKpis,
} from "./types.js";

const PAGE_SIZE = 1000;
const MAX_PAGES = 20;
const LAPSING_SOON_DAYS = 7;

const SUBSCRIPTION_SELECT =
  "id, user_id, plan_id, status, current_period_id, current_period_start, current_period_end, grace_ends_at, pending_plan_id";

const INVOICE_LIST_SELECT =
  "id, invoice_number, document_type, status, total_minor, currency, issued_at, due_date, series, receipt_number";

const BILLING_PROFILE_SELECT =
  "legal_name, entity_type, gstin, address_line1, address_line2, city, state_code, state_name, postal_code, country";

interface RawSubscriptionRow {
  id: string;
  user_id: string;
  plan_id: string;
  status: SubscriptionStatus;
  current_period_id: string | null;
  current_period_start: string;
  current_period_end: string;
  grace_ends_at: string;
  pending_plan_id: string | null;
}

function packTaxableMinor(planId: string): number {
  return findPack(planId)?.priceMinorUnits ?? 0;
}

function planName(planId: string): string | null {
  return findPack(planId)?.name ?? CREDIT_PACKS.find((p) => p.id === planId)?.name ?? null;
}

function planCredits(planId: string): number | null {
  const pack = findPack(planId) ?? CREDIT_PACKS.find((p) => p.id === planId);
  return pack?.credits ?? null;
}

function msPerDay(): number {
  return 24 * 60 * 60 * 1000;
}

export function deriveBufferFields(
  status: SubscriptionStatus,
  periodEnd: string,
  graceEndsAt: string,
  now = new Date(),
): { is_in_buffer: boolean; days_to_lapse: number | null } {
  const nowMs = now.getTime();
  const periodEndMs = new Date(periodEnd).getTime();
  const graceMs = new Date(graceEndsAt).getTime();
  const is_in_buffer =
    status === "past_due" || (status === "active" && nowMs > periodEndMs && nowMs <= graceMs);

  let days_to_lapse: number | null = null;
  if (status === "active" || status === "past_due") {
    const target = status === "past_due" || is_in_buffer ? graceMs : periodEndMs;
    days_to_lapse = Math.ceil((target - nowMs) / msPerDay());
  }
  return { is_in_buffer, days_to_lapse };
}

export function toSubscriptionSummary(
  row: RawSubscriptionRow,
  period?: { change_type: string | null; credits_granted: number | null } | null,
): AdminSubscriptionSummary {
  const { is_in_buffer, days_to_lapse } = deriveBufferFields(
    row.status,
    row.current_period_end,
    row.grace_ends_at,
  );
  return {
    plan_id: row.plan_id,
    plan_name: planName(row.plan_id),
    status: row.status,
    current_period_start: row.current_period_start,
    current_period_end: row.current_period_end,
    grace_ends_at: row.grace_ends_at,
    pending_plan_id: row.pending_plan_id,
    credits: planCredits(row.plan_id),
    is_in_buffer,
    days_to_lapse,
    current_period_id: row.current_period_id,
    period_change_type: period?.change_type ?? null,
    period_credits_granted: period?.credits_granted ?? null,
  };
}

export function toBillingProfileSummary(row: {
  legal_name: string;
  entity_type: string;
  gstin: string | null;
  address_line1: string;
  address_line2: string | null;
  city: string;
  state_code: string;
  state_name: string;
  postal_code: string;
  country: string;
}): AdminBillingProfileSummary {
  return {
    legal_name: row.legal_name,
    entity_type: row.entity_type,
    gstin: row.gstin,
    address_line1: row.address_line1,
    address_line2: row.address_line2,
    city: row.city,
    state_code: row.state_code,
    state_name: row.state_name,
    postal_code: row.postal_code,
    country: row.country,
  };
}

export function toAdminInvoiceRow(row: {
  id: string;
  invoice_number: string;
  document_type: string;
  status: string;
  total_minor: number;
  currency: string;
  issued_at: string;
  due_date: string | null;
  series: string;
  receipt_number: string | null;
}): AdminInvoiceRow {
  return {
    id: row.id,
    invoice_number: row.invoice_number,
    document_type: row.document_type as AdminInvoiceRow["document_type"],
    status: row.status as AdminInvoiceRow["status"],
    total_minor: row.total_minor,
    currency: row.currency,
    issued_at: row.issued_at,
    due_date: row.due_date,
    series: row.series,
    receipt_number: row.receipt_number,
  };
}

/** Batch lookup of plan_id + status for a page of users (avoids N+1). */
export async function getSubscriptionHintsByUserIds(
  userIds: string[],
): Promise<Map<string, { plan_id: string; status: SubscriptionStatus }>> {
  const map = new Map<string, { plan_id: string; status: SubscriptionStatus }>();
  if (userIds.length === 0) return map;

  const { data, error } = await supabaseAdmin
    .from("subscriptions")
    .select("user_id, plan_id, status")
    .in("user_id", userIds);
  if (error) throw error;

  for (const row of (data ?? []) as { user_id: string; plan_id: string; status: SubscriptionStatus }[]) {
    map.set(row.user_id, { plan_id: row.plan_id, status: row.status });
  }
  return map;
}

export async function fetchUserBillingBundle(userId: string): Promise<{
  subscription: AdminSubscriptionSummary | null;
  billing_profile: AdminBillingProfileSummary | null;
  invoices: AdminInvoiceRow[];
}> {
  const [subResult, profileResult, invoiceResult] = await Promise.all([
    supabaseAdmin.from("subscriptions").select(SUBSCRIPTION_SELECT).eq("user_id", userId).maybeSingle(),
    supabaseAdmin.from("billing_profiles").select(BILLING_PROFILE_SELECT).eq("user_id", userId).maybeSingle(),
    supabaseAdmin
      .from("invoices")
      .select(INVOICE_LIST_SELECT)
      .eq("user_id", userId)
      .order("issued_at", { ascending: false })
      .limit(50),
  ]);

  if (subResult.error) throw subResult.error;
  if (profileResult.error) throw profileResult.error;
  if (invoiceResult.error) throw invoiceResult.error;

  let subscription: AdminSubscriptionSummary | null = null;
  const rawSub = subResult.data as RawSubscriptionRow | null;
  if (rawSub) {
    let period: { change_type: string | null; credits_granted: number | null } | null = null;
    if (rawSub.current_period_id) {
      const { data: periodRow, error: periodError } = await supabaseAdmin
        .from("subscription_periods")
        .select("change_type, credits_granted")
        .eq("id", rawSub.current_period_id)
        .maybeSingle();
      if (periodError) throw periodError;
      if (periodRow) {
        period = {
          change_type: (periodRow.change_type as string | null) ?? null,
          credits_granted: (periodRow.credits_granted as number | null) ?? null,
        };
      }
    }
    subscription = toSubscriptionSummary(rawSub, period);
  }

  return {
    subscription,
    billing_profile: profileResult.data
      ? toBillingProfileSummary(profileResult.data as Parameters<typeof toBillingProfileSummary>[0])
      : null,
    invoices: ((invoiceResult.data ?? []) as Parameters<typeof toAdminInvoiceRow>[0][]).map(toAdminInvoiceRow),
  };
}

async function attachEmails<T extends { user_id: string }>(rows: T[]): Promise<(T & { email: string | null })[]> {
  return Promise.all(
    rows.map(async (row) => {
      const { data } = await supabaseAdmin.auth.admin.getUserById(row.user_id);
      return { ...row, email: data.user?.email ?? null };
    }),
  );
}

async function findUserIdsByEmailSubstring(term: string): Promise<Set<string>> {
  const needle = term.trim().toLowerCase();
  const ids = new Set<string>();
  if (!needle) return ids;

  for (let page = 1; page <= MAX_PAGES; page++) {
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage: PAGE_SIZE });
    if (error) throw error;
    const users = "users" in data ? data.users : [];
    for (const user of users) {
      if (user.email?.toLowerCase().includes(needle)) ids.add(user.id);
    }
    if (users.length < PAGE_SIZE) break;
  }
  return ids;
}

function lapsingSoonCutoffIso(now = new Date()): string {
  return new Date(now.getTime() + LAPSING_SOON_DAYS * msPerDay()).toISOString();
}

function isLapsingSoon(row: RawSubscriptionRow, now = new Date()): boolean {
  if (row.status === "past_due") return true;
  if (row.status !== "active") return false;
  return new Date(row.current_period_end).getTime() <= now.getTime() + LAPSING_SOON_DAYS * msPerDay();
}

interface GetSubscriptionsParams {
  page: number;
  pageSize: number;
  status?: SubscriptionStatus;
  planId?: string;
  search?: string;
  lapsingSoon?: boolean;
}

export async function getSubscriptions({
  page,
  pageSize,
  status,
  planId,
  search,
  lapsingSoon,
}: GetSubscriptionsParams): Promise<PaginatedSubscriptions> {
  const from = (page - 1) * pageSize;
  const trimmedSearch = search?.trim();
  const now = new Date();
  const cutoffIso = lapsingSoonCutoffIso(now);

  let userIdFilter: string[] | null = null;
  if (trimmedSearch) {
    const ids = await findUserIdsByEmailSubstring(trimmedSearch);
    if (ids.size === 0) {
      return { rows: [], total: 0, page, page_size: pageSize };
    }
    userIdFilter = Array.from(ids);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let query: any = supabaseAdmin
    .from("subscriptions")
    .select(SUBSCRIPTION_SELECT, { count: "exact" })
    .order("current_period_end", { ascending: true })
    .range(from, from + pageSize - 1);

  if (status) query = query.eq("status", status);
  if (planId) query = query.eq("plan_id", planId);
  if (userIdFilter) query = query.in("user_id", userIdFilter);

  if (lapsingSoon) {
    // past_due OR (active AND period_end within 7 days). Quote the ISO so
    // colons in the timestamp don't break PostgREST's filter parser.
    query = query.or(
      `status.eq.past_due,and(status.eq.active,current_period_end.lte."${cutoffIso}")`,
    );
  }

  const { data, error, count } = await query;
  if (error) throw error;

  const rawRows = (data ?? []) as RawSubscriptionRow[];
  const withEmails = await attachEmails(rawRows);

  const companyByUser = new Map<string, string | null>();
  if (rawRows.length > 0) {
    const { data: profiles, error: profileError } = await supabaseAdmin
      .from("profiles")
      .select("id, company")
      .in(
        "id",
        rawRows.map((r) => r.user_id),
      );
    if (profileError) throw profileError;
    for (const p of (profiles ?? []) as { id: string; company: string | null }[]) {
      companyByUser.set(p.id, p.company);
    }
  }

  const rows: AdminSubscriptionRow[] = withEmails.map((row) => {
    const { is_in_buffer, days_to_lapse } = deriveBufferFields(
      row.status,
      row.current_period_end,
      row.grace_ends_at,
      now,
    );
    return {
      user_id: row.user_id,
      email: row.email,
      company: companyByUser.get(row.user_id) ?? null,
      plan_id: row.plan_id,
      plan_name: planName(row.plan_id),
      status: row.status,
      current_period_start: row.current_period_start,
      current_period_end: row.current_period_end,
      grace_ends_at: row.grace_ends_at,
      pending_plan_id: row.pending_plan_id,
      credits: planCredits(row.plan_id),
      is_in_buffer,
      days_to_lapse,
      mrr_minor_units:
        row.status === "active" || row.status === "past_due" ? packTaxableMinor(row.plan_id) : 0,
    };
  });

  return { rows, total: count ?? 0, page, page_size: pageSize };
}

export async function getSubscriptionsKpis(): Promise<SubscriptionsKpis> {
  const now = new Date();
  const all: RawSubscriptionRow[] = [];
  let from = 0;
  for (let page = 0; page < MAX_PAGES; page++) {
    const { data, error } = await supabaseAdmin
      .from("subscriptions")
      .select(SUBSCRIPTION_SELECT)
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    const rows = (data ?? []) as RawSubscriptionRow[];
    if (rows.length === 0) break;
    all.push(...rows);
    if (rows.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }

  const { count: profileCount, error: profileCountError } = await supabaseAdmin
    .from("profiles")
    .select("id", { count: "exact", head: true });
  if (profileCountError) throw profileCountError;

  let mrr = 0;
  let paying = 0;
  let pastDue = 0;
  let expired = 0;
  let cancelled = 0;
  let lapsingSoon = 0;
  const mixMap = new Map<string, { count: number; mrr_minor_units: number }>();

  for (const row of all) {
    if (row.status === "active" || row.status === "past_due") {
      paying += 1;
      const taxable = packTaxableMinor(row.plan_id);
      mrr += taxable;
      const mix = mixMap.get(row.plan_id) ?? { count: 0, mrr_minor_units: 0 };
      mix.count += 1;
      mix.mrr_minor_units += taxable;
      mixMap.set(row.plan_id, mix);
    }
    if (row.status === "past_due") pastDue += 1;
    if (row.status === "expired") expired += 1;
    if (row.status === "cancelled") cancelled += 1;
    if (isLapsingSoon(row, now)) lapsingSoon += 1;
  }

  const plan_mix: PlanMixEntry[] = Array.from(mixMap.entries())
    .map(([plan_id, v]) => ({
      plan_id,
      plan_name: planName(plan_id),
      count: v.count,
      mrr_minor_units: v.mrr_minor_units,
    }))
    .sort((a, b) => b.mrr_minor_units - a.mrr_minor_units);

  return {
    mrr_minor_units: mrr,
    arr_minor_units: mrr * 12,
    currency: "INR",
    paying_count: paying,
    past_due_count: pastDue,
    expired_count: expired,
    cancelled_count: cancelled,
    no_subscription_count: Math.max(0, (profileCount ?? 0) - all.length),
    lapsing_soon_count: lapsingSoon,
    plan_mix,
  };
}

export async function getAdminInvoiceById(invoiceId: string): Promise<InvoiceRow | null> {
  const { data, error } = await supabaseAdmin.from("invoices").select("*").eq("id", invoiceId).maybeSingle();
  if (error) throw error;
  return (data as InvoiceRow | null) ?? null;
}

export { BILLING_PROFILE_SELECT, INVOICE_LIST_SELECT, SUBSCRIPTION_SELECT };
