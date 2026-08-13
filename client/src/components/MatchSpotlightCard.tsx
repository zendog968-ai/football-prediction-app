import React from "react";
import { AlertTriangle, CalendarDays, MapPin, ShieldCheck, Target } from "lucide-react";

export type SpotlightCardData = {
  competition: string;
  stage: string;
  kickoffLocal: string;
  venue: string;
  homeTeam: string;
  awayTeam: string;
  probabilities: { home: number; draw: number; away: number };
  expectedGoals: { home: number; away: number };
  scorelines: Array<{ score: string; probability: number }>;
  totalGoals: { under25: number; over25: number; bothTeamsScore: number };
  factors: Array<{ effect: "home" | "away" | "balance"; title: string; detail: string }>;
  notice: string;
  sources: Array<{ label: string; url: string }>;
};

export default function MatchSpotlightCard({ match }: { match: SpotlightCardData }) {
  return <section className="relative overflow-hidden rounded-[2rem] border border-[#d9c68d]/55 bg-[#0a1520] p-6 text-white shadow-[0_18px_50px_rgba(2,12,22,.13)] lg:p-8"><div className="pointer-events-none absolute inset-0 opacity-30 [background-image:linear-gradient(rgba(255,255,255,.05)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.05)_1px,transparent_1px)] [background-size:36px_36px]" /><div className="pointer-events-none absolute -right-20 -top-20 h-60 w-60 rounded-full bg-amber-300/10 blur-3xl" /><div className="relative"><div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start"><div><div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[.2em] text-amber-200"><Target size={14} />焦點賽事範疇提示</div><h2 className="mt-3 font-serif text-3xl leading-tight text-white sm:text-4xl">{match.homeTeam} <span className="px-1 text-amber-200">vs</span> {match.awayTeam}</h2><div className="mt-3 flex flex-wrap gap-x-4 gap-y-2 text-xs text-slate-300"><span className="inline-flex items-center gap-1.5"><CalendarDays size={13} />{match.competition} · {match.stage}</span><span className="inline-flex items-center gap-1.5"><MapPin size={13} />{match.venue}</span></div></div><div className="rounded-2xl border border-amber-200/20 bg-amber-200/[.07] px-3 py-2 text-xs text-amber-100"><span className="font-bold">Out-of-Scope</span><br />不提供數值預測</div></div><div className="mt-6 rounded-3xl border border-amber-200/20 bg-amber-200/[.07] p-5"><div className="flex gap-3"><AlertTriangle className="mt-0.5 shrink-0 text-amber-200" size={19} /><div><h3 className="text-sm font-bold text-amber-100">此盃賽不屬於目前校準模型的推論範圍</h3><p className="mt-2 max-w-3xl text-sm leading-6 text-slate-300">平台僅對13個已驗證聯賽內的對戰輸出校準機率。此場屬跨賽事盃賽，沒有相容的訓練與校準樣本，因此不顯示主勝、和局、客勝、比分分佈、預期進球或 +EV 數字。</p><p className="mt-2 text-xs leading-5 text-slate-400">{match.notice}</p><div className="mt-3 flex flex-wrap gap-x-4 gap-y-1">{match.sources.map(source => <a key={source.url} href={source.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs font-semibold text-amber-200 underline decoration-amber-200/40 underline-offset-4 transition hover:text-white"><ShieldCheck size={12} />{source.label}</a>)}</div></div></div></div></div></section>;
}
