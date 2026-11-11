'use strict';
// =====================================================================================================
// iLife 2.2.0 — РАЗДЕЛ «ЛЕКАРСТВА» (часть 1): меню раздела, общая база, страницы «Рецепты» и «Назначение врача».
// Страница «График приёма» (календарь, отметки, уведомления, PDF) — в js/meds-schedule.js.
//
// ВСЁ ХРАНИТСЯ В ОДНОЙ БАЗЕ — списке meds (ключ ilife_meds), записи различаются полем kind:
//   rx    — документ с фото: рецепт, диагноз (заключение врача) или другой документ.
//           { id, kind:'rx', type:'recipe'|'diagnosis'|'other', title, doctor, date:'ГГГГ-ММ-ДД', note, files:[вложения-картинки], createdAt, author }
//           Сами фото лежат в IndexedDB (BlobDB, core.js) и синхронизируются как остальные вложения (поле files, как у идей).
//   order — назначение врача, вводится вручную.
//           { id, kind:'order', date, doctor, diagnosis, drugs:[{ id, name, dose, how, days }], comment, rxIds:[id документов], createdAt, author }
//   plan  — приём лекарства в графике.
//           { id, kind:'plan', drug, dose, note, times:['08:00', …], from, to, mode:'daily'|'every'|'week', every, wd:[0..6, 0 = пн],
//             notify, taken:{ 'ГГГГ-ММ-ДД': ['08:00', …] }, orderId, drugId, createdAt, author }
//   mood  — день в «Дневнике настроения» (js/meds-mood.js): { id:'mood'+дата, kind:'mood', date, mood, color, note, createdAt, author }
// Список meds синхронизируется с Google Диском поштучно (js/gdrive.js → G_LISTS) и входит в резервную копию (js/settings.js).
// =====================================================================================================

// ---------- Значки раздела (дополняют js/icons.js) ----------
(function () {
    if (!window.ICONS) return;
    Object.assign(window.ICONS, {
        medication: '<path d="M6 3h12v2H6zm11 3H7c-1.1 0-2 .9-2 2v11c0 1.1.9 2 2 2h10c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2m-1 9h-2.5v2.5h-3V15H8v-3h2.5V9.5h3V12H16z"/>',
        medical_services: '<path d="M20 6h-4V4c0-1.1-.9-2-2-2h-4c-1.1 0-2 .9-2 2v2H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2M10 4h4v2h-4zm6 11h-3v3h-2v-3H8v-2h3v-3h2v3h3z"/>',
        receipt_long: '<path d="M19.5 3.5 18 2l-1.5 1.5L15 2l-1.5 1.5L12 2l-1.5 1.5L9 2 7.5 3.5 6 2v14H3v3c0 1.66 1.34 3 3 3h12c1.66 0 3-1.34 3-3V2zM19 19c0 .55-.45 1-1 1s-1-.45-1-1v-3H8V5h11z"/><path d="M9 7h6v2H9zm7 0h2v2h-2zm-7 3h6v2H9zm7 0h2v2h-2z"/>',
        notifications: '<path d="M12 22c1.1 0 2-.9 2-2h-4c0 1.1.89 2 2 2m6-6v-5c0-3.07-1.64-5.64-4.5-6.32V4c0-.83-.67-1.5-1.5-1.5s-1.5.67-1.5 1.5v.68C7.63 5.36 6 7.92 6 11v5l-2 2v1h16v-1z"/>',
        notifications_off: '<path d="M20 18.69 7.84 6.14 5.27 3.49 4 4.76l2.8 2.8v.01c-.52.99-.8 2.16-.8 3.42v5l-2 2v1h13.73l2 2L21 19.72zM12 22c1.11 0 2-.89 2-2h-4c0 1.11.89 2 2 2m6-7.32V11c0-3.08-1.64-5.64-4.5-6.32V4c0-.83-.67-1.5-1.5-1.5s-1.5.67-1.5 1.5v.68c-.51.12-.99.3-1.43.54z"/>',
        alarm: '<path d="m22 5.72-4.6-3.86-1.29 1.53 4.6 3.86zM7.88 3.39 6.6 1.86 2 5.71l1.29 1.53zM12.5 8H11v6l4.75 2.85.75-1.23-4-2.37zM12 4c-4.97 0-9 4.03-9 9s4.02 9 9 9c4.97 0 9-4.03 9-9s-4.03-9-9-9m0 16c-3.87 0-7-3.13-7-7s3.13-7 7-7 7 3.13 7 7-3.13 7-7 7"/>'
    });
})();

const MED_TABS = ['med-rx', 'med-orders', 'med-schedule', 'med-mood'];
const MED_RX_TYPES = [{ k: 'recipe', n: 'Рецепт', many: 'Рецепты', icon: 'receipt_long' }, { k: 'diagnosis', n: 'Диагноз', many: 'Диагнозы', icon: 'medical_services' }, { k: 'other', n: 'Другое', many: 'Другое', icon: 'description' }];

let meds = LS.get('meds', []);
if (!Array.isArray(meds)) meds = [];
function saveMeds() { if (typeof cloudLocalChanged === 'function') cloudLocalChanged(); LS.set('meds', meds); }
function medList(kind) { return meds.filter(m => m && m.kind === kind); }
function medById(id) { return meds.find(m => m && m.id === id) || null; }
function medRxType(k) { return MED_RX_TYPES.find(t => t.k === k) || MED_RX_TYPES[2]; }
function medFmtN(n, one, few, many) { const a = Math.abs(n) % 100, b = a % 10; return n + ' ' + (a > 10 && a < 20 ? many : b > 1 && b < 5 ? few : b === 1 ? one : many); }
function medDateLabel(key) { return key ? fmtDayKey(key, true) : 'без даты'; }
// Уже введённые имена врачей и лекарств — подсказки в формах
function medDoctors() { return Array.from(new Set(meds.map(m => (m && m.doctor || '').trim()).filter(Boolean))); }
function medDrugNames() {
    const s = new Set();
    medList('order').forEach(o => (o.drugs || []).forEach(d => d.name && s.add(d.name.trim())));
    medList('plan').forEach(p => p.drug && s.add(p.drug.trim()));
    return Array.from(s);
}
function medDatalist(id, values) { return '<datalist id="' + id + '">' + values.map(v => '<option value="' + esc(v) + '">').join('') + '</datalist>'; }
// Проставляет картинки из IndexedDB в <img data-blob="id"> (миниатюры)
function medFillThumbs(root) {
    $$('img[data-blob]', root).forEach(async img => {
        const id = img.dataset.blob; img.removeAttribute('data-blob');
        const u = await BlobDB.url(id, 'thumb');
        if (u) img.src = u; else { const w = img.closest('.med-thumb'); if (w) w.classList.add('is-missing'); }
    });
}
// После синхронизации с Google Диском или восстановления из копии
function medsAfterSync() {
    const active = (document.querySelector('.tab.is-active') || {}).id;
    if (MED_TABS.includes(active)) medTabOpened(active);
    if (typeof medScheduleChanged === 'function') medScheduleChanged();
}

// ---------- Меню раздела ----------
let medLastMain = 'ideas';
function medNavSync(id) {
    if (MED_TABS.includes(id)) { document.documentElement.dataset.nav = 'med'; LS.set('med_last', id); }
    else if (!String(id).startsWith('dnd-')) medLastMain = id;
}
function medOpen() { const t = LS.get('med_last', 'med-rx'); showTab(MED_TABS.includes(t) ? t : 'med-rx'); }
function medBack() { showTab(TABS.includes(medLastMain) && !MED_TABS.includes(medLastMain) ? medLastMain : 'ideas'); }
function medTabOpened(id) {
    if (id === 'med-rx') renderMedRx();
    if (id === 'med-orders') renderMedOrders();
    if (id === 'med-schedule' && typeof renderMedSchedule === 'function') renderMedSchedule();
    if (id === 'med-mood' && typeof renderMedMood === 'function') renderMedMood();
    if (id !== 'med-mood' && typeof moodClosePop === 'function') moodClosePop();
}

// =====================================================================================================
// СТРАНИЦА «РЕЦЕПТЫ»: кнопки «Сфотографировать» и «Импорт фото», одна база рецептов и диагнозов
// =====================================================================================================
let medRxFilter = 'all', medRxQuery = '';

async function medFilesToAttachments(fileList) {
    const out = [];
    for (const f of Array.from(fileList || [])) {
        if (!/^image\//.test(f.type) && !/\.(jpe?g|png|webp|heic|heif|gif|bmp)$/i.test(f.name || '')) { toast('Это не фото: ' + (f.name || 'файл')); continue; }
        try { out.push(await makeAttachment(f, 'image')); } catch (e) { toast('Не удалось прочитать фото: ' + (f.name || '')); }
    }
    return out;
}
// Выбор фото: camera = true — сразу камера телефона (на компьютере откроется обычный выбор файла)
function medPickPhotos(camera) {
    return new Promise(resolve => {
        const inp = document.createElement('input');
        inp.type = 'file'; inp.accept = 'image/*'; inp.style.display = 'none';
        if (camera) inp.setAttribute('capture', 'environment'); else inp.multiple = true;
        document.body.appendChild(inp);
        let done = false;
        const fin = async () => { if (done) return; done = true; const files = inp.files; setTimeout(() => inp.remove(), 0); resolve(files && files.length ? await medFilesToAttachments(files) : []); };
        inp.addEventListener('change', fin);
        inp.addEventListener('cancel', fin);
        inp.click();
    });
}
async function medRxAddFlow(camera) {
    const atts = await medPickPhotos(camera);
    if (atts.length) medRxFormSheet(null, atts);
}

// Форма документа: новые фото (drafts) ещё в памяти, в IndexedDB попадают при сохранении
function medRxFormSheet(doc, drafts) {
    const isNew = !doc;
    const d = doc || { type: medRxFilter !== 'all' ? medRxFilter : 'recipe', title: '', doctor: '', date: todayKey(), note: '', files: [] };
    let type = d.type;
    let kept = (d.files || []).slice();      // уже сохранённые фото (метаданные)
    let added = (drafts || []).slice();      // новые фото (с blob)
    const tmpUrls = [];
    const node = document.createElement('div'); node.className = 'med-form';
    node.innerHTML =
        '<div class="med-photos" id="mrx-photos"></div>' +
        '<div class="btn-group" style="margin-top:0.5rem"><button type="button" class="btn" id="mrx-cam">' + ic('photo_camera') + 'Сфотографировать</button><button type="button" class="btn" id="mrx-imp">' + ic('add_photo_alternate') + 'Импорт фото</button></div>' +
        '<label class="field-label">Что это</label><div class="seg" id="mrx-type" role="group" aria-label="Вид документа">' +
        MED_RX_TYPES.map(t => '<button type="button" data-k="' + t.k + '"' + (t.k === type ? ' class="is-on"' : '') + '>' + ic(t.icon) + t.n + '</button>').join('') + '</div>' +
        '<label class="field-label" for="mrx-title">Название</label><input type="text" id="mrx-title" maxlength="120" placeholder="Например, «Рецепт от терапевта» или сам диагноз" value="' + esc(d.title) + '">' +
        '<div class="med-row2"><div><label class="field-label" for="mrx-doc">Врач</label><input type="text" id="mrx-doc" maxlength="80" list="mrx-docs" placeholder="Фамилия, специальность" value="' + esc(d.doctor) + '">' + medDatalist('mrx-docs', medDoctors()) + '</div>' +
        '<div><label class="field-label" for="mrx-date">Дата</label><input type="date" id="mrx-date" value="' + esc(d.date || '') + '"></div></div>' +
        '<label class="field-label" for="mrx-note">Заметка</label><textarea id="mrx-note" rows="3" placeholder="Что назначено, до какого числа действует рецепт, что сказал врач">' + esc(d.note) + '</textarea>';
    const box = $('#mrx-photos', node);
    async function drawPhotos() {
        const all = kept.map(f => ({ f, saved: true })).concat(added.map(f => ({ f, saved: false })));
        box.innerHTML = all.length ? all.map((x, i) => '<div class="med-thumb"><img alt="Фото ' + (i + 1) + '" data-i="' + i + '"><button type="button" class="med-thumb-x" data-x="' + i + '" aria-label="Убрать фото">' + ic('close') + '</button></div>').join('') :
            '<p class="hint" style="margin:0">Фото пока нет — снимите рецепт или выберите готовое фото.</p>';
        for (let i = 0; i < all.length; i++) {
            const img = box.querySelector('img[data-i="' + i + '"]'); if (!img) continue;
            if (all[i].saved) img.src = await BlobDB.url(all[i].f.id, 'thumb');
            else { const u = URL.createObjectURL(all[i].f.thumb || all[i].f.blob); tmpUrls.push(u); img.src = u; }
        }
    }
    box.addEventListener('click', e => {
        const x = e.target.closest('[data-x]'); if (!x) return;
        const i = +x.dataset.x;
        if (i < kept.length) kept.splice(i, 1); else added.splice(i - kept.length, 1);
        drawPhotos();
    });
    $('#mrx-cam', node).addEventListener('click', async () => { added = added.concat(await medPickPhotos(true)); drawPhotos(); });
    $('#mrx-imp', node).addEventListener('click', async () => { added = added.concat(await medPickPhotos(false)); drawPhotos(); });
    $('#mrx-type', node).addEventListener('click', e => {
        const b = e.target.closest('[data-k]'); if (!b) return;
        type = b.dataset.k; $$('#mrx-type button', node).forEach(x => x.classList.toggle('is-on', x === b));
    });
    drawPhotos();
    openSheet({
        title: isNew ? 'Новый документ' : 'Документ', node,
        actions: [{ label: 'Отмена', value: false }, {
            label: 'Сохранить', kind: 'primary', icon: 'check',
            onClick: async () => {
                if (!kept.length && !added.length) { toast('Добавьте хотя бы одно фото'); return false; }
                try { for (const a of added) await persistAttachment(a); } catch (e) { toast('Не удалось сохранить фото'); return false; }
                const files = kept.concat(added.map(attachmentMeta));
                const title = $('#mrx-title', node).value.trim();
                const rec = { type, title, doctor: $('#mrx-doc', node).value.trim(), date: $('#mrx-date', node).value || todayKey(), note: $('#mrx-note', node).value.trim(), files };
                if (isNew) meds.unshift(Object.assign({ id: uid('mr'), kind: 'rx', createdAt: Date.now(), author: authorName() }, rec));
                else {
                    const keep = new Set(files.map(f => f.id));
                    (doc.files || []).forEach(f => { if (!keep.has(f.id)) BlobDB.del(f.id); });   // убранные фото больше не нужны
                    Object.assign(doc, rec);
                }
                saveMeds(); renderMedRx();
                toast(isNew ? medRxType(type).n + ' сохранён в базе' : 'Сохранено');
            }
        }],
        onClose: () => tmpUrls.forEach(u => URL.revokeObjectURL(u))
    });
}
async function medRxDelete(doc) {
    if (!(await confirmSheet('Удалить документ?', '«' + medRxTitle(doc) + '» и его фото (' + (doc.files || []).length + ') будут удалены.', 'Удалить', true))) return;
    meds = meds.filter(m => m !== doc);
    medList('order').forEach(o => { if (o.rxIds && o.rxIds.includes(doc.id)) o.rxIds = o.rxIds.filter(x => x !== doc.id); });
    saveMeds();
    (doc.files || []).forEach(f => BlobDB.del(f.id));
    renderMedRx(); toast('Документ удалён');
}
function medRxTitle(doc) { return doc.title || (medRxType(doc.type).n + ' от ' + medDateLabel(doc.date)); }
function medRxMatches(doc, q) {
    if (!q) return true;
    const hay = normText([doc.title, doc.doctor, doc.note, medRxType(doc.type).n, medDateLabel(doc.date), doc.date].join(' '));
    return q.split(/\s+/).every(w => hay.includes(w));
}
function renderMedRx() {
    const host = $('#med-rx-list'); if (!host) return;
    const all = medList('rx');
    const q = normText(medRxQuery).trim();
    const counts = { all: all.length }; MED_RX_TYPES.forEach(t => { counts[t.k] = all.filter(d => d.type === t.k).length; });
    $('#med-rx-filter').innerHTML = '<button type="button" class="chip' + (medRxFilter === 'all' ? ' is-on' : '') + '" data-f="all">Все ' + counts.all + '</button>' +
        MED_RX_TYPES.map(t => '<button type="button" class="chip' + (medRxFilter === t.k ? ' is-on' : '') + '" data-f="' + t.k + '">' + t.many + ' ' + counts[t.k] + '</button>').join('');
    const list = all.filter(d => (medRxFilter === 'all' || d.type === medRxFilter) && medRxMatches(d, q))
        .sort((a, b) => (b.date || '').localeCompare(a.date || '') || (b.createdAt || 0) - (a.createdAt || 0));
    $('#med-rx-count').textContent = list.length ? medFmtN(list.length, 'документ', 'документа', 'документов') : '';
    if (!list.length) {
        host.className = '';
        host.innerHTML = '<div class="empty"><div class="ico-big">' + ic('receipt_long') + '</div><b>' + (all.length ? 'Ничего не найдено' : 'База пока пустая') + '</b>' +
            (all.length ? 'Измените поиск или фильтр.' : 'Сфотографируйте рецепт или заключение врача — они сохранятся здесь, в одной базе.') + '</div>';
        return;
    }
    host.className = 'med-rx-grid';
    host.innerHTML = list.map(d => {
        const t = medRxType(d.type), n = (d.files || []).length;
        return '<article class="med-rx" data-id="' + esc(d.id) + '">' +
            '<button type="button" class="med-thumb med-rx-pic" data-view aria-label="Открыть фото">' + (n ? '<img alt="" loading="lazy" data-blob="' + esc(d.files[0].id) + '">' : ic('image')) + (n > 1 ? '<span class="med-pic-n">' + ic('photo_library') + n + '</span>' : '') + '</button>' +
            '<div class="med-rx-b"><span class="chip med-type-' + t.k + '">' + ic(t.icon) + t.n + '</span>' +
            '<h3>' + esc(medRxTitle(d)) + '</h3>' +
            '<p class="med-meta">' + ic('event') + esc(medDateLabel(d.date)) + (d.doctor ? ' · ' + esc(d.doctor) : '') + '</p>' +
            (d.note ? '<p class="med-note">' + esc(d.note) + '</p>' : '') +
            '<div class="med-acts"><button type="button" class="icon-btn" data-edit aria-label="Изменить" title="Изменить">' + ic('edit') + '</button><button type="button" class="icon-btn is-danger" data-del aria-label="Удалить" title="Удалить">' + ic('delete') + '</button></div></div></article>';
    }).join('');
    medFillThumbs(host);
}
function initMedRx() {
    $('#med-rx-cam').addEventListener('click', () => medRxAddFlow(true));
    $('#med-rx-import').addEventListener('click', () => medRxAddFlow(false));
    const q = $('#med-rx-q');
    q.addEventListener('input', debounce(() => { medRxQuery = q.value; renderMedRx(); }, 180));
    $('#med-rx-filter').addEventListener('click', e => { const b = e.target.closest('[data-f]'); if (!b) return; medRxFilter = b.dataset.f; renderMedRx(); });
    $('#med-rx-list').addEventListener('click', e => {
        const card = e.target.closest('.med-rx'); if (!card) return;
        const doc = medById(card.dataset.id); if (!doc) return;
        if (e.target.closest('[data-del]')) medRxDelete(doc);
        else if (e.target.closest('[data-edit]')) medRxFormSheet(doc);
        else if (e.target.closest('[data-view]')) { const ids = (doc.files || []).map(f => f.id); if (ids.length) openLightbox(ids, 0); }
    });
    // фото можно перетащить на страницу мышью (компьютер)
    const sec = $('#med-rx');
    sec.addEventListener('dragover', e => { if (e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files')) e.preventDefault(); });
    sec.addEventListener('drop', async e => {
        if (!e.dataTransfer || !e.dataTransfer.files.length) return;
        e.preventDefault();
        const atts = await medFilesToAttachments(e.dataTransfer.files);
        if (atts.length) medRxFormSheet(null, atts);
    });
}

// =====================================================================================================
// СТРАНИЦА «НАЗНАЧЕНИЕ ВРАЧА»: вводится вручную — врач, диагноз, лекарства, комментарии
// =====================================================================================================
function medDrugLine(d) { return [d.name, d.dose, d.how, d.days ? medFmtN(+d.days, 'день', 'дня', 'дней') : ''].filter(Boolean).join(' · '); }
function medOrderPlans(order, drug) { return medList('plan').filter(p => p.orderId === order.id && (!drug || p.drugId === drug.id)); }

function medOrderFormSheet(order) {
    const isNew = !order;
    const o = order || { date: todayKey(), doctor: '', diagnosis: '', drugs: [], comment: '', rxIds: [] };
    let drugs = (o.drugs || []).map(d => Object.assign({}, d));
    if (!drugs.length) drugs.push({ id: uid('md'), name: '', dose: '', how: '', days: '' });
    const rxDocs = medList('rx').sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    const rxSel = new Set(o.rxIds || []);
    const node = document.createElement('div'); node.className = 'med-form';
    node.innerHTML =
        '<div class="med-row2"><div><label class="field-label" for="mo-date">Дата приёма у врача</label><input type="date" id="mo-date" value="' + esc(o.date || '') + '"></div>' +
        '<div><label class="field-label" for="mo-doc">Врач</label><input type="text" id="mo-doc" maxlength="80" list="mo-docs" placeholder="Фамилия, специальность" value="' + esc(o.doctor) + '">' + medDatalist('mo-docs', medDoctors()) + '</div></div>' +
        '<label class="field-label" for="mo-diag">Диагноз</label><textarea id="mo-diag" rows="2" placeholder="Как записал врач">' + esc(o.diagnosis) + '</textarea>' +
        '<label class="field-label">Лекарства</label><div id="mo-drugs" class="med-drugs"></div>' + medDatalist('mo-names', medDrugNames()) +
        '<button type="button" class="btn" id="mo-add" style="margin-top:0.5rem">' + ic('add') + 'Добавить лекарство</button>' +
        '<label class="field-label" for="mo-comm">Комментарии и остальные назначения</label><textarea id="mo-comm" rows="3" placeholder="Режим, диета, процедуры, анализы, когда прийти снова">' + esc(o.comment) + '</textarea>' +
        (rxDocs.length ? '<label class="field-label">Фото из «Рецептов»</label><div class="chips" id="mo-rx">' + rxDocs.map(d => '<button type="button" class="chip' + (rxSel.has(d.id) ? ' is-on' : '') + '" data-id="' + esc(d.id) + '">' + ic(medRxType(d.type).icon) + esc(medRxTitle(d)) + '</button>').join('') + '</div>' : '');
    const box = $('#mo-drugs', node);
    const pull = () => { $$('.med-drug', box).forEach((row, i) => { const d = drugs[i]; if (!d) return; d.name = $('[data-f="name"]', row).value.trim(); d.dose = $('[data-f="dose"]', row).value.trim(); d.how = $('[data-f="how"]', row).value.trim(); d.days = $('[data-f="days"]', row).value.trim(); }); };
    const draw = () => {
        box.innerHTML = drugs.map((d, i) => '<div class="med-drug"><div class="med-drug-h"><b>' + (i + 1) + '</b>' +
            '<input type="text" data-f="name" list="mo-names" maxlength="80" placeholder="Название лекарства" aria-label="Название лекарства" value="' + esc(d.name) + '">' +
            '<button type="button" class="icon-btn is-danger" data-rm="' + i + '" aria-label="Убрать лекарство">' + ic('close') + '</button></div>' +
            '<div class="med-drug-r"><input type="text" data-f="dose" maxlength="60" placeholder="Доза: 1 таблетка, 5 мл" aria-label="Доза" value="' + esc(d.dose) + '">' +
            '<input type="text" data-f="how" maxlength="100" placeholder="Как: 2 раза в день после еды" aria-label="Как принимать" value="' + esc(d.how) + '">' +
            '<input type="number" data-f="days" min="1" max="999" inputmode="numeric" placeholder="Дней" aria-label="Сколько дней принимать" value="' + esc(d.days) + '"></div></div>').join('');
    };
    draw();
    box.addEventListener('click', e => { const b = e.target.closest('[data-rm]'); if (!b) return; pull(); drugs.splice(+b.dataset.rm, 1); if (!drugs.length) drugs.push({ id: uid('md'), name: '', dose: '', how: '', days: '' }); draw(); });
    $('#mo-add', node).addEventListener('click', () => { pull(); drugs.push({ id: uid('md'), name: '', dose: '', how: '', days: '' }); draw(); const rows = $$('.med-drug', box); const inp = $('[data-f="name"]', rows[rows.length - 1]); if (inp) inp.focus(); });
    const rxBox = $('#mo-rx', node);
    if (rxBox) rxBox.addEventListener('click', e => { const b = e.target.closest('[data-id]'); if (!b) return; const id = b.dataset.id; if (rxSel.has(id)) rxSel.delete(id); else rxSel.add(id); b.classList.toggle('is-on', rxSel.has(id)); });
    openSheet({
        title: isNew ? 'Новое назначение' : 'Назначение врача', node,
        actions: [{ label: 'Отмена', value: false }, {
            label: 'Сохранить', kind: 'primary', icon: 'check',
            onClick: () => {
                pull();
                const list = drugs.filter(d => d.name).map(d => ({ id: d.id || uid('md'), name: d.name, dose: d.dose, how: d.how, days: d.days ? String(Math.max(1, Math.min(999, parseInt(d.days, 10) || 0)) || '') : '' }));
                const rec = { date: $('#mo-date', node).value || todayKey(), doctor: $('#mo-doc', node).value.trim(), diagnosis: $('#mo-diag', node).value.trim(), drugs: list, comment: $('#mo-comm', node).value.trim(), rxIds: Array.from(rxSel) };
                if (!rec.doctor && !rec.diagnosis && !list.length && !rec.comment) { toast('Заполните хотя бы одно поле'); return false; }
                if (isNew) meds.unshift(Object.assign({ id: uid('mo'), kind: 'order', createdAt: Date.now(), author: authorName() }, rec));
                else Object.assign(order, rec);
                saveMeds(); renderMedOrders();
                toast(isNew ? 'Назначение сохранено' : 'Сохранено');
            }
        }]
    });
}
async function medOrderDelete(order) {
    const plans = medOrderPlans(order);
    if (!(await confirmSheet('Удалить назначение?', 'Назначение от ' + medDateLabel(order.date) + ' будет удалено.' + (plans.length ? ' Приёмы в графике (' + plans.length + ') останутся.' : ''), 'Удалить', true))) return;
    meds = meds.filter(m => m !== order); saveMeds(); renderMedOrders(); toast('Назначение удалено');
}
function renderMedOrders() {
    const host = $('#med-orders-list'); if (!host) return;
    const list = medList('order').sort((a, b) => (b.date || '').localeCompare(a.date || '') || (b.createdAt || 0) - (a.createdAt || 0));
    $('#med-orders-count').textContent = list.length ? medFmtN(list.length, 'назначение', 'назначения', 'назначений') : '';
    if (!list.length) {
        host.innerHTML = '<div class="empty"><div class="ico-big">' + ic('medical_services') + '</div><b>Назначений пока нет</b>Нажмите «Новое» и запишите, что назначил врач: лекарства, дозы и остальные комментарии.</div>';
        return;
    }
    host.innerHTML = list.map(o => {
        const docs = (o.rxIds || []).map(medById).filter(Boolean);
        return '<article class="card med-order" data-id="' + esc(o.id) + '"><div class="card-body">' +
            '<div class="med-order-h"><div><p class="med-meta">' + ic('event') + esc(medDateLabel(o.date)) + '</p><h3>' + esc(o.doctor || 'Врач не указан') + '</h3></div>' +
            '<div class="med-acts"><button type="button" class="icon-btn" data-edit aria-label="Изменить" title="Изменить">' + ic('edit') + '</button><button type="button" class="icon-btn is-danger" data-del aria-label="Удалить" title="Удалить">' + ic('delete') + '</button></div></div>' +
            (o.diagnosis ? '<p class="med-diag"><span>Диагноз</span>' + esc(o.diagnosis) + '</p>' : '') +
            ((o.drugs || []).length ? '<ol class="med-druglist">' + o.drugs.map(d => {
                const inPlan = medOrderPlans(o, d).length > 0;
                return '<li><div class="med-dl-t"><b>' + esc(d.name) + '</b><span>' + esc([d.dose, d.how, d.days ? medFmtN(+d.days, 'день', 'дня', 'дней') : ''].filter(Boolean).join(' · ')) + '</span></div>' +
                    (inPlan ? '<span class="chip is-ok med-inplan">' + ic('event_available') + 'в графике</span>' : '<button type="button" class="btn med-toplan" data-plan="' + esc(d.id) + '" title="Добавить в график приёма">' + ic('alarm') + 'В график</button>') + '</li>';
            }).join('') + '</ol>' : '') +
            (o.comment ? '<p class="med-note med-comment">' + esc(o.comment) + '</p>' : '') +
            (docs.length ? '<div class="chips med-order-rx">' + docs.map(d => '<button type="button" class="chip" data-rx="' + esc(d.id) + '">' + ic('image') + esc(medRxTitle(d)) + '</button>').join('') + '</div>' : '') +
            '</div></article>';
    }).join('');
}
function initMedOrders() {
    $('#med-orders-new').addEventListener('click', () => medOrderFormSheet(null));
    $('#med-orders-pdf').addEventListener('click', () => { if (typeof exportMedOrdersPdf === 'function') exportMedOrdersPdf(); });
    $('#med-orders-list').addEventListener('click', e => {
        const card = e.target.closest('.med-order'); if (!card) return;
        const o = medById(card.dataset.id); if (!o) return;
        const rx = e.target.closest('[data-rx]'), pl = e.target.closest('[data-plan]');
        if (rx) { const d = medById(rx.dataset.rx); const ids = d ? (d.files || []).map(f => f.id) : []; if (ids.length) openLightbox(ids, 0); }
        else if (pl) { const d = (o.drugs || []).find(x => x.id === pl.dataset.plan); if (d && typeof medPlanFormSheet === 'function') medPlanFormSheet(null, { drug: d.name, dose: d.dose, note: d.how, days: d.days, orderId: o.id, drugId: d.id, from: todayKey() }); }
        else if (e.target.closest('[data-del]')) medOrderDelete(o);
        else if (e.target.closest('[data-edit]')) medOrderFormSheet(o);
    });
}

function initMeds() {
    $$('[data-med-open]').forEach(b => b.addEventListener('click', medOpen));
    $$('[data-med-back]').forEach(b => b.addEventListener('click', medBack));
    initMedRx(); initMedOrders();
    if (typeof initMedSchedule === 'function') initMedSchedule();
    if (typeof initMedMood === 'function') initMedMood();
}
