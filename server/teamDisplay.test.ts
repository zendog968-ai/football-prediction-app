import { describe, expect, it } from "vitest";
import { formatFixtureDisplay, formatTeamDisplay, formatTranslatedTeamDisplay, localizeTeamName, selectTraditionalName } from "@shared/teamDisplay";

const aliases = [
  ["CF Pachuca", "帕丘卡"],
  ["Club Tijuana", "提華納"],
  ["Guadalajara Chivas", "瓜達拉哈拉"],
  ["VfL Bochum", "波琴"],
  ["VfL Bochum 1848", "波琴"],
  ["VfL Wolfsburg", "禾夫斯堡"],
  ["U.N.A.M. - Pumas", "普馬斯"],
  ["U.N.A.M.-Pumas", "普馬斯"],
  ["UNAM - Pumas", "普馬斯"],
  ["UNAM Pumas", "普馬斯"],
  ["Pumas UNAM", "普馬斯"],
  ["Urawa", "浦和紅鑽"],
  ["Urawa Reds", "浦和紅鑽"],
  ["Urawa Red Diamonds", "浦和紅鑽"],
] as const;

describe("traditional team display aliases", () => {
  it.each(aliases)("localizes %s and preserves the provider spelling", (english, traditional) => {
    expect(localizeTeamName(english)).toBe(traditional);
    expect(formatTeamDisplay(english)).toBe(`${traditional} (${english})`);
  });

  it.each(aliases)("matches %s case-insensitively with surrounding whitespace", (english, traditional) => {
    expect(selectTraditionalName(`  ${english.toUpperCase()}  `)).toBe(traditional);
  });

  it("normalizes whitespace and compatibility width only for matching", () => {
    expect(localizeTeamName("VfL\t  Bochum")).toBe("波琴");
    expect(localizeTeamName("ＶｆＬ Ｗｏｌｆｓｂｕｒｇ")).toBe("禾夫斯堡");
    expect(formatTeamDisplay("  Club   Tijuana  ")).toBe("提華納 (Club   Tijuana)");
  });

  it("keeps HK then TW authoritative translations ahead of alias fallbacks", () => {
    expect(formatTranslatedTeamDisplay("VfL Bochum", { nameZhHk: " 香港譯名 ", nameZhTw: "台灣譯名" })).toBe("香港譯名 (VfL Bochum)");
    expect(selectTraditionalName("Urawa", { nameZhHk: " ", nameZhTw: " 台灣譯名 " })).toBe("台灣譯名");
    expect(selectTraditionalName("CF Pachuca", { nameZhHk: null, nameZhTw: " " })).toBe("帕丘卡");
    // A caller's identity-keyed translation remains authoritative even when the
    // fixture's English name differs. This module never guesses numeric IDs.
    expect(selectTraditionalName("Unlisted provider name", { nameZhHk: "已按球隊ID配對" })).toBe("已按球隊ID配對");
  });

  it.each(["VfL", "Pumas", "Club", "Urawa Youth", "VfL Bochum II", "Unknown FC"])("does not fuzzy-match %s", english => {
    expect(selectTraditionalName(english)).toBeNull();
    expect(formatTeamDisplay(` ${english} `)).toBe(english);
  });

  it("retains safe gender suffix localization without changing team identity",()=>{expect(formatTeamDisplay("Club Tijuana Women")).toBe("提華納女足 (Club Tijuana Women)");});

  it("retains existing known names and fixture formatting", () => {
    expect(formatFixtureDisplay("Pachuca", "Club Tijuana")).toBe("帕丘卡 (Pachuca) vs 提華納 (Club Tijuana)");
    expect(formatFixtureDisplay("VfL Bochum", "VfL Wolfsburg")).toBe("波琴 (VfL Bochum) vs 禾夫斯堡 (VfL Wolfsburg)");
    expect(formatFixtureDisplay("Jeju United FC", "FC Anyang")).toBe("濟州SK (Jeju United FC) vs 安養FC (FC Anyang)");
    expect(formatTeamDisplay("Unknown FC")).toBe("Unknown FC");
    expect(formatTranslatedTeamDisplay("曼聯", { nameZhHk: "曼聯" })).toBe("曼聯");
  });
});
