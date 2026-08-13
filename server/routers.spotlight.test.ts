import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./spotlight", () => ({
  cruzeiroFlamengoSpotlight: {
    id: "cruzeiro-flamengo-libertadores-2026-r16-1",
    competition: "CONMEBOL Libertadores",
    stage: "十六強 · 首回合",
    kickoffLocal: "2026-08-12 21:30 UTC-3",
    venue: "Mineirão",
    homeTeam: "Cruzeiro",
    awayTeam: "Flamengo",
    probabilities: { home: 0.2956, draw: 0.2663, away: 0.4381 },
    expectedGoals: { home: 1.1, away: 1.4 },
    scorelines: [{ score: "1–1", probability: 0.1264 }],
    totalGoals: { under25: 0.5438, over25: 0.4562, bothTeamsScore: 0.5026 },
    factors: [{ effect: "away", title: "近期狀態", detail: "法林明高近期較佳。" }],
    notice: "情境限制。",
    sources: [{ label: "官方", url: "https://example.com" }],
  },
  hasValidSpotlight: vi.fn(() => true),
}));

import { hasValidSpotlight } from "./spotlight";
import { appRouter } from "./routers";

const context = { user: null, req: {} as never, res: {} as never };

describe("spotlight router", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns the verified Cruzeiro versus Flamengo scenario card data", async () => {
    await expect(appRouter.createCaller(context).spotlight.cruzeiroFlamengo()).resolves.toMatchObject({
      homeTeam: "Cruzeiro", awayTeam: "Flamengo", probabilities: { away: 0.4381 },
    });
  });

  it("exposes an error when the spotlight scenario does not pass validation", async () => {
    vi.mocked(hasValidSpotlight).mockReturnValue(false);
    await expect(appRouter.createCaller(context).spotlight.cruzeiroFlamengo()).rejects.toThrow("焦點賽事情境資料驗證失敗。");
  });
});
