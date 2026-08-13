// @vitest-environment jsdom
import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const forecastResult = {
  prediction_as_of: "2024-12-08 19:00:01",
  league_code: "BRA1",
  league_name: "Campeonato Brasileiro Série A",
  home_team: "Palmeiras",
  away_team: "Flamengo RJ",
  probabilities: { home_win: 0.4462, draw: 0.2572, away_win: 0.2966 },
  diagnostics: {
    historical_matches_used: 1900,
    latest_historical_match: "2024-12-08 19:00:00",
    dc_history_match_count: 380,
    dc_available: true,
  },
  selected_features: {
    home_elo_pre: 1625.1,
    away_elo_pre: 1603.6,
    elo_diff_pre: 21.5,
    home_recent5_win_rate: 0.6,
    away_recent5_win_rate: 0.6,
    dc_expected_home_goals: 1.57,
    dc_expected_away_goals: 1.04,
  },
};

const mutationSpy = vi.fn();
const mockState = vi.hoisted(() => ({ teamsLoading: false, forecastError: null as { message: string } | null }));
const expandedLeagueTeams = vi.hoisted(() => ({
  MLS: ["Atlanta United", "Los Angeles Galaxy"],
  J1: ["Kawasaki Frontale", "Urawa Reds"],
  FIN1: ["Haka", "Gnistan"],
  KOR1: ["Daegu", "Daejeon Hana Citizen"],
  POR1: ["AVS", "Arouca"],
  MEX1: ["Tigres UANL", "Guadalajara"],
  AUS1: ["Melbourne Victory", "Melbourne City FC"],
}));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    prediction: {
      leagues: {
        useQuery: () => ({
          data: {
            leagues: [
              { code: "BRA1", name: "Campeonato Brasileiro Série A", first_date: "2020-08-08", last_date: "2024-12-08", match_count: 1900 },
              { code: "EPL", name: "Premier League", first_date: "2020-09-12", last_date: "2025-05-25", match_count: 1900 },
              { code: "MLS", name: "Major League Soccer", first_date: "2020-02-29", last_date: "2024-12-07", match_count: 2329 },
              { code: "J1", name: "J1 League", first_date: "2020-02-21", last_date: "2024-12-08", match_count: 1679 },
              { code: "FIN1", name: "Veikkausliiga", first_date: "2020-07-01", last_date: "2024-11-02", match_count: 795 },
              { code: "KOR1", name: "K League 1", first_date: "2020-05-08", last_date: "2024-11-24", match_count: 1074 },
              { code: "POR1", name: "Primeira Liga", first_date: "2020-09-18", last_date: "2025-05-17", match_count: 1530 },
              { code: "MEX1", name: "Liga MX", first_date: "2020-01-11", last_date: "2024-12-16", match_count: 1599 },
              { code: "AUS1", name: "A-League Men", first_date: "2020-08-01", last_date: "2025-05-31", match_count: 852 },
            ],
            coverage: { firstDate: "2020-08-08", lastDate: "2025-05-25", lastUpdatedAt: "2026-08-13T00:00:00+00:00", model: "校準後 XGBoost 三分類模型", disclaimer: "僅使用歷史賽前資料。" },
          },
        }),
      },
      teams: { useQuery: (input: { leagueCode: string }) => ({
        data: { teams: input.leagueCode === "EPL" ? ["Arsenal", "Chelsea", "Liverpool"] : expandedLeagueTeams[input.leagueCode as keyof typeof expandedLeagueTeams] || ["Flamengo RJ", "Palmeiras", "Santos"] },
        isLoading: mockState.teamsLoading,
      }) },
      forecast: {
        useMutation: (options: { onSuccess: (data: typeof forecastResult) => void }) => ({
          mutate: (input: unknown) => { mutationSpy(input); options.onSuccess(forecastResult); },
          isPending: false,
          error: mockState.forecastError,
        }),
      },
    },
    spotlight: {
      cruzeiroFlamengo: {
        useQuery: () => ({
          data: {
            competition: "CONMEBOL Libertadores", stage: "十六強 · 首回合", kickoffLocal: "2026-08-12", venue: "Mineirão", homeTeam: "Cruzeiro", awayTeam: "Flamengo",
            probabilities: { home: 0.2956, draw: 0.2663, away: 0.4381 }, expectedGoals: { home: 1.1, away: 1.4 }, scorelines: [{ score: "1–1", probability: 0.1264 }], totalGoals: { under25: 0.5438, over25: 0.4562, bothTeamsScore: 0.5026 }, factors: [], notice: "情境限制。", sources: [],
          },
        }),
      },
    },
  },
}));

import Home from "./Home";

describe("Home prediction workflow", () => {
  afterEach(() => cleanup());

  beforeEach(() => {
    sessionStorage.clear();
    mutationSpy.mockClear();
    mockState.teamsLoading = false;
    mockState.forecastError = null;
  });

  it("filters teams, submits a forecast and writes the query to session history", async () => {
    const user = userEvent.setup();
    render(<Home />);

    await user.selectOptions(screen.getByRole("combobox"), "BRA1");
    const homeInput = screen.getByLabelText("主隊");
    await user.click(homeInput);
    await user.type(homeInput, "Palm");
    await user.click(screen.getByRole("button", { name: /Palmeiras/ }));

    const awayInput = screen.getByLabelText("客隊");
    await user.click(awayInput);
    await user.type(awayInput, "Flam");
    await user.click(screen.getByRole("button", { name: /Flamengo RJ/ }));

    await user.click(screen.getByRole("button", { name: /開始分析這場對戰/ }));

    expect(mutationSpy).toHaveBeenCalledWith({ leagueCode: "BRA1", homeTeam: "Palmeiras", awayTeam: "Flamengo RJ" });
    expect((await screen.findAllByText("44.6%")).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("Palmeiras vs Flamengo RJ")).toBeTruthy();
    expect(JSON.parse(sessionStorage.getItem("aurelia-football-session-history") || "[]")).toHaveLength(1);
  });

  it("clears stored session history", async () => {
    const user = userEvent.setup();
    sessionStorage.setItem("aurelia-football-session-history", JSON.stringify([{ ...forecastResult, id: "history-1", savedAt: 1 }]));
    render(<Home />);

    expect(await screen.findByRole("button", { name: /Palmeiras.*Flamengo RJ/ })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "清除" }));
    expect(sessionStorage.getItem("aurelia-football-session-history")).toBe("[]");
    expect(await screen.findByText(/本次 session 的查詢結果會留在這裡/)).toBeTruthy();
  });

  it("switches the available autocomplete pool when the league changes", async () => {
    const user = userEvent.setup();
    render(<Home />);

    await user.selectOptions(screen.getByRole("combobox"), "EPL");
    const homeInput = screen.getByLabelText("主隊");
    await user.click(homeInput);
    await user.type(homeInput, "Ars");

    expect(await screen.findByRole("button", { name: /Arsenal/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Palmeiras/ })).toBeNull();
  });

  it("shows all seven expanded leagues and provides the corresponding J1 team autocomplete", async () => {
    const user = userEvent.setup();
    render(<Home />);

    for (const name of ["美職 · Major League Soccer", "日職 · J1 League", "芬蘭聯賽 · Veikkausliiga", "韓職 · K League 1", "葡職 · Primeira Liga", "墨西哥聯賽 · Liga MX", "澳職 · A-League Men"]) {
      expect(screen.getByRole("option", { name })).toBeTruthy();
    }

    await user.selectOptions(screen.getByLabelText("聯賽"), "J1");
    const homeInput = screen.getByLabelText("主隊");
    await user.click(homeInput);
    await user.type(homeInput, "Kawa");
    expect(await screen.findByRole("button", { name: /Kawasaki Frontale/ })).toBeTruthy();
  });

  it("returns a league-specific autocomplete result for every expanded league", async () => {
    const user = userEvent.setup();
    render(<Home />);
    const leagueControl = screen.getByLabelText("聯賽");
    const homeInput = screen.getByLabelText("主隊");
    const checks = [
      ["MLS", "Atlan", "Atlanta United"], ["J1", "Kawa", "Kawasaki Frontale"],
      ["FIN1", "Hak", "Haka"], ["KOR1", "Daeg", "Daegu"], ["POR1", "AV", "AVS"],
      ["MEX1", "Tigr", "Tigres UANL"], ["AUS1", "Melbourne V", "Melbourne Victory"],
    ] as const;

    for (const [leagueCode, search, expected] of checks) {
      await user.selectOptions(leagueControl, leagueCode);
      await user.click(homeInput);
      await user.clear(homeInput);
      await user.type(homeInput, search);
      expect(await screen.findByRole("button", { name: new RegExp(expected) })).toBeTruthy();
      await user.click(screen.getByRole("button", { name: new RegExp(expected) }));
    }
  });

  it("exposes labelled controls and clear loading and error states", async () => {
    mockState.teamsLoading = true;
    mockState.forecastError = { message: "模型服務暫時無法回應。" };
    render(<Home />);

    const leagueControl = screen.getByLabelText("聯賽");
    leagueControl.focus();
    expect(document.activeElement).toBe(leagueControl);
    expect(screen.getByLabelText("主隊").getAttribute("placeholder")).toBe("載入球隊中…");
    expect(screen.getByText("模型服務暫時無法回應。")).toBeTruthy();
    expect(document.querySelector('[aria-live="polite"]')).toBeTruthy();
  });

  it("supports keyboard progression from league selection to team search and team clearing", async () => {
    const user = userEvent.setup();
    render(<Home />);

    const leagueControl = screen.getByLabelText("聯賽");
    const homeInput = screen.getByLabelText("主隊") as HTMLInputElement;
    leagueControl.focus();
    await user.tab();
    expect(document.activeElement).toBe(homeInput);

    await user.type(homeInput, "Palm");
    await user.click(screen.getByRole("button", { name: /Palmeiras/ }));
    const clearHome = screen.getByRole("button", { name: "清除主隊" });
    clearHome.focus();
    await user.keyboard("{Enter}");
    expect(homeInput.value).toBe("");
  });

  it("shows database update time and research-only model odds after a forecast", async () => {
    const user = userEvent.setup();
    render(<Home />);

    expect(screen.getByText(/資料庫最後更新/)).toBeTruthy();
    await user.selectOptions(screen.getByRole("combobox"), "BRA1");
    await user.click(screen.getByLabelText("主隊"));
    await user.type(screen.getByLabelText("主隊"), "Palm");
    await user.click(screen.getByRole("button", { name: /Palmeiras/ }));
    await user.click(screen.getByLabelText("客隊"));
    await user.type(screen.getByLabelText("客隊"), "Flam");
    await user.click(screen.getByRole("button", { name: /Flamengo RJ/ }));
    await user.click(screen.getByRole("button", { name: /開始分析這場對戰/ }));

    const disclaimer = await screen.findByTestId("research-disclaimer");
    expect(disclaimer.textContent).toContain("模型賠率 = 1 ÷ 機率");
    expect(disclaimer.textContent).toContain("不計算或推薦 +EV 機會");
  });
});
