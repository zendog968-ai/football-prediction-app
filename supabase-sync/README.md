# Football Poisson → Supabase Sync

這是一個**研究型**Python同步專案。它從授權的API-Football讀取熱門聯賽賽程、即時比分與賽前盤口，保存HDA、亞洲讓球與大小球快照，並以最近已完場賽事的入失球資料建立Poisson機率輸出。程式只輸出模型機率、最可能比分、研究傾向、證據星級及資料限制；它不產生投注或資金指令。

> 你先前在聊天中貼出的Supabase Secret Key應立即在Supabase後台輪換。此專案不包含任何實際金鑰，也不應把Secret Key放入Git、程式碼或瀏覽器端。

## 專案結構

| 路徑 | 用途 |
|---|---|
| `main.py` | 每小時同步編排器。 |
| `football_sync/api_football.py` | API-Football的賽程、即時賽事、盤口及近期賽果適配器。 |
| `football_sync/poisson.py` | 只以真實已完場賽事建立的Poisson研究模型。 |
| `football_sync/supabase_store.py` | Supabase上傳與去重。 |
| `schema.sql` | 三張Supabase資料表與索引。 |
| `.github/workflows/main.yml` | 每小時GitHub Actions同步。 |

## 先建立資料表

登入Supabase專案，打開**SQL Editor**，貼上並執行[`schema.sql`](./schema.sql)。這會建立`fixtures`、`odds_snapshots`和`ai_predictions`及必要索引。Supabase Python用戶端的upsert要求主鍵或明確衝突欄位；本schema已提供所需約束。[1]

## 本機執行

```bash
cd supabase-sync
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
```

在`.env`加入以下**已輪換的新值**，不可使用聊天中曾公開的舊Secret Key：

```dotenv
API_FOOTBALL_KEY=...
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SECRET_KEY=...
```

先執行不寫入資料庫的驗證：

```bash
set -a; source .env; set +a
python main.py --dry-run
pytest -q
```

確認API回傳與樣本數均正常後，移除`--dry-run`才會以server-only Supabase key寫入三張表：

```bash
python main.py
```

程式預設最多處理12場，以控制每小時API配額。若任一隊最近完成賽事少於3場，該場不會產生Poisson預測；這是資料品質停止條件，而不是以假設值補齊。

## GitHub Actions部署

將此資料夾與根目錄的`.github/workflows/main.yml`推送至GitHub的預設分支。然後在儲存庫的**Settings → Secrets and variables → Actions**設定：

| Secret | 用途 |
|---|---|
| `API_FOOTBALL_KEY` | API-Football伺服器端金鑰。 |
| `SUPABASE_URL` | Supabase專案URL。 |
| `SUPABASE_SECRET_KEY` | 已輪換的server-only Supabase Secret Key。 |

工作流程使用`0 * * * *`在每小時第0分鐘排程，並提供`workflow_dispatch`乾跑選項。GitHub說明指出排程只會在工作流程檔位於預設分支時觸發；首次部署可先從Actions介面以乾跑模式人工觸發。[2]

## 資料與模型限制

API-Football透過`x-apisports-key`的GET請求授權，並提供fixtures、in-play odds及pre-match odds端點；`/status`不計入每日配額。[3] 盤口覆蓋取決於你的方案、競賽與博彩公司，空回應會被保存為該輪沒有資料，而不會推測盤口。Poisson模型不使用xG、傷兵、陣容、紅牌或未授權資料，且有限樣本會降低證據星級。

## References

[1] [Supabase Python Upsert Reference](https://supabase.com/docs/reference/python/upsert)

[2] [GitHub Actions Schedule Events](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule)

[3] [API-Football v3 Documentation](https://www.api-football.com/documentation-v3)
