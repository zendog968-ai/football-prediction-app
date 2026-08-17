import { describe, expect, it } from "vitest";
import { blendOneXTwo, deVigOneXTwo, dixonColesScoreGrid, doubleChanceProbabilities, handicapSelectionProbability, handicapWinDistribution, highestOutcome, mainstreamTotals, outcomesFromScoreGrid, topScorelines, totalSelectionProbability } from "./compactResearch";

describe("compact research contract", () => {
  it("orders the three most likely scorelines from verified Poisson inputs", () => {
    const scores = topScorelines(1.4, 0.8);
    expect(scores).toHaveLength(3);
    expect(scores[0]!.probability).toBeGreaterThanOrEqual(scores[1]!.probability);
    expect(scores[1]!.probability).toBeGreaterThanOrEqual(scores[2]!.probability);
  });

  it("derives only supported mainstream totals and a half/full handicap row", () => {
    expect(totalSelectionProbability("Over 2.5", 1.4, 0.8)).toBeGreaterThan(0);
    expect(totalSelectionProbability("Over 1.5", 1.4, 0.8)).toBeGreaterThan(totalSelectionProbability("Over 4.5", 1.4, 0.8)!);
    expect(totalSelectionProbability("Over 3.0", 1.4, 0.8)).toBeNull();
    expect(handicapSelectionProbability("Home -0.5", 1.4, 0.8)).toBeGreaterThan(0);
    expect(handicapSelectionProbability("Home -0.25", 1.4, 0.8)).toBeGreaterThan(0);
    expect(handicapSelectionProbability("Away +0.75", 1.4, 0.8)).toBeGreaterThan(0);
    expect(handicapWinDistribution("Home -0.25", 1.4, 0.8)).toEqual(expect.objectContaining({ fullWin: expect.any(Number), halfWin: 0 }));
    expect(handicapWinDistribution("Away +0.75", 1.4, 0.8)!.halfWin).toBeGreaterThan(0);
    expect(handicapWinDistribution("Home -1.25", 1.4, 0.8)!.halfWin).toBeGreaterThan(0);
    expect(handicapWinDistribution("Away +1.75", 1.4, 0.8)!.halfWin).toBeGreaterThan(0);
    expect(handicapWinDistribution("Home -0.25", 1.4, 0.8)!.halfLoss).toBeGreaterThan(0);
    expect(handicapWinDistribution("Away +0.75", 1.4, 0.8)!.halfLoss).toBeGreaterThan(0);
    expect(handicapWinDistribution("Home -1.25", 1.4, 0.8)!.fullLoss).toBeGreaterThan(0);
    expect(handicapWinDistribution("Home -1", 1.4, 0.8)!.push).toBeGreaterThan(0);
  });

  it("returns one high-probability direction for every mainstream totals line", () => {
    const rows = mainstreamTotals(1.4, 0.8);
    expect(rows.map(row => row.market)).toEqual(["入球大細 1.5", "入球大細 2.5", "入球大細 3.5", "入球大細 4.5"]);
    expect(rows.every(row => row.probability >= 0.5)).toBe(true);
  });

  it("returns the highest complete 1X2 outcome without inventing partial probabilities", () => {
    expect(highestOutcome(0.52, 0.25, 0.23)).toEqual({ market: "主客和 (1X2)", selection: "主勝", probability: 0.52 });
    expect(highestOutcome(0.52, Number.NaN, 0.23)).toBeNull();
  });

  it("applies bounded Dixon–Coles low-score correction while preserving a normalized 1X2 distribution", () => {
    const grid = dixonColesScoreGrid(1.3, 0.9, -0.08);
    const outcomes = outcomesFromScoreGrid(grid);
    expect(grid).toHaveLength(81);
    expect(grid.reduce((sum, item) => sum + item.probability, 0)).toBeCloseTo(1, 8);
    expect(outcomes).not.toBeNull();
    expect(outcomes!.homeWin + outcomes!.draw + outcomes!.awayWin).toBeCloseTo(1, 8);
  });

  it("de-vigs verified 1X2 odds, blends them 50/50 and exposes double chance", () => {
    const market = deVigOneXTwo(2.0, 3.5, 4.0);
    expect(market).not.toBeNull();
    expect(market!.homeWin + market!.draw + market!.awayWin).toBeCloseTo(1, 8);
    const blended = blendOneXTwo({ homeWin: 0.50, draw: 0.28, awayWin: 0.22 }, market);
    const doubleChance = doubleChanceProbabilities(blended);
    expect(blended.homeWin + blended.draw + blended.awayWin).toBeCloseTo(1, 8);
    expect(doubleChance.oneX).toBeCloseTo(blended.homeWin + blended.draw, 8);
    expect(doubleChance.xTwo).toBeCloseTo(blended.draw + blended.awayWin, 8);
  });
});
