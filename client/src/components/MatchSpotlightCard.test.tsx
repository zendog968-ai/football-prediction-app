// @vitest-environment jsdom
import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import MatchSpotlightCard, { type SpotlightCardData } from "./MatchSpotlightCard";

const match: SpotlightCardData = {
  competition: "CONMEBOL Libertadores", stage: "十六強 · 首回合", kickoffLocal: "2026-08-12", venue: "Mineirão", homeTeam: "Cruzeiro", awayTeam: "Flamengo",
  probabilities: { home: 0.2956, draw: 0.2663, away: 0.4381 }, expectedGoals: { home: 1.1, away: 1.4 },
  scorelines: [{ score: "1–1", probability: 0.1264 }], totalGoals: { under25: 0.5438, over25: 0.4562, bothTeamsScore: 0.5026 },
  factors: [{ effect: "away", title: "近期狀態偏向法林明高", detail: "近況優勢。" }], notice: "情境限制。", sources: [{ label: "官方賽事中心", url: "https://example.com" }],
};

describe("MatchSpotlightCard", () => {
  it("blocks uncalibrated cup probability figures and explains the inference boundary", async () => {
    render(<MatchSpotlightCard match={match} />);
    expect(screen.getByText("Out-of-Scope")).toBeTruthy();
    expect(screen.getByText(/此盃賽不屬於目前校準模型/)).toBeTruthy();
    expect(screen.queryByText("43.81%")).toBeNull();
    expect(screen.queryByText("1–1")).toBeNull();
  });
});
