import { describe, expect, it } from "vitest";
import { cruzeiroFlamengoSpotlight, hasValidSpotlight } from "./spotlight";

describe("Cruzeiro vs Flamengo spotlight", () => {
  it("contains a valid three-way scenario distribution and sourced match context", () => {
    expect(hasValidSpotlight(cruzeiroFlamengoSpotlight)).toBe(true);
    expect(cruzeiroFlamengoSpotlight.probabilities.away).toBeGreaterThan(cruzeiroFlamengoSpotlight.probabilities.home);
    expect(cruzeiroFlamengoSpotlight.scorelines[0]?.score).toBe("1–1");
  });
});
