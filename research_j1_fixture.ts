import { fetchLiveTeamResearch } from "./server/livePoissonResearch";

async function main() {
  const research = await fetchLiveTeamResearch("Avispa Fukuoka");
  if (!research) {
    console.log(JSON.stringify({ ok: false, reason: "no_research" }, null, 2));
    return;
  }
  console.log(JSON.stringify({
    ok: true,
    fixtureId: research.fixtureId,
    leagueCode: research.leagueCode,
    leagueName: research.leagueName,
    kickoffAt: research.kickoffAt.toISOString(),
    homeTeam: research.homeTeam,
    awayTeam: research.awayTeam,
    outcomes: research.outcomes,
    doubleChance: research.doubleChance,
    compactMarkets: research.compactMarkets,
    topScorelines: research.topScorelines,
    sourceMode: research.sourceMode,
    calibrationLabel: research.calibrationLabel,
    dcRho: research.dcRho,
    marketEnsembleUsed: research.marketEnsembleUsed,
    highConfidence: research.highConfidence,
    preMatchRisk: research.preMatchRisk,
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exitCode = 1;
});
