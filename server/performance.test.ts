import { describe, expect, it } from "vitest";
import { hasValidPerformanceOverview, type PerformanceOverview } from "./performance";

const overview: PerformanceOverview = {
  summary: { validationMatches: 9101, accuracy: 0.511482, logLoss: 1.010341, folds: 5, validationStart: "2021-04-03", validationEnd: "2025-05-25" },
  foldMetrics: [],
  confusionMatrix: { labels: ["主勝", "和局", "客勝"], rows: [{ actual: "主勝", values: [1, 2, 3] }, { actual: "和局", values: [2, 3, 4] }, { actual: "客勝", values: [3, 4, 5] }] },
  calibration: [
    { code: "H", label: "主勝", points: [{ bin: 0, predicted: 0.1, observed: 0.12, count: 25 }] },
    { code: "D", label: "和局", points: [{ bin: 0, predicted: 0.1, observed: 0.11, count: 25 }] },
    { code: "A", label: "客勝", points: [{ bin: 0, predicted: 0.1, observed: 0.09, count: 25 }] },
  ],
  classDistribution: [],
  method: "OOF",
};

describe("performance data guard", () => {
  it("accepts a valid derived performance payload", () => expect(hasValidPerformanceOverview(overview)).toBe(true));
  it("rejects invalid probability calibration points", () => expect(hasValidPerformanceOverview({ ...overview, calibration: [{ ...overview.calibration[0], points: [{ bin: 0, predicted: 1.2, observed: 0.1, count: 20 }] }, ...overview.calibration.slice(1)] })).toBe(false));
});
