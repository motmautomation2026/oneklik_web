// Shared response shapes for the admin API — kept separate from queries.ts
// and routes.ts so both stay in sync against one definition.

export interface AdminOverview {
  users: {
    total_signups: number;
    verified: number;
    onboarded: number;
  };
  revenue: {
    all_time_minor_units: number;
    month_to_date_minor_units: number;
    currency: "INR";
  };
  credits: {
    purchased: number;
    consumed: number;
    held: number;
  };
  active_users: {
    last_7d: number;
    last_30d: number;
  };
}

export type TrendRunType = "company_search" | "people_search" | "email_enrich" | "mobile_enrich";

export interface TrendPoint {
  date: string; // YYYY-MM-DD
  signups: number;
  revenue_minor_units: number;
  credits_consumed: Record<TrendRunType, number>;
}

export interface FunnelStats {
  signed_up: number;
  verified: number;
  onboarded: number;
  first_search: number;
  paid: number;
}

export type RunStatus = "pending" | "running" | "completed" | "cancelled" | "failed";

export interface ProviderHealth {
  provider: string;
  total: number;
  error_rate: number; // 0..1
  avg_latency_ms: number | null;
}

export interface ProviderErrorTrendPoint {
  date: string;
  rates: Record<string, number>; // provider name -> error rate 0..1, only top providers by volume
}

export interface SystemHealth {
  run_status_counts: Record<RunStatus, number>;
  providers: ProviderHealth[];
  provider_error_trend: ProviderErrorTrendPoint[];
  open_flagged_accounts: number;
}

export type AccountStatus = "active" | "frozen" | "suspended" | "banned";

export type ModerationAction = "freeze" | "suspend" | "ban" | "reactivate";

export interface ModerationActionRow {
  id: string;
  action: ModerationAction;
  previous_status: AccountStatus;
  new_status: AccountStatus;
  reason: string | null;
  suspended_until: string | null;
  acted_by: string | null;
  acted_by_email: string | null;
  created_at: string;
}

export type SubscriptionStatus = "active" | "past_due" | "expired" | "cancelled";

export interface AdminUserRow {
  user_id: string;
  email: string | null;
  company: string | null;
  onboarded: boolean;
  created_at: string;
  available_balance: number;
  held_balance: number;
  lifetime_purchased: number;
  lifetime_consumed: number;
  is_flagged: boolean;
  account_status: AccountStatus;
  suspended_until: string | null;
  plan_id: string | null;
  subscription_status: SubscriptionStatus | null;
}

export interface PaginatedUsers {
  rows: AdminUserRow[];
  total: number;
  page: number;
  page_size: number;
}

export type PaymentStatus = "initiated" | "pending" | "success" | "failed";

export interface PaymentRow {
  id: string;
  user_id: string;
  email: string | null;
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

export interface PaginatedTransactions {
  rows: PaymentRow[];
  total: number;
  page: number;
  page_size: number;
}

export interface UsersKpis {
  total_users: number;
  new_this_week: number;
  new_this_month: number;
  onboarded_pct: number; // 0..1
  zero_balance_count: number;
  open_flagged_count: number;
  avg_lifetime_consumed: number;
}

export interface TransactionsKpis {
  total_count: number;
  success_count: number;
  failed_count: number;
  pending_count: number;
  initiated_count: number;
  revenue_minor_units: number;
  avg_amount_minor_units: number;
  success_rate: number; // 0..1
}

export interface FeatureUsageEntry {
  run_type: TrendRunType;
  credits: number;
}

export interface ListsActivity {
  total_lists: number;
  total_list_items: number;
  lists_this_week: number;
  avg_list_size: number;
}

export interface UseCaseBreakdownEntry {
  use_case: string;
  count: number;
}

export type LedgerType =
  | "hold"
  | "deduct"
  | "release"
  | "purchase"
  | "promo_grant"
  | "admin_adjustment"
  | "expiry";

export interface LedgerEntry {
  id: number;
  type: LedgerType;
  amount: number;
  reference_id: string | null;
  row_reference: string | null;
  reason_code: string | null;
  balance_after: number;
  created_at: string;
}

export interface GrantUserCreditsResponse {
  ok: true;
  available_balance: number;
  reference_id: string;
  amount: number;
}

export interface PaginatedLedger {
  rows: LedgerEntry[];
  total: number;
  page: number;
  page_size: number;
}

export type FlaggedStatus = "open" | "reviewed" | "dismissed";

export interface FlaggedAccountRow {
  id: string;
  reason: string;
  source: string;
  status: FlaggedStatus;
  created_at: string;
  reviewed_at: string | null;
  reviewed_by: string | null;
}

export interface AdminSubscriptionSummary {
  plan_id: string;
  plan_name: string | null;
  status: SubscriptionStatus;
  current_period_start: string;
  current_period_end: string;
  grace_ends_at: string;
  pending_plan_id: string | null;
  credits: number | null;
  is_in_buffer: boolean;
  days_to_lapse: number | null;
  current_period_id: string | null;
  period_change_type: string | null;
  period_credits_granted: number | null;
}

export interface AdminBillingProfileSummary {
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
}

export type InvoiceDocumentType = "tax_invoice" | "credit_note" | "proforma_invoice";
export type InvoiceStatus = "issued" | "cancelled" | "paid" | "void";

export interface AdminInvoiceRow {
  id: string;
  invoice_number: string;
  document_type: InvoiceDocumentType;
  status: InvoiceStatus;
  total_minor: number;
  currency: string;
  issued_at: string;
  due_date: string | null;
  series: string;
  receipt_number: string | null;
}

export interface AdminSubscriptionRow {
  user_id: string;
  email: string | null;
  company: string | null;
  plan_id: string;
  plan_name: string | null;
  status: SubscriptionStatus;
  current_period_start: string;
  current_period_end: string;
  grace_ends_at: string;
  pending_plan_id: string | null;
  credits: number | null;
  is_in_buffer: boolean;
  days_to_lapse: number | null;
  mrr_minor_units: number;
}

export interface PaginatedSubscriptions {
  rows: AdminSubscriptionRow[];
  total: number;
  page: number;
  page_size: number;
}

export interface PlanMixEntry {
  plan_id: string;
  plan_name: string | null;
  count: number;
  mrr_minor_units: number;
}

export interface SubscriptionsKpis {
  mrr_minor_units: number;
  arr_minor_units: number;
  currency: "INR";
  paying_count: number;
  past_due_count: number;
  expired_count: number;
  cancelled_count: number;
  no_subscription_count: number;
  lapsing_soon_count: number;
  plan_mix: PlanMixEntry[];
}

export interface UserDetail {
  user: AdminUserRow;
  role: string | null;
  use_case: string | null;
  status_reason: string | null;
  flags: FlaggedAccountRow[];
  moderation_actions: ModerationActionRow[];
  lists: { id: string; name: string; kind: string; created_at: string }[];
  lists_total: number;
  payments: PaymentRow[];
  payments_total: number;
  subscription: AdminSubscriptionSummary | null;
  billing_profile: AdminBillingProfileSummary | null;
  invoices: AdminInvoiceRow[];
}

export interface RunRow {
  id: string;
  user_id: string;
  email: string | null;
  list_id: string | null;
  run_type: string;
  status: RunStatus;
  requested_count: number;
  delivered_count: number;
  credits_held: number;
  credits_charged: number;
  credits_released: number;
  created_at: string;
  completed_at: string | null;
}

export interface PaginatedRuns {
  rows: RunRow[];
  total: number;
  page: number;
  page_size: number;
}

export interface RunsKpis {
  stuck_count: number;
  failed_today: number;
  completed_today: number;
  total_today: number;
}

export interface ListRow {
  id: string;
  name: string;
  kind: string;
  created_at: string;
  item_count: number;
  owner_user_id: string;
  owner_email: string | null;
}

export interface PaginatedLists {
  rows: ListRow[];
  total: number;
  page: number;
  page_size: number;
}

export interface CompanyRollupEntry {
  company: string;
  user_count: number;
  lifetime_purchased: number;
  lifetime_consumed: number;
  revenue_minor_units: number;
}

export interface AdminAccountRow {
  user_id: string;
  email: string | null;
  created_at: string;
}
