'use strict';
// =====================================================================================================
// iLife — СТРАНИЦА «ДЕЛА»: один блок «Дела и покупки».
// Блок «Список покупок» перенесён из My Money 4.8.1 (js/shopping.js) целиком: разбор списка из текста или сообщения
// (по строкам, запятым, «;»; количество «2 шт», «1,5 кг»; цена «450 тг», «5$»), предпросмотр, магазин, «Вставить» из буфера,
// галочка «куплено», цена и валюта у пункта (тенге, доллар, евро, рубль; итог пересчитывается в тенге по курсу),
// подсказка «в прошлый раз …», «Скопировать список», «Убрать купленное». История цен ведётся внутри (ключ ilife_prices).
// Расширение для iLife: тот же блок ведёт и обычные ДЕЛА (режим «Дела»): срок («завтра», «до 10.11», «в пятницу», «15 ноября»),
// время («в 15:30»), просроченные выделяются. Все записи группируются по дате добавления и подписаны автором (Александр).
// Запись: { id, type: 'buy'|'task', name, qty, price, currency, store, due, time, done, doneAt, addedAt, author }
// =====================================================================================================

let todos = LS.get('todos', []);
let prices = LS.get('prices', []);
if (!Array.isArray(todos)) todos = [];
if (!Array.isArray(prices)) prices = [];
let todoMode = LS.get('todo_mode', 'buy');
let todoFilter = 'all';

function saveTodos() { if (typeof cloudLocalChanged === 'function') cloudLocalChanged(); LS.set('todos', todos); LS.set('prices', prices); }

// ---------- Разбор «покупок» (как в My Money) ----------
function productKey(name) {
    return String(name || '').toLowerCase().replace(/ё/g, 'е')
        .replace(/\d+(?:[.,]\d+)?\s*(кг|г|гр|л|мл|шт|уп)\.?(?![а-яa-z])/gi, '')
        .replace(/[^a-zа-я0-9%]+/gi, ' ').trim();
}
function parseQtyUnit(text) {
    const m = String(text || '').match(/(\d+(?:[.,]\d+)?)\s*(кг|гр|г|л|мл|шт|уп)\.?(?![а-яa-z])/i);
    if (!m) return { qty: null, unit: '' };
    let unit = m[2].toLowerCase(); if (unit === 'гр') unit = 'г';
    return { qty: parseFloat(m[1].replace(',', '.')), unit };
}
function stripListMarkers(raw) {
    return raw.replace(/^[\s\-–—•*·>]+/, '').replace(/^[☐-☒✅❌✔✖️\s]+/u, '').replace(/^\d{1,2}\s*[.)]\s+/, '').replace(/^\[\s*[xх ]?\s*\]\s*/i, '').trim();
}
// «1. Молоко 2 шт — 450 тг», «- хлеб», «яйца 10», «сыр, колбаса; помидоры 1,5 кг»
function parseShoppingText(text) {
    const parts = String(text || '').replace(/\r/g, '').replace(/(\d),(\d)/g, '$1\u0001$2').split(/[\n;,]/).map(s => s.replace(/\u0001/g, ',').trim()).filter(Boolean);
    const items = [];
    parts.forEach(raw => {
        if (/:\s*$/.test(raw)) return; // заголовок сообщения: «Купи, пожалуйста:»
        let s = stripListMarkers(raw);
        if (!s || !/[a-zа-яё]/i.test(s)) return;
        let price = null, currency = 'KZT', qty = '';
        const pm = s.match(/[-–—:=]?\s*(\d[\d\s]*(?:[.,]\d{1,2})?)\s*(₸|тг|тенге|т\.|\$|usd|долл\w*|€|eur|евро|₽|руб\w*|р\.)(?=\s|$)/i);
        if (pm) {
            price = parseFloat(pm[1].replace(/\s/g, '').replace(',', '.'));
            const c = pm[2].toLowerCase();
            currency = /\$|usd|долл/.test(c) ? 'USD' : /€|eur|евро/.test(c) ? 'EUR' : /₽|руб|р\./.test(c) ? 'RUB' : 'KZT';
            s = (s.slice(0, pm.index) + s.slice(pm.index + pm[0].length)).trim();
        }
        const qm = s.match(/(?:^|\s)(?:[xх×]\s*(\d+)|(\d+(?:[.,]\d+)?)\s*(шт|кг|гр|г|л|мл|уп|пач\w*|бут\w*|бан\w*|пак\w*|десят\w*|штук\w*))\.?(?=\s|$)/i);
        if (qm) {
            qty = qm[1] ? qm[1] + ' шт' : qm[2] + ' ' + qm[3].toLowerCase();
            s = (s.slice(0, qm.index) + ' ' + s.slice(qm.index + qm[0].length)).trim();
        }
        const tail = s.match(/[\s\-–—:=]+(\d+(?:[.,]\d+)?)\s*$/); // голое число в конце: до 30 — количество, больше — цена
        if (tail) {
            const n = parseFloat(tail[1].replace(',', '.'));
            if (price === null && n > 30) price = n; else if (!qty) qty = tail[1] + ' шт';
            s = s.slice(0, tail.index).trim();
        }
        s = s.replace(/[\s\-–—:=,.]+$/, '').replace(/\s{2,}/g, ' ').trim();
        if (!/[a-zа-яё]/i.test(s)) return;
        items.push({ name: capitalizeFirst(s).slice(0, 60), qty: qty.slice(0, 20), price, currency });
    });
    return items;
}

// ---------- Разбор «дел»: срок и время прямо в тексте ----------
const WD_INDEX = { 'понедельник': 1, 'вторник': 2, 'сред': 3, 'четверг': 4, 'пятниц': 5, 'суббот': 6, 'воскресень': 0 };
function addDaysKey(key, n) { return dayKey(keyToMs(key) + n * 86400000); }
function extractDue(src) {
    let s = ' ' + src + ' ', due = null, time = '', m;
    const today = todayKey();
    const cut = mm => { s = s.slice(0, mm.index) + ' ' + s.slice(mm.index + mm[0].length); };
    m = s.match(/(?:^|\s)(?:в\s*)?([01]?\d|2[0-3]):([0-5]\d)(?=\s|$|[,.;!?])/);
    if (m) { time = pad2(+m[1]) + ':' + m[2]; cut(m); }
    if ((m = s.match(/(?:^|\s)(?:до\s+|на\s+|к\s+)?(сегодня|завтра|послезавтра)(?=\s|$|[,.;!?])/i))) {
        due = addDaysKey(today, { 'сегодня': 0, 'завтра': 1, 'послезавтра': 2 }[m[1].toLowerCase()]); cut(m);
    } else if ((m = s.match(/(?:^|\s)через\s+(\d+)\s*(дн\w*|день|недел\w*|нед\w*)(?=\s|$|[,.;!?])/i))) {
        due = addDaysKey(today, (+m[1]) * (/^нед/i.test(m[2]) ? 7 : 1)); cut(m);
    } else if ((m = s.match(/(?:^|\s)(?:до\s+|на\s+|к\s+)?(\d{1,2})[.\/](\d{1,2})(?:[.\/](\d{2,4}))?(?=\s|$|[,;!?])/)) && +m[1] >= 1 && +m[1] <= 31 && +m[2] >= 1 && +m[2] <= 12) {
        due = buildDate(+m[1], +m[2] - 1, m[3] ? (m[3].length === 2 ? 2000 + +m[3] : +m[3]) : null, today); cut(m);
    } else if ((m = s.match(/(?:^|\s)(?:до\s+|на\s+|к\s+)?(\d{1,2})\s+(января|февраля|марта|апреля|мая|июня|июля|августа|сентября|октября|ноября|декабря)(?:\s+(\d{4}))?(?=\s|$|[,.;!?])/i))) {
        due = buildDate(+m[1], MONTHS_GEN.indexOf(m[2].toLowerCase()), m[3] ? +m[3] : null, today); cut(m);
    } else if ((m = s.match(/(?:^|\s)(?:до\s+|на\s+|к\s+|в\s+|во\s+)?(понедельник|вторник|сред[ауы]|четверг|пятниц[ауы]|суббот[ауы]|воскресень[ея])(?=\s|$|[,.;!?])/i))) {
        const key = Object.keys(WD_INDEX).find(k => m[1].toLowerCase().startsWith(k));
        const target = WD_INDEX[key], cur = almatyParts(keyToMs(today)).wd;
        let diff = (target - cur + 7) % 7; if (diff === 0) diff = 7;
        due = addDaysKey(today, diff); cut(m);
    }
    return { text: s.replace(/\s{2,}/g, ' ').replace(/^[\s,.;:\-–—]+|[\s,.;:\-–—]+$/g, ''), due, time };
}
function buildDate(d, mo, y, todayK) {
    const t = keyToMs(todayK); const ty = almatyParts(t).y;
    let year = y || ty;
    let key = year + '-' + pad2(mo + 1) + '-' + pad2(d);
    if (!y && keyToMs(key) < t - 180 * 86400000) key = (year + 1) + '-' + pad2(mo + 1) + '-' + pad2(d);
    return isNaN(keyToMs(key)) ? null : key;
}
function parseTaskText(text) {
    const out = [];
    String(text || '').replace(/\r/g, '').split(/\n|;/).map(s => s.trim()).filter(Boolean).forEach(raw => {
        if (/:\s*$/.test(raw)) return;
        const r = extractDue(stripListMarkers(raw));
        if (!/[a-zа-яё]/i.test(r.text)) return;
        out.push({ name: capitalizeFirst(r.text).slice(0, 120), due: r.due, time: r.time });
    });
    return out;
}

// ---------- История цен ----------
function priceInTenge(rec) {
    const code = rec.currency || 'KZT';
    if (code === 'KZT') return rec.price;
    if (rec.rate) return rec.price * rec.rate;
    const r = currencyRate(code);
    return r ? rec.price * r : null;
}
function syncShopPrice(it) {
    const id = 'prs' + it.id;
    prices = prices.filter(r => r.id !== id);
    if (!it.price) return;
    const qu = parseQtyUnit(it.qty);
    prices.push(Object.assign({ id, product: it.name, price: it.price, currency: it.currency || 'KZT', store: it.store || '', qty: qu.qty, unit: qu.unit, date: todayKey(), source: 'shop' },
        it.currency && it.currency !== 'KZT' && currencyRate(it.currency) ? { rate: currencyRate(it.currency) } : {}));
}
function lastPriceFor(name, exceptId) {
    const key = productKey(name);
    return prices.filter(r => productKey(r.product) === key && r.id !== 'prs' + exceptId).sort((a, b) => String(b.date).localeCompare(String(a.date)))[0] || null;
}

// ---------- Добавление ----------
function addTodoFromInput() {
    const ta = $('#todo-input'); const now = Date.now();
    if (todoMode === 'buy') {
        const items = parseShoppingText(ta.value);
        if (!items.length) { toast('Впишите покупки: по одной в строке или через запятую. Можно вставить текст сообщения целиком.'); return; }
        const store = ($('#todo-store').value || '').trim().slice(0, 40);
        items.forEach((it, i) => {
            const item = { id: uid('t'), type: 'buy', name: it.name, qty: it.qty, price: it.price, currency: it.currency, done: false, store, addedAt: now + i, author: authorName() };
            todos.push(item); if (it.price) syncShopPrice(item);
        });
        toast('Добавлено в список: ' + items.length);
    } else {
        const items = parseTaskText(ta.value); const formDue = $('#todo-due').value || null;
        if (!items.length) { toast('Впишите дела: по одному в строке. Срок можно указать словами: «завтра», «до 10.11», «в пятницу в 15:30».'); return; }
        items.forEach((it, i) => todos.push({ id: uid('t'), type: 'task', name: it.name, due: it.due || formDue, time: it.time || '', done: false, addedAt: now + i, author: authorName() }));
        toast('Добавлено дел: ' + items.length);
        $('#todo-due').value = '';
    }
    ta.value = ''; saveTodos(); renderTodo(); renderTodoPreview();
}
async function pasteTodoText() {
    try {
        const text = await navigator.clipboard.readText();
        const ta = $('#todo-input'); ta.value = (ta.value ? ta.value + '\n' : '') + text; renderTodoPreview();
    } catch (e) { toast('Не удалось прочитать буфер обмена: нажмите в поле и вставьте текст вручную (долгое нажатие → «Вставить»)'); }
}
function renderTodoPreview() {
    const box = $('#todo-preview'), ta = $('#todo-input'); if (!box || !ta) return;
    const v = ta.value;
    if (todoMode === 'buy') {
        const items = parseShoppingText(v);
        box.innerHTML = items.length > 1 || (items.length === 1 && /[\n,;]/.test(v))
            ? '<span class="hint">Получится ' + items.length + ': ' + items.map(i => esc(i.name) + (i.qty ? ' (' + esc(i.qty) + ')' : '') + (i.price ? ' — ' + esc(fmtCur(i.price, i.currency)) : '')).join(', ') + '</span>' : '';
    } else {
        const items = parseTaskText(v);
        box.innerHTML = items.length && (items.length > 1 || items.some(i => i.due || i.time))
            ? '<span class="hint">Получится ' + items.length + ': ' + items.map(i => esc(i.name) + (i.due || i.time ? ' (' + esc(dueLabel(i.due, i.time)) + ')' : '')).join('; ') + '</span>' : '';
    }
}
function dueLabel(due, time) {
    let s = '';
    if (due) {
        if (due === todayKey()) s = 'сегодня'; else if (due === todayKey(1)) s = 'завтра'; else s = 'до ' + fmtDayKey(due);
    }
    return (s + (time ? (s ? ', ' : '') + time : '')).trim();
}
function setTodoMode(mode) {
    todoMode = mode; LS.set('todo_mode', mode);
    $$('#todo-mode button').forEach(b => b.classList.toggle('is-on', b.dataset.mode === mode));
    const buy = mode === 'buy';
    $('#todo-input').placeholder = buy ? 'Например: молоко 2 шт, хлеб, яйца 10, сыр 1500 тг' : 'Например: Позвонить маме завтра; Оплатить интернет до 10.11; Врач в пятницу в 15:30';
    $('#todo-hint').textContent = buy
        ? 'Впишите покупки (по одной в строке или через запятую) или вставьте сообщение со списком целиком — приложение само разложит его по пунктам. Цена у пункта сохраняется в истории цен.'
        : 'Впишите дела по одному в строке (или через «;»). Срок и время можно написать словами: «завтра», «до 10.11», «15 ноября», «в пятницу в 15:30».';
    $('#todo-store').hidden = !buy; $('#todo-due').hidden = buy;
    renderTodoPreview();
}

// ---------- Действия над пунктами ----------
function toggleTodo(id, done) {
    const it = todos.find(i => i.id === id); if (!it) return;
    it.done = !!done; if (done) it.doneAt = Date.now(); else delete it.doneAt;
    saveTodos(); renderTodo();
}
function setTodoPrice(id, value) {
    const it = todos.find(i => i.id === id); if (!it) return;
    const n = parseFloat(String(value).replace(/\s/g, '').replace(',', '.'));
    it.price = Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null;
    syncShopPrice(it); saveTodos(); renderTodo();
    if (it.price) toast('Цена «' + it.name + '» сохранена в истории цен');
}
function setTodoCurrency(id, code) {
    const it = todos.find(i => i.id === id); if (!it || !TX_CURRENCIES[code]) return;
    it.currency = code; syncShopPrice(it); saveTodos(); renderTodo();
}
function deleteTodo(id) { todos = todos.filter(i => i.id !== id); saveTodos(); renderTodo(); }
async function clearDoneTodos() {
    const list = todos.filter(i => i.done && (todoFilter === 'all' || i.type === todoFilter));
    if (!list.length) { toast('Выполненных пунктов нет'); return; }
    if (!(await confirmSheet('Убрать выполненное?', 'Будет убрано пунктов: ' + list.length + '. Цены купленного останутся в истории цен.', 'Убрать', true))) return;
    const ids = new Set(list.map(i => i.id));
    todos = todos.filter(i => !ids.has(i.id)); saveTodos(); renderTodo();
}
function todoListText() {
    const act = todos.filter(i => !i.done && (todoFilter === 'all' || i.type === todoFilter));
    const buy = act.filter(i => i.type === 'buy'), task = act.filter(i => i.type === 'task');
    const lines = [];
    if (buy.length) { if (todoFilter === 'all') lines.push('Покупки:'); buy.forEach(i => lines.push('• ' + i.name + (i.qty ? ' — ' + i.qty : ''))); }
    if (task.length) { if (todoFilter === 'all') lines.push('Дела:'); task.forEach(i => lines.push('• ' + i.name + (i.due || i.time ? ' — ' + dueLabel(i.due, i.time) : ''))); }
    return lines.join('\n');
}
async function copyTodoList() {
    const text = todoListText();
    if (!text) { toast('В списке нечего копировать'); return; }
    toast((await copyText(text)) ? 'Список скопирован — можно отправить в мессенджер' : 'Не удалось скопировать');
}

// ---------- Показ ----------
function todoItemHtml(it) {
    const last = it.type === 'buy' && !it.price ? lastPriceFor(it.name, it.id) : null;
    let meta = '';
    if (it.type === 'buy') {
        meta += '<input type="number" class="todo-price" min="0" step="any" inputmode="decimal" placeholder="Цена" value="' + (it.price || '') + '" data-price aria-label="Цена: ' + esc(it.name) + '">' +
            '<select class="todo-cur" data-cur aria-label="Валюта цены">' + Object.entries(TX_CURRENCIES).map(([k, v]) => '<option value="' + k + '"' + ((it.currency || 'KZT') === k ? ' selected' : '') + '>' + v.sign + '</option>').join('') + '</select>';
        if (it.store) meta += '<span class="chip">' + ic('store') + esc(it.store) + '</span>';
    } else if (it.due || it.time) {
        const over = !it.done && it.due && (it.due < todayKey() || (it.due === todayKey() && it.time && it.time < fmtTime(Date.now())));
        meta += '<span class="chip' + (over ? ' is-warn' : it.due === todayKey() && !it.done ? ' is-ok' : '') + '">' + ic(over ? 'warning' : 'event') + esc((over ? 'просрочено: ' : '') + (dueLabel(it.due, it.time) || '')) + '</span>';
    }
    meta += '<span class="who">' + ic('person') + esc(it.author || 'Александр') + ' · ' + esc(fmtTime(it.addedAt)) + '</span>';
    return '<div class="todo-item' + (it.done ? ' is-done' : '') + '" data-id="' + it.id + '">' +
        '<input type="checkbox" class="check" ' + (it.done ? 'checked' : '') + ' data-check aria-label="' + (it.type === 'buy' ? 'Куплено' : 'Выполнено') + ': ' + esc(it.name) + '">' +
        '<div class="todo-main"><div class="todo-name">' + esc(it.name) + (it.qty ? '<small>' + esc(it.qty) + '</small>' : '') + '</div>' +
        (last ? '<div class="todo-last">в прошлый раз ' + esc(fmtCur(last.price, last.currency || 'KZT')) + (last.store ? ', ' + esc(last.store) : '') + '</div>' : '') + '</div>' +
        '<button type="button" class="icon-btn is-danger" data-del aria-label="Убрать «' + esc(it.name) + '»">' + ic('close') + '</button>' +
        '<div class="todo-meta">' + meta + '</div></div>';
}
function todoSummaryText() {
    const parts = [];
    const buy = todos.filter(i => i.type === 'buy'), task = todos.filter(i => i.type === 'task');
    if ((todoFilter === 'all' || todoFilter === 'buy') && buy.length) {
        const left = buy.filter(i => !i.done).length;
        const total = buy.reduce((s, i) => s + (i.price ? (priceInTenge(i) || 0) : 0), 0);
        parts.push('Покупки: осталось ' + left + ' из ' + buy.length + (total ? ' · по ценам ≈ ' + fmtTenge(total) : ''));
    }
    if ((todoFilter === 'all' || todoFilter === 'task') && task.length) {
        const left = task.filter(i => !i.done), over = left.filter(i => i.due && i.due < todayKey()).length;
        parts.push('Дела: осталось ' + left.length + ' из ' + task.length + (over ? ' · просрочено ' + over : ''));
    }
    return parts.join('  |  ');
}
// Перерисовка с защитой от повторного входа: когда поле цены в фокусе, замена списка снимает фокус и браузер
// запускает «change» прямо посреди замены. Поэтому фокус снимаем заранее, а вложенный вызов пропускаем.
let todoRendering = false;
function renderTodo() {
    const list = $('#todo-list'); if (!list || todoRendering) return;
    todoRendering = true;
    try {
        const ae = document.activeElement;
        if (ae && ae !== document.body && list.contains(ae) && typeof ae.blur === 'function') ae.blur();
        renderTodoNow();
    } finally { todoRendering = false; }
}
function renderTodoNow() {
    const list = $('#todo-list'); if (!list) return;
    const nBuy = todos.filter(i => i.type === 'buy').length, nTask = todos.filter(i => i.type === 'task').length;
    $$('#todo-filter button').forEach(b => {
        const k = b.dataset.filter; b.classList.toggle('is-on', k === todoFilter);
        b.querySelector('.cnt').textContent = k === 'all' ? todos.length : k === 'buy' ? nBuy : nTask;
    });
    $('#todo-summary').textContent = todoSummaryText();
    const stores = Array.from(new Set([...todos.map(i => i.store), ...prices.map(r => r.store)].filter(Boolean)));
    $('#stores').innerHTML = stores.map(s => '<option value="' + esc(s) + '">').join('');
    const items = todos.filter(i => todoFilter === 'all' || i.type === todoFilter);
    $('#todo-pdf').disabled = !todos.length;
    if (!items.length) {
        list.innerHTML = '<div class="empty todo-empty"><div class="ico-big">' + ic(todoFilter === 'buy' ? 'shopping_cart' : 'task_alt') + '</div><b>' +
            (todos.length ? 'В этом разделе пусто' : 'Список пуст') + '</b>' + (todos.length ? 'Выберите другой раздел или добавьте записи выше.' : 'Впишите покупки или дела выше — они появятся здесь, сгруппированные по датам.') + '</div>';
        return;
    }
    const groups = new Map();
    items.forEach(i => { const k = dayKey(i.addedAt); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(i); });
    const keys = Array.from(groups.keys()).sort().reverse();
    list.innerHTML = keys.map(k => {
        const arr = groups.get(k).sort((a, b) => (a.done - b.done) || (a.addedAt - b.addedAt));
        const left = arr.filter(i => !i.done).length;
        return '<section class="day-group"><div class="day-head"><h4>' + esc(dayTitle(k)) + '</h4><span>' + (left ? 'осталось ' + left : 'всё готово') + ' · ' + esc(authorName()) + '</span></div><div class="day-items">' + arr.map(todoItemHtml).join('') + '</div></section>';
    }).join('');
}

function initTodo() {
    $('#todo-mode').addEventListener('click', e => { const b = e.target.closest('button[data-mode]'); if (b) setTodoMode(b.dataset.mode); });
    $('#todo-filter').addEventListener('click', e => { const b = e.target.closest('button[data-filter]'); if (b) { todoFilter = b.dataset.filter; renderTodo(); } });
    $('#todo-input').addEventListener('input', renderTodoPreview);
    $('#todo-input').addEventListener('keydown', e => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); addTodoFromInput(); } });
    $('#todo-add').addEventListener('click', addTodoFromInput);
    $('#todo-paste').addEventListener('click', pasteTodoText);
    $('#todo-copy').addEventListener('click', copyTodoList);
    $('#todo-clear').addEventListener('click', clearDoneTodos);
    $('#todo-pdf').addEventListener('click', openTodoPdfSheet);
    const list = $('#todo-list');
    const idOf = el => el.closest('.todo-item').dataset.id;
    list.addEventListener('change', e => {
        if (e.target.matches('[data-check]')) toggleTodo(idOf(e.target), e.target.checked);
        else if (e.target.matches('[data-price]')) setTodoPrice(idOf(e.target), e.target.value);
        else if (e.target.matches('[data-cur]')) setTodoCurrency(idOf(e.target), e.target.value);
    });
    list.addEventListener('click', e => { const d = e.target.closest('[data-del]'); if (d) deleteTodo(idOf(d)); });
    setTodoMode(todoMode === 'task' ? 'task' : 'buy'); renderTodo();
}
