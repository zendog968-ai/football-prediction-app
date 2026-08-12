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

const assetPath = "/manus-storage/model_performance_dashboard_772ed8c9.json";
let cachedOverview: PerformanceOverview | null = null;

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

export async function getPerformanceOverview(request: Request): Promise<PerformanceOverview> {
  if (cachedOverview) return cachedOverview;
  const response = await fetch(`${getOrigin(request)}${assetPath}`);
  if (!response.ok) throw new Error(`績效資料載入失敗（${response.status}）。`);
  const payload = await response.json() as PerformanceOverview;
  if (!hasValidPerformanceOverview(payload)) throw new Error("績效資料格式驗證失敗。");
  cachedOverview = payload;
  return payload;
}
