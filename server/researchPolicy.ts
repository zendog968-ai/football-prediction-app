// Operational safety policy. A model name or sample threshold is not calibration evidence.
export const RESEARCH_POLICY = Object.freeze({
  mode: "research-only" as const,
  calibrationStatus: "uncalibrated" as const,
  highConfidenceEnabled: false,
  bettingAdviceEnabled: false,
  expectedValueEnabled: false,
  minTeamMatches: 5,
  minLeagueMatches: 20,
});

export const RESEARCH_POLICY_NOTICE = "⚠️ 未校準研究；百分比不是保證命中率。高信心篩選停用；投注建議與EV停用。";

export function hasSufficientResearchSamples(home: unknown, away: unknown, league: unknown): boolean {
  const valid = (value: unknown, minimum: number) => typeof value === "number"
    && Number.isSafeInteger(value) && value >= minimum;
  return valid(home, RESEARCH_POLICY.minTeamMatches)
    && valid(away, RESEARCH_POLICY.minTeamMatches)
    && valid(league, RESEARCH_POLICY.minLeagueMatches);
}

export function formatResearchSamples(home: unknown, away: unknown, league: unknown): string {
  const display = (value: unknown) => typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? String(value) : "未提供";
  return `📚 【有效歷史樣本】主隊 ${display(home)} 場｜客隊 ${display(away)} 場｜聯賽 ${display(league)} 場（最低5/5/20）`;
}
