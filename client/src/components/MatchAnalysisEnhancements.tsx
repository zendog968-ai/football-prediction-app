import React, { useMemo, useState } from "react";
import { AlertTriangle, CircleGauge, UsersRound } from "lucide-react";
import { calculateLineupResearch, type OutcomeProbabilities } from "@/lib/lineupResearch";

type MatchForecast = {
  home_team: string;
  away_team: string;
  probabilities: { home_win: number; draw: number; away_win: number };
  diagnostics: { historical_matches_used: number; dc_available: boolean };
  selected_features: {
    elo_diff_pre: number;
    dc_expected_home_goals: number | null;
    dc_expected_away_goals: number | null;
  };
};

type LineupForecast = Pick<MatchForecast, "home_team" | "away_team"> & {
  selected_features: Pick<MatchForecast["selected_features"], "dc_expected_home_goals" | "dc_expected_away_goals">;
};

function percent(value: number) {
  return `${(value * 100).toFixed(1)}%`;
}

export function ProbabilityVisual({ probabilities, homeTeam, awayTeam }: { probabilities: OutcomeProbabilities; homeTeam: string; awayTeam: string }) {
  const home = probabilities.homeWin * 100;
  const draw = probabilities.draw * 100;
  const away = probabilities.awayWin * 100;
  const donutBackground = `conic-gradient(#34d399 0 ${home}%, #94a3b8 ${home}% ${home + draw}%, #fbbf24 ${home + draw}% 100%)`;
  const rows = [
    { label: "主勝", team: homeTeam, value: home, tone: "bg-emerald-400", text: "text-emerald-200" },
    { label: "和局", team: "平局", value: draw, tone: "bg-slate-400", text: "text-slate-200" },
    { label: "客勝", team: awayTeam, value: away, tone: "bg-amber-300", text: "text-amber-100" },
  ];
  return <section className="mt-5 rounded-3xl border border-white/10 bg-black/10 p-4" data-testid="probability-visual"><div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[.18em] text-slate-400"><CircleGauge size={14} />機率分佈</div><div className="mt-4 grid gap-5 sm:grid-cols-[8.5rem_1fr] sm:items-center"><div className="mx-auto grid h-32 w-32 place-items-center rounded-full p-3" style={{ background: donutBackground }} aria-label={`主勝 ${home.toFixed(1)}%、和局 ${draw.toFixed(1)}%、客勝 ${away.toFixed(1)}%`}><div className="grid h-full w-full place-items-center rounded-full bg-[#0a1520] text-center"><span className="font-serif text-xl text-white">1X2</span><span className="text-[10px] text-slate-400">校準機率</span></div></div><div className="space-y-3">{rows.map(row => <div key={row.label}><div className="mb-1.5 flex items-center justify-between gap-3 text-xs"><span className={row.text}>{row.label} <span className="text-slate-500">· {row.team}</span></span><strong className="text-white">{row.value.toFixed(1)}%</strong></div><div className="h-2 overflow-hidden rounded-full bg-white/10"><div className={`h-full rounded-full ${row.tone} transition-[width] duration-300`} style={{ width: `${row.value}%` }} /></div></div>)}</div></div></section>;
}

export function TacticalRiskFocus({ forecast }: { forecast: MatchForecast }) {
  const ordered = [forecast.probabilities.home_win, forecast.probabilities.draw, forecast.probabilities.away_win].sort((left, right) => right - left);
  const risks = [
    !forecast.diagnostics.dc_available && { label: "預期入球缺失", detail: "Dixon–Coles特徵不可用；先發調整不會顯示。", tone: "border-rose-200 bg-rose-50 text-rose-800" },
    forecast.diagnostics.historical_matches_used < 100 && { label: "樣本偏少", detail: `本次只使用${forecast.diagnostics.historical_matches_used}場歷史樣本，機率波動較大。`, tone: "border-amber-200 bg-amber-50 text-amber-800" },
    ordered[0] - ordered[1] < 0.08 && { label: "勝負接近", detail: "最高與次高結果機率差距不足8個百分點，賽前訊息可能明顯改變分佈。", tone: "border-sky-200 bg-sky-50 text-sky-800" },
    Math.abs(forecast.selected_features.elo_diff_pre) > 85 && { label: "強弱落差", detail: "Elo差距明顯；落後方早段冒險壓迫或輪換會放大比賽節奏風險。", tone: "border-violet-200 bg-violet-50 text-violet-800" },
  ].filter(Boolean) as Array<{ label: string; detail: string; tone: string }>;
  const shown = risks.length ? risks : [{ label: "資料風險受控", detail: "歷史樣本、Dixon–Coles特徵與勝率差距均未觸發目前的高優先風險規則。", tone: "border-emerald-200 bg-emerald-50 text-emerald-800" }];
  return <section className="mt-5 rounded-3xl border border-white/10 bg-white/[0.04] p-4" data-testid="tactical-risk-focus"><div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[.18em] text-amber-200"><AlertTriangle size={14} />戰術風險重點</div><div className="mt-3 flex flex-wrap gap-2">{shown.map(item => <span key={item.label} className={`rounded-full border px-2.5 py-1 text-[10px] font-bold ${item.tone}`}>{item.label}</span>)}</div><div className="mt-3 space-y-2">{shown.map(item => <p key={item.detail} className="text-xs leading-5 text-slate-300"><strong className="text-white">{item.label}：</strong>{item.detail}</p>)}</div><p className="mt-3 text-[11px] leading-5 text-slate-500">標籤由歷史特徵與機率分佈觸發；不會自行推定臨場傷停、先發或戰術變陣。</p></section>;
}

export function FixtureResearchRisk({ hasPrediction, expectedGoalsAvailable, researchSource }: { hasPrediction: boolean; expectedGoalsAvailable: boolean; researchSource?: string | null }) {
  const risks = [
    !hasPrediction && { label: "機率資料未同步", detail: "目前沒有完整主／和／客研究機率，圓餅與長條圖會保留空白。", tone: "border-rose-200 bg-rose-50 text-rose-800" },
    !expectedGoalsAvailable && { label: "預期入球缺失", detail: "沒有可驗證的模型預期入球基準；先發調整不會以假設數字啟用。", tone: "border-amber-200 bg-amber-50 text-amber-800" },
    !researchSource && { label: "來源標示不足", detail: "快取尚未保存研究來源文字，應以後續同步資料為準。", tone: "border-sky-200 bg-sky-50 text-sky-800" },
  ].filter(Boolean) as Array<{ label: string; detail: string; tone: string }>;
  const shown = risks.length ? risks : [{ label: "資料風險受控", detail: researchSource ? `已同步：${researchSource}。仍請以實際賽前資訊覆核。` : "可用研究欄位已同步。", tone: "border-emerald-200 bg-emerald-50 text-emerald-800" }];
  return <section className="mt-5 rounded-2xl border border-white/10 bg-white/[0.035] p-4" data-testid="fixture-research-risk"><div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[.18em] text-amber-200"><AlertTriangle size={14} />戰術風險重點</div><div className="mt-3 flex flex-wrap gap-2">{shown.map(item => <span key={item.label} className={`rounded-full border px-2.5 py-1 text-[10px] font-bold ${item.tone}`}>{item.label}</span>)}</div><div className="mt-3 space-y-2">{shown.map(item => <p key={item.detail} className="text-xs leading-5 text-zinc-300"><strong className="text-white">{item.label}：</strong>{item.detail}</p>)}</div><p className="mt-3 text-[11px] leading-5 text-zinc-500">系統不會推定臨場傷停、官方先發或戰術變陣。</p></section>;
}

export function LineupAdjustmentLab({ forecast }: { forecast: LineupForecast }) {
  const baselineHome = forecast.selected_features.dc_expected_home_goals;
  const baselineAway = forecast.selected_features.dc_expected_away_goals;
  const [homeLineup, setHomeLineup] = useState("");
  const [awayLineup, setAwayLineup] = useState("");
  const [homeAdjustment, setHomeAdjustment] = useState(0);
  const [awayAdjustment, setAwayAdjustment] = useState(0);
  const adjusted = useMemo(() => baselineHome !== null && baselineAway !== null ? calculateLineupResearch(baselineHome, baselineAway, homeAdjustment, awayAdjustment) : null, [baselineHome, baselineAway, homeAdjustment, awayAdjustment]);
  if (!adjusted) return <section className="mt-8 rounded-[2rem] border border-amber-200 bg-amber-50 p-6" data-testid="lineup-adjustment-unavailable"><div className="flex items-start gap-3"><AlertTriangle className="mt-0.5 text-amber-700" size={19} /><div><h2 className="font-serif text-2xl text-[#0d1d2a]">先發動態研究暫不可用</h2><p className="mt-2 text-sm leading-6 text-slate-600">此對戰沒有可驗證的模型預期入球基準。系統不會以假設數字填補，因此不會對手動先發產生偽精確更新。</p></div></div></section>;
  const probabilities = { homeWin: adjusted.homeWin, draw: adjusted.draw, awayWin: adjusted.awayWin };
  const controls = [
    { label: `${forecast.home_team} 先發強度調整`, value: homeAdjustment, setValue: setHomeAdjustment, accent: "accent-emerald-600", text: "text-emerald-700" },
    { label: `${forecast.away_team} 先發強度調整`, value: awayAdjustment, setValue: setAwayAdjustment, accent: "accent-amber-500", text: "text-amber-700" },
  ];
  return <section className="mt-8 rounded-[2rem] border border-slate-200 bg-white p-6 shadow-[0_14px_40px_rgba(15,23,42,0.05)] lg:p-8" data-testid="lineup-adjustment-lab"><div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start"><div><div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[.2em] text-violet-700"><UsersRound size={14} />Lineup adjustment lab</div><h2 className="mt-2 font-serif text-3xl text-[#0d1d2a]">先發動態研究</h2><p className="mt-2 max-w-3xl text-sm leading-6 text-slate-500">手動記錄已確認先發，再用兩隊先發強度調整重算預期入球與1X2分佈。名單只保留在目前瀏覽器；量化調整由你明確輸入，並非系統自動判定球員強弱。</p></div><button type="button" onClick={() => { setHomeLineup(""); setAwayLineup(""); setHomeAdjustment(0); setAwayAdjustment(0); }} className="shrink-0 rounded-xl border border-slate-200 px-3 py-2 text-xs font-bold text-slate-600 transition hover:border-rose-200 hover:text-rose-700">重設調整</button></div><div className="mt-6 grid gap-5 lg:grid-cols-2"><label className="block"><span className="mb-2 block text-xs font-bold text-emerald-800">{forecast.home_team} 已確認先發</span><textarea value={homeLineup} onChange={event => setHomeLineup(event.target.value)} placeholder="以逗號或換行輸入先發球員姓名" className="min-h-28 w-full rounded-2xl border border-emerald-100 bg-emerald-50/45 p-3 text-sm text-slate-700 outline-none transition focus:border-emerald-400" /><span className="mt-2 block text-[11px] text-slate-400">只在本機瀏覽器內使用，不會上傳或覆蓋官方名單。</span></label><label className="block"><span className="mb-2 block text-xs font-bold text-amber-800">{forecast.away_team} 已確認先發</span><textarea value={awayLineup} onChange={event => setAwayLineup(event.target.value)} placeholder="以逗號或換行輸入先發球員姓名" className="min-h-28 w-full rounded-2xl border border-amber-100 bg-amber-50/45 p-3 text-sm text-slate-700 outline-none transition focus:border-amber-400" /><span className="mt-2 block text-[11px] text-slate-400">輸入不會自動等同傷停、輪換或能力評級。</span></label></div><div className="mt-5 grid gap-5 lg:grid-cols-2">{controls.map(control => <label key={control.label} className="rounded-2xl border border-slate-100 bg-slate-50 p-4"><div className="flex items-center justify-between gap-3 text-xs"><span className="font-bold text-slate-700">{control.label}</span><strong className={control.text}>{control.value > 0 ? "+" : ""}{control.value}%</strong></div><input aria-label={control.label} type="range" min="-20" max="20" step="1" value={control.value} onChange={event => control.setValue(Number(event.target.value))} className={`mt-4 w-full ${control.accent}`} /><div className="mt-1 flex justify-between text-[10px] text-slate-400"><span>主力缺陣／輪換</span><span>基準</span><span>強陣／正向訊號</span></div></label>)}</div><div className="mt-6 grid gap-5 rounded-3xl bg-[#0a1520] p-5 text-white lg:grid-cols-[1fr_1.2fr]"><div><div className="text-[10px] font-bold uppercase tracking-[.17em] text-emerald-300">調整後預期入球</div><div className="mt-4 grid grid-cols-3 gap-2 text-center"><div><strong className="block font-serif text-3xl text-emerald-200">{adjusted.homeExpectedGoals.toFixed(2)}</strong><span className="text-[10px] text-slate-400">{forecast.home_team}</span></div><div><strong className="block font-serif text-3xl text-white">{adjusted.totalExpectedGoals.toFixed(2)}</strong><span className="text-[10px] text-slate-400">合計</span></div><div><strong className="block font-serif text-3xl text-amber-100">{adjusted.awayExpectedGoals.toFixed(2)}</strong><span className="text-[10px] text-slate-400">{forecast.away_team}</span></div></div><div className="mt-5 rounded-2xl border border-white/10 bg-white/[.04] p-3 text-xs leading-5 text-slate-300">Top 3比分：{adjusted.topScorelines.map(item => `${item.score} (${percent(item.probability)})`).join(" · ")}</div></div><ProbabilityVisual probabilities={probabilities} homeTeam={forecast.home_team} awayTeam={forecast.away_team} /></div><p className="mt-4 text-[11px] leading-5 text-slate-500">計算方式：模型預期入球基準 ×（1 + 手動先發調整）。更新後1X2由截斷Poisson比分矩陣重新正規化；這是情境研究，不是即時官方先發驗證或結果保證。</p></section>;
}
