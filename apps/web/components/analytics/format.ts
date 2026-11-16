/** Truncates instead of rounding so 99.996 % never displays as 100 %. */
export function formatPercent(value: number | null, digits = 2): string {
  if (value === null) return "—";
  if (value >= 100) return "100%";
  const f = 10 ** digits;
  return `${(Math.floor(value * f) / f).toFixed(digits)}%`;
}

export function formatMs(value: number | null): string {
  return value === null ? "—" : `${Math.round(value)} ms`;
}

export function formatDowntime(seconds: number): string {
  if (seconds <= 0) return "none";
  const m = Math.round(seconds / 60);
  if (m < 1) return "< 1 min";
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return h < 48 ? `${h} h ${m % 60} min` : `${Math.floor(h / 24)} d ${h % 24} h`;
}

/** Status thresholds for uptime, paired with a label so color is never the only cue. */
export function uptimeLevel(value: number | null): { label: string; color: string } {
  if (value === null) return { label: "No data", color: "#383835" };
  if (value >= 99.9) return { label: "Operational", color: "#0ca30c" };
  if (value >= 99) return { label: "Minor issues", color: "#fab219" };
  if (value >= 95) return { label: "Degraded", color: "#ec835a" };
  return { label: "Major outage", color: "#d03b3b" };
}
