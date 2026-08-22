import React, { useMemo, useState } from "react";
import { CalendarDays, ChevronDown, Clock3, ShieldAlert, Sparkles } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { localizeTeamName } from "@shared/teamDisplay";
import { localizeLeagueName } from "@shared/leagueDisplay";
import { Link } from "wouter";

const pct = (value: number) => `${Math.round(value * 100)}%`;
const labelTime = (value: string) => new Intl.DateTimeFormat("zh-HK", { hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(value));
const labelDate = (value: Date) => new Intl.DateTimeFormat("zh-HK", { month: "short", day: "numeric", weekday: "short" }).format(value);
const initials = (team: string) => team.split(/\s+/).map(part => part[0]).join("").slice(0, 2).toUpperCase();
const hktDay = (value: Date | string) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Hong_Kong", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(value));
const localize = (name: string) => localizeTeamName(name);

function CompactTable({ item }: { item: { compactMarkets: Array<{ market: string; selection: string; probability: number; distribution?: { fullWin: number; halfWin: number; push: number; halfLoss: number; fullLoss: number } }>; topScorelines: Array<{ score: string; probability: number }> } }) {
  const row = (market: string) => {
    const found = item.compactMarkets.find(entry => entry.market === market);
    return <tr key={market} className="border-t border-white/10"><td className="py-2 pr-2 text-zinc-400">{market}</td><td className="py-2 pr-2 text-zinc-100">{found ? <><div>{found.selection}</div>{found.distribution && <div className="mt-0.5 text-[10px] text-zinc-500">全贏 {pct(found.distribution.fullWin)}｜半贏 {pct(found.distribution.halfWin)}｜走盤 {pct(found.distribution.push)}｜半輸 {pct(found.distribution.halfLoss)}｜全輸 {pct(found.distribution.fullLoss)}</div>}</> : "資料不足"}</td><td className="py-2 text-right text-emerald-300">{found ? pct(found.probability) : "—"}</td></tr>;
  };
  return <div className="space-y-4 text-xs"><table className="w-full border-collapse"><thead className="text-left text-[10px] uppercase tracking-[.12em] text-zinc-500"><tr><th className="pb-2">盤口種類</th><th className="pb-2">預測選項</th><th className="pb-2 text-right">命中機率</th></tr></thead><tbody>{row("主客和 (1X2)")}{row("入球大細 1.5")}{row("入球大細 2.5")}{row("入球大細 3.5")}{row("入球大細 4.5")}{row("讓球盤 (Handicap)")}{row("亞洲讓球 0.25")}{row("亞洲讓球 0.75")}{row("亞洲讓球 1.25")}{row("亞洲讓球 1.75")}</tbody></table><div><div className="mb-2 font-bold text-emerald-300">【最高機率波膽 Top 3】</div><ol className="space-y-1 text-zinc-300">{[0, 1, 2].map(index => <li key={index}>{index + 1}. {item.topScorelines[index] ? `${item.topScorelines[index]!.score}：${pct(item.topScorelines[index]!.probability)}` : "資料不足"}</li>)}</ol></div></div>;
}

export default function MatchFeed() {
  const [league, setLeague] = useState("全部");
  const [dayOffset, setDayOffset] = useState(0);
  const [openId, setOpenId] = useState<number | null>(null);
  const query = trpc.prediction.upcomingCache.useQuery(undefined, { refetchInterval: 30_000, refetchOnWindowFocus: true });
  const days = useMemo(() => [0, 1, 2].map(offset => ({ offset, date: new Date(Date.now() + offset * 86400000) })), []);
  const dayFixtures = (query.data?.fixtures || []).filter(item => {
    const matchesLeague = league === "全部" || localizeLeagueName(item.leagueName).includes(league);
    const target = new Date(Date.now() + dayOffset * 86400000);
    const matchesDay = hktDay(item.eventTime) === hktDay(target);
    return matchesLeague && matchesDay;
  });
  const fallbackFixtures = (query.data?.fixtures || []).filter(item => league === "全部" || localizeLeagueName(item.leagueName).includes(league));
  const fixtures = dayFixtures.length ? dayFixtures : fallbackFixtures;
  const isFallback = dayFixtures.length === 0 && fallbackFixtures.length > 0;
  const leagueTabs = ["全部", "英超", "西甲", "歐聯", "歐霸", "日職", "美職"];

  return <main className="min-h-screen bg-[#121212] pb-24 text-zinc-100">
    <header className="sticky top-0 z-20 border-b border-white/10 bg-[#121212]/95 px-4 py-4 backdrop-blur xl:px-8">
      <div className="mx-auto flex max-w-5xl items-center justify-between"><div><p className="text-[10px] font-bold uppercase tracking-[.24em] text-emerald-400">Aurelia Football</p><h1 className="mt-1 text-xl font-black tracking-tight">今日賽程</h1></div><div className="flex items-center gap-2"><Link href="/operations" className="hidden rounded-full border border-emerald-400/20 bg-emerald-400/10 px-3 py-2 text-xs font-bold text-emerald-300 transition hover:bg-emerald-400/20 sm:block">運作監控</Link><div className="rounded-full border border-white/10 bg-white/5 px-3 py-2 text-xs text-zinc-300"><span className="mr-2 inline-block h-2 w-2 rounded-full bg-emerald-400"/>同步快取</div></div></div>
      <div className="mx-auto mt-4 flex max-w-5xl gap-2 overflow-x-auto pb-1">{days.map(day => <button key={day.offset} onClick={() => setDayOffset(day.offset)} className={`shrink-0 rounded-xl px-4 py-2 text-xs font-bold ${dayOffset === day.offset ? "bg-emerald-400 text-zinc-950" : "bg-[#1e1e1e] text-zinc-400"}`}>{day.offset === 0 ? "今天" : labelDate(day.date)}</button>)}</div>
      <div className="mx-auto mt-3 flex max-w-5xl gap-2 overflow-x-auto pb-1">{leagueTabs.map(tab => <button key={tab} onClick={() => setLeague(tab)} className={`shrink-0 rounded-full border px-3 py-1.5 text-xs ${league === tab ? "border-emerald-400 text-emerald-300" : "border-white/10 text-zinc-500"}`}>{tab}</button>)}</div>
    </header>
    <section className="mx-auto max-w-5xl px-4 pt-6 xl:px-8">
      <div className="mb-4 flex items-center justify-between"><div className="flex items-center gap-2 text-sm text-zinc-400"><CalendarDays size={15}/>{isFallback ? "最新抓取賽事清單" : dayOffset === 0 ? "今日已同步賽事" : labelDate(days.find(d => d.offset === dayOffset)!.date)}</div><span className="text-xs text-zinc-600">30秒自動更新</span></div>
      {query.isLoading ? <div className="rounded-2xl bg-[#1e1e1e] p-6 text-sm text-zinc-500">正在讀取同步賽程…</div> : fixtures.length ? <div className="space-y-3">{fixtures.map(item => <article key={item.fixtureId} className="overflow-hidden rounded-2xl border border-white/5 bg-[#1e1e1e] shadow-xl">
        <button className="w-full p-4 text-left" onClick={() => setOpenId(openId === item.fixtureId ? null : item.fixtureId)}>
          <div className="flex items-center justify-between text-[11px] font-bold text-zinc-500"><span>{localizeLeagueName(item.leagueName)}</span><span className="flex items-center gap-1"><Clock3 size={13}/>{labelTime(item.eventTime)} · 未開賽</span></div>
          <div className="mt-4 grid grid-cols-[1fr_auto_1fr] items-center gap-3"><div className="flex items-center gap-3"><span className="grid h-10 w-10 place-items-center rounded-full bg-white/10 text-xs font-black text-emerald-300">{initials(item.homeTeam)}</span><span className="font-bold leading-tight">{localize(item.homeTeam)}</span></div><div className="rounded-lg bg-black/30 px-3 py-1 text-center font-serif text-lg text-emerald-300">{item.hasPrediction ? item.predictedScore || "—" : "待同步"}</div><div className="flex items-center justify-end gap-3 text-right"><span className="font-bold leading-tight">{localize(item.awayTeam)}</span><span className="grid h-10 w-10 place-items-center rounded-full bg-white/10 text-xs font-black text-amber-200">{initials(item.awayTeam)}</span></div></div>
          <div className="mt-3 flex justify-end text-xs text-zinc-500"><ChevronDown className={`transition ${openId === item.fixtureId ? "rotate-180" : ""}`} size={14}/></div>
        </button>
        {openId === item.fixtureId && <div className="border-t border-white/10 bg-black/20 p-4"><CompactTable item={item}/></div>}
      </article>)}</div> : <div className="rounded-2xl border border-dashed border-white/10 bg-[#1e1e1e] p-8 text-center text-sm text-zinc-500"><ShieldAlert className="mx-auto mb-3" size={22}/>目前沒有已同步賽事。<p className="mt-2 text-xs">最後同步：{query.data?.lastSyncAt ? new Date(query.data.lastSyncAt).toLocaleString("zh-HK", { timeZone: "Asia/Hong_Kong" }) : "未提供"}</p><button onClick={() => query.refetch()} className="mt-4 rounded-lg bg-emerald-400 px-4 py-2 text-xs font-bold text-zinc-950">手動重新讀取同步資料</button></div>}
    </section>
  </main>;
}
