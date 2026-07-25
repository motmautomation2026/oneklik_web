import { apiDownload, apiGet, apiPatch } from "../../lib/api";
import type {
  AccountStatus,
  AdminAccountRow,
  AdminOverview,
  CompanyRollupEntry,
  FeatureUsageResponse,
  FunnelStats,
  ListsActivity,
  PaginatedLedger,
  PaginatedLists,
  PaginatedRuns,
  PaginatedTransactions,
  PaginatedUsers,
  ModerationAction,
  PaymentStatus,
  RunStatus,
  RunsKpis,
  SetUserStatusResponse,
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
