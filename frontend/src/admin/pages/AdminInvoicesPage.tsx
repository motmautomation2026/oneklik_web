import { useState } from "react";
import { Badge, Button, Form } from "react-bootstrap";
import { Link } from "react-router-dom";
import {
  exportInvoicesCsv,
  fetchInvoices,
  fetchInvoicesKpis,
  openAdminInvoiceHtml,
} from "../api/adminApi";
import { INVOICE_DOC_TYPE_LABEL, INVOICE_STATUS_VARIANT } from "../badgeVariants";
import DataTable from "../components/DataTable";
import KpiTile from "../components/KpiTile";
import PaginationBar from "../components/PaginationBar";
import SectionCard from "../components/SectionCard";
import { formatDateTime, formatInrFromMinorUnits, formatNumber } from "../format";
import { useAdminResource } from "../hooks/useAdminResource";
import { useDebouncedValue } from "../hooks/useDebouncedValue";
import { ADMIN_CHART_COLORS } from "../theme";
import type { AdminInvoiceListRow, InvoiceDocumentType, InvoiceStatus } from "../types";

const PAGE_SIZE = 25;

const DOC_TYPE_OPTIONS: { value: InvoiceDocumentType | ""; label: string }[] = [
  { value: "", label: "All types" },
  { value: "tax_invoice", label: "Tax invoice" },
  { value: "proforma_invoice", label: "Pro forma" },
  { value: "credit_note", label: "Credit note" },
];

const STATUS_OPTIONS: { value: InvoiceStatus | ""; label: string }[] = [
  { value: "", label: "All statuses" },
  { value: "paid", label: "Paid" },
  { value: "issued", label: "Issued" },
  { value: "void", label: "Void" },
  { value: "cancelled", label: "Cancelled" },
];

const PLAN_OPTIONS = [
  { value: "", label: "All plans" },
  { value: "starter", label: "Starter" },
  { value: "growth", label: "Growth" },
  { value: "business", label: "Business" },
];

function gstTotalMinor(row: AdminInvoiceListRow): number {
  return row.cgst_minor + row.sgst_minor + row.igst_minor;
}

export default function AdminInvoicesPage() {
  const [page, setPage] = useState(1);
  const [documentType, setDocumentType] = useState<InvoiceDocumentType | "">("");
  const [status, setStatus] = useState<InvoiceStatus | "">("");
  const [planId, setPlanId] = useState("");
  const [financialYear, setFinancialYear] = useState("");
  const [issuedFrom, setIssuedFrom] = useState("");
  const [issuedTo, setIssuedTo] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const search = useDebouncedValue(searchInput);
  const [exporting, setExporting] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const kpis = useAdminResource(fetchInvoicesKpis, []);
  const invoices = useAdminResource(
    (signal) =>
      fetchInvoices({
        page,
        pageSize: PAGE_SIZE,
        documentType: documentType || undefined,
        status: status || undefined,
        search: search || undefined,
        planId: planId || undefined,
        financialYear: financialYear.trim() || undefined,
        issuedFrom: issuedFrom || undefined,
        issuedTo: issuedTo ? `${issuedTo}T23:59:59.999Z` : undefined,
        signal,
      }),
    [page, documentType, status, search, planId, financialYear, issuedFrom, issuedTo],
  );

  function resetPage() {
    setPage(1);
  }

  async function handleExport() {
    setExporting(true);
    try {
      await exportInvoicesCsv({
        documentType: documentType || undefined,
        status: status || undefined,
        search: search || undefined,
        planId: planId || undefined,
        financialYear: financialYear.trim() || undefined,
        issuedFrom: issuedFrom || undefined,
        issuedTo: issuedTo ? `${issuedTo}T23:59:59.999Z` : undefined,
      });
    } finally {
      setExporting(false);
    }
  }

  async function handleOpen(row: AdminInvoiceListRow, view?: string) {
    setBusyId(row.id);
    setActionError(null);
    try {
      await openAdminInvoiceHtml(row.id, view);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Could not open document");
    } finally {
      setBusyId(null);
    }
  }

  const columns = [
    {
      key: "issued",
      header: "Issued",
      render: (row: AdminInvoiceListRow) => formatDateTime(row.issued_at),
    },
    {
      key: "type",
      header: "Type",
      render: (row: AdminInvoiceListRow) => (
        <Badge bg="secondary">{INVOICE_DOC_TYPE_LABEL[row.document_type] ?? row.document_type}</Badge>
      ),
    },
    {
      key: "numbers",
      header: "Numbers",
      render: (row: AdminInvoiceListRow) => (
        <div className="small">
          <div>{row.invoice_number}</div>
          {row.receipt_number && (
            <div style={{ color: ADMIN_CHART_COLORS.ink.muted }}>{row.receipt_number}</div>
          )}
        </div>
      ),
    },
    {
      key: "buyer",
      header: "Buyer",
      render: (row: AdminInvoiceListRow) => (
        <div className="small">
          <Link to={`/admin/users/${row.user_id}`}>{row.email ?? row.user_id}</Link>
          {row.buyer_legal_name && (
            <div style={{ color: ADMIN_CHART_COLORS.ink.muted }}>{row.buyer_legal_name}</div>
          )}
        </div>
      ),
    },
    {
      key: "status",
      header: "Status",
      render: (row: AdminInvoiceListRow) => (
        <Badge bg={INVOICE_STATUS_VARIANT[row.status] ?? "secondary"}>{row.status}</Badge>
      ),
    },
    {
      key: "plan",
      header: "Plan",
      render: (row: AdminInvoiceListRow) => (
        <div className="small">
          <div>{row.plan_name ?? row.pack_id ?? "—"}</div>
          {row.billing_intent && (
            <div style={{ color: ADMIN_CHART_COLORS.ink.muted }}>{row.billing_intent}</div>
          )}
        </div>
      ),
    },
    {
      key: "taxable",
      header: "Taxable",
      align: "end" as const,
      render: (row: AdminInvoiceListRow) => formatInrFromMinorUnits(row.taxable_value_minor),
    },
    {
      key: "gst",
      header: "GST",
      align: "end" as const,
      render: (row: AdminInvoiceListRow) => formatInrFromMinorUnits(gstTotalMinor(row)),
    },
    {
      key: "total",
      header: "Total",
      align: "end" as const,
      render: (row: AdminInvoiceListRow) => formatInrFromMinorUnits(row.total_minor),
    },
    {
      key: "actions",
      header: "",
      render: (row: AdminInvoiceListRow) => {
        const busy = busyId === row.id;
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
                  onClick={() => handleOpen(row, "invoice")}
                >
                  Invoice
                </Button>
                <Button
                  size="sm"
                  variant="outline-secondary"
                  disabled={busy}
                  onClick={() => handleOpen(row, "receipt")}
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
                onClick={() => handleOpen(row, "proforma")}
              >
                Pro forma
              </Button>
            )}
            {!isTax && !isProforma && (
              <Button size="sm" variant="outline-secondary" disabled={busy} onClick={() => handleOpen(row)}>
                View
              </Button>
            )}
          </div>
        );
      },
    },
  ];

  const hasFilters = Boolean(documentType || status || search || planId || financialYear || issuedFrom || issuedTo);

  return (
    <>
      <div className="mb-4">
        <h1 className="h4 mb-1" style={{ color: ADMIN_CHART_COLORS.ink.primary }}>
          Receipts &amp; Invoices
        </h1>
        <p className="mb-0 small" style={{ color: ADMIN_CHART_COLORS.ink.secondary }}>
          GST tax invoices, payment receipts, and open pro formas.
        </p>
      </div>

      <div className="row g-3 mb-4">
        <div className="col-6 col-lg-3">
          <KpiTile
            label="Tax invoices (MTD)"
            value={kpis.data ? formatNumber(kpis.data.tax_invoice_count_mtd) : "—"}
            sublabel={
              kpis.data
                ? `${formatInrFromMinorUnits(kpis.data.total_minor_mtd)} · ${formatNumber(kpis.data.tax_invoice_count_all)} all-time`
                : undefined
            }
          />
        </div>
        <div className="col-6 col-lg-3">
          <KpiTile
            label="Taxable / GST (MTD)"
            value={kpis.data ? formatInrFromMinorUnits(kpis.data.taxable_minor_mtd) : "—"}
            sublabel={
              kpis.data
                ? `GST ${formatInrFromMinorUnits(kpis.data.gst_minor_mtd)} · CGST ${formatInrFromMinorUnits(kpis.data.cgst_minor_mtd)} / SGST ${formatInrFromMinorUnits(kpis.data.sgst_minor_mtd)} / IGST ${formatInrFromMinorUnits(kpis.data.igst_minor_mtd)}`
                : undefined
            }
          />
        </div>
        <div className="col-6 col-lg-3">
          <KpiTile
            label="Open pro formas"
            value={kpis.data ? formatNumber(kpis.data.open_proforma_count) : "—"}
            sublabel={
              kpis.data ? `${formatInrFromMinorUnits(kpis.data.open_proforma_total_minor)} due` : undefined
            }
          />
        </div>
        <div className="col-6 col-lg-3">
          <KpiTile
            label="Success w/o invoice"
            value={kpis.data ? formatNumber(kpis.data.success_without_invoice_count) : "—"}
            sublabel="Orphan payment risk"
          />
        </div>
      </div>
      {kpis.error && (
        <div className="small mb-4" style={{ color: ADMIN_CHART_COLORS.status.critical }}>
          {kpis.error}
        </div>
      )}

      <SectionCard
        title="Documents"
        loading={invoices.loading}
        error={invoices.error}
        action={
          <div className="d-flex gap-2 flex-wrap justify-content-end">
            <Form.Select
              size="sm"
              value={documentType}
              onChange={(e) => {
                setDocumentType(e.target.value as InvoiceDocumentType | "");
                resetPage();
              }}
              style={{ width: 140 }}
            >
              {DOC_TYPE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </Form.Select>
            <Form.Select
              size="sm"
              value={status}
              onChange={(e) => {
                setStatus(e.target.value as InvoiceStatus | "");
                resetPage();
              }}
              style={{ width: 130 }}
            >
              {STATUS_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </Form.Select>
            <Form.Select
              size="sm"
              value={planId}
              onChange={(e) => {
                setPlanId(e.target.value);
                resetPage();
              }}
              style={{ width: 120 }}
            >
              {PLAN_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </Form.Select>
            <Form.Control
              type="text"
              size="sm"
              placeholder="FY e.g. 2025-26"
              value={financialYear}
              onChange={(e) => {
                setFinancialYear(e.target.value);
                resetPage();
              }}
              style={{ width: 120 }}
            />
            <Form.Control
              type="date"
              size="sm"
              value={issuedFrom}
              onChange={(e) => {
                setIssuedFrom(e.target.value);
                resetPage();
              }}
              style={{ width: 140 }}
              title="Issued from"
            />
            <Form.Control
              type="date"
              size="sm"
              value={issuedTo}
              onChange={(e) => {
                setIssuedTo(e.target.value);
                resetPage();
              }}
              style={{ width: 140 }}
              title="Issued to"
            />
            <Form.Control
              type="search"
              size="sm"
              placeholder="Email, INV, RCP, GSTIN…"
              value={searchInput}
              onChange={(e) => {
                setSearchInput(e.target.value);
                resetPage();
              }}
              style={{ maxWidth: 220 }}
            />
            <Button size="sm" variant="outline-secondary" disabled={exporting} onClick={handleExport}>
              {exporting ? "Exporting…" : "Export CSV"}
            </Button>
          </div>
        }
      >
        {actionError && (
          <div className="small mb-2" style={{ color: ADMIN_CHART_COLORS.status.critical }}>
            {actionError}
          </div>
        )}
        {invoices.data && (
          <>
            <DataTable
              columns={columns}
              rows={invoices.data.rows}
              getRowKey={(row) => row.id}
              emptyMessage={hasFilters ? "No documents match these filters" : "No invoices yet"}
            />
            <PaginationBar page={page} pageSize={PAGE_SIZE} total={invoices.data.total} onPageChange={setPage} />
          </>
        )}
      </SectionCard>
    </>
  );
}
