import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./prediction", () => ({
  getLeagueMetadata: vi.fn(),
  getPrediction: vi.fn(),
  getTeams: vi.fn(),
  hasValidProbabilityDistribution: vi.fn(() => true),
}));

import { getLeagueMetadata, getPrediction, getTeams } from "./prediction";
import { appRouter } from "./routers";

const prediction = {
  prediction_as_of: "2025-05-25 20:00:01",
  league_code: "EPL",
  league_name: "Premier League",
  home_team: "Arsenal",
  away_team: "Chelsea",
  probabilities: { home_win: 0.48, draw: 0.27, away_win: 0.25 },
  diagnostics: { historical_matches_used: 1900, latest_historical_match: "2025-05-25 20:00:00", dc_history_match_count: 380, dc_available: true },
  selected_features: { home_elo_pre: 1560, away_elo_pre: 1512, elo_diff_pre: 48, home_recent5_win_rate: 0.6, away_recent5_win_rate: 0.4, dc_expected_home_goals: 1.52, dc_expected_away_goals: 0.96 },
};

const context = {
  user: null,
  req: {} as never,
  res: {} as never,
};

describe("prediction router", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns supported league metadata, teams and a valid forecast", async () => {
    vi.mocked(getLeagueMetadata).mockResolvedValue({
      leagues: [{ code: "EPL", name: "Premier League", first_date: "2020-09-12", last_date: "2025-05-25", match_count: 1900 }],
      teams: [],
      coverage: { firstDate: "2020-08-08", lastDate: "2025-05-25", lastUpdatedAt: "2026-08-13T00:00:00+00:00", model: "校準後 XGBoost 三分類模型", disclaimer: "僅使用賽前資料。" },
    });
    vi.mocked(getTeams).mockResolvedValue(["Arsenal", "Chelsea"]);
    vi.mocked(getPrediction).mockResolvedValue(prediction);
    const caller = appRouter.createCaller(context);

    await expect(caller.prediction.leagues()).resolves.toMatchObject({ leagues: [{ code: "EPL" }] });
    await expect(caller.prediction.teams({ leagueCode: "EPL" })).resolves.toEqual({ teams: ["Arsenal", "Chelsea"] });
    await expect(caller.prediction.forecast({ leagueCode: "EPL", homeTeam: "Arsenal", awayTeam: "Chelsea" })).resolves.toMatchObject({ probabilities: prediction.probabilities });
  });

  it("maps inference failures to a user-visible procedure error", async () => {
    vi.mocked(getPrediction).mockRejectedValue(new Error("模型資產下載失敗（404）。"));
    const caller = appRouter.createCaller(context);

    await expect(caller.prediction.forecast({ leagueCode: "EPL", homeTeam: "Arsenal", awayTeam: "Chelsea" })).rejects.toThrow("模型資產下載失敗（404）。");
  });

  it("maps league metadata and team lookup failures to user-visible procedure errors", async () => {
    const caller = appRouter.createCaller(context);
    vi.mocked(getLeagueMetadata).mockRejectedValue(new Error("資料庫資產無法載入。"));
    await expect(caller.prediction.leagues()).rejects.toThrow("資料庫資產無法載入。");

    vi.mocked(getTeams).mockRejectedValue(new Error("聯賽球隊清單無法取得。"));
    await expect(caller.prediction.teams({ leagueCode: "EPL" })).rejects.toThrow("聯賽球隊清單無法取得。");
  });
});
