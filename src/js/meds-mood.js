'use strict';
// =====================================================================================================
// iLife 2.3.0 — РАЗДЕЛ «ЛЕКАРСТВА» (часть 3): страница «Дневник настроения».
//   Квадратная сетка на год: слева дни (1–31), сверху месяцы. Каждая клетка — день; она закрашена цветом,
//   который выбрал пользователь. Сетку можно масштабировать (кнопки, ползунок, «Вписать», Ctrl + колесо мыши).
//   Нажатие на клетку открывает небольшое окно у клетки: вкладка «Настроение» (17 настроений), вкладка «Цвет»
//   (палитра и свой цвет) и комментарий за этот день. Всё сохраняется сразу.
// Запись дня лежит в общей базе meds (js/meds.js):
//   { id:'mood' + дата, kind:'mood', date:'ГГГГ-ММ-ДД', mood:'ключ настроения'|'' , color:'#rrggbb'|'' , note, createdAt, author }
//   color пустой — клетка берёт цвет настроения. Номер записи зависит только от даты, поэтому день, отмеченный на двух
//   устройствах, при синхронизации остаётся одной записью (побеждает более поздняя правка).
// =====================================================================================================

(function () {
    if (!window.ICONS) return;
    window.ICONS.mood = '<path d="M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2M12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8m3.5-9c.83 0 1.5-.67 1.5-1.5S16.33 8 15.5 8 14 8.67 14 9.5s.67 1.5 1.5 1.5m-7 0c.83 0 1.5-.67 1.5-1.5S9.33 8 8.5 8 7 8.67 7 9.5 7.67 11 8.5 11m3.5 6.5c2.33 0 4.31-1.46 5.11-3.5H6.89c.8 2.04 2.78 3.5 5.11 3.5"/>';
})();

// Настроения: ключ, название, значок и цвет по умолчанию
const MOODS = [
    { k: 'joy', n: 'Весёлый', e: '😄', c: '#ffd23f' },
    { k: 'glad', n: 'Довольный', e: '🙂', c: '#8bd450' },
    { k: 'calm', n: 'Спокойный', e: '😌', c: '#5cc8c2' },
    { k: 'energy', n: 'Бодрый', e: '💪', c: '#ff9f1c' },
    { k: 'inspired', n: 'Вдохновлённый', e: '✨', c: '#b388ff' },
    { k: 'love', n: 'Влюблённый', e: '🥰', c: '#ff6fa3' },
    { k: 'grateful', n: 'Благодарный', e: '🙏', c: '#f4a8c0' },
    { k: 'none', n: 'Никакой', e: '😐', c: '#b0b4bc' },
    { k: 'tired', n: 'Уставший', e: '😩', c: '#8d99ae' },
    { k: 'sleepy', n: 'Сонный', e: '😴', c: '#a5b4fc' },
    { k: 'sad', n: 'Грустный', e: '😢', c: '#4f83cc' },
    { k: 'lonely', n: 'Одинокий', e: '🌧', c: '#6c7a9c' },
    { k: 'anxious', n: 'Тревожный', e: '😟', c: '#9b6bc7' },
    { k: 'stress', n: 'В стрессе', e: '😵', c: '#d9822b' },
    { k: 'irritated', n: 'Раздражённый', e: '😤', c: '#e8603c' },
    { k: 'angry', n: 'Злой', e: '😠', c: '#c62828' },
    { k: 'sick', n: 'Больной', e: '🤒', c: '#7a9a55' }
];
// Палитра вкладки «Цвет» (кроме неё — любой свой цвет)
const MOOD_COLORS = ['#ffd23f', '#ff9f1c', '#e8603c', '#c62828', '#ff6fa3', '#f4a8c0', '#b388ff', '#9b6bc7', '#4f83cc', '#a5b4fc', '#5cc8c2', '#2a9d8f', '#8bd450', '#7a9a55', '#b0b4bc', '#8d99ae', '#6c7a9c', '#5d4037', '#212121', '#ffffff'];
const MOOD_MONTHS = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
const MOOD_ZOOM_MIN = 12, MOOD_ZOOM_MAX = 72;

let moodYear = almatyParts().y;
let moodZoom = Number(LS.get('mood_zoom', 0)) || 0;   // размер клетки в точках; 0 — «вписать по ширине»
let moodPop = null;                                   // открытое окно дня

function moodByKey(k) { return MOODS.find(m => m.k === k) || null; }
function moodRec(date) { return meds.find(m => m && m.kind === 'mood' && m.date === date) || null; }
function moodColor(rec) { if (!rec) return ''; if (rec.color) return rec.color; const m = moodByKey(rec.mood); return m ? m.c : ''; }
// Запись дня: изменить поля; пустая запись (нет ни настроения, ни цвета, ни комментария) удаляется
function moodSet(date, patch) {
    let rec = moodRec(date);
    if (!rec) { rec = { id: 'mood' + date, kind: 'mood', date, mood: '', color: '', note: '', createdAt: Date.now(), author: authorName() }; meds.push(rec); }
    Object.assign(rec, patch);
    if (!rec.mood && !rec.color && !(rec.note || '').trim()) meds = meds.filter(m => m !== rec);
    saveMeds();
}
function moodCellSize() {
    if (moodZoom) return moodZoom;
    const wrap = $('#mood-wrap'); const w = wrap ? wrap.clientWidth : 0;
    return Math.max(MOOD_ZOOM_MIN, Math.min(48, Math.floor((w - 30 - 12 * 2) / 12) || 24));   // 30 — колонка с числами, 2 — зазор
}
function moodDateTitle(date) { const p = almatyParts(keyToMs(date)); return p.d + ' ' + MONTHS_GEN[p.mo] + ' ' + p.y + ', ' + WEEKDAYS[p.wd]; }
// тёмный или светлый значок поверх цвета клетки
function moodInk(hex) { const h = String(hex).replace('#', ''); if (h.length !== 6) return '#000'; const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16); return (r * 299 + g * 587 + b * 114) / 1000 > 150 ? '#1d1b20' : '#ffffff'; }

// ---------- Сетка ----------
function renderMedMood() {
    const grid = $('#mood-grid'); if (!grid) return;
    const today = todayKey(), size = moodCellSize();
    const byDate = new Map(); meds.forEach(m => { if (m && m.kind === 'mood' && m.date && m.date.startsWith(moodYear + '-')) byDate.set(m.date, m); });
    $('#mood-year').textContent = String(moodYear);
    grid.style.setProperty('--mood-cell', size + 'px');
    grid.classList.toggle('is-small', size < 22); grid.classList.toggle('is-big', size >= 30);
    let html = '<span class="mood-corner"></span>' + MOOD_MONTHS.map((n, i) => '<span class="mood-mo" title="' + capitalizeFirst(MONTHS_NOM[i]) + '">' + (size < 22 ? n.charAt(0) : n) + '</span>').join('');
    for (let d = 1; d <= 31; d++) {
        html += '<span class="mood-dn">' + d + '</span>';
        for (let mo = 0; mo < 12; mo++) {
            const days = new Date(Date.UTC(moodYear, mo + 1, 0)).getUTCDate();
            if (d > days) { html += '<span class="mood-cell is-void" aria-hidden="true"></span>'; continue; }
            const date = moodYear + '-' + pad2(mo + 1) + '-' + pad2(d), rec = byDate.get(date), col = moodColor(rec), m = rec ? moodByKey(rec.mood) : null;
            const label = d + ' ' + MONTHS_GEN[mo] + (m ? ': ' + m.n.toLowerCase() : rec && rec.color ? ': цвет выбран' : ': не отмечено') + (rec && rec.note ? '. ' + rec.note : '');
            html += '<button type="button" class="mood-cell' + (col ? ' is-set' : '') + (date === today ? ' is-today' : '') + (date > today ? ' is-future' : '') + (rec && rec.note ? ' has-note' : '') + '" data-d="' + date + '"' +
                (col ? ' style="background:' + esc(col) + ';color:' + moodInk(col) + '"' : '') + ' title="' + esc(label) + '" aria-label="' + esc(label) + '">' + (m && size >= 30 ? '<span class="mood-emo">' + m.e + '</span>' : '') + '</button>';
        }
    }
    grid.innerHTML = html;
    const z = $('#mood-zoom'); z.value = String(size);
    $('#mood-fit').classList.toggle('is-on', !moodZoom);
    renderMoodStats(byDate);
}
function renderMoodStats(byDate) {
    const host = $('#mood-stats'); if (!host) return;
    const counts = new Map(); let other = 0, notes = 0;
    byDate.forEach(r => { if (r.note) notes++; if (r.mood && moodByKey(r.mood)) counts.set(r.mood, (counts.get(r.mood) || 0) + 1); else if (r.color) other++; });
    const total = byDate.size;
    $('#mood-count').textContent = total ? 'отмечено ' + medFmtN(total, 'день', 'дня', 'дней') + (notes ? ' · с комментарием ' + notes : '') : '';
    if (!total) { host.innerHTML = '<p class="hint" style="margin:0">За ' + moodYear + ' год пока ничего не отмечено. Нажмите на клетку дня и выберите настроение или цвет.</p>'; return; }
    const rows = MOODS.filter(m => counts.has(m.k)).sort((a, b) => counts.get(b.k) - counts.get(a.k));
    host.innerHTML = '<div class="mood-legend">' + rows.map(m => '<span class="mood-lg"><i style="background:' + m.c + '"></i>' + m.e + ' ' + esc(m.n) + ' <b>' + counts.get(m.k) + '</b></span>').join('') +
        (other ? '<span class="mood-lg"><i class="is-any"></i>Только цвет <b>' + other + '</b></span>' : '') + '</div>';
}
function moodSetZoom(v) {
    moodZoom = v ? Math.max(MOOD_ZOOM_MIN, Math.min(MOOD_ZOOM_MAX, Math.round(v))) : 0;
    LS.set('mood_zoom', moodZoom); moodClosePop(); renderMedMood();
}

// ---------- Окно дня ----------
function moodClosePop() {
    if (!moodPop) return;
    const p = moodPop; moodPop = null;
    if (p.flush) p.flush();
    document.removeEventListener('mousedown', p.away, true); document.removeEventListener('touchstart', p.away, true); document.removeEventListener('keydown', p.key, true);
    window.removeEventListener('resize', p.place);
    p.el.remove();
    const c = $('#mood-grid .mood-cell.is-open'); if (c) c.classList.remove('is-open');
}
function moodOpenPop(cell) {
    const date = cell.dataset.d; if (!date) return;
    if (moodPop && moodPop.date === date) { moodClosePop(); return; }
    moodClosePop();
    if (date > todayKey()) { toast('Этот день ещё не наступил'); return; }
    cell.classList.add('is-open');
    let tab = LS.get('mood_tab', 'mood') === 'color' ? 'color' : 'mood';
    const el = document.createElement('div');
    el.className = 'mood-pop'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-label', 'Настроение за ' + moodDateTitle(date));
    el.innerHTML =
        '<div class="mood-pop-h"><b>' + esc(capitalizeFirst(moodDateTitle(date))) + '</b><button type="button" class="icon-btn" data-close aria-label="Закрыть">' + ic('close') + '</button></div>' +
        '<div class="seg mood-tabs" role="tablist"><button type="button" role="tab" data-tab-k="mood">' + ic('mood') + 'Настроение</button><button type="button" role="tab" data-tab-k="color">' + ic('palette') + 'Цвет</button></div>' +
        '<div class="mood-panel" data-p="mood"><div class="mood-list">' + MOODS.map(m => '<button type="button" class="mood-opt" data-m="' + m.k + '"><i style="background:' + m.c + '"></i><span class="e">' + m.e + '</span><span class="n">' + esc(m.n) + '</span></button>').join('') + '</div></div>' +
        '<div class="mood-panel" data-p="color"><div class="mood-swatches">' + MOOD_COLORS.map(c => '<button type="button" class="mood-sw" data-c="' + c + '" style="background:' + c + '" aria-label="Цвет ' + c + '"></button>').join('') + '</div>' +
        '<label class="mood-custom"><input type="color" id="mood-custom" aria-label="Свой цвет"><span>Свой цвет</span></label></div>' +
        '<label class="field-label" for="mood-note">Комментарий за день</label><textarea id="mood-note" rows="2" maxlength="600" placeholder="Что было, как себя чувствовали"></textarea>' +
        '<div class="mood-pop-a"><button type="button" class="btn btn-text is-danger" data-clear>' + ic('delete') + 'Очистить</button><button type="button" class="btn btn-primary" data-close>' + ic('check') + 'Готово</button></div>';
    document.body.appendChild(el);
    const note = $('#mood-note', el), custom = $('#mood-custom', el);
    const cur = () => moodRec(date) || { mood: '', color: '', note: '' };
    note.value = cur().note || '';
    function draw() {
        const r = cur(), col = moodColor(r);
        $$('[data-tab-k]', el).forEach(b => { const on = b.dataset.tabK === tab; b.classList.toggle('is-on', on); b.setAttribute('aria-selected', on); });
        $$('.mood-panel', el).forEach(p => { p.hidden = p.dataset.p !== tab; });
        $$('.mood-opt', el).forEach(b => b.classList.toggle('is-on', b.dataset.m === r.mood));
        $$('.mood-sw', el).forEach(b => b.classList.toggle('is-on', !!col && b.dataset.c.toLowerCase() === col.toLowerCase()));
        if (/^#[0-9a-f]{6}$/i.test(col)) custom.value = col;
        // клетка на странице обновляется сразу, без перерисовки всей сетки (иначе окно потеряло бы свою клетку)
        const m = moodByKey(r.mood);
        cell.classList.toggle('is-set', !!col); cell.classList.toggle('has-note', !!(r.note || '').trim());
        cell.style.background = col || ''; cell.style.color = col ? moodInk(col) : '';
        cell.innerHTML = m && moodCellSize() >= 30 ? '<span class="mood-emo">' + m.e + '</span>' : '';
    }
    const saveNote = () => { const v = note.value.trim(); if (v !== (cur().note || '')) { moodSet(date, { note: v }); draw(); } };
    const noteLater = debounce(saveNote, 500);
    note.addEventListener('input', noteLater);
    el.addEventListener('click', e => {
        const t = e.target.closest('[data-tab-k]'), m = e.target.closest('[data-m]'), c = e.target.closest('[data-c]');
        if (t) { tab = t.dataset.tabK; LS.set('mood_tab', tab); draw(); place(); }
        else if (m) { const same = cur().mood === m.dataset.m; moodSet(date, same ? { mood: '', color: '' } : { mood: m.dataset.m, color: '' }); draw(); }   // новое настроение — его цвет; повторное нажатие снимает
        else if (c) { moodSet(date, { color: c.dataset.c }); draw(); }
        else if (e.target.closest('[data-clear]')) { note.value = ''; moodSet(date, { mood: '', color: '', note: '' }); draw(); toast('День очищен'); }
        else if (e.target.closest('[data-close]')) moodClosePop();
    });
    custom.addEventListener('input', () => { moodSet(date, { color: custom.value }); draw(); });
    // окно ставится рядом с клеткой и не выходит за края экрана; на узком экране — по центру
    function place() {
        if (!cell.isConnected) return;
        const r = cell.getBoundingClientRect(), w = el.offsetWidth, h = el.offsetHeight, vw = window.innerWidth, vh = window.innerHeight, gap = 8;
        let left = r.left + r.width / 2 - w / 2, top = r.bottom + gap;
        if (top + h > vh - gap) top = r.top - gap - h;                 // не помещается снизу — показываем над клеткой
        if (top < gap) top = Math.max(gap, vh - h - gap);                // и сверху тесно — прижимаем к низу экрана
        left = Math.max(gap, Math.min(left, vw - w - gap));
        el.style.left = Math.round(left) + 'px'; el.style.top = Math.round(top) + 'px';
    }
    const away = e => { if (!el.contains(e.target) && !(e.target.closest && e.target.closest('.mood-cell') === cell)) moodClosePop(); };
    const key = e => { if (e.key === 'Escape') { e.stopPropagation(); moodClosePop(); cell.focus(); } };
    moodPop = { el, date, away, key, place, flush: () => { saveNote(); renderMoodStatsNow(); } };
    document.addEventListener('mousedown', away, true); document.addEventListener('touchstart', away, true); document.addEventListener('keydown', key, true);
    window.addEventListener('resize', place);
    draw(); place();
}
function renderMoodStatsNow() {
    const byDate = new Map(); meds.forEach(m => { if (m && m.kind === 'mood' && m.date && m.date.startsWith(moodYear + '-')) byDate.set(m.date, m); });
    renderMoodStats(byDate);
}

function initMedMood() {
    $('#mood-prev').addEventListener('click', () => { moodClosePop(); moodYear--; renderMedMood(); });
    $('#mood-next').addEventListener('click', () => { moodClosePop(); moodYear++; renderMedMood(); });
    $('#mood-today').addEventListener('click', () => {
        moodClosePop(); moodYear = almatyParts().y; renderMedMood();
        const c = $('#mood-grid .mood-cell.is-today'); if (c) { c.scrollIntoView({ block: 'center', inline: 'center', behavior: 'smooth' }); setTimeout(() => moodOpenPop(c), 350); }
    });
    $('#mood-grid').addEventListener('click', e => { const c = e.target.closest('.mood-cell[data-d]'); if (c) moodOpenPop(c); });
    $('#mood-zoom-out').addEventListener('click', () => moodSetZoom(moodCellSize() - 4));
    $('#mood-zoom-in').addEventListener('click', () => moodSetZoom(moodCellSize() + 4));
    $('#mood-zoom').addEventListener('input', e => moodSetZoom(+e.target.value));
    $('#mood-fit').addEventListener('click', () => moodSetZoom(0));
    // Ctrl + колесо мыши над сеткой — масштаб
    $('#mood-wrap').addEventListener('wheel', e => { if (!e.ctrlKey) return; e.preventDefault(); moodSetZoom(moodCellSize() + (e.deltaY < 0 ? 2 : -2)); }, { passive: false });
    $('#mood-wrap').addEventListener('scroll', () => { if (moodPop) moodPop.place(); }, { passive: true });
    window.addEventListener('scroll', () => { if (moodPop) moodPop.place(); }, { passive: true });
    window.addEventListener('resize', debounce(() => { if (!moodZoom && $('#med-mood').classList.contains('is-active') && !moodPop) renderMedMood(); }, 200));
}
