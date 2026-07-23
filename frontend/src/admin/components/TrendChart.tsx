import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ADMIN_CHART_COLORS } from "../theme";

export interface TrendSeries {
  key: string;
  label: string;
  color: string;
}

interface TrendChartProps<T extends { date: string }> {
  // Generic over the row shape (rather than a `Record<string, unknown>`
  // index signature) so callers can pass richer row objects — e.g.
  // TrendPoint, which also carries a nested credits_consumed object — a
  // plain interface isn't structurally assignable to an index-signature
  // type in TypeScript even when every property fits.
  data: T[];
  series: TrendSeries[];
  valueFormatter?: (value: number) => string;
  height?: number;
}

function formatDateTick(value: string): string {
  const d = new Date(value);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

// One axis, thin 2px lines, no dots until hover, recessive grid/axes, legend
// only when there's more than one series (identity is otherwise carried by
// the chart title) — per the dataviz skill's mark spec and anti-patterns.
export default function TrendChart<T extends { date: string }>({
  data,
  series,
  valueFormatter,
  height = 260,
}: TrendChartProps<T>) {
  const format = valueFormatter ?? ((v: number) => String(v));

  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
        <CartesianGrid stroke={ADMIN_CHART_COLORS.grid} vertical={false} />
        <XAxis
          dataKey="date"
          tickFormatter={formatDateTick}
          tick={{ fill: ADMIN_CHART_COLORS.ink.muted, fontSize: 12 }}
          axisLine={{ stroke: ADMIN_CHART_COLORS.baseline }}
          tickLine={false}
          minTickGap={24}
        />
        <YAxis
          tick={{ fill: ADMIN_CHART_COLORS.ink.muted, fontSize: 12 }}
          axisLine={false}
          tickLine={false}
          width={48}
          tickFormatter={format}
        />
        <Tooltip
          labelFormatter={(label) => formatDateTick(String(label))}
          formatter={(value, name) => [format(Number(value)), String(name)]}
          contentStyle={{
            background: ADMIN_CHART_COLORS.surface,
            border: `1px solid ${ADMIN_CHART_COLORS.grid}`,
            borderRadius: 8,
            fontSize: 13,
          }}
        />
        {series.length > 1 && <Legend wrapperStyle={{ fontSize: 12, color: ADMIN_CHART_COLORS.ink.secondary }} />}
        {series.map((s) => (
          <Line
            key={s.key}
            type="monotone"
            dataKey={s.key}
            name={s.label}
            stroke={s.color}
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4 }}
            isAnimationActive={false}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}
