import type { ComponentType } from "react";
import { ADMIN_CHART_COLORS } from "../theme";

interface KpiTileProps {
  label: string;
  value: string;
  sublabel?: string;
  // Optional accent icon + color, used where a tile benefits from an at-a-
  // glance visual category (e.g. Users KPIs). Omitted elsewhere, so existing
  // callers are unaffected.
  icon?: ComponentType<{ size?: number }>;
  accent?: string;
}

// A stat tile is the "not a chart" case from the dataviz form heuristic — a
// single headline number reads faster than any plot for a single magnitude.
export default function KpiTile({ label, value, sublabel, icon: Icon, accent }: KpiTileProps) {
  const accentColor = accent ?? ADMIN_CHART_COLORS.categorical.blue;
  return (
    <div
      className="rounded-3 border p-3 h-100"
      style={{ background: ADMIN_CHART_COLORS.surface, borderColor: ADMIN_CHART_COLORS.grid }}
    >
      <div className="d-flex align-items-start justify-content-between gap-2">
        <div className="small text-uppercase" style={{ color: ADMIN_CHART_COLORS.ink.muted, letterSpacing: "0.04em" }}>
          {label}
        </div>
        {Icon && (
          <div
            className="d-flex align-items-center justify-content-center rounded-2 flex-shrink-0"
            style={{ width: 32, height: 32, background: `${accentColor}1a`, color: accentColor }}
          >
            <Icon size={16} />
          </div>
        )}
      </div>
      <div
        className="fw-semibold"
        style={{ color: ADMIN_CHART_COLORS.ink.primary, fontSize: "1.75rem", fontVariantNumeric: "tabular-nums" }}
      >
        {value}
      </div>
      {sublabel && (
        <div className="small" style={{ color: ADMIN_CHART_COLORS.ink.secondary }}>
          {sublabel}
        </div>
      )}
    </div>
  );
}
