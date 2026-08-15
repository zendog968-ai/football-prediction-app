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
    dc_history_match_count: 0,
    dc_available: false,
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
  lean: {
    outcome: "home_win" as const,
    label: "主勝傾向",
    team: "Palmeiras",
    probability: 0.4462,
    risk_level: "high" as const,
    reasons: ["校準三分類模型中主勝傾向的機率最高（44.6%）。", "賽前Elo方向偏向Palmeiras（差距21.5）。"],
    limitations: ["Dixon–Coles資料不足；Lean只反映已校準的勝平負機率，不延伸為隊伍專屬入球結論。"],
  },
};

const mutationSpy = vi.fn();
const telegramWebhookSpy = vi.fn();
const telegramSchedulesSpy = vi.fn();
const mockState = vi.hoisted(() => ({ teamsLoading: false, forecastError: null as { message: string } | null }));
const expandedLeagueTeams = vi.hoisted(() => ({
  MLS: ["Atlanta United", "Los Angeles Galaxy"],
  J1: ["Kawasaki Frontale", "Urawa Reds"],
  FIN1: ["Haka", "Gnistan"],
  KOR1: ["Daegu", "Daejeon Hana Citizen"],
  POR1: ["AVS", "Arouca"],
  MEX1: ["Tigres UANL", "Guadalajara"],
  AUS1: ["Melbourne Victory", "Melbourne City FC"],
  UEL: ["Benfica", "Ferencváros"],
  SUD: ["Santos FC", "Vasco Da Gama"],
  LCUP: ["Seattle Sounders FC", "Guadalajara"],
}));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    prediction: {
      leagues: {
        useQuery: () => ({
          data: {
            leagues: [
              ...[
                ["BRA1", "Campeonato Brasileiro Série A"], ["EPL", "Premier League"], ["LL", "La Liga"], ["BL", "Bundesliga"], ["SA", "Serie A"], ["L1", "Ligue 1"], ["MLS", "Major League Soccer"], ["J1", "J1 League"], ["FIN1", "Veikkausliiga"], ["KOR1", "K League 1"], ["POR1", "Primeira Liga"], ["MEX1", "Liga MX"], ["AUS1", "A-League Men"], ["UEL", "UEFA Europa League"], ["SUD", "CONMEBOL Sudamericana"], ["LCUP", "Leagues Cup"],
              ].map(([code, name], index) => ({ code, name, first_completed_date: "2020-08-08", cutoff_date: index > 12 ? "2026-08-13" : "2025-05-25", last_updated_at: "2026-08-13T00:00:00+00:00", match_count: 1900, completed_match_count: 1900 })),
            ],
            coverage: { scopeCount: 16, totalMatches: 24235, totalCompletedMatches: 24235, firstDate: "2020-08-08", lastDate: "2026-08-13", lastUpdatedAt: "2026-08-13T00:00:00+00:00", releaseVersion: "data-20260813T224404Z-86a3231", model: "校準後 XGBoost 三分類模型", disclaimer: "僅使用歷史賽前資料。" },
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
      europa: {
        useQuery: () => ({
          data: {
            source: "UEFA official match API",
            retrievedAt: "2026-08-13T12:00:00Z",
            season: "2026-2027",
            recentResults: [{ date: "2026-08-11", homeTeam: "Benfica", awayTeam: "Ferencváros", homeGoals: 2, awayGoals: 1, status: "FINISHED", round: "Qualifying" }],
            upcomingFixtures: [{ date: "2026-08-20", homeTeam: "Benfica", awayTeam: "Ferencváros", homeGoals: null, awayGoals: null, status: "UPCOMING", round: "Qualifying" }],
          },
          error: null,
        }),
      },
      cup: {
        useQuery: (input: { leagueCode: "SUD" | "LCUP" }) => ({
          data: input.leagueCode === "SUD" ? {
            source: "ESPN public scoreboard", retrievedAt: "2026-08-13T12:00:00Z", season: "2026",
            recentResults: [{ date: "2026-08-12T22:00:00Z", homeTeam: "Santos FC", awayTeam: "Vasco Da Gama", homeGoals: 2, awayGoals: 1, status: "FINISHED", round: "Sudamericana" }],
            upcomingFixtures: [{ date: "2026-08-20T22:00:00Z", homeTeam: "Santos FC", awayTeam: "Vasco Da Gama", homeGoals: null, awayGoals: null, status: "UPCOMING", round: "Sudamericana" }],
          } : {
            source: "ESPN public scoreboard", retrievedAt: "2026-08-13T12:00:00Z", season: "2026",
            recentResults: [{ date: "2026-08-12T23:30:00Z", homeTeam: "Seattle Sounders FC", awayTeam: "Guadalajara", homeGoals: 2, awayGoals: 1, status: "FINISHED", round: "Leagues Cup" }],
            upcomingFixtures: [{ date: "2026-08-20T23:30:00Z", homeTeam: "Seattle Sounders FC", awayTeam: "Guadalajara", homeGoals: null, awayGoals: null, status: "UPCOMING", round: "Leagues Cup" }],
          },
          error: null,
        }),
      },
      upcomingCache: {
        useQuery: () => ({
          data: {
            source: "Supabase cache",
            loadedAt: "2026-08-15T10:00:00Z",
            available: true,
            fixtures: [{ fixtureId: 9001, leagueName: "MLS", eventTime: "2026-08-15T20:00:00Z", homeTeam: "Cache Home", awayTeam: "Cache Away", homeWin: 0.62, draw: 0.21, awayWin: 0.17, predictedScore: "2-1", recommendation: "研究傾向：主勝", confidence: 4, predictionUpdatedAt: "2026-08-15T10:00:00Z" }],
          },
          isLoading: false,
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
    telegramResearch: {
      status: {
        useQuery: () => ({
          data: { activeSubscribers: 1, schedules: [{ kind: "settlement", isEnabled: true, taskUid: "task-settlement", lastError: null }] },
          error: null,
          isFetching: false,
          refetch: vi.fn(),
        }),
      },
      configureWebhook: {
        useMutation: () => ({ mutate: telegramWebhookSpy, isPending: false, error: null }),
      },
      enableSchedules: {
        useMutation: () => ({ mutate: telegramSchedulesSpy, isPending: false, error: null }),
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
    telegramWebhookSpy.mockClear();
    telegramSchedulesSpy.mockClear();
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
    expect(screen.getByTestId("lean-summary").textContent).toContain("主勝傾向 · Palmeiras");
    expect(screen.getByTestId("lean-summary").textContent).toContain("高風險");
    expect(screen.getByTestId("lean-summary").textContent).toContain("Dixon–Coles資料不足");
    expect(JSON.parse(sessionStorage.getItem("aurelia-football-session-history") || "[]")).toHaveLength(1);
  });

  it("優先顯示Supabase快取的未來24小時研究資料與機率色彩標示", () => {
    render(<Home />);
    expect(screen.getByTestId("supabase-cache-board").textContent).toContain("Supabase cache");
    expect(screen.getByText("Cache Home vs Cache Away")).toBeTruthy();
    expect(screen.getByTestId("supabase-cache-board").textContent).toContain("🟢 62.0%");
    expect(screen.getByTestId("supabase-cache-board").textContent).toContain("⭐⭐⭐⭐");
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
    expect(screen.getByRole("option", { name: "歐霸盃 · UEFA Europa League" })).toBeTruthy();
    expect(screen.getByRole("option", { name: "南美球會盃 · CONMEBOL Sudamericana" })).toBeTruthy();
    expect(screen.getByRole("option", { name: "北美聯賽盃 · Leagues Cup" })).toBeTruthy();

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
    const checks = [
      ["MLS", "Atlan", "Atlanta United"], ["J1", "Kawa", "Kawasaki Frontale"],
      ["FIN1", "Hak", "Haka"], ["KOR1", "Daeg", "Daegu"], ["POR1", "AV", "AVS"],
      ["MEX1", "Tigr", "Tigres UANL"], ["AUS1", "Melbourne V", "Melbourne Victory"], ["UEL", "Feren", "Ferencváros"], ["SUD", "Sant", "Santos FC"], ["LCUP", "Seatt", "Seattle Sounders FC"],
    ] as const;

    for (const [leagueCode, search, expected] of checks) {
      await user.selectOptions(leagueControl, leagueCode);
      const homeInput = screen.getByLabelText("主隊");
      await user.click(homeInput);
      await user.clear(homeInput);
      await user.type(homeInput, search);
      const teamOption = await screen.findByRole("button", { name: expected });
      await user.click(teamOption);
    }
  });

  it("shows the official Europa League board and can load an eligible fixture into the prediction fields", async () => {
    const user = userEvent.setup();
    render(<Home />);

    await user.selectOptions(screen.getByLabelText("聯賽"), "UEL");
    expect(screen.getByTestId("europa-live-board")).toBeTruthy();
    expect(screen.getByText("Benfica 2–1 Ferencváros")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: /Benfica vs Ferencváros.*帶入預測/ }));
    expect((screen.getByLabelText("主隊") as HTMLInputElement).value).toBe("Benfica");
    expect((screen.getByLabelText("客隊") as HTMLInputElement).value).toBe("Ferencváros");
  });

  it("shows both new cup boards and can load a calibrated Leagues Cup fixture into the prediction fields", async () => {
    const user = userEvent.setup();
    render(<Home />);

    await user.selectOptions(screen.getByLabelText("聯賽"), "SUD");
    expect(screen.getByTestId("cup-live-board")).toBeTruthy();
    expect(screen.getByText("Santos FC 2–1 Vasco Da Gama")).toBeTruthy();
    await user.selectOptions(screen.getByLabelText("聯賽"), "LCUP");
    expect(screen.getByText("Seattle Sounders FC 2–1 Guadalajara")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: /Seattle Sounders FC vs Guadalajara.*帶入預測/ }));
    expect((screen.getByLabelText("主隊") as HTMLInputElement).value).toBe("Seattle Sounders FC");
    expect((screen.getByLabelText("客隊") as HTMLInputElement).value).toBe("Guadalajara");
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

  it("shows database update time and labels model odds as a non-probability fair threshold", async () => {
    const user = userEvent.setup();
    render(<Home />);

    expect(screen.getByText(/資料庫更新/)).toBeTruthy();
    await user.selectOptions(screen.getByRole("combobox"), "BRA1");
    await user.click(screen.getByLabelText("主隊"));
    await user.type(screen.getByLabelText("主隊"), "Palm");
    await user.click(screen.getByRole("button", { name: /Palmeiras/ }));
    await user.click(screen.getByLabelText("客隊"));
    await user.type(screen.getByLabelText("客隊"), "Flam");
    await user.click(screen.getByRole("button", { name: /Flamengo RJ/ }));
    await user.click(screen.getByRole("button", { name: /開始分析這場對戰/ }));

    const disclaimer = await screen.findByTestId("research-disclaimer");
    expect(disclaimer.textContent).toContain("模型公平門檻（十進制）= 1 ÷ 機率");
    expect(disclaimer.textContent).toContain("並非機率、命中率或保證");
    expect(disclaimer.textContent).toContain("大小球、BTTS與未涵蓋聯賽的研究數字不會被轉換為模型公平門檻或EV");
  });

  it("keeps Lean, risk reasoning and the research disclaimer available in a 375px viewport", async () => {
    const originalWidth = window.innerWidth;
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 375 });
    window.dispatchEvent(new Event("resize"));
    const user = userEvent.setup();
    render(<Home />);

    try {
      await user.selectOptions(screen.getByRole("combobox"), "BRA1");
      await user.click(screen.getByLabelText("主隊"));
      await user.type(screen.getByLabelText("主隊"), "Palm");
      await user.click(screen.getByRole("button", { name: /Palmeiras/ }));
      await user.click(screen.getByLabelText("客隊"));
      await user.type(screen.getByLabelText("客隊"), "Flam");
      await user.click(screen.getByRole("button", { name: /Flamengo RJ/ }));
      await user.click(screen.getByRole("button", { name: /開始分析這場對戰/ }));

      const lean = await screen.findByTestId("lean-summary");
      expect(lean.textContent).toContain("主勝傾向 · Palmeiras");
      expect(lean.textContent).toContain("高風險");
      expect(lean.textContent).toContain("Dixon–Coles資料不足");
      expect((await screen.findByTestId("research-disclaimer")).textContent).toContain("模型公平門檻（十進制）= 1 ÷ 機率");
      expect((await screen.findByTestId("research-disclaimer")).textContent).toContain("大小球、BTTS與未涵蓋聯賽的研究數字不會被轉換為模型公平門檻或EV");
    } finally {
      Object.defineProperty(window, "innerWidth", { configurable: true, value: originalWidth });
      window.dispatchEvent(new Event("resize"));
    }
  });

  it("shows a transparent cutoff and completed-sample card grid", () => {
    render(<Home />);

    const transparency = screen.getByTestId("data-transparency-cards");
    expect(transparency.textContent).toContain("資料截止日與樣本數");
    expect(transparency.textContent).toContain("已驗證範圍");
    expect(transparency.textContent).toContain("24,235");
    expect(transparency.textContent).toContain("data-20260813T224404Z-86a3231");
    expect(transparency.textContent).toContain("北美聯賽盃");
    expect(transparency.textContent).toContain("已完場樣本");
  });

  it("renders the Telegram research operations card with research-only guardrails", () => {
    render(<Home />);
    const operations = screen.getByTestId("telegram-research-settings");
    expect(operations.textContent).toContain("研究通知與盤口監控");
    expect(operations.textContent).toContain("10:30、11:00及18:30");
    expect(operations.textContent).toContain("並非投注或資金建議");
    expect(screen.getByRole("button", { name: "設定Webhook" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "啟用排程" })).toBeTruthy();
  });

  it("calculates EV research statistics only after three valid decimal odds are supplied", async () => {
    const user = userEvent.setup();
    render(<Home />);

    await user.selectOptions(screen.getByRole("combobox"), "BRA1");
    await user.click(screen.getByLabelText("主隊"));
    await user.type(screen.getByLabelText("主隊"), "Palm");
    await user.click(screen.getByRole("button", { name: /Palmeiras/ }));
    await user.click(screen.getByLabelText("客隊"));
    await user.type(screen.getByLabelText("客隊"), "Flam");
    await user.click(screen.getByRole("button", { name: /Flamengo RJ/ }));
    await user.click(screen.getByRole("button", { name: /開始分析這場對戰/ }));

    expect(await screen.findByTestId("odds-research-module")).toBeTruthy();
    expect(screen.getByText(/請輸入三個大於 1.00/)).toBeTruthy();
    await user.type(screen.getByLabelText("Palmeiras 主勝賠率"), "2.50");
    await user.type(screen.getByLabelText("和局賠率"), "3.50");
    await user.type(screen.getByLabelText("Flamengo RJ 客勝賠率"), "4.00");

    expect((await screen.findAllByText("+EV 統計標記")).length).toBeGreaterThan(0);
    expect(screen.getByText(/賠率與EV數據僅供模型效能驗證與統計學研究/)).toBeTruthy();
  });
});
