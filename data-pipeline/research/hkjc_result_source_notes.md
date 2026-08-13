# HKJC 足球賽果同步：資料來源與契約核對（未採用於自動化）

**查核日期：** 2026-08-14（GMT+8）

## 存取核對結果

香港賽馬會官方足球賽果頁 `https://bet.hkjc.com/en/football/results` 會公布賽事編號（例如 `FB2754`）、賽事名稱、主客隊、日期、半場比數、全場比數、加時附註及賽事無效狀態。頁面明確說明：一般賽果約在賽後30分鐘公布；個別需較長核實的賽事，派彩可能在賽後約三小時才開始。因此每日同步只接受官方結果資料中有完整90分鐘主客比分、且不屬 `Void Match` 的賽事。

HKJC公開網站使用的背景GraphQL服務位於 `https://info.cld.hkjc.com/graphql/base/`。其歷史結果查詢介面可包含內部比賽ID、`frontEndId`（FB編號）、狀態、日期／時間、英文及中文主客隊、賽事名稱，以及 `results` 內的主客比分、`resultType`、`payoutConfirmed` 及結果確認型別。不過，在未授權的自動化執行環境中，該端點回傳 `WHITELIST_ERROR`；無頭瀏覽器開啟公開結果頁亦未取得賽事內容。因此本專案**不以HKJC作每日自動化來源**，也不會規避該限制。

## 資料治理

目前每日更新採用原已使用、具ODC-BY授權的 `schochastics/football-data` `games.parquet` 公開賽果快照。每日流程將它保存為版本化輸入、計算SHA-256、產生逐筆對齊／衝突稽核，且只對既有14個模型範圍的已完成賽事重建Elo、近況、Dixon–Coles與校準模型；未對齊、歧義或比分衝突的資料不會靜默覆寫或擴張模型範圍。

## 參考

1. HKJC Football Results — https://bet.hkjc.com/en/football/results
2. HKJC Football home — https://football.hkjc.com/zh-hk/home
3. 公開用戶端所揭示的HKJC GraphQL查詢結構（僅作介面核對，程式不依賴第三方套件）— https://github.com/Bobosky2005/hkjc-api
