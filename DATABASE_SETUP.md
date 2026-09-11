# 案件狀態、請款單及回簽附件：資料庫設定

請先完成下列設定，再在 Cloudways Pull 並清除快取。

在現有 PocketBase 管理後台開啟 Collections → quotations → 編輯 Collection，新增以下三個欄位。這是新增欄位，請勿匯入取代整個 Collection，也不需要刪除既有報價。

| 欄位名稱 | 類型 | 設定 |
| --- | --- | --- |
| workflow_status | Select | 單選（Max select = 1）；選項 `quoted`、`awarded`、`billing`、`paid`；Required 關閉 |
| document_type | Select | 單選（Max select = 1）；選項 `quotation`、`payment_request`；Required 關閉 |
| signed_documents | File | Max files / Max select = 10；Max file size = 20971520 bytes（20 MiB）；Required 關閉 |

`signed_documents` 的 MIME types 設為：

```text
image/jpeg
image/png
image/webp
application/pdf
```

儲存 Collection 設定。既有資料不必批次修改：空白狀態顯示「報價中」，空白類型顯示「工程報價單」。狀態與線上簽名各自獨立保存。

此版本沿用現有報價讀寫權限，沒有新增後台登入或調整 API Rules。回簽附件入口僅放在內部編輯頁；這是介面顯示限制，不是新增的檔案存取控制。若現有 quotations 可公開讀取，附檔也需依原有 PocketBase 權限看待。Protected 檔案需要有效的 PocketBase 登入與 file token；現有 PIN 流程沒有這類登入，因此本版本不支援勾選 Protected 後直接預覽檔案。

操作：

- 歷史紀錄操作欄下方可點「報價中」「已得標」「請款中」「★ 已收款結案」，成功後即更新資料庫與狀態欄。黃色代表已得標，綠色代表請款中。
- 點「請款中」亦將單據類型設為工程請款單。
- 點主標題可切換報價單／請款單；切成請款單會將狀態設為請款中。切回報價單只改單據類型，不自動撤銷最新案件狀態。
- 已儲存單據切換標題時會立即儲存狀態與類型。新單則在按「儲存並發送」時保存。
- 在上方「業主回簽檔案」選擇照片或 PDF，再按「儲存並發送」。原有附件保留，新增附件追加；已保存的檔案可點連結開啟。
- 附件不列印在 PDF 內；共享頁只顯示報價／請款內容。
- 複製單據會回到報價中、報價單，且不複製回簽附件。

部署時須包含新增的 `workflow.js`。更新後首頁載入 `style.css?v=1.3.0`、`app.js?v=1.3.0` 與 `workflow.js?v=1.3.0`。

檢查：新增或編輯一筆測試單 → 已得標 → 請款中 → 已收款結案 → 重新開啟確認；上傳照片及 PDF 後重新開啟並點檔案；用分享連結確認請款單標題與列印。

PocketBase 官方參考：
- https://pocketbase.io/docs/collections/
- https://pocketbase.io/docs/files-handling/
