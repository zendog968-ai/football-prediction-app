import { inArray } from "drizzle-orm";
import { teamNameTranslations } from "../drizzle/schema";
import { localizeTeamName, registerRuntimeTeamTranslation } from "@shared/teamDisplay";
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

export async function ensureTelegramTeamTranslations(names: string[]): Promise<void> {
  const unique = Array.from(new Set(names.map(name => name.trim()).filter(name => {
    return Boolean(name) && localizeTeamName(name) === name && isEnglishTeamName(name);
  }))).slice(0, MAX_NAMES_PER_REQUEST);
  if (!unique.length) return;
  const db = await getDb();
  if (!db) return;
  const stored = await db.select().from(teamNameTranslations).where(inArray(teamNameTranslations.englishName, unique));
  const storedNames = new Set(stored.map(row => row.englishName));
  for (const row of stored) registerRuntimeTeamTranslation(row.englishName, row.traditionalName);
  const pending = unique.filter(name => !storedNames.has(name));
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
