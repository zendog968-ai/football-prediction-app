// @vitest-environment jsdom
import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import MatchFeed, { actualHistoryCounts, MatchDiagnostics, oddsDisplayStatus, predictionAgeLabel, predictionDisplayState, sampleCountLabel, type ResearchFixture } from "./MatchFeed";

// Synthetic offline contract fixture: no provider calls or runtime data.
const now = Date.parse("2026-11-08T02:30:00Z");
const item: ResearchFixture = {
  fixtureId: 1, leagueName: "MLS", eventTime: "2026-11-08T08:00:00Z",
  homeTeam: "Test Home", awayTeam: "Test Away", homeWin: 0.6, draw: 0.2, awayWin: 0.2,
  predictedScore: "2-1", hasPrediction: true, predictionUpdatedAt: "2026-11-08T02:00:00Z",
  homeHistoryMatches: 8, awayHistoryMatches: 7, leagueHistoryMatches: 69,
  homeSampleMatches: 18, awaySampleMatches: 17, leagueSampleMatches: 69,
  researchSource: "poisson-v4-shrink10-research（未校準；無市場融合）", dataQualityReason: "ok",
  oddsStatus: "not_available", odds: null,
};

afterEach(cleanup);

describe("scoped match feed diagnostics", () => {
  it("shows actual counts separately from effective samples, update age and unavailable as-of/odds", () => {
    render(<MatchFeed fixtures={[item]} now={now} />);
    const text = screen.getByTestId("research-match-feed").textContent;
    expect(text).toContain("實際歷史樣本：主隊 8 場 · 客隊 7 場 · 聯賽 69 場");
    expect(text).toContain("模型有效樣本（不等同實際歷史）：主隊 18 場");
    expect(text).toContain("預測資料截點：未提供（不以更新時間代替）");
    expect(text).toContain("HKT · 更新年齡：30 分鐘");
    expect(text).toContain("賠率狀態：未提供可用賠率");
    expect(text).toContain("主勝 60.0%");
    expect(text).not.toContain("NaN");
  });

  it("does not substitute model samples for absent actual counts and preserves real zero", () => {
    const { homeHistoryMatches: _home, awayHistoryMatches: _away, leagueHistoryMatches: _league, ...withoutHistory } = item;
    expect(actualHistoryCounts(withoutHistory)).toEqual({ home: undefined, away: undefined, league: undefined });
    render(<MatchDiagnostics item={{ ...withoutHistory, awayHistoryMatches: 0 }} now={now} />);
    expect(screen.getByTestId("match-diagnostics").textContent).toContain("實際歷史樣本：主隊 未提供 · 客隊 0 場 · 聯賽 未提供");
    expect(sampleCountLabel(-1)).toBe("未提供");
    expect(sampleCountLabel(Number.NaN)).toBe("未提供");
    expect(sampleCountLabel(2.1)).toBe("未提供");
  });

  it("accepts provided forecast diagnostics without inventing league counts from global counts", () => {
    expect(actualHistoryCounts({ diagnostics: { home_history_matches_used: 32, away_history_matches_used: 28, historical_matches_used: 1000 } }))
      .toEqual({ home: 32, away: 28, league: undefined });
    expect(actualHistoryCounts({ homeHistoryMatches: null, diagnostics: { home_history_matches_used: 32 } }).home).toBeNull();
  });

  it.each([
    ["stale", { predictionUpdatedAt: "2026-11-07T23:00:00Z" }, "預測過期"],
    ["future", { predictionUpdatedAt: "2026-11-08T02:31:00Z" }, "更新時間在未來"],
    ["missing timestamp", { predictionUpdatedAt: null }, "更新時間未提供"],
    ["timezone missing", { predictionUpdatedAt: "2026-11-08T02:00:00" }, "缺少時區"],
    ["false flag", { hasPrediction: false }, "快取驗證未通過"],
    ["missing flag", { hasPrediction: undefined }, "狀態未提供"],
    ["NaN", { homeWin: Number.NaN }, "機率資料無效"],
    ["out of range", { homeWin: 1.2 }, "機率資料無效"],
    ["sum", { homeWin: 0.8 }, "機率資料無效"],
    ["kickoff", { eventTime: "2026-11-08T02:30:00Z" }, "已到開賽時間"],
    ["quality rejected", { dataQualityReason: "insufficient_samples" }, "歷史樣本不足"],
  ] as const)("hides percentages and scorelines for %s while preserving diagnostics", (_label, overrides, reason) => {
    render(<MatchFeed fixtures={[{ ...item, ...overrides }]} now={now} />);
    const text = screen.getByTestId("research-match-feed").textContent;
    expect(text).toContain(reason);
    expect(text).toContain("實際歷史樣本");
    expect(text).not.toContain("60.0%");
    expect(text).not.toContain("2-1");
    expect(text).not.toContain("NaN");
  });

  it("uses the existing exact two-hour prediction freshness boundary", () => {
    expect(predictionDisplayState({ ...item, predictionUpdatedAt: "2026-11-08T00:30:00Z" }, now).available).toBe(true);
    expect(predictionDisplayState({ ...item, predictionUpdatedAt: "2026-11-08T00:29:59Z" }, now).available).toBe(false);
    expect(predictionAgeLabel(null, now)).toBe("未提供");
    expect(predictionAgeLabel("not-a-date", now)).toBe("無效或缺少時區");
  });

  it("shows valid/partial/stale/invalid odds independently of prediction availability", () => {
    const odds = { home: 2, draw: 3, away: 4, capturedAt: "2026-11-08T02:10:00Z" };
    expect(oddsDisplayStatus({ ...item, odds, oddsStatus: "verified" }, now)).toContain("主／和／客有效快照（3/3）");
    expect(oddsDisplayStatus({ ...item, odds: { ...odds, away: null } }, now)).toContain("資料不完整（2/3）");
    expect(oddsDisplayStatus({ ...item, odds: { ...odds, capturedAt: "2026-11-08T01:59:59Z" } }, now)).toContain("快照過期");
    expect(oddsDisplayStatus({ ...item, odds: { ...odds, capturedAt: null } }, now)).toContain("快照時間未提供");
    expect(oddsDisplayStatus({ ...item, odds: { ...odds, home: 1, draw: Number.NaN, away: null } }, now)).toContain("賠率資料無效");
    expect(oddsDisplayStatus({ ...item, odds: null, oddsStatus: "query_failed" }, now)).toContain("查詢失敗（query_failed）");
    expect(oddsDisplayStatus({ ...item, odds: null, oddsStatus: "stale" }, now)).toContain("賠率快照過期（stale）");
  });

  it("updates selected details using the existing fixture data only", async () => {
    const user = userEvent.setup();
    render(<MatchFeed fixtures={[item, { ...item, fixtureId: 2, homeTeam: "Second Home", homeHistoryMatches: 22 }]} now={now} />);
    await user.click(screen.getByRole("button", { name: /Second Home/ }));
    expect(screen.getByRole("heading", { name: "Second Home vs Test Away" })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Second Home/ }).getAttribute("aria-pressed")).toBe("true");
  });

  it("withholds free-text betting and calibration claims even beside uncalibrated wording", () => {
    render(<MatchDiagnostics item={{ ...item, researchSource: "uncalibrated +EV 20% stake 5%", dataQualityReason: "已校準高信心投注建議" }} now={now} />);
    const text = screen.getByTestId("match-diagnostics").textContent;
    expect(text).toContain("描述含未核實決策宣稱，已隱藏");
    expect(text).not.toContain("+EV");
    expect(text).not.toContain("stake");
    expect(text).not.toContain("已校準");
  });
});
