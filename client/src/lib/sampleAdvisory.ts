export type SampleAdvisory = {
  level: "robust" | "caution" | "low";
  title: string;
  detail: string;
  tone: "emerald" | "amber" | "rose";
};

/**
 * UI interpretation guardrail, not a statistical significance test.
 * >=300: enough breadth for a practical segment overview.
 * 100–299: directional use only; avoid interpreting small KPI differences.
 * <100: low sample; do not draw comparative model conclusions.
 */
export function getSampleAdvisory(sampleSize: number): SampleAdvisory {
  if (sampleSize < 100) {
    return {
      level: "low",
      title: "低樣本警示",
      detail: `目前切面僅有 ${sampleSize.toLocaleString()} 場折外預測。請勿以此比較模型優劣或解讀細微準確率差距。`,
      tone: "rose",
    };
  }
  if (sampleSize < 300) {
    return {
      level: "caution",
      title: "樣本有限，請審慎解讀",
      detail: `目前切面有 ${sampleSize.toLocaleString()} 場折外預測，可作方向性參考；較小的績效差距可能受樣本波動影響。`,
      tone: "amber",
    };
  }
  return {
    level: "robust",
    title: "樣本數充足",
    detail: `目前切面有 ${sampleSize.toLocaleString()} 場折外預測，可作分組績效概覽；仍應結合校準曲線與資料覆蓋範圍判讀。`,
    tone: "emerald",
  };
}
