const DAY = 86_400_000;

export function startOfDay(d = new Date()): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

export function isoAt(daysFromToday: number, hours = 9): string {
  const d = startOfDay();
  d.setDate(d.getDate() + daysFromToday);
  d.setHours(hours, 0, 0, 0);
  return d.toISOString();
}

export function parseUntil(until: string): Date {
  const raw = until.trim();
  const rel = raw.match(/^(\d+)\s*([dwm])$/i);
  if (rel) {
    const n = Number(rel[1]);
    const unit = rel[2].toLowerCase();
    const d = new Date();
    if (unit === "d") d.setDate(d.getDate() + n);
    if (unit === "w") d.setDate(d.getDate() + n * 7);
    if (unit === "m") d.setMonth(d.getMonth() + n);
    d.setHours(9, 0, 0, 0);
    return d;
  }
  // Date inputs describe a local calendar day, not midnight UTC.
  const dateOnly = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const parsed = new Date(dateOnly ? `${raw}T09:00:00` : raw);
  if (dateOnly && (
    parsed.getFullYear() !== Number(dateOnly[1]) ||
    parsed.getMonth() + 1 !== Number(dateOnly[2]) ||
    parsed.getDate() !== Number(dateOnly[3])
  )) {
    throw new Error(`Invalid date: ${until}`);
  }
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Invalid date: ${until}. Use ISO or relative like 3d, 1w.`);
  }
  return parsed;
}

export function daysUntil(iso: string | null, now = new Date()): number | null {
  if (!iso) return null;
  const due = startOfDay(new Date(iso));
  const today = startOfDay(now);
  return Math.round((due.getTime() - today.getTime()) / DAY);
}

export function isOverdue(iso: string | null, now = new Date()): boolean {
  const n = daysUntil(iso, now);
  return n !== null && n < 0;
}

export function isDueToday(iso: string | null, now = new Date()): boolean {
  return daysUntil(iso, now) === 0;
}

export function relativeDue(iso: string | null, now = new Date()): string | null {
  const n = daysUntil(iso, now);
  if (n === null) return null;
  if (n === 0) return "today";
  if (n === 1) return "tomorrow";
  if (n === -1) return "1d overdue";
  if (n < 0) return `${Math.abs(n)}d overdue`;
  if (n < 7) return `${n}d`;
  const d = new Date(iso!);
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

export function formatWhen(iso: string, now = new Date()): string {
  const t = new Date(iso);
  const diff = now.getTime() - t.getTime();
  const mins = Math.round(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days === 1) return "yesterday";
  if (days < 7) return `${days}d ago`;
  return t.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function nextFridayIso(): string {
  const d = startOfDay();
  const day = d.getDay();
  const add = day === 5 ? 7 : (5 - day + 7) % 7;
  return isoAt(add, 19);
}
