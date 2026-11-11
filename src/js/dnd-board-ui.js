'use strict';
// =====================================================================================================
// iLife 2.0.0 — ДОСКА: панели (верхняя, инструменты, плавающая панель выделения), всплывающие меню, миникарта,
// шаблоны, автораскладка сюжета, сохранение в PNG. Дополняет класс DndBoard из js/dnd-board.js.
// =====================================================================================================

// ---------- Шаблоны ----------
function bdTemplateItems(name, ox, oy) {
    const out = [], ref = {}; ox = ox || 0; oy = oy || 0;
    const add = (key, t, p) => { const it = bdItem(t, Object.assign({}, p, { x: (p.x || 0) + ox, y: (p.y || 0) + oy })); if (key) ref[key] = it; out.push(it); return it; };
    const link = (a, b, p) => out.push(bdItem('conn', Object.assign({ from: { id: ref[a].id, side: 'auto' }, to: { id: ref[b].id, side: 'auto' } }, p || {})));
    const card = (key, kind, title, text, x, y) => add(key, 'card', { kind, title, text, x, y });
    if (name === 'start') {
        const fr = [['Мир', 0, 0], ['Герои', 624, 0], ['Локации', 1248, 0], ['Квесты', 0, 480], ['Монстры', 624, 480], ['Предметы', 1248, 480]];
        fr.forEach(f => add(null, 'frame', { x: f[1], y: f[2], w: 584, h: 440, title: f[0], c: '#6750a4' }));
        card('w1', 'rule', 'Основа мира', 'Эпоха, магия, главные силы, что известно всем.', 24, 60);
        card('h1', 'char', 'Главный герой', 'Имя, класс, ключевая черта, чего хочет.', 648, 60); card('h2', 'char', 'Союзник', 'Кто рядом с героем и почему.', 924, 60);
        card('l1', 'loc', 'Стартовая локация', 'Где начинается история.', 1272, 60); card('l2', 'loc', 'Опасное место', 'Куда лучше не ходить.', 1272, 246);
        card('q1', 'quest', 'Главный квест', 'Цель, ставки, срок.', 24, 540); card('q2', 'quest', 'Побочный квест', 'Небольшая история на вечер.', 300, 540);
        card('m1', 'mon', 'Главный злодей', 'Мотив, сила, слабость.', 648, 540); card('m2', 'mon', 'Свита', 'Прислужники и стражи.', 924, 540);
        card('i1', 'item', 'Артефакт', 'Что делает, чего стоит.', 1272, 540);
    } else if (name === 'session') {
        const cols = [['Что было в прошлый раз', '#ffe066'], ['Цели сессии', '#b9efb8'], ['Сцены', '#b4d5ff'], ['Персонажи и NPC', '#ffc8e6'], ['Награды', '#ffd18c'], ['Вопросы игрокам', '#d8c4ff']];
        add(null, 'frame', { x: 0, y: 0, w: cols.length * 230 + 20, h: 300, title: 'Подготовка сессии', c: '#00897b' });
        cols.forEach((c, i) => add(null, 'sticky', { x: 20 + i * 230, y: 40, w: 210, h: 230, text: c[0] + '\n\n', c: c[1], fs: 16 }));
    } else if (name === 'quests') {
        card('m', 'quest', 'Главный квест', 'Что нужно сделать, чтобы победить.', 0, 160);
        card('a', 'quest', 'Шаг 1', 'Найти проводника.', 340, 0); card('b', 'quest', 'Шаг 2', 'Пройти через проклятый лес.', 340, 220); card('c', 'quest', 'Шаг 3', 'Добыть ключ у стража.', 340, 440);
        card('r', 'item', 'Награда', 'Артефакт и благодарность города.', 680, 220);
        link('m', 'a'); link('m', 'b'); link('m', 'c'); link('a', 'r'); link('b', 'r'); link('c', 'r');
    } else if (name === 'map') {
        card('c', 'loc', 'Город', 'Отправная точка: гильдия, рынок, таверна.', 0, 120); card('f', 'loc', 'Лес', 'Тропы, разбойники, друиды.', 340, 0);
        card('r', 'loc', 'Руины', 'Старая башня над рекой.', 340, 260); card('d', 'loc', 'Подземелье', 'Главная опасность кампании.', 680, 120);
        link('c', 'f'); link('c', 'r'); link('f', 'd'); link('r', 'd');
    } else if (name === 'acts') {
        const b = (k, kind, title, text, x, y) => add(k, 'block', { kind, title, text, x, y });
        b('s', 'start', 'Завязка', 'Что происходит в начале, что зовёт героев в путь.', 0, 100); b('a', 'scene', 'Первое испытание', 'Знакомство с миром и опасностями.', 330, 100);
        b('c', 'choice', 'Развилка', 'Герои выбирают, кому поверить.', 660, 100);
        b('x', 'combat', 'Бой с хранителем', 'Путь силы.', 990, 0); b('y', 'event', 'Тайный ход', 'Путь хитрости.', 990, 200);
        b('f', 'end', 'Финал', 'Развязка и последствия выбора.', 1320, 100);
        link('s', 'a'); link('a', 'c'); link('c', 'x', { label: 'силой' }); link('c', 'y', { label: 'хитростью' }); link('x', 'f'); link('y', 'f');
    } else if (name === 'dungeon') {
        const b = (k, kind, title, text, x, y) => add(k, 'block', { kind, title, text, x, y });
        b('e', 'loc', 'Вход', 'Каменная арка, следы на песке.', 0, 80); b('h', 'event', 'Ловушка в коридоре', 'Проверка внимательности.', 330, 80);
        b('g', 'combat', 'Зал стражей', 'Три скелета и командир.', 660, 0); b('t', 'reward', 'Тайник', 'Награда за поиск.', 660, 200); b('b', 'combat', 'Логово босса', 'Главный бой.', 990, 100); b('o', 'end', 'Выход', 'Возвращение с трофеями.', 1320, 100);
        link('e', 'h'); link('h', 'g'); link('h', 't'); link('g', 'b'); link('t', 'b'); link('b', 'o');
    }
    let z = 1; out.forEach(i => { i.z = i.t === 'frame' ? 0 : z++; });
    return out;
}
const BD_TEMPLATES = {
    board: [['start', 'Старт кампании', 'Мир, герои, локации, квесты, монстры и предметы — по рамке на каждое.', 'dnd_board'], ['session', 'Подготовка сессии', 'Шесть стикеров: прошлый раз, цели, сцены, персонажи, награды, вопросы.', 'sticky'],
        ['quests', 'Дерево квестов', 'Главный квест, три шага и награда, соединённые стрелками.', 'flag'], ['map', 'Карта локаций', 'Город, лес, руины и подземелье со связями между ними.', 'map']],
    plot: [['acts', 'Сюжет с развилкой', 'Завязка → испытание → выбор (силой или хитростью) → финал.', 'account_tree'], ['dungeon', 'Подземелье', 'Вход, ловушка, зал стражей, тайник, босс и выход.', 'skull']]
};

// ---------- Панели ----------
Object.assign(DndBoard.prototype, {
    toolDefs() {
        return this.mode === 'plot' ?
            [['select', 'cursor', 'Выбор (V)'], ['hand', 'hand', 'Рука: двигать поле (H)'], ['block', 'card', 'Блок сюжета (N)', 1], ['text', 'text_fields', 'Текст (T)'], ['frame', 'frame', 'Рамка: акт, глава (F)'], ['connect', 'connector', 'Стрелка между блоками (C)', 1]] :
            [['select', 'cursor', 'Выбор (V)'], ['hand', 'hand', 'Рука: двигать поле (H)'], ['sticky', 'sticky', 'Стикер (N)', 1], ['card', 'card', 'Карточка (K)', 1], ['text', 'text_fields', 'Текст (T)'], ['shape', 'shapes', 'Фигуры (R)', 1], ['frame', 'frame', 'Рамка (F)'],
                ['connect', 'connector', 'Связь-стрелка (C)', 1], ['pen', 'pen', 'Рисунок от руки (P)', 1], ['image', 'add_photo_alternate', 'Картинка с устройства']];
    },
    buildUi() {
        const plot = this.mode === 'plot';
        this.top.innerHTML =
            '<span class="bd-gb" data-dnd-gamebar></span><span class="bd-sep"></span>' +
            '<button type="button" class="bd-b" data-a="undo" title="Отменить (Ctrl+Z)">' + ic('undo') + '</button><button type="button" class="bd-b" data-a="redo" title="Вернуть (Ctrl+Shift+Z)">' + ic('redo') + '</button><span class="bd-sep"></span>' +
            '<button type="button" class="bd-b" data-a="zout" title="Уменьшить">' + ic('remove') + '</button><button type="button" class="bd-b bd-zl" data-a="z100" title="Масштаб 100 %" data-z-label>100 %</button><button type="button" class="bd-b" data-a="zin" title="Увеличить">' + ic('add') + '</button>' +
            '<button type="button" class="bd-b" data-a="fit" title="Показать всё (Shift+1)">' + ic('fit') + '</button><span class="bd-sep"></span>' +
            '<button type="button" class="bd-b" data-a="grid" title="Сетка">' + ic('grid') + '</button>' + (plot ? '' : '<button type="button" class="bd-b" data-a="snap" title="Прилипание к сетке">' + ic('magnet') + '</button>') +
            '<button type="button" class="bd-b" data-a="mini" title="Миникарта">' + ic('minimap') + '</button>' +
            (plot ? '<span class="bd-sep"></span><button type="button" class="bd-b bd-bt" data-a="arrange" title="Выстроить блоки по порядку слева направо">' + ic('auto_arrange') + '<span>Выстроить</span></button>' : '') +
            '<button type="button" class="bd-b" data-a="more" title="Ещё">' + ic('more_horiz') + '</button>';
        this.toolsEl.innerHTML = this.toolDefs().map(t => '<button type="button" class="bd-t" data-tool="' + t[0] + '" title="' + t[2] + '"' + (t[3] ? ' data-opts="1"' : '') + '>' + ic(t[1]) + (t[3] ? '<i class="bd-tc"></i>' : '') + '</button>').join('');
        this.top.addEventListener('click', e => { const b = e.target.closest('[data-a]'); if (b) this.topAction(b.dataset.a, b); });
        this.toolsEl.addEventListener('click', e => { const b = e.target.closest('[data-tool]'); if (b) this.toolClick(b.dataset.tool, b); });
        this.emptyEl.addEventListener('click', e => { if (e.target.closest('[data-bd-newgame]')) dndGameFormSheet(null, () => dndPagesReload()); });
        this.mini.addEventListener('pointerdown', e => { this.miniMove(e); const mv = ev => this.miniMove(ev), up = () => { window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); }; window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up); });
        this.fileEl.addEventListener('change', () => { const fs = Array.from(this.fileEl.files); this.fileEl.value = ''; if (fs.length) this.dropFiles(fs, this.viewCenter()); });
        document.addEventListener('pointerdown', e => { if (!this.popEl.hidden && !e.target.closest('.bd-pop,.bd-t,.bd-b,.bd-ctx button')) this.closePop(); }, true);
        this.penColor = '#1d1b20'; this.penWidth = 3; this.connStyle = 'curve'; this.connHead = 'end'; this.connColor = '#5f5b66';
        this.toolArgs = { sticky: null, card: 'note', shape: 'rect', block: 'scene' };
        this.miniOn = dndCfg.minimap !== false;
    },
    syncUi() {
        const q = a => this.top.querySelector('[data-a="' + a + '"]');
        const set = (a, on, dis) => { const b = q(a); if (b) { b.classList.toggle('is-on', !!on); if (dis != null) b.disabled = dis; } };
        set('undo', false, this.hi <= 0); set('redo', false, this.hi >= this.hist.length - 1);
        set('grid', this.grid); set('snap', this.snap); set('mini', this.miniOn);
        this.toolsEl.querySelectorAll('[data-tool]').forEach(b => b.classList.toggle('is-on', b.dataset.tool === this.tool));
        this.v.dataset.tool = this.tool;
        this.drawMini();
    },
    setTool(t, arg) {
        this.tool = t; if (arg !== undefined) this.toolArg = arg; else this.toolArg = this.toolArgs[t] != null ? this.toolArgs[t] : null;
        if (t !== 'connect') { this.pendFrom = null; this.hint(''); }
        this.root.dataset.tool = t; this.syncUi(); this.closePop();
        this.root.classList.toggle('show-dots', t === 'connect');
    },
    toolClick(t, btn) {
        if (t === 'image') { this.fileEl.click(); return; }
        const had = this.tool === t;
        this.setTool(t === 'select' || !had ? t : (btn.dataset.opts ? t : 'select'));
        if (btn.dataset.opts && this.tool === t) this.toolMenu(t, btn);
        if (t === 'connect' && this.tool === 'connect') this.hint('Потяните от точки на карточке к другой карточке или нажмите на две карточки по очереди');
    },
    topAction(a, btn) {
        if (a === 'undo') this.undo(); else if (a === 'redo') this.redo();
        else if (a === 'zin') this.zoomBy(1.25); else if (a === 'zout') this.zoomBy(0.8); else if (a === 'z100') { const r = this.v.getBoundingClientRect(); this.zoomAt(r.left + r.width / 2, r.top + r.height / 2, 1); }
        else if (a === 'fit') this.fit();
        else if (a === 'grid') { this.grid = !this.grid; if (this.model) this.model.grid = this.grid; this.o.onChange && this.o.onChange(this.game); this.applyView(); this.syncUi(); }
        else if (a === 'snap') { this.snap = !this.snap; if (this.model) this.model.snap = this.snap; this.o.onChange && this.o.onChange(this.game); this.syncUi(); toast(this.snap ? 'Прилипание к сетке включено' : 'Прилипание выключено'); }
        else if (a === 'mini') { this.miniOn = !this.miniOn; dndCfg.minimap = this.miniOn; dndCfgSave(); this.drawMini(); this.syncUi(); }
        else if (a === 'arrange') this.autoArrange();
        else if (a === 'more') this.moreMenu(btn);
    },
    dndCfgChanged() { this.miniOn = dndCfg.minimap !== false; if (this.game && this.mode === 'board') { this.snap = !!this.model.snap; } this.syncUi(); },

    // ---------- Всплывающие окошки ----------
    closePop() { this.popEl.hidden = true; this.popEl.innerHTML = ''; },
    pop(anchor, node, where) {
        const vr = this.v.getBoundingClientRect(), ar = anchor.getBoundingClientRect();
        this.popEl.innerHTML = ''; this.popEl.appendChild(node); this.popEl.hidden = false;
        const pw = this.popEl.offsetWidth, ph = this.popEl.offsetHeight;
        let x, y;
        if (where === 'below') { x = ar.left - vr.left; y = ar.bottom - vr.top + 6; }
        else if (where === 'above') { x = ar.left - vr.left + ar.width / 2 - pw / 2; y = ar.top - vr.top - ph - 8; }
        else if (ar.left < vr.left + 8) { x = ar.right - vr.left + 8; y = ar.top - vr.top; }
        else { x = ar.left - vr.left; y = ar.bottom - vr.top + 6; }
        const compactTools = this.toolsEl.contains(anchor) && getComputedStyle(this.toolsEl).flexDirection === 'row';
        if (compactTools) { x = ar.left - vr.left + ar.width / 2 - pw / 2; y = ar.top - vr.top - ph - 8; }
        x = bdClamp(x, 6, Math.max(6, vr.width - pw - 6)); y = bdClamp(y, 6, Math.max(6, vr.height - ph - 6));
        this.popEl.style.left = x + 'px'; this.popEl.style.top = y + 'px';
    },
    swatches(colors, cur, pick, withNone) {
        const box = document.createElement('div'); box.className = 'bd-sws';
        colors.forEach(c => { const b = document.createElement('button'); b.type = 'button'; b.className = 'bd-sw' + (c === cur ? ' is-on' : ''); b.style.background = c; b.setAttribute('aria-label', 'Цвет ' + c); b.addEventListener('click', () => pick(c)); box.appendChild(b); });
        if (withNone) { const b = document.createElement('button'); b.type = 'button'; b.className = 'bd-sw is-none' + (cur === 'none' ? ' is-on' : ''); b.title = 'Без заливки'; b.addEventListener('click', () => pick('none')); box.appendChild(b); }
        return box;
    },
    listPop(rows, cur, pick) {
        const box = document.createElement('div'); box.className = 'bd-list';
        rows.forEach(r => { const b = document.createElement('button'); b.type = 'button'; b.className = 'bd-li' + (r.k === cur ? ' is-on' : ''); b.innerHTML = (r.c ? '<i class="bd-dotc" style="background:' + r.c + '"></i>' : '') + (r.i ? ic(r.i) : '') + '<span>' + esc(r.n) + '</span>'; b.addEventListener('click', () => pick(r.k)); box.appendChild(b); });
        return box;
    },
    toolMenu(t, btn) {
        const cur = this.toolArg;
        if (t === 'sticky') this.pop(btn, this.swatches(BD_COLORS, cur || dndCfg.stickyColor, c => { this.toolArgs.sticky = c; this.toolArg = c; this.closePop(); }));
        else if (t === 'card') this.pop(btn, this.listPop(BD_CARD_KINDS.map(k => ({ k: k.k, n: k.n, c: k.c, i: k.i })), cur, k => { this.toolArgs.card = k; this.toolArg = k; this.closePop(); }));
        else if (t === 'block') this.pop(btn, this.listPop(BD_PLOT_KINDS.map(k => ({ k: k.k, n: k.n, c: k.c, i: k.i })), cur, k => { this.toolArgs.block = k; this.toolArg = k; this.closePop(); }));
        else if (t === 'shape') this.pop(btn, this.listPop(BD_SHAPES, cur, k => { this.toolArgs.shape = k; this.toolArg = k; this.closePop(); }));
        else if (t === 'connect') {
            const box = document.createElement('div'); box.className = 'bd-form';
            box.innerHTML = '<div class="bd-fr"><span>Линия</span><div class="bd-seg" data-k="style">' + [['curve', 'line_curve'], ['straight', 'line_straight'], ['elbow', 'line_elbow']].map(s => '<button type="button" data-v="' + s[0] + '" class="' + (this.connStyle === s[0] ? 'is-on' : '') + '">' + ic(s[1]) + '</button>').join('') + '</div></div>' +
                '<div class="bd-fr"><span>Концы</span><div class="bd-seg" data-k="head">' + [['none', 'head_none'], ['end', 'head_end'], ['both', 'head_both']].map(s => '<button type="button" data-v="' + s[0] + '" class="' + (this.connHead === s[0] ? 'is-on' : '') + '">' + ic(s[1]) + '</button>').join('') + '</div></div>';
            box.addEventListener('click', e => { const b = e.target.closest('button[data-v]'); if (!b) return; const k = b.parentNode.dataset.k; if (k === 'style') this.connStyle = b.dataset.v; else this.connHead = b.dataset.v; b.parentNode.querySelectorAll('button').forEach(x => x.classList.toggle('is-on', x === b)); });
            this.pop(btn, box);
        } else if (t === 'pen') {
            const box = document.createElement('div'); box.className = 'bd-form';
            box.appendChild(this.swatches(['#1d1b20', '#c62828', '#e65100', '#f9a825', '#2e7d32', '#1565c0', '#6a1b9a', '#ffffff'], this.penColor, c => { this.penColor = c; box.querySelectorAll('.bd-sw').forEach(x => x.classList.toggle('is-on', x.style.background === c || x.getAttribute('aria-label') === 'Цвет ' + c)); }));
            const w = document.createElement('div'); w.className = 'bd-seg'; w.innerHTML = [2, 3, 5, 9].map(n => '<button type="button" data-w="' + n + '" class="' + (this.penWidth === n ? 'is-on' : '') + '"><i style="height:' + n + 'px"></i></button>').join('');
            w.addEventListener('click', e => { const b = e.target.closest('button[data-w]'); if (!b) return; this.penWidth = +b.dataset.w; w.querySelectorAll('button').forEach(x => x.classList.toggle('is-on', x === b)); });
            box.appendChild(w); this.pop(btn, box);
        }
    },
    moreMenu(btn) {
        const list = document.createElement('div'); list.className = 'bd-list';
        const rows = [['tpl', 'layers', 'Шаблоны…'], ['png', 'download', 'Сохранить картинкой (PNG)'], ['exp', 'picture_as_pdf', 'Экспорт игры: Miro, PDF, текст…'], ['imp', 'file_upload', 'Импорт из Miro и файлов…'], ['emo', 'emoji', 'Картинка из эмодзи (по рисунку)…'], ['all', 'fit', 'Показать всё'], ['clr', 'delete', 'Очистить доску']];
        rows.forEach(r => { const b = document.createElement('button'); b.type = 'button'; b.className = 'bd-li' + (r[0] === 'clr' ? ' is-danger' : ''); b.innerHTML = ic(r[1]) + '<span>' + r[2] + '</span>'; b.addEventListener('click', () => { this.closePop(); this.moreAction(r[0]); }); list.appendChild(b); });
        this.pop(btn, list, 'below');
    },
    async moreAction(a) {
        if (!this.game) return;
        if (a === 'tpl') this.templateSheet(); else if (a === 'png') this.exportPng(); else if (a === 'exp') dndExportSheet(this.game, this.mode); else if (a === 'imp') dndImportSheet(); else if (a === 'emo') dndEmojiPick(this); else if (a === 'all') this.fit();
        else if (a === 'clr') {
            if (!this.items.length) { toast('Доска и так пуста'); return; }
            const ok = await confirmSheet('Очистить доску?', 'Все предметы на этой доске будут удалены. Сразу после очистки её можно вернуть кнопкой «Отменить».', 'Очистить', true);
            if (ok) { this.removeItems(this.items.map(i => i.id)); this.commit(); }
        }
    },
    templateSheet() {
        const list = BD_TEMPLATES[this.mode];
        const sh = openSheet({
            title: 'Шаблоны', html: '<div class="dg-menu">' + list.map(t => '<button type="button" class="dg-mi bd-tplb" data-t="' + t[0] + '">' + ic(t[3]) + '<span><b>' + esc(t[1]) + '</b><small>' + esc(t[2]) + '</small></span></button>').join('') + '</div>', actions: [{ label: 'Закрыть', value: false }],
            onOpen: api => api.body.addEventListener('click', e => { const b = e.target.closest('[data-t]'); if (!b) return; api.close(); this.insertTemplate(b.dataset.t); })
        });
        hydrateIcons(sh.body);
    },
    insertTemplate(name) {
        const probe = bdTemplateItems(name, 0, 0), b = this.bounds(probe) || { x: 0, y: 0, w: 400, h: 300 }, c = this.viewCenter();
        let ox = Math.round(c.x - b.x - b.w / 2), oy = Math.round(c.y - b.y - b.h / 2);
        const items = bdTemplateItems(name, ox, oy); let z = this.nextZ();
        items.forEach(i => { if (i.t !== 'conn') i.z = i.t === 'frame' ? 0 : z++; this.items.push(i); });
        this.reindex(); items.forEach(i => this.paint(i)); this.select(items.filter(i => i.t !== 'conn').map(i => i.id)); this.updateEmpty(); this.commit();
        const bb = this.bounds(items); if (bb) { const r = this.v.getBoundingClientRect(); const z0 = bdClamp(Math.min((r.width - 80) / bb.w, (r.height - 80) / bb.h), 0.15, 1); this.view.z = z0; this.centerOn(bb.x + bb.w / 2, bb.y + bb.h / 2); }
        toast('Шаблон добавлен');
    },

    // ---------- Плавающая панель выделения ----------
    placeCtx() {
        const ctx = this.ctx; const list = this.selItems();
        if (!list.length || this.editEl || (this.d && (this.d.type === 'move' && this.d.moved || this.d.type === 'resize' || this.d.type === 'pan' && this.d.moved || this.d.type === 'pinch' || this.d.type === 'band' && this.d.moved))) { ctx.hidden = true; return; }
        if (this._ctxKey !== this.ctxSig()) { this.buildCtx(); this._ctxKey = this.ctxSig(); }
        ctx.hidden = false;
        let b = this.selBox();
        if (!b) { const c = list.find(i => i.t === 'conn'); if (!c) { ctx.hidden = true; return; } const g = this.connGeom(c); b = { x: g.mid.x - 2, y: g.mid.y - 2, w: 4, h: 4 }; }
        const a = this.toScreen(b.x, b.y), a2 = this.toScreen(b.x + b.w, b.y + b.h), vr = this.v.getBoundingClientRect();
        const cw = ctx.offsetWidth, ch = ctx.offsetHeight;
        let x = (a.x + a2.x) / 2 - cw / 2, y = a.y - ch - 14;
        if (y < 6) y = a2.y + 14;
        ctx.style.left = bdClamp(x, 6, Math.max(6, vr.width - cw - 6)) + 'px'; ctx.style.top = bdClamp(y, 6, Math.max(6, vr.height - ch - 6)) + 'px';
    },
    ctxSig() { return this.selItems().map(i => i.id + i.t + (i.locked ? 'L' : '') + (i.g || '') + (i.c || i.fill || i.color || '') + (i.shape || '') + (i.style || '') + (i.head || '') + (i.fs || '') + (i.fst || '') + (i.kind || '') + (i.dash ? 'd' : '') + (i.width || '') + (i.bold === false ? 'b0' : '') + (i.ital ? 'i' : '') + (i.al || '') + (i.secret ? 's' : '')).join('|') + this.tool; },
    mutate(fn, keepPop) {
        this.selItems().forEach(i => { fn(i); this.paint(i); });
        this.redrawConns(new Set(this.sel)); this.items.forEach(i => { if (i.t === 'conn' && this.sel.has(i.id)) this.drawConn(i); });
        this._ctxKey = null; this.refreshSel(); this.commit(); if (!keepPop) this.closePop();
    },
    ctxBtn(icon, title, fn, on, extraCls) {
        const b = document.createElement('button'); b.type = 'button'; b.className = 'bd-cb' + (on ? ' is-on' : '') + (extraCls ? ' ' + extraCls : ''); b.title = title; b.setAttribute('aria-label', title); b.innerHTML = icon.startsWith('<') ? icon : (window.ICONS[icon] ? ic(icon) : '<b class="bd-tx">' + esc(icon) + '</b>');
        b.addEventListener('click', e => { e.stopPropagation(); fn(b); }); return b;
    },
    buildCtx() {
        const ctx = this.ctx; ctx.innerHTML = '';
        const l = this.selItems(); if (!l.length) return;
        const types = new Set(l.map(i => i.t)), single = l.length === 1 ? l[0] : null, only = types.size === 1 ? l[0].t : null;
        const add = (...b) => b.forEach(x => ctx.appendChild(x));
        const sep = () => { const s = document.createElement('i'); s.className = 'bd-cs'; ctx.appendChild(s); };
        const swatchBtn = (col, title, fn) => { const b = this.ctxBtn('<span class="bd-cc" style="background:' + (col === 'none' ? 'transparent' : col) + '"></span>', title, fn); return b; };
        const colorPicker = (prop, colors, title, none) => swatchBtn(single ? single[prop] : l[0][prop], title, btn => this.pop(btn, this.swatches(colors, single ? single[prop] : null, c => this.mutate(i => { i[prop] = c; }), none), 'below'));
        const sizeBtns = (prop, steps, def) => {
            const step = dir => this.mutate(i => { const cur = i[prop] || def; let k = steps.findIndex(s => s >= cur); if (k < 0) k = steps.length - 1; k = bdClamp(k + dir, 0, steps.length - 1); i[prop] = steps[k]; }, true);
            add(this.ctxBtn('A−', 'Мельче', () => step(-1), false, 'is-txt'), this.ctxBtn('A+', 'Крупнее', () => step(1), false, 'is-txt'));
        };
        if (only === 'conn') {
            const cs = ['curve', 'straight', 'elbow'], hs = ['end', 'both', 'none'], ws = [1, 2, 3, 5];
            add(swatchBtn(single ? single.color : l[0].color, 'Цвет', btn => this.pop(btn, this.swatches(['#5f5b66', '#1d1b20', '#c62828', '#e65100', '#2e7d32', '#1565c0', '#6a1b9a', '#ffffff'], single && single.color, c => this.mutate(i => { i.color = c; })), 'below')));
            add(this.ctxBtn(single && single.style === 'straight' ? 'line_straight' : single && single.style === 'elbow' ? 'line_elbow' : 'line_curve', 'Вид линии', () => this.mutate(i => { i.style = cs[(cs.indexOf(i.style || 'curve') + 1) % 3]; }, true)));
            add(this.ctxBtn(single && single.head === 'both' ? 'head_both' : single && single.head === 'none' ? 'head_none' : 'head_end', 'Стрелки на концах', () => this.mutate(i => { i.head = hs[(hs.indexOf(i.head || 'end') + 1) % 3]; }, true)));
            add(this.ctxBtn('dashed', 'Пунктир', () => this.mutate(i => { i.dash = !i.dash; }, true), single && single.dash));
            add(this.ctxBtn('format_size', 'Толщина', () => this.mutate(i => { i.width = ws[(ws.indexOf(i.width || 2) + 1) % ws.length]; }, true)));
            if (single) add(this.ctxBtn('edit', 'Подпись на стрелке', () => this.editLabel(single)));
            sep();
        } else if (only === 'pen') {
            add(colorPicker('color', ['#1d1b20', '#c62828', '#e65100', '#f9a825', '#2e7d32', '#1565c0', '#6a1b9a', '#ffffff'], 'Цвет линии'));
            add(this.ctxBtn('format_size', 'Толщина', () => this.mutate(i => { const ws = [2, 3, 5, 9]; i.width = ws[(ws.indexOf(i.width || 3) + 1) % ws.length]; }, true)));
            sep();
        } else {
            if (types.has('sticky') && types.size === 1) { add(colorPicker('c', BD_COLORS, 'Цвет стикера')); sizeBtns('fs', [12, 14, 16, 18, 22, 28, 36, 48], 18); sep(); }
            if (only === 'shape') {
                add(this.ctxBtn('shapes', 'Фигура', btn => this.pop(btn, this.listPop(BD_SHAPES, single && single.shape, k => this.mutate(i => { i.shape = k; })), 'below')));
                add(colorPicker('fill', BD_COLORS, 'Заливка', true)); add(colorPicker('stroke', ['#79747e', '#1d1b20', '#c62828', '#e65100', '#2e7d32', '#1565c0', '#6a1b9a'], 'Обводка'));
                sizeBtns('fs', [12, 14, 16, 18, 22, 28, 36, 48], 18); sep();
            }
            if (only === 'text') {
                add(colorPicker('ink', BD_INKS, 'Цвет текста')); sizeBtns('fs', [14, 18, 24, 32, 44, 60, 80], 24);
                add(this.ctxBtn('sort', 'Выравнивание', () => this.mutate(i => { const a = ['left', 'center', 'right']; i.al = a[(a.indexOf(i.al || 'left') + 1) % 3]; }, true))); sep();
            }
            if (only === 'frame') { add(colorPicker('c', ['#8e8a98', '#6750a4', '#1565c0', '#00897b', '#2e7d32', '#e65100', '#c62828', '#ad1457'], 'Цвет рамки')); sep(); }
            if (only === 'card') {
                add(this.ctxBtn('tag', 'Вид карточки', btn => this.pop(btn, this.listPop(BD_CARD_KINDS.map(k => ({ k: k.k, n: k.n, c: k.c, i: k.i })), single && single.kind, k => this.mutate(i => { i.kind = k; delete i.c; })), 'below')));
            }
            if (only === 'card' || only === 'block') {
                const sc = (i, d) => { i.fs = bdClamp((i.fs || 100) + d, 60, 260); i.fst = bdClamp((i.fst || (i.fs - d)) + d, 60, 260); };
                add(this.ctxBtn('A−', 'Мельче шрифт', () => this.mutate(i => sc(i, -10), true), false, 'is-txt'), this.ctxBtn('A+', 'Крупнее шрифт', () => this.mutate(i => sc(i, 10), true), false, 'is-txt'),
                    this.ctxBtn('B', 'Жирный заголовок', () => this.mutate(i => { i.bold = i.bold === false; }, true), single && single.bold !== false, 'is-txt is-b'), this.ctxBtn('I', 'Курсив в тексте', () => this.mutate(i => { i.ital = !i.ital; }, true), single && single.ital, 'is-txt is-i'),
                    this.ctxBtn('sort', 'Выравнивание текста', () => this.mutate(i => { const a = ['left', 'center', 'right']; i.al = a[(a.indexOf(i.al || 'left') + 1) % 3]; }, true)));
                if (single) add(this.ctxBtn('compress', 'Подогнать высоту карточки под текст', () => this.fitHeight(single)));
                if (single && single.kind === 'note') add(this.ctxBtn('visibility_off', single.secret ? 'Секрет: убрать пометку' : 'Секрет: пометить полосками', () => this.mutate(i => { i.secret = !i.secret; }, true), single.secret));
                sep();
            }
            if (only === 'block') {
                add(this.ctxBtn('tag', 'Вид блока', btn => this.pop(btn, this.listPop(BD_PLOT_KINDS.map(k => ({ k: k.k, n: k.n, c: k.c, i: k.i })), single && single.kind, k => this.mutate(i => { i.kind = k; })), 'below')));
                add(this.ctxBtn('check', 'Состояние блока', btn => this.pop(btn, this.listPop(BD_PLOT_STATUS, single && single.status, k => this.mutate(i => { i.status = k; })), 'below')));
            }
            if (single && (['card', 'block', 'sticky', 'text', 'shape', 'frame', 'emoji'].includes(single.t))) add(this.ctxBtn('edit', single.t === 'card' || single.t === 'block' || single.t === 'emoji' ? 'Открыть и править' : 'Править текст', () => this.startEdit(single, false)));
            if (single && single.t === 'image' && single.imgId) add(this.ctxBtn('emoji', 'Превратить картинку в эмодзи (распознать значки или собрать мозаику)', async () => { const rec = await BlobDB.get(single.imgId); if (rec && rec.blob) dndEmojiPick(this, rec.blob); else toast('Картинка не найдена на этом устройстве'); }));
            if (single && single.t !== 'pen') add(this.ctxBtn('connector', 'Провести стрелку от этого предмета', () => { this.setTool('connect'); this.pendFrom = single.id; this.hint('Нажмите на предмет, к которому провести стрелку'); }));
            if (l.length > 1) {
                add(this.ctxBtn('al_left', 'Выровнять по левому краю', () => this.align('left')), this.ctxBtn('al_center', 'По центру (горизонтально)', () => this.align('center')), this.ctxBtn('al_right', 'По правому краю', () => this.align('right')),
                    this.ctxBtn('al_top', 'По верхнему краю', () => this.align('top')), this.ctxBtn('al_middle', 'По центру (вертикально)', () => this.align('middle')), this.ctxBtn('al_bottom', 'По нижнему краю', () => this.align('bottom')),
                    this.ctxBtn('dist_h', 'Распределить по горизонтали', () => this.align('dh')), this.ctxBtn('dist_v', 'Распределить по вертикали', () => this.align('dv')));
                add(this.ctxBtn('group', l.some(i => i.g) ? 'Разгруппировать' : 'Сгруппировать', () => l.some(i => i.g) ? this.ungroup() : this.group(), l.some(i => i.g))); sep();
            }
        }
        if (only !== 'conn') add(this.ctxBtn('to_front', 'На передний план', () => this.toFront(false)), this.ctxBtn('to_back', 'На задний план', () => this.toFront(true)));
        add(this.ctxBtn(l.every(i => i.locked) ? 'lock' : 'lock_open', l.every(i => i.locked) ? 'Открепить' : 'Закрепить на месте', () => this.toggleLock(), l.every(i => i.locked)));
        if (only !== 'conn') add(this.ctxBtn('content_copy', 'Дублировать (Ctrl+D)', () => this.duplicate()));
        add(this.ctxBtn('delete', 'Удалить', () => this.deleteSel(), false, 'is-danger'));
    },
    editLabel(c) {
        const sh = openSheet({
            title: 'Подпись на стрелке', html: '<input type="text" id="bd-lbl" maxlength="60" placeholder="Например: «если согласятся»" value="' + esc(c.label || '') + '">',
            actions: [{ label: 'Отмена', value: false }, { label: 'Сохранить', kind: 'primary', icon: 'check', onClick: api => { const v = api.body.querySelector('#bd-lbl').value.trim(); c.label = v; this.drawConn(c); this.commit(); } }],
            onOpen: api => { const i = api.body.querySelector('#bd-lbl'); setTimeout(() => { i.focus(); i.select(); }, 60); i.addEventListener('keydown', e => { if (e.key === 'Enter') { c.label = i.value.trim(); this.drawConn(c); this.commit(); api.close(); } }); }
        });
        hydrateIcons(sh.body);
    },

    // ---------- Миникарта ----------
    drawMini() {
        const cv = this.mini; if (!cv) return; const on = this.miniOn && this.items.some(i => i.t !== 'conn') && !!this.game; cv.hidden = !on; if (!on) return;
        const g = cv.getContext('2d'), W = cv.width, H = cv.height; g.clearRect(0, 0, W, H);
        const vr = this.v.getBoundingClientRect(); const vb = { x: -this.view.x / this.view.z, y: -this.view.y / this.view.z, w: vr.width / this.view.z, h: vr.height / this.view.z };
        const ib = this.bounds() || vb; const x0 = Math.min(ib.x, vb.x), y0 = Math.min(ib.y, vb.y), x1 = Math.max(ib.x + ib.w, vb.x + vb.w), y1 = Math.max(ib.y + ib.h, vb.y + vb.h);
        const pad = 12, k = Math.min((W - pad * 2) / (x1 - x0), (H - pad * 2) / (y1 - y0)); const ox = (W - (x1 - x0) * k) / 2 - x0 * k, oy = (H - (y1 - y0) * k) / 2 - y0 * k;
        this._mm = { k, ox, oy };
        const cs = getComputedStyle(this.v); g.fillStyle = cs.getPropertyValue('--md-container-high') || '#eee'; g.globalAlpha = 0.92; g.fillRect(0, 0, W, H); g.globalAlpha = 1;
        this.items.forEach(i => {
            if (i.t === 'conn') return; const b = this.box(i);
            g.fillStyle = i.t === 'sticky' ? i.c : i.t === 'frame' ? 'rgba(120,110,150,.25)' : i.t === 'card' ? bdKind(BD_CARD_KINDS, i.kind).c : i.t === 'block' ? bdKind(BD_PLOT_KINDS, i.kind).c : i.t === 'shape' ? (i.fill && i.fill !== 'none' ? i.fill : '#9a96a3') : i.t === 'pen' ? i.color : '#8d8a96';
            g.fillRect(b.x * k + ox, b.y * k + oy, Math.max(2, b.w * k), Math.max(2, b.h * k));
        });
        g.strokeStyle = cs.getPropertyValue('--md-primary') || '#6750a4'; g.lineWidth = 2.5; g.strokeRect(vb.x * k + ox, vb.y * k + oy, vb.w * k, vb.h * k);
    },
    miniMove(e) {
        if (!this._mm) return; const r = this.mini.getBoundingClientRect(), sx = this.mini.width / r.width;
        const px = (e.clientX - r.left) * sx, py = (e.clientY - r.top) * sx; const { k, ox, oy } = this._mm;
        this.centerOn((px - ox) / k, (py - oy) / k);
    },

    // ---------- Автораскладка (Сюжет) ----------
    autoArrange() {
        const nodes = this.items.filter(i => i.t !== 'conn' && i.t !== 'frame' && i.t !== 'pen' && !i.locked);
        if (!nodes.length) { toast('Пока нечего выстраивать'); return; }
        const ids = new Set(nodes.map(n => n.id)), edges = this.items.filter(c => c.t === 'conn' && c.from && c.to && ids.has(c.from.id) && ids.has(c.to.id));
        const level = new Map(nodes.map(n => [n.id, 0]));
        for (let it = 0; it < nodes.length; it++) { let ch = false; edges.forEach(e => { const a = level.get(e.from.id) + 1; if (a > level.get(e.to.id) && a < nodes.length) { level.set(e.to.id, a); ch = true; } }); if (!ch) break; }
        const cols = new Map(); nodes.forEach(n => { const l = level.get(n.id); if (!cols.has(l)) cols.set(l, []); cols.get(l).push(n); });
        const keys = Array.from(cols.keys()).sort((a, b) => a - b); const gapX = 110, gapY = 40; let x = 0; const pos = new Map();
        keys.forEach(k => {
            const col = cols.get(k);
            col.sort((a, b) => { const pa = edges.filter(e => e.to.id === a.id).map(e => pos.get(e.from.id)).filter(v => v != null), pb = edges.filter(e => e.to.id === b.id).map(e => pos.get(e.from.id)).filter(v => v != null); const ma = pa.length ? pa.reduce((s, v) => s + v, 0) / pa.length : a.y, mb = pb.length ? pb.reduce((s, v) => s + v, 0) / pb.length : b.y; return ma - mb; });
            const maxW = Math.max(...col.map(n => n.w)), tot = col.reduce((s, n) => s + n.h, 0) + gapY * (col.length - 1); let y = -tot / 2;
            col.forEach(n => { n.x = Math.round(x); n.y = Math.round(y); pos.set(n.id, n.y + n.h / 2); y += n.h + gapY; });
            x += maxW + gapX;
        });
        nodes.forEach(n => this.paint(n)); this.items.forEach(i => { if (i.t === 'conn') this.drawConn(i); }); this.refreshSel(); this.commit(); this.fit(); toast('Блоки выстроены слева направо');
    },

    // Подогнать высоту карточки или блока под их текст (после смены шрифта): сначала замеряем без ограничений по высоте и по числу строк
    fitHeight(it) {
        const el = this.els.get(it.id); if (!el || it.locked) return;
        const prev = el.style.height; el.classList.add('is-measuring'); el.style.height = 'auto';
        const need = Math.ceil(el.offsetHeight); el.classList.remove('is-measuring'); el.style.height = prev;
        it.h = bdClamp(need + 2, 90, 640); this.paint(it); this.redrawConns(new Set([it.id])); this._ctxKey = null; this.refreshSel(); this.commit(); toast('Высота карточки подогнана');
    },

    // Сохранение в PNG, разрезание на листы PDF и общая отрисовка предметов вынесены в js/dnd-export.js (drawScene, exportPng).
});
