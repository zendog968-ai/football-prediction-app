import { fetchLiveTeamResearch } from "./server/livePoissonResearch";

const teams = [
  { fixtureId: 1575149, home: "VfB Stuttgart", away: "1. FC Köln" },
  { fixtureId: 1575155, home: "Werder Bremen", away: "RB Leipzig" },
  { fixtureId: 1575150, home: "1899 Hoffenheim", away: "Borussia Dortmund" },
  { fixtureId: 1575153, home: "Borussia Mönchengladbach", away: "SV Elversberg" },
  { fixtureId: 1575151, home: "Bayer Leverkusen", away: "Union Berlin" },
  { fixtureId: 1575157, home: "SC Paderborn 07", away: "SC Freiburg" },
];

async function main() {
  const results = [];
  for (const item of teams) {
    try {
      const research = await fetchLiveTeamResearch(item.home);
      results.push({ target: item, research });
    } catch (error) {
      results.push({ target: item, error: error instanceof Error ? error.message : String(error) });
    }
  }
  console.log(JSON.stringify({ dateHkt: "2026-09-05", results }, null, 2));
}

main().catch((error) => { console.error(error instanceof Error ? error.stack ?? error.message : error); process.exitCode = 1; });
