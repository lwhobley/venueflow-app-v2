export type TimeBreak = {
  startAt: number;
  endAt: number | null;
  type: 'paid' | 'unpaid';
};

/** Parse the JSON break column without trusting its persisted shape. */
export function parseTimeBreaks(value: unknown): TimeBreak[] {
  const list = Array.isArray(value)
    ? value
    : typeof value === 'object' && value !== null && Array.isArray((value as Record<string, unknown>).intervals)
      ? ((value as Record<string, unknown>).intervals as unknown[])
      : [];
  return list.flatMap((candidate): TimeBreak[] => {
    if (!candidate || typeof candidate !== 'object') return [];
    const row = candidate as Record<string, unknown>;
    const startAt = typeof row.startAt === 'number' ? row.startAt : Number(row.startAt);
    const endAt = row.endAt === null ? null : typeof row.endAt === 'number' ? row.endAt : Number(row.endAt);
    if (!Number.isFinite(startAt)) return [];
    if (endAt !== null && (!Number.isFinite(endAt) || endAt < startAt)) return [];
    if (row.type !== 'paid' && row.type !== 'unpaid') return [];
    return [{ startAt, endAt, type: row.type }];
  });
}

/** Safe unpaid-break duration in ms. Non-numeric or inverted ranges yield 0. */
export function unpaidBreakMs(startAt: unknown, endAt: unknown): number {
  const start = typeof startAt === 'number' ? startAt : Number(startAt);
  const end = typeof endAt === 'number' ? endAt : Number(endAt);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 0;
  return end - start;
}
