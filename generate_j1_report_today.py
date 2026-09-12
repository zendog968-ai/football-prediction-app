import json
import os

def format_percent(val):
    return f"{val * 100:.1f}%"

def main():
    with open("/tmp/research_j1_20260905.json", "r") as f:
        data = json.load(f)
    
    if not data.get("ok"):
        print("No research data found.")
        return

    report = []
    report.append("# 今日日本職業聯賽 (J1) 深度研究報告")
    report.append(f"\n**資料日期：2026-09-05 HKT**")
    report.append("\n國師已調用系統預測模組，完成今日日本職業足球甲組聯賽（J1）的深度模型研究。本次分析直接調用已部署的即時研究模組，採用 Dixon–Coles 歷史攻防模型與去水市場 HDA 賠率融合。")

    report.append("\n## 🏆 重點賽事：福岡黃蜂 vs 水戶蜀葵")
    report.append(f"\n**開賽時間：2026-09-05 18:00 (HKT)**")
    
    outcomes = data["outcomes"]
    report.append("\n### 📊 核心機率分布")
    report.append(f"- **主勝 (Home Win):** {format_percent(outcomes['homeWin'])}")
    report.append(f"- **和局 (Draw):** {format_percent(outcomes['draw'])}")
    report.append(f"- **客勝 (Away Win):** {format_percent(outcomes['awayWin'])}")
    
    dc = data["doubleChance"]
    report.append(f"- **雙重機率 1X (主隊不敗):** {format_percent(dc['oneX'])}")
    report.append(f"- **雙重機率 X2 (客隊不敗):** {format_percent(dc['xTwo'])}")

    report.append("\n### 🔥 進階盤口預測")
    markets = data["compactMarkets"]
    for m in markets:
        if m["market"] == "讓球盤 (Handicap)":
            report.append(f"- **讓球盤:** {m['selection']} —— 命中率 {format_percent(m['probability'])}")
        elif m["market"] == "入球大細 2.5":
            report.append(f"- **入球大細 (2.5球):** {m['selection']} —— 命中率 {format_percent(m['probability'])}")

    report.append("\n### 🎯 最高機率波膽 Top 3")
    for i, s in enumerate(data["topScorelines"]):
        report.append(f"{i+1}. **{s['score']}** —— {format_percent(s['probability'])}")

    report.append("\n### 🔍 國師戰術判讀與風險分析")
    risk = data["preMatchRisk"]
    report.append(f"- **風險等級:** {'⚠️ ' if risk['tier'] == 'caution' else '✅ '}{risk['tier'].upper()}")
    if risk.get("reasons"):
        report.append("- **風險因素:**")
        for r in risk["reasons"]:
            report.append(f"  - {r}")
    
    report.append(f"\n- **國師點評:** 福岡黃蜂主場作戰具備一定優勢，模型主勝率接近五成。首選波膽 **1-1** 反映了比賽可能出現的拉鋸態勢。雖然主隊不敗 (1X) 達 **75.5%**，但需注意至少一隊近期防守波動較大，1-0 或 2-1 的窄勝格局比大勝更符合目前模型分布。")
    
    report.append(f"\n- **模型來源:** {data['calibrationLabel']}")
    
    report.append("\n---")
    report.append("\n**⚠️ 資料限制與性質聲明：**")
    report.append("1. 本報告僅針對今日 J1 聯賽中具備完整模型覆蓋的場次進行深度研究。")
    report.append("2. 分析內容基於 Dixon–Coles 歷史數據與去水市場隱含機率，僅供戰術參考，不構成任何投注或資金建議。")
    report.append("3. 如需針對特定場次進行「先發名單調整重算」，請隨時告知國師。")

    with open("/home/ubuntu/j1_report_final.md", "w") as f:
        f.write("\n".join(report))

if __name__ == "__main__":
    main()
