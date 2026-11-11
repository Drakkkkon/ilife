'use strict';
// =====================================================================================================
// iLife 2.1.0 — «ДНД»: ОКНА КАРТИНКИ ИЗ ЭМОДЗИ.
//   dndEmojiImportSheet(blob) — картинка (скриншот из Miro) → сетка эмодзи: сетка находится сама, число клеток можно поправить;
//                               режим «Мозаика» собирает эмодзи-картинку из обычного рисунка.
//   dndEmojiEditor(it, board) — правка: кисть, ластик, пипетка, заливка, фон клетки, размер, «текстом».
//   dndEmojiPick(board)       — выбрать файл и добавить результат на доску (кнопка в меню «Ещё»).
// =====================================================================================================

const DND_EMOJI_BG = ['#ffffff', '#fff3a3', '#ffd18c', '#ffb4a8', '#ffc8e6', '#d8c4ff', '#b4d5ff', '#aaeaf0', '#b9efb8', '#dfe2e8', '#8e8a98', '#1d1b20'];

// ---------- Импорт из картинки ----------
function dndEmojiImportSheet(blob, o) {
    o = o || {};
    return new Promise(async resolve => {
        let an;
        try { an = await dndEmojiLoad(blob); } catch (e) { console.error(e); toast('Не удалось открыть картинку'); resolve(null); return; }
        const auto = { box: Object.assign({}, an.box), cols: an.cols, rows: an.rows };
        let mode = 'recognize', box = Object.assign({}, an.box), cols = an.cols, rows = an.rows, sets = ['sq', 'ci', 'he'], built = null, busy = false, finished = false, token = 0;
        const done = v => { if (finished) return; finished = true; resolve(v); };
        openSheet({
            title: o.title || 'Картинка из эмодзи',
            html: '<div class="em-imp">' +
                '<div class="seg" id="emi-mode"><button type="button" data-m="recognize" class="is-on">' + ic('emoji') + '<span>Узнать эмодзи</span></button><button type="button" data-m="mosaic">' + ic('image') + '<span>Мозаика из рисунка</span></button></div>' +
                '<p class="hint" id="emi-hint" style="margin:0.5rem 0"></p>' +
                '<div class="em-prev"><canvas id="emi-src" aria-label="Исходная картинка с сеткой"></canvas></div>' +
                '<div class="em-steps"><div><label class="field-label" for="emi-cols">Столбцов</label><div class="em-num"><button type="button" class="icon-btn" data-st="cols-" aria-label="Меньше">−</button><input type="number" id="emi-cols" min="1" max="120" inputmode="numeric"><button type="button" class="icon-btn" data-st="cols+" aria-label="Больше">+</button></div></div>' +
                '<div><label class="field-label" for="emi-rows">Строк</label><div class="em-num"><button type="button" class="icon-btn" data-st="rows-" aria-label="Меньше">−</button><input type="number" id="emi-rows" min="1" max="120" inputmode="numeric"><button type="button" class="icon-btn" data-st="rows+" aria-label="Больше">+</button></div></div></div>' +
                '<details class="em-area"><summary>' + ic('crop') + 'Область рисунка на картинке</summary><div class="em-area-b"><p class="hint" style="margin:0 0 0.5rem">Сдвиньте края так, чтобы рамка проходила ровно по внешним значкам. Лишнее (меню Miro, поля) оставьте снаружи.</p>' +
                ['l:Слева', 't:Сверху', 'r:Справа', 'b:Снизу'].map(s => { const [k, n] = s.split(':'); return '<label class="em-sl"><span>' + n + '</span><input type="range" min="0" max="60" step="0.25" data-a="' + k + '" aria-label="' + n + '"></label>'; }).join('') +
                '<button type="button" class="btn" id="emi-regrid">' + ic('auto_arrange') + 'Определить сетку заново</button></div></details>' +
                '<div id="emi-mos" hidden><span class="field-label">Из каких значков собрать</span><div class="chips" id="emi-sets">' +
                [['sq', 'Квадраты'], ['ci', 'Круги'], ['he', 'Сердца'], ['fx', 'Фрукты, цветы, звери']].map(s => '<button type="button" class="chip' + (sets.includes(s[0]) ? ' is-on' : '') + '" data-s="' + s[0] + '">' + s[1] + '</button>').join('') + '</div></div>' +
                '<button type="button" class="btn btn-primary btn-wide" id="emi-run" style="margin-top:0.75rem">' + ic('refresh') + '<span>Распознать</span></button>' +
                '<div class="em-prog" id="emi-prog" hidden><i></i></div>' +
                '<div class="em-prev" id="emi-resw" hidden><canvas id="emi-res" aria-label="Результат"></canvas></div><p class="hint" id="emi-rh" style="margin:0.5rem 0 0"></p></div>',
            actions: [{ label: 'Отмена', value: false }, { label: 'Добавить на доску', kind: 'primary', icon: 'check', value: true, onClick: () => { if (!built) { toast('Сначала нажмите «Распознать»'); return false; } if (busy) { toast('Подождите, идёт распознавание'); return false; } } }],
            onClose: r => { token++; if (r === true && built) done({ data: built, w: an.w, h: an.h }); else done(null); },
            onOpen: api => {
                hydrateIcons(api.body); const b = api.body, $q = s => b.querySelector(s);
                const hint = $q('#emi-hint'), cIn = $q('#emi-cols'), rIn = $q('#emi-rows'), src = $q('#emi-src'), res = $q('#emi-res');
                const setHint = () => { hint.textContent = mode === 'recognize' ?
                    'Это для картинки, собранной из эмодзи (например, скриншот из Miro). Сетка найдена' + (an.conf > 0.12 ? ' сама' : ' приблизительно — проверьте число столбцов') + ', каждая клетка сравнивается с эмодзи вашего устройства.' :
                    'Для обычного рисунка или фото: оно будет собрано из цветных значков. Чем больше столбцов, тем точнее и тем мельче значки.'; };
                const drawSrc = () => {
                    const W = Math.min(b.clientWidth - 8 || 320, 380), k = W / an.w; src.width = Math.round(an.w * k); src.height = Math.round(an.h * k);
                    const c = src.getContext('2d'); c.drawImage(an.cv, 0, 0, src.width, src.height);
                    c.strokeStyle = 'rgba(103,80,164,.9)'; c.lineWidth = 1; c.beginPath();
                    const x0 = box.x * k, y0 = box.y * k, x1 = (box.x + box.w) * k, y1 = (box.y + box.h) * k;
                    for (let i = 0; i <= cols; i++) { const x = x0 + (x1 - x0) * i / cols; c.moveTo(x, y0); c.lineTo(x, y1); }
                    for (let j = 0; j <= rows; j++) { const y = y0 + (y1 - y0) * j / rows; c.moveTo(x0, y); c.lineTo(x1, y); }
                    c.stroke(); c.strokeStyle = '#e53935'; c.lineWidth = 2; c.strokeRect(x0, y0, x1 - x0, y1 - y0);
                };
                const syncNums = () => { cIn.value = cols; rIn.value = rows; };
                const syncSliders = () => { b.querySelectorAll('[data-a]').forEach(s => { const a = s.dataset.a; s.value = a === 'l' ? box.x / an.w * 100 : a === 't' ? box.y / an.h * 100 : a === 'r' ? (an.w - box.x - box.w) / an.w * 100 : (an.h - box.y - box.h) / an.h * 100; }); };
                const squareRows = () => Math.max(1, Math.min(120, Math.round(box.h / (box.w / cols))));
                const stale = () => { built = null; $q('#emi-resw').hidden = true; $q('#emi-rh').textContent = ''; token++; };
                const redo = () => { syncNums(); drawSrc(); stale(); };
                setHint(); syncNums(); syncSliders(); drawSrc();
                $q('#emi-mode').addEventListener('click', e => {
                    const m = e.target.closest('button[data-m]'); if (!m || busy) return; mode = m.dataset.m;
                    b.querySelectorAll('#emi-mode button').forEach(x => x.classList.toggle('is-on', x === m)); $q('#emi-mos').hidden = mode !== 'mosaic';
                    if (mode === 'mosaic') { box = { x: 0, y: 0, w: an.w, h: an.h }; cols = Math.min(120, Math.max(8, o.mosaicCols || 32)); rows = squareRows(); }
                    else { box = Object.assign({}, auto.box); cols = auto.cols; rows = auto.rows; }
                    setHint(); syncSliders(); redo();
                });
                b.addEventListener('click', e => {
                    const s = e.target.closest('[data-st]'); if (!s) return; const [k, sg] = [s.dataset.st.slice(0, 4), s.dataset.st.slice(4)];
                    const dlt = sg === '+' ? 1 : -1;
                    if (k === 'cols') { cols = Math.max(1, Math.min(120, cols + dlt)); rows = squareRows(); } else rows = Math.max(1, Math.min(120, rows + dlt));
                    redo();
                });
                [cIn, rIn].forEach(inp => inp.addEventListener('change', () => { const v = Math.max(1, Math.min(120, Math.round(+inp.value) || 1)); if (inp === cIn) { cols = v; rows = squareRows(); } else rows = v; redo(); }));
                b.querySelectorAll('[data-a]').forEach(s => s.addEventListener('input', () => {
                    const g = a => +b.querySelector('[data-a="' + a + '"]').value;
                    const l = g('l') / 100 * an.w, t = g('t') / 100 * an.h, r = g('r') / 100 * an.w, bt = g('b') / 100 * an.h;
                    if (an.w - l - r < 8 || an.h - t - bt < 8) return;
                    box = { x: Math.round(l), y: Math.round(t), w: Math.round(an.w - l - r), h: Math.round(an.h - t - bt) }; drawSrc(); stale();
                }));
                $q('#emi-regrid').addEventListener('click', () => { const g = dndEmojiGuess(Object.assign({}, an, { box })); cols = Math.min(120, g.cols); rows = Math.min(120, g.rows); an.conf = g.conf; setHint(); redo(); });
                $q('#emi-sets').addEventListener('click', e => { const c = e.target.closest('[data-s]'); if (!c) return; const k = c.dataset.s; sets = sets.includes(k) ? sets.filter(x => x !== k) : sets.concat(k); if (!sets.length) sets = [k]; b.querySelectorAll('#emi-sets .chip').forEach(x => x.classList.toggle('is-on', sets.includes(x.dataset.s))); stale(); });
                const run = async () => {
                    if (busy) return; busy = true; const my = ++token, btn = $q('#emi-run'), prog = $q('#emi-prog'); btn.disabled = true; prog.hidden = false; prog.firstChild.style.width = '0%';
                    try {
                        const out = await dndEmojiBuild(an, { cols, rows, box, mode, sets }, p => { if (my === token) prog.firstChild.style.width = Math.round(p * 100) + '%'; });
                        if (my !== token) return;
                        built = out; const px = Math.max(5, Math.min(36, Math.floor(380 / cols))); res.width = cols * px; res.height = rows * px;
                        const c = res.getContext('2d'); c.fillStyle = '#fff'; c.fillRect(0, 0, res.width, res.height); dndEmojiPaint(c, out, px, 0, 0); $q('#emi-resw').hidden = false;
                        const kinds = new Set(out.c.filter(Boolean)).size;
                        $q('#emi-rh').textContent = mode === 'mosaic' ? 'Готово: ' + cols + '×' + rows + ' значков, ' + kinds + ' видов. Можно добавить на доску и поправить кистью.' :
                            (out.err > 70 ? 'Похоже, на картинке не эмодзи или сетка найдена неверно. Проверьте число столбцов и область, либо выберите «Мозаика из рисунка».' :
                                'Готово: ' + cols + '×' + rows + ' клеток, ' + kinds + ' видов эмодзи. Если значки отличаются от оригинала (у Miro и у вашего устройства рисунки эмодзи разные), цвета и места сохранены — поправьте отдельные клетки в редакторе.');
                        $q('#emi-resw').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
                    } catch (e) { console.error(e); toast('Не удалось распознать'); }
                    finally { busy = false; btn.disabled = false; prog.hidden = true; }
                };
                $q('#emi-run').addEventListener('click', run);
                setTimeout(run, 120);   // сразу пробуем с найденной сеткой
            }
        });
    });
}

// Выбрать файл и добавить результат на доску
function dndEmojiPick(board, blob) {
    const go = async f => {
        const r = await dndEmojiImportSheet(f, {}); if (!r) return;
        const c = board.viewCenter(), it = dndEmojiItem(r.data, (f.name || '').replace(/\.[^.]+$/, ''), c);
        board.addItem(it); toast('Картинка из эмодзи добавлена — нажмите дважды, чтобы править');
    };
    if (blob) { go(blob); return; }
    const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'image/*'; inp.hidden = true; document.body.appendChild(inp);
    inp.addEventListener('change', () => { const f = inp.files[0]; inp.remove(); if (f) go(f); });
    inp.addEventListener('cancel', () => inp.remove()); inp.click();
}
// Текст с эмодзи → картинка на доске (вставка из Miro)
function dndEmojiFromPaste(board, text) {
    const d = dndEmojiFromText(text); if (!d) return false;
    const c = board.viewCenter(); board.addItem(dndEmojiItem(d, '', c)); toast('Строки из эмодзи превращены в картинку'); return true;
}

// ---------- Редактор ----------
function dndEmojiEditor(it, board) {
    dndEmojiNorm(it);
    const d = dndEmojiCopy(it); d.pal = it.pal.slice();
    let tool = 'brush', cur = d.em.length > 1 ? d.em[1] : '😀', bgc = '#fff3a3', zoom = 1, cat = 0, undo = [], painting = null;
    const snap = () => { undo.push(JSON.stringify(dndEmojiCopy(d))); if (undo.length > 40) undo.shift(); };
    const restore = s => { const o = JSON.parse(s); Object.assign(d, o); };
    const recent = (() => { try { return JSON.parse(localStorage.getItem('dnd_emoji_recent') || '[]'); } catch (e) { return []; } })();
    const pushRecent = e => { const i = recent.indexOf(e); if (i >= 0) recent.splice(i, 1); recent.unshift(e); recent.length = Math.min(recent.length, 18); try { localStorage.setItem('dnd_emoji_recent', JSON.stringify(recent)); } catch (er) {} };
    const tools = [['brush', 'brush', 'Кисть'], ['erase', 'eraser', 'Ластик'], ['pick', 'pipette', 'Пипетка'], ['fill', 'bucket', 'Заливка'], ['bg', 'palette', 'Фон клетки'], ['pan', 'hand', 'Двигать']];
    const sh = openSheet({
        title: 'Картинка из эмодзи',
        html: '<div class="em-ed">' +
            '<div class="em-tools" id="eme-tools">' + tools.map(t => '<button type="button" class="em-t' + (t[0] === tool ? ' is-on' : '') + '" data-t="' + t[0] + '" title="' + t[2] + '" aria-label="' + t[2] + '">' + ic(t[1]) + '<span>' + t[2] + '</span></button>').join('') + '</div>' +
            '<div class="em-cvw" id="eme-wrap"><canvas id="eme-cv"></canvas></div>' +
            '<div class="em-row"><label class="em-sl" style="flex:1"><span>Масштаб</span><input type="range" id="eme-zoom" min="100" max="400" step="10" value="100" aria-label="Масштаб"></label>' +
            '<button type="button" class="icon-btn" id="eme-undo" aria-label="Отменить" title="Отменить">' + ic('undo') + '</button></div>' +
            '<div class="em-cur" id="eme-cur"></div>' +
            '<div id="eme-bgp" hidden class="em-bgp"></div>' +
            '<div class="em-pal"><div class="em-used" id="eme-used"></div><div class="em-cats" id="eme-cats"></div><div class="em-grid" id="eme-grid"></div>' +
            '<div class="em-own"><input type="text" id="eme-own" placeholder="Свой значок: вставьте или напечатайте эмодзи" aria-label="Свой значок"><button type="button" class="btn" id="eme-own-ok">Взять</button></div></div>' +
            '<div class="em-steps"><div><span class="field-label">Столбцов</span><div class="em-num"><button type="button" class="icon-btn" data-sz="c-">−</button><b id="eme-nc"></b><button type="button" class="icon-btn" data-sz="c+">+</button></div></div>' +
            '<div><span class="field-label">Строк</span><div class="em-num"><button type="button" class="icon-btn" data-sz="r-">−</button><b id="eme-nr"></b><button type="button" class="icon-btn" data-sz="r+">+</button></div></div></div>' +
            '<div class="btn-group" style="margin-top:0.5rem"><button type="button" class="btn" id="eme-mir">' + ic('swap_horiz') + 'Отразить</button><button type="button" class="btn" id="eme-copy">' + ic('content_copy') + 'Скопировать текстом</button><button type="button" class="btn" id="eme-txt">' + ic('description') + 'Из текста…</button><button type="button" class="btn btn-danger" id="eme-clr">' + ic('delete') + 'Очистить</button></div></div>',
        actions: [
            { label: 'Удалить', kind: 'danger', icon: 'delete', onClick: () => { setTimeout(() => { board.select([it.id]); board.deleteSel(); }, 220); } },
            { label: 'Отмена', value: false },
            { label: 'Сохранить', kind: 'primary', icon: 'check', value: true, onClick: () => {
                Object.assign(it, { cols: d.cols, rows: d.rows, em: d.em, c: d.c, pal: d.pal, b: d.b }); dndEmojiTidy(it); it.rev = (it.rev || 1) + 1;
                it.h = Math.max(20, Math.round(it.w * it.rows / it.cols)); dndEmojiDrop(it); board.paint(it); board.refreshSel(); board.commit();
            } }
        ],
        onOpen: api => {
            const b = api.body, $q = s => b.querySelector(s), cv = $q('#eme-cv'), wrap = $q('#eme-wrap'); let ctx = cv.getContext('2d'), px = 24;
            const layout = () => {
                const W = Math.max(200, Math.min(wrap.clientWidth || 340, 520)); px = Math.max(10, Math.floor(W / d.cols)) * zoom;
                cv.width = Math.round(d.cols * px); cv.height = Math.round(d.rows * px); cv.style.width = cv.width + 'px'; cv.style.height = cv.height + 'px';
                ctx = cv.getContext('2d'); ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.font = Math.round(px * dndEmojiScale()) + 'px ' + DND_EMOJI_FONT;
            };
            const cell = i => {
                const x = (i % d.cols) * px, y = Math.floor(i / d.cols) * px;
                ctx.fillStyle = '#fff'; ctx.fillRect(x, y, px, px); dndEmojiCell(ctx, d, i, px, 0, 0);
                ctx.strokeStyle = 'rgba(120,115,130,.28)'; ctx.lineWidth = 1; ctx.strokeRect(x + 0.5, y + 0.5, px - 1, px - 1);
            };
            const redraw = () => { layout(); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height); for (let i = 0; i < d.cols * d.rows; i++) cell(i); $q('#eme-nc').textContent = d.cols; $q('#eme-nr').textContent = d.rows; $q('#eme-undo').disabled = !undo.length; drawUsed(); };
            const drawCur = () => { $q('#eme-cur').innerHTML = (tool === 'brush' || tool === 'fill') ? 'Выбрано: <b class="em-big">' + esc(cur) + '</b>' : tool === 'bg' ? 'Цвет фона клетки: <i class="em-sw" style="background:' + bgc + '"></i>' : tool === 'erase' ? 'Ластик стирает значок и фон клетки' : tool === 'pick' ? 'Нажмите на клетку — значок станет кистью' : 'Двигайте картинку пальцем'; $q('#eme-bgp').hidden = tool !== 'bg'; $q('#eme-cv').style.touchAction = tool === 'pan' ? 'auto' : 'none'; };
            const drawUsed = () => {
                const used = Array.from(new Set(d.c.filter(Boolean))).map(v => d.em[v]);
                $q('#eme-used').innerHTML = (used.length ? '<span class="field-label">В картинке</span><div class="em-chips">' + used.map(e => '<button type="button" class="em-k' + (e === cur ? ' is-on' : '') + '" data-e="' + esc(e) + '">' + esc(e) + '</button>').join('') + '</div>' : '') +
                    (recent.length ? '<span class="field-label">Недавние</span><div class="em-chips">' + recent.map(e => '<button type="button" class="em-k' + (e === cur ? ' is-on' : '') + '" data-e="' + esc(e) + '">' + esc(e) + '</button>').join('') + '</div>' : '');
            };
            const drawCats = () => {
                $q('#eme-cats').innerHTML = DND_EMOJI_CATS.map((c, i) => '<button type="button" class="em-c' + (i === cat ? ' is-on' : '') + '" data-c="' + i + '" title="' + c.n + '" aria-label="' + c.n + '">' + c.e + '</button>').join('');
                $q('#eme-grid').innerHTML = dndGraphemes(DND_EMOJI_CATS[cat].s).map(e => '<button type="button" class="em-k' + (e === cur ? ' is-on' : '') + '" data-e="' + esc(e) + '">' + esc(e) + '</button>').join('');
            };
            $q('#eme-bgp').innerHTML = DND_EMOJI_BG.map(c => '<button type="button" class="em-bgb' + (c === bgc ? ' is-on' : '') + '" data-bg="' + c + '" style="background:' + c + '" aria-label="Цвет ' + c + '"></button>').join('');
            hydrateIcons(b); drawCats(); drawCur(); redraw();
            const setCur = e => { cur = e; pushRecent(e); if (tool !== 'brush' && tool !== 'fill') { tool = 'brush'; b.querySelectorAll('.em-t').forEach(x => x.classList.toggle('is-on', x.dataset.t === 'brush')); } drawCur(); drawCats(); drawUsed(); };
            b.addEventListener('click', e => {
                const k = e.target.closest('.em-k'); if (k) { setCur(k.dataset.e); return; }
                const c = e.target.closest('.em-c'); if (c) { cat = +c.dataset.c; drawCats(); return; }
                const g = e.target.closest('[data-bg]'); if (g) { bgc = g.dataset.bg; b.querySelectorAll('.em-bgb').forEach(x => x.classList.toggle('is-on', x === g)); drawCur(); return; }
                const t = e.target.closest('.em-t'); if (t) { tool = t.dataset.t; b.querySelectorAll('.em-t').forEach(x => x.classList.toggle('is-on', x === t)); drawCur(); return; }
                const z = e.target.closest('[data-sz]'); if (z) { resize(z.dataset.sz); }
            });
            $q('#eme-own-ok').addEventListener('click', () => { const g = dndGraphemes($q('#eme-own').value.trim()).filter(dndIsEmojiG)[0]; if (!g) { toast('Вставьте или напечатайте эмодзи'); return; } $q('#eme-own').value = ''; setCur(g); });
            $q('#eme-zoom').addEventListener('input', e => { zoom = e.target.value / 100; redraw(); });
            $q('#eme-undo').addEventListener('click', () => { if (!undo.length) return; restore(undo.pop()); redraw(); });
            const resize = a => {
                snap(); const nc = d.cols + (a === 'c+' ? 1 : a === 'c-' ? -1 : 0), nr = d.rows + (a === 'r+' ? 1 : a === 'r-' ? -1 : 0);
                if (nc < 1 || nr < 1 || nc > 120 || nr > 120) { undo.pop(); return; }
                const c2 = new Array(nc * nr).fill(0), b2 = new Array(nc * nr).fill(0);
                for (let y = 0; y < Math.min(nr, d.rows); y++) for (let x = 0; x < Math.min(nc, d.cols); x++) { c2[y * nc + x] = d.c[y * d.cols + x]; b2[y * nc + x] = d.b[y * d.cols + x]; }
                d.cols = nc; d.rows = nr; d.c = c2; d.b = b2; redraw();
            };
            $q('#eme-mir').addEventListener('click', () => { snap(); for (let y = 0; y < d.rows; y++) { const r = d.c.slice(y * d.cols, (y + 1) * d.cols).reverse(), q = d.b.slice(y * d.cols, (y + 1) * d.cols).reverse(); r.forEach((v, x) => { d.c[y * d.cols + x] = v; d.b[y * d.cols + x] = q[x]; }); } redraw(); });
            $q('#eme-clr').addEventListener('click', async () => { if (!d.c.some(Boolean) && !d.b.some(Boolean)) return; if (await confirmSheet('Очистить картинку?', 'Все значки и фоны клеток будут стёрты. Сразу после этого можно нажать «Отменить».', 'Очистить', true)) { snap(); d.c.fill(0); d.b.fill(0); redraw(); } });
            $q('#eme-copy').addEventListener('click', async () => {
                const txt = dndEmojiToText({ cols: d.cols, rows: d.rows, em: d.em, c: d.c });
                try { await navigator.clipboard.writeText(txt); toast('Скопировано — вставьте в Miro как текст или в заметку'); } catch (e) { openSheet({ title: 'Текст картинки', html: '<textarea rows="10" readonly style="width:100%;font-size:1rem" onfocus="this.select()">' + esc(txt) + '</textarea><p class="hint">Выделите и скопируйте вручную.</p>', actions: [{ label: 'Закрыть', value: false }] }); }
            });
            $q('#eme-txt').addEventListener('click', () => {
                openSheet({ title: 'Картинка из текста', html: '<p class="hint" style="margin:0 0 0.5rem">Вставьте строки из эмодзи (например, скопированные из Miro или заметки). Каждая строка — ряд клеток, пробел — пустая клетка.</p><textarea id="emt-ta" rows="9" style="width:100%;font-size:1.1rem" placeholder="🟥🟧🟨&#10;🟩🟦🟪"></textarea>',
                    actions: [{ label: 'Отмена', value: false }, { label: 'Заменить картинку', kind: 'primary', icon: 'check', value: true, onClick: ap => { const t = ap.body.querySelector('#emt-ta').value, nd = dndEmojiFromText(t); if (!nd) { toast('Не похоже на строки из эмодзи'); return false; } snap(); Object.assign(d, dndEmojiCopy(nd)); d.pal = nd.pal; redraw(); } }] });
            });
            // рисование по клеткам
            const at = e => { const r = cv.getBoundingClientRect(), x = Math.floor((e.clientX - r.left) / r.width * d.cols), y = Math.floor((e.clientY - r.top) / r.height * d.rows); return x < 0 || y < 0 || x >= d.cols || y >= d.rows ? -1 : y * d.cols + x; };
            const apply = i => {
                if (i < 0) return;
                if (tool === 'brush') { const v = dndEmojiIndex(d, cur); if (d.c[i] === v) return; d.c[i] = v; }
                else if (tool === 'erase') { if (!d.c[i] && !d.b[i]) return; d.c[i] = 0; d.b[i] = 0; }
                else if (tool === 'bg') { const v = bgc === '#ffffff' ? 0 : dndEmojiPalIndex(d, bgc); if (d.b[i] === v) return; d.b[i] = v; }
                cell(i);
            };
            const flood = i => {
                const target = d.c[i], v = dndEmojiIndex(d, cur); if (target === v) return; const q = [i], seen = new Uint8Array(d.cols * d.rows);
                while (q.length) { const j = q.pop(); if (seen[j] || d.c[j] !== target) continue; seen[j] = 1; d.c[j] = v; const x = j % d.cols, y = (j - x) / d.cols; if (x > 0) q.push(j - 1); if (x < d.cols - 1) q.push(j + 1); if (y > 0) q.push(j - d.cols); if (y < d.rows - 1) q.push(j + d.cols); }
                redraw();
            };
            cv.addEventListener('pointerdown', e => {
                if (tool === 'pan') return; e.preventDefault(); const i = at(e); if (i < 0) return;
                if (tool === 'pick') { if (d.c[i]) setCur(d.em[d.c[i]]); else toast('В этой клетке пусто'); return; }
                snap(); if (tool === 'fill') { flood(i); return; }
                painting = i; try { cv.setPointerCapture(e.pointerId); } catch (er) {} apply(i); $q('#eme-undo').disabled = false;
            });
            cv.addEventListener('pointermove', e => {
                if (painting === null) return; const i = at(e); if (i < 0 || i === painting) return;
                const x0 = painting % d.cols, y0 = Math.floor(painting / d.cols), x1 = i % d.cols, y1 = Math.floor(i / d.cols), n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
                for (let s = 1; s <= n; s++) apply(Math.round(y0 + (y1 - y0) * s / n) * d.cols + Math.round(x0 + (x1 - x0) * s / n));
                painting = i;
            });
            const stop = () => { if (painting !== null) { painting = null; drawUsed(); } };
            cv.addEventListener('pointerup', stop); cv.addEventListener('pointercancel', stop);
        }
    });
    return sh;
}
