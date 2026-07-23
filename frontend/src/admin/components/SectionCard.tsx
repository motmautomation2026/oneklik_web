import type { ReactNode } from "react";
import { Spinner } from "react-bootstrap";
import { ADMIN_CHART_COLORS } from "../theme";

interface SectionCardProps {
  title: string;
  action?: ReactNode;
  loading: boolean;
  error: string | null;
  children: ReactNode;
}

// Consistent card chrome + loading/error handling for every section on the
// overview page, so a failure in one section (e.g. top-users) never blanks
// the rest of the dashboard — each SectionCard fails independently.
export default function SectionCard({ title, action, loading, error, children }: SectionCardProps) {
  return (
    <div
      className="rounded-3 border p-3 h-100"
      style={{ background: ADMIN_CHART_COLORS.surface, borderColor: ADMIN_CHART_COLORS.grid }}
    >
      <div className="d-flex align-items-center justify-content-between mb-2 gap-2">
        <h2 className="h6 mb-0" style={{ color: ADMIN_CHART_COLORS.ink.primary }}>
          {title}
        </h2>
        {action}
      </div>
      {loading && (
        <div className="d-flex justify-content-center py-4">
          <Spinner animation="border" size="sm" />
        </div>
      )}
      {!loading && error && (
        <div className="small" style={{ color: ADMIN_CHART_COLORS.status.critical }}>
          {error}
        </div>
      )}
      {!loading && !error && children}
    </div>
  );
}
