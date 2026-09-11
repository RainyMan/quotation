const workflowStates = {
    quoted: ['報價中', 'bg-secondary'],
    awarded: ['已得標', 'bg-warning text-dark'],
    billing: ['請款中', 'bg-success'],
    paid: ['★ 已收款結案', 'bg-dark']
};
let workflowState = 'quoted';
let documentType = 'quotation';
let signedRecord = null;
let pendingSignedFiles = [];

function workflowBadge(q) {
    const [label, style] = workflowStates[q.workflow_status] || workflowStates.quoted;
    return `<span class="badge rounded-pill ${style}">${label}</span>`;
}

function renderDocumentType() {
    const title = document.getElementById('document-title');
    if (!title) return;
    const billing = documentType === 'payment_request';
    title.textContent = billing ? '工程請款單' : '工程報價單';
    title.classList.toggle('text-primary', !billing);
    title.classList.toggle('payment-title', billing);
    title.setAttribute('aria-pressed', String(billing));
    document.getElementById('document-subtitle').textContent = billing ? 'Construction Payment Request' : 'Construction Quotation';
    const badge = document.getElementById('current-workflow');
    if (badge) badge.innerHTML = workflowBadge({workflow_status: workflowState});
}

function restoreWorkflow(q) {
    workflowState = workflowStates[q.workflow_status] ? q.workflow_status : 'quoted';
    documentType = q.document_type === 'payment_request' ? 'payment_request' : 'quotation';
    signedRecord = q;
    pendingSignedFiles = [];
    renderDocumentType();
    renderSignedFiles();
}

function appendWorkflowData(formData) {
    formData.append('workflow_status', workflowState);
    formData.append('document_type', documentType);
    pendingSignedFiles.forEach(file => formData.append('signed_documents+', file));
}

function verifyWorkflowSave(record) {
    const oldCount = Array.isArray(signedRecord?.signed_documents) ? signedRecord.signed_documents.length : 0;
    const newCount = Array.isArray(record.signed_documents) ? record.signed_documents.length : 0;
    if (record.workflow_status !== workflowState || record.document_type !== documentType || newCount < oldCount + pendingSignedFiles.length) {
        throw new Error('報價基本資料已儲存，但狀態或回簽檔未完整保存。請確認資料庫的 workflow_status、document_type、signed_documents 欄位設定後再試。');
    }
}

async function updateWorkflowRecord(id, status, type) {
    const data = {workflow_status: status, last_updated: new Date().toISOString()};
    if (type) data.document_type = type;
    const record = await pb.collection('quotations').update(id, data, {$autoCancel: false});
    if (record.workflow_status !== status || (type && record.document_type !== type)) {
        throw new Error('資料庫尚未設定 workflow_status / document_type 欄位，請先依資料庫設定說明新增。');
    }
    return record;
}

function addWorkflowActions(tr, q) {
    const cell = tr.lastElementChild;
    const actions = document.createElement('div');
    actions.className = 'd-flex gap-1 flex-wrap mt-2';
    for (const status of ['quoted', 'awarded', 'billing', 'paid']) {
        const button = document.createElement('button');
        const [label] = workflowStates[status];
        button.className = `btn btn-sm ${status === 'awarded' ? 'btn-warning' : status === 'billing' ? 'btn-success' : 'btn-outline-secondary'}`;
        button.textContent = label;
        button.disabled = (q.workflow_status || 'quoted') === status;
        button.addEventListener('click', async event => {
            event.stopPropagation();
            actions.querySelectorAll('button').forEach(b => b.disabled = true);
            try {
                const record = await updateWorkflowRecord(q.id, status, status === 'billing' ? 'payment_request' : undefined);
                if (currentQuotationId === q.id) {
                    workflowState = status;
                    documentType = record.document_type === 'payment_request' ? 'payment_request' : 'quotation';
                    renderDocumentType();
                }
                await loadHistory();
            } catch (e) {
                alert(`狀態更新失敗：${e.message}`);
                actions.querySelectorAll('button').forEach((b, i) => b.disabled = ['quoted','awarded','billing','paid'][i] === (q.workflow_status || 'quoted'));
            }
        });
        actions.appendChild(button);
    }
    cell.appendChild(actions);
    const signed = document.createElement('small');
    signed.className = 'd-block text-muted mt-1';
    const files = Array.isArray(q.signed_documents) ? q.signed_documents : q.signed_documents ? [q.signed_documents] : [];
    signed.textContent = `${q.signature_client ? '已有線上簽名' : '無線上簽名'} · 回簽附件 ${files.length} 份`;
    cell.appendChild(signed);
}

function renderSignedFiles() {
    const list = document.getElementById('signed-file-list');
    if (!list) return;
    list.replaceChildren();
    const names = Array.isArray(signedRecord?.signed_documents) ? signedRecord.signed_documents : signedRecord?.signed_documents ? [signedRecord.signed_documents] : [];
    names.forEach(name => {
        const link = document.createElement('a');
        link.className = 'd-block';
        link.textContent = name;
        link.href = pb.files.getURL(signedRecord, name);
        link.target = '_blank';
        link.rel = 'noopener';
        list.appendChild(link);
    });
    pendingSignedFiles.forEach((file, index) => {
        const row = document.createElement('div');
        row.textContent = `${file.name}（待儲存） `;
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'btn btn-sm btn-outline-danger';
        remove.textContent = '移除';
        remove.onclick = () => { pendingSignedFiles.splice(index, 1); renderSignedFiles(); };
        row.appendChild(remove);
        list.appendChild(row);
    });
}

function initWorkflow() {
    const title = document.getElementById('document-title');
    if (!isViewMode) {
        title.tabIndex = 0;
        title.setAttribute('role', 'button');
        title.title = '點擊切換工程報價單／工程請款單';
        const toggle = async () => {
            if (title.getAttribute('aria-busy') === 'true') return;
            const type = documentType === 'quotation' ? 'payment_request' : 'quotation';
            // Switching back changes the document only; retain the latest project status.
            const status = type === 'payment_request' ? 'billing' : workflowState;
            title.setAttribute('aria-busy', 'true');
            try {
                if (currentQuotationId) await updateWorkflowRecord(currentQuotationId, status, type);
                workflowState = status;
                documentType = type;
                renderDocumentType();
            } catch (e) { alert(`切換失敗：${e.message}`); }
            finally { title.removeAttribute('aria-busy'); }
        };
        title.addEventListener('click', toggle);
        title.addEventListener('keydown', e => {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); }
        });
    }
    const panel = document.createElement('section');
    panel.className = 'no-print card card-body my-3';
    panel.id = 'signed-documents-panel';
    panel.innerHTML = '<div class="mb-2">案件狀態：<span id="current-workflow"></span></div><label for="signed-file-input" class="fw-bold">業主回簽檔案（照片／PDF）</label><input id="signed-file-input" type="file" class="form-control mt-2" accept="image/jpeg,image/png,image/webp,application/pdf" multiple><small class="text-muted">每份最多 20 MB，最多 10 份；選取後按「儲存並發送」保存。</small><div id="signed-file-list" class="mt-2"></div>';
    document.getElementById('ui-controls').appendChild(panel);
    panel.querySelector('input').addEventListener('change', event => {
        const files = [...event.target.files];
        const existing = Array.isArray(signedRecord?.signed_documents) ? signedRecord.signed_documents.length : signedRecord?.signed_documents ? 1 : 0;
        if (existing + pendingSignedFiles.length + files.length > 10 || files.some(f => f.size > 20 * 1024 * 1024 || !['image/jpeg','image/png','image/webp','application/pdf'].includes(f.type))) {
            alert('請選擇 JPG、PNG、WebP 或 PDF，每份不超過 20 MB，合計不超過 10 份。');
        } else { pendingSignedFiles.push(...files); renderSignedFiles(); }
        event.target.value = '';
    });
    renderDocumentType();
    renderSignedFiles();
}
