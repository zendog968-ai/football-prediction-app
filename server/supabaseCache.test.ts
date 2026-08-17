import { afterEach, describe, expect, it, vi } from "vitest";
import { __resetSupabaseUpcomingCacheForTests, getSupabaseUpcomingCache } from "./supabaseCache";

afterEach(() => {
  vi.unstubAllGlobals();
  __resetSupabaseUpcomingCacheForTests();
});

describe("英冠Supabase研究卡快取", () => {
  it("保留大於1的預期入球，並重建大細球與Top 3波膽", async () => {
    const fetchMock = vi.fn(async (input: URL | string) => ({
      ok: true,
      json: async () => {
        const url = String(input);
        if (url.includes("fixtures?")) return [{ fixture_id: 1563085, league_name: "Championship", event_time: "2026-08-15T14:00:00Z", home_team: "Bristol City", away_team: "Millwall", status: "NS", updated_at: "2026-08-15T10:00:00Z" }];
        if (url.includes("ai_predictions?")) return [{ fixture_id: 1563085, home_win_prob: 0.23, draw_prob: 0.32, away_win_prob: 0.45, predicted_score: "0-1", recommendation: "\n[AURELIA_META]{\"h\":0.7183,\"a\":1.1175,\"s\":\"英冠校準\"}", confidence: 2, updated_at: "2026-08-15T10:00:00Z" }];
        return [];
      },
    }));
    vi.stubGlobal("fetch", fetchMock);
    const cache = await getSupabaseUpcomingCache(true);
    const card = cache.fixtures[0];
    expect(card?.researchSource).toContain("英冠正式聯賽樣本");
    expect(card?.compactMarkets.some(item => item.market === "入球大細 2.5")).toBe(true);
    expect(card?.compactMarkets.some(item => item.market === "讓球盤 (Handicap)")).toBe(false);
    expect(card?.handicapQuote).toBeNull();
    expect(card?.topScorelines).toHaveLength(3);
  });
});


describe("Supabase繁中翻譯與讓球盤資料契約", () => {
  it("以 team_translations、league_translations 的香港繁中優先，並保存同一快照的完整雙邊讓球水位", async () => {
    const fetchMock = vi.fn(async (input: URL | string) => ({
      ok: true,
      json: async () => {
        const url = String(input);
        if (url.includes("fixtures?")) return [{ fixture_id: 991, league_name: "Premier League", event_time: "2026-08-19T12:30:00Z", home_team: "Manchester United", away_team: "Arsenal", status: "NS", updated_at: "2026-08-18T10:00:00Z" }];
        if (url.includes("ai_predictions?")) return [{ fixture_id: 991, home_win_prob: 0.51, draw_prob: 0.27, away_win_prob: 0.22, predicted_score: "2-1", recommendation: "\n[AURELIA_META]{\"h\":1.54,\"a\":0.92,\"s\":\"隊史\"}", confidence: 4, updated_at: "2026-08-18T10:00:00Z" }];
        if (url.includes("odds_snapshots?")) return [
          { fixture_id: 991, market_type: "HDC", handicap: "Home -0.5", home_odds: 1.91, away_odds: 1.89, snapshot_time: "2026-08-18T10:00:00Z" },
        ];
        if (url.includes("team_translations?")) return [
          { english_name: "Manchester United", name_zh_hk: "曼聯", name_zh_tw: "曼徹斯特聯" },
          { english_name: "Arsenal", name_zh_hk: null, name_zh_tw: "阿森納" },
        ];
        if (url.includes("league_translations?")) return [{ english_name: "Premier League", name_zh_hk: "英超", name_zh_tw: "英格蘭超級足球聯賽" }];
        return [];
      },
    }));
    vi.stubGlobal("fetch", fetchMock);

    const cache = await getSupabaseUpcomingCache(true);
    const card = cache.fixtures[0];
    expect(card?.leagueTranslation).toEqual({ nameZhHk: "英超", nameZhTw: "英格蘭超級足球聯賽" });
    expect(card?.homeTeamTranslation).toEqual({ nameZhHk: "曼聯", nameZhTw: "曼徹斯特聯" });
    expect(card?.awayTeamTranslation).toEqual({ nameZhHk: null, nameZhTw: "阿森納" });
    expect(card?.handicapQuote).toEqual({
      source: "API-Football Asian Handicap",
      homeSelection: "Home -0.5",
      homeOdds: 1.91,
      awaySelection: "Away +0.5",
      awayOdds: 1.89,
      capturedAt: "2026-08-18T10:00:00Z",
    });
  });
});
