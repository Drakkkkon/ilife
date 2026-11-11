'use strict';
// =====================================================================================================
// iLife 2.1.0 — «ДНД»: ВЫВОД ИГРЫ.
//   • Пакет для Miro (ZIP): board.png (вся доска картинкой), miro_board.json (предметы и стрелки в формате Miro),
//     miro_cards.csv (таблица всех карточек, героев, блоков и зданий), miro_stickers.txt (по строке на стикер), файл игры iLife.
//   • PDF «Склеить большую карту»: доска, сюжет или город режутся на листы A4/A3/Letter с метками, нахлёстом и схемой склейки.
//   • PDF «Список событий»: блоки сюжета по порядку, у каждого «откуда» и «дальше» со стрелками.
//   • Текст (.txt) со всей игрой, PNG доски, сюжета и города.
// Нужны: js/pdf.js (PdfWriter), js/dnd-city.js (карта города), js/dnd-emoji.js.
// =====================================================================================================

// ---------- ZIP без сжатия ----------
const DND_CRC_T = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function dndCrc32(u8) { let c = 0xFFFFFFFF; for (let i = 0; i < u8.length; i++) c = DND_CRC_T[(c ^ u8[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
// files: [{ name, data: Uint8Array | string }] → Blob (zip)
function dndZip(files) {
    const enc = new TextEncoder(), parts = [], cen = []; let pos = 0;
    const d = new Date(), time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1), date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
    const u16 = v => [v & 255, (v >> 8) & 255], u32 = v => [v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255];
    files.forEach(f => {
        const name = enc.encode(f.name), data = typeof f.data === 'string' ? enc.encode(f.data) : f.data, crc = dndCrc32(data);
        const lh = new Uint8Array([0x50, 0x4b, 3, 4, 20, 0, 0, 8, 0, 0, ...u16(time), ...u16(date), ...u32(crc), ...u32(data.length), ...u32(data.length), ...u16(name.length), 0, 0]);
        parts.push(lh, name, data);
        cen.push({ name, crc, size: data.length, off: pos, time, date }); pos += lh.length + name.length + data.length;
    });
    let csize = 0;
    cen.forEach(c => {
        const h = new Uint8Array([0x50, 0x4b, 1, 2, 20, 0, 20, 0, 0, 8, 0, 0, ...u16(c.time), ...u16(c.date), ...u32(c.crc), ...u32(c.size), ...u32(c.size), ...u16(c.name.length), 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, ...u32(c.off)]);
        parts.push(h, c.name); csize += h.length + c.name.length;
    });
    parts.push(new Uint8Array([0x50, 0x4b, 5, 6, 0, 0, 0, 0, ...u16(cen.length), ...u16(cen.length), ...u32(csize), ...u32(pos), 0, 0]));
    return new Blob(parts, { type: 'application/zip' });
}

// ---------- Общие помощники ----------
const dndSlug = s => String(s || 'игра').replace(/[^\p{L}\p{N}_-]+/gu, '_').replace(/^_+|_+$/g, '').slice(0, 40) || 'игра';
async function dndDeliver(blob, name, what) {
    const r = await deliverFile(blob, name);
    toast(r === 'unsupported' ? 'В этом приложении сохранить файл нельзя — откройте iLife в браузере' : r === 'shared' ? (what || 'Файл') + ' готов — выберите, куда отправить' : 'Сохранено: ' + name, { ms: 5000 });
    return r;
}
function dndJpegBytes(canvas, q) { return new Promise(res => canvas.toBlob(async b => res(b ? { bytes: new Uint8Array(await b.arrayBuffer()), w: canvas.width, h: canvas.height } : null), 'image/jpeg', q || 0.86)); }
const dndKindName = (it) => it.t === 'block' ? bdKind(BD_PLOT_KINDS, it.kind).n : bdKind(BD_CARD_KINDS, it.kind).n;

// ---------- Порядок событий и стрелки сюжета ----------
// Возвращает { list: блоки по порядку, out: Map(id → [{to, label}]), inn: Map(id → [{from, label}]), num: Map(id → номер) }
// Копия игры без «тайного» (если gm выключен): секретные заметки, заметки ведущему, тайны героев. Исходная игра не меняется.
function dndGameView(g, gm) {
    if (gm) return g;
    const c = JSON.parse(JSON.stringify(g));
    const clean = items => {
        const drop = new Set((items || []).filter(i => (i.t === 'card' || i.t === 'block') && i.kind === 'note' && i.secret).map(i => i.id));
        const out = (items || []).filter(i => !drop.has(i.id) && !(i.t === 'conn' && i.from && i.to && (drop.has(i.from.id) || drop.has(i.to.id))));
        out.forEach(i => { if (i.t === 'block' && i.gm) i.gm = ''; });
        return out;
    };
    if (c.board) c.board.items = clean(c.board.items);
    if (c.plot) c.plot.items = clean(c.plot.items);
    (c.chars || []).forEach(h => { h.secrets = ''; });
    return c;
}
function dndPlotFlow(g) {
    const items = (g.plot && g.plot.items) || [], blocks = items.filter(i => i.t === 'block'), byId = new Map(blocks.map(b => [b.id, b]));
    const out = new Map(blocks.map(b => [b.id, []])), inn = new Map(blocks.map(b => [b.id, []]));
    items.filter(i => i.t === 'conn' && i.from && i.to && byId.has(i.from.id) && byId.has(i.to.id) && i.from.id !== i.to.id).forEach(c => {
        const a = c.from.id, b = c.to.id; let from = a, to = b; if (c.head === 'start') { from = b; to = a; }
        out.get(from).push({ to, label: c.label || '' }); inn.get(to).push({ from, label: c.label || '' });
    });
    const pos = (a, b) => (a.y - b.y) || (a.x - b.x);
    blocks.sort(pos);
    const seen = new Set(), post = [];
    const dfs = v => { seen.add(v.id); out.get(v.id).map(e => byId.get(e.to)).sort((a, b) => pos(b, a)).forEach(c => { if (!seen.has(c.id)) dfs(c); }); post.push(v); };
    const roots = blocks.filter(b => !inn.get(b.id).length).sort((a, b) => (a.kind === 'start' ? -1 : 0) - (b.kind === 'start' ? -1 : 0) || pos(b, a));
    roots.forEach(r => { if (!seen.has(r.id)) dfs(r); });
    blocks.slice().sort((a, b) => pos(b, a)).forEach(b => { if (!seen.has(b.id)) dfs(b); });   // кольца и одиночные
    const list = post.reverse(), num = new Map(list.map((b, i) => [b.id, i + 1]));
    return { list, out, inn, num };
}

// ---------- Сцена доски (для картинок и склейки карты) ----------
// Лёгкая «доска» без страницы: нужна только для геометрии стрелок. Конструктор не вызываем — страница не создаётся.
function dndSceneOf(g, mode) {
    const model = mode === 'plot' ? g.plot : g.board, items = (model && model.items) || [];
    const sc = Object.create(DndBoard.prototype); sc.game = g; sc.mode = mode; sc.items = items; sc.els = new Map(); sc.cels = new Map(); sc.byIdMap = new Map(items.map(i => [i.id, i]));
    return sc;
}
const dndFont = (px, w, it) => (it ? 'italic ' : '') + (w || 400) + ' ' + px + 'px "Google Sans Flex", Roboto, system-ui, sans-serif';
function dndWrapText(g, text, x, y, w, lh, maxLines, al) {
    let yy = y, n = 0; const put = (line) => { if (n < maxLines) { const tx = al === 'center' ? x + w / 2 : al === 'right' ? x + w : x; g.textAlign = al || 'left'; g.fillText(line, tx, yy); } yy += lh; n++; };
    String(text || '').split('\n').forEach(par => { let line = ''; par.split(' ').forEach(word => { const t = line ? line + ' ' + word : word; if (g.measureText(t).width > w && line) { put(line); line = word; } else line = t; }); put(line); });
    g.textAlign = 'left'; return yy;
}
// Грузим картинки сцены заранее (отрисовка потом идёт без ожиданий и годится для многих листов)
async function dndScenePreload(g, scene) {
    const imgs = new Map(), want = new Set();
    scene.items.forEach(i => { if (i.t === 'image' && i.imgId) want.add(i.imgId); if (i.t === 'card' && i.imgId) want.add(i.imgId); });
    (g.chars || []).forEach(c => { if (c.portraitId) want.add(c.portraitId); });
    await Promise.all(Array.from(want).map(id => BlobDB.url(id, id && scene.items.some(i => i.t === 'image' && i.imgId === id) ? undefined : 'thumb').then(url => new Promise(res => { if (!url) return res(); const im = new Image(); im.onload = () => { imgs.set(id, im); res(); }; im.onerror = res; im.src = url; })).catch(() => {})));
    return imgs;
}
function dndSceneBox(scene) {
    const b = scene.bounds(); if (!b) return null;
    // «text» без высоты: оцениваем по числу строк
    scene.items.forEach(i => { if (i.t === 'text' && !i.h) { const n = String(i.text || '').split('\n').length; b.h = Math.max(b.h, i.y + n * (i.fs || 24) * 1.4 - b.y); } });
    return b;
}
// Рисует всю сцену в текущих координатах холста g (масштаб и сдвиг уже заданы снаружи)
function dndDrawScene(g, scene, imgs) {
    const game = scene.game, rr = (x, y, w, h, r) => { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); };
    const order = scene.items.filter(i => i.t !== 'conn').sort((a, b) => (a.t === 'frame' ? -1e9 : a.z || 0) - (b.t === 'frame' ? -1e9 : b.z || 0));
    g.textBaseline = 'alphabetic';
    for (const i of order.filter(i => i.t === 'frame')) { const c = i.c || '#8e8a98'; g.globalAlpha = 0.09; g.fillStyle = c; rr(i.x, i.y, i.w, i.h, 10); g.fill(); g.globalAlpha = 0.55; g.strokeStyle = c; g.lineWidth = 2; g.stroke(); g.globalAlpha = 1; g.fillStyle = c; g.font = dndFont(15, 600); g.fillText(i.title || 'Рамка', i.x + 2, i.y - 8); }
    for (const i of scene.items.filter(i => i.t === 'conn')) {
        if (!(i.from && i.to)) continue; let geo; try { geo = scene.connGeom(i); } catch (e) { continue; }
        const w = i.width || 2; g.strokeStyle = i.color || '#5f5b66'; g.fillStyle = i.color || '#5f5b66'; g.lineWidth = w; g.lineCap = 'round'; g.setLineDash(i.dash ? [w * 3.2, w * 2.6] : []); g.stroke(new Path2D(geo.d)); g.setLineDash([]);
        const arrow = (p, ang) => { const s = 9 + w * 1.6, ux = Math.cos(ang), uy = Math.sin(ang), bx = p.x - ux * s, by = p.y - uy * s, hw = s * 0.48; g.beginPath(); g.moveTo(p.x, p.y); g.lineTo(bx - uy * hw, by + ux * hw); g.lineTo(bx + uy * hw, by - ux * hw); g.closePath(); g.fill(); };
        if (i.head === 'end' || i.head === 'both') arrow(geo.p2, geo.a2); if (i.head === 'both' || i.head === 'start') arrow(geo.p1, geo.a1);
        if (i.label) { g.font = dndFont(13, 500); g.textAlign = 'center'; g.textBaseline = 'middle'; g.lineWidth = 5; g.strokeStyle = '#fff'; g.strokeText(i.label, geo.mid.x, geo.mid.y); g.fillStyle = '#3a3640'; g.fillText(i.label, geo.mid.x, geo.mid.y); g.textAlign = 'left'; g.textBaseline = 'alphabetic'; }
    }
    for (const i of order.filter(i => i.t !== 'frame')) {
        g.textBaseline = 'alphabetic'; g.textAlign = 'left';
        if (i.t === 'sticky') { g.save(); g.shadowColor = 'rgba(0,0,0,.18)'; g.shadowBlur = 8; g.shadowOffsetY = 2; g.fillStyle = i.c; rr(i.x, i.y, i.w, i.h, 4); g.fill(); g.restore(); g.fillStyle = bdInk(i.c); g.font = dndFont(i.fs || 18, 500); dndWrapText(g, i.text, i.x + 14, i.y + 14 + (i.fs || 18), i.w - 28, (i.fs || 18) * 1.3, Math.max(1, Math.floor((i.h - 20) / ((i.fs || 18) * 1.3)))); }
        else if (i.t === 'text') { g.fillStyle = i.ink || '#1d1b20'; g.font = dndFont(i.fs || 24, 400); dndWrapText(g, i.text, i.x, i.y + (i.fs || 24), i.w, (i.fs || 24) * 1.25, 60, i.al); }
        else if (i.t === 'shape') {
            const fill = i.fill === 'none' ? null : (i.fill || '#fff'); g.lineWidth = 2; g.strokeStyle = i.stroke || '#79747e'; g.beginPath();
            if (i.shape === 'ellipse') g.ellipse(i.x + i.w / 2, i.y + i.h / 2, i.w / 2, i.h / 2, 0, 0, Math.PI * 2); else if (i.shape === 'diamond') { g.moveTo(i.x + i.w / 2, i.y); g.lineTo(i.x + i.w, i.y + i.h / 2); g.lineTo(i.x + i.w / 2, i.y + i.h); g.lineTo(i.x, i.y + i.h / 2); g.closePath(); }
            else if (i.shape === 'triangle') { g.moveTo(i.x + i.w / 2, i.y); g.lineTo(i.x + i.w, i.y + i.h); g.lineTo(i.x, i.y + i.h); g.closePath(); }
            else if (i.shape === 'hex') { g.moveTo(i.x + i.w * .25, i.y); g.lineTo(i.x + i.w * .75, i.y); g.lineTo(i.x + i.w, i.y + i.h / 2); g.lineTo(i.x + i.w * .75, i.y + i.h); g.lineTo(i.x + i.w * .25, i.y + i.h); g.lineTo(i.x, i.y + i.h / 2); g.closePath(); }
            else rr(i.x, i.y, i.w, i.h, i.shape === 'round' ? 20 : 4);
            if (fill) { g.fillStyle = fill; g.fill(); } g.stroke();
            g.fillStyle = i.ink || bdInk(i.fill); g.font = dndFont(i.fs || 18, 500); g.textAlign = 'center'; const lines = String(i.text || '').split('\n'); lines.forEach((ln, n) => g.fillText(ln, i.x + i.w / 2, i.y + i.h / 2 + (n - (lines.length - 1) / 2) * (i.fs || 18) * 1.3 + (i.fs || 18) * 0.35, i.w - 16)); g.textAlign = 'left';
        }
        else if (i.t === 'card' || i.t === 'block') {
            const kd = i.t === 'card' ? bdKind(BD_CARD_KINDS, i.kind) : bdKind(BD_PLOT_KINDS, i.kind), col = i.c || kd.c, sec = i.secret && i.kind === 'note', fs = (i.fs || 100) / 100, ft = (i.fst || i.fs || 100) / 100;
            g.save(); g.shadowColor = 'rgba(0,0,0,.2)'; g.shadowBlur = 10; g.shadowOffsetY = 2; g.fillStyle = '#ffffff'; rr(i.x, i.y, i.w, i.h, 12); g.fill(); g.restore();
            g.save(); rr(i.x, i.y, i.w, i.h, 12); g.clip();
            if (sec) { g.strokeStyle = 'rgba(120,110,140,.16)'; g.lineWidth = 6; g.beginPath(); for (let s = -i.h; s < i.w; s += 16) { g.moveTo(i.x + s, i.y + i.h); g.lineTo(i.x + s + i.h, i.y); } g.stroke(); }
            g.fillStyle = col; g.fillRect(i.x, i.y, i.w, 30); g.restore();
            g.fillStyle = '#fff'; g.font = dndFont(13, 600); g.fillText(kd.n + (sec ? ' · секрет' : ''), i.x + 12, i.y + 20);
            const ch = i.t === 'card' && i.kind === 'char' && i.charId ? (game.chars || []).find(c => c.id === i.charId) : null, ph = ch && ch.portraitId ? imgs.get(ch.portraitId) : null;
            let tx = i.x + 12, tw = i.w - 24;
            if (ch) { const pw = 42, phh = 56; if (ph) { g.save(); rr(i.x + 12, i.y + 38, pw, phh, 6); g.clip(); const k = Math.max(pw / ph.naturalWidth, phh / ph.naturalHeight); g.drawImage(ph, i.x + 12 - (ph.naturalWidth * k - pw) / 2, i.y + 38, ph.naturalWidth * k, ph.naturalHeight * k); g.restore(); } else { g.fillStyle = 'hsl(' + (ch.hue || 265) + ',55%,48%)'; rr(i.x + 12, i.y + 38, pw, phh, 6); g.fill(); g.fillStyle = '#fff'; g.font = dndFont(22, 700); g.textAlign = 'center'; g.fillText((ch.name || '?').charAt(0).toUpperCase(), i.x + 12 + pw / 2, i.y + 38 + phh / 2 + 8); g.textAlign = 'left'; } tx += pw + 10; tw -= pw + 10; }
            g.fillStyle = '#1d1b20'; g.font = dndFont(Math.round(16 * ft), i.bold === false ? 400 : 600, i.ital); let yy = dndWrapText(g, i.title || 'Без названия', tx, i.y + 54, tw, 20 * ft, 2, i.al);
            g.fillStyle = '#5f5b66'; g.font = dndFont(Math.round(13 * fs), 400, i.ital); if (i.text) yy = dndWrapText(g, i.text, tx, yy + 2, tw, 17 * fs, Math.max(1, Math.floor((i.y + i.h - yy - 28) / (17 * fs))), i.al);
            const tags = (i.tags || []); if (tags.length) { g.font = dndFont(12, 600); let xx = i.x + 12; tags.forEach(t => { const k = dndTagKind(game, t), w = g.measureText('#' + t).width; if (xx + w < i.x + i.w - 8) { g.fillStyle = DND_TAG_KINDS[k].c; g.fillText('#' + t, xx, i.y + i.h - 12); xx += w + 8; } }); }
            if (i.t === 'block') {
                const chars = dndBlockChars(game, i).slice(0, 4); chars.forEach((c, n) => { const px = i.x + i.w - 12 - 30 - n * 14, py = i.y + i.h - 12 - 40, im = c.portraitId ? imgs.get(c.portraitId) : null; g.save(); rr(px, py, 30, 40, 4); g.clip(); if (im) { const k = Math.max(30 / im.naturalWidth, 40 / im.naturalHeight); g.drawImage(im, px - (im.naturalWidth * k - 30) / 2, py, im.naturalWidth * k, im.naturalHeight * k); } else { g.fillStyle = 'hsl(' + (c.hue || 265) + ',55%,48%)'; g.fillRect(px, py, 30, 40); g.fillStyle = '#fff'; g.font = dndFont(15, 700); g.textAlign = 'center'; g.fillText((c.name || '?').charAt(0).toUpperCase(), px + 15, py + 26); g.textAlign = 'left'; } g.restore(); g.strokeStyle = '#fff'; g.lineWidth = 1.5; rr(px, py, 30, 40, 4); g.stroke(); });
            }
        }
        else if (i.t === 'emoji') { try { g.drawImage(dndEmojiCanvas(i), i.x, i.y, i.w, i.h); } catch (e) {} }
        else if (i.t === 'pen') { g.strokeStyle = i.color; g.lineWidth = i.width || 3; g.lineCap = 'round'; g.lineJoin = 'round'; g.beginPath(); (i.pts || []).forEach((p, n) => { const px = i.x + p[0] * (i.w / (i.ow || 1)), py = i.y + p[1] * (i.h / (i.oh || 1)); n ? g.lineTo(px, py) : g.moveTo(px, py); }); g.stroke(); }
        else if (i.t === 'image') { const im = imgs.get(i.imgId); if (im) g.drawImage(im, i.x, i.y, i.w, i.h); }
    }
}
// Участок источника → холст. src: { kind:'board'|'plot'|'city', ... }, область в единицах источника, k — пикселей на единицу
function dndRenderRegion(src, x0, y0, x1, y1, k) {
    const cv = document.createElement('canvas'); cv.width = Math.max(1, Math.round((x1 - x0) * k)); cv.height = Math.max(1, Math.round((y1 - y0) * k));
    const c = cv.getContext('2d'); c.fillStyle = '#ffffff'; c.fillRect(0, 0, cv.width, cv.height);
    if (src.kind === 'city') { dndCityDraw(c, src.g, src.city, { px: k, ox: -x0 * k, oy: -y0 * k, x0, y0, x1, y1, badges: false }); }
    else { c.scale(k, k); c.translate(-x0, -y0); dndDrawScene(c, src.scene, src.imgs); }
    return cv;
}
// Подготовка источника: границы и картинки
async function dndSource(g, kind) {
    if (kind === 'city') { const city = dndCityGet(g); if (!city) return null; await dndCityPreload(g); return { kind, g, city, x: 0, y: 0, w: city.w, h: city.h, unit: 'клеток' }; }
    const scene = dndSceneOf(g, kind), b = dndSceneBox(scene); if (!b) return null; const pad = 48;
    return { kind, g, scene, imgs: await dndScenePreload(g, scene), x: b.x - pad, y: b.y - pad, w: b.w + pad * 2, h: b.h + pad * 2, unit: 'px' };
}
const DND_SRC_NAMES = { board: 'Карточки и Заметки', plot: 'Сюжет', city: 'Вижуал (город)' };

// ---------- PNG ----------
async function dndSavePng(g, kind) {
    const src = await dndSource(g, kind); if (!src) { toast(kind === 'city' ? 'Карта города пока пуста' : 'Здесь пока нечего сохранять'); return; }
    const k = src.kind === 'city' ? Math.min(48, Math.max(16, Math.floor(4000 / Math.max(src.w, src.h)))) : Math.min(2, 4096 / Math.max(src.w, src.h));
    const cv = dndRenderRegion(src, src.x, src.y, src.x + src.w, src.y + src.h, k), blob = await new Promise(r => cv.toBlob(r, 'image/png'));
    await dndDeliver(blob, stampName('ДНД_' + (kind === 'plot' ? 'сюжет' : kind === 'city' ? 'город' : 'доска') + '_' + dndSlug(g.title), 'png'), 'Картинка');
}
DndBoard.prototype.exportPng = function () { if (this.game) dndSavePng(this.game, this.mode).catch(e => { console.error(e); toast('Не удалось сохранить картинку'); }); };

// ---------- PDF: склеить большую карту ----------
const DND_PAPER = { a4: ['A4', 210, 297], a3: ['A3', 297, 420], letter: ['Letter', 215.9, 279.4] };
// Считает раскладку листов (без рисования), чтобы показать пользователю итог ещё до создания файла
function dndMapPlan(src, o) {
    const [, pw0, ph0] = DND_PAPER[o.paper] || DND_PAPER.a4, m = 8, ov = o.overlap || 0;
    const calc = land => {
        const pw = (land ? ph0 : pw0) - m * 2, ph = (land ? pw0 : ph0) - m * 2, n = Math.max(1, o.across), mapW = n * (pw - ov) + ov, s = mapW / src.w, mapH = src.h * s;
        const rows = mapH <= ph ? 1 : Math.ceil((mapH - ov) / (ph - ov));
        return { land, pw, ph, n, rows, s, mapW, mapH, pages: n * rows, paperW: land ? ph0 : pw0, paperH: land ? pw0 : ph0 };
    };
    const a = calc(true), b = calc(false);
    return o.orient === 'land' ? a : o.orient === 'port' ? b : (a.pages < b.pages || (a.pages === b.pages && src.w >= src.h) ? a : b);
}
const dndLetter = n => { let s = ''; n++; while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); } return s; };
async function dndMapPdf(g, o, progress) {
    const src = await dndSource(g, o.src); if (!src) throw new Error('empty');
    const pl = dndMapPlan(src, o), mm = 72 / 25.4, m = 8, ov = o.overlap || 0, dpi = 150, k = pl.s * dpi / 25.4;   // пикселей на единицу источника
    const pdf = new PdfWriter({ title: 'Карта: ' + g.title, footer: false }); pdf.W = pl.paperW * mm; pdf.H = pl.paperH * mm;
    const cols = pl.n, rows = pl.rows, step = { x: pl.pw - ov, y: pl.ph - ov };
    // страница 1 — схема склейки
    const mx = 36; let y = 40;
    pdf.textAt('iLife · ДНД', mx, y, 10, { color: '#79747e' }); y += 30;
    pdf.textAt('Карта «' + g.title + '» — склейка из ' + pl.pages + ' ' + (pl.pages === 1 ? 'листа' : pl.pages < 5 ? 'листов' : 'листов'), mx, y, 22, { bold: true, color: '#1d1b20' }); y += 18;
    const mapCm = [Math.round(pl.mapW / 10 * 10) / 10, Math.round(pl.mapH / 10 * 10) / 10];
    pdf.textAt(DND_SRC_NAMES[o.src] + ' · ' + DND_PAPER[o.paper][0] + (pl.land ? ', альбомная' : ', книжная') + ' · ' + cols + ' × ' + rows + ' листов · итог примерно ' + mapCm[0] + ' × ' + mapCm[1] + ' см' + (src.kind === 'city' ? ' · клетка ' + (Math.round(pl.s * 10) / 10) + ' мм' : ''), mx, y + 8, 10.5, { color: '#49454f' }); y += 30;
    const availW = pdf.W - mx * 2, availH = pdf.H - y - 150, cell = Math.min(availW / cols, availH / rows, 90), gx = mx, gy = y;
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
        pdf.rect(gx + c * cell, gy + r * cell, cell - 2, cell - 2, '#e8def8', 3); pdf.textAt(dndLetter(c) + (r + 1), gx + c * cell + (cell - 2) / 2, gy + r * cell + (cell - 2) / 2 + 5, Math.min(16, cell / 3), { bold: true, align: 'center', color: '#4a3b73' });
    }
    y = gy + rows * cell + 22;
    const tips = ['Печатайте в масштабе 100% («Реальный размер»), без «вписать в страницу».', 'Обрежьте листы по угловым меткам (поля 8 мм остаются снаружи).' + (ov ? ' Нахлёст ' + ov + ' мм: рисунок на соседних листах повторяется, склеивайте по пунктирной линии.' : ' Края листов стыкуются встык.'), 'Буква — столбец, цифра — строка: A1 в левом верхнем углу, дальше вправо и вниз.', 'Сначала склейте строки между собой, затем сами строки.'];
    tips.forEach(t => { pdf.y = y; y += pdf.para('• ' + t, { size: 10.5, lh: 1.35, width: pdf.W - mx * 2 }) + 3; });
    // листы с картой
    let n = 0;
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
        n++; if (progress) progress(n / pl.pages);
        const x0u = src.x + (c * step.x) / pl.s, y0u = src.y + (r * step.y) / pl.s, x1u = x0u + pl.pw / pl.s, y1u = y0u + pl.ph / pl.s;
        const cv = dndRenderRegion(src, x0u, y0u, x1u, y1u, k), jp = await dndJpegBytes(cv, 0.86);
        cv.width = cv.height = 1; if (!jp) throw new Error('jpeg');
        pdf.newPage(); const X = m * mm, Y = m * mm, W = pl.pw * mm, H = pl.ph * mm;
        pdf.image(jp, X, Y, W, H);
        if (o.marks !== false) {
            const L = 3.2 * mm, d = 1 * mm, col = '#444444'; // угловые метки вокруг области печати
            [[X, Y, -1, -1], [X + W, Y, 1, -1], [X, Y + H, -1, 1], [X + W, Y + H, 1, 1]].forEach(([px, py, sx, sy]) => { pdf.line(px + sx * d, py, px + sx * (d + L), py, col, 0.6); pdf.line(px, py + sy * d, px, py + sy * (d + L), col, 0.6); });
            if (ov && c < cols - 1) { const lx = X + (pl.pw - ov) * mm; for (let yy = Y; yy < Y + H; yy += 8) pdf.line(lx, yy, lx, Math.min(Y + H, yy + 4), '#c62828', 0.5); pdf.textAt('склеить с ' + dndLetter(c + 1) + (r + 1) + ' →', lx - 4, Y + 10, 7, { align: 'right', color: '#c62828' }); }
            if (ov && r < rows - 1) { const ly = Y + (pl.ph - ov) * mm; for (let xx = X; xx < X + W; xx += 8) pdf.line(xx, ly, Math.min(X + W, xx + 4), ly, '#c62828', 0.5); pdf.textAt('склеить с ' + dndLetter(c) + (r + 2) + ' ↓', X + 6, ly - 3, 7, { color: '#c62828' }); }
        }
        pdf.textAt(dndLetter(c) + (r + 1) + ' · лист ' + n + ' из ' + pl.pages, X, Y - 3.4 * mm, 8, { color: '#444444', bold: true });
        pdf.textAt(g.title + ' · ' + DND_SRC_NAMES[o.src], X + W, Y - 3.4 * mm, 7, { color: '#79747e', align: 'right' });
    }
    return { blob: await pdf.build(), plan: pl };
}

// ---------- PDF: список событий со стрелками ----------
async function dndEventsPdf(g, o) {
    const flow = dndPlotFlow(g); if (!flow.list.length) throw new Error('empty');
    const pdf = new PdfWriter({ title: 'События: ' + g.title }); const mx = pdf.mx, cw = pdf.cw; const accent = '#6750a4';
    const city = dndCityGet(g), bname = id => { const b = city && city.items.find(x => x.id === id); return b ? (b.n || 'Здание') : ''; };
    pdf.textAt('iLife · ДНД', mx, pdf.y + 8, 10, { color: '#79747e' }); pdf.textAt(fmtDateTime(Date.now()), pdf.W - mx, pdf.y + 8, 9, { color: '#79747e', align: 'right' }); pdf.y += 26;
    pdf.para('События игры «' + g.title + '»', { size: 24, bold: true, lh: 1.15 }); pdf.gap(2);
    const nOut = Array.from(flow.out.values()).reduce((s, a) => s + a.length, 0);
    pdf.para(flow.list.length + ' событий · ' + nOut + ' переходов · порядок идёт по стрелкам сюжета, неподключённые блоки — в конце' + (o.gm ? ' · с заметками ведущего' : ' · без заметок ведущего'), { size: 10, color: '#49454f' });
    pdf.gap(8); pdf.line(mx, pdf.y, pdf.W - mx, pdf.y, accent, 1.2); pdf.gap(14);
    const lab = (id) => { const b = flow.list.find(x => x.id === id); return flow.num.get(id) + '. ' + ((b && b.title) || 'Без названия'); };
    for (let idx = 0; idx < flow.list.length; idx++) {
        const b = flow.list[idx], kd = bdKind(BD_PLOT_KINDS, b.kind), st = BD_PLOT_STATUS.find(s => s.k === (b.status || 'plan')), chars = dndBlockChars(g, b), col = b.c || kd.c;
        const intro = o.details ? (b.intro || []).filter(x => x.title || x.text) : [];
        pdf.ensure(110);
        const y0 = pdf.y; pdf.rect(mx, y0, cw, 24, col, 7); pdf.rect(mx, y0 + 12, cw, 12, col);
        pdf.textAt(String(flow.num.get(b.id)), mx + 12, y0 + 16.5, 12, { bold: true, color: '#ffffff' }); pdf.textAt(kd.n + (st && b.status !== 'plan' ? ' · ' + st.n : ''), mx + 34, y0 + 16, 10, { bold: true, color: '#ffffff' });
        if (b.bldId && bname(b.bldId)) pdf.textAt('Здание: ' + bname(b.bldId), pdf.W - mx - 10, y0 + 16, 9, { color: '#ffffff', align: 'right' });
        pdf.y = y0 + 32;
        pdf.para(b.title || 'Без названия', { size: 15, bold: true, lh: 1.2, indent: 4 }); pdf.gap(2);
        if (b.text) pdf.para(b.text, { size: 11, color: '#3a3640', indent: 4 });
        if (o.details && b.desc) { pdf.gap(3); pdf.para(b.desc, { size: 10.5, color: '#49454f', indent: 4 }); }
        if (chars.length) { pdf.gap(3); pdf.para('Участвуют: ' + chars.map(c => c.name || 'Без имени').join(', '), { size: 10, color: '#4a3b73', indent: 4, bold: true }); }
        if (intro.length) { pdf.gap(4); pdf.para('Вводные:', { size: 10, bold: true, indent: 4 }); intro.forEach(x => pdf.para('• ' + (x.title || 'Вводная') + (x.text ? ' — ' + x.text : ''), { size: 10, color: '#3a3640', indent: 12 })); }
        if (o.gm && b.gm) { pdf.gap(4); pdf.para('Ведущему: ' + b.gm, { size: 10, color: '#8a2d2d', indent: 4 }); }
        if ((b.tags || []).length) { pdf.gap(3); pdf.para(b.tags.map(t => '#' + t).join('  '), { size: 9.5, color: col, indent: 4, bold: true }); }
        const from = flow.inn.get(b.id), to = flow.out.get(b.id);
        if (from.length) { pdf.gap(4); pdf.para('← Откуда: ' + from.map(e => lab(e.from) + (e.label ? ' (' + e.label + ')' : '')).join('; '), { size: 9.5, color: '#79747e', indent: 4 }); }
        if (to.length) { pdf.gap(2); to.forEach(e => pdf.para('→ Дальше: ' + lab(e.to) + (e.label ? '  [' + e.label + ']' : ''), { size: 10.5, bold: true, color: accent, indent: 4 })); }
        pdf.gap(6);
        const yEnd = pdf.y; pdf.line(mx, y0 + 24, mx, yEnd, '#d9d3e6', 0.8); pdf.line(pdf.W - mx, y0 + 24, pdf.W - mx, yEnd, '#d9d3e6', 0.8); pdf.line(mx, yEnd, pdf.W - mx, yEnd, '#d9d3e6', 0.8);
        // стрелка вниз к следующему событию в списке
        if (idx < flow.list.length - 1) {
            const nx = flow.list[idx + 1], linked = to.some(e => e.to === nx.id);
            pdf.ensure(34); const cx = pdf.W / 2, ya = pdf.y + 2, yb = pdf.y + 24, c2 = linked ? accent : '#b9b3c6';
            if (!linked) { for (let yy = ya; yy < yb - 2; yy += 6) pdf.line(cx, yy, cx, Math.min(yb, yy + 3), c2, 1.2); } else pdf.line(cx, ya, cx, yb, c2, 1.6);
            pdf.line(cx - 5, yb - 6, cx, yb, c2, 1.6); pdf.line(cx + 5, yb - 6, cx, yb, c2, 1.6);
            if (!linked) pdf.textAt('нет прямой стрелки', cx + 12, yb - 8, 8, { color: '#79747e' });
            pdf.y += 30;
        }
    }
    return pdf.build();
}

// ---------- Текст ----------
function dndTextExport(g, o) {
    o = o || {}; const L = [], hr = '─'.repeat(40);
    const tags = a => (a && a.length ? '  ' + a.map(t => '#' + t).join(' ') : '');
    L.push('ИГРА: ' + g.title); L.push([g.system, dndStatusName(g.status)].filter(Boolean).join(' · ')); if (g.desc) L.push(g.desc); L.push('Выгружено: ' + fmtDateTime(Date.now()) + ' · iLife ' + APP_VERSION); L.push('');
    const chars = g.chars || [];
    if (chars.length) {
        L.push(hr, 'ПЕРСОНАЖИ (' + chars.length + ')', hr);
        chars.forEach(c => {
            L.push('■ ' + (c.name || 'Без имени') + ' — ' + dcType(c.type).n + [c.race, c.cls, c.level && c.cls ? c.level + ' ур.' : ''].filter(Boolean).map(x => ' · ' + x).join(''));
            [['Роль', c.role], ['Игрок', c.player], ['Возраст', c.age], ['Внешность', c.look], ['Характер', c.traits], ['Цели', c.goals], ['История', c.backstory], ['Связи', (c.rel || []).filter(r => r.name).map(r => r.name + (r.note ? ' (' + r.note + ')' : '')).join(', ')], ['Заметки', c.notes], o.gm ? ['Тайны', c.secrets] : null].forEach(p => { if (p && p[1]) L.push('   ' + p[0] + ': ' + String(p[1]).replace(/\n/g, '\n      ')); });
            L.push('');
        });
    }
    const cards = ((g.board && g.board.items) || []).filter(i => i.t === 'card');
    if (cards.length) {
        L.push(hr, 'КАРТОЧКИ И ЗАМЕТКИ (' + cards.length + ')', hr);
        BD_CARD_KINDS.forEach(k => {
            const ls = cards.filter(c => (c.kind || 'note') === k.k && (o.gm || !c.secret)); if (!ls.length) return; L.push('[' + k.n + ']');
            ls.forEach(c => { L.push('■ ' + (c.title || 'Без названия') + (c.secret ? ' (СЕКРЕТ)' : '') + tags(c.tags)); if (c.text) L.push('   ' + c.text.replace(/\n/g, '\n   ')); }); L.push('');
        });
        const loose = ((g.board && g.board.items) || []).filter(i => (i.t === 'sticky' || i.t === 'text') && (i.text || '').trim()); if (loose.length) { L.push('[Стикеры и надписи]'); loose.forEach(s => L.push('• ' + s.text.replace(/\n/g, ' / '))); L.push(''); }
    }
    const flow = dndPlotFlow(g);
    if (flow.list.length) {
        const city = dndCityGet(g), bname = id => { const b = city && city.items.find(x => x.id === id); return b ? (b.n || 'Здание') : ''; };
        L.push(hr, 'СЮЖЕТ (' + flow.list.length + ' событий)', hr);
        flow.list.forEach(b => {
            const kd = bdKind(BD_PLOT_KINDS, b.kind), st = BD_PLOT_STATUS.find(s => s.k === (b.status || 'plan')); if (!o.gm && b.secret) return;
            L.push(flow.num.get(b.id) + '. ' + (b.title || 'Без названия') + '  [' + kd.n + (st ? ', ' + st.n : '') + ']' + tags(b.tags));
            if (b.text) L.push('   ' + b.text.replace(/\n/g, '\n   ')); if (b.desc) L.push('   ' + b.desc.replace(/\n/g, '\n   '));
            if (b.bldId && bname(b.bldId)) L.push('   Место: ' + bname(b.bldId));
            const ch = dndBlockChars(g, b); if (ch.length) L.push('   Участвуют: ' + ch.map(c => c.name || 'Без имени').join(', '));
            (b.intro || []).filter(x => x.title || x.text).forEach(x => L.push('   • ' + (x.title || 'Вводная') + (x.text ? ': ' + x.text.replace(/\n/g, ' ') : '')));
            if (o.gm && b.gm) L.push('   Ведущему: ' + b.gm.replace(/\n/g, '\n   '));
            flow.inn.get(b.id).forEach(e => L.push('   ← из ' + flow.num.get(e.from) + (e.label ? ' (' + e.label + ')' : '')));
            flow.out.get(b.id).forEach(e => L.push('   → в ' + flow.num.get(e.to) + '. ' + ((flow.list.find(x => x.id === e.to) || {}).title || '') + (e.label ? ' [' + e.label + ']' : '')));
            L.push('');
        });
    }
    const city = dndCityGet(g), bs = city ? city.items.filter(i => i.t === 'b') : [];
    if (bs.length) {
        L.push(hr, 'ГОРОД: ЗДАНИЯ (' + bs.length + ')', hr);
        bs.forEach(b => { L.push('■ ' + (b.n || 'Здание') + ' — ' + bldKind(b.k).n + ' (' + b.w + '×' + b.h + ' клеток)'); if (b.note) L.push('   ' + b.note.replace(/\n/g, '\n   ')); const ls = dndCityBlocks(g, b.id); if (ls.length) L.push('   События: ' + ls.map(l => l.title || 'Без названия').join('; ')); });
        const ps = city.items.filter(i => i.t === 'p'); if (ps.length) L.push('Жетоны на карте: ' + ps.map(p => { const c = p.char && chars.find(x => x.id === p.char); return c ? c.name : p.n; }).filter(Boolean).join(', ')); L.push('');
    }
    const em = ((g.board && g.board.items) || []).concat((g.plot && g.plot.items) || []).filter(i => i.t === 'emoji');
    em.forEach(e => { L.push(hr, 'КАРТИНКА ИЗ ЭМОДЗИ' + (e.name ? ': ' + e.name : ''), hr, dndEmojiToText(e, '⬜'), ''); });
    return '﻿' + L.join('\n');
}

// ---------- Пакет для Miro ----------
const dndMiroNames = (() => { const names = Object.keys(MIRO_COLORS).filter(n => n !== 'white'); return names; })();
function dndMiroName(hex) {
    const rgb = h => { const n = parseInt(String(h).replace('#', ''), 16); return [n >> 16, (n >> 8) & 255, n & 255]; }; const a = rgb(hex || '#fff3a3'); let best = 'light_yellow', bd = 1e9;
    dndMiroNames.forEach(nm => { const b = rgb(MIRO_COLORS[nm]), d = (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2; if (d < bd) { bd = d; best = nm; } }); return best;
}
function dndMiroBuild(g, o) {
    const out = [], conns = [], chars = g.chars || [], city = dndCityGet(g);
    const card = (id, x, y, w, h, title, desc, color) => out.push({ id, type: 'card', data: { title: title || 'Без названия', description: desc || '' }, style: { cardTheme: color || '#757575' }, position: { x: Math.round(x + w / 2), y: Math.round(y + h / 2), origin: 'center' }, geometry: { width: Math.round(w), height: Math.round(h) } });
    const scene = dndSceneOf(g, 'board'), bb = dndSceneBox(scene) || { x: 0, y: 0, w: 0, h: 0 };
    let oy = 0;
    const doBoard = (prefix, items, offY) => {
        items.forEach(i => {
            const id = prefix + i.id, x = i.x, y = i.y + offY, w = i.w || 200, h = i.h || 120;
            if (i.t === 'sticky') out.push({ id, type: 'sticky_note', data: { content: i.text || '', shape: 'square' }, style: { fillColor: dndMiroName(i.c) }, position: { x: Math.round(x + w / 2), y: Math.round(y + h / 2), origin: 'center' }, geometry: { width: Math.round(w) } });
            else if (i.t === 'text') out.push({ id, type: 'text', data: { content: i.text || '' }, style: { fontSize: String(i.fs || 24) }, position: { x: Math.round(x + w / 2), y: Math.round(y + 20), origin: 'center' }, geometry: { width: Math.round(w) } });
            else if (i.t === 'shape') out.push({ id, type: 'shape', data: { shape: ({ rect: 'rectangle', round: 'round_rectangle', ellipse: 'circle', triangle: 'triangle', diamond: 'rhombus', hex: 'hexagon' })[i.shape] || 'rectangle', content: i.text || '' }, style: { fillColor: i.fill === 'none' ? '#ffffff' : (i.fill || '#ffffff'), borderColor: i.stroke || '#79747e', fillOpacity: i.fill === 'none' ? '0.0' : '1.0' }, position: { x: Math.round(x + w / 2), y: Math.round(y + h / 2), origin: 'center' }, geometry: { width: Math.round(w), height: Math.round(h) } });
            else if (i.t === 'frame') out.push({ id, type: 'frame', data: { title: i.title || 'Рамка' }, position: { x: Math.round(x + w / 2), y: Math.round(y + h / 2), origin: 'center' }, geometry: { width: Math.round(w), height: Math.round(h) } });
            else if (i.t === 'card') { const kd = bdKind(BD_CARD_KINDS, i.kind); card(id, x, y, Math.max(w, 240), Math.max(h, 150), i.title, '[' + kd.n + (i.secret ? ', секрет' : '') + '] ' + (i.text || '') + (i.tags && i.tags.length ? '\n' + i.tags.map(t => '#' + t).join(' ') : ''), i.c || kd.c); }
            else if (i.t === 'block') {
                const kd = bdKind(BD_PLOT_KINDS, i.kind), st = BD_PLOT_STATUS.find(s => s.k === (i.status || 'plan')), ch = dndBlockChars(g, i), intro = (i.intro || []).filter(v => v.title || v.text);
                const city2 = city && i.bldId ? city.items.find(b => b.id === i.bldId) : null;
                card(id, x, y, Math.max(w, 280), Math.max(h, 170), i.title, '[' + kd.n + ', ' + (st ? st.n : '') + '] ' + (i.text || '') + (i.desc ? '\n' + i.desc : '') + (ch.length ? '\nУчаствуют: ' + ch.map(c => c.name).join(', ') : '') + (city2 ? '\nМесто: ' + (city2.n || 'здание') : '') + intro.map(v => '\n• ' + (v.title || 'Вводная') + (v.text ? ': ' + v.text : '')).join('') + (o.gm && i.gm ? '\nВедущему: ' + i.gm : '') + (i.tags && i.tags.length ? '\n' + i.tags.map(t => '#' + t).join(' ') : ''), i.c || kd.c);
            }
            else if (i.t === 'emoji') { const txt = dndEmojiToText(i, '⬜'); const n = Math.max(i.cols, 1); out.push({ id, type: 'text', data: { content: txt.replace(/\n/g, '<br>') }, style: { fontSize: String(Math.max(10, Math.min(72, Math.round(w / n * 0.9)))) }, position: { x: Math.round(x + w / 2), y: Math.round(y + h / 2), origin: 'center' }, geometry: { width: Math.round(w * 1.05) } }); }
        });
        items.filter(i => i.t === 'conn' && i.from && i.to && i.from.id && i.to.id).forEach(c => conns.push({ id: prefix + c.id, type: 'connector', startItem: { id: prefix + c.from.id }, endItem: { id: prefix + c.to.id }, shape: c.style === 'straight' ? 'straight' : c.style === 'elbow' ? 'elbowed' : 'curved', style: { endStrokeCap: c.head === 'none' || c.head === 'start' ? 'none' : 'stealth', startStrokeCap: c.head === 'both' || c.head === 'start' ? 'stealth' : 'none', strokeColor: c.color || '#5f5b66', strokeStyle: c.dash ? 'dashed' : 'normal' }, captions: c.label ? [{ content: c.label }] : [] }));
    };
    if (o.board !== false) { doBoard('b_', ((g.board && g.board.items) || []).filter(i => ['sticky', 'text', 'shape', 'frame', 'card', 'emoji', 'conn'].includes(i.t)), 0); oy = bb.h ? bb.y + bb.h + 400 : 0; }
    if (o.plot !== false) {
        const pi = ((g.plot && g.plot.items) || []); const ps = dndSceneBox(dndSceneOf(g, 'plot')) || { x: 0, y: 0, w: 0, h: 0 };
        doBoard('p_', pi.filter(i => ['block', 'frame', 'sticky', 'text', 'conn', 'emoji', 'shape'].includes(i.t)), oy - ps.y); oy += ps.h + 400;
    }
    if (o.chars !== false && chars.length) {
        chars.forEach((c, n) => card('c_' + c.id, (n % 4) * 300, oy + Math.floor(n / 4) * 260, 280, 240, c.name || 'Без имени', [dcType(c.type).n, c.race, c.cls, c.role].filter(Boolean).join(' · ') + (c.look ? '\n' + c.look : '') + (c.traits ? '\nХарактер: ' + c.traits : '') + (c.goals ? '\nЦели: ' + c.goals : '') + (c.backstory ? '\n' + c.backstory : '') + (o.gm && c.secrets ? '\nТайны: ' + c.secrets : ''), '#7c4dff'));
        oy += Math.ceil(chars.length / 4) * 260 + 300;
    }
    if (o.city !== false && city) {
        city.items.filter(i => i.t === 'b').forEach((b, n) => card('z_' + b.id, (n % 4) * 300, oy + Math.floor(n / 4) * 200, 280, 180, b.n || 'Здание', bldKind(b.k).n + (b.note ? '\n' + b.note : '') + (dndCityBlocks(g, b.id).length ? '\nСобытия: ' + dndCityBlocks(g, b.id).map(l => l.title || 'Без названия').join('; ') : ''), b.c));
    }
    return { data: out.concat(conns), count: out.length, conns: conns.length };
}
const dndCsvCell = v => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
function dndMiroCsv(g, o) {
    const rows = [['Раздел', 'Вид', 'Название', 'Описание', 'Метки', 'Секрет', 'Состояние', 'Место', 'Герои', 'Ведущему']], city = dndCityGet(g);
    ((g.board && g.board.items) || []).forEach(i => { if (i.t === 'card') rows.push(['Карточки', bdKind(BD_CARD_KINDS, i.kind).n, i.title, i.text, (i.tags || []).join(' '), i.secret ? 'да' : '', '', '', '', '']); else if ((i.t === 'sticky' || i.t === 'text') && (i.text || '').trim()) rows.push(['Карточки', i.t === 'sticky' ? 'Стикер' : 'Надпись', (i.text || '').split('\n')[0], i.text, '', '', '', '', '', '']); });
    dndPlotFlow(g).list.forEach(b => rows.push(['Сюжет', bdKind(BD_PLOT_KINDS, b.kind).n, b.title, [b.text, b.desc].filter(Boolean).join('\n') + (b.intro || []).filter(x => x.title || x.text).map(x => '\n• ' + (x.title || '') + (x.text ? ': ' + x.text : '')).join(''), (b.tags || []).join(' '), '', (BD_PLOT_STATUS.find(s => s.k === (b.status || 'plan')) || {}).n || '', b.bldId && city ? ((city.items.find(x => x.id === b.bldId) || {}).n || '') : '', dndBlockChars(g, b).map(c => c.name).join(', '), o.gm ? b.gm : '']));
    (g.chars || []).forEach(c => rows.push(['Персонажи', dcType(c.type).n, c.name, [c.race, c.cls, c.role, c.look, c.backstory].filter(Boolean).join('\n'), '', '', '', '', '', o.gm ? c.secrets : '']));
    if (city) city.items.filter(i => i.t === 'b').forEach(b => rows.push(['Город', bldKind(b.k).n, b.n, b.note, '', '', '', '', '', '']));
    return '﻿' + rows.map(r => r.map(dndCsvCell).join(';')).join('\r\n');
}
async function dndMiroPack(g, o, progress) {
    const files = []; const enc = s => new TextEncoder().encode(s);
    if (progress) progress(0.05);
    const mj = dndMiroBuild(g, o);
    files.push({ name: 'miro_board.json', data: JSON.stringify({ data: mj.data, total: mj.data.length }, null, 1) });
    files.push({ name: 'miro_cards.csv', data: dndMiroCsv(g, o) });
    const stick = []; ((g.board && g.board.items) || []).forEach(i => { if (i.t === 'card') stick.push((i.title || 'Без названия') + (i.text ? ' — ' + i.text.replace(/\s+/g, ' ').slice(0, 160) : '')); });
    dndPlotFlow(g).list.forEach(b => stick.push((b.title || 'Без названия') + (b.text ? ' — ' + b.text.replace(/\s+/g, ' ').slice(0, 160) : ''))); (g.chars || []).forEach(c => stick.push((c.name || 'Без имени') + (c.role ? ' — ' + c.role : '')));
    files.push({ name: 'miro_stickers.txt', data: '﻿' + stick.join('\r\n') });
    files.push({ name: 'igra.txt', data: dndTextExport(g, o) });
    // файл игры iLife (чтобы можно было восстановить всё обратно)
    const refs = dndMediaRefs([g]), media = []; for (const id of refs) { const rec = await BlobDB.get(id); if (rec && rec.blob) media.push({ id, name: rec.name, type: rec.type, data: await blobToBase64(rec.blob) }); }
    files.push({ name: 'ilife_igra.json', data: JSON.stringify({ app: 'iLife-dnd', format: 1, version: APP_VERSION, exportedAt: new Date().toISOString(), games: [g], media }) });
    if (progress) progress(0.4);
    for (const kind of ['board', 'plot', 'city']) {
        if (kind === 'board' && o.board === false || kind === 'plot' && o.plot === false || kind === 'city' && o.city === false) continue;
        const src = await dndSource(g, kind); if (!src) continue;
        const k = src.kind === 'city' ? Math.min(40, Math.max(16, Math.floor(3600 / Math.max(src.w, src.h)))) : Math.min(2, 3600 / Math.max(src.w, src.h));
        const cv = dndRenderRegion(src, src.x, src.y, src.x + src.w, src.y + src.h, k), blob = await new Promise(r => cv.toBlob(r, 'image/png'));
        files.push({ name: ({ board: 'kartochki_i_zametki', plot: 'syuzhet', city: 'gorod' })[kind] + '.png', data: new Uint8Array(await blob.arrayBuffer()) });
        if (progress) progress(kind === 'board' ? 0.6 : kind === 'plot' ? 0.8 : 0.95);
    }
    files.unshift({ name: 'ПРОЧТИ_МЕНЯ.txt', data: '﻿' + [
        'Пакет для Miro — игра «' + g.title + '» (iLife ' + APP_VERSION + ')', '',
        'Miro не умеет открывать целую доску из чужого файла, поэтому в пакете несколько способов — выбирайте удобный:', '',
        '1. КАРТИНКА. Перетащите файлы kartochki_i_zametki.png, syuzhet.png, gorod.png прямо на доску Miro — получите всё как есть, одним изображением.', '',
        '2. СТИКЕРЫ. Откройте miro_cards.csv в Excel или Google Таблицах, выделите столбец «Название», скопируйте и вставьте на доску Miro (Ctrl+V): каждая ячейка станет стикером.',
        '   Либо откройте miro_stickers.txt, скопируйте нужные строки и вставляйте по одной.', '',
        '3. КАРТОЧКИ ИЗ ТАБЛИЦЫ. В Miro есть приложения для импорта таблиц (CSV / Excel) в карточки — добавьте такое из «Apps» и загрузите miro_cards.csv: в нём название, описание, метки, состояние, место и герои.', '',
        '4. ДЛЯ ПРОГРАММИСТОВ. miro_board.json — предметы и стрелки в том виде, как их отдаёт и принимает Miro REST API (карточки, стикеры, фигуры, рамки, текст, соединители). iLife умеет открывать такой файл обратно.', '',
        '5. ВОССТАНОВИТЬ В iLife. ilife_igra.json — полный файл игры (карточки, сюжет, герои, город, картинки). В iLife: ДНД → Игры → Импорт.', '',
        'igra.txt — вся игра обычным текстом.', '', o.gm ? 'В пакет включены секретные заметки, заметки ведущего и тайны героев — не отдавайте его игрокам.' : 'Секретные заметки, заметки ведущего и тайны героев в пакет НЕ включены.'
    ].join('\r\n') });
    return dndZip(files);
}

// ---------- Окно «Экспорт» ----------
function dndExportSheet(g, mode) {
    if (!g) { toast('Сначала выберите игру'); return; }
    let src = mode === 'city' || mode === 'plot' ? mode : 'board';
    const opt = { paper: LS.get('dnd_exp_paper', 'a4'), orient: 'auto', across: LS.get('dnd_exp_across', 3), overlap: 10, marks: true, gm: false, details: true };
    const sh = openSheet({
        title: 'Вывод игры «' + g.title + '»',
        html: '<div class="ex">' +
            '<section class="ex-s"><h4>' + ic('upload') + 'Для Miro</h4><p class="hint">ZIP-пакет: картинки доски, сюжета и города, таблица карточек (CSV), файл с предметами и стрелками (JSON), текст и полный файл игры.</p>' +
            '<div class="chips" id="ex-miro-what"><button type="button" class="chip is-on" data-w="board">Карточки и Заметки</button><button type="button" class="chip is-on" data-w="plot">Сюжет</button><button type="button" class="chip is-on" data-w="chars">Герои</button><button type="button" class="chip is-on" data-w="city">Город</button></div>' +
            '<button type="button" class="btn btn-primary btn-wide" id="ex-miro">' + ic('download') + 'Собрать пакет для Miro</button></section>' +
            '<section class="ex-s"><h4>' + ic('picture_as_pdf') + 'PDF: склеить большую карту</h4><p class="hint">Карта режется на листы по краям с метками и схемой — распечатайте и склейте.</p>' +
            '<span class="field-label">Что печатать</span><div class="seg" id="ex-src">' + ['board', 'plot', 'city'].map(k => '<button type="button" data-v="' + k + '" class="' + (k === src ? 'is-on' : '') + '"><span>' + DND_SRC_NAMES[k] + '</span></button>').join('') + '</div>' +
            '<div class="em-steps" style="margin-top:0.5rem"><div><span class="field-label">Бумага</span><select id="ex-paper">' + Object.keys(DND_PAPER).map(k => '<option value="' + k + '"' + (k === opt.paper ? ' selected' : '') + '>' + DND_PAPER[k][0] + '</option>').join('') + '</select></div>' +
            '<div><span class="field-label">Положение</span><select id="ex-orient"><option value="auto">Подобрать само</option><option value="land">Альбомное</option><option value="port">Книжное</option></select></div></div>' +
            '<div class="em-steps"><div><span class="field-label">Листов по ширине</span><div class="em-num"><button type="button" class="icon-btn" data-ac="-">−</button><b id="ex-ac">' + opt.across + '</b><button type="button" class="icon-btn" data-ac="+">+</button></div></div>' +
            '<div><span class="field-label">Нахлёст для склейки</span><select id="ex-ov"><option value="0">Нет, встык</option><option value="5">5 мм</option><option value="10" selected>10 мм</option><option value="15">15 мм</option></select></div></div>' +
            '<div class="switch-row"><div class="tx"><b>Метки и номера листов</b><span class="sub">Угловые метки реза, буква и цифра на каждом листе</span></div><input type="checkbox" class="switch" id="ex-marks" aria-label="Метки" checked></div>' +
            '<p class="ex-plan" id="ex-plan"></p><button type="button" class="btn btn-primary btn-wide" id="ex-map">' + ic('picture_as_pdf') + 'Создать PDF для склейки</button></section>' +
            '<section class="ex-s"><h4>' + ic('account_tree') + 'PDF: список всех событий</h4><p class="hint">Блоки сюжета по порядку, у каждого «откуда» и «дальше» со стрелками.</p>' +
            '<div class="switch-row"><div class="tx"><b>Подробности и вводные</b></div><input type="checkbox" class="switch" id="ex-det" aria-label="Подробности" checked></div>' +
            '<button type="button" class="btn btn-primary btn-wide" id="ex-ev">' + ic('picture_as_pdf') + 'Создать список событий</button></section>' +
            '<section class="ex-s"><h4>' + ic('description') + 'Текст и картинки</h4><div class="btn-group"><button type="button" class="btn" id="ex-txt">' + ic('description') + 'Текст (.txt)</button><button type="button" class="btn" id="ex-copy">' + ic('content_copy') + 'Скопировать текст</button></div>' +
            '<div class="btn-group" style="margin-top:0.5rem"><button type="button" class="btn" data-png="board">' + ic('image') + 'PNG доски</button><button type="button" class="btn" data-png="plot">' + ic('image') + 'PNG сюжета</button><button type="button" class="btn" data-png="city">' + ic('image') + 'PNG города</button></div></section>' +
            '<section class="ex-s"><div class="switch-row"><div class="tx"><b>Включать скрытое для ведущего</b><span class="sub">Заметки ведущего, тайны героев и карточки-«секреты». Выключите, если файл пойдёт игрокам</span></div><input type="checkbox" class="switch" id="ex-gm" aria-label="Скрытое для ведущего"></div></section>' +
            '<div class="em-prog" id="ex-prog" hidden><i></i></div></div>',
        actions: [{ label: 'Закрыть', value: false }],
        onOpen: api => {
            hydrateIcons(api.body); const b = api.body, q = s => b.querySelector(s), prog = q('#ex-prog');
            let busy = false, miroWhat = { board: true, plot: true, chars: true, city: true };
            const setProg = p => { prog.hidden = p == null; if (p != null) prog.firstChild.style.width = Math.round(p * 100) + '%'; };
            const run = async (btn, fn, err) => { if (busy) { toast('Подождите, предыдущий файл ещё готовится'); return; } busy = true; if (btn) btn.disabled = true; setProg(0.02); try { await fn(); } catch (e) { console.error(e); toast(e && e.message === 'empty' ? 'Здесь пока нечего выводить' : err || 'Не удалось подготовить файл'); } finally { busy = false; if (btn) btn.disabled = false; setProg(null); } };
            const plan = async () => {
                const s = await dndSource(dndGameView(g, opt.gm), src).catch(() => null), el = q('#ex-plan');
                if (!s) { el.textContent = 'Здесь пока нечего печатать.'; return; }
                opt.paper = q('#ex-paper').value; opt.orient = q('#ex-orient').value; opt.overlap = +q('#ex-ov').value; const p = dndMapPlan(s, opt);
                el.textContent = 'Выйдет ' + p.pages + ' ' + (p.pages % 10 === 1 && p.pages !== 11 ? 'лист' : p.pages % 10 >= 2 && p.pages % 10 <= 4 && (p.pages < 10 || p.pages > 20) ? 'листа' : 'листов') + ' (' + p.n + ' × ' + p.rows + '), ' + (p.land ? 'альбомные' : 'книжные') + ' · карта примерно ' + Math.round(p.mapW / 10 * 10) / 10 + ' × ' + Math.round(p.mapH / 10 * 10) / 10 + ' см' + (s.kind === 'city' ? ' · клетка ' + Math.round(p.s * 10) / 10 + ' мм' : '') + '.' + (p.pages > 40 ? ' Это много листов — уменьшите число листов по ширине.' : '');
            };
            plan();
            q('#ex-src').addEventListener('click', e => { const x = e.target.closest('[data-v]'); if (!x) return; src = x.dataset.v; b.querySelectorAll('#ex-src button').forEach(y => y.classList.toggle('is-on', y === x)); plan(); });
            ['#ex-paper', '#ex-orient', '#ex-ov'].forEach(s => q(s).addEventListener('change', () => { LS.set('dnd_exp_paper', q('#ex-paper').value); plan(); }));
            b.addEventListener('click', e => { const a = e.target.closest('[data-ac]'); if (a) { opt.across = Math.max(1, Math.min(10, opt.across + (a.dataset.ac === '+' ? 1 : -1))); q('#ex-ac').textContent = opt.across; LS.set('dnd_exp_across', opt.across); plan(); } });
            q('#ex-marks').addEventListener('change', e => { opt.marks = e.target.checked; });
            q('#ex-gm').addEventListener('change', e => { opt.gm = e.target.checked; plan(); });
            q('#ex-det').addEventListener('change', e => { opt.details = e.target.checked; });
            q('#ex-miro-what').addEventListener('click', e => { const c = e.target.closest('[data-w]'); if (!c) return; miroWhat[c.dataset.w] = !miroWhat[c.dataset.w]; c.classList.toggle('is-on', miroWhat[c.dataset.w]); });
            q('#ex-miro').addEventListener('click', ev => run(ev.currentTarget, async () => { const z = await dndMiroPack(dndGameView(g, opt.gm), Object.assign({ gm: opt.gm }, miroWhat), setProg); await dndDeliver(z, stampName('ДНД_Miro_' + dndSlug(g.title), 'zip'), 'Пакет'); }, 'Не удалось собрать пакет'));
            q('#ex-map').addEventListener('click', ev => run(ev.currentTarget, async () => { const r = await dndMapPdf(dndGameView(g, opt.gm), Object.assign({ src }, opt), setProg); await dndDeliver(r.blob, stampName('ДНД_карта_' + ({ board: 'доска', plot: 'сюжет', city: 'город' })[src] + '_' + dndSlug(g.title), 'pdf'), 'PDF'); }, 'Не удалось создать PDF'));
            q('#ex-ev').addEventListener('click', ev => run(ev.currentTarget, async () => { const bl = await dndEventsPdf(dndGameView(g, opt.gm), { gm: opt.gm, details: opt.details }); await dndDeliver(bl, stampName('ДНД_события_' + dndSlug(g.title), 'pdf'), 'PDF'); }, 'Не удалось создать PDF'));
            q('#ex-txt').addEventListener('click', ev => run(ev.currentTarget, async () => { await dndDeliver(new Blob([dndTextExport(dndGameView(g, opt.gm), { gm: opt.gm })], { type: 'text/plain;charset=utf-8' }), stampName('ДНД_текст_' + dndSlug(g.title), 'txt'), 'Текст'); }));
            q('#ex-copy').addEventListener('click', async () => { const ok = await copyText(dndTextExport(dndGameView(g, opt.gm), { gm: opt.gm }).replace(/^﻿/, '')); toast(ok ? 'Текст скопирован' : 'Не удалось скопировать — сохраните файлом'); });
            b.querySelectorAll('[data-png]').forEach(x => x.addEventListener('click', () => run(x, () => dndSavePng(dndGameView(g, opt.gm), x.dataset.png))));
        }
    });
    return sh;
}
