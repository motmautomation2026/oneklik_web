import { useEffect, useState } from "react";
import { Alert, Badge, Button, Dropdown, Form } from "react-bootstrap";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import {
  InboxFill,
  PersonDash,
  ClockHistory,
  LightningCharge,
  Search,
  Download,
  ChevronRight,
  FunnelFill,
} from "react-bootstrap-icons";
import { exportSupportTicketsCsv, fetchSupportKpis, fetchSupportTickets } from "../api/adminApi";
import DataTable from "../components/DataTable";
import KpiTile from "../components/KpiTile";
import PaginationBar from "../components/PaginationBar";
import { ACCOUNT_STATUS_VARIANT, TICKET_STATUS_VARIANT } from "../badgeVariants";
import { formatDateTime, formatNumber } from "../format";
import { useAdminResource } from "../hooks/useAdminResource";
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
  if (minutes < 60) return `${minutes}m`;
  if (minutes < 60 * 24) return `${(minutes / 60).toFixed(1)}h`;
  return `${(minutes / (60 * 24)).toFixed(1)}d`;
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

// Priority gets a colored dot rather than a full badge for a cleaner, less noisy table.
const PRIORITY_DOT_COLOR: Record<string, string> = {
  low: ADMIN_CHART_COLORS.ink.muted,
  normal: ADMIN_CHART_COLORS.categorical.aqua,
  high: "#e6a817",
  urgent: ADMIN_CHART_COLORS.status.critical,
};

// Tab definitions — each maps to a combination of existing filter state, so no
// new backend queries are needed. The "tab" is purely a visual shortcut.
type TabKey = "attention" | "open" | "waiting" | "closed" | "all";

interface TabDef {
  key: TabKey;
  label: string;
  countField?: keyof import("../types").SupportKpis;
}

const TABS: TabDef[] = [
  { key: "attention", label: "Needs attention", countField: "awaiting_reply" },
  { key: "open", label: "All open", countField: "open" },
  { key: "waiting", label: "Waiting" },
  { key: "closed", label: "Closed" },
  { key: "all", label: "All" },
];

export default function AdminSupportPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
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
  const [showMoreFilters, setShowMoreFilters] = useState(false);

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

  // ── Tab logic ──────────────────────────────────────────────────────────
  // Derive the active tab from the current filter state rather than storing
  // it separately — a single source of truth avoids desync.
  function deriveActiveTab(): TabKey {
    if (status === "closed" && !openOnly) return "closed";
    if (status === "waiting_on_user") return "waiting";
    if (!openOnly && !status) return "all";
    if (unanswered && openOnly && !status) return "attention";
    return "open";
  }

  function applyTab(tab: TabKey) {
    setPage(1);
    switch (tab) {
      case "attention":
        setStatus("");
        setOpenOnly(true);
        setUnanswered(true);
        setUnassigned(false);
        break;
      case "open":
        setStatus("");
        setOpenOnly(true);
        setUnanswered(false);
        setUnassigned(false);
        break;
      case "waiting":
        setStatus("waiting_on_user");
        setOpenOnly(false);
        setUnanswered(false);
        setUnassigned(false);
        break;
      case "closed":
        setStatus("closed");
        setOpenOnly(false);
        setUnanswered(false);
        setUnassigned(false);
        break;
      case "all":
        setStatus("");
        setOpenOnly(false);
        setUnanswered(false);
        setUnassigned(false);
        break;
    }
  }

  const activeTab = deriveActiveTab();

  // ── Column definitions ─────────────────────────────────────────────────
  const columns = [
    {
      key: "ticket",
      header: "Ticket",
      render: (row: AdminTicketRow) => (
        <div className="d-flex align-items-center gap-2">
          {row.admin_unread && (
            <span
              title="No one has opened this since the customer's last message"
              style={{ width: 8, height: 8, borderRadius: 4, background: ADMIN_CHART_COLORS.status.critical, flexShrink: 0 }}
            />
          )}
          <div style={{ minWidth: 0 }}>
            <div className="d-flex align-items-center gap-2">
              <span className="small fw-medium" style={{ color: ADMIN_CHART_COLORS.ink.muted, flexShrink: 0 }}>
                #{row.ticket_number}
              </span>
              <Link
                to={`/admin/support/${row.id}`}
                className="d-block text-truncate fw-semibold"
                style={{ maxWidth: 280, color: ADMIN_CHART_COLORS.ink.primary, textDecoration: "none" }}
                onClick={(e) => e.stopPropagation()}
              >
                {row.subject}
              </Link>
            </div>
            <span className="small" style={{ color: ADMIN_CHART_COLORS.ink.muted }}>
              {TICKET_CATEGORY_LABEL[row.category]}
            </span>
          </div>
        </div>
      ),
    },
    {
      key: "requester",
      header: "Requester",
      render: (row: AdminTicketRow) => (
        <div>
          <Link
            to={`/admin/users/${row.user_id}`}
            className="text-truncate d-block small fw-medium"
            style={{ maxWidth: 200, color: ADMIN_CHART_COLORS.ink.primary, textDecoration: "none" }}
            onClick={(e) => e.stopPropagation()}
          >
            {row.email ?? row.user_id}
          </Link>
          {row.account_status_at_submit !== "active" && (
            <Badge bg={ACCOUNT_STATUS_VARIANT[row.account_status_at_submit] ?? "secondary"} title="Account status when raised" className="mt-1" style={{ fontSize: "0.65rem" }}>
              {row.account_status_at_submit}
            </Badge>
          )}
        </div>
      ),
    },
    {
      key: "priority",
      header: "Priority",
      render: (row: AdminTicketRow) => (
        <div className="d-flex align-items-center gap-2">
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: "50%",
              background: PRIORITY_DOT_COLOR[row.priority] ?? ADMIN_CHART_COLORS.ink.muted,
              flexShrink: 0,
            }}
          />
          <span className="small" style={{ color: ADMIN_CHART_COLORS.ink.primary, textTransform: "capitalize" }}>
            {row.priority}
          </span>
        </div>
      ),
    },
    {
      key: "status",
      header: "Status",
      render: (row: AdminTicketRow) => (
        <div className="d-flex align-items-center gap-1 flex-wrap">
          <Badge
            bg={TICKET_STATUS_VARIANT[row.status] ?? "secondary"}
            style={{ fontSize: "0.7rem", fontWeight: 500, padding: "3px 8px", borderRadius: 4 }}
          >
            {TICKET_STATUS_LABEL[row.status]}
          </Badge>
          {row.awaiting_reply && (
            <Badge bg="warning" text="dark" title="The customer sent the last message" style={{ fontSize: "0.65rem" }}>
              Awaiting reply
            </Badge>
          )}
        </div>
      ),
    },
    {
      key: "assignee",
      header: "Assignee",
      render: (row: AdminTicketRow) =>
        row.assigned_to_email ? (
          <div className="d-flex align-items-center gap-2">
            <div
              style={{
                width: 24,
                height: 24,
                borderRadius: "50%",
                background: `${ADMIN_CHART_COLORS.categorical.blue}18`,
                color: ADMIN_CHART_COLORS.categorical.blue,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: "0.65rem",
                fontWeight: 600,
                flexShrink: 0,
              }}
            >
              {row.assigned_to_email[0]?.toUpperCase() ?? "?"}
            </div>
            <span className="small text-truncate" style={{ maxWidth: 120 }}>{row.assigned_to_email}</span>
          </div>
        ) : (
          <span className="small" style={{ color: ADMIN_CHART_COLORS.ink.muted }}>
            Unassigned
          </span>
        ),
    },
    {
      key: "activity",
      header: "Last activity",
      align: "end" as const,
      render: (row: AdminTicketRow) => (
        <div className="d-flex align-items-center gap-2 justify-content-end">
          <div className="text-end">
            <div className="small fw-medium" title={formatDateTime(row.last_message_at)}>
              {formatAge(row.last_message_at)}
            </div>
            <div style={{ fontSize: "0.7rem", color: row.last_message_role !== "admin" ? ADMIN_CHART_COLORS.status.warning : ADMIN_CHART_COLORS.ink.muted }}>
              {row.last_message_role === "admin" ? "You replied" : row.awaiting_reply ? `${formatAge(row.last_message_at).replace(" ago", "")} waiting` : "Customer replied"}
            </div>
          </div>
          <ChevronRight size={14} style={{ color: ADMIN_CHART_COLORS.ink.muted, flexShrink: 0 }} />
        </div>
      ),
    },
  ];

  const filtersActive = Boolean(search || status || category || priority || unassigned || unanswered);

  return (
    <>
      {/* ── Page header ──────────────────────────────────────────────────── */}
      <div className="d-flex align-items-start justify-content-between mb-4 flex-wrap gap-2">
        <div>
          <h1 className="h4 mb-1 fw-bold" style={{ color: ADMIN_CHART_COLORS.ink.primary }}>
            Support Inbox
          </h1>
          <p className="mb-0 small" style={{ color: ADMIN_CHART_COLORS.ink.secondary }}>
            Manage customer requests and resolve issues quickly.
          </p>
        </div>
        <Dropdown>
          <Dropdown.Toggle
            variant="outline-secondary"
            size="sm"
            disabled={exporting}
            className="d-flex align-items-center gap-2"
            style={{ borderRadius: 8, padding: "6px 14px" }}
          >
            <Download size={14} />
            {exporting ? "Exporting…" : "Export"}
          </Dropdown.Toggle>
          <Dropdown.Menu align="end">
            <Dropdown.Item onClick={handleExport}>Export as CSV</Dropdown.Item>
          </Dropdown.Menu>
        </Dropdown>
      </div>

      {/* ── KPI tiles ────────────────────────────────────────────────────── */}
      <div className="row g-3 mb-4">
        <div className="col-6 col-lg-3">
          <KpiTile
            label="Open"
            value={kpis.data ? formatNumber(kpis.data.open) : "—"}
            sublabel="Tickets"
            icon={InboxFill}
            accent={ADMIN_CHART_COLORS.categorical.blue}
          />
        </div>
        <div className="col-6 col-lg-3">
          <KpiTile
            label="Unassigned"
            value={kpis.data ? formatNumber(kpis.data.unassigned) : "—"}
            sublabel="Tickets"
            icon={PersonDash}
            accent={ADMIN_CHART_COLORS.categorical.orange}
          />
        </div>
        <div className="col-6 col-lg-3">
          <KpiTile
            label="Waiting > 24h"
            value={kpis.data ? formatNumber(kpis.data.awaiting_reply) : "—"}
            sublabel="Tickets"
            icon={ClockHistory}
            accent={ADMIN_CHART_COLORS.status.critical}
          />
        </div>
        <div className="col-6 col-lg-3">
          <KpiTile
            label="Median first response"
            value={formatMinutes(kpis.data?.median_first_response_minutes ?? null)}
            sublabel={kpis.data ? `This week` : undefined}
            icon={LightningCharge}
            accent={ADMIN_CHART_COLORS.categorical.aqua}
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

      {/* ── Tab bar + filters + table ────────────────────────────────────── */}
      <div
        className="rounded-3 border"
        style={{ background: ADMIN_CHART_COLORS.surface, borderColor: ADMIN_CHART_COLORS.grid }}
      >
        {/* Tab navigation */}
        <div
          className="d-flex align-items-center gap-1 px-3 pt-3 pb-0 flex-wrap"
          style={{ borderBottom: `1px solid ${ADMIN_CHART_COLORS.grid}` }}
        >
          {TABS.map((tab) => {
            const isActive = activeTab === tab.key;
            const count = tab.countField && kpis.data ? (kpis.data as unknown as Record<string, number>)[tab.countField] : undefined;
            return (
              <button
                key={tab.key}
                type="button"
                onClick={() => applyTab(tab.key)}
                style={{
                  background: "none",
                  border: "none",
                  borderBottom: isActive ? `2px solid ${ADMIN_CHART_COLORS.categorical.blue}` : "2px solid transparent",
                  padding: "8px 14px",
                  cursor: "pointer",
                  color: isActive ? ADMIN_CHART_COLORS.categorical.blue : ADMIN_CHART_COLORS.ink.secondary,
                  fontWeight: isActive ? 600 : 400,
                  fontSize: "0.875rem",
                  transition: "all 0.15s ease",
                  marginBottom: -1,
                }}
              >
                {tab.label}
                {count !== undefined && count > 0 && (
                  <Badge
                    pill
                    bg={isActive ? "primary" : "secondary"}
                    className="ms-2"
                    style={{ fontSize: "0.65rem", fontWeight: 500, verticalAlign: "middle" }}
                  >
                    {count}
                  </Badge>
                )}
              </button>
            );
          })}
        </div>

        {/* Filter bar */}
        <div className="px-3 py-3">
          <div className="d-flex flex-wrap gap-2 align-items-center">
            {/* Search */}
            <div className="position-relative" style={{ flex: "1 1 280px", maxWidth: 400 }}>
              <Search
                size={14}
                style={{
                  position: "absolute",
                  left: 12,
                  top: "50%",
                  transform: "translateY(-50%)",
                  color: ADMIN_CHART_COLORS.ink.muted,
                  pointerEvents: "none",
                }}
              />
              <Form.Control
                type="search"
                size="sm"
                placeholder="Search tickets, email, or customer…"
                value={searchInput}
                onChange={(e) => resetPage(setSearchInput)(e.target.value)}
                style={{
                  paddingLeft: 34,
                  paddingRight: 50,
                  borderRadius: 8,
                  borderColor: ADMIN_CHART_COLORS.grid,
                  fontSize: "0.85rem",
                }}
              />
              <kbd
                style={{
                  position: "absolute",
                  right: 8,
                  top: "50%",
                  transform: "translateY(-50%)",
                  fontSize: "0.65rem",
                  padding: "1px 5px",
                  borderRadius: 4,
                  background: "#f0f0ee",
                  border: `1px solid ${ADMIN_CHART_COLORS.grid}`,
                  color: ADMIN_CHART_COLORS.ink.muted,
                  fontFamily: "inherit",
                  pointerEvents: "none",
                }}
              >
                ⌘K
              </kbd>
            </div>

            {/* Category filter */}
            <Form.Select
              size="sm"
              value={category}
              onChange={(e) => resetPage(setCategory)((parseCategory(e.target.value) ?? "") as TicketCategory | "")}
              style={{ maxWidth: 180, borderRadius: 8, borderColor: ADMIN_CHART_COLORS.grid, fontSize: "0.85rem" }}
              aria-label="Filter by category"
            >
              <option value="">Category</option>
              {TICKET_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {TICKET_CATEGORY_LABEL[c]}
                </option>
              ))}
            </Form.Select>

            {/* More filters toggle */}
            <Button
              size="sm"
              variant={showMoreFilters ? "primary" : "outline-secondary"}
              onClick={() => setShowMoreFilters(!showMoreFilters)}
              className="d-flex align-items-center gap-1"
              style={{ borderRadius: 8, fontSize: "0.85rem" }}
            >
              <FunnelFill size={12} />
              More filters
            </Button>

            {/* Active filter count */}
            {filtersActive && (
              <Button
                size="sm"
                variant="link"
                onClick={() => {
                  resetPage(setSearchInput)("");
                  resetPage(setStatus)("" as TicketStatus | "");
                  resetPage(setCategory)("" as TicketCategory | "");
                  resetPage(setPriority)("" as TicketPriority | "");
                  resetPage(setUnassigned)(false);
                  resetPage(setUnanswered)(false);
                  setOpenOnly(true);
                }}
                style={{ fontSize: "0.8rem", textDecoration: "none" }}
              >
                Clear filters
              </Button>
            )}
          </div>

          {/* Expanded filters */}
          {showMoreFilters && (
            <div
              className="d-flex flex-wrap gap-2 align-items-center mt-2 pt-2"
              style={{ borderTop: `1px solid ${ADMIN_CHART_COLORS.grid}` }}
            >
              <Form.Select
                size="sm"
                value={status}
                onChange={(e) => resetPage(setStatus)((parseStatus(e.target.value) ?? "") as TicketStatus | "")}
                style={{ maxWidth: 160, borderRadius: 8, borderColor: ADMIN_CHART_COLORS.grid, fontSize: "0.85rem" }}
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
                value={priority}
                onChange={(e) => resetPage(setPriority)((parsePriority(e.target.value) ?? "") as TicketPriority | "")}
                style={{ maxWidth: 140, borderRadius: 8, borderColor: ADMIN_CHART_COLORS.grid, fontSize: "0.85rem" }}
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
            </div>
          )}
        </div>

        {/* ── Ticket table ─────────────────────────────────────────────────── */}
        <div style={{ borderTop: `1px solid ${ADMIN_CHART_COLORS.grid}` }}>
          {tickets.loading && (
            <div className="d-flex justify-content-center py-5">
              <div className="spinner-border spinner-border-sm" role="status" />
            </div>
          )}
          {!tickets.loading && tickets.error && (
            <div className="p-3 small" style={{ color: ADMIN_CHART_COLORS.status.critical }}>
              {tickets.error}
            </div>
          )}
          {!tickets.loading && !tickets.error && tickets.data && (
            <>
              <DataTable
                columns={columns}
                rows={tickets.data.rows}
                getRowKey={(row) => row.id}
                emptyMessage={filtersActive ? "No tickets match those filters" : "No tickets yet"}
                onRowClick={(row) => navigate(`/admin/support/${row.id}`)}
              />
              <div className="px-3 pb-3">
                <PaginationBar page={page} pageSize={PAGE_SIZE} total={tickets.data.total} onPageChange={setPage} />
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}

// ── Debounce hook (unchanged) ────────────────────────────────────────────
function useDebouncedValue(value: string, delay = 300): string {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}
