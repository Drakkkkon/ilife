'use strict';
// =====================================================================================================
// iLife 2.2.0 — РАЗДЕЛ «ЛЕКАРСТВА» (часть 2): страница «График приёма».
//   • календарь на месяц с отметками по дням (всё принято / принято частично / пропущено / запланировано);
//   • список приёмов выбранного дня: время, лекарство, доза, галочка «принято»;
//   • «Мои лекарства» — приёмы (записи kind:'plan' из общей базы meds, см. js/meds.js);
//   • уведомления «пора принять» — пока iLife открыт или свёрнут (браузер не будит закрытый сайт без сервера),
//     поэтому есть и файл для календаря телефона (.ics): календарь напомнит сам, даже когда iLife закрыт;
//   • вывод списком в PDF (график по дням и сводка лекарств), а также PDF назначений врача.
// День считается по времени Алматы, как во всём приложении (core.js → todayKey, fmtTime).
// =====================================================================================================

const MED_WD = ['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс'];
const MED_QUICK = [{ n: 'Утро', t: '08:00' }, { n: 'День', t: '14:00' }, { n: 'Вечер', t: '20:00' }, { n: 'На ночь', t: '22:00' }];
const MED_NOTIFY_WINDOW = 120;   // минут: напоминаем о приёме, если его время наступило не раньше чем два часа назад

let medCal = (function () { const p = almatyParts(); return { y: p.y, mo: p.mo }; })();
let medSel = todayKey();

// ---------- Даты ----------
function medDaysBetween(a, b) { return Math.round((keyToMs(b) - keyToMs(a)) / 86400000); }
function medDayAdd(key, n) { return dayKey(keyToMs(key) + n * 86400000); }
function medWd(key) { return (almatyParts(keyToMs(key)).wd + 6) % 7; }   // 0 = понедельник
function medMin(t) { const m = String(t).match(/^(\d{1,2}):(\d{2})$/); return m ? +m[1] * 60 + +m[2] : 0; }
function medDayFull(key) { const p = almatyParts(keyToMs(key)); return p.d + ' ' + MONTHS_GEN[p.mo] + ' ' + p.y + ', ' + WEEKDAYS[p.wd]; }
function medMonthKeys(y, mo) { const n = new Date(Date.UTC(y, mo + 1, 0)).getUTCDate(); const out = []; for (let d = 1; d <= n; d++) out.push(y + '-' + pad2(mo + 1) + '-' + pad2(d)); return out; }
function medMonthTitle(y, mo) { return capitalizeFirst(MONTHS_NOM[mo]) + ' ' + y; }

// ---------- Приёмы ----------
function medPlanActiveOn(p, key) {
    if (!p.from || key < p.from) return false;
    if (p.to && key > p.to) return false;
    if (p.mode === 'every') return medDaysBetween(p.from, key) % Math.max(2, +p.every || 2) === 0;
    if (p.mode === 'week') return (p.wd || []).includes(medWd(key));
    return true;
}
function medIsTaken(p, key, time) { return !!(p.taken && p.taken[key] && p.taken[key].includes(time)); }
function medSetTaken(p, key, time, on) {
    p.taken = p.taken || {};
    const arr = (p.taken[key] || []).filter(t => t !== time);
    if (on) arr.push(time);
    if (arr.length) p.taken[key] = arr.sort(); else delete p.taken[key];
}
// Все приёмы дня по времени: [{ plan, time, taken, key }]
function medDosesOn(key) {
    const out = [];
    medList('plan').forEach(p => { if (medPlanActiveOn(p, key)) (p.times || []).forEach(t => out.push({ plan: p, time: t, taken: medIsTaken(p, key, t), key: p.id + '|' + key + '|' + t })); });
    return out.sort((a, b) => a.time.localeCompare(b.time) || String(a.plan.drug).localeCompare(String(b.plan.drug), 'ru'));
}
// Состояние дня для календаря: '' | done | part | miss | plan
function medDayState(key, doses) {
    doses = doses || medDosesOn(key);
    const total = doses.length, done = doses.filter(d => d.taken).length;
    if (!total) return { s: '', total, done };
    if (done === total) return { s: 'done', total, done };
    const today = todayKey();
    if (key < today) return { s: done ? 'part' : 'miss', total, done };
    if (key === today) { const now = fmtTime(Date.now()); return { s: doses.some(d => !d.taken && d.time < now) || done ? 'part' : 'plan', total, done }; }
    return { s: 'plan', total, done };
}
function medPlanModeText(p) {
    if (p.mode === 'every') { const n = Math.max(2, +p.every || 2); return n === 2 ? 'через день' : 'раз в ' + n + ' ' + (n < 5 ? 'дня' : 'дней'); }
    if (p.mode === 'week') return 'по ' + (p.wd || []).slice().sort().map(i => MED_WD[i]).join(', ');
    return 'каждый день';
}
function medPlanPeriodText(p) { return 'с ' + fmtDayKey(p.from, true) + (p.to ? ' по ' + fmtDayKey(p.to, true) : ', без срока') + ' · ' + medPlanModeText(p); }
function medPlanState(p) { const t = todayKey(); return p.to && p.to < t ? 'past' : p.from > t ? 'future' : 'now'; }
// «2 раза в день», «утром и вечером», «на ночь» → время приёма
function medGuessTimes(text) {
    const s = normText(text); const out = new Set();
    if (/утр/.test(s)) out.add('08:00');
    if (/обед|днем/.test(s)) out.add('14:00');
    if (/вечер/.test(s)) out.add('20:00');
    if (/ноч|перед сном/.test(s)) out.add('22:00');
    if (!out.size) {
        const m = s.match(/(\d)\s*(?:раза?|р\.?)\s*(?:в|\/)\s*(?:день|сутки|д)/);
        const n = m ? +m[1] : /дважды/.test(s) ? 2 : /трижды/.test(s) ? 3 : 0;
        ({ 1: ['08:00'], 2: ['08:00', '20:00'], 3: ['08:00', '14:00', '20:00'], 4: ['08:00', '12:00', '16:00', '20:00'] }[n] || []).forEach(t => out.add(t));
    }
    return Array.from(out).sort();
}

// ---------- Форма приёма ----------
function medPlanFormSheet(plan, preset) {
    const isNew = !plan; preset = preset || {};
    const from0 = preset.from || medSel || todayKey();
    const p = plan || { drug: preset.drug || '', dose: preset.dose || '', note: preset.note || '', times: medGuessTimes(preset.note || ''), from: from0, to: preset.days ? medDayAdd(from0, Math.max(1, +preset.days) - 1) : '', mode: 'daily', every: 2, wd: [0, 1, 2, 3, 4, 5, 6], notify: true };
    let times = (p.times || []).slice(); if (!times.length) times = ['08:00'];
    let mode = p.mode || 'daily'; let wd = new Set(p.wd && p.wd.length ? p.wd : [0, 1, 2, 3, 4, 5, 6]);
    const node = document.createElement('div'); node.className = 'med-form';
    node.innerHTML =
        '<label class="field-label" for="mp-drug">Лекарство</label><input type="text" id="mp-drug" maxlength="80" list="mp-names" placeholder="Название" value="' + esc(p.drug) + '">' + medDatalist('mp-names', medDrugNames()) +
        '<div class="med-row2"><div><label class="field-label" for="mp-dose">Доза</label><input type="text" id="mp-dose" maxlength="60" placeholder="1 таблетка, 5 мл, 2 капли" value="' + esc(p.dose) + '"></div>' +
        '<div><label class="field-label" for="mp-note">Комментарий</label><input type="text" id="mp-note" maxlength="120" list="mp-notes" placeholder="После еды, запить водой" value="' + esc(p.note) + '">' + medDatalist('mp-notes', ['До еды', 'Во время еды', 'После еды', 'Натощак', 'Перед сном', 'Запить водой']) + '</div></div>' +
        '<label class="field-label">Время приёма</label><div id="mp-times" class="med-times"></div>' +
        '<div class="chips" id="mp-quick" style="margin-top:0.5rem">' + MED_QUICK.map(q => '<button type="button" class="chip" data-t="' + q.t + '">' + q.n + ' ' + q.t + '</button>').join('') + '<button type="button" class="chip" data-t="">' + ic('add') + 'Своё время</button></div>' +
        '<div class="med-row3"><div><label class="field-label" for="mp-from">Начало</label><input type="date" id="mp-from" value="' + esc(p.from) + '"></div>' +
        '<div><label class="field-label" for="mp-to">Окончание</label><input type="date" id="mp-to" value="' + esc(p.to || '') + '"></div>' +
        '<div><label class="field-label" for="mp-days">Курс, дней</label><input type="number" id="mp-days" min="1" max="999" inputmode="numeric" placeholder="без срока"></div></div>' +
        '<label class="field-label">Дни приёма</label><div class="seg" id="mp-mode" role="group" aria-label="Дни приёма"><button type="button" data-m="daily">Каждый день</button><button type="button" data-m="every">Через день</button><button type="button" data-m="week">По дням недели</button></div>' +
        '<div class="chips med-wd" id="mp-wd" style="margin-top:0.5rem">' + MED_WD.map((n, i) => '<button type="button" class="chip" data-wd="' + i + '">' + n + '</button>').join('') + '</div>' +
        '<label class="opt-row" style="margin-top:0.5rem"><span style="flex:1"><b>Напоминать</b><span class="sub">уведомление в назначенное время</span></span><input type="checkbox" class="switch" id="mp-notify"' + (p.notify !== false ? ' checked' : '') + '></label>';
    const tBox = $('#mp-times', node), fromI = $('#mp-from', node), toI = $('#mp-to', node), daysI = $('#mp-days', node);
    const pullTimes = () => { times = $$('input[type="time"]', tBox).map(i => i.value); };
    const drawTimes = () => {
        tBox.innerHTML = times.map((t, i) => '<span class="med-time"><input type="time" value="' + esc(t) + '" aria-label="Время приёма ' + (i + 1) + '"><button type="button" class="icon-btn is-danger" data-rm="' + i + '" aria-label="Убрать время">' + ic('close') + '</button></span>').join('');
        $$('#mp-quick [data-t]', node).forEach(b => { if (b.dataset.t) b.classList.toggle('is-on', times.includes(b.dataset.t)); });
    };
    const syncDays = () => { daysI.value = fromI.value && toI.value && toI.value >= fromI.value ? String(medDaysBetween(fromI.value, toI.value) + 1) : ''; };
    const drawMode = () => { $$('#mp-mode button', node).forEach(b => b.classList.toggle('is-on', b.dataset.m === mode)); $('#mp-wd', node).hidden = mode !== 'week'; $$('#mp-wd [data-wd]', node).forEach(b => b.classList.toggle('is-on', wd.has(+b.dataset.wd))); };
    drawTimes(); syncDays(); drawMode();
    tBox.addEventListener('click', e => { const b = e.target.closest('[data-rm]'); if (!b) return; pullTimes(); times.splice(+b.dataset.rm, 1); drawTimes(); });
    tBox.addEventListener('change', () => { pullTimes(); $$('#mp-quick [data-t]', node).forEach(b => { if (b.dataset.t) b.classList.toggle('is-on', times.includes(b.dataset.t)); }); });
    $('#mp-quick', node).addEventListener('click', e => {
        const b = e.target.closest('[data-t]'); if (!b) return; pullTimes();
        const t = b.dataset.t;
        if (!t) { times.push('12:00'); drawTimes(); const all = $$('input[type="time"]', tBox); all[all.length - 1].focus(); return; }
        if (times.includes(t)) times = times.filter(x => x !== t); else times.push(t);
        times = times.filter(Boolean).sort(); drawTimes();
    });
    fromI.addEventListener('change', () => { if (daysI.value && fromI.value) toI.value = medDayAdd(fromI.value, Math.max(1, +daysI.value) - 1); else syncDays(); });
    toI.addEventListener('change', syncDays);
    daysI.addEventListener('input', () => { const n = parseInt(daysI.value, 10); if (!fromI.value) return; toI.value = n > 0 ? medDayAdd(fromI.value, Math.min(999, n) - 1) : ''; });
    $('#mp-mode', node).addEventListener('click', e => { const b = e.target.closest('[data-m]'); if (!b) return; mode = b.dataset.m; drawMode(); });
    $('#mp-wd', node).addEventListener('click', e => { const b = e.target.closest('[data-wd]'); if (!b) return; const i = +b.dataset.wd; if (wd.has(i)) wd.delete(i); else wd.add(i); drawMode(); });
    const actions = [{ label: 'Отмена', value: false }];
    if (!isNew) actions.unshift({ label: 'Удалить', kind: 'danger', icon: 'delete', onClick: () => { setTimeout(() => medPlanDelete(plan), 220); } });
    actions.push({
        label: isNew ? 'В график' : 'Сохранить', kind: 'primary', icon: 'check',
        onClick: () => {
            pullTimes();
            const drug = $('#mp-drug', node).value.trim();
            const ts = Array.from(new Set(times.filter(t => /^\d{2}:\d{2}$/.test(t)))).sort();
            if (!drug) { toast('Введите название лекарства'); $('#mp-drug', node).focus(); return false; }
            if (!ts.length) { toast('Укажите хотя бы одно время приёма'); return false; }
            if (!fromI.value) { toast('Укажите дату начала'); fromI.focus(); return false; }
            if (toI.value && toI.value < fromI.value) { toast('Окончание раньше начала'); toI.focus(); return false; }
            if (mode === 'week' && !wd.size) { toast('Выберите дни недели'); return false; }
            const rec = { drug, dose: $('#mp-dose', node).value.trim(), note: $('#mp-note', node).value.trim(), times: ts, from: fromI.value, to: toI.value || '', mode, every: 2, wd: Array.from(wd).sort(), notify: $('#mp-notify', node).checked };
            if (isNew) meds.push(Object.assign({ id: uid('mp'), kind: 'plan', taken: {}, orderId: preset.orderId || '', drugId: preset.drugId || '', createdAt: Date.now(), author: authorName() }, rec));
            else Object.assign(plan, rec);
            saveMeds(); medScheduleChanged();
            if (isNew && preset.orderId) { renderMedOrders(); toast('«' + drug + '» добавлено в график', { action: 'Открыть', onAction: () => showTab('med-schedule') }); }
            else toast(isNew ? '«' + drug + '» добавлено в график' : 'Сохранено');
            if (rec.notify && medNotifySupported() && Notification.permission === 'default') medNotifyAsk();
        }
    });
    openSheet({ title: isNew ? 'Новый приём' : 'Приём лекарства', node, actions });
}
async function medPlanDelete(plan) {
    if (!(await confirmSheet('Удалить из графика?', '«' + plan.drug + '» и все отметки о приёме будут удалены.', 'Удалить', true))) return;
    meds = meds.filter(m => m !== plan); saveMeds(); medScheduleChanged();
    if (typeof renderMedOrders === 'function') renderMedOrders();
    toast('Удалено из графика');
}

// ---------- Отрисовка ----------
function medScheduleChanged() { if ($('#med-schedule') && $('#med-schedule').classList.contains('is-active')) renderMedSchedule(); }
function renderMedSchedule() { renderMedNow(); renderMedCalendar(); renderMedDay(); renderMedPlans(); renderMedNotify(); }

function renderMedNow() {
    const host = $('#med-now'); if (!host) return;
    const today = todayKey(), now = fmtTime(Date.now());
    const doses = medDosesOn(today).filter(d => !d.taken);
    const late = doses.filter(d => d.time <= now), next = doses.filter(d => d.time > now);
    if (!late.length && !next.length) { host.innerHTML = ''; return; }
    const line = arr => { const t = arr[0].time; return '<b>' + t + '</b> — ' + arr.filter(d => d.time === t).map(d => esc(d.plan.drug) + (d.plan.dose ? ', ' + esc(d.plan.dose) : '')).join('; '); };
    host.innerHTML = late.length ?
        '<div class="med-now is-late">' + ic('alarm') + '<div><small>Пора принять' + (late.length > 1 ? ' · ' + late.length : '') + '</small><span>' + late.map(d => '<b>' + d.time + '</b> ' + esc(d.plan.drug)).join(', ') + '</span></div><button type="button" class="btn btn-primary" id="med-now-take">' + ic('check') + 'Принял</button></div>' :
        '<div class="med-now">' + ic('schedule') + '<div><small>Следующий приём сегодня</small><span>' + line(next) + '</span></div></div>';
    const b = $('#med-now-take'); if (b) b.addEventListener('click', () => { late.forEach(d => medSetTaken(d.plan, today, d.time, true)); saveMeds(); renderMedSchedule(); toast('Отмечено: принято'); });
}

function renderMedCalendar() {
    const host = $('#med-cal'); if (!host) return;
    const keys = medMonthKeys(medCal.y, medCal.mo), lead = medWd(keys[0]), today = todayKey();
    $('#med-cal-title').textContent = medMonthTitle(medCal.y, medCal.mo);
    let html = MED_WD.map(n => '<span class="med-cal-wd">' + n + '</span>').join('') + '<span class="med-cal-pad"></span>'.repeat(lead);
    html += keys.map(k => {
        const st = medDayState(k), d = +k.slice(8);
        const label = medDayFull(k) + (st.total ? ': принято ' + st.done + ' из ' + st.total : ': приёмов нет');
        return '<button type="button" class="med-day' + (st.s ? ' is-' + st.s : '') + (k === today ? ' is-today' : '') + (k === medSel ? ' is-sel' : '') + '" data-k="' + k + '" aria-label="' + esc(label) + '"' + (k === medSel ? ' aria-pressed="true"' : '') + '>' +
            '<span class="n">' + d + '</span><span class="m">' + (st.s === 'done' ? ic('check') : st.total ? st.done + '/' + st.total : '') + '</span></button>';
    }).join('');
    host.innerHTML = html;
}

function renderMedDay() {
    const host = $('#med-day'); if (!host) return;
    const doses = medDosesOn(medSel), today = todayKey(), now = fmtTime(Date.now());
    const done = doses.filter(d => d.taken).length;
    let html = '<div class="med-day-h"><h3>' + esc(medSel === today ? 'Сегодня · ' + medDayFull(medSel) : capitalizeFirst(medDayFull(medSel))) + '</h3>' +
        (doses.length ? '<span class="count">принято ' + done + ' из ' + doses.length + '</span>' : '') + '</div>';
    if (!doses.length) html += '<p class="hint med-day-empty">На этот день приёмов нет. Нажмите «Добавить», чтобы назначить лекарство с этого дня.</p>';
    else {
        html += '<div class="med-doses">' + doses.map(d => {
            const late = !d.taken && (medSel < today || (medSel === today && d.time <= now));
            return '<div class="med-dose' + (d.taken ? ' is-taken' : late ? ' is-late' : '') + '">' +
                '<button type="button" class="med-check" data-take="' + esc(d.plan.id) + '|' + d.time + '" role="checkbox" aria-checked="' + d.taken + '" aria-label="' + esc(d.time + ' ' + d.plan.drug + ': ' + (d.taken ? 'принято' : 'не принято')) + '">' + ic(d.taken ? 'check_circle' : 'radio_button_unchecked') + '</button>' +
                '<span class="med-dose-t">' + d.time + '</span>' +
                '<div class="med-dose-b"><b>' + esc(d.plan.drug) + '</b><span>' + esc([d.plan.dose, d.plan.note].filter(Boolean).join(' · ')) + (late ? (d.plan.dose || d.plan.note ? ' · ' : '') + '<em>не отмечено</em>' : '') + '</span></div>' +
                (d.plan.notify === false ? '<span class="med-mute" title="Без напоминания">' + ic('notifications_off') + '</span>' : '') +
                '<button type="button" class="icon-btn" data-plan="' + esc(d.plan.id) + '" aria-label="Изменить приём" title="Изменить">' + ic('edit') + '</button></div>';
        }).join('') + '</div>';
        if (medSel <= today && done < doses.length && doses.length > 1) html += '<button type="button" class="btn" id="med-day-all" style="margin-top:0.625rem">' + ic('done_all') + 'Отметить всё за день</button>';
    }
    host.innerHTML = html;
}

function renderMedPlans() {
    const host = $('#med-plans'); if (!host) return;
    const order = { now: 0, future: 1, past: 2 };
    const list = medList('plan').sort((a, b) => order[medPlanState(a)] - order[medPlanState(b)] || String(a.drug).localeCompare(String(b.drug), 'ru'));
    $('#med-plans-badge').textContent = list.length ? String(list.filter(p => medPlanState(p) !== 'past').length) : '';
    if (!list.length) { host.innerHTML = '<div class="empty" style="padding:1rem 1rem 1.25rem"><b>Лекарств в графике нет</b>Нажмите «Добавить» вверху страницы или кнопку «В график» в назначении врача.</div>'; return; }
    host.innerHTML = list.map(p => {
        const st = medPlanState(p);
        return '<div class="med-plan is-' + st + '" data-id="' + esc(p.id) + '"><span class="med-plan-ico">' + ic('medication') + '</span>' +
            '<div class="med-plan-b"><b>' + esc(p.drug) + (p.dose ? ' <span>' + esc(p.dose) + '</span>' : '') + '</b>' +
            '<div class="chips">' + (p.times || []).map(t => '<span class="chip">' + ic('schedule') + t + '</span>').join('') + (st === 'past' ? '<span class="chip">курс окончен</span>' : st === 'future' ? '<span class="chip is-ok">ещё не начат</span>' : '') + '</div>' +
            '<small>' + esc(medPlanPeriodText(p)) + (p.note ? ' · ' + esc(p.note) : '') + '</small></div>' +
            '<button type="button" class="icon-btn" data-bell aria-pressed="' + (p.notify !== false) + '" aria-label="Напоминание: ' + (p.notify !== false ? 'включено' : 'выключено') + '" title="Напоминание">' + ic(p.notify !== false ? 'notifications' : 'notifications_off') + '</button>' +
            '<button type="button" class="icon-btn" data-edit aria-label="Изменить" title="Изменить">' + ic('edit') + '</button></div>';
    }).join('');
}

// ---------- Уведомления ----------
function medNotifySupported() { return typeof Notification !== 'undefined'; }
function medNotifyOn() { return medNotifySupported() && Notification.permission === 'granted' && LS.get('med_notify', true) !== false; }
async function medNotifyAsk() {
    if (!medNotifySupported()) { toast('В этом браузере уведомления недоступны — добавьте график в календарь телефона', { ms: 5200 }); return false; }
    if (Notification.permission === 'denied') { toast('Уведомления запрещены в настройках браузера для этого сайта', { action: 'Инструкция', onAction: () => openInstruction('instr-med-notify') }); return false; }
    let res = Notification.permission;
    if (res !== 'granted') { try { res = await Notification.requestPermission(); } catch (e) { res = 'denied'; } }
    if (res === 'granted') { LS.set('med_notify', true); toast('Уведомления о приёме лекарств включены'); }
    else toast('Без разрешения уведомлений не будет');
    renderMedNotify();
    return res === 'granted';
}
function renderMedNotify() {
    const host = $('#med-notify'); if (!host) return;
    const sup = medNotifySupported(), perm = sup ? Notification.permission : 'none', on = medNotifyOn();
    $('#med-notify-badge').textContent = on ? 'Включены' : 'Выключены';
    const sw = $('#med-notify-switch'); sw.checked = on; sw.disabled = !sup;
    $('#med-notify-state').textContent = !sup ? 'В этом браузере уведомлений нет. Напоминания можно получить через календарь телефона — кнопка ниже.' :
        perm === 'denied' ? 'Уведомления запрещены в настройках браузера для этого сайта. Как разрешить — в инструкции.' :
        on ? 'Напоминание приходит в назначенное время, пока iLife открыт или свёрнут.' : 'Включите, чтобы iLife напоминал о приёме в назначенное время.';
}
async function medShowNotification(title, body, tag, keys) {
    const opts = { body, tag, icon: 'images/icon-192.png', badge: 'images/favicon-48.png', renotify: true, requireInteraction: true, lang: 'ru', data: { keys, url: './#med-schedule' } };
    try {
        const reg = await navigator.serviceWorker.getRegistration();
        if (reg && reg.showNotification) { await reg.showNotification(title, Object.assign({ actions: [{ action: 'taken', title: 'Принял' }] }, opts)); return true; }
    } catch (e) { /* без служебного воркера (или он ещё не готов) — обычное уведомление страницы */ }
    try { const n = new Notification(title, opts); n.onclick = () => { try { window.focus(); } catch (e) {} medOpenToday(); n.close(); }; return true; } catch (e) { return false; }
}
function medOpenToday() { const p = almatyParts(); medCal = { y: p.y, mo: p.mo }; medSel = todayKey(); showTab('med-schedule'); }
function medMarkKeys(keys) {
    let n = 0;
    (keys || []).forEach(k => { const [id, day, time] = String(k).split('|'); const p = medById(id); if (p && p.kind === 'plan' && day && time && !medIsTaken(p, day, time)) { medSetTaken(p, day, time, true); n++; } });
    if (n) { saveMeds(); medScheduleChanged(); }
    return n;
}
// Проверка «не пора ли»: раз в 20 секунд и при возвращении на вкладку
let medTickDay = '', medTickMin = '';
function medTick() {
    const today = todayKey(), now = fmtTime(Date.now());
    if (now === medTickMin && today === medTickDay) return;
    const dayChanged = medTickDay && medTickDay !== today;
    medTickMin = now; medTickDay = today;
    if (dayChanged && medSel === medDayAdd(today, -1)) medSel = today;
    let sent = LS.get('med_sent', null);
    if (!sent || sent.day !== today) sent = { day: today, keys: [] };
    const due = medDosesOn(today).filter(d => !d.taken && d.plan.notify !== false && d.time <= now && medMin(now) - medMin(d.time) <= MED_NOTIFY_WINDOW && !sent.keys.includes(d.key));
    if (due.length) {
        const byTime = new Map();
        due.forEach(d => { if (!byTime.has(d.time)) byTime.set(d.time, []); byTime.get(d.time).push(d); sent.keys.push(d.key); });
        LS.set('med_sent', sent);
        byTime.forEach((arr, t) => {
            const text = arr.map(d => d.plan.drug + (d.plan.dose ? ' — ' + d.plan.dose : '') + (d.plan.note ? ' (' + d.plan.note + ')' : '')).join('\n');
            const keys = arr.map(d => d.key);
            if (medNotifyOn()) medShowNotification('Пора принять лекарство · ' + t, text, 'ilife-med-' + today + '-' + t, keys);
            if (document.visibilityState === 'visible') toast(t + ' — пора принять: ' + arr.map(d => d.plan.drug).join(', '), { action: 'Принял', ms: 12000, onAction: () => { if (medMarkKeys(keys)) toast('Отмечено: принято'); } });
        });
    }
    medScheduleChanged();   // раз в минуту обновляем «пора принять» и отметки просроченного
}

// ---------- Файл для календаря телефона (.ics) ----------
function medIcsEsc(s) { return String(s || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n'); }
function medIcsFold(line) {   // строка не длиннее 75 байт, продолжение начинается с пробела
    const enc = new TextEncoder(); const out = []; let cur = '', bytes = 0;
    for (const ch of line) { const b = enc.encode(ch).length; if (bytes + b > 73) { out.push(cur); cur = ' '; bytes = 1; } cur += ch; bytes += b; }
    out.push(cur); return out.join('\r\n');
}
function medBuildIcs() {
    const today = todayKey(), stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
    const BY = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'];
    const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//iLife//Lekarstva//RU', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'X-WR-CALNAME:iLife — лекарства'];
    let n = 0;
    medList('plan').forEach(p => {
        if (p.to && p.to < today) return;
        let start = p.from > today ? p.from : today;   // первый день приёма, начиная с сегодняшнего
        for (let i = 0; i < 400 && !medPlanActiveOn(p, start); i++) start = medDayAdd(start, 1);
        if (!medPlanActiveOn(p, start)) return;
        const rule = (p.mode === 'week' ? 'FREQ=WEEKLY;BYDAY=' + (p.wd || []).slice().sort().map(i => BY[i]).join(',') : 'FREQ=DAILY;INTERVAL=' + (p.mode === 'every' ? Math.max(2, +p.every || 2) : 1)) + (p.to ? ';UNTIL=' + p.to.replace(/-/g, '') + 'T235959' : '');
        const title = 'Принять: ' + p.drug + (p.dose ? ', ' + p.dose : '');
        (p.times || []).forEach(t => {
            lines.push('BEGIN:VEVENT', 'UID:' + p.id + '-' + t.replace(':', '') + '@ilife', 'DTSTAMP:' + stamp, 'DTSTART:' + start.replace(/-/g, '') + 'T' + t.replace(':', '') + '00', 'DURATION:PT10M', 'RRULE:' + rule,
                'SUMMARY:' + medIcsEsc(title), 'DESCRIPTION:' + medIcsEsc((p.note ? p.note + '\n' : '') + 'Из iLife: Лекарства → График приёма'),
                'BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:' + medIcsEsc(title), 'TRIGGER:PT0M', 'END:VALARM', 'END:VEVENT');
            n++;
        });
    });
    lines.push('END:VCALENDAR');
    return { text: lines.map(medIcsFold).join('\r\n') + '\r\n', count: n };
}
async function medExportIcs() {
    const ics = medBuildIcs();
    if (!ics.count) { toast('В графике нет действующих приёмов'); return; }
    const blob = new Blob([ics.text], { type: 'text/calendar' }), name = 'iLife_лекарства_' + todayKey() + '.ics';
    const bridge = nativeFileBridge();
    if (bridge) { try { const ok = bridge.saveFile(await blobToBase64(blob), name, 'text/calendar'); if (ok !== false && ok !== 'false') { toast('Файл сохранён: ' + name); return; } } catch (e) {} }
    if (isAndroidWebView()) { toast('В этом приложении сохранить файл нельзя — откройте iLife в браузере (Chrome)', { ms: 6000 }); return; }
    const url = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = url; a.download = name; a.rel = 'noopener'; a.style.display = 'none'; document.body.appendChild(a); a.click();
    setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 60000);
    toast('Файл скачан — откройте его, и календарь добавит напоминания', { ms: 6000, action: 'Инструкция', onAction: () => openInstruction('instr-med-notify') });
}

// ---------- PDF: график приёма ----------
function openMedSchedulePdfSheet() {
    if (!medList('plan').length) { toast('В графике пока нечего выводить'); return; }
    const keys = medMonthKeys(medCal.y, medCal.mo);
    const html =
        '<p class="hint" style="margin:0 4px 8px">График выводится списком: лекарства с дозами и временем, затем приёмы по дням с клетками для отметок. Отмеченные приёмы идут с галочкой.</p>' +
        '<label class="opt-row"><input type="radio" name="mpdf-per" value="month" checked><span><b>' + esc(medMonthTitle(medCal.y, medCal.mo)) + '</b><span class="sub">месяц, открытый в календаре</span></span></label>' +
        '<label class="opt-row"><input type="radio" name="mpdf-per" value="range"><span><b>Свой период</b></span></label>' +
        '<div class="med-row2" style="margin:0 0.5rem 0.5rem"><div><label class="field-label" for="mpdf-from">С</label><input type="date" id="mpdf-from" value="' + keys[0] + '"></div><div><label class="field-label" for="mpdf-to">По</label><input type="date" id="mpdf-to" value="' + keys[keys.length - 1] + '"></div></div>' +
        '<label class="field-label" style="margin-top:0.75rem">Что вывести</label>' +
        '<label class="opt-row"><input type="radio" name="mpdf-kind" value="full" checked><span><b>Всё</b><span class="sub">список лекарств и приёмы по дням</span></span></label>' +
        '<label class="opt-row"><input type="radio" name="mpdf-kind" value="list"><span><b>Только список лекарств</b><span class="sub">доза, время, период — одной страницей</span></span></label>' +
        '<label class="opt-row"><input type="radio" name="mpdf-kind" value="days"><span><b>Только приёмы по дням</b><span class="sub">удобно распечатать и отмечать ручкой</span></span></label>';
    openSheet({
        title: 'График в PDF', html,
        onOpen: api => { ['#mpdf-from', '#mpdf-to'].forEach(s => $(s, api.el).addEventListener('change', () => { $('input[name="mpdf-per"][value="range"]', api.el).checked = true; })); },
        actions: [{ label: 'Отмена' }, { label: 'Сохранить PDF', kind: 'primary', icon: 'picture_as_pdf', async onClick(s) {
            const range = ($('input[name="mpdf-per"]:checked', s.el) || {}).value === 'range';
            let from = range ? $('#mpdf-from', s.el).value : keys[0], to = range ? $('#mpdf-to', s.el).value : keys[keys.length - 1];
            if (!from || !to || to < from) { toast('Проверьте даты периода'); return false; }
            if (medDaysBetween(from, to) > 366) { toast('Период не длиннее года'); return false; }
            const btn = $('.btn-primary', s.el); btn.disabled = true; btn.textContent = 'Готовим PDF…';
            try { await exportMedSchedulePdf({ from, to, kind: ($('input[name="mpdf-kind"]:checked', s.el) || {}).value || 'full' }); }
            catch (e) { console.error(e); toast('Не удалось собрать PDF'); }
        } }]
    });
}
function medPdfSection(pdf, title, accent) {
    pdf.ensure(46);
    pdf.textAt(title, pdf.mx, pdf.y + 13, 14, { bold: true, color: '#1d1b20' });
    pdf.y += 20; pdf.line(pdf.mx, pdf.y, pdf.W - pdf.mx, pdf.y, accent, 0.9); pdf.gap(9);
}
async function exportMedSchedulePdf(o) {
    const accent = pdfAccent();
    const days = []; for (let k = o.from; k <= o.to; k = medDayAdd(k, 1)) days.push(k);
    const perDay = days.map(k => ({ k, doses: medDosesOn(k) })).filter(d => d.doses.length);
    if (!perDay.length) { toast('В этом периоде приёмов нет'); return; }
    const stat = new Map(); let total = 0, taken = 0;
    perDay.forEach(d => d.doses.forEach(x => { const s = stat.get(x.plan.id) || { plan: x.plan, total: 0, taken: 0 }; s.total++; total++; if (x.taken) { s.taken++; taken++; } stat.set(x.plan.id, s); }));
    const plans = Array.from(stat.values()).sort((a, b) => String(a.plan.drug).localeCompare(String(b.plan.drug), 'ru'));
    const pdf = new PdfWriter({ title: 'iLife — График приёма лекарств', footer: 'iLife · Лекарства · ' + authorName() });
    const period = o.from === o.to ? fmtDayKey(o.from, true) : fmtDayKey(o.from, true) + ' — ' + fmtDayKey(o.to, true);
    pdfHeader(pdf, 'График приёма лекарств', period + '   ·   ' + medFmtN(plans.length, 'лекарство', 'лекарства', 'лекарств') + '   ·   ' + medFmtN(total, 'приём', 'приёма', 'приёмов') + ', отмечено ' + taken, accent);

    if (o.kind !== 'days') {
        medPdfSection(pdf, 'Лекарства', accent);
        plans.forEach((s, i) => {
            const p = s.plan, nameW = pdf.cw - 22 - 110;
            const nameLines = pdf.wrap(p.drug + (p.dose ? ' — ' + p.dose : ''), 12, true, nameW);
            const info = ['Время: ' + (p.times || []).join(', '), medPlanPeriodText(p)].join('   ·   ');
            const infoLines = pdf.wrap(info, 9.5, false, pdf.cw - 22);
            const noteLines = p.note ? pdf.wrap(p.note, 9.5, false, pdf.cw - 22) : [];
            const h = nameLines.length * 15.5 + infoLines.length * 12.5 + noteLines.length * 12.5 + 8;
            pdf.ensure(h + 4);
            const y0 = pdf.y;
            pdf.textAt(String(i + 1) + '.', pdf.mx, y0 + 11.5, 12, { bold: true, color: accent });
            nameLines.forEach((l, li) => pdf.textAt(l, pdf.mx + 22, y0 + 11.5 + li * 15.5, 12, { bold: true, color: '#1d1b20' }));
            pdf.textAt('принято ' + s.taken + ' из ' + s.total, pdf.W - pdf.mx, y0 + 11.5, 9.5, { color: s.taken === s.total ? '#2e7d32' : '#79747e', align: 'right' });
            let y = y0 + nameLines.length * 15.5 + 9;
            infoLines.forEach(l => { pdf.textAt(l, pdf.mx + 22, y, 9.5, { color: '#49454f' }); y += 12.5; });
            noteLines.forEach(l => { pdf.textAt(l, pdf.mx + 22, y, 9.5, { color: '#79747e' }); y += 12.5; });
            pdf.y = y0 + h;
            pdf.line(pdf.mx + 22, pdf.y - 2, pdf.W - pdf.mx, pdf.y - 2, '#e7e0ec', 0.5); pdf.gap(5);
        });
        pdf.gap(10);
    }
    if (o.kind !== 'list') {
        medPdfSection(pdf, 'Приёмы по дням', accent);
        const today = todayKey();
        perDay.forEach(d => {
            const done = d.doses.filter(x => x.taken).length;
            pdf.ensure(20 + 20);   // заголовок дня не остаётся один внизу страницы
            pdf.textAt(capitalizeFirst(medDayFull(d.k)), pdf.mx, pdf.y + 11, 11.5, { bold: true, color: accent });
            pdf.textAt((d.k <= today || done ? 'принято ' + done + ' из ' : 'приёмов: ') + d.doses.length, pdf.W - pdf.mx, pdf.y + 11, 9, { color: '#79747e', align: 'right' });
            pdf.y += 17; pdf.line(pdf.mx, pdf.y, pdf.W - pdf.mx, pdf.y, '#cac4d0', 0.5); pdf.gap(6);
            d.doses.forEach(x => {
                const textW = pdf.cw - 70;
                const lines = pdf.wrap(x.plan.drug + (x.plan.dose ? ' — ' + x.plan.dose : ''), 11, false, textW);
                const note = x.plan.note ? pdf.wrap(x.plan.note, 8.8, false, textW) : [];
                const h = lines.length * 14 + note.length * 11.5 + 5;
                pdf.ensure(h);
                const y0 = pdf.y;
                pdf.box(pdf.mx, y0 + 1, 11, x.taken ? accent : '#79747e', x.taken);
                pdf.textAt(x.time, pdf.mx + 22, y0 + 10.5, 11, { bold: true, color: '#1d1b20' });
                lines.forEach((l, li) => pdf.textAt(l, pdf.mx + 70, y0 + 10.5 + li * 14, 11, { color: '#1d1b20' }));
                note.forEach((l, li) => pdf.textAt(l, pdf.mx + 70, y0 + 10.5 + lines.length * 14 - 2 + li * 11.5, 8.8, { color: '#79747e' }));
                pdf.y = y0 + h;
            });
            pdf.gap(8);
        });
    }
    return finishPdf(pdf, 'График_лекарств');
}

// ---------- PDF: назначения врача ----------
async function exportMedOrdersPdf() {
    const list = medList('order').sort((a, b) => (b.date || '').localeCompare(a.date || '') || (b.createdAt || 0) - (a.createdAt || 0));
    if (!list.length) { toast('Назначений пока нет'); return; }
    try {
        const accent = pdfAccent();
        const pdf = new PdfWriter({ title: 'iLife — Назначения врача', footer: 'iLife · Лекарства · ' + authorName() });
        pdfHeader(pdf, 'Назначения врача', medFmtN(list.length, 'назначение', 'назначения', 'назначений'), accent);
        list.forEach(o => {
            pdf.ensure(70);
            pdf.textAt(o.doctor || 'Врач не указан', pdf.mx, pdf.y + 12, 13, { bold: true, color: '#1d1b20' });
            pdf.textAt(medDateLabel(o.date), pdf.W - pdf.mx, pdf.y + 12, 10, { color: accent, bold: true, align: 'right' });
            pdf.y += 19; pdf.line(pdf.mx, pdf.y, pdf.W - pdf.mx, pdf.y, '#cac4d0', 0.6); pdf.gap(7);
            if (o.diagnosis) { pdf.para('Диагноз', { size: 8.8, color: '#79747e' }); pdf.para(o.diagnosis, { size: 11, color: '#1d1b20' }); pdf.gap(6); }
            if ((o.drugs || []).length) {
                pdf.para('Лекарства', { size: 8.8, color: '#79747e' }); pdf.gap(1);
                o.drugs.forEach((d, i) => {
                    pdf.ensure(30);
                    const yy = pdf.y;
                    pdf.textAt((i + 1) + '.', pdf.mx, yy + 10.2, 11, { bold: true, color: accent });
                    pdf.para(d.name, { size: 11, bold: true, color: '#1d1b20', indent: 18 });
                    const sub = [d.dose, d.how, d.days ? medFmtN(+d.days, 'день', 'дня', 'дней') : ''].filter(Boolean).join('   ·   ');
                    if (sub) pdf.para(sub, { size: 9.8, color: '#49454f', indent: 18 });
                    pdf.gap(3);
                });
                pdf.gap(3);
            }
            if (o.comment) { pdf.para('Комментарии', { size: 8.8, color: '#79747e' }); pdf.para(o.comment, { size: 10.5, color: '#1d1b20' }); }
            const docs = (o.rxIds || []).map(medById).filter(Boolean);
            if (docs.length) { pdf.gap(4); pdf.para('Фото в базе: ' + docs.map(medRxTitle).join('; '), { size: 8.8, color: '#79747e' }); }
            pdf.gap(16);
        });
        await finishPdf(pdf, 'Назначения_врача');
    } catch (e) { console.error(e); toast('Не удалось собрать PDF'); }
}

// ---------- Запуск ----------
function initMedSchedule() {
    $('#med-sch-new').addEventListener('click', () => medPlanFormSheet(null));
    $('#med-sch-pdf').addEventListener('click', openMedSchedulePdfSheet);
    $('#med-cal-prev').addEventListener('click', () => { medCal = medCal.mo ? { y: medCal.y, mo: medCal.mo - 1 } : { y: medCal.y - 1, mo: 11 }; renderMedCalendar(); });
    $('#med-cal-next').addEventListener('click', () => { medCal = medCal.mo < 11 ? { y: medCal.y, mo: medCal.mo + 1 } : { y: medCal.y + 1, mo: 0 }; renderMedCalendar(); });
    $('#med-cal-today').addEventListener('click', () => { const p = almatyParts(); medCal = { y: p.y, mo: p.mo }; medSel = todayKey(); renderMedCalendar(); renderMedDay(); });
    $('#med-cal').addEventListener('click', e => { const b = e.target.closest('[data-k]'); if (!b) return; medSel = b.dataset.k; renderMedCalendar(); renderMedDay(); });
    $('#med-day').addEventListener('click', e => {
        const t = e.target.closest('[data-take]'), pl = e.target.closest('[data-plan]');
        if (t) {
            const [id, time] = t.dataset.take.split('|'); const p = medById(id); if (!p) return;
            if (medSel > todayKey() && !medIsTaken(p, medSel, time)) { toast('Этот день ещё не наступил'); return; }
            medSetTaken(p, medSel, time, !medIsTaken(p, medSel, time)); saveMeds(); renderMedSchedule();
        } else if (pl) { const p = medById(pl.dataset.plan); if (p) medPlanFormSheet(p); }
        else if (e.target.closest('#med-day-all')) { medDosesOn(medSel).forEach(d => medSetTaken(d.plan, medSel, d.time, true)); saveMeds(); renderMedSchedule(); toast('Все приёмы дня отмечены'); }
    });
    $('#med-plans').addEventListener('click', e => {
        const row = e.target.closest('.med-plan'); if (!row) return;
        const p = medById(row.dataset.id); if (!p) return;
        if (e.target.closest('[data-bell]')) { p.notify = p.notify === false; saveMeds(); renderMedSchedule(); toast(p.notify ? 'Напоминание включено: ' + p.drug : 'Напоминание выключено: ' + p.drug); if (p.notify && medNotifySupported() && Notification.permission === 'default') medNotifyAsk(); }
        else if (e.target.closest('[data-edit]')) medPlanFormSheet(p);
    });
    $('#med-notify-switch').addEventListener('change', async e => {
        if (e.target.checked) { if (!(await medNotifyAsk())) e.target.checked = false; }
        else { LS.set('med_notify', false); toast('Уведомления о лекарствах выключены на этом устройстве'); }
        renderMedNotify();
    });
    $('#med-ics').addEventListener('click', medExportIcs);
    // нажатие на уведомление (служебный воркер sw.js): открыть график или сразу отметить «принял»
    try {
        if (navigator.serviceWorker) navigator.serviceWorker.addEventListener('message', e => {
            const m = e.data || {}; if (m.type !== 'med-notify') return;
            if (m.taken) { if (medMarkKeys(m.keys)) toast('Отмечено: принято'); } else medOpenToday();
        });
    } catch (e) {}
    // iLife был закрыт, уведомление открыло его заново: ?med=taken:ключи или ?med=open
    try {
        const m = location.search.match(/[?&]med=([^&]*)/);
        if (m) {
            const v = decodeURIComponent(m[1]);
            if (v.startsWith('taken:')) setTimeout(() => { if (medMarkKeys(v.slice(6).split(',').filter(Boolean))) toast('Отмечено: принято'); }, 600);
            const rest = location.search.replace(/([?&])med=[^&]*&?/, '$1').replace(/[?&]$/, '');
            history.replaceState(null, '', location.pathname + rest + location.hash);
        }
    } catch (e) {}
    setInterval(medTick, 20000);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') medTick(); });
    setTimeout(medTick, 1500);
}
