import { apiDownload, apiGet, apiGetText, apiPatch, apiPost } from "../../lib/api";
import type {
  AccountStatus,
  AdminAccountRow,
  AdminOverview,
  AdminTicketDetail,
  PaginatedSupportTickets,
  SupportKpis,
  TicketCategory,
  TicketPriority,
  TicketStatus,
  CompanyRollupEntry,
  FeatureUsageResponse,
  FunnelStats,
  GrantUserCreditsResponse,
  ListsActivity,
  PaginatedLedger,
  PaginatedLists,
  PaginatedRuns,
  PaginatedSubscriptions,
  PaginatedTransactions,
  PaginatedUsers,
  ModerationAction,
  PaymentStatus,
  RunStatus,
  RunsKpis,
  SetUserStatusResponse,
  SubscriptionStatus,
  SubscriptionsKpis,
  SystemHealthResponse,
  TransactionsKpis,
  TrendsResponse,
  UseCaseBreakdownEntry,
  UserDetail,
  UsersKpis,
} from "../types";

export function fetchOverview(): Promise<AdminOverview> {
  return apiGet<AdminOverview>("/api/admin/overview");
}

export function fetchTrends(days: 7 | 30 | 90): Promise<TrendsResponse> {
  return apiGet<TrendsResponse>(`/api/admin/trends?days=${days}`);
}

export function fetchFunnel(): Promise<FunnelStats> {
  return apiGet<FunnelStats>("/api/admin/funnel");
}

export function fetchSystemHealth(days: 7 | 30 | 90): Promise<SystemHealthResponse> {
  return apiGet<SystemHealthResponse>(`/api/admin/system-health?days=${days}`);
}

export function fetchFeatureUsage(days: 7 | 30 | 90): Promise<FeatureUsageResponse> {
  return apiGet<FeatureUsageResponse>(`/api/admin/feature-usage?days=${days}`);
}

export function fetchListsActivity(): Promise<ListsActivity> {
  return apiGet<ListsActivity>("/api/admin/lists-activity");
}

export function fetchUseCaseBreakdown(): Promise<{ breakdown: UseCaseBreakdownEntry[] }> {
  return apiGet<{ breakdown: UseCaseBreakdownEntry[] }>("/api/admin/use-case-breakdown");
}

export function fetchUsersKpis(): Promise<UsersKpis> {
  return apiGet<UsersKpis>("/api/admin/users/kpis");
}

export function fetchTransactionsKpis(params: { search?: string }): Promise<TransactionsKpis> {
  const query = new URLSearchParams();
  if (params.search) query.set("search", params.search);
  const qs = query.toString();
  return apiGet<TransactionsKpis>(`/api/admin/transactions/kpis${qs ? `?${qs}` : ""}`);
}

export interface FetchUsersParams {
  page: number;
  pageSize: number;
  search?: string;
  status?: AccountStatus;
  signal?: AbortSignal;
}

export function fetchUsers({ page, pageSize, search, status, signal }: FetchUsersParams): Promise<PaginatedUsers> {
  const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
  if (search) params.set("search", search);
  if (status) params.set("status", status);
  return apiGet<PaginatedUsers>(`/api/admin/users?${params.toString()}`, signal);
}

export interface SetUserStatusParams {
  action: ModerationAction;
  reason?: string;
  // ISO timestamp; only meaningful for the 'suspend' action.
  until?: string;
}

export function setUserStatus(userId: string, params: SetUserStatusParams): Promise<SetUserStatusResponse> {
  return apiPatch<SetUserStatusResponse>(`/api/admin/users/${encodeURIComponent(userId)}/status`, params);
}

export function fetchUserDetail(userId: string): Promise<UserDetail> {
  return apiGet<UserDetail>(`/api/admin/users/${encodeURIComponent(userId)}`);
}

export function fetchUserLedger(
  userId: string,
  params: { page: number; pageSize: number },
): Promise<PaginatedLedger> {
  const query = new URLSearchParams({ page: String(params.page), pageSize: String(params.pageSize) });
  return apiGet<PaginatedLedger>(`/api/admin/users/${encodeURIComponent(userId)}/ledger?${query.toString()}`);
}

export interface GrantUserCreditsParams {
  amount: number;
  reason: string;
  reason_code?: string;
}

export function grantUserCredits(
  userId: string,
  params: GrantUserCreditsParams,
): Promise<GrantUserCreditsResponse> {
  return apiPost<GrantUserCreditsResponse>(`/api/admin/users/${encodeURIComponent(userId)}/credits`, params);
}

export function reviewFlaggedAccount(
  flaggedAccountId: string,
  status: "reviewed" | "dismissed",
): Promise<{ ok: true }> {
  return apiPatch<{ ok: true }>(`/api/admin/flagged-accounts/${encodeURIComponent(flaggedAccountId)}`, { status });
}

export interface FetchTransactionsParams {
  page: number;
  pageSize: number;
  status?: PaymentStatus;
  search?: string;
}

export function fetchTransactions({
  page,
  pageSize,
  status,
  search,
}: FetchTransactionsParams): Promise<PaginatedTransactions> {
  const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
  if (status) params.set("status", status);
  if (search) params.set("search", search);
  return apiGet<PaginatedTransactions>(`/api/admin/transactions?${params.toString()}`);
}

export function exportUsersCsv(search?: string): Promise<void> {
  const params = new URLSearchParams();
  if (search) params.set("search", search);
  const qs = params.toString();
  return apiDownload(`/api/admin/users/export${qs ? `?${qs}` : ""}`, "users.csv");
}

export function exportTransactionsCsv(params: { status?: PaymentStatus; search?: string }): Promise<void> {
  const query = new URLSearchParams();
  if (params.status) query.set("status", params.status);
  if (params.search) query.set("search", params.search);
  const qs = query.toString();
  return apiDownload(`/api/admin/transactions/export${qs ? `?${qs}` : ""}`, "transactions.csv");
}

export function fetchRunsKpis(): Promise<RunsKpis> {
  return apiGet<RunsKpis>("/api/admin/runs/kpis");
}

export interface FetchRunsParams {
  page: number;
  pageSize: number;
  status?: RunStatus;
  search?: string;
}

export function fetchRuns({ page, pageSize, status, search }: FetchRunsParams): Promise<PaginatedRuns> {
  const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
  if (status) params.set("status", status);
  if (search) params.set("search", search);
  return apiGet<PaginatedRuns>(`/api/admin/runs?${params.toString()}`);
}

export interface FetchListsParams {
  page: number;
  pageSize: number;
  search?: string;
  userId?: string;
  signal?: AbortSignal;
}

export function fetchLists({ page, pageSize, search, userId, signal }: FetchListsParams): Promise<PaginatedLists> {
  const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
  if (search) params.set("search", search);
  if (userId) params.set("userId", userId);
  return apiGet<PaginatedLists>(`/api/admin/lists?${params.toString()}`, signal);
}

export function fetchTopCompanies(limit = 10): Promise<{ companies: CompanyRollupEntry[] }> {
  return apiGet<{ companies: CompanyRollupEntry[] }>(`/api/admin/companies/top?limit=${limit}`);
}

export function fetchAdmins(): Promise<{ admins: AdminAccountRow[] }> {
  return apiGet<{ admins: AdminAccountRow[] }>("/api/admin/admins");
}

export function fetchSubscriptionsKpis(signal?: AbortSignal): Promise<SubscriptionsKpis> {
  return apiGet<SubscriptionsKpis>("/api/admin/subscriptions/kpis", signal);
}

export interface FetchSubscriptionsParams {
  page: number;
  pageSize: number;
  status?: SubscriptionStatus;
  planId?: string;
  search?: string;
  lapsingSoon?: boolean;
  signal?: AbortSignal;
}

export function fetchSubscriptions({
  page,
  pageSize,
  status,
  planId,
  search,
  lapsingSoon,
  signal,
}: FetchSubscriptionsParams): Promise<PaginatedSubscriptions> {
  const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
  if (status) params.set("status", status);
  if (planId) params.set("planId", planId);
  if (search) params.set("search", search);
  if (lapsingSoon) params.set("lapsingSoon", "1");
  return apiGet<PaginatedSubscriptions>(`/api/admin/subscriptions?${params.toString()}`, signal);
}

export async function openAdminInvoiceHtml(invoiceId: string, view?: string): Promise<void> {
  // Open synchronously on the click stack so popup blockers don't swallow the tab
  // after the await. Failures navigate the placeholder tab to about:blank and throw.
  const tab = window.open("about:blank", "_blank");
  const qs = view ? `?view=${encodeURIComponent(view)}` : "";
  try {
    const html = await apiGetText(`/api/admin/invoices/${encodeURIComponent(invoiceId)}/html${qs}`);
    const blob = new Blob([html], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    if (tab) {
      tab.location.href = url;
    } else {
      window.open(url, "_blank", "noopener,noreferrer");
    }
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  } catch (err) {
    tab?.close();
    throw err;
  }
}

export async function openAdminInvoicePdf(invoiceId: string, view?: string): Promise<void> {
  const tab = window.open("about:blank", "_blank");
  const qs = view ? `?view=${encodeURIComponent(view)}` : "";
  try {
    const result = await apiGet<{ url: string; filename: string }>(
      `/api/admin/invoices/${encodeURIComponent(invoiceId)}/pdf${qs}`,
    );
    if (tab) {
      tab.location.href = result.url;
    } else {
      window.open(result.url, "_blank", "noopener,noreferrer");
    }
  } catch (err) {
    tab?.close();
    throw err;
  }
}

// ── support tickets ─────────────────────────────────────────────────────

export interface FetchSupportTicketsParams {
  page: number;
  pageSize: number;
  status?: TicketStatus;
  category?: TicketCategory;
  priority?: TicketPriority;
  assignedTo?: string;
  unassigned?: boolean;
  unanswered?: boolean;
  openOnly?: boolean;
  search?: string;
  signal?: AbortSignal;
}

function supportQuery(params: Omit<FetchSupportTicketsParams, "signal">): URLSearchParams {
  const query = new URLSearchParams();
  if (params.page) query.set("page", String(params.page));
  if (params.pageSize) query.set("pageSize", String(params.pageSize));
  if (params.status) query.set("status", params.status);
  if (params.category) query.set("category", params.category);
  if (params.priority) query.set("priority", params.priority);
  if (params.assignedTo) query.set("assignedTo", params.assignedTo);
  if (params.unassigned) query.set("unassigned", "1");
  if (params.unanswered) query.set("unanswered", "1");
  if (params.openOnly) query.set("openOnly", "1");
  if (params.search) query.set("search", params.search);
  return query;
}

export function fetchSupportTickets({ signal, ...params }: FetchSupportTicketsParams): Promise<PaginatedSupportTickets> {
  return apiGet<PaginatedSupportTickets>(`/api/admin/support?${supportQuery(params).toString()}`, signal);
}

export function fetchSupportKpis(signal?: AbortSignal): Promise<SupportKpis> {
  return apiGet<SupportKpis>("/api/admin/support/kpis", signal);
}

export function fetchSupportBadge(signal?: AbortSignal): Promise<{ count: number }> {
  return apiGet<{ count: number }>("/api/admin/support/badge", signal);
}

export function fetchSupportTicket(id: string, signal?: AbortSignal): Promise<{ ticket: AdminTicketDetail }> {
  return apiGet<{ ticket: AdminTicketDetail }>(`/api/admin/support/${id}`, signal);
}

export function postSupportMessage(id: string, body: string, internal: boolean): Promise<{ ok: true }> {
  return apiPost<{ ok: true }>(`/api/admin/support/${id}/messages`, { body, internal });
}

export function patchSupportTicket(
  id: string,
  patch: { status?: TicketStatus; priority?: TicketPriority; assigned_to?: string | null },
): Promise<{ ok: true }> {
  return apiPatch<{ ok: true }>(`/api/admin/support/${id}`, patch);
}

export function markSupportTicketRead(id: string): Promise<{ ok: true }> {
  return apiPost<{ ok: true }>(`/api/admin/support/${id}/read`, {});
}

export function setSupportMute(id: string, userId: string, until: string | null): Promise<{ ok: true; until: string | null }> {
  return apiPost<{ ok: true; until: string | null }>(`/api/admin/support/${id}/mute`, { user_id: userId, until });
}

export function fetchSupportAttachmentUrl(attachmentId: string): Promise<{ url: string }> {
  return apiGet<{ url: string }>(`/api/admin/support-attachments/${attachmentId}/url`);
}

export function exportSupportTicketsCsv(params: Omit<FetchSupportTicketsParams, "signal" | "page" | "pageSize">): Promise<void> {
  const query = supportQuery({ ...params, page: 0, pageSize: 0 });
  const qs = query.toString();
  return apiDownload(`/api/admin/support/export${qs ? `?${qs}` : ""}`, "support-tickets.csv");
}
