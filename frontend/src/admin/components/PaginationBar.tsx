import { Pagination } from "react-bootstrap";
import { ADMIN_CHART_COLORS } from "../theme";

interface PaginationBarProps {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
}

// Shared by Users and Transactions — both are server-paginated (page/pageSize
// query params against a `total` count from the backend), so this is just
// the page-window math plus react-bootstrap's Pagination control.
export default function PaginationBar({ page, pageSize, total, onPageChange }: PaginationBarProps) {
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  if (pageCount <= 1) return null;

  const windowSize = 5;
  const start = Math.max(1, Math.min(page - Math.floor(windowSize / 2), pageCount - windowSize + 1));
  const end = Math.min(pageCount, start + windowSize - 1);
  const pages = Array.from({ length: end - start + 1 }, (_, i) => start + i);

  const rangeStart = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const rangeEnd = Math.min(page * pageSize, total);

  return (
    <div className="d-flex align-items-center justify-content-between flex-wrap gap-2 mt-3">
      <div className="small" style={{ color: ADMIN_CHART_COLORS.ink.muted }}>
        Showing {rangeStart}–{rangeEnd} of {total}
      </div>
      <Pagination size="sm" className="mb-0">
        <Pagination.Prev disabled={page <= 1} onClick={() => onPageChange(page - 1)} />
        {start > 1 && <Pagination.Ellipsis disabled />}
        {pages.map((p) => (
          <Pagination.Item key={p} active={p === page} onClick={() => onPageChange(p)}>
            {p}
          </Pagination.Item>
        ))}
        {end < pageCount && <Pagination.Ellipsis disabled />}
        <Pagination.Next disabled={page >= pageCount} onClick={() => onPageChange(page + 1)} />
      </Pagination>
    </div>
  );
}
