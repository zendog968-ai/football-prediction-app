import { describe, expect, it } from "vitest";
import { formatFixtureDisplay, registerRuntimeTeamTranslation } from "@shared/teamDisplay";
import { isValidTraditionalTeamTranslation } from "./teamTranslation";

describe("Telegram隊名翻譯回退", () => {
  it("優先呈現墨超與中北美已核對的繁中隊名", () => {
    expect(formatFixtureDisplay("Atlante FC", "Toluca")).toBe("亞特蘭蒂 (Atlante FC) vs 托盧卡 (Toluca)");
    expect(formatFixtureDisplay("Forge FC", "CD Olimpia")).toBe("鍛造FC (Forge FC) vs 奧林比亞 (CD Olimpia)");
  });

  it("只接受安全的繁中翻譯快取結果", () => {
    expect(isValidTraditionalTeamTranslation("聖卡洛斯")).toBe(true);
    expect(isValidTraditionalTeamTranslation("English only")).toBe(false);
    expect(isValidTraditionalTeamTranslation("測試\n注入")).toBe(false);
    registerRuntimeTeamTranslation("Unknown Football Club", "未知足球會");
    expect(formatFixtureDisplay("Unknown Football Club", "Toluca")).toContain("未知足球會 (Unknown Football Club)");
  });
});
