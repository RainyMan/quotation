// These fields reduce what the standard shared page requests. They are NOT an
// authorization boundary: PocketBase rules must protect the original stamp.
const sharedQuotationFields = [
    'id','collectionId','quo_number','customer_name','customer_contact','customer_phone',
    'project_name','project_location','date','total','manual_totals','items','memo_html',
    'vendor','is_party_a_signature_needed','photo_scale','project_address','project_lat',
    'project_lng','project_map_url','images','signature_client','workflow_status','document_type',
    'watermarked_stamp','expand.vendor.id','expand.vendor.name','expand.vendor.tax_id',
    'expand.vendor.address','expand.vendor.phone','expand.vendor.contact','expand.vendor.website',
    'expand.vendor.email','expand.vendor.stamp_scale'
].join(',');
let stampGeneration = 0;

function stampWatermarkLabel() {
    const customer = document.getElementById('c-name');
    return [customer.value || customer.innerText || '未指定報價對象',
        document.getElementById('c-date-input').value || '未指定日期',
        document.getElementById('quo-number').innerText || ''];
}

async function buildProtectedStamp() {
    const vendor = vendors.find(v => v.id === vendorSelect.value);
    if (!vendor?.stamp) return null;
    const img = new Image();
    img.crossOrigin = 'anonymous';
    const loaded = new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = () => reject(new Error('無法讀取印章製作浮水印，請檢查圖片與跨來源存取設定。'));
    });
    img.src = getFileUrl('vendors', vendor, vendor.stamp);
    await loaded;
    const canvas = document.createElement('canvas');
    canvas.width = 1000;
    canvas.height = Math.max(500, Math.round(1000 * img.naturalHeight / img.naturalWidth));
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const [customer, date, number] = stampWatermarkLabel();
    // Burn text into image pixels; no separate removable overlay in shared DOM.
    ctx.save();
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.rotate(-Math.PI / 8);
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(35, 55, 65, 0.20)';
    ctx.font = 'bold 34px sans-serif';
    for (let y = -canvas.height; y <= canvas.height; y += 160) {
        ctx.fillText('僅供本次報價使用', 0, y, 900);
        ctx.fillText(customer, 0, y + 45, 900);
        ctx.fillText(`${date} ${number}`, 0, y + 90, 900);
    }
    ctx.restore();
    return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('浮水印產生失敗')), 'image/png'));
}

async function refreshProtectedStamp() {
    if (isViewMode) return;
    const generation = ++stampGeneration;
    stampImgArea.removeAttribute('src');
    stampImgArea.style.display = 'none';
    try {
        const blob = await buildProtectedStamp();
        if (!blob || generation !== stampGeneration) return;
        const reader = new FileReader();
        reader.onload = () => {
            if (generation !== stampGeneration) return;
            stampImgArea.src = reader.result;
            stampImgArea.style.display = 'block';
        };
        reader.readAsDataURL(blob);
    } catch (e) { console.error('浮水印預覽失敗', e.message); }
}

async function appendProtectedStamp(data) {
    const blob = await buildProtectedStamp();
    if (blob) data.append('watermarked_stamp', blob, 'quotation-stamp.png');
    else data.append('watermarked_stamp', '');
}

function verifyProtectedStamp(record, data) {
    if (data.get('watermarked_stamp') instanceof Blob && !record.watermarked_stamp) {
        throw new Error('基本資料已儲存，但浮水印印章未保存。請先在 quotations 新增 watermarked_stamp 單檔圖片欄位後重新儲存。');
    }
}

function showSharedStamp(record) {
    stampImgArea.removeAttribute('src');
    stampImgArea.style.display = 'none';
    if (record.watermarked_stamp) {
        stampImgArea.src = getFileUrl('quotations', record, record.watermarked_stamp);
        stampImgArea.style.display = 'block';
    }
}

function initShareProtection() {
    stampImgArea.draggable = false;
    if (!isViewMode) {
        for (const id of ['c-name','c-date-input']) {
            document.getElementById(id).addEventListener('change', refreshProtectedStamp);
            document.getElementById(id).addEventListener('input', refreshProtectedStamp);
        }
        return;
    }
    document.body.classList.add('protected-share');
    // Deterrents for casual copying only. Screenshots and browser tools remain possible.
    for (const event of ['copy','cut','dragstart','contextmenu']) {
        document.addEventListener(event, e => {
            if (e.target.closest?.('.modal')) return;
            e.preventDefault();
        });
    }
    document.addEventListener('click', e => {
        if (e.target.closest?.('#quotation-print-area a')) e.preventDefault();
    }, true);
    document.addEventListener('keydown', e => {
        if ((e.ctrlKey || e.metaKey) && ['s','c','u'].includes(e.key.toLowerCase()) && !e.target.closest?.('.modal')) e.preventDefault();
    });
}
