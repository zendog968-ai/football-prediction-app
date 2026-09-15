import { describe, expect, it } from "vitest";

describe("GITHUB_STATUS_TOKEN", () => {
  it("authenticates against GitHub rate_limit endpoint without exposing the token", async () => {
    const token = process.env.GITHUB_STATUS_TOKEN;
    expect(token, "GITHUB_STATUS_TOKEN must be configured").toBeTruthy();

    const response = await fetch("https://api.github.com/rate_limit", {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "football-prediction-app-status-check",
      },
      signal: AbortSignal.timeout(15000),
    });

    expect(response.status).toBe(200);
    const payload = (await response.json()) as {
      rate?: { limit?: number; remaining?: number };
    };
    expect(payload.rate?.limit).toBeTypeOf("number");
    expect(payload.rate?.remaining).toBeTypeOf("number");
  }, 20000);
});
