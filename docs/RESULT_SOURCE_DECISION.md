# Aurelia 每日賽果來源決策與品質關卡

**決策日期：**2026-08-14（GMT+8）  
**作者：**Manus AI

## 決策摘要

Aurelia的每日重建以 `schochastics/football-data` 的版本化 `games.parquet` 作為**已完場歷史賽果的主要可重現輸入**，並保存SHA-256與逐筆對齊稽核。南美球會盃及北美聯賽盃的當季賽程補充則分別依既有盃賽建置器的官方／公開記分板來源處理；ODC-BY對齊品質閘門只適用於其14個兼容賽事範圍，完整發布仍必須通過全部16個資料範圍的建置、模型與煙霧測試。

| 候選來源 | 認證與速率 | 覆蓋與資料治理觀察 | 決策 |
|---|---|---|---|
| `schochastics/football-data` `games.parquet` | 不需專屬API金鑰；資料集以ODC-BY授權。 | 專案說明列出207個頂級國內聯賽及20項國際賽事、可離線取得Parquet，適合以雜湊固定每日建置輸入；舊期資料可能有來源或隊名沿革限制。[1] | **主來源。** 可重現、可稽核，並與既有資料庫建置流程相容。 |
| Football-Data.org | 匿名用戶每日100次且只能取用地區／賽事清單；要取用賽事資料須註冊，免費級為每分鐘10次。[2] | 提供賽事與賽季資源，但每日重建需依賴金鑰、服務級別與其可用賽事目錄；不適合作為目前16範圍的無金鑰、離線可重建唯一來源。 | **保留為候選補充來源。** 只有在使用者提供合規金鑰、逐一驗證競賽覆蓋與授權後才採用。 |
| TheSportsDB | v1免費介面使用公開`123`金鑰、整體限制30次／分鐘；多個免費端點另有限制，v2及較高覆蓋屬付費層。[3] | 文件描述跨運動資料庫，但免費端點對搜尋、聯賽／日程查詢有單次或少量結果限制；不保證本系統16範圍的歷史完整性與主客隊識別穩定性。 | **不作每日重建來源。** 可在未來作公開賽程或素材的輔助核對，不能取代訓練用賽果來源。 |
| HKJC足球結果 | 公開網頁與GraphQL均受存取限制；無頭頁面無結果內容、未授權GraphQL回傳白名單錯誤。 | 缺乏可授權、可由CI穩定使用的介面；不會規避存取限制。 | **安全結案。** 不納入自動化；詳情見既有HKJC來源核對紀錄。[4] |

## 品質閘門

每日同步將產生`result_sync_report.json`。報告中的`quality_gate`必須為`passed: true`，編排器才可建立賽前特徵、重訓模型、生成績效檔及發布Release。該閘門要求來源完成賽果數大於零、稽核計數守恆、至少有一筆確認或更新、歧義與比分衝突均為零，且未對齊比例不得高於4%。

2026-08-13成功發布的指標報告為11,302筆來源已完場資料、10,915筆確認、387筆未對齊、0筆歧義及0筆衝突，未對齊比例約3.42%，在4%門檻內。門檻不是資料真實性的證明；它只是防止來源範圍或名稱對齊突然劣化時仍繼續重訓與發布。

> 若品質閘門失敗，候選資料只保留作稽核，流程以非零狀態停止；既有不可變Release與網站已驗證資產不會被新指標覆蓋。

## 發布與回退語意

成功建置先上傳不可變的`data-<UTC>-<commit>` Release資產，最後才更新`data-latest/pipeline_status.json`指標。服務端會先驗證指標的結構與安全檔名；已在同一執行個體成功取得不可變Release後，後續指標下載或驗證失敗時會保留該**最後已驗證不可變版本**。若冷啟動時尚未取得任何有效Release，服務端才改用受管的靜態回退資產。此行為由`server/releaseAssets.test.ts`驗證。

## 參考資料

[1] [schochastics/football-data repository](https://github.com/schochastics/football-data)

[2] [Football-Data.org API policies](https://docs.football-data.org/general/v4/policies.html)

[3] [TheSportsDB API documentation](https://www.thesportsdb.com/docs_api_guide)

[4] [`data-pipeline/research/hkjc_result_source_notes.md`](../data-pipeline/research/hkjc_result_source_notes.md)
