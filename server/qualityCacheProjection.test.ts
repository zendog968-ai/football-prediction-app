import { describe, expect, it } from "vitest";
import { safeCacheProjection, type SupabaseUpcomingCache } from "./supabaseCache";
const now = Date.parse("2026-10-18T09:00:00Z");
const payload: SupabaseUpcomingCache = { source: "Supabase cache", loadedAt: "2026-10-18T09:00:00Z", available: true, fixtures: [{ fixtureId: 1, leagueName: "J1", eventTime: "2026-10-18T10:00:00Z", homeTeam: "Home", awayTeam: "Away", homeWin: .6, draw: .2, awayWin: .2, predictedScore: "2-1", recommendation: "勝率60%", researchSource: "v4", confidence: 2, predictionUpdatedAt: "2026-10-18T08:00:00Z", hasPrediction: true, compactMarkets: [{ market: "主客和 (1X2)", selection: "主勝", probability: .6 }, { market: "讓球盤 (Handicap)", selection: "Home -0.5", probability: .6 }], topScorelines: [{ score: "2-1", probability: .12 }], odds: { home: 2, draw: 3, away: 4, capturedAt: "2026-10-18T08:00:00Z" }, handicapQuote: { source: "Book", homeSelection: "Home -0.5", homeOdds: 2, awaySelection: "Away +0.5", awayOdds: 2, capturedAt: "2026-10-18T08:00:00Z" } }] };
describe("cache public DTO time safety", () => {
  it("removes expired quotes even while model probabilities are fresh", () => {
    const row = safeCacheProjection(payload, now).fixtures[0]!;
    expect(row.hasPrediction).toBe(true); expect(row.homeWin).toBe(.6);
    expect(row.handicapQuote).toBeNull(); expect(row.odds).toBeNull();
    expect(row.compactMarkets.some(m => m.market === "讓球盤 (Handicap)")).toBe(false);
  });
  it("removes all derivative percentages, recommendation and scores at kickoff on cache hit", () => {
    const row = safeCacheProjection(payload, now + 3600000).fixtures[0]!;
    expect(row.hasPrediction).toBe(false); expect(Number.isNaN(row.homeWin)).toBe(true);
    expect(row.topScorelines).toEqual([]); expect(row.compactMarkets).toEqual([]);
    expect(row.recommendation).toBeNull(); expect(row.predictedScore).toBeNull();
    expect(JSON.stringify(row)).not.toContain('"homeWin":0.6');
  });
  it("clears old forecasts before kickoff and rejects unverified times", () => {
    const p = { ...payload, fixtures: [{ ...payload.fixtures[0]!, predictionUpdatedAt: "2026-10-18T06:00:00Z" }] };
    expect(safeCacheProjection(p, now).fixtures[0]!.hasPrediction).toBe(false);
  });
});
