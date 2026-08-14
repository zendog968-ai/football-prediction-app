# Telegram研究通知：備用賠率來源評估

**評估日期：**2026-08-14（GMT+8）  
**作者：**Manus AI

## 決策背景

使用者已要求停止The Odds API整合，因此不會再以其未通過驗證的憑證讀取任何盤口或建立相依排程。香港馬會的公開盤口頁與既有GraphQL介面均不具可授權、可重現的自動化存取條件，故不作資料來源。本文件只比較具帳戶授權的第三方供應商，通知輸出維持為模型Lean、資料限制與風險摘要，而非下注或資金指令。

| 來源 | 已公開文件可證實的能力 | 對本專案需求的適用性 | 前置條件與風險 |
|---|---|---|---|
| FootyStats | 文件明確描述足球統計、大小球、BTTS、入球及其他統計；套餐可按聯賽訂閱。[1] | 可補充統計與賽後資料，但公開文件**未明確保證**亞洲讓球盤、開盤／最新盤歷史或每次變動快照。 | 需先以帳戶Key驗證實際端點與所選聯賽資料；未證實前不啟用盤路走勢。 |
| API-Football（API-Sports） | 文件列出賽前／即場odds、博彩公司與bets端點；以`x-apisports-key`授權，`/status`可無額度驗證帳戶狀態。[2] | 可作較低門檻的盤口與賽果備用來源；文件搜尋結果顯示讓球類別，但尚需實測目標聯賽的亞洲讓球細節與歷史可用性。 | 需使用者建立帳戶與Key；依方案、聯賽和博彩公司檢查。 |
| Sportmonks Premium Odds Feed | 官方文件明確列出亞洲讓球、大小球、盤口開盤及每次變動、每筆更新時間、賽前約每分鐘更新，以及開賽後7天的變動歷史。[3] [4] | **最符合**讓球盤、盤路走勢與賽後複盤資料契約；可直接按fixture、market與bookmaker追蹤。 | 需要Sportmonks Football API帳戶及Premium Odds Feed附加方案；先用Token驗證所選16個範圍與所需市場／博彩公司。 |

## 建議的決策門檻

若目標是完整實作「亞洲讓球＋開盤至臨場走勢＋賽後結算」，應由使用者在 **Sportmonks Premium Odds Feed** 與成本較低、但覆蓋待驗證的 **API-Football** 中選擇。FootyStats只在其帳戶實測證實亞洲讓球、盤口時間戳與目標聯賽覆蓋後才可採用；否則只可作統計補充，不能支撐盤路監控。

任何來源若未回傳明確fixture、來源時間、market、handicap／total line及最終賽果，系統將標記資料不足並停止該場研究摘要，而不會填補或推測盤口。

## References

[1] [FootyStats API Overview](https://footystats.org/api/documentations)

[2] [API-Football v3 Documentation](https://api-sports.io/documentation/football/v3)

[3] [Sportmonks Premium Odds Feed Documentation](https://docs.sportmonks.com/v3/endpoints-and-entities/endpoints/premium-odds-feed)

[4] [Sportmonks Premium Odds Feed Overview](https://www.sportmonks.com/football-api/premium-odds-feed/)
