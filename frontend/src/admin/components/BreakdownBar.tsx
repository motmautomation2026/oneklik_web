import { ADMIN_CHART_COLORS } from "../theme";

export interface BreakdownEntry {
  key: string;
  label: string;
  value: number;
  color: string;
}

interface BreakdownBarProps {
  entries: BreakdownEntry[];
  formatValue?: (value: number) => string;
}

// A proportion bar + legend for a small set of named categories sharing one
// total — used for run outcomes, feature usage, and users-by-use-case.
// Deliberately not a pie chart: a single horizontal bar reads proportion at
// a glance without forcing an extra legend lookup for each wedge, and stays
// legible with the 4-6 categories these breakdowns actually have.
export default function BreakdownBar({ entries, formatValue }: BreakdownBarProps) {
  const total = entries.reduce((sum, e) => sum + e.value, 0);
  const format = formatValue ?? ((v: number) => String(v));

  if (total === 0) {
    return (
      <div className="small" style={{ color: ADMIN_CHART_COLORS.ink.muted }}>
        No data in this range
      </div>
    );
  }

  return (
    <>
      <div className="d-flex rounded-2 overflow-hidden mb-3" style={{ height: 10 }}>
        {entries.map((entry) =>
          entry.value > 0 ? (
            <div
              key={entry.key}
              style={{ width: `${(entry.value / total) * 100}%`, background: entry.color }}
              title={`${entry.label}: ${format(entry.value)}`}
            />
          ) : null,
        )}
      </div>
      <div className="d-flex flex-wrap gap-3">
        {entries.map((entry) => (
          <div key={entry.key} className="d-flex align-items-center gap-2 small">
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: "50%",
                background: entry.color,
                display: "inline-block",
              }}
            />
            <span style={{ color: ADMIN_CHART_COLORS.ink.secondary }}>{entry.label}</span>
            <span style={{ color: ADMIN_CHART_COLORS.ink.primary, fontVariantNumeric: "tabular-nums" }}>
              {format(entry.value)}
            </span>
          </div>
        ))}
      </div>
    </>
  );
}
