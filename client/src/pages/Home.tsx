import React, { useEffect, useMemo, useState } from "react";
import {
  Activity,
  ArrowRight,
  BadgeInfo,
  BarChart3,
  BellRing,
  BrainCircuit,
  ChevronDown,
  Clock3,
  Database,
  History,
  Loader2,
  RotateCcw,
  Search,
  ShieldCheck,
  Sparkles,
  Target,
  Trophy,
  X,
} from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Link } from "wouter";
import MatchSpotlightCard from "@/components/MatchSpotlightCard";
import { calculateMarketResearch, type MarketOdds } from "@/lib/oddsResearch";

type Forecast = {
  prediction_as_of: string;
  league_code: string;
  league_name: string;
  home_team: string;
  away_team: string;
  probabilities: { home_win: number; draw: number; away_win: number };
  diagnostics: { historical_matches_used: number; latest_historical_match: string; dc_available: boolean };
  selected_features: {
    home_elo_pre: number;
    away_elo_pre: number;
    elo_diff_pre: number;
    home_recent5_win_rate: number;
    away_recent5_win_rate: number;
    dc_expected_home_goals: number | null;
    dc_expected_away_goals: number | null;
  };
  lean?: {
    outcome: "home_win" | "draw" | "away_win";
    label: string;
    team: string;
    probability: number;
    risk_level: "low" | "medium" | "high";
    reasons: string[];
    limitations: string[];
  };
};

type HistoryItem = Forecast & { id: string; savedAt: number };

const HISTORY_KEY = "aurelia-football-session-history";
const leagueLabels: Record<string, string> = {
  BRA1: "巴甲", EPL: "英超", LL: "西甲", BL: "德甲", SA: "義甲", L1: "法甲",
  MLS: "美職", J1: "日職", FIN1: "芬蘭聯賽", KOR1: "韓職", POR1: "葡職", MEX1: "墨西哥聯賽", AUS1: "澳職", UEL: "歐霸盃", SUD: "南美球會盃", LCUP: "北美聯賽盃",
};

function percent(value: number) {
  return `${(value * 100).toFixed(1)}%`;
}

function dateLabel(value: string) {
  return new Intl.DateTimeFormat("zh-TW", { year: "numeric", month: "short", day: "numeric" }).format(new Date(`${value}T00:00:00`));
}

function timestampLabel(value: string | null | undefined) {
  if (!value) return "未提供";
  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.getTime())) return value;
  return new Intl.DateTimeFormat("zh-TW", { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).format(timestamp);
}

function modelOdds(value: number) {
  return value > 0 ? (1 / value).toFixed(2) : "—";
}

function signedPercent(value: number) {
  return `${value >= 0 ? "+" : ""}${(value * 100).toFixed(1)}%`;
}

function TeamSearch({
  label,
  value,
  onSelect,
  teams,
  placeholder,
  accent,
}: {
  label: string;
  value: string;
  onSelect: (value: string) => void;
  teams: string[];
  placeholder: string;
  accent: "emerald" | "gold";
}) {
  const [query, setQuery] = useState(value);
  const [open, setOpen] = useState(false);
  useEffect(() => setQuery(value), [value]);
  const results = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return teams.filter(team => team.toLowerCase().includes(normalized)).slice(0, 7);
  }, [query, teams]);
  const choose = (team: string) => {
    setQuery(team);
    onSelect(team);
    setOpen(false);
  };

  return (
    <div className="relative">
      <label className="mb-2 flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400">
        <span className={`h-1.5 w-1.5 rounded-full ${accent === "emerald" ? "bg-emerald-400" : "bg-amber-300"}`} />
        {label}
      </label>
      <div className={`group flex h-13 items-center gap-3 rounded-2xl border px-4 transition ${open ? "border-amber-300/60 bg-white" : "border-slate-200 bg-slate-50/70 hover:border-slate-300"}`}>
        <Search size={17} className="shrink-0 text-slate-400" />
        <input
          value={query}
          onChange={event => { setQuery(event.target.value); onSelect(""); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onKeyDown={event => {
            if (event.key === "Enter" && results[0]) { event.preventDefault(); choose(results[0]); }
            if (event.key === "Escape") setOpen(false);
          }}
          onBlur={() => window.setTimeout(() => setOpen(false), 120)}
          placeholder={placeholder}
          className="min-w-0 flex-1 bg-transparent text-sm font-semibold text-slate-800 outline-none placeholder:font-normal placeholder:text-slate-400"
          aria-label={label}
          autoComplete="off"
        />
        {value && <button type="button" onMouseDown={event => event.preventDefault()} onClick={() => { setQuery(""); onSelect(""); }} className="rounded-full p-1 text-slate-400 transition hover:bg-slate-200 hover:text-slate-700" aria-label={`清除${label}`}><X size={14} /></button>}
      </div>
      {open && results.length > 0 && (
        <div className="absolute z-20 mt-2 w-full overflow-hidden rounded-2xl border border-slate-200 bg-white p-1.5 shadow-[0_20px_45px_rgba(15,23,42,0.16)]">
          {results.map(team => (
            <button key={team} type="button" onMouseDown={event => event.preventDefault()} onClick={() => choose(team)} className="flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-left text-sm font-medium text-slate-700 transition hover:bg-slate-900 hover:text-white">
              {team}<ArrowRight size={14} className="opacity-50" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function ProbabilityCard({ label, team, value, tone }: { label: string; team: string; value: number; tone: "emerald" | "amber" | "slate" }) {
  const color = tone === "emerald" ? "bg-emerald-400" : tone === "amber" ? "bg-amber-300" : "bg-slate-500";
  const text = tone === "emerald" ? "text-emerald-300" : tone === "amber" ? "text-amber-200" : "text-slate-300";
  return (
    <div className="rounded-3xl border border-white/10 bg-white/[0.055] p-5 backdrop-blur-sm">
      <div className="flex items-start justify-between gap-3"><span className={`text-[10px] font-bold uppercase tracking-[0.18em] ${text}`}>{label}</span><span className="text-xs text-slate-400">{team}</span></div>
      <div className="mt-4 flex items-end justify-between"><span className="font-serif text-4xl leading-none text-white">{percent(value)}</span><span className="text-xs text-slate-400">概率</span></div>
      <div className="mt-5 h-1.5 overflow-hidden rounded-full bg-white/10"><div className={`h-full rounded-full ${color}`} style={{ width: `${value * 100}%` }} /></div>
    </div>
  );
}

function LeanSummary({ lean }: { lean: NonNullable<Forecast["lean"]> }) {
  const risk = lean.risk_level === "high"
    ? { label: "高風險", className: "border-rose-200/25 bg-rose-300/10 text-rose-100" }
    : lean.risk_level === "medium"
      ? { label: "中等風險", className: "border-amber-200/25 bg-amber-200/10 text-amber-100" }
      : { label: "較低風險", className: "border-emerald-200/25 bg-emerald-300/10 text-emerald-100" };
  return <section className="rounded-3xl border border-emerald-300/25 bg-emerald-400/[0.08] p-5" data-testid="lean-summary"><div className="flex items-start justify-between gap-3"><div><div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[.18em] text-emerald-200"><Sparkles size={14} />數據傾向（Lean）</div><h3 className="mt-2 font-serif text-2xl text-white">{lean.label} · {lean.team}</h3><p className="mt-1 text-xs text-emerald-100/80">最高校準機率：{percent(lean.probability)}</p></div><span className={`shrink-0 rounded-full border px-2.5 py-1 text-[10px] font-bold ${risk.className}`}>{risk.label}</span></div><ul className="mt-4 space-y-1.5 text-xs leading-5 text-slate-200">{lean.reasons.slice(0, 3).map(reason => <li key={reason}>• {reason}</li>)}</ul>{lean.limitations.length > 0 && <div className="mt-4 rounded-2xl border border-white/10 bg-black/10 px-3 py-2 text-xs leading-5 text-slate-300">{lean.limitations.join(" ")}</div>}<p className="mt-4 text-[11px] leading-5 text-slate-400">Lean是最高校準機率的研究方向，並非投注、資金或結果保證。</p></section>;
}

function Metric({ label, home, away, formatter = (value: number) => value.toFixed(0) }: { label: string; home: number | null; away: number | null; formatter?: (value: number) => string }) {
  return <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 py-3 text-sm"><span className="text-right font-semibold text-slate-800">{home === null ? "—" : formatter(home)}</span><span className="min-w-26 text-center text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">{label}</span><span className="font-semibold text-slate-800">{away === null ? "—" : formatter(away)}</span></div>;
}

function OddsInput({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return <label className="block"><span className="mb-1.5 block text-[10px] font-bold uppercase tracking-[0.13em] text-slate-400">{label}</span><input aria-label={`${label}賠率`} type="number" inputMode="decimal" min="1.01" step="0.01" value={value} onChange={event => onChange(event.target.value)} placeholder="例如 2.10" className="h-10 w-full rounded-xl border border-white/10 bg-white/[.06] px-3 text-sm font-semibold text-white outline-none placeholder:text-slate-500 focus:border-amber-200/60" /></label>;
}

export default function Home() {
  const [leagueCode, setLeagueCode] = useState("BRA1");
  const [homeTeam, setHomeTeam] = useState("");
  const [awayTeam, setAwayTeam] = useState("");
  const [marketOdds, setMarketOdds] = useState({ home: "", draw: "", away: "" });
  const [result, setResult] = useState<Forecast | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>(() => {
    try { return JSON.parse(sessionStorage.getItem(HISTORY_KEY) || "[]"); } catch { return []; }
  });
  const leaguesQuery = trpc.prediction.leagues.useQuery();
  const teamsQuery = trpc.prediction.teams.useQuery({ leagueCode }, { enabled: Boolean(leagueCode) });
  const forecast = trpc.prediction.forecast.useMutation({
    onSuccess: data => {
      setResult(data);
      const item = { ...data, id: `${Date.now()}-${data.home_team}-${data.away_team}`, savedAt: Date.now() };
      setHistory(current => [item, ...current.filter(existing => !(existing.home_team === item.home_team && existing.away_team === item.away_team && existing.league_code === item.league_code))].slice(0, 8));
    },
  });
  const europaQuery = trpc.prediction.europa.useQuery(undefined, { enabled: leagueCode === "UEL" });
  const cupQuery = trpc.prediction.cup.useQuery({ leagueCode: leagueCode === "SUD" ? "SUD" : "LCUP" }, { enabled: leagueCode === "SUD" || leagueCode === "LCUP" });
  const spotlightQuery = trpc.spotlight.cruzeiroFlamengo.useQuery();
  const supabaseUpcomingQuery = trpc.prediction.upcomingCache.useQuery(undefined, { refetchInterval: 30_000, refetchOnWindowFocus: true });
  const notificationStatusQuery = trpc.telegramResearch.status.useQuery(undefined, { enabled: false, retry: false });
  const configureTelegramWebhook = trpc.telegramResearch.configureWebhook.useMutation({ onSuccess: () => notificationStatusQuery.refetch() });
  const enableResearchSchedules = trpc.telegramResearch.enableSchedules.useMutation({ onSuccess: () => notificationStatusQuery.refetch() });

  useEffect(() => { sessionStorage.setItem(HISTORY_KEY, JSON.stringify(history)); }, [history]);
  const changeLeague = (nextLeagueCode: string) => {
    setLeagueCode(nextLeagueCode);
    setHomeTeam("");
    setAwayTeam("");
    setResult(null);
    setMarketOdds({ home: "", draw: "", away: "" });
  };

  const teams = teamsQuery.data?.teams || [];
  const selectedLeague = leaguesQuery.data?.leagues.find(league => league.code === leagueCode);
  const canPredict = Boolean(homeTeam && awayTeam && homeTeam !== awayTeam && !forecast.isPending);
  const runForecast = () => {
    if (!canPredict) return;
    forecast.mutate({ leagueCode, homeTeam, awayTeam });
  };
  const display = result;
  const hasCompleteMarketOdds = [marketOdds.home, marketOdds.draw, marketOdds.away].every(value => value.trim() !== "" && Number.isFinite(Number(value)) && Number(value) > 1);
  const marketResearch = display && hasCompleteMarketOdds ? calculateMarketResearch(
    { home: display.probabilities.home_win, draw: display.probabilities.draw, away: display.probabilities.away_win },
    { home: Number(marketOdds.home), draw: Number(marketOdds.draw), away: Number(marketOdds.away) } as MarketOdds,
  ) : null;
  const notificationBusy = configureTelegramWebhook.isPending || enableResearchSchedules.isPending;
  const notificationError = configureTelegramWebhook.error || enableResearchSchedules.error || notificationStatusQuery.error;

  return (
    <div className="min-h-screen overflow-x-hidden bg-[#f6f7f5] text-slate-900 selection:bg-amber-200">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_12%_10%,rgba(203,162,90,0.11),transparent_22%),radial-gradient(circle_at_92%_42%,rgba(16,185,129,0.07),transparent_23%)]" />
      <header className="relative border-b border-white/10 bg-[#0a1520] text-white">
        <div className="absolute inset-0 opacity-20 [background-image:linear-gradient(rgba(255,255,255,.05)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.05)_1px,transparent_1px)] [background-size:42px_42px]" />
        <div className="relative mx-auto flex max-w-7xl items-center justify-between px-5 py-5 lg:px-8">
          <div className="flex items-center gap-3"><div className="grid h-10 w-10 place-items-center rounded-2xl border border-amber-200/20 bg-amber-200/10 text-amber-200"><Trophy size={19} /></div><div><div className="font-serif text-xl tracking-wide">Aurelia Football</div><div className="text-[9px] font-bold uppercase tracking-[0.22em] text-slate-400">Probability Studio</div></div></div>
          <div className="flex items-center gap-3"><Link href="/performance" className="hidden items-center gap-2 rounded-full border border-amber-200/25 bg-amber-200/10 px-3 py-2 text-[10px] font-bold uppercase tracking-[0.16em] text-amber-100 transition hover:bg-amber-200/20 sm:flex"><BarChart3 size={13} />模型績效</Link><div className="hidden items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-2 text-[10px] font-bold uppercase tracking-[0.16em] text-slate-300 md:flex"><span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />校準模型已載入</div></div>
        </div>
      </header>

      <main className="relative mx-auto max-w-7xl px-5 py-8 lg:px-8 lg:py-12">
        <section className="grid gap-8 lg:grid-cols-[1.05fr_.95fr] lg:items-stretch">
          <div className="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-[0_18px_55px_rgba(15,23,42,0.07)] lg:p-8">
            <div className="flex items-start justify-between gap-4"><div><div className="mb-3 flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.2em] text-emerald-700"><Sparkles size={14} />賽前預測工作台</div><h1 className="max-w-xl font-serif text-4xl leading-[1.02] text-[#0d1d2a] sm:text-5xl">讓每一場對戰，
              <span className="text-emerald-700">更有依據。</span></h1></div><div className="hidden rounded-2xl bg-[#f5f0e6] p-3 text-amber-700 sm:block"><BrainCircuit size={23} /></div></div>
            <p className="mt-5 max-w-xl text-sm leading-7 text-slate-500">先選定聯賽與對戰球隊。系統只分析16個已驗證資料範圍內的對戰，並以校準後的機器學習模型輸出三種結果機率。</p>

            <div className="mt-8 grid gap-5">
              <div><label htmlFor="league-selector" className="mb-2 flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400"><Target size={13} />聯賽</label><div className="relative"><select id="league-selector" value={leagueCode} onChange={event => changeLeague(event.target.value)} className="h-13 w-full appearance-none rounded-2xl border border-slate-200 bg-slate-50/70 px-4 pr-10 text-sm font-semibold text-slate-800 outline-none transition focus:border-amber-300 focus:bg-white"><option value="">選擇聯賽</option>{leaguesQuery.data?.leagues.map(league => <option key={league.code} value={league.code}>{leagueLabels[league.code] || league.name} · {league.name}</option>)}</select><ChevronDown size={17} className="pointer-events-none absolute right-4 top-4 text-slate-400" /></div></div>
              <div className="grid gap-5 sm:grid-cols-2"><TeamSearch key={`home-${leagueCode}`} label="主隊" value={homeTeam} onSelect={setHomeTeam} teams={teams} placeholder={teamsQuery.isLoading ? "載入球隊中…" : "搜尋主隊"} accent="emerald" /><TeamSearch key={`away-${leagueCode}`} label="客隊" value={awayTeam} onSelect={setAwayTeam} teams={teams} placeholder={teamsQuery.isLoading ? "載入球隊中…" : "搜尋客隊"} accent="gold" /></div>
            </div>
            {leagueCode === "UEL" && <section className="mt-6 rounded-2xl border border-sky-100 bg-sky-50/60 p-4" data-testid="europa-live-board"><div className="flex items-start justify-between gap-4"><div><div className="text-[10px] font-bold uppercase tracking-[.16em] text-sky-700">UEFA official feed</div><h2 className="mt-1 font-serif text-xl text-[#0d1d2a]">歐霸盃近期賽果與待賽程</h2></div><span className="text-right text-[10px] leading-4 text-slate-500">{europaQuery.data ? `更新：${timestampLabel(europaQuery.data.retrievedAt)}` : "載入官方賽程…"}</span></div>{europaQuery.error && <p className="mt-3 text-xs leading-5 text-rose-700">{europaQuery.error.message}</p>}{europaQuery.data && <div className="mt-4 grid gap-4 lg:grid-cols-2"><div><h3 className="text-[10px] font-bold uppercase tracking-[.14em] text-slate-500">最近賽果</h3><div className="mt-2 space-y-1.5">{europaQuery.data.recentResults.map(match => <div key={`${match.date}-${match.homeTeam}-${match.awayTeam}`} className="rounded-xl bg-white px-3 py-2 text-xs text-slate-700"><span className="mr-2 text-slate-400">{match.date}</span><strong>{match.homeTeam} {match.homeGoals}–{match.awayGoals} {match.awayTeam}</strong></div>)}</div></div><div><h3 className="text-[10px] font-bold uppercase tracking-[.14em] text-slate-500">待賽程</h3><div className="mt-2 space-y-1.5">{europaQuery.data.upcomingFixtures.map(match => { const available = teams.includes(match.homeTeam) && teams.includes(match.awayTeam); return <button key={`${match.date}-${match.homeTeam}-${match.awayTeam}`} type="button" disabled={!available} onClick={() => { setHomeTeam(match.homeTeam); setAwayTeam(match.awayTeam); }} className="flex w-full items-center justify-between gap-3 rounded-xl bg-white px-3 py-2 text-left text-xs text-slate-700 transition enabled:hover:bg-sky-100 disabled:cursor-not-allowed disabled:opacity-55"><span><span className="mr-2 text-slate-400">{match.date}</span><strong>{match.homeTeam} vs {match.awayTeam}</strong></span><span className="shrink-0 text-[10px] font-bold text-sky-700">{available ? "帶入預測" : "資料累積中"}</span></button>; })}</div></div></div>}<p className="mt-4 text-[11px] leading-5 text-slate-500">官方賽程只供顯示；訓練與預測資料庫只使用已完成比賽。沒有足夠已完成歐霸盃歷史的待賽隊伍不會產生機率。</p></section>}
            {(leagueCode === "SUD" || leagueCode === "LCUP") && <section className="mt-6 rounded-2xl border border-emerald-100 bg-emerald-50/60 p-4" data-testid="cup-live-board"><div className="flex items-start justify-between gap-4"><div><div className="text-[10px] font-bold uppercase tracking-[.16em] text-emerald-700">Public scoreboard feed</div><h2 className="mt-1 font-serif text-xl text-[#0d1d2a]">{leagueLabels[leagueCode]}近期賽果與待賽程</h2></div><span className="text-right text-[10px] leading-4 text-slate-500">{cupQuery.data ? `更新：${timestampLabel(cupQuery.data.retrievedAt)}` : "載入公開賽程…"}</span></div>{cupQuery.error && <p className="mt-3 text-xs leading-5 text-rose-700">{cupQuery.error.message}</p>}{cupQuery.data && <div className="mt-4 grid gap-4 lg:grid-cols-2"><div><h3 className="text-[10px] font-bold uppercase tracking-[.14em] text-slate-500">最近賽果</h3><div className="mt-2 space-y-1.5">{cupQuery.data.recentResults.map(match => <div key={`${match.date}-${match.homeTeam}-${match.awayTeam}`} className="rounded-xl bg-white px-3 py-2 text-xs text-slate-700"><span className="mr-2 text-slate-400">{match.date.slice(0, 10)}</span><strong>{match.homeTeam} {match.homeGoals}–{match.awayGoals} {match.awayTeam}</strong></div>)}</div></div><div><h3 className="text-[10px] font-bold uppercase tracking-[.14em] text-slate-500">待賽程</h3><div className="mt-2 space-y-1.5">{cupQuery.data.upcomingFixtures.map(match => { const available = teams.includes(match.homeTeam) && teams.includes(match.awayTeam); return <button key={`${match.date}-${match.homeTeam}-${match.awayTeam}`} type="button" disabled={!available} onClick={() => { setHomeTeam(match.homeTeam); setAwayTeam(match.awayTeam); }} className="flex w-full items-center justify-between gap-3 rounded-xl bg-white px-3 py-2 text-left text-xs text-slate-700 transition enabled:hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-55"><span><span className="mr-2 text-slate-400">{match.date.slice(0, 10)}</span><strong>{match.homeTeam} vs {match.awayTeam}</strong></span><span className="shrink-0 text-[10px] font-bold text-emerald-700">{available ? "帶入預測" : "資料累積中"}</span></button>; })}</div></div></div>}<p className="mt-4 text-[11px] leading-5 text-slate-500">公開賽程只供顯示；模型資料庫只使用已完成比賽。資料庫名稱與公開賽程隊名完全一致時，待賽程才可帶入預測。</p></section>}
            {homeTeam && awayTeam && homeTeam === awayTeam && <p className="mt-4 text-xs font-medium text-rose-600">請選擇兩支不同的球隊。</p>}
            {forecast.error && <p className="mt-4 rounded-xl border border-rose-100 bg-rose-50 px-4 py-3 text-sm leading-6 text-rose-700"><strong>範疇驗證：</strong>{forecast.error.message}</p>}
            <button type="button" onClick={runForecast} disabled={!canPredict} className="mt-7 flex h-14 w-full items-center justify-center gap-3 rounded-2xl bg-[#0c1a25] text-sm font-bold tracking-[0.08em] text-white shadow-[0_12px_24px_rgba(12,26,37,.18)] transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-45 active:scale-[.985]">
              {forecast.isPending ? <><Loader2 size={18} className="animate-spin" />正在重建賽前特徵…</> : <><Activity size={18} />開始分析這場對戰 <ArrowRight size={17} /></>}
            </button>
          </div>

          <div className="relative overflow-hidden rounded-[2rem] bg-[#0a1520] p-6 text-white shadow-[0_20px_55px_rgba(2,12,22,.2)] lg:p-8" aria-live="polite">
            <div className="absolute -right-20 -top-24 h-64 w-64 rounded-full bg-emerald-500/15 blur-3xl" /><div className="absolute -bottom-24 -left-12 h-56 w-56 rounded-full bg-amber-300/10 blur-3xl" />
            <div className="relative flex h-full flex-col">
              <div className="flex items-start justify-between gap-4"><div><div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.2em] text-amber-200"><BarChart3 size={14} />預測結果</div><h2 className="mt-3 font-serif text-3xl">{display ? `${display.home_team} vs ${display.away_team}` : "等待你的對戰組合"}</h2></div><div className="rounded-xl border border-white/10 bg-white/5 p-2 text-emerald-300"><ShieldCheck size={19} /></div></div>
              {display ? <div className="mt-7 grid gap-3"><ProbabilityCard label="主勝" team={display.home_team} value={display.probabilities.home_win} tone="emerald" /><ProbabilityCard label="和局" team="平局" value={display.probabilities.draw} tone="slate" /><ProbabilityCard label="客勝" team={display.away_team} value={display.probabilities.away_win} tone="amber" /></div> : <div className="my-auto py-10"><div className="grid h-18 w-18 place-items-center rounded-[1.5rem] border border-white/10 bg-white/[0.04] text-amber-200"><Target size={30} /></div><p className="mt-5 max-w-sm text-sm leading-7 text-slate-300">選定兩隊後，系統會展開校準後的賽果分佈與特徵訊號。</p><div className="mt-7 space-y-3 rounded-3xl border border-white/[0.07] bg-white/[0.025] p-4"><div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-[.18em] text-slate-500"><span>Calibration field</span><span>H · D · A</span></div><div className="space-y-2.5">{[["主勝", "w-3/5", "bg-emerald-400"], ["和局", "w-[34%]", "bg-slate-400"], ["客勝", "w-[47%]", "bg-amber-300"]].map(([label, width, color]) => <div key={label} className="flex items-center gap-3"><span className="w-7 text-[10px] font-bold text-slate-500">{label}</span><div className="h-1 flex-1 overflow-hidden rounded-full bg-white/10"><div className={`h-full rounded-full ${width} ${color}`} /></div></div>)}</div></div></div>}
              {display && <>{display.lean && <div className="mt-5"><LeanSummary lean={display.lean} /></div>}<div className="mt-5 flex items-center gap-2 text-xs text-slate-400"><Clock3 size={14} />歷史資料截點：{display.prediction_as_of}</div><div className="mt-4 rounded-2xl border border-amber-200/20 bg-amber-200/[0.06] p-4 text-xs leading-6 text-slate-300" data-testid="research-disclaimer"><div className="flex items-center gap-2 font-bold text-amber-100"><BadgeInfo size={14} />機率研究、Lean與模型賠率</div><p className="mt-2">Lean由最高校準機率產生；模型賠率 = 1 ÷ 機率。主勝 {modelOdds(display.probabilities.home_win)}、和局 {modelOdds(display.probabilities.draw)}、客勝 {modelOdds(display.probabilities.away_win)}。</p><p className="mt-2 text-slate-400">Lean、模型賠率與下方市場比較只供模型效能驗證與統計學研究，並非市場賠率推薦、價值判斷或任何投注與資金建議。</p></div></>}
            </div>
          </div>
        </section>

        {spotlightQuery.data && <div className="mt-8"><MatchSpotlightCard match={spotlightQuery.data} /></div>}

        <section className="mt-8 rounded-[2rem] border border-violet-100 bg-violet-50/60 p-6 shadow-[0_14px_40px_rgba(15,23,42,0.04)] lg:p-8" data-testid="supabase-cache-board">
          <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start"><div><div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[.2em] text-violet-700"><Database size={14} />Supabase cache</div><h2 className="mt-2 font-serif text-3xl text-[#0d1d2a]">未來24小時同步研究快取</h2><p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">頁面優先讀取伺服器端Supabase快取，並每30秒自動重新核對。只有已同步賽事與已保存研究模型會顯示；快取不可用時不以舊資料推測。</p></div><div className="rounded-2xl border border-violet-200 bg-white px-4 py-3 text-xs leading-5 text-slate-600"><strong className="block text-violet-800">同步狀態</strong>{supabaseUpcomingQuery.isLoading ? "載入快取中…" : supabaseUpcomingQuery.data?.available ? `已同步｜${timestampLabel(supabaseUpcomingQuery.data.loadedAt)}` : "快取暫時不可用"}</div></div>
          {supabaseUpcomingQuery.data?.available && supabaseUpcomingQuery.data.fixtures.length > 0 ? <div className="mt-5 grid gap-3 lg:grid-cols-2">{supabaseUpcomingQuery.data.fixtures.slice(0, 4).map(item => <article key={item.fixtureId} className="rounded-2xl border border-violet-100 bg-white p-4"><div className="flex items-start justify-between gap-3"><div><div className="text-[10px] font-bold uppercase tracking-[.14em] text-violet-600">{item.leagueName}</div><h3 className="mt-1 text-sm font-bold text-slate-800">{item.homeTeam} vs {item.awayTeam}</h3><p className="mt-1 text-xs text-slate-500">{timestampLabel(item.eventTime)}</p></div><span className="rounded-full bg-violet-100 px-2.5 py-1 text-[10px] font-bold text-violet-800">{"⭐".repeat(item.confidence) || "資料不足"}</span></div><div className="mt-4 grid grid-cols-3 gap-2 text-center text-xs"><span className="rounded-xl bg-emerald-50 px-2 py-2 text-emerald-800">🟢 {percent(item.homeWin)}</span><span className="rounded-xl bg-amber-50 px-2 py-2 text-amber-800">🟡 {percent(item.draw)}</span><span className="rounded-xl bg-rose-50 px-2 py-2 text-rose-800">🔴 {percent(item.awayWin)}</span></div><p className="mt-3 text-xs text-slate-600">最可能比分：{item.predictedScore || "資料不足"}｜{item.recommendation || "研究傾向資料不足"}</p></article>)}</div> : <p className="mt-5 rounded-2xl border border-dashed border-violet-200 bg-white/70 p-4 text-sm leading-6 text-slate-500">{supabaseUpcomingQuery.data?.available ? "未來24小時暫無具同步模型資料的賽事。" : supabaseUpcomingQuery.data?.reason || "快取資料確認中。"}</p>}
        </section>

        <section className="mt-8 grid gap-8 lg:grid-cols-[1.05fr_.95fr]">
          <div className="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-[0_14px_40px_rgba(15,23,42,0.05)] lg:p-8">
            <div className="flex items-center justify-between"><div><div className="text-[10px] font-bold uppercase tracking-[0.2em] text-emerald-700">Feature lens</div><h2 className="mt-2 font-serif text-3xl text-[#0d1d2a]">關鍵特徵摘要</h2></div><div className="rounded-2xl bg-emerald-50 p-3 text-emerald-700"><Activity size={21} /></div></div>
            {display ? <><div className="mt-7 grid grid-cols-[1fr_auto_1fr] items-center gap-3 border-b border-slate-100 pb-4"><div className="truncate text-right text-sm font-bold text-slate-800">{display.home_team}</div><div className="text-[10px] font-bold uppercase tracking-[.16em] text-slate-400">對比</div><div className="truncate text-sm font-bold text-slate-800">{display.away_team}</div></div><Metric label="Elo 評分" home={display.selected_features.home_elo_pre} away={display.selected_features.away_elo_pre} /><div className="border-t border-slate-100" /><Metric label="近五場勝率" home={display.selected_features.home_recent5_win_rate} away={display.selected_features.away_recent5_win_rate} formatter={percent} /><div className="border-t border-slate-100" /><Metric label="DC 預期進球" home={display.selected_features.dc_expected_home_goals} away={display.selected_features.dc_expected_away_goals} formatter={value => value.toFixed(2)} /><div className="mt-4 rounded-2xl bg-[#f6f7f5] px-4 py-3 text-xs leading-5 text-slate-500">Elo 差距為 <strong className="text-slate-700">{display.selected_features.elo_diff_pre > 0 ? "+" : ""}{display.selected_features.elo_diff_pre.toFixed(1)}</strong>。Dixon–Coles 特徵：<strong className="text-slate-700">{display.diagnostics.dc_available ? "可用" : "資料不足"}</strong>。</div></> : <div className="mt-8 rounded-3xl border border-dashed border-slate-200 bg-slate-50 p-8 text-center text-sm leading-6 text-slate-500">完成一組預測後，雙方的 Elo、近五場勝率與預期進球會顯示在這裡。</div>}
          </div>

          <div className="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-[0_14px_40px_rgba(15,23,42,0.05)] lg:p-8">
            <div className="flex items-center justify-between"><div><div className="text-[10px] font-bold uppercase tracking-[0.2em] text-amber-700">Session archive</div><h2 className="mt-2 font-serif text-3xl text-[#0d1d2a]">本次查詢</h2></div>{history.length > 0 && <button type="button" onClick={() => setHistory([])} className="rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-500 transition hover:border-rose-200 hover:text-rose-600">清除</button>}</div>
            {history.length ? <div className="mt-6 space-y-2">{history.map(item => <button type="button" key={item.id} onClick={() => setResult(item)} className={`w-full rounded-2xl border p-4 text-left transition hover:border-emerald-300 hover:bg-emerald-50/50 ${result && result.prediction_as_of === item.prediction_as_of && result.home_team === item.home_team ? "border-emerald-200 bg-emerald-50/60" : "border-slate-100 bg-slate-50/65"}`}><div className="flex items-start justify-between gap-4"><div><div className="text-sm font-bold text-slate-800">{item.home_team} <span className="px-1 text-slate-400">vs</span> {item.away_team}</div><div className="mt-1 text-[10px] font-bold uppercase tracking-[.14em] text-slate-400">{leagueLabels[item.league_code] || item.league_name}</div></div><div className="text-right text-xs leading-5 text-slate-500"><strong className="block text-emerald-700">{percent(item.probabilities.home_win)}</strong>主勝概率</div></div></button>)}</div> : <div className="mt-8 grid place-items-center rounded-3xl border border-dashed border-slate-200 bg-slate-50 p-8 text-center"><History size={25} className="text-slate-300" /><p className="mt-3 text-sm text-slate-500">本次 session 的查詢結果會留在這裡，方便快速回看與比較。</p></div>}
          </div>
        </section>

        {display && <section className="mt-8 rounded-[2rem] border border-slate-700 bg-[#0a1520] p-6 text-white shadow-[0_14px_40px_rgba(15,23,42,0.13)] lg:p-8" data-testid="odds-research-module"><div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start"><div><div className="text-[10px] font-bold uppercase tracking-[0.2em] text-amber-200">Odds research</div><h2 className="mt-2 font-serif text-3xl">市場賠率與模型機率比較</h2><p className="mt-2 max-w-3xl text-sm leading-6 text-slate-300">輸入十進制市場賠率後，系統以 <strong className="text-white">EV = (模型機率 × 賠率) − 1</strong> 與 <strong className="text-white">隱含機率 = 1 ÷ 賠率</strong> 做統計比較。</p></div><div className="rounded-2xl border border-amber-200/20 bg-amber-200/[.07] px-3 py-2 text-xs leading-5 text-amber-100">僅供模型效能驗證<br />及統計學研究</div></div><div className="mt-6 grid gap-3 sm:grid-cols-3"><OddsInput label={`${display.home_team} 主勝`} value={marketOdds.home} onChange={value => setMarketOdds(current => ({ ...current, home: value }))} /><OddsInput label="和局" value={marketOdds.draw} onChange={value => setMarketOdds(current => ({ ...current, draw: value }))} /><OddsInput label={`${display.away_team} 客勝`} value={marketOdds.away} onChange={value => setMarketOdds(current => ({ ...current, away: value }))} /></div>{!hasCompleteMarketOdds && <p className="mt-3 text-xs text-slate-400">請輸入三個大於 1.00 的十進制賠率，以產生研究比較；無效或不完整值不會計算。</p>}{marketResearch && <div className="mt-6 grid gap-3 lg:grid-cols-3">{[{ label: `${display.home_team} 主勝`, probability: display.probabilities.home_win, research: marketResearch.home, tone: "emerald" }, { label: "和局", probability: display.probabilities.draw, research: marketResearch.draw, tone: "slate" }, { label: `${display.away_team} 客勝`, probability: display.probabilities.away_win, research: marketResearch.away, tone: "amber" }].map(({ label, probability, research, tone }) => research && <div key={label} className="rounded-2xl border border-white/10 bg-white/[.05] p-4"><div className="flex items-start justify-between gap-3"><div><div className="text-[10px] font-bold uppercase tracking-[.14em] text-slate-400">{label}</div><div className="mt-2 text-sm text-slate-300">模型 {percent(probability)} · 市場隱含 {percent(research.impliedProbability)}</div></div>{research.isPositiveExpectedValue && <span className={`rounded-full px-2.5 py-1 text-[10px] font-bold ${tone === "emerald" ? "bg-emerald-400/15 text-emerald-200" : tone === "amber" ? "bg-amber-200/15 text-amber-100" : "bg-slate-300/15 text-slate-100"}`}>+EV 統計標記</span>}</div><div className="mt-4 flex items-end justify-between"><span className="font-serif text-3xl text-white">{signedPercent(research.expectedValue)}</span><span className="text-xs text-slate-400">EV（研究）</span></div><div className="mt-3 text-xs text-slate-400">輸入賠率 {research.marketOdds.toFixed(2)} · 模型賠率 {Number.isFinite(research.modelOdds) ? research.modelOdds.toFixed(2) : "—"}</div></div>)}</div>}<p className="mt-5 rounded-2xl border border-amber-200/15 bg-amber-200/[.06] px-4 py-3 text-xs leading-6 text-slate-300">賠率與EV數據僅供模型效能驗證與統計學研究，不構成任何投注、資金或行動建議。正EV標記只表示此固定公式在輸入數值下的代數結果，並不預測或保證任何結果。</p></section>}

        <section className="mt-8" data-testid="data-transparency-cards">
          <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end"><div><div className="text-[10px] font-bold uppercase tracking-[.2em] text-emerald-700">Data transparency</div><h2 className="mt-2 font-serif text-3xl text-[#0d1d2a]">資料截止日與樣本數</h2><p className="mt-2 max-w-3xl text-sm leading-6 text-slate-500">每張卡皆由目前已驗證的SQLite發布資產計算；截止日只計入已完場賽事，樣本數不含未完場賽程。</p></div><div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-right shadow-[0_10px_25px_rgba(15,23,42,0.04)]"><div className="text-[10px] font-bold uppercase tracking-[.15em] text-slate-400">發布資產</div><div className="mt-1 text-xs font-semibold text-slate-700">{leaguesQuery.data?.coverage.releaseVersion || "確認中"}</div></div></div>
          <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><div className="rounded-3xl bg-[#0a1520] p-5 text-white"><div className="text-[10px] font-bold uppercase tracking-[.15em] text-emerald-300">已驗證範圍</div><div className="mt-4 font-serif text-4xl">{leaguesQuery.data?.coverage.scopeCount ?? "—"}</div><p className="mt-2 text-xs text-slate-400">可供校準預測的聯賽與盃賽</p></div><div className="rounded-3xl border border-slate-200 bg-white p-5"><div className="text-[10px] font-bold uppercase tracking-[.15em] text-slate-400">已完場樣本</div><div className="mt-4 font-serif text-4xl text-[#0d1d2a]">{(leaguesQuery.data?.coverage.totalCompletedMatches || 0).toLocaleString("zh-TW")}</div><p className="mt-2 text-xs text-slate-500">模型可回放的歷史賽果</p></div><div className="rounded-3xl border border-slate-200 bg-white p-5"><div className="text-[10px] font-bold uppercase tracking-[.15em] text-slate-400">整體截止日</div><div className="mt-4 text-lg font-bold text-[#0d1d2a]">{leaguesQuery.data?.coverage.lastDate ? dateLabel(leaguesQuery.data.coverage.lastDate) : "確認中"}</div><p className="mt-2 text-xs text-slate-500">全部範圍中最新的已完場日期</p></div><div className="rounded-3xl border border-slate-200 bg-white p-5"><div className="text-[10px] font-bold uppercase tracking-[.15em] text-slate-400">資料庫更新</div><div className="mt-4 text-lg font-bold text-[#0d1d2a]">{timestampLabel(leaguesQuery.data?.coverage.lastUpdatedAt)}</div><p className="mt-2 text-xs text-slate-500">來源快照最近擷取時間</p></div></div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{leaguesQuery.data?.leagues.map(league => <article key={league.code} className={`rounded-2xl border p-4 transition ${league.code === leagueCode ? "border-emerald-300 bg-emerald-50/65 shadow-[0_10px_24px_rgba(16,185,129,0.08)]" : "border-slate-200 bg-white"}`}><div className="flex items-start justify-between gap-3"><div><div className="text-[10px] font-bold uppercase tracking-[.14em] text-slate-400">{league.code}</div><h3 className="mt-1 text-sm font-bold text-slate-800">{leagueLabels[league.code] || league.name}</h3></div>{league.code === leagueCode && <span className="rounded-full bg-emerald-700 px-2 py-1 text-[9px] font-bold text-white">目前</span>}</div><div className="mt-4 grid grid-cols-2 gap-3 border-t border-slate-100 pt-3"><div><div className="text-[9px] font-bold uppercase tracking-[.13em] text-slate-400">截止日</div><div className="mt-1 text-xs font-semibold text-slate-700">{league.cutoff_date ? dateLabel(league.cutoff_date) : "資料確認中"}</div></div><div><div className="text-[9px] font-bold uppercase tracking-[.13em] text-slate-400">已完場樣本</div><div className="mt-1 text-xs font-semibold text-slate-700">{(league.completed_match_count || 0).toLocaleString("zh-TW")}</div></div></div></article>)}</div>
        </section>

        <section className="mt-8 rounded-[2rem] border border-sky-200 bg-sky-50/55 p-6 shadow-[0_14px_40px_rgba(15,23,42,0.04)] lg:p-8" data-testid="telegram-research-settings">
          <div className="flex flex-col justify-between gap-5 lg:flex-row lg:items-start"><div className="max-w-3xl"><div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[.2em] text-sky-700"><BellRing size={14} />Telegram research operations</div><h2 className="mt-2 font-serif text-3xl text-[#0d1d2a]">研究通知與盤口監控</h2><p className="mt-2 text-sm leading-6 text-slate-600">通知只會傳送已核對盤口、模型Lean、風險理由與賽後研究統計。系統每天以香港時間10:30、11:00及18:30執行；不會自動執行投注、資金操作或以缺少資料的盤口產生訊息。</p></div><div className="rounded-2xl border border-sky-200 bg-white px-4 py-3 text-xs leading-5 text-slate-600"><strong className="block text-sky-800">目前狀態</strong>{notificationStatusQuery.data ? `有效訂閱：${notificationStatusQuery.data.activeSubscribers}` : "需登入後查詢"}</div></div>
          <div className="mt-6 grid gap-3 lg:grid-cols-3"><article className="rounded-2xl border border-sky-100 bg-white p-4"><div className="text-[10px] font-bold uppercase tracking-[.14em] text-slate-400">第一步</div><h3 className="mt-2 text-sm font-bold text-slate-800">設定Telegram Webhook</h3><p className="mt-2 text-xs leading-5 text-slate-500">發布後設定安全回呼；再向Bot傳送 <code>/start</code> 以完成自願訂閱。</p><button type="button" disabled={notificationBusy} onClick={() => { if (window.confirm("將設定Telegram webhook。請確認你已發布網站並願意啟用Bot訂閱回呼。")) configureTelegramWebhook.mutate(); }} className="mt-4 rounded-xl bg-sky-700 px-3 py-2 text-xs font-bold text-white transition hover:bg-sky-800 disabled:cursor-not-allowed disabled:opacity-50">設定Webhook</button></article><article className="rounded-2xl border border-sky-100 bg-white p-4"><div className="text-[10px] font-bold uppercase tracking-[.14em] text-slate-400">第二步</div><h3 className="mt-2 text-sm font-bold text-slate-800">啟用三個研究排程</h3><p className="mt-2 text-xs leading-5 text-slate-500">建立10:30複盤、11:00日間摘要及18:30晚間摘要的可管理Heartbeat任務。</p><button type="button" disabled={notificationBusy} onClick={() => { if (window.confirm("將建立或恢復三個Telegram研究排程。通知只會傳送研究型摘要。是否繼續？")) enableResearchSchedules.mutate(); }} className="mt-4 rounded-xl bg-[#0a1520] px-3 py-2 text-xs font-bold text-white transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-50">啟用排程</button></article><article className="rounded-2xl border border-sky-100 bg-white p-4"><div className="text-[10px] font-bold uppercase tracking-[.14em] text-slate-400">執行紀錄</div><h3 className="mt-2 text-sm font-bold text-slate-800">可稽核與可停止</h3><p className="mt-2 text-xs leading-5 text-slate-500">盤口快照、摘要與結算均保存於資料庫；排程可在管理介面暫停或檢視執行紀錄。</p><button type="button" disabled={notificationStatusQuery.isFetching} onClick={() => notificationStatusQuery.refetch()} className="mt-4 rounded-xl border border-slate-200 px-3 py-2 text-xs font-bold text-slate-700 transition hover:border-sky-300 hover:bg-sky-50 disabled:opacity-50">{notificationStatusQuery.isFetching ? "查詢中…" : "重新整理狀態"}</button></article></div>
          {notificationStatusQuery.data?.schedules.length ? <div className="mt-4 grid gap-2 sm:grid-cols-3">{notificationStatusQuery.data.schedules.map(schedule => <div key={schedule.kind} className="rounded-xl border border-sky-100 bg-white px-3 py-2 text-xs text-slate-600"><strong className="text-slate-800">{schedule.kind === "settlement" ? "10:30複盤" : schedule.kind === "day_digest" ? "11:00日間" : "18:30晚間"}</strong><br />{schedule.isEnabled ? "已啟用" : "未啟用"}{schedule.lastError ? ` · 最近錯誤：${schedule.lastError}` : ""}</div>)}</div> : null}
          {notificationError && <p className="mt-4 rounded-2xl border border-rose-100 bg-rose-50 px-4 py-3 text-xs leading-5 text-rose-700">研究通知設定未完成：{notificationError.message}</p>}
          <p className="mt-5 text-[11px] leading-5 text-slate-500">資料供應商為API-Football Pro；每場僅在來源回傳明確fixture、亞洲讓球或大小球資料時才建立快照。所有通知僅供模型效能與戰術研究，並非投注或資金建議。</p>
        </section>

        <section className="mt-8 rounded-[2rem] border border-amber-200/70 bg-[#fbf8f0] px-6 py-5 lg:px-8"><div className="flex flex-col gap-4 sm:flex-row sm:items-start"><div className="rounded-2xl bg-amber-200/50 p-3 text-amber-800"><Database size={20} /></div><div><div className="text-[10px] font-bold uppercase tracking-[.2em] text-amber-800">資料覆蓋與模型說明</div><p className="mt-2 max-w-4xl text-sm leading-6 text-slate-600">{leaguesQuery.data?.coverage.disclaimer || "正在確認資料覆蓋範圍…"} 跨聯賽與盃賽不在校準範圍內，系統會拒絕輸出偽精確機率。</p><div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-xs font-semibold text-slate-500"><span>資料期間：{leaguesQuery.data?.coverage.firstDate && leaguesQuery.data.coverage.lastDate ? `${dateLabel(leaguesQuery.data.coverage.firstDate)} — ${dateLabel(leaguesQuery.data.coverage.lastDate)}` : "載入中"}</span><span>模型：{leaguesQuery.data?.coverage.model || "載入中"}</span>{selectedLeague && <span>目前聯賽資料截止：{selectedLeague.cutoff_date || "確認中"}</span>}</div></div></div></section>
      </main>
      <footer className="relative mt-6 border-t border-slate-200 px-5 py-7 text-center text-xs leading-6 text-slate-400">Aurelia Football · 歷史資料驅動的賽前概率研究工具，不構成任何結果保證、投注建議或 +EV 判斷。</footer>
    </div>
  );
}
