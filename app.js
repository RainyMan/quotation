// --- 1. PocketBase 初始化 ---
const pb = new PocketBase('https://q.tarmacroad.com'); // Synology 外網路徑

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

// 廠商管理變數
let vendors = [];
const vendorSelect = document.getElementById('vendor-select');
const vendorListBody = document.getElementById('vendor-list-body');
const vendorForm = document.getElementById('vendor-form');
const stampPreview = document.getElementById('m-v-stamp-preview');
const stampImgArea = document.getElementById('vendor-stamp-img');

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
    rowCount++;
    const tr = document.createElement('tr');
    tr.innerHTML = `
        <td>${rowCount}</td>
        <td><input type="text" class="item-name form-control-plaintext" placeholder="輸入品項名稱" list="items-datalist"></td>
        <td><input type="text" class="item-unit form-control-plaintext text-center" value="式"></td>
        <td><input type="number" class="item-qty text-center" value="1"></td>
        <td><input type="number" class="item-price text-end" value="0"></td>
        <td class="item-subtotal text-end fw-bold">NT$ 0</td>
        <td><input type="text" class="item-note form-control-plaintext" placeholder="備註"></td>
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

    itemsBody.appendChild(tr);
    return tr;
}

function updateRowNumbers() {
    itemsBody.querySelectorAll('tr').forEach((row, index) => {
        row.cells[0].innerText = index + 1;
    });
}

// --- 6. 附件照片區動態排版 ---
const attachmentArea = document.getElementById('quotation-attachments');
let uploadedImages = []; // 存儲圖片 DataURL (預覽用)
let selectedFiles = []; // 存儲實體 File 物件 (上傳用)

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
    uploadedImages.splice(index, 1);
    selectedFiles.splice(index, 1);
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
    return `https://q.tarmacroad.com/api/files/${collection}/${record.id}/${filename}`;
}

async function loadMemoPresets() {
    const presetContainer = document.getElementById('memo-presets-container');
    if (!presetContainer) return;
    try {
        const records = await pb.collection('memo_presets').getFullList({ sort: 'content' });

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
        const records = await pb.collection('items').getFullList({ sort: 'name' });
        itemDictionary = records.map(r => r.name);
        datalist.innerHTML = '';
        records.forEach(r => {
            const option = document.createElement('option');
            option.value = r.name;
            datalist.appendChild(option);
        });
    } catch (e) {
        console.error('更新品項列表失敗', e);
    }
}

window.saveQuotation = async function (isCopy = false) {
    try {
        const btn = document.getElementById('btn-save');
        btn.disabled = true;
        btn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>儲存中...';

        const memoHtml = document.getElementById('memo-field').innerHTML;
        const items = [];
        const rows = itemsBody.querySelectorAll('tr');

        for (const row of rows) {
            const name = row.querySelector('.item-name').value;
            if (name) {
                items.push({
                    name: name,
                    unit: row.querySelector('.item-unit').value,
                    qty: parseFloat(row.querySelector('.item-qty').value),
                    price: parseFloat(row.querySelector('.item-price').value),
                    note: row.querySelector('.item-note').value
                });

                // 自動同步新品項到 items collection
                if (!itemDictionary.includes(name)) {
                    await pb.collection('items').create({ name: name, unit: row.querySelector('.item-unit').value, default_price: parseFloat(row.querySelector('.item-price').value) }, { '$autoCancel': false });
                }
            }
        }

        // 構建 FormData 以支援多圖上傳
        const formData = new FormData();
        formData.append('quo_number', document.getElementById('quo-number').innerText);
        formData.append('customer_name', document.getElementById('c-name').innerText);
        // 同時傳送 project_location 與 project_name 以相容資料庫設定
        const projName = document.getElementById('c-location').innerText;
        formData.append('project_location', projName);
        formData.append('project_name', projName);
        formData.append('customer_contact', document.getElementById('c-contact').innerText);
        formData.append('customer_phone', document.getElementById('c-phone').innerText);
        formData.append('date', document.getElementById('c-date-input').value);
        formData.append('total', parseFloat(totalEl.innerText.replace(/[^\d]/g, '')));
        formData.append('items', JSON.stringify(items));
        formData.append('memo_html', memoHtml);
        formData.append('vendor', vendorSelect.value);

        // 取得 image-upload 中的真實 File 物件 (注意：此前的 uploadedImages 是 DataURL，我們要改用原始檔案)
        const fileInput = document.getElementById('image-upload-files') || { files: [] }; // 假設我們調整 HTML 使用隱藏 input 存檔案
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
        loadHistory();
        loadMemoPresets();

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
        // 優化搜尋字串，如果欄位不存在，getList 會噴 400
        let filterStr = '';
        const filters = [];
        if (customerSearch) {
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

        const options = {
            sort: '-id',
            $autoCancel: false
        };
        if (filterStr) options.filter = filterStr;

        const records = await pb.collection('quotations').getList(1, 50, options);

        historyBody.innerHTML = '';
        if (records.items.length === 0) {
            historyBody.innerHTML = '<tr><td colspan="6" class="text-center">查無紀錄</td></tr>';
            return;
        }

        records.items.forEach(q => {
            const tr = document.createElement('tr');
            tr.className = 'clickable-row';
            // 安全處理日期與顯示
            const displayDate = q.date ? q.date.substring(0, 10) : (q.created ? q.created.substring(0, 10) : '---');
            const displayTotal = q.total ? q.total.toLocaleString() : '0';

            tr.innerHTML = `
                <td>${q.quo_number || '---'}</td>
                <td>${displayDate}</td>
                <td>${q.customer_name || '未命名客戶'}</td>
                <td>NT$ ${displayTotal}</td>
                <td><span class="badge bg-primary">已儲存</span></td>
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
        console.error('歷史讀取失敗', e);
        alert(`讀取失敗！錯誤訊息：${e.message}\n這通常是權限(API Rules)或資料過濾語法問題。`);
        historyBody.innerHTML = '<tr><td colspan="6" class="text-center text-danger">讀取失敗</td></tr>';
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
    try {
        const q = await pb.collection('quotations').getOne(id);
        currentQuotationId = q.id; // 標記正在編輯此單

        // 還原基本資訊
        document.getElementById('quo-number').innerText = q.quo_number;
        document.getElementById('c-name').innerText = q.customer_name || "";
        document.getElementById('c-location').innerText = q.project_location || q.project_name || ""; // 相容不同欄位名
        document.getElementById('c-contact').innerText = q.customer_contact || "王先生";
        document.getElementById('c-phone').innerText = q.customer_phone || "0912-345-678";

        const dateVal = q.date ? q.date.substring(0, 10) : "";
        document.getElementById('c-date-input').value = dateVal;
        document.getElementById('c-date-display').innerText = dateVal;
        document.getElementById('memo-field').innerHTML = q.memo_html;

        // 還原品項
        itemsBody.innerHTML = '';
        rowCount = 0;
        // 安全處理解析
        let items = q.items;
        if (typeof items === 'string') {
            try { items = JSON.parse(items); } catch (err) { items = []; }
        }
        if (Array.isArray(items)) {
            items.forEach(item => {
                const tr = createRow();
                tr.querySelector('.item-name').value = item.name || "";
                tr.querySelector('.item-unit').value = item.unit || "式";
                tr.querySelector('.item-qty').value = item.qty || 1;
                tr.querySelector('.item-price').value = item.price || 0;
                tr.querySelector('.item-note').value = item.note || '';
            });
        }
        calculateTotals();

        // 還原廠商
        if (q.vendor) {
            vendorSelect.value = q.vendor;
            vendorSelect.dispatchEvent(new Event('change'));
        }

        // 還原圖片 (相容 images 或 photos 欄位)
        uploadedImages = [];
        selectedFiles = []; // 清空之前的檔案，編輯模式下若沒動則不傳新檔
        const imgs = q.images || q.photos || [];
        if (Array.isArray(imgs)) {
            imgs.forEach(img => {
                const url = getFileUrl('quotations', q, img);
                uploadedImages.push(url);
                // 注意：這裡無法還原實體 File 物件，僅做顯示用
                // 實務上若要保留原圖，PB 會自動處理沒傳遞 images 欄位時不更動原圖
            });
        }
        updateAttachmentLayout();

        bootstrap.Modal.getInstance(document.getElementById('historyModal')).hide();
    } catch (e) {
        console.error(e);
        alert('載入報價單失敗');
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
    const today = new Date().toISOString().split('T')[0];
    const dateInput = document.getElementById('c-date-input');
    const dateDisplay = document.getElementById('c-date-display');

    dateInput.value = today;
    dateDisplay.innerText = today;

    // 初始生成單號
    await generateQuoNumber(today);

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
            sigCName.innerText = cName.innerText;
        });
        sigCName.innerText = cName.innerText;
    }
}


// --- 9. 廠商管理與用印功能 ---

async function renderVendors() {
    try {
        const records = await pb.collection('vendors').getFullList({ sort: 'name' });
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
    const valEl = document.getElementById('stamp-scale-val');
    if (valEl) valEl.innerText = size;
    stampImgArea.style.width = `${size}px`;
});
// 處理列印時的檔名 (公司名稱_工程名稱)
window.addEventListener('beforeprint', () => {
    const company = document.getElementById('c-name').innerText.trim();
    const project = document.getElementById('c-location').innerText.trim();
    window._oldTitle = document.title;
    document.title = `${company}_${project}`;
});
window.addEventListener('afterprint', () => {
    document.title = window._oldTitle || "專業報價系統 | Quotation System";
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
        document.getElementById('btn-client-sign').style.display = 'inline-block';

        // 進入唯讀模式
        document.body.classList.add('view-mode');

        await loadQuotationForView(viewId);
    }
}

async function loadQuotationForView(id) {
    try {
        const q = await pb.collection('quotations').getOne(id, { expand: 'vendor' });

        // 填充基本資訊
        document.getElementById('quo-number').innerText = q.quo_number;
        document.getElementById('c-name').innerText = q.customer_name;
        document.getElementById('c-location').innerText = q.project_name || q.project_location;
        document.getElementById('c-contact').innerText = q.customer_contact || "";
        document.getElementById('c-phone').innerText = q.customer_phone || "";
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
        document.getElementById('memo-field').innerHTML = q.memo_html || '';

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

        // 甲方簽名
        if (q.signature_client) {
            const sigUrl = getFileUrl('quotations', q, q.signature_client);
            document.getElementById('sig-client-img').src = sigUrl;
            document.getElementById('sig-client-img').style.display = 'inline-block';
            document.getElementById('btn-client-sign').style.display = 'none';
        }

        calculateTotals();
        setupDynamicSync();

        // 禁止所有編輯
        const editables = document.querySelectorAll('[contenteditable="true"]');
        editables.forEach(el => {
            el.setAttribute('contenteditable', 'false');
            el.style.border = 'none';
        });
        const inputs = document.querySelectorAll('input, select, textarea');
        inputs.forEach(el => {
            el.disabled = true;
            el.style.backgroundColor = 'transparent';
        });
        document.querySelectorAll('.btn-row-remove, #add-row').forEach(el => el.style.display = 'none');

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
    }
}

async function submitClientSignature() {
    if (!currentQuotationId) return;

    const activeTab = document.querySelector('#sigTab .nav-link.active').id;
    let signatureBlob = null;

    if (activeTab === 'hand-tab') {
        if (signaturePad.isEmpty()) {
            alert('請先在板上簽名');
            return;
        }
        // 將 Canvas 轉為 Blob
        const dataUrl = signaturePad.toDataURL('image/png');
        const res = await fetch(dataUrl);
        signatureBlob = await res.blob();
    } else {
        const fileInput = document.getElementById('sig-file');
        if (fileInput.files.length === 0) {
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


// --- 12. 初始化執行 (放在最末以確保所有函數與變數都已定義) ---
addRowBtn.addEventListener('click', createRow);
document.getElementById('btn-save').addEventListener('click', saveQuotation);
document.getElementById('btn-history').addEventListener('click', loadHistory);
document.getElementById('btn-history-filter').addEventListener('click', loadHistory);

// 核心初始化
initQuotationInfo();
setupDynamicSync();
loadMemoPresets();
renderVendors();
updateItemsDatalist();

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

// 檢查是否進入檢視模式
checkViewMode();
