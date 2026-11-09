'use strict';
// =====================================================================================================
// iLife 2.1.0 — «ДНД»: КАРТИНКИ ИЗ ЭМОДЗИ (ядро). Окна — в js/dnd-emoji-ui.js.
//   Предмет доски t:'emoji': { cols, rows, em[], c[], pal[], b[], rev, name }
//     em[]  — список разных эмодзи в картинке, em[0] всегда '' (пустая клетка);
//     c[i]  — какое эмодзи (индекс в em) стоит в клетке i (строки подряд, слева направо); 0 — пусто;
//     pal[] — цвета фона клеток, pal[0] всегда '' (без фона); b[i] — индекс цвета фона клетки i;
//     rev   — номер правки (по нему обновляется нарисованная картинка).
//   Здесь же: рисование сетки, текст ↔ сетка, и распознавание картинки: на скриншоте из Miro находится
//   сетка клеток, а каждая клетка сравнивается с эмодзи вашего устройства (по маленькому «отпечатку» цвета).
// =====================================================================================================

const DND_EMOJI_FONT = '"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji","Twemoji Mozilla","EmojiOne Color",sans-serif';

// Наборы для выбора и для распознавания
const DND_EMOJI_CATS = [
    { k: 'face', n: 'Лица', e: '😀', s: '😀😃😄😁😆😅😂🤣😊😇🙂🙃😉😌😍🥰😘😗😙😚😋😛😝😜🤪🤨🧐🤓😎🥳😏😒😞😔😟😕🙁😣😖😫😩🥺😢😭😤😠😡🤬🤯😳🥵🥶😱😨😰😥😓🤗🤔🤭🤫🤥😶😐😑😬🙄😯😦😧😮😲🥱😴🤤😪😵🤐🥴🤢🤮🤧😷🤒🤕🤑🤠😈👿👹👺🤡💩👻💀👽👾🤖🎃😺😸😹😻😼😽🙀😿😾' },
    { k: 'heart', n: 'Сердца и огонь', e: '❤️', s: '❤️🧡💛💚💙💜🖤🤍🤎💔💕💞💓💗💖💘💝⭐🌟✨⚡🔥💥💫💦💧🌈☀️⛅☁️🌧️⛈️❄️⛄💨🌙🌕🌑🌍🪐' },
    { k: 'hand', n: 'Люди и жесты', e: '👍', s: '👍👎👌✌️🤞🤟🤘🤙👈👉👆👇☝️✋🤚🖐️🖖👋🤏💪🦾👂👃👀👅👄🧠🦷🦴👶🧒👦👧🧑👨👩🧓👴👵🧔👸🤴🎅🧙🧚🧛🧜🧝🧞🧟🥷🦸🦹👮💂👷👼🙏' },
    { k: 'animal', n: 'Животные', e: '🐱', s: '🐶🐱🐭🐹🐰🦊🐻🐼🐨🐯🦁🐮🐷🐸🐵🙈🙉🙊🐒🐔🐧🐦🐤🦆🦅🦉🦇🐺🐗🐴🦄🐝🐛🦋🐌🐞🐜🦗🕷️🕸️🦂🐢🐍🦎🦖🦕🐙🦑🦐🦞🦀🐡🐠🐟🐬🐳🐋🦈🐊🐅🐆🦓🦍🐘🦏🐪🦒🐃🐂🐄🐎🐖🐑🐐🦌🐕🐩🐈🦃🦚🦜🦢🦩🕊️🐇🦝🦔🐁🐀🐉🐲' },
    { k: 'nature', n: 'Природа', e: '🌳', s: '🌵🎄🌲🌳🌴🌱🌿☘️🍀🎍🍃🍂🍁🍄🐚🪨🌾💐🌷🌹🥀🌺🌸🌼🌻🌋⛰️🏔️🗻🏝️🏜️🌊' },
    { k: 'food', n: 'Еда', e: '🍎', s: '🍏🍎🍐🍊🍋🍌🍉🍇🍓🍈🍒🍑🥭🍍🥥🥝🍅🍆🥑🥦🥒🌶️🌽🥕🧄🧅🥔🍠🥐🍞🥖🥨🧀🥚🍳🥞🥓🥩🍗🍖🌭🍔🍟🍕🥪🌮🌯🥗🍝🍜🍲🍛🍣🍱🥟🍤🍙🍚🍥🍡🍧🍨🍦🥧🧁🍰🎂🍮🍭🍬🍫🍿🍩🍪🌰🥜🍯🥛🍼☕🍵🍶🍺🍻🥂🍷🥃🍸🍹🍾' },
    { k: 'dnd', n: 'Игра и приключения', e: '⚔️', s: '⚔️🛡️🏹🗡️🔱🪓🔨⛏️🔧⚒️🛠️🔮📜📖📚📕🗝️🔑🔒🔓💰🪙💎💍👑🎩🎒🧪⚗️🕯️💡🔦🏮🧭⏳⌛⏰🎲♟️🎭🎨🎵🎶🎷🎸🎺🎻🥁🏆🥇🥈🥉🎖️🏅🎁🎈🎉🧸💣🧨⛓️⚙️🔗📌📍🗺️🧿🛏️🚪🪑🏺⚱️🪦⚰️🔔🧲💊🩸' },
    { k: 'place', n: 'Места и транспорт', e: '🏰', s: '🏰🏯🏠🏡🏘️🏚️🏗️🏭🏢🏬🏣🏤🏥🏦🏨🏪🏫🏩💒🏛️⛪🕌🕍⛩️🗼🗽⛲⛺🌃🏙️🌄🌅🌆🌇🌉🎡🎢🎪🚂🚃🚄🚗🚕🚙🚌🚎🚓🚑🚒🚚🚜🛵🚲🚁✈️🚀🛸⛵🚤🛳️⚓🛶' },
    { k: 'color', n: 'Цвета и фигуры', e: '🟥', s: '🟥🟧🟨🟩🟦🟪🟫⬛⬜🔴🟠🟡🟢🔵🟣⚫⚪🟤🔶🔷🔸🔹🔺🔻◼️◻️▪️▫️⬆️⬇️⬅️➡️↗️↘️↙️↖️✅❌❓❗⭕🚫⛔💯➕➖✖️✔️⚠️🏁🚩🏴🏳️' }
];
// Для мозаики из обычной картинки: чем дробнее цвета, тем точнее
const DND_EMOJI_MOSAIC = {
    sq: '🟥🟧🟨🟩🟦🟪🟫⬛⬜',
    ci: '🔴🟠🟡🟢🔵🟣🟤⚫⚪',
    he: '❤️🧡💛💚💙💜🤎🖤🤍',
    fx: '🍎🍊🍋🍏🫐🍇🍓🍑🥥🌽🥕🍅🍆🥝🌸🌻🍄🌲🌊🪨🐸🐝'
};

// ---------- Эмодзи → буквы (графемы) ----------
function dndGraphemes(str) {
    str = String(str || '');
    try { if (typeof Intl !== 'undefined' && Intl.Segmenter) return Array.from(new Intl.Segmenter('ru', { granularity: 'grapheme' }).segment(str), s => s.segment); } catch (e) { /* ниже */ }
    try { return str.match(/(?:\p{Regional_Indicator}{2}|[0-9#*]️?⃣|\p{Extended_Pictographic}(?:️|\p{Emoji_Modifier})?(?:‍\p{Extended_Pictographic}(?:️|\p{Emoji_Modifier})?)*|[\s\S])/gu) || []; } catch (e) { return Array.from(str); }
}
function dndIsEmojiG(g) { try { return /\p{Extended_Pictographic}|\p{Regional_Indicator}|⃣/u.test(g); } catch (e) { return g.length > 1 || g.charCodeAt(0) > 0x2000; } }

// Все эмодзи наборов без повторов (кандидаты для распознавания)
let dndEmojiAllCache = null;
function dndEmojiAll() {
    if (!dndEmojiAllCache) { const seen = new Set(), out = []; DND_EMOJI_CATS.forEach(c => dndGraphemes(c.s).forEach(g => { if (!seen.has(g)) { seen.add(g); out.push(g); } })); dndEmojiAllCache = out; }
    return dndEmojiAllCache;
}

// ---------- Данные ----------
function dndEmojiNorm(it) {
    it.cols = Math.max(1, Math.min(200, it.cols | 0 || 1)); it.rows = Math.max(1, Math.min(200, it.rows | 0 || 1));
    const n = it.cols * it.rows;
    if (!Array.isArray(it.em) || !it.em.length) it.em = ['']; it.em[0] = '';
    if (!Array.isArray(it.pal) || !it.pal.length) it.pal = ['']; it.pal[0] = '';
    if (!Array.isArray(it.c)) it.c = []; if (!Array.isArray(it.b)) it.b = [];
    while (it.c.length < n) it.c.push(0); if (it.c.length > n) it.c.length = n;
    while (it.b.length < n) it.b.push(0); if (it.b.length > n) it.b.length = n;
    if (!it.rev) it.rev = 1;
    return it;
}
function dndEmojiIndex(it, ch) { let i = it.em.indexOf(ch); if (i < 0) { it.em.push(ch); i = it.em.length - 1; } return i; }
function dndEmojiPalIndex(it, col) { col = String(col || '').toLowerCase(); if (!col) return 0; let i = it.pal.indexOf(col); if (i < 0) { it.pal.push(col); i = it.pal.length - 1; } return i; }
// Убирает из списков то, чем никто не пользуется
function dndEmojiTidy(it) {
    const useE = new Set(it.c), useP = new Set(it.b), em = [''], pal = [''], mE = new Map([[0, 0]]), mP = new Map([[0, 0]]);
    it.em.forEach((e, i) => { if (i && useE.has(i)) { mE.set(i, em.length); em.push(e); } });
    it.pal.forEach((p, i) => { if (i && useP.has(i)) { mP.set(i, pal.length); pal.push(p); } });
    it.c = it.c.map(v => mE.get(v) || 0); it.b = it.b.map(v => mP.get(v) || 0); it.em = em; it.pal = pal;
}
function dndEmojiNew(cols, rows) { return dndEmojiNorm({ t: 'emoji', cols, rows, em: [''], c: [], pal: [''], b: [], rev: 1 }); }
function dndEmojiCopy(it) { return { cols: it.cols, rows: it.rows, em: it.em.slice(), c: it.c.slice(), pal: it.pal.slice(), b: it.b.slice() }; }

// ---------- Рисование ----------
// Размер значка в клетке подбирается по шрифту устройства так, чтобы эмодзи занимало почти всю клетку
let dndEmojiK = 0;
function dndEmojiScale() {
    if (dndEmojiK) return dndEmojiK;
    try { const c = document.createElement('canvas').getContext('2d'); c.font = '100px ' + DND_EMOJI_FONT; const w = c.measureText('🟥').width / 100; dndEmojiK = w > 0.4 && w < 3 ? Math.min(1, 0.96 / w) : 0.8; } catch (e) { dndEmojiK = 0.8; }
    return dndEmojiK;
}
function dndEmojiCell(ctx, d, i, px, ox, oy, k) {
    const x = ox + (i % d.cols) * px, y = oy + Math.floor(i / d.cols) * px;
    if (d.b[i] && d.pal[d.b[i]]) { ctx.fillStyle = d.pal[d.b[i]]; ctx.fillRect(x, y, px + 0.6, px + 0.6); }
    const e = d.c[i] ? d.em[d.c[i]] : '';
    if (e) ctx.fillText(e, x + px / 2, y + px / 2 + px * 0.05);
}
function dndEmojiPaint(ctx, d, px, ox, oy, scale) {
    ctx.save(); ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.font = Math.max(4, Math.round(px * dndEmojiScale() * (scale || 1))) + 'px ' + DND_EMOJI_FONT;
    const n = d.cols * d.rows; for (let i = 0; i < n; i++) dndEmojiCell(ctx, d, i, px, ox || 0, oy || 0);
    ctx.restore();
}
// Один раз рисуем в большой холст, браузер потом сам масштабирует — движение и изменение размера на доске не тормозят
const dndEmojiCache = new WeakMap();
function dndEmojiPx(d) { return Math.max(10, Math.min(48, Math.floor(1800 / Math.max(d.cols, d.rows)))); }
function dndEmojiCanvas(it) {
    dndEmojiNorm(it);
    const key = it.rev + '|' + it.cols + '|' + it.rows; let e = dndEmojiCache.get(it);
    if (!e || e.key !== key) {
        const px = dndEmojiPx(it), cv = document.createElement('canvas'); cv.width = it.cols * px; cv.height = it.rows * px; cv.className = 'be-cv';
        dndEmojiPaint(cv.getContext('2d'), it, px, 0, 0); e = { key, cv }; dndEmojiCache.set(it, e);
    }
    return e.cv;
}
function dndEmojiDrop(it) { dndEmojiCache.delete(it); }

// ---------- Текст ↔ сетка ----------
// Строки эмодзи (как в тексте Miro) → данные. Пробел и «широкий пробел» — пустая клетка. null — если это не похоже на картинку из эмодзи.
function dndEmojiFromText(text) {
    text = String(text || '').replace(/\r/g, '').replace(/\s+$/g, '');
    if (!text) return null;
    let lines = text.split('\n');
    const spaced = lines.every(l => { const w = l.trim().split(/\s+/); return w.length > 1 && w.every(x => dndGraphemes(x).length === 1); });   // «🟥 🟥 🟥»: пробелы между значками — просто разделители
    lines = lines.map(l => spaced ? l.trim().split(/\s+/) : dndGraphemes(l));
    let emo = 0, other = 0;
    lines.forEach(l => l.forEach(g => { if (g === ' ' || g === '　' || g === '\t') return; if (dndIsEmojiG(g)) emo++; else other++; }));
    if (emo < 6 || other > emo * 0.2) return null;
    if (lines.length < 2 && emo < 10) return null;
    const cols = Math.max(...lines.map(l => l.length)), rows = lines.length;
    if (cols > 200 || rows > 200) return null;
    const it = dndEmojiNew(cols, rows);
    lines.forEach((l, y) => l.forEach((g, x) => { if (g && g !== ' ' && g !== '　' && g !== '\t') it.c[y * cols + x] = dndEmojiIndex(it, g); }));
    return it;
}
function dndEmojiToText(it, blank) {
    dndEmojiNorm(it); const out = [];
    for (let y = 0; y < it.rows; y++) { let s = ''; for (let x = 0; x < it.cols; x++) { const v = it.c[y * it.cols + x]; s += v ? it.em[v] : (blank == null ? '　' : blank); } out.push(s.replace(/　+$/, '')); }
    return out.join('\n');
}

// ---------- Картинка → сетка ----------
// Загрузка: рисуем в холст не крупнее 1800 пикселей по большой стороне
async function dndEmojiLoad(blob) {
    const bmp = await decodeImage(blob instanceof File ? blob : new File([blob], 'x', { type: blob.type || 'image/png' }));
    const sz = bitmapSize(bmp), k = Math.min(1, 1800 / Math.max(sz.w, sz.h)), w = Math.max(1, Math.round(sz.w * k)), h = Math.max(1, Math.round(sz.h * k));
    const cv = document.createElement('canvas'); cv.width = w; cv.height = h; const ctx = cv.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(bmp, 0, 0, w, h); if (bmp.close) try { bmp.close(); } catch (e) {}
    const data = ctx.getImageData(0, 0, w, h);
    const an = { cv, w, h, data, bg: dndEmojiBg(data, w, h) };
    an.box = dndEmojiBox(an); const g = dndEmojiGuess(an); an.cols = g.cols; an.rows = g.rows; an.conf = g.conf;
    return an;
}
// Фон — самый частый цвет по краю картинки
function dndEmojiBg(img, w, h) {
    const d = img.data, bins = new Map(); const take = (x, y) => { const p = (y * w + x) * 4; const k = (d[p] >> 4) << 8 | (d[p + 1] >> 4) << 4 | (d[p + 2] >> 4); const e = bins.get(k) || { n: 0, r: 0, g: 0, b: 0 }; e.n++; e.r += d[p]; e.g += d[p + 1]; e.b += d[p + 2]; bins.set(k, e); };
    for (let x = 0; x < w; x += 2) { take(x, 0); take(x, h - 1); } for (let y = 0; y < h; y += 2) { take(0, y); take(w - 1, y); }
    let best = null; bins.forEach(e => { if (!best || e.n > best.n) best = e; });
    return best ? [Math.round(best.r / best.n), Math.round(best.g / best.n), Math.round(best.b / best.n)] : [255, 255, 255];
}
// Рамка, где лежит рисунок (всё, что отличается от фона)
function dndEmojiBox(an) {
    const { w, h, data, bg } = an, d = data.data, colN = new Int32Array(w), rowN = new Int32Array(h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const p = (y * w + x) * 4; if (Math.abs(d[p] - bg[0]) + Math.abs(d[p + 1] - bg[1]) + Math.abs(d[p + 2] - bg[2]) > 54) { colN[x]++; rowN[y]++; } }
    const tx = Math.max(2, Math.round(h * 0.004)), ty = Math.max(2, Math.round(w * 0.004));
    let x0 = 0, x1 = w - 1, y0 = 0, y1 = h - 1; while (x0 < w - 1 && colN[x0] < tx) x0++; while (x1 > x0 && colN[x1] < tx) x1--; while (y0 < h - 1 && rowN[y0] < ty) y0++; while (y1 > y0 && rowN[y1] < ty) y1--;
    if (x1 - x0 < 8 || y1 - y0 < 8) return { x: 0, y: 0, w, h };
    return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}
// Шаг сетки: рёбра рисунка повторяются через размер клетки — ищем это повторение
function dndEmojiPitch(prof, minL, maxL) {
    const n = prof.length; let mean = 0; for (let i = 0; i < n; i++) mean += prof[i]; mean /= n;
    const p = Float64Array.from(prof, v => v - mean); let e0 = 0; for (let i = 0; i < n; i++) e0 += p[i] * p[i]; if (!e0) return { L: 0, r: 0 };
    const R = []; for (let L = minL; L <= maxL; L++) { let s = 0; for (let i = 0; i + L < n; i++) s += p[i] * p[i + L]; R[L] = s / e0 * n / Math.max(1, n - L); }
    let mx = -1; for (let L = minL; L <= maxL; L++) if (R[L] > mx) mx = R[L];
    if (mx < 0.05) return { L: 0, r: mx };
    for (let L = minL + 1; L < maxL; L++) if (R[L] >= mx * 0.8 && R[L] >= R[L - 1] && R[L] >= R[L + 1]) return { L, r: R[L] };
    return { L: 0, r: mx };
}
function dndEmojiGuess(an) {
    const { box, data, w } = an, d = data.data, gray = (x, y) => { const p = (y * w + x) * 4; return d[p] * 0.3 + d[p + 1] * 0.59 + d[p + 2] * 0.11; };
    const ex = new Float64Array(box.w - 1), ey = new Float64Array(box.h - 1), st = Math.max(1, Math.floor(Math.min(box.w, box.h) / 300));
    for (let y = box.y; y < box.y + box.h; y += st) for (let x = box.x + 1; x < box.x + box.w; x++) ex[x - box.x - 1] += Math.abs(gray(x, y) - gray(x - 1, y));
    for (let x = box.x; x < box.x + box.w; x += st) for (let y = box.y + 1; y < box.y + box.h; y++) ey[y - box.y - 1] += Math.abs(gray(x, y) - gray(x, y - 1));
    const minL = Math.max(6, Math.round(Math.min(box.w, box.h) / 150)), px = dndEmojiPitch(ex, minL, Math.max(minL + 2, Math.floor(box.w / 3))), py = dndEmojiPitch(ey, minL, Math.max(minL + 2, Math.floor(box.h / 3)));
    let L = 0, r = 0;
    if (px.L && py.L && Math.abs(px.L - py.L) / Math.max(px.L, py.L) < 0.15) { L = (px.L + py.L) / 2; r = Math.min(px.r, py.r); }
    else if (px.L || py.L) { const q = px.r >= py.r ? px : py; L = q.L; r = q.r * 0.6; }
    if (!L) { const cols = 20; return { cols, rows: Math.max(1, Math.round(box.h / (box.w / cols))), conf: 0 }; }
    return { cols: Math.max(1, Math.round(box.w / L)), rows: Math.max(1, Math.round(box.h / L)), conf: r };
}

// Средний цвет каждого квадрата N×N внутри каждой клетки. Возвращает Float32Array [клетка][N*N*3]
function dndEmojiSample(img, w, box, cols, rows, N) {
    const d = img.data, out = new Float32Array(cols * rows * N * N * 3), cw = box.w / cols, ch = box.h / rows;
    for (let cy = 0; cy < rows; cy++) for (let cx = 0; cx < cols; cx++) {
        const base = (cy * cols + cx) * N * N * 3;
        for (let j = 0; j < N; j++) {
            const ya = Math.floor(box.y + cy * ch + j * ch / N), yb = Math.max(ya + 1, Math.floor(box.y + cy * ch + (j + 1) * ch / N));
            for (let i = 0; i < N; i++) {
                const xa = Math.floor(box.x + cx * cw + i * cw / N), xb = Math.max(xa + 1, Math.floor(box.x + cx * cw + (i + 1) * cw / N));
                let r = 0, g = 0, b = 0, n = 0;
                for (let y = ya; y < yb; y++) for (let x = xa; x < xb; x++) { const p = (y * w + x) * 4; r += d[p]; g += d[p + 1]; b += d[p + 2]; n++; }
                const o = base + (j * N + i) * 3; out[o] = r / n; out[o + 1] = g / n; out[o + 2] = b / n;
            }
        }
    }
    return out;
}
// «Отпечаток» эмодзи на цвете фона: рисуем значок крупно и усредняем так же, как клетки картинки
function dndEmojiSig(ch, bg, ratio, N) {
    const S = 64, cv = document.createElement('canvas'); cv.width = S; cv.height = S; const c = cv.getContext('2d', { willReadFrequently: true });
    c.fillStyle = 'rgb(' + bg.join(',') + ')'; c.fillRect(0, 0, S, S); c.textAlign = 'center'; c.textBaseline = 'middle'; c.font = Math.round(S * dndEmojiScale() * ratio) + 'px ' + DND_EMOJI_FONT; c.fillText(ch, S / 2, S / 2 + S * 0.05 * ratio);
    return dndEmojiSample(c.getImageData(0, 0, S, S), S, { x: 0, y: 0, w: S, h: S }, 1, 1, N);
}
const dndWait = () => new Promise(r => setTimeout(r, 0));

// Главная работа: сетка → эмодзи. opt: { cols, rows, box, mode:'recognize'|'mosaic', sets:['sq','ci','he','fx'], ratio:0|число }
async function dndEmojiBuild(an, opt, progress) {
    const box = opt.box || an.box, cols = opt.cols, rows = opt.rows, n = cols * rows, bg = an.bg;
    const out = dndEmojiNew(cols, rows);
    if (opt.mode === 'mosaic') {
        const list = []; (opt.sets || ['sq', 'ci', 'he']).forEach(k => dndGraphemes(DND_EMOJI_MOSAIC[k] || '').forEach(g => list.push(g)));
        const cols1 = list.map(g => { const s = dndEmojiSig(g, [0, 0, 0], 1, 1), t = dndEmojiSig(g, [255, 255, 255], 1, 1); return [(s[0] + t[0]) / 2, (s[1] + t[1]) / 2, (s[2] + t[2]) / 2]; });
        // для сплошных значков (квадраты, круги) среднее по чёрному и белому фону — это почти их цвет; для остальных сравниваем с запасом
        const cell = dndEmojiSample(an.data, an.w, box, cols, rows, 1);
        for (let i = 0; i < n; i++) {
            const r = cell[i * 3], g = cell[i * 3 + 1], b = cell[i * 3 + 2]; let best = 0, bd = 1e12;
            for (let k = 0; k < cols1.length; k++) { const q = cols1[k]; const dd = (r - q[0]) ** 2 + (g - q[1]) ** 2 + (b - q[2]) ** 2; if (dd < bd) { bd = dd; best = k; } }
            out.c[i] = dndEmojiIndex(out, list[best]);
            if (i % 400 === 399) { if (progress) progress(i / n); await dndWait(); }
        }
        out.avg = 0; return out;
    }
    const cand = dndEmojiAll(), c6 = dndEmojiSample(an.data, an.w, box, cols, rows, 6), c12 = dndEmojiSample(an.data, an.w, box, cols, rows, 12);
    // пустые клетки: почти всё как фон
    const empty = new Uint8Array(n), live = [];
    for (let i = 0; i < n; i++) { let diff = 0; for (let k = 0; k < 144; k++) { const o = (i * 144 + k) * 3; if (Math.abs(c12[o] - bg[0]) + Math.abs(c12[o + 1] - bg[1]) + Math.abs(c12[o + 2] - bg[2]) > 40) diff++; } if (diff < 144 * 0.035) empty[i] = 1; else live.push(i); }
    const dist = (a, ao, b, bo, len, stop) => { let s = 0; for (let k = 0; k < len; k++) { const t = a[ao + k] - b[bo + k]; s += t * t; if (s > stop) return s; } return s; };
    const sigs6 = ratio => { const m = new Float32Array(cand.length * 108); cand.forEach((g, k) => m.set(dndEmojiSig(g, bg, ratio, 6), k * 108)); return m; };
    // подбираем размер значка в клетке (в Miro он бывает разный): пробуем три и берём самый подходящий по первым клеткам
    let ratio = opt.ratio || 0, sg6 = null;
    if (!ratio) {
        const probe = live.filter((_, k) => k % Math.max(1, Math.floor(live.length / 40)) === 0).slice(0, 40); let bestE = 1e18;
        for (const r of [0.8, 0.92, 1.02]) {
            const m = sigs6(r); let tot = 0;
            for (const i of probe) { let bd = 1e18; for (let k = 0; k < cand.length; k++) { const dd = dist(c6, i * 108, m, k * 108, 108, bd); if (dd < bd) bd = dd; } tot += bd; }
            if (tot < bestE) { bestE = tot; ratio = r; sg6 = m; }
            await dndWait();
        }
    } else sg6 = sigs6(ratio);
    const sg12 = new Map(); const sig12 = k => { let s = sg12.get(k); if (!s) { s = dndEmojiSig(cand[k], bg, ratio, 12); sg12.set(k, s); } return s; };
    let errSum = 0;
    for (let t = 0; t < live.length; t++) {
        const i = live[t], top = [];   // пять лучших по грубому отпечатку
        for (let k = 0; k < cand.length; k++) { const worst = top.length < 5 ? 1e18 : top[4][0]; const dd = dist(c6, i * 108, sg6, k * 108, 108, worst); if (dd < worst) { top.push([dd, k]); top.sort((a, b) => a[0] - b[0]); if (top.length > 5) top.pop(); } }
        let best = top[0][1], bd = 1e18;
        for (const [, k] of top) { const dd = dist(c12, i * 432, sig12(k), 0, 432, bd); if (dd < bd) { bd = dd; best = k; } }
        errSum += bd / 432; out.c[i] = dndEmojiIndex(out, cand[best]);
        if (t % 60 === 59) { if (progress) progress(t / live.length); await dndWait(); }
    }
    out.err = live.length ? Math.sqrt(errSum / live.length) : 0;   // средняя ошибка цвета (0…255): чем меньше, тем точнее
    out.ratio = ratio; return out;
}

// Готовый предмет доски из данных
function dndEmojiItem(d, name, at) {
    const cell = 24, w0 = Math.min(720, d.cols * cell), k = w0 / d.cols;
    return bdItem('emoji', { x: at ? Math.round(at.x - w0 / 2) : 0, y: at ? Math.round(at.y - d.rows * k / 2) : 0, w: Math.round(w0), h: Math.round(d.rows * k), cols: d.cols, rows: d.rows, em: d.em.slice(), c: d.c.slice(), pal: (d.pal || ['']).slice(), b: (d.b || []).slice(), rev: 1, name: name || '' });
}
