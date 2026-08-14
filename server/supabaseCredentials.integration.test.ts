import { describe, expect, it } from "vitest";

describe("Supabase server-only credentials", () => {
  it("authenticates to the REST root without exposing or mutating data", async () => {
    const url = process.env.SUPABASE_URL;
    const secret = process.env.SUPABASE_SECRET_KEY;
    expect(url).toMatch(/^https:\/\/[a-z0-9-]+\.supabase\.co$/);
    expect(secret).toMatch(/^sb_secret_/);

    const response = await fetch(`${url}/rest/v1/`, {
      headers: { apikey: secret!, Authorization: `Bearer ${secret}` },
    });

    expect([401, 403]).not.toContain(response.status);
    expect(response.status).toBeLessThan(500);
  }, 20_000);
});
