import { supabaseAdmin } from "../lib/supabaseAdmin.js";
import { CREDIT_PACKS, findPack } from "../lib/creditPacks.js";
import type { InvoiceRow } from "../lib/issueInvoice.js";
import type {
  AdminBillingProfileSummary,
  AdminInvoiceListRow,
  AdminInvoiceRow,
  AdminSubscriptionRow,
  AdminSubscriptionSummary,
  InvoiceDocumentType,
  InvoiceStatus,
  InvoicesKpis,
  PaginatedInvoices,
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

const INVOICE_DIRECTORY_SELECT =
  "id, user_id, payment_id, invoice_number, receipt_number, document_type, status, taxable_value_minor, cgst_minor, sgst_minor, igst_minor, total_minor, currency, issued_at, due_date, series, financial_year, buyer_snapshot, payment_snapshot";

const NO_MATCH_USER_ID = "00000000-0000-0000-0000-000000000000";

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

interface RawInvoiceDirectoryRow {
  id: string;
  user_id: string;
  payment_id: string | null;
  invoice_number: string;
  receipt_number: string | null;
  document_type: string;
  status: string;
  taxable_value_minor: number;
  cgst_minor: number;
  sgst_minor: number;
  igst_minor: number;
  total_minor: number;
  currency: string;
  issued_at: string;
  due_date: string | null;
  series: string;
  financial_year: string;
  buyer_snapshot: Record<string, unknown> | null;
  payment_snapshot: Record<string, unknown> | null;
}

function snapshotString(snap: Record<string, unknown> | null | undefined, key: string): string | null {
  const v = snap?.[key];
  return typeof v === "string" && v.trim() ? v : null;
}

interface GetInvoicesParams {
  page: number;
  pageSize: number;
  documentType?: InvoiceDocumentType;
  status?: InvoiceStatus;
  search?: string;
  planId?: string;
  financialYear?: string;
  issuedFrom?: string;
  issuedTo?: string;
}

type InvoicesSearchFilter =
  | { type: "ids"; ids: string[] }
  | { type: "doc"; term: string }
  | { type: "none" };

async function resolveInvoicesSearchFilter(search?: string): Promise<InvoicesSearchFilter> {
  const trimmed = search?.trim();
  if (!trimmed) return { type: "none" };
  if (trimmed.includes("@")) {
    const ids = await findUserIdsByEmailSubstring(trimmed);
    return { type: "ids", ids: Array.from(ids) };
  }
  return { type: "doc", term: trimmed };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function applyInvoicesSearchFilter(query: any, filter: InvoicesSearchFilter): any {
  if (filter.type === "ids") {
    return filter.ids.length > 0 ? query.in("user_id", filter.ids) : query.eq("user_id", NO_MATCH_USER_ID);
  }
  if (filter.type === "doc") {
    const t = filter.term.replace(/%/g, "");
    // invoice #, receipt #, buyer legal name, or GSTIN
    return query.or(
      `invoice_number.ilike.%${t}%,receipt_number.ilike.%${t}%,buyer_snapshot->>legal_name.ilike.%${t}%,buyer_snapshot->>gstin.ilike.%${t}%`,
    );
  }
  return query;
}

async function paymentIdsForPlan(planId: string): Promise<string[]> {
  const ids: string[] = [];
  let from = 0;
  for (let page = 0; page < MAX_PAGES; page++) {
    const { data, error } = await supabaseAdmin
      .from("payments")
      .select("id")
      .eq("pack_id", planId)
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    const rows = (data ?? []) as { id: string }[];
    if (rows.length === 0) break;
    for (const row of rows) ids.push(row.id);
    if (rows.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  return ids;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function applyInvoiceDirectoryFilters(
  query: any,
  params: Omit<GetInvoicesParams, "page" | "pageSize">,
  searchFilter: InvoicesSearchFilter,
): Promise<any> {
  let q = applyInvoicesSearchFilter(query, searchFilter);
  if (params.documentType) q = q.eq("document_type", params.documentType);
  if (params.status) q = q.eq("status", params.status);
  if (params.financialYear) q = q.eq("financial_year", params.financialYear);
  if (params.issuedFrom) q = q.gte("issued_at", params.issuedFrom);
  if (params.issuedTo) q = q.lte("issued_at", params.issuedTo);
  if (params.planId) {
    const paymentIds = await paymentIdsForPlan(params.planId);
    q = paymentIds.length > 0 ? q.in("payment_id", paymentIds) : q.eq("payment_id", NO_MATCH_USER_ID);
  }
  return q;
}

async function attachPaymentHints(
  rows: RawInvoiceDirectoryRow[],
): Promise<
  Map<string, { pack_id: string | null; billing_intent: string | null; gateway_capture_id: string | null }>
> {
  const map = new Map<
    string,
    { pack_id: string | null; billing_intent: string | null; gateway_capture_id: string | null }
  >();
  const paymentIds = rows.map((r) => r.payment_id).filter((id): id is string => Boolean(id));
  if (paymentIds.length === 0) return map;

  const { data, error } = await supabaseAdmin
    .from("payments")
    .select("id, pack_id, billing_intent, gateway_capture_id")
    .in("id", paymentIds);
  if (error) throw error;

  for (const p of (data ?? []) as {
    id: string;
    pack_id: string | null;
    billing_intent: string | null;
    gateway_capture_id: string | null;
  }[]) {
    map.set(p.id, {
      pack_id: p.pack_id,
      billing_intent: p.billing_intent,
      gateway_capture_id: p.gateway_capture_id,
    });
  }
  return map;
}

function toAdminInvoiceListRow(
  row: RawInvoiceDirectoryRow & { email: string | null },
  paymentHint: { pack_id: string | null; billing_intent: string | null; gateway_capture_id: string | null } | null,
): AdminInvoiceListRow {
  const packId = paymentHint?.pack_id ?? null;
  const captureFromSnap = snapshotString(row.payment_snapshot, "razorpay_payment_id");
  return {
    id: row.id,
    user_id: row.user_id,
    email: row.email,
    invoice_number: row.invoice_number,
    receipt_number: row.receipt_number,
    document_type: row.document_type as InvoiceDocumentType,
    status: row.status as InvoiceStatus,
    taxable_value_minor: row.taxable_value_minor,
    cgst_minor: row.cgst_minor,
    sgst_minor: row.sgst_minor,
    igst_minor: row.igst_minor,
    total_minor: row.total_minor,
    currency: row.currency,
    issued_at: row.issued_at,
    due_date: row.due_date,
    series: row.series,
    financial_year: row.financial_year,
    buyer_legal_name: snapshotString(row.buyer_snapshot, "legal_name"),
    buyer_gstin: snapshotString(row.buyer_snapshot, "gstin"),
    payment_id: row.payment_id,
    pack_id: packId,
    plan_name: packId ? planName(packId) : null,
    billing_intent: paymentHint?.billing_intent ?? null,
    gateway_capture_id: paymentHint?.gateway_capture_id ?? captureFromSnap,
  };
}

export async function getInvoices(params: GetInvoicesParams): Promise<PaginatedInvoices> {
  const { page, pageSize } = params;
  const from = (page - 1) * pageSize;
  const searchFilter = await resolveInvoicesSearchFilter(params.search);

  let query = await applyInvoiceDirectoryFilters(
    supabaseAdmin
      .from("invoices")
      .select(INVOICE_DIRECTORY_SELECT, { count: "exact" })
      .order("issued_at", { ascending: false })
      .range(from, from + pageSize - 1),
    params,
    searchFilter,
  );

  const { data, error, count } = await query;
  if (error) throw error;

  const rawRows = (data ?? []) as RawInvoiceDirectoryRow[];
  const [withEmails, paymentHints] = await Promise.all([attachEmails(rawRows), attachPaymentHints(rawRows)]);

  const rows = withEmails.map((row) =>
    toAdminInvoiceListRow(row, row.payment_id ? paymentHints.get(row.payment_id) ?? null : null),
  );

  return { rows, total: count ?? 0, page, page_size: pageSize };
}

export async function getAllInvoicesForExport(
  params: Omit<GetInvoicesParams, "page" | "pageSize">,
): Promise<AdminInvoiceListRow[]> {
  const searchFilter = await resolveInvoicesSearchFilter(params.search);
  const all: RawInvoiceDirectoryRow[] = [];
  let from = 0;
  for (let page = 0; page < MAX_PAGES; page++) {
    let query = await applyInvoiceDirectoryFilters(
      supabaseAdmin
        .from("invoices")
        .select(INVOICE_DIRECTORY_SELECT)
        .order("issued_at", { ascending: false })
        .range(from, from + PAGE_SIZE - 1),
      params,
      searchFilter,
    );
    const { data, error } = await query;
    if (error) throw error;
    const rows = (data ?? []) as RawInvoiceDirectoryRow[];
    if (rows.length === 0) break;
    all.push(...rows);
    if (rows.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }

  const [withEmails, paymentHints] = await Promise.all([attachEmails(all), attachPaymentHints(all)]);
  return withEmails.map((row) =>
    toAdminInvoiceListRow(row, row.payment_id ? paymentHints.get(row.payment_id) ?? null : null),
  );
}

function monthStartIso(now = new Date()): string {
  return new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
}

export async function getInvoicesKpis(): Promise<InvoicesKpis> {
  const mtdIso = monthStartIso();

  const taxSelect =
    "taxable_value_minor, cgst_minor, sgst_minor, igst_minor, total_minor, issued_at, document_type, status";

  let taxableMtd = 0;
  let cgstMtd = 0;
  let sgstMtd = 0;
  let igstMtd = 0;
  let totalMtd = 0;
  let taxCountMtd = 0;
  let taxableAll = 0;
  let gstAll = 0;
  let totalAll = 0;
  let taxCountAll = 0;
  let openProformaCount = 0;
  let openProformaTotal = 0;

  let from = 0;
  for (let page = 0; page < MAX_PAGES; page++) {
    const { data, error } = await supabaseAdmin
      .from("invoices")
      .select(taxSelect)
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    const rows = (data ?? []) as {
      taxable_value_minor: number;
      cgst_minor: number;
      sgst_minor: number;
      igst_minor: number;
      total_minor: number;
      issued_at: string;
      document_type: string;
      status: string;
    }[];
    if (rows.length === 0) break;

    for (const row of rows) {
      if (row.document_type === "tax_invoice" && row.status !== "cancelled" && row.status !== "void") {
        taxCountAll += 1;
        taxableAll += row.taxable_value_minor;
        gstAll += row.cgst_minor + row.sgst_minor + row.igst_minor;
        totalAll += row.total_minor;
        if (row.issued_at >= mtdIso) {
          taxCountMtd += 1;
          taxableMtd += row.taxable_value_minor;
          cgstMtd += row.cgst_minor;
          sgstMtd += row.sgst_minor;
          igstMtd += row.igst_minor;
          totalMtd += row.total_minor;
        }
      }
      if (row.document_type === "proforma_invoice" && row.status === "issued") {
        openProformaCount += 1;
        openProformaTotal += row.total_minor;
      }
    }

    if (rows.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }

  // Success payments that never got a tax invoice — orphan / repair signal.
  const invoicedPaymentIds = new Set<string>();
  from = 0;
  for (let page = 0; page < MAX_PAGES; page++) {
    const { data, error } = await supabaseAdmin
      .from("invoices")
      .select("payment_id")
      .eq("document_type", "tax_invoice")
      .not("payment_id", "is", null)
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    const rows = (data ?? []) as { payment_id: string | null }[];
    if (rows.length === 0) break;
    for (const row of rows) {
      if (row.payment_id) invoicedPaymentIds.add(row.payment_id);
    }
    if (rows.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }

  let successWithoutInvoice = 0;
  from = 0;
  for (let page = 0; page < MAX_PAGES; page++) {
    const { data, error } = await supabaseAdmin
      .from("payments")
      .select("id")
      .eq("status", "success")
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    const rows = (data ?? []) as { id: string }[];
    if (rows.length === 0) break;
    for (const row of rows) {
      if (!invoicedPaymentIds.has(row.id)) successWithoutInvoice += 1;
    }
    if (rows.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }

  return {
    tax_invoice_count_mtd: taxCountMtd,
    tax_invoice_count_all: taxCountAll,
    taxable_minor_mtd: taxableMtd,
    gst_minor_mtd: cgstMtd + sgstMtd + igstMtd,
    total_minor_mtd: totalMtd,
    cgst_minor_mtd: cgstMtd,
    sgst_minor_mtd: sgstMtd,
    igst_minor_mtd: igstMtd,
    taxable_minor_all: taxableAll,
    gst_minor_all: gstAll,
    total_minor_all: totalAll,
    open_proforma_count: openProformaCount,
    open_proforma_total_minor: openProformaTotal,
    success_without_invoice_count: successWithoutInvoice,
    currency: "INR",
  };
}

/** Batch lookup of invoice numbers for a page of payments (transactions cross-link). */
export async function getInvoiceHintsByPaymentIds(
  paymentIds: string[],
): Promise<Map<string, { invoice_id: string; invoice_number: string; receipt_number: string | null }>> {
  const map = new Map<string, { invoice_id: string; invoice_number: string; receipt_number: string | null }>();
  if (paymentIds.length === 0) return map;

  const { data, error } = await supabaseAdmin
    .from("invoices")
    .select("id, payment_id, invoice_number, receipt_number")
    .in("payment_id", paymentIds)
    .eq("document_type", "tax_invoice");
  if (error) throw error;

  for (const row of (data ?? []) as {
    id: string;
    payment_id: string;
    invoice_number: string;
    receipt_number: string | null;
  }[]) {
    map.set(row.payment_id, {
      invoice_id: row.id,
      invoice_number: row.invoice_number,
      receipt_number: row.receipt_number,
    });
  }
  return map;
}

export { BILLING_PROFILE_SELECT, INVOICE_LIST_SELECT, SUBSCRIPTION_SELECT };
