'use strict';
// =====================================================================================================
// iLife 2.7.0 — «ДЕЛА» → БЛОК «ПЛАН НА ДЕНЬ»: список дел на выбранный день, который составляется вручную.
//   • у дела — текст и время (необязательно), галочка «сделано», колокольчик «напомнить»;
//   • уведомления в назначенное время — как у лекарств (js/meds-schedule.js): пока iLife открыт или свёрнут,
//     через служебный воркер (sw.js) с кнопкой «Сделано»; надёжный способ при закрытом iLife — файл для календаря (.ics);
//   • «Лист в PDF» — страница A4 на день: квадратики для галочек, время, дела и пустые строки для записей от руки;
//   • «Перенести невыполненное на завтра».
// Данные — список dayplan (ключ ilife_dayplan), синхронизируется с Google Диском поштучно (js/gdrive.js → G_LISTS)
// и входит в резервную копию: { id, date:'ГГГГ-ММ-ДД', time:'ЧЧ:ММ'|'', text, done, doneAt, notify, createdAt, author }.
// =====================================================================================================

let dayplan = LS.get('dayplan', []);
if (!Array.isArray(dayplan)) dayplan = [];
let dpDay = todayKey();
let dpAsked = false;   // предложение включить напоминания — один раз за сеанс
const DP_NOTIFY_WINDOW = 120;   // минут: напоминаем, если время наступило не раньше чем два часа назад
const DP_QUICK = ['Зарядка', 'Прогулка', 'Позвонить маме', 'Почта', 'Купить продукты', 'Уборка'];

function saveDayPlan() { if (typeof cloudLocalChanged === 'function') cloudLocalChanged(); LS.set('dayplan', dayplan); }
function dpItems(day) {
    return dayplan.filter(i => i && i.date === day).sort((a, b) => (a.time || '99:99').localeCompare(b.time || '99:99') || (a.createdAt || 0) - (b.createdAt || 0));
}
function dpDayTitle(day) {
    const p = almatyParts(keyToMs(day)), t = todayKey();
    const rel = day === t ? 'Сегодня' : day === todayKey(1) ? 'Завтра' : day === todayKey(-1) ? 'Вчера' : capitalizeFirst(WEEKDAYS[p.wd]);
    return { main: p.d + ' ' + MONTHS_GEN[p.mo] + (p.y !== almatyParts().y ? ' ' + p.y : ''), sub: rel + (rel !== capitalizeFirst(WEEKDAYS[p.wd]) ? ', ' + WEEKDAYS[p.wd] : '') };
}
function dpNotifyOn() { return typeof Notification !== 'undefined' && Notification.permission === 'granted' && LS.get('dp_notify', true) !== false; }

function renderDayPlan() {
    const host = $('#dp-list'); if (!host) return;
    const t = dpDayTitle(dpDay);
    $('#dp-title').innerHTML = esc(t.main) + '<small>' + esc(t.sub) + '</small>';
    const items = dpItems(dpDay), now = fmtTime(Date.now()), today = todayKey();
    const done = items.filter(i => i.done).length;
    $('#dp-badge').textContent = items.length ? done + ' из ' + items.length : '';
    host.innerHTML = items.length ? items.map(i => {
        const late = !i.done && i.time && (dpDay < today || (dpDay === today && i.time < now));
        return '<li class="dp-item' + (i.done ? ' is-done' : '') + (late ? ' is-late' : '') + '" data-id="' + esc(i.id) + '">' +
            '<input type="checkbox" class="dp-check" data-done' + (i.done ? ' checked' : '') + ' aria-label="Сделано: ' + esc(i.text) + '">' +
            '<button type="button" class="dp-time linkbtn' + (i.time ? '' : ' is-empty') + '" data-time title="Изменить время">' + esc(i.time || '—:—') + '</button>' +
            '<span class="dp-txt">' + esc(i.text) + '</span>' +
            (i.time ? '<button type="button" class="icon-btn' + (i.notify === false ? ' is-off' : '') + '" data-bell aria-label="Напоминание" title="' + (i.notify === false ? 'Напоминание выключено' : 'Напомнить в ' + esc(i.time)) + '">' + ic(i.notify === false ? 'notifications_off' : 'notifications') + '</button>' : '') +
            '<button type="button" class="icon-btn is-danger" data-del aria-label="Удалить">' + ic('close') + '</button></li>';
    }).join('') : '<li class="hint dp-empty">На этот день дел нет. Впишите дело и (по желанию) время — в это время придёт напоминание.</li>';
    const used = new Set(items.map(i => normText(i.text)));
    $('#dp-quick').innerHTML = DP_QUICK.filter(q => !used.has(normText(q))).map(q => '<button type="button" class="chip" data-q="' + esc(q) + '">' + ic('add') + esc(q) + '</button>').join('');
    const sup = typeof Notification !== 'undefined', perm = sup ? Notification.permission : 'none';
    $('#dp-notify').checked = dpNotifyOn(); $('#dp-notify').disabled = !sup;
    $('#dp-notify-state').textContent = !sup ? 'В этом браузере уведомлений нет — используйте «В календарь телефона».' :
        perm === 'denied' ? 'Уведомления запрещены в настройках браузера для этого сайта.' :
        dpNotifyOn() ? 'Напоминание приходит в время дела, пока iLife открыт или свёрнут. При закрытом — через календарь телефона.' : 'Включите, чтобы iLife напоминал о делах со временем.';
}
function dpAdd(text, time) {
    text = String(text || '').trim(); if (!text) { toast('Впишите, что сделать'); return false; }
    dayplan.push({ id: uid('dp'), date: dpDay, time: time || '', text: text.slice(0, 200), done: false, notify: true, createdAt: Date.now(), author: authorName() });
    saveDayPlan(); renderDayPlan();
    if (time && !dpAsked && !dpNotifyOn() && typeof Notification !== 'undefined' && Notification.permission === 'default' && (dpAsked = true)) toast('Включить напоминания о делах?', { action: 'Включить', ms: 7000, onAction: dpNotifyAsk });
    return true;
}
async function dpNotifyAsk() {
    if (typeof Notification === 'undefined') { toast('В этом браузере уведомлений нет'); return false; }
    if (Notification.permission === 'denied') { toast('Уведомления запрещены в настройках браузера для этого сайта', { action: 'Инструкция', onAction: () => openInstruction('instr-med-notify') }); return false; }
    let res = Notification.permission;
    if (res !== 'granted') { try { res = await Notification.requestPermission(); } catch (e) { res = 'denied'; } }
    if (res === 'granted') { LS.set('dp_notify', true); toast('Напоминания о делах включены'); } else toast('Без разрешения уведомлений не будет');
    renderDayPlan();
    return res === 'granted';
}
function dpEditTime(item) {
    const node = document.createElement('div'); node.className = 'med-form';
    node.innerHTML = '<label class="field-label" for="dpe-time">Время</label><input type="time" id="dpe-time" value="' + esc(item.time || '') + '">' +
        '<label class="field-label" for="dpe-text">Дело</label><input type="text" id="dpe-text" maxlength="200" value="' + esc(item.text) + '">' +
        '<label class="field-label" for="dpe-date">День</label><input type="date" id="dpe-date" value="' + esc(item.date) + '">';
    openSheet({
        title: 'Дело', node,
        actions: [{ label: 'Отмена', value: false }, {
            label: 'Сохранить', kind: 'primary', icon: 'check', onClick: () => {
                const text = $('#dpe-text', node).value.trim(); if (!text) { toast('Впишите дело'); return false; }
                item.time = $('#dpe-time', node).value || ''; item.text = text; item.date = $('#dpe-date', node).value || item.date;
                saveDayPlan(); renderDayPlan();
            }
        }]
    });
}
function dpCarryOver() {
    const left = dpItems(dpDay).filter(i => !i.done);
    if (!left.length) { toast('Невыполненных дел нет'); return; }
    const next = dayKey(keyToMs(dpDay) + 86400000);
    left.forEach(i => dayplan.push({ id: uid('dp'), date: next, time: i.time, text: i.text, done: false, notify: i.notify !== false, createdAt: Date.now(), author: authorName() }));
    saveDayPlan();
    toast('Перенесено на ' + dpDayTitle(next).main + ': ' + left.length, { action: 'Открыть', onAction: () => { dpDay = next; renderDayPlan(); } });
}

// ---------- Уведомления (как у лекарств) ----------
async function dpShowNotification(title, body, tag, keys) {
    const opts = { body, tag, icon: 'images/icon-192.png', badge: 'images/favicon-48.png', renotify: true, requireInteraction: true, lang: 'ru', data: { keys, type: 'plan-notify', url: './#todo' } };
    try {
        const reg = await navigator.serviceWorker.getRegistration();
        if (reg && reg.showNotification) { await reg.showNotification(title, Object.assign({ actions: [{ action: 'taken', title: 'Сделано' }] }, opts)); return true; }
    } catch (e) {}
    try { const n = new Notification(title, opts); n.onclick = () => { try { window.focus(); } catch (e) {} dpDay = todayKey(); showTab('todo'); n.close(); }; return true; } catch (e) { return false; }
}
function dpMarkKeys(keys) {
    let n = 0;
    (keys || []).forEach(id => { const i = dayplan.find(x => x.id === id); if (i && !i.done) { i.done = true; i.doneAt = Date.now(); n++; } });
    if (n) { saveDayPlan(); renderDayPlan(); }
    return n;
}
let dpTickMin = '';
function dpTick() {
    const today = todayKey(), now = fmtTime(Date.now());
    if (now === dpTickMin) return; dpTickMin = now;
    let sent = LS.get('dp_sent', null);
    if (!sent || sent.day !== today) sent = { day: today, ids: [] };
    const min = t => { const m = String(t).match(/^(\d{1,2}):(\d{2})$/); return m ? +m[1] * 60 + +m[2] : 0; };
    const due = dpItems(today).filter(i => !i.done && i.time && i.notify !== false && i.time <= now && min(now) - min(i.time) <= DP_NOTIFY_WINDOW && !sent.ids.includes(i.id));
    if (due.length) {
        due.forEach(i => sent.ids.push(i.id)); LS.set('dp_sent', sent);
        const byTime = new Map(); due.forEach(i => { if (!byTime.has(i.time)) byTime.set(i.time, []); byTime.get(i.time).push(i); });
        byTime.forEach((arr, t) => {
            const ids = arr.map(i => i.id);
            if (dpNotifyOn()) dpShowNotification('Дела · ' + t, arr.map(i => '• ' + i.text).join('\n'), 'ilife-plan-' + today + '-' + t, ids);
            if (document.visibilityState === 'visible') toast(t + ' — ' + arr.map(i => i.text).join(', '), { action: 'Сделано', ms: 12000, onAction: () => { if (dpMarkKeys(ids)) toast('Отмечено: сделано'); } });
        });
    }
    if ($('#todo') && $('#todo').classList.contains('is-active')) renderDayPlan();   // раз в минуту обновляем просроченные
}

// ---------- Календарь телефона (.ics) ----------
async function dpExportIcs() {
    const items = dpItems(dpDay).filter(i => i.time && !i.done);
    if (!items.length) { toast('На этот день нет невыполненных дел со временем'); return; }
    const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
    const L = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//iLife//Dela//RU', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'X-WR-CALNAME:iLife — дела'];
    items.forEach(i => L.push('BEGIN:VEVENT', 'UID:' + i.id + '@ilife', 'DTSTAMP:' + stamp, 'DTSTART:' + i.date.replace(/-/g, '') + 'T' + i.time.replace(':', '') + '00', 'DURATION:PT15M',
        'SUMMARY:' + medIcsEsc(i.text), 'DESCRIPTION:' + medIcsEsc('Из iLife: Заметки → Дела → План на день'), 'BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:' + medIcsEsc(i.text), 'TRIGGER:PT0M', 'END:VALARM', 'END:VEVENT'));
    L.push('END:VCALENDAR');
    const blob = new Blob([L.map(medIcsFold).join('\r\n') + '\r\n'], { type: 'text/calendar' });
    const res = await deliverFile(blob, 'iLife_дела_' + dpDay + '.ics');
    toast(res === 'unsupported' ? 'В этом приложении сохранить файл нельзя — откройте iLife в браузере' : 'Откройте файл — календарь телефона добавит ' + items.length + ' напоминаний', { ms: 6000 });
}

// ---------- PDF: лист дел на день ----------
async function exportDayPlanPdf() {
    const items = dpItems(dpDay), t = dpDayTitle(dpDay), p = almatyParts(keyToMs(dpDay));
    try {
        const accent = pdfAccent();
        const pdf = new PdfWriter({ title: 'iLife — План на день', footer: 'iLife · Дела · ' + authorName() });
        pdfHeader(pdf, 'План на день', p.d + ' ' + MONTHS_GEN[p.mo] + ' ' + p.y + ', ' + WEEKDAYS[p.wd] + '  ·  дел: ' + items.length + (items.length ? ', сделано: ' + items.filter(i => i.done).length : ''), accent);
        const rowH = 28, x0 = pdf.mx, tx = x0 + 74;
        const row = (it) => {
            pdf.ensure(rowH);
            const y = pdf.y;
            pdf.box(x0 + 2, y + 6, 14, it && it.done ? accent : '#79747e', !!(it && it.done));
            if (it && it.time) pdf.textAt(it.time, x0 + 26, y + 18, 11, { bold: true, color: accent });
            if (it) {
                const lines = pdf.wrap(it.text, 11.5, false, pdf.W - pdf.mx - tx);
                lines.forEach((l, k) => pdf.textAt(l, tx, y + 18 + k * 15, 11.5, { color: it.done ? '#79747e' : '#1d1b20', strike: it.done }));
                pdf.y += Math.max(rowH, 10 + lines.length * 15);
            } else pdf.y += rowH;
            pdf.line(tx, pdf.y - 4, pdf.W - pdf.mx, pdf.y - 4, '#d8d4dc', 0.5);
        };
        items.forEach(row);
        const free = Math.max(6, Math.min(18, Math.floor((pdf.H - pdf.mb - pdf.y) / rowH) - 3));
        if (items.length) pdf.gap(6);
        for (let k = 0; k < free; k++) row(null);   // пустые строки — дописать от руки
        pdf.gap(10);
        pdf.para('Заметки на день', { size: 9, color: '#79747e' });
        for (let k = 0; k < 3 && pdf.y < pdf.H - pdf.mb - 20; k++) { pdf.gap(20); pdf.line(x0, pdf.y, pdf.W - pdf.mx, pdf.y, '#d8d4dc', 0.5); }
        await finishPdf(pdf, 'План_на_день_' + dpDay);
    } catch (e) { console.error(e); toast('Не удалось собрать PDF'); }
}

function initDayPlan() {
    if (!$('#dayplan-card')) return;
    const add = () => { if (dpAdd($('#dp-text').value, $('#dp-time').value)) { $('#dp-text').value = ''; $('#dp-time').value = ''; $('#dp-text').focus(); } };
    $('#dp-add').addEventListener('click', add);
    $('#dp-text').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); add(); } });
    $('#dp-prev').addEventListener('click', () => { dpDay = dayKey(keyToMs(dpDay) - 86400000); renderDayPlan(); });
    $('#dp-next').addEventListener('click', () => { dpDay = dayKey(keyToMs(dpDay) + 86400000); renderDayPlan(); });
    $('#dp-today').addEventListener('click', () => { dpDay = todayKey(); renderDayPlan(); });
    $('#dp-quick').addEventListener('click', e => { const b = e.target.closest('[data-q]'); if (b) dpAdd(b.dataset.q, $('#dp-time').value); });
    $('#dp-list').addEventListener('click', e => {
        const li = e.target.closest('.dp-item'); if (!li) return;
        const it = dayplan.find(x => x.id === li.dataset.id); if (!it) return;
        if (e.target.closest('[data-del]')) { dayplan = dayplan.filter(x => x !== it); saveDayPlan(); renderDayPlan(); toast('Дело удалено', { action: 'Вернуть', onAction: () => { dayplan.push(it); saveDayPlan(); renderDayPlan(); } }); }
        else if (e.target.closest('[data-bell]')) { it.notify = it.notify === false; saveDayPlan(); renderDayPlan(); if (it.notify && !dpNotifyOn()) dpNotifyAsk(); }
        else if (e.target.closest('[data-time]')) dpEditTime(it);
    });
    $('#dp-list').addEventListener('change', e => {
        const c = e.target.closest('[data-done]'); if (!c) return;
        const it = dayplan.find(x => x.id === c.closest('.dp-item').dataset.id); if (!it) return;
        it.done = c.checked; it.doneAt = c.checked ? Date.now() : 0; saveDayPlan(); renderDayPlan();
    });
    $('#dp-notify').addEventListener('change', async e => {
        if (e.target.checked) { if (!(await dpNotifyAsk())) e.target.checked = false; }
        else { LS.set('dp_notify', false); toast('Напоминания о делах выключены на этом устройстве'); renderDayPlan(); }
    });
    $('#dp-pdf').addEventListener('click', exportDayPlanPdf);
    $('#dp-ics').addEventListener('click', dpExportIcs);
    $('#dp-copy').addEventListener('click', dpCarryOver);
    // нажатие на уведомление: «Сделано» или открыть «Дела»
    try {
        if (navigator.serviceWorker) navigator.serviceWorker.addEventListener('message', e => {
            const m = e.data || {}; if (m.type !== 'plan-notify') return;
            if (m.taken) { if (dpMarkKeys(m.keys)) toast('Отмечено: сделано'); } else { dpDay = todayKey(); showTab('todo'); }
        });
    } catch (e) {}
    try {
        const m = location.search.match(/[?&]plan=([^&]*)/);
        if (m) {
            const v = decodeURIComponent(m[1]);
            if (v.startsWith('taken:')) setTimeout(() => { if (dpMarkKeys(v.slice(6).split(',').filter(Boolean))) toast('Отмечено: сделано'); }, 600);
            const rest = location.search.replace(/([?&])plan=[^&]*&?/, '$1').replace(/[?&]$/, '');
            history.replaceState(null, '', location.pathname + rest + location.hash);
        }
    } catch (e) {}
    setInterval(dpTick, 20000);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') dpTick(); });
    setTimeout(dpTick, 1800);
    renderDayPlan();
}
