# HKJC 足球讓球盤來源查核

**查核日期：** 2026-08-17（GMT+8）

## 官方頁面結論

[HKJC Football Handicap](https://bet.hkjc.com/en/football/hdc) 是公開可瀏覽的讓球盤頁。頁面展示賽事開賽時間、主客隊、讓球線及兩邊參考賠率；例如頁面資料把主隊與客隊的對應線位分別以 `[-0.5/-1]` 與 `[+0.5/+1]` 顯示，並列出兩側十進制賠率。頁面同時聲明所示賠率僅供參考，最終賠率以投注被接納時為準。[1]

[HKJC Handicap Bet Type](https://is.hkjc.com/football/info/en/betting/bettypes_hdc.asp) 說明讓球按法定比賽時間全場結果結算，不包括加時及互射十二碼；四分之一球盤可出現半輸／半退或半贏／半退的結果。[2]

## 自動化可用性判定

以一般 HTTP 直接取得 `https://bet.hkjc.com/en/football/hdc` 時，只取得 JavaScript 應用程式載入頁，而非可直接解析的盤口列。HKJC 前端設定包含 HDC 盤口路徑與即時更新設定，但沒有可供本服務安全、公開且可重現使用的官方資料 API 文件。因此本次 v3 升級採取下列資料契約：

1. 只有在服務已保存並驗證的 HKJC HDC 雙邊線位／賠率完整資料存在時，卡片才標示 `HKJC`。
2. HKJC 沒有相符、可驗證的資料時，採用已授權的 API-Football 亞洲讓球盤快照，明確標示 `API-Football Asian Handicap`，不冒充 HKJC。
3. 若兩者都缺少同一場、同一時間的完整主客兩邊線位及水位，顯示 `資料不足`，且絕不以模型讓球或單邊價格替代。

## References

[1] [HKJC Football Betting — Handicap](https://bet.hkjc.com/en/football/hdc)

[2] [HKJC Football Betting Limited — Handicap Bet Type](https://is.hkjc.com/football/info/en/betting/bettypes_hdc.asp)
