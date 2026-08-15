# API-Football J1 League 覆蓋驗證

- 驗證時間：2026-08-15 UTC
- 官方服務端點：`https://v3.football.api-sports.io/leagues?id=98&current=true`
- 回應：HTTP 200；聯賽名稱為 `J1 League`，國家為 `Japan`。
- 歷史端點：`https://v3.football.api-sports.io/fixtures?league=98&season=2026&last=5&timezone=UTC`
- 回應：HTTP 200；回傳J1近期賽事資料，包括川崎前鋒、廣島三箭、柏雷素爾、京都不死鳥、橫濱水手與清水心跳等隊伍。

此驗證只確認授權資料來源可辨識J1聯賽及讀取2026賽季賽事。同步程式仍只會在每隊至少兩場同聯賽、同賽季的已完場資料可用時寫入低證據的基礎Poisson研究列；否則保留資料缺失狀態，不填造機率。
