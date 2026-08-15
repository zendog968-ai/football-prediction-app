import { ENV } from "./_core/env";
import { handicapSelectionProbability, handicapWinDistribution, highestOutcome, mainstreamTotals, outcomeProbabilities, topScorelines, type CompactMarketRow, type ScorelineProbability } from "@shared/compactResearch";

const API_BASE = "https://v3.football.api-sports.io";
const FINISHED = new Set(["FT", "AET", "PEN"]);
const POPULAR_LEAGUE_IDS = new Set([2, 3, 11, 13, 39, 48, 61, 71, 78, 94, 98, 135, 140, 169, 188, 253, 262, 292]);

type ApiFixture = {
  fixture?: { id?: number; date?: string; status?: { short?: string } };
  league?: { id?: number; season?: number; name?: string };
  teams?: { home?: { id?: number; name?: string }; away?: { id?: number; name?: string } };
  goals?: { home?: number | null; away?: number | null };
};

type ApiPayload<T> = { response?: T[]; errors?: Record<string, unknown> | unknown[] };
type ApiTeam = { team?: { id?: number; name?: string } };

export type LiveTeamResearch = {
  homeTeam: string;
  awayTeam: string;
  outcomes: { homeWin: number; draw: number; awayWin: number };
  compactMarkets: CompactMarketRow[];
  topScorelines: ScorelineProbability[];
  sourceMode: "team-history" | "league-average";
};

export function hasCompleteLiveResearch(research: LiveTeamResearch): boolean {
  const outcomes = [research.outcomes.homeWin, research.outcomes.draw, research.outcomes.awayWin];
  const totals = research.compactMarkets.find(item => item.market === "入球大細 2.5");
  const handicap = research.compactMarkets.find(item => item.market === "讓球盤 (Handicap)");
  return outcomes.every(value => Number.isFinite(value) && value >= 0 && value <= 1)
    && Boolean(totals && Number.isFinite(totals.probability))
    && Boolean(handicap && Number.isFinite(handicap.probability))
    && research.topScorelines.length >= 3
    && research.topScorelines.slice(0, 3).every(item => Boolean(item.score) && Number.isFinite(item.probability));
}

type TeamGoals = { matches: number; goalsFor: number; goalsAgainst: number };

function apiErrorCount(payload: ApiPayload<unknown>): number {
  const errors = payload.errors ?? {};
  return Array.isArray(errors) ? errors.length : Object.keys(errors).length;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

async function apiFootball<T>(path: string): Promise<T[]> {
  if (!ENV.apiFootballKey) throw new Error("API-Football Key未設定");
  const url = `${API_BASE}${path}`;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    let response: Response;
    try {
      response = await fetch(url, { headers: { "x-apisports-key": ENV.apiFootballKey } });
    } catch (error) {
      if (attempt < 2) {
        await delay(100 * (attempt + 1));
        continue;
      }
      const message = error instanceof Error ? error.message : "未知網路錯誤";
      throw new Error(`API-Football連線失敗：${message}`);
    }
    if (!response.ok) {
      const retryable = response.status === 408 || response.status === 425 || response.status === 429 || response.status >= 500;
      if (retryable && attempt < 2) {
        await delay(100 * (attempt + 1));
        continue;
      }
      throw new Error(`API-Football請求失敗（${response.status}）`);
    }
    const payload = await response.json() as ApiPayload<T>;
    if (apiErrorCount(payload) > 0) throw new Error("API-Football回傳資料錯誤");
    return payload.response ?? [];
  }
  throw new Error("API-Football重試次數已用盡");
}

function clampMean(value: number): number {
  return Math.min(4.5, Math.max(0.2, value));
}

function teamGoals(history: ApiFixture[], teamId: number): TeamGoals {
  return history.reduce((metrics, item) => {
    if (!FINISHED.has(item.fixture?.status?.short ?? "")) return metrics;
    const homeId = item.teams?.home?.id;
    const awayId = item.teams?.away?.id;
    const homeGoals = item.goals?.home;
    const awayGoals = item.goals?.away;
    if (typeof homeGoals !== "number" || typeof awayGoals !== "number" || !Number.isInteger(homeGoals) || !Number.isInteger(awayGoals)) return metrics;
    if (homeId === teamId) return { matches: metrics.matches + 1, goalsFor: metrics.goalsFor + homeGoals, goalsAgainst: metrics.goalsAgainst + awayGoals };
    if (awayId === teamId) return { matches: metrics.matches + 1, goalsFor: metrics.goalsFor + awayGoals, goalsAgainst: metrics.goalsAgainst + homeGoals };
    return metrics;
  }, { matches: 0, goalsFor: 0, goalsAgainst: 0 });
}

function leagueAverage(history: ApiFixture[]): number | null {
  const totals = history.reduce((summary, item) => {
    if (!FINISHED.has(item.fixture?.status?.short ?? "")) return summary;
    const homeGoals = item.goals?.home;
    const awayGoals = item.goals?.away;
    if (typeof homeGoals !== "number" || typeof awayGoals !== "number" || !Number.isInteger(homeGoals) || !Number.isInteger(awayGoals)) return summary;
    return { matches: summary.matches + 1, goals: summary.goals + homeGoals + awayGoals };
  }, { matches: 0, goals: 0 });
  return totals.matches >= 2 ? totals.goals / (2 * totals.matches) : null;
}

function modelHandicapRows(homeMean: number, awayMean: number, outcomes: { homeWin: number; awayWin: number }): CompactMarketRow[] {
  const side = outcomes.homeWin >= outcomes.awayWin ? "Home" : "Away";
  const sign = side === "Home" ? "-" : "+";
  const lineFor = (line: string) => `${side} ${sign}${line}`;
  return [
    ["讓球盤 (Handicap)", lineFor("0.5")],
    ["亞洲讓球 0.25", lineFor("0.25")],
    ["亞洲讓球 0.75", lineFor("0.75")],
    ["亞洲讓球 1.25", lineFor("1.25")],
    ["亞洲讓球 1.75", lineFor("1.75")],
  ].flatMap(([market, selection]) => {
    const probability = handicapSelectionProbability(selection, homeMean, awayMean);
    const distribution = handicapWinDistribution(selection, homeMean, awayMean);
    return probability === null || !distribution ? [] : [{ market: market as CompactMarketRow["market"], selection: `${selection.replace("Home", "主隊").replace("Away", "客隊")}（模型參考）`, probability, distribution }];
  });
}

export function deriveLivePoissonResearch(fixture: ApiFixture, homeHistory: ApiFixture[], awayHistory: ApiFixture[], leagueHistory: ApiFixture[]): LiveTeamResearch | null {
  const homeId = fixture.teams?.home?.id;
  const awayId = fixture.teams?.away?.id;
  const homeTeam = fixture.teams?.home?.name?.trim();
  const awayTeam = fixture.teams?.away?.name?.trim();
  const resolvedHomeId = typeof homeId === "number" ? homeId : null;
  const resolvedAwayId = typeof awayId === "number" ? awayId : null;
  if (resolvedHomeId === null || resolvedAwayId === null || !Number.isInteger(resolvedHomeId) || !Number.isInteger(resolvedAwayId) || !homeTeam || !awayTeam) return null;
  const baseline = leagueAverage(leagueHistory);
  if (baseline === null) return null;
  const home = teamGoals(homeHistory, resolvedHomeId);
  const away = teamGoals(awayHistory, resolvedAwayId);
  const homeFor = home.matches >= 2 ? home.goalsFor / home.matches : baseline;
  const homeAgainst = home.matches >= 2 ? home.goalsAgainst / home.matches : baseline;
  const awayFor = away.matches >= 2 ? away.goalsFor / away.matches : baseline;
  const awayAgainst = away.matches >= 2 ? away.goalsAgainst / away.matches : baseline;
  const homeMean = clampMean(baseline * (homeFor / baseline) * (awayAgainst / baseline) * 1.08);
  const awayMean = clampMean(baseline * (awayFor / baseline) * (homeAgainst / baseline));
  const outcomes = outcomeProbabilities(homeMean, awayMean);
  if (!outcomes) return null;
  const outcome = highestOutcome(outcomes.homeWin, outcomes.draw, outcomes.awayWin);
  return {
    homeTeam,
    awayTeam,
    outcomes,
    compactMarkets: [outcome, ...mainstreamTotals(homeMean, awayMean), ...modelHandicapRows(homeMean, awayMean, outcomes)].filter((row): row is CompactMarketRow => row !== null),
    topScorelines: topScorelines(homeMean, awayMean),
    sourceMode: home.matches >= 2 && away.matches >= 2 ? "team-history" : "league-average",
  };
}

function upcomingFixture(rows: ApiFixture[]): ApiFixture | null {
  return rows
    .filter(row => ["NS", "TBD", "PST"].includes(row.fixture?.status?.short ?? ""))
    .filter(row => typeof row.fixture?.date === "string" && new Date(row.fixture.date).getTime() >= Date.now())
    .sort((left, right) => new Date(left.fixture?.date ?? 0).getTime() - new Date(right.fixture?.date ?? 0).getTime())[0] ?? null;
}

async function researchForFixture(fixture: ApiFixture): Promise<LiveTeamResearch | null> {
  const homeId = fixture.teams?.home?.id;
  const awayId = fixture.teams?.away?.id;
  const leagueId = fixture.league?.id;
  const season = fixture.league?.season;
  if (!Number.isInteger(homeId) || !Number.isInteger(awayId) || !Number.isInteger(leagueId) || !Number.isInteger(season)) return null;
  const [homeHistory, awayHistory, leagueHistory] = await Promise.all([
    apiFootball<ApiFixture>(`/fixtures?team=${homeId}&last=10&timezone=UTC`),
    apiFootball<ApiFixture>(`/fixtures?team=${awayId}&last=10&timezone=UTC`),
    apiFootball<ApiFixture>(`/fixtures?league=${leagueId}&season=${season}&last=40&timezone=UTC`),
  ]);
  return deriveLivePoissonResearch(fixture, homeHistory, awayHistory, leagueHistory);
}

export async function fetchLiveTeamResearch(teamName: string): Promise<LiveTeamResearch | null> {
  const teams = await apiFootball<ApiTeam>(`/teams?search=${encodeURIComponent(teamName)}`);
  const normalized = teamName.toLowerCase().replace(/[^a-z0-9]/g, "");
  const team = teams.find(item => item.team?.name?.toLowerCase().replace(/[^a-z0-9]/g, "") === normalized) ?? teams[0];
  const teamId = team?.team?.id;
  if (!Number.isInteger(teamId)) return null;
  const fixtures = await apiFootball<ApiFixture>(`/fixtures?team=${teamId}&next=10&timezone=UTC`);
  const fixture = upcomingFixture(fixtures);
  return fixture ? researchForFixture(fixture) : null;
}

export async function fetchLiveUpcomingResearch(limit = 3): Promise<LiveTeamResearch[]> {
  const fixtures = await apiFootball<ApiFixture>("/fixtures?next=30&timezone=UTC");
  const candidates = fixtures.filter(row => POPULAR_LEAGUE_IDS.has(row.league?.id ?? -1));
  const results: LiveTeamResearch[] = [];
  for (const candidate of candidates.slice(0, Math.max(limit * 5, 15))) {
    const research = await researchForFixture(candidate).catch(() => null);
    if (research && hasCompleteLiveResearch(research)) results.push(research);
    if (results.length === limit) break;
  }
  return results;
}
