import { useState } from "react";
import { Alert, Badge, Button, Spinner } from "react-bootstrap";
import { Link, useParams } from "react-router-dom";
import {
  fetchUserDetail,
  fetchUserLedger,
  openAdminInvoiceHtml,
  reviewFlaggedAccount,
} from "../api/adminApi";
import {
  ACCOUNT_STATUS_VARIANT,
  FLAGGED_STATUS_VARIANT,
  INVOICE_DOC_TYPE_LABEL,
  INVOICE_STATUS_VARIANT,
  LEDGER_TYPE_VARIANT,
  PAYMENT_STATUS_VARIANT,
  SUBSCRIPTION_STATUS_VARIANT,
} from "../badgeVariants";
import DataTable from "../components/DataTable";
import CreditGrantPanel from "../components/CreditGrantPanel";
import KpiTile from "../components/KpiTile";
import ModerationPanel from "../components/ModerationPanel";
import PaginationBar from "../components/PaginationBar";
import SectionCard from "../components/SectionCard";
import { formatDateTime, formatInrFromMinorUnits, formatNumber } from "../format";
import { useAdminResource } from "../hooks/useAdminResource";
import { ADMIN_CHART_COLORS } from "../theme";
import type { AdminInvoiceRow, LedgerEntry, PaymentRow } from "../types";

const LEDGER_PAGE_SIZE = 25;

export default function AdminUserDetailPage() {
  const { id } = useParams<{ id: string }>();
  const userId = id ?? "";
  const [refetchKey, setRefetchKey] = useState(0);
  const [ledgerPage, setLedgerPage] = useState(1);
  const [reviewingFlagId, setReviewingFlagId] = useState<string | null>(null);
  const [invoiceBusyId, setInvoiceBusyId] = useState<string | null>(null);
  const [invoiceError, setInvoiceError] = useState<string | null>(null);

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

  async function handleInvoiceView(
    invoice: AdminInvoiceRow,
    view?: "invoice" | "receipt" | "proforma",
  ) {
    setInvoiceBusyId(invoice.id);
    setInvoiceError(null);
    try {
      await openAdminInvoiceHtml(invoice.id, view);
    } catch (err) {
      setInvoiceError(err instanceof Error ? err.message : "Could not open invoice");
    } finally {
      setInvoiceBusyId(null);
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
    {
      key: "intent",
      header: "Intent",
      render: (row: PaymentRow) => row.billing_intent ?? "—",
    },
    {
      key: "pack",
      header: "Pack",
      render: (row: PaymentRow) => row.pack_id ?? "—",
    },
    { key: "gateway", header: "Gateway", render: (row: PaymentRow) => row.gateway },
    {
      key: "document",
      header: "Document",
      render: (row: PaymentRow) => row.invoice_number ?? "—",
    },
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

  const invoiceColumns = [
    {
      key: "type",
      header: "Type",
      render: (row: AdminInvoiceRow) => INVOICE_DOC_TYPE_LABEL[row.document_type] ?? row.document_type,
    },
    { key: "number", header: "Invoice #", render: (row: AdminInvoiceRow) => row.invoice_number },
    {
      key: "receipt",
      header: "Receipt #",
      render: (row: AdminInvoiceRow) => row.receipt_number ?? "—",
    },
    {
      key: "status",
      header: "Status",
      render: (row: AdminInvoiceRow) => (
        <Badge bg={INVOICE_STATUS_VARIANT[row.status] ?? "secondary"}>{row.status}</Badge>
      ),
    },
    {
      key: "amount",
      header: "Amount",
      align: "end" as const,
      render: (row: AdminInvoiceRow) => formatInrFromMinorUnits(row.total_minor),
    },
    {
      key: "issued",
      header: "Issued",
      render: (row: AdminInvoiceRow) => formatDateTime(row.issued_at),
    },
    {
      key: "actions",
      header: "",
      render: (row: AdminInvoiceRow) => {
        const busy = invoiceBusyId === row.id;
        const isTax = row.document_type === "tax_invoice";
        const isProforma = row.document_type === "proforma_invoice";
        return (
          <div className="d-flex gap-1 justify-content-end flex-wrap">
            {isTax && (
              <>
                <Button
                  size="sm"
                  variant="outline-secondary"
                  disabled={busy}
                  onClick={() => handleInvoiceView(row, "invoice")}
                >
                  Invoice
                </Button>
                <Button
                  size="sm"
                  variant="outline-secondary"
                  disabled={busy}
                  onClick={() => handleInvoiceView(row, "receipt")}
                >
                  Receipt
                </Button>
              </>
            )}
            {isProforma && (
              <Button
                size="sm"
                variant="outline-secondary"
                disabled={busy}
                onClick={() => handleInvoiceView(row, "proforma")}
              >
                Pro forma
              </Button>
            )}
            {!isTax && !isProforma && (
              <Button size="sm" variant="outline-secondary" disabled={busy} onClick={() => handleInvoiceView(row)}>
                View
              </Button>
            )}
          </div>
        );
      },
    },
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

  const {
    user,
    role,
    use_case,
    status_reason,
    flags,
    moderation_actions,
    lists,
    lists_total,
    payments,
    payments_total,
    subscription,
    billing_profile,
    invoices,
  } = detail.data;
  const openFlags = flags.filter((f) => f.status === "open");

  return (
    <>
      <Link to="/admin/users" className="small d-inline-block mb-2">
        &larr; Back to Users
      </Link>

      <div className="mb-4">
        <div className="d-flex align-items-center gap-2 mb-1 flex-wrap">
          <h1 className="h4 mb-0" style={{ color: ADMIN_CHART_COLORS.ink.primary }}>
            {user.email ?? user.user_id}
          </h1>
          {user.account_status !== "active" && (
            <Badge bg={ACCOUNT_STATUS_VARIANT[user.account_status] ?? "secondary"}>{user.account_status}</Badge>
          )}
          {subscription && (
            <>
              <Badge bg="primary">{subscription.plan_name ?? subscription.plan_id}</Badge>
              <Badge bg={SUBSCRIPTION_STATUS_VARIANT[subscription.status] ?? "secondary"}>
                {subscription.status}
              </Badge>
            </>
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

      <CreditGrantPanel
        userId={user.user_id}
        availableBalance={user.available_balance}
        onChanged={() => {
          setLedgerPage(1);
          setRefetchKey((k) => k + 1);
        }}
      />

      <div className="row g-3 mb-4">
        <div className="col-12 col-xl-6">
          <SectionCard title="Subscription" loading={false} error={null}>
            {!subscription ? (
              <div className="small" style={{ color: ADMIN_CHART_COLORS.ink.muted }}>
                No subscription
              </div>
            ) : (
              <dl className="row mb-0 small">
                <dt className="col-sm-4">Plan</dt>
                <dd className="col-sm-8">{subscription.plan_name ?? subscription.plan_id}</dd>
                <dt className="col-sm-4">Status</dt>
                <dd className="col-sm-8">
                  <Badge bg={SUBSCRIPTION_STATUS_VARIANT[subscription.status] ?? "secondary"}>
                    {subscription.status}
                  </Badge>
                  {subscription.is_in_buffer && (
                    <Badge bg="warning" className="ms-2">
                      in buffer
                    </Badge>
                  )}
                </dd>
                <dt className="col-sm-4">Monthly credits</dt>
                <dd className="col-sm-8">
                  {subscription.credits != null ? formatNumber(subscription.credits) : "—"}
                </dd>
                <dt className="col-sm-4">Period</dt>
                <dd className="col-sm-8">
                  {formatDateTime(subscription.current_period_start)} →{" "}
                  {formatDateTime(subscription.current_period_end)}
                </dd>
                <dt className="col-sm-4">Buffer until</dt>
                <dd className="col-sm-8">{formatDateTime(subscription.grace_ends_at)}</dd>
                <dt className="col-sm-4">Pending plan</dt>
                <dd className="col-sm-8">{subscription.pending_plan_id ?? "—"}</dd>
                {subscription.period_change_type && (
                  <>
                    <dt className="col-sm-4">Period change</dt>
                    <dd className="col-sm-8">
                      {subscription.period_change_type}
                      {subscription.period_credits_granted != null
                        ? ` · ${formatNumber(subscription.period_credits_granted)} credits granted`
                        : ""}
                    </dd>
                  </>
                )}
              </dl>
            )}
          </SectionCard>
        </div>
        <div className="col-12 col-xl-6">
          <SectionCard title="Billing profile" loading={false} error={null}>
            {!billing_profile ? (
              <div className="small" style={{ color: ADMIN_CHART_COLORS.ink.muted }}>
                No billing profile
              </div>
            ) : (
              <dl className="row mb-0 small">
                <dt className="col-sm-4">Legal name</dt>
                <dd className="col-sm-8">{billing_profile.legal_name}</dd>
                <dt className="col-sm-4">Entity</dt>
                <dd className="col-sm-8">{billing_profile.entity_type}</dd>
                <dt className="col-sm-4">GSTIN</dt>
                <dd className="col-sm-8">{billing_profile.gstin ?? "—"}</dd>
                <dt className="col-sm-4">Address</dt>
                <dd className="col-sm-8">
                  {billing_profile.address_line1}
                  {billing_profile.address_line2 ? `, ${billing_profile.address_line2}` : ""}
                  <br />
                  {billing_profile.city}, {billing_profile.state_name} ({billing_profile.state_code}){" "}
                  {billing_profile.postal_code}
                  <br />
                  {billing_profile.country}
                </dd>
              </dl>
            )}
          </SectionCard>
        </div>
      </div>

      <div className="row g-3 mb-4">
        <div className="col-12">
          <SectionCard title={`Invoices (${invoices.length})`} loading={false} error={null}>
            {invoiceError && (
              <Alert variant="danger" className="py-2 small" dismissible onClose={() => setInvoiceError(null)}>
                {invoiceError}
              </Alert>
            )}
            <DataTable
              columns={invoiceColumns}
              rows={invoices}
              getRowKey={(row) => row.id}
              emptyMessage="No invoices yet"
            />
          </SectionCard>
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
