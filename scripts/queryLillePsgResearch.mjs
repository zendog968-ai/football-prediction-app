import { deriveLivePoissonResearch } from "../server/livePoissonResearch.ts";

const apiBase = "https://v3.football.api-sports.io";
const key = process.env.API_FOOTBALL_KEY;
if (!key) throw new Error("API_FOOTBALL_KEY未設定");

async function api(path) {
  const response = await fetch(`${apiBase}${path}`, { headers: { "x-apisports-key": key } });
  const payload = await response.json();
  if (!response.ok || (payload.errors && Object.keys(payload.errors).length)) {
    throw new Error(`API請求失敗：${response.status}`);
  }
  return payload.response ?? [];
}

const fixtureId = 1552746;
const fixtureRows = await api(`/fixtures?id=${fixtureId}`);
const fixture = fixtureRows[0];
if (!fixture?.teams?.home?.id || !fixture?.teams?.away?.id) throw new Error("找不到指定賽事的隊伍識別");
const homeId = fixture.teams.home.id;
const awayId = fixture.teams.away.id;
const leagueId = fixture.league?.id ?? 61;
const season = fixture.league?.season ?? 2026;
const [homeHistory, awayHistory, leagueHistory, oddsRows] = await Promise.all([
  api(`/fixtures?team=${homeId}&last=10`),
  api(`/fixtures?team=${awayId}&last=10`),
  api(`/fixtures?league=${leagueId}&season=${season}`),
  api(`/odds?fixture=${fixtureId}`),
]);
const research = deriveLivePoissonResearch(fixture, homeHistory, awayHistory, leagueHistory, oddsRows);
if (!research) throw new Error("現有API回應不足以產生可驗證研究");
const result = {
  fixtureId: research.fixtureId,
  league: research.leagueName,
  kickoffUtc: research.kickoffAt.toISOString(),
  homeTeam: research.homeTeam,
  awayTeam: research.awayTeam,
  outcomes: research.outcomes,
  topScorelines: research.topScorelines,
  compactMarkets: research.compactMarkets.filter(item => ["入球大細 2.5", "讓球盤 (Handicap)"].includes(item.market)),
  sourceMode: research.sourceMode,
  calibrationLabel: research.calibrationLabel,
  dcRho: research.dcRho,
  marketEnsembleUsed: research.marketEnsembleUsed,
  doubleChance: research.doubleChance,
  preMatchRisk: research.preMatchRisk,
  historyCounts: {
    homeTeamFinished: homeHistory.filter(item => ["FT", "AET", "PEN"].includes(item.fixture?.status?.short ?? "")).length,
    awayTeamFinished: awayHistory.filter(item => ["FT", "AET", "PEN"].includes(item.fixture?.status?.short ?? "")).length,
    leagueFinished: leagueHistory.filter(item => ["FT", "AET", "PEN"].includes(item.fixture?.status?.short ?? "")).length,
    oddsRows: oddsRows.length,
  },
};
console.log(JSON.stringify(result, null, 2));
