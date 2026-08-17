import { describe, expect, it } from "vitest";
import { summarizeWeeklyModelHealth } from "./weeklyModelReport";

describe("每週模型健康報告", () => {
  it("低樣本時明確標示為資料不足而不過度解讀", () => {
    const result = summarizeWeeklyModelHealth({ settledMarkets: 6, favorableMarkets: 3, winnerMarkets: 1, favorableWinnerMarkets: 1, featureSnapshots: 2, xgMissingSnapshots: 2, oddsCoveredSnapshots: 0, restMissingSnapshots: 0 });
    expect(result.driftStatus).toBe("insufficient");
    expect(result.content).toContain("樣本不足");
  });

  it("足量且高覆蓋時標示為穩定", () => {
    const result = summarizeWeeklyModelHealth({ settledMarkets: 30, favorableMarkets: 17, winnerMarkets: 12, favorableWinnerMarkets: 7, featureSnapshots: 24, xgMissingSnapshots: 3, oddsCoveredSnapshots: 20, restMissingSnapshots: 0 });
    expect(result.driftStatus).toBe("stable");
    expect(result.content).toContain("盤口覆蓋");
  });
});
