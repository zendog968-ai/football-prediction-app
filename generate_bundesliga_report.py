import json
import os

def load_json(path):
    if os.path.exists(path):
        with open(path, 'r', encoding='utf-8') as f:
            return json.load(f)
    return None

def main():
    research_data = load_json('/tmp/bundesliga_research.json')
    exact_data = load_json('/tmp/gladbach_exact.json')
    names = load_json('bundesliga_team_names.json') or {}
    
    if not research_data:
        print("Error: No research data found")
        return

    # Fix the Gladbach result in research_data
    for item in research_data['results']:
        if item['target']['fixtureId'] == 1575153 and exact_data:
            item['research'] = exact_data['research']
            item['error'] = None

    # Filter only today's Bundesliga matches (excluding the already passed Stuttgart match)
    today_fixtures = [
        r for r in research_data['results'] 
        if r.get('research') and r['research']['fixtureId'] != 1635741
    ]
    
    report = []
    report.append("# 今晚德國甲組聯賽（Bundesliga）深度研究報告\n")
    report.append(f"**研究日期：** 2026-09-05 (HKT)  ")
    report.append("**資料來源：** 已部署 Dixon–Coles 歷史攻防模型、低比分 Tau 參數校正、去水市場 HDA 50/50 融合  ")
    report.append("**報告性質：** 學術與戰術研究參考，不構成投注或資金建議\n")
    
    report.append("## 🏆 重點賽事核心機率摘要\n")
    report.append("| HKT 開賽 | 賽事 | 主勝 | 和局 | 客勝 | 雙重機率 | 大/小 2.5 | 讓球參考 |")
    report.append("|:---:|:---|:---:|:---:|:---:|:---|:---|:---|")
    
    for item in today_fixtures:
        r = item['research']
        home = f"{names.get(r['homeTeam'], r['homeTeam'])} ({r['homeTeam']})"
        away = f"{names.get(r['awayTeam'], r['awayTeam'])} ({r['awayTeam']})"
        
        # Format kickoff time to HKT (UTC+8)
        # 2026-09-05T13:30:00+00:00 -> 21:30
        kickoff_hkt = "21:30" # Based on the query results
        
        out = r['outcomes']
        dc = r['doubleChance']
        
        total_25 = next((m for m in r['compactMarkets'] if m['market'] == "入球大細 2.5"), {"selection": "-", "probability": 0})
        handicap = next((m for m in r['compactMarkets'] if m['market'] == "讓球盤 (Handicap)"), {"selection": "-", "probability": 0})
        
        report.append(f"| {kickoff_hkt} | {home} vs {away} | {out['homeWin']*100:.1f}% | {out['draw']*100:.1f}% | {out['awayWin']*100:.1f}% | 1X: {dc['oneX']*100:.1f}%<br>X2: {dc['xTwo']*100:.1f}% | {total_25['selection']} ({total_25['probability']*100:.1f}%) | {handicap['selection']} ({handicap['probability']*100:.1f}%) |")

    report.append("\n---\n")
    report.append("## 🎯 最高機率波膽 Top 3\n")
    for item in today_fixtures:
        r = item['research']
        home = f"{names.get(r['homeTeam'], r['homeTeam'])}"
        away = f"{names.get(r['awayTeam'], r['awayTeam'])}"
        scores = "; ".join([f"**{s['score']}** ({s['probability']*100:.1f}%)" for s in r['topScorelines']])
        report.append(f"*   **{home} vs {away}：** {scores}")

    report.append("\n---\n")
    report.append("## 🔍 國師戰術判讀與風險分層\n")
    
    for item in today_fixtures:
        r = item['research']
        home = f"{names.get(r['homeTeam'], r['homeTeam'])}"
        away = f"{names.get(r['awayTeam'], r['awayTeam'])}"
        risk = r.get('preMatchRisk', {'tier': 'standard', 'reasons': []})
        tier_label = "⚠️ 注意 (Caution)" if risk['tier'] == 'caution' else "✅ 標準 (Standard)"
        
        report.append(f"### {home} vs {away}")
        report.append(f"*   **風險等級：** {tier_label}")
        if risk['reasons']:
            report.append(f"*   **關鍵風險：** {', '.join(risk['reasons'])}")
        
        # Tactical commentary based on probabilities
        if r['outcomes']['homeWin'] > 0.6:
            comment = f"模型顯示 {home} 具備顯著主場統治力，高入球率與主勝方向高度契合。"
        elif r['outcomes']['awayWin'] > 0.45:
            comment = f"儘管作客，{away} 的攻防轉換效率仍被模型看高，X2 具備較強的戰術防禦價值。"
        elif r['outcomes']['draw'] > 0.3:
            comment = f"兩隊實力極為接近，預期將陷入中場拉鋸戰，和局風險極高。"
        else:
            comment = f"典型的德甲均勢格局，勝負取決於下半場的體能分配與換人調整。"
            
        report.append(f"*   **戰術點評：** {comment}\n")

    with open('/home/ubuntu/bundesliga_report_final.md', 'w', encoding='utf-8') as f:
        f.write("\n".join(report))

if __name__ == "__main__":
    main()
