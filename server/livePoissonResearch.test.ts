import { afterEach, describe, expect, it, vi } from "vitest";
import { deriveLivePoissonResearch, fetchLiveTeamResearch, fetchLiveUpcomingResearch, hasCompleteLiveResearch } from "./livePoissonResearch";

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

  it("拒絕缺少主流2.5大小球、讓球或三個波膽的即時研究", () => {
    const incomplete = {
      homeTeam: "Example Home", awayTeam: "Example Away",
      outcomes: { homeWin: 0.5, draw: 0.25, awayWin: 0.25 },
      compactMarkets: [{ market: "主客和 (1X2)", selection: "主勝", probability: 0.5 }],
      topScorelines: [{ score: "1-0", probability: 0.1 }], sourceMode: "league-average",
    } as never;
    expect(hasCompleteLiveResearch(incomplete)).toBe(false);
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

  it("英冠布里斯托城即使缺少即時賠率，仍只以真實歷史賽果產出完整基礎Poisson研究", async () => {
    const championshipFixture = {
      fixture: { id: 1563083, date: "2026-08-16T14:00:00+00:00", status: { short: "NS" } },
      league: { id: 40, season: 2026, name: "Championship" },
      teams: { home: { id: 55, name: "Bristol City" }, away: { id: 64, name: "Millwall" } },
    };
    const history = [finished(55, 90, 2, 1), finished(91, 55, 0, 1), finished(64, 92, 1, 1), finished(93, 64, 2, 1)];
    const fetchMock = vi.fn(async (input: string) => ({
      ok: true,
      json: async () => {
        if (input.includes("/teams?search=Bristol%20City")) return { response: [{ team: { id: 55, name: "Bristol City" } }], errors: [] };
        if (input.includes("/fixtures?team=55&next=10")) return { response: [championshipFixture], errors: [] };
        if (input.includes("/fixtures?team=55&league=40&season=2025") || input.includes("/fixtures?team=64&league=40&season=2025") || input.includes("/fixtures?league=40&season=2025")) return { response: history, errors: [] };
        return { response: [], errors: [] };
      },
    }));
    vi.stubGlobal("fetch", fetchMock);
    const result = await fetchLiveTeamResearch("Bristol City");
    expect(result?.homeTeam).toBe("Bristol City");
    expect(result?.awayTeam).toBe("Millwall");
    expect(result && hasCompleteLiveResearch(result)).toBe(true);
    expect(result?.calibrationLabel).toContain("英冠正式聯賽樣本");
    expect(fetchMock.mock.calls.some(([input]) => String(input).includes("team=55&league=40&season=2025"))).toBe(true);
    expect(fetchMock.mock.calls.some(([input]) => String(input).includes("/odds"))).toBe(false);
  });

  it("在短暫API連線失敗後重試並完成即時隊伍研究", async () => {
    const history = [finished(1, 9, 2, 1), finished(8, 1, 0, 1), finished(2, 7, 1, 1), finished(6, 2, 2, 1)];
    let calls = 0;
    const fetchMock = vi.fn(async (input: string) => {
      calls += 1;
      if (calls === 1) throw new Error("temporary SSL failure");
      return {
        ok: true,
        json: async () => {
          if (input.includes("/teams?search=Vissel")) return { response: [{ team: { id: 1, name: "Vissel Kobe" } }], errors: [] };
          if (input.includes("/fixtures?team=1&next=10")) return { response: [upcoming], errors: [] };
          if (input.includes("/fixtures?team=1&last=10") || input.includes("/fixtures?team=2&last=10") || input.includes("/fixtures?league=98&season=2026&last=40")) return { response: history, errors: [] };
          return { response: [], errors: [] };
        },
      };
    });
    vi.stubGlobal("fetch", fetchMock);
    const result = await fetchLiveTeamResearch("Vissel Kobe");
    expect(result?.topScorelines).toHaveLength(3);
    expect(fetchMock.mock.calls.length).toBeGreaterThan(4);
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
