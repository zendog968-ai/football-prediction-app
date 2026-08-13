import React, { useEffect, useMemo, useState } from "react";
import {
  Activity,
  ArrowRight,
  BarChart3,
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
};

type HistoryItem = Forecast & { id: string; savedAt: number };

const HISTORY_KEY = "aurelia-football-session-history";
const leagueLabels: Record<string, string> = {
  BRA1: "巴甲", EPL: "英超", LL: "西甲", BL: "德甲", SA: "義甲", L1: "法甲",
};

function percent(value: number) {
  return `${(value * 100).toFixed(1)}%`;
}

function dateLabel(value: string) {
  return new Intl.DateTimeFormat("zh-TW", { year: "numeric", month: "short", day: "numeric" }).format(new Date(`${value}T00:00:00`));
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

function Metric({ label, home, away, formatter = (value: number) => value.toFixed(0) }: { label: string; home: number | null; away: number | null; formatter?: (value: number) => string }) {
  return <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 py-3 text-sm"><span className="text-right font-semibold text-slate-800">{home === null ? "—" : formatter(home)}</span><span className="min-w-26 text-center text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">{label}</span><span className="font-semibold text-slate-800">{away === null ? "—" : formatter(away)}</span></div>;
}

export default function Home() {
  const [leagueCode, setLeagueCode] = useState("BRA1");
  const [homeTeam, setHomeTeam] = useState("");
  const [awayTeam, setAwayTeam] = useState("");
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
  const spotlightQuery = trpc.spotlight.cruzeiroFlamengo.useQuery();

  useEffect(() => { sessionStorage.setItem(HISTORY_KEY, JSON.stringify(history)); }, [history]);
  useEffect(() => { setHomeTeam(""); setAwayTeam(""); setResult(null); }, [leagueCode]);

  const teams = teamsQuery.data?.teams || [];
  const selectedLeague = leaguesQuery.data?.leagues.find(league => league.code === leagueCode);
  const canPredict = Boolean(homeTeam && awayTeam && homeTeam !== awayTeam && !forecast.isPending);
  const runForecast = () => {
    if (!canPredict) return;
    forecast.mutate({ leagueCode, homeTeam, awayTeam });
  };
  const display = result;

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
            <p className="mt-5 max-w-xl text-sm leading-7 text-slate-500">先選定聯賽與對戰球隊。系統會重建最新可用賽前特徵，並以校準後的機器學習模型輸出三種結果機率。</p>

            <div className="mt-8 grid gap-5">
              <div><label htmlFor="league-selector" className="mb-2 flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400"><Target size={13} />聯賽</label><div className="relative"><select id="league-selector" value={leagueCode} onChange={event => setLeagueCode(event.target.value)} className="h-13 w-full appearance-none rounded-2xl border border-slate-200 bg-slate-50/70 px-4 pr-10 text-sm font-semibold text-slate-800 outline-none transition focus:border-amber-300 focus:bg-white"><option value="">選擇聯賽</option>{leaguesQuery.data?.leagues.map(league => <option key={league.code} value={league.code}>{leagueLabels[league.code] || league.name} · {league.name}</option>)}</select><ChevronDown size={17} className="pointer-events-none absolute right-4 top-4 text-slate-400" /></div></div>
              <div className="grid gap-5 sm:grid-cols-2"><TeamSearch label="主隊" value={homeTeam} onSelect={setHomeTeam} teams={teams} placeholder={teamsQuery.isLoading ? "載入球隊中…" : "搜尋主隊"} accent="emerald" /><TeamSearch label="客隊" value={awayTeam} onSelect={setAwayTeam} teams={teams} placeholder={teamsQuery.isLoading ? "載入球隊中…" : "搜尋客隊"} accent="gold" /></div>
            </div>
            {homeTeam && awayTeam && homeTeam === awayTeam && <p className="mt-4 text-xs font-medium text-rose-600">請選擇兩支不同的球隊。</p>}
            {forecast.error && <p className="mt-4 rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-700">{forecast.error.message}</p>}
            <button type="button" onClick={runForecast} disabled={!canPredict} className="mt-7 flex h-14 w-full items-center justify-center gap-3 rounded-2xl bg-[#0c1a25] text-sm font-bold tracking-[0.08em] text-white shadow-[0_12px_24px_rgba(12,26,37,.18)] transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-45 active:scale-[.985]">
              {forecast.isPending ? <><Loader2 size={18} className="animate-spin" />正在重建賽前特徵…</> : <><Activity size={18} />開始分析這場對戰 <ArrowRight size={17} /></>}
            </button>
          </div>

          <div className="relative overflow-hidden rounded-[2rem] bg-[#0a1520] p-6 text-white shadow-[0_20px_55px_rgba(2,12,22,.2)] lg:p-8" aria-live="polite">
            <div className="absolute -right-20 -top-24 h-64 w-64 rounded-full bg-emerald-500/15 blur-3xl" /><div className="absolute -bottom-24 -left-12 h-56 w-56 rounded-full bg-amber-300/10 blur-3xl" />
            <div className="relative flex h-full flex-col">
              <div className="flex items-start justify-between gap-4"><div><div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.2em] text-amber-200"><BarChart3 size={14} />預測結果</div><h2 className="mt-3 font-serif text-3xl">{display ? `${display.home_team} vs ${display.away_team}` : "等待你的對戰組合"}</h2></div><div className="rounded-xl border border-white/10 bg-white/5 p-2 text-emerald-300"><ShieldCheck size={19} /></div></div>
              {display ? <div className="mt-7 grid gap-3"><ProbabilityCard label="主勝" team={display.home_team} value={display.probabilities.home_win} tone="emerald" /><ProbabilityCard label="和局" team="平局" value={display.probabilities.draw} tone="slate" /><ProbabilityCard label="客勝" team={display.away_team} value={display.probabilities.away_win} tone="amber" /></div> : <div className="my-auto py-10"><div className="grid h-18 w-18 place-items-center rounded-[1.5rem] border border-white/10 bg-white/[0.04] text-amber-200"><Target size={30} /></div><p className="mt-5 max-w-sm text-sm leading-7 text-slate-300">選定兩隊後，系統會展開校準後的賽果分佈與特徵訊號。</p><div className="mt-7 space-y-3 rounded-3xl border border-white/[0.07] bg-white/[0.025] p-4"><div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-[.18em] text-slate-500"><span>Calibration field</span><span>H · D · A</span></div><div className="space-y-2.5">{[["主勝", "w-3/5", "bg-emerald-400"], ["和局", "w-[34%]", "bg-slate-400"], ["客勝", "w-[47%]", "bg-amber-300"]].map(([label, width, color]) => <div key={label} className="flex items-center gap-3"><span className="w-7 text-[10px] font-bold text-slate-500">{label}</span><div className="h-1 flex-1 overflow-hidden rounded-full bg-white/10"><div className={`h-full rounded-full ${width} ${color}`} /></div></div>)}</div></div></div>}
              {display && <div className="mt-5 flex items-center gap-2 text-xs text-slate-400"><Clock3 size={14} />歷史資料截點：{display.prediction_as_of}</div>}
            </div>
          </div>
        </section>

        {spotlightQuery.data && <div className="mt-8"><MatchSpotlightCard match={spotlightQuery.data} /></div>}

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

        <section className="mt-8 rounded-[2rem] border border-amber-200/70 bg-[#fbf8f0] px-6 py-5 lg:px-8"><div className="flex flex-col gap-4 sm:flex-row sm:items-start"><div className="rounded-2xl bg-amber-200/50 p-3 text-amber-800"><Database size={20} /></div><div><div className="text-[10px] font-bold uppercase tracking-[.2em] text-amber-800">資料覆蓋與模型說明</div><p className="mt-2 max-w-4xl text-sm leading-6 text-slate-600">{leaguesQuery.data?.coverage.disclaimer || "正在確認資料覆蓋範圍…"}</p><div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-xs font-semibold text-slate-500"><span>資料期間：{leaguesQuery.data?.coverage.firstDate ? `${dateLabel(leaguesQuery.data.coverage.firstDate)} — ${dateLabel(leaguesQuery.data.coverage.lastDate)}` : "載入中"}</span><span>模型：{leaguesQuery.data?.coverage.model || "載入中"}</span>{selectedLeague && <span>目前聯賽資料截止：{selectedLeague.last_date}</span>}</div></div></div></section>
      </main>
      <footer className="relative mt-6 border-t border-slate-200 px-5 py-7 text-center text-xs text-slate-400">Aurelia Football · 歷史資料驅動的賽前概率工具，不構成任何結果保證。</footer>
    </div>
  );
}
