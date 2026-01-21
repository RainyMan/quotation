// --- 1. PocketBase 初始化 ---
const pb = new PocketBase('https://pocketbase.tarmacroad.com'); // Synology 外網路徑

// --- 2. 核心變數與元素 ---
const itemsBody = document.getElementById('items-body');
const addRowBtn = document.getElementById('add-row');
const totalChineseEl = document.getElementById('total-chinese');
const subtotalEl = document.getElementById('subtotal');
const taxEl = document.getElementById('tax');
const totalEl = document.getElementById('total');
const imageUpload = document.getElementById('image-upload');
const imagePreview = document.getElementById('image-preview');

let rowCount = 0;
let currentQuotationId = null;
let isViewMode = false; // 是否進入訪客觀看模式
let signaturePad = null; // 手寫簽名物件
let manualTotals = { subtotal: null, total: null }; // 存儲手動修改的金額

// 即時檢查：如果是檢視模式 或 已登入，立刻隱藏登入遮罩防止閃爍
const isAuth = localStorage.getItem('system_auth') === 'true';
if (new URLSearchParams(window.location.search).get('view') || isAuth) {
    if (!new URLSearchParams(window.location.search).get('view')) {
        // 非檢視模式但已登入
    } else {
        isViewMode = true;
    }
    // 使用 requestAnimationFrame 確保 DOM 已載入但尚未渲染完成時介入
    const hideOverlay = () => {
        const overlay = document.getElementById('login-overlay');
        if (overlay) overlay.style.display = 'none';
        else requestAnimationFrame(hideOverlay);
    };
    hideOverlay();
}

// 廠商管理變數
let vendors = [];
const vendorSelect = document.getElementById('vendor-select');
const vendorListBody = document.getElementById('vendor-list-body');
const vendorForm = document.getElementById('vendor-form');
const stampPreview = document.getElementById('m-v-stamp-preview');
const stampImgArea = document.getElementById('vendor-stamp-img');
const sigImgArea = document.getElementById('sig-client-img'); // 取得甲方簽名圖

// 記錄當前印章縮放大小 (預設 175px)
let currentStampSize = 175;
// 記錄當前照片縮放大小 (預設 400px)
let currentPhotoSize = 400;

// 歷史紀錄排序變數
let historySort = { field: 'last_updated', direction: 'desc' }; // 預設依最後更新由新到舊


// --- 3. 核心工具函式 (圖片壓縮等) ---
/**
 * 將圖片壓縮至指定大小 (預設 300KB)
 * @param {File} file 原始檔案
 * @param {number} targetSizeKB 目標大小 (KB)
 * @returns {Promise<File>} 壓縮後的檔案
 */
async function compressImage(file, targetSizeKB = 200) {
    // 如果檔案本來就小於百分之百目標大小，則直接回傳原始檔案，保留原始格式 (如 PNG 透明度)
    if (file.size <= targetSizeKB * 1024) {
        return file;
    }

    return new Promise((resolve) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = (e) => {
            const img = new Image();
            img.src = e.target.result;
            img.onload = () => {
                const canvas = document.createElement('canvas');
                let width = img.width;
                let height = img.height;

                // 限制最大解析度，避免超大圖導致記憶體崩潰或壓縮率過低
                const MAX_WIDTH = 1920;
                const MAX_HEIGHT = 1920;

                if (width > MAX_WIDTH || height > MAX_HEIGHT) {
                    if (width > height) {
                        height = Math.round((height * MAX_WIDTH) / width);
                        width = MAX_WIDTH;
                    } else {
                        width = Math.round((width * MAX_HEIGHT) / height);
                        height = MAX_HEIGHT;
                    }
                }

                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, width, height);

                // 遞進式壓縮：從高品質開始嘗試
                let quality = 0.9;
                const iterate = () => {
                    canvas.toBlob((blob) => {
                        if (blob.size <= targetSizeKB * 1024 || quality <= 0.1) {
                            const compressedFile = new File([blob], file.name.replace(/\.[^/.]+$/, "") + ".jpg", {
                                type: 'image/jpeg',
                                lastModified: Date.now()
                            });
                            resolve(compressedFile);
                        } else {
                            quality -= 0.1;
                            iterate();
                        }
                    }, 'image/jpeg', quality);
                };
                iterate();
            };
        };
    });
}

// --- 4. 國字大寫轉換與備註功能 ---
function addMemo(text) {
    const memoField = document.getElementById('memo-field');
    const existingContent = memoField.innerHTML.trim();
    const lines = existingContent ? existingContent.split(/<br>|<div>/).length : 0;
    const prefix = existingContent !== "" ? "<br>" : "";
    memoField.innerHTML += `${prefix}${lines + 1}. ${text}`;
}

function numberToChinese(n) {
    if (isNaN(n)) return "零元整";
    const fraction = ['角', '分'];
    const digit = ['零', '壹', '貳', '參', '肆', '伍', '陸', '柒', '捌', '玖'];
    const unit = [['元', '萬', '億'], ['', '拾', '佰', '仟']];
    let s = '';
    for (let i = 0; i < fraction.length; i++) {
        s += (digit[Math.floor(n * 10 * Math.pow(10, i)) % 10] + fraction[i]).replace(/零./, '');
    }
    s = s || '整';
    n = Math.floor(n);
    for (let i = 0; i < unit[0].length && n > 0; i++) {
        let p = '';
        for (let j = 0; j < unit[1].length && n > 0; j++) {
            p = digit[n % 10] + unit[1][j] + p;
            n = Math.floor(n / 10);
        }
        s = p.replace(/(零.)*零$/, '').replace(/^$/, '零') + unit[0][i] + s;
    }
    return s.replace(/(零.)*零元/, '元')
        .replace(/(零.)+/g, '零')
        .replace(/^整$/, '零元整');
}

// --- 5. Google Maps 工程地點功能 ---
let mapPicker, mapMarker, geocoder;
let tempLat, tempLng, tempAddress;

async function initMapAutocomplete() {
    const input = document.getElementById('c-address-search');
    const display = document.getElementById('c-address-text');
    const mapBtn = document.getElementById('map-link-btn');
    const latInp = document.getElementById('c-address-lat');
    const lngInp = document.getElementById('c-address-lng');
    const urlInp = document.getElementById('c-address-map-url');

    if (!input || !google.maps.importLibrary) return;

    try {
        const { Autocomplete } = await google.maps.importLibrary("places");
        const autocomplete = new Autocomplete(input);
        autocomplete.addListener('place_changed', function () {
            const place = autocomplete.getPlace();
            if (!place.geometry) return;
            updateAddressData(place);
        });
    } catch (e) { console.error("Google Maps Autocomplete 載入失敗:", e); }
}

function updateAddressData(placeOrResult) {
    const display = document.getElementById('c-address-text');
    const mapBtn = document.getElementById('map-link-btn');
    const latInp = document.getElementById('c-address-lat');
    const lngInp = document.getElementById('c-address-lng');
    const urlInp = document.getElementById('c-address-map-url');

    const address = placeOrResult.formatted_address || placeOrResult.name;
    const lat = typeof placeOrResult.geometry.location.lat === 'function' ? placeOrResult.geometry.location.lat() : placeOrResult.geometry.location.lat;
    const lng = typeof placeOrResult.geometry.location.lng === 'function' ? placeOrResult.geometry.location.lng() : placeOrResult.geometry.location.lng;
    const mapUrl = `https://www.google.com/maps/search/?api=1&query=${lat},${lng}${placeOrResult.place_id ? `&query_place_id=${placeOrResult.place_id}` : ''}`;

    if (display) display.innerText = address;
    if (latInp) latInp.value = lat;
    if (lngInp) lngInp.value = lng;
    if (urlInp) urlInp.value = mapUrl;
    if (mapBtn) {
        mapBtn.href = mapUrl;
        mapBtn.style.display = 'inline-block';
    }
}

window.openMapPicker = async function () {
    const modal = new bootstrap.Modal(document.getElementById('mapPickerModal'));
    modal.show();

    // 延遲初始化以確保容器已渲染
    setTimeout(async () => {
        const { Map } = await google.maps.importLibrary("maps");
        const { AdvancedMarkerElement } = await google.maps.importLibrary("marker");
        const { Autocomplete } = await google.maps.importLibrary("places");
        const { Geocoder } = await google.maps.importLibrary("geocoding");
        geocoder = new Geocoder();

        const defaultPos = { lat: 25.0339, lng: 121.5644 }; // 預設台北 101
        const currentLat = parseFloat(document.getElementById('c-address-lat').value) || defaultPos.lat;
        const currentLng = parseFloat(document.getElementById('c-address-lng').value) || defaultPos.lng;

        mapPicker = new Map(document.getElementById('map-picker-container'), {
            center: { lat: currentLat, lng: currentLng },
            zoom: 16,
            mapId: "QUOTATION_MAP_ID", // 需在 Cloud Console 設定 Map ID
        });

        mapMarker = new AdvancedMarkerElement({
            map: mapPicker,
            position: { lat: currentLat, lng: currentLng },
            gmpDraggable: true,
            title: "拖移選取地點",
        });

        // 搜尋功能輔助
        const modalSearch = document.getElementById('map-modal-search');
        const modalAutocomplete = new Autocomplete(modalSearch);
        modalAutocomplete.bindTo("bounds", mapPicker);

        modalAutocomplete.addListener("place_changed", () => {
            const place = modalAutocomplete.getPlace();
            if (!place.geometry || !place.geometry.location) return;

            // 讓地圖中心與標記跳轉到搜尋結果
            mapPicker.setCenter(place.geometry.location);
            mapPicker.setZoom(17); // 搜尋後自動放大
            mapMarker.position = place.geometry.location;

            updateTempData(place.geometry.location.lat(), place.geometry.location.lng(), place.formatted_address || place.name);
        });

        // 標記拖移事件
        mapMarker.addListener("dragend", (event) => {
            const pos = mapMarker.position;
            updateTempData(pos.lat, pos.lng);
        });

        // 點擊地圖直接移動標記
        mapPicker.addListener("click", (event) => {
            mapMarker.position = event.latLng;
            updateTempData(event.latLng.lat(), event.latLng.lng());
        });

        // 初始化當前數據
        updateTempData(currentLat, currentLng, document.getElementById('c-address-text').innerText);
    }, 300);
};

async function updateTempData(lat, lng, address = null) {
    tempLat = lat;
    tempLng = lng;
    if (address) {
        tempAddress = address;
        document.getElementById('map-picker-address').innerText = address;
    } else {
        geocoder.geocode({ location: { lat, lng } }, (results, status) => {
            if (status === "OK" && results[0]) {
                tempAddress = results[0].formatted_address;
                document.getElementById('map-picker-address').innerText = tempAddress;
            }
        });
    }
}

window.confirmMapSelection = function () {
    const display = document.getElementById('c-address-text');
    const latInp = document.getElementById('c-address-lat');
    const lngInp = document.getElementById('c-address-lng');
    const urlInp = document.getElementById('c-address-map-url');
    const mapBtn = document.getElementById('map-link-btn');

    const mapUrl = `https://www.google.com/maps/search/?api=1&query=${tempLat},${tempLng}`;

    if (display) display.innerText = tempAddress;
    if (latInp) latInp.value = tempLat;
    if (lngInp) lngInp.value = tempLng;
    if (urlInp) urlInp.value = mapUrl;
    if (mapBtn) {
        mapBtn.href = mapUrl;
        mapBtn.style.display = 'inline-block';
    }

    bootstrap.Modal.getInstance(document.getElementById('mapPickerModal')).hide();
};



// --- 4. 即時計算功能 ---
// --- 4. 即時計算功能 ---
function calculateTotals() {
    let subtotal = 0;
    let totalCost = 0;
    const rows = itemsBody.querySelectorAll('tr');
    const costInputs = document.querySelectorAll('.internal-cost-input');

    rows.forEach((row, index) => {
        const price = parseFloat(row.querySelector('.item-price').value) || 0;
        const qty = parseFloat(row.querySelector('.item-qty').value) || 0;

        // 從對應的側邊欄輸入框取得成本
        const costInput = costInputs[index];
        const cost = parseFloat(costInput?.value) || 0;

        const lineTotal = price * qty;
        const lineCost = cost * qty;

        row.querySelector('.item-subtotal').innerText = `NT$ ${lineTotal.toLocaleString()}`;
        subtotal += lineTotal;
        totalCost += lineCost;

        // 同步品項名稱到側邊欄 (標記用)
        const costLabel = document.getElementById(`cost-label-${index}`);
        if (costLabel) {
            const name = row.querySelector('.item-name').value.trim() || `品項 ${index + 1}`;
            costLabel.innerText = name;
        }
    });

    const calcSubtotal = subtotal;
    const calcTax = Math.round(subtotal * 0.05);
    const calcTotal = subtotal + calcTax;

    // 定義顯示用的變數
    let subtotalDisplay = calcSubtotal;
    let taxDisplay = calcTax;
    let totalDisplay = calcTotal;

    // 重置元件狀態
    const sOrig = document.getElementById('subtotal-original');
    const tOrig = document.getElementById('tax-original');
    const totOrig = document.getElementById('total-original');

    sOrig.style.display = 'none';
    if (tOrig) tOrig.style.display = 'none';
    totOrig.style.display = 'none';
    subtotalEl.classList.remove('text-primary');
    taxEl.classList.remove('text-decoration-line-through', 'text-muted', 'opacity-50');
    totalEl.classList.remove('text-decoration-line-through', 'text-muted');
    document.getElementById('total-row').classList.remove('opacity-50');

    // 邏輯 A：手動修改未稅 (不開發票模式)
    if (manualTotals && manualTotals.subtotal !== null) {
        subtotalDisplay = manualTotals.subtotal;
        // 數字完全不變動，稅金與總計維持原本根據項次算出的數字，僅畫刪除線
        taxDisplay = calcTax;
        totalDisplay = calcTotal;

        sOrig.innerText = `NT$ ${calcSubtotal.toLocaleString()}`;
        sOrig.style.display = 'inline';
        subtotalEl.classList.add('text-primary'); // 變藍色 (與標題一致)

        taxEl.classList.add('text-decoration-line-through', 'text-muted', 'opacity-50');
        totalEl.classList.add('text-decoration-line-through', 'text-muted');
        document.getElementById('total-row').classList.add('opacity-50');
    }
    // 邏輯 B：手動修改總價 (回推模式)
    else if (manualTotals && manualTotals.total !== null) {
        totalDisplay = manualTotals.total;
        subtotalDisplay = Math.round(totalDisplay / 1.05);
        taxDisplay = totalDisplay - subtotalDisplay;

        // 劃掉原始合計
        sOrig.innerText = `NT$ ${calcSubtotal.toLocaleString()}`;
        sOrig.style.display = 'inline';

        // 劃掉原始稅金
        if (tOrig) {
            tOrig.innerText = `NT$ ${calcTax.toLocaleString()}`;
            tOrig.style.display = 'inline';
        }

        // 劃掉原始總價
        totOrig.innerText = `NT$ ${calcTotal.toLocaleString()}`;
        totOrig.style.display = 'inline';
    }

    subtotalEl.innerText = `NT$ ${subtotalDisplay.toLocaleString()}`;
    taxEl.innerText = `NT$ ${taxDisplay.toLocaleString()}`;
    totalEl.innerText = `NT$ ${totalDisplay.toLocaleString()}`;

    // 中文大寫連動
    const chineseTargetVal = (manualTotals && manualTotals.subtotal !== null) ? subtotalDisplay : totalDisplay;
    totalChineseEl.innerText = numberToChinese(chineseTargetVal);

    // 利潤計算：(議價後未稅金額 - 總成本)
    const actualProfit = subtotalDisplay - totalCost;

    const profitSidebar = document.getElementById('profit-sidebar-val');
    if (profitSidebar) {
        profitSidebar.innerText = `NT$ ${actualProfit.toLocaleString()}`;
    }
}

// 新增：手動修改金額功能
window.manualEditAmount = function (type) {
    if (isViewMode) return;
    const input = prompt(type === 'subtotal' ? '請輸入新的【未稅合計】金額 (輸入 0 或清空則恢復自動計算)：\n(注意：這將視為客戶不開發票，劃掉稅金與總計)' : '請輸入新的【含稅總計】金額 (輸入 0 或清空則恢復自動計算)：');

    if (input === null) return;

    const newVal = parseInt(input.replace(/[^\d]/g, ''));
    if (!newVal || newVal <= 0) {
        manualTotals[type] = null;
    } else {
        manualTotals[type] = newVal;
        // 如果改了其中一個，另一個恢復自動避免衝突
        if (type === 'subtotal') manualTotals.total = null;
        else manualTotals.subtotal = null;
    }
    calculateTotals();
}

// 新增：刷新右側成本分析側邊欄
function refreshCostSidebar(savedCosts = null) {
    const list = document.getElementById('cost-items-list');
    if (!list) return;

    const rows = itemsBody.querySelectorAll('tr');

    // 保存現有輸入值 (如果沒有傳入 savedCosts)
    const currentCosts = savedCosts || Array.from(document.querySelectorAll('.internal-cost-input')).map(input => input.value);

    list.innerHTML = '';
    rows.forEach((row, index) => {
        const name = row.querySelector('.item-name').value.trim() || `品項 ${index + 1}`;
        const div = document.createElement('div');
        div.className = 'mb-2 pb-2 border-bottom';
        div.innerHTML = `
            <div class="d-flex justify-content-between align-items-center mb-1">
                <span class="small fw-bold text-truncate" style="max-width: 150px;" id="cost-label-${index}">${name}</span>
                <span class="badge bg-light text-dark border p-1" style="font-size: 10px;">Row ${index + 1}</span>
            </div>
            <div class="input-group input-group-sm">
                <span class="input-group-text bg-danger text-white border-danger" style="font-size: 10px;">成本</span>
                <input type="number" class="form-control internal-cost-input text-end" 
                       value="${currentCosts[index] || 0}" 
                       data-index="${index}" 
                       oninput="calculateTotals()">
            </div>
        `;
        list.appendChild(div);
    });

    // 如果一開始是隱藏的 (檢視模式)，則不需重新計算
    if (!isViewMode) calculateTotals();
}

// --- 5. 表格列操作 ---
function createRow() {
    const currentRows = itemsBody.querySelectorAll('tr').length;
    const newNumber = currentRows + 1;
    const tr = document.createElement('tr');
    const dragIcon = isViewMode ? '' : `<i class="bi bi-grip-vertical text-muted drag-handle no-print"></i> `;
    tr.innerHTML = `
        <td class="drag-handle cursor-move text-center">${dragIcon}${newNumber}</td>
        <td><input type="text" class="item-name form-control-plaintext" placeholder="輸入品項名稱" list="items-datalist"></td>
        <td><input type="text" class="item-unit form-control-plaintext text-center" value="式"></td>
        <td><input type="number" class="item-qty text-center" value="1"></td>
        <td><input type="number" class="item-price text-end" value="0"></td>
        <td class="item-subtotal text-end fw-bold">NT$ 0</td>
        <td><input type="text" class="item-note form-control-plaintext" placeholder=""></td>
        <td class="no-print text-center">
            <button class="btn btn-sm text-danger btn-remove-row"><i class="bi bi-trash"></i></button>
        </td>
    `;

    // 綁定事件
    tr.querySelectorAll('input').forEach(input => {
        input.addEventListener('input', () => {
            calculateTotals();
            // 如果是品項名稱變更，同步到側邊欄
            if (input.classList.contains('item-name')) {
                const index = Array.from(itemsBody.querySelectorAll('tr')).indexOf(tr);
                const label = document.getElementById(`cost-label-${index}`);
                if (label) label.innerText = input.value.trim() || `品項 ${index + 1}`;
            }
        });
    });

    tr.querySelector('.btn-remove-row').addEventListener('click', () => {
        tr.remove();
        refreshCostSidebar(); // 刪除列後重新刷新側邊欄
        calculateTotals();
        updateRowNumbers();
    });

    const nameInput = tr.querySelector('.item-name');
    nameInput.addEventListener('input', () => {
        const val = nameInput.value.trim();

        // 優先嘗試解析 "品項 (單位)" 格式 (從下拉選單選取的)
        const match = val.match(/^(.+)\s\((.+)\)$/);
        if (match) {
            const pureName = match[1].trim();
            const pureUnit = match[2].trim();
            const found = itemDictionary.find(i => i.name === pureName && (i.unit || '式') === pureUnit);
            if (found) {
                nameInput.value = found.name; // 還原為純名稱
                tr.querySelector('.item-unit').value = found.unit || '式';
                tr.querySelector('.item-price').value = found.price || 0;
                calculateTotals();
                return;
            }
        }

        // 若不匹配格式 (手動輸入中)，按名稱搜尋字典
        const foundByName = itemDictionary.find(i => i.name === val);
        if (foundByName) {
            tr.querySelector('.item-unit').value = foundByName.unit || '式';
            tr.querySelector('.item-price').value = foundByName.price || 0;
            calculateTotals();
        }
    });

    itemsBody.appendChild(tr);
    refreshCostSidebar(); // 新增列後重新刷新側邊欄
    return tr;
}

function updateRowNumbers() {
    itemsBody.querySelectorAll('tr').forEach((row, index) => {
        const cell = row.cells[0];
        const dragIcon = isViewMode ? '' : `<i class="bi bi-grip-vertical text-muted drag-handle no-print"></i> `;
        cell.innerHTML = `${dragIcon}${index + 1}`;
    });
}

// --- 6. 附件照片區動態排版 ---
const attachmentArea = document.getElementById('quotation-attachments');
let uploadedImages = []; // 存儲圖片 DataURL (預覽用)
let selectedFiles = []; // 存儲實體 File 物件 (上傳用)
let keepExistingImages = []; // 存儲已存在的檔案名稱 (PocketBase 用)

function updateAttachmentLayout() {
    attachmentArea.innerHTML = '';
    const count = uploadedImages.length;
    if (count === 0) return;

    // 清除舊的 layout class
    attachmentArea.className = 'mb-4 d-flex justify-content-center flex-wrap gap-2';

    // 根據數量套用 class
    if (count === 1) attachmentArea.classList.add('layout-1');
    else if (count === 2) attachmentArea.classList.add('layout-2');
    else if (count === 3) attachmentArea.classList.add('layout-3');
    else if (count >= 4) attachmentArea.classList.add('layout-4');

    uploadedImages.forEach((src, index) => {
        const div = document.createElement('div');
        div.className = 'attachment-item';
        // 套用當前縮放大小
        div.style.width = `${currentPhotoSize}px`;
        div.style.height = 'auto'; // 取消 CSS 的固定高度

        const removeBtn = isViewMode ? '' : `<button class="remove-btn no-print" onclick="removeImage(${index})">&times;</button>`;
        div.innerHTML = `
            <img src="${src}">
            ${removeBtn}
        `;
        attachmentArea.appendChild(div);
    });
}

window.removeImage = function (index) {
    // 判斷移除的是「既有檔案」還是「新選檔案」
    const existingCount = keepExistingImages.length;
    if (index < existingCount) {
        keepExistingImages.splice(index, 1);
    } else {
        selectedFiles.splice(index - existingCount, 1);
    }
    uploadedImages.splice(index, 1);
    updateAttachmentLayout();
};

imageUpload.addEventListener('change', async function (e) {
    const files = e.target.files;
    if (!files.length) return;

    // 顯示上傳中提示 (如有需要可加入)
    for (let i = 0; i < files.length; i++) {
        const file = files[i];

        // 1. 進行壓縮
        const compressedFile = await compressImage(file, 200);
        selectedFiles.push(compressedFile); // 儲存壓縮後的實體檔案

        // 2. 產生預覽
        const reader = new FileReader();
        reader.onload = function (event) {
            uploadedImages.push(event.target.result);
            updateAttachmentLayout();
        };
        reader.readAsDataURL(compressedFile);
    }
    imageUpload.value = '';
});

// --- 7. PocketBase CRUD 與歷史紀錄功能 ---

// 取得廠商印章 URL 的輔助函式
function getFileUrl(collection, record, filename) {
    if (!filename) return '';
    return `https://pocketbase.tarmacroad.com/api/files/${collection}/${record.id}/${filename}`;
}

async function loadMemoPresets() {
    const presetContainer = document.getElementById('memo-presets-container');
    if (!presetContainer) return;
    try {
        const records = await pb.collection('memo_presets').getFullList({ sort: 'content', '$autoCancel': false });

        // 去重處理
        const uniqueMemos = [...new Set(records.map(r => r.content.trim()))];

        presetContainer.innerHTML = '';
        uniqueMemos.forEach((content, index) => {
            const div = document.createElement('div');
            // 使用自定義 flex 佈局避免 Bootstrap form-check 可能的邊距問題
            div.className = 'd-flex align-items-center justify-content-between mb-2 p-1 border-bottom-dashed';
            div.innerHTML = `
                <div class="d-flex align-items-center flex-grow-1">
                    <input class="form-check-input memo-checkbox me-2 mt-0" type="checkbox" value="${content}" id="memo-${index}">
                    <label class="form-check-label small cursor-pointer flex-grow-1 mb-0" for="memo-${index}">${content}</label>
                </div>
                <i class="bi bi-x-circle text-danger ms-2 cursor-pointer" onclick="event.stopPropagation(); deleteMemoPreset('${content}')" title="刪除此預設值"></i>
            `;
            presetContainer.appendChild(div);
        });

        // 監聽所有核取方塊
        presetContainer.querySelectorAll('.memo-checkbox').forEach(cb => {
            cb.addEventListener('change', syncMemoPresets);
        });

        // 防止點擊選單內部時自動關閉下拉選單
        presetContainer.addEventListener('click', (e) => {
            e.stopPropagation();
        });
    } catch (e) {
        console.error('載入預設說明失敗', e);
    }
}

window.deleteMemoPreset = async function (content) {
    if (!confirm(`確定要刪除「${content}」這個預設備註嗎？`)) return;
    try {
        // 找到所有內容符合的記錄並刪除
        const records = await pb.collection('memo_presets').getFullList({
            filter: `content = "${content}"`
        });
        for (const record of records) {
            await pb.collection('memo_presets').delete(record.id);
        }
        loadMemoPresets(); // 重新載入清單
    } catch (e) {
        console.error('刪除預設備註失敗', e);
        alert('刪除失敗');
    }
};

function syncMemoPresets() {
    const checkboxes = document.querySelectorAll('.memo-checkbox:checked');
    const memoField = document.getElementById('memo-field');

    // 取得目前手動編輯過的其他行（如果需要保留，但通常多選是為了覆蓋或重新產生）
    // 這裡我們採取「重新產生」策略：1. 2. 3. ...
    let newContent = '';
    checkboxes.forEach((cb, i) => {
        newContent += `${i + 1}. ${cb.value}<br>`;
    });

    memoField.innerHTML = newContent;
}

// --- 10. 品項字典與自動補全 ---
let itemDictionary = [];

async function updateItemsDatalist() {
    const datalist = document.getElementById('items-datalist');
    try {
        const records = await pb.collection('items').getFullList({ sort: 'name', '$autoCancel': false });
        // 儲存完整資訊供連動使用
        itemDictionary = records.map(r => ({ name: r.name, unit: r.unit, price: r.default_price }));
        datalist.innerHTML = '';
        records.forEach(r => {
            const option = document.createElement('option');
            // 將 value 設為具備唯一性的格式，以便輸入時解析
            option.value = `${r.name} (${r.unit || '式'})`;
            datalist.appendChild(option);
        });
    } catch (e) {
        console.error('更新品項列表失敗', e);
    }
}

async function loadItemPresets() {
    const presetContainer = document.getElementById('item-presets-container');
    if (!presetContainer) return;
    presetContainer.innerHTML = '<div class="text-center small py-2">載入中...</div>';
    try {
        const records = await pb.collection('items').getFullList({ sort: 'name', '$autoCancel': false });
        console.log('Loaded item presets:', records.length);

        presetContainer.innerHTML = '';
        if (records.length === 0) {
            presetContainer.innerHTML = '<div class="text-center small py-2 text-muted">目前無品項紀錄</div>';
        }

        records.forEach((r, index) => {
            const div = document.createElement('div');
            div.className = 'd-flex align-items-center justify-content-between mb-2 p-1 border-bottom-dashed';
            div.innerHTML = `
                <div class="d-flex align-items-center flex-grow-1 cursor-pointer" onclick="addItemFromPreset('${r.id}')">
                    <span class="small flex-grow-1">${r.name} (${r.unit || '式'})</span>
                </div>
                <i class="bi bi-x-circle text-danger ms-2 cursor-pointer" onclick="event.stopPropagation(); deleteItemPreset('${r.id}', '${r.name}')" title="刪除此預設品項"></i>
            `;
            presetContainer.appendChild(div);
        });

        // 防止點擊選單內部時自動關閉下拉選單
        presetContainer.addEventListener('click', (e) => {
            e.stopPropagation();
        });
    } catch (e) {
        console.error('載入品項預設失敗詳細資訊:', e);
        presetContainer.innerHTML = `<div class="text-center small py-2 text-danger">載入失敗: ${e.message}</div>`;
    }
}

window.addItemFromPreset = async function (id) {
    try {
        const item = await pb.collection('items').getOne(id, { '$autoCancel': false });
        const tr = createRow();
        tr.querySelector('.item-name').value = item.name;
        tr.querySelector('.item-unit').value = item.unit || '式';
        tr.querySelector('.item-price').value = item.default_price || 0;
        calculateTotals();
    } catch (e) {
        console.error('添加預設品項失敗', e);
    }
};

window.deleteItemPreset = async function (id, name) {
    if (!confirm(`確定要刪除品項預設「${name}」嗎？`)) return;
    try {
        await pb.collection('items').delete(id);
        loadItemPresets();
        updateItemsDatalist();
    } catch (e) {
        console.error('刪製品項預設失敗', e);
        alert('刪除失敗');
    }
};

// --- 10b. 客戶字典與自動補全 ---
let customerDictionary = [];

async function updateCustomersDatalist() {
    const datalist = document.getElementById('customers-datalist');
    const presetContainer = document.getElementById('customer-presets-container');
    if (!datalist || !presetContainer) return;

    try {
        // 修正：從最近 500 筆提取，並改用更穩定的排序或備援
        let records;
        try {
            records = await pb.collection('quotations').getList(1, 500, {
                sort: '-created',
                '$autoCancel': false
            });
        } catch (err) {
            console.warn('嘗試原始撈取客戶清單...');
            records = await pb.collection('quotations').getList(1, 500, { '$autoCancel': false });
        }
        console.log(`[客戶資料庫] 已從歷史紀錄載入 ${records.items.length} 筆資料`);

        const uniqueCustomers = [];
        const seen = new Set();

        records.items.forEach(q => {
            const name = (q.customer_name || '').trim();
            const contact = (q.customer_contact || '').trim();
            const phone = (q.customer_phone || '').trim();
            if (!name) return;

            const key = `${name}_${contact}(${phone})`;
            if (!seen.has(key)) {
                seen.add(key);
                uniqueCustomers.push({ name, contact, phone, key });
            }
        });

        customerDictionary = uniqueCustomers;

        // 更新 Datalist
        datalist.innerHTML = '';
        uniqueCustomers.forEach(c => {
            const opt = document.createElement('option');
            opt.value = c.key;
            datalist.appendChild(opt);
        });

        // 渲染浮動選單 (初始渲染全部)
        renderCustomerList(customerDictionary);

    } catch (e) {
        console.error('更新客戶列表失敗', e);
    }
}

// 新增：渲染客戶列表輔助函式
function renderCustomerList(list) {
    const listContainer = document.getElementById('customer-list-container');
    if (!listContainer) return;

    listContainer.innerHTML = '';
    if (list.length === 0) {
        listContainer.innerHTML = '<div class="text-center small py-3 text-muted">找不到相符的客戶紀錄</div>';
        return;
    }

    list.forEach(c => {
        const div = document.createElement('div');
        div.className = 'p-2 border-bottom cursor-pointer hover-bg-light small customer-preset-item';
        div.innerHTML = `<strong>${c.name}_${c.contact}(${c.phone})</strong>`;
        div.onclick = (e) => {
            e.stopPropagation();
            setCustomerFields(c.name, c.contact, c.phone);
            // 選取後自動關閉選單 (可選)
            const dropdown = bootstrap.Dropdown.getInstance(document.getElementById('customerDropdown'));
            if (dropdown) dropdown.hide();
        };
        listContainer.appendChild(div);
    });
}

function setCustomerFields(name, contact, phone) {
    const fields = {
        'c-name': name,
        'c-contact': contact,
        'c-phone': phone
    };
    for (const [id, val] of Object.entries(fields)) {
        const el = document.getElementById(id);
        if (el) {
            // 修正：判斷標籤類型，INPUT 使用 value，其餘使用 innerText
            if (el.tagName === 'INPUT') el.value = val || "";
            else el.innerText = val || "";
        }
    }
    // 同時更新簽名處的甲方名稱
    const sigCName = document.getElementById('sig-c-name');
    if (sigCName) sigCName.innerText = name || "";
}

function setupCustomerAutoFill() {
    ['c-name', 'c-contact', 'c-phone'].forEach(id => {
        const el = document.getElementById(id);
        if (!el) return;
        el.addEventListener('input', (e) => {
            const val = e.target.value || '';
            // 1. 檢測是否選擇了 Datalist 中的完整格式 (Name_Contact(Phone))
            if (val.includes('_') && val.includes('(')) {
                const parts = val.split('_'); // [Name, "Contact(Phone)"]
                if (parts.length >= 2) {
                    const name = parts[0];
                    const rest = parts[1]; // "Contact(Phone)"
                    const subParts = rest.match(/(.+)\((.+)\)/);
                    if (subParts) {
                        setCustomerFields(name, subParts[1], subParts[2]);
                    } else {
                        setCustomerFields(name, rest, "");
                    }
                }
            }
            else if (val.includes('_')) {
                const parts = val.split('_');
                if (parts.length >= 1) {
                    setCustomerFields(parts[0], parts[1] || '', parts[2] || '');
                }
            }
            // 2. 精確匹配：如果輸入的公司名稱完全吻合字典，自動帶入
            else if (id === 'c-name') {
                const found = customerDictionary.find(c => c.name === val.trim());
                if (found) {
                    setCustomerFields(found.name, found.contact, found.phone);
                }
            }
        });
    });
}

window.saveQuotation = async function (isCopy = false) {
    try {
        const btn = document.getElementById('btn-save');
        btn.disabled = true;
        btn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>儲存中...';

        const memoHtml = document.getElementById('memo-field').innerHTML;
        const items = [];
        const rows = itemsBody.querySelectorAll('tr');
        const costInputs = document.querySelectorAll('.internal-cost-input');

        const processedKeys = new Set();
        for (let i = 0; i < rows.length; i++) {
            const row = rows[i];
            const name = row.querySelector('.item-name').value.trim();
            const unit = row.querySelector('.item-unit').value.trim();
            const price = parseFloat(row.querySelector('.item-price').value) || 0;
            const cost = parseFloat(costInputs[i]?.value || 0);

            if (name) {
                items.push({
                    name: name,
                    unit: unit,
                    qty: parseFloat(row.querySelector('.item-qty').value),
                    price: price,
                    cost: cost,
                    note: row.querySelector('.item-note').value
                });

                // 自動同步新品項或更新單價到 items collection
                const itemKey = `${name}|${unit}`;
                if (!processedKeys.has(itemKey)) {
                    try {
                        const filter = `name="${name}" && unit="${unit}"`;
                        const existing = await pb.collection('items').getFirstListItem(filter).catch(() => null);

                        if (!existing) {
                            // 新增品項
                            await pb.collection('items').create({
                                name: name,
                                unit: unit,
                                default_price: price
                            }, { '$autoCancel': false });
                            itemDictionary.push({ name, unit, price });
                        } else if (existing.default_price !== price) {
                            // 名稱單位相同但單價改變 -> 更新資料庫預設值
                            await pb.collection('items').update(existing.id, {
                                default_price: price
                            }, { '$autoCancel': false });
                            // 更新本地快取
                            const localItem = itemDictionary.find(i => i.name === name && (i.unit || '式') === unit);
                            if (localItem) localItem.price = price;
                        }
                        processedKeys.add(itemKey);
                    } catch (err) { console.warn('同步或更新品項失敗', err); }
                }
            }
        }

        // 構建 FormData 以支援多圖上傳
        const formData = new FormData();
        const getElVal = (id) => {
            const el = document.getElementById(id);
            if (!el) return "";
            return (el.value || el.innerText || "").trim();
        };

        formData.append('quo_number', document.getElementById('quo-number').innerText);
        formData.append('customer_name', getElVal('c-name'));
        // 同時傳送 project_location 與 project_name 以相容資料庫設定
        const projName = getElVal('c-location');
        formData.append('project_location', projName);
        formData.append('project_name', projName);
        formData.append('customer_contact', getElVal('c-contact'));
        formData.append('customer_phone', getElVal('c-phone'));
        formData.append('date', document.getElementById('c-date-input').value);
        formData.append('total', parseFloat(totalEl.innerText.replace(/[^\d]/g, '')));
        formData.append('manual_totals', JSON.stringify(manualTotals)); // 儲存議價狀態
        formData.append('items', JSON.stringify(items));
        formData.append('memo_html', memoHtml);
        formData.append('vendor', vendorSelect.value);
        // 儲存甲方簽名開關狀態 (對接資料庫欄位: is_party_a_signature_needed)
        const signatureToggle = document.getElementById('signature-mode-toggle');
        formData.append('is_party_a_signature_needed', signatureToggle ? signatureToggle.checked : false);
        // 新增自定義時間欄位，解決系統 updated 欄位無法顯示的問題
        formData.append('last_updated', new Date().toISOString());
        formData.append('photo_scale', currentPhotoSize); // 儲存照片縮放比例
        // 移除 stamp_scale，改為由廠商資料控制

        // 工程地點相關
        formData.append('project_address', document.getElementById('c-address-text').innerText);
        formData.append('project_lat', document.getElementById('c-address-lat').value);
        formData.append('project_lng', document.getElementById('c-address-lng').value);
        formData.append('project_map_url', document.getElementById('c-address-map-url').value);

        // 取得 image-upload 中的真實 File 物件 (注意：此前的 uploadedImages 是 DataURL，我們要改用原始檔案)
        const fileInput = document.getElementById('image-upload-files') || { files: [] }; // 假設我們調整 HTML 使用隱藏 input 存檔案
        // 處理照片：保留舊的 + 新增新的
        if (keepExistingImages.length > 0) {
            // PocketBase 支援直接傳入檔名來保留舊檔案
            keepExistingImages.forEach(name => {
                formData.append('images', name);
            });
        }

        // 取得已選取的實體檔案
        for (let file of selectedFiles) {
            formData.append('images', file);
        }

        const recordId = currentQuotationId;
        let record;
        if (recordId) {
            record = await pb.collection('quotations').update(recordId, formData, { '$autoCancel': false });
        } else {
            record = await pb.collection('quotations').create(formData, { '$autoCancel': false });
        }

        console.log('儲存成功，回傳紀錄內容:', record);
        currentQuotationId = record.id; // 儲存後標記為正在編輯此單

        // 同步更新當前廠商的印章比例到廠商資料庫
        const selectedVendorId = vendorSelect.value;
        if (selectedVendorId) {
            try {
                await pb.collection('vendors').update(selectedVendorId, {
                    stamp_scale: currentStampSize
                }, { '$autoCancel': false });
                // 同步更新本地 vendors 資料，避免下次切換選單時抓到舊比例
                const v = vendors.find(x => x.id === selectedVendorId);
                if (v) v.stamp_scale = currentStampSize;
            } catch (err) {
                console.warn('同步廠商印章比例失敗:', err);
            }
        }

        // 解析補充說明並自動同步到 memo_presets (重複檢查)
        const memoLines = document.getElementById('memo-field').innerText.split('\n');
        // 先取得現有 presets
        const existingPresets = await pb.collection('memo_presets').getFullList();
        const existingContents = existingPresets.map(p => p.content.trim());

        for (let line of memoLines) {
            const cleanLine = line.replace(/^\d+\.\s*/, '').trim();
            if (cleanLine.length > 3 && !existingContents.includes(cleanLine)) {
                try {
                    await pb.collection('memo_presets').create({ content: cleanLine }, { '$autoCancel': false });
                    existingContents.push(cleanLine); // 避免本次儲存中重複
                } catch (err) { /* 忽略 */ }
            }
        }

        alert(isCopy ? '已成功複製並儲存新的報價單！' : '報價單已成功儲存！');

        updateItemsDatalist();
        updateCustomersDatalist(); // 新增：儲存後立即更新客戶下拉選單與 Datalist
        loadHistory();
        loadMemoPresets();
        loadItemPresets();

    } catch (error) {
        console.error('儲存失敗', error);
        alert('儲存失敗: ' + (error.data?.message || error.message));
    } finally {
        const btn = document.getElementById('btn-save');
        btn.disabled = false;
        btn.innerHTML = '<i class="bi bi-cloud-arrow-up me-2"></i>儲存並發送';
    }
}

async function loadHistory() {
    const customerSearch = document.getElementById('history-search-customer').value;
    const historyBody = document.getElementById('history-body');
    historyBody.innerHTML = '<tr><td colspan="6" class="text-center">載入中...</td></tr>';

    try {
        // 更新排序圖示
        updateSortIcons();

        // 優化搜尋字串，如果欄位不存在，getList 會噴 400
        let filterStr = '';
        const filters = [];
        if (customerSearch) {
            // 注意：若資料庫缺少欄位，此過濾語法會導致 400 錯誤。
            // 建議使用者確認欄位是否存在，或暫時縮減過濾範圍。
            // 同時搜尋 customer_name 與 project_name / project_location
            filters.push(`(customer_name ~ "${customerSearch}" || project_name ~ "${customerSearch}" || project_location ~ "${customerSearch}")`);
        }

        const dateStart = document.getElementById('history-start').value;
        const dateEnd = document.getElementById('history-end').value;
        if (dateStart) {
            filters.push(`date >= "${dateStart} 00:00:00"`);
        }
        if (dateEnd) {
            filters.push(`date <= "${dateEnd} 23:59:59"`);
        }

        filterStr = filters.join(' && ');

        // 構建排序字串 (PocketBase 語法: field 或 -field)
        const sortParam = (historySort.direction === 'desc' ? '-' : '') + historySort.field;

        const options = {
            sort: sortParam,
            $autoCancel: false
        };
        if (filterStr) options.filter = filterStr;

        console.log('正在讀取歷史紀錄...', { options });

        let records;
        try {
            records = await pb.collection('quotations').getList(1, 50, options);
        } catch (err) {
            // 如果帶排序失敗，嘗試不帶排序 (處理可能不存在的欄位)
            if (err.status === 400 && options.sort) {
                console.warn('帶排序讀取失敗，嘗試不帶排序...', err);
                delete options.sort;
                records = await pb.collection('quotations').getList(1, 50, options);
            } else {
                throw err;
            }
        }

        if (records.items.length > 0) {
            console.log('歷史紀錄欄位清單 (請確認是否有 last_updated):', Object.keys(records.items[0]));
            console.log('第一個紀錄範例:', records.items[0]);
        }

        historyBody.innerHTML = '';
        if (records.items.length === 0) {
            historyBody.innerHTML = '<tr><td colspan="7" class="text-center">查無紀錄</td></tr>';
            return;
        }

        records.items.forEach(q => {
            const tr = document.createElement('tr');
            tr.className = 'clickable-row';
            // 安全處理日期與顯示
            const displayDate = q.date ? q.date.substring(0, 10) : (q.created ? q.created.substring(0, 10) : '---');
            const displayTotal = q.total ? q.total.toLocaleString() : '0';

            // 優先使用自定義的 last_updated，其次是系統 updated，最後是 created
            const rawUpdated = q.last_updated || q.updated || q.created;
            let displayUpdated = '---';
            if (rawUpdated) {
                try {
                    displayUpdated = new Date(rawUpdated).toLocaleString('zh-TW', {
                        timeZone: 'Asia/Taipei',
                        hour12: false,
                        year: 'numeric',
                        month: '2-digit',
                        day: '2-digit',
                        hour: '2-digit',
                        minute: '2-digit'
                    }).replace(/\//g, '-');
                } catch (e) {
                    displayUpdated = String(rawUpdated).substring(0, 16).replace('T', ' ');
                }
            }

            const statusBadge = q.signature_client
                ? '<span class="badge rounded-pill bg-success">已回簽</span>'
                : '<span class="badge rounded-pill bg-danger">未簽名</span>';

            tr.innerHTML = `
                <td>${q.quo_number || '---'}</td>
                <td>${displayDate}</td>
                <td>${q.customer_name || '未命名客戶'}</td>
                <td>NT$ ${displayTotal}</td>
                <td class="small">${displayUpdated}</td>
                <td>${statusBadge}</td>
                <td>
                    <div class="btn-group btn-group-sm">
                        <button class="btn btn-outline-primary" onclick="event.stopPropagation(); editQuotation('${q.id}')">編輯</button>
                        <button class="btn btn-outline-info" onclick="event.stopPropagation(); copyQuotation('${q.id}')">複製</button>
                        <button class="btn btn-outline-success" onclick="event.stopPropagation(); copyShareLinkById('${q.id}')"><i class="bi bi-share"></i></button>
                        <button class="btn btn-outline-danger" onclick="event.stopPropagation(); deleteQuotation('${q.id}')">刪除</button>
                    </div>
                </td>
            `;
            tr.onclick = () => editQuotation(q.id);
            historyBody.appendChild(tr);
        });
    } catch (e) {
        console.error('歷史讀取失敗詳細資訊:', e);
        const detail = e.data?.message || e.message;
        const errorData = e.data?.data ? JSON.stringify(e.data.data) : '';

        alert(`讀取歷史紀錄失敗！\n錯誤原因：${detail}\n${errorData}\n\n這通常是：\n1. 欄位名稱不符 (例如少了 customer_name)\n2. PocketBase API Rules 未開放 List 讀取權限\n3. 過濾語法錯誤`);
        historyBody.innerHTML = '<tr><td colspan="7" class="text-center text-danger">讀取失敗</td></tr>';
    }
}

window.toggleHistorySort = function (field) {
    if (historySort.field === field) {
        historySort.direction = historySort.direction === 'asc' ? 'desc' : 'asc';
    } else {
        historySort.field = field;
        historySort.direction = 'desc'; // 切換新欄位預設由大到小
    }
    loadHistory();
};

function updateSortIcons() {
    const iconDate = document.getElementById('sort-icon-date');
    const iconUpdated = document.getElementById('sort-icon-updated');

    if (iconDate) iconDate.innerHTML = '';
    if (iconUpdated) iconUpdated.innerHTML = '';

    const targetIcon = document.getElementById(`sort-icon-${historySort.field}`);
    if (targetIcon) {
        const iconClass = historySort.direction === 'asc' ? 'bi-caret-up-fill' : 'bi-caret-down-fill';
        targetIcon.innerHTML = `<i class="bi ${iconClass}"></i>`;
    }
}

window.deleteQuotation = async function (id) {
    if (confirm('確定要永久刪除此報價單嗎？')) {
        try {
            await pb.collection('quotations').delete(id);
            loadHistory();
        } catch (e) { alert('刪除失敗'); }
    }
};

window.editQuotation = async function (id) {
    console.log('正在嘗試載入報價單 ID:', id);
    try {
        const q = await pb.collection('quotations').getOne(id, { '$autoCancel': false });
        console.log('取得報價單原始資料:', q);
        currentQuotationId = q.id; // 標記正在編輯此單

        // 還原基本資訊 (加入安全檢查)
        const safeSetText = (id, val) => {
            const el = document.getElementById(id);
            if (el) {
                if (el.tagName === 'INPUT') el.value = val || "";
                else el.innerText = val || "";

                // 額外同步：如果是 c-name，也同步到 sig-c-name
                if (id === 'c-name') {
                    const sigCName = document.getElementById('sig-c-name');
                    if (sigCName) sigCName.innerText = val || "";
                }
            }
            else console.warn(`找不到元素: ${id}`);
        };
        const safeSetValue = (id, val) => {
            const el = document.getElementById(id);
            if (el) el.value = val || "";
            else console.warn(`找不到元素: ${id}`);
        };

        safeSetText('quo-number', q.quo_number);
        safeSetText('c-name', q.customer_name);
        safeSetText('c-location', q.project_location || q.project_name);
        safeSetText('c-contact', q.customer_contact || "");
        safeSetText('c-phone', q.customer_phone || "");

        const dateVal = q.date ? q.date.substring(0, 10) : "";
        safeSetValue('c-date-input', dateVal);
        safeSetText('c-date-display', dateVal);

        // 還原照片與印章比例
        if (q.photo_scale) {
            currentPhotoSize = q.photo_scale;
            const pScaleInput = document.getElementById('photo-scale');
            const pScaleVal = document.getElementById('photo-scale-val');
            if (pScaleInput) pScaleInput.value = currentPhotoSize;
            if (pScaleVal) pScaleVal.innerText = currentPhotoSize;
        }

        // 還原工程地點
        const addrText = q.project_address || "";
        const mapUrl = q.project_map_url || "";
        if (document.getElementById('c-address-text')) document.getElementById('c-address-text').innerText = addrText;
        if (document.getElementById('c-address-lat')) document.getElementById('c-address-lat').value = q.project_lat || "";
        if (document.getElementById('c-address-lng')) document.getElementById('c-address-lng').value = q.project_lng || "";
        if (document.getElementById('c-address-map-url')) document.getElementById('c-address-map-url').value = mapUrl;
        const mapBtn = document.getElementById('map-link-btn');
        if (mapBtn && mapUrl) {
            mapBtn.href = mapUrl;
            mapBtn.style.display = 'inline-block';
        }

        // 注意：印章比例現在由 vendorSelect.onchange 在載入廠商資訊時自動處理

        // 還原手動修改金額
        manualTotals = q.manual_totals ? (typeof q.manual_totals === 'string' ? JSON.parse(q.manual_totals) : q.manual_totals) : { subtotal: null, total: null };

        const memoEl = document.getElementById('memo-field');
        const memoContainer = document.getElementById('memo-container');
        if (memoEl) memoEl.innerHTML = q.memo_html || "";
        if (memoContainer) memoContainer.style.display = 'block';

        // 還原品項
        itemsBody.innerHTML = '';
        rowCount = 0;
        // 安全處理解析
        let items = q.items;
        if (typeof items === 'string') {
            try { items = JSON.parse(items); } catch (err) {
                console.error('解析 items JSON 失敗:', err);
                items = [];
            }
        }
        if (Array.isArray(items)) {
            const tempCosts = [];
            items.forEach((item, idx) => {
                try {
                    const tr = createRow();
                    tr.querySelector('.item-name').value = item.name || "";
                    tr.querySelector('.item-unit').value = item.unit || "式";
                    tr.querySelector('.item-qty').value = item.qty || 1;
                    tr.querySelector('.item-price').value = item.price || 0;
                    tr.querySelector('.item-note').value = item.note || '';
                    tempCosts.push(item.cost || 0);
                } catch (rowErr) {
                    console.error(`還原第 ${idx + 1} 列品項失敗:`, rowErr);
                }
            });
            refreshCostSidebar(tempCosts); // 還原後刷新側邊欄並填入成本
        }
        calculateTotals();

        // 還原廠商
        if (q.vendor && vendorSelect) {
            vendorSelect.value = q.vendor;
            vendorSelect.dispatchEvent(new Event('change'));
        }

        // 還原圖片 (相容 images 或 photos 欄位)
        uploadedImages = [];
        selectedFiles = [];
        keepExistingImages = []; // 重置
        const imgs = q.images || q.photos || [];
        if (Array.isArray(imgs)) {
            imgs.forEach(img => {
                const url = getFileUrl('quotations', q, img);
                uploadedImages.push(url);
                keepExistingImages.push(img); // 記錄名稱以便後續更新保留
            });
        }
        updateAttachmentLayout();

        // 還原甲方簽名模式狀態
        const signatureToggle = document.getElementById('signature-mode-toggle');
        if (signatureToggle) {
            signatureToggle.checked = q.is_party_a_signature_needed === true;
            // 手動觸發變更以更新 UI 配置
            signatureToggle.dispatchEvent(new Event('change'));
        }

        // 甲方簽名 (簽章) 還原
        const sigImg = document.getElementById('sig-client-img');
        const delSigBtn = document.getElementById('btn-delete-sig');
        if (q.signature_client) {
            const sigUrl = getFileUrl('quotations', q, q.signature_client);
            sigImg.src = sigUrl;
            sigImg.style.display = 'inline-block';
            sigImg.style.width = `${currentStampSize}px`; // 同步大小
            if (delSigBtn) delSigBtn.style.display = 'block';
        } else {
            sigImg.style.display = 'none';
            if (delSigBtn) delSigBtn.style.display = 'none';
        }

        const historyModal = document.getElementById('historyModal');
        if (historyModal) {
            const modalInstance = bootstrap.Modal.getInstance(historyModal);
            if (modalInstance) modalInstance.hide();
        }
    } catch (e) {
        console.error('載入報價單詳細錯誤:', e);
        alert(`載入報價單失敗！\n錯誤原因：${e.message}\n\n請查看瀏覽器控制台 (F12) 以取得詳細資訊。`);
    }
};

window.copyQuotation = async function (id) {
    await editQuotation(id);
    currentQuotationId = null; // 複製時清空 ID，視為新單儲存
    await initQuotationInfo(); // 更新為今日單號
    alert('已載入資料並更新為今日單號，請修改後儲存。');
};

// --- 8. 初始化與輔助功能 ---
async function generateQuoNumber(selectedDate) {
    const parts = selectedDate.split('-');
    if (parts.length !== 3) return;
    const datePart = parts[0] + parts[1] + parts[2]; // YYYYMMDD

    // 改用範圍過濾，這在字串比較中非常精確且不會誤抓其他日期的資料
    const filter = `quo_number >= '${datePart}-00' && quo_number <= '${datePart}-99'`;

    let sequence = "01";
    try {
        const result = await pb.collection('quotations').getList(1, 1, {
            filter: filter,
            sort: '-quo_number',
            $autoCancel: false
        });

        if (result.items.length > 0) {
            const lastFullNo = result.items[0].quo_number;
            const seqPart = lastFullNo.split('-')[1];
            if (seqPart) {
                const nextSeq = parseInt(seqPart) + 1;
                sequence = String(nextSeq).padStart(2, '0');
            }
        }
    } catch (e) {
        console.warn("產生單號失敗", e);
        sequence = "01";
    }

    document.getElementById('quo-number').innerText = `${datePart}-${sequence}`;
}

async function initQuotationInfo() {
    const now = new Date();
    // 修正時區問題，使用當地時間
    const today = new Date(now.getTime() - (now.getTimezoneOffset() * 60000)).toISOString().split('T')[0];
    const dateInput = document.getElementById('c-date-input');
    const dateDisplay = document.getElementById('c-date-display');

    dateInput.value = today;
    dateDisplay.innerText = today;

    // 初始生成單號
    await generateQuoNumber(today);

    // 強制清空初始內容，避免隱形空格干擾 placeholder
    // 修正：如果是檢視模式，則跳過清空動作，以免覆蓋剛讀取的資料
    const params = new URLSearchParams(window.location.search);
    if (!params.get('view')) {
        // 不再強制清空內容，讓 placeholder (如果有的話) 或空狀態自然呈現
        // 但使用者要求「不用有浮水印引導」，所以 HTML 已移除 placeholder
    }

    // 監聽日期變更
    dateInput.addEventListener('change', async (e) => {
        const newDate = e.target.value;
        dateDisplay.innerText = newDate;
        await generateQuoNumber(newDate); // 根據新日期回推序號
    });
}

// 動態同步簽章區名稱
function setupDynamicSync() {
    const vName = document.getElementById('v-name');
    const cName = document.getElementById('c-name');
    const sigVName = document.getElementById('sig-v-name');
    const sigCName = document.getElementById('sig-c-name');

    if (vName && sigVName) {
        vName.addEventListener('input', () => {
            sigVName.innerText = vName.innerText;
        });
        sigVName.innerText = vName.innerText;
    }

    if (cName && sigCName) {
        cName.addEventListener('input', () => {
            // 修正：c-name 是 INPUT，需使用 .value
            sigCName.innerText = cName.value || "";
        });
        sigCName.innerText = cName.value || "";
    }
}


// --- 9. 廠商管理與用印功能 ---

async function renderVendors() {
    try {
        const records = await pb.collection('vendors').getFullList({ sort: 'name', '$autoCancel': false });
        vendors = records;

        vendorSelect.innerHTML = '<option value="">-- 請選擇廠商 --</option>';
        vendorListBody.innerHTML = '';

        vendors.forEach(v => {
            const opt = document.createElement('option');
            opt.value = v.id;
            opt.innerText = v.name;
            vendorSelect.appendChild(opt);

            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${v.name}</td>
                <td>${v.contact}</td>
                <td>
                    <button class="btn btn-sm btn-outline-primary" onclick="loadVendorToForm('${v.id}')">編輯</button>
                    <button class="btn btn-sm btn-outline-danger" onclick="deleteVendor('${v.id}')">刪除</button>
                </td>
            `;
            vendorListBody.appendChild(tr);
        });
    } catch (e) { console.error('讀取廠商失敗', e); }
}

window.loadVendorToForm = function (id) {
    const v = vendors.find(x => x.id === id);
    if (!v) return;
    document.getElementById('vendor-id').value = v.id;
    document.getElementById('m-v-name').value = v.name;
    document.getElementById('m-v-tax').value = v.tax_id;
    document.getElementById('m-v-address').value = v.address;
    document.getElementById('m-v-phone').value = v.phone;
    document.getElementById('m-v-contact').value = v.contact;
    document.getElementById('m-v-website').value = v.website || '';
    document.getElementById('m-v-email').value = v.email || '';
    document.getElementById('m-v-stamp-scale').value = v.stamp_scale || 175;
    if (v.stamp) {
        stampPreview.style.display = 'block';
        stampPreview.querySelector('img').src = getFileUrl('vendors', v, v.stamp);
    } else {
        stampPreview.style.display = 'none';
    }
};

window.deleteVendor = async function (id) {
    if (confirm('確定要刪除此廠商資料嗎？')) {
        try {
            await pb.collection('vendors').delete(id);
            renderVendors();
        } catch (e) { alert('刪除失敗'); }
    }
};

window.resetVendorForm = function () {
    vendorForm.reset();
    document.getElementById('vendor-id').value = '';
    stampPreview.style.display = 'none';
};

document.getElementById('m-v-stamp').addEventListener('change', function (e) {
    const file = e.target.files[0];
    if (file) {
        const reader = new FileReader();
        reader.onload = (event) => {
            stampPreview.style.display = 'block';
            stampPreview.querySelector('img').src = event.target.result;
        };
        reader.readAsDataURL(file);
    }
});

vendorForm.onsubmit = async function (e) {
    e.preventDefault();
    const id = document.getElementById('vendor-id').value;
    const formData = new FormData();
    formData.append('name', document.getElementById('m-v-name').value);
    formData.append('tax_id', document.getElementById('m-v-tax').value);
    formData.append('address', document.getElementById('m-v-address').value);
    formData.append('phone', document.getElementById('m-v-phone').value);
    formData.append('contact', document.getElementById('m-v-contact').value);
    formData.append('website', document.getElementById('m-v-website').value);
    formData.append('email', document.getElementById('m-v-email').value);
    formData.append('stamp_scale', document.getElementById('m-v-stamp-scale').value || 175);

    const stampFile = document.getElementById('m-v-stamp').files[0];
    if (stampFile) {
        // 壓縮廠商印章
        const compressedStamp = await compressImage(stampFile, 200);
        formData.append('stamp', compressedStamp);
    }

    try {
        if (id) {
            await pb.collection('vendors').update(id, formData);
        } else {
            await pb.collection('vendors').create(formData);
        }
        alert('廠商資料已儲存！');
        resetVendorForm();
        renderVendors();
    } catch (e) { alert('儲存廠商失敗: ' + e.message); }
};

vendorSelect.onchange = function () {
    const v = vendors.find(x => x.id === this.value);
    if (v) {
        document.getElementById('v-name').innerText = v.name;
        document.getElementById('v-tax').innerText = v.tax_id || '';
        document.getElementById('v-address').innerText = v.address || '';
        document.getElementById('v-phone').innerText = v.phone || '';
        document.getElementById('v-contact').innerText = v.contact || '';
        document.getElementById('v-website').innerText = v.website || '';
        document.getElementById('v-email').innerText = v.email || '';
        document.getElementById('sig-v-name').innerText = v.name;

        // 套用廠商預設印章大小
        if (v.stamp_scale) {
            currentStampSize = v.stamp_scale;
            const slider = document.getElementById('stamp-scale');
            const valEl = document.getElementById('stamp-scale-val');
            if (slider) slider.value = currentStampSize;
            if (valEl) valEl.innerText = currentStampSize;
            if (stampImgArea) stampImgArea.style.width = `${currentStampSize}px`;
            if (sigImgArea) sigImgArea.style.width = `${currentStampSize}px`;
        }

        if (v.stamp) {
            stampImgArea.src = getFileUrl('vendors', v, v.stamp);
            stampImgArea.style.display = 'block';
        } else {
            stampImgArea.style.display = 'none';
        }
    }
};

// 處理印章縮放
document.getElementById('stamp-scale').addEventListener('input', function (e) {
    const size = e.target.value;
    currentStampSize = size; // 更新全域變數
    const valEl = document.getElementById('stamp-scale-val');
    if (valEl) valEl.innerText = size;

    // 同時作用於乙方印章與甲方簽署
    if (stampImgArea) stampImgArea.style.width = `${size}px`;
    if (sigImgArea) sigImgArea.style.width = `${size}px`;
});

// 處理照片縮放
document.getElementById('photo-scale').addEventListener('input', function (e) {
    const size = e.target.value;
    currentPhotoSize = size;
    const valEl = document.getElementById('photo-scale-val');
    if (valEl) valEl.innerText = size;

    // 即時套用到所有附件圖片
    const images = document.querySelectorAll('.attachment-item');
    images.forEach(container => {
        container.style.width = `${size}px`;
        container.style.height = 'auto'; // 縮放時取消固定高度，保持比例
    });
});

// 輔助函式：取得列印檔名 (甲方公司名稱_工程名稱_日期)
function getPrintFilename() {
    const companyEl = document.getElementById('c-name');
    const projectEl = document.getElementById('c-location');

    const company = (companyEl.value || companyEl.innerText || "甲方公司").trim();
    const project = (projectEl.value || projectEl.innerText || "工程報價").trim();

    const now = new Date();
    const dateStr = now.getFullYear() +
        String(now.getMonth() + 1).padStart(2, '0') +
        String(now.getDate()).padStart(2, '0');

    return `${company}-${project}(${dateStr})`.replace(/[\/\?<>\\:\*\|":]/g, '_');
}

// 處理列印時的檔名
window.addEventListener('beforeprint', () => {
    window._oldTitle = document.title;
    document.title = getPrintFilename();
});
window.addEventListener('afterprint', () => {
    document.title = window._oldTitle || "大馬道路報價系統";
});

// --- 11. 分享連結與電子簽章邏輯 ---

// 產生分享連結
window.generateShareLink = async function () {
    if (!currentQuotationId) {
        alert('請先儲存報價單，才能產生分享連結');
        return;
    }
    await copyShareLinkById(currentQuotationId);
}

// 根據 ID 複製分享連結
window.copyShareLinkById = async function (id) {
    const currentUrl = window.location.origin + window.location.pathname;
    const shareUrl = `${currentUrl}?view=${id}`;

    try {
        await navigator.clipboard.writeText(shareUrl);
        alert(`分享連結已複製到剪貼簿！`);
    } catch (err) {
        prompt('請手動複製連結：', shareUrl);
    }
}

// 檢查是否為檢視模式
async function checkViewMode() {
    const params = new URLSearchParams(window.location.search);
    const viewId = params.get('view');

    if (viewId) {
        isViewMode = true;
        currentQuotationId = viewId;
        document.getElementById('ui-controls').style.display = 'none';
        // 隱藏原本的按鈕，改由簽名處區塊處理點擊
        document.getElementById('btn-client-sign').style.display = 'none';
        const toolbar = document.getElementById('view-mode-toolbar');
        if (toolbar) toolbar.style.display = 'flex';

        // 隱藏右側浮動控制項
        const floatingControls = document.getElementById('floating-controls');
        if (floatingControls) floatingControls.style.setProperty('display', 'none', 'important');

        // 監聽列印事件以自動修改檔名 (document.title)
        // 已在全域設置，此處保留邏輯一致性即可
        window.onbeforeprint = () => {
            window._oldTitle = document.title;
            document.title = getPrintFilename();
        };

        window.onafterprint = () => {
            document.title = window._oldTitle || "大馬道路報價系統";
        };

        // 進入唯讀模式
        document.body.classList.add('view-mode');

        await loadQuotationForView(viewId);
    }
}

async function loadQuotationForView(id) {
    try {
        const q = await pb.collection('quotations').getOne(id, { expand: 'vendor', '$autoCancel': false });

        // 填充基本資訊
        const setValOrText = (id, val) => {
            const el = document.getElementById(id);
            if (!el) return;
            if (el.tagName === 'INPUT') el.value = val || '';
            else el.innerText = val || '';
        };

        document.getElementById('quo-number').innerText = q.quo_number;
        const customerName = (q.customer_name || "").trim();
        const projectName = (q.project_name || q.project_location || "").trim();

        setValOrText('c-name', customerName);
        setValOrText('c-location', projectName);

        const sigCName = document.getElementById('sig-c-name');
        if (sigCName) sigCName.innerText = customerName;
        setValOrText('c-contact', (q.customer_contact || "").trim());
        setValOrText('c-phone', (q.customer_phone || "").trim());
        document.getElementById('c-date-input').value = q.date ? q.date.substring(0, 10) : '';
        document.getElementById('c-date-display').innerText = q.date ? q.date.substring(0, 10) : '';

        // 更新頁面標題與描述，供分享連結預覽
        const datePart = q.date ? q.date.substring(0, 10).replace(/-/g, '') : '';
        const fullTitle = `${customerName}-${projectName}(${datePart})`;
        document.title = fullTitle;

        const metaDesc = document.querySelector('meta[name="description"]');
        if (metaDesc) {
            metaDesc.setAttribute("content", `大馬道路工程報價單：${customerName} - ${projectName}。點擊查看詳細品項與進行線上簽署。`);
        }

        // 還原比例狀態
        if (q.photo_scale) {
            currentPhotoSize = q.photo_scale;
            const pScaleInput = document.getElementById('photo-scale');
            const pScaleVal = document.getElementById('photo-scale-val');
            if (pScaleInput) pScaleInput.value = currentPhotoSize;
            if (pScaleVal) pScaleVal.innerText = currentPhotoSize;
        }

        // 訪客模式還原工程地點
        const addrText = q.project_address || "";
        const mapUrl = q.project_map_url || "";
        if (document.getElementById('c-address-text')) document.getElementById('c-address-text').innerText = addrText;
        const mapBtn = document.getElementById('map-link-btn');
        if (mapBtn && mapUrl) {
            mapBtn.href = mapUrl;
            mapBtn.style.display = 'inline-block';
        }

        // 訪客模式：如果有 vendor 資訊，套用廠商預設印章大小
        if (q.expand && q.expand.vendor && q.expand.vendor.stamp_scale) {
            currentStampSize = q.expand.vendor.stamp_scale;
            if (stampImgArea) stampImgArea.style.width = `${currentStampSize}px`;
            if (sigImgArea) sigImgArea.style.width = `${currentStampSize}px`;
            // 更新 UI 控制項 (如果有顯示的話)
            const slider = document.getElementById('stamp-scale');
            const valEl = document.getElementById('stamp-scale-val');
            if (slider) slider.value = currentStampSize;
            if (valEl) valEl.innerText = currentStampSize;
        }

        // 還原議價狀態
        manualTotals = q.manual_totals ? (typeof q.manual_totals === 'string' ? JSON.parse(q.manual_totals) : q.manual_totals) : { subtotal: null, total: null };

        // 渲染品項
        itemsBody.innerHTML = '';
        rowCount = 0;
        if (q.items) {
            const items = typeof q.items === 'string' ? JSON.parse(q.items) : q.items;
            const tempCosts = [];
            items.forEach(item => {
                const row = createRow();
                row.querySelector('.item-name').value = item.name;
                row.querySelector('.item-unit').value = item.unit;
                row.querySelector('.item-qty').value = item.qty;
                row.querySelector('.item-price').value = item.price;
                row.querySelector('.item-note').value = item.note || '';
                tempCosts.push(item.cost || 0);
            });
            refreshCostSidebar(tempCosts);
        }

        // 隱藏分析面板 (訪客模式)
        const costPanel = document.getElementById('cost-analysis-panel');
        if (costPanel) costPanel.style.display = 'none';

        // 補充說明
        const memoContent = (q.memo_html || '').trim();
        const memoField = document.getElementById('memo-field');
        const memoContainer = document.getElementById('memo-container');
        memoField.innerHTML = memoContent;

        // 如果在檢視模式且備註為空，隱藏整個備註區塊
        if (memoContainer) {
            if (!memoContent || memoContent === '<br>') {
                memoContainer.style.display = 'none';
            } else {
                memoContainer.style.display = 'block';
            }
        }

        // 附件照片
        if (q.images || q.photos) {
            const images = q.images || q.photos;
            uploadedImages = []; // 重置
            selectedFiles = []; // 清除

            images.forEach(imgName => {
                const url = getFileUrl('quotations', q, imgName);
                uploadedImages.push(url);
            });
            updateAttachmentLayout();
        }

        // 甲方簽名模式載入 (檢視模式)
        const signatureToggle = document.getElementById('signature-mode-toggle');
        if (signatureToggle) {
            signatureToggle.checked = q.is_party_a_signature_needed === true;
            // 重要：在檢視模式下也需要觸發 UI 更新
            const modeUpdateFunc = window._updateSignatureUI;
            if (typeof modeUpdateFunc === 'function') {
                modeUpdateFunc();
            } else {
                // 如果函數還沒準備好，延遲一下下執行或直接在這裡處理簡單切換
                signatureToggle.dispatchEvent(new Event('change'));
            }
        }

        // 廠商資訊
        if (q.expand && q.expand.vendor) {
            const v = q.expand.vendor;
            document.getElementById('v-name').innerText = v.name;
            document.getElementById('v-tax').innerText = v.tax_id || '';
            document.getElementById('v-address').innerText = v.address || '';
            document.getElementById('v-phone').innerText = v.phone || '';
            document.getElementById('v-contact').innerText = v.contact || '';
            document.getElementById('v-website').innerText = v.website || '';
            document.getElementById('v-email').innerText = v.email || '';
            document.getElementById('sig-v-name').innerText = v.name;
            if (v.stamp) {
                stampImgArea.src = getFileUrl('vendors', v, v.stamp);
                stampImgArea.style.display = 'block';
            }
        }

        // 甲方簽名處理
        const sigDisplay = document.getElementById('sig-client-display');
        const sigImg = document.getElementById('sig-client-img');

        if (q.signature_client) {
            const sigUrl = getFileUrl('quotations', q, q.signature_client);
            sigImg.src = sigUrl;
            sigImg.style.display = 'inline-block';
            sigImg.style.width = `${currentStampSize}px`; // 同步大小
            sigDisplay.classList.remove('needs-signature');
            // 移除點擊事件 (如果存在)
            sigDisplay.onclick = null;
        } else {
            sigImg.style.display = 'none';
            sigDisplay.classList.add('needs-signature');
            // 點擊後開啟簽名 Modal
            sigDisplay.onclick = () => {
                const modal = new bootstrap.Modal(document.getElementById('signatureModal'));
                modal.show();
            };
        }

        calculateTotals();
        setupDynamicSync();

        // 禁止所有編輯 (排除 Modal 內的輸入框)
        const editables = document.querySelectorAll('[contenteditable="true"]');
        editables.forEach(el => {
            el.setAttribute('contenteditable', 'false');
            el.style.border = 'none';
        });
        const inputs = document.querySelectorAll('input:not(.modal input), select:not(.modal select), textarea:not(.modal textarea)');
        inputs.forEach(el => {
            el.disabled = true;
            el.style.backgroundColor = 'transparent';
        });
        document.querySelectorAll('.btn-remove-row, #add-row').forEach(el => el.style.display = 'none');

    } catch (e) {
        console.error('載入分享報價單詳情失敗:', e);
        // 如果是權限問題，會有具體的狀態碼 400 或 404
        if (e.status === 404) {
            alert('找不到該報價單，請確認 ID 是否正確');
        } else if (e.status === 400 || e.status === 403) {
            alert('讀取失敗：可能是資料庫 API Rules 權限未開放為 Public');
        } else {
            alert('讀取失敗：' + e.message);
        }
    }
}

// 簽名板功能
function initSignaturePad() {
    const canvas = document.getElementById('signature-canvas');
    if (canvas) {
        signaturePad = new SignaturePad(canvas, {
            backgroundColor: 'rgba(255, 255, 255, 0)',
            penColor: 'rgb(0, 0, 0)'
        });

        // 綁定視窗縮放
        window.addEventListener('resize', resizeCanvas);
    }
}

function resizeCanvas() {
    const canvas = document.getElementById('signature-canvas');
    if (!canvas || !signaturePad) return;

    // 取得容器寬度
    const ratio = Math.max(window.devicePixelRatio || 1, 1);
    const containerWidth = canvas.parentElement.clientWidth;

    // 設置畫布寬度
    canvas.width = containerWidth * ratio;
    // 手機版高度可以稍微調高一點
    canvas.height = (window.innerWidth < 768 ? 250 : 200) * ratio;
    canvas.getContext("2d").scale(ratio, ratio);

    signaturePad.clear(); // 調整大小後必須清除畫布
}

async function submitClientSignature() {
    if (!currentQuotationId) return;

    // 更強健的標籤頁判斷方式：檢查哪個區塊具備 .active
    const isHandTab = document.getElementById('sig-hand').classList.contains('show');

    if (isHandTab) {
        if (!signaturePad || signaturePad.isEmpty()) {
            alert('請先在板上簽名');
            return;
        }
        // 將 Canvas 轉為 Blob
        const dataUrl = signaturePad.toDataURL('image/png');
        const res = await fetch(dataUrl);
        signatureBlob = await res.blob();
    } else {
        const fileInput = document.getElementById('sig-file');
        if (!fileInput || fileInput.files.length === 0) {
            alert('請先選擇簽名圖檔');
            return;
        }
        // 壓縮上傳的簽名圖檔
        signatureBlob = await compressImage(fileInput.files[0], 200);
    }

    try {
        const btn = document.getElementById('btn-submit-sig');
        btn.disabled = true;
        btn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>回傳中...';

        const formData = new FormData();
        formData.append('signature_client', signatureBlob, 'signature.png');
        formData.append('signed_at', new Date().toISOString());

        await pb.collection('quotations').update(currentQuotationId, formData);

        alert('簽名已成功回傳！感謝您的簽署。');
        location.reload(); // 重新整理以載入簽名
    } catch (e) {
        console.error('簽名上傳失敗', e);
        alert('簽名回傳失敗，請稍後再試');
        document.getElementById('btn-submit-sig').disabled = false;
        document.getElementById('btn-submit-sig').innerText = '確認提交並回傳';
    }
}


async function deleteClientSignature() {
    if (!currentQuotationId) {
        alert('請先載入或儲存報價單');
        return;
    }
    if (!confirm('確定要刪除此份報價單的甲方簽章嗎？')) return;

    try {
        await pb.collection('quotations').update(currentQuotationId, {
            signature_client: null,
            signed_at: null
        });
        alert('簽章已成功刪除！');
        // 重新載入當前報價單內容以更新 UI
        editQuotation(currentQuotationId);
        loadHistory(); // 同步更新歷史紀錄狀態
    } catch (e) {
        console.error('刪除簽章失敗:', e);
        alert('刪除失敗: ' + e.message);
    }
}


// --- 11b. 簽名模式切換邏輯 (甲方須簽名 / 不須簽名) ---
function setupSignatureModeToggle() {
    const toggle = document.getElementById('signature-mode-toggle');
    if (!toggle) return;

    const updateUI = () => {
        const isPartyANeeded = toggle.checked;
        const sigA = document.getElementById('sig-a-col');
        const sigBCol = document.getElementById('sig-b-col');
        const sigBPlaceholder = document.getElementById('sig-b-placeholder');
        const sigBContent = document.getElementById('sig-b-content');
        const sigBlock = document.getElementById('signature-block');
        const attachments = document.getElementById('quotation-attachments');
        const memoContainer = document.getElementById('memo-container');

        const container = document.querySelector('.a4-page > .p-5');

        if (!isPartyANeeded) {
            // 模式 A：甲方不須簽名 (預設)
            if (sigA) sigA.style.setProperty('display', 'none', 'important');
            if (sigBCol) sigBCol.style.setProperty('display', 'none', 'important');

            // 下移「補充說明」區塊以對齊乙方
            if (memoContainer) {
                memoContainer.style.marginTop = '42px';
            }

            if (sigBPlaceholder && sigBContent) {
                sigBPlaceholder.appendChild(sigBContent);
                // 乙方簽名區調整
                sigBPlaceholder.style.marginTop = '50px';
                if (sigBContent.style) sigBContent.style.marginTop = '0px';
                sigBContent.querySelectorAll('p').forEach(p => {
                    p.style.marginBottom = '1.2rem';
                });
            }
            // 照片移到最下面
            if (attachments && container) {
                container.appendChild(attachments);
            }
            if (sigBlock) sigBlock.style.setProperty('display', 'none', 'important');
        } else {
            // 模式 B：甲方須簽名 (原本狀態)
            if (sigA) sigA.style.setProperty('display', 'flex', 'important');
            if (sigBCol) sigBCol.style.setProperty('display', 'flex', 'important');

            // 恢復「補充說明」原始間距
            if (memoContainer) {
                memoContainer.style.marginTop = '';
            }

            if (sigBCol && sigBContent) {
                sigBCol.appendChild(sigBContent);
                sigBContent.style.marginTop = '';
                sigBContent.querySelectorAll('p').forEach(p => {
                    p.style.marginBottom = '';
                });
            }
            // 照片搬回簽名區之前
            if (attachments && sigBlock && container) {
                container.insertBefore(attachments, sigBlock);
            }
            if (sigBlock) {
                sigBlock.style.setProperty('display', 'flex', 'important');
                sigBlock.classList.add('mt-5', 'pt-5');
            }
        }
    };

    window._updateSignatureUI = updateUI;
    toggle.addEventListener('change', updateUI);
    updateUI();
}

// --- 12. 初始化執行 (放在最末以確保所有函數與變數都已定義) ---
addRowBtn.addEventListener('click', createRow);
document.getElementById('btn-save').addEventListener('click', saveQuotation);
document.getElementById('btn-history').addEventListener('click', loadHistory);
document.getElementById('btn-history-filter').addEventListener('click', loadHistory);

// 核心初始化
initQuotationInfo();
setupDynamicSync();
setupSignatureModeToggle();

// 初始化拖拽排序
if (typeof Sortable !== 'undefined') {
    new Sortable(itemsBody, {
        animation: 150,
        handle: '.drag-handle', // 指定項次為拖拽手把
        ghostClass: 'sortable-ghost',
        onEnd: function () {
            updateRowNumbers();
            calculateTotals();
        }
    });
}

loadMemoPresets();
renderVendors();
updateItemsDatalist();
loadItemPresets();
console.log('正在初始化客戶功能...');
updateCustomersDatalist();
setupCustomerAutoFill();

// 監聽客戶搜尋框
const customerSearchInput = document.getElementById('customer-search-input');
if (customerSearchInput) {
    customerSearchInput.addEventListener('input', (e) => {
        const query = e.target.value.toLowerCase().trim();
        const filtered = customerDictionary.filter(c =>
            c.name.toLowerCase().includes(query) ||
            c.contact.toLowerCase().includes(query) ||
            c.phone.toLowerCase().includes(query)
        );
        renderCustomerList(filtered);
    });
    // 防止點擊搜尋框時關閉 Dropdown
    customerSearchInput.addEventListener('click', (e) => e.stopPropagation());
}

console.log('客戶功能初始化完成');

// 初始新增一列 (使用者再視需求自行新增)
for (let i = 0; i < 1; i++) createRow();
calculateTotals();

// 初始印章大小設定 (175%)
const initScale = 175;
if (stampImgArea) {
    stampImgArea.style.width = `${initScale}px`;
}
const sValEl = document.getElementById('stamp-scale-val');
if (sValEl) sValEl.innerText = initScale;
const sSlider = document.getElementById('stamp-scale');
if (sSlider) sSlider.value = initScale;

// 分享與簽名事件
document.getElementById('btn-share').addEventListener('click', generateShareLink);
document.getElementById('btn-clear-sig').addEventListener('click', () => signaturePad.clear());
document.getElementById('btn-submit-sig').addEventListener('click', submitClientSignature);
document.getElementById('btn-delete-sig').addEventListener('click', (e) => {
    e.stopPropagation();
    deleteClientSignature();
});

// 簽名圖片預覽
document.getElementById('sig-file').addEventListener('change', function (e) {
    const file = e.target.files[0];
    if (file) {
        const reader = new FileReader();
        reader.onload = (event) => {
            const preview = document.getElementById('sig-upload-preview');
            preview.style.display = 'block';
            preview.querySelector('img').src = event.target.result;
        };
        reader.readAsDataURL(file);
    }
});

// 初始化簽名板
initSignaturePad();

// 監聽簽名 Modal 開啟後立刻重調畫布大小
const sigModalEl = document.getElementById('signatureModal');
if (sigModalEl) {
    sigModalEl.addEventListener('shown.bs.modal', resizeCanvas);
}

// 檢查是否進入檢視模式
checkViewMode();

// --- 13. PIN 碼登入與重置邏輯 ---
let SYSTEM_PIN = "113117"; // 預設密碼
let configRecordId = null;
let resetStep = 0; // 0: 登入, 1: 舊密 1, 2: 舊密 2, 3: 新密
let firstOldPin = "";

const pinInputs = document.querySelectorAll('.pin-box');
const loginOverlay = document.getElementById('login-overlay');
const loginHint = document.getElementById('login-hint');

// 從 PocketBase 同步密碼
async function syncPinFromDb() {
    try {
        const record = await pb.collection('system_config').getFirstListItem('key="system_pin"').catch(() => null);
        if (record) {
            SYSTEM_PIN = record.value;
            configRecordId = record.id;
        } else {
            // 如果資料庫沒設，嘗試建立 (方便使用者)
            const newRecord = await pb.collection('system_config').create({ key: 'system_pin', value: '113117' }).catch(() => null);
            if (newRecord) configRecordId = newRecord.id;
        }
    } catch (e) {
        console.warn('同步資料庫密碼失敗，使用本地預設', e);
    }
}

async function initPinLogic() {
    await syncPinFromDb();

    // 1. 檢查是否已登入 (排除檢視模式)
    if (isViewMode) {
        if (loginOverlay) loginOverlay.style.display = 'none';
        return;
    }

    const sessionAuth = localStorage.getItem('system_auth');
    if (sessionAuth === 'true') {
        if (loginOverlay) loginOverlay.style.display = 'none';
        return;
    }

    // 2. 設置輸入框行為
    pinInputs.forEach((input, index) => {
        input.addEventListener('input', (e) => {
            if (e.target.value.length === 1 && index < pinInputs.length - 1) {
                pinInputs[index + 1].focus();
            }
            if (Array.from(pinInputs).every(i => i.value.length === 1)) {
                checkFullPin();
            }
        });

        input.addEventListener('keydown', (e) => {
            if (e.key === 'Backspace' && !e.target.value && index > 0) {
                pinInputs[index - 1].focus();
            }
        });
    });

    // 3. 重置按鈕
    document.getElementById('btn-reset-pin').addEventListener('click', startResetFlow);
}

function startResetFlow() {
    resetStep = 1;
    loginHint.innerText = "【重置密碼 1/3】請輸入舊密碼";
    clearPinInputs();
}

function clearPinInputs() {
    pinInputs.forEach(i => i.value = '');
    pinInputs[0].focus();
}

async function checkFullPin() {
    const pin = Array.from(pinInputs).map(i => i.value).join('');

    if (resetStep === 0) {
        // 正常登入
        if (pin === SYSTEM_PIN) {
            handleLoginSuccess();
        } else {
            handleLoginError("密碼錯誤");
        }
    } else if (resetStep === 1) {
        // 重置步驟 1：驗證舊密碼第一次
        if (pin === SYSTEM_PIN) {
            firstOldPin = pin;
            resetStep = 2;
            loginHint.innerText = "【重置密碼 2/3】請再次輸入舊密碼驗證";
            clearPinInputs();
        } else {
            handleLoginError("舊密碼錯誤，請重試");
            resetStep = 0;
            loginHint.innerText = "請輸入 6 位數通行密碼";
        }
    } else if (resetStep === 2) {
        // 重置步驟 2：驗證舊密碼第二次
        if (pin === firstOldPin) {
            resetStep = 3;
            loginHint.innerText = "【重置密碼 3/3】請設定新的 6 位數密碼";
            clearPinInputs();
        } else {
            handleLoginError("兩次舊密碼輸入不一致");
            resetStep = 0;
            loginHint.innerText = "請輸入 6 位數通行密碼";
        }
    } else if (resetStep === 3) {
        // 重置步驟 3：設定新密碼
        await updateDbPin(pin);
    }
}

async function updateDbPin(newPin) {
    try {
        if (configRecordId) {
            await pb.collection('system_config').update(configRecordId, { value: newPin });
        } else {
            await pb.collection('system_config').create({ key: 'system_pin', value: newPin });
        }
        SYSTEM_PIN = newPin;
        alert("密碼已成功更新！請使用新密碼登入");
        resetStep = 0;
        loginHint.innerText = "請輸入 6 位數通行密碼";
        clearPinInputs();
    } catch (e) {
        alert("更新密碼失敗: " + e.message);
        resetStep = 0;
        loginHint.innerText = "請輸入 6 位數通行密碼";
        clearPinInputs();
    }
}

function handleLoginSuccess() {
    localStorage.setItem('system_auth', 'true');
    loginOverlay.classList.add('fade-out');
    setTimeout(() => {
        loginOverlay.style.display = 'none';
    }, 800);
}

function handleLoginError(msg) {
    const card = document.querySelector('.login-card');
    card.classList.add('shake');
    alert(msg);
    clearPinInputs();
    setTimeout(() => {
        card.classList.remove('shake');
    }, 500);
}

// 執行初始化
document.addEventListener('DOMContentLoaded', () => {
    initPinLogic();
});
