import { ENV } from "./server/_core/env";
import { deriveLivePoissonResearch } from "./server/livePoissonResearch";

async function api(path: string) {
  if (!ENV.apiFootballKey) throw new Error("API-Football Key未設定");
  const response = await fetch(`https://v3.football.api-sports.io${path}`, { headers: { "x-apisports-key": ENV.apiFootballKey }, signal: AbortSignal.timeout(20000) });
  const text = await response.text();
  if (!response.ok) throw new Error(`API-Football ${response.status}: ${text.slice(0, 300)}`);
  const payload = JSON.parse(text) as { response?: unknown[]; errors?: unknown };
  if (payload.errors && Object.keys(payload.errors as object).length) throw new Error(`API-Football errors: ${JSON.stringify(payload.errors)}`);
  return payload.response ?? [];
}

async function main() {
  const fixtureId = process.env.FIXTURE_ID ?? "1575153";
  const rows = await api(`/fixtures?id=${encodeURIComponent(fixtureId)}&timezone=UTC`);
  const fixture = rows[0] as any;
  if (!fixture) throw new Error(`fixture ${fixtureId} not found`);
  const leagueId = fixture.league?.id;
  const season = fixture.league?.season;
  const homeId = fixture.teams?.home?.id;
  const awayId = fixture.teams?.away?.id;
  if (![leagueId, season, homeId, awayId].every(Number.isInteger)) throw new Error("fixture missing league/team metadata");
  const [homeHistory, awayHistory, leagueHistory, odds] = await Promise.all([
    api(`/fixtures?team=${homeId}&last=10&timezone=UTC`),
    api(`/fixtures?team=${awayId}&last=10&timezone=UTC`),
    api(`/fixtures?league=${leagueId}&season=${season}&last=40&timezone=UTC`),
    api(`/odds?fixture=${fixtureId}`).catch(() => []),
  ]);
  const research = deriveLivePoissonResearch(fixture, homeHistory as any, awayHistory as any, leagueHistory as any, odds as any);
  console.log(JSON.stringify({ fixtureId, fixture: { id: fixture.fixture?.id, date: fixture.fixture?.date, league: fixture.league, home: fixture.teams?.home, away: fixture.teams?.away }, research }, null, 2));
}

main().catch((error) => { console.error(error instanceof Error ? error.stack ?? error.message : error); process.exitCode = 1; });
