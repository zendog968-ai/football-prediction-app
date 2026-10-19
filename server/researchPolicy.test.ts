import { describe, expect, it } from "vitest";
import { formatResearchSamples, hasSufficientResearchSamples, RESEARCH_POLICY, RESEARCH_POLICY_NOTICE } from "./researchPolicy";

describe("研究模式營運政策", () => {
  it("固定未校準狀態，停用高信心、投注建議與EV", () => {
    expect(RESEARCH_POLICY.calibrationStatus).toBe("uncalibrated");
    expect(RESEARCH_POLICY.highConfidenceEnabled).toBe(false);
    expect(RESEARCH_POLICY.bettingAdviceEnabled).toBe(false);
    expect(RESEARCH_POLICY.expectedValueEnabled).toBe(false);
    expect(Object.isFrozen(RESEARCH_POLICY)).toBe(true);
    expect(RESEARCH_POLICY_NOTICE).toContain("未校準研究");
    expect(RESEARCH_POLICY_NOTICE).toContain("高信心篩選停用");
  });
  it("只有真實整數样本通过5/5/20門檻，不以缺失或字串補零", () => {
    expect(hasSufficientResearchSamples(5, 5, 20)).toBe(true);
    expect(hasSufficientResearchSamples(10, 10, 105)).toBe(true);
    for (const h of [null, undefined, NaN, Infinity, -1, 4, 5.5, "10"]) {
      expect(hasSufficientResearchSamples(h, 10, 105)).toBe(false);
    }
    expect(hasSufficientResearchSamples(10, 4, 105)).toBe(false);
    expect(hasSufficientResearchSamples(10, 10, 19)).toBe(false);
  });
  it("分別顯示主客隊與聯賽有效样本，未知不能顯示成0或充分", () => {
    expect(formatResearchSamples(10, 8, 105)).toContain("主隊 10 場｜客隊 8 場｜聯賽 105 場");
    expect(formatResearchSamples(null, undefined, NaN)).toContain("主隊 未提供 場｜客隊 未提供 場｜聯賽 未提供 場");
  });
});
