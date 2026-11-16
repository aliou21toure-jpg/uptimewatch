import { ERROR_LABELS, type CheckErrorCode } from "@uptimewatch/monitoring/errors";

const STYLES = {
  open: { label: "Open", cls: "bg-red-500/15 text-red-300 ring-red-500/30" },
  acknowledged: { label: "Acknowledged", cls: "bg-amber-500/15 text-amber-300 ring-amber-500/30" },
  resolved: { label: "Resolved", cls: "bg-emerald-500/10 text-emerald-300 ring-emerald-500/30" },
} as const;

export function IncidentBadge({ status }: { status: keyof typeof STYLES }) {
  const s = STYLES[status];
  return <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ring-1 ${s.cls}`}>{s.label}</span>;
}

export function causeLabel(code: string | null): string {
  if (!code) return "Check failed";
  return ERROR_LABELS[code as CheckErrorCode] ?? code;
}

export function formatDuration(from: Date, to: Date | null, now = new Date()): string {
  const ms = (to ?? now).getTime() - from.getTime();
  const minutes = Math.max(0, Math.round(ms / 60_000));
  if (minutes < 1) return "< 1 min";
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours} h ${minutes % 60} min`;
  return `${Math.floor(hours / 24)} d ${hours % 24} h`;
}
