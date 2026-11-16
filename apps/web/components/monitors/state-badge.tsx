import type { MonitorState } from "@uptimewatch/db/schema";

const STYLES: Record<MonitorState, { label: string; dot: string; text: string }> = {
  unknown: { label: "Pending", dot: "bg-neutral-500", text: "text-neutral-400" },
  healthy: { label: "Up", dot: "bg-emerald-400", text: "text-emerald-300" },
  degraded: { label: "Degraded", dot: "bg-amber-400", text: "text-amber-300" },
  down: { label: "Down", dot: "bg-red-500", text: "text-red-400" },
  recovering: { label: "Recovering", dot: "bg-sky-400", text: "text-sky-300" },
  paused: { label: "Paused", dot: "bg-neutral-600", text: "text-neutral-500" },
};

export function StateBadge({ state }: { state: MonitorState }) {
  const s = STYLES[state];
  return (
    <span className={`inline-flex items-center gap-1.5 text-sm ${s.text}`}>
      <span className={`h-2 w-2 rounded-full ${s.dot}`} aria-hidden />
      {s.label}
    </span>
  );
}

export const STATE_OPTIONS = Object.entries(STYLES).map(([value, { label }]) => ({ value, label }));

export function formatInterval(seconds: number): string {
  return seconds < 60 ? `${seconds}s` : seconds < 3600 ? `${seconds / 60} min` : `${seconds / 3600} h`;
}

export function formatRelative(date: Date | null, now = new Date()): string {
  if (!date) return "—";
  const s = Math.round((date.getTime() - now.getTime()) / 1000);
  const abs = Math.abs(s);
  const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  if (abs < 60) return rtf.format(s, "second");
  if (abs < 3600) return rtf.format(Math.round(s / 60), "minute");
  if (abs < 86400) return rtf.format(Math.round(s / 3600), "hour");
  return rtf.format(Math.round(s / 86400), "day");
}
