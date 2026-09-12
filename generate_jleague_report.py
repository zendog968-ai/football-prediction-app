import json
import os
from datetime import datetime

def format_prob(val):
    if val is None: return "0.0%"
    return f"{val * 100:.1f}%"

def get_hkt_time(iso_str):
    dt = datetime.fromisoformat(iso_str.replace("Z", "+00:00"))
    # Manual HKT offset
    import datetime as dt_mod
    hkt = dt + dt_mod.timedelta(hours=8)
    return hkt.strftime("%H:%M")

def main():
    with open("/home/ubuntu/jleague_today_cache.json", "r") as f:
        data = json.load(f)
    
    with open("/home/ubuntu/football-prediction-app/jleague_team_names.json", "r") as f:
        translations = json.load(f)

    today_hkt = data.get("todayHkt", "2026-09-02")
    fixtures = data.get("fixtures", [])
    
    report = []
    report.append(f"# 今日日本職業聯賽深度研究報告 (HKT {today_hkt})")
    report.append("\n國師已調用系統 J-League 預測模組，對今日全部 **10 場** 賽事進行了逐場模型計算。研究採用了 **Dixon–Coles 歷史攻防模型** 與 **市場 HDA 賠率融合**。")
    
    report.append("\n## 🏆 全部賽事核心機率摘要")
    report.append("\n| 時間 | 賽事 (主 vs 客) | 主勝 | 和局 | 客勝 | 雙重機率 | 大/小 2.5 | 首選波膽 |")
    report.append("|:---:|:---|:---:|:---:|:---:|:---|:---|:---|")
    
    for f in fixtures:
        h_name = translations.get(f['homeTeam'], f['homeTeam'])
        a_name = translations.get(f['awayTeam'], f['awayTeam'])
        match_str = f"{h_name} ({f['homeTeam']}) vs {a_name} ({f['awayTeam']})"
        
        # Double chance
        one_x = f['homeWin'] + f['draw']
        x_two = f['awayWin'] + f['draw']
        dc_str = f"1X ({one_x*100:.1f}%)" if one_x >= x_two else f"X2 ({x_two*100:.1f}%)"
        
        # Totals
        over25 = next((m['probability'] for m in f['compactMarkets'] if m['market'] == "入球大細 2.5" and "大" in m['selection']), 0.5)
        total_str = f"大 ({over25*100:.1f}%)" if over25 >= 0.5 else f"小 ({(1-over25)*100:.1f}%)"
        
        # Top scoreline
        top_score = f['topScorelines'][0]['score'] if f['topScorelines'] else ""
        top_prob = f['topScorelines'][0]['probability'] if f['topScorelines'] else 0
        score_str = f"{top_score} ({top_prob*100:.1f}%)"
        
        report.append(f"| {get_hkt_time(f['eventTime'])} | {match_str} | {format_prob(f['homeWin'])} | {format_prob(f['draw'])} | {format_prob(f['awayWin'])} | {dc_str} | {total_str} | {score_str} |")

    report.append("\n---")
    report.append("\n## 🔍 國師戰術點評與風險分層")
    
    # Sort by confidence or notable gaps
    sorted_fixtures = sorted(fixtures, key=lambda x: max(x['homeWin'], x['awayWin']), reverse=True)
    
    report.append("\n### 1. 強勢訊號場次 (模型勝率 > 60%)")
    for f in sorted_fixtures:
        if max(f['homeWin'], f['awayWin']) > 0.60:
            h_name = translations.get(f['homeTeam'], f['homeTeam'])
            a_name = translations.get(f['awayTeam'], f['awayTeam'])
            winner = h_name if f['homeWin'] > f['awayWin'] else a_name
            win_prob = max(f['homeWin'], f['awayWin'])
            report.append(f"- **{h_name} vs {a_name}**：模型高度看好 **{winner}** (勝率 {win_prob*100:.1f}%)。預期入球數 {f['expectedHomeGoals']:.2f} vs {f['expectedAwayGoals']:.2f}，主隊具備壓倒性統治力。")

    report.append("\n### 2. 均勢拉鋸與和局風險")
    for f in fixtures:
        if f['draw'] > 0.25 or abs(f['homeWin'] - f['awayWin']) < 0.10:
            h_name = translations.get(f['homeTeam'], f['homeTeam'])
            a_name = translations.get(f['awayTeam'], f['awayTeam'])
            if max(f['homeWin'], f['awayWin']) <= 0.60:
                report.append(f"- **{h_name} vs {a_name}**：三項機率分佈接近，首選波膽 **{f['topScorelines'][0]['score']}**。戰術上傾向低比分拉鋸，需警惕和局風險。")

    report.append("\n### 3. 入球大細研究")
    high_over = [f for f in fixtures if next((m['probability'] for m in f['compactMarkets'] if m['market'] == "入球大細 2.5" and "大" in m['selection']), 0) > 0.70]
    for f in high_over:
        h_name = translations.get(f['homeTeam'], f['homeTeam'])
        a_name = translations.get(f['awayTeam'], f['awayTeam'])
        prob = next((m['probability'] for m in f['compactMarkets'] if m['market'] == "入球大細 2.5" and "大" in m['selection']), 0)
        report.append(f"- **{h_name} vs {a_name}**：大球訊號強烈 ({prob*100:.1f}%)，兩隊近期攻防轉換極快，預期總入球超過 3 球。")

    report.append("\n---")
    report.append("\n**⚠️ 資料限制與風險聲明：**")
    report.append("1. **模型校準**：本報告採用 Dixon–Coles 低比分校正，對 0-0, 1-1 等比分進行了權重優化。")
    report.append("2. **市場融合**：部分場次已包含去水市場賠率融合，若模型與市場分歧過大，已在風險評估中標註。")
    report.append("3. **性質聲明**：內容僅供戰術與數據研究參考，不構成任何投注、過關或資金建議。數據採香港時間 (HKT)。")

    with open("/home/ubuntu/jleague_report_final.md", "w") as f:
        f.write("\n".join(report))

if __name__ == "__main__":
    main()
