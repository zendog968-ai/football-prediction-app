import json
import os
from datetime import datetime, timedelta

def load_json(path):
    if os.path.exists(path):
        with open(path, 'r', encoding='utf-8') as f:
            return json.load(f)
    return None

def main():
    results = load_json('/tmp/mls_research_results.json')
    names = load_json('mls_team_names.json') or {}
    
    if not results:
        print("Error: No research data found")
        return

    report = []
    report.append("# 今日美國職業聯賽（MLS）深度研究報告\n")
    report.append(f"**研究日期：** 2026-09-06 (HKT)  ")
    report.append("**資料來源：** Aurelia 部署之 Dixon–Coles 歷史攻防模型 + 去水市場 HDA 融合  ")
    report.append("**報告性質：** 國師戰術與數據研究參考\n")
    
    report.append("## 🏆 重點賽事核心機率摘要\n")
    report.append("| HKT 開賽 | 賽事 | 主勝 | 和局 | 客勝 | 雙重機率 | 大/小 2.5 | 讓球參考 |")
    report.append("|:---:|:---|:---:|:---:|:---:|:---|:---|:---|")
    
    for item in results:
        r = item['research']
        if not r: continue
        
        home = f"{names.get(r['homeTeam'], r['homeTeam'])} ({r['homeTeam']})"
        away = f"{names.get(r['awayTeam'], r['awayTeam'])} ({r['awayTeam']})"
        
        # Convert UTC to HKT
        utc_dt = datetime.fromisoformat(item['fixture']['date'].replace('Z', '+00:00'))
        hkt_dt = utc_dt + timedelta(hours=8)
        kickoff_hkt = hkt_dt.strftime("%m-%d %H:%M")
        
        out = r['outcomes']
        dc = r['doubleChance']
        
        total_25 = next((m for m in r['compactMarkets'] if m['market'] == "入球大細 2.5"), {"selection": "-", "probability": 0})
        handicap = next((m for m in r['compactMarkets'] if m['market'] == "讓球盤 (Handicap)"), {"selection": "-", "probability": 0})
        
        report.append(f"| {kickoff_hkt} | {home} vs {away} | {out['homeWin']*100:.1f}% | {out['draw']*100:.1f}% | {out['awayWin']*100:.1f}% | 1X: {dc['oneX']*100:.1f}%<br>X2: {dc['xTwo']*100:.1f}% | {total_25['selection']} ({total_25['probability']*100:.1f}%) | {handicap['selection']} ({handicap['probability']*100:.1f}%) |")

    report.append("\n---\n")
    report.append("## 🎯 最高機率波膽 Top 3\n")
    for item in results:
        r = item['research']
        if not r: continue
        home = f"{names.get(r['homeTeam'], r['homeTeam'])}"
        away = f"{names.get(r['awayTeam'], r['awayTeam'])}"
        scores = "; ".join([f"**{s['score']}** ({s['probability']*100:.1f}%)" for s in r['topScorelines']])
        report.append(f"*   **{home} vs {away}：** {scores}")

    report.append("\n---\n")
    report.append("## 🔍 國師戰術判讀與風險分層\n")
    
    for item in results:
        r = item['research']
        if not r: continue
        home = f"{names.get(r['homeTeam'], r['homeTeam'])}"
        away = f"{names.get(r['awayTeam'], r['awayTeam'])}"
        risk = r.get('preMatchRisk', {'tier': 'standard', 'reasons': []})
        tier_label = "⚠️ 注意 (Caution)" if risk['tier'] == 'caution' else "✅ 標準 (Standard)"
        
        report.append(f"### {home} vs {away}")
        report.append(f"*   **風險等級：** {tier_label}")
        if risk['reasons']:
            report.append(f"*   **關鍵風險：** {', '.join(risk['reasons'])}")
        
        # Tactical commentary
        if r['outcomes']['homeWin'] > 0.6:
            comment = f"模型顯示 {home} 在主場具備統治級優勢，進攻端火力全開，主勝信心極高。"
        elif r['outcomes']['awayWin'] > 0.5:
            comment = f"作客的 {away} 在數據模型中被高度看好，防守反擊效率預計將主導比賽節奏。"
        elif r['compactMarkets'] and any(m['market'] == "入球大細 2.5" and m['selection'].startswith("大") and m['probability'] > 0.7 for m in r['compactMarkets']):
            comment = f"兩隊攻強守弱特徵明顯，預期將演變成一場進攻大戰，大球機率極高。"
        else:
            comment = f"兩隊實力均勢，MLS 賽場常見的後期體能博弈將是關鍵，建議關注 1X 或 X2 的防禦價值。"
            
        report.append(f"*   **戰術點評：** {comment}\n")

    with open('/home/ubuntu/mls_report_final.md', 'w', encoding='utf-8') as f:
        f.write("\n".join(report))

if __name__ == "__main__":
    main()
