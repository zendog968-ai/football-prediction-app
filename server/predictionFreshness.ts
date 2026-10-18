export function predictionIsFresh(updatedAt: unknown, eventTime: unknown, now = Date.now()): boolean {
  if (typeof updatedAt !== "string" || typeof eventTime !== "string") return false;
  if (!/(?:Z|[+-]\d{2}:\d{2})$/.test(updatedAt) || !/(?:Z|[+-]\d{2}:\d{2})$/.test(eventTime)) return false;
  const generated = Date.parse(updatedAt), kickoff = Date.parse(eventTime);
  return Number.isFinite(generated) && Number.isFinite(kickoff) && kickoff > now
    && generated <= now && generated < kickoff && now - generated <= 2 * 3600000;
}

export function snapshotIsFresh(value: unknown, now = Date.now()): boolean {
  if (typeof value !== "string" || !/(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return false;
  const captured = Date.parse(value);
  return Number.isFinite(captured) && captured <= now && now - captured <= 30 * 60000;
}
