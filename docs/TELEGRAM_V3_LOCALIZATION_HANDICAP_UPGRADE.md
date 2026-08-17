# Telegram v3 本地化與實時讓球盤升級

**版本：** V3 Localized Handicap Card
**日期：** 2026-08-17（HKT）
**作者：** Manus AI

## 升級摘要

本升級把 Telegram 研究卡片統一為香港時間與繁體中文優先顯示，並把讓球欄改為**實際儲存的雙邊讓球線位與水位**。系統不再以 Dixon–Coles 推算的讓球線補空；若不能取得完整、同一來源的主客兩邊水位，卡片必須顯示 `資料不足`。

> 此卡片是模型與市場資料研究輸出，不構成投注、資金或結果保證。HKJC 指出顯示賠率僅供參考，最終賠率在投注被接納時確認。[1]

| 功能 | 已實作行為 | 資料不足時的處理 |
|---|---|---|
| 開賽時間 | UTC `event_time` 轉為 `YYYY-MM-DD HH:mm (HKT)`。 | 顯示 `資料不足`。 |
| 隊名 | `name_zh_hk` → `name_zh_tw` → 既有繁中別名 → 英文。 | 保留英文，不臆造音譯。 |
| 聯賽 | `name_zh_hk` → `name_zh_tw` → 既有繁中聯賽表 → 英文。 | 保留英文。 |
| 讓球盤 | 完整 HKJC HDC 雙邊盤優先；否則已授權 API-Football 亞洲讓球盤快照。 | 顯示 `資料不足`，不顯示模型讓球。 |
| 大小球與波膽 | 只使用有限的 Dixon–Coles 期望入球與三個有效波膽。 | 顯示 `資料不足`。 |

## Supabase 翻譯表契約

服務端以可設定的兩張表讀取翻譯後，按英文名稱進行 deterministic map join。預設表名為 `team_translations` 與 `league_translations`，可透過環境變數替換，而無須改程式碼：

```dotenv
SUPABASE_TEAM_TRANSLATIONS_TABLE=team_translations
SUPABASE_LEAGUE_TRANSLATIONS_TABLE=league_translations
```

兩張翻譯表必須至少有一個英文識別欄，以及下列繁中欄位。

| 表 | 可接受英文識別欄 | 必需中文欄 |
|---|---|---|
| `team_translations` | `english_name`、`team_name` 或 `name` | `name_zh_hk`、`name_zh_tw` |
| `league_translations` | `english_name`、`league_name` 或 `name` | `name_zh_hk`、`name_zh_tw` |

服務首先查 `name_zh_hk`，空值才查 `name_zh_tw`。若翻譯表尚未建立、被 RLS 阻擋或暫時不可讀，資料層只會回退原有的已驗證英文／靜態繁中別名；不會阻斷賽事資料或呼叫未驗證的自動音譯寫回。若要啟用寫回，必須先提供 Wikidata 實體 ID 對應、寫入權限和人工覆核流程。

## 讓球盤來源與資料品質

HKJC 公開 HDC 頁會顯示賽事、讓球線和兩邊參考賠率。[1] 讓球按法定時間賽果結算；不包括加時及互射十二碼。[2]

本服務的 `server/hkjcHandicap.ts` 以 90 秒快取讀取官方 HDC 頁，並且只接受具有明確表格欄位邊界、完整事件 ID、主客隊、對稱讓球線及兩個大於 1 的水位的列。這個限制刻意避免多字隊名在扁平文字中被拆錯。若官方頁是純 JavaScript 載入且 HTTP 回應沒有可驗證表格列，或找不到同一場英文主客隊，系統會回退至已保存的 `API-Football Asian Handicap` 快照；兩者皆不存在時則顯示資料不足。

## Telegram 卡片格式

```text
🏆 【聯賽】英超 (Premier League)
📅 【時間】2026-08-19 20:30 (HKT)
---
⚽️ 曼聯 (Manchester United)  vs  阿仙奴 (Arsenal)
---
📊 【資料來源】Dixon-Coles 模型 + HDA 賠率融合
🛡️ 【雙重機率】1X: 78.0% | X2: 49.0%
⚖️ 【實時讓球盤】HKJC [Home -0.5 @1.91 / Away +0.5 @1.89]
🎯 【模型勝率預測】主勝 51.0% | 和局 27.0% | 客勝 22.0%
🔥 【大小球】大 2.5 (54.3%) | 小 2.5 (45.7%)
---
💡 【最高波膽 Top 3】
1. 2-1 —— 12.4%
2. 1-0 —— 11.3%
3. 1-1 —— 10.8%
```

上述只是版面示例，並非現場賽事或即時盤口。實際發送時只會使用已驗證的 fixture、模型輸入及完整盤口快照。

## 驗證結果

`pnpm check` 已通過。以下回歸測試共 31 項均通過：

```bash
SUPABASE_URL='https://example.supabase.co' \
SUPABASE_SECRET_KEY='sb_secret_test_key' \
API_FOOTBALL_KEY='test-key' \
pnpm vitest run \
  server/hkjcHandicap.test.ts \
  server/telegramResearch.test.ts \
  server/supabaseCache.test.ts
```

完整專案建置亦已通過。完整測試集中仍有憑證整合測試與既有 live Poisson fixture 在未注入正式 API／Telegram／Supabase 憑證的隔離環境失敗；這些不是本次程式型別或卡片契約錯誤，不能以測試替代真實部署健康檢查。

## 發布與測試推播

將這些程式推送至 `main` 後，請在已發布的專案環境確認以下 server-side variables 已存在：`TELEGRAM_BOT_TOKEN`、`TELEGRAM_WEBHOOK_SECRET`、`API_FOOTBALL_KEY`、`SUPABASE_URL`、`SUPABASE_SECRET_KEY`。然後由已登入擁有者在服務介面設定 webhook 與排程，並先在 Telegram 對 Bot 發送 `/start` 建立訂閱。發送單次測試推播前，必須取得接收者的明確確認，並只發送實際存在且完整的未來賽事卡片。

## References

[1] [HKJC Football Betting — Handicap](https://bet.hkjc.com/en/football/hdc)

[2] [HKJC Football Betting Limited — Handicap Bet Type](https://is.hkjc.com/football/info/en/betting/bettypes_hdc.asp)
