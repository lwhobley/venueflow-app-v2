// Venue-local time helpers. Venues report against their own business day, not
// the server's (UTC on Railway). All helpers fall back to UTC when the venue
// has no timezone configured, preserving the previous behavior.

const FALLBACK_TZ = 'UTC';

function safeTimeZone(timeZone: string | null | undefined): string {
  if (!timeZone) return FALLBACK_TZ;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return timeZone;
  } catch {
    return FALLBACK_TZ;
  }
}

// Milliseconds the zone is ahead of UTC at the given instant (DST-aware).
function tzOffsetMs(timeZone: string, at: Date): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  const parts = Object.fromEntries(dtf.formatToParts(at).map((p) => [p.type, p.value]));
  const wallClockAsUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour) % 24,
    Number(parts.minute),
    Number(parts.second),
  );
  return wallClockAsUtc - at.getTime();
}

/** The venue-local day-of-week (0 = Sunday … 6 = Saturday) at the given instant. */
export function zonedDayOfWeek(timeZone: string | null | undefined, ts: number): number {
  const tz = safeTimeZone(timeZone);
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short' }).formatToParts(new Date(ts)).map((p) => [p.type, p.value]),
  );
  const map: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return map[parts.weekday] ?? new Date(ts).getUTCDay();
}

/** Minutes since midnight (0–1439) in the venue's local time at the given instant. */
export function zonedMinutesOfDay(timeZone: string | null | undefined, ts: number): number {
  const tz = safeTimeZone(timeZone);
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false })
      .formatToParts(new Date(ts))
      .map((p) => [p.type, p.value]),
  );
  return (Number(parts.hour) % 24) * 60 + Number(parts.minute);
}

/** The venue-local calendar date (YYYY-MM-DD) of the given instant. */
export function zonedIsoDate(timeZone: string | null | undefined, ts: number): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: safeTimeZone(timeZone),
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(ts));
}

/** UTC instant range [start, end) for a specific local YYYY-MM-DD date. */
export function zonedDateBounds(
  timeZone: string | null | undefined,
  isoDate: string,
): { start: number; end: number } {
  const tz = safeTimeZone(timeZone);
  const [y, m, d] = isoDate.split('-').map(Number);
  const boundary = (dayOffset: number) => {
    const utcGuess = Date.UTC(y, m - 1, d + dayOffset);
    return utcGuess - tzOffsetMs(tz, new Date(utcGuess - tzOffsetMs(tz, new Date(utcGuess))));
  };
  return { start: boundary(0), end: boundary(1) };
}

/**
 * UTC instant range [start, end) of a venue-local calendar day, offset from
 * the venue's "today" by offsetDays. DST-safe (end is the next day's start).
 */
export function zonedDayBounds(
  timeZone: string | null | undefined,
  offsetDays: number,
): { start: number; end: number } {
  const tz = safeTimeZone(timeZone);
  const todayIso = zonedIsoDate(tz, Date.now());
  const [y, m, d] = todayIso.split('-').map(Number);
  const targetIso = new Date(Date.UTC(y, m - 1, d + offsetDays)).toISOString().slice(0, 10);
  return zonedDateBounds(tz, targetIso);
}

/**
 * The UTC instant of a venue-local wall-clock time on a specific local date.
 *
 * Shift times are stored as a local date (`YYYY-MM-DD`) plus a local clock
 * string (`HH:mm`) with no offset, so reading them as UTC shifts every venue by
 * its own offset — for a US venue that lands hours away from the real moment.
 *
 * Uses the same double-correction as zonedDateBounds so it stays right across a
 * DST boundary. Falls back to UTC for an unknown zone, and to midnight for an
 * unparseable time, matching the rest of this module.
 */
export function zonedWallClockToUtc(
  timeZone: string | null | undefined,
  isoDate: string,
  clock: string,
): number {
  const tz = safeTimeZone(timeZone);
  const [y, m, d] = isoDate.split('-').map(Number);
  const [rawH, rawMin] = (clock || '00:00').split(':').map(Number);
  const hour = Number.isFinite(rawH) ? Math.min(23, Math.max(0, rawH)) : 0;
  const minute = Number.isFinite(rawMin) ? Math.min(59, Math.max(0, rawMin)) : 0;

  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return NaN;

  const utcGuess = Date.UTC(y, m - 1, d, hour, minute);
  return utcGuess - tzOffsetMs(tz, new Date(utcGuess - tzOffsetMs(tz, new Date(utcGuess))));
}
