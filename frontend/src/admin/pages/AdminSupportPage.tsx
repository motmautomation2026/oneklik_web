import { useEffect, useState } from "react";
import { Alert, Badge, Button, Form } from "react-bootstrap";
import { Link, useSearchParams } from "react-router-dom";
import { exportSupportTicketsCsv, fetchSupportKpis, fetchSupportTickets } from "../api/adminApi";
import DataTable from "../components/DataTable";
import KpiTile from "../components/KpiTile";
import PaginationBar from "../components/PaginationBar";
import SectionCard from "../components/SectionCard";
import { ACCOUNT_STATUS_VARIANT, TICKET_PRIORITY_VARIANT, TICKET_STATUS_VARIANT } from "../badgeVariants";
import { formatDateTime, formatNumber } from "../format";
import { useAdminResource } from "../hooks/useAdminResource";
import { useDebouncedValue } from "../hooks/useDebouncedValue";
import { ADMIN_CHART_COLORS } from "../theme";
import {
  TICKET_CATEGORIES,
  TICKET_CATEGORY_LABEL,
  TICKET_PRIORITIES,
  TICKET_STATUS_LABEL,
  TICKET_STATUSES,
  type AdminTicketRow,
  type TicketCategory,
  type TicketPriority,
  type TicketStatus,
} from "../types";

const PAGE_SIZE = 25;

function parseStatus(value: string | null): TicketStatus | undefined {
  return value && (TICKET_STATUSES as string[]).includes(value) ? (value as TicketStatus) : undefined;
}

function parseCategory(value: string | null): TicketCategory | undefined {
  return value && (TICKET_CATEGORIES as string[]).includes(value) ? (value as TicketCategory) : undefined;
}

function parsePriority(value: string | null): TicketPriority | undefined {
  return value && (TICKET_PRIORITIES as string[]).includes(value) ? (value as TicketPriority) : undefined;
}

// "2 h" reads better than "127 minutes" on a KPI tile, and days better than
// either once a queue has been neglected.
function formatMinutes(minutes: number | null): string {
  if (minutes == null) return "—";
  if (minutes < 60) return `${minutes} min`;
  if (minutes < 60 * 24) return `${(minutes / 60).toFixed(1)} h`;
  return `${(minutes / (60 * 24)).toFixed(1)} d`;
}

// Age of the last message, which is what an agent triages on — not ticket age.
// A three-week-old ticket answered an hour ago is not urgent.
function formatAge(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(ms / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export default function AdminSupportPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [page, setPage] = useState(() => Number(searchParams.get("page")) || 1);
  const [searchInput, setSearchInput] = useState(() => searchParams.get("search") ?? "");
  const [status, setStatus] = useState<TicketStatus | "">(() => parseStatus(searchParams.get("status")) ?? "");
  const [category, setCategory] = useState<TicketCategory | "">(() => parseCategory(searchParams.get("category")) ?? "");
  const [priority, setPriority] = useState<TicketPriority | "">(() => parsePriority(searchParams.get("priority")) ?? "");
  const [unassigned, setUnassigned] = useState(() => searchParams.get("unassigned") === "1");
  const [unanswered, setUnanswered] = useState(() => searchParams.get("unanswered") === "1");
  // Default view is the working set, not the archive. Explicitly picking a
  // status turns this off, otherwise "Closed" would return nothing and look
  // broken.
  const [openOnly, setOpenOnly] = useState(() => searchParams.get("openOnly") !== "0");
  const search = useDebouncedValue(searchInput);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  useEffect(() => {
    const next = new URLSearchParams();
    if (page > 1) next.set("page", String(page));
    if (search) next.set("search", search);
    if (status) next.set("status", status);
    if (category) next.set("category", category);
    if (priority) next.set("priority", priority);
    if (unassigned) next.set("unassigned", "1");
    if (unanswered) next.set("unanswered", "1");
    if (!openOnly) next.set("openOnly", "0");
    setSearchParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, search, status, category, priority, unassigned, unanswered, openOnly]);

  const effectiveOpenOnly = openOnly && !status;

  const kpis = useAdminResource((signal) => fetchSupportKpis(signal), []);
  const tickets = useAdminResource(
    (signal) =>
      fetchSupportTickets({
        page,
        pageSize: PAGE_SIZE,
        status: status || undefined,
        category: category || undefined,
        priority: priority || undefined,
        unassigned: unassigned || undefined,
        unanswered: unanswered || undefined,
        openOnly: effectiveOpenOnly || undefined,
        search: search || undefined,
        signal,
      }),
    [page, status, category, priority, unassigned, unanswered, effectiveOpenOnly, search],
  );

  function resetPage<T>(setter: (value: T) => void) {
    return (value: T) => {
      setter(value);
      setPage(1);
    };
  }

  async function handleExport() {
    setExporting(true);
    // The export can legitimately refuse (413 when the result set is too large
    // to return honestly), so the rejection has to be shown rather than
    // becoming an unhandled promise the admin never sees.
    setExportError(null);
    try {
      await exportSupportTicketsCsv({
        status: status || undefined,
        category: category || undefined,
        priority: priority || undefined,
        unassigned: unassigned || undefined,
        unanswered: unanswered || undefined,
        openOnly: effectiveOpenOnly || undefined,
        search: search || undefined,
      });
    } catch (err) {
      setExportError(err instanceof Error ? err.message : "Could not export the tickets.");
    } finally {
      setExporting(false);
    }
  }

  const columns = [
    {
      key: "ticket",
      header: "Ticket",
      render: (row: AdminTicketRow) => (
        <div className="d-flex align-items-center gap-2">
          {row.admin_unread && (
            <span
              title="No one has opened this since the customer's last message"
              style={{ width: 8, height: 8, borderRadius: 4, background: "#dc3545", flexShrink: 0 }}
            />
          )}
          <div style={{ minWidth: 0 }}>
            <Link to={`/admin/support/${row.id}`} className="d-block text-truncate" style={{ maxWidth: 320 }}>
              {row.subject}
            </Link>
            <span className="small" style={{ color: ADMIN_CHART_COLORS.ink.muted }}>
              #{row.ticket_number} · {TICKET_CATEGORY_LABEL[row.category]}
            </span>
          </div>
        </div>
      ),
    },
    {
      key: "requester",
      header: "Requester",
      render: (row: AdminTicketRow) => (
        <div className="d-flex align-items-center gap-2">
          <Link to={`/admin/users/${row.user_id}`} className="text-truncate" style={{ maxWidth: 200 }}>
            {row.email ?? row.user_id}
          </Link>
          {row.account_status_at_submit !== "active" && (
            <Badge bg={ACCOUNT_STATUS_VARIANT[row.account_status_at_submit] ?? "secondary"} title="Account status when raised">
              {row.account_status_at_submit}
            </Badge>
          )}
        </div>
      ),
    },
    {
      key: "status",
      header: "Status",
      render: (row: AdminTicketRow) => (
        <div className="d-flex align-items-center gap-1">
          <Badge bg={TICKET_STATUS_VARIANT[row.status] ?? "secondary"}>{TICKET_STATUS_LABEL[row.status]}</Badge>
          {row.awaiting_reply && (
            <Badge bg="warning" text="dark" title="The customer sent the last message">
              Awaiting reply
            </Badge>
          )}
        </div>
      ),
    },
    {
      key: "priority",
      header: "Priority",
      render: (row: AdminTicketRow) => (
        <Badge bg={TICKET_PRIORITY_VARIANT[row.priority] ?? "secondary"}>{row.priority}</Badge>
      ),
    },
    {
      key: "assignee",
      header: "Assignee",
      render: (row: AdminTicketRow) =>
        row.assigned_to_email ? (
          <span className="small">{row.assigned_to_email}</span>
        ) : (
          <span className="small" style={{ color: ADMIN_CHART_COLORS.ink.muted }}>
            Unassigned
          </span>
        ),
    },
    {
      key: "activity",
      header: "Last activity",
      render: (row: AdminTicketRow) => (
        <span title={formatDateTime(row.last_message_at)}>
          {formatAge(row.last_message_at)}
          <span className="small ms-1" style={{ color: ADMIN_CHART_COLORS.ink.muted }}>
            {row.last_message_role === "admin" ? "(us)" : "(them)"}
          </span>
        </span>
      ),
    },
  ];

  const filtersActive = Boolean(search || status || category || priority || unassigned || unanswered);

  return (
    <>
      <div className="mb-4">
        <h1 className="h4 mb-1" style={{ color: ADMIN_CHART_COLORS.ink.primary }}>
          Support
        </h1>
        <p className="mb-0 small" style={{ color: ADMIN_CHART_COLORS.ink.secondary }}>
          Every ticket raised from the app or from an account lockout screen.
        </p>
      </div>

      <div className="row g-3 mb-4">
        <div className="col-6 col-lg-3">
          <KpiTile label="Open" value={kpis.data ? formatNumber(kpis.data.open) : "—"} sublabel="Not resolved or closed" />
        </div>
        <div className="col-6 col-lg-3">
          <KpiTile
            label="Unassigned"
            value={kpis.data ? formatNumber(kpis.data.unassigned) : "—"}
            sublabel="Nobody owns these yet"
          />
        </div>
        <div className="col-6 col-lg-3">
          <KpiTile
            label="Awaiting reply >24h"
            value={kpis.data ? formatNumber(kpis.data.awaiting_reply) : "—"}
            sublabel="Customer is still waiting"
          />
        </div>
        <div className="col-6 col-lg-3">
          <KpiTile
            label="Median first response"
            value={formatMinutes(kpis.data?.median_first_response_minutes ?? null)}
            sublabel={kpis.data ? `${formatNumber(kpis.data.resolved_this_week)} resolved this week` : undefined}
          />
        </div>
      </div>
      {kpis.error && (
        <div className="small mb-4" style={{ color: ADMIN_CHART_COLORS.status.critical }}>
          {kpis.error}
        </div>
      )}
      {exportError && (
        <Alert variant="warning" className="py-2 small" dismissible onClose={() => setExportError(null)}>
          {exportError}
        </Alert>
      )}

      <SectionCard
        title="Queue"
        loading={tickets.loading}
        error={tickets.error}
        action={
          <div className="d-flex flex-wrap gap-2 align-items-center justify-content-end">
            <Form.Control
              type="search"
              size="sm"
              placeholder="Search subject or #number…"
              value={searchInput}
              onChange={(e) => resetPage(setSearchInput)(e.target.value)}
              style={{ maxWidth: 220 }}
            />
            <Form.Select
              size="sm"
              value={status}
              onChange={(e) => resetPage(setStatus)((parseStatus(e.target.value) ?? "") as TicketStatus | "")}
              style={{ maxWidth: 160 }}
              aria-label="Filter by status"
            >
              <option value="">{openOnly ? "Open statuses" : "All statuses"}</option>
              {TICKET_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {TICKET_STATUS_LABEL[s]}
                </option>
              ))}
            </Form.Select>
            <Form.Select
              size="sm"
              value={category}
              onChange={(e) => resetPage(setCategory)((parseCategory(e.target.value) ?? "") as TicketCategory | "")}
              style={{ maxWidth: 190 }}
              aria-label="Filter by category"
            >
              <option value="">All categories</option>
              {TICKET_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {TICKET_CATEGORY_LABEL[c]}
                </option>
              ))}
            </Form.Select>
            <Form.Select
              size="sm"
              value={priority}
              onChange={(e) => resetPage(setPriority)((parsePriority(e.target.value) ?? "") as TicketPriority | "")}
              style={{ maxWidth: 130 }}
              aria-label="Filter by priority"
            >
              <option value="">All priorities</option>
              {TICKET_PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </Form.Select>
            <Form.Check
              type="checkbox"
              id="support-unassigned"
              label="Unassigned"
              className="small"
              checked={unassigned}
              onChange={(e) => resetPage(setUnassigned)(e.target.checked)}
            />
            <Form.Check
              type="checkbox"
              id="support-unanswered"
              label="Unanswered"
              className="small"
              checked={unanswered}
              onChange={(e) => resetPage(setUnanswered)(e.target.checked)}
            />
            {/* Wording tracks what the filter actually does: the default view
                is the working set (open / in progress / waiting on user), so
                unchecking it brings back BOTH resolved and closed. */}
            <Form.Check
              type="checkbox"
              id="support-include-done"
              label="Include resolved & closed"
              className="small"
              checked={!openOnly}
              disabled={Boolean(status)}
              onChange={(e) => resetPage(setOpenOnly)(!e.target.checked)}
            />
            <Button size="sm" variant="outline-secondary" disabled={exporting} onClick={handleExport}>
              {exporting ? "Exporting…" : "Export CSV"}
            </Button>
          </div>
        }
      >
        {tickets.data && (
          <>
            <DataTable
              columns={columns}
              rows={tickets.data.rows}
              getRowKey={(row) => row.id}
              emptyMessage={filtersActive ? "No tickets match those filters" : "No tickets yet"}
            />
            <PaginationBar page={page} pageSize={PAGE_SIZE} total={tickets.data.total} onPageChange={setPage} />
          </>
        )}
      </SectionCard>
    </>
  );
}
