import { describe, expect, it } from "vitest";
import { ADDITIONAL_LIVE_RESEARCH_LEAGUES, LIVE_RESEARCH_LEAGUE_IDS, leagueSeasonFixturesPath, selectLiveUpcomingFixtures } from "./liveResearchData";
import { SUPPORTED_LEAGUE_CODES } from "./prediction";
const now = Date.parse("2026-10-18T09:00:00Z");
function fixture(id: number, league: number, date = "2026-10-19T09:00:00Z", status = "NS") {
  return { fixture: { id, date, status: { short: status } }, league: { id: league } };
}
describe("live research source contract", () => {
  it("uses a legal full-season query without the rejected last=200 parameter", () => {
    for (const { id } of ADDITIONAL_LIVE_RESEARCH_LEAGUES) {
      expect(leagueSeasonFixturesPath(id, 2026)).toBe(`/fixtures?league=${id}&season=2026&timezone=UTC`);
      expect(leagueSeasonFixturesPath(id, 2026)).not.toContain("last=");
    }
  });
  it.each([[0,2026],[-1,2026],[88,NaN],[88,1],[88,2201],[88.5,2026]])("rejects malformed query identities %s/%s", (league, season) => {
    expect(() => leagueSeasonFixturesPath(league, season)).toThrow();
  });
  it("adds NED1/NOR1/GER2 research without granting NOR1/GER2 calibrated support", () => {
    expect(ADDITIONAL_LIVE_RESEARCH_LEAGUES.map(x => x.code)).toEqual(["NED1", "NOR1", "GER2"]);
    for (const { id } of ADDITIONAL_LIVE_RESEARCH_LEAGUES) expect(LIVE_RESEARCH_LEAGUE_IDS.has(id)).toBe(true);
    expect(SUPPORTED_LEAGUE_CODES.has("NED1")).toBe(true);
    expect(SUPPORTED_LEAGUE_CODES.has("NOR1")).toBe(false);
    expect(SUPPORTED_LEAGUE_CODES.has("GER2")).toBe(false);
  });
  it("deduplicates overlapping global and league results and sorts by kickoff", () => {
    const rows=[fixture(2,103,"2026-10-19T11:00:00Z"),fixture(1,88),fixture(1,88),fixture(3,79)];
    expect(selectLiveUpcomingFixtures(rows,now).map(x=>x.fixture.id)).toEqual([1,3,2]);
  });
  it("rejects started, malformed, postponed and unsupported fixtures", () => {
    const rows=[fixture(1,88,"2026-10-18T09:00:00Z"),fixture(2,103,"invalid"),fixture(3,79,undefined,"PST"),fixture(4,667),fixture(0,88),fixture(5,88,undefined,"FT")];
    expect(selectLiveUpcomingFixtures(rows,now)).toEqual([]);
  });
});
