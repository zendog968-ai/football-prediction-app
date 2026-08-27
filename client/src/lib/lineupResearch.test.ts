import { describe, expect, it } from "vitest";
import { calculateLineupResearch } from "./lineupResearch";

describe("calculateLineupResearch", () => {
  it("keeps outcome probabilities normalised after manual lineup adjustments", () => {
    const result = calculateLineupResearch(1.45, 1.05, -10, 8);
    expect(result.homeExpectedGoals).toBeCloseTo(1.305, 4);
    expect(result.awayExpectedGoals).toBeCloseTo(1.134, 4);
    expect(result.homeWin + result.draw + result.awayWin).toBeCloseTo(1, 8);
    expect(result.topScorelines).toHaveLength(3);
  });

  it("increases home win probability when a home strength adjustment is applied", () => {
    const baseline = calculateLineupResearch(1.3, 1.0, 0, 0);
    const adjusted = calculateLineupResearch(1.3, 1.0, 15, 0);
    expect(adjusted.homeWin).toBeGreaterThan(baseline.homeWin);
    expect(adjusted.totalExpectedGoals).toBeGreaterThan(baseline.totalExpectedGoals);
  });
});
