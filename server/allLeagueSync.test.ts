import { describe, expect, it } from "vitest";
import { summarizeAllLeagueFixtures } from "./allLeagueSync";

describe("全聯賽同步覆蓋統計", () => {
  it("以聯賽ID與國家計算唯一覆蓋，不因同聯賽多場賽事重複計數", () => {
    const summary = summarizeAllLeagueFixtures([
      { fixture: { id: 1 }, league: { id: 40, country: "England" } },
      { fixture: { id: 2 }, league: { id: 40, country: "England" } },
      { fixture: { id: 3 }, league: { id: 195, country: "Australia" } },
    ], "2026-08-15T01:10:00.000Z");
    expect(summary).toEqual({ fixtures: 3, leagues: 2, countries: 2, generatedAt: "2026-08-15T01:10:00.000Z" });
  });
});
