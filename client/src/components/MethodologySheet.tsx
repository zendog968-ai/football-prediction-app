import React, { useState } from "react";
import { AlertTriangle, BookOpen, BrainCircuit, CheckCircle2, Gauge, Info, Sigma, Target } from "lucide-react";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

type Mode = "beginner" | "advanced";
export const READING_MODE_STORAGE_KEY = "aurelia:methodology-reading-mode";

function isMode(value: string | null): value is Mode {
  return value === "beginner" || value === "advanced";
}

export function getStoredReadingMode(): Mode {
  if (typeof window === "undefined") return "beginner";
  try {
    const stored = window.localStorage.getItem(READING_MODE_STORAGE_KEY);
    return isMode(stored) ? stored : "beginner";
  } catch {
    return "beginner";
  }
}

function saveReadingMode(mode: Mode) {
  try {
    window.localStorage.setItem(READING_MODE_STORAGE_KEY, mode);
  } catch {
    // Storage can be disabled or unavailable in private/security-restricted contexts.
  }
}

function Formula({ children }: { children: React.ReactNode }) {
  return <code className="mt-3 block overflow-x-auto rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 font-mono text-[11px] leading-5 text-slate-700">{children}</code>;
}

function MethodItem({ value, icon, title, children }: { value: string; icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return <AccordionItem value={value} className="rounded-2xl border border-slate-200 bg-white px-4 shadow-[0_6px_18px_rgba(15,23,42,.03)]"><AccordionTrigger className="py-4 no-underline hover:no-underline"><span className="flex items-center gap-3 text-left"><span className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-emerald-50 text-emerald-700">{icon}</span><span className="text-sm font-bold text-slate-800">{title}</span></span></AccordionTrigger><AccordionContent className="pb-4 text-xs leading-5 text-slate-600">{children}</AccordionContent></AccordionItem>;
}

function ReadingMode({ mode, setMode }: { mode: Mode; setMode: (mode: Mode) => void }) {
  return <div className="rounded-2xl border border-slate-200 bg-white p-3 shadow-[0_6px_18px_rgba(15,23,42,.03)]"><div className="flex items-center justify-between gap-3"><div><div className="text-xs font-bold text-slate-800">閱讀模式</div><p className="mt-0.5 text-[11px] leading-4 text-slate-500">依需求切換白話導覽或完整數學細節。</p></div><ToggleGroup type="single" value={mode} onValueChange={value => { if (value) setMode(value as Mode); }} aria-label="方法學閱讀模式" variant="outline" size="sm" className="shrink-0 rounded-xl border border-slate-200 bg-slate-50 p-0.5"><ToggleGroupItem value="beginner" aria-label="初學者模式" className="rounded-lg border-0 px-3 text-xs data-[state=on]:bg-[#0a1520] data-[state=on]:text-white">初學者</ToggleGroupItem><ToggleGroupItem value="advanced" aria-label="進階模式" className="rounded-lg border-0 px-3 text-xs data-[state=on]:bg-[#0a1520] data-[state=on]:text-white">進階</ToggleGroupItem></ToggleGroup></div></div>;
}

export default function MethodologySheet() {
  const [mode, setMode] = useState<Mode>(getStoredReadingMode);
  const updateMode = (nextMode: Mode) => {
    setMode(nextMode);
    saveReadingMode(nextMode);
  };
  const advanced = mode === "advanced";
  return <Sheet><SheetTrigger asChild><button type="button" className="inline-flex items-center gap-2 rounded-full border border-amber-200/25 bg-amber-200/10 px-3 py-2 text-[10px] font-bold uppercase tracking-[.14em] text-amber-100 transition hover:bg-amber-200/20" aria-label="開啟方法學說明"><BookOpen size={13} />方法學說明</button></SheetTrigger><SheetContent side="right" className="w-[min(92vw,34rem)] overflow-y-auto border-l border-slate-200 bg-[#f6f7f5] p-0 sm:max-w-none"><SheetHeader className="border-b border-slate-200 bg-[#0a1520] px-6 py-7 text-white"><div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[.2em] text-amber-200"><BookOpen size={14} />Model methodology</div><SheetTitle className="mt-2 font-serif text-3xl text-white">怎麼閱讀這些數字？</SheetTitle><SheetDescription className="mt-2 max-w-md leading-6 text-slate-300">{advanced ? "進階模式會顯示完整公式、符號與術語。" : "初學者模式以白話方式說明，專注於如何閱讀儀表板。"}</SheetDescription></SheetHeader><div className="space-y-4 p-5 sm:p-6"><ReadingMode mode={mode} setMode={updateMode} /><div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs leading-5 text-emerald-900"><strong>{advanced ? "進階閱讀提示：" : "建議順序："}</strong>{advanced ? "公式以歷史折外驗證樣本計算；請同時閱讀樣本數與校準曲線，避免孤立解讀單一指標。" : "先確認篩選切面與樣本數，再看準確率及 Log-Loss，最後以校準曲線和混淆矩陣檢視模型盲點。"}</div><Accordion type="multiple" defaultValue={["validation"]} className="space-y-3"><MethodItem value="validation" icon={<BrainCircuit size={17} />} title="折外驗證與時間序列"><p>每一折會先用較早期賽事訓練，再以模型尚未看過的較晚期賽事測試。這樣能避免用未來資訊評估過去，也更接近實際部署時的情境。</p>{advanced && <><Formula>Train(t₁ … tₖ) → Test(tₖ₊₁ … tₙ)</Formula><p className="mt-3"><strong>進階術語：</strong>OOF（out-of-fold）預測指各驗證折留出的賽事預測；擴張式窗口指每一折會納入更多早期資料重新訓練。</p></>}</MethodItem><MethodItem value="accuracy" icon={<CheckCircle2 size={17} />} title="準確率：猜中結果的比例"><p>模型取主勝、和局、客勝中機率最高的一類，與實際賽果比較。它回答的是「最高機率的判斷有多常猜中」。</p>{advanced && <><Formula>Accuracy = (1 / N) × Σ 𝟙(ŷᵢ = yᵢ)</Formula><p className="mt-3"><strong>符號：</strong>N 為賽事數；ŷᵢ 為模型選出的類別；yᵢ 為實際賽果；𝟙 為條件成立時記為 1 的指示函數。準確率不會反映模型的信心是否合理。</p></>}</MethodItem><MethodItem value="logloss" icon={<Sigma size={17} />} title="Log-Loss：機率分配是否合理"><p>Log-Loss 同時考慮結果和信心。如果模型把錯誤結果給得太高，懲罰會更大；因此數值愈低通常愈好。</p>{advanced && <><Formula>Log-Loss = −(1 / N) × Σ log(pᵢ, yᵢ)</Formula><p className="mt-3"><strong>符號：</strong>pᵢ,yᵢ 是第 i 場對實際發生類別給出的機率。高準確率模型仍可能有較差的 Log-Loss，原因通常是過度自信。</p></>}</MethodItem><MethodItem value="calibration" icon={<Target size={17} />} title="校準曲線：60% 真的接近 60% 嗎？"><p>系統把相近的預測機率放在同一分箱，並比較分箱內的平均預測機率與實際發生率。兩者愈接近，該區間的機率讀法愈可靠。</p>{advanced && <><Formula>p̄ᵦ = (1 / nᵦ) × Σpᵢ　；　ȳᵦ = (1 / nᵦ) × Σ𝟙(yᵢ = class)</Formula><p className="mt-3"><strong>進階術語：</strong>分箱（bin）是相近機率的群組；可靠度（reliability）指 p̄ᵦ 與 ȳᵦ 的貼近程度。校準曲線用於歷史檢查，不是未來結果保證。</p></>}</MethodItem><MethodItem value="matrix" icon={<Info size={17} />} title="混淆矩陣：錯在什麼地方？"><p>列代表實際賽果，欄代表模型預測。對角線是預測正確的場次；非對角線則顯示模型最容易混淆的結果，例如把和局判成主勝。</p>{advanced && <><Formula>Cᵣ,𝚌 = Σ 𝟙(yᵢ = r ∧ ŷᵢ = c)</Formula><p className="mt-3"><strong>進階術語：</strong>類別不平衡表示主勝、和局、客勝數量不同；閱讀矩陣時，應同時看每一列樣本量，不只看最大的格子。</p></>}</MethodItem><MethodItem value="samples" icon={<AlertTriangle size={17} />} title="樣本數警示與分組解讀"><p>篩選越細，樣本越少，指標越容易因少數賽事而波動。介面會依樣本數提示穩健、注意或低樣本。</p>{advanced && <><Formula>n ≥ 300：穩健　｜　100 ≤ n &lt; 300：注意　｜　n &lt; 100：低樣本</Formula><p className="mt-3"><strong>進階術語：</strong>切面（segment）是聯賽、賽季與主客場賽果等篩選組合；低樣本時請避免以細微差距比較模型優劣。</p></>}</MethodItem>{advanced && <MethodItem value="glossary" icon={<Gauge size={17} />} title="進階術語表"><dl className="space-y-3"><div><dt className="font-bold text-slate-800">三分類（multiclass）</dt><dd>本模型同時為主勝、和局、客勝輸出互斥且總和為 1 的機率。</dd></div><div><dt className="font-bold text-slate-800">Elo 評分</dt><dd>依賽果逐場更新的相對強度分數；本版本以賽前 Elo 作為模型特徵之一。</dd></div><div><dt className="font-bold text-slate-800">Dixon–Coles</dt><dd>以主客攻守強度估計低比分足球賽事預期進球，並對特定低比分組合校正的泊松模型框架。</dd></div><div><dt className="font-bold text-slate-800">校準後機率</dt><dd>經校準程序調整後的分類機率，目標是讓預測概率與長期實際發生率更一致。</dd></div><div><dt className="font-bold text-slate-800">未納入訊號</dt><dd>此版本不會即時納入傷停、先發、天氣、紅牌、賠率或臨場戰術調整。</dd></div></dl></MethodItem>}</Accordion></div></SheetContent></Sheet>;
}
