export type MatchSpotlight = {
  id: string;
  competition: string;
  stage: string;
  kickoffLocal: string;
  venue: string;
  homeTeam: string;
  awayTeam: string;
  probabilities: { home: number; draw: number; away: number };
  expectedGoals: { home: number; away: number };
  scorelines: Array<{ score: string; probability: number }>;
  totalGoals: { under25: number; over25: number; bothTeamsScore: number };
  factors: Array<{ effect: "home" | "away" | "balance"; title: string; detail: string }>;
  notice: string;
  sources: Array<{ label: string; url: string }>;
};

export const cruzeiroFlamengoSpotlight: MatchSpotlight = {
  id: "cruzeiro-flamengo-libertadores-2026-r16-1",
  competition: "CONMEBOL Libertadores",
  stage: "十六強 · 首回合",
  kickoffLocal: "2026-08-12 21:30 UTC-3",
  venue: "Estádio Governador Magalhães Pinto · Mineirão",
  homeTeam: "Cruzeiro",
  awayTeam: "Flamengo",
  probabilities: { home: 0.2956, draw: 0.2663, away: 0.4381 },
  expectedGoals: { home: 1.1, away: 1.4 },
  scorelines: [
    { score: "1–1", probability: 0.1264 }, { score: "0–1", probability: 0.1149 },
    { score: "1–0", probability: 0.0903 }, { score: "1–2", probability: 0.0885 },
    { score: "0–0", probability: 0.0821 }, { score: "0–2", probability: 0.0804 },
  ],
  totalGoals: { under25: 0.5438, over25: 0.4562, bothTeamsScore: 0.5026 },
  factors: [
    { effect: "away", title: "近期狀態偏向法林明高", detail: "官方近六場指標為法林明高 5 勝 1 和 0 負，高士路則為 3 勝 2 和 1 負。" },
    { effect: "home", title: "Mineirão 與首回合節奏", detail: "高士路主場作戰、總比分仍為 0–0，使其能以較低風險節奏保留平局與一球差距的空間。" },
    { effect: "away", title: "高士路的中後場缺口", detail: "賽前資訊顯示 Fagner 與 Lucas Romero 停賽，另有 Gabriel Pec、Luis Sinisterra 傷缺，降低主隊輪換深度。" },
    { effect: "balance", title: "低比分情境仍具份量", detail: "中央情境下 2.5 球以下為 54.38%，最可能單一比分是 1–1。" },
  ],
  notice: "此卡片為賽前情境分佈，不是既有即時校準模型輸出。既有模型資料截止於 2024 年，未納入 2026 自由盃的即時傷停、臨場先發調整、天氣或賠率；比賽開踢後不應視為賽中機率。",
  sources: [
    { label: "CONMEBOL 官方賽事中心", url: "https://gol.conmebol.com/libertadores/en/fixture/view/1602" },
    { label: "賽前陣容與缺陣報導", url: "https://www.sportsmole.co.uk/football/cruzeiro/copa-libertadores/preview/cruzeiro-vs-flamengo-prediction-team-news-lineups_602815.html" },
  ],
};

export function hasValidSpotlight(data: MatchSpotlight) {
  const total = data.probabilities.home + data.probabilities.draw + data.probabilities.away;
  return Math.abs(total - 1) < 0.0002 && data.scorelines.length > 0 && data.factors.length > 0 && data.sources.every(source => source.url.startsWith("https://"));
}
