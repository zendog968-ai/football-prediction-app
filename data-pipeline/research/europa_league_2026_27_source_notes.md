# 2026–27 歐霸盃資料來源核對筆記

更新時間：2026-08-13（UTC+8）

## 官方賽制與近期賽果

UEFA 的資格賽說明指出，2026–27 歐霸盃資格賽共有 52 支球隊，賽期為 2026-07-09 至 2026-08-27；13 支球隊直接進入聯賽階段，其他席位由資格賽勝隊及歐冠附加賽落敗隊補足。聯賽階段抽籤日期為 2026-08-28。[1]

截至本次查核，第一與第二資格賽已完成；第三資格賽首回合也已完成，而多場次回合在 2026-08-13 排定。官方來源可逐場提供主客隊、日期與比分，適合作為當季近期賽果的最終核對來源。[1]

## 可重現資料來源

FBref 的 2026–27 歐霸盃頁顯示本賽季的資格賽對戰、已完成比分與未賽賽程，並標示聯賽階段將有 36 隊、每隊 8 場比賽。[2] 這可用於交叉核對來源完整性，但公開頁面並非本管線的批量下載契約。

現有的 `schochastics/football-data` 公開Parquet使用 `UEFA EL` 作為歐霸盃競賽標籤，包含 14,679 場比賽，時間從 1955-06-04 至 2025-08-28；資料集以 ODC-BY 授權發布，並明示較早期資料可能有來源或球隊沿革誤差。[3] 因此，管線可採 2021–22 至 2025–26 的五個完整賽季作為可重現的訓練窗口；2026–27 已完成資格賽則以 UEFA 官方結果增量加入。

ClubElo 的公開排名頁提供日期化俱樂部Elo快照及賽果後評分變動，適合做當日對照與資料品質診斷，但不是本模型的訓練特徵來源。[4] 模型仍將使用由資料庫內、按開賽前狀態更新的競賽內部動態Elo，以維持折外驗證與推論的一致性。沒有相容公開xG時，`home_xg` 與 `away_xg` 必須維持NULL。

## 當季每日刷新端點

已驗證 UEFA 的公開競賽端點將歐霸盃標記為 `competitionId=14`、`code=UEL`。[5] 當季賽事端點採用**賽季結束年份**，所以 2026–27 必須使用 `seasonYear=2027`：`https://match.uefa.com/v5/matches?competitionId=14&seasonYear=2027&limit=500&offset=0&order=ASC`。端點提供正式 `status`、`kickOffTime.date`、主客隊國際名稱與 `score.regular`；管線只保留 `FINISHED` 場次及正規時間比分，以維持勝／和／負三分類口徑。[6]

以 2026-08-13 為資料截點時，候選資料庫包含 910 場歐霸盃比賽、2021–22 至 2026–27 共六季，其中 44 場是當季已完成資格賽。歷史五季來源無相容xG或終盤賠率，相關欄位均保持NULL。

## 參考資料

[1]: https://www.uefa.com/uefaeuropaleague/news/02a6-20e5db0029dd-8241a8d00925-1000--europa-league-qualifying-fixtures-results-dates-how-it-works/ "UEFA：Europa League qualifying: Fixtures, results, dates, how it works"
[2]: https://fbref.com/en/comps/19/Europa-League-Stats "FBref：2026–2027 Europa League Stats"
[3]: https://github.com/schochastics/football-data "schochastics/football-data：公開足球賽果資料集"
[4]: http://clubelo.com/ "ClubElo：Football Club Elo Ratings"
[5]: https://comp.uefa.com/v2/competitions?limit=50&offset=0 "UEFA 官方競賽端點"
[6]: https://match.uefa.com/v5/matches?competitionId=14&seasonYear=2027&limit=500&offset=0&order=ASC "UEFA 官方歐霸盃2026–27賽事端點"
