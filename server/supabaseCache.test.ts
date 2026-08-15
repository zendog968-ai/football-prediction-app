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
    expect(card?.compactMarkets.some(item => item.market === "讓球盤 (Handicap)")).toBe(true);
    expect(card?.topScorelines).toHaveLength(3);
  });
});
