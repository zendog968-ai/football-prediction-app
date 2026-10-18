import { describe, expect, it } from "vitest";
import { estimateQualityGoals, verifiedHistory, type VerifiedFixture } from "./qualityPoisson";
import { predictionIsFresh } from "./predictionFreshness";
const now = new Date("2026-10-18T09:00:00Z");
const fixture = { fixture: { id: 100, date: "2026-10-19T09:00:00Z", status: { short: "NS" } }, league: { id: 98, season: 2026 }, teams: { home: { id: 1 }, away: { id: 2 } } };
function history(team: number, n: number, h = 2, a = 1): VerifiedFixture[] {
  return Array.from({ length: n }, (_, i) => ({ fixture: { id: team * 100 + i, date: new Date(now.getTime() - (i + 1) * 86400000).toISOString(), status: { short: "FT" } }, league: { id: 98, season: 2026 }, teams: { home: { id: team }, away: { id: 1000 + i } }, goals: { home: h, away: a } }));
}
describe("quality Poisson v4", () => {
  it("uses fixed shrink10 formula and records sample/version, not calibration", () => {
    const r = estimateQualityGoals(fixture, history(1, 5), history(2, 5), history(5, 20), now)!;
    expect(r.modelVersion).toBe("poisson-v4-shrink10-research"); expect(r.calibrated).toBe(false);
    expect(r.homeMean).toBeCloseTo(2 * (25 / 15) / 1.5 * (20 / 15) / 1.5, 10);
    expect(r.awayMean).toBeCloseTo(1 * (25 / 15) / 1.5 * (20 / 15) / 1.5, 10);
    expect(r.homeMatches).toBe(5); expect(r.leagueMatches).toBe(20);
  });
  it("rejects small samples instead of inventing league-average team probabilities", () => {
    expect(estimateQualityGoals(fixture, history(1, 4), history(2, 5), history(5, 20), now)).toBeNull();
    expect(estimateQualityGoals(fixture, history(1, 5), history(2, 5), history(5, 19), now)).toBeNull();
  });
  it("excludes mixed competition, season, future, same-time, malformed, stale, duplicate and extra-time rows", () => {
    const rows = history(1, 5); const sample = rows[0]!;
    const bad = [sample, { ...sample, fixture: { ...sample.fixture, id: 900, date: "2026-10-19T01:00:00Z" } }, { ...sample, fixture: { ...sample.fixture, id: 901, date: "2026-10-18T08:00:00Z" } }, { ...sample, league: { id: 667, season: 2026 } }, { ...sample, league: { id: 98, season: 2025 } }, { ...sample, fixture: { id: 904, date: "bad", status: { short: "FT" } } }, { ...sample, fixture: { ...sample.fixture, id: 905, date: "2024-01-01T00:00:00Z" } }, { ...sample, fixture: { ...sample.fixture, id: 906, status: { short: "AET" } } }, { ...sample, goals: { home: -1, away: 1 } }];
    expect(verifiedHistory([...rows, ...bad], 98, 2026, now.getTime(), 10)).toHaveLength(5);
  });
  it("requires future NS match and distinct team IDs", () => {
    for (const f of [{ ...fixture, fixture: { ...fixture.fixture, status: { short: "2H" } } }, { ...fixture, fixture: { ...fixture.fixture, date: now.toISOString() } }, { ...fixture, teams: { home: { id: 1 }, away: { id: 1 } } }]) expect(estimateQualityGoals(f, history(1, 5), history(2, 5), history(5, 20), now)).toBeNull();
  });
  it("enforces pre-match 2h prediction freshness", () => {
    const event = "2026-10-19T00:00:00Z", t = now.getTime();
    expect(predictionIsFresh("2026-10-18T08:00:00Z", event, t)).toBe(true);
    for (const time of [null, "bad", "2026-10-18T06:00:00Z", "2026-10-19T01:00:00Z"]) expect(predictionIsFresh(time, event, t)).toBe(false);
    expect(predictionIsFresh("2026-10-18T08:00:00Z", "2026-10-18T08:30:00Z", t)).toBe(false);
  });
});

import { topScorelines, totalSelectionProbability } from "@shared/compactResearch";
describe("full-tail probability and identity guards", () => {
  it("retains high-goal tail at lambda=4.5 rather than conditioning on max8", () => {
    expect(totalSelectionProbability("Over 2.5", 4.5, 4.5)).toBeCloseTo(1 - Math.exp(-9) * (1 + 9 + 81 / 2), 9);
    expect(topScorelines(4.5, 4.5)[0]!.probability).toBeCloseTo(Math.exp(-9) * 4.5 ** 8 / (24 * 24), 9);
  });
  it("rejects zero, negative and boolean target identity", () => {
    for (const f of [{ ...fixture, fixture: { ...fixture.fixture, id: 0 } }, { ...fixture, league: { id: true as never, season: 2026 } }, { ...fixture, teams: { home: { id: -1 }, away: { id: 2 } } }]) expect(estimateQualityGoals(f, history(1, 5), history(2, 5), history(5, 20), now)).toBeNull();
  });
  it("rejects a result first observed after forecast time", () => {
    const rows = history(1, 5); rows[0]!.result_observed_at = "2026-10-18T10:00:00Z";
    expect(verifiedHistory(rows, 98, 2026, now.getTime(), 10)).toHaveLength(4);
  });
});
