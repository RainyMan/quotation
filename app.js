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

// 歷史紀錄排序變數
let historySort = { field: 'last_updated', direction: 'desc' }; // 預設依最後更新由新到舊


// --- 3. 國字大寫轉換與備註功能 ---
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

// --- 4. 即時計算功能 ---
function calculateTotals() {
    let subtotal = 0;
    const rows = itemsBody.querySelectorAll('tr');

    rows.forEach(row => {
        const price = parseFloat(row.querySelector('.item-price').value) || 0;
        const qty = parseFloat(row.querySelector('.item-qty').value) || 0;
        const lineTotal = price * qty;
        row.querySelector('.item-subtotal').innerText = `NT$ ${lineTotal.toLocaleString()}`;
        subtotal += lineTotal;
    });

    const tax = Math.round(subtotal * 0.05);
    const total = subtotal + tax;

    subtotalEl.innerText = `NT$ ${subtotal.toLocaleString()}`;
    taxEl.innerText = `NT$ ${tax.toLocaleString()}`;
    totalEl.innerText = `NT$ ${total.toLocaleString()}`;
    totalChineseEl.innerText = numberToChinese(total);
}

// --- 5. 表格列操作 ---
function createRow() {
    const currentRows = itemsBody.querySelectorAll('tr').length;
    const newNumber = currentRows + 1;
    const tr = document.createElement('tr');
    const dragIcon = isViewMode ? '' : `<i class="bi bi-grip-vertical text-muted"></i> `;
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
        input.addEventListener('input', calculateTotals);
    });

    tr.querySelector('.btn-remove-row').addEventListener('click', () => {
        tr.remove();
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
    return tr;
}

function updateRowNumbers() {
    itemsBody.querySelectorAll('tr').forEach((row, index) => {
        const cell = row.cells[0];
        const dragIcon = isViewMode ? '' : `<i class="bi bi-grip-vertical text-muted"></i> `;
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

imageUpload.addEventListener('change', function (e) {
    const files = e.target.files;
    for (let i = 0; i < files.length; i++) {
        const file = files[i];
        selectedFiles.push(file); // 儲存實體檔案
        const reader = new FileReader();
        reader.onload = function (event) {
            uploadedImages.push(event.target.result);
            updateAttachmentLayout();
        };
        reader.readAsDataURL(file);
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

        const processedKeys = new Set();
        for (const row of rows) {
            const name = row.querySelector('.item-name').value.trim();
            const unit = row.querySelector('.item-unit').value.trim();
            const price = parseFloat(row.querySelector('.item-price').value) || 0;

            if (name) {
                items.push({
                    name: name,
                    unit: unit,
                    qty: parseFloat(row.querySelector('.item-qty').value),
                    price: price,
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
        formData.append('items', JSON.stringify(items));
        formData.append('memo_html', memoHtml);
        formData.append('vendor', vendorSelect.value);
        // 新增自定義時間欄位，解決系統 updated 欄位無法顯示的問題
        formData.append('last_updated', new Date().toISOString());

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
            items.forEach((item, idx) => {
                try {
                    const tr = createRow();
                    tr.querySelector('.item-name').value = item.name || "";
                    tr.querySelector('.item-unit').value = item.unit || "式";
                    tr.querySelector('.item-qty').value = item.qty || 1;
                    tr.querySelector('.item-price').value = item.price || 0;
                    tr.querySelector('.item-note').value = item.note || '';
                } catch (rowErr) {
                    console.error(`還原第 ${idx + 1} 列品項失敗:`, rowErr);
                }
            });
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

    const stampFile = document.getElementById('m-v-stamp').files[0];
    if (stampFile) {
        formData.append('stamp', stampFile);
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
        setValOrText('c-name', customerName);
        const sigCName = document.getElementById('sig-c-name');
        if (sigCName) sigCName.innerText = customerName;

        setValOrText('c-location', (q.project_name || q.project_location || "").trim());
        setValOrText('c-contact', (q.customer_contact || "").trim());
        setValOrText('c-phone', (q.customer_phone || "").trim());
        document.getElementById('c-date-input').value = q.date ? q.date.substring(0, 10) : '';
        document.getElementById('c-date-display').innerText = q.date ? q.date.substring(0, 10) : '';

        // 渲染品項
        itemsBody.innerHTML = '';
        rowCount = 0;
        if (q.items) {
            const items = typeof q.items === 'string' ? JSON.parse(q.items) : q.items;
            items.forEach(item => {
                const row = createRow();
                row.querySelector('.item-name').value = item.name;
                row.querySelector('.item-unit').value = item.unit;
                row.querySelector('.item-qty').value = item.qty;
                row.querySelector('.item-price').value = item.price;
                row.querySelector('.item-note').value = item.note || '';
            });
        }

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
        signatureBlob = fileInput.files[0];
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


// --- 12. 初始化執行 (放在最末以確保所有函數與變數都已定義) ---
addRowBtn.addEventListener('click', createRow);
document.getElementById('btn-save').addEventListener('click', saveQuotation);
document.getElementById('btn-history').addEventListener('click', loadHistory);
document.getElementById('btn-history-filter').addEventListener('click', loadHistory);

// 核心初始化
initQuotationInfo();
setupDynamicSync();

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
