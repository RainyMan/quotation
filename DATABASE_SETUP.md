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

- 歷史紀錄操作欄下方可點「報價中」「已得標」「請款中」「已結案」，成功後即更新資料庫與狀態欄。黃色代表已得標，綠色代表請款中。
- 點「請款中」亦將單據類型設為工程請款單。
- 點主標題可切換報價單／請款單；切成請款單會將狀態設為請款中。切回報價單會同步將狀態設為報價中。
- 已儲存單據切換標題時會立即儲存狀態與類型。新單則在按「儲存並發送」時保存。
- 在上方「業主回簽檔案」選擇照片或 PDF，再按「儲存並發送」。原有附件保留，新增附件追加；已保存的檔案可點連結開啟。
- 附件不列印在 PDF 內；共享頁只顯示報價／請款內容。
- 複製單據會回到報價中、報價單，且不複製回簽附件。

部署時須包含新增的 `workflow.js`。更新後首頁載入 `style.css?v=1.3.1`、`app.js?v=1.3.1` 與 `workflow.js?v=1.3.1`。

檢查：新增或編輯一筆測試單 → 已得標 → 請款中 → 已收款結案 → 重新開啟確認；上傳照片及 PDF 後重新開啟並點檔案；用分享連結確認請款單標題與列印。

PocketBase 官方參考：
- https://pocketbase.io/docs/collections/
- https://pocketbase.io/docs/files-handling/


## 1.4 分享頁浮水印（仍需後端原章權限改造）

部署前在 `quotations` 新增 `watermarked_stamp`：File、最多 1 個檔案、10 MB（10485760 bytes）、MIME `image/png`、非必填。

內部儲存報價會將原章與「僅供本次報價使用／報價對象／報價日期／單號」合成一張 PNG，存入此欄位。分享頁只使用這張副本；舊報價需在內部重新儲存以產生副本，否則分享頁隱藏印章，絕不回退顯示原章。分享頁與內部均可列印／另存 PDF，印章沿用已合成浮水印的副本。

**尚未完成的伺服器安全措施：** 前端限制不是存取控制。只要原 `vendors.stamp` 仍可公開讀取，已知 URL 或直接呼叫 API 仍可能取得無浮水印原章。請勿將此版本視為已封鎖原章存取。

正式保護需將原章移至需登入的私人 Collection／檔案儲存，管理者使用真正的 PocketBase Auth 登入（目前 localStorage PIN 不具伺服器身份），由後端或有權限的內部端產生浮水印副本；公開 vendor 資料不得回傳原章檔名或私人儲存位置。保護 File 欄位、API Rules 及檔案 token 需一起實作，不能只勾選 Protected 否則現有內部端也無法讀取。新權限啟用後，應撤除既有公開原章與 CDN 快取，再以未登入請求驗證舊網址確實拒絕存取。已被下載的舊檔無法撤回。

本版本限制分享頁選取、複製、拖曳、右鍵、一般快捷鍵另存網頁與連結點擊；這些僅防止一般操作，無法阻止截圖、瀏覽器開發工具、直接 API 請求或對方修改本機網頁。浮水印圖本身仍可被取出，但文字已合成進像素，並非能直接刪除的 HTML 疊層。
