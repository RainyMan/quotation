# 報價單瀏覽紀錄部署（Cloudways）

此功能包含 `analytics.html` 管理後台、`api/analytics.php` 伺服器接口、`visit-tracker.js` 分享頁追蹤。後台具獨立密碼登入，**不沿用原報價系統的前端 PIN**。這不會改造原有報價／印章的存取權限。

## 第一次啟用：Pull 以外還有一次伺服器設定

1. 在 Cloudways Pull 最新版本，確認網站目錄（通常 public_html）存在 `api/analytics.php`。
2. 以 Cloudways SSH／Terminal 進入這個網站的 public_html。先執行 `php -v` 和 `php -m`，確認 PHP 8.1 以上以及 `curl`、`pdo_sqlite` 已啟用。此功能使用 SQLite，**不需要在 PocketBase 新增欄位**。
3. 建立網站目錄外的設定和資料夾。以下指令以目前位於 public_html 為前提：

```bash
mkdir -p ../quotation-analytics-data
chmod 700 ../quotation-analytics-data
cp -n analytics-config.example.php ../quotation-analytics-config.php
chmod 600 ../quotation-analytics-config.php
```

檔案與資料夾需由該 Cloudways application 的 PHP 執行帳號可讀寫。請不要把 SQLite、設定檔或密碼放在 public_html 內。不要使用 chmod 777。若你部署在 public_html 的子目錄，須透過 PHP 執行環境的 `QUOTATION_ANALYTICS_CONFIG` 指向網站目錄外的設定檔；此版分享 URL 以網域根目錄部署為準。

4. 產生獨立後台密碼的雜湊。在 SSH 的 Bash 執行：

```bash
read -r -s -p '請設定瀏覽紀錄後台密碼（建議至少 16 字元）：' ANALYTICS_ADMIN_PASSWORD
printf '\n'
printf '%s' "$ANALYTICS_ADMIN_PASSWORD" | php -r 'echo password_hash(stream_get_contents(STDIN), PASSWORD_DEFAULT), PHP_EOL;'
unset ANALYTICS_ADMIN_PASSWORD
```

輸入的密碼不會顯示，也不會以指令參數傳給 PHP。保存輸出的 `$2y$...` 雜湊；**不要把密碼或雜湊貼給 Codex 或提交 GitHub**。

5. 編輯 `../quotation-analytics-config.php`，將 `password_hash` 空字串替換成產生的雜湊。`origin` 設為 `https://q.tarmacroad.com`（沒有尾端 `/`）。保留 `database` 指向網站外的資料夾。
6. 預設 `geolocation => 'ipwho.is'` 會將訪客 IP 傳給 IPWhois 查國家及城市，查詢快取 24 小時；設為空字串可關閉，地區會顯示「未知」。查詢失敗／超額時仍保留瀏覽紀錄，不影響報價。相關服务條款與限制請參考 https://ipwhois.io/documentation 。這是推估地點，不是定位座標。
7. 對 `/api/analytics.php*` 停用 Cloudflare／Varnish／其他 CDN 快取。接口本身已回傳 `Cache-Control: no-store, private`；請勿用 Cache Everything 覆蓋。登入頁與訪客事件不可由 CDN 回傳其他人的回應。
8. 清除網站快取，打開 `https://q.tarmacroad.com/analytics.html`，用新設定的密碼登入。SQLite 資料表會在第一次請求自動建立。

## 確認 IP 正確

預設只使用伺服器的 `REMOTE_ADDR`。許多代理服務會在 Web server 層還原真實 IP。請用手機行動網路與另一條網路各開一次分享連結，確認後台顯示不同來源，沒有全部變成主機 IP。

若全部是代理 IP，請向 Cloudways 確認「PHP REMOTE_ADDR 的直接上游代理 IP」及其可靠的「單一真實用戶 IP」header；將**確切可信的代理 IP**加入 `trusted_proxies`，並填 `client_ip_header`。例：可信代理提供 CF-Connecting-IP 時，PHP 名稱是 `HTTP_CF_CONNECTING_IP`。本程式不會盲目信任 X-Forwarded-For 或用戶自行傳入的 IP。不要只為了數字看起來正確就任意新增可信 IP。若原站可以繞過可信代理直連，請確認 Web server 有正確重寫／過濾 header。

## 使用方式

- 編輯或開啟已儲存報價單，按「瀏覽紀錄／追蹤分享」：後台會帶入該報價記錄 ID。
- 登入後輸入收件人標籤，例如「某公司／林先生」，按「產生連結」再複製給客戶。
- 同一份報價可以建立多個收件人連結。**標籤代表連結歸屬，不是身分驗證**；转傳仍計在同一標籤。
- 原本 `?view=...` 連結仍可查看並記錄，但收件人顯示「未標記收件人」。既有分享按鈕仍複製這種通用連結。
- 「停用追蹤」僅停止該標籤的新瀏覽記錄，不撤回原報價的公開存取；已開始的瀏覽工作階段仍可回報剩餘時間。若需要撤回報價存取，需另行改造原有報價授權。
- 後台可依客戶／工程／單號、台北日期區間、**瀏覽當時的案件狀態**及是否點過 PDF 篩選。統計與 IP 累計均以篩選結果為準；每頁最多 50 張／50 筆，提供翻頁。
- 管理者已登入這個後台的同一瀏覽器，查看分享頁時不計入。測試請用無痕視窗或另一個瀏覽器。
- 網頁會顯示簡短的瀏覽記錄告知。除非地區查詢啟用，記錄資料只送往自己的網站。

## 計算方式與限制

- 網頁成功讀取報價後才開始追蹤；重新整理計新的一次。追蹤失敗不阻擋報價功能。
- 不同 IP 是去重 IP 數，不是人數；多人共用網路／VPN／IP 變動都會影響解讀。
- 停留時間：頁面可見時累計，每 15 秒回報，背景暫停；關閉時用 keepalive 補送。離線、強制關閉瀏覽器與阻擋追蹤可能漏記。伺服器只接受持有隨機工作階段密鑰的回報，累計秒數不倒退且不得超過實際經過時間。
- 點擊分享頁「列印報價單（可存 PDF）」會記一次 PDF 事件，重送同一事件不重複。無法確認是否在列印對話框真正存檔；瀏覽器快捷鍵／選單列印也不會算作按鈕點擊。
- 可能執行 JavaScript 的預覽機器人會被算入，非 JavaScript 抓取不計。本版不是防作弊的計費統計。
- 資料保留 90 天；每次接收事件／查詢統計時清除過期紀錄。若長期沒有流量，過期資料到下一次請求才會清除。專屬連結配置保留，不隨瀏覽紀錄刪除。

## 驗收

1. 未登入直接打開 `/api/analytics.php?action=summary` 應回傳 401，不得取得紀錄。
2. 產生兩個收件人連結，用無痕開啟第一個，停留 20 秒，切到其他分頁 20 秒，再回來 10 秒；後台約顯示 30 秒，不應加上背景的 20 秒。
3. 按一次 PDF 後取消列印，仍顯示「PDF 點擊 1 次」；這不代表已下载。
4. 相同網路重新整理，再以手機行動網路開啟，確認總次數／各 IP 次數／不同 IP 數。
5. 原有水印、PDF、報價及請款狀態仍正常。
6. 確認網站 HTTP 無法下載資料庫或正式設定檔；它們不應位於任何公開目錄。

## 程式測試

後端整合測試會啟動本機 PHP + SQLite 與模擬 PocketBase，完全不寫入正式資料。

```text
PHP_BINARY=/path/to/php python tests/test_analytics.py
```

Windows 可設定環境變數 PHP_BINARY、PHP_TEST_INI 後執行 Python。瀏覽器測試為 `node tests/analytics-browser.cjs`，需要 Node 20+、Playwright、Edge；API 使用模擬資料。

## 故障排查

- 「尚未設定」：設定檔位置不對；預設是 api/analytics.php 的上上層目錄中的 quotation-analytics-config.php，也就是 public_html 的上一層。
- 「服務暂時無法使用」：查 Cloudways PHP error log；常見原因為缺少 curl／pdo_sqlite、資料目錄不可寫，或設定檔語法錯誤。錯誤不會回傳 SQL／路徑给訪客。
- 「無法確認報價單」：伺服器連不到 PocketBase、Cloudflare 封鎖，或現有 quotations View rule 不允許讀取。不要把 PocketBase superuser token 放入前端來解決。
- 地區「未知」：未開啟第三方查詢、非公開 IP、服務限流或 IP 无法對應。
- 密碼遺失：重新產生密碼雜湊並更新伺服器設定；既有登入最長維持 8 小時。
