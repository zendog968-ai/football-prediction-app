import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __resetReleaseAssetsCacheForTests, getReleaseAssets } from "./releaseAssets";

const origin = "https://example.test";

describe("release asset fallback", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-14T00:00:00Z"));
    __resetReleaseAssetsCacheForTests();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    __resetReleaseAssetsCacheForTests();
  });

  it("keeps the last verified immutable release when the latest pointer later fails", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          schema_version: 1,
          generated_at: "2026-08-13T22:44:03Z",
          release_tag: "data-20260813T224404Z-86a3231",
          assets: {
            database: "football_data_expanded.db",
            model: "soccer_predict_model.pkl",
            performance: "model_performance_filters.json",
          },
        }),
      })
      .mockRejectedValueOnce(new Error("pointer unavailable"));
    vi.stubGlobal("fetch", fetchMock);

    const verified = await getReleaseAssets(origin);
    vi.advanceTimersByTime(15 * 60 * 1000 + 1);
    const retained = await getReleaseAssets(origin);

    expect(verified.version).toBe("data-20260813T224404Z-86a3231");
    expect(retained).toEqual(verified);
  });

  it("uses managed assets only when no immutable release has ever been verified", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 503 }));

    const assets = await getReleaseAssets(origin);

    expect(assets.version).toBe("managed-fallback-v2-odds");
    expect(assets.database).toContain(`${origin}/manus-storage/`);
  });
});
