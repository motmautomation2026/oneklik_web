import type { ReactElement } from "react";
import { Bar, BarChart, Cell, LabelList, ResponsiveContainer, XAxis, YAxis } from "recharts";
import { ADMIN_CHART_COLORS } from "../theme";
import type { FunnelStats } from "../types";

interface FunnelChartProps {
  funnel: FunnelStats;
}

const STAGES: { key: keyof FunnelStats; label: string }[] = [
  { key: "signed_up", label: "Signed up" },
  { key: "verified", label: "Verified email" },
  { key: "onboarded", label: "Onboarded" },
  { key: "first_search", label: "Made a search" },
  { key: "paid", label: "Purchased credits" },
];

// A funnel is ordinal (discrete ordered stages), not a continuous magnitude —
// per the dataviz skill this takes the ordinal ramp (fixed step list), not
// the sequential 100->700 gradient, and each stage gets a direct label
// rather than relying on a legend for a single-series chart.
export default function FunnelChart({ funnel }: FunnelChartProps) {
  const base = funnel.signed_up || 1;
  const data = STAGES.map((stage, i) => ({
    label: stage.label,
    count: funnel[stage.key],
    pct: Math.round((funnel[stage.key] / base) * 100),
    color: ADMIN_CHART_COLORS.funnelRamp[i],
  }));

  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 40, bottom: 4, left: 4 }}>
        <XAxis type="number" hide />
        <YAxis
          type="category"
          dataKey="label"
          width={140}
          tick={{ fill: ADMIN_CHART_COLORS.ink.secondary, fontSize: 13 }}
          axisLine={false}
          tickLine={false}
        />
        <Bar dataKey="count" radius={[0, 4, 4, 0]} isAnimationActive={false} barSize={22}>
          {data.map((entry) => (
            <Cell key={entry.label} fill={entry.color} />
          ))}
          <LabelList
            dataKey="count"
            position="right"
            content={(props): ReactElement => {
              const { x, y, width, height, index } = props as unknown as {
                x: number;
                y: number;
                width: number;
                height: number;
                index: number;
              };
              const row = data[index];
              return (
                <text
                  x={x + width + 8}
                  y={y + height / 2}
                  dy={4}
                  fontSize={12}
                  fill={ADMIN_CHART_COLORS.ink.primary}
                  style={{ fontVariantNumeric: "tabular-nums" }}
                >
                  {`${row.count.toLocaleString()} (${row.pct}%)`}
                </text>
              );
            }}
          />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
