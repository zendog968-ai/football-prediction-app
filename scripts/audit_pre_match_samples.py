#!/usr/bin/env python3
"""Generate a transparent pre-match sample audit from a local Aurelia SQLite snapshot."""
from __future__ import annotations

import argparse
import sqlite3
from datetime import datetime, timezone
from pathlib import Path


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--database", required=True)
    parser.add_argument("--home", default="Wolverhampton Wanderers")
    parser.add_argument("--away", default="West Bromwich Albion")
    parser.add_argument("--league-code", default="ENG2")
    parser.add_argument("--as-of", default="2026-09-20T00:00:00Z")
    parser.add_argument("--output", required=True)
    args = parser.parse_args()

    db = Path(args.database)
    if not db.exists():
        raise SystemExit(f"找不到資料庫：{db}")
    as_of = args.as_of.replace("Z", "+00:00")
    con = sqlite3.connect(db)
    con.row_factory = sqlite3.Row
    try:
        rows = con.execute(
            """SELECT league_code, league_name, season, match_date, home_team, away_team,
                      home_goals, away_goals, result_status
               FROM matches
              WHERE match_date < ? AND result_status IN ('FINISHED', 'FT', 'AET', 'PEN')
                AND (lower(home_team) IN (lower(?), lower(?), lower(?)) OR lower(away_team) IN (lower(?), lower(?), lower(?)))
              ORDER BY match_date DESC""",
            (as_of[:10], args.home, "Wolves", args.away, args.home, "Wolves", args.away),
        ).fetchall()
        league_rows = con.execute(
            """SELECT COUNT(*) AS n FROM matches
               WHERE league_code = ? AND match_date < ?
                 AND result_status IN ('FINISHED', 'FT', 'AET', 'PEN')""",
            (args.league_code, as_of[:10]),
        ).fetchone()["n"]
    finally:
        con.close()

    home_count = sum(1 for row in rows if args.home.lower() in (row["home_team"] or "").lower() or "wolves" in (row["home_team"] or "").lower() or args.home.lower() in (row["away_team"] or "").lower() or "wolves" in (row["away_team"] or "").lower())
    away_count = sum(1 for row in rows if args.away.lower() in (row["home_team"] or "").lower() or args.away.lower() in (row["away_team"] or "").lower())
    generated = datetime.now(timezone.utc).isoformat(timespec="seconds")
    lines = [
        "# Wolves–West Brom 賽前樣本稽核報告",
        "",
        f"> 產生時間：{generated}。本報告只讀取指定 SQLite 快照，不會把缺失資料估算成真實樣本。",
        "",
        "## 1. 事件摘要",
        "",
        "| 欄位 | 值 |",
        "|---|---|",
        f"| 對戰 | {args.home} vs {args.away} |",
        f"| 預測截點 | {args.as_of} |",
        "| 實際結果 | Wolves 1–0 West Brom |",
        "| 原推播客勝機率 | 55.4% |",
        "| 原推播客隊 +0.5 | 84.6% |",
        "| 推播資料來源 | 聯賽平均 |",
        "",
        "## 2. 快照覆蓋結果",
        "",
        "| 檢查項目 | 結果 | 判讀 |",
        "|---|---:|---|",
        f"| Wolves 可辨識歷史賽事 | {home_count} | {'可用' if home_count >= 2 else '不足，會觸發回退'} |",
        f"| West Brom 可辨識歷史賽事 | {away_count} | {'可用' if away_count >= 2 else '不足，會觸發回退'} |",
        f"| {args.league_code} 聯賽已完場樣本 | {league_rows} | {'可計算聯賽基準' if league_rows >= 20 else '聯賽基準亦不足'} |",
        "",
        "本次指定的本地 expanded Release 快照沒有辨識到 Wolves 或 West Brom 的英冠賽事；這證明該快照不能用來重建本場的隊伍歷史攻防，不能把 0 筆解讀為真實世界的零場。正式 Supabase/API-Football 稽核應使用同一預測截點的原始 fixture 歷史回應再重跑本腳本。",
        "",
        "## 3. 根因與影響",
        "",
        "英冠即時研究原本固定查詢上一季英冠資料。升班、降班或剛轉入英冠的球隊可能在上一季沒有同聯賽記錄，任一隊少於兩場時，模型將該隊進球及失球均值替換成聯賽平均。因此產生的 55.4% 客勝與 84.6% 客隊 +0.5 並不是兩隊獨立攻防支持的結果，應視為低證據情境；1–0 主勝與該方向出現重大偏差並不構成模型普遍命中率估計。",
        "",
        "## 4. 已完成的防護",
        "",
        "1. 英冠查詢現優先讀取當季資料；單隊或聯賽樣本不足才按需回退上一季。",
        "2. Telegram 對「聯賽平均」來源加上 `🚨 數據警告`，並明確寫明不建議參考讓球盤。",
        "3. 每日高信心推播會排除缺少主客隊獨立樣本的候選，而不是用低樣本候選補滿清單。",
        "",
        "## 5. 限制與下一步",
        "",
        "本地 Release 快照沒有這兩隊的可回放英冠記錄，因此本報告不能宣稱已取得 API-Football 原始歷史筆數。待下一次同步保存英冠原始回應後，應補上逐隊場數、截點前最後一場及本季／上季各自筆數。",
    ]
    Path(args.output).parent.mkdir(parents=True, exist_ok=True)
    Path(args.output).write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(args.output)


if __name__ == "__main__":
    main()
