import { and, desc, eq, inArray } from "drizzle-orm";
import { teamNameTranslationAudits, teamNameTranslations } from "../drizzle/schema";
import { clearRuntimeTeamTranslation, localizeTeamName, registerRuntimeTeamTranslation } from "@shared/teamDisplay";
import { getDb } from "./db";
import { invokeLLM } from "./_core/llm";

const MAX_NAMES_PER_REQUEST = 24;

function isEnglishTeamName(value: string): boolean {
  return /^[\x20-\x7E]+$/.test(value) && /[A-Za-z]/.test(value);
}

export function isValidTraditionalTeamTranslation(value: string): boolean {
  const normalized = value.trim();
  return normalized.length >= 2 && normalized.length <= 80 && /[\u3400-\u9fff]/.test(normalized) && !/[\r\n<>]/.test(normalized);
}

export type TranslationDictionaryEntry = {
  englishName: string;
  traditionalName: string;
  source: "llm" | "curated";
  updatedAt: Date;
};

export async function listRecentTeamTranslations(limit = 10): Promise<TranslationDictionaryEntry[]> {
  const db = await getDb();
  if (!db) throw new Error("資料庫暫時無法使用。");
  const rows = await db.select().from(teamNameTranslations).orderBy(desc(teamNameTranslations.updatedAt)).limit(Math.min(Math.max(limit, 1), 20));
  return rows.map(row => ({ englishName: row.englishName, traditionalName: row.traditionalName, source: row.source, updatedAt: row.updatedAt }));
}

export async function overrideTeamTranslation(input: { englishName: string; traditionalName: string; adminChatId: string }): Promise<void> {
  const englishName = input.englishName.trim();
  const traditionalName = input.traditionalName.trim();
  if (!englishName || englishName.length > 160 || !isEnglishTeamName(englishName)) throw new Error("英文隊名格式不正確。");
  if (!isValidTraditionalTeamTranslation(traditionalName)) throw new Error("繁中譯名需為2至80個字元且不可包含換行或標籤。");
  const db = await getDb();
  if (!db) throw new Error("資料庫暫時無法使用。");
  const previous = (await db.select().from(teamNameTranslations).where(eq(teamNameTranslations.englishName, englishName)).limit(1))[0];
  await db.insert(teamNameTranslations).values({ englishName, traditionalName, source: "curated" })
    .onDuplicateKeyUpdate({ set: { traditionalName, source: "curated" } });
  await db.insert(teamNameTranslationAudits).values({ englishName, previousTraditionalName: previous?.traditionalName ?? null, nextTraditionalName: traditionalName, action: "override", adminChatId: input.adminChatId });
  registerRuntimeTeamTranslation(englishName, traditionalName);
}

export async function resetTeamTranslation(input: { englishName: string; adminChatId: string }): Promise<boolean> {
  const englishName = input.englishName.trim();
  const db = await getDb();
  if (!db) throw new Error("資料庫暫時無法使用。");
  const previous = (await db.select().from(teamNameTranslations).where(eq(teamNameTranslations.englishName, englishName)).limit(1))[0];
  if (!previous) return false;
  await db.delete(teamNameTranslations).where(eq(teamNameTranslations.englishName, englishName));
  await db.insert(teamNameTranslationAudits).values({ englishName, previousTraditionalName: previous.traditionalName, nextTraditionalName: null, action: "reset", adminChatId: input.adminChatId });
  clearRuntimeTeamTranslation(englishName);
  return true;
}

export async function undoLastTeamTranslationOverride(adminChatId: string): Promise<{ englishName: string; traditionalName: string | null } | null> {
  const db = await getDb();
  if (!db) throw new Error("資料庫暫時無法使用。");
  const [overrides, priorUndos] = await Promise.all([
    db.select().from(teamNameTranslationAudits)
      .where(and(eq(teamNameTranslationAudits.action, "override"), eq(teamNameTranslationAudits.adminChatId, adminChatId)))
      .orderBy(desc(teamNameTranslationAudits.id)).limit(50),
    db.select({ revertsAuditId: teamNameTranslationAudits.revertsAuditId }).from(teamNameTranslationAudits)
      .where(and(eq(teamNameTranslationAudits.action, "undo"), eq(teamNameTranslationAudits.adminChatId, adminChatId))),
  ]);
  const reverted = new Set(priorUndos.map(row => row.revertsAuditId).filter((id): id is number => id !== null));
  const target = overrides.find(row => !reverted.has(row.id));
  if (!target) return null;
  if (target.previousTraditionalName) {
    await db.insert(teamNameTranslations).values({ englishName: target.englishName, traditionalName: target.previousTraditionalName, source: "curated" })
      .onDuplicateKeyUpdate({ set: { traditionalName: target.previousTraditionalName, source: "curated" } });
    registerRuntimeTeamTranslation(target.englishName, target.previousTraditionalName);
  } else {
    await db.delete(teamNameTranslations).where(eq(teamNameTranslations.englishName, target.englishName));
    clearRuntimeTeamTranslation(target.englishName);
  }
  await db.insert(teamNameTranslationAudits).values({
    englishName: target.englishName,
    previousTraditionalName: target.nextTraditionalName,
    nextTraditionalName: target.previousTraditionalName,
    action: "undo",
    revertsAuditId: target.id,
    adminChatId,
  });
  return { englishName: target.englishName, traditionalName: target.previousTraditionalName };
}

export async function ensureTelegramTeamTranslations(names: string[]): Promise<void> {
  const unique = Array.from(new Set(names.map(name => name.trim()).filter(name => Boolean(name) && isEnglishTeamName(name)))).slice(0, MAX_NAMES_PER_REQUEST);
  if (!unique.length) return;
  const db = await getDb();
  if (!db) return;
  const stored = await db.select().from(teamNameTranslations).where(inArray(teamNameTranslations.englishName, unique));
  const storedNames = new Set(stored.map(row => row.englishName));
  for (const row of stored) registerRuntimeTeamTranslation(row.englishName, row.traditionalName);
  const pending = unique.filter(name => !storedNames.has(name) && localizeTeamName(name) === name);
  if (!pending.length) return;
  try {
    const result = await invokeLLM({
      model: "gpt-5-mini",
      maxTokens: 400,
      messages: [
        { role: "system", content: "你是香港足球編輯。將英文足球會名轉為繁體中文常用譯名或保守音譯。只處理輸入球會名；不可加入解釋、標點、聯賽或國家。" },
        { role: "user", content: JSON.stringify({ teams: pending }) },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "team_name_translations",
          strict: true,
          schema: {
            type: "object",
            properties: {
              translations: {
                type: "array",
                items: {
                  type: "object",
                  properties: { english: { type: "string" }, traditional: { type: "string" } },
                  required: ["english", "traditional"],
                  additionalProperties: false,
                },
              },
            },
            required: ["translations"],
            additionalProperties: false,
          },
        },
      },
    });
    const content = result.choices[0]?.message.content;
    if (typeof content !== "string") return;
    const parsed = JSON.parse(content) as { translations?: Array<{ english?: string; traditional?: string }> };
    const translations = (parsed.translations ?? []).flatMap(item => {
      const english = item.english?.trim();
      const traditional = item.traditional?.trim();
      return english && pending.includes(english) && traditional && isValidTraditionalTeamTranslation(traditional) ? [{ english, traditional }] : [];
    });
    for (const translation of translations) {
      await db.insert(teamNameTranslations).values({ englishName: translation.english, traditionalName: translation.traditional, source: "llm" })
        .onDuplicateKeyUpdate({ set: { traditionalName: translation.traditional, source: "llm" } });
      registerRuntimeTeamTranslation(translation.english, translation.traditional);
    }
  } catch {
    // Fail closed: retain English rather than present an unverified made-up translation.
  }
}
