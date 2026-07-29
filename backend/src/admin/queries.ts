import { supabaseAdmin } from "../lib/supabaseAdmin.js";
import { fetchUserBillingBundle, getSubscriptionHintsByUserIds } from "./billingQueries.js";
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
const MAX_PAGES = 20; // bounds every paginated scan to 20k rows — see note below

// No schema changes were made for this feature, so there are no SQL
// sum()/count(distinct) aggregates to call — these helpers page through raw
// rows and reduce in JS, bounded by MAX_PAGES so no admin endpoint can be
// made to pull an unbounded table. Fine at current data volume; if this ever
// gets slow, the fix is moving these into SQL views/RPCs (a DB change,
// intentionally out of scope here). Filter callbacks are typed `any` to
// match the rest of this codebase, which doesn't use generated Supabase
// Database types anywhere (see supabaseAdmin.ts) — the alternative is
// fighting postgrest-js's chained generics for no real type-safety gain.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function sumColumn(table: string, column: string, filters: (q: any) => any): Promise<number> {
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
  const seen = new Set<string>();
  let from = 0;
  for (let page = 0; page < MAX_PAGES; page++) {
    let query = supabaseAdmin.from(table).select("user_id").range(from, from + PAGE_SIZE - 1);
    if (filters.statusEq) query = query.eq("status", filters.statusEq);
    if (filters.sinceIso) query = query.gte("created_at", filters.sinceIso);
    const { data, error } = await query;
    if (error) throw error;
    const rows = (data ?? []) as { user_id: string }[];
    if (rows.length === 0) break;
    for (const row of rows) seen.add(row.user_id);
    if (rows.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  return seen.size;
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
  return Promise.all(
    rows.map(async (row) => {
      const { data } = await supabaseAdmin.auth.admin.getUserById(row.user_id);
      return { ...row, email: data.user?.email ?? null };
    }),
  );
}

// Bounded scan over the GoTrue admin user list (same MAX_PAGES/PAGE_SIZE
// bound as every other scan here) — profiles/payments don't store email, so
// any email-substring search has to go through auth.admin.listUsers. Shared
// by getUsers and getTransactions.
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

export async function getOverview(): Promise<AdminOverview> {
  const now = new Date();
  const monthStartIso = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  const since7dIso = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const since30dIso = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();

  const [
    totalSignupsCount,
    verifiedCount,
    onboardedCount,
    revenueAllTime,
    revenueMtd,
    walletPurchased,
    walletConsumed,
    walletHeld,
    active7d,
    active30d,
  ] = await Promise.all([
    totalSignups(),
    headCount("profiles", (q) => q),
    headCount("profiles", (q) => q.not("company", "is", null)),
    sumColumn("payments", "amount_minor_units", (q) => q.eq("status", "success")),
    sumColumn("payments", "amount_minor_units", (q) => q.eq("status", "success").gte("created_at", monthStartIso)),
    sumColumn("credit_wallets", "lifetime_purchased", (q) => q),
    sumColumn("credit_wallets", "lifetime_consumed", (q) => q),
    sumColumn("credit_wallets", "held_balance", (q) => q),
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

function emptyCreditsByType(): Record<TrendRunType, number> {
  return { company_search: 0, people_search: 0, email_enrich: 0, mobile_enrich: 0 };
}

function dayKey(iso: string): string {
  return iso.slice(0, 10);
}

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
  const now = new Date();
  const sinceDate = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  const sinceIso = sinceDate.toISOString();

  const byDay = new Map<string, TrendPoint>();
  for (let i = 0; i <= days; i++) {
    const d = new Date(sinceDate.getTime() + i * 24 * 60 * 60 * 1000);
    const key = dayKey(d.toISOString());
    byDay.set(key, { date: key, signups: 0, revenue_minor_units: 0, credits_consumed: emptyCreditsByType() });
  }

  await Promise.all([
    forEachPage<{ created_at: string }>(
      "profiles",
      "created_at",
      (q) => q.gte("created_at", sinceIso),
      (row) => {
        const point = byDay.get(dayKey(row.created_at));
        if (point) point.signups += 1;
      },
    ),
    forEachPage<{ created_at: string; amount_minor_units: number }>(
      "payments",
      "created_at, amount_minor_units",
      (q) => q.eq("status", "success").gte("created_at", sinceIso),
      (row) => {
        const point = byDay.get(dayKey(row.created_at));
        if (point) point.revenue_minor_units += row.amount_minor_units;
      },
    ),
    forEachPage<{ completed_at: string | null; run_type: string; credits_charged: number }>(
      "enrichment_runs",
      "completed_at, run_type, credits_charged",
      (q) => q.not("completed_at", "is", null).gte("completed_at", sinceIso),
      (row) => {
        if (!row.completed_at) return;
        const point = byDay.get(dayKey(row.completed_at));
        if (point && TREND_RUN_TYPES.includes(row.run_type as TrendRunType)) {
          point.credits_consumed[row.run_type as TrendRunType] += row.credits_charged;
        }
      },
    ),
  ]);

  return Array.from(byDay.values()).sort((a, b) => a.date.localeCompare(b.date));
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

const PROVIDER_TREND_TOP_N = 4;

// "Is the product actually working" — run outcomes (stuck/failing runs) and
// per-provider error rate/latency (which upstream n8n webhook is degraded),
// both derived from columns that already exist for exactly this purpose
// (enrichment_runs.status, enrichment_results.provider/outcome/latency_ms)
// but that nothing reads today. The enrichment_results scan also buckets by
// day in the same pass (not a second query) so the response carries a trend,
// not just a point-in-time snapshot — only the top-N providers by volume
// keep their daily series, to keep the response small.
export async function getSystemHealth(days: number): Promise<SystemHealth> {
  const now = new Date();
  const sinceDate = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  const sinceIso = sinceDate.toISOString();

  const runStatusCounts = emptyRunStatusCounts();
  const providerAgg = new Map<string, { total: number; errors: number; latencySum: number; latencyCount: number }>();
  const byDayProvider = new Map<string, Map<string, { total: number; errors: number }>>();

  const [, , openFlaggedCount] = await Promise.all([
    forEachPage<{ status: string }>(
      "enrichment_runs",
      "status",
      (q) => q.gte("created_at", sinceIso),
      (row) => {
        if (RUN_STATUSES.includes(row.status as RunStatus)) {
          runStatusCounts[row.status as RunStatus] += 1;
        }
      },
    ),
    forEachPage<{ provider: string; outcome: string; latency_ms: number | null; created_at: string }>(
      "enrichment_results",
      "provider, outcome, latency_ms, created_at",
      (q) => q.gte("created_at", sinceIso),
      (row) => {
        const agg = providerAgg.get(row.provider) ?? { total: 0, errors: 0, latencySum: 0, latencyCount: 0 };
        agg.total += 1;
        if (row.outcome === "error") agg.errors += 1;
        if (typeof row.latency_ms === "number") {
          agg.latencySum += row.latency_ms;
          agg.latencyCount += 1;
        }
        providerAgg.set(row.provider, agg);

        const day = dayKey(row.created_at);
        const dayMap = byDayProvider.get(day) ?? new Map<string, { total: number; errors: number }>();
        const dayAgg = dayMap.get(row.provider) ?? { total: 0, errors: 0 };
        dayAgg.total += 1;
        if (row.outcome === "error") dayAgg.errors += 1;
        dayMap.set(row.provider, dayAgg);
        byDayProvider.set(day, dayMap);
      },
    ),
    getOpenFlaggedCount(),
  ]);

  const providers: ProviderHealth[] = Array.from(providerAgg.entries())
    .map(([provider, agg]) => ({
      provider,
      total: agg.total,
      error_rate: agg.total > 0 ? agg.errors / agg.total : 0,
      avg_latency_ms: agg.latencyCount > 0 ? Math.round(agg.latencySum / agg.latencyCount) : null,
    }))
    .sort((a, b) => b.total - a.total);

  const topProviders = new Set(providers.slice(0, PROVIDER_TREND_TOP_N).map((p) => p.provider));

  const providerErrorTrend: ProviderErrorTrendPoint[] = [];
  for (let i = 0; i <= days; i++) {
    const d = new Date(sinceDate.getTime() + i * 24 * 60 * 60 * 1000);
    const key = dayKey(d.toISOString());
    const dayMap = byDayProvider.get(key);
    const rates: Record<string, number> = {};
    for (const provider of topProviders) {
      const agg = dayMap?.get(provider);
      rates[provider] = agg && agg.total > 0 ? agg.errors / agg.total : 0;
    }
    providerErrorTrend.push({ date: key, rates });
  }

  return {
    run_status_counts: runStatusCounts,
    providers,
    provider_error_trend: providerErrorTrend,
    open_flagged_accounts: openFlaggedCount,
  };
}

interface ProfileWithWallet {
  id: string;
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
  "id, company, created_at, account_status, suspended_until, credit_wallets(available_balance, held_balance, lifetime_purchased, lifetime_consumed)";

// Shared by getUsers and getAllUsersForExport (the export path scans every
// matching page instead of one) so both build the exact same row shape.
function toAdminUserRow(
  row: ProfileWithWallet & { email: string | null },
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
  const withEmails = await attachEmails(profileRows.map((r) => ({ ...r, user_id: r.id })));
  const rows: AdminUserRow[] = withEmails.map((row) =>
    toAdminUserRow(row, flaggedSet, subHints.get(row.id) ?? null),
  );

  return { rows, total, page, page_size: pageSize };
}

// Same filtering as getUsers, but scans every matching page (bounded by
// MAX_PAGES, same 20k-row cap as every other unbounded scan in this file)
// instead of one — used only by the CSV export route.
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
  const withEmails = await attachEmails(profileRows.map((r) => ({ ...r, user_id: r.id })));
  return withEmails.map((row) => toAdminUserRow(row, flaggedSet, subHints.get(row.id) ?? null));
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
  return { rows: withEmails as PaymentRow[], total: count ?? 0, page, page_size: pageSize };
}

// Same filtering as getTransactions, but scans every matching page (bounded
// by MAX_PAGES) instead of one — used only by the CSV export route.
export async function getAllTransactionsForExport({
  status,
  search,
}: {
  status?: PaymentStatus;
  search?: string;
}): Promise<PaymentRow[]> {
  const filter = await resolveTransactionsFilter(search);
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
  return (await attachEmails(rows)) as PaymentRow[];
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

  const [totalCount, successCount, failedCount, pendingCount, initiatedCount, revenue] = await Promise.all([
    headCount("payments", withFilter()),
    headCount("payments", withFilter("success")),
    headCount("payments", withFilter("failed")),
    headCount("payments", withFilter("pending")),
    headCount("payments", withFilter("initiated")),
    sumColumn("payments", "amount_minor_units", withFilter("success")),
  ]);

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

  const [totalUsers, newThisWeek, newThisMonth, onboardedCount, zeroBalanceCount, openFlaggedCount, lifetimeConsumedSum] =
    await Promise.all([
      headCount("profiles", (q) => q),
      headCount("profiles", (q) => q.gte("created_at", since7dIso)),
      headCount("profiles", (q) => q.gte("created_at", monthStartIso)),
      headCount("profiles", (q) => q.not("company", "is", null)),
      headCount("credit_wallets", (q) => q.eq("available_balance", 0), "user_id"),
      getOpenFlaggedCount(),
      sumColumn("credit_wallets", "lifetime_consumed", (q) => q),
    ]);

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
  const sinceIso = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const totals = emptyCreditsByType();

  await forEachPage<{ run_type: string; credits_charged: number }>(
    "enrichment_runs",
    "run_type, credits_charged",
    (q) => q.not("completed_at", "is", null).gte("completed_at", sinceIso),
    (row) => {
      if (TREND_RUN_TYPES.includes(row.run_type as TrendRunType)) {
        totals[row.run_type as TrendRunType] += row.credits_charged;
      }
    },
  );

  return TREND_RUN_TYPES.map((run_type) => ({ run_type, credits: totals[run_type] }));
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
  const counts = new Map<string, number>();

  await forEachPage<{ use_case: string | null }>(
    "profiles",
    "use_case",
    (q) => q,
    (row) => {
      const key = row.use_case?.trim() || "Not set";
      counts.set(key, (counts.get(key) ?? 0) + 1);
    },
  );

  return Array.from(counts.entries())
    .map(([use_case, count]) => ({ use_case, count }))
    .sort((a, b) => b.count - a.count);
}

const USER_DETAIL_SELECT =
  "id, company, role, use_case, created_at, account_status, suspended_until, status_reason, credit_wallets(available_balance, held_balance, lifetime_purchased, lifetime_consumed)";

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

  const [flagResult, moderationResult, listResult, listsTotal, paymentResult, paymentsTotal, emailResult, billing] =
    await Promise.all([
      supabaseAdmin
        .from("flagged_accounts")
        .select("id, reason, source, status, created_at, reviewed_at, reviewed_by")
        .eq("user_id", userId)
        .order("created_at", { ascending: false }),
      supabaseAdmin
        .from("moderation_actions")
        .select("id, action, previous_status, new_status, reason, suspended_until, acted_by, created_at")
        .eq("user_id", userId)
        .order("created_at", { ascending: false }),
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
      supabaseAdmin.auth.admin.getUserById(userId),
      fetchUserBillingBundle(userId),
    ]);

  if (flagResult.error) throw flagResult.error;
  if (moderationResult.error) throw moderationResult.error;
  if (listResult.error) throw listResult.error;
  if (paymentResult.error) throw paymentResult.error;

  const email = emailResult.data.user?.email ?? null;
  const wallet = typedProfile.credit_wallets;
  const flags = (flagResult.data ?? []) as FlaggedAccountRow[];

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
    is_flagged: flags.some((f) => f.status === "open"),
    account_status: typedProfile.account_status ?? "active",
    suspended_until: typedProfile.suspended_until ?? null,
    plan_id: billing.subscription?.plan_id ?? null,
    subscription_status: billing.subscription?.status ?? null,
  };

  const moderationActions = await resolveActorEmails(
    (moderationResult.data ?? []) as Omit<ModerationActionRow, "acted_by_email">[],
  );

  // All rows here belong to the one user already looked up above — no need
  // to pay for attachEmails' per-row getUserById lookups.
  const payments: PaymentRow[] = ((paymentResult.data ?? []) as RawPaymentRow[]).map((p) => ({
    ...p,
    email,
    billing_intent: p.billing_intent ?? null,
    pack_id: p.pack_id ?? null,
  }));

  return {
    user,
    role: typedProfile.role,
    use_case: typedProfile.use_case,
    status_reason: typedProfile.status_reason,
    flags,
    moderation_actions: moderationActions,
    lists: (listResult.data ?? []) as { id: string; name: string; kind: string; created_at: string }[],
    lists_total: listsTotal,
    payments,
    payments_total: paymentsTotal,
    subscription: billing.subscription,
    billing_profile: billing.billing_profile,
    invoices: billing.invoices,
  };
}

// Resolves acted_by ids to admin emails for the moderation history display.
// De-duplicates lookups so a user with many actions from the same admin
// costs one getUserById per distinct admin, not one per row.
async function resolveActorEmails(
  rows: Omit<ModerationActionRow, "acted_by_email">[],
): Promise<ModerationActionRow[]> {
  const emailByActor = new Map<string, string | null>();
  const actorIds = [...new Set(rows.map((r) => r.acted_by).filter((id): id is string => Boolean(id)))];
  await Promise.all(
    actorIds.map(async (id) => {
      const { data } = await supabaseAdmin.auth.admin.getUserById(id);
      emailByActor.set(id, data.user?.email ?? null);
    }),
  );
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

interface CompanyAgg {
  userIds: Set<string>;
  lifetime_purchased: number;
  lifetime_consumed: number;
  revenue_minor_units: number;
}

// Two bounded scans (same pattern as getTrends' parallel scans): profiles
// build the company -> users map and wallet totals, then payments are
// rolled up into the same map via the id -> company lookup from the first
// scan. B2B-specific view — profiles.company already exists but nothing
// aggregates by it today.
export async function getTopCompanies(limit = 10): Promise<CompanyRollupEntry[]> {
  const companyByUser = new Map<string, string>();
  const companyAgg = new Map<string, CompanyAgg>();

  function getAgg(company: string): CompanyAgg {
    let agg = companyAgg.get(company);
    if (!agg) {
      agg = { userIds: new Set(), lifetime_purchased: 0, lifetime_consumed: 0, revenue_minor_units: 0 };
      companyAgg.set(company, agg);
    }
    return agg;
  }

  await forEachPage<{
    id: string;
    company: string | null;
    credit_wallets: { lifetime_purchased: number; lifetime_consumed: number } | null;
  }>(
    "profiles",
    "id, company, credit_wallets(lifetime_purchased, lifetime_consumed)",
    (q) => q.not("company", "is", null),
    (row) => {
      if (!row.company) return;
      companyByUser.set(row.id, row.company);
      const agg = getAgg(row.company);
      agg.userIds.add(row.id);
      agg.lifetime_purchased += row.credit_wallets?.lifetime_purchased ?? 0;
      agg.lifetime_consumed += row.credit_wallets?.lifetime_consumed ?? 0;
    },
  );

  await forEachPage<{ user_id: string; amount_minor_units: number }>(
    "payments",
    "user_id, amount_minor_units",
    (q) => q.eq("status", "success"),
    (row) => {
      const company = companyByUser.get(row.user_id);
      if (!company) return;
      getAgg(company).revenue_minor_units += row.amount_minor_units;
    },
  );

  return Array.from(companyAgg.entries())
    .map(([company, agg]) => ({
      company,
      user_count: agg.userIds.size,
      lifetime_purchased: agg.lifetime_purchased,
      lifetime_consumed: agg.lifetime_consumed,
      revenue_minor_units: agg.revenue_minor_units,
    }))
    .sort((a, b) => b.lifetime_consumed - a.lifetime_consumed)
    .slice(0, limit);
}

// Read-only visibility into who currently holds is_admin — granting/revoking
// stays service-role-only (prevent_is_admin_self_escalation), this is just a
// "who has this power" sanity check. The table is bounded by definition.
export async function getAdmins(): Promise<AdminAccountRow[]> {
  const { data, error } = await supabaseAdmin
    .from("profiles")
    .select("id, created_at")
    .eq("is_admin", true)
    .order("created_at", { ascending: true });
  if (error) throw error;
  const rows = (data ?? []) as { id: string; created_at: string }[];
  const withEmails = await attachEmails(rows.map((r) => ({ user_id: r.id, created_at: r.created_at })));
  return withEmails.map((r) => ({ user_id: r.user_id, email: r.email, created_at: r.created_at }));
}
