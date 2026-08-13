# 2026 南美球會盃與北美聯賽盃：來源核對紀錄

## 名稱與範圍

本次「南美球會盃」採用正式競賽 **CONMEBOL Sudamericana**，資料庫代碼預定為 `SUD`；「北美聯賽盃」採用 **Leagues Cup**，預定代碼為 `LCUP`。兩者都應作為獨立競賽範圍，不與參賽隊伍的本土聯賽賽果混為同一個盃賽標籤。

## 官方當季資料

CONMEBOL官方Sudamericana頁面可列出2026年已完成賽果、待賽程、比賽時間、場地、對戰隊伍及結果。例如2026年8月11至12日的十六強首回合資料已出現在官方賽程頁，8月13日後的對戰則列為未完成賽程。[1]

Leagues Cup官方網站表明2026年賽事為「3 countries, 2 leagues, 1 champion」，並公告賽期為8月4日至9月6日；官方首頁刊載Phase One近期比賽回顧與賽果內容。[2]

無頭瀏覽器核對官方賽程頁時，頁面載入React與相關前端資源，但首屏未暴露可直接重用的結構化賽程請求，且可見內容為骨架載入狀態。此現象不足以建立GitHub每日訓練來源，故不會以未確認的前端資料或猜測端點寫入模型資料庫。

因此，Leagues Cup逐場結果採用公開可讀的ESPN記分板端點 `https://site.api.espn.com/apis/site/v2/sports/soccer/concacaf.leagues.cup/scoreboard?dates=<year>&limit=500`。實測該端點能以`homeAway`、隊名、`score`與`STATUS_FULL_TIME`欄位提供真實完場結果；2019、2021、2023、2024、2025與截至2026-08-13的2026賽季合計203場完成比賽。2020賽事取消、2022無該競賽記錄，資料庫僅收錄狀態明確為`STATUS_FULL_TIME`的事件，待賽程絕不寫入訓練標籤。

## 歷史資料與每日更新原則

公開ODC-BY `schochastics/football-data` `games.parquet` 是歷史訓練與每日候選資產的主要來源。只有其精確競賽標籤具至少五季可重現的完成賽果時，才會啟用相應模型範圍。當季官方頁面只供近期賽果與待賽程展示，不會將未開賽資料寫入訓練資料庫或用作回測標籤。

## 參考資料

[1] [CONMEBOL Sudamericana 2026：官方賽程、賽果與球隊](https://gol.conmebol.com/sudamericana/en/)

[2] [Leagues Cup 2026：官方網站與賽程資訊](https://www.leaguescup.com/)

[3] [ESPN Leagues Cup公開記分板：2026賽事資料](https://site.api.espn.com/apis/site/v2/sports/soccer/concacaf.leagues.cup/scoreboard?dates=2026&limit=500)
