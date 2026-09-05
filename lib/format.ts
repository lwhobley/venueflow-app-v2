/**
 * Shared formatting utilities for money, dates, times, tags, and dollar parsing.
 *
 * These were previously duplicated across guests.tsx, sales.tsx, integrations.tsx,
 * CrmSalesWorkspace.tsx, reservations.tsx, clock.tsx, chat/[id].tsx, and others.
 */

/** Format cents as `$X.XX` with locale-aware thousands separators. */
export function formatMoney(cents: number | null | undefined): string {
  return `$${((cents ?? 0) / 100).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/** Format cents as a rounded whole-dollar string (`$X`). */
export function formatMoneyWhole(cents: number | null | undefined): string {
  return `$${((cents ?? 0) / 100).toLocaleString('en-US', {
    maximumFractionDigits: 0,
  })}`;
}

/** Short date: "Jun 30". Returns the fallback if value is nullish. */
export function formatShortDate(value: number | null | undefined, fallback = 'None'): string {
  return value
    ? new Date(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
    : fallback;
}

/** Short weekday + date: "Mon, Jun 30". */
export function formatWeekdayDate(value: number): string {
  return new Date(value).toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

/** Short date + time: "Jun 30, 5:00 PM". */
export function formatShortDateTime(value: number): string {
  return new Date(value).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/** Full date + time: "Monday, June 30, 2026, 5:00 PM". */
export function formatFullDateTime(value: number): string {
  return new Date(value).toLocaleString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/** Time only: "5:00 PM". */
export function formatTime(at: number): string {
  return new Date(at).toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  });
}

/**
 * Relative time label: time-only for today, short date otherwise.
 * Returns empty string for nullish input.
 */
export function formatRelativeTime(value: number | null | undefined): string {
  if (!value) return '';
  const date = new Date(value);
  const today = new Date();
  if (date.toDateString() === today.toDateString()) {
    return formatTime(value);
  }
  return formatShortDate(value);
}

/** Split a comma-separated string into trimmed, non-empty tags. */
export function splitTags(value: string): string[] {
  return value
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean);
}

/**
 * Parse a dollar string (e.g. "$1,234.56") to cents.
 * Returns `undefined` for invalid or non-positive values.
 */
export function dollarsToCents(value: string): number | undefined {
  const amount = Number(value.replace(/[$,]/g, '').trim());
  return Number.isFinite(amount) && amount > 0 ? Math.round(amount * 100) : undefined;
}

/** Extract a human-readable message from a caught error. */
export function errorMessage(error: unknown, fallback = 'Something went wrong.'): string {
  return error instanceof Error ? error.message : fallback;
}

/** Format a percentage: "42%" or "—" when the denominator is zero. */
export function formatPct(part: number, whole: number): string {
  if (!whole) return '—';
  return `${Math.round((part / whole) * 100)}%`;
}

/** Format minutes as a human-readable duration: "2h 15m" or "45 min". */
export function formatDuration(minutes: number | null | undefined): string {
  if (minutes == null) return '—';
  if (minutes < 60) return `${Math.round(minutes)} min`;
  const h = Math.floor(minutes / 60);
  const rem = Math.round(minutes % 60);
  return rem > 0 ? `${h}h ${rem}m` : `${h}h`;
}

/** Zero-pad a number to two digits. */
export function pad2(n: number): string {
  return n.toString().padStart(2, '0');
}

/**
 * Coerce a value that is *supposed* to be a list into one.
 *
 * API payloads are not runtime-validated, so a degraded, partial, or
 * non-JSON response can hand a screen an object or a string where it expects
 * an array. `value ?? []` only covers null/undefined; anything else reaches
 * `.map`/`.filter` and throws, which takes the whole screen down. Use this at
 * every boundary where a network payload is first treated as a list.
 */
export function asArray<T>(value: T[] | null | undefined): T[];
export function asArray<T = unknown>(value: unknown): T[];
export function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/**
 * Render a snake_case API enum as a human label ("pre_open" -> "Pre Open").
 *
 * Accepts a missing value because these are read straight off API rows: a
 * status the server omitted used to throw inside `replaceAll` and take the
 * screen down.
 */
export function humanizeLabel(value: string | null | undefined, fallback = '—'): string {
  if (typeof value !== 'string' || !value) return fallback;
  return value.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}
