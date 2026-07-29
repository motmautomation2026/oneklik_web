import { useState } from "react";
import { Badge, Form } from "react-bootstrap";
import { Link } from "react-router-dom";
import { fetchSubscriptions, fetchSubscriptionsKpis } from "../api/adminApi";
import { SUBSCRIPTION_STATUS_VARIANT } from "../badgeVariants";
import BreakdownBar, { type BreakdownEntry } from "../components/BreakdownBar";
import DataTable from "../components/DataTable";
import KpiTile from "../components/KpiTile";
import PaginationBar from "../components/PaginationBar";
import SectionCard from "../components/SectionCard";
import { formatDateTime, formatInrFromMinorUnits, formatNumber } from "../format";
import { useAdminResource } from "../hooks/useAdminResource";
import { useDebouncedValue } from "../hooks/useDebouncedValue";
import { ADMIN_CHART_COLORS } from "../theme";
import type { AdminSubscriptionRow, SubscriptionStatus } from "../types";

const PAGE_SIZE = 25;

const STATUS_OPTIONS: { value: SubscriptionStatus | ""; label: string }[] = [
  { value: "", label: "All statuses" },
  { value: "active", label: "Active" },
  { value: "past_due", label: "Past due" },
  { value: "expired", label: "Expired" },
  { value: "cancelled", label: "Cancelled" },
];

const PLAN_OPTIONS = [
  { value: "", label: "All plans" },
  { value: "starter", label: "Starter" },
  { value: "growth", label: "Growth" },
  { value: "business", label: "Business" },
];

const PLAN_COLORS: Record<string, string> = {
  starter: ADMIN_CHART_COLORS.categorical.blue,
  growth: ADMIN_CHART_COLORS.categorical.orange,
  business: ADMIN_CHART_COLORS.categorical.aqua,
};

export default function AdminSubscriptionsPage() {
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<SubscriptionStatus | "">("");
  const [planId, setPlanId] = useState("");
  const [lapsingSoon, setLapsingSoon] = useState(false);
  const [searchInput, setSearchInput] = useState("");
  const search = useDebouncedValue(searchInput);

  const kpis = useAdminResource(fetchSubscriptionsKpis, []);
  const subscriptions = useAdminResource(
    (signal) =>
      fetchSubscriptions({
        page,
        pageSize: PAGE_SIZE,
        status: status || undefined,
        planId: planId || undefined,
        search: search || undefined,
        lapsingSoon: lapsingSoon || undefined,
        signal,
      }),
    [page, status, planId, search, lapsingSoon],
  );

  function handleSearchChange(value: string) {
    setSearchInput(value);
    setPage(1);
  }

  const planMixEntries: BreakdownEntry[] = kpis.data
    ? kpis.data.plan_mix.map((p) => ({
        key: p.plan_id,
        label: p.plan_name ?? p.plan_id,
        value: p.count,
        color: PLAN_COLORS[p.plan_id] ?? ADMIN_CHART_COLORS.ink.muted,
      }))
    : [];

  const columns = [
    {
      key: "email",
      header: "User",
      render: (row: AdminSubscriptionRow) => (
        <Link to={`/admin/users/${row.user_id}`}>{row.email ?? row.user_id}</Link>
      ),
    },
    { key: "company", header: "Company", render: (row: AdminSubscriptionRow) => row.company ?? "—" },
    {
      key: "plan",
      header: "Plan",
      render: (row: AdminSubscriptionRow) => row.plan_name ?? row.plan_id,
    },
    {
      key: "status",
      header: "Status",
      render: (row: AdminSubscriptionRow) => (
        <span className="d-inline-flex align-items-center gap-1 flex-wrap">
          <Badge bg={SUBSCRIPTION_STATUS_VARIANT[row.status] ?? "secondary"}>{row.status}</Badge>
          {row.is_in_buffer && <Badge bg="warning">buffer</Badge>}
        </span>
      ),
    },
    {
      key: "period_end",
      header: "Period end",
      render: (row: AdminSubscriptionRow) => formatDateTime(row.current_period_end),
    },
    {
      key: "grace",
      header: "Buffer until",
      render: (row: AdminSubscriptionRow) => formatDateTime(row.grace_ends_at),
    },
    {
      key: "mrr",
      header: "MRR",
      align: "end" as const,
      render: (row: AdminSubscriptionRow) =>
        row.mrr_minor_units > 0 ? formatInrFromMinorUnits(row.mrr_minor_units) : "—",
    },
  ];

  return (
    <>
      <div className="mb-4">
        <h1 className="h4 mb-1" style={{ color: ADMIN_CHART_COLORS.ink.primary }}>
          Subscriptions
        </h1>
        <p className="mb-0 small" style={{ color: ADMIN_CHART_COLORS.ink.secondary }}>
          Plan mix, recurring revenue, and accounts approaching lapse.
        </p>
      </div>

      <div className="row g-3 mb-4">
        <div className="col-6 col-lg">
          <KpiTile
            label="MRR (ex-GST)"
            value={kpis.data ? formatInrFromMinorUnits(kpis.data.mrr_minor_units) : "—"}
            sublabel={kpis.data ? `${formatNumber(kpis.data.paying_count)} paying` : undefined}
          />
        </div>
        <div className="col-6 col-lg">
          <KpiTile
            label="ARR (ex-GST)"
            value={kpis.data ? formatInrFromMinorUnits(kpis.data.arr_minor_units) : "—"}
          />
        </div>
        <div className="col-6 col-lg">
          <KpiTile
            label="Past due"
            value={kpis.data ? formatNumber(kpis.data.past_due_count) : "—"}
          />
        </div>
        <div className="col-6 col-lg">
          <KpiTile
            label="Lapsing soon"
            value={kpis.data ? formatNumber(kpis.data.lapsing_soon_count) : "—"}
            sublabel="Past due or period ends ≤7d"
          />
        </div>
        <div className="col-6 col-lg">
          <KpiTile
            label="Expired"
            value={kpis.data ? formatNumber(kpis.data.expired_count) : "—"}
            sublabel={
              kpis.data ? `${formatNumber(kpis.data.no_subscription_count)} never subscribed` : undefined
            }
          />
        </div>
      </div>
      {kpis.error && (
        <div className="small mb-4" style={{ color: ADMIN_CHART_COLORS.status.critical }}>
          {kpis.error}
        </div>
      )}

      <div className="row g-3 mb-4">
        <div className="col-12 col-lg-6">
          <SectionCard title="Plan mix (paying)" loading={kpis.loading} error={kpis.error}>
            <BreakdownBar entries={planMixEntries} formatValue={(v) => formatNumber(v)} />
            {kpis.data && kpis.data.plan_mix.length > 0 && (
              <div className="small mt-2" style={{ color: ADMIN_CHART_COLORS.ink.secondary }}>
                {kpis.data.plan_mix.map((p) => (
                  <div key={p.plan_id}>
                    {p.plan_name ?? p.plan_id}: {formatNumber(p.count)} ·{" "}
                    {formatInrFromMinorUnits(p.mrr_minor_units)} MRR
                  </div>
                ))}
              </div>
            )}
          </SectionCard>
        </div>
      </div>

      <SectionCard
        title="Directory"
        loading={subscriptions.loading}
        error={subscriptions.error}
        action={
          <div className="d-flex flex-wrap gap-2 align-items-center">
            <Form.Control
              size="sm"
              style={{ width: 200 }}
              placeholder="Search email…"
              value={searchInput}
              onChange={(e) => handleSearchChange(e.target.value)}
            />
            <Form.Select
              size="sm"
              style={{ width: 140 }}
              value={status}
              onChange={(e) => {
                setStatus(e.target.value as SubscriptionStatus | "");
                setPage(1);
              }}
            >
              {STATUS_OPTIONS.map((o) => (
                <option key={o.value || "all"} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Form.Select>
            <Form.Select
              size="sm"
              style={{ width: 130 }}
              value={planId}
              onChange={(e) => {
                setPlanId(e.target.value);
                setPage(1);
              }}
            >
              {PLAN_OPTIONS.map((o) => (
                <option key={o.value || "all"} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Form.Select>
            <Form.Check
              type="checkbox"
              id="lapsing-soon"
              label="Lapsing soon"
              checked={lapsingSoon}
              onChange={(e) => {
                setLapsingSoon(e.target.checked);
                setPage(1);
              }}
              className="small mb-0"
            />
          </div>
        }
      >
        {subscriptions.data && (
          <>
            <DataTable
              columns={columns}
              rows={subscriptions.data.rows}
              getRowKey={(row) => row.user_id}
              emptyMessage="No subscriptions match"
            />
            <PaginationBar
              page={page}
              pageSize={PAGE_SIZE}
              total={subscriptions.data.total}
              onPageChange={setPage}
            />
          </>
        )}
      </SectionCard>
    </>
  );
}
