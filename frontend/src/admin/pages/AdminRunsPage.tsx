import { useState } from "react";
import { Badge, Form } from "react-bootstrap";
import { Link } from "react-router-dom";
import { fetchRuns, fetchRunsKpis } from "../api/adminApi";
import DataTable from "../components/DataTable";
import KpiTile from "../components/KpiTile";
import PaginationBar from "../components/PaginationBar";
import SectionCard from "../components/SectionCard";
import { formatDateTime, formatNumber } from "../format";
import { useAdminResource } from "../hooks/useAdminResource";
import { useDebouncedValue } from "../hooks/useDebouncedValue";
import { ADMIN_CHART_COLORS } from "../theme";
import type { RunRow, RunStatus } from "../types";

const PAGE_SIZE = 25;

const STATUS_OPTIONS: { value: RunStatus | ""; label: string }[] = [
  { value: "", label: "All statuses" },
  { value: "pending", label: "Pending" },
  { value: "running", label: "Running" },
  { value: "completed", label: "Completed" },
  { value: "cancelled", label: "Cancelled" },
  { value: "failed", label: "Failed" },
];

const STATUS_VARIANT: Record<RunStatus, string> = {
  completed: "success",
  failed: "danger",
  cancelled: "secondary",
  running: "primary",
  pending: "warning",
};

// "Is anything stuck right now" — enrichment_runs/enrichment_results already
// carry this data (see AdminOverviewPage's system-health section), but that
// view is aggregate-only. This is the row-level drill-down for support/ops.
export default function AdminRunsPage() {
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<RunStatus | "">("");
  const [searchInput, setSearchInput] = useState("");
  const search = useDebouncedValue(searchInput);

  const kpis = useAdminResource(fetchRunsKpis, []);
  const runs = useAdminResource(
    () => fetchRuns({ page, pageSize: PAGE_SIZE, status: status || undefined, search: search || undefined }),
    [page, status, search],
  );

  function handleSearchChange(value: string) {
    setSearchInput(value);
    setPage(1);
  }

  function handleStatusChange(value: string) {
    setStatus(value as RunStatus | "");
    setPage(1);
  }

  const columns = [
    { key: "email", header: "User", render: (row: RunRow) => <Link to={`/admin/users/${row.user_id}`}>{row.email ?? row.user_id}</Link> },
    { key: "run_type", header: "Type", render: (row: RunRow) => row.run_type },
    {
      key: "status",
      header: "Status",
      render: (row: RunRow) => <Badge bg={STATUS_VARIANT[row.status]}>{row.status}</Badge>,
    },
    {
      key: "delivered",
      header: "Delivered / requested",
      align: "end" as const,
      render: (row: RunRow) => `${formatNumber(row.delivered_count)} / ${formatNumber(row.requested_count)}`,
    },
    {
      key: "credits_charged",
      header: "Credits charged",
      align: "end" as const,
      render: (row: RunRow) => formatNumber(row.credits_charged),
    },
    { key: "created_at", header: "Started", render: (row: RunRow) => formatDateTime(row.created_at) },
    {
      key: "completed_at",
      header: "Completed",
      render: (row: RunRow) => (row.completed_at ? formatDateTime(row.completed_at) : "—"),
    },
  ];

  return (
    <>
      <div className="mb-4">
        <h1 className="h4 mb-1" style={{ color: ADMIN_CHART_COLORS.ink.primary }}>
          Runs
        </h1>
        <p className="mb-0 small" style={{ color: ADMIN_CHART_COLORS.ink.secondary }}>
          Enrichment run queue and outcomes, per user.
        </p>
      </div>

      <div className="row g-3 mb-4">
        <div className="col-6 col-lg-3">
          <KpiTile
            label="Stuck (>1h)"
            value={kpis.data ? formatNumber(kpis.data.stuck_count) : "—"}
            sublabel="Pending or running"
          />
        </div>
        <div className="col-6 col-lg-3">
          <KpiTile label="Failed today" value={kpis.data ? formatNumber(kpis.data.failed_today) : "—"} />
        </div>
        <div className="col-6 col-lg-3">
          <KpiTile label="Completed today" value={kpis.data ? formatNumber(kpis.data.completed_today) : "—"} />
        </div>
        <div className="col-6 col-lg-3">
          <KpiTile label="Total today" value={kpis.data ? formatNumber(kpis.data.total_today) : "—"} />
        </div>
      </div>
      {kpis.error && (
        <div className="small mb-4" style={{ color: ADMIN_CHART_COLORS.status.critical }}>
          {kpis.error}
        </div>
      )}

      <SectionCard
        title="Runs"
        loading={runs.loading}
        error={runs.error}
        action={
          <div className="d-flex gap-2">
            <Form.Select size="sm" value={status} onChange={(e) => handleStatusChange(e.target.value)} style={{ width: 160 }}>
              {STATUS_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </Form.Select>
            <Form.Control
              type="search"
              size="sm"
              placeholder="Search by email…"
              value={searchInput}
              onChange={(e) => handleSearchChange(e.target.value)}
              style={{ maxWidth: 240 }}
            />
          </div>
        }
      >
        {runs.data && (
          <>
            <DataTable
              columns={columns}
              rows={runs.data.rows}
              getRowKey={(row) => row.id}
              emptyMessage={search || status ? "No runs match these filters" : "No runs yet"}
            />
            <PaginationBar page={page} pageSize={PAGE_SIZE} total={runs.data.total} onPageChange={setPage} />
          </>
        )}
      </SectionCard>
    </>
  );
}
