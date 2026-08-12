import type { Request } from "express";

export type PerformanceOverview = {
  summary: {
    validationMatches: number;
    accuracy: number;
    logLoss: number;
    folds: number;
    validationStart: string;
    validationEnd: string;
  };
  foldMetrics: Array<{ fold: number; accuracy: number; logLoss: number; validationRows: number; validationStart: string; validationEnd: string }>;
  confusionMatrix: { labels: string[]; rows: Array<{ actual: string; values: number[] }> };
  calibration: Array<{ code: string; label: string; points: Array<{ bin: number; predicted: number; observed: number; count: number }> }>;
  classDistribution: Array<{ code: string; label: string; actualRate: number; meanPredictedRate: number }>;
  method: string;
};

export type PerformanceFilterInput = { leagueCode?: string; season?: string; outcome?: string };
export type PerformanceFilters = {
  leagues: Array<{ code: string; label: string }>;
  seasons: Array<{ code: string; label: string }>;
  outcomes: Array<{ code: string; label: string }>;
};

type PerformancePayload = { filters: PerformanceFilters; segments: Record<string, Omit<PerformanceOverview, "method">>; method: string };
export type FilteredPerformanceOverview = PerformanceOverview & { filters: PerformanceFilters; activeFilters: Required<PerformanceFilterInput> };

const assetPath = "/manus-storage/model_performance_filters_85bb0b9d.json";
let cachedPayload: PerformancePayload | null = null;

function getOrigin(request: Request) {
  const forwardedProtocol = request.get("x-forwarded-proto")?.split(",")[0];
  const protocol = forwardedProtocol || request.protocol || "http";
  const host = request.get("host");
  if (!host) throw new Error("無法建立績效資料下載網址。");
  return `${protocol}://${host}`;
}

export function hasValidPerformanceOverview(value: PerformanceOverview) {
  const summaryOk = Number.isFinite(value.summary.accuracy) && value.summary.accuracy >= 0 && value.summary.accuracy <= 1 &&
    Number.isFinite(value.summary.logLoss) && value.summary.logLoss > 0 && value.summary.validationMatches > 0;
  const matrixOk = value.confusionMatrix.rows.length === 3 && value.confusionMatrix.rows.every(row => row.values.length === 3 && row.values.every(cell => Number.isInteger(cell) && cell >= 0));
  const calibrationOk = value.calibration.length === 3 && value.calibration.every(series => series.points.every(point => point.predicted >= 0 && point.predicted <= 1 && point.observed >= 0 && point.observed <= 1 && point.count > 0));
  return summaryOk && matrixOk && calibrationOk;
}

export async function getPerformanceOverview(request: Request, filter: PerformanceFilterInput = {}): Promise<FilteredPerformanceOverview> {
  const activeFilters = { leagueCode: filter.leagueCode || "all", season: filter.season || "all", outcome: filter.outcome || "all" };
  if (!cachedPayload) {
  const response = await fetch(`${getOrigin(request)}${assetPath}`);
  if (!response.ok) throw new Error(`績效資料載入失敗（${response.status}）。`);
    cachedPayload = await response.json() as PerformancePayload;
  }
  const key = `${activeFilters.leagueCode}|${activeFilters.season}|${activeFilters.outcome}`;
  const segment = cachedPayload.segments[key];
  if (!segment || !hasValidPerformanceOverview({ ...segment, method: cachedPayload.method })) throw new Error("績效資料格式驗證失敗或目前篩選沒有可用樣本。");
  return { ...segment, method: cachedPayload.method, filters: cachedPayload.filters, activeFilters };
}
