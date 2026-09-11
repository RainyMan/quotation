/* Quotation layout and line-based memo editor. Layout metadata lives in the
   existing memo_html field so no PocketBase schema migration is needed. */
let memoSuggestions = [];
const defaultColumnWidths = [7, 30, 8, 10, 14, 15, 11, 5];
let columnWidths = [...defaultColumnWidths];

function applyColumnWidths(widths) {
    columnWidths = Array.isArray(widths) && widths.length === 8 &&
        widths.every(w => Number.isFinite(w) && w >= 3 && w <= 65) &&
        Math.abs(widths.reduce((a, b) => a + b, 0) - 100) < 0.1
        ? [...widths] : [...defaultColumnWidths];
    document.querySelectorAll('#items-table thead th').forEach((th, i) => {
        th.style.width = `${columnWidths[i]}%`;
    });
}

function getMemoLines() {
    return [...document.querySelectorAll('#memo-field .memo-text')].map(el => el.value);
}

function renumberMemos() {
    document.querySelectorAll('#memo-field .memo-number').forEach((el, i) => el.textContent = `${i + 1}.`);
}

function fitMemo(input) {
    input.style.height = 'auto';
    input.style.height = `${Math.max(28, input.scrollHeight)}px`;
    input.parentElement.querySelector('.memo-display').textContent = input.value;
}

function appendMemoRow(text = '', after = null) {
    const row = document.createElement('div');
    row.className = 'memo-row';
    const grip = document.createElement('button');
    grip.type = 'button';
    grip.className = 'memo-grip no-print memo-control';
    grip.textContent = '⠿';
    grip.title = '拖曳排序';
    grip.setAttribute('aria-label', '拖曳排序補充說明');
    const number = document.createElement('span');
    number.className = 'memo-number';
    const body = document.createElement('div');
    body.className = 'memo-body';
    const input = document.createElement('textarea');
    input.className = 'memo-text';
    input.rows = 1;
    input.value = text;
    input.placeholder = '輸入說明或關鍵字搜尋';
    input.setAttribute('aria-label', '補充說明內容');
    input.disabled = isViewMode;
    const display = document.createElement('span');
    display.className = 'memo-display';
    display.textContent = text;
    const suggestions = document.createElement('div');
    suggestions.className = 'memo-suggestions no-print';
    suggestions.hidden = true;
    const search = () => {
        fitMemo(input);
        suggestions.replaceChildren();
        const query = input.value.trim().toLocaleLowerCase();
        const matches = query ? memoSuggestions.filter(s => s.toLocaleLowerCase().includes(query) && s !== input.value).slice(0, 10) : [];
        suggestions.hidden = !matches.length;
        matches.forEach(content => {
            const option = document.createElement('button');
            option.type = 'button';
            option.textContent = content;
            option.addEventListener('click', () => {
                input.value = content;
                suggestions.hidden = true;
                fitMemo(input);
                input.focus();
            });
            suggestions.appendChild(option);
        });
    };
    input.addEventListener('input', search);
    input.addEventListener('focus', search);
    row.addEventListener('focusout', e => {
        if (!row.contains(e.relatedTarget)) suggestions.hidden = true;
    });
    input.addEventListener('keydown', e => {
        if (e.key === 'Escape') suggestions.hidden = true;
        if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
            e.preventDefault();
            suggestions.hidden = true;
            appendMemoRow('', row).querySelector('textarea').focus();
        }
    });
    body.append(input, display, suggestions);
    row.append(grip, number, body);
    for (const [label, action] of [
        ['＋', () => appendMemoRow('', row).querySelector('textarea').focus()],
        ['−', () => { row.remove(); renumberMemos(); }]
    ]) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'memo-control no-print';
        button.textContent = label;
        button.title = label === '＋' ? '在下方新增一項' : '刪除此項';
        button.setAttribute('aria-label', button.title);
        button.addEventListener('click', action);
        row.appendChild(button);
    }
    if (after) after.after(row);
    else document.getElementById('memo-field').appendChild(row);
    renumberMemos();
    fitMemo(input);
    return row;
}

function restoreMemo(html) {
    const parsed = new DOMParser().parseFromString(html, 'text/html');
    const layout = parsed.querySelector('[data-column-widths]');
    let widths;
    try { widths = JSON.parse(layout?.getAttribute('data-column-widths') || 'null'); } catch (_) {}
    applyColumnWidths(widths);
    // Handle original <br> content as well as paragraphs created by contenteditable.
    parsed.querySelectorAll('br').forEach(el => el.replaceWith('\n'));
    parsed.querySelectorAll('div,p,li').forEach(el => { el.prepend('\n'); el.append('\n'); });
    const rawLines = layout ? [...layout.children].map(el => el.textContent) : parsed.body.textContent.split('\n');
    const lines = rawLines.map(s => s.trim().replace(/^\d+\.\s*/, '')).filter(Boolean);
    document.getElementById('memo-field').replaceChildren();
    lines.forEach(line => appendMemoRow(line));
}

function serializeMemo() {
    const wrapper = document.createElement('div');
    wrapper.dataset.columnWidths = JSON.stringify(columnWidths);
    getMemoLines().map(s => s.trim()).filter(Boolean).forEach((line, i) => {
        const p = document.createElement('div');
        p.textContent = `${i + 1}. ${line}`;
        wrapper.appendChild(p);
    });
    return wrapper.outerHTML;
}

function syncItemDisplays() {
    document.querySelectorAll('#items-body input').forEach(input => {
        let display = input.nextElementSibling;
        if (!display?.classList.contains('item-display')) {
            display = document.createElement('span');
            display.className = 'item-display';
            input.after(display);
            input.addEventListener('input', syncItemDisplays);
            input.addEventListener('blur', syncItemDisplays);
        }
        display.textContent = input.value || input.placeholder;
    });
}

function initQuotationEditor() {
    restoreMemo(document.getElementById('memo-field').innerHTML);
    const add = document.createElement('button');
    add.type = 'button';
    add.className = 'btn btn-sm btn-outline-primary no-print memo-control mt-2';
    add.textContent = '＋ 新增補充說明';
    add.addEventListener('click', () => appendMemoRow().querySelector('textarea').focus());
    document.getElementById('memo-field').after(add);
    if (!isViewMode && typeof Sortable !== 'undefined') {
        new Sortable(document.getElementById('memo-field'), {
            animation: 150, handle: '.memo-grip', draggable: '.memo-row', onEnd: renumberMemos
        });
    }
    if (!isViewMode) document.querySelectorAll('#items-table thead th').forEach((th, i) => {
        if (i >= 6) return;
        const handle = document.createElement('span');
        handle.className = 'column-resizer no-print';
        handle.title = '左右拖曳調整欄寬（方向鍵亦可調整）';
        handle.tabIndex = 0;
        handle.setAttribute('role', 'separator');
        handle.setAttribute('aria-orientation', 'vertical');
        handle.setAttribute('aria-label', `調整${th.textContent.trim()}欄寬`);
        const adjust = (startWidths, delta) => {
            const min = 5;
            const bounded = Math.max(min - startWidths[i], Math.min(startWidths[i + 1] - min, delta));
            const next = [...startWidths];
            next[i] += bounded;
            next[i + 1] -= bounded;
            applyColumnWidths(next);
        };
        handle.addEventListener('keydown', e => {
            if (['ArrowLeft', 'ArrowRight'].includes(e.key)) {
                e.preventDefault();
                adjust(columnWidths, e.key === 'ArrowLeft' ? -1 : 1);
            }
        });
        handle.addEventListener('pointerdown', e => {
            e.preventDefault();
            const start = e.clientX;
            const widths = [...columnWidths];
            const total = document.getElementById('items-table').getBoundingClientRect().width;
            handle.setPointerCapture(e.pointerId);
            const move = event => adjust(widths, (event.clientX - start) / total * 100);
            const stop = () => {
                handle.removeEventListener('pointermove', move);
                handle.removeEventListener('lostpointercapture', stop);
            };
            handle.addEventListener('pointermove', move);
            handle.addEventListener('lostpointercapture', stop);
        });
        th.appendChild(handle);
    });
    syncItemDisplays();
    window.addEventListener('beforeprint', syncItemDisplays);
    window.addEventListener('resize', () => document.querySelectorAll('.memo-text').forEach(fitMemo));
}
