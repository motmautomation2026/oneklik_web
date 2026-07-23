import { useState } from "react";
import { Badge, ButtonGroup, ToggleButton } from "react-bootstrap";
import { Link } from "react-router-dom";
import {
  fetchAdmins,
  fetchFeatureUsage,
  fetchFunnel,
  fetchListsActivity,
  fetchOverview,
  fetchRunsKpis,
  fetchSystemHealth,
  fetchTrends,
  fetchUseCaseBreakdown,
} from "../api/adminApi";
import BreakdownBar, { type BreakdownEntry } from "../components/BreakdownBar";
import DataTable from "../components/DataTable";
import FunnelChart from "../components/FunnelChart";
import KpiTile from "../components/KpiTile";
import SectionCard from "../components/SectionCard";
import TrendChart from "../components/TrendChart";
import { formatDateTime, formatInrFromMinorUnits, formatNumber } from "../format";
import { useAdminResource } from "../hooks/useAdminResource";
import { ADMIN_CHART_COLORS } from "../theme";
import type { ProviderHealth, RunStatus, TrendRunType } from "../types";

const DAY_RANGES = [7, 30, 90] as const;
type DayRange = (typeof DAY_RANGES)[number];

// Provider names are dynamic (whatever the top-N happen to be), so this
// can't be a fixed interface — a named `date` plus a string index signature
// covering the per-provider percentage columns TrendChart plots.
interface ProviderTrendRow {
  date: string;
  [provider: string]: string | number;
}

const RUN_STATUS_LABELS: Record<RunStatus, string> = {
  completed: "Completed",
  failed: "Failed",
  cancelled: "Cancelled",
  running: "Running",
  pending: "Pending",
};

const RUN_STATUS_COLORS: Record<RunStatus, string> = {
  completed: ADMIN_CHART_COLORS.status.good,
  failed: ADMIN_CHART_COLORS.status.critical,
  cancelled: ADMIN_CHART_COLORS.status.warning,
  running: ADMIN_CHART_COLORS.categorical.blue,
  pending: ADMIN_CHART_COLORS.ink.muted,
};

const FEATURE_LABELS: Record<TrendRunType, string> = {
  company_search: "Company search",
  people_search: "People search",
  email_enrich: "Email reveal",
  mobile_enrich: "Phone reveal",
};

const FEATURE_COLORS: Record<TrendRunType, string> = {
  company_search: ADMIN_CHART_COLORS.categorical.blue,
  people_search: ADMIN_CHART_COLORS.categorical.orange,
  email_enrich: ADMIN_CHART_COLORS.categorical.aqua,
  mobile_enrich: ADMIN_CHART_COLORS.categorical.yellow,
};

// Fixed order, per the dataviz skill's categorical rule — cycled across
// however many use-case buckets exist (5 fixed options + "Not set").
const USE_CASE_COLOR_CYCLE = [
  ADMIN_CHART_COLORS.categorical.blue,
  ADMIN_CHART_COLORS.categorical.orange,
  ADMIN_CHART_COLORS.categorical.aqua,
  ADMIN_CHART_COLORS.categorical.yellow,
  ADMIN_CHART_COLORS.categorical.magenta,
  ADMIN_CHART_COLORS.categorical.green,
];

const PROVIDER_TREND_COLOR_CYCLE = [
  ADMIN_CHART_COLORS.categorical.blue,
  ADMIN_CHART_COLORS.categorical.orange,
  ADMIN_CHART_COLORS.categorical.aqua,
  ADMIN_CHART_COLORS.categorical.yellow,
];

function providerStatus(errorRate: number): { label: string; variant: string } {
  if (errorRate >= 0.25) return { label: "Critical", variant: "danger" };
  if (errorRate >= 0.1) return { label: "Degraded", variant: "warning" };
  return { label: "Healthy", variant: "success" };
}

export default function AdminOverviewPage() {
  const [days, setDays] = useState<DayRange>(30);

  const overview = useAdminResource(fetchOverview, []);
  const trends = useAdminResource(() => fetchTrends(days), [days]);
  const funnel = useAdminResource(fetchFunnel, []);
  const health = useAdminResource(() => fetchSystemHealth(days), [days]);
  const featureUsage = useAdminResource(() => fetchFeatureUsage(days), [days]);
  const listsActivity = useAdminResource(fetchListsActivity, []);
  const useCaseBreakdown = useAdminResource(fetchUseCaseBreakdown, []);
  const runsKpis = useAdminResource(fetchRunsKpis, []);
  const admins = useAdminResource(fetchAdmins, []);

  const providerColumns = [
    { key: "provider", header: "Provider", render: (row: ProviderHealth) => row.provider },
    { key: "total", header: "Requests", align: "end" as const, render: (row: ProviderHealth) => formatNumber(row.total) },
    {
      key: "error_rate",
      header: "Error rate",
      align: "end" as const,
      render: (row: ProviderHealth) => `${(row.error_rate * 100).toFixed(1)}%`,
    },
    {
      key: "latency",
      header: "Avg latency",
      align: "end" as const,
      render: (row: ProviderHealth) => (row.avg_latency_ms != null ? `${formatNumber(row.avg_latency_ms)} ms` : "—"),
    },
    {
      key: "status",
      header: "Status",
      render: (row: ProviderHealth) => {
        const s = providerStatus(row.error_rate);
        return <Badge bg={s.variant}>{s.label}</Badge>;
      },
    },
  ];

  const runStatusEntries: BreakdownEntry[] = health.data
    ? (Object.keys(RUN_STATUS_LABELS) as RunStatus[]).map((status) => ({
        key: status,
        label: RUN_STATUS_LABELS[status],
        value: health.data!.run_status_counts[status] ?? 0,
        color: RUN_STATUS_COLORS[status],
      }))
    : [];

  const featureEntries: BreakdownEntry[] = featureUsage.data
    ? featureUsage.data.usage.map((u) => ({
        key: u.run_type,
        label: FEATURE_LABELS[u.run_type],
        value: u.credits,
        color: FEATURE_COLORS[u.run_type],
      }))
    : [];

  const useCaseEntries: BreakdownEntry[] = useCaseBreakdown.data
    ? useCaseBreakdown.data.breakdown.map((u, i) => ({
        key: u.use_case,
        label: u.use_case,
        value: u.count,
        color: USE_CASE_COLOR_CYCLE[i % USE_CASE_COLOR_CYCLE.length],
      }))
    : [];

  const topProviderNames = health.data?.provider_error_trend[0] ? Object.keys(health.data.provider_error_trend[0].rates) : [];
  const providerTrendData: ProviderTrendRow[] = health.data
    ? health.data.provider_error_trend.map((point) => {
        const row: ProviderTrendRow = { date: point.date };
        for (const provider of topProviderNames) row[provider] = (point.rates[provider] ?? 0) * 100;
        return row;
      })
    : [];
  const providerTrendSeries = topProviderNames.map((provider, i) => ({
    key: provider,
    label: provider,
    color: PROVIDER_TREND_COLOR_CYCLE[i % PROVIDER_TREND_COLOR_CYCLE.length],
  }));

  return (
    <>
      <div className="d-flex align-items-start justify-content-between flex-wrap gap-2 mb-4">
        <div>
          <h1 className="h4 mb-1" style={{ color: ADMIN_CHART_COLORS.ink.primary }}>
            Dashboard
          </h1>
          <p className="mb-0 small" style={{ color: ADMIN_CHART_COLORS.ink.secondary }}>
            Analytics and system health monitoring.
          </p>
        </div>
        <ButtonGroup size="sm">
          {DAY_RANGES.map((range) => (
            <ToggleButton
              key={range}
              id={`day-range-${range}`}
              name="day-range"
              type="radio"
              variant="outline-primary"
              checked={days === range}
              value={range}
              onChange={() => setDays(range)}
            >
              {range}d
            </ToggleButton>
          ))}
        </ButtonGroup>
      </div>

      {/* KPI tiles */}
      <div className="row g-3 mb-4">
        <div className="col-6 col-lg-3">
          <KpiTile
            label="Total signups"
            value={overview.data ? formatNumber(overview.data.users.total_signups) : "—"}
            sublabel={overview.data ? `${formatNumber(overview.data.users.onboarded)} onboarded` : undefined}
          />
        </div>
        <div className="col-6 col-lg-3">
          <KpiTile
            label="Revenue (all time)"
            value={overview.data ? formatInrFromMinorUnits(overview.data.revenue.all_time_minor_units) : "—"}
            sublabel={
              overview.data
                ? `${formatInrFromMinorUnits(overview.data.revenue.month_to_date_minor_units)} this month`
                : undefined
            }
          />
        </div>
        <div className="col-6 col-lg-3">
          <KpiTile
            label="Credits consumed"
            value={overview.data ? formatNumber(overview.data.credits.consumed) : "—"}
            sublabel={overview.data ? `${formatNumber(overview.data.credits.held)} currently held` : undefined}
          />
        </div>
        <div className="col-6 col-lg-3">
          <KpiTile
            label="Active users (30d)"
            value={overview.data ? formatNumber(overview.data.active_users.last_30d) : "—"}
            sublabel={overview.data ? `${formatNumber(overview.data.active_users.last_7d)} in last 7d` : undefined}
          />
        </div>
      </div>
      {overview.error && (
        <div className="small mb-4" style={{ color: ADMIN_CHART_COLORS.status.critical }}>
          {overview.error}
        </div>
      )}

      {/* Trends */}
      <div className="row g-3 mb-4">
        <div className="col-12">
          <SectionCard title="Trends" loading={trends.loading} error={trends.error}>
            {trends.data && (
              <div className="row g-3">
                <div className="col-12 col-lg-4">
                  <div className="small mb-1" style={{ color: ADMIN_CHART_COLORS.ink.secondary }}>
                    Signups
                  </div>
                  <TrendChart
                    data={trends.data.trends}
                    series={[{ key: "signups", label: "Signups", color: ADMIN_CHART_COLORS.categorical.blue }]}
                    height={200}
                  />
                </div>
                <div className="col-12 col-lg-4">
                  <div className="small mb-1" style={{ color: ADMIN_CHART_COLORS.ink.secondary }}>
                    Revenue
                  </div>
                  <TrendChart
                    data={trends.data.trends.map((t) => ({ date: t.date, revenue: t.revenue_minor_units / 100 }))}
                    series={[{ key: "revenue", label: "Revenue", color: ADMIN_CHART_COLORS.categorical.aqua }]}
                    valueFormatter={(v) => `₹${formatNumber(Math.round(v))}`}
                    height={200}
                  />
                </div>
                <div className="col-12 col-lg-4">
                  <div className="small mb-1" style={{ color: ADMIN_CHART_COLORS.ink.secondary }}>
                    Credits consumed by type
                  </div>
                  <TrendChart
                    data={trends.data.trends.map((t) => ({
                      date: t.date,
                      company_search: t.credits_consumed.company_search,
                      people_search: t.credits_consumed.people_search,
                      email_enrich: t.credits_consumed.email_enrich,
                      mobile_enrich: t.credits_consumed.mobile_enrich,
                    }))}
                    series={[
                      { key: "company_search", label: "Company search", color: ADMIN_CHART_COLORS.categorical.blue },
                      { key: "people_search", label: "People search", color: ADMIN_CHART_COLORS.categorical.orange },
                      { key: "email_enrich", label: "Email reveal", color: ADMIN_CHART_COLORS.categorical.aqua },
                      { key: "mobile_enrich", label: "Phone reveal", color: ADMIN_CHART_COLORS.categorical.yellow },
                    ]}
                    height={200}
                  />
                </div>
              </div>
            )}
          </SectionCard>
        </div>
      </div>

      {/* Feature usage + Lists activity */}
      <div className="row g-3 mb-4">
        <div className="col-12 col-xl-6">
          <SectionCard title="Feature usage" loading={featureUsage.loading} error={featureUsage.error}>
            {featureUsage.data && <BreakdownBar entries={featureEntries} formatValue={formatNumber} />}
          </SectionCard>
        </div>
        <div className="col-12 col-xl-6">
          <SectionCard title="Lists activity" loading={listsActivity.loading} error={listsActivity.error}>
            {listsActivity.data && (
              <div className="row g-3">
                <div className="col-6">
                  <KpiTile label="Total lists" value={formatNumber(listsActivity.data.total_lists)} />
                </div>
                <div className="col-6">
                  <KpiTile label="Total rows" value={formatNumber(listsActivity.data.total_list_items)} />
                </div>
                <div className="col-6">
                  <KpiTile label="Created this week" value={formatNumber(listsActivity.data.lists_this_week)} />
                </div>
                <div className="col-6">
                  <KpiTile label="Avg list size" value={formatNumber(listsActivity.data.avg_list_size)} />
                </div>
              </div>
            )}
          </SectionCard>
        </div>
      </div>

      {/* Users by use case */}
      <div className="row g-3 mb-4">
        <div className="col-12">
          <SectionCard title="Users by use case" loading={useCaseBreakdown.loading} error={useCaseBreakdown.error}>
            {useCaseBreakdown.data && <BreakdownBar entries={useCaseEntries} formatValue={formatNumber} />}
          </SectionCard>
        </div>
      </div>

      {/* System health */}
      <div className="row g-3 mb-4">
        <div className="col-6 col-lg-3">
          <KpiTile
            label="Stuck runs"
            value={runsKpis.data ? formatNumber(runsKpis.data.stuck_count) : "—"}
            sublabel="Pending/running over 1h"
          />
          <Link to="/admin/runs" className="small d-inline-block mt-1">
            View runs &rarr;
          </Link>
        </div>
      </div>

      <div className="row g-3 mb-4">
        <div className="col-12 col-xl-5">
          <SectionCard title="Run outcomes" loading={health.loading} error={health.error}>
            {health.data && (
              <>
                <BreakdownBar entries={runStatusEntries} formatValue={formatNumber} />
                <div className="mt-3 small" style={{ color: ADMIN_CHART_COLORS.ink.muted }}>
                  {formatNumber(health.data.open_flagged_accounts)} open flagged account
                  {health.data.open_flagged_accounts === 1 ? "" : "s"} — see a user's page for detail.
                </div>
              </>
            )}
          </SectionCard>
        </div>
        <div className="col-12 col-xl-7">
          <SectionCard title="Provider health" loading={health.loading} error={health.error}>
            {health.data && (
              <DataTable
                columns={providerColumns}
                rows={health.data.providers}
                getRowKey={(row) => row.provider}
                emptyMessage="No provider activity in this range"
              />
            )}
          </SectionCard>
        </div>
      </div>

      {/* Provider error-rate trend */}
      <div className="row g-3 mb-4">
        <div className="col-12">
          <SectionCard title="Provider error rate over time" loading={health.loading} error={health.error}>
            {health.data &&
              (providerTrendSeries.length > 0 ? (
                <TrendChart
                  data={providerTrendData}
                  series={providerTrendSeries}
                  valueFormatter={(v) => `${v.toFixed(1)}%`}
                  height={220}
                />
              ) : (
                <div className="small" style={{ color: ADMIN_CHART_COLORS.ink.muted }}>
                  No provider activity in this range
                </div>
              ))}
          </SectionCard>
        </div>
      </div>

      {/* Funnel */}
      <div className="row g-3 mb-4">
        <div className="col-12">
          <SectionCard title="Signup → paid funnel" loading={funnel.loading} error={funnel.error}>
            {funnel.data && <FunnelChart funnel={funnel.data} />}
          </SectionCard>
        </div>
      </div>

      {/* Admins — read-only visibility; granting/revoking stays service-role-only */}
      <div className="row g-3 mb-4">
        <div className="col-12">
          <SectionCard title="Admins" loading={admins.loading} error={admins.error}>
            {admins.data && (
              <DataTable
                columns={[
                  { key: "email", header: "Email", render: (row) => row.email ?? row.user_id },
                  { key: "created_at", header: "Admin since", render: (row) => formatDateTime(row.created_at) },
                ]}
                rows={admins.data.admins}
                getRowKey={(row) => row.user_id}
                emptyMessage="No admin accounts found"
              />
            )}
          </SectionCard>
        </div>
      </div>
    </>
  );
}
