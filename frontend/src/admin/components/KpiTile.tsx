import { ADMIN_CHART_COLORS } from "../theme";

interface KpiTileProps {
  label: string;
  value: string;
  sublabel?: string;
}

// A stat tile is the "not a chart" case from the dataviz form heuristic — a
// single headline number reads faster than any plot for a single magnitude.
export default function KpiTile({ label, value, sublabel }: KpiTileProps) {
  return (
    <div
      className="rounded-3 border p-3 h-100"
      style={{ background: ADMIN_CHART_COLORS.surface, borderColor: ADMIN_CHART_COLORS.grid }}
    >
      <div className="small text-uppercase" style={{ color: ADMIN_CHART_COLORS.ink.muted, letterSpacing: "0.04em" }}>
        {label}
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
