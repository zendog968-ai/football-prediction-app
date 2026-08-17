# HKJC 足球讓球盤資料來源紀錄

更新日期：2026-08-17（香港時間）

HKJC 官方公開足球讓球盤頁面為 <https://bet.hkjc.com/en/football/hdc>，頁面顯示賽事、讓球線、主客盤水位與最後更新時間，並註明賠率僅供參考、最終賠率以受注時為準。

本次伺服器端驗證發現，官方前端使用 `https://info.cld.hkjc.com/graphql/base/` 作為資料端點，但直接只讀請求回覆 `WHITELIST_ERROR`，不具可部署的穩定伺服器存取條件。因此，系統不會將任何非直接取得的資料標示為「HKJC」。

替代顯示層使用已同步至 Supabase 的 API-Football 真實 `HDC | {bookmaker}` 快照；卡片會保留書商名稱、對應上下盤讓球線及十進制水位。當沒有可驗證快照時，會清楚顯示無可驗證市場盤口，而不以模型讓球取代。

## 來源

- HKJC Handicap odds：<https://bet.hkjc.com/en/football/hdc>
- HKJC Handicap 規則：<https://is.hkjc.com/football/info/en/betting/bettypes_hdc.asp>
