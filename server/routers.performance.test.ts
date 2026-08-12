import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./performance", () => ({
  getPerformanceOverview: vi.fn(),
  hasValidPerformanceOverview: vi.fn(() => true),
}));

import { getPerformanceOverview } from "./performance";
import { appRouter } from "./routers";

const context = { user: null, req: {} as never, res: {} as never };

describe("performance router", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns derived model performance data", async () => {
    vi.mocked(getPerformanceOverview).mockResolvedValue({
      summary: { validationMatches: 9101, accuracy: 0.511482, logLoss: 1.010341, folds: 5, validationStart: "2021-04-03", validationEnd: "2025-05-25" },
      foldMetrics: [],
      confusionMatrix: { labels: ["主勝", "和局", "客勝"], rows: [{ actual: "主勝", values: [1, 2, 3] }, { actual: "和局", values: [2, 3, 4] }, { actual: "客勝", values: [3, 4, 5] }] },
      calibration: [{ code: "H", label: "主勝", points: [{ bin: 0, predicted: 0.2, observed: 0.2, count: 20 }] }, { code: "D", label: "和局", points: [{ bin: 0, predicted: 0.2, observed: 0.2, count: 20 }] }, { code: "A", label: "客勝", points: [{ bin: 0, predicted: 0.2, observed: 0.2, count: 20 }] }],
      classDistribution: [],
      method: "擴張式時間序列交叉驗證。",
    });

    await expect(appRouter.createCaller(context).performance.overview()).resolves.toMatchObject({ summary: { validationMatches: 9101 } });
  });

  it("maps performance asset failures to a visible procedure error", async () => {
    vi.mocked(getPerformanceOverview).mockRejectedValue(new Error("績效資料載入失敗（404）。"));
    await expect(appRouter.createCaller(context).performance.overview()).rejects.toThrow("績效資料載入失敗（404）。");
  });
});
