import React, { useEffect, useState } from "react";

/** Optional diagnostics are display-only. Never substitute prior/model samples for actual history. */
export type ResearchFixture = {
  fixtureId: number;
  leagueName: string;
  eventTime: string;
  homeTeam: string;
  awayTeam: string;
  homeWin: number;
  draw: number;
  awayWin: number;
  predictedScore?: string | null;
  hasPrediction?: boolean;
  predictionUpdatedAt?: string | null;
  predictionAsOf?: string | null;
  researchSource?: string | null;
  dataQualityReason?: string | null;
  oddsStatus?: string | null;
  homeHistoryMatches?: number | null;
  awayHistoryMatches?: number | null;
  leagueHistoryMatches?: number | null;
  homeSampleMatches?: number | null;
  awaySampleMatches?: number | null;
  leagueSampleMatches?: number | null;
  diagnostics?: unknown;
  odds?: { home: number | null; draw: number | null; away: number | null; capturedAt: string | null } | null;
};

type DiagnosticFields = Partial<ResearchFixture>;
const HOUR = 3_600_000;
const explicitTimestamp = (value: unknown): value is string => typeof value === "string"
  && /(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value));
const validProbability = (value: unknown): value is number => typeof value === "number"
  && Number.isFinite(value) && value >= 0 && value <= 1;
const validOdds = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value > 1;

export function useResearchNow() {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);
  return now;
}

export function sampleCountLabel(value: unknown) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? `${value} 場` : "未提供";
}

export function formatResearchTimestamp(value: string | null | undefined) {
  if (!value) return "未提供";
  if (!explicitTimestamp(value)) return "無效或缺少時區";
  return `${new Intl.DateTimeFormat("zh-HK", {
    timeZone: "Asia/Hong_Kong", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(new Date(value))} HKT`;
}

export function predictionAgeLabel(value: string | null | undefined, now: number) {
  if (!value) return "未提供";
  if (!explicitTimestamp(value)) return "無效或缺少時區";
  const age = now - Date.parse(value);
  if (age < 0) return "時間在未來（無效）";
  if (age < 60_000) return "少於 1 分鐘";
  if (age < HOUR) return `${Math.floor(age / 60_000)} 分鐘`;
  if (age < 24 * HOUR) return `${Math.floor(age / HOUR)} 小時 ${Math.floor((age % HOUR) / 60_000)} 分鐘`;
  return `${Math.floor(age / (24 * HOUR))} 天 ${Math.floor((age % (24 * HOUR)) / HOUR)} 小時`;
}

function diagnosticRecord(item: DiagnosticFields): Record<string, unknown> {
  return item.diagnostics && typeof item.diagnostics === "object" && !Array.isArray(item.diagnostics)
    ? item.diagnostics as Record<string, unknown> : {};
}

export function actualHistoryCounts(item: DiagnosticFields) {
  const diagnostics = diagnosticRecord(item);
  const count = (field: "homeHistoryMatches" | "awayHistoryMatches" | "leagueHistoryMatches", legacy: string) => {
    if (item[field] !== undefined) return item[field];
    return diagnostics[field] ?? diagnostics[legacy];
  };
  return {
    home: count("homeHistoryMatches", "home_history_matches_used"),
    away: count("awayHistoryMatches", "away_history_matches_used"),
    league: count("leagueHistoryMatches", "league_history_matches_used"),
  };
}

const reasonLabels: Record<string, string> = {
  stale: "預測過期", stale_prediction: "預測過期", prediction_stale: "預測過期",
  invalid_prediction: "預測資料無效", invalid_probabilities: "機率資料無效",
  insufficient_samples: "歷史樣本不足", missing_prediction: "尚未提供預測",
  unsupported_source: "研究來源未核實", legacy_source: "舊版研究來源",
  missing: "未提供", unavailable: "未提供", pending: "待同步",
  stale_odds: "賠率快照過期", invalid_odds: "賠率資料無效",
  prediction_stale_or_insufficient: "預測過期或歷史樣本不足", no_prediction: "尚未提供預測",
  unverified_model_version: "模型版本未核實", invalid_probability: "機率資料無效",
  ok: "快取驗證通過（未校準研究）", verified: "來源已驗證", query_failed: "查詢失敗",
  partial_query: "查詢不完整", not_available: "未提供",
  available: "可用", fresh: "有效快照", partial: "資料不完整", invalid: "資料無效",
};

function safeDescription(value: string | null | undefined) {
  if (!value) return "未提供";
  // Do not repeat stored decision text or inherited calibration/market-fusion claims.
  if (/(?:\bEV\b|stake|kelly|高信心|高置信|注碼|投注建議|已校準|經校準|\bcalibrated\b|market.fused)/i.test(value)) return "描述含未核實決策宣稱，已隱藏";
  return reasonLabels[value] ? `${reasonLabels[value]}（${value}）` : value;
}

export function predictionDisplayState(item: ResearchFixture, now = Date.now()) {
  const reasons: string[] = [];
  if (item.hasPrediction !== true) reasons.push(item.hasPrediction === false ? "預測不可用（快取驗證未通過）" : "預測可用狀態未提供");
  if (item.dataQualityReason && item.dataQualityReason !== "ok") reasons.push(`資料品質未通過：${safeDescription(item.dataQualityReason)}`);
  if (![item.homeWin, item.draw, item.awayWin].every(validProbability)
    || Math.abs(item.homeWin + item.draw + item.awayWin - 1) >= 0.001) reasons.push("機率資料無效或不完整");
  if (!explicitTimestamp(item.predictionUpdatedAt)) reasons.push(item.predictionUpdatedAt ? "預測更新時間無效或缺少時區" : "預測更新時間未提供");
  else if (Date.parse(item.predictionUpdatedAt) > now) reasons.push("預測更新時間在未來");
  else if (now - Date.parse(item.predictionUpdatedAt) > 2 * HOUR) reasons.push("預測過期（更新超過 2 小時）");
  if (!explicitTimestamp(item.eventTime)) reasons.push("開賽時間無效或缺少時區");
  else if (Date.parse(item.eventTime) <= now) reasons.push("賽事已到開賽時間；不顯示賽前預測");
  else if (explicitTimestamp(item.predictionUpdatedAt) && Date.parse(item.predictionUpdatedAt) >= Date.parse(item.eventTime)) reasons.push("預測更新時間不早於開賽");
  return { available: reasons.length === 0, reason: reasons.join("；") };
}

export function oddsDisplayStatus(item: DiagnosticFields, now: number) {
  const odds = item.odds;
  const providerStatus = item.oddsStatus ? `；來源狀態：${item.oddsStatus === "stale" ? "賠率快照過期（stale）" : safeDescription(item.oddsStatus)}` : "；來源狀態未提供";
  if (!odds) return `未提供可用賠率${providerStatus}`;
  if (!explicitTimestamp(odds.capturedAt)) return `快照時間未提供或無效${providerStatus}`;
  const age = now - Date.parse(odds.capturedAt);
  if (age < 0) return `快照時間在未來（無效）${providerStatus}`;
  if (age > 30 * 60_000) return `快照過期（超過 30 分鐘）${providerStatus}`;
  const complete = [odds.home, odds.draw, odds.away].filter(validOdds).length;
  if (complete === 0) return `賠率資料無效或不完整${providerStatus}`;
  return `${complete === 3 ? "主／和／客有效快照" : "主／和／客資料不完整"}（${complete}/3）；擷取：${formatResearchTimestamp(odds.capturedAt)}；快照年齡：${predictionAgeLabel(odds.capturedAt, now)}${providerStatus}`;
}

export function MatchDiagnostics({ item, now = Date.now(), predictionState }: {
  item: DiagnosticFields;
  now?: number;
  predictionState?: ReturnType<typeof predictionDisplayState>;
}) {
  const counts = actualHistoryCounts(item);
  const diagnostics = diagnosticRecord(item);
  const asOf = item.predictionAsOf ?? diagnostics.prediction_as_of;
  const reason = item.dataQualityReason ?? (typeof diagnostics.dataQualityReason === "string" ? diagnostics.dataQualityReason : null);
  const hasModelSamples = [item.homeSampleMatches, item.awaySampleMatches, item.leagueSampleMatches].some(value => value != null);
  return <div className="mt-3 space-y-1.5 rounded-xl border border-white/10 bg-black/10 p-3 text-xs leading-5 text-slate-300" data-testid="match-diagnostics">
    <p>實際歷史樣本：主隊 {sampleCountLabel(counts.home)} · 客隊 {sampleCountLabel(counts.away)} · 聯賽 {sampleCountLabel(counts.league)}</p>
    {hasModelSamples && <p className="text-slate-400">模型有效樣本（不等同實際歷史）：主隊 {sampleCountLabel(item.homeSampleMatches)} · 客隊 {sampleCountLabel(item.awaySampleMatches)} · 聯賽 {sampleCountLabel(item.leagueSampleMatches)}</p>}
    <p>預測資料截點：{typeof asOf === "string" && asOf ? asOf : "未提供（不以更新時間代替）"}</p>
    <p>預測更新：{formatResearchTimestamp(item.predictionUpdatedAt)} · 更新年齡：{predictionAgeLabel(item.predictionUpdatedAt, now)}</p>
    {predictionState && <p className={predictionState.available ? "text-emerald-200" : "text-amber-100"}>預測狀態：{predictionState.available ? "可用（未校準研究）" : predictionState.reason}</p>}
    <p>資料品質原因：{reason ? safeDescription(reason) : "未提供（不推定資料完整）"}</p>
    <p>研究來源：{safeDescription(item.researchSource)}</p>
    <p>賠率狀態：{oddsDisplayStatus(item, now)}</p>
  </div>;
}

function OutcomeProbabilities({ item, now, bars = false }: { item: ResearchFixture; now: number; bars?: boolean }) {
  if (!predictionDisplayState(item, now).available) return <p className="mt-3 text-xs text-amber-100">機率與預測比分已隱藏，請查看資料狀態。</p>;
  const outcomes = [
    { label: "主勝", value: item.homeWin, color: "bg-emerald-400" },
    { label: "和局", value: item.draw, color: "bg-amber-300" },
    { label: "客勝", value: item.awayWin, color: "bg-slate-400" },
  ];
  return <div className={bars ? "mt-5 space-y-3" : "mt-4 grid grid-cols-3 gap-2 text-center text-xs"}>
    {outcomes.map(outcome => <div key={outcome.label} className={bars ? "" : "rounded-lg bg-white/5 py-2"}>
      <div className={bars ? "mb-1 flex justify-between text-xs" : "text-xs"}><span>{outcome.label} </span><span>{(outcome.value * 100).toFixed(1)}%</span></div>
      {bars && <div className="h-2 overflow-hidden rounded-full bg-white/10"><div className={`h-full rounded-full ${outcome.color}`} style={{ width: `${outcome.value * 100}%` }} /></div>}
    </div>)}
  </div>;
}

/** Pure reusable board. The routed page may pass its already-fetched/filtered fixtures. */
export default function MatchFeed({ fixtures, selectedFixtureId, onSelect, now: suppliedNow }: {
  fixtures: ResearchFixture[];
  selectedFixtureId?: number | null;
  onSelect?: (fixtureId: number) => void;
  now?: number;
}) {
  const clock = useResearchNow();
  const now = suppliedNow ?? clock;
  const [localSelectedId, setLocalSelectedId] = useState<number | null>(null);
  const selected = fixtures.find(item => item.fixtureId === (selectedFixtureId ?? localSelectedId)) ?? fixtures[0];
  return <div className="mt-6 grid gap-5 xl:grid-cols-[1.35fr_.65fr]" data-testid="research-match-feed">
    <div className="space-y-3">{fixtures.map(item => {
      const state = predictionDisplayState(item, now);
      return <article key={item.fixtureId} className={`rounded-2xl border p-4 ${selected?.fixtureId === item.fixtureId ? "border-emerald-300 bg-emerald-300/10" : "border-white/10 bg-white/[.035]"}`}>
        <button type="button" aria-pressed={selected?.fixtureId === item.fixtureId} onClick={() => { setLocalSelectedId(item.fixtureId); onSelect?.(item.fixtureId); }} className="w-full rounded-lg text-left outline-offset-4 focus-visible:outline focus-visible:outline-emerald-300">
          <div className="flex flex-wrap justify-between gap-2 text-[10px] font-bold text-slate-400"><span>{item.leagueName}</span><span>{formatResearchTimestamp(item.eventTime)}</span></div>
          <div className="mt-3 flex items-center justify-between gap-3"><span className="font-semibold">{item.homeTeam}</span><span className="rounded-lg bg-white/10 px-3 py-1 font-serif text-lg">{state.available ? item.predictedScore || "資料不足" : "不可用"}</span><span className="text-right font-semibold">{item.awayTeam}</span></div>
        </button>
        <OutcomeProbabilities item={item} now={now} />
        <MatchDiagnostics item={item} now={now} predictionState={state} />
        <p className="mt-3 text-xs text-slate-400">未校準研究 · 高信心篩選停用 · 投注建議停用</p>
      </article>;
    })}</div>
    <aside className="rounded-2xl border border-white/10 bg-white/[.035] p-5" aria-live="polite">
      {selected ? <>
        <div className="text-[10px] font-bold uppercase tracking-[.18em] text-emerald-300">Match details</div>
        <h3 className="mt-2 text-lg font-bold">{selected.homeTeam} vs {selected.awayTeam}</h3>
        <p className="mt-1 text-xs text-slate-400">{selected.leagueName} · {formatResearchTimestamp(selected.eventTime)}</p>
        <OutcomeProbabilities item={selected} now={now} bars />
        <MatchDiagnostics item={selected} now={now} predictionState={predictionDisplayState(selected, now)} />
        <p className="mt-5 text-xs leading-5 text-slate-400">研究機率並非已驗證命中率；不提供高信心篩選、投注或資金建議。</p>
      </> : <p className="text-sm text-slate-400">目前沒有已同步賽事。</p>}
    </aside>
  </div>;
}
