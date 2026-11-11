'use strict';
// =====================================================================================================
// iLife — СТРАНИЦА «СЦЕНАРИИ» (версия 1.7.0): сценарий к чему угодно киношному — фильму, короткому метру, сериалу, клипу, ролику.
//
// Запись: { id, title, kind, status, logline, genre, theme, author, createdAt, updatedAt,
//           els[]   — строки сценария: { i, t, x, m?, sy? }
//                     t: s — сцена (ИНТ. КУХНЯ — ДЕНЬ), a — действие, c — персонаж, p — ремарка, d — реплика, t — переход, n — заметка (не печатается);
//                     m — музыка в сцене [{ s: id песни, b: id блока }] (песни-контейнеры, js/songs.js); sy — коротко «о чём сцена»;
//           chars{} — заметки о персонажах: { 'АННА': 'описание' },
//           beats[] — структура: { id, title, text, done, time? },
//           notes   — свободные заметки }
// Окно ввода устроено как в профессиональных программах: Enter — следующая строка по смыслу (после «Персонажа» — «Реплика»),
// Tab — сменить вид строки, Shift+Enter — перенос внутри строки, имена персонажей и места подсказываются.
// Вывод: PDF, Fountain (открытый текстовый формат сценариев), обычный текст, печать.
// =====================================================================================================

let scripts = LS.get('scripts', []);
if (!Array.isArray(scripts)) scripts = [];
const scUi = Object.assign({ font: 15, paper: true, sort: 'new', status: 'all' }, LS.get('sc_ui', {}));
const scUiSave = () => LS.set('sc_ui', scUi);

const SC_KINDS = [
    { k: 'film', n: 'Фильм', i: 'movie' }, { k: 'short', n: 'Короткий метр', i: 'theaters' }, { k: 'series', n: 'Сериал', i: 'tv' },
    { k: 'clip', n: 'Клип', i: 'queue_music' }, { k: 'ad', n: 'Ролик / реклама', i: 'bolt' }, { k: 'anim', n: 'Анимация', i: 'auto_awesome' },
    { k: 'doc', n: 'Документальное', i: 'photo_camera' }, { k: 'stage', n: 'Спектакль', i: 'star' }, { k: 'other', n: 'Другое', i: 'edit_note' }
];
const SC_STATUS = [{ k: 'idea', n: 'Идея' }, { k: 'synopsis', n: 'Синопсис' }, { k: 'draft', n: 'Черновик' }, { k: 'rewrite', n: 'Правки' }, { k: 'final', n: 'Готово' }];
const SC_TYPES = [
    { t: 's', n: 'Сцена', ph: 'ИНТ. МЕСТО — ВРЕМЯ СУТОК', ic: 'movie' }, { t: 'a', n: 'Действие', ph: 'Что видно в кадре…', ic: 'visibility' },
    { t: 'c', n: 'Персонаж', ph: 'ИМЯ', ic: 'person' }, { t: 'p', n: 'Ремарка', ph: '(как говорит)', ic: 'text_snippet' },
    { t: 'd', n: 'Реплика', ph: 'Что говорит…', ic: 'notes' }, { t: 't', n: 'Переход', ph: 'ЗАТЕМНЕНИЕ.', ic: 'swap_horiz' }, { t: 'n', n: 'Заметка', ph: 'Заметка для себя (в печать не идёт)', ic: 'edit_note' }
];
const SC_TYPE = Object.fromEntries(SC_TYPES.map(x => [x.t, x]));
const SC_ORDER = ['a', 'c', 'd', 'p', 's', 't', 'n'];            // порядок смены вида по Tab
const SC_NEXT = { s: 'a', a: 'a', c: 'd', p: 'd', d: 'c', t: 's', n: 'a' };   // какая строка идёт после какой при Enter
const SC_UPPER = { s: true, c: true, t: true };
const SC_BEATS = {
    acts3: ['Открывающий образ', 'Завязка: привычный мир нарушен', 'Первый поворот (назад пути нет)', 'Развитие: испытания и союзники', 'Середина: всё меняется', 'Кризис: кажется, всё потеряно', 'Второй поворот', 'Кульминация', 'Развязка: новый мир'],
    short: ['Образ-крючок', 'Конфликт', 'Нарастание', 'Поворот', 'Финал и послевкусие'],
    episode: ['Холодное открытие', 'Завязка серии', 'Сюжет A', 'Сюжет B', 'Пересечение линий', 'Кульминация серии', 'Хвост-крючок на следующую'],
    clip: ['Вступление', 'Куплет 1', 'Припев', 'Куплет 2', 'Мост', 'Финал']
};
const SC_BEAT_NAMES = { acts3: 'Три акта', short: 'Короткий метр', episode: 'Эпизод сериала', clip: 'Клип по частям' };

const scById = id => scripts.find(x => x.id === id) || null;
const scKind = k => SC_KINDS.find(x => x.k === k) || SC_KINDS[8];
const scStat = k => SC_STATUS.find(x => x.k === k) || SC_STATUS[2];
function saveScripts() { if (typeof cloudLocalChanged === 'function') cloudLocalChanged(); const ok = LS.set('scripts', scripts); scSavedFlash(); return ok; }
const saveScriptsSoon = debounce(() => saveScripts(), 700);
function scSavedFlash() { const s = $('#sc-saved'); if (!s) return; s.classList.add('is-on'); s.lastElementChild.textContent = 'Сохранено'; clearTimeout(scSavedFlash.t); scSavedFlash.t = setTimeout(() => s.classList.remove('is-on'), 1600); }
function scTouch(sc) { sc.updatedAt = Date.now(); const s = $('#sc-saved'); if (s) { s.classList.add('is-on'); s.lastElementChild.textContent = 'Сохраняем…'; } saveScriptsSoon(); }

// ---------- Строки и сцены ----------
const scNewEl = (t, x) => ({ i: uid('e'), t, x: x || '' });
function scGroups(sc) {   // [{ head, items[], n }] — сцена и всё до следующей сцены; первая группа без заголовка — строки до первой сцены
    const out = [{ head: null, items: [], n: 0 }]; let n = 0;
    (sc.els || []).forEach(el => { if (el.t === 's') { out.push({ head: el, items: [], n: ++n }); } else out[out.length - 1].items.push(el); });
    if (!out[0].items.length) out.shift();
    return out;
}
const scCharKey = x => String(x || '').replace(/\([^)]*\)/g, '').replace(/\s+/g, ' ').trim().toLocaleUpperCase('ru-RU');
function scWords(x) { const m = String(x || '').trim().match(/[\p{L}\p{N}]+/gu); return m ? m.length : 0; }
const SC_COLS = { s: 58, a: 58, c: 40, p: 28, d: 34, t: 20, n: 58 };
function scLineCount(el) {
    const cols = SC_COLS[el.t] || 58; let lines = 0;
    String(el.x || '').split('\n').forEach(p => { lines += Math.max(1, Math.ceil(p.length / cols)); });
    return lines + (el.t === 'd' || el.t === 'p' || el.t === 'c' ? 0 : 1);
}
function scStats(sc) {
    const st = { scenes: 0, words: 0, lines: 0, dialogueWords: 0, actionWords: 0, cues: 0, chars: new Map(), places: { int: 0, ext: 0 }, times: {}, scenesLen: [], firstScene: new Map() };
    let curChar = '', cur = null;
    (sc.els || []).forEach(el => {
        if (el.t === 'n') return;
        const w = scWords(el.x), ln = scLineCount(el); st.lines += ln; st.words += w;
        if (el.t === 's') {
            st.scenes++; curChar = ''; cur = { n: st.scenes, el, lines: 0 }; st.scenesLen.push(cur);
            const u = String(el.x).toLocaleUpperCase('ru-RU');
            if (/^(ИНТ|INT)/.test(u)) st.places.int++; else if (/^(НАТ|EXT)/.test(u)) st.places.ext++;
            const tm = (u.match(/[—–-]\s*([А-ЯЁA-Z ]+?)\s*\.?$/) || [])[1];
            if (tm) { const k = tm.trim(); st.times[k] = (st.times[k] || 0) + 1; }
        }
        if (cur) cur.lines += ln;
        if (el.t === 'c') { curChar = scCharKey(el.x); if (curChar) { const c = st.chars.get(curChar) || { cues: 0, words: 0, scenes: new Set() }; c.cues++; c.scenes.add(st.scenes); st.chars.set(curChar, c); if (!st.firstScene.has(curChar)) st.firstScene.set(curChar, el.i); st.cues++; } }
        else if (el.t === 'd') { st.dialogueWords += w; const c = st.chars.get(curChar); if (c) c.words += w; }
        else if (el.t === 'p') { /* ремарки не считаем ни диалогом, ни действием */ }
        else { if (el.t === 'a') st.actionWords += w; curChar = el.t === 'a' || el.t === 's' || el.t === 't' ? '' : curChar; }
    });
    st.pages = Math.max(0, Math.round(st.lines / 54 * 10) / 10);
    return st;
}
function scAllChars(sc) {
    const set = new Set(Object.keys(sc.chars || {}));
    (sc.els || []).forEach(el => { if (el.t === 'c') { const k = scCharKey(el.x); if (k) set.add(k); } });
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'ru'));
}
const scHue = id => { let h = 0; String(id).split('').forEach(c => { h = (h * 31 + c.charCodeAt(0)) % 360; }); return h; };
const scPlural = (n, one, few, many) => { const a = Math.abs(n) % 100, b = a % 10; return n + ' ' + (a > 10 && a < 20 ? many : b > 1 && b < 5 ? few : b === 1 ? one : many); };

// ---------- Шаблоны ----------
function scTemplateEls(kind) {
    if (kind === 'sample') return [
        scNewEl('s', 'НАТ. ДВОР ЗАКРЫТОГО КИНОТЕАТРА — РАННЕЕ УТРО'),
        scNewEl('a', 'Мокрый асфальт блестит. На ступенях сидит МАРТА, 30, в старом плаще, и держит в руках катушку плёнки.'),
        scNewEl('a', 'Из-за угла выходит ГЛЕБ, 40, с термосом. Останавливается.'),
        scNewEl('c', 'ГЛЕБ'), scNewEl('p', '(тихо)'), scNewEl('d', 'Ты опять не ночевала дома.'),
        scNewEl('c', 'МАРТА'), scNewEl('d', 'Я дома. Просто дом сегодня здесь.'),
        scNewEl('a', 'Она поднимает катушку, как доказательство. Глеб улыбается — впервые за долгое время.'),
        scNewEl('t', 'ЗАТЕМНЕНИЕ.')
    ];
    if (kind === 'blank') return [scNewEl('s', 'ИНТ. ')];
    return [];
}

// =====================================================================================================
// Состояние страницы
// =====================================================================================================
const S = { open: null, tab: 'text', cur: null, undo: [], q: '', folded: new Set(), find: '', findAt: -1, sugg: null, speaking: false };
const sc = () => scById(S.open);

function renderScripts() {
    const host = $('#sc-lib'), ed = $('#sc-ed'); if (!host || !ed) return;
    const s = sc();
    if (S.open && !s) S.open = null;
    $('#sc-listview').hidden = !!S.open; ed.hidden = !S.open;
    if (S.open) renderEditor(); else renderLibrary();
}
function openScript(id, opts) {
    if (!scById(id)) return;
    S.open = id; S.tab = (opts && opts.tab) || 'text'; S.cur = null; S.undo = []; S.find = ''; S.folded = new Set();
    const s = scById(id); if ((s.els || []).length > 700) (scGroups(s)).forEach(g => { if (g.head) S.folded.add(g.head.i); });
    renderScripts(); window.scrollTo({ top: 0 });
}
function closeScript() { scStopSpeech(); S.open = null; renderScripts(); window.scrollTo({ top: 0 }); }

// =====================================================================================================
// БИБЛИОТЕКА
// =====================================================================================================
function renderLibrary() {
    const host = $('#sc-lib'); const q = normText(S.q).trim();
    $('#sc-count').textContent = scripts.length ? 'всего ' + scripts.length : '';
    let list = scripts.filter(s => (scUi.status === 'all' || s.status === scUi.status) && (!q || normText([s.title, s.logline, s.genre, s.theme].join(' ')).includes(q)));
    list.sort(scUi.sort === 'abc' ? (a, b) => (a.title || '').localeCompare(b.title || '', 'ru') : (a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    $('#sc-filter').innerHTML = [{ k: 'all', n: 'Все' }].concat(SC_STATUS).map(x => '<button type="button" class="chip' + (scUi.status === x.k ? ' is-on' : '') + '" data-st="' + x.k + '">' + x.n + (x.k === 'all' ? ' <small>' + scripts.length + '</small>' : ' <small>' + scripts.filter(s => s.status === x.k).length + '</small>') + '</button>').join('');
    if (!scripts.length) {
        host.innerHTML = '<div class="empty sc-empty"><div class="ico-big">' + ic('edit_note') + '</div><b>Пока нет сценариев</b>Пишите сценарий к чему угодно киношному: фильму, клипу, ролику, сериалу. Сцены, персонажи, структура, музыка из ваших песен-контейнеров — всё в одном месте.<div style="margin-top:14px"><button type="button" class="btn btn-primary" data-a="new">' + ic('add') + 'Начать сценарий</button></div></div>';
        return;
    }
    if (!list.length) { host.innerHTML = '<div class="empty"><div class="ico-big">' + ic('search') + '</div><b>Ничего не найдено</b>Измените запрос или фильтр.</div>'; return; }
    host.innerHTML = list.map(s => {
        const k = scKind(s.kind), st = scStats(s), chars = scAllChars(s).length;
        return '<article class="scl-card" data-id="' + s.id + '" style="--scl-h:' + scHue(s.id) + '"><button type="button" class="scl-open" data-a="open">' +
            '<span class="scl-poster">' + ic(k.i) + '<b>' + esc((s.title || 'Б').trim().charAt(0).toLocaleUpperCase('ru-RU')) + '</b></span>' +
            '<span class="scl-tx"><b>' + esc(s.title || 'Без названия') + '</b><span class="scl-log">' + esc(s.logline || 'Логлайн пока не написан') + '</span>' +
            '<span class="scl-chips"><span class="chip">' + esc(k.n) + '</span><span class="chip st-' + s.status + '">' + esc(scStat(s.status).n) + '</span>' + (s.genre ? '<span class="chip">' + esc(s.genre) + '</span>' : '') + '</span>' +
            '<span class="scl-meta">' + scPlural(st.scenes, 'сцена', 'сцены', 'сцен') + ' · ≈ ' + String(st.pages).replace('.', ',') + ' стр. · ' + scPlural(chars, 'персонаж', 'персонажа', 'персонажей') + ' · ' + esc(fmtDate(s.updatedAt || s.createdAt)) + '</span></span></button>' +
            '<button type="button" class="icon-btn" data-a="menu" aria-label="Действия">' + ic('more_vert') + '</button></article>';
    }).join('');
}
function scNewSheet() {
    let kind = 'film', tpl = 'blank';
    const kinds = SC_KINDS.map(k => '<button type="button" class="chip' + (k.k === kind ? ' is-on' : '') + '" data-k="' + k.k + '">' + ic(k.i) + k.n + '</button>').join('');
    const tpls = [['blank', 'Чистый лист'], ['sample', 'С примером сцены'], ['acts3', 'Структура в три акта'], ['clip', 'Клип: по частям песни']].map(x => '<button type="button" class="chip' + (x[0] === tpl ? ' is-on' : '') + '" data-t="' + x[0] + '">' + x[1] + '</button>').join('');
    const sheet = openSheet({
        title: 'Новый сценарий',
        html: '<label class="field-label" for="scn-title">Название</label><input type="text" id="scn-title" maxlength="80" autocomplete="off" placeholder="Рабочее название можно поменять потом">' +
            '<span class="field-label" style="margin-top:14px">Что пишем</span><div class="chips" id="scn-kinds">' + kinds + '</div>' +
            '<span class="field-label" style="margin-top:14px">С чего начать</span><div class="chips" id="scn-tpls">' + tpls + '</div>' +
            '<p class="hint" style="margin-top:12px">Структуру («биты») и музыку из ваших песен можно добавить в любой момент.</p>',
        actions: [{ label: 'Отмена' }, { label: 'Создать', kind: 'primary', icon: 'check', onClick() {
            const now = Date.now(), title = $('#scn-title', sheet.el).value.trim() || 'Без названия';
            const s = { id: uid('sc'), title, kind, status: 'idea', logline: '', genre: '', theme: '', author: authorName(), createdAt: now, updatedAt: now, els: scTemplateEls(tpl === 'sample' ? 'sample' : 'blank'), chars: {}, beats: [], notes: '' };
            if (tpl === 'acts3' || tpl === 'clip') s.beats = SC_BEATS[tpl].map(t => ({ id: uid('bt'), title: t, text: '', done: false }));
            if (tpl === 'clip') s.kind = 'clip';
            if (tpl === 'sample' && kind === 'film') { /* оставляем */ }
            scripts.unshift(s);
            if (!saveScripts()) { scripts.shift(); return false; }
            openScript(s.id, { tab: tpl === 'acts3' || tpl === 'clip' ? 'beats' : 'text' });
            toast('Сценарий создан');
        } }]
    });
    $('#scn-kinds', sheet.el).addEventListener('click', e => { const b = e.target.closest('[data-k]'); if (!b) return; kind = b.dataset.k; $$('#scn-kinds .chip', sheet.el).forEach(c => c.classList.toggle('is-on', c === b)); });
    $('#scn-tpls', sheet.el).addEventListener('click', e => { const b = e.target.closest('[data-t]'); if (!b) return; tpl = b.dataset.t; $$('#scn-tpls .chip', sheet.el).forEach(c => c.classList.toggle('is-on', c === b)); });
    setTimeout(() => { try { $('#scn-title', sheet.el).focus(); } catch (e) {} }, 250);
}
function scLibMenu(id) {
    const s = scById(id); if (!s) return;
    const sheet = openSheet({
        title: s.title || 'Без названия',
        html: '<div class="ss-menu"><button type="button" class="btn btn-wide" data-m="open">' + ic('edit') + 'Открыть</button><button type="button" class="btn btn-wide" data-m="dup">' + ic('filter_none') + 'Сделать копию</button>' +
            '<button type="button" class="btn btn-wide" data-m="pdf">' + ic('picture_as_pdf') + 'Сохранить PDF</button><button type="button" class="btn btn-wide" data-m="fountain">' + ic('download') + 'Fountain (.fountain)</button>' +
            '<button type="button" class="btn btn-wide" data-m="txt">' + ic('description') + 'Текст (.txt)</button><button type="button" class="btn btn-danger btn-wide" data-m="del">' + ic('delete') + 'Удалить</button></div>',
        actions: [{ label: 'Закрыть' }]
    });
    sheet.body.addEventListener('click', async e => {
        const b = e.target.closest('[data-m]'); if (!b) return; sheet.close(); const m = b.dataset.m;
        if (m === 'open') openScript(id);
        else if (m === 'dup') { const c = JSON.parse(JSON.stringify(s)); c.id = uid('sc'); c.title = (s.title || 'Без названия') + ' (копия)'; c.createdAt = c.updatedAt = Date.now(); c.els.forEach(el => { el.i = uid('e'); }); scripts.unshift(c); saveScripts(); renderLibrary(); toast('Копия создана'); }
        else if (m === 'pdf') scExportPdf(s); else if (m === 'fountain') scExportFile(s, 'fountain'); else if (m === 'txt') scExportFile(s, 'txt');
        else if (m === 'del') scDelete(id);
    });
}
async function scDelete(id) {
    const s = scById(id); if (!s) return;
    if (!(await confirmSheet('Удалить сценарий?', '«' + (s.title || 'Без названия') + '» будет удалён с этого устройства и с Google Диска (при следующей синхронизации). Это нельзя отменить.', 'Удалить', true))) return;
    scripts = scripts.filter(x => x.id !== id); if (S.open === id) S.open = null; saveScripts(); renderScripts(); toast('Сценарий удалён');
}

// =====================================================================================================
// РЕДАКТОР
// =====================================================================================================
const SC_TABS = [{ k: 'text', n: 'Текст', i: 'edit_note' }, { k: 'scenes', n: 'Сцены', i: 'view_list' }, { k: 'chars', n: 'Персонажи', i: 'groups' }, { k: 'beats', n: 'Структура', i: 'format_list_numbered' }, { k: 'notes', n: 'Заметки', i: 'notes' }, { k: 'stats', n: 'Обзор', i: 'bar_chart' }];
function renderEditor() {
    const s = sc(); if (!s) return;
    const k = scKind(s.kind);
    $('#sc-head').innerHTML =
        '<button type="button" class="icon-btn" data-a="back" aria-label="К списку сценариев">' + ic('arrow_back') + '</button>' +
        '<div class="sc-ttl"><input type="text" class="sc-title" id="sc-title" maxlength="80" value="' + esc(s.title) + '" placeholder="Название сценария" aria-label="Название сценария">' +
        '<div class="sc-sub"><label class="sc-kind">' + ic(k.i) + '<select id="sc-kind" aria-label="Вид">' + SC_KINDS.map(x => '<option value="' + x.k + '"' + (x.k === s.kind ? ' selected' : '') + '>' + x.n + '</option>').join('') + '</select></label>' +
        '<label class="sc-stsel st-' + s.status + '"><select id="sc-status" aria-label="Стадия">' + SC_STATUS.map(x => '<option value="' + x.k + '"' + (x.k === s.status ? ' selected' : '') + '>' + x.n + '</option>').join('') + '</select></label>' +
        '<span class="sc-saved" id="sc-saved">' + ic('check') + '<span>Сохранено</span></span></div></div>' +
        '<button type="button" class="icon-btn" data-a="emenu" aria-label="Меню сценария">' + ic('more_vert') + '</button>';
    $('#sc-tabs').innerHTML = SC_TABS.map(t => '<button type="button" data-tab2="' + t.k + '" class="' + (S.tab === t.k ? 'is-on' : '') + '">' + ic(t.i) + '<span>' + t.n + '</span></button>').join('');
    $('#sc-ed').dataset.tab = S.tab;
    ['text', 'scenes', 'chars', 'beats', 'notes', 'stats'].forEach(t => { const p = $('#sc-p-' + t); if (p) p.hidden = S.tab !== t; });
    $('#sc-toolbar').hidden = S.tab !== 'text';
    if (S.tab === 'text') renderText(); else if (S.tab === 'scenes') renderScenes(); else if (S.tab === 'chars') renderChars();
    else if (S.tab === 'beats') renderBeats(); else if (S.tab === 'notes') renderNotes(); else renderStats();
    paintToolbar();
}
function scSetTab(k) { S.tab = k; hideSugg(); renderEditor(); window.scrollTo({ top: 0, behavior: 'smooth' }); }
function scPushUndo(label) { const s = sc(); if (!s) return; S.undo.push({ label, els: JSON.stringify(s.els) }); if (S.undo.length > 30) S.undo.shift(); paintToolbar(); }
function scUndo() {
    const s = sc(), u = S.undo.pop(); if (!s || !u) { toast('Отменять пока нечего'); return; }
    s.els = JSON.parse(u.els); scTouch(s); renderEditor(); toast('Отменено: ' + u.label);
}

// ---------- Вкладка «Текст» ----------
function elRowHtml(el, head) {
    const T = SC_TYPE[el.t] || SC_TYPE.a;
    return '<div class="se' + (head ? ' sc-gh' : '') + '" data-t="' + el.t + '" data-i="' + el.i + '">' +
        (head ? '<button type="button" class="icon-btn sc-fold" data-a="fold" aria-label="Свернуть сцену">' + ic('expand_more') + '</button><span class="sc-no"></span>' : '<span class="se-tag">' + T.n + '</span>') +
        '<textarea class="se-x" rows="1" spellcheck="true" autocapitalize="sentences" placeholder="' + esc(T.ph) + '" aria-label="' + T.n + '">\n' + esc(el.x) + '</textarea>' +
        (head ? '<button type="button" class="icon-btn sc-mus" data-a="music" aria-label="Добавить музыку в сцену" title="Музыка в сцене: блок из песни-контейнера">' + ic('music_note') + '</button>' : '') + '</div>';
}
function musicChipsHtml(el) {
    const items = (el.m || []).map((m, k) => '<span class="chip sc-mchip" data-k="' + k + '"><button type="button" class="sc-mopen" data-a="mopen" data-s="' + esc(m.s) + '" data-b="' + esc(m.b || '') + '">' + ic('music_note') + '<span>' + esc(songRefLabel(m)) + '</span></button><button type="button" class="icon-btn chip-x" data-a="mrm" data-k="' + k + '" aria-label="Убрать музыку">' + ic('close') + '</button></span>').join('');
    return items;
}
function groupHtml(g, sceneCount) {
    if (!g.head) return '<section class="sc-grp sc-grp0"><div class="sc-gb">' + g.items.map(el => elRowHtml(el)).join('') + '</div></section>';
    const folded = S.folded.has(g.head.i);
    const sy = g.head.sy != null ? g.head.sy : '';
    return '<section class="sc-grp' + (folded ? ' is-folded' : '') + '" data-g="' + g.head.i + '">' + elRowHtml(g.head, true) +
        '<div class="sc-chips" data-m="' + g.head.i + '">' + musicChipsHtml(g.head) + '</div>' +
        '<div class="sc-sy"><input type="text" class="sc-syin" maxlength="140" value="' + esc(sy) + '" placeholder="О чём сцена, одной строкой (необязательно)" aria-label="О чём сцена"></div>' +
        '<div class="sc-gb">' + g.items.map(el => elRowHtml(el)).join('') + '</div></section>';
}
function renderText() {
    const s = sc(), root = $('#sc-text'); if (!root) return;
    root.style.setProperty('--sc-fs', scUi.font + 'px'); root.classList.toggle('is-paper', !!scUi.paper);
    const groups = scGroups(s);
    if (!groups.length) {
        root.innerHTML = '<div class="empty"><div class="ico-big">' + ic('edit_note') + '</div><b>Сценарий пуст</b>Начните со сцены: где мы и когда. Дальше Enter сам предложит нужную строку.<div style="margin-top:14px"><button type="button" class="btn btn-primary" data-a="first">' + ic('add') + 'Первая сцена</button></div></div>';
        return;
    }
    root.innerHTML = groups.map(g => groupHtml(g)).join('') +
        '<div class="sc-endpad"><button type="button" class="btn" data-a="addscene">' + ic('add') + 'Новая сцена</button><button type="button" class="btn" data-a="addline">' + ic('add') + 'Строка в конец</button></div>';
    root.querySelectorAll('.se').forEach(row => { const ta = $('.se-x', row); fit(ta); });
    scNumberScenes();
    if (S.cur) { const ta = $('.se[data-i="' + S.cur + '"] .se-x', root); if (ta && document.activeElement !== ta) ta.focus({ preventScroll: true }); }
}
function scNumberScenes() { $$('#sc-text .sc-gh .sc-no').forEach((n, i) => { n.textContent = String(i + 1); }); }
function fit(ta) { if (!ta) return; ta.style.height = 'auto'; ta.style.height = (ta.scrollHeight + 1) + 'px'; }
function scFocus(id, pos) {
    const ta = $('#sc-text .se[data-i="' + id + '"] .se-x'); if (!ta) return;
    const grp = ta.closest('.sc-grp'); if (grp && grp.classList.contains('is-folded')) { grp.classList.remove('is-folded'); S.folded.delete(grp.dataset.g); }
    ta.focus({ preventScroll: true }); const p = pos == null ? ta.value.length : pos; try { ta.setSelectionRange(p, p); } catch (e) {}
    const r = ta.getBoundingClientRect(); if (r.top < 120 || r.bottom > window.innerHeight - 160) ta.scrollIntoView({ block: 'center', behavior: 'smooth' });
}
function scRowDom(id) { return $('#sc-text .se[data-i="' + id + '"]'); }
function scAddRowAfter(prev, ne, pos) {   // новая строка сразу после prev — без перерисовки всего сценария
    const s = sc(), i = s.els.findIndex(x => x.i === prev.i); s.els.splice(i + 1, 0, ne);
    if (ne.t === 's') { renderText(); scFocus(ne.i, pos); return; }
    const row = scRowDom(prev.i); if (!row) { renderText(); scFocus(ne.i, pos); return; }
    const html = elRowHtml(ne);
    if (row.classList.contains('sc-gh')) row.closest('.sc-grp').querySelector('.sc-gb').insertAdjacentHTML('afterbegin', html); else row.insertAdjacentHTML('afterend', html);
    const nr = scRowDom(ne.i); fit($('.se-x', nr)); scFocus(ne.i, pos);
}
function scSetType(el, t) {
    if (el.t === t) return; const wasScene = el.t === 's';
    if (wasScene || t === 's') { scPushUndo('смена вида строки'); el.t = t; if (t !== 's') { delete el.m; delete el.sy; } if (SC_UPPER[t]) el.x = el.x.toLocaleUpperCase('ru-RU'); scTouch(sc()); S.cur = el.i; renderText(); scFocus(el.i); paintToolbar(); return; }
    el.t = t; if (SC_UPPER[t]) el.x = el.x.toLocaleUpperCase('ru-RU');
    const row = scRowDom(el.i); if (row) { row.dataset.t = t; $('.se-tag', row).textContent = SC_TYPE[t].n; const ta = $('.se-x', row); ta.placeholder = SC_TYPE[t].ph; ta.value = el.x; fit(ta); ta.focus({ preventScroll: true }); }
    scTouch(sc()); paintToolbar();
}
function scDetect(el, ta) {   // «ИНТ. …» набрано в действии — это сцена; «(…» в реплике — ремарка
    if (el.t === 'a' && /^(ИНТ|НАТ|INT|EXT)[.\/ ]/i.test(ta.value.trim()) && ta.value.trim().length > 4) { scSetType(el, 's'); return true; }
    if (el.t === 'd' && /^\(/.test(ta.value) && !ta.value.includes('\n')) { scSetType(el, 'p'); return true; }
    return false;
}
// Подсказки: имена персонажей и места
function hideSugg() { if (S.sugg) { S.sugg.box.remove(); S.sugg = null; } }
function showSugg(el, ta) {
    const s = sc(); let pool = [];
    const v = ta.value.trim().toLocaleUpperCase('ru-RU');
    if (el.t === 'c') pool = scAllChars(s); else if (el.t === 's') { pool = Array.from(new Set(s.els.filter(x => x.t === 's' && x.i !== el.i).map(x => x.x.trim().toLocaleUpperCase('ru-RU')).filter(Boolean))); ['ИНТ. ', 'НАТ. ', 'ИНТ./НАТ. '].forEach(p => pool.push(p)); }
    const items = v ? pool.filter(p => p.startsWith(v) && p !== v).slice(0, 6) : [];
    hideSugg(); if (!items.length) return;
    const box = document.createElement('div'); box.className = 'sc-sugg'; box.setAttribute('role', 'listbox');
    box.innerHTML = items.map((x, k) => '<button type="button" role="option" data-k="' + k + '"' + (k === 0 ? ' class="is-on"' : '') + '>' + esc(x) + '</button>').join('');
    ta.closest('.se').appendChild(box); S.sugg = { box, items, idx: 0, el, ta };
}
function acceptSugg() {
    const g = S.sugg; if (!g) return false;
    const val = g.items[g.idx]; g.ta.value = val; g.el.x = val; fit(g.ta); hideSugg(); scTouch(sc()); return true;
}
function scTextKeydown(e, ta) {
    const s = sc(), row = ta.closest('.se'), i = s.els.findIndex(x => x.i === row.dataset.i); if (i < 0) return; const el = s.els[i];
    if (S.sugg) {
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); const g = S.sugg; g.idx = (g.idx + (e.key === 'ArrowDown' ? 1 : g.items.length - 1)) % g.items.length; $$('button', g.box).forEach((b, k) => b.classList.toggle('is-on', k === g.idx)); return; }
        if (e.key === 'Escape') { hideSugg(); return; }
        if (e.key === 'Tab') { e.preventDefault(); acceptSugg(); return; }
        if (e.key === 'Enter' && !e.shiftKey) acceptSugg();
    }
    if (e.key === 'Tab') {
        e.preventDefault(); const k = SC_ORDER.indexOf(el.t), n = SC_ORDER[(k + (e.shiftKey ? SC_ORDER.length - 1 : 1)) % SC_ORDER.length]; scSetType(el, n); return;
    }
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        const v = ta.value, a = ta.selectionStart, b = ta.selectionEnd;
        if (!v.trim() && el.t !== 'a' && el.t !== 's') { scSetType(el, 'a'); return; }   // пустая строка + Enter → «Действие» (как в профессиональных программах)
        scPushUndo('новая строка');
        if (a < v.length && el.t !== 's') {   // курсор внутри: делим строку надвое
            const head = v.slice(0, a), tail = v.slice(b); el.x = head; ta.value = head; fit(ta);
            const ne = scNewEl(el.t, tail); scAddRowAfter(el, ne, 0); scTouch(s); return;
        }
        const ne = scNewEl(SC_NEXT[el.t] || 'a', el.t === 's' ? '' : ''); scAddRowAfter(el, ne, 0); scTouch(s); paintToolbar(); return;
    }
    if (e.key === 'Backspace' && ta.selectionStart === 0 && ta.selectionEnd === 0 && i > 0) {
        const prev = s.els[i - 1];
        if (!ta.value) {   // пустую строку удаляем
            e.preventDefault(); scPushUndo('удаление строки'); s.els.splice(i, 1);
            if (el.t === 's') { renderText(); scFocus(prev.i); } else { const r = scRowDom(el.i); if (r) r.remove(); scFocus(prev.i); }
            scTouch(s); return;
        }
        if (prev.t !== 's' && el.t !== 's') {   // склеиваем с предыдущей
            e.preventDefault(); scPushUndo('склейка строк'); const pos = prev.x.length; prev.x += (prev.x && !/\s$/.test(prev.x) ? ' ' : '') + ta.value; s.els.splice(i, 1);
            const r = scRowDom(el.i); if (r) r.remove(); const pt = $('#sc-text .se[data-i="' + prev.i + '"] .se-x'); if (pt) { pt.value = prev.x; fit(pt); }
            scFocus(prev.i, Math.min(prev.x.length, pos + 1)); scTouch(s);
        }
        return;
    }
    if (e.key === 'ArrowUp' && ta.selectionStart === ta.selectionEnd && ta.value.slice(0, ta.selectionStart).indexOf('\n') < 0 && isFirstVisualLine(ta) && i > 0) { e.preventDefault(); const p = s.els[i - 1]; scFocus(p.i, p.x.length); }
    else if (e.key === 'ArrowDown' && ta.selectionStart === ta.selectionEnd && ta.value.slice(ta.selectionEnd).indexOf('\n') < 0 && isLastVisualLine(ta) && i < s.els.length - 1) { e.preventDefault(); scFocus(s.els[i + 1].i, 0); }
}
function isFirstVisualLine(ta) { const lh = parseFloat(getComputedStyle(ta).lineHeight) || 20; return ta.scrollHeight <= lh * 1.6 || ta.selectionStart < Math.max(8, ta.value.length * 0.0) + (ta.clientWidth / 9); }
function isLastVisualLine(ta) { const lh = parseFloat(getComputedStyle(ta).lineHeight) || 20; return ta.scrollHeight <= lh * 1.6 || ta.value.length - ta.selectionEnd < (ta.clientWidth / 9); }
function paintToolbar() {
    const s = sc(), bar = $('#sc-toolbar'); if (!bar || !s) return;
    const cur = S.cur && s.els.find(x => x.i === S.cur);
    bar.querySelectorAll('[data-type]').forEach(b => b.classList.toggle('is-on', !!cur && cur.t === b.dataset.type));
    const u = bar.querySelector('[data-a="undo"]'); if (u) u.disabled = !S.undo.length;
}
function scInitTextEvents() {
    const root = $('#sc-text');
    root.addEventListener('input', e => {
        const ta = e.target.closest('.se-x'); const sy = e.target.closest('.sc-syin');
        const s = sc(); if (!s) return;
        if (sy) { const el = s.els.find(x => x.i === sy.closest('.sc-grp').dataset.g); if (el) { el.sy = sy.value; scTouch(s); } return; }
        if (!ta) return; const el = s.els.find(x => x.i === ta.closest('.se').dataset.i); if (!el) return;
        el.x = ta.value; fit(ta); S.cur = el.i;
        if (!scDetect(el, ta)) { if (el.t === 'c' || el.t === 's') showSugg(el, ta); else hideSugg(); }
        scTouch(s);
    });
    root.addEventListener('keydown', e => { const ta = e.target.closest('.se-x'); if (ta) scTextKeydown(e, ta); });
    root.addEventListener('focusin', e => { const row = e.target.closest('.se'); if (row) { S.cur = row.dataset.i; paintToolbar(); } });
    root.addEventListener('focusout', e => {
        const ta = e.target.closest('.se-x'); if (!ta) return; const s = sc(); if (!s) return;
        const el = s.els.find(x => x.i === ta.closest('.se').dataset.i); if (!el) return;
        setTimeout(() => { if (S.sugg && S.sugg.ta === ta && !(document.activeElement && S.sugg.box.contains(document.activeElement))) hideSugg(); }, 120);
        if (SC_UPPER[el.t] && ta.value !== ta.value.toLocaleUpperCase('ru-RU')) { ta.value = ta.value.toLocaleUpperCase('ru-RU'); el.x = ta.value; fit(ta); scTouch(s); }
    });
    root.addEventListener('mousedown', e => { const b = e.target.closest('.sc-sugg button'); if (b && S.sugg) { e.preventDefault(); S.sugg.idx = +b.dataset.k; const ta = S.sugg.ta; acceptSugg(); ta.focus(); } });
    root.addEventListener('click', async e => {
        const b = e.target.closest('[data-a]'); if (!b) return; const s = sc(); if (!s) return; const act = b.dataset.a;
        const grp = b.closest('.sc-grp'), head = grp && s.els.find(x => x.i === grp.dataset.g);
        if (act === 'fold') { grp.classList.toggle('is-folded'); if (grp.classList.contains('is-folded')) S.folded.add(grp.dataset.g); else { S.folded.delete(grp.dataset.g); $$('.se-x', grp).forEach(fit); } }
        else if (act === 'first') { const ne = scNewEl('s', 'ИНТ. '); s.els.push(ne); scTouch(s); renderText(); scFocus(ne.i); }
        else if (act === 'addscene') { const ne = scNewEl('s', 'ИНТ. '); scPushUndo('новая сцена'); s.els.push(ne); scTouch(s); renderText(); scFocus(ne.i); }
        else if (act === 'addline') { const last = s.els[s.els.length - 1], ne = scNewEl(last ? SC_NEXT[last.t] || 'a' : 's', ''); scPushUndo('новая строка'); s.els.push(ne); scTouch(s); renderText(); scFocus(ne.i); }
        else if (act === 'music' && head) { const ref = await songPickBlock(); if (ref) { head.m = (head.m || []).concat([ref]); scTouch(s); const c = $('.sc-chips', grp); c.innerHTML = musicChipsHtml(head); toast('Музыка добавлена в сцену'); } }
        else if (act === 'mrm' && head) { head.m = (head.m || []).filter((_, k) => k !== +b.dataset.k); scTouch(s); $('.sc-chips', grp).innerHTML = musicChipsHtml(head); }
        else if (act === 'mopen') { if (songById(b.dataset.s)) openSongStudio(b.dataset.s, b.dataset.b || undefined); else toast('Эта песня удалена'); }
    });
    // панель вида строк
    $('#sc-toolbar').addEventListener('click', e => {
        const s = sc(); if (!s) return; const t = e.target.closest('[data-type]'), a = e.target.closest('[data-a]');
        if (t) { let cur = S.cur && s.els.find(x => x.i === S.cur); if (!cur) { cur = s.els[s.els.length - 1]; if (!cur) { const ne = scNewEl(t.dataset.type, ''); s.els.push(ne); renderText(); scFocus(ne.i); return; } } scSetType(cur, t.dataset.type); }
        else if (a) {
            const act = a.dataset.a;
            if (act === 'undo') scUndo();
            else if (act === 'next') { const cur = S.cur && s.els.find(x => x.i === S.cur); if (cur) { scPushUndo('новая строка'); scAddRowAfter(cur, scNewEl(SC_NEXT[cur.t] || 'a', ''), 0); scTouch(s); } else { const ne = scNewEl('s', 'ИНТ. '); s.els.push(ne); renderText(); scFocus(ne.i); } }
            else if (act === 'find') scToggleFind();
            else if (act === 'fontminus') { scUi.font = Math.max(12, scUi.font - 1); scUiSave(); $('#sc-text').style.setProperty('--sc-fs', scUi.font + 'px'); $$('#sc-text .se-x').forEach(fit); }
            else if (act === 'fontplus') { scUi.font = Math.min(24, scUi.font + 1); scUiSave(); $('#sc-text').style.setProperty('--sc-fs', scUi.font + 'px'); $$('#sc-text .se-x').forEach(fit); }
            else if (act === 'paper') { scUi.paper = !scUi.paper; scUiSave(); $('#sc-text').classList.toggle('is-paper', scUi.paper); a.classList.toggle('is-on', scUi.paper); }
            else if (act === 'readscene') scSpeak(s, S.cur);
        }
    });
}

// ---------- Поиск по тексту ----------
function scToggleFind() {
    const bar = $('#sc-find'); bar.hidden = !bar.hidden;
    if (!bar.hidden) { const i = $('#sc-find-in'); i.focus(); i.select(); } else S.find = '';
}
function scFindStep(dir) {
    const s = sc(), q = normText(S.find); if (!s || !q) return;
    const n = s.els.length; let k = S.findAt;
    for (let step = 1; step <= n; step++) {
        const j = ((k + dir * step) % n + n) % n, el = s.els[j];
        const at = normText(el.x).indexOf(q);
        if (at >= 0) {
            S.findAt = j; scFocus(el.i, at); const ta = $('#sc-text .se[data-i="' + el.i + '"] .se-x'); if (ta) { try { ta.setSelectionRange(at, at + q.length); } catch (e) {} }
            $('#sc-find-info').textContent = (j + 1) + ' из ' + n + ' строк'; return;
        }
    }
    $('#sc-find-info').textContent = 'Не найдено';
}
function scReplaceAll() {
    const s = sc(), f = $('#sc-find-in').value, r = $('#sc-replace-in').value; if (!s || !f) return;
    const re = new RegExp(f.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'giu'); let n = 0;
    scPushUndo('замена');
    s.els.forEach(el => { const nx = el.x.replace(re, () => { n++; return SC_UPPER[el.t] ? r.toLocaleUpperCase('ru-RU') : r; }); el.x = nx; });
    scTouch(s); renderText(); toast(n ? 'Заменено: ' + n : 'Ничего не найдено');
}

// ---------- Вкладка «Сцены» ----------
function renderScenes() {
    const s = sc(), host = $('#sc-p-scenes'), groups = scGroups(s).filter(g => g.head), st = scStats(s);
    if (!groups.length) { host.innerHTML = '<div class="empty"><div class="ico-big">' + ic('view_list') + '</div><b>Сцен пока нет</b>Они появятся здесь, как только вы напишете первую во вкладке «Текст».</div>'; return; }
    const maxLines = Math.max(1, ...st.scenesLen.map(x => x.lines));
    host.innerHTML = '<p class="hint" style="margin:0 0.5rem 0.75rem">Сцены карточками: переставляйте стрелками, пишите «о чём» одной строкой, привязывайте музыку.</p><div class="scn-grid">' + groups.map((g, k) => {
        const sl = st.scenesLen[k] || { lines: 0 }, chars = new Set();
        let cc = ''; g.items.forEach(el => { if (el.t === 'c') { cc = scCharKey(el.x); if (cc) chars.add(cc); } });
        return '<article class="scn-card" data-g="' + g.head.i + '" style="--scn-h:' + (k * 37 + 250) % 360 + '"><header><span class="scn-no">' + g.n + '</span><b>' + esc(g.head.x || 'Без названия') + '</b>' +
            '<button type="button" class="icon-btn" data-a="up" aria-label="Выше"' + (k === 0 ? ' disabled' : '') + '>' + ic('keyboard_arrow_up') + '</button><button type="button" class="icon-btn" data-a="down" aria-label="Ниже"' + (k === groups.length - 1 ? ' disabled' : '') + '>' + ic('keyboard_arrow_down') + '</button></header>' +
            '<input type="text" class="scn-sy" maxlength="140" value="' + esc(g.head.sy || '') + '" placeholder="О чём сцена, одной строкой" aria-label="О чём сцена">' +
            '<div class="scn-len" title="Длина сцены"><i style="width:' + Math.max(4, sl.lines / maxLines * 100) + '%"></i></div>' +
            '<div class="chips scn-chips">' + (chars.size ? Array.from(chars).slice(0, 6).map(c => '<span class="chip">' + esc(c) + '</span>').join('') : '<span class="hint">без реплик</span>') +
            (g.head.m || []).map(m => '<span class="chip sc-mchip"><button type="button" class="sc-mopen" data-a="mopen" data-s="' + esc(m.s) + '" data-b="' + esc(m.b || '') + '">' + ic('music_note') + '<span>' + esc(songRefLabel(m)) + '</span></button></span>').join('') + '</div>' +
            '<footer><button type="button" class="btn btn-text" data-a="goto">' + ic('edit') + 'Править</button>' + ('speechSynthesis' in window ? '<button type="button" class="btn btn-text" data-a="read">' + ic('volume_up') + 'Прочитать</button>' : '') + '<button type="button" class="btn btn-text" data-a="dup">' + ic('filter_none') + 'Копия</button><button type="button" class="btn btn-text is-danger" data-a="del">' + ic('delete') + 'Удалить</button></footer></article>';
    }).join('') + '</div>';
}
function scGroupRange(s, headId) {
    const a = s.els.findIndex(x => x.i === headId); if (a < 0) return null; let b = a + 1; while (b < s.els.length && s.els[b].t !== 's') b++;
    return { a, b };
}
function scInitScenesEvents() {
    const host = $('#sc-p-scenes');
    host.addEventListener('input', e => { const inp = e.target.closest('.scn-sy'); if (!inp) return; const s = sc(), el = s.els.find(x => x.i === inp.closest('.scn-card').dataset.g); if (el) { el.sy = inp.value; scTouch(s); } });
    host.addEventListener('click', async e => {
        const b = e.target.closest('[data-a]'); if (!b) return; const s = sc(), card = b.closest('.scn-card'), id = card && card.dataset.g, act = b.dataset.a;
        if (act === 'mopen') { if (songById(b.dataset.s)) openSongStudio(b.dataset.s, b.dataset.b || undefined); return; }
        const r = id && scGroupRange(s, id); if (!r) return;
        if (act === 'goto') { S.tab = 'text'; S.cur = id; renderEditor(); setTimeout(() => scFocus(id, 0), 60); }
        else if (act === 'read') scSpeak(s, id);
        else if (act === 'up' || act === 'down') {
            const heads = s.els.filter(x => x.t === 's'), k = heads.findIndex(x => x.i === id), o = heads[k + (act === 'up' ? -1 : 1)]; if (!o) return;
            const ro = scGroupRange(s, o.i); scPushUndo('перенос сцены');
            const mine = s.els.splice(r.a, r.b - r.a); const idx = act === 'up' ? ro.a : ro.b - mine.length; s.els.splice(idx, 0, ...mine);
            scTouch(s); renderScenes(); const nc = $('.scn-card[data-g="' + id + '"]'); if (nc) { nc.classList.add('is-moved'); setTimeout(() => nc.classList.remove('is-moved'), 600); }
        } else if (act === 'dup') { scPushUndo('копия сцены'); const copy = s.els.slice(r.a, r.b).map(x => Object.assign({}, x, { i: uid('e'), m: x.m ? x.m.slice() : undefined })); s.els.splice(r.b, 0, ...copy); scTouch(s); renderScenes(); toast('Копия сцены добавлена ниже'); }
        else if (act === 'del') { if (!(await confirmSheet('Удалить сцену?', 'Сцена и весь её текст будут удалены. Сразу после этого можно нажать «Отменить» в панели вкладки «Текст».', 'Удалить', true))) return; scPushUndo('удаление сцены'); s.els.splice(r.a, r.b - r.a); scTouch(s); renderScenes(); toast('Сцена удалена', { action: 'Отменить', onAction: scUndo }); }
    });
}

// ---------- Вкладка «Персонажи» ----------
function renderChars() {
    const s = sc(), host = $('#sc-p-chars'), st = scStats(s), names = scAllChars(s);
    const maxW = Math.max(1, ...Array.from(st.chars.values()).map(c => c.words));
    host.innerHTML = '<div class="sc-charbar"><input type="text" id="sc-char-new" maxlength="40" placeholder="Новый персонаж" aria-label="Имя нового персонажа"><button type="button" class="btn btn-primary" data-a="add">' + ic('person_add') + 'Добавить</button></div>' +
        (names.length ? '<div class="chr-grid">' + names.map(n => {
            const c = st.chars.get(n) || { cues: 0, words: 0, scenes: new Set() };
            return '<article class="chr-card" data-n="' + esc(n) + '" style="--chr-h:' + scHue(n) + '"><header><span class="chr-av">' + esc(n.charAt(0)) + '</span><div><b>' + esc(n) + '</b><span class="hint">' + scPlural(c.cues, 'реплика', 'реплики', 'реплик') + ' · слов: ' + c.words + ' · сцен: ' + c.scenes.size + '</span></div>' +
                '<button type="button" class="icon-btn" data-a="rename" aria-label="Переименовать">' + ic('edit') + '</button></header>' +
                '<div class="chr-bar" title="Доля слов в диалогах"><i style="width:' + (c.words / maxW * 100) + '%"></i></div>' +
                '<textarea class="chr-bio" rows="3" placeholder="Кто это: возраст, характер, чего хочет, чего боится, как говорит…" aria-label="О персонаже ' + esc(n) + '">' + esc((s.chars || {})[n] || '') + '</textarea>' +
                '<footer>' + (st.firstScene.has(n) ? '<button type="button" class="btn btn-text" data-a="goto">' + ic('edit') + 'К первой реплике</button>' : '<span class="hint">В тексте пока не говорит</span>') + '</footer></article>';
        }).join('') + '</div>' : '<div class="empty"><div class="ico-big">' + ic('groups') + '</div><b>Персонажей пока нет</b>Они появятся сами, когда вы напишете строку «Персонаж» в тексте, или добавьте здесь вручную.</div>');
}
function scInitCharsEvents() {
    const host = $('#sc-p-chars');
    host.addEventListener('input', e => { const ta = e.target.closest('.chr-bio'); if (!ta) return; const s = sc(); s.chars = s.chars || {}; const n = ta.closest('.chr-card').dataset.n; if (ta.value.trim()) s.chars[n] = ta.value; else delete s.chars[n]; scTouch(s); });
    host.addEventListener('click', e => {
        const b = e.target.closest('[data-a]'); if (!b) return; const s = sc(), act = b.dataset.a, card = b.closest('.chr-card'), n = card && card.dataset.n;
        if (act === 'add') {
            const inp = $('#sc-char-new'), name = scCharKey(inp.value); if (!name) { toast('Напишите имя'); return; }
            s.chars = s.chars || {}; if (!(name in s.chars)) s.chars[name] = ''; scTouch(s); renderChars(); toast('Персонаж добавлен');
        } else if (act === 'goto') { const st = scStats(s), id = st.firstScene.get(n); if (id) { S.tab = 'text'; S.cur = id; renderEditor(); setTimeout(() => scFocus(id, 0), 60); } }
        else if (act === 'rename') {
            const sheet = openSheet({ title: 'Переименовать ' + n, html: '<p class="hint" style="margin-bottom:10px">Имя поменяется во всех строках «Персонаж» этого сценария. Если такое имя уже есть, персонажи объединятся.</p><input type="text" id="chr-rn" maxlength="40" autocomplete="off">',
                actions: [{ label: 'Отмена' }, { label: 'Переименовать', kind: 'primary', icon: 'check', onClick() {
                    const nn = scCharKey($('#chr-rn', sheet.el).value); if (!nn) { toast('Напишите имя'); return false; } if (nn === n) return;
                    scPushUndo('переименование'); let c = 0;
                    s.els.forEach(el => { if (el.t === 'c' && scCharKey(el.x) === n) { el.x = el.x.replace(/^[^(]*/, nn + ' ').replace(/\s+$/, '').replace(/\s{2,}/g, ' '); c++; } });
                    s.chars = s.chars || {}; if (s.chars[n]) { s.chars[nn] = [s.chars[nn], s.chars[n]].filter(Boolean).join('\n\n'); } delete s.chars[n];
                    scTouch(s); renderChars(); toast('Готово: строк изменено ' + c);
                } }] });
            $('#chr-rn', sheet.el).value = n; setTimeout(() => $('#chr-rn', sheet.el).select(), 200);
        }
    });
}

// ---------- Вкладка «Структура» ----------
function renderBeats() {
    const s = sc(), host = $('#sc-p-beats'), beats = s.beats || [];
    const done = beats.filter(b => b.done).length;
    host.innerHTML = '<div class="bt-top"><div class="bt-prog" title="Готовность структуры"><i style="width:' + (beats.length ? done / beats.length * 100 : 0) + '%"></i></div><span class="hint">' + (beats.length ? 'готово ' + done + ' из ' + beats.length : 'Структура — это опорные точки истории. Заполняйте их кратко, потом разворачивайте в сцены.') + '</span></div>' +
        '<div class="btn-group bt-acts"><button type="button" class="btn" data-a="tpl">' + ic('tips_and_updates') + 'Взять шаблон</button><button type="button" class="btn" data-a="song">' + ic('music_note') + 'Из блоков песни</button><button type="button" class="btn btn-primary" data-a="add">' + ic('add') + 'Новый бит</button></div>' +
        (beats.length ? '<ol class="bt-list">' + beats.map((b, k) => '<li class="bt' + (b.done ? ' is-done' : '') + '" data-id="' + b.id + '"><div class="bt-head"><button type="button" class="bt-check" data-a="done" aria-label="Готово" aria-pressed="' + !!b.done + '">' + ic(b.done ? 'check_circle' : 'radio_button_unchecked') + '</button><span class="bt-n">' + (k + 1) + '</span>' +
            '<input type="text" class="bt-title" maxlength="80" value="' + esc(b.title) + '" placeholder="Название бита" aria-label="Название бита">' + (b.time ? '<span class="chip">' + esc(b.time) + '</span>' : '') +
            '<button type="button" class="icon-btn" data-a="up" aria-label="Выше"' + (k === 0 ? ' disabled' : '') + '>' + ic('keyboard_arrow_up') + '</button><button type="button" class="icon-btn" data-a="down" aria-label="Ниже"' + (k === beats.length - 1 ? ' disabled' : '') + '>' + ic('keyboard_arrow_down') + '</button><button type="button" class="icon-btn is-danger" data-a="del" aria-label="Удалить бит">' + ic('delete') + '</button></div>' +
            '<textarea class="bt-text" rows="2" placeholder="Что здесь происходит, что меняется для героя…" aria-label="Описание бита">' + esc(b.text) + '</textarea></li>').join('') + '</ol>' : '<div class="empty"><div class="ico-big">' + ic('format_list_numbered') + '</div><b>Структуры пока нет</b>Возьмите шаблон («Три акта», «Короткий метр», «Эпизод сериала»), соберите биты из блоков вашей песни или добавьте свои.</div>');
    $$('.bt-text', host).forEach(fit);
}
function scBeatSongSheet() {
    if (!songs.length) { toast('Сначала загрузите песню на странице «Идеи»'); return; }
    const s = sc();
    const sheet = openSheet({ title: 'Биты из блоков песни', html: '<p class="hint" style="margin-bottom:10px">Каждый блок песни станет битом: подпись — название, заметка — описание, время — метка.</p>' +
        songs.map(sg => '<button type="button" class="btn btn-wide" style="margin-bottom:8px" data-s="' + sg.id + '">' + ic('music_note') + esc(songTitleOf(sg)) + ' · блоков: ' + (sg.blocks || []).length + '</button>').join(''), actions: [{ label: 'Отмена' }] });
    sheet.body.addEventListener('click', e => {
        const b = e.target.closest('[data-s]'); if (!b) return; const sg = songById(b.dataset.s); sheet.close(); if (!sg) return;
        const bl = songBlocks(sg); if (!bl.length) { toast('В этой песне пока нет блоков'); return; }
        s.beats = (s.beats || []).concat(bl.map(x => ({ id: uid('bt'), title: x.label || 'Блок ' + fmtClock(x.start), text: x.note || '', done: false, time: fmtClock(x.start) + '–' + fmtClock(x.end) })));
        scTouch(s); renderBeats(); toast('Добавлено битов: ' + bl.length);
    });
}
function scInitBeatsEvents() {
    const host = $('#sc-p-beats');
    host.addEventListener('input', e => {
        const s = sc(), li = e.target.closest('.bt'); if (!li) return; const b = (s.beats || []).find(x => x.id === li.dataset.id); if (!b) return;
        if (e.target.classList.contains('bt-title')) b.title = e.target.value; else if (e.target.classList.contains('bt-text')) { b.text = e.target.value; fit(e.target); } scTouch(s);
    });
    host.addEventListener('click', e => {
        const btn = e.target.closest('[data-a]'); if (!btn) return; const s = sc(), act = btn.dataset.a, li = btn.closest('.bt'), id = li && li.dataset.id; s.beats = s.beats || [];
        if (act === 'add') { s.beats.push({ id: uid('bt'), title: '', text: '', done: false }); scTouch(s); renderBeats(); const t = $$('.bt-title', host).pop(); if (t) t.focus(); }
        else if (act === 'song') scBeatSongSheet();
        else if (act === 'tpl') {
            const sheet = openSheet({ title: 'Шаблон структуры', html: '<div class="ss-menu">' + Object.keys(SC_BEAT_NAMES).map(k => '<button type="button" class="btn btn-wide" data-k="' + k + '">' + ic('format_list_numbered') + SC_BEAT_NAMES[k] + '<small style="opacity:.7"> · ' + SC_BEATS[k].length + '</small></button>').join('') + '</div><p class="hint" style="margin-top:10px">Шаблон добавится к уже написанным битам.</p>', actions: [{ label: 'Отмена' }] });
            sheet.body.addEventListener('click', ev => { const b = ev.target.closest('[data-k]'); if (!b) return; sheet.close(); s.beats = s.beats.concat(SC_BEATS[b.dataset.k].map(t => ({ id: uid('bt'), title: t, text: '', done: false }))); scTouch(s); renderBeats(); });
        } else {
            const k = s.beats.findIndex(x => x.id === id); if (k < 0) return;
            if (act === 'done') { s.beats[k].done = !s.beats[k].done; scTouch(s); renderBeats(); }
            else if (act === 'del') { s.beats.splice(k, 1); scTouch(s); renderBeats(); }
            else if (act === 'up' && k > 0) { [s.beats[k - 1], s.beats[k]] = [s.beats[k], s.beats[k - 1]]; scTouch(s); renderBeats(); }
            else if (act === 'down' && k < s.beats.length - 1) { [s.beats[k + 1], s.beats[k]] = [s.beats[k], s.beats[k + 1]]; scTouch(s); renderBeats(); }
        }
    });
}

// ---------- Вкладка «Заметки» ----------
function renderNotes() {
    const s = sc(), host = $('#sc-p-notes');
    const used = []; (s.els || []).forEach(el => (el.m || []).forEach(m => used.push(m)));
    host.innerHTML = '<label class="field-label" for="sc-logline">Логлайн (суть в одном-двух предложениях)</label><textarea id="sc-logline" rows="2" maxlength="400" placeholder="Кто, чего хочет, что мешает и что стоит на кону">' + esc(s.logline) + '</textarea>' +
        '<div class="sc-two"><div><label class="field-label" for="sc-genre">Жанр и тон</label><input type="text" id="sc-genre" maxlength="60" value="' + esc(s.genre) + '" placeholder="Драма, чёрная комедия…"></div><div><label class="field-label" for="sc-theme">Тема</label><input type="text" id="sc-theme" maxlength="80" value="' + esc(s.theme) + '" placeholder="О чём на самом деле"></div></div>' +
        '<label class="field-label" for="sc-notes" style="margin-top:14px">Свободные заметки</label><textarea id="sc-notes" rows="9" placeholder="Референсы, наблюдения, обрывки диалогов, вопросы к себе…">' + esc(s.notes) + '</textarea>' +
        '<h3 class="sc-h3" style="margin-top:18px">' + ic('music_note') + 'Музыка в сценарии</h3>' +
        (used.length ? '<div class="chips">' + used.map(m => '<span class="chip sc-mchip"><button type="button" class="sc-mopen" data-a="mopen" data-s="' + esc(m.s) + '" data-b="' + esc(m.b || '') + '">' + ic('music_note') + '<span>' + esc(songRefLabel(m)) + '</span></button></span>').join('') + '</div>' : '<p class="hint">Пока нет. В тексте у каждой сцены есть кнопка ♪ — она привязывает блок песни-контейнера к сцене.</p>');
    fit($('#sc-logline')); fit($('#sc-notes'));
}
function scInitNotesEvents() {
    const host = $('#sc-p-notes');
    host.addEventListener('input', e => {
        const s = sc(), id = e.target.id; if (!s) return;
        if (id === 'sc-logline') s.logline = e.target.value; else if (id === 'sc-genre') s.genre = e.target.value; else if (id === 'sc-theme') s.theme = e.target.value; else if (id === 'sc-notes') s.notes = e.target.value; else return;
        if (e.target.tagName === 'TEXTAREA') fit(e.target); scTouch(s);
    });
    host.addEventListener('click', e => { const b = e.target.closest('[data-a="mopen"]'); if (b) { if (songById(b.dataset.s)) openSongStudio(b.dataset.s, b.dataset.b || undefined); else toast('Эта песня удалена'); } });
}

// ---------- Вкладка «Обзор» ----------
function renderStats() {
    const s = sc(), host = $('#sc-p-stats'), st = scStats(s);
    const tile = (v, l, ico) => '<div class="stt"><span class="stt-i">' + ic(ico) + '</span><b data-count="' + v + '">0</b><span>' + l + '</span></div>';
    const chars = Array.from(st.chars.entries()).sort((a, b) => b[1].words - a[1].words).slice(0, 8), tot = Math.max(1, st.dialogueWords);
    const mins = Math.round(st.pages);
    const dlg = st.dialogueWords, act = st.actionWords, sum = Math.max(1, dlg + act);
    host.innerHTML = '<div class="stt-grid">' + tile(st.pages, 'страниц ≈', 'description') + tile(mins, 'минут экрана ≈', 'timer') + tile(st.scenes, 'сцен', 'movie') + tile(scAllChars(s).length, 'персонажей', 'groups') + tile(st.words, 'слов', 'text_snippet') + tile(st.cues, 'реплик', 'notes') + '</div>' +
        '<div class="card stt-card"><h3 class="sc-h3">Действие и диалог</h3><div class="stt-split"><i class="a" style="width:' + (act / sum * 100) + '%"></i><i class="d" style="width:' + (dlg / sum * 100) + '%"></i></div><div class="stt-legend"><span><i class="a"></i>действие ' + Math.round(act / sum * 100) + '%</span><span><i class="d"></i>диалог ' + Math.round(dlg / sum * 100) + '%</span></div></div>' +
        '<div class="card stt-card"><h3 class="sc-h3">Кто говорит больше всех</h3>' + (chars.length ? chars.map(([n, c]) => '<div class="stt-row"><span>' + esc(n) + '</span><div class="chr-bar"><i style="width:' + (c.words / tot * 100) + '%;--chr-h:' + scHue(n) + '"></i></div><small>' + Math.round(c.words / tot * 100) + '%</small></div>').join('') : '<p class="hint">Пока нет реплик.</p>') + '</div>' +
        '<div class="card stt-card"><h3 class="sc-h3">Ритм сцен</h3>' + (st.scenesLen.length ? '<div class="stt-rhythm">' + st.scenesLen.map(x => '<button type="button" data-g="' + x.el.i + '" title="' + esc('Сцена ' + x.n + ': ' + x.el.x) + '" style="height:' + Math.max(8, x.lines / Math.max(1, ...st.scenesLen.map(y => y.lines)) * 100) + '%;--scn-h:' + ((x.n - 1) * 37 + 250) % 360 + '"></button>').join('') + '</div><p class="hint" style="margin-top:6px">Высота столбика — длина сцены. Нажмите, чтобы перейти к сцене.</p>' : '<p class="hint">Пока нет сцен.</p>') +
        '<div class="chips" style="margin-top:8px">' + (st.places.int ? '<span class="chip">ИНТ. ' + st.places.int + '</span>' : '') + (st.places.ext ? '<span class="chip">НАТ. ' + st.places.ext + '</span>' : '') + Object.entries(st.times).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k, v]) => '<span class="chip">' + esc(k.toLocaleLowerCase('ru-RU')) + ' ' + v + '</span>').join('') + '</div></div>';
    // числа «набегают»
    const rm = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
    $$('[data-count]', host).forEach(b => {
        const target = parseFloat(b.dataset.count) || 0, dec = String(target).includes('.'), fmt = v => (dec ? v.toFixed(1).replace('.', ',') : Math.round(v).toLocaleString('ru-RU'));
        if (rm) { b.textContent = fmt(target); return; }
        const t0 = performance.now(); const step = now => { const k = Math.min(1, (now - t0) / 700), e = 1 - Math.pow(1 - k, 3); b.textContent = fmt(target * e); if (k < 1) requestAnimationFrame(step); }; requestAnimationFrame(step);
    });
    $$('.stt-rhythm button', host).forEach(b => b.addEventListener('click', () => { S.tab = 'text'; S.cur = b.dataset.g; renderEditor(); setTimeout(() => scFocus(b.dataset.g, 0), 60); }));
}

// ---------- Чтение вслух (стол-репетиция) ----------
function scStopSpeech() { try { if ('speechSynthesis' in window) speechSynthesis.cancel(); } catch (e) {} S.speaking = false; const b = $('#sc-speak-stop'); if (b) b.hidden = true; }
function scSpeak(s, fromId) {
    if (!('speechSynthesis' in window)) { toast('Чтение вслух не поддерживается в этом браузере'); return; }
    scStopSpeech();
    let a = Math.max(0, s.els.findIndex(x => x.i === fromId)); if (fromId && s.els[a] && s.els[a].t !== 's') { while (a > 0 && s.els[a].t !== 's') a--; }
    let b = a + 1; while (b < s.els.length && s.els[b].t !== 's') b++;
    const voices = speechSynthesis.getVoices().filter(v => /^ru/i.test(v.lang)); let cur = '';
    const q = []; s.els.slice(a, b).forEach(el => {
        if (el.t === 'n' || !el.x.trim()) return;
        if (el.t === 'c') { cur = scCharKey(el.x); return; }
        const u = new SpeechSynthesisUtterance(el.x); u.lang = 'ru-RU';
        if (el.t === 'd' || el.t === 'p') { const h = scHue(cur || 'x'); u.pitch = 0.7 + (h % 70) / 100; u.rate = el.t === 'p' ? 0.9 : 1; if (voices.length) u.voice = voices[h % voices.length]; }
        else { u.rate = 1.05; u.pitch = 1; if (voices[0]) u.voice = voices[0]; if (el.t === 's') u.rate = 0.95; }
        q.push(u);
    });
    if (!q.length) { toast('В сцене нечего читать'); return; }
    S.speaking = true; const stop = $('#sc-speak-stop'); if (stop) stop.hidden = false;
    q.forEach((u, k) => { if (k === q.length - 1) u.onend = () => scStopSpeech(); speechSynthesis.speak(u); });
    toast('Читаем сцену вслух — персонажи говорят разными голосами');
}

// =====================================================================================================
// ВЫВОД: Fountain, текст, PDF, печать
// =====================================================================================================
function scFountain(s) {
    const L = [];
    L.push('Title: ' + (s.title || 'Без названия')); L.push('Credit: Автор'); L.push('Author: ' + (s.author || authorName())); L.push('Draft date: ' + fmtDateShort(s.updatedAt || Date.now()));
    if (s.logline) L.push('Notes: ' + s.logline.replace(/\n/g, ' ')); L.push('', '===', '');
    s.els.forEach(el => {
        const x = el.x.replace(/\s+$/, '');
        if (el.t === 'n') { if (x) L.push('[[' + x.replace(/\n/g, ' ') + ']]', ''); return; }
        if (!x && el.t !== 'a') return;
        if (el.t === 's') L.push('', '.' + x.toLocaleUpperCase('ru-RU') + (el.sy ? ' [[' + el.sy + ']]' : ''), '');
        else if (el.t === 'a') L.push(x.split('\n').map(l => /^[.!@>~=#]|^[A-ZА-ЯЁ0-9 ,.'’-]+$/.test(l) && l.trim() ? '!' + l : l).join('\n'), '');
        else if (el.t === 'c') L.push('@' + x.toLocaleUpperCase('ru-RU'));
        else if (el.t === 'p') L.push(/^\(.*\)$/.test(x) ? x : '(' + x.replace(/^\(|\)$/g, '') + ')');
        else if (el.t === 'd') L.push(x.replace(/\n{2,}/g, '\n \n'), '');
        else if (el.t === 't') L.push('', '> ' + x.toLocaleUpperCase('ru-RU'), '');
    });
    return L.join('\n').replace(/\n{3,}/g, '\n\n') + '\n';
}
function scPlainText(s) {
    const L = [(s.title || 'Без названия').toLocaleUpperCase('ru-RU'), 'Автор: ' + (s.author || authorName()), fmtDateShort(s.updatedAt || Date.now()), '', ''];
    const ind = { s: 0, a: 0, c: 22, p: 16, d: 10, t: 48 }, wrap = { s: 60, a: 60, c: 38, p: 30, d: 36, t: 14 };
    let no = 0;
    s.els.forEach(el => {
        if (el.t === 'n') return; let x = el.x.trim(); if (!x) return;
        if (el.t === 's') { no++; x = no + '. ' + x.toLocaleUpperCase('ru-RU'); L.push(''); }
        if (el.t === 'c' || el.t === 't') x = x.toLocaleUpperCase('ru-RU');
        const w = wrap[el.t] || 60, pad = ' '.repeat(ind[el.t] || 0);
        x.split('\n').forEach(par => {
            let line = ''; par.split(/\s+/).forEach(word => { if ((line + ' ' + word).trim().length > w && line) { L.push(pad + line); line = word; } else line = (line + ' ' + word).trim(); });
            if (line) L.push(pad + line);
        });
        if (el.t !== 'c' && el.t !== 'p' && !(el.t === 'd')) L.push('');
        if (el.t === 'd') L.push('');
    });
    return L.join('\n').replace(/\n{3,}/g, '\n\n') + '\n';
}
async function scExportFile(s, kind) {
    const text = kind === 'fountain' ? scFountain(s) : scPlainText(s);
    const base = songSafe((s.title || 'Сценарий') + '_' + dayKey(s.updatedAt || Date.now()), 80);
    const blob = new Blob(['﻿' + text], { type: 'text/plain;charset=utf-8' });
    const res = await deliverFile(blob, base + '.' + kind);
    toast(res === 'unsupported' ? 'В этом приложении сохранить файл нельзя — откройте iLife в браузере' : res === 'shared' ? 'Файл готов — выберите, куда отправить' : 'Файл сохранён: ' + base + '.' + kind);
}
async function scExportPdf(s) {
    try {
        if (typeof PdfWriter === 'undefined' || !window.PDF_FONTS) { toast('PDF сейчас недоступен'); return; }
        const pdf = new PdfWriter({ title: s.title || 'Сценарий', footer: (s.title || 'Сценарий') + ' · iLife' });
        pdf.gap(150);
        pdf.para((s.title || 'Без названия').toLocaleUpperCase('ru-RU'), { size: 26, bold: true, lh: 1.15, indent: 40, width: pdf.cw - 80 });
        pdf.gap(10); pdf.para(scKind(s.kind).n + (s.genre ? ' · ' + s.genre : ''), { size: 12, color: '#49454f', indent: 40 });
        pdf.gap(24); pdf.para('Автор: ' + (s.author || authorName()), { size: 12, indent: 40 }); pdf.para(fmtDate(s.updatedAt || Date.now(), true), { size: 11, color: '#79747e', indent: 40 });
        if (s.logline) { pdf.gap(30); pdf.para(s.logline, { size: 11, color: '#49454f', indent: 40, width: pdf.cw - 120 }); }
        pdf.newPage(); let no = 0;
        const fmt = { s: { ind: 0, w: pdf.cw, bold: true }, a: { ind: 0, w: pdf.cw }, c: { ind: 150, w: 260, bold: false }, p: { ind: 110, w: 200 }, d: { ind: 70, w: 300 }, t: { ind: 330, w: 150, bold: true } };
        s.els.forEach(el => {
            if (el.t === 'n') return; let x = el.x.trim(); if (!x) return; const f = fmt[el.t] || fmt.a;
            if (el.t === 's') { no++; x = no + '.  ' + x.toLocaleUpperCase('ru-RU'); pdf.gap(10); pdf.ensure(48); }
            if (el.t === 'c') { x = x.toLocaleUpperCase('ru-RU'); pdf.gap(4); pdf.ensure(40); }
            if (el.t === 't') x = x.toLocaleUpperCase('ru-RU');
            pdf.para(x, { size: 11.5, lh: 1.38, indent: f.ind, width: f.w, bold: !!f.bold, color: el.t === 'p' ? '#49454f' : '#1d1b20' });
            if (el.t !== 'c' && el.t !== 'p') pdf.gap(el.t === 'd' ? 5 : 7);
        });
        const blob = await pdf.build(), name = songSafe((s.title || 'Сценарий') + '_' + dayKey(s.updatedAt || Date.now()), 80) + '.pdf';
        const res = await deliverFile(blob, name);
        toast(res === 'unsupported' ? 'В этом приложении сохранить PDF нельзя — откройте iLife в браузере' : res === 'shared' ? 'PDF готов — выберите, куда отправить' : 'PDF скачан: ' + name);
    } catch (e) { console.error(e); toast('Не удалось собрать PDF'); }
}
function scPrint(s) {
    let host = $('#sc-print'); if (!host) { host = document.createElement('div'); host.id = 'sc-print'; document.body.appendChild(host); }
    let no = 0;
    host.innerHTML = '<div class="scp-title"><h1>' + esc(s.title || 'Без названия') + '</h1><p>' + esc(s.author || authorName()) + '</p></div>' +
        s.els.filter(el => el.t !== 'n' && el.x.trim()).map(el => '<p class="scp scp-' + el.t + '">' + (el.t === 's' ? (++no) + '. ' : '') + esc(SC_UPPER[el.t] ? el.x.toLocaleUpperCase('ru-RU') : el.x).replace(/\n/g, '<br>') + '</p>').join('');
    document.body.classList.add('is-printing-script');
    const done = () => { document.body.classList.remove('is-printing-script'); window.removeEventListener('afterprint', done); };
    window.addEventListener('afterprint', done);
    try { window.print(); } catch (e) { done(); toast('Печать недоступна — сохраните PDF'); }
    setTimeout(() => { if (document.body.classList.contains('is-printing-script')) done(); }, 60000);
}
function scEditorMenu() {
    const s = sc(); if (!s) return;
    const sheet = openSheet({
        title: 'Сценарий',
        html: '<div class="ss-menu"><button type="button" class="btn btn-wide" data-m="pdf">' + ic('picture_as_pdf') + 'Сохранить PDF</button><button type="button" class="btn btn-wide" data-m="fountain">' + ic('download') + 'Fountain (.fountain)</button>' +
            '<button type="button" class="btn btn-wide" data-m="txt">' + ic('description') + 'Текст (.txt)</button><button type="button" class="btn btn-wide" data-m="print">' + ic('print') + 'Печать</button>' +
            ('speechSynthesis' in window ? '<button type="button" class="btn btn-wide" data-m="read">' + ic('volume_up') + 'Прочитать вслух с начала</button>' : '') +
            '<button type="button" class="btn btn-danger btn-wide" data-m="del">' + ic('delete') + 'Удалить сценарий</button></div>' +
            '<p class="hint" style="margin-top:10px">Fountain — открытый формат: файл открывается во многих сценарных программах.</p>', actions: [{ label: 'Закрыть' }]
    });
    sheet.body.addEventListener('click', e => {
        const b = e.target.closest('[data-m]'); if (!b) return; sheet.close(); const m = b.dataset.m;
        if (m === 'pdf') scExportPdf(s); else if (m === 'fountain') scExportFile(s, 'fountain'); else if (m === 'txt') scExportFile(s, 'txt'); else if (m === 'print') scPrint(s);
        else if (m === 'read') scSpeak(s, null); else if (m === 'del') scDelete(s.id);
    });
}

// =====================================================================================================
// Подключение
// =====================================================================================================
function initScripts() {
    if (!$('#scripts')) return;
    $('#sc-new').addEventListener('click', scNewSheet);
    $('#sc-lib').addEventListener('click', e => {
        const b = e.target.closest('[data-a]'); if (!b) return; const card = b.closest('.scl-card'), id = card && card.dataset.id;
        if (b.dataset.a === 'new') scNewSheet(); else if (b.dataset.a === 'open' && id) openScript(id); else if (b.dataset.a === 'menu' && id) scLibMenu(id);
    });
    $('#sc-filter').addEventListener('click', e => { const b = e.target.closest('[data-st]'); if (!b) return; scUi.status = b.dataset.st; scUiSave(); renderLibrary(); });
    $('#sc-q').addEventListener('input', debounce(e => { S.q = e.target.value; renderLibrary(); }, 150));
    $('#sc-sort').addEventListener('change', e => { scUi.sort = e.target.value; scUiSave(); renderLibrary(); });
    $('#sc-sort').value = scUi.sort;
    $('#sc-head').addEventListener('click', e => { const b = e.target.closest('[data-a]'); if (!b) return; if (b.dataset.a === 'back') closeScript(); else if (b.dataset.a === 'emenu') scEditorMenu(); });
    $('#sc-head').addEventListener('input', e => { const s = sc(); if (s && e.target.id === 'sc-title') { s.title = e.target.value; scTouch(s); } });
    $('#sc-head').addEventListener('change', e => {
        const s = sc(); if (!s) return;
        if (e.target.id === 'sc-kind') { s.kind = e.target.value; scTouch(s); const k = scKind(s.kind); e.target.closest('.sc-kind').firstElementChild.outerHTML = ic(k.i); }
        else if (e.target.id === 'sc-status') { s.status = e.target.value; scTouch(s); e.target.closest('.sc-stsel').className = 'sc-stsel st-' + s.status; }
    });
    $('#sc-tabs').addEventListener('click', e => { const b = e.target.closest('[data-tab2]'); if (b) scSetTab(b.dataset.tab2); });
    $('#sc-find-in').addEventListener('input', e => { S.find = e.target.value; S.findAt = -1; $('#sc-find-info').textContent = ''; });
    $('#sc-find').addEventListener('click', e => { const b = e.target.closest('[data-f]'); if (!b) return; const f = b.dataset.f; if (f === 'next') scFindStep(1); else if (f === 'prev') scFindStep(-1); else if (f === 'all') scReplaceAll(); else if (f === 'close') scToggleFind(); });
    $('#sc-find-in').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); scFindStep(e.shiftKey ? -1 : 1); } else if (e.key === 'Escape') scToggleFind(); });
    $('#sc-speak-stop').addEventListener('click', scStopSpeech);
    $('#sc-toolbar').addEventListener('mousedown', e => { if (e.target.closest('button')) e.preventDefault(); });   // кнопки панели не отбирают фокус у строки: на телефоне клавиатура не закрывается
    scInitTextEvents(); scInitScenesEvents(); scInitCharsEvents(); scInitBeatsEvents(); scInitNotesEvents();
    document.addEventListener('keydown', e => {
        if (!S.open || sheetStack.length || !$('#scripts').classList.contains('is-active')) return;
        if ((e.ctrlKey || e.metaKey) && (e.key === 'f' || e.key === 'F' || e.key === 'а' || e.key === 'А') && S.tab === 'text') { e.preventDefault(); scToggleFind(); }
        else if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'z' || e.key === 'Z')) { e.preventDefault(); scUndo(); }
    });
    renderScripts();
}
