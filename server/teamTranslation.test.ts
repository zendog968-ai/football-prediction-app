import { describe, expect, it } from "vitest";
import { clearRuntimeTeamTranslation, formatFixtureDisplay, registerRuntimeTeamTranslation } from "@shared/teamDisplay";
import { isValidTraditionalTeamTranslation } from "./teamTranslation";
import { parseDictionaryApproveCommand, parseDictionaryCommand } from "./telegramResearch";

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

  it("允許管理員覆寫暫存譯名並於重設後回復靜態詞庫", () => {
    registerRuntimeTeamTranslation("Atlante FC", "亞特蘭特");
    expect(formatFixtureDisplay("Atlante FC", "Toluca")).toContain("亞特蘭特 (Atlante FC)");
    clearRuntimeTeamTranslation("Atlante FC");
    expect(formatFixtureDisplay("Atlante FC", "Toluca")).toContain("亞特蘭蒂 (Atlante FC)");
  });

  it("解析管理員詞典檢視、覆寫與重設語法", () => {
    expect(parseDictionaryCommand("/dict")).toEqual({ kind: "list" });
    expect(parseDictionaryCommand("/dict set Atlante FC => 亞特蘭特")).toEqual({ kind: "set", englishName: "Atlante FC", traditionalName: "亞特蘭特" });
    expect(parseDictionaryCommand("/dict reset Atlante FC")).toEqual({ kind: "reset", englishName: "Atlante FC" });
    expect(parseDictionaryCommand("/dict undo")).toEqual({ kind: "undo" });
    expect(parseDictionaryCommand("/dict undo Atlante FC")).toEqual({ kind: "undo", englishName: "Atlante FC" });
    expect(parseDictionaryCommand("/dict pending")).toEqual({ kind: "pending" });
    expect(parseDictionaryCommand("/dict modify Atlante FC")).toEqual({ kind: "invalid" });
  });

  it("解析管理員待審翻譯批核語法", () => {
    expect(parseDictionaryApproveCommand("/approve 1 國際體育會")).toEqual({ id: 1, traditionalName: "國際體育會" });
    expect(parseDictionaryApproveCommand("/approve 0 國際體育會")).toBeNull();
    expect(parseDictionaryApproveCommand("/approve 1")).toBeNull();
  });
});
