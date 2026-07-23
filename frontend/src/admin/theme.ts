// Chart color roles for the admin section — values taken from the dataviz
// skill's validated reference palette (light surface only; the app has no
// dark mode today, so no dark variants are defined here).

export const ADMIN_CHART_COLORS = {
  categorical: {
    blue: "#2a78d6", // slot 1 — company_search
    orange: "#eb6834", // slot 2 — people_search
    aqua: "#1baf7a", // slot 3 — email_enrich
    yellow: "#eda100", // slot 4 — mobile_enrich
    magenta: "#e87ba4", // slot 5
    green: "#008300", // slot 6
  },
  // Ordinal blue ramp (steps 250/300/400/500/600) for the 5-stage funnel —
  // lightest step kept at 250, the documented light-surface floor for an
  // ordinal (non-sequential-magnitude) use of this ramp.
  funnelRamp: ["#86b6ef", "#6da7ec", "#3987e5", "#256abf", "#184f95"],
  ink: {
    primary: "#0b0b0b",
    secondary: "#52514e",
    muted: "#898781",
  },
  grid: "#e1e0d9",
  baseline: "#c3c2b7",
  surface: "#fcfcfb",
  status: {
    good: "#0ca30c",
    warning: "#fab219",
    serious: "#ec835a",
    critical: "#d03b3b",
  },
} as const;
