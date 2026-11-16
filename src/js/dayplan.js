'use strict';
// =====================================================================================================
// iLife 2.10.0 — РАЗДЕЛ «МОЙ ДЕНЬ» (в главном меню, своё меню с кнопкой «Назад»), логика как у «Лекарств»:
//   «Дела и расценки» — дела с расписанием (один раз / каждый день / по дням недели / через день, время — по желанию),
//                       напоминания; «Стоимость моей работы» — расценки за час или за единицу; обычное рабочее время.
//   «Календарь»       — месяц с отметками (дела, заработок); ниже выбранный день: рабочее время дня (своё или выходной),
//                       дела с галочками, «Сделанная работа» (расценка × количество = сумма); итог месяца;
//                       PDF за месяц таблицей или списком.
// Данные — список dayplan (ключ ilife_dayplan, синхронизируется через Google Диск и аккаунт, входит в копию).
// Записи различаются полем kind:
//   task — { id, kind:'task', text, note, times:['09:00'], mode:'once'|'daily'|'week'|'every', date (для once), from, to,
//            wd:[0..6, 0 = пн], every, notify, rateId, done:{ 'ГГГГ-ММ-ДД': ['09:00' | '*'] }, createdAt, author }
//   rate — { id, kind:'rate', name, per:'hour'|'unit', unit, price }              (цена в тенге)
//   log  — { id, kind:'log', date, rateId, name, per, unit, price, qty, note, createdAt }   (сделанная работа)
//   wday — { id:'wd'+дата, kind:'wday', date, start, end, off }                    (рабочее время дня)
//   cfg  — { id:'wcfg', kind:'cfg', start, end, wd:[0..6] }                         (обычное рабочее время)
// Записи «Плана на день» версий 2.7–2.9 (без kind: { date, time, text, done }) переводятся в дела «один раз».
// =====================================================================================================

(function () {
    if (!window.ICONS) return;
    Object.assign(window.ICONS, {
        payments: '<path d="M19 14V6c0-1.1-.9-2-2-2H3c-1.1 0-2 .9-2 2v8c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2m-9-1c-1.66 0-3-1.34-3-3s1.34-3 3-3 3 1.34 3 3-1.34 3-3 3m13-6v11c0 1.1-.9 2-2 2H4v-2h17V7z"/>'
    });
})();

let dayplan = LS.get('dayplan', []);
if (!Array.isArray(dayplan)) dayplan = [];
let wkSel = todayKey();
let wkCal = (function () { const p = almatyParts(); return { y: p.y, mo: p.mo }; })();
let wkAsked = false;
const WK_NOTIFY_WINDOW = 120;
const WK_QUICK = [{ n: 'Утро', t: '09:00' }, { n: 'Обед', t: '13:00' }, { n: 'Вечер', t: '18:00' }];

function saveDayPlan() { if (typeof cloudLocalChanged === 'function') cloudLocalChanged(); LS.set('dayplan', dayplan); }
function wkList(kind) { return dayplan.filter(x => x && x.kind === kind); }
function wkById(id) { return dayplan.find(x => x && x.id === id) || null; }
function wkMoney(n) { return (Math.round((+n || 0) * 100) / 100).toLocaleString('ru-RU') + ' ₸'; }
function wkNum(n) { return (Math.round((+n || 0) * 100) / 100).toLocaleString('ru-RU'); }
function wkMin(t) { return medMin(t); }

// Старые записи «Плана на день» → дела «один раз»; обычное рабочее время по умолчанию
function wkMigrate() {
    let ch = false;
    dayplan.forEach(x => {
        if (!x || x.kind) return;
        const t = /^\d{2}:\d{2}$/.test(x.time || '') ? x.time : '';
        Object.assign(x, { kind: 'task', text: x.text || '', note: '', times: t ? [t] : [], mode: 'once', date: x.date || todayKey(), from: x.date || todayKey(), to: x.date || todayKey(), wd: [], every: 2, notify: x.notify !== false, rateId: '', done: x.done ? { [x.date]: [t || '*'] } : {} });
        ch = true;
    });
    if (!wkById('wcfg')) { dayplan.push({ id: 'wcfg', kind: 'cfg', start: '09:00', end: '18:00', wd: [0, 1, 2, 3, 4], createdAt: Date.now() }); ch = true; }
    if (ch) saveDayPlan();
}
function wkCfg() { return wkById('wcfg') || { start: '09:00', end: '18:00', wd: [0, 1, 2, 3, 4] }; }

// ---------- Дела по дням ----------
function wkTaskOn(t, key) {
    if (t.mode === 'once') return t.date === key;
    if (!t.from || key < t.from) return false;
    if (t.to && key > t.to) return false;
    if (t.mode === 'every') return medDaysBetween(t.from, key) % Math.max(2, +t.every || 2) === 0;
    if (t.mode === 'week') return (t.wd || []).includes(medWd(key));
    return true;
}
function wkSlots(t) { return (t.times || []).length ? t.times : ['*']; }
function wkIsDone(t, key, time) { return !!(t.done && t.done[key] && t.done[key].includes(time)); }
function wkSetDone(t, key, time, on) {
    t.done = t.done || {};
    const arr = (t.done[key] || []).filter(x => x !== time);
    if (on) arr.push(time);
    if (arr.length) t.done[key] = arr.sort(); else delete t.done[key];
}
// Дела дня: [{ task, time, done, key }] — сначала со временем, потом без
function wkItemsOn(key) {
    const out = [];
    wkList('task').forEach(t => { if (wkTaskOn(t, key)) wkSlots(t).forEach(tm => out.push({ task: t, time: tm, done: wkIsDone(t, key, tm), key: t.id + '|' + key + '|' + tm })); });
    return out.sort((a, b) => (a.time === '*' ? '99' : a.time).localeCompare(b.time === '*' ? '99' : b.time) || String(a.task.text).localeCompare(String(b.task.text), 'ru'));
}
function wkDayState(key, items) {
    items = items || wkItemsOn(key);
    const total = items.length, done = items.filter(d => d.done).length;
    if (!total) return { s: '', total, done };
    if (done === total) return { s: 'done', total, done };
    const today = todayKey();
    if (key < today) return { s: done ? 'part' : 'miss', total, done };
    if (key === today) { const now = fmtTime(Date.now()); return { s: items.some(d => !d.done && d.time !== '*' && d.time < now) || done ? 'part' : 'plan', total, done }; }
    return { s: 'plan', total, done };
}
function wkTaskModeText(t) {
    if (t.mode === 'once') return fmtDayKey(t.date, true);
    const per = t.mode === 'every' ? 'через день' : t.mode === 'week' ? (t.wd || []).slice().sort().map(i => MED_WD[i]).join(', ') : 'каждый день';
    return per + ' · с ' + fmtDayKey(t.from, true) + (t.to ? ' по ' + fmtDayKey(t.to, true) : '');
}
function wkTaskState(t) { const d = todayKey(); if (t.mode === 'once') return t.date < d ? 'past' : t.date > d ? 'future' : 'now'; return t.to && t.to < d ? 'past' : t.from > d ? 'future' : 'now'; }

// ---------- Рабочее время дня ----------
function wkDayRec(key) { return wkById('wd' + key); }
function wkHoursOf(start, end) { if (!start || !end) return 0; let m = wkMin(end) - wkMin(start); if (m < 0) m += 1440; return m / 60; }
// { start, end, off, own, hours }
function wkWorkTime(key) {
    const r = wkDayRec(key);
    if (r) return r.off ? { off: true, own: true, hours: 0 } : { start: r.start, end: r.end, own: true, hours: wkHoursOf(r.start, r.end) };
    const c = wkCfg();
    if (!(c.wd || []).includes(medWd(key))) return { off: true, own: false, hours: 0 };
    return { start: c.start, end: c.end, own: false, hours: wkHoursOf(c.start, c.end) };
}
function wkSetDay(key, patch) {
    let r = wkDayRec(key);
    if (patch === null) { if (r) dayplan = dayplan.filter(x => x !== r); }
    else { if (!r) { const w = wkWorkTime(key); r = { id: 'wd' + key, kind: 'wday', date: key, start: w.start || wkCfg().start, end: w.end || wkCfg().end, off: false, createdAt: Date.now() }; dayplan.push(r); } Object.assign(r, patch); }
    saveDayPlan();
}
// ---------- Сделанная работа ----------
function wkLogsOn(key) { return wkList('log').filter(l => l.date === key).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0)); }
function wkSum(logs) { return logs.reduce((a, l) => a + (+l.qty || 0) * (+l.price || 0), 0); }
function wkRateLabel(r) { return r.per === 'hour' ? 'час' : (r.unit || 'шт'); }

// =====================================================================================================
// СТРАНИЦА «ДЕЛА И РАСЦЕНКИ»
// =====================================================================================================
function renderWkNow() {
    const host = $('#wk-now'); if (!host) return;
    const today = todayKey(), now = fmtTime(Date.now());
    const items = wkItemsOn(today).filter(d => !d.done && d.time !== '*');
    const late = items.filter(d => d.time <= now), next = items.filter(d => d.time > now);
    if (!late.length && !next.length) { host.innerHTML = ''; return; }
    host.innerHTML = late.length ?
        '<div class="med-now is-late">' + ic('alarm') + '<div><small>Пора сделать' + (late.length > 1 ? ' · ' + late.length : '') + '</small><span>' + late.map(d => '<b>' + d.time + '</b> ' + esc(d.task.text)).join(', ') + '</span></div><button type="button" class="btn btn-primary" id="wk-now-done">' + ic('check') + 'Сделано</button></div>' :
        '<div class="med-now">' + ic('schedule') + '<div><small>Следующее дело сегодня</small><span><b>' + next[0].time + '</b> — ' + next.filter(d => d.time === next[0].time).map(d => esc(d.task.text)).join('; ') + '</span></div></div>';
    const b = $('#wk-now-done'); if (b) b.addEventListener('click', () => { late.forEach(d => wkSetDone(d.task, today, d.time, true)); saveDayPlan(); renderDayPlan(); toast('Отмечено: сделано'); });
}
function renderWkTasks() {
    const host = $('#wk-tasks'); if (!host) return;
    const order = { now: 0, future: 1, past: 2 };
    const list = wkList('task').sort((a, b) => order[wkTaskState(a)] - order[wkTaskState(b)] || (a.mode === 'once') - (b.mode === 'once') || String(a.text).localeCompare(String(b.text), 'ru'));
    $('#wk-tasks-badge').textContent = list.length ? String(list.filter(t => wkTaskState(t) !== 'past').length) : '';
    if (!list.length) { host.innerHTML = '<div class="empty" style="padding:1rem 1rem 1.25rem"><b>Дел пока нет</b>Нажмите «Добавить дело»: что сделать, во сколько и как часто.</div>'; return; }
    const past = list.filter(t => wkTaskState(t) === 'past'), cur = list.filter(t => wkTaskState(t) !== 'past');
    const row = t => {
        const st = wkTaskState(t), r = t.rateId && wkById(t.rateId);
        return '<div class="med-plan is-' + st + '" data-id="' + esc(t.id) + '"><span class="med-plan-ico">' + ic(t.mode === 'once' ? 'task_alt' : 'event_available') + '</span>' +
            '<div class="med-plan-b"><b>' + esc(t.text) + (r ? ' <span>· ' + esc(r.name) + '</span>' : '') + '</b>' +
            '<div class="chips">' + (t.times || []).map(x => '<span class="chip">' + ic('schedule') + x + '</span>').join('') + (!(t.times || []).length ? '<span class="chip">без времени</span>' : '') + (st === 'past' ? '<span class="chip">прошло</span>' : st === 'future' ? '<span class="chip is-ok">впереди</span>' : '') + '</div>' +
            '<small>' + esc(wkTaskModeText(t)) + (t.note ? ' · ' + esc(t.note) : '') + '</small></div>' +
            ((t.times || []).length ? '<button type="button" class="icon-btn" data-bell aria-pressed="' + (t.notify !== false) + '" aria-label="Напоминание" title="Напоминание">' + ic(t.notify !== false ? 'notifications' : 'notifications_off') + '</button>' : '') +
            '<button type="button" class="icon-btn" data-edit aria-label="Изменить" title="Изменить">' + ic('edit') + '</button></div>';
    };
    host.innerHTML = cur.map(row).join('') + (past.length ? '<details class="fold wk-past"><summary>' + ic('history') + 'Прошедшие · ' + past.length + '</summary><div class="fold-body">' + past.map(row).join('') + '</div></details>' : '');
}
function renderWkRates() {
    const host = $('#wk-rates'); if (!host) return;
    const list = wkList('rate').sort((a, b) => String(a.name).localeCompare(String(b.name), 'ru'));
    $('#wk-rates-badge').textContent = list.length ? String(list.length) : '';
    host.innerHTML = (list.length ? '<div class="wk-rates">' + list.map(r => '<div class="wk-rate" data-id="' + esc(r.id) + '"><span class="med-plan-ico">' + ic(r.per === 'hour' ? 'schedule' : 'payments') + '</span>' +
        '<div class="wk-rate-b"><b>' + esc(r.name) + '</b><small>' + wkMoney(r.price) + ' за ' + esc(wkRateLabel(r)) + '</small></div>' +
        '<button type="button" class="icon-btn" data-edit aria-label="Изменить расценку">' + ic('edit') + '</button></div>').join('') + '</div>' : '') +
        '<button type="button" class="btn" id="wk-rate-add" style="margin-top:0.625rem">' + ic('add') + 'Добавить расценку</button>';
}
function renderWkHours() {
    const c = wkCfg(), s = $('#wk-def-start'); if (!s) return;
    s.value = c.start || ''; $('#wk-def-end').value = c.end || '';
    $('#wk-def-wd').innerHTML = MED_WD.map((n, i) => '<button type="button" class="chip' + ((c.wd || []).includes(i) ? ' is-on' : '') + '" data-wd="' + i + '">' + n + '</button>').join('');
    $('#wk-hours-badge').textContent = c.start && c.end ? c.start + '–' + c.end : '';
}
function renderWkNotify() {
    const el = $('#wk-notify'); if (!el) return;
    const sup = typeof Notification !== 'undefined', perm = sup ? Notification.permission : 'none', on = wkNotifyOn();
    el.checked = on; el.disabled = !sup;
    $('#wk-notify-badge').textContent = on ? 'Включены' : 'Выключены';
    $('#wk-notify-state').textContent = !sup ? 'В этом браузере уведомлений нет — используйте «В календарь телефона».' : perm === 'denied' ? 'Уведомления запрещены в настройках браузера для этого сайта.' :
        on ? 'Напоминание приходит во время дела, пока iLife открыт или свёрнут.' : 'Включите, чтобы iLife напоминал о делах со временем.';
}

// Форма дела (как форма приёма лекарства)
function wkTaskSheet(task, preset) {
    const isNew = !task; preset = preset || {};
    const day = preset.date || wkSel || todayKey();
    const t = task || { text: '', note: '', times: [], mode: 'once', date: day, from: day, to: '', wd: [0, 1, 2, 3, 4], every: 2, notify: true, rateId: '' };
    let times = (t.times || []).slice(), mode = t.mode || 'once';
    const wd = new Set(t.wd && t.wd.length ? t.wd : [0, 1, 2, 3, 4]);
    const rates = wkList('rate');
    const node = document.createElement('div'); node.className = 'med-form';
    node.innerHTML =
        '<label class="field-label" for="wt-text">Что сделать</label><input type="text" id="wt-text" maxlength="160" placeholder="Например, «Сдать отчёт», «Тренировка»" value="' + esc(t.text) + '">' +
        '<label class="field-label">Время</label><div id="wt-times" class="med-times"></div>' +
        '<div class="chips" id="wt-quick" style="margin-top:0.5rem">' + WK_QUICK.map(q => '<button type="button" class="chip" data-t="' + q.t + '">' + q.n + ' ' + q.t + '</button>').join('') + '<button type="button" class="chip" data-t="">' + ic('add') + 'Своё время</button></div>' +
        '<p class="hint" style="margin:0.375rem 0 0">Без времени — дело на весь день, без напоминания.</p>' +
        '<label class="field-label">Когда</label><div class="seg" id="wt-mode" role="group" aria-label="Когда"><button type="button" data-m="once">Один раз</button><button type="button" data-m="daily">Каждый день</button><button type="button" data-m="week">По дням</button><button type="button" data-m="every">Через день</button></div>' +
        '<div class="chips med-wd" id="wt-wd" style="margin-top:0.5rem">' + MED_WD.map((n, i) => '<button type="button" class="chip" data-wd="' + i + '">' + n + '</button>').join('') + '</div>' +
        '<div id="wt-once"><label class="field-label" for="wt-date">День</label><input type="date" id="wt-date" value="' + esc(t.date || day) + '"></div>' +
        '<div class="med-row2" id="wt-range"><div><label class="field-label" for="wt-from">С</label><input type="date" id="wt-from" value="' + esc(t.from || day) + '"></div><div><label class="field-label" for="wt-to">По (необязательно)</label><input type="date" id="wt-to" value="' + esc(t.mode === 'once' ? '' : (t.to || '')) + '"></div></div>' +
        (rates.length ? '<label class="field-label" for="wt-rate">Расценка (необязательно)</label><select id="wt-rate"><option value="">— без расценки —</option>' + rates.map(r => '<option value="' + esc(r.id) + '"' + (r.id === t.rateId ? ' selected' : '') + '>' + esc(r.name) + ' · ' + wkMoney(r.price) + ' за ' + esc(wkRateLabel(r)) + '</option>').join('') + '</select>' : '') +
        '<label class="field-label" for="wt-note">Заметка</label><input type="text" id="wt-note" maxlength="160" value="' + esc(t.note || '') + '">' +
        '<label class="opt-row" style="margin-top:0.5rem"><span style="flex:1"><b>Напоминать</b><span class="sub">уведомление во время дела</span></span><input type="checkbox" class="switch" id="wt-notify"' + (t.notify !== false ? ' checked' : '') + '></label>';
    const tBox = $('#wt-times', node);
    const pull = () => { times = $$('input[type="time"]', tBox).map(i => i.value); };
    const drawTimes = () => {
        tBox.innerHTML = times.map((x, i) => '<span class="med-time"><input type="time" value="' + esc(x) + '" aria-label="Время ' + (i + 1) + '"><button type="button" class="icon-btn is-danger" data-rm="' + i + '" aria-label="Убрать время">' + ic('close') + '</button></span>').join('');
        $$('#wt-quick [data-t]', node).forEach(b => { if (b.dataset.t) b.classList.toggle('is-on', times.includes(b.dataset.t)); });
    };
    const drawMode = () => {
        $$('#wt-mode button', node).forEach(b => b.classList.toggle('is-on', b.dataset.m === mode));
        $('#wt-wd', node).hidden = mode !== 'week'; $('#wt-once', node).hidden = mode !== 'once'; $('#wt-range', node).hidden = mode === 'once';
        $$('#wt-wd [data-wd]', node).forEach(b => b.classList.toggle('is-on', wd.has(+b.dataset.wd)));
    };
    drawTimes(); drawMode();
    tBox.addEventListener('click', e => { const b = e.target.closest('[data-rm]'); if (!b) return; pull(); times.splice(+b.dataset.rm, 1); drawTimes(); });
    tBox.addEventListener('change', () => { pull(); drawTimes(); });
    $('#wt-quick', node).addEventListener('click', e => {
        const b = e.target.closest('[data-t]'); if (!b) return; pull();
        if (!b.dataset.t) { times.push('12:00'); drawTimes(); const a = $$('input[type="time"]', tBox); a[a.length - 1].focus(); return; }
        times = times.includes(b.dataset.t) ? times.filter(x => x !== b.dataset.t) : times.concat(b.dataset.t);
        times = times.filter(Boolean).sort(); drawTimes();
    });
    $('#wt-mode', node).addEventListener('click', e => { const b = e.target.closest('[data-m]'); if (!b) return; mode = b.dataset.m; drawMode(); });
    $('#wt-wd', node).addEventListener('click', e => { const b = e.target.closest('[data-wd]'); if (!b) return; const i = +b.dataset.wd; if (wd.has(i)) wd.delete(i); else wd.add(i); drawMode(); });
    const actions = [{ label: 'Отмена', value: false }];
    if (!isNew) actions.unshift({ label: 'Удалить', kind: 'danger', icon: 'delete', onClick: async () => { if (!(await confirmSheet('Удалить дело?', '«' + task.text + '» и его отметки будут удалены.', 'Удалить', true))) return false; dayplan = dayplan.filter(x => x !== task); saveDayPlan(); renderDayPlan(); toast('Дело удалено'); } });
    actions.push({
        label: 'Сохранить', kind: 'primary', icon: 'check', onClick: () => {
            pull();
            const text = $('#wt-text', node).value.trim();
            if (!text) { toast('Впишите, что сделать'); $('#wt-text', node).focus(); return false; }
            const ts = Array.from(new Set(times.filter(x => /^\d{2}:\d{2}$/.test(x)))).sort();
            const date = $('#wt-date', node).value || day, from = $('#wt-from', node).value || day, to = $('#wt-to', node).value || '';
            if (mode !== 'once' && to && to < from) { toast('«По» раньше, чем «С»'); return false; }
            if (mode === 'week' && !wd.size) { toast('Выберите дни недели'); return false; }
            const rec = { text, note: $('#wt-note', node).value.trim(), times: ts, mode, date: mode === 'once' ? date : '', from: mode === 'once' ? date : from, to: mode === 'once' ? date : to, wd: Array.from(wd).sort(), every: 2, notify: $('#wt-notify', node).checked, rateId: ($('#wt-rate', node) || {}).value || '' };
            if (isNew) dayplan.push(Object.assign({ id: uid('wt'), kind: 'task', done: {}, createdAt: Date.now(), author: authorName() }, rec));
            else Object.assign(task, rec);
            saveDayPlan(); renderDayPlan();
            toast(isNew ? 'Дело добавлено' : 'Сохранено');
            if (ts.length && rec.notify && !wkAsked && !wkNotifyOn() && typeof Notification !== 'undefined' && Notification.permission === 'default') { wkAsked = true; toast('Включить напоминания о делах?', { action: 'Включить', ms: 7000, onAction: wkNotifyAsk }); }
        }
    });
    openSheet({ title: isNew ? 'Новое дело' : 'Дело', node, actions });
}
function wkRateSheet(rate) {
    const isNew = !rate, r = rate || { name: '', per: 'hour', unit: '', price: '' };
    let per = r.per || 'hour';
    const node = document.createElement('div'); node.className = 'med-form';
    node.innerHTML = '<label class="field-label" for="wr-name">Что за работа</label><input type="text" id="wr-name" maxlength="80" placeholder="Например, «Монтаж видео», «Перевод»" value="' + esc(r.name) + '">' +
        '<label class="field-label">Как считается</label><div class="seg" id="wr-per"><button type="button" data-p="hour">' + ic('schedule') + 'За час</button><button type="button" data-p="unit">' + ic('payments') + 'За единицу</button></div>' +
        '<div id="wr-unit-box"><label class="field-label" for="wr-unit">Единица работы</label><input type="text" id="wr-unit" maxlength="30" list="wr-units" placeholder="страница, штука, заказ, минута видео" value="' + esc(r.per === 'unit' ? (r.unit || '') : '') + '">' + medDatalist('wr-units', ['страница', 'штука', 'заказ', 'минута', 'слово', 'урок', 'смена']) + '</div>' +
        '<label class="field-label" for="wr-price">Цена, ₸</label><input type="number" id="wr-price" min="0" step="any" inputmode="decimal" placeholder="0" value="' + esc(r.price === '' ? '' : String(r.price)) + '">';
    const draw = () => { $$('#wr-per button', node).forEach(b => b.classList.toggle('is-on', b.dataset.p === per)); $('#wr-unit-box', node).hidden = per !== 'unit'; };
    draw(); $('#wr-per', node).addEventListener('click', e => { const b = e.target.closest('[data-p]'); if (b) { per = b.dataset.p; draw(); } });
    const actions = [{ label: 'Отмена', value: false }];
    if (!isNew) actions.unshift({ label: 'Удалить', kind: 'danger', icon: 'delete', onClick: () => { dayplan = dayplan.filter(x => x !== rate); dayplan.forEach(x => { if (x.kind === 'task' && x.rateId === rate.id) x.rateId = ''; }); saveDayPlan(); renderDayPlan(); toast('Расценка удалена (сделанная работа в календаре осталась)'); } });
    actions.push({
        label: 'Сохранить', kind: 'primary', icon: 'check', onClick: () => {
            const name = $('#wr-name', node).value.trim(), price = parseFloat(String($('#wr-price', node).value).replace(',', '.'));
            if (!name) { toast('Впишите название работы'); return false; }
            if (!(price >= 0)) { toast('Укажите цену'); return false; }
            const rec = { name, per, unit: per === 'unit' ? ($('#wr-unit', node).value.trim() || 'шт') : 'час', price };
            if (isNew) dayplan.push(Object.assign({ id: uid('wr'), kind: 'rate', createdAt: Date.now() }, rec)); else Object.assign(rate, rec);
            saveDayPlan(); renderDayPlan(); toast(isNew ? 'Расценка добавлена' : 'Сохранено');
        }
    });
    openSheet({ title: isNew ? 'Стоимость работы' : 'Расценка', node, actions });
}

// =====================================================================================================
// СТРАНИЦА «КАЛЕНДАРЬ»
// =====================================================================================================
function wkShort(n) { n = Math.round(n); return n >= 1e6 ? (Math.round(n / 1e5) / 10) + 'м' : n >= 1e4 ? Math.round(n / 1e3) + 'к' : n >= 1e3 ? (Math.round(n / 100) / 10) + 'к' : String(n); }
function renderWkCal() {
    const host = $('#wk-cal'); if (!host) return;
    const keys = medMonthKeys(wkCal.y, wkCal.mo), lead = medWd(keys[0]), today = todayKey();
    $('#wk-cal-title').textContent = medMonthTitle(wkCal.y, wkCal.mo);
    let html = MED_WD.map(n => '<span class="med-cal-wd">' + n + '</span>').join('') + '<span class="med-cal-pad"></span>'.repeat(lead);
    html += keys.map(k => {
        const st = wkDayState(k), w = wkWorkTime(k), sum = wkSum(wkLogsOn(k)), d = +k.slice(8);
        const label = medDayFull(k) + (st.total ? ': сделано ' + st.done + ' из ' + st.total : '') + (w.off ? ', выходной' : ', работа ' + w.start + '–' + w.end) + (sum ? ', заработано ' + wkMoney(sum) : '');
        return '<button type="button" class="med-day wk-day' + (st.s ? ' is-' + st.s : '') + (w.off ? ' is-off' : '') + (w.own && !w.off ? ' is-own' : '') + (k === today ? ' is-today' : '') + (k === wkSel ? ' is-sel' : '') + '" data-k="' + k + '" aria-label="' + esc(label) + '"' + (k === wkSel ? ' aria-pressed="true"' : '') + '>' +
            '<span class="n">' + d + '</span><span class="m">' + (st.s === 'done' ? ic('check') : st.total ? st.done + '/' + st.total : '') + '</span>' +
            '<span class="wk-sum">' + (sum ? wkShort(sum) : '') + '</span></button>';
    }).join('');
    host.innerHTML = html;
    // итог месяца
    let hours = 0, earned = 0, done = 0, total = 0, workDays = 0;
    keys.forEach(k => { const w = wkWorkTime(k); if (!w.off && k <= today) { hours += w.hours; workDays++; } earned += wkSum(wkLogsOn(k)); if (k <= today) { const st = wkDayState(k); done += st.done; total += st.total; } });
    const byRate = new Map();
    wkList('log').filter(l => l.date.slice(0, 7) === keys[0].slice(0, 7)).forEach(l => { const k = l.name + '|' + l.unit; const v = byRate.get(k) || { name: l.name, unit: l.unit, per: l.per, qty: 0, sum: 0 }; v.qty += +l.qty || 0; v.sum += (+l.qty || 0) * (+l.price || 0); byRate.set(k, v); });
    $('#wk-month').innerHTML = '<div class="wk-tiles"><div><small>Заработано</small><b>' + wkMoney(earned) + '</b></div><div><small>Рабочее время' + (keys[0].slice(0, 7) === today.slice(0, 7) ? ' по сегодня' : '') + '</small><b>' + wkNum(hours) + ' ч · ' + medFmtN(workDays, 'день', 'дня', 'дней') + '</b></div><div><small>Дела сделано' + (keys[0].slice(0, 7) >= today.slice(0, 7) ? ' по сегодня' : '') + '</small><b>' + done + ' из ' + total + '</b></div></div>' +
        (byRate.size ? '<ul class="wk-byrate">' + Array.from(byRate.values()).sort((a, b) => b.sum - a.sum).map(v => '<li><span>' + esc(v.name) + '</span><span>' + wkNum(v.qty) + ' ' + esc(v.per === 'hour' ? 'ч' : v.unit) + '</span><b>' + wkMoney(v.sum) + '</b></li>').join('') + '</ul>' : '');
}
function renderWkDay() {
    const host = $('#wk-day'); if (!host) return;
    const key = wkSel, today = todayKey(), now = fmtTime(Date.now());
    const items = wkItemsOn(key), w = wkWorkTime(key), logs = wkLogsOn(key), rates = wkList('rate');
    const doneN = items.filter(d => d.done).length;
    let h = '<div class="card-body"><div class="med-day-h"><h3>' + esc(key === today ? 'Сегодня · ' + medDayFull(key) : capitalizeFirst(medDayFull(key))) + '</h3>' + (items.length ? '<span class="count">сделано ' + doneN + ' из ' + items.length + '</span>' : '') + '</div>';
    // рабочее время дня
    h += '<div class="wk-sec"><h4>' + ic('schedule') + 'Рабочее время' + (w.own ? '<span class="chip">своё на этот день</span>' : '') + '</h4>' +
        '<div class="wk-hours' + (w.off ? ' is-off' : '') + '"><input type="time" id="wk-d-start" value="' + esc(w.start || wkCfg().start || '') + '" aria-label="Начало работы"><span>—</span><input type="time" id="wk-d-end" value="' + esc(w.end || wkCfg().end || '') + '" aria-label="Конец работы">' +
        '<b class="wk-hn">' + (w.off ? 'выходной' : wkNum(w.hours) + ' ч') + '</b></div>' + (w.off ? '<p class="hint" style="margin:0.375rem 0 0">Выходной. Поставьте время — день станет рабочим.</p>' : '') +
        '<div class="btn-group" style="margin-top:0.5rem"><button type="button" class="btn" id="wk-d-off">' + ic(w.off ? 'event_available' : 'event') + (w.off ? 'Сделать рабочим' : 'Выходной') + '</button>' + (w.own ? '<button type="button" class="btn btn-text" id="wk-d-reset">' + ic('undo') + 'Как обычно</button>' : '') + '</div></div>';
    // дела
    h += '<div class="wk-sec"><h4>' + ic('checklist') + 'Дела</h4>';
    if (!items.length) h += '<p class="hint" style="margin:0 0 0.5rem">На этот день дел нет.</p>';
    else h += '<div class="med-doses">' + items.map(d => {
        const late = !d.done && (key < today || (key === today && d.time !== '*' && d.time <= now));
        return '<div class="med-dose' + (d.done ? ' is-taken' : late ? ' is-late' : '') + '"><button type="button" class="med-check" data-done="' + esc(d.key) + '" role="checkbox" aria-checked="' + d.done + '" aria-label="' + esc(d.task.text + ': ' + (d.done ? 'сделано' : 'не сделано')) + '">' + ic('check') + '</button>' +
            '<span class="med-dose-t">' + (d.time === '*' ? '—' : d.time) + '</span><div class="med-dose-b"><b>' + esc(d.task.text) + '</b><span>' + esc(d.task.note || '') + (late ? (d.task.note ? ' · ' : '') + '<em>не отмечено</em>' : '') + '</span></div>' +
            '<button type="button" class="icon-btn" data-task="' + esc(d.task.id) + '" aria-label="Изменить дело">' + ic('edit') + '</button></div>';
    }).join('') + '</div>';
    h += '<button type="button" class="btn" id="wk-d-addtask" style="margin-top:0.5rem">' + ic('add') + 'Дело на этот день</button></div>';
    // сделанная работа
    h += '<div class="wk-sec"><h4>' + ic('payments') + 'Сделанная работа' + (logs.length ? '<span class="wk-daysum">' + wkMoney(wkSum(logs)) + '</span>' : '') + '</h4>';
    if (logs.length) h += '<ul class="wk-logs">' + logs.map(l => '<li data-id="' + esc(l.id) + '"><div><b>' + esc(l.name) + '</b><small>' + wkNum(l.qty) + ' ' + esc(l.per === 'hour' ? 'ч' : l.unit) + ' × ' + wkMoney(l.price) + (l.note ? ' · ' + esc(l.note) : '') + '</small></div><b>' + wkMoney(l.qty * l.price) + '</b><button type="button" class="icon-btn is-danger" data-dellog aria-label="Убрать запись">' + ic('close') + '</button></li>').join('') + '</ul>';
    if (!rates.length) h += '<p class="hint">Сначала добавьте расценку на странице «Дела и расценки» — что вы делаете и сколько это стоит за час или за единицу.</p><button type="button" class="btn" id="wk-d-rate">' + ic('add') + 'Добавить расценку</button>';
    else h += '<div class="wk-addlog"><select id="wk-l-rate" aria-label="Расценка">' + rates.map(r => '<option value="' + esc(r.id) + '">' + esc(r.name) + ' · ' + wkMoney(r.price) + '/' + esc(wkRateLabel(r)) + '</option>').join('') + '</select>' +
        '<input type="number" id="wk-l-qty" min="0" step="any" inputmode="decimal" placeholder="Сколько" aria-label="Количество">' +
        '<input type="text" id="wk-l-note" maxlength="100" placeholder="Заметка (необязательно)" aria-label="Заметка">' +
        '<div class="btn-group"><button type="button" class="btn" id="wk-l-hours" title="Подставить часы рабочего времени дня">' + ic('schedule') + 'По рабочему времени</button><button type="button" class="btn btn-primary" id="wk-l-add">' + ic('add') + 'Добавить</button></div></div>';
    h += '</div></div>';
    host.innerHTML = h;
    const sel = $('#wk-l-rate');
    if (sel) {
        const last = LS.get('wk_last_rate', ''); if (rates.some(r => r.id === last)) sel.value = last;
        const sync = () => { const r = wkById(sel.value); $('#wk-l-hours').hidden = !(r && r.per === 'hour'); $('#wk-l-qty').placeholder = r ? 'Сколько, ' + (r.per === 'hour' ? 'часов' : r.unit) : 'Сколько'; };
        sel.addEventListener('change', sync); sync();
    }
}

// ---------- PDF за месяц: таблицей или списком ----------
function wkPdfSheet() {
    const row = (name, v, title, sub, on) => '<label class="opt-row"><input type="radio" name="' + name + '" value="' + v + '"' + (on ? ' checked' : '') + '><span><b>' + title + '</b><span class="sub">' + sub + '</span></span></label>';
    const html = '<p class="hint" style="margin-bottom:0.5rem">Месяц: <b>' + esc(medMonthTitle(wkCal.y, wkCal.mo)) + '</b> (переключается стрелками в календаре)</p><h4 class="opt-h">Вид</h4>' +
        row('wk-fmt', 'table', 'Таблица', 'Строка на день: дата, рабочее время, часы, дела, работа, сумма; внизу итог', true) +
        row('wk-fmt', 'list', 'Список', 'По дням: дела с отметками, работа и суммы', false) +
        '<h4 class="opt-h">Дни</h4>' + row('wk-days', 'busy', 'Рабочие дни и дни с делами или работой', 'пустые выходные пропускаются', true) + row('wk-days', 'all', 'Все дни месяца', 'включая пустые', false);
    openSheet({
        title: '«Мой день» в PDF', html,
        actions: [{ label: 'Отмена' }, { label: 'Сохранить PDF', kind: 'primary', icon: 'picture_as_pdf', async onClick(s) {
            const v = n => ($('input[name="' + n + '"]:checked', s.el) || {}).value;
            await exportWkPdf(v('wk-fmt'), v('wk-days') === 'all');
        } }]
    });
}
async function exportWkPdf(fmt, allDays) {
    const keys = medMonthKeys(wkCal.y, wkCal.mo).filter(k => allDays || wkItemsOn(k).length || wkLogsOn(k).length || !wkWorkTime(k).off);
    try {
        const accent = pdfAccent();
        const pdf = new PdfWriter({ title: 'iLife — Мой день', footer: 'iLife · Мой день · ' + authorName() });
        let earned = 0, hours = 0, done = 0, total = 0;
        const today = todayKey();
        keys.forEach(k => { earned += wkSum(wkLogsOn(k)); const w = wkWorkTime(k); hours += w.off ? 0 : w.hours; if (k <= today) { const st = wkDayState(k); done += st.done; total += st.total; } });
        pdfHeader(pdf, 'Мой день · ' + medMonthTitle(wkCal.y, wkCal.mo), 'Заработано: ' + wkMoney(earned) + '  ·  рабочих часов по графику: ' + wkNum(hours) + '  ·  дела сделано: ' + done + ' из ' + total, accent);
        const dd = k => { const p = almatyParts(keyToMs(k)); return pad2(p.d) + '.' + pad2(p.mo + 1) + ' ' + MED_WD[medWd(k)]; };
        if (fmt === 'table') {
            const cols = [{ t: 'Дата', w: 54 }, { t: 'Время', w: 64 }, { t: 'Часы', w: 32 }, { t: 'Дела', w: 128 }, { t: 'Работа', w: 152 }, { t: 'Сумма', w: pdf.cw - 430 }];
            const X = []; let x = pdf.mx; cols.forEach(c => { X.push(x); x += c.w; });
            const head = () => { pdf.ensure(24); pdf.rect(pdf.mx, pdf.y, pdf.cw, 20, '#efeaf3', 4); cols.forEach((c, i) => pdf.textAt(c.t, X[i] + 4, pdf.y + 14, 8.5, { bold: true, color: '#49454f' })); pdf.y += 22; };
            head();
            keys.forEach((k, ri) => {
                const w = wkWorkTime(k), items = wkItemsOn(k), logs = wkLogsOn(k), st = wkDayState(k, items);
                const cells = [dd(k), w.off ? 'выходной' : w.start + '–' + w.end, w.off ? '' : wkNum(w.hours),
                    items.map(d => (d.done ? 'v ' : '– ') + d.task.text).join('\n') || '—',
                    logs.map(l => l.name + ': ' + wkNum(l.qty) + ' ' + (l.per === 'hour' ? 'ч' : l.unit)).join('\n') || '—', logs.length ? wkMoney(wkSum(logs)) : ''];
                const lines = cells.map((c, i) => c.split('\n').flatMap(par => pdf.wrap(par, 8.5, false, cols[i].w - 8)));
                const hRow = Math.max(18, 6 + Math.max(...lines.map(l => l.length)) * 11);
                if (pdf.y + hRow > pdf.H - pdf.mb) { pdf.newPage(); head(); }
                if (ri % 2) pdf.rect(pdf.mx, pdf.y, pdf.cw, hRow, '#f8f6fa');
                lines.forEach((ls, i) => ls.forEach((l, j) => pdf.textAt(l, X[i] + 4, pdf.y + 12 + j * 11, 8.5, { bold: i === 5, color: i === 3 && st.s === 'miss' ? '#b3261e' : '#1d1b20' })));
                pdf.y += hRow; pdf.line(pdf.mx, pdf.y, pdf.W - pdf.mx, pdf.y, '#e2dde6', 0.5);
            });
            pdf.gap(6); pdf.ensure(20);
            pdf.textAt('Итого', X[0] + 4, pdf.y + 12, 9.5, { bold: true }); pdf.textAt(wkNum(hours), X[2] + 4, pdf.y + 12, 9.5, { bold: true }); pdf.textAt(done + ' из ' + total, X[3] + 4, pdf.y + 12, 9.5, { bold: true }); pdf.textAt(wkMoney(earned), X[5] + 4, pdf.y + 12, 9.5, { bold: true, color: accent });
            pdf.y += 20;
        } else {
            keys.forEach(k => {
                const w = wkWorkTime(k), items = wkItemsOn(k), logs = wkLogsOn(k);
                pdf.ensure(46);
                pdf.textAt(capitalizeFirst(medDayFull(k)), pdf.mx, pdf.y + 12, 12, { bold: true });
                pdf.textAt(w.off ? 'выходной' : w.start + '–' + w.end + ' · ' + wkNum(w.hours) + ' ч', pdf.W - pdf.mx, pdf.y + 12, 9.5, { color: accent, bold: true, align: 'right' });
                pdf.y += 18; pdf.line(pdf.mx, pdf.y, pdf.W - pdf.mx, pdf.y, '#cac4d0', 0.6); pdf.gap(5);
                items.forEach(d => { pdf.ensure(16); pdf.box(pdf.mx + 2, pdf.y + 1, 10, d.done ? accent : '#79747e', d.done); pdf.textAt((d.time === '*' ? '' : d.time + '  ') + d.task.text, pdf.mx + 18, pdf.y + 10, 10, { color: d.done ? '#79747e' : '#1d1b20' }); pdf.y += 15; });
                logs.forEach(l => { pdf.ensure(15); pdf.textAt(l.name + ': ' + wkNum(l.qty) + ' ' + (l.per === 'hour' ? 'ч' : l.unit) + ' × ' + wkMoney(l.price), pdf.mx + 18, pdf.y + 10, 9.5, { color: '#49454f' }); pdf.textAt(wkMoney(l.qty * l.price), pdf.W - pdf.mx, pdf.y + 10, 9.5, { bold: true, align: 'right' }); pdf.y += 14; });
                if (!items.length && !logs.length) pdf.para('Нет дел и записей о работе', { size: 9, color: '#79747e', indent: 18 });
                if (logs.length) { pdf.textAt('За день: ' + wkMoney(wkSum(logs)), pdf.W - pdf.mx, pdf.y + 10, 9.5, { bold: true, color: accent, align: 'right' }); pdf.y += 14; }
                pdf.gap(10);
            });
        }
        await finishPdf(pdf, 'Мой_день_' + wkCal.y + '-' + pad2(wkCal.mo + 1));
    } catch (e) { console.error(e); toast('Не удалось собрать PDF'); }
}

// ---------- Уведомления (как у лекарств) ----------
function wkNotifyOn() { return typeof Notification !== 'undefined' && Notification.permission === 'granted' && LS.get('dp_notify', true) !== false; }
async function wkNotifyAsk() {
    if (typeof Notification === 'undefined') { toast('В этом браузере уведомлений нет'); return false; }
    if (Notification.permission === 'denied') { toast('Уведомления запрещены в настройках браузера для этого сайта', { action: 'Инструкция', onAction: () => openInstruction('instr-med-notify') }); return false; }
    let res = Notification.permission;
    if (res !== 'granted') { try { res = await Notification.requestPermission(); } catch (e) { res = 'denied'; } }
    if (res === 'granted') { LS.set('dp_notify', true); toast('Напоминания о делах включены'); } else toast('Без разрешения уведомлений не будет');
    renderWkNotify();
    return res === 'granted';
}
async function wkShowNotification(title, body, tag, keys) {
    const opts = { body, tag, icon: 'images/icon-192.png', badge: 'images/favicon-48.png', renotify: true, requireInteraction: true, lang: 'ru', data: { keys, type: 'plan-notify', url: './#day-cal' } };
    try { const reg = await navigator.serviceWorker.getRegistration(); if (reg && reg.showNotification) { await reg.showNotification(title, Object.assign({ actions: [{ action: 'taken', title: 'Сделано' }] }, opts)); return true; } } catch (e) {}
    try { const n = new Notification(title, opts); n.onclick = () => { try { window.focus(); } catch (e) {} wkOpenToday(); n.close(); }; return true; } catch (e) { return false; }
}
function wkOpenToday() { const p = almatyParts(); wkCal = { y: p.y, mo: p.mo }; wkSel = todayKey(); showTab('day-cal'); }
function wkMarkKeys(keys) {
    let n = 0;
    (keys || []).forEach(k => { const [id, day, time] = String(k).split('|'); const t = wkById(id); if (t && t.kind === 'task' && day && time && !wkIsDone(t, day, time)) { wkSetDone(t, day, time, true); n++; } });
    if (n) { saveDayPlan(); renderDayPlan(); }
    return n;
}
let wkTickMin = '';
function wkTick() {
    const today = todayKey(), now = fmtTime(Date.now());
    if (now === wkTickMin) return; wkTickMin = now;
    let sent = LS.get('dp_sent', null);
    if (!sent || sent.day !== today || !Array.isArray(sent.keys)) sent = { day: today, keys: [] };
    const due = wkItemsOn(today).filter(d => !d.done && d.time !== '*' && d.task.notify !== false && d.time <= now && wkMin(now) - wkMin(d.time) <= WK_NOTIFY_WINDOW && !sent.keys.includes(d.key));
    if (due.length) {
        due.forEach(d => sent.keys.push(d.key)); LS.set('dp_sent', sent);
        const byTime = new Map(); due.forEach(d => { if (!byTime.has(d.time)) byTime.set(d.time, []); byTime.get(d.time).push(d); });
        byTime.forEach((arr, t) => {
            const keys = arr.map(d => d.key);
            if (wkNotifyOn()) wkShowNotification('Дела · ' + t, arr.map(d => '• ' + d.task.text).join('\n'), 'ilife-plan-' + today + '-' + t, keys);
            if (document.visibilityState === 'visible') toast(t + ' — ' + arr.map(d => d.task.text).join(', '), { action: 'Сделано', ms: 12000, onAction: () => { if (wkMarkKeys(keys)) toast('Отмечено: сделано'); } });
        });
    }
    const a = (document.querySelector('.tab.is-active') || {}).id;
    if (a === 'day-plan') renderWkNow(); else if (a === 'day-cal') renderWkCal();
}
async function wkExportIcs() {
    const today = todayKey(), stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
    const BY = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'];
    const L = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//iLife//Moy-den//RU', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'X-WR-CALNAME:iLife — мой день'];
    let n = 0;
    wkList('task').forEach(t => {
        if (!(t.times || []).length || wkTaskState(t) === 'past') return;
        let start = t.mode === 'once' ? t.date : (t.from > today ? t.from : today);
        if (t.mode !== 'once') { for (let i = 0; i < 400 && !wkTaskOn(t, start); i++) start = medDayAdd(start, 1); if (!wkTaskOn(t, start)) return; }
        const rule = t.mode === 'once' ? '' : (t.mode === 'week' ? 'FREQ=WEEKLY;BYDAY=' + (t.wd || []).slice().sort().map(i => BY[i]).join(',') : 'FREQ=DAILY;INTERVAL=' + (t.mode === 'every' ? 2 : 1)) + (t.to ? ';UNTIL=' + t.to.replace(/-/g, '') + 'T235959' : '');
        t.times.forEach(tm => {
            L.push('BEGIN:VEVENT', 'UID:' + t.id + '-' + tm.replace(':', '') + '@ilife', 'DTSTAMP:' + stamp, 'DTSTART:' + start.replace(/-/g, '') + 'T' + tm.replace(':', '') + '00', 'DURATION:PT15M');
            if (rule) L.push('RRULE:' + rule);
            L.push('SUMMARY:' + medIcsEsc(t.text), 'DESCRIPTION:' + medIcsEsc((t.note ? t.note + '\n' : '') + 'Из iLife: Мой день'), 'BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:' + medIcsEsc(t.text), 'TRIGGER:PT0M', 'END:VALARM', 'END:VEVENT');
            n++;
        });
    });
    L.push('END:VCALENDAR');
    if (!n) { toast('Нет предстоящих дел со временем'); return; }
    const res = await deliverFile(new Blob([L.map(medIcsFold).join('\r\n') + '\r\n'], { type: 'text/calendar' }), 'iLife_мой_день_' + today + '.ics');
    toast(res === 'unsupported' ? 'В этом приложении сохранить файл нельзя — откройте iLife в браузере' : 'Откройте файл — календарь телефона добавит ' + medFmtN(n, 'напоминание', 'напоминания', 'напоминаний'), { ms: 6000 });
}

// ---------- Отрисовка и запуск ----------
function renderDayPlan() {
    wkMigrate();
    const a = (document.querySelector('.tab.is-active') || {}).id;
    if (a === 'day-plan') { renderWkNow(); renderWkTasks(); renderWkRates(); renderWkHours(); renderWkNotify(); }
    if (a === 'day-cal') { renderWkCal(); renderWkDay(); }
}
function dayTabOpened() { renderDayPlan(); }
function initDayPlan() {
    if (!$('#day-plan')) return;
    wkMigrate();
    $('#wk-task-new').addEventListener('click', () => wkTaskSheet(null, { date: todayKey() }));
    $('#wk-rate-new').addEventListener('click', () => wkRateSheet(null));
    $('#wk-tasks').addEventListener('click', e => {
        const row = e.target.closest('.med-plan'); if (!row) return; const t = wkById(row.dataset.id); if (!t) return;
        if (e.target.closest('[data-bell]')) { t.notify = t.notify === false; saveDayPlan(); renderDayPlan(); if (t.notify && !wkNotifyOn()) wkNotifyAsk(); }
        else wkTaskSheet(t);
    });
    $('#wk-rates').addEventListener('click', e => { if (e.target.closest('#wk-rate-add')) { wkRateSheet(null); return; } const r = e.target.closest('.wk-rate'); if (r) wkRateSheet(wkById(r.dataset.id)); });
    const cfgSave = patch => { let c = wkById('wcfg'); if (!c) { c = { id: 'wcfg', kind: 'cfg', start: '09:00', end: '18:00', wd: [0, 1, 2, 3, 4] }; dayplan.push(c); } Object.assign(c, patch); saveDayPlan(); renderWkHours(); };
    $('#wk-def-start').addEventListener('change', e => cfgSave({ start: e.target.value }));
    $('#wk-def-end').addEventListener('change', e => cfgSave({ end: e.target.value }));
    $('#wk-def-wd').addEventListener('click', e => { const b = e.target.closest('[data-wd]'); if (!b) return; const s = new Set(wkCfg().wd || []), i = +b.dataset.wd; if (s.has(i)) s.delete(i); else s.add(i); cfgSave({ wd: Array.from(s).sort() }); });
    $('#wk-notify').addEventListener('change', async e => { if (e.target.checked) { if (!(await wkNotifyAsk())) e.target.checked = false; } else { LS.set('dp_notify', false); toast('Напоминания о делах выключены на этом устройстве'); renderWkNotify(); } });
    $('#wk-ics').addEventListener('click', wkExportIcs);
    // календарь
    $('#wk-cal-prev').addEventListener('click', () => { wkCal = wkCal.mo ? { y: wkCal.y, mo: wkCal.mo - 1 } : { y: wkCal.y - 1, mo: 11 }; renderWkCal(); });
    $('#wk-cal-next').addEventListener('click', () => { wkCal = wkCal.mo < 11 ? { y: wkCal.y, mo: wkCal.mo + 1 } : { y: wkCal.y + 1, mo: 0 }; renderWkCal(); });
    $('#wk-cal-today').addEventListener('click', () => { const p = almatyParts(); wkCal = { y: p.y, mo: p.mo }; wkSel = todayKey(); renderWkCal(); renderWkDay(); });
    $('#wk-cal').addEventListener('click', e => { const b = e.target.closest('[data-k]'); if (!b) return; wkSel = b.dataset.k; renderWkCal(); renderWkDay(); });
    $('#wk-pdf').addEventListener('click', wkPdfSheet);
    const day = $('#wk-day');
    const redraw = () => { renderWkCal(); renderWkDay(); };
    day.addEventListener('click', e => {
        const t = e.target;
        const dn = t.closest('[data-done]');
        if (dn) { const [id, k, tm] = dn.dataset.done.split('|'); const task = wkById(id); if (!task) return; if (k > todayKey() && !wkIsDone(task, k, tm)) { toast('Этот день ещё не наступил'); return; } wkSetDone(task, k, tm, !wkIsDone(task, k, tm)); saveDayPlan(); redraw(); return; }
        const tk = t.closest('[data-task]'); if (tk) { wkTaskSheet(wkById(tk.dataset.task)); return; }
        if (t.closest('#wk-d-addtask')) { wkTaskSheet(null, { date: wkSel }); return; }
        if (t.closest('#wk-d-rate')) { wkRateSheet(null); return; }
        if (t.closest('#wk-d-off')) { const w = wkWorkTime(wkSel); wkSetDay(wkSel, { off: !w.off }); redraw(); return; }
        if (t.closest('#wk-d-reset')) { wkSetDay(wkSel, null); redraw(); return; }
        if (t.closest('#wk-l-hours')) { const w = wkWorkTime(wkSel); if (w.off) { toast('День отмечен выходным'); return; } $('#wk-l-qty').value = String(Math.round(w.hours * 100) / 100); return; }
        if (t.closest('#wk-l-add')) {
            const r = wkById($('#wk-l-rate').value), qty = parseFloat(String($('#wk-l-qty').value).replace(',', '.'));
            if (!r) return; if (!(qty > 0)) { toast('Укажите, сколько сделали'); $('#wk-l-qty').focus(); return; }
            dayplan.push({ id: uid('wl'), kind: 'log', date: wkSel, rateId: r.id, name: r.name, per: r.per, unit: r.per === 'hour' ? 'ч' : r.unit, price: +r.price || 0, qty, note: $('#wk-l-note').value.trim(), createdAt: Date.now(), author: authorName() });
            LS.set('wk_last_rate', r.id); saveDayPlan(); redraw(); toast('Добавлено: ' + wkMoney(qty * (+r.price || 0)));
            return;
        }
        const dl = t.closest('[data-dellog]');
        if (dl) { const l = wkById(dl.closest('[data-id]').dataset.id); if (!l) return; dayplan = dayplan.filter(x => x !== l); saveDayPlan(); redraw(); toast('Запись убрана', { action: 'Вернуть', onAction: () => { dayplan.push(l); saveDayPlan(); redraw(); } }); }
    });
    day.addEventListener('change', e => {
        if (e.target.id === 'wk-d-start' || e.target.id === 'wk-d-end') { const s = $('#wk-d-start').value, en = $('#wk-d-end').value; if (s && en) { wkSetDay(wkSel, { start: s, end: en, off: false }); redraw(); } }
    });
    // уведомление: «Сделано» или открыть календарь
    try { if (navigator.serviceWorker) navigator.serviceWorker.addEventListener('message', e => { const m = e.data || {}; if (m.type !== 'plan-notify') return; if (m.taken) { if (wkMarkKeys(m.keys)) toast('Отмечено: сделано'); } else wkOpenToday(); }); } catch (e) {}
    try {
        const m = location.search.match(/[?&]plan=([^&]*)/);
        if (m) {
            const v = decodeURIComponent(m[1]);
            if (v.startsWith('taken:')) setTimeout(() => { if (wkMarkKeys(v.slice(6).split(',').filter(Boolean))) toast('Отмечено: сделано'); }, 600);
            const rest = location.search.replace(/([?&])plan=[^&]*&?/, '$1').replace(/[?&]$/, '');
            history.replaceState(null, '', location.pathname + rest + location.hash);
        }
    } catch (e) {}
    setInterval(wkTick, 20000);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') wkTick(); });
    setTimeout(wkTick, 1800);
}
