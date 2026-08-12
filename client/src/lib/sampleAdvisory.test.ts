import { describe, expect, it } from "vitest";
import { getSampleAdvisory } from "./sampleAdvisory";

describe("sample advisory guardrail", () => {
  it("marks samples below 100 as low sample", () => {
    expect(getSampleAdvisory(99)).toMatchObject({ level: "low", tone: "rose" });
  });

  it("marks 100 through 299 samples as caution", () => {
    expect(getSampleAdvisory(100)).toMatchObject({ level: "caution", tone: "amber" });
    expect(getSampleAdvisory(299)).toMatchObject({ level: "caution" });
  });

  it("marks samples at or above 300 as robust", () => {
    expect(getSampleAdvisory(300)).toMatchObject({ level: "robust", tone: "emerald" });
  });
});
