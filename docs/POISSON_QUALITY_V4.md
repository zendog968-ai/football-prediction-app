# Telegram Poisson v4 品質修正

## 範圍

`poisson-v4-shrink10-research` 修正 Python sync 與 TypeScript live fallback 的基礎進球估計。它不是 calibrated XGBoost release，不修改 `SUPPORTED_LEAGUE_CODES`、data-latest 或已鎖定歷史結果。

## 資料門檻

只預測有時區時間戳、未來開賽及 `NS` 狀態的賽事。只採同聯賽同賽季的 `FT` 賽果；排除 AET、PEN、友誼賽混入、無時間戳、負數入球、重複 fixture 及相同隊伍身份。歷史必須在產生預測時已可使用；完成時間未知時使用開賽時間加三小時的保守 embargo。回看期上限365日，每隊最近10場、聯賽最近200場。未達5／5／20場便停止預測，不以聯賽平均冒充球隊實力。

## 固定收縮公式

設聯賽主場入球均值 Lh、客場入球均值 La，B=(Lh+La)/2。每隊入球／失球率分別為 `(實際入球或失球總和+10*B)/(場數+10)`。主隊進球均值為 `Lh*(主隊入球率/B)*(客隊失球率/B)`；客隊為 `La*(客隊入球率/B)*(主隊失球率/B)`。均值限制於0.2–4.5。

這是固定10場先驗的 regularization，不是經未觸碰留出集選出的校準。勝平負、大小球、讓球參考與波膽來自同一個 Poisson 分佈。不可將單独融合市場的勝平負與不同分佈的大小球／波膽混稱同一模型。主／客強隊的模型讓球參考一致採 -0.5；+0.5不輸機率不能與獲勝機率混用。

## 快取與標籤

預測需要有效產生時間、未來開賽時間、產生於開賽前及當時之前，且不超過2小時。空值不轉換成0%。保留資料來源，不硬編碼「Dixon–Coles+HDA融合」。模型版本以既有 recommendation varchar(50) 的 `s=Q4` metadata 保存，不更改表結構。研究百分比不是歷史命中率。

## 測試與歷史對照

離線執行 `pnpm check`、新模型及 Telegram/cache 測試，以及 `PYTHONPATH=supabase-sync python -m pytest -q supabase-sync/tests`。API key與Supabase URL使用虛假測試值，不呼叫真實服務或Telegram。

`python scripts/evaluate_poisson_quality.py --database <唯讀資料庫> --baseline <修改前poisson.py> --output <本機結果.json>` 在相同可用樣本上比較新舊模型。每日賽果先整批預測、再加入歷史，避免同日洩漏。輸出含資料庫雜湊、Accuracy、Log-Loss、multiclass Brier及平均最高機率。這是日期層級的歷史回歸測試，不是帶有實際歷史API可用時間的前瞻盲測；不得聲稱已證明未來或近期命中率。

## 部署邊界

GitHub合併、Home雲端服務部署及Telegram目前webhook主機是三個不同狀態。主分支更新不能證明手機已使用新版本。保留雲端特有的國家映射、特徵快照、聯賽配置及安全邊界；不改Nginx、UFW、排程或webhook。未經確認不傳送測試訊息。先備份、測試、建置，再重啟既有loopback服務，並在AGENTS.md記錄。

## 審查補強

格點延伸至0–24球，最大均值4.5時雙邊未計尾端低於1e-10，修正原0–8球格點截尾重新正規化的偏差。身份代碼只接受正整數。已保存result_observed_at的資料要求其早於預測截點；未具備首次可得時間的歷史資料只作日期層級回歸，不宣稱嚴格前瞻驗證。

公共快取每次回傳均重新投影：超過2小時、賽後或缺有效時間的資料清除勝平負、波膽、recommendation與衍生市場；API不只附hasPrediction旗標。實時盤口要求有時區捕捉時間且不超過30分鐘，否則不顯示。拒絕任意metadata research_source升格為校準標籤；只有固定Q4標示新版未校準研究，其餘為舊版未核實。
