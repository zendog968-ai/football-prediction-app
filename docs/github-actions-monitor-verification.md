# GitHub Actions 監控頁驗證摘要

- 公開 GitHub API 在共享開發環境曾回覆 HTTP 403 限流，前端正確顯示可重試錯誤狀態。
- 已改用僅限伺服器端的 `GITHUB_STATUS_TOKEN` 讀取 `zendog968-ai/football-prediction-app` 的 Actions 執行資料。
- `server/githubActions.test.ts` 的唯讀輕量查詢已成功通過；測試不輸出或斷言Token內容。
- 前端只接收工作流程名稱、狀態、時間、分支、短提交雜湊與GitHub執行連結；不接收GitHub Token。
- 正式網域的Telegram webhook健康端點已回覆受控JSON；正式tRPC監控路由仍須在每次發布後獨立核對，避免將端點回復誤判為整個新版本已完整載入。
