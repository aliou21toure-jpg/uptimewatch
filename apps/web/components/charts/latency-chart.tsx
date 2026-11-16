"use client";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

export interface HourPoint {
  hour: string;
  p50: number | null;
  p95: number | null;
  up: number;
  down: number;
}

// Validated categorical slots 1–2 for the dark surface (dataviz reference palette).
const SERIES = [
  { key: "p50", name: "P50", color: "#3987e5" },
  { key: "p95", name: "P95", color: "#d95926" },
] as const;
const MUTED = "#898781";
const GRID = "#2c2c2a";

const hourLabel = (iso: string) => new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });

const BUCKET_MS = 10 * 60_000;

/** Fills every 10-minute bucket of the last 24 h so gaps show as gaps instead of being interpolated over. */
function fill(points: HourPoint[]): HourPoint[] {
  const byBucket = new Map(points.map((p) => [p.hour, p]));
  const end = Math.floor(Date.now() / BUCKET_MS) * BUCKET_MS;
  const count = (24 * 3_600_000) / BUCKET_MS;
  return Array.from({ length: count + 1 }, (_, i) => {
    const hour = new Date(end - (count - i) * BUCKET_MS).toISOString();
    return byBucket.get(hour) ?? { hour, p50: null, p95: null, up: 0, down: 0 };
  });
}

interface TooltipProps {
  active?: boolean | undefined;
  payload?: readonly { payload?: unknown }[] | undefined;
  label?: string | number | undefined;
}

function ChartTooltip({ active, payload, label }: TooltipProps) {
  if (!active || !payload?.length) return null;
  const point = payload[0]!.payload as HourPoint;
  return (
    <div className="rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-xs shadow-lg">
      <p className="mb-1 text-neutral-400">{hourLabel(String(label))}–{hourLabel(new Date(new Date(String(label)).getTime() + BUCKET_MS).toISOString())} · {point.up + point.down} checks{point.down ? `, ${point.down} failed` : ""}</p>
      {SERIES.map((s) => (
        <p key={s.key} className="flex items-center gap-2">
          <span className="inline-block h-0.5 w-3" style={{ backgroundColor: s.color }} aria-hidden />
          <span className="font-semibold text-neutral-100 tabular-nums">{point[s.key] === null ? "—" : `${point[s.key]} ms`}</span>
          <span className="text-neutral-400">{s.name}</span>
        </p>
      ))}
    </div>
  );
}

export function LatencyChart({ points }: { points: HourPoint[] }) {
  const data = fill(points);
  const hasData = data.some((d) => d.p50 !== null);
  return (
    <figure>
      <div className="mb-3 flex items-center justify-between">
        <figcaption className="text-sm font-medium">Response time, last 24 hours</figcaption>
        <ul className="flex gap-4 text-xs text-neutral-300">
          {SERIES.map((s) => (
            <li key={s.key} className="flex items-center gap-1.5">
              <span className="inline-block h-0.5 w-4" style={{ backgroundColor: s.color }} aria-hidden />
              {s.name}
            </li>
          ))}
        </ul>
      </div>
      {!hasData ? (
        <p className="py-16 text-center text-sm text-neutral-500">No successful checks in the last 24 hours.</p>
      ) : (
        <div className="h-56">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid stroke={GRID} vertical={false} />
              <XAxis dataKey="hour" tickFormatter={hourLabel} stroke={MUTED} tickLine={false} axisLine={{ stroke: "#383835" }} fontSize={11} minTickGap={32} />
              <YAxis stroke={MUTED} tickLine={false} axisLine={false} fontSize={11} width={56} tickFormatter={(v: number) => `${v} ms`} />
              <Tooltip content={(props) => <ChartTooltip active={props.active} payload={props.payload} label={props.label} />} cursor={{ stroke: MUTED, strokeWidth: 1 }} />
              {SERIES.map((s) => (
                <Line key={s.key} type="monotone" dataKey={s.key} name={s.name} stroke={s.color} strokeWidth={2} dot={false} activeDot={{ r: 4, strokeWidth: 2, stroke: "#121212" }} connectNulls={false} isAnimationActive={false} />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </figure>
  );
}
