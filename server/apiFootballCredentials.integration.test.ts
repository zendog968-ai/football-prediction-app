import { describe, expect, it } from "vitest";

type ApiFootballStatus = {
  response?: {
    subscription?: { active?: boolean };
    requests?: { limit_day?: number; current?: number };
  };
  errors?: Record<string, unknown> | unknown[];
};

describe("API-Football 憑證", () => {
  it("以不計日額度的status端點驗證API Key及帳戶狀態", async () => {
    const apiKey = process.env.API_FOOTBALL_KEY;
    expect(apiKey, "缺少API_FOOTBALL_KEY").toBeTruthy();

    const response = await fetch("https://v3.football.api-sports.io/status", {
      headers: { "x-apisports-key": apiKey ?? "" },
    });
    expect(response.ok, `API-Football驗證失敗（HTTP ${response.status}）`).toBe(true);

    const payload = await response.json() as ApiFootballStatus;
    const errors = payload.errors ?? {};
    expect(Array.isArray(errors) ? errors : Object.keys(errors)).toHaveLength(0);
    expect(payload.response?.subscription?.active).toBe(true);
    expect(payload.response?.requests?.limit_day).toBeGreaterThan(0);
  }, 20_000);
});
