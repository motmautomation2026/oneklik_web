import { useState } from "react";
import { Alert, Badge, Button, Spinner } from "react-bootstrap";
import { Link, useParams } from "react-router-dom";
import { fetchUserDetail, fetchUserLedger, reviewFlaggedAccount } from "../api/adminApi";
import { ACCOUNT_STATUS_VARIANT, FLAGGED_STATUS_VARIANT, LEDGER_TYPE_VARIANT, PAYMENT_STATUS_VARIANT } from "../badgeVariants";
import DataTable from "../components/DataTable";
import KpiTile from "../components/KpiTile";
import ModerationPanel from "../components/ModerationPanel";
import PaginationBar from "../components/PaginationBar";
import SectionCard from "../components/SectionCard";
import { formatDateTime, formatInrFromMinorUnits, formatNumber } from "../format";
import { useAdminResource } from "../hooks/useAdminResource";
import { ADMIN_CHART_COLORS } from "../theme";
import type { LedgerEntry, PaymentRow } from "../types";

const LEDGER_PAGE_SIZE = 25;

export default function AdminUserDetailPage() {
  const { id } = useParams<{ id: string }>();
  const userId = id ?? "";
  const [refetchKey, setRefetchKey] = useState(0);
  const [ledgerPage, setLedgerPage] = useState(1);
  const [reviewingFlagId, setReviewingFlagId] = useState<string | null>(null);

  const detail = useAdminResource(() => fetchUserDetail(userId), [userId, refetchKey]);
  const ledger = useAdminResource(
    () => fetchUserLedger(userId, { page: ledgerPage, pageSize: LEDGER_PAGE_SIZE }),
    [userId, ledgerPage, refetchKey],
  );

  async function handleReview(flagId: string, status: "reviewed" | "dismissed") {
    setReviewingFlagId(flagId);
    try {
      await reviewFlaggedAccount(flagId, status);
      setRefetchKey((k) => k + 1);
    } finally {
      setReviewingFlagId(null);
    }
  }

  const paymentColumns = [
    {
      key: "status",
      header: "Status",
      render: (row: PaymentRow) => <Badge bg={PAYMENT_STATUS_VARIANT[row.status] ?? "secondary"}>{row.status}</Badge>,
    },
    {
      key: "amount",
      header: "Amount",
      align: "end" as const,
      render: (row: PaymentRow) => formatInrFromMinorUnits(row.amount_minor_units),
    },
    {
      key: "credits",
      header: "Credits",
      align: "end" as const,
      render: (row: PaymentRow) => formatNumber(row.credits_promised),
    },
    { key: "gateway", header: "Gateway", render: (row: PaymentRow) => row.gateway },
    { key: "created_at", header: "Created", render: (row: PaymentRow) => formatDateTime(row.created_at) },
  ];

  const ledgerColumns = [
    {
      key: "type",
      header: "Type",
      render: (row: LedgerEntry) => <Badge bg={LEDGER_TYPE_VARIANT[row.type] ?? "secondary"}>{row.type}</Badge>,
    },
    { key: "amount", header: "Amount", align: "end" as const, render: (row: LedgerEntry) => formatNumber(row.amount) },
    {
      key: "balance_after",
      header: "Balance after",
      align: "end" as const,
      render: (row: LedgerEntry) => formatNumber(row.balance_after),
    },
    { key: "reason_code", header: "Reason", render: (row: LedgerEntry) => row.reason_code ?? "—" },
    { key: "created_at", header: "When", render: (row: LedgerEntry) => formatDateTime(row.created_at) },
  ];

  if (detail.loading) {
    return (
      <div className="d-flex justify-content-center py-5">
        <Spinner animation="border" />
      </div>
    );
  }

  if (detail.error || !detail.data) {
    return (
      <div>
        <Link to="/admin/users" className="small">
          &larr; Back to Users
        </Link>
        <Alert variant="danger" className="mt-3">
          {detail.error ?? "User not found"}
        </Alert>
      </div>
    );
  }

  const { user, role, use_case, status_reason, flags, moderation_actions, lists, lists_total, payments, payments_total } =
    detail.data;
  const openFlags = flags.filter((f) => f.status === "open");

  return (
    <>
      <Link to="/admin/users" className="small d-inline-block mb-2">
        &larr; Back to Users
      </Link>

      <div className="mb-4">
        <div className="d-flex align-items-center gap-2 mb-1">
          <h1 className="h4 mb-0" style={{ color: ADMIN_CHART_COLORS.ink.primary }}>
            {user.email ?? user.user_id}
          </h1>
          {user.account_status !== "active" && (
            <Badge bg={ACCOUNT_STATUS_VARIANT[user.account_status] ?? "secondary"}>{user.account_status}</Badge>
          )}
        </div>
        <p className="mb-0 small" style={{ color: ADMIN_CHART_COLORS.ink.secondary }}>
          {user.company ?? "No company"}
          {role ? ` · ${role}` : ""}
          {use_case ? ` · ${use_case}` : ""} · Signed up {formatDateTime(user.created_at)}
        </p>
      </div>

      {openFlags.map((flag) => (
        <Alert key={flag.id} variant="danger" className="d-flex align-items-center justify-content-between gap-3">
          <div>
            <div className="fw-semibold">
              Flagged <Badge bg={FLAGGED_STATUS_VARIANT[flag.status]}>{flag.status}</Badge>
            </div>
            <div className="small">
              {flag.reason} — source: {flag.source} — {formatDateTime(flag.created_at)}
            </div>
          </div>
          <div className="d-flex gap-2 flex-shrink-0">
            <Button
              size="sm"
              variant="outline-secondary"
              disabled={reviewingFlagId === flag.id}
              onClick={() => handleReview(flag.id, "dismissed")}
            >
              Dismiss
            </Button>
            <Button
              size="sm"
              variant="success"
              disabled={reviewingFlagId === flag.id}
              onClick={() => handleReview(flag.id, "reviewed")}
            >
              Mark reviewed
            </Button>
          </div>
        </Alert>
      ))}

      <ModerationPanel
        user={user}
        statusReason={status_reason}
        moderationActions={moderation_actions}
        onChanged={() => setRefetchKey((k) => k + 1)}
      />

      <div className="row g-3 mb-4">
        <div className="col-6 col-lg-3">
          <KpiTile label="Available" value={formatNumber(user.available_balance)} />
        </div>
        <div className="col-6 col-lg-3">
          <KpiTile label="Held" value={formatNumber(user.held_balance)} />
        </div>
        <div className="col-6 col-lg-3">
          <KpiTile label="Lifetime purchased" value={formatNumber(user.lifetime_purchased)} />
        </div>
        <div className="col-6 col-lg-3">
          <KpiTile label="Lifetime consumed" value={formatNumber(user.lifetime_consumed)} />
        </div>
      </div>

      <div className="row g-3 mb-4">
        <div className="col-12 col-xl-6">
          <SectionCard
            title={`Lists (${lists_total})`}
            loading={false}
            error={null}
            action={
              <Link to={`/admin/lists?userId=${encodeURIComponent(userId)}`} className="small">
                View all lists &rarr;
              </Link>
            }
          >
            <DataTable
              columns={[
                { key: "name", header: "Name", render: (row: (typeof lists)[number]) => row.name },
                { key: "kind", header: "Kind", render: (row: (typeof lists)[number]) => row.kind },
                {
                  key: "created_at",
                  header: "Created",
                  render: (row: (typeof lists)[number]) => formatDateTime(row.created_at),
                },
              ]}
              rows={lists}
              getRowKey={(row) => row.id}
              emptyMessage="No lists yet"
            />
            {lists_total > lists.length && (
              <div className="small mt-2" style={{ color: ADMIN_CHART_COLORS.ink.muted }}>
                Showing latest {lists.length} of {lists_total}
              </div>
            )}
          </SectionCard>
        </div>
        <div className="col-12 col-xl-6">
          <SectionCard title={`Payments (${payments_total})`} loading={false} error={null}>
            <DataTable
              columns={paymentColumns}
              rows={payments}
              getRowKey={(row) => row.id}
              emptyMessage="No payments yet"
            />
            {payments_total > payments.length && (
              <div className="small mt-2" style={{ color: ADMIN_CHART_COLORS.ink.muted }}>
                Showing latest {payments.length} of {payments_total}
              </div>
            )}
          </SectionCard>
        </div>
      </div>

      <div className="row g-3 mb-4">
        <div className="col-12">
          <SectionCard title="Credit ledger" loading={ledger.loading} error={ledger.error}>
            {ledger.data && (
              <>
                <DataTable
                  columns={ledgerColumns}
                  rows={ledger.data.rows}
                  getRowKey={(row) => String(row.id)}
                  emptyMessage="No ledger activity"
                />
                <PaginationBar
                  page={ledgerPage}
                  pageSize={LEDGER_PAGE_SIZE}
                  total={ledger.data.total}
                  onPageChange={setLedgerPage}
                />
              </>
            )}
          </SectionCard>
        </div>
      </div>
    </>
  );
}
