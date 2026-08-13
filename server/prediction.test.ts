import { describe, expect, it } from "vitest";
import { hasValidProbabilityDistribution, PredictionScopeError, type PredictionResult, validateInferenceScope } from "./prediction";

const validResult: PredictionResult = {
  prediction_as_of: "2025-05-25 20:00:01",
  league_code: "E0",
  league_name: "Premier League",
  home_team: "Arsenal",
  away_team: "Chelsea",
  probabilities: { home_win: 0.48, draw: 0.27, away_win: 0.25 },
  diagnostics: {
    historical_matches_used: 1900,
    latest_historical_match: "2025-05-25 20:00:00",
    dc_history_match_count: 365,
    dc_available: true,
  },
  selected_features: {
    home_elo_pre: 1560,
    away_elo_pre: 1512,
    elo_diff_pre: 48,
    home_recent5_win_rate: 0.6,
    away_recent5_win_rate: 0.4,
    dc_expected_home_goals: 1.52,
    dc_expected_away_goals: 0.96,
  },
};

describe("prediction probability guard", () => {
  it("accepts a finite three-way probability distribution that sums to one", () => {
    expect(hasValidProbabilityDistribution(validResult)).toBe(true);
  });

  it("rejects a distribution with invalid total probability", () => {
    expect(hasValidProbabilityDistribution({
      ...validResult,
      probabilities: { home_win: 0.48, draw: 0.27, away_win: 0.35 },
    })).toBe(false);
  });
});

describe("prediction scope guard", () => {
  it("permits an in-scope pair from one supported league", () => {
    expect(() => validateInferenceScope(
      { leagueCode: "EPL", homeTeam: "Arsenal", awayTeam: "Chelsea" },
      ["Arsenal", "Chelsea", "Liverpool"],
    )).not.toThrow();
  });

  it("rejects a cup or cross-league team before Python inference", () => {
    expect(() => validateInferenceScope(
      { leagueCode: "MLS", homeTeam: "Los Angeles FC", awayTeam: "Queretaro" },
      ["Los Angeles FC", "Seattle Sounders"],
    )).toThrow(PredictionScopeError);
    expect(() => validateInferenceScope(
      { leagueCode: "MLS", homeTeam: "Los Angeles FC", awayTeam: "Queretaro" },
      ["Los Angeles FC", "Seattle Sounders"],
    )).toThrow("超出模型範疇");
  });

  it("rejects a league outside the calibrated 13-league scope", () => {
    expect(() => validateInferenceScope(
      { leagueCode: "LIBERTADORES", homeTeam: "Palmeiras", awayTeam: "Penarol" },
      [],
    )).toThrow("未納入目前校準模型");
  });
});
