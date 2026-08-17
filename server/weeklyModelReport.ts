import type { Request, Response } from "express";
import { and, desc, eq, gte, lt } from "drizzle-orm";
import { researchSettlements, weeklyModelReportJobs, weeklyModelReports } from "../drizzle/schema";
import { ENV } from "./_core/env";
import { sdk } from "./_core/sdk";
import { getDb } from "./db";
import { deliverWeeklyModelHealthReport } from "./telegramResearch";

type FeatureSnapshot = {
  xg_source_available?: boolean | null;
  market_implied_home?: number | null;
  home_rest_days?: number | null;
  away_rest_days?: number | null;
};

export type WeeklyMetrics = {
  settledMarkets: number;
  favorableMarkets: number;
  winnerMarkets: number;
  favorableWinnerMarkets: number;
  featureSnapshots: number;
  xgMissingSnapshots: number;
  oddsCoveredSnapshots: number;
  restMissingSnapshots: number;
};

function percent(numerator: number, denominator: number): string {
  return denominator > 0 ? `${(numerator / denominator * 100).toFixed(1)}%` : "—";
}

export function summarizeWeeklyModelHealth(metrics: WeeklyMetrics): { driftStatus: "insufficient" | "stable" | "watch"; content: string } {
  const outcomeRate = metrics.favorableMarkets / Math.max(metrics.settledMarkets, 1);
  const xgMissingRate = metrics.xgMissingSnapshots / Math.max(metrics.featureSnapshots, 1);
  const lowSample = metrics.settledMarkets < 20 || metrics.featureSnapshots < 10;
  const driftStatus = lowSample ? "insufficient" : xgMissingRate > 0.5 || outcomeRate < 0.35 ? "watch" : "stable";
  const statusText = driftStatus === "stable" ? "穩定：目前未見明顯資料覆蓋警訊。" : driftStatus === "watch" ? "留意：特徵缺失或已結算市場結果偏離，需要持續追蹤。" : "樣本不足：僅作資料品質監測，不應解讀為模型長期表現。";
  return {
    driftStatus,
    content: [
      "📊 <b>Aurelia 每週模型健康報告</b>",
      "──────────────────",
      `【已結算市場】${metrics.settledMarkets} 項｜有利結果 ${percent(metrics.favorableMarkets, metrics.settledMarkets)}`,
      `【主客和研究】${metrics.winnerMarkets} 項｜有利結果 ${percent(metrics.favorableWinnerMarkets, metrics.winnerMarkets)}`,
      `【特徵快照】${metrics.featureSnapshots} 筆｜xG缺失 ${percent(metrics.xgMissingSnapshots, metrics.featureSnapshots)}`,
      `【盤口覆蓋】去水1X2可用 ${percent(metrics.oddsCoveredSnapshots, metrics.featureSnapshots)}｜休養日缺失 ${percent(metrics.restMissingSnapshots, metrics.featureSnapshots)}`,
      `【漂移判讀】${statusText}`,
      "註：本報告用於模型與資料品質監測，非投注或資金建議。",
    ].join("\n"),
  };
}

async function getFeatureSnapshots(periodStart: Date, periodEnd: Date): Promise<FeatureSnapshot[]> {
  if (!ENV.supabaseUrl || !ENV.supabaseSecretKey) return [];
  const query = new URLSearchParams({
    select: "xg_source_available,market_implied_home,home_rest_days,away_rest_days",
    order: "generated_at.desc",
  });
  query.set("and", `(generated_at.gte.${periodStart.toISOString()},generated_at.lt.${periodEnd.toISOString()})`);
  const response = await fetch(`${ENV.supabaseUrl}/rest/v1/model_feature_snapshots?${query.toString()}`, {
    headers: { apikey: ENV.supabaseSecretKey, Authorization: `Bearer ${ENV.supabaseSecretKey}` },
  });
  if (!response.ok) throw new Error(`特徵快照查詢失敗（${response.status}）。`);
  const payload = await response.json();
  return Array.isArray(payload) ? payload as FeatureSnapshot[] : [];
}

export async function generateWeeklyModelReport(now = new Date()): Promise<{ reportId: number; content: string; metrics: WeeklyMetrics }> {
  const db = await getDb();
  if (!db) throw new Error("週報資料庫暫時無法使用。");
  const weekday = (now.getUTCDay() + 6) % 7;
  const periodEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - weekday));
  const periodStart = new Date(periodEnd.getTime() - 7 * 86_400_000);
  const settlements = await db.select().from(researchSettlements).where(and(gte(researchSettlements.settledAt, periodStart), lt(researchSettlements.settledAt, periodEnd)));
  const features = await getFeatureSnapshots(periodStart, periodEnd);
  const settled = settlements.filter(item => item.outcome !== "pending" && item.outcome !== "void");
  const winners = settled.filter(item => item.marketName === "Match Winner");
  const favorable = (items: typeof settled) => items.filter(item => item.outcome === "win" || item.outcome === "half_win").length;
  const metrics: WeeklyMetrics = {
    settledMarkets: settled.length,
    favorableMarkets: favorable(settled),
    winnerMarkets: winners.length,
    favorableWinnerMarkets: favorable(winners),
    featureSnapshots: features.length,
    xgMissingSnapshots: features.filter(item => item.xg_source_available !== true).length,
    oddsCoveredSnapshots: features.filter(item => Number.isFinite(Number(item.market_implied_home))).length,
    restMissingSnapshots: features.filter(item => !Number.isFinite(Number(item.home_rest_days)) || !Number.isFinite(Number(item.away_rest_days))).length,
  };
  const summary = summarizeWeeklyModelHealth(metrics);
  const [existing] = await db.select().from(weeklyModelReports).where(and(eq(weeklyModelReports.periodStart, periodStart), eq(weeklyModelReports.periodEnd, periodEnd))).limit(1);
  const reportId = existing?.id ?? (await db.insert(weeklyModelReports).values({ periodStart, periodEnd, ...metrics, driftStatus: summary.driftStatus, content: summary.content }).$returningId())[0]?.id;
  if (!reportId) throw new Error("無法建立週報稽核列。");
  return { reportId, content: summary.content, metrics };
}

export async function handleScheduledWeeklyModelReport(req: Request, res: Response): Promise<void> {
  let taskUid: string | undefined;
  try {
    const user = await sdk.authenticateRequest(req);
    if (!user.isCron || !user.taskUid) {
      res.status(403).json({ error: "cron-only" });
      return;
    }
    taskUid = user.taskUid;
    const db = await getDb();
    if (!db) throw new Error("週報資料庫暫時無法使用。");
    const job = (await db.select().from(weeklyModelReportJobs).where(eq(weeklyModelReportJobs.scheduleCronTaskUid, taskUid)).limit(1))[0];
    if (!job) {
      res.json({ ok: true, skipped: "orphan" });
      return;
    }
    await db.update(weeklyModelReportJobs).set({ lastStartedAt: new Date(), lastError: null }).where(eq(weeklyModelReportJobs.id, job.id));
    const report = await generateWeeklyModelReport();
    const delivery = await deliverWeeklyModelHealthReport(report.content);
    await db.update(weeklyModelReports).set({ deliveryStatus: delivery.delivered === delivery.recipients ? "sent" : delivery.delivered ? "partial" : "failed", sentAt: new Date() }).where(eq(weeklyModelReports.id, report.reportId));
    await db.update(weeklyModelReportJobs).set({ lastCompletedAt: new Date(), lastReportId: report.reportId, lastError: null }).where(eq(weeklyModelReportJobs.id, job.id));
    res.json({ ok: true, reportId: report.reportId, ...report.metrics, telegram: delivery });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    const db = await getDb().catch(() => null);
    if (db && taskUid) await db.update(weeklyModelReportJobs).set({ lastError: detail.slice(0, 4000) }).where(eq(weeklyModelReportJobs.scheduleCronTaskUid, taskUid)).catch(() => undefined);
    res.status(500).json({ error: detail, timestamp: new Date().toISOString(), context: { taskUid} });
  }
}
