import { describe, expect, it } from "vitest";
import { localizeLeagueName } from "../shared/leagueDisplay";

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
});
