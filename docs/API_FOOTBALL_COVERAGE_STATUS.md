# API-Football：授權與2026盤口覆蓋實測

**測試日期：**2026-08-14（GMT+8）  
**作者：**Manus AI

## 實測結果

使用者提供的API-Football Application Key已成功通過官方`/status`端點的帳戶啟用及日額度驗證。然而，使用相同Key請求MLS 2026賽季的賽前odds端點時，服務回傳：`Free plans do not have access to this season, try from 2022 to 2024.` 因此，該帳戶目前**不能取得2026即時或近期盤口**，更不能支援使用者要求的初盤／最新盤比較、每日研究摘要或賽後自動結算。

在使用者表示將升級後重新檢查，`/status`仍回傳`plan: Free`、每日上限100，且MLS 2026 odds端點仍回傳相同拒絕訊息。這表示升級尚未生效於目前API Key，或帳戶方案尚未完成變更；在`/status`不顯示可用方案且odds端點不返回當季資料前，所有自動化通知均維持停止。

其後再次驗證，帳戶已回傳`plan: Pro`、`active: true`及每日7,500次額度。MLS 2026賽前odds端點成功回傳10個fixture與119筆博彩公司資料，市場名稱包含`Asian Handicap`、`Asian Handicap First Half`、`Goal Line`及`Goals Over/Under`。這證實資料源已具備當季讓球與大小球快照的最小覆蓋條件；在建立排程前，仍須以資料庫保存來源時間、fixture、bookmaker、market、line與價格，並於缺欄位時停止個別場次摘要。

以市場篩選端點逐一核對16個模型範圍後，以下範圍本輪同時有亞洲讓球及大小球fixture：BRA1、LL、MLS、FIN1、KOR1、POR1、MEX1、UEL、SUD、LCUP。EPL、BL、SA、L1、J1及AUS1本輪回傳零個賽前fixture但沒有供應商錯誤，代表目前不是授權或資料格式問題，而是該請求時點沒有可用盤口；排程會跳過這些範圍，不以零資料推測盤路。每個具覆蓋範圍皆回傳零個API錯誤。

| 資料範圍 | 亞洲讓球fixture | 大小球fixture | 結論 |
|---|---:|---:|---|
| BRA1、LL、MLS、FIN1、KOR1、POR1、UEL、SUD、LCUP | 8–10 | 8–10 | 本輪可用，允許盤口快照與模型隊名對應後的研究摘要。 |
| MEX1 | 9 | 9 | 本輪可用，允許盤口快照與模型隊名對應後的研究摘要。 |
| EPL、BL、SA、L1、J1、AUS1 | 0 | 0 | 本輪沒有賽前盤口，安全跳過；下一次排程會重新查詢。 |

| 驗證項目 | 結果 | 意義 |
|---|---|---|
| `GET /status` with `x-apisports-key` | 通過 | Key有效、帳戶啟用及具日額度。 |
| `GET /odds?league=253&season=2026` | 先拒絕、後通過 | 免費方案曾只容許2022–2024；Pro方案生效後成功取得2026當季盤口。 |
| 升級後首次重試`/status`與MLS 2026 odds | 仍拒絕 | 升級尚未在當時的Key生效；此為後續Pro成功驗證前的歷史紀錄。 |
| Pro方案再次驗證與MLS 2026 odds | 通過 | `Pro`、每日7,500次，10個fixture、119筆博彩公司資料，以及亞洲讓球與大小球市場可用。 |
| 讓球／大小球市場實測 | 通過 | 16範圍中10個本輪提供兩類市場；6個範圍無fixture且零供應商錯誤，採安全跳過。 |
| Telegram排程 | 程式就緒、尚未啟用 | 在使用者設定Webhook、/start訂閱並確認前，不建立正式會傳送訊息的任務。 |

## 可行後續方案

API-Football Pro方案目前已通過當季覆蓋測試。下一步是由使用者在發布版本明確設定Telegram Webhook、重新傳送`/start`建立訂閱，並確認後建立三個Heartbeat任務；若日後需擴充更長的盤口歷史，也可評估Sportmonks Premium Odds Feed，其官方文件明確說明亞洲讓球、大小球、開盤與每次盤口變化資料。[1]

在正式訂閱與排程啟用前，Telegram只保留研究架構；系統不會主動傳送任何即時盤口、盤路走勢或賽後結算訊息。

## References

[1] [Sportmonks Premium Odds Feed](https://docs.sportmonks.com/v3/endpoints-and-entities/endpoints/premium-odds-feed)
