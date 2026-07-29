import { useState } from "react";
import { Badge, Button, Form } from "react-bootstrap";
import { Link, useSearchParams } from "react-router-dom";
import {
  exportTransactionsCsv,
  fetchTransactions,
  fetchTransactionsKpis,
  openAdminInvoiceHtml,
} from "../api/adminApi";
import { PAYMENT_STATUS_VARIANT } from "../badgeVariants";
import DataTable from "../components/DataTable";
import KpiTile from "../components/KpiTile";
import PaginationBar from "../components/PaginationBar";
import SectionCard from "../components/SectionCard";
import { formatDateTime, formatInrFromMinorUnits, formatNumber } from "../format";
import { useAdminResource } from "../hooks/useAdminResource";
import { useDebouncedValue } from "../hooks/useDebouncedValue";
import { ADMIN_CHART_COLORS } from "../theme";
import type { PaymentRow, PaymentStatus } from "../types";

const PAGE_SIZE = 25;

const STATUS_OPTIONS: { value: PaymentStatus | ""; label: string }[] = [
  { value: "", label: "All statuses" },
  { value: "success", label: "Success" },
  { value: "pending", label: "Pending" },
  { value: "initiated", label: "Initiated" },
  { value: "failed", label: "Failed" },
];

export default function AdminTransactionsPage() {
  const [searchParams] = useSearchParams();
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<PaymentStatus | "">("");
  const [searchInput, setSearchInput] = useState(() => searchParams.get("search") ?? "");
  const search = useDebouncedValue(searchInput);
  const [exporting, setExporting] = useState(false);
  const [docBusyId, setDocBusyId] = useState<string | null>(null);

  // Deliberately keyed on `search` only, not `status` — matches the
  // backend's scoping (see getTransactionsKpis): the status dropdown keeps
  // filtering the table below without re-scoping the KPI row above it.
  const kpis = useAdminResource(() => fetchTransactionsKpis({ search: search || undefined }), [search]);
  const transactions = useAdminResource(
    () => fetchTransactions({ page, pageSize: PAGE_SIZE, status: status || undefined, search: search || undefined }),
    [page, status, search],
  );

  function handleSearchChange(value: string) {
    setSearchInput(value);
    setPage(1);
  }

  function handleStatusChange(value: string) {
    setStatus(value as PaymentStatus | "");
    setPage(1);
  }

  async function handleExport() {
    setExporting(true);
    try {
      await exportTransactionsCsv({ status: status || undefined, search: search || undefined });
    } finally {
      setExporting(false);
    }
  }

  async function handleOpenDocument(row: PaymentRow, view: "invoice" | "receipt") {
    if (!row.invoice_id) return;
    setDocBusyId(row.id);
    try {
      await openAdminInvoiceHtml(row.invoice_id, view);
    } finally {
      setDocBusyId(null);
    }
  }

  const columns = [
    {
      key: "email",
      header: "User",
      render: (row: PaymentRow) => (
        <Link to={`/admin/users/${row.user_id}`}>{row.email ?? row.user_id}</Link>
      ),
    },
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
    {
      key: "gateway_payment_id",
      header: "Gateway payment id",
      render: (row: PaymentRow) => row.gateway_payment_id ?? "—",
    },
    {
      key: "document",
      header: "Document",
      render: (row: PaymentRow) => {
        if (!row.invoice_id || !row.invoice_number) {
          return <span style={{ color: ADMIN_CHART_COLORS.ink.muted }}>—</span>;
        }
        return (
          <div className="d-flex align-items-center gap-2 flex-wrap">
            <div className="small">
              <div>{row.invoice_number}</div>
              {row.receipt_number && (
                <div style={{ color: ADMIN_CHART_COLORS.ink.muted }}>{row.receipt_number}</div>
              )}
            </div>
            <Button
              size="sm"
              variant="outline-secondary"
              disabled={docBusyId === row.id}
              onClick={() => handleOpenDocument(row, "invoice")}
            >
              Invoice
            </Button>
            {row.receipt_number && (
              <Button
                size="sm"
                variant="outline-secondary"
                disabled={docBusyId === row.id}
                onClick={() => handleOpenDocument(row, "receipt")}
              >
                Receipt
              </Button>
            )}
          </div>
        );
      },
    },
    { key: "created_at", header: "Created", render: (row: PaymentRow) => formatDateTime(row.created_at) },
    { key: "updated_at", header: "Updated", render: (row: PaymentRow) => formatDateTime(row.updated_at) },
  ];

  return (
    <>
      <div className="mb-4">
        <h1 className="h4 mb-1" style={{ color: ADMIN_CHART_COLORS.ink.primary }}>
          Transactions
        </h1>
        <p className="mb-0 small" style={{ color: ADMIN_CHART_COLORS.ink.secondary }}>
          Full Razorpay payment ledger, filterable by status.
        </p>
      </div>

      <div className="row g-3 mb-4">
        <div className="col-6 col-lg-3">
          <KpiTile
            label="Revenue (this view)"
            value={kpis.data ? formatInrFromMinorUnits(kpis.data.revenue_minor_units) : "—"}
            sublabel={search ? "Scoped by search" : "All transactions"}
          />
        </div>
        <div className="col-6 col-lg-3">
          <KpiTile
            label="Success rate"
            value={kpis.data ? `${Math.round(kpis.data.success_rate * 100)}%` : "—"}
            sublabel={kpis.data ? `${formatNumber(kpis.data.total_count)} total` : undefined}
          />
        </div>
        <div className="col-6 col-lg-3">
          <KpiTile
            label="Avg. successful amount"
            value={kpis.data ? formatInrFromMinorUnits(kpis.data.avg_amount_minor_units) : "—"}
            sublabel={kpis.data ? `${formatNumber(kpis.data.success_count)} succeeded` : undefined}
          />
        </div>
        <div className="col-6 col-lg-3">
          <KpiTile
            label="Failed / pending"
            value={kpis.data ? `${formatNumber(kpis.data.failed_count)} / ${formatNumber(kpis.data.pending_count)}` : "—"}
            sublabel={kpis.data ? `${formatNumber(kpis.data.initiated_count)} initiated` : undefined}
          />
        </div>
      </div>
      {kpis.error && (
        <div className="small mb-4" style={{ color: ADMIN_CHART_COLORS.status.critical }}>
          {kpis.error}
        </div>
      )}

      <SectionCard
        title="Payments"
        loading={transactions.loading}
        error={transactions.error}
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
              placeholder="Search email or payment id…"
              value={searchInput}
              onChange={(e) => handleSearchChange(e.target.value)}
              style={{ maxWidth: 260 }}
            />
            <Button size="sm" variant="outline-secondary" disabled={exporting} onClick={handleExport}>
              {exporting ? "Exporting…" : "Export CSV"}
            </Button>
          </div>
        }
      >
        {transactions.data && (
          <>
            <DataTable
              columns={columns}
              rows={transactions.data.rows}
              getRowKey={(row) => row.id}
              emptyMessage={search || status ? "No transactions match these filters" : "No transactions yet"}
            />
            <PaginationBar page={page} pageSize={PAGE_SIZE} total={transactions.data.total} onPageChange={setPage} />
          </>
        )}
      </SectionCard>
    </>
  );
}
