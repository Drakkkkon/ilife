'use strict';
// =====================================================================================================
// iLife 2.0.0 — СТРАНИЦЫ «КОНСТРУКТОР» И «СЮЖЕТ»: запуск досок, окна правки карточки и блока сюжета («вводные»),
// просмотр картинки. Сам движок доски — js/dnd-board.js и js/dnd-board-ui.js.
// =====================================================================================================

let dndBuilder = null, dndPlot = null;
const DND_INTRO_PRESETS = ['Что видят герои', 'Что слышат и чувствуют', 'Кто здесь', 'Что известно заранее', 'Какая угроза', 'Что можно сделать', 'Что будет, если не вмешаться', 'Награда и последствия'];

function initDndBoards() {
    const mk = (host, mode) => new DndBoard({ host: $(host), mode, getGame: dndCur, onChange: g => dndTouch(g), onEdit: dndEditItem, onImage: dndViewImage });
    dndBuilder = mk('#dnd-builder-host', 'board'); dndPlot = mk('#dnd-plot-host', 'plot');
    dndBuilder.bind(dndCur()); dndPlot.bind(dndCur()); dndBuilder._dirty = dndPlot._dirty = false;
    dndRefreshHeaders();
}
function dndBoardShow(b) {
    if (!b) return; const g = dndCur();
    if (b.game !== g || b._dirty) { b.bind(g); b._dirty = false; b._needFit = !!(g && b.items.length && !(LS.get('dnd_views', {})[g.id + ':' + b.mode])); }
    requestAnimationFrame(() => { if (b._needFit) { b.fit(); b._needFit = false; } else b.applyView(); b.syncUi(); });
}
function dndBuilderOpened() { dndBoardShow(dndBuilder); }
function dndPlotOpened() { dndBoardShow(dndPlot); }
function dndPagesReload() {
    [dndBuilder, dndPlot].forEach(b => { if (!b) return; b._dirty = true; if (b.host.offsetParent) dndBoardShow(b); });
    if (typeof dndCharsReload === 'function') dndCharsReload();
}
function dndBoardsApplyCfg() { [dndBuilder, dndPlot].forEach(b => b && b.dndCfgChanged()); }
function dndEditItem(it, board) { if (it.t === 'block') dndEditBlock(it, board); else dndEditCard(it, board); }

function dndViewImage(it) {
    BlobDB.url(it.imgId).then(url => {
        if (!url) { toast('Картинка не найдена на этом устройстве'); return; }
        openSheet({ title: it.name || 'Картинка', html: '<img class="dnd-bigimg" src="' + url + '" alt="">', actions: [{ label: 'Закрыть', value: false }] });
    });
}

// ---------- Окно правки карточки ----------
function dndTagsParse(s) { return String(s || '').split(/[,;\n]+|\s+(?=#)/).map(t => t.trim().replace(/^#+/, '').trim()).filter(Boolean).slice(0, 12); }
function dndEditCard(it, board) {
    const g = board.game; if (!g) return;
    let kind = it.kind || 'note', col = it.c || '', imgId = it.imgId || '', added = [];
    const kinds = BD_CARD_KINDS.map(k => '<button type="button" class="dce-kind' + (k.k === kind ? ' is-on' : '') + '" data-k="' + k.k + '" style="--kc:' + k.c + '">' + ic(k.i) + '<span>' + esc(k.n) + '</span></button>').join('');
    const chars = (g.chars || []);
    const sh = openSheet({
        title: 'Карточка',
        html: '<div class="dce-kinds" id="dce-kinds">' + kinds + '</div>' +
            '<label class="field-label" for="dce-title">Название</label><input type="text" id="dce-title" maxlength="120" placeholder="Например, «Кузница Гримбрана»" value="' + esc(it.title) + '">' +
            '<label class="field-label" for="dce-text">Описание</label><textarea id="dce-text" rows="6" placeholder="Что важно знать об этом: внешность, цели, особенности, секреты">' + esc(it.text) + '</textarea>' +
            '<label class="field-label" for="dce-tags">Метки (через запятую)</label><input type="text" id="dce-tags" placeholder="город, торговля, опасно" value="' + esc((it.tags || []).join(', ')) + '">' +
            '<label class="field-label">Картинка</label><div class="btn-group" id="dce-imgrow"></div><input type="file" id="dce-file" accept="image/*" hidden>' +
            '<label class="field-label">Цвет полоски</label><div id="dce-col"></div>' +
            '<div id="dce-link" ' + (kind === 'char' ? '' : 'hidden') + '><label class="field-label" for="dce-char">Связь со страницей «Персонажи»</label><select id="dce-char"><option value="">— не связана —</option>' + chars.map(c => '<option value="' + esc(c.id) + '"' + (c.id === it.charId ? ' selected' : '') + '>' + esc(c.name || 'Без имени') + '</option>').join('') + '</select>' +
            '<div class="btn-group" style="margin-top:0.5rem"><button type="button" class="btn" id="dce-mkchar"><i data-i="person_add"></i>Создать персонажа из карточки</button><button type="button" class="btn btn-text" id="dce-openchar"' + (it.charId ? '' : ' hidden') + '>Открыть персонажа</button></div></div>',
        actions: [
            { label: 'Удалить', kind: 'danger', icon: 'delete', onClick: () => { setTimeout(() => { board.select([it.id]); board.deleteSel(); }, 220); } },
            { label: 'Отмена', value: false },
            {
                label: 'Сохранить', kind: 'primary', icon: 'check', value: true, onClick: api => {
                    const b = api.body, old = it.imgId;
                    it.title = b.querySelector('#dce-title').value.trim(); it.text = b.querySelector('#dce-text').value.trim(); it.tags = dndTagsParse(b.querySelector('#dce-tags').value);
                    it.kind = kind; if (col) it.c = col; else delete it.c;
                    const cs = b.querySelector('#dce-char'); if (kind === 'char' && cs && cs.value) it.charId = cs.value; else delete it.charId;
                    if (imgId) it.imgId = imgId; else delete it.imgId;
                    if (old && old !== imgId) { board._dropImgs = (board._dropImgs || []).concat([old]); }
                    added = added.filter(x => x !== imgId); added.forEach(x => dndDropImage(g, x));
                    if (it.charId) { const c = chars.find(x => x.id === it.charId); if (c) { c.cardId = it.id; if (!c.name && it.title) c.name = it.title; } }
                    board.paint(it); board.refreshSel(); board.commit();
                }
            }
        ],
        onClose: r => { if (r !== true) added.forEach(x => dndDropImage(g, x)); },
        onOpen: api => {
            hydrateIcons(api.body); const b = api.body;
            const drawImg = () => {
                const row = b.querySelector('#dce-imgrow');
                row.innerHTML = '<button type="button" class="btn" id="dce-pick">' + ic('add_photo_alternate') + (imgId ? 'Заменить картинку' : 'Добавить картинку') + '</button>' + (imgId ? '<button type="button" class="btn btn-danger" id="dce-rm">' + ic('delete') + 'Убрать</button>' : '');
                row.querySelector('#dce-pick').addEventListener('click', () => b.querySelector('#dce-file').click());
                const rm = row.querySelector('#dce-rm'); if (rm) rm.addEventListener('click', () => { imgId = ''; drawImg(); });
            };
            drawImg();
            b.querySelector('#dce-file').addEventListener('change', async e => {
                const f = e.target.files[0]; if (!f) return;
                try { const r = await dndAddImage(g, f); added.push(r.id); imgId = r.id; drawImg(); } catch (er) { console.error(er); toast('Не удалось загрузить картинку'); }
            });
            const colBox = b.querySelector('#dce-col');
            const drawCol = () => { const k = bdKind(BD_CARD_KINDS, kind); colBox.innerHTML = ''; const sw = board.swatches(['#7c4dff', '#1e88e5', '#00897b', '#2e7d32', '#f9a825', '#e65100', '#d32f2f', '#ad1457', '#546e7a'], col || null, c => { col = c; drawCol(); }); const reset = document.createElement('button'); reset.type = 'button'; reset.className = 'btn btn-text'; reset.textContent = 'По виду карточки'; reset.style.marginLeft = '0.25rem'; reset.addEventListener('click', () => { col = ''; drawCol(); }); colBox.appendChild(sw); if (col) colBox.appendChild(reset); };
            drawCol();
            b.querySelector('#dce-kinds').addEventListener('click', e => {
                const k = e.target.closest('.dce-kind'); if (!k) return; kind = k.dataset.k;
                b.querySelectorAll('.dce-kind').forEach(x => x.classList.toggle('is-on', x === k)); b.querySelector('#dce-link').hidden = kind !== 'char';
            });
            b.querySelector('#dce-mkchar').addEventListener('click', () => {
                const tmp = Object.assign({}, it, { title: b.querySelector('#dce-title').value.trim(), text: b.querySelector('#dce-text').value.trim(), tags: dndTagsParse(b.querySelector('#dce-tags').value) });
                const c = dndCharFromCard(g, tmp); it.charId = c.id; c.cardId = it.id; dndTouch(g);
                const sel = b.querySelector('#dce-char'); sel.insertAdjacentHTML('beforeend', '<option value="' + esc(c.id) + '">' + esc(c.name || 'Без имени') + '</option>'); sel.value = c.id; b.querySelector('#dce-openchar').hidden = false;
                toast('Персонаж создан — он на странице «Персонажи»');
            });
            b.querySelector('#dce-openchar').addEventListener('click', () => { const v = b.querySelector('#dce-char').value; if (!v) return; api.close(); dndCharsOpenChar(v); });
            b.querySelector('#dce-char').addEventListener('change', e => { b.querySelector('#dce-openchar').hidden = !e.target.value; });
            setTimeout(() => { const t = b.querySelector('#dce-title'); t.focus(); if (!it.title) t.select(); }, 80);
        }
    });
    return sh;
}

// ---------- Окно правки блока сюжета ----------
function dndEditBlock(it, board) {
    const g = board.game; if (!g) return;
    let kind = it.kind || 'scene', intro = JSON.parse(JSON.stringify(it.intro || [])), chosen = new Set(it.chars || []);
    const chars = g.chars || [];
    const kinds = BD_PLOT_KINDS.map(k => '<button type="button" class="dce-kind' + (k.k === kind ? ' is-on' : '') + '" data-k="' + k.k + '" style="--kc:' + k.c + '">' + ic(k.i) + '<span>' + esc(k.n) + '</span></button>').join('');
    const sh = openSheet({
        title: 'Блок сюжета',
        html: '<div class="dce-kinds" id="dce-kinds">' + kinds + '</div>' +
            '<label class="field-label" for="dbe-title">Название</label><input type="text" id="dbe-title" maxlength="120" placeholder="Например, «Засада у моста»" value="' + esc(it.title) + '">' +
            '<label class="field-label" for="dbe-text">Коротко (видно на блоке)</label><textarea id="dbe-text" rows="2" placeholder="Одна-две строки: что здесь происходит">' + esc(it.text) + '</textarea>' +
            '<label class="field-label" for="dbe-desc">Подробное описание</label><textarea id="dbe-desc" rows="6" placeholder="Развернуто: обстановка, ход событий, возможные решения игроков, чем всё может закончиться">' + esc(it.desc) + '</textarea>' +
            '<div class="dbe-introhead"><span class="field-label" style="margin:0">Вводные <b id="dbe-n"></b></span></div><div id="dbe-intro" class="dbe-intro"></div>' +
            '<div class="dbe-presets" id="dbe-presets">' + DND_INTRO_PRESETS.map(p => '<button type="button" class="chip" data-p="' + esc(p) + '">' + ic('add') + esc(p) + '</button>').join('') + '</div>' +
            '<button type="button" class="btn btn-wide" id="dbe-add" style="margin-top:0.5rem"><i data-i="add"></i>Добавить свою вводную</button>' +
            '<div class="dg-row2" style="margin-top:0.75rem"><div><label class="field-label" for="dbe-st">Состояние</label><select id="dbe-st">' + BD_PLOT_STATUS.map(s => '<option value="' + s.k + '"' + (s.k === (it.status || 'plan') ? ' selected' : '') + '>' + esc(s.n) + '</option>').join('') + '</select></div>' +
            '<div><label class="field-label" for="dbe-tags">Метки</label><input type="text" id="dbe-tags" placeholder="бой, город" value="' + esc((it.tags || []).join(', ')) + '"></div></div>' +
            '<label class="field-label">Кто участвует</label><div class="chips" id="dbe-chars">' + (chars.length ? chars.map(c => '<button type="button" class="chip' + (chosen.has(c.id) ? ' is-on' : '') + '" data-id="' + esc(c.id) + '">' + esc(c.name || 'Без имени') + '</button>').join('') : '<span class="hint">Персонажей в этой игре пока нет — добавьте их на странице «Персонажи».</span>') + '</div>' +
            '<label class="field-label" for="dbe-gm">Заметки ведущему (скрытое от игроков)</label><textarea id="dbe-gm" rows="3" placeholder="Секреты, проверки, запасные варианты">' + esc(it.gm) + '</textarea>',
        actions: [
            { label: 'Удалить', kind: 'danger', icon: 'delete', onClick: () => { setTimeout(() => { board.select([it.id]); board.deleteSel(); }, 220); } },
            { label: 'Отмена', value: false },
            {
                label: 'Сохранить', kind: 'primary', icon: 'check', value: true, onClick: api => {
                    const b = api.body;
                    it.title = b.querySelector('#dbe-title').value.trim(); it.text = b.querySelector('#dbe-text').value.trim(); it.desc = b.querySelector('#dbe-desc').value.trim(); it.gm = b.querySelector('#dbe-gm').value.trim();
                    it.kind = kind; it.status = b.querySelector('#dbe-st').value; it.tags = dndTagsParse(b.querySelector('#dbe-tags').value); it.chars = Array.from(chosen);
                    it.intro = intro.filter(x => (x.title || '').trim() || (x.text || '').trim());
                    board.paint(it); board.refreshSel(); board.commit();
                }
            }
        ],
        onOpen: api => {
            hydrateIcons(api.body); const b = api.body, list = b.querySelector('#dbe-intro');
            const drawIntro = () => {
                b.querySelector('#dbe-n').textContent = intro.length ? '· ' + intro.length : '';
                list.innerHTML = intro.length ? intro.map((x, i) => '<div class="dbe-it" data-i="' + i + '"><div class="dbe-it-h"><span class="dbe-num">' + (i + 1) + '</span><input type="text" data-f="title" maxlength="100" placeholder="Название вводной" value="' + esc(x.title) + '">' +
                    '<button type="button" class="icon-btn" data-m="up" aria-label="Выше"' + (i ? '' : ' disabled') + '>' + ic('keyboard_arrow_up') + '</button><button type="button" class="icon-btn" data-m="down" aria-label="Ниже"' + (i < intro.length - 1 ? '' : ' disabled') + '>' + ic('keyboard_arrow_down') + '</button><button type="button" class="icon-btn" data-m="del" aria-label="Убрать">' + ic('close') + '</button></div>' +
                    '<textarea data-f="text" rows="3" placeholder="Что именно рассказать или показать игрокам">' + esc(x.text) + '</textarea></div>').join('') : '<p class="hint" style="margin:0 0 0.25rem">Вводных пока нет. Добавьте готовые вопросы ниже или напишите свою.</p>';
            };
            drawIntro();
            list.addEventListener('input', e => { const row = e.target.closest('.dbe-it'); if (!row) return; intro[+row.dataset.i][e.target.dataset.f] = e.target.value; });
            list.addEventListener('click', e => {
                const btn = e.target.closest('[data-m]'); if (!btn) return; const i = +btn.closest('.dbe-it').dataset.i, m = btn.dataset.m;
                if (m === 'del') intro.splice(i, 1); else { const j = m === 'up' ? i - 1 : i + 1; if (j < 0 || j >= intro.length) return; [intro[i], intro[j]] = [intro[j], intro[i]]; }
                drawIntro();
            });
            const addIntro = title => { intro.push({ id: uid('in'), title: title || '', text: '' }); drawIntro(); const last = list.querySelector('.dbe-it:last-child'); if (last) { last.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); setTimeout(() => (last.querySelector(title ? 'textarea' : 'input') || {}).focus && last.querySelector(title ? 'textarea' : 'input').focus({ preventScroll: true }), 150); } };
            b.querySelector('#dbe-add').addEventListener('click', () => addIntro(''));
            b.querySelector('#dbe-presets').addEventListener('click', e => { const p = e.target.closest('[data-p]'); if (p) addIntro(p.dataset.p); });
            b.querySelector('#dce-kinds').addEventListener('click', e => { const k = e.target.closest('.dce-kind'); if (!k) return; kind = k.dataset.k; b.querySelectorAll('.dce-kind').forEach(x => x.classList.toggle('is-on', x === k)); });
            b.querySelector('#dbe-chars').addEventListener('click', e => { const c = e.target.closest('.chip[data-id]'); if (!c) return; const id = c.dataset.id; chosen.has(id) ? chosen.delete(id) : chosen.add(id); c.classList.toggle('is-on', chosen.has(id)); });
            setTimeout(() => { const t = b.querySelector('#dbe-title'); t.focus(); if (!it.title) t.select(); }, 80);
        }
    });
    return sh;
}
