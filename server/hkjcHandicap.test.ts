import { describe, expect, it } from "vitest";
import { parseHkjcHandicapText } from "./hkjcHandicap";

describe("HKJC讓球盤解析契約", () => {
  it("只接受有完整主客兩邊對稱讓球與水位的官方 HDC 列", () => {
    const source = [
      "FB2935 | Pisa SC | Empoli | [0/-0.5] | 1.68 | [0/+0.5] | 2.12",
      "FB2934 | Sassuolo | Cesena | [-1/-1.5] | 1.93 | [+1/+1.5] | 1.83",
    ].join("\n");
    expect(parseHkjcHandicapText(source, new Date("2026-08-17T01:33:00Z"))).toEqual([
      {
        eventId: "FB2935",
        homeTeam: "Pisa SC",
        awayTeam: "Empoli",
        source: "HKJC",
        homeSelection: "Home 0",
        homeOdds: 1.68,
        awaySelection: "Away 0",
        awayOdds: 2.12,
        capturedAt: "2026-08-17T01:33:00.000Z",
      },
      {
        eventId: "FB2934",
        homeTeam: "Sassuolo",
        awayTeam: "Cesena",
        source: "HKJC",
        homeSelection: "Home -1",
        homeOdds: 1.93,
        awaySelection: "Away +1",
        awayOdds: 1.83,
        capturedAt: "2026-08-17T01:33:00.000Z",
      },
    ]);
  });

  it("拒絕只有一側價格或雙邊讓球不對稱的列", () => {
    const source = [
      "FB3001 | Home One | Away One | [-0.5] | 1.91",
      "FB3002 | Home Two | Away Two | [-0.5] | 1.91 | [+1] | 1.89",
    ].join("\n");
    expect(parseHkjcHandicapText(source)).toEqual([]);
  });
});
