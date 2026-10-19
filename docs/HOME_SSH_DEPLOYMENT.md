# Aurelia Home：GitHub Actions 經 SSH 部署

## 狀態與範圍

本流程為 `football-prediction-app` 的 Node／Python 全端程式提供受控 SSH 發布。它**不是** `daily-data-refresh.yml` 的模型資料重訓，也不修改 Supabase schema、Nginx、Telegram Webhook、cron、賽馬 V10、N6 或其他服務。

正式主機目前無法經本任務連入，SSH 用戶、服務名稱和目錄未經現場核對；所以此 PR 只建立流程，**不宣稱 Home 已配置或部署成功**。`HOME_SSH_DEPLOY_ENABLED` 未設為 `true` 時不會正式部署。手動預設模式是唯讀 `preflight`。

## 部署鏈

1. `main` push 或手動執行：完整 Vitest、TypeScript、Python 同步器與部署安全測試。
2. 使用專案鎖定的 pnpm 及 Node 22 建置，封裝同一 commit 的程式及 `dist`；不封裝 `.env`、資料庫、模型 pickle、SSH 私鑰或 `node_modules`。
3. GitHub Environment `home-production` 的專用 SSH 身分，使用預先確認的主機公鑰嚴格驗證連線。
4. 非 root 發布用戶讀取主機 root 持有的 `/etc/aurelia-football-deploy.json`，先核對**唯一足球服務**的用戶、工作目錄、Node 執行路徑、Python PATH、環境檔及上一版本可用性。
5. 安全解壓到新 release，安裝 release 專屬 Node／Python 依賴，不動全域 Python 或現有資料；原子切換 `current` 後僅重啟指定足球 unit。
6. `/api/deployment/health` 的應用程式啟動版本必須等於封裝 commit，並確認5／5／20及研究模式政策。失敗則嘗試還原上一指標、重啟同一服務和確認上一健康 URL；回滾失敗亦明確報錯。
7. 保留部署回條。可選的 Telegram 通知只報告部署狀態，不冒充賽事研究圖卡或手機閱讀回條。

## 一次性前置條件：必須由主機管理員確認

### 1. 先確認目標，不猜舊配置

舊 webhook 腳本曾提及 `136.108.33.74`、Node port `3100` 和 `/etc/aurelia-football.env`，這些只是歷史線索，不是本次驗證過的 SSH 目標。

需要核對：公開 IP／DNS、SSH port、**非 root** 發布帳戶、足球 unit 真實名稱、原本的程式目錄及 Node／Python 安裝位置。若 Home 其實使用 Python-only Dashboard、Docker 或不同服務模式，停止；不能把本 Node systemd 流程直接套上去。

可由有權限的管理員查看指定足球 unit 的 `User`、`WorkingDirectory`、`ExecStart`、`EnvironmentFiles` 和 `FragmentPath`。不要把整份 `Environment` 或環境檔貼到聊天／Actions 日誌。
主機工具要求 Node 至少22.12、Python 至少3.11及 **pnpm固定10.4.1**。不能任意升級pnpm，否則可能忽略專案既有patches設定。Preflight以 `sudo -n -l` 唯讀確認僅指定足球 restart 命令的授權，不真的重啟。

### 2. 使用專用 SSH key 和主機身分驗證

在可信賴的管理環境產生專用 Ed25519 key；私鑰不設互動式 passphrase，以供 CI 使用，必須只用於本發布帳戶並保存在 GitHub Environment Secret。不要重用 Windows 管理員個人私鑰，也不要在聊天貼私鑰。

在目標發布用戶的 `authorized_keys` 安裝其公鑰，建議加 `restrict` 選項，停用轉發及 PTY。發布用戶不可使用 root，亦不可有廣泛 `sudo ALL` 權限。僅授權 `sudo -n /usr/bin/systemctl restart <已核對的足球服務>.service`；預設 shell 可發布程式，但不得取得賽馬或其他服務的管理權限。

`HOME_SSH_KNOWN_HOSTS` 要使用從可信賴 Console／既有可信 SSH 會話核對的主機公鑰；例如用主機 `/etc/ssh/ssh_host_ed25519_key.pub` 與 SHA256 fingerprint 核對。非22 port 的 known_hosts 身分為 `[host]:port`。不要僅憑未驗證的 `ssh-keyscan` 結果接受主機，也不要使用 `StrictHostKeyChecking=no`。

### 3. 發布目錄、回滾與環境檔

本流程要求主機**已經**採用以下佈局：

```text
<已核對的部署根目錄>/
  current -> releases/<上一個可用版本>
  releases/
  receipts/
```

足球 unit 必須以發布用戶執行，`WorkingDirectory=<root>/current`，指定絕對 Node binary 和 `<root>/current/dist/index.js`。環境 PATH 必須含 `<root>/current/.venv/bin`，因為預測器使用 `execFile('python3')`；其餘 PATH 沿用原本安全設定。

既有環境檔留在發布目錄以外，root 持有、權限0600，由 systemd `EnvironmentFile` 載入。不可打包或覆寫。若現有服務並非此佈局，需先備份並由管理員完成一次性遷移，確認上一服務能運行；**本腳本不會自動搬動未知安裝或產生 systemd unit**。

資料庫、模型、日誌等持久資料不得置於會被替換的 release。需要舊相對路徑的項目可在 `shared_links` 中指定既有資料目錄；程式只建立安全 symlink，不改資料內容，不能覆盖程式碼、依賴或 release metadata。

### 4. root 持有的主機配置

將 `deploy/home-ssh-config.example.json` 複製為 `/etc/aurelia-football-deploy.json`，填入**實際已核對**的值。示例空值是有意的安全停止，不可當作可直接部署配置。

- `deploy_root`、`service`、`service_user` 與工具 binary 使用確認過的绝对路徑。
- `health_url` 是本機 `/api/deployment/health`。新版會提供它。
- `rollback_health_url` 是上一版本已存在且唯讀的 loopback 健康 URL，必須已證實HTTP200。可使用原有 tRPC health URL，但不能指向有副作用的推播／排程端點。
- 配置檔 root 持有，建議0644；group／other 不可寫。環境檔仍是0600，配置僅存路徑而非 secret。

首次新端點尚未存在不構成阻塞：舊服務使用独立 `rollback_health_url` 證實可用；更新後使用新 health 回傳同一 commit 和政策。健康驗證只證明服務存活及版本，**不證明資料庫、模型覆蓋、外部 API 或 Telegram 狀態**。

## GitHub 設定

### Environment Secrets：`home-production`

| 名稱 | 內容 |
|---|---|
| `HOME_SSH_HOST` | 已核對的公開IP或DNS，不含 `user@` |
| `HOME_SSH_PORT` | 純數字SSH port |
| `HOME_SSH_USER` | 專用非root發布帳戶 |
| `HOME_SSH_PRIVATE_KEY` | 專用未加密Ed25519私鑰，完整多行 |
| `HOME_SSH_KNOWN_HOSTS` | 已核對的主機公鑰known_hosts記錄 |
| `TELEGRAM_BOT_TOKEN` | 可選部署通知；可沿用同名 Repository Secret |
| `TELEGRAM_CHAT_ID` | 可選部署通知的純數字ID；可沿用同名 Repository Secret |

若服務僅接受私有網絡連線，GitHub hosted runner不能直接SSH，必須先提供獲授權的網絡通道；不能放寬全部防火牆來繞過。

建議把 Environment 的 deployment branch policy 限制為 `main`；首次部署使用 required reviewer。只有完成主機檢查後才按需要取消每次人工審批，以實現 main merge 後自動部署。

### Repository Variables

| 名稱 | 預設／用途 |
|---|---|
| `HOME_SSH_DEPLOY_ENABLED` | 缺失或非 `true`：禁止正式SSH部署 |
| `HOME_TELEGRAM_NOTIFY_ENABLED` | 缺失或非 `true`：不嘗試部署通知 |
| `VITE_APP_ID` | 前端既有公開應用ID；真实部署時必填 |
| `VITE_OAUTH_PORTAL_URL` | 前端既有公開HTTPS登入入口；真实部署時必填 |

主機伺服器端的 `DATABASE_URL`、`JWT_SECRET`、API-Football、Supabase、OAuth／Forge 等值沿用現有 root 環境檔，**不用把它們搬到 GitHub**。未核對前端設定就停止真實部署，避免產生無法登入的版本。若現有前端另有必要 VITE 欄位，需要核對後擴充，不把後端秘密當作 VITE 變數。

本次 GitHub 認證能讀写程式與PR，但讀取 Repository Secret／Variable清單曾回403；這不等於 Secrets不存在，也不代表Actions執行時必定不能讀取。請在GitHub介面設定，不需要重新把Token貼到聊天。

## 首次執行

1. 合併部署 PR（先通過 Admin Configuration Security Regression 和新部署 validation job）。
2. 填入 host／key／known_hosts／root 配置，保留部署開關關閉。
3. Actions → **Deploy Aurelia Home via SSH** → Run workflow → 分支 `main` → mode **preflight**。
4. 應取得 `status: preflight-ok`；檢查不會安裝相依、換 current、重啟服務或推播。SSH連線及root配置不可用則直接失敗。
5. 檢查通過後，將 `HOME_SSH_DEPLOY_ENABLED=true`，手動 mode **deploy**。首次部署由管理員核對回條及網站實際功能。
6. 其後 main push 自動部署，不依賴 Manus Home 的遠端操作連線；但仍需要主機本身及SSH正常。

```bash
gh workflow run deploy-home-ssh.yml \
  --repo zendog968-ai/football-prediction-app --ref main -f mode=preflight

# 只在主機配置已驗證、部署開關已啟用後執行：
gh workflow run deploy-home-ssh.yml \
  --repo zendog968-ai/football-prediction-app --ref main -f mode=deploy
```

手動 workflow 必須選main；不能從任意feature branch觸碰正式主機。PR只跑測試與建置，不拿 production Environment 或SSH Secret。

## 回條與失敗處理

- `home-deployment-evidence-*` artifact 僅保存 allowlisted 部署及 Telegram 回條，不保存憑證、環境或SSH私鑰。
- 部署成功必須包含正確 `releaseSha` 與 `policyVerified:true`；不是只看HTTP200。
- 新應用進程在啟動時固定版本 metadata，避免舊进程在current切換後讀到新SHA而假裝新版本。
- Telegram失敗不觸發已健康程式的回滾；workflow會報告通知失敗，不能把它說成部署未发生。
- 通知只發送一次，不在不確定的網絡超時後盲目重發，降低重複訊息。
- 回滾是程式版本回滾，不還原資料庫；本流程不執行資料庫 migration、資料刷新或重訓。
- 保留上一 release，不自動刪除舊版本，亦不重啟Nginx、賽馬或主機。

## 正式部署完成的判準

只有取得SSH發佈回條、同commit的新版健康驗證，並檢查正式網站／Bot功能，才可說Home上線完成。本PR的測試與合併，只是部署通道準備完成；尚缺實際主機設定時不得觸發盲目部署。
