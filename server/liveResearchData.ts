// Research coverage only: this list must not grant calibrated-model support.
export const LIVE_RESEARCH_LEAGUE_IDS: ReadonlySet<number> = new Set([
  2, 3, 11, 13, 39, 40, 48, 61, 71, 78, 79, 88, 94, 98, 103,
  135, 140, 169, 188, 253, 262, 292,
]);
export const ADDITIONAL_LIVE_RESEARCH_LEAGUES = [
  { code: "NED1", id: 88 },
  { code: "NOR1", id: 103 },
  { code: "GER2", id: 79 },
] as const;

export function leagueSeasonFixturesPath(leagueId: number, season: number): string {
  if (!Number.isInteger(leagueId) || leagueId <= 0 || !Number.isInteger(season) || season < 1900 || season > 2200) {
    throw new Error("聯賽或賽季識別碼無效");
  }
  // The provider rejects last=200. Fetch this competition's season; the
  // existing quality estimator applies FT/as-of/365-day and <=200 guards.
  return `/fixtures?league=${leagueId}&season=${season}&timezone=UTC`;
}

type FixtureCandidate = {
  fixture?: { id?: number; date?: string; status?: { short?: string } };
  league?: { id?: number };
};
export function selectLiveUpcomingFixtures<T extends FixtureCandidate>(rows: T[], nowMs = Date.now()): T[] {
  const unique = new Map<number, T>();
  for (const row of rows) {
    const id = row.fixture?.id;
    if (typeof id !== "number" || !Number.isInteger(id) || id <= 0
      || !LIVE_RESEARCH_LEAGUE_IDS.has(row.league?.id ?? -1)
      || row.fixture?.status?.short !== "NS"
      || !Number.isFinite(Date.parse(row.fixture?.date ?? ""))
      || Date.parse(row.fixture?.date ?? "") <= nowMs) continue;
    if (!unique.has(id)) unique.set(id, row);
  }
  return Array.from(unique.values()).sort((a, b) =>
    Date.parse(a.fixture!.date!) - Date.parse(b.fixture!.date!) || a.fixture!.id! - b.fixture!.id!);
}
