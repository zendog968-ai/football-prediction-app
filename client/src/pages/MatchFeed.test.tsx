// @vitest-environment jsdom
import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
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
                { market: "讓球盤 (Handicap)", selection: "主隊 -0.5", probability: 0.58 },
              ],
              topScorelines: [{ score: "2-1", probability: 0.12 }, { score: "1-0", probability: 0.11 }, { score: "2-0", probability: 0.1 }],
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

  it("renders the minimal market table and three scorelines only after a card is opened", async () => {
    const user = userEvent.setup();
    render(<MatchFeed />);

    await user.click(screen.getByRole("button", { name: /Example Home.*Example Away/ }));
    expect(screen.getByText("盤口種類")).toBeTruthy();
    expect(screen.getByText("主客和 (1X2)")).toBeTruthy();
    expect(screen.getByText("入球大細 1.5")).toBeTruthy();
    expect(screen.getByText("大 2.5")).toBeTruthy();
    expect(screen.getByText("入球大細 3.5")).toBeTruthy();
    expect(screen.getByText("【最高機率波膽 Top 3】")).toBeTruthy();
    expect(screen.getByText("1. 2-1：12%")).toBeTruthy();
    expect(screen.queryByText("研究標籤")).toBeNull();
  });
});
