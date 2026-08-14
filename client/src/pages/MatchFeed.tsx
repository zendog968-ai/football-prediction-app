import { useMemo, useState } from "react";
import { CalendarDays, ChevronDown, Clock3, ShieldAlert, Sparkles } from "lucide-react";
import { trpc } from "@/lib/trpc";

const pct = (value: number) => `${Math.round(value * 100)}%`;
const labelTime = (value: string) => new Intl.DateTimeFormat("zh-HK", { hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(value));
const labelDate = (value: Date) => new Intl.DateTimeFormat("zh-HK", { month: "short", day: "numeric", weekday: "short" }).format(value);
const initials = (team: string) => team.split(/\s+/).map(part => part[0]).join("").slice(0, 2).toUpperCase();
const hktDay = (value: Date | string) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Hong_Kong", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(value));
const zh: Record<string, string> = {
  "Major League Soccer": "美國職業足球大聯盟", "Premier League": "英格蘭超級足球聯賽", "La Liga": "西班牙甲組足球聯賽", "UEFA Champions League": "歐洲冠軍聯賽", "UEFA Europa League": "歐洲聯賽", "J1 League": "日本職業足球甲級聯賽",
  "Orlando City SC": "奧蘭多城", "FC Cincinnati": "辛辛那提FC", "Inter Miami": "國際邁阿密", "LA Galaxy": "洛杉磯銀河", "Los Angeles FC": "洛杉磯FC", "Seattle Sounders": "西雅圖海灣者", "Portland Timbers": "波特蘭伐木者", "Club Tijuana": "提華納", "Cruz Azul": "藍十字", "Chicago Fire": "芝加哥火焰",
};
const localize = (name: string) => zh[name] || name;

export default function MatchFeed() {
  const [league, setLeague] = useState("全部");
  const [dayOffset, setDayOffset] = useState(0);
  const [openId, setOpenId] = useState<number | null>(null);
  const query = trpc.prediction.upcomingCache.useQuery(undefined, { refetchInterval: 30_000, refetchOnWindowFocus: true });
  const days = useMemo(() => [0, 1, 2].map(offset => ({ offset, date: new Date(Date.now() + offset * 86400000) })), []);
  const dayFixtures = (query.data?.fixtures || []).filter(item => {
    const matchesLeague = league === "全部" || localize(item.leagueName).includes(league);
    const target = new Date(Date.now() + dayOffset * 86400000);
    const matchesDay = hktDay(item.eventTime) === hktDay(target);
    return matchesLeague && matchesDay;
  });
  const fallbackFixtures = (query.data?.fixtures || []).filter(item => league === "全部" || localize(item.leagueName).includes(league));
  const fixtures = dayFixtures.length ? dayFixtures : fallbackFixtures;
  const isFallback = dayFixtures.length === 0 && fallbackFixtures.length > 0;
  const leagueTabs = ["全部", "英超", "西甲", "歐聯", "歐霸", "日職", "美職"];

  return <main className="min-h-screen bg-[#121212] pb-24 text-zinc-100">
    <header className="sticky top-0 z-20 border-b border-white/10 bg-[#121212]/95 px-4 py-4 backdrop-blur xl:px-8">
      <div className="mx-auto flex max-w-5xl items-center justify-between"><div><p className="text-[10px] font-bold uppercase tracking-[.24em] text-emerald-400">Aurelia Football</p><h1 className="mt-1 text-xl font-black tracking-tight">今日賽程</h1></div><div className="rounded-full border border-white/10 bg-white/5 px-3 py-2 text-xs text-zinc-300"><span className="mr-2 inline-block h-2 w-2 rounded-full bg-emerald-400"/>同步快取</div></div>
      <div className="mx-auto mt-4 flex max-w-5xl gap-2 overflow-x-auto pb-1">{days.map(day => <button key={day.offset} onClick={() => setDayOffset(day.offset)} className={`shrink-0 rounded-xl px-4 py-2 text-xs font-bold ${dayOffset === day.offset ? "bg-emerald-400 text-zinc-950" : "bg-[#1e1e1e] text-zinc-400"}`}>{day.offset === 0 ? "今天" : labelDate(day.date)}</button>)}</div>
      <div className="mx-auto mt-3 flex max-w-5xl gap-2 overflow-x-auto pb-1">{leagueTabs.map(tab => <button key={tab} onClick={() => setLeague(tab)} className={`shrink-0 rounded-full border px-3 py-1.5 text-xs ${league === tab ? "border-emerald-400 text-emerald-300" : "border-white/10 text-zinc-500"}`}>{tab}</button>)}</div>
    </header>
    <section className="mx-auto max-w-5xl px-4 pt-6 xl:px-8">
      <div className="mb-4 flex items-center justify-between"><div className="flex items-center gap-2 text-sm text-zinc-400"><CalendarDays size={15}/>{isFallback ? "最新抓取賽事清單" : dayOffset === 0 ? "今日已同步賽事" : labelDate(days.find(d => d.offset === dayOffset)!.date)}</div><span className="text-xs text-zinc-600">30秒自動更新</span></div>
      {query.isLoading ? <div className="rounded-2xl bg-[#1e1e1e] p-6 text-sm text-zinc-500">正在讀取同步賽程…</div> : fixtures.length ? <div className="space-y-3">{fixtures.map(item => <article key={item.fixtureId} className="overflow-hidden rounded-2xl border border-white/5 bg-[#1e1e1e] shadow-xl">
        <button className="w-full p-4 text-left" onClick={() => setOpenId(openId === item.fixtureId ? null : item.fixtureId)}>
          <div className="flex items-center justify-between text-[11px] font-bold text-zinc-500"><span>{localize(item.leagueName)}</span><span className="flex items-center gap-1"><Clock3 size={13}/>{labelTime(item.eventTime)} · 未開賽</span></div>
          <div className="mt-4 grid grid-cols-[1fr_auto_1fr] items-center gap-3"><div className="flex items-center gap-3"><span className="grid h-10 w-10 place-items-center rounded-full bg-white/10 text-xs font-black text-emerald-300">{initials(item.homeTeam)}</span><span className="font-bold leading-tight">{localize(item.homeTeam)}</span></div><div className="rounded-lg bg-black/30 px-3 py-1 text-center font-serif text-lg text-emerald-300">{item.hasPrediction ? item.predictedScore || "—" : "待同步"}</div><div className="flex items-center justify-end gap-3 text-right"><span className="font-bold leading-tight">{localize(item.awayTeam)}</span><span className="grid h-10 w-10 place-items-center rounded-full bg-white/10 text-xs font-black text-amber-200">{initials(item.awayTeam)}</span></div></div>
          {item.hasPrediction ? <div className="mt-4 grid grid-cols-3 gap-2 text-center text-xs"><span className="rounded-lg bg-emerald-400/10 py-2 text-emerald-200">主 {pct(item.homeWin ?? 0)}</span><span className="rounded-lg bg-amber-300/10 py-2 text-amber-100">和 {pct(item.draw ?? 0)}</span><span className="rounded-lg bg-rose-400/10 py-2 text-rose-200">客 {pct(item.awayWin ?? 0)}</span></div> : <div className="mt-4 rounded-lg border border-amber-300/20 bg-amber-300/5 py-2 text-center text-xs text-amber-100">Poisson 預測資料尚未同步</div>}
          <div className="mt-3 flex items-center justify-between text-xs text-zinc-500"><span>{item.hasPrediction ? item.recommendation || "研究傾向待確認" : "等待 ai_predictions 同步"}</span><span>{item.hasPrediction ? "⭐".repeat(item.confidence) : ""}<ChevronDown className={`ml-2 inline transition ${openId === item.fixtureId ? "rotate-180" : ""}`} size={14}/></span></div>
        </button>
        {openId === item.fixtureId && <div className="border-t border-white/10 bg-black/20 p-4">{item.hasPrediction ? <><div className="flex items-center gap-2 text-sm font-bold text-emerald-300"><Sparkles size={15}/>Poisson 研究分佈</div><div className="mt-4 space-y-3">{[["主勝", item.homeWin ?? 0, "bg-emerald-400"], ["和局", item.draw ?? 0, "bg-amber-300"], ["客勝", item.awayWin ?? 0, "bg-rose-400"]].map(([name, value, color]) => <div key={String(name)}><div className="mb-1 flex justify-between text-xs text-zinc-400"><span>{String(name)}</span><span>{pct(value as number)}</span></div><div className="h-2 rounded-full bg-white/10"><div className={`h-2 rounded-full ${String(color)}`} style={{ width: `${(value as number) * 100}%` }}/></div></div>)}</div></> : <div className="rounded-xl border border-amber-300/20 bg-amber-300/5 p-3 text-xs leading-5 text-amber-100"><strong>【基礎分析】</strong><br/>Poisson機率尚待同步，系統不會以0%或推測值取代。盤口：{item.odds ? `主 ${item.odds.home?.toFixed(2) ?? "待同步"}｜和 ${item.odds.draw?.toFixed(2) ?? "待同步"}｜客 ${item.odds.away?.toFixed(2) ?? "待同步"}` : "尚未同步"}</div>}<div className="mt-5 rounded-xl border border-white/10 bg-white/[.03] p-3 text-xs leading-5 text-zinc-400"><strong className="text-zinc-100">研究標籤</strong><br/>最可能比分：{item.predictedScore || "資料不足"}<br/>研究傾向：{item.recommendation || "資料不足"}<br/>盤口：只有已同步資料會顯示；本頁不生成投注或資金指令。</div></div>}
      </article>)}</div> : <div className="rounded-2xl border border-dashed border-white/10 bg-[#1e1e1e] p-8 text-center text-sm text-zinc-500"><ShieldAlert className="mx-auto mb-3" size={22}/>目前沒有已同步賽事。<p className="mt-2 text-xs">最後同步：{query.data?.lastSyncAt ? new Date(query.data.lastSyncAt).toLocaleString("zh-HK", { timeZone: "Asia/Hong_Kong" }) : "未提供"}</p><button onClick={() => query.refetch()} className="mt-4 rounded-lg bg-emerald-400 px-4 py-2 text-xs font-bold text-zinc-950">手動重新讀取同步資料</button></div>}
    </section>
  </main>;
}
