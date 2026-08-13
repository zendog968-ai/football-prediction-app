export type MarketOdds = { home: number; draw: number; away: number };
export type ModelProbabilities = { home: number; draw: number; away: number };
export type OutcomeResearch = {
  marketOdds: number;
  impliedProbability: number;
  expectedValue: number;
  modelOdds: number;
  isPositiveExpectedValue: boolean;
};

export function isValidDecimalOdds(value: number) {
  return Number.isFinite(value) && value > 1;
}

export function calculateOutcomeResearch(probability: number, odds: number): OutcomeResearch | null {
  if (!Number.isFinite(probability) || probability < 0 || probability > 1 || !isValidDecimalOdds(odds)) return null;
  const expectedValue = probability * odds - 1;
  return {
    marketOdds: odds,
    impliedProbability: 1 / odds,
    expectedValue,
    modelOdds: probability === 0 ? Number.POSITIVE_INFINITY : 1 / probability,
    isPositiveExpectedValue: expectedValue > 0,
  };
}

export function calculateMarketResearch(probabilities: ModelProbabilities, odds: MarketOdds) {
  return {
    home: calculateOutcomeResearch(probabilities.home, odds.home),
    draw: calculateOutcomeResearch(probabilities.draw, odds.draw),
    away: calculateOutcomeResearch(probabilities.away, odds.away),
  };
}
