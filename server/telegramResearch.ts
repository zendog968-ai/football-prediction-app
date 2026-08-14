import { timingSafeEqual } from "node:crypto";
import type { Request, Response } from "express";
import { and, desc, eq, gte, inArray } from "drizzle-orm";
import { parse as parseCookie } from "cookie";
import { COOKIE_NAME } from "@shared/const";
import {
  oddsSnapshots,
  researchDigests,
  researchScheduleJobs,
  researchSettlements,
  telegramSubscriptions,
} from "../drizzle/schema";
import { getDb } from "./db";
import { ENV } from "./_core/env";
import { createHeartbeatJob, updateHeartbeatJob } from "./_core/heartbeat";
import { sdk } from "./_core/sdk";
import { getPrediction, getTeams, type PredictionResult } from "./prediction";

export type ResearchWindow = "day" | "evening" | "settlement";
export type ScheduleKind = "settlement" | "day_digest" | "evening_digest";

type ApiFootballOddsValue = { value?: string; odd?: string };
type ApiFootballOddsResponse = {
  response?: Array<{
    fixture?: { id?: number; date?: string };
    league?: { id?: number; season?: number };
    update?: string;
    bookmakers?: Array<{
      id?: number;
      name?: string;
      bets?: Array<{ name?: string; values?: ApiFootballOddsValue[] }>;
    }>;
  }>;
  errors?: Record<string, unknown> | unknown[];
};

type ApiFootballFixtureResponse = {
  response?: Array<{
    fixture?: { id?: number; date?: string; status?: { short?: string } };
    teams?: { home?: { name?: string }; away?: { name?: string } };
    goals?: { home?: number | null; away?: number | null };
  }>;
};

type ApiFootballStatus = {
  response?: { subscription?: { active?: boolean; plan?: string }; requests?: { limit_day?: number; current?: number } };
  errors?: Record<string, unknown> | unknown[];
};

type TelegramStatusSnapshot = {
  subscriptionActive: boolean;
  scheduleCount: number;
  enabledScheduleCount: number;
  apiPlan: string | null;
  apiActive: boolean | null;
  apiUsed: number | null;
  apiLimit: number | null;
  apiError: string | null;
};

type MarketContext = {
  marketName: string;
  selection: string;
  decimalOdds: number;
  capturedAt: Date;
  openingSelection?: string;
  openingOdds?: number;
  openingCapturedAt?: Date;
};

type Candidate = {
  fixtureId: number;
  leagueCode: string;
  homeTeam: string;
  awayTeam: string;
  kickoffAt: Date;
  prediction: PredictionResult;
  marketContext: MarketContext[];
};

const LEAGUES: Record<string, { apiLeagueId: number; season: number }> = {
  BRA1: { apiLeagueId: 71, season: 2026 },
  EPL: { apiLeagueId: 39, season: 2026 },
  LL: { apiLeagueId: 140, season: 2026 },
  BL: { apiLeagueId: 78, season: 2026 },
  SA: { apiLeagueId: 135, season: 2026 },
  L1: { apiLeagueId: 61, season: 2026 },
  MLS: { apiLeagueId: 253, season: 2026 },
  J1: { apiLeagueId: 98, season: 2026 },
  FIN1: { apiLeagueId: 244, season: 2026 },
  KOR1: { apiLeagueId: 292, season: 2026 },
  POR1: { apiLeagueId: 94, season: 2026 },
  MEX1: { apiLeagueId: 262, season: 2026 },
  AUS1: { apiLeagueId: 188, season: 2026 },
  UEL: { apiLeagueId: 3, season: 2026 },
  SUD: { apiLeagueId: 11, season: 2026 },
  LCUP: { apiLeagueId: 772, season: 2026 },
};

export const RESEARCH_SCHEDULES: Array<{ kind: ScheduleKind; cron: string; path: string; description: string }> = [
  { kind: "settlement", cron: "0 30 2 * * *", path: "/api/scheduled/research-settlement", description: "每日10:30香港時間研究統計複盤" },
  { kind: "day_digest", cron: "0 0 3 * * *", path: "/api/scheduled/research-day", description: "每日11:00香港時間日間研究摘要" },
  { kind: "evening_digest", cron: "0 30 10 * * *", path: "/api/scheduled/research-evening", description: "每日18:30香港時間晚間研究摘要" },
];

function requireSecret(value: string, label: string): string {
  if (!value) throw new Error(`${label}尚未設定。`);
  return value;
}

function originFromRequest(request: Request): string {
  const protocol = request.get("x-forwarded-proto")?.split(",")[0] || request.protocol || "https";
  const host = request.get("host");
  if (!host) throw new Error("無法建立Telegram webhook網址。");
  return `${protocol}://${host}`;
}

function isSameSecret(actual: string, expected: string): boolean {
  const actualBytes = Buffer.from(actual);
  const expectedBytes = Buffer.from(expected);
  return actualBytes.length === expectedBytes.length && timingSafeEqual(actualBytes, expectedBytes);
}

function normalizeTeam(value: string): string {
  return value.trim().toLocaleLowerCase().replace(/[.\-']/g, " ").replace(/\s+/g, " ");
}

function parseLine(value: string): string | null {
  const match = value.match(/([+-]?\d+(?:\.\d+)?)/);
  return match?.[1] ?? null;
}

function hasRelevantMarket(name: string): boolean {
  return name === "Asian Handicap" || name === "Goals Over/Under";
}

function apiErrorCount(payload: { errors?: Record<string, unknown> | unknown[] }): number {
  const errors = payload.errors ?? {};
  return Array.isArray(errors) ? errors.length : Object.keys(errors).length;
}

async function apiFootball<T>(path: string): Promise<T> {
  const key = requireSecret(ENV.apiFootballKey, "API-Football Key");
  const response = await fetch(`https://v3.football.api-sports.io${path}`, {
    headers: { "x-apisports-key": key },
  });
  if (!response.ok) throw new Error(`API-Football請求失敗（${response.status}）。`);
  return response.json() as Promise<T>;
}

export async function verifyApiFootballReadiness(): Promise<void> {
  const status = await apiFootball<ApiFootballStatus>("/status");
  if (apiErrorCount(status) > 0 || status.response?.subscription?.active !== true || (status.response?.requests?.limit_day ?? 0) < 1000) {
    throw new Error("API-Football帳戶未通過授權或額度健康檢查；研究摘要已安全停止。");
  }
  const mls = LEAGUES.MLS;
  const mlsOdds = await apiFootball<ApiFootballOddsResponse>(`/odds?league=${mls.apiLeagueId}&season=${mls.season}`);
  if (apiErrorCount(mlsOdds) > 0 || !Array.isArray(mlsOdds.response) || mlsOdds.response.length === 0) {
    throw new Error("API-Football未提供2026 MLS盤口覆蓋；研究摘要已安全停止。");
  }
}

export function formatTelegramStatus(snapshot: TelegramStatusSnapshot): string {
  const subscription = snapshot.subscriptionActive ? "已啟用" : "已停止";
  const schedule = `${snapshot.enabledScheduleCount}/${snapshot.scheduleCount} 個任務啟用`;
  const apiUsage = snapshot.apiError
    ? `暫時無法讀取（${snapshot.apiError}）`
    : snapshot.apiLimit === null || snapshot.apiUsed === null
      ? "資料不足"
      : `${Math.max(0, snapshot.apiLimit - snapshot.apiUsed)}/${snapshot.apiLimit} 次可用`;
  const plan = snapshot.apiPlan ?? "未提供";
  const apiStatus = snapshot.apiActive === true ? "正常" : snapshot.apiActive === false ? "未啟用" : "未知";
  return [
    "Aurelia Football｜系統狀態",
    "",
    `通知訂閱：${subscription}`,
    `Heartbeat排程：${schedule}（10:30／11:00／18:30 香港時間）`,
    `API-Football：${apiStatus}｜方案：${plan}`,
    `今日API額度：${apiUsage}`,
    "",
    "所有通知只供模型與戰術研究，並非投注或資金建議。傳送 /stop 可取消訂閱。",
  ].join("\n");
}

export function normalizeTelegramCommand(text: string | undefined): string | undefined {
  return text?.trim().toLowerCase().split(/\s+/)[0]?.replace(/@[a-z0-9_]+$/i, "");
}

async function telegramStatusForChat(chatId: string): Promise<string> {
  const db = await getDb();
  if (!db) throw new Error("資料庫暫時無法使用。");
  const [subscription, schedules] = await Promise.all([
    db.select().from(telegramSubscriptions).where(eq(telegramSubscriptions.chatId, chatId)).limit(1),
    db.select().from(researchScheduleJobs),
  ]);
  let status: ApiFootballStatus | null = null;
  let apiError: string | null = null;
  try {
    status = await apiFootball<ApiFootballStatus>("/status");
    if (apiErrorCount(status) > 0) apiError = "供應商回傳錯誤";
  } catch (error) {
    apiError = error instanceof Error ? error.message : "連線失敗";
  }
  return formatTelegramStatus({
    subscriptionActive: subscription[0]?.isActive === true,
    scheduleCount: schedules.length,
    enabledScheduleCount: schedules.filter(schedule => schedule.isEnabled).length,
    apiPlan: status?.response?.subscription?.plan ?? null,
    apiActive: status?.response?.subscription?.active ?? null,
    apiUsed: status?.response?.requests?.current ?? null,
    apiLimit: status?.response?.requests?.limit_day ?? null,
    apiError,
  });
}

async function sendTelegramMessage(chatId: string, text: string): Promise<void> {
  const token = requireSecret(ENV.telegramBotToken, "Telegram Bot Token");
  const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
  });
  if (!response.ok) throw new Error(`Telegram訊息送出失敗（${response.status}）。`);
}

async function getSubscriptionChatIds(): Promise<string[]> {
  const db = await getDb();
  if (!db) throw new Error("資料庫暫時無法使用。");
  const rows = await db.select({ chatId: telegramSubscriptions.chatId })
    .from(telegramSubscriptions)
    .where(eq(telegramSubscriptions.isActive, true));
  return rows.map(row => row.chatId);
}

async function deliverDigest(digestId: number, content: string): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("資料庫暫時無法使用。");
  const chatIds = await getSubscriptionChatIds();
  if (chatIds.length === 0) {
    await db.update(researchDigests).set({ deliveryStatus: "sent", sentAt: new Date() }).where(eq(researchDigests.id, digestId));
    return;
  }
  const results = await Promise.allSettled(chatIds.map(chatId => sendTelegramMessage(chatId, content)));
  const failed = results.filter(result => result.status === "rejected");
  await db.update(researchDigests).set({
    deliveryStatus: failed.length === 0 ? "sent" : failed.length === chatIds.length ? "failed" : "partial",
    deliveryError: failed.map(item => String((item as PromiseRejectedResult).reason)).join(" | ").slice(0, 4000) || null,
    sentAt: new Date(),
  }).where(eq(researchDigests.id, digestId));
  if (failed.length === chatIds.length) throw new Error("所有Telegram研究訊息均未能送達。");
}

async function fixtureDetails(fixtureId: number): Promise<{ homeTeam: string; awayTeam: string; kickoffAt: Date; status: string; homeGoals: number | null; awayGoals: number | null } | null> {
  const payload = await apiFootball<ApiFootballFixtureResponse>(`/fixtures?id=${fixtureId}`);
  const row = payload.response?.[0];
  const homeTeam = row?.teams?.home?.name?.trim();
  const awayTeam = row?.teams?.away?.name?.trim();
  const date = row?.fixture?.date;
  if (!homeTeam || !awayTeam || !date) return null;
  return {
    homeTeam,
    awayTeam,
    kickoffAt: new Date(date),
    status: row.fixture?.status?.short || "",
    homeGoals: Number.isInteger(row.goals?.home) ? row.goals!.home! : null,
    awayGoals: Number.isInteger(row.goals?.away) ? row.goals!.away! : null,
  };
}

async function captureLeagueOdds(leagueCode: string): Promise<Array<{ fixtureId: number; kickoffAt: Date }>> {
  const config = LEAGUES[leagueCode];
  if (!config) return [];
  const db = await getDb();
  if (!db) throw new Error("資料庫暫時無法使用。");
  const payload = await apiFootball<ApiFootballOddsResponse>(`/odds?league=${config.apiLeagueId}&season=${config.season}`);
  if (apiErrorCount(payload) > 0) throw new Error(`API-Football回傳盤口錯誤：${JSON.stringify(payload.errors).slice(0, 800)}`);
  const capturedAt = new Date();
  const fixtures: Array<{ fixtureId: number; kickoffAt: Date }> = [];
  for (const row of payload.response ?? []) {
    const fixtureId = row.fixture?.id;
    const kickoff = row.fixture?.date ? new Date(row.fixture.date) : null;
    if (!fixtureId || !kickoff || Number.isNaN(kickoff.getTime())) continue;
    fixtures.push({ fixtureId, kickoffAt: kickoff });
    for (const bookmaker of row.bookmakers ?? []) {
      if (!bookmaker.id || !bookmaker.name) continue;
      for (const bet of bookmaker.bets ?? []) {
        if (!bet.name || !hasRelevantMarket(bet.name)) continue;
        for (const value of bet.values ?? []) {
          const odds = Number(value.odd);
          if (!value.value || !Number.isFinite(odds) || odds <= 1) continue;
          await db.insert(oddsSnapshots).values({
            apiFixtureId: fixtureId,
            leagueCode,
            apiLeagueId: config.apiLeagueId,
            fixtureKickoffAt: kickoff,
            bookmakerId: bookmaker.id,
            bookmakerName: bookmaker.name,
            marketName: bet.name,
            selection: value.value,
            handicapOrTotal: parseLine(value.value),
            decimalOdds: odds.toFixed(3),
            sourceUpdatedAt: row.update ? new Date(row.update) : null,
            capturedAt,
          }).onDuplicateKeyUpdate({ set: { decimalOdds: odds.toFixed(3), sourceUpdatedAt: row.update ? new Date(row.update) : null } });
        }
      }
    }
  }
  return fixtures;
}

async function resolveCandidate(request: Request, leagueCode: string, fixtureId: number): Promise<Candidate | null> {
  const details = await fixtureDetails(fixtureId);
  if (!details || details.kickoffAt <= new Date() || !["NS", "TBD"].includes(details.status)) return null;
  const modelTeams = await getTeams(request, leagueCode);
  const home = modelTeams.find(team => normalizeTeam(team) === normalizeTeam(details.homeTeam));
  const away = modelTeams.find(team => normalizeTeam(team) === normalizeTeam(details.awayTeam));
  if (!home || !away) return null;
  const prediction = await getPrediction(request, { leagueCode, homeTeam: home, awayTeam: away });
  const db = await getDb();
  if (!db) throw new Error("資料庫暫時無法使用。");
  const snapshotRows = await db.select().from(oddsSnapshots).where(and(
    eq(oddsSnapshots.apiFixtureId, fixtureId),
    inArray(oddsSnapshots.marketName, ["Asian Handicap", "Goals Over/Under"]),
  )).orderBy(desc(oddsSnapshots.capturedAt));
  const marketContext = ["Asian Handicap", "Goals Over/Under"].flatMap<MarketContext>(marketName => {
    const latest = snapshotRows.find(snapshot => snapshot.marketName === marketName);
    if (!latest) return [];
    const sameMarketBookmaker = snapshotRows.filter(snapshot => snapshot.marketName === marketName && snapshot.bookmakerId === latest.bookmakerId);
    const opening = sameMarketBookmaker.at(-1);
    return [{
      marketName,
      selection: latest.selection,
      decimalOdds: Number(latest.decimalOdds),
      capturedAt: latest.capturedAt,
      ...(opening && opening.capturedAt.getTime() !== latest.capturedAt.getTime() ? {
        openingSelection: opening.selection,
        openingOdds: Number(opening.decimalOdds),
        openingCapturedAt: opening.capturedAt,
      } : {}),
    }];
  });
  return { fixtureId, leagueCode, homeTeam: home, awayTeam: away, kickoffAt: details.kickoffAt, prediction, marketContext };
}

export function describeMarketMovement(item: MarketContext): string {
  if (!item.openingSelection || !item.openingOdds) return "初盤基準建立中";
  return `初盤 ${item.openingSelection} @${item.openingOdds.toFixed(2)} → 最新 ${item.selection} @${item.decimalOdds.toFixed(2)}`;
}

function formatCandidate(candidate: Candidate): string {
  const lean = candidate.prediction.lean;
  const risk = lean.risk_level === "low" ? "低" : lean.risk_level === "medium" ? "中等" : "高";
  const reasons = lean.reasons.slice(0, 2).join(" ");
  const limitation = lean.limitations[0] ? ` 限制：${lean.limitations[0]}` : "";
  const markets = candidate.marketContext.length > 0
    ? `盤口快照：${candidate.marketContext.map(item => `${item.marketName} ${describeMarketMovement(item)}`).join("；")}。`
    : "盤口快照：目前沒有可用的亞洲讓球／大小球資料。";
  return [
    `${candidate.homeTeam} vs ${candidate.awayTeam}`,
    `開賽：${candidate.kickoffAt.toLocaleString("zh-HK", { timeZone: "Asia/Hong_Kong", hour12: false })}`,
    `數據傾向：${lean.label}（${(lean.probability * 100).toFixed(1)}%）；風險：${risk}。`,
    markets,
    `${reasons}${limitation}`,
  ].join("\n");
}

export async function runResearchDigest(request: Request, window: "day" | "evening"): Promise<{ digestId: number; signalCount: number }> {
  const now = new Date();
  await verifyApiFootballReadiness();
  const allFixtures: Array<{ leagueCode: string; fixtureId: number }> = [];
  const captureErrors: string[] = [];
  for (const leagueCode of Object.keys(LEAGUES)) {
    try {
      const fixtures = await captureLeagueOdds(leagueCode);
      allFixtures.push(...fixtures.map(item => ({ leagueCode, fixtureId: item.fixtureId })));
    } catch (error) {
      captureErrors.push(`${leagueCode}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (captureErrors.length > 0 || allFixtures.length === 0) {
    throw new Error(`盤口資料品質閘門失敗，未產生或傳送研究摘要：${captureErrors.join(" | ") || "沒有可用fixture"}`);
  }
  const candidates: Candidate[] = [];
  for (const item of allFixtures.slice(0, 16)) {
    try {
      const candidate = await resolveCandidate(request, item.leagueCode, item.fixtureId);
      if (candidate) candidates.push(candidate);
    } catch {
      // Team naming / individual inference failures are intentionally skipped, not inferred.
    }
  }
  const selected = candidates
    .filter(candidate => candidate.prediction.lean.risk_level !== "high")
    .sort((a, b) => b.prediction.lean.probability - a.prediction.lean.probability)
    .slice(0, 2);
  const title = window === "day" ? "日間" : "晚間／歐洲時段";
  const content = selected.length > 0
    ? `Aurelia Football｜${title}研究摘要\n\n${selected.map((candidate, index) => `${index + 1}. ${formatCandidate(candidate)}`).join("\n\n")}\n\n此訊息只供模型效能與戰術研究，並非投注或資金建議。`
    : `Aurelia Football｜${title}研究摘要\n\n今日此時段無符合研究品質條件的賽事，建議休息。\n\n此訊息只供模型效能與戰術研究，並非投注或資金建議。`;
  const db = await getDb();
  if (!db) throw new Error("資料庫暫時無法使用。");
  const inserted = await db.insert(researchDigests).values({ window, asOf: now, content, signalCount: selected.length });
  const digestId = Number(inserted[0].insertId);
  const settlementRows = selected.flatMap(candidate => candidate.marketContext.map(market => ({
    digestId,
    apiFixtureId: candidate.fixtureId,
    marketName: market.marketName,
    selection: market.selection,
  })));
  if (settlementRows.length > 0) await db.insert(researchSettlements).values(settlementRows);
  await deliverDigest(digestId, content);
  return { digestId, signalCount: selected.length };
}

function splitAsianLine(line: number): number[] {
  const absolute = Math.abs(line);
  const quarter = Math.round((absolute - Math.floor(absolute)) * 100) / 100;
  if (quarter !== 0.25 && quarter !== 0.75) return [line];
  const low = Math.floor(absolute * 2) / 2;
  const high = Math.ceil(absolute * 2) / 2;
  return line >= 0 ? [low, high] : [-low, -high];
}

export function settlementForScores(marketName: string, selection: string, homeGoals: number, awayGoals: number): typeof researchSettlements.$inferInsert.outcome {
  const asian = selection.match(/^(Home|Away)\s+([+-]?\d+(?:\.\d+)?)$/i);
  const total = selection.match(/^(Over|Under)\s+(\d+(?:\.\d+)?)$/i);
  if (marketName !== "Asian Handicap" && marketName !== "Goals Over/Under") return "void";
  if ((marketName === "Asian Handicap" && !asian) || (marketName === "Goals Over/Under" && !total)) return "void";
  const side = asian?.[1]?.toLowerCase();
  const line = Number(asian?.[2] ?? total?.[2]);
  if (!Number.isFinite(line)) return "void";
  const base = asian
    ? (side === "home" ? homeGoals - awayGoals : awayGoals - homeGoals)
    : (total?.[1]?.toLowerCase() === "over" ? homeGoals + awayGoals : -(homeGoals + awayGoals));
  const outcomes = splitAsianLine(line).map(part => {
    const value = asian ? base + part : (total?.[1]?.toLowerCase() === "over" ? base - part : base + part);
    return value > 0 ? "win" : value < 0 ? "loss" : "push";
  });
  if (outcomes.every(outcome => outcome === "win")) return "win";
  if (outcomes.every(outcome => outcome === "loss")) return "loss";
  if (outcomes.every(outcome => outcome === "push")) return "push";
  if (outcomes.includes("win") && outcomes.includes("push")) return "half_win";
  if (outcomes.includes("loss") && outcomes.includes("push")) return "half_loss";
  return "void";
}

function accuracy(rows: Array<{ outcome: string }>): string {
  const resolved = rows.filter(row => !["pending", "void", "push"].includes(row.outcome));
  if (!resolved.length) return "資料不足";
  const units = resolved.reduce((total, row) => total + (row.outcome === "win" ? 1 : row.outcome === "half_win" ? 0.5 : row.outcome === "half_loss" ? -0.5 : -1), 0);
  return `${(units / resolved.length * 100 + 50).toFixed(1)}%`;
}

export async function runSettlementDigest(): Promise<{ digestId: number; settled: number }> {
  await verifyApiFootballReadiness();
  const db = await getDb();
  if (!db) throw new Error("資料庫暫時無法使用。");
  const pending = await db.select().from(researchSettlements).where(eq(researchSettlements.outcome, "pending")).limit(100);
  let settled = 0;
  for (const row of pending) {
    const details = await fixtureDetails(row.apiFixtureId);
    if (!details || !["FT", "AET", "PEN"].includes(details.status) || details.homeGoals === null || details.awayGoals === null) continue;
    const outcome = settlementForScores(row.marketName, row.selection, details.homeGoals, details.awayGoals);
    await db.update(researchSettlements).set({ homeGoals: details.homeGoals, awayGoals: details.awayGoals, outcome, settledAt: new Date(), sourcePayload: { status: details.status } }).where(eq(researchSettlements.id, row.id));
    settled += 1;
  }
  const [lastSevenDays, lastThirtyDays] = [new Date(Date.now() - 7 * 24 * 60 * 60_000), new Date(Date.now() - 30 * 24 * 60 * 60_000)];
  const [sevenRows, thirtyRows, allRows] = await Promise.all([
    db.select({ outcome: researchSettlements.outcome }).from(researchSettlements).where(gte(researchSettlements.settledAt, lastSevenDays)),
    db.select({ outcome: researchSettlements.outcome }).from(researchSettlements).where(gte(researchSettlements.settledAt, lastThirtyDays)),
    db.select({ outcome: researchSettlements.outcome }).from(researchSettlements),
  ]);
  const content = `Aurelia Football｜賽後研究統計\n\n近7日：${accuracy(sevenRows)}｜近30日：${accuracy(thirtyRows)}｜累積：${accuracy(allRows)}。\n\n只計入具備已驗證盤口線與最終賽果的資料；走盤與無法辨識的盤口不納入命中率。\n\n此訊息只供模型效能與戰術研究，並非投注或資金建議。`;
  const inserted = await db.insert(researchDigests).values({ window: "settlement", asOf: new Date(), content, signalCount: sevenRows.length });
  const digestId = Number(inserted[0].insertId);
  await deliverDigest(digestId, content);
  return { digestId, settled };
}

export async function handleTelegramWebhook(req: Request, res: Response): Promise<void> {
  const suppliedSecret = req.get("x-telegram-bot-api-secret-token") || "";
  const expectedSecret = requireSecret(ENV.telegramWebhookSecret, "Telegram Webhook Secret");
  if (!isSameSecret(suppliedSecret, expectedSecret)) {
    res.status(403).json({ error: "invalid webhook secret" });
    return;
  }
  const message = (req.body as { message?: { chat?: { id?: number | string }; from?: { first_name?: string; username?: string }; text?: string } }).message;
  const chatId = message?.chat?.id;
  const text = normalizeTelegramCommand(message?.text);
  if (!chatId || !text) {
    res.status(200).json({ ok: true, ignored: true });
    return;
  }
  const db = await getDb();
  if (!db) throw new Error("資料庫暫時無法使用。");
  const displayName = message.from?.username || message.from?.first_name || null;
  if (text === "/start") {
    await db.insert(telegramSubscriptions).values({ chatId: String(chatId), displayName, isActive: true, stoppedAt: null })
      .onDuplicateKeyUpdate({ set: { displayName, isActive: true, stoppedAt: null } });
    await sendTelegramMessage(String(chatId), "Aurelia Football研究通知已啟用。你會收到經資料品質檢核的研究摘要與賽後統計；回覆 /stop 可停止通知。所有內容僅供研究，並非投注或資金建議。");
  } else if (text === "/status") {
    await sendTelegramMessage(String(chatId), await telegramStatusForChat(String(chatId)));
  } else if (text === "/stop") {
    const existing = (await db.select().from(telegramSubscriptions).where(eq(telegramSubscriptions.chatId, String(chatId))).limit(1))[0];
    if (!existing) {
      await sendTelegramMessage(String(chatId), "你目前沒有啟用中的Aurelia Football研究通知。傳送 /start 可建立訂閱。");
    } else if (!existing.isActive) {
      await sendTelegramMessage(String(chatId), "Aurelia Football研究通知已是停止狀態。重新傳送 /start 可再次訂閱。");
    } else {
      await db.update(telegramSubscriptions).set({ isActive: false, stoppedAt: new Date() }).where(eq(telegramSubscriptions.chatId, String(chatId)));
      await sendTelegramMessage(String(chatId), "Aurelia Football研究通知已停止。重新傳送 /start 可再次訂閱。");
    }
  }
  res.status(200).json({ ok: true });
}

export async function configureTelegramWebhook(request: Request): Promise<{ webhookUrl: string }> {
  if (!ENV.isProduction) throw new Error("請先發布網站，才能設定可公開存取的Telegram webhook。");
  const token = requireSecret(ENV.telegramBotToken, "Telegram Bot Token");
  const webhookUrl = `${originFromRequest(request)}/api/integrations/telegram/webhook`;
  const response = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ url: webhookUrl, secret_token: requireSecret(ENV.telegramWebhookSecret, "Telegram Webhook Secret"), allowed_updates: ["message"] }),
  });
  if (!response.ok) throw new Error(`Telegram webhook設定失敗（${response.status}）。`);
  const payload = await response.json() as { ok?: boolean };
  if (!payload.ok) throw new Error("Telegram拒絕webhook設定。");
  return { webhookUrl };
}

export async function ensureResearchSchedules(request: Request): Promise<Array<{ kind: ScheduleKind; taskUid: string }>> {
  if (!ENV.isProduction) throw new Error("請先發布網站，才能建立正式Heartbeat排程。");
  await verifyApiFootballReadiness();
  const db = await getDb();
  if (!db) throw new Error("資料庫暫時無法使用。");
  const session = parseCookie(request.headers.cookie ?? "")[COOKIE_NAME] ?? "";
  const result: Array<{ kind: ScheduleKind; taskUid: string }> = [];
  for (const schedule of RESEARCH_SCHEDULES) {
    const existing = await db.select().from(researchScheduleJobs).where(eq(researchScheduleJobs.kind, schedule.kind)).limit(1);
    const row = existing[0];
    if (row?.scheduleCronTaskUid) {
      await updateHeartbeatJob(row.scheduleCronTaskUid, { cron: schedule.cron, path: schedule.path, description: schedule.description, enable: true }, session);
      await db.update(researchScheduleJobs).set({ cronExpression: schedule.cron, isEnabled: true, lastError: null }).where(eq(researchScheduleJobs.id, row.id));
      result.push({ kind: schedule.kind, taskUid: row.scheduleCronTaskUid });
      continue;
    }
    const job = await createHeartbeatJob({ name: `aurelia-research-${schedule.kind}`, cron: schedule.cron, path: schedule.path, description: schedule.description }, session);
    await db.insert(researchScheduleJobs).values({ kind: schedule.kind, scheduleCronTaskUid: job.taskUid, cronExpression: schedule.cron, isEnabled: true })
      .onDuplicateKeyUpdate({ set: { scheduleCronTaskUid: job.taskUid, cronExpression: schedule.cron, isEnabled: true, lastError: null } });
    result.push({ kind: schedule.kind, taskUid: job.taskUid });
  }
  return result;
}

export async function handleScheduledResearch(req: Request, res: Response, kind: ScheduleKind): Promise<void> {
  try {
    const user = await sdk.authenticateRequest(req);
    if (!user.isCron || !user.taskUid) {
      res.status(403).json({ error: "cron-only" });
      return;
    }
    const db = await getDb();
    if (!db) throw new Error("資料庫暫時無法使用。");
    const job = (await db.select().from(researchScheduleJobs).where(and(eq(researchScheduleJobs.scheduleCronTaskUid, user.taskUid), eq(researchScheduleJobs.kind, kind))).limit(1))[0];
    if (!job) {
      res.json({ ok: true, skipped: "orphan" });
      return;
    }
    await db.update(researchScheduleJobs).set({ lastStartedAt: new Date(), lastError: null }).where(eq(researchScheduleJobs.id, job.id));
    const outcome = kind === "settlement" ? await runSettlementDigest() : await runResearchDigest(req, kind === "day_digest" ? "day" : "evening");
    await db.update(researchScheduleJobs).set({ lastCompletedAt: new Date(), lastError: null }).where(eq(researchScheduleJobs.id, job.id));
    res.json({ ok: true, ...outcome });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    const db = await getDb().catch(() => null);
    if (db) {
      await db.update(researchScheduleJobs).set({ lastError: detail.slice(0, 4000) }).where(eq(researchScheduleJobs.kind, kind)).catch(() => undefined);
    }
    res.status(500).json({ error: detail, timestamp: new Date().toISOString(), context: { kind } });
  }
}

export async function getResearchNotificationStatus(): Promise<{ activeSubscribers: number; schedules: Array<{ kind: ScheduleKind; isEnabled: boolean; taskUid: string | null; lastError: string | null }> }> {
  const db = await getDb();
  if (!db) throw new Error("資料庫暫時無法使用。");
  const [subscriptions, schedules] = await Promise.all([
    db.select().from(telegramSubscriptions).where(eq(telegramSubscriptions.isActive, true)),
    db.select().from(researchScheduleJobs).orderBy(desc(researchScheduleJobs.id)),
  ]);
  return {
    activeSubscribers: subscriptions.length,
    schedules: schedules.map(schedule => ({ kind: schedule.kind, isEnabled: schedule.isEnabled, taskUid: schedule.scheduleCronTaskUid, lastError: schedule.lastError })),
  };
}
