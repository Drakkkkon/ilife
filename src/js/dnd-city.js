'use strict';
// =====================================================================================================
// iLife 2.1.0 — «ДНД» → «ВИЖУАЛ»: КОНСТРУКТОР ГОРОДА (вид сверху, 2D).
//   game.city = { v:1, w, h (клеток), tiles:'0120…' (по цифре на клетку), grid, lab, items:[…] }
//   items:  здание   { id, t:'b', x, y, w, h (клетки), n, k (вид), c (цвет), lv (этажность 1–5), note }
//           жетон    { id, t:'p', x, y (клетки, центр), char (id героя) | n (имя) }
//           декор    { id, t:'d', x, y, e (эмодзи) }
//   Блок сюжета привязывается к зданию полем bldId (окно правки блока). Нажатие на здание открывает подсказки —
//   привязанные блоки с вводными и заметками ведущему. Нажатие на жетон героя открывает рассказ о нём.
//   dndCityDraw рисует любой участок карты — им же пользуются экспорт в PNG и склейка карты на листах PDF (js/dnd-export.js).
// =====================================================================================================

const DND_CITY_TILES = [
    { k: 0, n: 'Трава', c: '#cfe6bd', e: '' }, { k: 1, n: 'Дорога', c: '#c4bcab', e: '' }, { k: 2, n: 'Вода', c: '#8fc7ea', e: '' },
    { k: 3, n: 'Площадь', c: '#eadfc4', e: '' }, { k: 4, n: 'Лес', c: '#9dc88f', e: '🌲' }, { k: 5, n: 'Поле', c: '#e9dc98', e: '' }, { k: 6, n: 'Камень', c: '#aaa7ae', e: '⛰️' },
    { k: 7, n: 'Песок', c: '#efdca5', e: '' }, { k: 8, n: 'Снег', c: '#f1f5fa', e: '' }
];
const DND_TILE_COL = DND_CITY_TILES.map(t => t.c);
const DND_TILE_EDGE = [null, 'rgba(90,80,60,.35)', 'rgba(40,110,160,.45)', null, null, null, 'rgba(60,60,70,.35)', null, null];   // тёмная кромка на стыках дороги, воды и камня
const DND_BLD_KINDS = [
    { k: 'house', n: 'Дом', e: '🏠', c: '#d7a77a', w: 3, h: 3 }, { k: 'shop', n: 'Лавка', e: '🏪', c: '#e3b660', w: 3, h: 2 }, { k: 'tavern', n: 'Таверна', e: '🍺', c: '#c98f5c', w: 4, h: 3 },
    { k: 'inn', n: 'Постоялый двор', e: '🛏️', c: '#cfa17a', w: 4, h: 3 }, { k: 'temple', n: 'Храм', e: '⛪', c: '#d9d2e9', w: 4, h: 4 }, { k: 'tower', n: 'Башня', e: '🗼', c: '#b0b4c4', w: 2, h: 2, lv: 4 },
    { k: 'castle', n: 'Замок', e: '🏰', c: '#a9acb8', w: 6, h: 5, lv: 4 }, { k: 'smithy', n: 'Кузница', e: '⚒️', c: '#9a8f88', w: 3, h: 2 }, { k: 'guild', n: 'Гильдия', e: '📜', c: '#b99ad6', w: 4, h: 3 },
    { k: 'market', n: 'Рынок', e: '🧺', c: '#e9b3a0', w: 4, h: 4, lv: 1 }, { k: 'gate', n: 'Ворота', e: '🚪', c: '#8d8a96', w: 3, h: 1, lv: 3 }, { k: 'dungeon', n: 'Подземелье', e: '💀', c: '#6d6a75', w: 3, h: 3 }, { k: 'other', n: 'Своё здание', e: '📍', c: '#9ec1d9', w: 3, h: 3 }
];
const DND_BLD_COLORS = ['#d7a77a', '#e3b660', '#c98f5c', '#d9d2e9', '#b0b4c4', '#a9acb8', '#b99ad6', '#e9b3a0', '#9ec1d9', '#b9d9a8', '#e8a0a0', '#f2ede2'];
const DND_DECOR = ['🌳', '🌲', '🌴', '⛲', '🪨', '🌸', '🔥', '⛺', '🪦', '🌾', '🏺', '🛖', '🚩', '🪵', '🐄', '🐎', '🌵'];
const bldKind = k => DND_BLD_KINDS.find(x => x.k === k) || DND_BLD_KINDS[DND_BLD_KINDS.length - 1];

// ---------- Данные ----------
function dndCityGet(g, create) {
    if (!g) return null;
    if (!g.city && create) g.city = { v: 1, w: 40, h: 28, tiles: '0'.repeat(40 * 28), grid: true, lab: true, items: [] };
    const c = g.city; if (c) { if (!c.items) c.items = []; if (!c.tiles || c.tiles.length !== c.w * c.h) c.tiles = (c.tiles || '').padEnd(c.w * c.h, '0').slice(0, c.w * c.h); }
    return c || null;
}
function dndCityBlocks(g, bid) { return ((g && g.plot && g.plot.items) || []).filter(i => i.t === 'block' && i.bldId === bid); }

// Мягкое затемнение цвета для боковых граней
function dndShade(hex, k) {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex || ''); if (!m) return hex;
    const n = parseInt(m[1], 16), f = v => Math.max(0, Math.min(255, Math.round(k < 0 ? v * (1 + k) : v + (255 - v) * k)));
    return 'rgb(' + f(n >> 16) + ',' + f((n >> 8) & 255) + ',' + f(n & 255) + ')';
}

// ---------- Фото героев для жетонов ----------
const dndCityPhotos = new Map();
function dndCityPhoto(id, redraw) {
    if (!id) return null; const v = dndCityPhotos.get(id); if (v) return v === 'x' ? null : (v.complete ? v : null);
    dndCityPhotos.set(id, 'x');
    BlobDB.url(id, 'thumb').then(url => { if (!url) return; const im = new Image(); im.onload = () => { dndCityPhotos.set(id, im); if (redraw) redraw(); }; im.src = url; });
    return null;
}
async function dndCityPreload(g) {   // для экспорта: ждём, пока все фото загрузятся
    const ids = ((dndCityGet(g) || {}).items || []).filter(i => i.t === 'p').map(i => { const c = (g.chars || []).find(x => x.id === i.char); return c && c.portraitId; }).filter(Boolean);
    await Promise.all(ids.map(id => new Promise(res => { if (dndCityPhoto(id, res)) res(); else setTimeout(res, 1200); })));
}

// ---------- Значки-эмодзи: рисуются один раз в маленькую картинку, дальше — быстрое копирование ----------
// (прямой fillText с цветным эмодзи на телефонах очень медленный: на каждую клетку леса и каждый кадр)
const dndCityGlyphs = new Map();
function dndEmoji(ctx, e, cx, cy, size, sc) {   // size — в единицах холста, sc — сколько пикселей экрана в одной единице
    const s = Math.max(6, Math.round(size * sc / 2) * 2), key = s + e;
    let c = dndCityGlyphs.get(key);
    if (!c) {
        const d = Math.ceil(s * 1.3); c = document.createElement('canvas'); c.width = c.height = d;
        const x = c.getContext('2d'); x.font = s + 'px ' + DND_EMOJI_FONT; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(e, d / 2, d / 2 + s * 0.05);
        if (dndCityGlyphs.size > 600) dndCityGlyphs.delete(dndCityGlyphs.keys().next().value);
        dndCityGlyphs.set(key, c);
    }
    const k = c.width / sc; ctx.drawImage(c, cx - k / 2, cy - k / 2, k, k);
}
// Сколько блоков сюжета привязано к каждому зданию (одним проходом, а не отдельным поиском на каждое здание)
function dndCityBlockCounts(g) {
    const m = new Map(); for (const i of ((g && g.plot && g.plot.items) || [])) if (i.t === 'block' && i.bldId) m.set(i.bldId, (m.get(i.bldId) || 0) + 1); return m;
}

// ---------- Местность: заливка, кромки, значки леса и гор ----------
// tiles — Uint8Array (живые клетки редактора) или строка '0120…'; o: { px, ox, oy, x0,y0,x1,y1 (целые клетки), sc, bleed }
// Кромки лежат внутри клетки, поэтому участок можно рисовать отдельно (так работают «куски» кэша в редакторе).
function dndCityTerrain(ctx, tiles, W, H, o) {
    const T = typeof tiles === 'string' ? Uint8Array.from(tiles, ch => +ch || 0) : tiles, px = o.px, ox = o.ox, oy = o.oy, x0 = o.x0, y0 = o.y0, x1 = o.x1, y1 = o.y1, sc = o.sc || 1, bleed = o.bleed == null ? 0.6 : o.bleed;
    for (let y = y0; y < y1; y++) {   // заливка полосами одного цвета
        let x = x0; const row = y * W;
        while (x < x1) { const k = T[row + x]; let e = x + 1; while (e < x1 && T[row + e] === k) e++; ctx.fillStyle = DND_TILE_COL[k] || DND_TILE_COL[0]; ctx.fillRect(ox + x * px, oy + y * px, (e - x) * px + bleed, px + bleed); x = e; }
    }
    const lw = Math.max(1, px * 0.07); let cur = '';
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
        const i = y * W + x, k = T[i], col = DND_TILE_EDGE[k]; if (!col) continue;
        if (col !== cur) { ctx.fillStyle = col; cur = col; }
        const X = ox + x * px, Y = oy + y * px;
        if (x === 0 || T[i - 1] !== k) ctx.fillRect(X, Y, lw, px);
        if (x === W - 1 || T[i + 1] !== k) ctx.fillRect(X + px - lw, Y, lw, px);
        if (y === 0 || T[i - W] !== k) ctx.fillRect(X, Y, px, lw);
        if (y === H - 1 || T[i + W] !== k) ctx.fillRect(X, Y + px - lw, px, lw);
    }
    if (px >= 14) for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const t = DND_CITY_TILES[T[y * W + x]]; if (t && t.e) dndEmoji(ctx, t.e, ox + x * px + px / 2, oy + y * px + px / 2, px * 0.62, sc); }
}

// ---------- Рисование участка карты ----------
// o: { px (пикселей на клетку), ox, oy (где на холсте клетка 0,0), x0,y0,x1,y1 (клетки), grid, labels, sel (id), redraw,
//      tiles (живые клетки; иначе берутся city.tiles), terrain:false (местность уже нарисована), sc (масштаб холста) }
function dndCityDraw(ctx, g, city, o) {
    const px = o.px, ox = o.ox, oy = o.oy, W = city.w, H = city.h, sc = o.sc || (ctx.getTransform ? ctx.getTransform().a : 1) || 1;
    const x0 = Math.max(0, Math.floor(o.x0 == null ? 0 : o.x0)), y0 = Math.max(0, Math.floor(o.y0 == null ? 0 : o.y0)), x1 = Math.min(W, Math.ceil(o.x1 == null ? W : o.x1)), y1 = Math.min(H, Math.ceil(o.y1 == null ? H : o.y1));
    ctx.save(); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    if (o.terrain !== false) dndCityTerrain(ctx, o.tiles || city.tiles, W, H, { px, ox, oy, x0, y0, x1, y1, sc });
    if (o.grid !== false && city.grid !== false && px >= 10) {
        ctx.strokeStyle = 'rgba(70,60,90,.16)'; ctx.lineWidth = 1; ctx.beginPath();
        for (let x = x0; x <= x1; x++) { const X = Math.round(ox + x * px) + 0.5; ctx.moveTo(X, oy + y0 * px); ctx.lineTo(X, oy + y1 * px); }
        for (let y = y0; y <= y1; y++) { const Y = Math.round(oy + y * px) + 0.5; ctx.moveTo(ox + x0 * px, Y); ctx.lineTo(ox + x1 * px, Y); }
        ctx.stroke();
    }
    const vis = (x, y, w, h) => x + w + 1 >= x0 && x - 1 <= x1 && y + h + 1 >= y0 && y - 1 <= y1;
    const decor = [], blds = [], toks = []; let seld = null;   // один проход по предметам
    for (const i of city.items) {
        if (i.t === 'd') { if (vis(i.x, i.y, 1, 1)) { decor.push(i); if (o.sel === i.id) seld = i; } }
        else if (i.t === 'b') { if (vis(i.x, i.y, i.w, i.h)) blds.push(i); }
        else if (i.t === 'p') { if (vis(i.x, i.y, 0, 0)) toks.push(i); }
    }
    decor.forEach(i => dndEmoji(ctx, i.e, ox + (i.x + 0.5) * px, oy + (i.y + 0.5) * px, px * 0.9, sc));
    // здания — сверху вниз, чтобы нижние перекрывали верхние
    const labels = [], bc = o.badges !== false && blds.length ? dndCityBlockCounts(g) : null;
    blds.sort((a, b) => (a.y + a.h) - (b.y + b.h)).forEach(b => {
        const x = ox + b.x * px, y = oy + b.y * px, w = b.w * px, h = b.h * px, e = Math.min(5, Math.max(1, b.lv || 1)) * 0.11 * px, c = b.c || bldKind(b.k).c;
        ctx.fillStyle = 'rgba(30,25,40,.2)'; ctx.fillRect(x + e * 0.5, y + e * 0.5, w + e * 0.9, h + e * 0.9);
        ctx.fillStyle = dndShade(c, -0.3); ctx.beginPath(); ctx.moveTo(x - e + w, y - e); ctx.lineTo(x + w, y); ctx.lineTo(x + w, y + h); ctx.lineTo(x - e + w, y - e + h); ctx.closePath(); ctx.fill();
        ctx.fillStyle = dndShade(c, -0.45); ctx.beginPath(); ctx.moveTo(x - e, y - e + h); ctx.lineTo(x, y + h); ctx.lineTo(x + w, y + h); ctx.lineTo(x - e + w, y - e + h); ctx.closePath(); ctx.fill();
        ctx.fillStyle = c; ctx.fillRect(x - e, y - e, w, h);
        ctx.strokeStyle = dndShade(c, -0.5); ctx.lineWidth = Math.max(1, px * 0.06); ctx.strokeRect(x - e, y - e, w, h);
        ctx.strokeStyle = dndShade(c, -0.22); ctx.lineWidth = Math.max(1, px * 0.05); ctx.beginPath();   // коньки крыши
        if (b.w >= b.h) { ctx.moveTo(x - e + px * 0.3, y - e + h / 2); ctx.lineTo(x - e + w - px * 0.3, y - e + h / 2); } else { ctx.moveTo(x - e + w / 2, y - e + px * 0.3); ctx.lineTo(x - e + w / 2, y - e + h - px * 0.3); }
        ctx.stroke();
        const em = b.e || bldKind(b.k).e;
        if (em) dndEmoji(ctx, em, x - e + w / 2, y - e + h / 2, Math.min(w, h) * 0.5, sc);
        const nl = bc && bc.get(b.id);
        if (nl) { const r = Math.max(7, px * 0.3); ctx.fillStyle = '#e65100'; ctx.beginPath(); ctx.arc(x + w - e - r * 0.2, y - e + r * 0.2, r, 0, 7); ctx.fill(); ctx.fillStyle = '#fff'; ctx.font = 'bold ' + Math.round(r * 1.25) + 'px sans-serif'; ctx.fillText(String(nl), x + w - e - r * 0.2, y - e + r * 0.2 + 1); }
        if (o.sel === b.id) { ctx.strokeStyle = '#6750a4'; ctx.lineWidth = 3; ctx.setLineDash([6, 4]); ctx.strokeRect(x - e - 3, y - e - 3, w + e + 6, h + e + 6); ctx.setLineDash([]); }
        if (o.labels !== false && city.lab !== false && b.n) labels.push([b.n, x - e + w / 2, y + h + Math.max(8, px * 0.32)]);
    });
    ctx.lineJoin = 'round';   // без острых «шипов» у обводки букв
    labels.forEach(l => { ctx.font = 'bold ' + Math.round(Math.max(9, Math.min(17, px * 0.4))) + 'px sans-serif'; ctx.lineWidth = 3.5; ctx.strokeStyle = 'rgba(255,255,255,.92)'; ctx.strokeText(l[0], l[1], l[2]); ctx.fillStyle = '#2b2733'; ctx.fillText(l[0], l[1], l[2]); });
    // жетоны
    toks.forEach(p => {
        const ch = p.char ? (g.chars || []).find(c => c.id === p.char) : null, name = ch ? ch.name : p.n, cx = ox + p.x * px, cy = oy + p.y * px, r = Math.max(8, px * 0.46);
        ctx.fillStyle = 'rgba(0,0,0,.28)'; ctx.beginPath(); ctx.arc(cx + 1.5, cy + 2.5, r, 0, 7); ctx.fill();
        const im = ch && ch.portraitId ? dndCityPhoto(ch.portraitId, o.redraw) : null;
        ctx.save(); ctx.beginPath(); ctx.arc(cx, cy, r, 0, 7); ctx.clip();
        if (im) { const iw = im.naturalWidth, ih = im.naturalHeight, s = Math.max(2 * r / iw, 2 * r / ih); ctx.drawImage(im, cx - iw * s / 2, cy - r - (ih * s - 2 * r) * 0.15, iw * s, ih * s); }
        else { ctx.fillStyle = 'hsl(' + ((ch && ch.hue) || 265) + ',55%,48%)'; ctx.fillRect(cx - r, cy - r, 2 * r, 2 * r); ctx.fillStyle = '#fff'; ctx.font = 'bold ' + Math.round(r * 1.1) + 'px sans-serif'; ctx.fillText(((name || '?').trim().charAt(0) || '?').toLocaleUpperCase('ru-RU'), cx, cy + 1); }
        ctx.restore();
        ctx.strokeStyle = o.sel === p.id ? '#ffb300' : '#fff'; ctx.lineWidth = o.sel === p.id ? 4 : 2.5; ctx.beginPath(); ctx.arc(cx, cy, r, 0, 7); ctx.stroke();
        if (o.labels !== false && name) { const t = String(name).split(' ')[0]; ctx.font = 'bold ' + Math.round(Math.max(9, Math.min(15, px * 0.36))) + 'px sans-serif'; ctx.lineWidth = 3.5; ctx.strokeStyle = 'rgba(255,255,255,.92)'; ctx.strokeText(t, cx, cy + r + 8); ctx.fillStyle = '#2b2733'; ctx.fillText(t, cx, cy + r + 8); }
    });
    ctx.lineJoin = 'miter';
    if (seld) { ctx.strokeStyle = '#6750a4'; ctx.lineWidth = 2.5; ctx.setLineDash([5, 3]); ctx.strokeRect(ox + seld.x * px + 2, oy + seld.y * px + 2, px - 4, px - 4); ctx.setLineDash([]); }
    ctx.restore();
}
// Вся карта целиком одним холстом (для PNG)
function dndCityCanvas(g, px, opt) {
    const city = dndCityGet(g); if (!city) return null; const cv = document.createElement('canvas'); cv.width = Math.round(city.w * px); cv.height = Math.round(city.h * px);
    const c = cv.getContext('2d'); dndCityDraw(c, g, city, Object.assign({ px, ox: 0, oy: 0, badges: false }, opt || {})); return cv;
}

// ---------- Страница «Вижуал» ----------
class DndCity {
    constructor(host) {
        this.host = host; this.g = null; this.city = null; this.view = { x: 20, y: 20, z: 1 }; this.tool = 'select'; this.tile = 1; this.brush = 1; this.bkind = 'house'; this.decor = DND_DECOR[0];
        this.sel = null; this.undo = []; this.ptr = new Map(); this.drag = null; this._raf = 0; this._fitDone = '';
        this.tc = { n: 0, map: new Map() }; this.lastZoom = 0; this._rect = null;   // кэш местности по «кускам» (см. drawTerrain)
        host.innerHTML =
            '<div class="cy-root"><div class="cy-bar" id="cy-bar"></div><div class="cy-sub" id="cy-sub"></div>' +
            '<div class="cy-view" id="cy-view"><canvas class="cy-cv" id="cy-cv" aria-label="Карта города"></canvas><div class="cy-hint" id="cy-hint"></div>' +
            '<div class="cy-zoom"><button type="button" class="icon-btn" data-z="in" aria-label="Приблизить">' + ic('add') + '</button><button type="button" class="icon-btn" data-z="out" aria-label="Отдалить">' + ic('remove') + '</button><button type="button" class="icon-btn" data-z="fit" aria-label="Показать всю карту">' + ic('fit') + '</button></div>' +
            '<button type="button" class="cy-gen" id="cy-gen" aria-label="Генератор карт" title="Генератор карт: случайная карта и три готовые">' + ic('auto_awesome') + '<span>Генератор</span></button>' +
            '<button type="button" class="cy-3d" id="cy-3d" aria-label="Включить 3D: прогулка по городу" title="3D: прогулка по городу от первого лица">' + ic('view_in_ar') + '<span>3D</span></button><div class="cy-empty" id="cy-empty" hidden></div></div></div>';
        this.$ = s => host.querySelector(s); this.cv = this.$('#cy-cv'); this.ctx = this.cv.getContext('2d');
        this.buildBar(); this.bindEvents();
        if (window.ResizeObserver) new ResizeObserver(() => { if (host.offsetParent) this.resize(); }).observe(this.$('#cy-view'));
    }
    // ----- панель -----
    buildBar() {
        const tools = [['select', 'cursor', 'Выбрать'], ['hand', 'hand', 'Двигать'], ['bld', 'apartment', 'Здание'], ['tile', 'road', 'Местность'], ['hero', 'person', 'Герои'], ['decor', 'tree', 'Декор'], ['view3d', 'view_in_ar', '3D']];
        this.$('#cy-bar').innerHTML = '<span data-dnd-gamebar></span><div class="cy-tools">' + tools.map(t => '<button type="button" class="cy-t" data-t="' + t[0] + '" title="' + t[2] + '" aria-label="' + t[2] + '">' + ic(t[1]) + '<span>' + t[2] + '</span></button>').join('') + '</div>' +
            '<div class="cy-acts"><button type="button" class="icon-btn" data-a="undo" aria-label="Отменить" title="Отменить">' + ic('undo') + '</button><button type="button" class="icon-btn" data-a="png" aria-label="Сохранить картинкой" title="Сохранить картинкой (PNG)">' + ic('download') + '</button><button type="button" class="icon-btn" data-a="exp" aria-label="Экспорт и печать" title="Экспорт: PDF для склейки карты, Miro, текст">' + ic('picture_as_pdf') + '</button><button type="button" class="icon-btn" data-a="gen" aria-label="Генератор карт" title="Генератор карт: случайная карта и три готовые">' + ic('auto_awesome') + '</button><button type="button" class="icon-btn" data-a="set" aria-label="Размер карты и вид" title="Размер карты и вид">' + ic('tune') + '</button></div>';
        hydrateIcons(this.$('#cy-bar')); if (typeof dndRefreshHeaders === 'function') dndRefreshHeaders();
    }
    syncBar() {
        this.host.querySelectorAll('.cy-t').forEach(b => b.classList.toggle('is-on', b.dataset.t === this.tool));
        const u = this.$('[data-a="undo"]'); if (u) u.disabled = !this.undo.length;
        const sub = this.$('#cy-sub'); let h = '';
        if (this.tool === 'bld') h = '<div class="cy-chips">' + DND_BLD_KINDS.map(k => '<button type="button" class="chip' + (k.k === this.bkind ? ' is-on' : '') + '" data-bk="' + k.k + '">' + k.e + ' ' + esc(k.n) + '</button>').join('') + '</div><p class="hint">Нажмите на карту — здание встанет туда. Потом его можно перетащить.</p>';
        else if (this.tool === 'tile') h = '<div class="cy-chips">' + DND_CITY_TILES.map(t => '<button type="button" class="chip' + (t.k === this.tile ? ' is-on' : '') + '" data-tl="' + t.k + '"><i class="cy-sw" style="background:' + t.c + '"></i>' + esc(t.n) + '</button>').join('') +
            '<span class="cy-br">' + [1, 2, 3].map(n => '<button type="button" class="chip' + (n === this.brush ? ' is-on' : '') + '" data-br="' + n + '" title="Размер кисти">' + n + '×' + n + '</button>').join('') + '</span></div><p class="hint">Проводите пальцем по карте. Двумя пальцами — двигать и менять масштаб. «Трава» стирает.</p>';
        else if (this.tool === 'decor') h = '<div class="cy-chips">' + DND_DECOR.map(e => '<button type="button" class="chip em' + (e === this.decor ? ' is-on' : '') + '" data-dc="' + esc(e) + '">' + e + '</button>').join('') + '</div><p class="hint">Нажмите на карту, чтобы поставить значок.</p>';
        else if (this.tool === 'hand') h = '<p class="hint">Тяните карту пальцем. Масштаб — двумя пальцами или колесом мыши.</p>';
        else if (this.sel) h = this.selBar();
        sub.innerHTML = h; sub.hidden = !h; hydrateIcons(sub);
    }
    selBar() {
        const it = this.city && this.city.items.find(i => i.id === this.sel); if (!it) return '';
        const name = it.t === 'b' ? (it.n || 'Здание') : it.t === 'p' ? this.tokenName(it) : 'Декор ' + it.e;
        return '<div class="cy-selbar"><b>' + esc(name) + '</b>' + (it.t === 'b' ? '<button type="button" class="btn" data-s="edit">' + ic('edit') + 'Править</button><button type="button" class="btn" data-s="hint">' + ic('notes') + 'Подсказки</button>' : '') +
            (it.t === 'p' && it.char ? '<button type="button" class="btn" data-s="read">' + ic('person') + 'О герое</button>' : '') + '<button type="button" class="btn" data-s="dup">' + ic('content_copy') + 'Копия</button><button type="button" class="btn btn-danger" data-s="del">' + ic('delete') + 'Убрать</button></div>';
    }
    tokenName(p) { const c = p.char ? (this.g.chars || []).find(x => x.id === p.char) : null; return c ? (c.name || 'Без имени') : (p.n || 'Жетон'); }
    // ----- данные -----
    bind(g) {
        if (this.v3) { this.v3.stop(); this.v3 = null; }
        this.g = g || null; this.city = g ? dndCityGet(g, true) : null; this.sel = null; this.undo = []; this.drag = null;
        if (this.city) { this.tiles = Uint8Array.from(this.city.tiles, ch => +ch || 0); }
        this.tcClear();
        const e = this.$('#cy-empty'); e.hidden = !!g;
        if (!g) e.innerHTML = '<div class="empty"><div class="ico-big">' + ic('map') + '</div><b>Сначала выберите игру</b>Город хранится внутри игры.<div class="btn-group" style="justify-content:center;margin-top:1rem"><button type="button" class="btn btn-primary" data-dnd-pick>' + ic('casino') + 'Выбрать игру</button></div></div>';
        this.syncBar(); this.resize(); this.fitOnce(true);
    }
    save(quiet) { if (!this.city) return; this.city.tiles = Array.from(this.tiles).join(''); if (this.g) dndTouch(this.g); if (!quiet) this.syncBar(); }
    snap() { if (!this.city) return; this.city.tiles = Array.from(this.tiles).join(''); this.undo.push(JSON.stringify(this.city)); if (this.undo.length > 30) this.undo.shift(); const u = this.$('[data-a="undo"]'); if (u) u.disabled = false; }
    doUndo() { if (!this.undo.length) return; this.g.city = JSON.parse(this.undo.pop()); this.city = dndCityGet(this.g); this.tiles = Uint8Array.from(this.city.tiles, ch => +ch || 0); this.tcClear(); if (!this.city.items.some(i => i.id === this.sel)) this.sel = null; dndTouch(this.g); this.syncBar(); this.draw(); }
    // ----- вид -----
    get px() { return 32 * this.view.z; }
    resize() {
        const v = this.$('#cy-view'), w = v.clientWidth, h = v.clientHeight; if (!w || !h) return;
        const r = Math.min(2, window.devicePixelRatio || 1); this.cv.width = Math.round(w * r); this.cv.height = Math.round(h * r); this.cv.style.width = w + 'px'; this.cv.style.height = h + 'px'; this.r = r; this.vw = w; this.vh = h; this._rect = null; this.draw();
    }
    fitOnce(force) { const key = this.g ? this.g.id : ''; if (!force && this._fitDone === key) return; if (this.vw) { this.fit(); this._fitDone = key; } }
    fit() {
        if (!this.city || !this.vw) return; const z = Math.min((this.vw - 24) / (this.city.w * 32), (this.vh - 24) / (this.city.h * 32)); this.view.z = Math.max(0.2, Math.min(3, z));
        this.view.x = (this.vw - this.city.w * this.px) / 2; this.view.y = (this.vh - this.city.h * this.px) / 2; this.draw();
    }
    zoomAt(f, sx, sy) { const z0 = this.view.z, z1 = Math.max(0.2, Math.min(4, z0 * f)); if (z1 === z0) return; const k = z1 / z0; this.view.x = sx - (sx - this.view.x) * k; this.view.y = sy - (sy - this.view.y) * k; this.view.z = z1; this.lastZoom = performance.now(); this.draw(); }
    draw() {
        if (this._raf) return; this._raf = requestAnimationFrame(() => {
            this._raf = 0; if (!this.vw) return; const c = this.ctx, r = this.r || 1; c.setTransform(r, 0, 0, r, 0, 0); c.fillStyle = '#e9e6ee'; c.fillRect(0, 0, this.vw, this.vh);
            if (!this.city) return; const px = this.px, ox = this.view.x, oy = this.view.y;
            c.fillStyle = 'rgba(0,0,0,.18)'; c.fillRect(ox + 3, oy + 4, this.city.w * px, this.city.h * px);
            c.save(); c.beginPath(); c.rect(ox, oy, this.city.w * px, this.city.h * px); c.clip();
            this.drawTerrain(c, px, ox, oy, r);
            dndCityDraw(c, this.g, this.city, { px, ox, oy, x0: (0 - ox) / px, y0: (0 - oy) / px, x1: (this.vw - ox) / px, y1: (this.vh - oy) / px, sel: this.sel, terrain: false, sc: r, redraw: () => this.draw() });
            c.restore(); c.strokeStyle = 'rgba(80,70,100,.5)'; c.lineWidth = 2; c.strokeRect(ox, oy, this.city.w * px, this.city.h * px);
        });
    }
    // Местность рисуется «кусками» (n×n клеток) в запасные холсты и потом просто копируется на экран. При рисовании кистью
    // перерисовываются только изменённые куски, при сдвиге карты — ничего. Во время зума куски растягиваются, а чёткими
    // становятся через долю секунды после остановки.
    tcClear() { this.tc.map.clear(); }
    markDirty(x, y) {
        const T = this.tc, n = T.n, W = this.city.w, H = this.city.h; if (!n) return;
        for (const d of [[0, 0], [-1, 0], [1, 0], [0, -1], [0, 1]]) { const cx = x + d[0], cy = y + d[1]; if (cx < 0 || cy < 0 || cx >= W || cy >= H) continue; const ch = T.map.get(Math.floor(cy / n) * 1000 + Math.floor(cx / n)); if (ch) ch.dirty = true; }
    }
    tChunk(i, j, n, cp, ch) {
        const W = this.city.w, H = this.city.h, x0 = i * n, y0 = j * n, x1 = Math.min(W, x0 + n), y1 = Math.min(H, y0 + n), w = Math.ceil((x1 - x0) * cp) + 3, h = Math.ceil((y1 - y0) * cp) + 3;
        if (!ch) ch = { cv: document.createElement('canvas') }; const cv = ch.cv; if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
        const x = cv.getContext('2d'); x.setTransform(1, 0, 0, 1, 0, 0); x.clearRect(0, 0, w, h);
        dndCityTerrain(x, this.tiles, W, H, { px: cp, ox: -x0 * cp, oy: -y0 * cp, x0, y0, x1, y1, sc: 1, bleed: 2 });
        ch.cp = cp; ch.dirty = false; return ch;
    }
    drawTerrain(c, px, ox, oy, r) {
        const T = this.tc, W = this.city.w, H = this.city.h, cp = px * r, n = cp < 20 ? 16 : cp < 80 ? 8 : cp < 160 ? 4 : 2;
        if (T.n !== n) { T.map.clear(); T.n = n; }
        const zooming = performance.now() - this.lastZoom < 180, i0 = Math.max(0, Math.floor(-ox / px / n)), i1 = Math.min(Math.ceil(W / n) - 1, Math.floor((this.vw - ox) / px / n)), j0 = Math.max(0, Math.floor(-oy / px / n)), j1 = Math.min(Math.ceil(H / n) - 1, Math.floor((this.vh - oy) / px / n));
        let blurry = false; c.save(); c.setTransform(1, 0, 0, 1, 0, 0);
        for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
            const key = j * 1000 + i; let ch = T.map.get(key), k = ch ? ch.cp / cp : 0;
            if (!ch || ch.dirty || (Math.abs(k - 1) > 0.01 && (!zooming || k > 2 || k < 0.5))) { ch = this.tChunk(i, j, n, cp, ch); k = 1; }
            T.map.delete(key); T.map.set(key, ch);   // последний использованный — в конец (для очистки лишнего)
            const dx = Math.round((ox + i * n * px) * r), dy = Math.round((oy + j * n * px) * r);
            if (Math.abs(k - 1) <= 0.01) c.drawImage(ch.cv, dx, dy); else { blurry = true; c.drawImage(ch.cv, dx, dy, ch.cv.width / k, ch.cv.height / k); }
        }
        c.restore();
        for (let cap = Math.max(36, (i1 - i0 + 1) * (j1 - j0 + 1) + 8); T.map.size > cap;) T.map.delete(T.map.keys().next().value);
        if (blurry) { clearTimeout(this._lzT); this._lzT = setTimeout(() => this.draw(), 200); }
    }
    // ----- координаты и поиск -----
    cellAt(sx, sy) { return { x: (sx - this.view.x) / this.px, y: (sy - this.view.y) / this.px }; }
    local(e) { const r = this._rect || (this._rect = this.cv.getBoundingClientRect()); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
    hit(cx, cy) {
        const items = this.city.items;
        for (let i = items.length - 1; i >= 0; i--) { const p = items[i]; if (p.t === 'p' && Math.hypot(p.x - cx, p.y - cy) <= 0.55) return p; }
        const bs = items.filter(i => i.t === 'b').sort((a, b) => (b.y + b.h) - (a.y + a.h));
        for (const b of bs) { const e = Math.min(5, Math.max(1, b.lv || 1)) * 0.11; if (cx >= b.x - e && cx <= b.x + b.w && cy >= b.y - e && cy <= b.y + b.h) return b; }
        for (let i = items.length - 1; i >= 0; i--) { const d = items[i]; if (d.t === 'd' && cx >= d.x && cx <= d.x + 1 && cy >= d.y && cy <= d.y + 1) return d; }
        return null;
    }
    paintAt(cx, cy) {
        const W = this.city.w, H = this.city.h, n = this.brush, a = Math.floor(cx - (n - 1) / 2 + 0.0001), b = Math.floor(cy - (n - 1) / 2 + 0.0001); let ch = false;
        for (let y = b; y < b + n; y++) for (let x = a; x < a + n; x++) { if (x < 0 || y < 0 || x >= W || y >= H) continue; if (this.tiles[y * W + x] !== this.tile) { this.tiles[y * W + x] = this.tile; ch = true; this.markDirty(x, y); } }
        return ch;
    }
    // ----- события -----
    bindEvents() {
        const cv = this.cv;
        cv.addEventListener('pointerdown', e => this.onDown(e));
        cv.addEventListener('pointermove', e => this.onMove(e));
        ['pointerup', 'pointercancel'].forEach(t => cv.addEventListener(t, e => this.onUp(e)));
        cv.addEventListener('wheel', e => { e.preventDefault(); this._rect = null; const p = this.local(e); this.zoomAt(e.deltaY < 0 ? 1.12 : 1 / 1.12, p.x, p.y); }, { passive: false });
        cv.addEventListener('dblclick', e => { if (!this.city || this.tool !== 'select') return; this._rect = null; const p = this.local(e), c = this.cellAt(p.x, p.y), h = this.hit(c.x, c.y); if (h && h.t === 'b') this.editBuilding(h); });
        this.$('.cy-zoom').addEventListener('click', e => { const b = e.target.closest('[data-z]'); if (!b) return; if (b.dataset.z === 'fit') this.fit(); else this.zoomAt(b.dataset.z === 'in' ? 1.25 : 0.8, this.vw / 2, this.vh / 2); });
        this.host.addEventListener('click', e => {
            if (e.target.closest('.cy-3d')) { this.open3d(); return; }
            if (e.target.closest('.cy-gen')) { this.genSheet(); return; }
            const t = e.target.closest('.cy-t'); if (t) { this.setTool(t.dataset.t); return; }
            const a = e.target.closest('[data-a]'); if (a) { this.act(a.dataset.a); return; }
            const bk = e.target.closest('[data-bk]'); if (bk) { this.bkind = bk.dataset.bk; this.syncBar(); return; }
            const tl = e.target.closest('[data-tl]'); if (tl) { this.tile = +tl.dataset.tl; this.syncBar(); return; }
            const br = e.target.closest('[data-br]'); if (br) { this.brush = +br.dataset.br; this.syncBar(); return; }
            const dc = e.target.closest('[data-dc]'); if (dc) { this.decor = dc.dataset.dc; this.syncBar(); return; }
            const s = e.target.closest('[data-s]'); if (s) this.selAct(s.dataset.s);
        });
    }
    // ----- 3D-режим: прогулка по городу от первого лица (js/dnd-city3d.js) -----
    open3d() {
        if (!this.city) { toast('Сначала выберите игру'); return; }
        if (this.v3) return;
        if (typeof City3D === 'undefined') { toast('3D-режим не загрузился — обновите страницу'); return; }
        const root = this.$('.cy-root'); let el = this.$('#cy3'); if (!el) { el = document.createElement('div'); el.className = 'cy3'; el.id = 'cy3'; root.appendChild(el); }
        this.city.tiles = Array.from(this.tiles).join('');
        const sel = this.sel && this.city.items.find(i => i.id === this.sel), c = this.cellAt(this.vw / 2, this.vh / 2);
        let start = { x: c.x, z: c.y };   // старт — в центре видимой части карты, а если выбрано здание — перед его дверью
        if (sel && sel.t === 'b') start = { x: sel.x + Math.floor((sel.w - 1) / 2) + 0.5, z: sel.y + sel.h + 0.9, yaw: 0 }; else if (sel && sel.t === 'p') start = { x: sel.x, z: sel.y + 0.8 };
        this.v3 = new City3D(el, {
            city: this.city, g: this.g, start,
            onExit: p => { this.v3 = null; if (p && this.vw) { this.view.x = this.vw / 2 - p.x * this.px; this.view.y = this.vh / 2 - p.z * this.px; } this.draw(); },
            onBld: b => { this.sel = b.id; this.tapItem(b); }
        });
        this.v3.start();
    }
    setTool(t) {
        if (t === 'hero') { this.heroSheet(); return; }
        if (t === 'view3d') { this.open3d(); return; }
        this.tool = t; if (t !== 'select') this.sel = null; this.cv.style.touchAction = 'none'; this.cv.dataset.tool = t; this.syncBar(); this.draw();
        const h = this.$('#cy-hint'); h.textContent = ''; h.classList.remove('is-on');
    }
    onDown(e) {
        if (!this.city) return; e.preventDefault(); try { this.cv.setPointerCapture(e.pointerId); } catch (er) {}
        if (!this.ptr.size) this._rect = null;
        const p = this.local(e); this.ptr.set(e.pointerId, p);
        if (this.ptr.size === 2) { const [a, b] = Array.from(this.ptr.values()); this.drag = { k: 'pinch', d: Math.hypot(a.x - b.x, a.y - b.y), z: this.view.z, vx: this.view.x, vy: this.view.y, mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 }; return; }
        const c = this.cellAt(p.x, p.y), t = this.tool;
        if (t === 'hand') { this.drag = { k: 'pan', sx: p.x, sy: p.y, vx: this.view.x, vy: this.view.y }; return; }
        if (t === 'tile') { this.snap(); this.drag = { k: 'paint', lx: Math.floor(c.x), ly: Math.floor(c.y), moved: false }; if (this.paintAt(c.x, c.y)) this.draw(); return; }
        if (t === 'bld') { const k = bldKind(this.bkind); this.snap(); const b = { id: uid('bl'), t: 'b', x: Math.max(0, Math.min(this.city.w - k.w, Math.round(c.x - k.w / 2))), y: Math.max(0, Math.min(this.city.h - k.h, Math.round(c.y - k.h / 2))), w: k.w, h: k.h, n: k.n, k: k.k, c: k.c, lv: k.lv || 2, note: '' }; this.city.items.push(b); this.sel = b.id; this.save(); this.draw(); this.drag = null; this.editBuilding(b, true); return; }
        if (t === 'decor') { const x = Math.floor(c.x), y = Math.floor(c.y); if (x >= 0 && y >= 0 && x < this.city.w && y < this.city.h) { this.snap(); const d = { id: uid('dc'), t: 'd', x, y, e: this.decor }; this.city.items.push(d); this.save(true); this.draw(); } this.drag = null; return; }
        // выбрать / двигать
        const h = this.hit(c.x, c.y);
        if (h) { this.sel = h.id; this.drag = { k: 'item', it: h, sx: p.x, sy: p.y, ox: h.x, oy: h.y, moved: false, snapped: false }; this.syncBar(); this.draw(); }
        else { const had = !!this.sel; this.sel = null; this.drag = { k: 'pan', sx: p.x, sy: p.y, vx: this.view.x, vy: this.view.y, tap: true }; if (had) { this.syncBar(); this.draw(); } }
    }
    onMove(e) {
        if (!this.ptr.has(e.pointerId)) return; const p = this.local(e); this.ptr.set(e.pointerId, p); const d = this.drag; if (!d) return;
        if (d.k === 'pinch' && this.ptr.size >= 2) { const [a, b] = Array.from(this.ptr.values()), dist = Math.hypot(a.x - b.x, a.y - b.y), mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2, z1 = Math.max(0.2, Math.min(4, d.z * dist / (d.d || 1))), k = z1 / d.z; this.view.z = z1; this.view.x = mx - (d.mx - d.vx) * k; this.view.y = my - (d.my - d.vy) * k; this.lastZoom = performance.now(); this.draw(); return; }
        if (d.k === 'pan') { if (Math.hypot(p.x - d.sx, p.y - d.sy) > 3) d.tap = false; this.view.x = d.vx + p.x - d.sx; this.view.y = d.vy + p.y - d.sy; this.draw(); return; }
        if (d.k === 'paint') {
            const c = this.cellAt(p.x, p.y), x = Math.floor(c.x), y = Math.floor(c.y), n = Math.max(Math.abs(x - d.lx), Math.abs(y - d.ly)) || 1; let ch = false;
            for (let s = 1; s <= n; s++) ch = this.paintAt(d.lx + (x - d.lx) * s / n + 0.5, d.ly + (y - d.ly) * s / n + 0.5) || ch;
            d.lx = x; d.ly = y; if (ch) this.draw(); return;
        }
        if (d.k === 'item') {
            const dx = (p.x - d.sx) / this.px, dy = (p.y - d.sy) / this.px; if (!d.moved && Math.hypot(p.x - d.sx, p.y - d.sy) < 5) return;
            if (!d.snapped) { this.snap(); d.snapped = true; } d.moved = true; const it = d.it;
            if (it.t === 'p') { it.x = Math.max(0, Math.min(this.city.w, Math.round((d.ox + dx) * 4) / 4)); it.y = Math.max(0, Math.min(this.city.h, Math.round((d.oy + dy) * 4) / 4)); }
            else { it.x = Math.max(0, Math.min(this.city.w - (it.w || 1), Math.round(d.ox + dx))); it.y = Math.max(0, Math.min(this.city.h - (it.h || 1), Math.round(d.oy + dy))); }
            this.draw();
        }
    }
    onUp(e) {
        this.ptr.delete(e.pointerId); const d = this.drag;
        if (this.ptr.size === 1 && d && d.k === 'pinch') { const [q] = Array.from(this.ptr.values()); this.drag = { k: 'pan', sx: q.x, sy: q.y, vx: this.view.x, vy: this.view.y }; return; }
        if (this.ptr.size) return; this.drag = null; if (!d) return;
        if (d.k === 'paint') this.save(true);
        else if (d.k === 'item') { if (d.moved) this.save(); else this.tapItem(d.it); }
        else if (d.k === 'pan' && d.tap) this.syncBar();
    }
    tapItem(it) {
        if (it.t === 'b') this.hintSheet(it);
        else if (it.t === 'p') { const c = it.char ? (this.g.chars || []).find(x => x.id === it.char) : null; if (c) dndDeckSheet(this.g, [c], c.id, c.name || 'Герой'); else this.editToken(it); }
    }
    selAct(a) {
        const it = this.city.items.find(i => i.id === this.sel); if (!it) return;
        if (a === 'edit') { if (it.t === 'b') this.editBuilding(it); else this.editToken(it); }
        else if (a === 'hint') this.hintSheet(it);
        else if (a === 'read') this.tapItem(it);
        else if (a === 'dup') { this.snap(); const c = Object.assign({}, it, { id: uid(it.t === 'b' ? 'bl' : it.t === 'p' ? 'pt' : 'dc') }); c.x = Math.min(this.city.w - (c.w || 1), c.x + 1); c.y = Math.min(this.city.h - (c.h || 1), c.y + 1); if (it.t === 'b') { c.n = (it.n || 'Здание') + ' 2'; } this.city.items.push(c); this.sel = c.id; this.save(); this.draw(); }
        else if (a === 'del') { this.snap(); this.city.items = this.city.items.filter(i => i.id !== it.id); if (it.t === 'b') (this.g.plot.items || []).forEach(x => { if (x.bldId === it.id) delete x.bldId; }); this.sel = null; this.save(); this.draw(); if (typeof dndPagesReload === 'function') { if (dndPlot) dndPlot._dirty = true; } }
    }
    act(a) {
        if (!this.city) { toast('Сначала выберите игру'); return; }
        if (a === 'undo') this.doUndo();
        else if (a === 'png') { this.city.tiles = Array.from(this.tiles).join(''); this.savePng(); }
        else if (a === 'exp') { this.city.tiles = Array.from(this.tiles).join(''); dndExportSheet(this.g, 'city'); }
        else if (a === 'set') this.settingsSheet();
        else if (a === 'gen') this.genSheet();
    }
    async savePng() {
        await dndCityPreload(this.g); const cv = dndCityCanvas(this.g, Math.min(48, Math.max(16, Math.floor(4000 / Math.max(this.city.w, this.city.h)))));
        const blob = await new Promise(r => cv.toBlob(r, 'image/png')); const res = await deliverFile(blob, stampName('gorod-' + (this.g.title || 'karta').replace(/[^\p{L}\p{N}]+/gu, '_'), 'png'));
        toast(res === 'downloaded' || res === 'native' ? 'Карта сохранена' : res === 'shared' ? 'Карта готова — выберите, куда отправить' : 'Сохранить не удалось');
    }
    // ----- окна -----
    editBuilding(b, isNew) {
        const kinds = DND_BLD_KINDS.map(k => '<button type="button" class="chip' + (k.k === b.k ? ' is-on' : '') + '" data-k="' + k.k + '">' + k.e + ' ' + esc(k.n) + '</button>').join('');
        const st = { w: b.w, h: b.h, lv: b.lv || 2, c: b.c || bldKind(b.k).c, k: b.k, e: b.e || '' };
        const before = JSON.stringify(b);
        let saved = false;
        const sh = openSheet({
            title: isNew ? 'Новое здание' : 'Здание',
            html: '<label class="field-label" for="cb-n">Название</label><input type="text" id="cb-n" maxlength="60" placeholder="Например, «Таверна у моста»" value="' + esc(b.n) + '">' +
                '<span class="field-label">Вид</span><div class="chips" id="cb-k">' + kinds + '</div>' +
                '<div class="em-steps" style="margin-top:0.5rem"><div><span class="field-label">Ширина, клеток</span><div class="em-num"><button type="button" class="icon-btn" data-st="w-">−</button><b id="cb-w">' + st.w + '</b><button type="button" class="icon-btn" data-st="w+">+</button></div></div>' +
                '<div><span class="field-label">Длина, клеток</span><div class="em-num"><button type="button" class="icon-btn" data-st="h-">−</button><b id="cb-h">' + st.h + '</b><button type="button" class="icon-btn" data-st="h+">+</button></div></div></div>' +
                '<label class="field-label" for="cb-lv">Высота (этажи) <b id="cb-lvv">' + st.lv + '</b></label><input type="range" id="cb-lv" min="1" max="5" step="1" value="' + st.lv + '" aria-label="Высота здания">' +
                '<span class="field-label">Цвет</span><div class="cy-colors" id="cb-c">' + DND_BLD_COLORS.map(c => '<button type="button" class="em-bgb' + (c === st.c ? ' is-on' : '') + '" data-c="' + c + '" style="background:' + c + '" aria-label="Цвет ' + c + '"></button>').join('') + '</div>' +
                '<label class="field-label" for="cb-e">Значок на крыше (по желанию)</label><input type="text" id="cb-e" maxlength="8" placeholder="по умолчанию — по виду здания" value="' + esc(st.e) + '">' +
                '<label class="field-label" for="cb-note">Заметка о здании</label><textarea id="cb-note" rows="3" placeholder="Кто здесь живёт, что внутри, чем знаменито">' + esc(b.note) + '</textarea>' +
                '<div id="cb-links"></div>',
            actions: [{ label: 'Убрать', kind: 'danger', icon: 'delete', onClick: () => { setTimeout(() => { this.sel = b.id; this.selAct('del'); }, 220); } }, { label: 'Отмена', value: false }, {
                label: 'Сохранить', kind: 'primary', icon: 'check', value: true, onClick: ap => {
                    const q = s => ap.body.querySelector(s); this.snap();
                    b.n = q('#cb-n').value.trim(); b.k = st.k; b.w = st.w; b.h = st.h; b.lv = st.lv; b.c = st.c; const em = dndGraphemes(q('#cb-e').value.trim())[0]; if (em) b.e = em; else delete b.e; b.note = q('#cb-note').value.trim();
                    b.x = Math.max(0, Math.min(this.city.w - b.w, b.x)); b.y = Math.max(0, Math.min(this.city.h - b.h, b.y)); saved = true; this.save(); this.draw(); this.syncBar();
                }
            }],
            onClose: r => { if (r !== true && isNew && !saved) { this.city.items = this.city.items.filter(i => i.id !== b.id); this.sel = null; this.save(); this.draw(); } },
            onOpen: ap => {
                hydrateIcons(ap.body); const q = s => ap.body.querySelector(s);
                const links = () => { const ls = dndCityBlocks(this.g, b.id); q('#cb-links').innerHTML = '<span class="field-label">Блоки сюжета в этом здании</span>' + (ls.length ? '<div class="chips">' + ls.map(l => '<span class="chip is-on">' + esc(l.title || 'Без названия') + '</span>').join('') + '</div>' : '<p class="hint" style="margin:0">Пока нет. Привяжите блок в окне «Подсказки» (нажмите на здание) или в окне правки блока на странице «Сюжет».</p>'); };
                links();
                q('#cb-k').addEventListener('click', e => { const c = e.target.closest('[data-k]'); if (!c) return; const k = bldKind(c.dataset.k); const oldK = bldKind(st.k); st.k = k.k; ap.body.querySelectorAll('#cb-k .chip').forEach(x => x.classList.toggle('is-on', x === c)); if (st.c === oldK.c) { st.c = k.c; ap.body.querySelectorAll('#cb-c .em-bgb').forEach(x => x.classList.toggle('is-on', x.dataset.c === st.c)); } const nm = q('#cb-n'); if (!nm.value.trim() || nm.value.trim() === oldK.n) nm.value = k.n; });
                ap.body.addEventListener('click', e => {
                    const s = e.target.closest('[data-st]'); if (s) { const f = s.dataset.st[0], d = s.dataset.st[1] === '+' ? 1 : -1; st[f] = Math.max(1, Math.min(f === 'w' ? Math.min(20, this.city.w) : Math.min(20, this.city.h), st[f] + d)); q('#cb-' + f).textContent = st[f]; return; }
                    const c = e.target.closest('#cb-c [data-c]'); if (c) { st.c = c.dataset.c; ap.body.querySelectorAll('#cb-c .em-bgb').forEach(x => x.classList.toggle('is-on', x === c)); }
                });
                q('#cb-lv').addEventListener('input', e => { st.lv = +e.target.value; q('#cb-lvv').textContent = st.lv; });
                setTimeout(() => { const n = q('#cb-n'); n.focus(); n.select(); }, 80);
            }
        });
        return sh;
    }
    editToken(p) {
        openSheet({
            title: 'Жетон', html: '<label class="field-label" for="ct-n">Имя на карте</label><input type="text" id="ct-n" maxlength="40" value="' + esc(p.n || '') + '" placeholder="Например, «Стражник»">',
            actions: [{ label: 'Убрать', kind: 'danger', icon: 'delete', onClick: () => { setTimeout(() => { this.sel = p.id; this.selAct('del'); }, 220); } }, { label: 'Отмена', value: false }, { label: 'Сохранить', kind: 'primary', icon: 'check', value: true, onClick: ap => { this.snap(); p.n = ap.body.querySelector('#ct-n').value.trim(); this.save(); this.draw(); } }],
            onOpen: ap => setTimeout(() => ap.body.querySelector('#ct-n').focus(), 80)
        });
    }
    heroSheet() {
        if (!this.city) { toast('Сначала выберите игру'); return; }
        const g = this.g, chars = g.chars || [];
        const on = id => this.city.items.some(i => i.t === 'p' && i.char === id);
        openSheet({
            title: 'Герои на карте',
            html: '<p class="hint" style="margin:0 0 0.5rem">Нажмите на героя, чтобы поставить его на карту или убрать. Потом жетон можно перетащить, а нажатие на него расскажет о герое.</p><div class="chips" id="ch-list"></div>' +
                '<label class="field-label" for="ch-free">Жетон без карточки (прохожий, стражник)</label><div class="em-own"><input type="text" id="ch-free" maxlength="40" placeholder="Имя на карте"><button type="button" class="btn" id="ch-free-ok">Поставить</button></div>',
            actions: [{ label: 'Готово', kind: 'primary', value: true }],
            onClose: () => { this.tool = 'select'; this.syncBar(); },
            onOpen: ap => {
                const q = s => ap.body.querySelector(s);
                const draw = () => { q('#ch-list').innerHTML = chars.length ? chars.map(c => '<button type="button" class="chip' + (on(c.id) ? ' is-on' : '') + '" data-id="' + esc(c.id) + '">' + dndPhotoHtml(c, 'cy-mini') + esc(c.name || 'Без имени') + '</button>').join('') : '<span class="hint">В игре пока нет героев — создайте их на странице «Персонажи».</span>'; dndPaintPhotos(ap.body); };
                const spot = k => { const c = this.cellAt(this.vw / 2, this.vh / 2); return { x: Math.max(1, Math.min(this.city.w - 1, Math.round((c.x + (k % 4) * 1.2 - 1.8) * 4) / 4)), y: Math.max(1, Math.min(this.city.h - 1, Math.round((c.y + Math.floor(k / 4) * 1.2) * 4) / 4)) }; };
                draw();
                q('#ch-list').addEventListener('click', e => {
                    const b = e.target.closest('[data-id]'); if (!b) return; const id = b.dataset.id; this.snap();
                    if (on(id)) this.city.items = this.city.items.filter(i => !(i.t === 'p' && i.char === id));
                    else { const n = this.city.items.filter(i => i.t === 'p').length, s = spot(n); this.city.items.push({ id: uid('pt'), t: 'p', x: s.x, y: s.y, char: id }); }
                    this.save(true); this.draw(); draw();
                });
                q('#ch-free-ok').addEventListener('click', () => { const n = q('#ch-free').value.trim(); if (!n) { toast('Впишите имя'); return; } this.snap(); const s = spot(this.city.items.filter(i => i.t === 'p').length); this.city.items.push({ id: uid('pt'), t: 'p', x: s.x, y: s.y, n }); q('#ch-free').value = ''; this.save(true); this.draw(); toast('Жетон поставлен'); });
            }
        });
    }
    // Подсказки здания: привязанные блоки сюжета (вводные и заметки ведущему)
    hintSheet(b) {
        const g = this.g, k = bldKind(b.k);
        const cards = () => {
            const ls = dndCityBlocks(g, b.id);
            return (b.note ? '<p class="cy-note">' + esc(b.note).replace(/\n/g, '<br>') + '</p>' : '') +
                (ls.length ? ls.map(l => {
                    const bk = bdKind(BD_PLOT_KINDS, l.kind), st = BD_PLOT_STATUS.find(s => s.k === (l.status || 'plan')), chars = dndBlockChars(g, l);
                    const intro = (l.intro || []).filter(x => x.title || x.text);
                    return '<article class="cy-hc" style="--kc:' + (l.c || bk.c) + '" data-id="' + esc(l.id) + '"><header>' + ic(bk.i) + '<span>' + esc(bk.n) + '</span><em>' + esc(st ? st.n : '') + '</em></header>' +
                        '<h4>' + esc(l.title || 'Без названия') + '</h4>' + (l.text ? '<p>' + esc(l.text) + '</p>' : '') +
                        (l.desc ? '<details><summary>Подробнее</summary><p>' + esc(l.desc).replace(/\n/g, '<br>') + '</p></details>' : '') +
                        (intro.length ? '<details open><summary>Вводные · ' + intro.length + '</summary>' + intro.map(x => '<div class="cy-in"><b>' + esc(x.title || 'Вводная') + '</b>' + (x.text ? '<span>' + esc(x.text) + '</span>' : '') + '</div>').join('') + '</details>' : '') +
                        (l.gm ? '<details class="gm"><summary>' + ic('visibility_off') + 'Заметки ведущему</summary><p>' + esc(l.gm).replace(/\n/g, '<br>') + '</p></details>' : '') +
                        (chars.length ? dndDeckHtml(chars) : '') +
                        '<footer><button type="button" class="btn" data-h="edit">' + ic('edit') + 'Править блок</button><button type="button" class="btn btn-text" data-h="unlink">Отвязать</button></footer></article>';
                }).join('') : '<div class="empty" style="padding:1rem"><b>К этому зданию ничего не привязано</b>Привяжите блоки сюжета, чтобы видеть здесь подсказки: что происходит, какие вводные и кто участвует.</div>');
        };
        const sh = openSheet({
            title: (k.e + ' ' + (b.n || k.n)).trim(),
            html: '<div class="cy-hints" id="cy-hints"></div>',
            actions: [{ label: 'Закрыть', value: false }, { label: 'Править здание', icon: 'edit', onClick: () => { setTimeout(() => this.editBuilding(b), 220); } }, { label: 'Привязать блок', kind: 'primary', icon: 'add', onClick: () => { setTimeout(() => this.linkSheet(b), 220); } }],
            onOpen: ap => {
                const box = ap.body.querySelector('#cy-hints'); const draw = () => { box.innerHTML = cards(); hydrateIcons(box); dndPaintPhotos(box); }; draw();
                box.addEventListener('click', e => {
                    const dk = e.target.closest('.bk-deck'); const art = e.target.closest('.cy-hc'); if (!art) return; const blk = (g.plot.items || []).find(x => x.id === art.dataset.id); if (!blk) return;
                    if (dk) { ap.close(); setTimeout(() => dndDeckSheet(g, dndBlockChars(g, blk), null, blk.title || 'Герои сцены'), 220); return; }
                    const a = e.target.closest('[data-h]'); if (!a) return;
                    if (a.dataset.h === 'unlink') { delete blk.bldId; dndTouch(g); if (typeof dndPlot !== 'undefined' && dndPlot) dndPlot._dirty = true; this.draw(); draw(); }
                    else if (a.dataset.h === 'edit') { ap.close(); setTimeout(() => { if (dndPlot) { if (dndPlot.game !== g) dndPlot.bind(g); const it = dndPlot.items.find(x => x.id === blk.id); if (it) dndEditBlock(it, dndPlot); } }, 220); }
                });
            }
        });
        return sh;
    }
    linkSheet(b) {
        const g = this.g, all = (g.plot.items || []).filter(i => i.t === 'block');
        if (!all.length) { toast('На странице «Сюжет» пока нет блоков'); return; }
        openSheet({
            title: 'Привязать блок к «' + (b.n || 'зданию') + '»',
            html: '<div class="dg-menu">' + all.map(l => { const bk = bdKind(BD_PLOT_KINDS, l.kind), cur = l.bldId && (this.city.items.find(x => x.id === l.bldId) || {}).n; return '<button type="button" class="dg-mi" data-id="' + esc(l.id) + '">' + ic(bk.i) + '<span><b>' + esc(l.title || 'Без названия') + '</b><small>' + esc(bk.n) + (l.bldId === b.id ? ' · уже здесь' : cur ? ' · сейчас: ' + esc(cur) : '') + '</small></span></button>'; }).join('') + '</div>',
            actions: [{ label: 'Закрыть', value: false }],
            onOpen: ap => ap.body.addEventListener('click', e => { const m = e.target.closest('[data-id]'); if (!m) return; const blk = all.find(x => x.id === m.dataset.id); blk.bldId = b.id; dndTouch(g); if (dndPlot) dndPlot._dirty = true; this.draw(); ap.close(); toast('Блок привязан к зданию'); setTimeout(() => this.hintSheet(b), 230); })
        });
    }
    // ----- генератор карт (js/dnd-citygen.js) -----
    async applyGen(res) {   // false — пользователь передумал
        const c = this.city;
        if ((c.items.some(i => i.t !== 'p') || this.tiles.some(k => k !== 0)) && !(await confirmSheet('Заменить карту?', 'Текущая местность, здания и декор будут заменены. Герои останутся и встанут на главной площади. Это можно отменить кнопкой «Отменить».', 'Заменить', true))) return false;
        this.snap(); const toks = c.items.filter(i => i.t === 'p');
        if (this.g.plot && this.g.plot.items) this.g.plot.items.forEach(x => { delete x.bldId; });
        c.w = res.w; c.h = res.h; this.tiles = Uint8Array.from(res.tiles); this.tcClear();
        toks.forEach((t, i) => { t.x = Math.round((res.hub.x + (i % 5) * 0.9 - 1.8) * 4) / 4; t.y = Math.round((res.hub.y + Math.floor(i / 5) * 0.9) * 4) / 4; });
        c.items = JSON.parse(JSON.stringify(res.items)).concat(toks); this.sel = null; this.save();
        if (typeof dndPagesReload === 'function' && typeof dndPlot !== 'undefined' && dndPlot) dndPlot._dirty = true;
        this.fit(); return true;
    }
    genSheet() {
        if (!this.city) { toast('Сначала выберите игру'); return; }
        const st = { biome: 'any', size: 'm', k: 1, build: true, seed: 1000 + Math.floor(Math.random() * 89000) }; let cur = null;
        const gen = () => { const sz = DND_GEN_SIZES.find(s => s.id === st.size); return dndCityGenerate({ biome: st.biome, w: sz.w, h: sz.h, seed: st.seed, towns: Math.max(1, Math.round(sz.t * st.k)), build: st.build }); };
        const chips = (attr, list, now) => '<div class="cy-chips">' + list.map(l => '<button type="button" class="chip' + (String(l[0]) === String(now) ? ' is-on' : '') + '" ' + attr + '="' + l[0] + '">' + l[1] + '</button>').join('') + '</div>';
        const cards = DND_GEN_PRESETS.map(p => '<button type="button" class="gn-card" data-gp="' + p.id + '"><canvas></canvas><b>' + p.e + ' ' + esc(p.n) + '</b><small>' + esc(p.info) + '</small></button>').join('');
        openSheet({
            title: 'Генератор карт',
            html: '<p class="hint">Новая карта заменит текущую; герои останутся. Это можно отменить кнопкой «Отменить».</p><h4 class="gn-h">Готовые карты</h4><div class="gn-cards">' + cards + '</div>' +
                '<h4 class="gn-h">Случайная карта</h4><span class="field-label">Местность</span>' + chips('data-gb', [['any', 'Любая']].concat(DND_GEN_BIOMES.map(b => [b.id, b.e + ' ' + b.n])), st.biome) +
                '<span class="field-label">Размер</span>' + chips('data-gs', DND_GEN_SIZES.map(s => [s.id, s.n + ' ' + s.w + '×' + s.h]), st.size) +
                '<span class="field-label">Поселений</span>' + chips('data-gk', [[0.5, 'Мало'], [1, 'Средне'], [1.5, 'Много']], st.k) +
                '<div class="switch-row"><div class="tx"><b>Дороги и здания</b><small>выключено — только местность</small></div><input type="checkbox" class="switch" id="gn-build" aria-label="Дороги и здания" checked></div>' +
                '<div class="gn-prev"><canvas id="gn-cv"></canvas><div class="gn-side"><b id="gn-cap"></b><small id="gn-sub"></small><button type="button" class="btn" id="gn-roll">' + ic('refresh') + 'Другой вариант</button></div></div>',
            actions: [{ label: 'Закрыть', value: false }, { label: 'Создать эту карту', kind: 'primary', icon: 'auto_awesome', onClick: async ap => { if (!cur) return false; if (await this.applyGen(cur) === false) return false; } }],
            onOpen: ap => {
                hydrateIcons(ap.body); const q = s => ap.body.querySelector(s), cv = q('#gn-cv');
                const upd = () => {
                    cur = gen(); dndGenPreview(cv, cur); const b = DND_GEN_BIOMES.find(x => x.id === cur.biome);
                    q('#gn-cap').textContent = b.e + ' ' + b.n + ' · ' + cur.w + '×' + cur.h; q('#gn-sub').textContent = 'Карта № ' + cur.seed + (cur.towns.length ? ' · поселений: ' + cur.towns.length : '');
                };
                upd(); setTimeout(() => ap.body.querySelectorAll('.gn-card').forEach(cd => { const p = DND_GEN_PRESETS.find(x => x.id === cd.dataset.gp); dndGenPreview(cd.querySelector('canvas'), dndCityGenerate({ biome: p.biome, w: p.w, h: p.h, seed: p.seed, towns: p.count, preset: p })); }), 30);
                ap.body.addEventListener('click', async e => {
                    const pc = e.target.closest('[data-gp]'), gb = e.target.closest('[data-gb]'), gs = e.target.closest('[data-gs]'), gk = e.target.closest('[data-gk]');
                    if (pc) { const p = DND_GEN_PRESETS.find(x => x.id === pc.dataset.gp); if (await this.applyGen(dndCityGenerate({ biome: p.biome, w: p.w, h: p.h, seed: p.seed, towns: p.count, preset: p }))) ap.close(true); return; }
                    if (gb) st.biome = gb.dataset.gb; else if (gs) st.size = gs.dataset.gs; else if (gk) st.k = +gk.dataset.gk; else if (e.target.closest('#gn-roll')) st.seed = 1000 + Math.floor(Math.random() * 89000); else return;
                    ap.body.querySelectorAll('[data-gb],[data-gs],[data-gk]').forEach(b => { const a = b.dataset; b.classList.toggle('is-on', (a.gb !== undefined && a.gb === st.biome) || (a.gs !== undefined && a.gs === st.size) || (a.gk !== undefined && +a.gk === st.k)); });
                    upd();
                });
                q('#gn-build').addEventListener('change', e => { st.build = e.target.checked; upd(); });
            }
        });
    }
    settingsSheet() {
        const c = this.city;
        openSheet({
            title: 'Карта города',
            html: '<div class="em-steps"><div><span class="field-label">Ширина, клеток</span><div class="em-num"><button type="button" class="icon-btn" data-sz="w-">−</button><b id="cs-w">' + c.w + '</b><button type="button" class="icon-btn" data-sz="w+">+</button></div></div>' +
                '<div><span class="field-label">Высота, клеток</span><div class="em-num"><button type="button" class="icon-btn" data-sz="h-">−</button><b id="cs-h">' + c.h + '</b><button type="button" class="icon-btn" data-sz="h+">+</button></div></div></div>' +
                '<p class="hint">Расширение добавляет траву справа и снизу; уменьшение обрезает края вместе с тем, что там стоит.</p>' +
                '<div class="switch-row"><div class="tx"><b>Сетка</b></div><input type="checkbox" class="switch" id="cs-grid" aria-label="Сетка"' + (c.grid !== false ? ' checked' : '') + '></div>' +
                '<div class="switch-row"><div class="tx"><b>Подписи зданий и героев</b></div><input type="checkbox" class="switch" id="cs-lab" aria-label="Подписи"' + (c.lab !== false ? ' checked' : '') + '></div>' +
                '<div class="btn-group" style="margin-top:0.5rem"><button type="button" class="btn btn-danger" id="cs-clr">' + ic('delete') + 'Стереть местность</button><button type="button" class="btn btn-danger" id="cs-all">' + ic('delete') + 'Очистить всю карту</button></div>',
            actions: [{ label: 'Готово', kind: 'primary', value: true }],
            onOpen: ap => {
                hydrateIcons(ap.body); const q = s => ap.body.querySelector(s);
                const resize = (nw, nh) => {
                    nw = Math.max(8, Math.min(120, nw)); nh = Math.max(8, Math.min(120, nh)); if (nw === c.w && nh === c.h) return; this.snap();
                    const t = new Uint8Array(nw * nh); for (let y = 0; y < Math.min(nh, c.h); y++) for (let x = 0; x < Math.min(nw, c.w); x++) t[y * nw + x] = this.tiles[y * c.w + x];
                    c.w = nw; c.h = nh; this.tiles = t; this.tcClear(); c.items = c.items.filter(i => i.x < nw && i.y < nh); c.items.forEach(i => { if (i.t === 'b') { i.w = Math.min(i.w, nw - i.x); i.h = Math.min(i.h, nh - i.y); } });
                    this.save(true); q('#cs-w').textContent = nw; q('#cs-h').textContent = nh; this.draw();
                };
                ap.body.addEventListener('click', e => { const s = e.target.closest('[data-sz]'); if (!s) return; const f = s.dataset.sz[0], d = s.dataset.sz[1] === '+' ? 4 : -4; resize(f === 'w' ? c.w + d : c.w, f === 'h' ? c.h + d : c.h); });
                q('#cs-grid').addEventListener('change', e => { c.grid = e.target.checked; this.save(true); this.draw(); });
                q('#cs-lab').addEventListener('change', e => { c.lab = e.target.checked; this.save(true); this.draw(); });
                q('#cs-clr').addEventListener('click', async () => { if (await confirmSheet('Стереть местность?', 'Вся трава, дороги и вода будут сброшены в траву. Здания и герои останутся. Это можно отменить.', 'Стереть', true)) { this.snap(); this.tiles.fill(0); this.tcClear(); this.save(true); this.draw(); } });
                q('#cs-all').addEventListener('click', async () => { if (await confirmSheet('Очистить всю карту?', 'Исчезнет всё: местность, здания, жетоны. Привязки блоков сюжета к зданиям тоже сбросятся. Это можно отменить кнопкой «Отменить».', 'Очистить', true)) { this.snap(); this.tiles.fill(0); this.tcClear(); (this.g.plot.items || []).forEach(x => { delete x.bldId; }); c.items = []; this.sel = null; this.save(); this.draw(); } });
            }
        });
    }
}

// ---------- Подключение ----------
let dndCity = null;
function initDndCity() { const h = document.getElementById('dnd-visual-host'); if (h) { dndCity = new DndCity(h); dndCity.bind(typeof dndCur === 'function' ? dndCur() : null); } }
function dndVisualOpened() { if (!dndCity) return; const g = dndCur(); if (dndCity.g !== g || dndCity._dirty) { dndCity._dirty = false; dndCity.bind(g); } else { dndCity.resize(); dndCity.fitOnce(); } dndRefreshHeaders(); }
function dndCityReload() { if (!dndCity) return; dndCity._dirty = true; if (dndCity.host.offsetParent) dndVisualOpened(); }
