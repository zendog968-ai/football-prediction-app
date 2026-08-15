import { afterEach, describe, expect, it, vi } from "vitest";
import { deriveLivePoissonResearch, fetchLiveTeamResearch, fetchLiveUpcomingResearch } from "./livePoissonResearch";

afterEach(() => vi.unstubAllGlobals());

function finished(homeId: number, awayId: number, homeGoals: number, awayGoals: number) {
  return {
    fixture: { status: { short: "FT" } },
    teams: { home: { id: homeId, name: `Team ${homeId}` }, away: { id: awayId, name: `Team ${awayId}` } },
    goals: { home: homeGoals, away: awayGoals },
  };
}

const upcoming = {
  fixture: { id: 1, date: "2026-08-20T10:00:00+00:00", status: { short: "NS" } },
  league: { id: 98, season: 2026, name: "J1 League" },
  teams: { home: { id: 1, name: "Vissel Kobe" }, away: { id: 2, name: "FC Tokyo" } },
};

describe("即時可驗證Poisson回退", () => {
  it("以每隊兩場真實歷史建立完整市場與波膽資料", () => {
    const home = [finished(1, 9, 2, 1), finished(8, 1, 0, 1)];
    const away = [finished(2, 7, 1, 1), finished(6, 2, 2, 1)];
    const league = [...home, ...away, finished(3, 4, 1, 0)];
    const result = deriveLivePoissonResearch(upcoming, home, away, league);
    expect(result?.sourceMode).toBe("team-history");
    expect(result?.compactMarkets).toHaveLength(10);
    expect(result?.topScorelines).toHaveLength(3);
  });

  it("在隊伍歷史少於兩場但聯賽平均可驗證時安全使用聯賽平均", () => {
    const league = [finished(3, 4, 1, 0), finished(5, 6, 2, 2), finished(7, 8, 0, 1)];
    const result = deriveLivePoissonResearch(upcoming, [finished(1, 9, 1, 0)], [finished(2, 7, 0, 1)], league);
    expect(result?.sourceMode).toBe("league-average");
    expect(result?.compactMarkets.find(item => item.market === "主客和 (1X2)")?.probability).toBeGreaterThan(0);
  });

  it("在Supabase未命中時以API-Football即時隊伍賽程及歷史產出研究", async () => {
    const history = [finished(1, 9, 2, 1), finished(8, 1, 0, 1), finished(2, 7, 1, 1), finished(6, 2, 2, 1)];
    const fetchMock = vi.fn(async (input: string) => ({
      ok: true,
      json: async () => {
        if (input.includes("/teams?search=Vissel")) return { response: [{ team: { id: 1, name: "Vissel Kobe" } }], errors: [] };
        if (input.includes("/fixtures?team=1&next=10")) return { response: [upcoming], errors: [] };
        if (input.includes("/fixtures?team=1&last=10")) return { response: history, errors: [] };
        if (input.includes("/fixtures?team=2&last=10")) return { response: history, errors: [] };
        if (input.includes("/fixtures?league=98&season=2026&last=40")) return { response: history, errors: [] };
        return { response: [], errors: [] };
      },
    }));
    vi.stubGlobal("fetch", fetchMock);
    const result = await fetchLiveTeamResearch("Vissel Kobe");
    expect(result?.homeTeam).toBe("Vissel Kobe");
    expect(result?.compactMarkets).toHaveLength(10);
    expect(fetchMock).toHaveBeenCalled();
  });

  it("以即時熱門賽程回退最多產出指定數量的研究", async () => {
    const history = [finished(1, 9, 2, 1), finished(8, 1, 0, 1), finished(2, 7, 1, 1), finished(6, 2, 2, 1)];
    const fetchMock = vi.fn(async (input: string) => ({
      ok: true,
      json: async () => {
        if (input.includes("/fixtures?next=30")) return { response: [upcoming], errors: [] };
        if (input.includes("/fixtures?team=1&last=10") || input.includes("/fixtures?team=2&last=10") || input.includes("/fixtures?league=98&season=2026&last=40")) return { response: history, errors: [] };
        return { response: [], errors: [] };
      },
    }));
    vi.stubGlobal("fetch", fetchMock);
    const result = await fetchLiveUpcomingResearch(3);
    expect(result).toHaveLength(1);
    expect(result[0]?.topScorelines).toHaveLength(3);
  });
});
