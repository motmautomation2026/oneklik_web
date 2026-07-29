import { useEffect, useState } from "react";
import { Badge, Button, Form } from "react-bootstrap";
import { Link, useSearchParams } from "react-router-dom";
import { exportUsersCsv, fetchTopCompanies, fetchUsers, fetchUsersKpis } from "../api/adminApi";
import DataTable from "../components/DataTable";
import KpiTile from "../components/KpiTile";
import PaginationBar from "../components/PaginationBar";
import SectionCard from "../components/SectionCard";
import { ACCOUNT_STATUS_VARIANT, SUBSCRIPTION_STATUS_VARIANT } from "../badgeVariants";
import { formatDateTime, formatInrFromMinorUnits, formatNumber } from "../format";
import { useAdminResource } from "../hooks/useAdminResource";
import { useDebouncedValue } from "../hooks/useDebouncedValue";
import { ADMIN_CHART_COLORS } from "../theme";
import type { AccountStatus, AdminUserRow, CompanyRollupEntry } from "../types";

const PAGE_SIZE = 25;

const ACCOUNT_STATUSES: AccountStatus[] = ["active", "frozen", "suspended", "banned"];

// Narrow an arbitrary URL param to a valid AccountStatus, or undefined.
function parseStatusParam(value: string | null): AccountStatus | undefined {
  return value && (ACCOUNT_STATUSES as string[]).includes(value) ? (value as AccountStatus) : undefined;
}

export default function AdminUsersPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [page, setPage] = useState(() => Number(searchParams.get("page")) || 1);
  const [searchInput, setSearchInput] = useState(() => searchParams.get("search") ?? "");
  const [statusFilter, setStatusFilter] = useState<AccountStatus | "">(() => parseStatusParam(searchParams.get("status")) ?? "");
  const search = useDebouncedValue(searchInput);
  const [exporting, setExporting] = useState(false);

  // Mirror page/search/status into the URL so the view is bookmarkable and
  // survives browser back/forward — read once as initial state above, kept in
  // sync here on every change.
  useEffect(() => {
    const next = new URLSearchParams(searchParams);
    if (page > 1) next.set("page", String(page));
    else next.delete("page");
    if (search) next.set("search", search);
    else next.delete("search");
    if (statusFilter) next.set("status", statusFilter);
    else next.delete("status");
    setSearchParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, search, statusFilter]);

  const kpis = useAdminResource(fetchUsersKpis, []);
  const topCompanies = useAdminResource(() => fetchTopCompanies(10), []);
  const users = useAdminResource(
    (signal) =>
      fetchUsers({ page, pageSize: PAGE_SIZE, search: search || undefined, status: statusFilter || undefined, signal }),
    [page, search, statusFilter],
  );

  function handleSearchChange(value: string) {
    setSearchInput(value);
    setPage(1);
  }

  function handleStatusChange(value: string) {
    setStatusFilter(parseStatusParam(value) ?? "");
    setPage(1);
  }

  async function handleExport() {
    setExporting(true);
    try {
      await exportUsersCsv(search || undefined);
    } finally {
      setExporting(false);
    }
  }

  const companyColumns = [
    { key: "company", header: "Company", render: (row: CompanyRollupEntry) => row.company },
    { key: "users", header: "Users", align: "end" as const, render: (row: CompanyRollupEntry) => formatNumber(row.user_count) },
    {
      key: "consumed",
      header: "Lifetime consumed",
      align: "end" as const,
      render: (row: CompanyRollupEntry) => formatNumber(row.lifetime_consumed),
    },
    {
      key: "purchased",
      header: "Lifetime purchased",
      align: "end" as const,
      render: (row: CompanyRollupEntry) => formatNumber(row.lifetime_purchased),
    },
    {
      key: "revenue",
      header: "Revenue",
      align: "end" as const,
      render: (row: CompanyRollupEntry) => formatInrFromMinorUnits(row.revenue_minor_units),
    },
  ];

  const columns = [
    {
      key: "email",
      header: "User",
      render: (row: AdminUserRow) => (
        <div className="d-flex align-items-center gap-2">
          <Link to={`/admin/users/${row.user_id}`}>{row.email ?? row.user_id}</Link>
          {row.is_flagged && <Badge bg="danger">Flagged</Badge>}
        </div>
      ),
    },
    { key: "company", header: "Company", render: (row: AdminUserRow) => row.company ?? "—" },
    {
      key: "status",
      header: "Status",
      render: (row: AdminUserRow) => (
        <Badge bg={ACCOUNT_STATUS_VARIANT[row.account_status] ?? "secondary"}>{row.account_status}</Badge>
      ),
    },
    {
      key: "plan",
      header: "Plan",
      render: (row: AdminUserRow) => row.plan_id ?? "—",
    },
    {
      key: "subscription_status",
      header: "Sub status",
      render: (row: AdminUserRow) =>
        row.subscription_status ? (
          <Badge bg={SUBSCRIPTION_STATUS_VARIANT[row.subscription_status] ?? "secondary"}>
            {row.subscription_status}
          </Badge>
        ) : (
          "—"
        ),
    },
    {
      key: "onboarded",
      header: "Onboarded",
      render: (row: AdminUserRow) => (
        <Badge bg={row.onboarded ? "success" : "secondary"}>{row.onboarded ? "Yes" : "No"}</Badge>
      ),
    },
    { key: "signed_up", header: "Signed up", render: (row: AdminUserRow) => formatDateTime(row.created_at) },
    {
      key: "available",
      header: "Available",
      align: "end" as const,
      render: (row: AdminUserRow) => formatNumber(row.available_balance),
    },
    {
      key: "held",
      header: "Held",
      align: "end" as const,
      render: (row: AdminUserRow) => formatNumber(row.held_balance),
    },
    {
      key: "purchased",
      header: "Lifetime purchased",
      align: "end" as const,
      render: (row: AdminUserRow) => formatNumber(row.lifetime_purchased),
    },
    {
      key: "consumed",
      header: "Lifetime consumed",
      align: "end" as const,
      render: (row: AdminUserRow) => formatNumber(row.lifetime_consumed),
    },
  ];

  return (
    <>
      <div className="mb-4">
        <h1 className="h4 mb-1" style={{ color: ADMIN_CHART_COLORS.ink.primary }}>
          Users
        </h1>
        <p className="mb-0 small" style={{ color: ADMIN_CHART_COLORS.ink.secondary }}>
          Every verified account, wallet balance, and flag status.
        </p>
      </div>

      <div className="row g-3 mb-4">
        <div className="col-6 col-lg-3">
          <KpiTile
            label="Total users"
            value={kpis.data ? formatNumber(kpis.data.total_users) : "—"}
            sublabel={kpis.data ? `${formatNumber(kpis.data.new_this_week)} new this week` : undefined}
          />
        </div>
        <div className="col-6 col-lg-3">
          <KpiTile
            label="Onboarded"
            value={kpis.data ? `${Math.round(kpis.data.onboarded_pct * 100)}%` : "—"}
            sublabel={kpis.data ? `${formatNumber(kpis.data.new_this_month)} new this month` : undefined}
          />
        </div>
        <div className="col-6 col-lg-3">
          <KpiTile
            label="Zero balance"
            value={kpis.data ? formatNumber(kpis.data.zero_balance_count) : "—"}
            sublabel="At risk of churn"
          />
        </div>
        <div className="col-6 col-lg-3">
          <KpiTile
            label="Open flags"
            value={kpis.data ? formatNumber(kpis.data.open_flagged_count) : "—"}
            sublabel={kpis.data ? `${formatNumber(kpis.data.avg_lifetime_consumed)} avg. credits consumed` : undefined}
          />
        </div>
      </div>
      {kpis.error && (
        <div className="small mb-4" style={{ color: ADMIN_CHART_COLORS.status.critical }}>
          {kpis.error}
        </div>
      )}

      <div className="row g-3 mb-4">
        <div className="col-12">
          <SectionCard title="Top companies" loading={topCompanies.loading} error={topCompanies.error}>
            {topCompanies.data && (
              <DataTable
                columns={companyColumns}
                rows={topCompanies.data.companies}
                getRowKey={(row) => row.company}
                emptyMessage="No companies on file yet"
              />
            )}
          </SectionCard>
        </div>
      </div>

      <SectionCard
        title="Directory"
        loading={users.loading}
        error={users.error}
        action={
          <div className="d-flex gap-2">
            <Form.Control
              type="search"
              size="sm"
              placeholder="Search by email or company…"
              value={searchInput}
              onChange={(e) => handleSearchChange(e.target.value)}
              style={{ maxWidth: 280 }}
            />
            <Form.Select
              size="sm"
              value={statusFilter}
              onChange={(e) => handleStatusChange(e.target.value)}
              style={{ maxWidth: 150 }}
              aria-label="Filter by account status"
            >
              <option value="">All statuses</option>
              {ACCOUNT_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s.charAt(0).toUpperCase() + s.slice(1)}
                </option>
              ))}
            </Form.Select>
            <Button size="sm" variant="outline-secondary" disabled={exporting} onClick={handleExport}>
              {exporting ? "Exporting…" : "Export CSV"}
            </Button>
          </div>
        }
      >
        {users.data && (
          <>
            <DataTable
              columns={columns}
              rows={users.data.rows}
              getRowKey={(row) => row.user_id}
              emptyMessage={search || statusFilter ? "No users match those filters" : "No users yet"}
            />
            <PaginationBar page={page} pageSize={PAGE_SIZE} total={users.data.total} onPageChange={setPage} />
          </>
        )}
      </SectionCard>
    </>
  );
}
