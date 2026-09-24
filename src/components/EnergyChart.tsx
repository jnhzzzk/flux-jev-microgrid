import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { HourlyDispatch } from "../../shared/contracts";

interface TooltipEntry {
  color: string;
  dataKey: string;
  name: string;
  value: number;
}

function EnergyTooltip({
  active,
  label,
  payload,
}: {
  active?: boolean;
  label?: string;
  payload?: TooltipEntry[];
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="energy-tooltip">
      <strong>{label}</strong>
      {payload.map((entry) => (
        <span key={entry.dataKey}>
          <i style={{ background: entry.color }} aria-hidden="true" />
          <b>{entry.name}</b>
          <em>{entry.dataKey === "socAfter" ? `${entry.value.toFixed(0)}%` : `${entry.value.toFixed(0)} kW`}</em>
        </span>
      ))}
    </div>
  );
}

export function EnergyChart({
  schedule,
  selectedHour,
}: {
  schedule: HourlyDispatch[];
  selectedHour: number;
}) {
  const selectedLabel = schedule[selectedHour]?.label;
  return (
    <div
      id="energy-trend"
      className="energy-chart"
      data-selected-hour={selectedHour}
      aria-label="24 小时负荷、光伏和储能 SOC 趋势图"
    >
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={schedule} margin={{ top: 12, right: 10, left: -18, bottom: 0 }}>
          <defs>
            <linearGradient id="tabletLoadFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--color-ink)" stopOpacity={0.12} />
              <stop offset="100%" stopColor="var(--color-ink)" stopOpacity={0} />
            </linearGradient>
            <linearGradient id="tabletSolarFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--color-solar)" stopOpacity={0.24} />
              <stop offset="100%" stopColor="var(--color-solar)" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} stroke="var(--color-rule)" strokeDasharray="2 7" />
          <XAxis
            dataKey="label"
            axisLine={false}
            tickLine={false}
            interval={3}
            tick={{ fill: "var(--color-muted)", fontSize: 12 }}
            tickMargin={10}
          />
          <YAxis
            yAxisId="power"
            axisLine={false}
            tickLine={false}
            tick={{ fill: "var(--color-muted)", fontSize: 12 }}
          />
          <YAxis yAxisId="soc" orientation="right" domain={[0, 100]} hide />
          <Tooltip content={<EnergyTooltip />} cursor={{ stroke: "var(--color-accent)", strokeOpacity: 0.25 }} />
          {selectedLabel && (
            <ReferenceLine yAxisId="power" x={selectedLabel} stroke="var(--color-accent)" strokeDasharray="3 4" />
          )}
          <Area
            isAnimationActive={false}
            yAxisId="power"
            type="monotone"
            dataKey="loadKW"
            name="负荷"
            stroke="var(--color-ink)"
            strokeWidth={2}
            fill="url(#tabletLoadFill)"
            dot={false}
          />
          <Area
            isAnimationActive={false}
            yAxisId="power"
            type="monotone"
            dataKey="solarKW"
            name="光伏"
            stroke="var(--color-solar)"
            strokeWidth={2}
            fill="url(#tabletSolarFill)"
            dot={false}
          />
          <Line
            isAnimationActive={false}
            yAxisId="soc"
            type="monotone"
            dataKey="socAfter"
            name="SOC"
            stroke="var(--color-accent)"
            strokeWidth={2.5}
            dot={false}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
