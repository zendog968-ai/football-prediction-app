import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { deriveLivePoissonResearch, fetchLiveTeamResearch, fetchLiveUpcomingResearch, hasCompleteLiveResearch } from "./livePoissonResearch";
import type { VerifiedFixture } from "./qualityPoisson";
const now = new Date("2026-10-18T09:00:00Z");
const upcoming = { fixture: { id: 1, date: "2026-10-19T09:00:00Z", status: { short: "NS" } }, league: { id: 98, season: 2026, name: "J1 League" }, teams: { home: { id: 1, name: "Vissel Kobe" }, away: { id: 2, name: "FC Tokyo" } } };
function history(team: number, n = 5, hg = 2, ag = 1): VerifiedFixture[] { return Array.from({ length: n }, (_, i) => ({ fixture: { id: team * 100 + i, date: new Date(now.getTime() - (i + 1) * 86400000).toISOString(), status: { short: "FT" } }, league: { id: 98, season: 2026 }, teams: { home: { id: team, name: `Team ${team}` }, away: { id: i + 1000 } }, goals: { home: hg, away: ag } })); }
beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(now); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
describe("verified live research v4", () => {
  it("returns one coherent probability grid and versioned sample provenance", () => {
    const result = deriveLivePoissonResearch(upcoming, history(1), history(2), history(3, 20))!;
    expect(result.sourceMode).toBe("team-history"); expect(result.modelVersion).toBe("poisson-v4-shrink10-research");
    expect(result.outcomes.homeWin + result.outcomes.draw + result.outcomes.awayWin).toBeCloseTo(1, 8);
    expect(result.topScorelines).toHaveLength(3); expect(hasCompleteLiveResearch(result)).toBe(true);
    expect(result.quality?.homeMatches).toBe(5); expect(result.calibrationLabel).toContain("未校準");
  });
  it("does not manufacture team-strength probabilities from league-only averages", () => {
    expect(deriveLivePoissonResearch(upcoming, history(1, 2), history(2, 2), history(3, 20))).toBeNull();
  });
  it("rejects mixed cup history before estimating means", () => {
    const mixed = history(1).map(r => ({ ...r, league: { id: 667, season: 2026 } }));
    expect(deriveLivePoissonResearch(upcoming, mixed, history(2), history(3, 20))).toBeNull();
  });
  it("symmetrically uses favourite -0.5 references rather than inflating away +0.5", () => {
    const r = deriveLivePoissonResearch(upcoming, history(1, 5, 0, 2), history(2, 5, 3, 1), history(3, 20))!;
    const handicap = r.compactMarkets.find(row => row.market === "讓球盤 (Handicap)")!;
    expect(handicap.selection).toContain("客隊 -0.5"); expect(handicap.probability).toBeCloseTo(r.outcomes.awayWin, 6);
  });
  it("rejects incomplete research cards", () => {
    expect(hasCompleteLiveResearch({ outcomes: { homeWin: .5, draw: .25, awayWin: .25 }, compactMarkets: [], topScorelines: [] } as never)).toBe(false);
  });
  it("retrieves own-competition histories and current-season baseline", async () => {
    const fetchMock = vi.fn(async (input: string) => ({ ok: true, json: async () => {
      if (input.includes("/teams?search=")) return { response: [{ team: { id: 1, name: "Vissel Kobe" } }] };
      if (input.includes("/fixtures?team=1&next=")) return { response: [upcoming] };
      if (input.includes("/fixtures?team=1&league=98&season=2026&last=10")) return { response: history(1) };
      if (input.includes("/fixtures?team=2&league=98&season=2026&last=10")) return { response: history(2) };
      if (input.includes("/fixtures?league=98&season=2026&last=200")) return { response: history(3, 20) };
      return { response: [] };
    } }));
    vi.stubGlobal("fetch", fetchMock);
    const r = await fetchLiveTeamResearch("Vissel Kobe"); expect(r?.modelVersion).toBe("poisson-v4-shrink10-research");
    expect(fetchMock.mock.calls.every(([p]) => !p.includes("/fixtures?team=2&last="))).toBe(true);
  });
  it("excludes already-started matches in upcoming fallback", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ response: [{ ...upcoming, fixture: { ...upcoming.fixture, date: "2026-10-17T09:00:00Z" } }] }) })));
    expect(await fetchLiveUpcomingResearch(3)).toHaveLength(0);
  });
});
