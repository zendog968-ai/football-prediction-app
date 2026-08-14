import { describe, expect, it } from "vitest";
import { deriveResearchLean, hasValidProbabilityDistribution, PredictionScopeError, type PredictionResult, validateInferenceScope } from "./prediction";

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
  lean: {
    outcome: "home_win",
    label: "主勝傾向",
    team: "Arsenal",
    probability: 0.48,
    risk_level: "medium",
    reasons: ["測試用研究傾向。"],
    limitations: [],
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

describe("research lean contract", () => {
  it("selects the largest calibrated outcome and makes DC gaps a high-risk limitation", () => {
    const lean = deriveResearchLean({
      ...validResult,
      diagnostics: { ...validResult.diagnostics, historical_matches_used: 203, dc_history_match_count: 0, dc_available: false },
    });

    expect(lean).toMatchObject({ outcome: "home_win", label: "主勝傾向", team: "Arsenal", risk_level: "high" });
    expect(lean.reasons[0]).toContain("機率最高");
    expect(lean.limitations.join(" ")).toContain("Dixon–Coles資料不足");
  });

  it("does not change a valid probability distribution when producing a lean", () => {
    const lean = deriveResearchLean(validResult);

    expect(lean.probability).toBe(validResult.probabilities.home_win);
    expect(hasValidProbabilityDistribution(validResult)).toBe(true);
  });
});

describe("prediction scope guard", () => {
  it("permits an in-scope pair from one supported league", () => {
    expect(() => validateInferenceScope(
      { leagueCode: "EPL", homeTeam: "Arsenal", awayTeam: "Chelsea" },
      ["Arsenal", "Chelsea", "Liverpool"],
    )).not.toThrow();
  });

  it("permits an in-scope Europa League pair after the UEL data contract is published", () => {
    expect(() => validateInferenceScope(
      { leagueCode: "UEL", homeTeam: "Benfica", awayTeam: "Ferencváros" },
      ["Benfica", "Ferencváros", "CSKA Sofia"],
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

  it("rejects a league outside the calibrated 14-scope data contract", () => {
    expect(() => validateInferenceScope(
      { leagueCode: "LIBERTADORES", homeTeam: "Palmeiras", awayTeam: "Penarol" },
      [],
    )).toThrow("未納入目前校準模型");
  });
});
