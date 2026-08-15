import { describe, expect, it } from "vitest";
import { handicapSelectionProbability, highestOutcome, topScorelines, totalSelectionProbability } from "./compactResearch";

describe("compact research contract", () => {
  it("orders the three most likely scorelines from verified Poisson inputs", () => {
    const scores = topScorelines(1.4, 0.8);
    expect(scores).toHaveLength(3);
    expect(scores[0]!.probability).toBeGreaterThanOrEqual(scores[1]!.probability);
    expect(scores[1]!.probability).toBeGreaterThanOrEqual(scores[2]!.probability);
  });

  it("only derives a totals row for an explicit 2.5 market and a half/full handicap row", () => {
    expect(totalSelectionProbability("Over 2.5", 1.4, 0.8)).toBeGreaterThan(0);
    expect(totalSelectionProbability("Over 3.0", 1.4, 0.8)).toBeNull();
    expect(handicapSelectionProbability("Home -0.5", 1.4, 0.8)).toBeGreaterThan(0);
    expect(handicapSelectionProbability("Home -0.25", 1.4, 0.8)).toBeNull();
  });

  it("returns the highest complete 1X2 outcome without inventing partial probabilities", () => {
    expect(highestOutcome(0.52, 0.25, 0.23)).toEqual({ market: "主客和 (1X2)", selection: "主勝", probability: 0.52 });
    expect(highestOutcome(0.52, Number.NaN, 0.23)).toBeNull();
  });
});
