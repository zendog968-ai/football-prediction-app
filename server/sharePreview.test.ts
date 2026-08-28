import { describe, expect, it } from "vitest";
import type { CachedUpcomingFixture } from "./supabaseCache";
import { buildFixtureSharePreview, injectFixtureShareMeta, renderFixtureShareCard } from "./sharePreview";

const fixture: CachedUpcomingFixture = {
  fixtureId: 77,
  leagueName: "K League 2",
  eventTime: "2026-08-28T10:30:00Z",
  homeTeam: "Ansan Greeners",
  awayTeam: "Daegu FC",
  homeWin: 0.42,
  draw: 0.31,
  awayWin: 0.27,
  predictedScore: "1-1",
  recommendation: null,
  researchSource: "Dixon–Coles模型＋HDA去水融合",
  confidence: 3,
  predictionUpdatedAt: "2026-08-28T08:00:00Z",
  hasPrediction: true,
  compactMarkets: [],
  topScorelines: [{ score: "1-1", probability: 0.13 }, { score: "1-0", probability: 0.11 }, { score: "0-1", probability: 0.09 }],
  expectedHomeGoals: 1.12,
  expectedAwayGoals: 0.98,
  odds: null,
  handicapQuote: null,
};

describe("fixture share previews", () => {
  it("derives a canonical, localized preview only from the supplied cached fixture", () => {
    const preview = buildFixtureSharePreview(fixture, "https://footypred.example");

    expect(preview.canonicalUrl).toBe("https://footypred.example/?fixture=77");
    expect(preview.imageUrl).toBe("https://footypred.example/api/share/fixture/77/card.png");
    expect(preview.fixture).toContain("Ansan Greeners");
    expect(preview.predictionLine).toContain("主勝 42%");
    expect(preview.researchLine).toContain("預期入球 1.12 — 0.98");
  });

  it("injects crawler-readable Open Graph and Twitter metadata into the page template", () => {
    const preview = buildFixtureSharePreview(fixture, "https://footypred.example");
    const page = injectFixtureShareMeta("<title>Aurelia Football Probability Studio</title><meta name=\"description\" content=\"以已同步資料呈現的足球賽事機率與戰術研究平台。\" /><!-- AURELIA_SHARE_META -->", preview);

    expect(page).toContain('property="og:title"');
    expect(page).toContain('property="og:image" content="https://footypred.example/api/share/fixture/77/card.png"');
    expect(page).toContain('name="twitter:card" content="summary_large_image"');
    expect(page).not.toContain("AURELIA_SHARE_META");
  });

  it("renders a 1200 by 630 social card with current research context", () => {
    const preview = buildFixtureSharePreview(fixture, "https://footypred.example");
    const svg = renderFixtureShareCard(preview);

    expect(svg).toContain('width="1200" height="630"');
    expect(svg).toContain("1X2 機率研究");
    expect(svg).toContain("預測比分");
    expect(svg).toContain("不構成投注、資金或保證性建議");
  });
});
