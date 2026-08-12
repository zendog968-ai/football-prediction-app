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

vi.mock("@/lib/trpc", () => ({
  trpc: {
    prediction: {
      leagues: {
        useQuery: () => ({
          data: {
            leagues: [
              { code: "BRA1", name: "Campeonato Brasileiro Série A", first_date: "2020-08-08", last_date: "2024-12-08", match_count: 1900 },
              { code: "EPL", name: "Premier League", first_date: "2020-09-12", last_date: "2025-05-25", match_count: 1900 },
            ],
            coverage: { firstDate: "2020-08-08", lastDate: "2025-05-25", model: "校準後 XGBoost 三分類模型", disclaimer: "僅使用歷史賽前資料。" },
          },
        }),
      },
      teams: { useQuery: (input: { leagueCode: string }) => ({
        data: { teams: input.leagueCode === "EPL" ? ["Arsenal", "Chelsea", "Liverpool"] : ["Flamengo RJ", "Palmeiras", "Santos"] },
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
});
