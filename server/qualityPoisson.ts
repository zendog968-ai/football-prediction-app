export const RESEARCH_MODEL_VERSION = "poisson-v4-shrink10-research";
export type VerifiedFixture = {
  result_observed_at?: string;
  fixture?: { id?: number; date?: string; status?: { short?: string } };
  league?: { id?: number; season?: number; name?: string };
  teams?: { home?: { id?: number; name?: string }; away?: { id?: number; name?: string } };
  goals?: { home?: number | null; away?: number | null };
};

export function verifiedHistory(rows: VerifiedFixture[], leagueId: number, season: number, cutoff: number, limit: number) {
  const seen = new Set<string>();
  return rows.filter(row => {
    const date = Date.parse(row.fixture?.date ?? "");
    const hi = row.teams?.home?.id, ai = row.teams?.away?.id;
    const h = row.goals?.home, a = row.goals?.away;
    const key = String(row.fixture?.id ?? `${date}:${hi}:${ai}`);
    if (row.fixture?.status?.short !== "FT" || row.league?.id !== leagueId || row.league?.season !== season
      || !Number.isFinite(date) || !/(?:Z|[+-]\d{2}:\d{2})$/.test(row.fixture?.date ?? "")
      || date + 3 * 3600000 >= cutoff || date < cutoff - 365 * 86400000
      || !Number.isInteger(h) || !Number.isInteger(a) || h! < 0 || a! < 0
      || !Number.isSafeInteger(hi) || !Number.isSafeInteger(ai) || hi! <= 0 || ai! <= 0 || hi === ai || seen.has(key)) return false;
    if (row.result_observed_at !== undefined) {
      const observed = Date.parse(row.result_observed_at);
      if (!Number.isFinite(observed) || observed >= cutoff) return false;
    }
    seen.add(key); return true;
  }).sort((a, b) => Date.parse(a.fixture!.date!) - Date.parse(b.fixture!.date!)).slice(-limit);
}

export function estimateQualityGoals(fixture: VerifiedFixture, homeRows: VerifiedFixture[], awayRows: VerifiedFixture[], leagueRows: VerifiedFixture[], now = new Date()) {
  const kickoff = Date.parse(fixture.fixture?.date ?? "");
  const lid = fixture.league?.id, season = fixture.league?.season;
  const hi = fixture.teams?.home?.id, ai = fixture.teams?.away?.id;
  if (!Number.isSafeInteger(fixture.fixture?.id) || fixture.fixture!.id! <= 0 || fixture.fixture?.status?.short !== "NS" || !Number.isFinite(kickoff) || kickoff <= now.getTime()
    || !/(?:Z|[+-]\d{2}:\d{2})$/.test(fixture.fixture?.date ?? "")
    || !Number.isSafeInteger(lid) || !Number.isSafeInteger(season) || lid! <= 0 || season! <= 0 || !Number.isSafeInteger(hi) || !Number.isSafeInteger(ai) || hi! <= 0 || ai! <= 0 || hi === ai) return null;
  const forTeam = (rows: VerifiedFixture[], id: number) => rows.filter(r => r.teams?.home?.id === id || r.teams?.away?.id === id);
  const home = verifiedHistory(forTeam(homeRows, hi!), lid!, season!, now.getTime(), 10);
  const away = verifiedHistory(forTeam(awayRows, ai!), lid!, season!, now.getTime(), 10);
  const league = verifiedHistory(leagueRows, lid!, season!, now.getTime(), 200);
  if (home.length < 5 || away.length < 5 || league.length < 20) return null;
  const lh = league.reduce((sum, r) => sum + r.goals!.home!, 0) / league.length;
  const la = league.reduce((sum, r) => sum + r.goals!.away!, 0) / league.length;
  const baseline = (lh + la) / 2;
  if (baseline <= 0 || lh <= 0 || la <= 0) return null;
  const rates = (rows: VerifiedFixture[], id: number) => {
    let gf = 0, ga = 0;
    for (const r of rows) {
      const homeSide = r.teams!.home!.id === id;
      gf += homeSide ? r.goals!.home! : r.goals!.away!;
      ga += homeSide ? r.goals!.away! : r.goals!.home!;
    }
    return [(gf + 10 * baseline) / (rows.length + 10), (ga + 10 * baseline) / (rows.length + 10)];
  };
  const [hf, ha] = rates(home, hi!); const [af, aa] = rates(away, ai!);
  const clamp = (value: number) => Math.min(4.5, Math.max(0.2, value));
  return {
    homeMean: clamp(lh * hf! / baseline * aa! / baseline), awayMean: clamp(la * af! / baseline * ha! / baseline),
    modelVersion: RESEARCH_MODEL_VERSION, priorMatches: 10, calibrated: false as const,
    homeMatches: home.length, awayMatches: away.length, leagueMatches: league.length,
    latestHistoryAt: new Date(Math.max(...home.concat(away, league).map(r => Date.parse(r.fixture!.date!)))).toISOString(),
    predictionAsOf: now.toISOString(),
  };
}
