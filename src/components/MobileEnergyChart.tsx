import {
  Area,
  CartesianGrid,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  ComposedChart,
} from "recharts";
import type { HourlyDispatch } from "../../shared/contracts";

interface TooltipEntry {
  color: string;
  dataKey: string;
  name: string;
  value: number;
}

function MobileTooltip({
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
    <div className="mobile-tooltip">
      <b>{label}</b>
      {payload.map((entry) => (
        <span key={entry.dataKey}>
          <i style={{ background: entry.color }} />
          {entry.name}
          <strong>{entry.dataKey === "socAfter" ? `${entry.value.toFixed(0)}%` : `${entry.value.toFixed(0)} kW`}</strong>
        </span>
      ))}
    </div>
  );
}

export function MobileEnergyChart({
  schedule,
  selectedHour,
}: {
  schedule: HourlyDispatch[];
  selectedHour: number;
}) {
  const selectedLabel = schedule[selectedHour]?.label;
  return (
    <div className="mobile-chart">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={schedule} margin={{ top: 8, right: 4, left: -28, bottom: 0 }}>
          <defs>
            <linearGradient id="loadFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--color-ink)" stopOpacity={0.14} />
              <stop offset="100%" stopColor="var(--color-ink)" stopOpacity={0} />
            </linearGradient>
            <linearGradient id="solarFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--color-solar)" stopOpacity={0.28} />
              <stop offset="100%" stopColor="var(--color-solar)" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} stroke="var(--color-rule)" strokeDasharray="2 6" />
          <XAxis
            dataKey="label"
            axisLine={false}
            tickLine={false}
            interval={5}
            tick={{ fill: "var(--color-muted)", fontSize: 10 }}
            tickMargin={9}
          />
          <YAxis yAxisId="power" axisLine={false} tickLine={false} tick={{ fill: "var(--color-muted)", fontSize: 9 }} />
          <YAxis yAxisId="soc" orientation="right" domain={[0, 100]} hide />
          <Tooltip content={<MobileTooltip />} cursor={{ stroke: "var(--color-accent)", strokeOpacity: 0.22 }} />
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
            fill="url(#loadFill)"
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
            fill="url(#solarFill)"
            dot={false}
          />
          <Line
            isAnimationActive={false}
            yAxisId="soc"
            type="monotone"
            dataKey="socAfter"
            name="SOC"
            stroke="var(--color-accent)"
            strokeWidth={2.4}
            dot={false}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
