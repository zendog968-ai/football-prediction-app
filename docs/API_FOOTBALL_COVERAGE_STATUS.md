# API-Football：授權與2026盤口覆蓋實測

**測試日期：**2026-08-14（GMT+8）  
**作者：**Manus AI

## 實測結果

使用者提供的API-Football Application Key已成功通過官方`/status`端點的帳戶啟用及日額度驗證。然而，使用相同Key請求MLS 2026賽季的賽前odds端點時，服務回傳：`Free plans do not have access to this season, try from 2022 to 2024.` 因此，該帳戶目前**不能取得2026即時或近期盤口**，更不能支援使用者要求的初盤／最新盤比較、每日研究摘要或賽後自動結算。

在使用者表示將升級後重新檢查，`/status`仍回傳`plan: Free`、每日上限100，且MLS 2026 odds端點仍回傳相同拒絕訊息。這表示升級尚未生效於目前API Key，或帳戶方案尚未完成變更；在`/status`不顯示可用方案且odds端點不返回當季資料前，所有自動化通知均維持停止。

其後再次驗證，帳戶已回傳`plan: Pro`、`active: true`及每日7,500次額度。MLS 2026賽前odds端點成功回傳10個fixture與119筆博彩公司資料，市場名稱包含`Asian Handicap`、`Asian Handicap First Half`、`Goal Line`及`Goals Over/Under`。這證實資料源已具備當季讓球與大小球快照的最小覆蓋條件；在建立排程前，仍須以資料庫保存來源時間、fixture、bookmaker、market、line與價格，並於缺欄位時停止個別場次摘要。

| 驗證項目 | 結果 | 意義 |
|---|---|---|
| `GET /status` with `x-apisports-key` | 通過 | Key有效、帳戶啟用及具日額度。 |
| `GET /odds?league=253&season=2026` | 拒絕 | 免費方案僅容許2022–2024，無法取得本專案需要的2026當季盤口。 |
| 升級後重試`/status`與MLS 2026 odds | 仍拒絕 | 目前Key仍顯示`Free`；升級尚未生效或尚未完成。 |
| Pro方案再次驗證與MLS 2026 odds | 通過 | `Pro`、每日7,500次，10個fixture、119筆博彩公司資料，以及亞洲讓球與大小球市場可用。 |
| 讓球／大小球市場實測 | 未執行 | 2026資料沒有授權，不能用舊季或空回應假定目前覆蓋。 |
| Telegram排程 | 停止 | 在缺少當季授權盤口時，不建立會發送不完整研究訊息的排程。 |

## 可行後續方案

第一種方案是由使用者升級API-Football至明確包含2026當季odds資料的計劃；升級後，系統會重新跑status、MLS與其他模型資料範圍的odds覆蓋測試，再建立盤口快照及Telegram排程。第二種方案是選用Sportmonks Premium Odds Feed；其官方文件明確說明亞洲讓球、大小球、開盤與每次盤口變化資料，但同樣需要帳戶與附加方案授權。[1]

在兩種方案之一通過實測前，Telegram只可保留訂閱與研究架構，不能宣稱有即時亞洲讓球、盤路走勢或自動賽後結算資料。

## References

[1] [Sportmonks Premium Odds Feed](https://docs.sportmonks.com/v3/endpoints-and-entities/endpoints/premium-odds-feed)
