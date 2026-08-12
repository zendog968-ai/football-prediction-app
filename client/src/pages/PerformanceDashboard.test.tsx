// @vitest-environment jsdom
import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}

vi.stubGlobal("ResizeObserver", ResizeObserverMock);

const overviewQuerySpy = vi.hoisted(() => vi.fn());
const dashboardTestState = vi.hoisted(() => ({ sampleSize: 9101 }));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    performance: {
      overview: {
        useQuery: (input: unknown) => {
          overviewQuerySpy(input);
          return ({
          data: {
            summary: { validationMatches: dashboardTestState.sampleSize, accuracy: 0.511482, logLoss: 1.010341, folds: 5, validationStart: "2021-04-03", validationEnd: "2025-05-25" },
            foldMetrics: [{ fold: 1, accuracy: 0.489874, logLoss: 1.030378, validationRows: 1827, validationStart: "2021-04-03", validationEnd: "2022-01-22" }],
            confusionMatrix: { labels: ["主勝", "和局", "客勝"], rows: [{ actual: "主勝", values: [3106, 9, 873] }, { actual: "和局", values: [1486, 11, 835] }, { actual: "客勝", values: [1239, 4, 1538] }] },
            calibration: [
              { code: "H", label: "主勝", points: [{ bin: 0, predicted: 0.2, observed: 0.16, count: 400 }] },
              { code: "D", label: "和局", points: [{ bin: 0, predicted: 0.2, observed: 0.18, count: 400 }] },
              { code: "A", label: "客勝", points: [{ bin: 0, predicted: 0.2, observed: 0.19, count: 400 }] },
            ],
            classDistribution: [{ code: "H", label: "主勝", actualRate: 0.4382, meanPredictedRate: 0.4257 }, { code: "D", label: "和局", actualRate: 0.2562, meanPredictedRate: 0.2577 }, { code: "A", label: "客勝", actualRate: 0.3056, meanPredictedRate: 0.3166 }],
            method: "擴張式時間序列交叉驗證。",
            filters: { leagues: [{ code: "all", label: "全部聯賽" }, { code: "EPL", label: "英超" }], seasons: [{ code: "all", label: "全部賽季" }, { code: "2024-2025", label: "2024-2025" }], outcomes: [{ code: "all", label: "全部賽果" }, { code: "H", label: "主隊勝出" }, { code: "A", label: "客隊勝出" }] },
            activeFilters: { leagueCode: "all", season: "all", outcome: "all" },
          },
          isLoading: false,
          error: null,
          });
        },
      },
    },
  },
}));

import PerformanceDashboard from "./PerformanceDashboard";

describe("PerformanceDashboard", () => {
  afterEach(() => { cleanup(); dashboardTestState.sampleSize = 9101; });

  it("renders real-format validation KPI, calibration, confusion matrix and distribution data", () => {
    render(<PerformanceDashboard />);
    expect(screen.getByText("51.15%")).toBeTruthy();
    expect(screen.getByText("1.010")).toBeTruthy();
    expect(screen.getByText("9,101")).toBeTruthy();
    expect(screen.getByText("概率校準曲線")).toBeTruthy();
    expect(screen.getByText("混淆矩陣")).toBeTruthy();
    expect(screen.getByText("3,106")).toBeTruthy();
    expect(screen.getByText("類別機率對照")).toBeTruthy();
  });

  it("requeries performance data when league, season and outcome filters change", async () => {
    const user = userEvent.setup();
    overviewQuerySpy.mockClear();
    render(<PerformanceDashboard />);

    await user.selectOptions(screen.getByLabelText("聯賽"), "EPL");
    await user.selectOptions(screen.getByLabelText("賽季"), "2024-2025");
    await user.selectOptions(screen.getByLabelText("主客場賽果"), "H");

    expect(overviewQuerySpy).toHaveBeenLastCalledWith({ leagueCode: "EPL", season: "2024-2025", outcome: "H" });
  });

  it("renders a low-sample warning and interpretation guardrail", () => {
    dashboardTestState.sampleSize = 72;
    render(<PerformanceDashboard />);

    expect(screen.getByText("低樣本警示")).toBeTruthy();
    expect(screen.getByText(/目前切面僅有 72 場折外預測/)).toBeTruthy();
    expect(screen.getByText(/並非統計顯著性檢定/)).toBeTruthy();
  });
});
