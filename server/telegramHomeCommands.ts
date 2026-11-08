import { ENV } from "./_core/env";
import { listRecentTeamTranslations, listPendingTeamTranslations, seedPendingTeamTranslationsForTest, overrideTeamTranslation, resetTeamTranslation, undoLastTeamTranslationOverride, approvePendingTeamTranslation } from "./teamTranslation";
export function parseDictionaryCommand(rawText: string | undefined):
  | { kind: "list" }
  | { kind: "pending" }
  | { kind: "seed" }
  | { kind: "set"; englishName: string; traditionalName: string }
  | { kind: "reset"; englishName: string }
  | { kind: "undo"; englishName?: string }
  | { kind: "invalid" } {
  const body = rawText?.trim().replace(/^\/dict(?:@[a-z0-9_]+)?\s*/i, "") ?? "";
  if (!body) return { kind: "list" };
  if (/^pending$/i.test(body)) return { kind: "pending" };
  if (/^seed$/i.test(body)) return { kind: "seed" };
  const undo = /^undo(?:\s+(.+))?$/i.exec(body);
  if (undo) return { kind: "undo", ...(undo[1]?.trim() ? { englishName: undo[1].trim() } : {}) };
  const set = /^set\s+(.+?)\s*=>\s*(.+)$/i.exec(body);
  if (set) return { kind: "set", englishName: set[1]!.trim(), traditionalName: set[2]!.trim() };
  const reset = /^reset\s+(.+)$/i.exec(body);
  if (reset) return { kind: "reset", englishName: reset[1]!.trim() };
  return { kind: "invalid" };
}

export function parseDictionaryApproveCommand(rawText: string | undefined): { id: number; traditionalName: string } | null {
  const match = rawText?.trim().match(/^\/approve(?:@[a-z0-9_]+)?\s+(\d+)\s+(.+)$/i);
  if (!match) return null;
  const id = Number(match[1]);
  const traditionalName = match[2]?.trim();
  return Number.isInteger(id) && id > 0 && traditionalName ? { id, traditionalName } : null;
}

function isDictionaryAdmin(chatId: string): boolean {
  return Boolean(ENV.telegramAdminChatId) && chatId === ENV.telegramAdminChatId;
}

export async function telegramDictionaryForAdmin(chatId: string, rawText: string | undefined): Promise<string> {
  if (!isDictionaryAdmin(chatId)) return "🔒 無權限：此詞典指令僅限系統管理員使用。";
  const command = parseDictionaryCommand(rawText);
  if (command.kind === "invalid") {
    return "用法：\n/dict\n/dict pending\n/dict seed（建立明確測試待審項目）\n/approve 1 國際體育會\n/dict set Atlante FC => 繁中譯名\n/dict reset Atlante FC\n/dict undo\n/dict undo Atlante FC";
  }
  if (command.kind === "seed") {
    await seedPendingTeamTranslationsForTest();
    return "🧪 已建立測試待審項目：TestFC、Demo United。\n傳送 /dict pending 查看；以 /approve [ID] [繁中譯名] 批核。";
  }
  if (command.kind === "pending") {
    const pending = await listPendingTeamTranslations();
    if (!pending.length) return "📥 【待審核隊名】\n目前沒有待審核音譯。";
    return [
      "📥 【待審核隊名】",
      "──────────────────",
      ...pending.map(entry => `${entry.id}. ${entry.englishName} → ${entry.suggestedTraditionalName}（${entry.source === "test" ? "測試" : "安全音譯"}｜出現${entry.seenCount}次）`),
      "",
      "批核：/approve [ID] [正確繁中譯名]",
    ].join("\n");
  }
  if (command.kind === "set") {
    await overrideTeamTranslation({ ...command, adminChatId: chatId });
    return `✅ 已覆寫\n${command.englishName} → ${command.traditionalName}\n\n變更已記錄，後續Telegram推播會優先使用此譯名。`;
  }
  if (command.kind === "reset") {
    const removed = await resetTeamTranslation({ englishName: command.englishName, adminChatId: chatId });
    return removed
      ? `↩️ 已重設 ${command.englishName}\n下次需要時會恢復使用詞庫或重新進行安全翻譯。`
      : `找不到 ${command.englishName} 的可重設自動／覆寫譯名。`;
  }
  if (command.kind === "undo") {
    if (command.englishName && (!/^[\x20-\x7E]+$/.test(command.englishName) || !/[A-Za-z]/.test(command.englishName) || command.englishName.length > 160)) {
      return "指定隊名須為不超過160字元的英文隊名。";
    }
    const undone = await undoLastTeamTranslationOverride(chatId, command.englishName);
    if (!undone) return command.englishName ? `找不到 ${command.englishName} 可復原的詞典覆寫。` : "目前沒有可復原的詞典覆寫。";
    return undone.traditionalName
      ? `↩️ 已復原最近覆寫\n${undone.englishName} → ${undone.traditionalName}\n\n此復原已記錄至詞典稽核。`
      : `↩️ 已移除最近覆寫\n${undone.englishName} 已還原至內建詞庫或待下次安全翻譯。`;
  }
  const recent = await listRecentTeamTranslations(12);
  if (!recent.length) return "📚 詞典目前沒有已快取的自動譯名。";
  return [
    "📚 【近期自動隊名詞典】",
    ...recent.map((entry, index) => `${index + 1}. ${entry.englishName} → ${entry.traditionalName} ${entry.source === "llm" ? "🤖" : "✍️"}`),
    "",
    "覆寫：/dict set 英文隊名 => 繁中譯名",
    "待審音譯：/dict pending",
    "批核待審：/approve 1 國際體育會",
    "重設：/dict reset 英文隊名",
    "復原最近覆寫：/dict undo",
    "復原指定隊名：/dict undo Atlante FC",
  ].join("\n");
}

export async function telegramApproveForAdmin(chatId: string, rawText: string | undefined): Promise<string> {
  if (!isDictionaryAdmin(chatId)) return "🔒 無權限：此詞典指令僅限系統管理員使用。";
  const input = parseDictionaryApproveCommand(rawText);
  if (!input) return "用法：/approve [待審ID] [正確繁中譯名]\n例如：/approve 1 國際體育會";
  const approved = await approvePendingTeamTranslation({ ...input, adminChatId: chatId });
  return approved
    ? `✅ 已批核 #${input.id}\n${approved.englishName} → ${approved.traditionalName}\n\n翻譯快取已刷新，後續 /upcoming 與定時推播會立即使用此名稱。`
    : `找不到待審核項目 #${input.id}，或該項目已處理。`;
}

