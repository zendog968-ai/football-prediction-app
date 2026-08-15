import { describe, expect, it } from "vitest";
import { encodeLeagueIdentity, formatLeagueDisplay, localizeLeagueName } from "../shared/leagueDisplay";

describe("繁中聯賽顯示對照", () => {
  it("對應常見7M式熱門與次級聯賽名稱", () => {
    expect(localizeLeagueName("Championship", "England")).toBe("英冠");
    expect(localizeLeagueName("J2 League", "Japan")).toBe("日乙");
    expect(localizeLeagueName("Liga Profesional Argentina", "Argentina")).toBe("阿甲");
    expect(localizeLeagueName("Victoria NPL", "Australia")).toBe("澳維超");
    expect(localizeLeagueName("Pro League", "United-Arab-Emirates")).toBe("阿聯酋超");
    expect(localizeLeagueName("Bundesliga", "Austria")).toBe("奧甲");
  });

  it("未知聯賽保留原文並加上已知國家，避免未驗證錯譯", () => {
    expect(localizeLeagueName("Regional League 7", "England")).toBe("英格蘭｜Regional League 7");
    expect(localizeLeagueName("Unverified League")).toBe("Unverified League");
  });

  it("以國家與聯賽名稱區分巴甲、意甲及拉丁美洲與亞洲常見聯賽", () => {
    expect(formatLeagueDisplay(encodeLeagueIdentity("Serie A", "Brazil"))).toBe("巴甲 (Serie A)");
    expect(formatLeagueDisplay(encodeLeagueIdentity("Serie A", "Italy"))).toBe("意甲 (Serie A)");
    expect(formatLeagueDisplay(encodeLeagueIdentity("Liga MX", "Mexico"))).toBe("墨超 (Liga MX)");
    expect(formatLeagueDisplay(encodeLeagueIdentity("K League 1", "South Korea"))).toBe("K1聯賽 (K League 1)");
  });
});
