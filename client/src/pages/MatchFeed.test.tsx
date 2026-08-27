// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/trpc", () => ({
  trpc: {
    prediction: {
      upcomingCache: {
        useQuery: () => ({
          data: {
            available: true,
            fixtures: [{
              fixtureId: 77,
              leagueName: "Major League Soccer",
              eventTime: "2026-08-15T20:00:00Z",
              homeTeam: "Example Home",
              awayTeam: "Example Away",
              homeWin: 0.58,
              draw: 0.23,
              awayWin: 0.19,
              predictedScore: "2-1",
              recommendation: null,
              confidence: 2,
              predictionUpdatedAt: "2026-08-15T10:00:00Z",
              hasPrediction: true,
              compactMarkets: [
                { market: "主客和 (1X2)", selection: "主勝", probability: 0.58 },
                { market: "入球大細 1.5", selection: "大 1.5", probability: 0.78 },
                { market: "入球大細 2.5", selection: "大 2.5", probability: 0.54 },
                { market: "入球大細 3.5", selection: "小 3.5", probability: 0.64 },
                { market: "入球大細 4.5", selection: "小 4.5", probability: 0.82 },
                { market: "讓球盤 (Handicap)", selection: "主隊 -1", probability: 0.47, distribution: { fullWin: 0.47, halfWin: 0, push: 0.21, halfLoss: 0, fullLoss: 0.32 } },
                { market: "亞洲讓球 0.25", selection: "主隊 -0.25", probability: 0.37, distribution: { fullWin: 0.37, halfWin: 0, push: 0, halfLoss: 0.24, fullLoss: 0.39 } },
                { market: "亞洲讓球 0.75", selection: "客隊 +0.75", probability: 0.61, distribution: { fullWin: 0.49, halfWin: 0.24, push: 0, halfLoss: 0.11, fullLoss: 0.16 } },
                { market: "亞洲讓球 1.25", selection: "主隊 -1.25", probability: 0.36, distribution: { fullWin: 0.24, halfWin: 0.24, push: 0, halfLoss: 0.19, fullLoss: 0.33 } },
                { market: "亞洲讓球 1.75", selection: "客隊 +1.75", probability: 0.68, distribution: { fullWin: 0.56, halfWin: 0.24, push: 0, halfLoss: 0.08, fullLoss: 0.12 } },
              ],
              topScorelines: [{ score: "2-1", probability: 0.12 }, { score: "1-0", probability: 0.11 }, { score: "2-0", probability: 0.1 }],
              expectedHomeGoals: 1.4,
              expectedAwayGoals: 0.9,
              researchSource: "Dixon–Coles模型＋HDA去水融合",
              odds: null,
            }],
          },
          isLoading: false,
          refetch: vi.fn(),
        }),
      },
    },
  },
}));

import MatchFeed from "./MatchFeed";

describe("MatchFeed compact research format", () => {
  afterEach(() => cleanup());

  it("renders market research plus visual, risk and lineup tools only after a card is opened", async () => {
    const user = userEvent.setup();
    render(<MatchFeed />);

    await user.click(screen.getByRole("button", { name: /Example Home.*Example Away/ }));
    expect(screen.getByText("盤口種類")).toBeTruthy();
    expect(screen.getByText("主客和 (1X2)")).toBeTruthy();
    expect(screen.getByText("入球大細 1.5")).toBeTruthy();
    expect(screen.getByText("大 2.5")).toBeTruthy();
    expect(screen.getByText("入球大細 3.5")).toBeTruthy();
    expect(screen.getByText("入球大細 4.5")).toBeTruthy();
    expect(screen.getByText("亞洲讓球 0.25")).toBeTruthy();
    expect(screen.getByText("亞洲讓球 0.75")).toBeTruthy();
    expect(screen.getByText("亞洲讓球 1.25")).toBeTruthy();
    expect(screen.getByText("亞洲讓球 1.75")).toBeTruthy();
    expect(screen.getByText("全贏 47%｜半贏 0%｜走盤 21%｜半輸 0%｜全輸 32%")).toBeTruthy();
    expect(screen.getByText("【最高機率波膽 Top 3】")).toBeTruthy();
    expect(screen.getByText("1. 2-1：12%")).toBeTruthy();
    expect(screen.getAllByTestId("probability-visual")).toHaveLength(2);
    expect(screen.getByTestId("fixture-research-risk").textContent).toContain("資料風險受控");
    expect(screen.getByTestId("lineup-adjustment-lab")).toBeTruthy();
    expect(screen.getByText("1.40")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Example Home 先發強度調整"), { target: { value: "20" } });
    expect(screen.getByText("+20%")).toBeTruthy();
    expect(screen.queryByText("研究標籤")).toBeNull();
  });
});
