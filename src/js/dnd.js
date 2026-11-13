'use strict';
// =====================================================================================================
// iLife 2.0.0 — РАЗДЕЛ «ДНД» (настольные ролевые игры): данные, меню, страницы «Игры» и «Настройки», импорт из Miro.
//
// Игра (проект) — одна запись в списке dndGames (localStorage ilife_dnd_games, синхронизируется через Google Диск вместе
// с остальными списками, см. gdrive.js):
//   { id, title, system, status, desc, hue, coverId?, source: 'created'|'miro'|'file', createdAt, updatedAt,
//     files{}  — сведения о картинках игры (id → { name, type }); сами картинки лежат в IndexedDB (BlobDB), как вложения идей,
//     board{ items[], grid, snap }  — доска «Карточек и Заметок» (стикеры, карточки, текст, фигуры, рамки, картинки, рисунок, связи),
//     plot { items[] }              — схема «Сюжета» (блоки со стрелками),
//     chars[]                       — персонажи (js/dnd-chars.js) }
// Положение и масштаб доски запоминаются только на этом устройстве (ilife_dnd_views): в синхронизацию они не попадают.
//
// Меню: у главного меню появилась кнопка «ДНД». Она заменяет меню своим (Игры, Карточки и Заметки, Персонажи, Вижуал, Сюжет,
// Настройки) с кнопкой «Назад»; признак — html[data-nav="dnd"]. Страницы раздела: id dnd-games … dnd-settings (js/app.js, TABS).
// =====================================================================================================

let dndGames = LS.get('dnd_games', []);
if (!Array.isArray(dndGames)) dndGames = [];
let dndActiveId = LS.get('dnd_active', '');
const dndCfg = Object.assign({ grid: true, snap: false, minimap: true, textScale: 100, confirmDelete: true, system: 'D&D 5e', stickyColor: '#fff3a3', cols: 5, sections: {}, autoTags: true, autoTagsAdd: true, autoDeck: true }, LS.get('dnd_cfg', {}));
const dndCfgSave = () => LS.set('dnd_cfg', dndCfg);
const dndUi = Object.assign({ q: '', filter: 'all', sort: 'new' }, LS.get('dnd_ui', {}));
const dndUiSave = () => LS.set('dnd_ui', { q: '', filter: dndUi.filter, sort: dndUi.sort });

const DND_TABS = ['dnd-games', 'dnd-builder', 'dnd-chars', 'dnd-visual', 'dnd-plot', 'dnd-settings'];
const DND_SYSTEMS = ['D&D 5e', 'D&D 5.5 (2024)', 'Pathfinder 2e', 'Call of Cthulhu', 'Другая система'];
const DND_STATUS = [{ k: 'idea', n: 'Идея' }, { k: 'prep', n: 'Подготовка' }, { k: 'run', n: 'Идёт' }, { k: 'pause', n: 'Пауза' }, { k: 'done', n: 'Завершена' }];
const DND_HUES = [265, 330, 12, 38, 140, 175, 205, 235];

// Карточки доски: виды и цвета (Карточки и Заметки) и блоки сюжета
const BD_CARD_KINDS = [
    { k: 'char', n: 'Персонаж', c: '#7c4dff', i: 'person' }, { k: 'loc', n: 'Локация', c: '#00897b', i: 'pin' }, { k: 'mon', n: 'Монстр', c: '#d32f2f', i: 'skull' },
    { k: 'item', n: 'Предмет', c: '#f9a825', i: 'gem' }, { k: 'quest', n: 'Квест', c: '#1e88e5', i: 'flag' }, { k: 'scene', n: 'Сцена', c: '#8e24aa', i: 'movie' },
    { k: 'rule', n: 'Правило', c: '#546e7a', i: 'auto_stories' }, { k: 'note', n: 'Заметка', c: '#757575', i: 'notes' }
];
const BD_PLOT_KINDS = [
    { k: 'start', n: 'Начало', c: '#2e7d32', i: 'play_arrow' }, { k: 'scene', n: 'Сцена', c: '#6750a4', i: 'movie' }, { k: 'event', n: 'Событие', c: '#e65100', i: 'bolt' },
    { k: 'choice', n: 'Выбор', c: '#00838f', i: 'help' }, { k: 'combat', n: 'Бой', c: '#c62828', i: 'swords' }, { k: 'loc', n: 'Локация', c: '#00695c', i: 'pin' },
    { k: 'npc', n: 'Персонаж', c: '#ad1457', i: 'person' }, { k: 'reward', n: 'Награда', c: '#f9a825', i: 'gem' }, { k: 'end', n: 'Финал', c: '#37474f', i: 'flag' },
    { k: 'note', n: 'Заметка', c: '#546e7a', i: 'notes' }
];
const BD_PLOT_STATUS = [{ k: 'plan', n: 'В планах' }, { k: 'ready', n: 'Готово к игре' }, { k: 'played', n: 'Сыграно' }];
const BD_COLORS = ['#fff3a3', '#ffd18c', '#ffb4a8', '#ffc8e6', '#d8c4ff', '#b4d5ff', '#aaeaf0', '#b9efb8', '#e3f19d', '#dfe2e8', '#ffffff', '#3d3a45'];
const BD_INKS = ['#1d1b20', '#5f5b66', '#c62828', '#1565c0', '#2e7d32', '#6a1b9a', '#ffffff'];
const BD_SHAPES = [{ k: 'rect', n: 'Прямоугольник' }, { k: 'round', n: 'Скруглённый' }, { k: 'ellipse', n: 'Овал' }, { k: 'diamond', n: 'Ромб' }, { k: 'triangle', n: 'Треугольник' }, { k: 'hex', n: 'Шестиугольник' }];
const bdKind = (list, k) => list.find(x => x.k === k) || list[list.length - 1];

// ---------- Данные ----------
function saveDnd() { if (typeof cloudLocalChanged === 'function') cloudLocalChanged(); return LS.set('dnd_games', dndGames); }
// пока палец на карте (рисование, перетаскивание), запись откладывается: большая запись посреди мазка даёт заметный рывок
const saveDndSoon = debounce(() => { if (typeof dndCity !== 'undefined' && dndCity && dndCity.drag) { saveDndSoon(); return; } saveDnd(); }, 600);
function dndTouch(g) { if (g) { g.updatedAt = Date.now(); if (typeof dndTagReset === 'function') dndTagReset(g); } saveDndSoon(); }
const dndGame = id => dndGames.find(g => g.id === id) || null;
function dndCur() { return dndGame(dndActiveId) || null; }
function dndSetActive(id) {
    dndActiveId = id || ''; LS.set('dnd_active', dndActiveId);
    if (typeof renderDndGames === 'function') renderDndGames();
    if (typeof dndRefreshHeaders === 'function') dndRefreshHeaders();
}
function dndEmptyBoard() { return { items: [], grid: dndCfg.grid, snap: dndCfg.snap }; }
function dndNewGame(o) {
    o = o || {};
    const now = Date.now();
    const g = {
        id: uid('dg'), title: (o.title || '').trim() || 'Новая игра', system: o.system || dndCfg.system, status: o.status || 'idea', desc: o.desc || '',
        hue: o.hue != null ? o.hue : DND_HUES[dndGames.length % DND_HUES.length], source: o.source || 'created', createdAt: now, updatedAt: now,
        files: {}, board: dndEmptyBoard(), plot: { items: [] }, chars: []
    };
    dndGames.unshift(g); saveDnd();
    return g;
}
function dndStats(g) {
    const bi = (g.board && g.board.items) || [], pi = (g.plot && g.plot.items) || [];
    return { cards: bi.filter(i => i.t !== 'conn' && i.t !== 'pen').length, chars: (g.chars || []).length, blocks: pi.filter(i => i.t === 'block').length };
}
function dndFmtN(n, one, few, many) { const a = Math.abs(n) % 100, b = a % 10; return n + ' ' + (a > 10 && a < 20 ? many : b > 1 && b < 5 ? few : b === 1 ? one : many); }
function dndStatusName(k) { return (DND_STATUS.find(s => s.k === k) || DND_STATUS[0]).n; }

// Картинки игр: id → метаданные хранятся в game.files; id попадают в общий список вложений для синхронизации (gdrive.js)
function dndMediaRefs(list) {
    const set = new Set();
    (function walk(v, depth) {
        if (!v || typeof v !== 'object' || depth > 8) return;
        if (Array.isArray(v)) { v.forEach(x => walk(x, depth + 1)); return; }
        for (const k in v) {
            const x = v[k];
            if ((k === 'imgId' || k === 'portraitId' || k === 'coverId') && typeof x === 'string' && x) set.add(x);
            else if (x && typeof x === 'object' && k !== 'files') walk(x, depth + 1);
        }
    })(Array.isArray(list) ? list : [], 0);
    return set;
}
function dndMediaMeta(id) {
    for (const g of dndGames) { const f = g.files && g.files[id]; if (f) return { name: f.name, type: f.type }; }
    return dndMediaRefs(dndGames).has(id) ? { name: 'dnd.jpg', type: 'image/jpeg' } : null;
}
// Файл-картинка → вложение игры; возвращает id
async function dndAddImage(game, file) {
    const a = await makeAttachment(file, 'image');
    await persistAttachment(a);
    game.files = game.files || {}; game.files[a.id] = { name: a.name, type: a.type, w: a.w, h: a.h };
    return { id: a.id, w: a.w, h: a.h, name: a.name };
}
function dndDropImage(game, id) { if (!id) return; if (game && game.files) delete game.files[id]; BlobDB.del(id); }
function dndAfterSync() {
    if (dndActiveId && !dndGame(dndActiveId)) { dndActiveId = ''; LS.set('dnd_active', ''); }
    if (typeof renderDndGames === 'function') renderDndGames();
    if (typeof dndRefreshHeaders === 'function') dndRefreshHeaders();
    if (typeof dndPagesReload === 'function') dndPagesReload();
    if (typeof renderDndSettings === 'function') renderDndSettings();
}

// ---------- Меню ----------
let dndLastMain = 'ideas';
function dndNavSync(id) {
    const root = document.documentElement;
    root.dataset.nav = DND_TABS.includes(id) ? 'dnd' : 'main';
    root.dataset.tab = id;
    if (DND_TABS.includes(id)) LS.set('dnd_last', id); else dndLastMain = id;
}
function dndOpen() { if (DND_TABS.includes(settings.lastTab) && typeof navOpenGroup === 'function') { navOpenGroup('dnd'); return; } const t = LS.get('dnd_last', 'dnd-games'); showTab(DND_TABS.includes(t) ? t : 'dnd-games'); }
function dndBack() { navShowMain(); }   // с 2.7.0: «Назад» — главное меню, страница остаётся
function dndTabOpened(id) {
    if (id === 'dnd-games') renderDndGames();
    if (id === 'dnd-builder' && typeof dndBuilderOpened === 'function') dndBuilderOpened();
    if (id === 'dnd-plot' && typeof dndPlotOpened === 'function') dndPlotOpened();
    if (id === 'dnd-visual' && typeof dndVisualOpened === 'function') dndVisualOpened();
    if (id === 'dnd-chars' && typeof dndCharsOpened === 'function') dndCharsOpened();
    if (id === 'dnd-settings') renderDndSettings();
    dndRefreshHeaders();
}

// ---------- Полоска «Игра: …» на страницах ----------
function dndGameBarHtml() {
    const g = dndCur();
    return '<button type="button" class="dnd-gamechip' + (g ? '' : ' is-none') + '" data-dnd-pick title="Выбрать игру">' + ic('casino') +
        '<span class="dgc-t"><small>Игра</small><b>' + esc(g ? g.title : 'не выбрана') + '</b></span>' + ic('expand_more') + '</button>';
}
function dndRefreshHeaders() { $$('[data-dnd-gamebar]').forEach(el => { el.innerHTML = dndGameBarHtml(); }); }
function dndPickGameSheet(after) {
    const rows = dndGames.map(g => '<button type="button" class="dg-pick' + (g.id === dndActiveId ? ' is-on' : '') + '" data-id="' + esc(g.id) + '"><span class="dg-pick-ico" style="--h:' + (g.hue || 265) + '">' + ic('d20') + '</span><span class="dg-pick-t"><b>' + esc(g.title) + '</b><small>' +
        esc(g.system) + ' · ' + esc(dndStatusName(g.status)) + '</small></span>' + (g.id === dndActiveId ? ic('check') : '') + '</button>').join('');
    const sh = openSheet({
        title: 'Выбрать игру',
        html: '<div class="dg-picklist">' + (rows || '<div class="empty" style="padding:1rem"><b>Игр пока нет</b>Создайте первую — она сразу станет активной.</div>') + '</div>',
        actions: [{ label: 'Новая игра', icon: 'add', kind: 'primary', onClick: () => { setTimeout(() => dndGameFormSheet(null, after), 220); } }, { label: 'Закрыть', value: false }],
        onOpen: api => api.body.addEventListener('click', e => {
            const b = e.target.closest('.dg-pick'); if (!b) return;
            dndSetActive(b.dataset.id); api.close(); if (after) after(dndCur());
        })
    });
    return sh;
}
document.addEventListener('click', e => { const b = e.target.closest('[data-dnd-pick]'); if (b) { dndPickGameSheet(function () { if (typeof dndPagesReload === 'function') dndPagesReload(); }); } });

// ---------- Создание и изменение игры ----------
function dndGameFormSheet(game, after) {
    const isNew = !game;
    const g = game || { title: '', system: dndCfg.system, status: 'idea', desc: '', hue: DND_HUES[dndGames.length % DND_HUES.length] };
    let hue = g.hue;
    const sh = openSheet({
        title: isNew ? 'Новая игра' : 'Игра: настройки',
        html:
            '<label class="field-label" for="dg-title">Название</label><input type="text" id="dg-title" maxlength="80" placeholder="Например, «Проклятие Страда»" value="' + esc(g.title) + '">' +
            '<div class="dg-row2"><div><label class="field-label" for="dg-sys">Система</label><select id="dg-sys">' + DND_SYSTEMS.map(s => '<option' + (s === g.system ? ' selected' : '') + '>' + esc(s) + '</option>').join('') + '</select></div>' +
            '<div><label class="field-label" for="dg-st">Состояние</label><select id="dg-st">' + DND_STATUS.map(s => '<option value="' + s.k + '"' + (s.k === g.status ? ' selected' : '') + '>' + esc(s.n) + '</option>').join('') + '</select></div></div>' +
            '<label class="field-label" for="dg-desc">Описание</label><textarea id="dg-desc" rows="3" placeholder="О чём кампания, для кого, какой тон">' + esc(g.desc) + '</textarea>' +
            '<label class="field-label">Цвет обложки</label><div class="dg-hues">' + DND_HUES.map(h => '<button type="button" class="dg-hue' + (h === hue ? ' is-on' : '') + '" data-h="' + h + '" style="--h:' + h + '" aria-label="Цвет"></button>').join('') + '</div>' +
            (isNew ? '<label class="field-label" for="dg-tpl">Начать с</label><select id="dg-tpl"><option value="">Пустой доски</option><option value="start">Заготовки «Старт кампании» (мир, герои, локации, квесты…)</option></select>' :
                '<label class="field-label">Обложка-картинка</label><div class="btn-group"><button type="button" class="btn" id="dg-cover"><i data-i="add_photo_alternate"></i>Выбрать картинку</button>' + (g.coverId ? '<button type="button" class="btn btn-danger" id="dg-cover-x"><i data-i="delete"></i>Убрать</button>' : '') + '</div><input type="file" id="dg-cover-file" accept="image/*" hidden>'),
        actions: [{ label: 'Отмена', value: false }, {
            label: isNew ? 'Создать' : 'Сохранить', kind: 'primary', icon: 'check',
            onClick: api => {
                const title = api.body.querySelector('#dg-title').value.trim();
                if (!title) { toast('Введите название игры'); api.body.querySelector('#dg-title').focus(); return false; }
                const o = { title, system: api.body.querySelector('#dg-sys').value, status: api.body.querySelector('#dg-st').value, desc: api.body.querySelector('#dg-desc').value.trim(), hue };
                if (isNew) {
                    const ng = dndNewGame(o);
                    const t = api.body.querySelector('#dg-tpl');
                    if (t && t.value === 'start' && typeof bdTemplateItems === 'function') ng.board.items = bdTemplateItems('start', 0, 0);
                    saveDnd(); dndSetActive(ng.id); toast('Игра создана: ' + ng.title);
                    if (after) after(ng);
                } else { Object.assign(game, o); dndTouch(game); renderDndGames(); dndRefreshHeaders(); toast('Сохранено'); if (after) after(game); }
            }
        }],
        onOpen: api => {
            hydrateIcons(api.body);
            api.body.addEventListener('click', e => { const h = e.target.closest('.dg-hue'); if (!h) return; hue = +h.dataset.h; api.body.querySelectorAll('.dg-hue').forEach(x => x.classList.toggle('is-on', x === h)); });
            if (!isNew) {
                const f = api.body.querySelector('#dg-cover-file');
                api.body.querySelector('#dg-cover').addEventListener('click', () => f.click());
                f.addEventListener('change', async () => {
                    if (!f.files[0]) return;
                    try { const old = game.coverId; const r = await dndAddImage(game, f.files[0]); game.coverId = r.id; if (old) dndDropImage(game, old); dndTouch(game); renderDndGames(); toast('Обложка обновлена'); api.close(); } catch (er) { console.error(er); toast('Не удалось загрузить картинку'); }
                });
                const x = api.body.querySelector('#dg-cover-x');
                if (x) x.addEventListener('click', () => { dndDropImage(game, game.coverId); game.coverId = ''; dndTouch(game); renderDndGames(); api.close(); });
            }
            setTimeout(() => api.body.querySelector('#dg-title').focus(), 60);
        }
    });
    return sh;
}

// ---------- Страница «Игры» ----------
async function dndPaintCovers(root) {
    for (const el of $$('[data-cover]', root)) {
        const url = await BlobDB.url(el.dataset.cover, 'thumb');
        if (url) { el.style.backgroundImage = 'url("' + url + '")'; el.classList.add('has-img'); }
    }
}
function renderDndGames() {
    const host = $('#dnd-games-body'); if (!host) return;
    const q = normText(dndUi.q);
    let list = dndGames.filter(g => {
        if (dndUi.filter === 'created' && g.source !== 'created') return false;
        if (dndUi.filter === 'imported' && g.source === 'created') return false;
        return !q || normText(g.title + ' ' + g.system + ' ' + g.desc).includes(q);
    });
    list.sort(dndUi.sort === 'abc' ? (a, b) => a.title.localeCompare(b.title, 'ru') : dndUi.sort === 'made' ? (a, b) => b.createdAt - a.createdAt : (a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    $('#dnd-games-count').textContent = dndGames.length ? (list.length === dndGames.length ? dndFmtN(dndGames.length, 'игра', 'игры', 'игр') : list.length + ' из ' + dndGames.length) : '';
    $$('#dnd-games-filter button').forEach(b => b.classList.toggle('is-on', b.dataset.f === dndUi.filter));
    $('#dnd-games-sort').value = dndUi.sort;
    if (!dndGames.length) {
        host.innerHTML = '<div class="empty"><div class="ico-big">' + ic('d20') + '</div><b>Игр пока нет</b>Создайте первую игру или импортируйте доску из Miro.' +
            '<div class="btn-group" style="justify-content:center;margin-top:1rem"><button type="button" class="btn btn-primary" data-dg="new">' + ic('add') + 'Новая игра</button><button type="button" class="btn" data-dg="import">' + ic('file_upload') + 'Импорт</button></div></div>';
        return;
    }
    if (!list.length) { host.innerHTML = '<div class="empty"><div class="ico-big">' + ic('search') + '</div><b>Ничего не найдено</b>Измените запрос или фильтр.</div>'; return; }
    host.innerHTML = list.map(g => {
        const st = dndStats(g), on = g.id === dndActiveId;
        return '<article class="dg-tile' + (on ? ' is-active' : '') + '" data-id="' + esc(g.id) + '">' +
            '<div class="dg-cover" style="--h:' + (g.hue || 265) + '"' + (g.coverId ? ' data-cover="' + esc(g.coverId) + '"' : '') + '><span class="dg-d20">' + ic('d20') + '</span>' +
            (on ? '<span class="dg-badge">' + ic('check') + 'Активная</span>' : '') + '</div>' +
            '<div class="dg-main"><h3>' + esc(g.title) + '</h3>' +
            '<div class="dg-meta"><span class="chip">' + esc(g.system) + '</span><span class="chip is-on">' + esc(dndStatusName(g.status)) + '</span>' +
            (g.source !== 'created' ? '<span class="chip tag">' + ic('file_upload') + (g.source === 'miro' ? 'Из Miro' : 'Импорт') + '</span>' : '') + '</div>' +
            (g.desc ? '<p class="dg-desc">' + esc(g.desc) + '</p>' : '') +
            '<div class="dg-stats"><span>' + ic('card') + dndFmtN(st.cards, 'карточка', 'карточки', 'карточек') + '</span><span>' + ic('groups') + dndFmtN(st.chars, 'персонаж', 'персонажа', 'персонажей') + '</span><span>' + ic('account_tree') + dndFmtN(st.blocks, 'блок', 'блока', 'блоков') + '</span></div>' +
            '<div class="dg-date">Изменена ' + esc(fmtDate(g.updatedAt || g.createdAt, true)) + '</div></div>' +
            '<div class="dg-actions"><button type="button" class="btn btn-primary" data-dg="open">' + ic('dnd_board') + 'Открыть</button>' +
            '<button type="button" class="icon-btn" data-dg="more" aria-label="Ещё">' + ic('more_vert') + '</button></div></article>';
    }).join('');
    dndPaintCovers(host);
}
function dndGameMenu(g) {
    const items = [
        ['sel', 'check', 'Сделать активной'], ['open', 'dnd_board', 'Открыть в «Карточках и Заметках»'], ['chars', 'groups', 'Персонажи'], ['plot', 'account_tree', 'Сюжет'],
        ['edit', 'edit', 'Изменить название и обложку'], ['dup', 'content_copy', 'Дублировать'], ['expx', 'picture_as_pdf', 'Вывод: Miro, PDF, текст…'], ['exp', 'download', 'Сохранить файлом (JSON)'], ['del', 'delete', 'Удалить']
    ];
    const sh = openSheet({
        title: g.title, html: '<div class="dg-menu">' + items.map(i => '<button type="button" class="dg-mi' + (i[0] === 'del' ? ' is-danger' : '') + '" data-a="' + i[0] + '">' + ic(i[1]) + '<span>' + i[2] + '</span></button>').join('') + '</div>',
        actions: [{ label: 'Закрыть', value: false }],
        onOpen: api => api.body.addEventListener('click', async e => {
            const b = e.target.closest('.dg-mi'); if (!b) return; const a = b.dataset.a; api.close();
            if (a === 'sel') { dndSetActive(g.id); toast('Активная игра: ' + g.title); }
            else if (a === 'open') { dndSetActive(g.id); showTab('dnd-builder'); }
            else if (a === 'chars') { dndSetActive(g.id); showTab('dnd-chars'); }
            else if (a === 'plot') { dndSetActive(g.id); showTab('dnd-plot'); }
            else if (a === 'edit') setTimeout(() => dndGameFormSheet(g), 220);
            else if (a === 'dup') { const c = JSON.parse(JSON.stringify(g)); c.id = uid('dg'); c.title = g.title + ' (копия)'; c.createdAt = c.updatedAt = Date.now(); dndGames.unshift(c); saveDnd(); renderDndGames(); toast('Копия создана'); }
            else if (a === 'exp') dndExportGames([g.id]);
            else if (a === 'expx') setTimeout(() => dndExportSheet(g, 'board'), 220);
            else if (a === 'del') {
                const ok = await confirmSheet('Удалить игру?', '«' + g.title + '» будет удалена вместе с доской, персонажами и сюжетом. Отменить это нельзя.', 'Удалить', true);
                if (!ok) return;
                const refs = dndMediaRefs([g]); dndGames = dndGames.filter(x => x.id !== g.id); if (dndActiveId === g.id) { dndActiveId = ''; LS.set('dnd_active', ''); }
                saveDnd(); const still = dndMediaRefs(dndGames); refs.forEach(id => { if (!still.has(id)) BlobDB.del(id); });
                renderDndGames(); dndRefreshHeaders(); if (typeof dndPagesReload === 'function') dndPagesReload(); toast('Игра удалена');
            }
        })
    });
    hydrateIcons(sh.body);
}
function initDndGames() {
    const host = $('#dnd-games-body');
    $('#dnd-games-new').addEventListener('click', () => dndGameFormSheet(null, () => { renderDndGames(); }));
    $('#dnd-games-import').addEventListener('click', () => dndImportSheet());
    const q = $('#dnd-games-q'); q.value = '';
    q.addEventListener('input', debounce(() => { dndUi.q = q.value; renderDndGames(); }, 150));
    $('#dnd-games-filter').addEventListener('click', e => { const b = e.target.closest('button[data-f]'); if (!b) return; dndUi.filter = b.dataset.f; dndUiSave(); renderDndGames(); });
    $('#dnd-games-sort').addEventListener('change', e => { dndUi.sort = e.target.value; dndUiSave(); renderDndGames(); });
    host.addEventListener('click', e => {
        const b = e.target.closest('[data-dg]'); if (!b) return;
        const a = b.dataset.dg;
        if (a === 'new') return dndGameFormSheet(null, () => renderDndGames());
        if (a === 'import') return dndImportSheet();
        const t = b.closest('.dg-tile'); const g = t && dndGame(t.dataset.id); if (!g) return;
        if (a === 'open') { dndSetActive(g.id); showTab('dnd-builder'); } else if (a === 'more') dndGameMenu(g);
    });
    host.addEventListener('dblclick', e => { const t = e.target.closest('.dg-tile'); if (t && !e.target.closest('button')) { dndSetActive(t.dataset.id); showTab('dnd-builder'); } });
}

// ---------- Файл игры: сохранить и загрузить ----------
async function dndExportGames(ids) {
    try {
        const games = dndGames.filter(g => !ids || ids.includes(g.id));
        if (!games.length) { toast('Нет игр для сохранения'); return; }
        const refs = dndMediaRefs(games), media = [];
        for (const id of refs) { const rec = await BlobDB.get(id); if (rec && rec.blob) media.push({ id, name: rec.name, type: rec.type, data: await blobToBase64(rec.blob) }); }
        const data = { app: 'iLife-dnd', format: 1, version: APP_VERSION, exportedAt: new Date().toISOString(), games, media };
        const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
        const name = stampName(games.length === 1 ? 'ДНД_' + games[0].title.replace(/[^\p{L}\p{N}_-]+/gu, '') : 'ДНД_игры', 'json');
        const res = await deliverFile(blob, name);
        toast(res === 'unsupported' ? 'В этом приложении сохранить файл нельзя — откройте iLife в браузере' : res === 'shared' ? 'Файл готов — выберите, куда его отправить' : 'Сохранено: ' + name);
    } catch (e) { console.error(e); toast('Не удалось собрать файл игры'); }
}

// ---------- Импорт: файл игры iLife, Miro (CSV, JSON из API, картинки), обычный текст ----------
const MIRO_COLORS = {
    gray: '#dfe2e8', light_yellow: '#fff3a3', yellow: '#ffe066', orange: '#ffd18c', light_green: '#d4f0a8', green: '#b9efb8', dark_green: '#7fcf8a', cyan: '#aaeaf0',
    light_pink: '#ffd6ec', pink: '#ffc8e6', violet: '#d8c4ff', red: '#ffb4a8', light_blue: '#cfe3ff', blue: '#b4d5ff', dark_blue: '#8fb5f0', black: '#3d3a45', white: '#ffffff'
};
const miroColor = (c, def) => { if (!c) return def; c = String(c).trim(); if (/^#[0-9a-f]{6}$/i.test(c)) return c.toLowerCase(); if (/^#[0-9a-f]{3}$/i.test(c)) return ('#' + c[1] + c[1] + c[2] + c[2] + c[3] + c[3]).toLowerCase(); return MIRO_COLORS[c.toLowerCase()] || def; };
function miroText(html) {
    if (html == null) return '';
    const s = String(html).replace(/<\s*br\s*\/?>/gi, '\n').replace(/<\/(p|div|li|h[1-6])>/gi, '\n');
    const d = document.createElement('div'); d.innerHTML = s;
    return (d.textContent || '').replace(/ /g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}
function csvParse(text) {
    text = String(text || '').replace(/^﻿/, '');
    const first = text.split(/\r?\n/, 1)[0] || '';
    const delim = [',', ';', '\t'].map(d => [d, first.split(d).length]).sort((a, b) => b[1] - a[1])[0][0];
    const rows = []; let row = [], cell = '', q = false;
    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (q) {
            if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += ch;
        } else if (ch === '"') q = true;
        else if (ch === delim) { row.push(cell); cell = ''; }
        else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
        else cell += ch;
    }
    if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
    return rows.filter(r => r.some(c => String(c).trim() !== ''));
}
// Таблица из CSV → список карточек или стикеров
function dndFromCsv(text, opts) {
    const rows = csvParse(text); if (!rows.length) return [];
    let iT = 0, iD = 1, iG = 2, start = 0;
    const head = rows[0].map(c => String(c).trim().toLowerCase());
    const find = re => head.findIndex(h => re.test(h));
    if (head.some(h => /text|title|name|content|descr|tag|url|link|текст|назван|заголов|описан|метк|тег|ссылк/.test(h)) && rows.length > 1) {
        start = 1;
        const t = find(/^(text|title|name|content|текст|назван|заголов)/), d = find(/descr|url|link|описан|ссылк/), g = find(/tag|тег|метк/);
        if (t >= 0) iT = t; iD = d >= 0 ? d : (iT === 0 ? 1 : 0); iG = g >= 0 ? g : -1;
        if (d < 0 && g < 0) { iD = -1; }
    }
    const out = [];
    rows.slice(start).forEach(r => {
        const title = String(r[iT] || '').trim(), desc = iD >= 0 ? String(r[iD] || '').trim() : '', tags = iG >= 0 ? String(r[iG] || '').split(/[;,|]/).map(s => s.trim().replace(/^#/, '')).filter(Boolean) : [];
        if (!title && !desc) return;
        out.push({ title, desc, tags });
    });
    return out;
}
function dndCsvItems(rows, opts) {
    const cols = Math.max(1, +opts.cols || 5), asCard = opts.as !== 'sticky', W = asCard ? 260 : 200, H = asCard ? 170 : 200, gap = 28;
    return rows.map((r, i) => {
        const x = (i % cols) * (W + gap), y = Math.floor(i / cols) * (H + gap);
        if (asCard || r.desc || r.tags.length) {
            return bdItem('card', { x, y, w: 260, h: 170, kind: 'note', title: r.title || r.desc.slice(0, 60), text: r.title ? r.desc : '', tags: r.tags });
        }
        return bdItem('sticky', { x, y, text: r.title, c: dndCfg.stickyColor });
    });
}
function dndTextItems(text, opts) {
    const parts = String(text || '').replace(/\r/g, '').split(/\n\s*\n/).map(s => s.trim()).filter(Boolean);
    const lines = parts.length > 1 ? parts : String(text || '').split(/\n/).map(s => s.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, '').trim()).filter(Boolean);
    return dndCsvItems(lines.map(l => { const ls = l.split('\n'); return { title: ls[0].slice(0, 120), desc: ls.slice(1).join('\n'), tags: [] }; }), opts);
}
// JSON из Miro REST API (список предметов доски и/или список связей)
function dndFromMiroJson(obj) {
    let arr = Array.isArray(obj) ? obj : Array.isArray(obj && obj.data) ? obj.data : Array.isArray(obj && obj.items) ? obj.items : Array.isArray(obj && obj.connectors) ? obj.connectors : null;
    if (!arr || !arr.length || !arr.every(x => x && typeof x === 'object')) return null;
    if (!arr.some(x => x.type || x.startItem || x.endItem)) return null;
    const info = { sticky: 0, card: 0, shape: 0, text: 0, frame: 0, conn: 0, skipped: 0 }, byMiro = new Map(), items = [], conns = [];
    const frames = new Map(arr.filter(x => x.type === 'frame').map(f => [String(f.id), f]));
    const posOf = it => {
        const g = it.geometry || {}, p = it.position || {}; const w = +g.width || 0, h = +g.height || 0;
        let x = (+p.x || 0) - w / 2, y = (+p.y || 0) - h / 2;
        const par = it.parent && frames.get(String(it.parent.id));
        if (par && par.position && par.geometry) { x = (+p.x || 0) + ((+par.position.x || 0) - (+par.geometry.width || 0) / 2); y = (+p.y || 0) + ((+par.position.y || 0) - (+par.geometry.height || 0) / 2); }
        return { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) };
    };
    arr.forEach(m => {
        const t = m.type, d = m.data || {}, s = m.style || {};
        if (m.startItem || m.endItem || t === 'connector') {
            const cap = s.endStrokeCap || 'none', cap0 = s.startStrokeCap || 'none';
            conns.push({
                mid: String(m.id), a: m.startItem && String(m.startItem.id), b: m.endItem && String(m.endItem.id),
                style: m.shape === 'straight' ? 'straight' : m.shape === 'elbowed' ? 'elbow' : 'curve', head: cap !== 'none' && cap0 !== 'none' ? 'both' : cap !== 'none' ? 'end' : cap0 !== 'none' ? 'start' : 'none',
                color: miroColor(s.strokeColor, '#5f5b66'), dash: s.strokeStyle === 'dashed' || s.strokeStyle === 'dotted', label: m.captions && m.captions[0] ? miroText(m.captions[0].content) : ''
            });
            return;
        }
        const p = posOf(m); let it = null;
        if (t === 'sticky_note') { const sz = p.w || 199; it = bdItem('sticky', { x: p.x, y: p.y, w: sz, h: p.h || sz, text: miroText(d.content), c: miroColor(s.fillColor, '#fff3a3') }); info.sticky++; }
        else if (t === 'card') { it = bdItem('card', { x: p.x, y: p.y, w: p.w || 260, h: Math.max(p.h || 0, 140), kind: 'note', title: miroText(d.title), text: miroText(d.description), tags: [] }); info.card++; }
        else if (t === 'text') { it = bdItem('text', { x: p.x, y: p.y, w: p.w || 240, text: miroText(d.content), fs: Math.max(12, Math.min(72, Math.round(+s.fontSize || 24))) }); info.text++; }
        else if (t === 'shape') {
            const sh = String(d.shape || 'rectangle'); const map = { rectangle: 'rect', square: 'rect', round_rectangle: 'round', circle: 'ellipse', triangle: 'triangle', rhombus: 'diamond', hexagon: 'hex', octagon: 'hex' };
            it = bdItem('shape', { x: p.x, y: p.y, w: p.w || 160, h: p.h || 120, shape: map[sh] || 'rect', text: miroText(d.content), fill: s.fillOpacity === '0.0' ? 'none' : miroColor(s.fillColor, '#ffffff'), stroke: miroColor(s.borderColor, '#79747e') }); info.shape++;
        }
        else if (t === 'frame') { it = bdItem('frame', { x: p.x, y: p.y, w: p.w || 480, h: p.h || 320, title: miroText(d.title) || 'Рамка' }); info.frame++; }
        else if (t === 'embed' || t === 'document' || t === 'preview' || t === 'app_card' || t === 'image') {
            const ttl = miroText(d.title || (d.url ? '' : 'Вложение')); const url = d.url || d.imageUrl || d.documentUrl || '';
            if (t === 'image' || (!ttl && !url)) { info.skipped++; return; }
            it = bdItem('card', { x: p.x, y: p.y, w: 260, h: 150, kind: 'note', title: ttl || url, text: url, tags: [] }); info.card++;
        }
        else { info.skipped++; return; }
        byMiro.set(String(m.id), it); items.push(it);
    });
    conns.forEach(c => {
        const a = byMiro.get(c.a), b = byMiro.get(c.b); if (!a || !b) { info.skipped++; return; }
        items.push(bdItem('conn', { from: { id: a.id, side: 'auto' }, to: { id: b.id, side: 'auto' }, style: c.style, head: c.head === 'start' ? 'end' : c.head, color: c.color, dash: c.dash, label: c.label })); info.conn++;
    });
    return { items, info };
}
// Пересчёт положения: сдвиг так, чтобы набор встал рядом, а не поверх уже стоящих карточек
function dndShiftItems(items, existing) {
    const box = list => { let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9; list.forEach(i => { if (i.t === 'conn') return; x0 = Math.min(x0, i.x); y0 = Math.min(y0, i.y); x1 = Math.max(x1, i.x + (i.w || 0)); y1 = Math.max(y1, i.y + (i.h || 0)); }); return x0 > x1 ? null : { x0, y0, x1, y1 }; };
    const nb = box(items); if (!nb) return;
    const eb = box(existing || []);
    const dx = eb ? eb.x1 + 120 - nb.x0 : -nb.x0, dy = eb ? eb.y0 - nb.y0 : -nb.y0;
    items.forEach(i => { if (i.t !== 'conn' && i.x != null) { i.x += dx; i.y += dy; } });
}
async function dndReadImageFile(game, file) {
    const r = await dndAddImage(game, file); const k = Math.min(1, 420 / Math.max(r.w || 420, 1));
    return bdItem('image', { x: 0, y: 0, w: Math.round((r.w || 420) * k), h: Math.round((r.h || 300) * k), imgId: r.id, name: file.name });
}
// Главная функция: файлы → результат { games[]/items[], notes[] } и запись в игру
async function dndImportFiles(files, o) {
    const res = { items: [], games: [], notes: [], info: {} };
    o = Object.assign({ mode: 'new', as: 'card', cols: 5, target: null }, o || {});
    let target = o.mode === 'active' ? dndCur() : null;
    let mediaIn = [];
    const addNote = s => res.notes.push(s);
    // Файл игры iLife — отдельная ветка: игры добавляются как есть
    const texts = [];
    for (const f of files) {
        const name = f.name || 'файл', ext = (name.split('.').pop() || '').toLowerCase();
        try {
            if (/^image\//.test(f.type) || ['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg'].includes(ext)) {
                if (o.imgAs === 'emoji' && typeof dndEmojiImportSheet === 'function') {   // картинка из эмодзи (скриншот Miro): сетка, распознавание, правка
                    const er = await dndEmojiImportSheet(f, {});
                    if (er) { res.items.push(dndEmojiItem(er.data, name.replace(/\.[^.]+$/, ''), { x: 0, y: 0 })); res.info.emoji = (res.info.emoji || 0) + 1; } else addNote('«' + name + '»: распознавание отменено.');
                    continue;
                }
                if (!target) { target = { files: {}, tmp: true }; }
                res.items.push(await dndReadImageFile(target, f)); res.info.image = (res.info.image || 0) + 1; res._imgTarget = target; continue;
            }
            if (ext === 'pdf') { addNote('PDF «' + name + '» не открывается в iLife: выгрузите доску из Miro как JPG, PNG или SVG либо как CSV.'); continue; }
            const txt = await f.text();
            if (ext === 'json' || /^\s*[\[{]/.test(txt)) {
                let obj = null; try { obj = JSON.parse(txt); } catch (e) { addNote('«' + name + '»: это не JSON.'); continue; }
                if (obj && obj.app === 'iLife-dnd' && Array.isArray(obj.games)) {
                    for (const m of obj.media || []) { try { await BlobDB.put({ id: m.id, name: m.name, type: m.type, size: 0, blob: b64ToBlob(m.data, m.type) }); } catch (e) { console.warn(e); } }
                    obj.games.forEach(g => res.games.push(g)); continue;
                }
                const mi = dndFromMiroJson(obj);
                if (mi) { res.items.push(...mi.items); Object.keys(mi.info).forEach(k => { res.info[k] = (res.info[k] || 0) + mi.info[k]; }); res.miro = true; continue; }
                addNote('«' + name + '»: не похоже ни на файл игры iLife, ни на данные Miro.'); continue;
            }
            if (ext === 'csv') { const rows = dndFromCsv(txt, o); res.items.push(...dndCsvItems(rows, o)); res.info.csv = (res.info.csv || 0) + rows.length; res.miro = true; continue; }
            texts.push(txt);
        } catch (e) { console.error(e); addNote('«' + name + '» не удалось прочитать.'); }
    }
    texts.forEach(t => { const its = dndTextItems(t, o); res.items.push(...its); res.info.text_lines = (res.info.text_lines || 0) + its.length; });
    // раскладка картинок, пришедших вместе с остальным: ряд справа от общего набора
    const imgs = res.items.filter(i => i.t === 'image'); imgs.forEach((im, i) => { im.x = i * 460; im.y = -im.h - 80; });
    return res;
}
// Результат → в игру (новая или активная)
async function dndApplyImport(res, o) {
    let game = o.mode === 'active' ? dndCur() : null;
    const made = [];
    res.games.forEach(g => {
        const ng = JSON.parse(JSON.stringify(g)); if (dndGame(ng.id)) ng.id = uid('dg');
        ng.source = ng.source && ng.source !== 'created' ? ng.source : 'file'; ng.updatedAt = Date.now(); ng.createdAt = ng.createdAt || Date.now();
        ng.files = ng.files || {}; ng.board = ng.board || dndEmptyBoard(); ng.plot = ng.plot || { items: [] }; ng.chars = ng.chars || [];
        dndGames.unshift(ng); made.push(ng);
    });
    if (res.items.length) {
        if (!game) { game = dndNewGame({ title: o.title || (res.miro ? 'Доска из Miro' : 'Импорт'), source: res.miro ? 'miro' : 'file' }); made.push(game); }
        const imgOwner = res._imgTarget; if (imgOwner && imgOwner.files) { game.files = Object.assign(game.files || {}, imgOwner.files); }
        dndShiftItems(res.items, game.board.items);
        res.items.forEach(i => { if (i.z == null) i.z = 0; });
        let z = Math.max(0, ...game.board.items.map(i => i.z || 0)); res.items.forEach(i => { i.z = ++z; });
        game.board.items.push(...res.items); dndTouch(game);
    }
    saveDnd();
    if (made.length) dndSetActive(made[0].id); else if (game) dndSetActive(game.id);
    return game || made[0] || null;
}
function dndImportSummary(res) {
    const i = res.info, parts = [];
    if (res.games.length) parts.push(dndFmtN(res.games.length, 'игра', 'игры', 'игр'));
    if (i.sticky) parts.push(dndFmtN(i.sticky, 'стикер', 'стикера', 'стикеров'));
    if (i.card) parts.push(dndFmtN(i.card, 'карточка', 'карточки', 'карточек'));
    if (i.csv) parts.push(dndFmtN(i.csv, 'строка таблицы', 'строки таблицы', 'строк таблицы'));
    if (i.text_lines) parts.push(dndFmtN(i.text_lines, 'запись из текста', 'записи из текста', 'записей из текста'));
    if (i.shape) parts.push(dndFmtN(i.shape, 'фигура', 'фигуры', 'фигур'));
    if (i.text) parts.push(dndFmtN(i.text, 'надпись', 'надписи', 'надписей'));
    if (i.frame) parts.push(dndFmtN(i.frame, 'рамка', 'рамки', 'рамок'));
    if (i.conn) parts.push(dndFmtN(i.conn, 'связь', 'связи', 'связей'));
    if (i.image) parts.push(dndFmtN(i.image, 'картинка', 'картинки', 'картинок'));
    if (i.emoji) parts.push(dndFmtN(i.emoji, 'картинка из эмодзи', 'картинки из эмодзи', 'картинок из эмодзи'));
    return parts.join(', ');
}

// Окно импорта (используется и на странице «Игры», и в «Настройках ДНД»)
function dndImportWidget(host, onDone) {
    const cur = dndCur();
    host.innerHTML =
        '<div class="di-drop" id="di-drop" tabindex="0" role="button" aria-label="Выбрать файлы для импорта">' + ic('file_upload') + '<b>Выберите файлы или перетащите их сюда</b><small>CSV и JSON из Miro, картинки JPG/PNG/SVG, текст, файл игры iLife</small></div>' +
        '<input type="file" id="di-file" multiple accept=".csv,.json,.txt,.md,.png,.jpg,.jpeg,.webp,.gif,.svg,text/*,image/*,application/json" hidden>' +
        '<div class="di-files" id="di-files"></div>' +
        '<div class="di-opts" id="di-opts" hidden>' +
        '<div class="field-pair"><span class="field-label">Куда добавить</span><div class="seg" id="di-mode"><button type="button" data-m="new" class="is-on">' + ic('add') + '<span>Новая игра</span></button><button type="button" data-m="active"' + (cur ? '' : ' disabled') + '>' + ic('dnd_board') + '<span>' + (cur ? 'В «' + esc(cur.title.length > 18 ? cur.title.slice(0, 17) + '…' : cur.title) + '»' : 'В активную') + '</span></button></div></div>' +
        '<div class="field-pair" id="di-title-row"><label class="field-label" for="di-title">Название новой игры</label><input type="text" id="di-title" maxlength="80" placeholder="Доска из Miro"></div>' +
        '<div class="field-pair" id="di-as-row"><span class="field-label">Строки таблицы и текст превратить в</span><div class="seg" id="di-as"><button type="button" data-a="card" class="is-on">' + ic('card') + '<span>Карточки</span></button><button type="button" data-a="sticky">' + ic('sticky') + '<span>Стикеры</span></button></div></div>' +
        '<div class="field-pair" id="di-img-row" hidden><span class="field-label">Картинки</span><div class="seg" id="di-img"><button type="button" data-g="pic" class="is-on">' + ic('image') + '<span>Оставить картинкой</span></button><button type="button" data-g="emoji">' + ic('emoji') + '<span>Картинка из эмодзи</span></button></div><p class="hint" style="margin:0.25rem 0 0">Для рисунка, собранного из эмодзи: iLife найдёт клетки, узнает значки, и каждую клетку можно будет править.</p></div>' +
        '<div class="field-pair" id="di-cols-row"><label class="field-label" for="di-cols">Карточек в ряд</label><input type="number" id="di-cols" min="1" max="20" value="' + (dndCfg.cols || 5) + '"></div>' +
        '<button type="button" class="btn btn-primary btn-wide" id="di-go"><i data-i="check"></i>Импортировать</button></div>' +
        '<div class="di-result" id="di-result" hidden></div>';
    hydrateIcons(host);
    let files = [], mode = cur ? 'active' : 'new', as = 'card', imgAs = 'pic';
    const $h = s => host.querySelector(s);
    const setMode = m => { mode = m; $$('#di-mode button', host).forEach(b => b.classList.toggle('is-on', b.dataset.m === m)); $h('#di-title-row').hidden = m !== 'new'; };
    const show = () => {
        $h('#di-opts').hidden = !files.length;
        $h('#di-files').innerHTML = files.map((f, i) => '<span class="chip">' + ic(/image/.test(f.type) ? 'image' : 'description') + esc(f.name) + '<button type="button" class="icon-btn chip-x" data-i="' + i + '" aria-label="Убрать">' + ic('close') + '</button></span>').join('');
        const needsAs = files.some(f => /\.(csv|txt|md)$/i.test(f.name) || /^text\//.test(f.type));
        $h('#di-as-row').hidden = !needsAs; $h('#di-cols-row').hidden = !needsAs; $h('#di-img-row').hidden = !files.some(f => /^image\//.test(f.type) || /\.(png|jpe?g|webp|gif)$/i.test(f.name));
    };
    const add = list => { files = files.concat(Array.from(list)); $h('#di-result').hidden = true; show(); if (!$h('#di-title').value) $h('#di-title').placeholder = 'Доска из Miro'; };
    const inp = $h('#di-file'), drop = $h('#di-drop');
    drop.addEventListener('click', () => { inp.value = ''; inp.click(); });
    drop.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); inp.click(); } });
    inp.addEventListener('change', () => add(inp.files));
    ['dragenter', 'dragover'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('is-over'); }));
    ['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('is-over'); }));
    drop.addEventListener('drop', e => { if (e.dataTransfer && e.dataTransfer.files.length) add(e.dataTransfer.files); });
    $h('#di-files').addEventListener('click', e => { const x = e.target.closest('[data-i]'); if (!x) return; files.splice(+x.dataset.i, 1); show(); });
    $h('#di-mode').addEventListener('click', e => { const b = e.target.closest('button[data-m]'); if (b && !b.disabled) setMode(b.dataset.m); });
    $h('#di-img').addEventListener('click', e => { const b = e.target.closest('button[data-g]'); if (!b) return; imgAs = b.dataset.g; $$('#di-img button', host).forEach(x => x.classList.toggle('is-on', x === b)); });
    $h('#di-as').addEventListener('click', e => { const b = e.target.closest('button[data-a]'); if (!b) return; as = b.dataset.a; $$('#di-as button', host).forEach(x => x.classList.toggle('is-on', x === b)); });
    setMode(mode);
    $h('#di-go').addEventListener('click', async () => {
        const btn = $h('#di-go'); btn.disabled = true;
        try {
            const cols = Math.max(1, Math.min(20, +$h('#di-cols').value || 5)); dndCfg.cols = cols; dndCfgSave();
            const opt = { mode, as, cols, imgAs, title: $h('#di-title').value.trim() };
            const res = await dndImportFiles(files, opt);
            const game = (res.items.length || res.games.length) ? await dndApplyImport(res, opt) : null;
            const box = $h('#di-result'); box.hidden = false;
            const sum = dndImportSummary(res);
            box.innerHTML = game ?
                '<div class="di-ok">' + ic('check') + '<div><b>Готово: ' + esc(sum || 'импорт выполнен') + '</b><small>Игра «' + esc(game.title) + '» теперь активная.</small></div></div>' + (res.info.skipped ? '<p class="hint">Пропущено ' + res.info.skipped + ': Miro не отдаёт картинки по API и часть служебных предметов.</p>' : '') :
                '<div class="di-fail">' + ic('info') + '<div><b>Ничего не импортировано</b></div></div>';
            if (res.notes.length) box.innerHTML += '<ul class="di-notes">' + res.notes.map(n => '<li>' + esc(n) + '</li>').join('') + '</ul>';
            if (game) {
                box.insertAdjacentHTML('beforeend', '<div class="btn-group"><button type="button" class="btn btn-primary" data-go="dnd-builder">' + ic('dnd_board') + 'Открыть в «Карточках и Заметках»</button><button type="button" class="btn" data-go="dnd-games">' + ic('casino') + 'К списку игр</button></div>');
                files = []; show(); renderDndGames(); if (typeof dndPagesReload === 'function') dndPagesReload(); if (onDone) onDone(game);
            }
        } catch (e) { console.error(e); toast('Не удалось выполнить импорт'); } finally { btn.disabled = false; }
    });
    $h('#di-result').addEventListener('click', e => { const b = e.target.closest('[data-go]'); if (b) { const sh = sheetStack[sheetStack.length - 1]; if (sh) sh.close(); showTab(b.dataset.go); } });
}
function dndImportSheet() {
    const sh = openSheet({ title: 'Импорт в ДНД', html: '<div id="di-host"></div><p class="instr-row"><button type="button" class="linkbtn instr-link" data-instr="instr-miro"><i data-i="help"></i>Как выгрузить доску из Miro — инструкция</button></p>', actions: [{ label: 'Закрыть', value: false }] });
    hydrateIcons(sh.body); dndImportWidget(sh.body.querySelector('#di-host'));
}

// ---------- Настройки ДНД ----------
function renderDndSettings() {
    const info = $('#dnd-data-info'); if (!info) return;
    const chars = dndGames.reduce((n, g) => n + (g.chars || []).length, 0), cards = dndGames.reduce((n, g) => n + dndStats(g).cards, 0), blocks = dndGames.reduce((n, g) => n + dndStats(g).blocks, 0);
    info.textContent = 'Игр: ' + dndGames.length + ' · карточек на досках: ' + cards + ' · персонажей: ' + chars + ' · блоков сюжета: ' + blocks;
    const w = $('#dnd-import-host'); if (w && !w.dataset.ready) { w.dataset.ready = '1'; dndImportWidget(w); }
    const cur = dndCur(); const b = $('#dnd-cur-name'); if (b) b.textContent = cur ? cur.title : 'не выбрана';
}
function initDndSettings() {
    const bind = (id, key, num) => {
        const el = $('#' + id); if (!el) return;
        if (el.type === 'checkbox') { el.checked = !!dndCfg[key]; el.addEventListener('change', () => { dndCfg[key] = el.checked; dndCfgSave(); dndSettingsApplied(); }); }
        else { el.value = dndCfg[key]; el.addEventListener('change', () => { dndCfg[key] = num ? (+el.value || 100) : el.value; dndCfgSave(); dndSettingsApplied(); }); }
    };
    bind('dns-grid', 'grid'); bind('dns-snap', 'snap'); bind('dns-mini', 'minimap'); bind('dns-confirm', 'confirmDelete'); bind('dns-sys', 'system'); bind('dns-scale', 'textScale', true);
    ['dns-autotags:autoTags', 'dns-autotagsadd:autoTagsAdd', 'dns-autodeck:autoDeck'].forEach(p => { const [id, key] = p.split(':'), el = $('#' + id); if (!el) return; el.checked = dndCfg[key] !== false; el.addEventListener('change', () => { dndCfg[key] = el.checked; dndCfgSave(); if (typeof dndPagesReload === 'function') dndPagesReload(); }); });
    const exo = $('#dnd-export-open'); if (exo) exo.addEventListener('click', () => { const g = dndCur(); if (!g) { toast('Сначала выберите игру'); return; } dndExportSheet(g, 'board'); });
    const sel = $('#dns-sys'); sel.innerHTML = DND_SYSTEMS.map(s => '<option>' + esc(s) + '</option>').join(''); sel.value = dndCfg.system;
    const sc = $('#dns-scale'), lab = $('#dns-scale-val'); lab.textContent = dndCfg.textScale + ' %'; sc.addEventListener('input', () => { lab.textContent = sc.value + ' %'; });
    const stc = $('#dns-sticky'); stc.innerHTML = BD_COLORS.map(c => '<button type="button" class="bd-sw' + (c === dndCfg.stickyColor ? ' is-on' : '') + '" data-c="' + c + '" style="background:' + c + '" aria-label="Цвет стикера"></button>').join('');
    stc.addEventListener('click', e => { const b = e.target.closest('.bd-sw'); if (!b) return; dndCfg.stickyColor = b.dataset.c; dndCfgSave(); $$('.bd-sw', stc).forEach(x => x.classList.toggle('is-on', x === b)); });
    // какие разделы листа персонажа показывать
    const secs = typeof DC_SECTIONS !== 'undefined' ? DC_SECTIONS : [];
    const box = $('#dns-sections');
    box.innerHTML = secs.map(s => '<label class="dns-sec"><input type="checkbox" class="switch" data-s="' + s.k + '"' + (dndCfg.sections[s.k] === false ? '' : ' checked') + '><span>' + esc(s.n) + '</span></label>').join('');
    box.addEventListener('change', e => { const c = e.target.closest('[data-s]'); if (!c) return; dndCfg.sections[c.dataset.s] = c.checked; dndCfgSave(); if (typeof dndPagesReload === 'function') dndPagesReload(); });
    $('#dnd-export-all').addEventListener('click', () => dndExportGames(null));
    const inp = $('#dnd-import-file'); $('#dnd-import-games').addEventListener('click', () => { inp.value = ''; inp.click(); });
    inp.addEventListener('change', async () => {
        if (!inp.files[0]) return;
        const res = await dndImportFiles([inp.files[0]], { mode: 'new' });
        if (!res.games.length) { toast(res.notes[0] || 'В файле нет игр iLife'); return; }
        await dndApplyImport(res, { mode: 'new' }); renderDndGames(); renderDndSettings(); toast('Загружено игр: ' + res.games.length);
    });
    $('#dnd-clear-all').addEventListener('click', async () => {
        if (!dndGames.length) { toast('Игр нет'); return; }
        const ok = await confirmSheet('Удалить все игры?', 'Будут удалены все игры, доски, персонажи и сюжеты (' + dndGames.length + '). Лучше сначала сохранить файл. Отменить нельзя.', 'Удалить всё', true);
        if (!ok) return;
        const refs = dndMediaRefs(dndGames); dndGames = []; dndActiveId = ''; LS.set('dnd_active', ''); saveDnd(); refs.forEach(id => BlobDB.del(id));
        renderDndGames(); renderDndSettings(); dndRefreshHeaders(); if (typeof dndPagesReload === 'function') dndPagesReload(); toast('Все игры удалены');
    });
}
function dndSettingsApplied() {
    document.documentElement.style.setProperty('--bd-text-scale', String((dndCfg.textScale || 100) / 100));
    if (typeof dndBoardsApplyCfg === 'function') dndBoardsApplyCfg();
}

// ---------- Запуск ----------
function initDnd() {
    $$('[data-dnd-open]').forEach(b => b.addEventListener('click', dndOpen));
    $$('[data-dnd-back]').forEach(b => b.addEventListener('click', dndBack));
    initDndGames(); initDndSettings();
    if (typeof initDndBoards === 'function') initDndBoards();
    if (typeof initDndChars === 'function') initDndChars();
    if (typeof initDndCity === 'function') initDndCity();
    dndSettingsApplied();
    if (dndActiveId && !dndGame(dndActiveId)) dndActiveId = '';
    renderDndGames(); renderDndSettings(); dndRefreshHeaders();
}
