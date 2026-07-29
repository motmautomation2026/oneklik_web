import { supabaseAdmin } from "../lib/supabaseAdmin.js";
import { fetchUserBillingBundle, getInvoiceHintsByPaymentIds, getSubscriptionHintsByUserIds } from "./billingQueries.js";
import { ExportTooLargeError, MAX_EXPORT_ROWS } from "./exportLimits.js";
import type {
  AccountStatus,
  AdminAccountRow,
  AdminOverview,
  AdminUserRow,
  ModerationAction,
  ModerationActionRow,
  CompanyRollupEntry,
  FeatureUsageEntry,
  FlaggedAccountRow,
  FlaggedStatus,
  FunnelStats,
  LedgerEntry,
  ListRow,
  ListsActivity,
  PaginatedLedger,
  PaginatedLists,
  PaginatedModerationActions,
  PaginatedRuns,
  PaginatedTransactions,
  PaginatedUsers,
  PaymentRow,
  PaymentStatus,
  ProviderErrorTrendPoint,
  ProviderHealth,
  RunRow,
  RunStatus,
  RunsKpis,
  SubscriptionStatus,
  SystemHealth,
  TransactionsKpis,
  TrendPoint,
  TrendRunType,
  UseCaseBreakdownEntry,
  UserDetail,
  UsersKpis,
} from "./types.js";

const PAGE_SIZE = 1000;
const MAX_PAGES = 20; // still used by export page loops and email-search fallback

// Prefer SQL sum when we can express the filter as an RPC; otherwise page
// and reduce in JS. PostgREST `column.sum()` is intentionally avoided — many
// Supabase projects reject aggregate selects, which broke the overview KPIs.

async function sumColumnPaged(
  table: string,
  column: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  filters: (q: any) => any,
): Promise<number> {
  let total = 0;
  let from = 0;
  for (let page = 0; page < MAX_PAGES; page++) {
    const query = filters(supabaseAdmin.from(table).select(column).range(from, from + PAGE_SIZE - 1));
    const { data, error } = await query;
    if (error) throw error;
    const rows = (data ?? []) as Record<string, number>[];
    if (rows.length === 0) break;
    for (const row of rows) total += Number(row[column]) || 0;
    if (rows.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  return total;
}

async function distinctUserCount(
  table: "enrichment_runs" | "payments",
  filters: { statusEq?: string; sinceIso?: string },
): Promise<number> {
  if (table === "payments") {
    const { data, error } = await supabaseAdmin.rpc("fn_admin_distinct_paid_users");
    if (error) throw error;
    return Number(data) || 0;
  }
  const { data, error } = await supabaseAdmin.rpc("fn_admin_distinct_run_users", {
    p_since: filters.sinceIso ?? null,
  });
  if (error) throw error;
  return Number(data) || 0;
}

// idColumn defaults to "id" but some tables (credit_wallets) have no such
// column — their primary key is user_id — so it's overridable.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function headCount(table: string, build: (q: any) => any, idColumn = "id"): Promise<number> {
  const { count, error } = await build(supabaseAdmin.from(table).select(idColumn, { count: "exact", head: true }));
  if (error) throw error;
  return count ?? 0;
}

async function getOpenFlaggedCount(): Promise<number> {
  return headCount("flagged_accounts", (q) => q.eq("status", "open"));
}

async function totalSignups(): Promise<number> {
  // Only the GoTrue admin API knows about unconfirmed users at all —
  // profiles rows don't exist until email confirmation (see
  // 0003_auth_bootstrap.sql). perPage:1 just to read the `total` field
  // cheaply without pulling the user list.
  const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 1 });
  if (error) throw error;
  return "total" in data ? data.total : 0;
}

async function attachEmails<T extends { user_id: string }>(rows: T[]): Promise<(T & { email: string | null })[]> {
  if (rows.length === 0) return [];
  const ids = [...new Set(rows.map((r) => r.user_id))];
  const { data, error } = await supabaseAdmin.from("profiles").select("id, email").in("id", ids);
  if (error) throw error;
  const emailById = new Map((data ?? []).map((r) => [r.id as string, (r.email as string | null) ?? null]));
  return rows.map((row) => ({ ...row, email: emailById.get(row.user_id) ?? null }));
}

// Indexed substring search on the profiles.email mirror (synced from
// auth.users). Falls back to empty when the term is blank.
async function findUserIdsByEmailSubstring(term: string): Promise<Set<string>> {
  const needle = term.trim().toLowerCase();
  const ids = new Set<string>();
  if (!needle) return ids;

  const { data, error } = await supabaseAdmin
    .from("profiles")
    .select("id")
    .ilike("email", `%${needle}%`)
    .range(0, PAGE_SIZE - 1);
  if (error) throw error;
  for (const row of (data ?? []) as { id: string }[]) ids.add(row.id);
  return ids;
}

export async function getOverview(): Promise<AdminOverview> {
  const now = new Date();
  const monthStartIso = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  const since7dIso = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const since30dIso = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();

  const [totalSignupsCount, metricsResult] = await Promise.all([
    totalSignups(),
    supabaseAdmin.rpc("fn_admin_overview_metrics", {
      p_month_start: monthStartIso,
      p_since_7d: since7dIso,
      p_since_30d: since30dIso,
    }),
  ]);

  if (!metricsResult.error && metricsResult.data) {
    const m = metricsResult.data as Record<string, number>;
    return {
      users: {
        total_signups: totalSignupsCount,
        verified: Number(m.verified_profiles) || 0,
        onboarded: Number(m.onboarded_profiles) || 0,
      },
      revenue: {
        all_time_minor_units: Number(m.revenue_all_time_minor_units) || 0,
        month_to_date_minor_units: Number(m.revenue_mtd_minor_units) || 0,
        currency: "INR",
      },
      credits: {
        purchased: Number(m.wallet_purchased) || 0,
        consumed: Number(m.wallet_consumed) || 0,
        held: Number(m.wallet_held) || 0,
      },
      active_users: {
        last_7d: Number(m.active_users_7d) || 0,
        last_30d: Number(m.active_users_30d) || 0,
      },
    };
  }

  // Fallback when 0020 is not applied yet — never use PostgREST .sum().
  const [verifiedCount, onboardedCount, revenueAllTime, revenueMtd, walletPurchased, walletConsumed, walletHeld, active7d, active30d] =
    await Promise.all([
      headCount("profiles", (q) => q),
      headCount("profiles", (q) => q.not("company", "is", null)),
      sumColumnPaged("payments", "amount_minor_units", (q) => q.eq("status", "success")),
      sumColumnPaged("payments", "amount_minor_units", (q) =>
        q.eq("status", "success").gte("created_at", monthStartIso),
      ),
      sumColumnPaged("credit_wallets", "lifetime_purchased", (q) => q),
      sumColumnPaged("credit_wallets", "lifetime_consumed", (q) => q),
      sumColumnPaged("credit_wallets", "held_balance", (q) => q),
      distinctUserCount("enrichment_runs", { sinceIso: since7dIso }),
      distinctUserCount("enrichment_runs", { sinceIso: since30dIso }),
    ]);

  return {
    users: {
      total_signups: totalSignupsCount,
      verified: verifiedCount,
      onboarded: onboardedCount,
    },
    revenue: {
      all_time_minor_units: revenueAllTime,
      month_to_date_minor_units: revenueMtd,
      currency: "INR",
    },
    credits: {
      purchased: walletPurchased,
      consumed: walletConsumed,
      held: walletHeld,
    },
    active_users: {
      last_7d: active7d,
      last_30d: active30d,
    },
  };
}

const TREND_RUN_TYPES: TrendRunType[] = ["company_search", "people_search", "email_enrich", "mobile_enrich"];

async function forEachPage<T>(
  table: string,
  columns: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  applyFilters: (q: any) => any,
  onRow: (row: T) => void,
) {
  let from = 0;
  for (let page = 0; page < MAX_PAGES; page++) {
    const query = applyFilters(supabaseAdmin.from(table).select(columns).range(from, from + PAGE_SIZE - 1));
    const { data, error } = await query;
    if (error) throw error;
    const rows = (data ?? []) as T[];
    if (rows.length === 0) break;
    for (const row of rows) onRow(row);
    if (rows.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
}

export async function getTrends(days: number): Promise<TrendPoint[]> {
  const { data, error } = await supabaseAdmin.rpc("fn_admin_trends", { p_days: days });
  if (error) throw error;

  // jsonb RPCs usually return a parsed array; tolerate a JSON string just in case.
  const raw = typeof data === "string" ? (JSON.parse(data) as unknown) : data;
  const rows = Array.isArray(raw) ? (raw as TrendPoint[]) : [];

  return rows.map((row) => ({
    date: row.date,
    signups: Number(row.signups) || 0,
    revenue_minor_units: Number(row.revenue_minor_units) || 0,
    credits_consumed: {
      company_search: Number(row.credits_consumed?.company_search) || 0,
      people_search: Number(row.credits_consumed?.people_search) || 0,
      email_enrich: Number(row.credits_consumed?.email_enrich) || 0,
      mobile_enrich: Number(row.credits_consumed?.mobile_enrich) || 0,
    },
  }));
}

export async function getFunnel(): Promise<FunnelStats> {
  const [signedUp, verified, onboarded, firstSearch, paid] = await Promise.all([
    totalSignups(),
    headCount("profiles", (q) => q),
    headCount("profiles", (q) => q.not("company", "is", null)),
    distinctUserCount("enrichment_runs", {}),
    distinctUserCount("payments", { statusEq: "success" }),
  ]);

  return { signed_up: signedUp, verified, onboarded, first_search: firstSearch, paid };
}

const RUN_STATUSES: RunStatus[] = ["pending", "running", "completed", "cancelled", "failed"];

function emptyRunStatusCounts(): Record<RunStatus, number> {
  return { pending: 0, running: 0, completed: 0, cancelled: 0, failed: 0 };
}

// "Is the product actually working" — run outcomes and per-provider error
// rate/latency, aggregated in SQL (fn_admin_system_health) so we never scan
// enrichment_results into Node.
export async function getSystemHealth(days: number): Promise<SystemHealth> {
  const [{ data, error }, openFlaggedCount] = await Promise.all([
    supabaseAdmin.rpc("fn_admin_system_health", { p_days: days }),
    getOpenFlaggedCount(),
  ]);
  if (error) throw error;

  const payload = (data ?? {}) as {
    run_status_counts?: Record<string, number>;
    providers?: ProviderHealth[];
    provider_error_trend?: ProviderErrorTrendPoint[];
  };

  const runStatusCounts = emptyRunStatusCounts();
  for (const status of RUN_STATUSES) {
    runStatusCounts[status] = Number(payload.run_status_counts?.[status]) || 0;
  }

  const providers: ProviderHealth[] = (payload.providers ?? []).map((p) => ({
    provider: p.provider,
    total: Number(p.total) || 0,
    error_rate: Number(p.error_rate) || 0,
    avg_latency_ms: p.avg_latency_ms == null ? null : Number(p.avg_latency_ms),
  }));

  const providerErrorTrend: ProviderErrorTrendPoint[] = (payload.provider_error_trend ?? []).map((point) => ({
    date: point.date,
    rates: Object.fromEntries(
      Object.entries(point.rates ?? {}).map(([provider, rate]) => [provider, Number(rate) || 0]),
    ),
  }));

  return {
    run_status_counts: runStatusCounts,
    providers,
    provider_error_trend: providerErrorTrend,
    open_flagged_accounts: openFlaggedCount,
  };
}

interface ProfileWithWallet {
  id: string;
  email: string | null;
  company: string | null;
  created_at: string;
  account_status: AccountStatus;
  suspended_until: string | null;
  credit_wallets: {
    available_balance: number;
    held_balance: number;
    lifetime_purchased: number;
    lifetime_consumed: number;
  } | null;
}

const PROFILE_WITH_WALLET_SELECT =
  "id, email, company, created_at, account_status, suspended_until, credit_wallets(available_balance, held_balance, lifetime_purchased, lifetime_consumed)";

// Shared by getUsers and getAllUsersForExport (the export path scans every
// matching page instead of one) so both build the exact same row shape.
function toAdminUserRow(
  row: ProfileWithWallet,
  flaggedSet: Set<string>,
  subHint?: { plan_id: string; status: SubscriptionStatus } | null,
): AdminUserRow {
  return {
    user_id: row.id,
    email: row.email,
    company: row.company,
    onboarded: Boolean(row.company),
    created_at: row.created_at,
    available_balance: row.credit_wallets?.available_balance ?? 0,
    held_balance: row.credit_wallets?.held_balance ?? 0,
    lifetime_purchased: row.credit_wallets?.lifetime_purchased ?? 0,
    lifetime_consumed: row.credit_wallets?.lifetime_consumed ?? 0,
    is_flagged: flaggedSet.has(row.id),
    account_status: row.account_status ?? "active",
    suspended_until: row.suspended_until ?? null,
    plan_id: subHint?.plan_id ?? null,
    subscription_status: subHint?.status ?? null,
  };
}

async function getOpenFlaggedSetFor(userIds: string[]): Promise<Set<string>> {
  const { data, error } = userIds.length
    ? await supabaseAdmin.from("flagged_accounts").select("user_id").eq("status", "open").in("user_id", userIds)
    : { data: [] as { user_id: string }[], error: null };
  if (error) throw error;
  return new Set((data ?? []).map((r) => r.user_id));
}

interface GetUsersParams {
  page: number;
  pageSize: number;
  search?: string;
  status?: AccountStatus;
}

// No search: a plain DB-level paginated scan (cheap, index-friendly on
// created_at). With search: profiles.company is searchable in the DB, but
// email lives only in auth.users, so an email search first resolves a
// bounded id set via findUserIdsByEmailSubstring, unions it with the
// DB-level company match, and paginates that bounded set in JS — the same
// pattern this file already uses everywhere data isn't reachable via a
// single indexed Postgres query without a schema change. An optional
// account_status filter is applied at the DB level in either branch, and the
// total is derived from the filtered count so pagination stays accurate.
export async function getUsers({ page, pageSize, search, status }: GetUsersParams): Promise<PaginatedUsers> {
  const from = (page - 1) * pageSize;
  const trimmedSearch = search?.trim();

  let profileRows: ProfileWithWallet[];
  let total: number;

  if (trimmedSearch) {
    const [emailMatchIds, companyMatches] = await Promise.all([
      findUserIdsByEmailSubstring(trimmedSearch),
      supabaseAdmin.from("profiles").select("id").ilike("company", `%${trimmedSearch}%`).range(0, PAGE_SIZE - 1),
    ]);
    if (companyMatches.error) throw companyMatches.error;

    const idSet = new Set<string>(emailMatchIds);
    for (const row of (companyMatches.data ?? []) as { id: string }[]) idSet.add(row.id);

    if (idSet.size === 0) {
      return { rows: [], total: 0, page, page_size: pageSize };
    }

    // count:"exact" so the status filter (which can't be applied to the
    // in-memory idSet size) still yields a correct total.
    let query = supabaseAdmin
      .from("profiles")
      .select(PROFILE_WITH_WALLET_SELECT, { count: "exact" })
      .in("id", Array.from(idSet))
      .order("created_at", { ascending: false })
      .range(from, from + pageSize - 1);
    if (status) query = query.eq("account_status", status);

    const { data, error, count } = await query;
    if (error) throw error;
    profileRows = (data ?? []) as unknown as ProfileWithWallet[];
    total = count ?? 0;
  } else {
    let query = supabaseAdmin
      .from("profiles")
      .select(PROFILE_WITH_WALLET_SELECT, { count: "exact" })
      .order("created_at", { ascending: false })
      .range(from, from + pageSize - 1);
    if (status) query = query.eq("account_status", status);

    const { data, error, count } = await query;
    if (error) throw error;
    profileRows = (data ?? []) as unknown as ProfileWithWallet[];
    total = count ?? 0;
  }

  const userIds = profileRows.map((r) => r.id);
  const [flaggedSet, subHints] = await Promise.all([
    getOpenFlaggedSetFor(userIds),
    getSubscriptionHintsByUserIds(userIds),
  ]);
  const rows: AdminUserRow[] = profileRows.map((row) =>
    toAdminUserRow(row, flaggedSet, subHints.get(row.id) ?? null),
  );

  return { rows, total, page, page_size: pageSize };
}

// Same filtering as getUsers, but scans every matching page. Past
// MAX_EXPORT_ROWS this refuses outright instead of truncating — used only by
// the CSV export route.
export async function getAllUsersForExport(search?: string): Promise<AdminUserRow[]> {
  const trimmedSearch = search?.trim();
  let idFilter: string[] | null = null;

  if (trimmedSearch) {
    const [emailMatchIds, companyMatches] = await Promise.all([
      findUserIdsByEmailSubstring(trimmedSearch),
      supabaseAdmin.from("profiles").select("id").ilike("company", `%${trimmedSearch}%`).range(0, PAGE_SIZE - 1),
    ]);
    if (companyMatches.error) throw companyMatches.error;
    const idSet = new Set<string>(emailMatchIds);
    for (const row of (companyMatches.data ?? []) as { id: string }[]) idSet.add(row.id);
    idFilter = Array.from(idSet);
    if (idFilter.length === 0) return [];
  }

  const total = idFilter
    ? idFilter.length
    : await headCount("profiles", (q) => q);
  if (total > MAX_EXPORT_ROWS) throw new ExportTooLargeError(total);

  const profileRows: ProfileWithWallet[] = [];
  await forEachPage<ProfileWithWallet>(
    "profiles",
    PROFILE_WITH_WALLET_SELECT,
    (q) => (idFilter ? q.in("id", idFilter) : q),
    (row) => profileRows.push(row),
  );

  const userIds = profileRows.map((r) => r.id);
  const [flaggedSet, subHints] = await Promise.all([
    getOpenFlaggedSetFor(userIds),
    getSubscriptionHintsByUserIds(userIds),
  ]);
  return profileRows.map((row) => toAdminUserRow(row, flaggedSet, subHints.get(row.id) ?? null));
}

interface RawPaymentRow {
  id: string;
  user_id: string;
  status: string;
  gateway: string;
  gateway_payment_id: string | null;
  credits_promised: number;
  amount_minor_units: number;
  currency: string;
  created_at: string;
  updated_at: string;
  billing_intent: string | null;
  pack_id: string | null;
}

const PAYMENT_SELECT =
  "id, user_id, status, gateway, gateway_payment_id, credits_promised, amount_minor_units, currency, created_at, updated_at, billing_intent, pack_id";

interface GetTransactionsParams {
  page: number;
  pageSize: number;
  status?: PaymentStatus;
  search?: string;
}

// A dummy id that can never match a real user — used to force zero rows
// when a search resolves to an empty id set, rather than relying on
// PostgREST's edge-case behavior for `.in("user_id", [])`.
const NO_MATCH_USER_ID = "00000000-0000-0000-0000-000000000000";

type TransactionsFilter = { type: "ids"; ids: string[] } | { type: "ilike"; term: string } | { type: "none" };

// Search branches on shape: an "@" implies an email search (bounded id-set
// resolution via findUserIdsByEmailSubstring, same as getUsers), otherwise
// it's treated as a gateway_payment_id substring (DB-level ilike — payment/
// order ids don't need the bounded-scan path). Shared by getTransactions and
// getTransactionsKpis so both filter identically.
async function resolveTransactionsFilter(search?: string): Promise<TransactionsFilter> {
  const trimmed = search?.trim();
  if (!trimmed) return { type: "none" };
  if (trimmed.includes("@")) {
    const ids = await findUserIdsByEmailSubstring(trimmed);
    return { type: "ids", ids: Array.from(ids) };
  }
  return { type: "ilike", term: trimmed };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function applyTransactionsFilter(query: any, filter: TransactionsFilter): any {
  if (filter.type === "ids") {
    return filter.ids.length > 0 ? query.in("user_id", filter.ids) : query.eq("user_id", NO_MATCH_USER_ID);
  }
  if (filter.type === "ilike") {
    return query.ilike("gateway_payment_id", `%${filter.term}%`);
  }
  return query;
}

export async function getTransactions({
  page,
  pageSize,
  status,
  search,
}: GetTransactionsParams): Promise<PaginatedTransactions> {
  const from = (page - 1) * pageSize;
  const filter = await resolveTransactionsFilter(search);

  let query = applyTransactionsFilter(
    supabaseAdmin
      .from("payments")
      .select(PAYMENT_SELECT, { count: "exact" })
      .order("created_at", { ascending: false })
      .range(from, from + pageSize - 1),
    filter,
  );
  if (status) query = query.eq("status", status);

  const { data, error, count } = await query;
  if (error) throw error;
  const rows = (data ?? []) as RawPaymentRow[];

  const withEmails = await attachEmails(rows);
  const invoiceHints = await getInvoiceHintsByPaymentIds(rows.map((r) => r.id));
  const withInvoices: PaymentRow[] = withEmails.map((row) => {
    const hint = invoiceHints.get(row.id);
    return {
      ...row,
      billing_intent: row.billing_intent ?? null,
      pack_id: row.pack_id ?? null,
      invoice_id: hint?.invoice_id ?? null,
      invoice_number: hint?.invoice_number ?? null,
      receipt_number: hint?.receipt_number ?? null,
    };
  });
  return { rows: withInvoices, total: count ?? 0, page, page_size: pageSize };
}

// Same filtering as getTransactions, but scans every matching page. Past
// MAX_EXPORT_ROWS this refuses outright instead of truncating — used only by
// the CSV export route.
export async function getAllTransactionsForExport({
  status,
  search,
}: {
  status?: PaymentStatus;
  search?: string;
}): Promise<PaymentRow[]> {
  const filter = await resolveTransactionsFilter(search);
  const total = await headCount("payments", (q) => {
    const filtered = applyTransactionsFilter(q, filter);
    return status ? filtered.eq("status", status) : filtered;
  });
  if (total > MAX_EXPORT_ROWS) throw new ExportTooLargeError(total);

  const rows: RawPaymentRow[] = [];
  await forEachPage<RawPaymentRow>(
    "payments",
    PAYMENT_SELECT,
    (q) => {
      const filtered = applyTransactionsFilter(q, filter);
      return status ? filtered.eq("status", status) : filtered;
    },
    (row) => rows.push(row),
  );
  const withEmails = await attachEmails(rows);
  const invoiceHints = await getInvoiceHintsByPaymentIds(rows.map((r) => r.id));
  return withEmails.map((row) => {
    const hint = invoiceHints.get(row.id);
    return {
      ...row,
      billing_intent: row.billing_intent ?? null,
      pack_id: row.pack_id ?? null,
      invoice_id: hint?.invoice_id ?? null,
      invoice_number: hint?.invoice_number ?? null,
      receipt_number: hint?.receipt_number ?? null,
    };
  });
}

// Deliberately scoped by search only, not the status dropdown — filtering to
// "Failed" and then showing a success rate computed against that same
// filtered set would always read 0%. This answers "of everything matching
// this search, how's it breaking down," independent of which status tab is
// open in the table below.
export async function getTransactionsKpis({ search }: { search?: string }): Promise<TransactionsKpis> {
  const filter = await resolveTransactionsFilter(search);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const withFilter = (statusEq?: string) => (q: any) => {
    const filtered = applyTransactionsFilter(q, filter);
    return statusEq ? filtered.eq("status", statusEq) : filtered;
  };

  let revenueRpcArgs: { p_status: string; p_user_ids: string[] | null; p_gateway_ilike: string | null } = {
    p_status: "success",
    p_user_ids: null,
    p_gateway_ilike: null,
  };
  if (filter.type === "ids") {
    revenueRpcArgs = {
      p_status: "success",
      p_user_ids: filter.ids.length > 0 ? filter.ids : [NO_MATCH_USER_ID],
      p_gateway_ilike: null,
    };
  } else if (filter.type === "ilike") {
    revenueRpcArgs = { p_status: "success", p_user_ids: null, p_gateway_ilike: filter.term };
  }

  const [totalCount, successCount, failedCount, pendingCount, initiatedCount, revenueResult] = await Promise.all([
    headCount("payments", withFilter()),
    headCount("payments", withFilter("success")),
    headCount("payments", withFilter("failed")),
    headCount("payments", withFilter("pending")),
    headCount("payments", withFilter("initiated")),
    supabaseAdmin.rpc("fn_admin_sum_payment_amounts", revenueRpcArgs),
  ]);
  if (revenueResult.error) {
    // Fallback if migration 0020 is not applied yet.
    const revenue = await sumColumnPaged("payments", "amount_minor_units", withFilter("success"));
    return {
      total_count: totalCount,
      success_count: successCount,
      failed_count: failedCount,
      pending_count: pendingCount,
      initiated_count: initiatedCount,
      revenue_minor_units: revenue,
      avg_amount_minor_units: successCount > 0 ? Math.round(revenue / successCount) : 0,
      success_rate: totalCount > 0 ? successCount / totalCount : 0,
    };
  }

  const revenue = Number(revenueResult.data) || 0;

  return {
    total_count: totalCount,
    success_count: successCount,
    failed_count: failedCount,
    pending_count: pendingCount,
    initiated_count: initiatedCount,
    revenue_minor_units: revenue,
    avg_amount_minor_units: successCount > 0 ? Math.round(revenue / successCount) : 0,
    success_rate: totalCount > 0 ? successCount / totalCount : 0,
  };
}

export async function getUsersKpis(): Promise<UsersKpis> {
  const now = new Date();
  const since7dIso = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const monthStartIso = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

  const [totalUsers, newThisWeek, newThisMonth, onboardedCount, zeroBalanceCount, openFlaggedCount, consumedResult] =
    await Promise.all([
      headCount("profiles", (q) => q),
      headCount("profiles", (q) => q.gte("created_at", since7dIso)),
      headCount("profiles", (q) => q.gte("created_at", monthStartIso)),
      headCount("profiles", (q) => q.not("company", "is", null)),
      headCount("credit_wallets", (q) => q.eq("available_balance", 0), "user_id"),
      getOpenFlaggedCount(),
      supabaseAdmin.rpc("fn_admin_sum_wallet_lifetime_consumed"),
    ]);

  let lifetimeConsumedSum = Number(consumedResult.data) || 0;
  if (consumedResult.error) {
    lifetimeConsumedSum = await sumColumnPaged("credit_wallets", "lifetime_consumed", (q) => q);
  }

  return {
    total_users: totalUsers,
    new_this_week: newThisWeek,
    new_this_month: newThisMonth,
    onboarded_pct: totalUsers > 0 ? onboardedCount / totalUsers : 0,
    zero_balance_count: zeroBalanceCount,
    open_flagged_count: openFlaggedCount,
    avg_lifetime_consumed: totalUsers > 0 ? Math.round(lifetimeConsumedSum / totalUsers) : 0,
  };
}

export async function getFeatureUsage(days: number): Promise<FeatureUsageEntry[]> {
  const { data, error } = await supabaseAdmin.rpc("fn_admin_feature_usage", { p_days: days });
  if (error) throw error;
  const raw = typeof data === "string" ? (JSON.parse(data) as unknown) : data;
  const rows = Array.isArray(raw) ? (raw as FeatureUsageEntry[]) : [];
  const byType = new Map(rows.map((r) => [r.run_type, Number(r.credits) || 0]));
  return TREND_RUN_TYPES.map((run_type) => ({ run_type, credits: byType.get(run_type) ?? 0 }));
}

export async function getListsActivity(): Promise<ListsActivity> {
  const since7dIso = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const [totalLists, totalListItems, listsThisWeek] = await Promise.all([
    headCount("lists", (q) => q),
    headCount("list_items", (q) => q),
    headCount("lists", (q) => q.gte("created_at", since7dIso)),
  ]);

  return {
    total_lists: totalLists,
    total_list_items: totalListItems,
    lists_this_week: listsThisWeek,
    avg_list_size: totalLists > 0 ? Math.round((totalListItems / totalLists) * 10) / 10 : 0,
  };
}

export async function getUseCaseBreakdown(): Promise<UseCaseBreakdownEntry[]> {
  const { data, error } = await supabaseAdmin.rpc("fn_admin_use_case_breakdown");
  if (error) throw error;
  const raw = typeof data === "string" ? (JSON.parse(data) as unknown) : data;
  const rows = Array.isArray(raw) ? (raw as UseCaseBreakdownEntry[]) : [];
  return rows
    .map((r) => ({ use_case: r.use_case, count: Number(r.count) || 0 }))
    .sort((a, b) => b.count - a.count);
}

const USER_DETAIL_SELECT =
  "id, email, company, role, use_case, created_at, account_status, suspended_until, status_reason, credit_wallets(available_balance, held_balance, lifetime_purchased, lifetime_consumed)";

interface ProfileDetailRow extends ProfileWithWallet {
  role: string | null;
  use_case: string | null;
  status_reason: string | null;
}

// Returns null when the id doesn't match any profile (unconfirmed signups
// and non-existent ids both look like this — the route turns it into 404).
export async function getUserDetail(userId: string): Promise<UserDetail | null> {
  const { data: profile, error: profileError } = await supabaseAdmin
    .from("profiles")
    .select(USER_DETAIL_SELECT)
    .eq("id", userId)
    .maybeSingle();
  if (profileError) throw profileError;
  if (!profile) return null;

  const typedProfile = profile as unknown as ProfileDetailRow;

  // Nested lists are capped previews (+ totals). Moderation history is a
  // separate paginated endpoint — same pattern as the credit ledger.
  const [openFlagResult, flagsTotal, listResult, listsTotal, paymentResult, paymentsTotal, billing] =
    await Promise.all([
      supabaseAdmin
        .from("flagged_accounts")
        .select("id, reason, source, status, created_at, reviewed_at, reviewed_by")
        .eq("user_id", userId)
        .eq("status", "open")
        .order("created_at", { ascending: false })
        .limit(50),
      headCount("flagged_accounts", (q) => q.eq("user_id", userId)),
      supabaseAdmin
        .from("lists")
        .select("id, name, kind, created_at")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(20),
      headCount("lists", (q) => q.eq("user_id", userId)),
      supabaseAdmin
        .from("payments")
        .select(PAYMENT_SELECT)
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(20),
      headCount("payments", (q) => q.eq("user_id", userId)),
      fetchUserBillingBundle(userId),
    ]);

  if (openFlagResult.error) throw openFlagResult.error;
  if (listResult.error) throw listResult.error;
  if (paymentResult.error) throw paymentResult.error;

  const email = typedProfile.email;
  const wallet = typedProfile.credit_wallets;
  const flags = (openFlagResult.data ?? []) as FlaggedAccountRow[];

  const user: AdminUserRow = {
    user_id: typedProfile.id,
    email,
    company: typedProfile.company,
    onboarded: Boolean(typedProfile.company),
    created_at: typedProfile.created_at,
    available_balance: wallet?.available_balance ?? 0,
    held_balance: wallet?.held_balance ?? 0,
    lifetime_purchased: wallet?.lifetime_purchased ?? 0,
    lifetime_consumed: wallet?.lifetime_consumed ?? 0,
    is_flagged: flags.length > 0,
    account_status: typedProfile.account_status ?? "active",
    suspended_until: typedProfile.suspended_until ?? null,
    plan_id: billing.subscription?.plan_id ?? null,
    subscription_status: billing.subscription?.status ?? null,
  };

  // All rows here belong to the one user already looked up above — no need
  // to pay for attachEmails' per-row getUserById lookups.
  const rawPayments = (paymentResult.data ?? []) as RawPaymentRow[];
  const invoiceHints = await getInvoiceHintsByPaymentIds(rawPayments.map((p) => p.id));
  const payments: PaymentRow[] = rawPayments.map((p) => {
    const hint = invoiceHints.get(p.id);
    return {
      ...p,
      email,
      billing_intent: p.billing_intent ?? null,
      pack_id: p.pack_id ?? null,
      invoice_id: hint?.invoice_id ?? null,
      invoice_number: hint?.invoice_number ?? null,
      receipt_number: hint?.receipt_number ?? null,
    };
  });

  return {
    user,
    role: typedProfile.role,
    use_case: typedProfile.use_case,
    status_reason: typedProfile.status_reason,
    flags,
    flags_total: flagsTotal,
    lists: (listResult.data ?? []) as { id: string; name: string; kind: string; created_at: string }[],
    lists_total: listsTotal,
    payments,
    payments_total: paymentsTotal,
    subscription: billing.subscription,
    billing_profile: billing.billing_profile,
    invoices: billing.invoices,
    invoices_total: billing.invoices_total,
  };
}

// Resolves acted_by ids to admin emails for the moderation history display.
// De-duplicates lookups so a user with many actions from the same admin
// costs one getUserById per distinct admin, not one per row.
async function resolveActorEmails(
  rows: Omit<ModerationActionRow, "acted_by_email">[],
): Promise<ModerationActionRow[]> {
  const actorIds = [...new Set(rows.map((r) => r.acted_by).filter((id): id is string => Boolean(id)))];
  const emailByActor = new Map<string, string | null>();
  if (actorIds.length > 0) {
    const { data, error } = await supabaseAdmin.from("profiles").select("id, email").in("id", actorIds);
    if (error) throw error;
    for (const row of (data ?? []) as { id: string; email: string | null }[]) {
      emailByActor.set(row.id, row.email);
    }
  }
  return rows.map((r) => ({ ...r, acted_by_email: r.acted_by ? emailByActor.get(r.acted_by) ?? null : null }));
}

interface GetUserLedgerParams {
  page: number;
  pageSize: number;
}

// Ordered by id (bigserial, append-only) rather than created_at — a stable,
// tie-free order for rows that can share the same millisecond timestamp.
export async function getUserLedger(userId: string, { page, pageSize }: GetUserLedgerParams): Promise<PaginatedLedger> {
  const from = (page - 1) * pageSize;

  const { data, error, count } = await supabaseAdmin
    .from("credit_ledger")
    .select("id, type, amount, reference_id, row_reference, reason_code, balance_after, created_at", {
      count: "exact",
    })
    .eq("user_id", userId)
    .order("id", { ascending: false })
    .range(from, from + pageSize - 1);
  if (error) throw error;

  return { rows: (data ?? []) as LedgerEntry[], total: count ?? 0, page, page_size: pageSize };
}

export async function getUserModerationActions(
  userId: string,
  { page, pageSize }: GetUserLedgerParams,
): Promise<PaginatedModerationActions> {
  const from = (page - 1) * pageSize;

  const { data, error, count } = await supabaseAdmin
    .from("moderation_actions")
    .select("id, action, previous_status, new_status, reason, suspended_until, acted_by, created_at", {
      count: "exact",
    })
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .range(from, from + pageSize - 1);
  if (error) throw error;

  const rows = await resolveActorEmails((data ?? []) as Omit<ModerationActionRow, "acted_by_email">[]);
  return { rows, total: count ?? 0, page, page_size: pageSize };
}

// Closes a flag — only 'reviewed' or 'dismissed' are accepted targets (the
// route enforces this before calling in); reopening a closed flag isn't a
// workflow this covers.
export async function reviewFlaggedAccount(
  flaggedAccountId: string,
  params: { status: Extract<FlaggedStatus, "reviewed" | "dismissed">; reviewedBy: string },
): Promise<void> {
  const { error } = await supabaseAdmin
    .from("flagged_accounts")
    .update({ status: params.status, reviewed_at: new Date().toISOString(), reviewed_by: params.reviewedBy })
    .eq("id", flaggedAccountId);
  if (error) throw error;
}

export type SetUserStatusResult =
  | { ok: false; reason: "not_found" | "target_is_admin" }
  | { ok: true; previous_status: AccountStatus; new_status: AccountStatus };

const ACTION_TO_STATUS: Record<ModerationAction, AccountStatus> = {
  freeze: "frozen",
  suspend: "suspended",
  ban: "banned",
  reactivate: "active",
};

// The single path for changing a user's moderation status. Ordering is
// deliberate:
//   1. read current status + is_admin  (existence check, admin guard, and the
//      previous_status recorded in the audit row)
//   2. update profiles                 (the source of truth every enforcement
//      layer reads)
//   3. write the audit row
//
// NO AUTH-LAYER BAN. Until migration 0009 this function also called GoTrue's
// admin.updateUserById({ ban_duration }) so a banned user could not sign in at
// all. That was removed deliberately: a banned user must be able to log in to
// reach the support system and appeal, which is impossible if authentication
// itself is refused.
//
// Ban is not weaker for it, it moved down a layer. 'banned' is now enforced by
//   - enforceAccountStatus on every product API route, and
//   - the account_can_write() RESTRICTIVE policies from 0009, which block the
//     direct browser-to-Postgres writes to lists/list_items that never touch
//     Express at all.
// The second of those is strictly better coverage than the GoTrue ban ever
// gave us: it applies to a path the middleware could not see, and it is
// permanent rather than lapsing when a token happens to expire.
export async function setUserAccountStatus(params: {
  userId: string;
  action: ModerationAction;
  reason: string | null;
  suspendedUntil: string | null;
  actedBy: string;
}): Promise<SetUserStatusResult> {
  const { userId, action, reason, suspendedUntil, actedBy } = params;

  const { data: current, error: readError } = await supabaseAdmin
    .from("profiles")
    .select("account_status, is_admin")
    .eq("id", userId)
    .maybeSingle();
  if (readError) throw readError;
  if (!current) return { ok: false, reason: "not_found" };
  // An admin can never be moderated through this path — demotion is a
  // separate, service-role-only concern (prevent_is_admin_self_escalation).
  if (current.is_admin) return { ok: false, reason: "target_is_admin" };

  const previousStatus = (current.account_status ?? "active") as AccountStatus;
  const newStatus = ACTION_TO_STATUS[action];
  const until = action === "suspend" ? suspendedUntil : null;

  const { error: updateError } = await supabaseAdmin
    .from("profiles")
    .update({
      account_status: newStatus,
      status_reason: action === "reactivate" ? null : reason,
      suspended_until: until,
      status_updated_at: new Date().toISOString(),
      status_updated_by: actedBy,
    })
    .eq("id", userId);
  if (updateError) throw updateError;

  const { error: auditError } = await supabaseAdmin.from("moderation_actions").insert({
    user_id: userId,
    action,
    previous_status: previousStatus,
    new_status: newStatus,
    reason,
    suspended_until: until,
    acted_by: actedBy,
  });
  if (auditError) throw auditError;

  return { ok: true, previous_status: previousStatus, new_status: newStatus };
}

// Hard ceiling per grant call. Monthly packs are 4k–20k; 50k leaves headroom
// for multi-pack goodwill without letting a typo grant millions.
export const MAX_ADMIN_CREDIT_GRANT = 50_000;
export const MIN_ADMIN_CREDIT_GRANT_REASON_LENGTH = 5;

export type GrantUserCreditsResult =
  | { ok: false; reason: "not_found" | "wallet_not_found" }
  | { ok: true; available_balance: number; reference_id: string; amount: number };

// Grant-only credit compensation. Wallet mutation goes through
// fn_admin_adjust_credits (admin_adjustment ledger row). Audit free-text +
// acted_by live in admin_credit_adjustments. Does not touch lifetime_purchased,
// held_balance, or subscriptions.
export async function grantUserCredits(params: {
  userId: string;
  amount: number;
  reason: string;
  reasonCode: string;
  actedBy: string;
  referenceId: string;
}): Promise<GrantUserCreditsResult> {
  const { userId, amount, reason, reasonCode, actedBy, referenceId } = params;

  const { data: profile, error: profileError } = await supabaseAdmin
    .from("profiles")
    .select("id")
    .eq("id", userId)
    .maybeSingle();
  if (profileError) throw profileError;
  if (!profile) return { ok: false, reason: "not_found" };

  const { data: wallet, error: walletError } = await supabaseAdmin
    .from("credit_wallets")
    .select("user_id")
    .eq("user_id", userId)
    .maybeSingle();
  if (walletError) throw walletError;
  if (!wallet) return { ok: false, reason: "wallet_not_found" };

  const { data: balanceAfter, error: rpcError } = await supabaseAdmin.rpc("fn_admin_adjust_credits", {
    p_user_id: userId,
    p_amount: amount,
    p_reference_id: referenceId,
    p_reason_code: reasonCode,
  });
  if (rpcError) throw rpcError;

  const availableBalance = typeof balanceAfter === "number" ? balanceAfter : Number(balanceAfter);
  if (!Number.isFinite(availableBalance)) {
    throw new Error("fn_admin_adjust_credits returned a non-numeric balance");
  }

  const { error: auditError } = await supabaseAdmin.from("admin_credit_adjustments").insert({
    user_id: userId,
    amount,
    reason,
    reason_code: reasonCode,
    reference_id: referenceId,
    balance_after: availableBalance,
    acted_by: actedBy,
  });
  if (auditError) {
    // Unique violation on reference_id means a retry after the RPC succeeded —
    // treat as success rather than failing the grant the user already received.
    if (auditError.code !== "23505") throw auditError;
  }

  return {
    ok: true,
    available_balance: availableBalance,
    reference_id: referenceId,
    amount,
  };
}

// ── v4: runs monitor, lists browser, company rollup, admins ──

const RUN_SELECT =
  "id, user_id, list_id, run_type, status, requested_count, delivered_count, credits_held, credits_charged, credits_released, created_at, completed_at";

interface GetRunsParams {
  page: number;
  pageSize: number;
  status?: RunStatus;
  search?: string;
}

export async function getRuns({ page, pageSize, status, search }: GetRunsParams): Promise<PaginatedRuns> {
  const from = (page - 1) * pageSize;
  const trimmedSearch = search?.trim();

  let query = supabaseAdmin
    .from("enrichment_runs")
    .select(RUN_SELECT, { count: "exact" })
    .order("created_at", { ascending: false })
    .range(from, from + pageSize - 1);
  if (status) query = query.eq("status", status);
  if (trimmedSearch) {
    const ids = await findUserIdsByEmailSubstring(trimmedSearch);
    query = ids.size > 0 ? query.in("user_id", Array.from(ids)) : query.eq("user_id", NO_MATCH_USER_ID);
  }

  const { data, error, count } = await query;
  if (error) throw error;
  const rows = (data ?? []) as Omit<RunRow, "email">[];
  const withEmails = await attachEmails(rows);
  return { rows: withEmails as RunRow[], total: count ?? 0, page, page_size: pageSize };
}

// "What's broken right now" — pending/running runs stuck past a generous
// 1-hour window is the actionable signal; failed/completed/total-today give
// the daily throughput context around it.
export async function getRunsKpis(): Promise<RunsKpis> {
  const now = new Date();
  const oneHourAgoIso = new Date(now.getTime() - 60 * 60 * 1000).toISOString();
  const todayStartIso = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();

  const [stuckCount, failedToday, completedToday, totalToday] = await Promise.all([
    headCount("enrichment_runs", (q) => q.in("status", ["pending", "running"]).lt("created_at", oneHourAgoIso)),
    headCount("enrichment_runs", (q) => q.eq("status", "failed").gte("created_at", todayStartIso)),
    headCount("enrichment_runs", (q) => q.eq("status", "completed").gte("created_at", todayStartIso)),
    headCount("enrichment_runs", (q) => q.gte("created_at", todayStartIso)),
  ]);

  return { stuck_count: stuckCount, failed_today: failedToday, completed_today: completedToday, total_today: totalToday };
}

interface RawListRow {
  id: string;
  name: string;
  kind: string;
  created_at: string;
  user_id: string;
  list_items: { count: number }[];
}

const LIST_SELECT = "id, name, kind, created_at, user_id, list_items(count)";

interface GetListsParams {
  page: number;
  pageSize: number;
  search?: string;
  userId?: string;
}

// search branches like transactions: "@" implies an owner-email search
// (bounded id-set resolution), otherwise a DB-level ilike on the list name.
// list_items(count) is Postgrest's embedded-aggregate syntax — one row's
// item count comes back in the same query instead of N extra head-counts.
// When userId is set (drilling into one user's lists from their detail
// page), it's applied directly and the email-search branch is skipped
// entirely — there's no need to resolve owner ids when the owner is
// already known.
export async function getLists({ page, pageSize, search, userId }: GetListsParams): Promise<PaginatedLists> {
  const from = (page - 1) * pageSize;
  const trimmedSearch = search?.trim();

  let query = supabaseAdmin
    .from("lists")
    .select(LIST_SELECT, { count: "exact" })
    .order("created_at", { ascending: false })
    .range(from, from + pageSize - 1);

  if (userId) {
    query = query.eq("user_id", userId);
    if (trimmedSearch) query = query.ilike("name", `%${trimmedSearch}%`);
  } else if (trimmedSearch?.includes("@")) {
    const ids = await findUserIdsByEmailSubstring(trimmedSearch);
    query = ids.size > 0 ? query.in("user_id", Array.from(ids)) : query.eq("user_id", NO_MATCH_USER_ID);
  } else if (trimmedSearch) {
    query = query.ilike("name", `%${trimmedSearch}%`);
  }

  const { data, error, count } = await query;
  if (error) throw error;
  const rows = (data ?? []) as unknown as RawListRow[];
  const withEmails = await attachEmails(rows);

  return {
    rows: withEmails.map((r) => ({
      id: r.id,
      name: r.name,
      kind: r.kind,
      created_at: r.created_at,
      item_count: r.list_items?.[0]?.count ?? 0,
      owner_user_id: r.user_id,
      owner_email: r.email,
    })),
    total: count ?? 0,
    page,
    page_size: pageSize,
  };
}

export async function getTopCompanies(limit = 10): Promise<CompanyRollupEntry[]> {
  const { data, error } = await supabaseAdmin.rpc("fn_admin_top_companies", {
    p_limit: Math.min(Math.max(limit, 1), 50),
  });
  if (error) throw error;
  const raw = typeof data === "string" ? (JSON.parse(data) as unknown) : data;
  const rows = Array.isArray(raw) ? (raw as CompanyRollupEntry[]) : [];
  return rows.map((r) => ({
    company: r.company,
    user_count: Number(r.user_count) || 0,
    lifetime_purchased: Number(r.lifetime_purchased) || 0,
    lifetime_consumed: Number(r.lifetime_consumed) || 0,
    revenue_minor_units: Number(r.revenue_minor_units) || 0,
  }));
}

// Read-only visibility into who currently holds is_admin — granting/revoking
// stays service-role-only (prevent_is_admin_self_escalation), this is just a
// "who has this power" sanity check. The table is bounded by definition.
export async function getAdmins(): Promise<AdminAccountRow[]> {
  const { data, error } = await supabaseAdmin
    .from("profiles")
    .select("id, email, created_at")
    .eq("is_admin", true)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return ((data ?? []) as { id: string; email: string | null; created_at: string }[]).map((r) => ({
    user_id: r.id,
    email: r.email,
    created_at: r.created_at,
  }));
}
