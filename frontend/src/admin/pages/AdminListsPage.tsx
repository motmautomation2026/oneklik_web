import { useEffect, useState } from "react";
import { Badge, Button, Form } from "react-bootstrap";
import { Link, useSearchParams } from "react-router-dom";
import { fetchLists, fetchListsActivity } from "../api/adminApi";
import DataTable from "../components/DataTable";
import KpiTile from "../components/KpiTile";
import PaginationBar from "../components/PaginationBar";
import SectionCard from "../components/SectionCard";
import { formatDateTime, formatNumber } from "../format";
import { useAdminResource } from "../hooks/useAdminResource";
import { useDebouncedValue } from "../hooks/useDebouncedValue";
import { ADMIN_CHART_COLORS } from "../theme";
import type { ListRow } from "../types";

const PAGE_SIZE = 25;

// Lists were previously only visible as aggregate counts on the Dashboard's
// "Lists activity" card — this is the row-level browser, useful when
// following up on a specific user's "my enrichment didn't work" report.
export default function AdminListsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const userId = searchParams.get("userId") ?? undefined;
  const [page, setPage] = useState(() => Number(searchParams.get("page")) || 1);
  const [searchInput, setSearchInput] = useState(() => searchParams.get("search") ?? "");
  const search = useDebouncedValue(searchInput);

  // Mirror page/search into the URL (userId is left untouched here — it's
  // only ever set/cleared via navigation, see handleClearUserFilter below)
  // so the view is bookmarkable and survives browser back/forward.
  useEffect(() => {
    const next = new URLSearchParams(searchParams);
    if (page > 1) next.set("page", String(page));
    else next.delete("page");
    if (search) next.set("search", search);
    else next.delete("search");
    setSearchParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, search]);

  const activity = useAdminResource(fetchListsActivity, []);
  const lists = useAdminResource(
    (signal) => fetchLists({ page, pageSize: PAGE_SIZE, search: search || undefined, userId, signal }),
    [page, search, userId],
  );

  const ownerEmail = userId ? lists.data?.rows.find((r) => r.owner_user_id === userId)?.owner_email : undefined;

  function handleSearchChange(value: string) {
    setSearchInput(value);
    setPage(1);
  }

  function handleClearUserFilter() {
    const next = new URLSearchParams(searchParams);
    next.delete("userId");
    next.delete("page");
    setSearchParams(next, { replace: true });
    setPage(1);
  }

  const columns = [
    { key: "name", header: "Name", render: (row: ListRow) => row.name },
    {
      key: "kind",
      header: "Kind",
      render: (row: ListRow) => <Badge bg={row.kind === "company" ? "info" : "primary"}>{row.kind}</Badge>,
    },
    {
      key: "owner",
      header: "Owner",
      render: (row: ListRow) => <Link to={`/admin/users/${row.owner_user_id}`}>{row.owner_email ?? row.owner_user_id}</Link>,
    },
    {
      key: "item_count",
      header: "Rows",
      align: "end" as const,
      render: (row: ListRow) => formatNumber(row.item_count),
    },
    { key: "created_at", header: "Created", render: (row: ListRow) => formatDateTime(row.created_at) },
  ];

  return (
    <>
      <div className="mb-4 d-flex align-items-start justify-content-between gap-3 flex-wrap">
        <div>
          <h1 className="h4 mb-1" style={{ color: ADMIN_CHART_COLORS.ink.primary }}>
            Lists
          </h1>
          <p className="mb-0 small" style={{ color: ADMIN_CHART_COLORS.ink.secondary }}>
            {userId
              ? `Lists owned by ${ownerEmail ?? userId}.`
              : "Every list across all users, with row counts."}
          </p>
        </div>
        {userId && (
          <Badge bg="info" className="d-flex align-items-center gap-2 py-2 px-3">
            Filtered to {ownerEmail ?? userId}
            <Button
              size="sm"
              variant="link"
              className="p-0 text-white text-decoration-none"
              onClick={handleClearUserFilter}
              aria-label="Clear user filter"
            >
              &times;
            </Button>
          </Badge>
        )}
      </div>

      <div className="row g-3 mb-4">
        <div className="col-6 col-lg-3">
          <KpiTile label="Total lists" value={activity.data ? formatNumber(activity.data.total_lists) : "—"} />
        </div>
        <div className="col-6 col-lg-3">
          <KpiTile label="Total rows" value={activity.data ? formatNumber(activity.data.total_list_items) : "—"} />
        </div>
        <div className="col-6 col-lg-3">
          <KpiTile
            label="Created this week"
            value={activity.data ? formatNumber(activity.data.lists_this_week) : "—"}
          />
        </div>
        <div className="col-6 col-lg-3">
          <KpiTile label="Avg list size" value={activity.data ? formatNumber(activity.data.avg_list_size) : "—"} />
        </div>
      </div>
      {activity.error && (
        <div className="small mb-4" style={{ color: ADMIN_CHART_COLORS.status.critical }}>
          {activity.error}
        </div>
      )}

      <SectionCard
        title={userId ? "This user's lists" : "All lists"}
        loading={lists.loading}
        error={lists.error}
        action={
          <Form.Control
            type="search"
            size="sm"
            placeholder={userId ? "Search by name…" : "Search by name or owner email…"}
            value={searchInput}
            onChange={(e) => handleSearchChange(e.target.value)}
            style={{ maxWidth: 260 }}
          />
        }
      >
        {lists.data && (
          <>
            <DataTable
              columns={columns}
              rows={lists.data.rows}
              getRowKey={(row) => row.id}
              emptyMessage={search ? "No lists match that search" : "No lists yet"}
            />
            <PaginationBar page={page} pageSize={PAGE_SIZE} total={lists.data.total} onPageChange={setPage} />
          </>
        )}
      </SectionCard>
    </>
  );
}
