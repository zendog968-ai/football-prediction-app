import { describe, expect, it } from "vitest";
import { calculateMarketResearch, calculateOutcomeResearch } from "./oddsResearch";

describe("odds research calculations", () => {
  it("calculates implied probability, model odds and positive EV from decimal odds", () => {
    const research = calculateOutcomeResearch(0.5, 2.2);
    expect(research?.marketOdds).toBe(2.2);
    expect(research?.impliedProbability).toBeCloseTo(1 / 2.2, 10);
    expect(research?.expectedValue).toBeCloseTo(0.1, 10);
    expect(research?.modelOdds).toBe(2);
    expect(research?.isPositiveExpectedValue).toBe(true);
  });

  it("does not calculate research statistics for invalid odds or probabilities", () => {
    expect(calculateOutcomeResearch(0.4, 1)).toBeNull();
    expect(calculateOutcomeResearch(1.1, 2.4)).toBeNull();
    expect(calculateOutcomeResearch(Number.NaN, 2.4)).toBeNull();
  });

  it("keeps three-way research results separated by outcome", () => {
    const result = calculateMarketResearch(
      { home: 0.45, draw: 0.28, away: 0.27 },
      { home: 2.3, draw: 3.2, away: 3.7 },
    );
    expect(result.home?.isPositiveExpectedValue).toBe(true);
    expect(result.draw?.isPositiveExpectedValue).toBe(false);
    expect(result.away?.expectedValue).toBeCloseTo(-0.001, 8);
  });
});
