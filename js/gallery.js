'use strict';
// =====================================================================================================
// iLife — МОЕ_СОВСЕК: фото и GIF из экспорта Telegram.
//
// • Импорт: ZIP / result.json / messages.html (или просто файлы-картинки). Разбор экспорта — те же функции, что у блока
//   «Telegram-канал» на странице «Идеи» (telegram.js). Берутся только картинки и GIF-файлы; видео и GIF-анимации в виде
//   mp4 пропускаются (видео — позже).
// • Копии хуже качеством отбрасываются: миниатюры «…_thumb.jpg» из экспорта и «тот же снимок, но меньше» (сравнение по
//   отпечатку dHash и пропорциям). Остаётся версия с лучшим разрешением, при равенстве — тяжелее по размеру файла.
// • Папки — виртуальные (файлы не дублируются): Картинки/год/месяц/день, GIF/год/месяц/день, Актёры/Имя, Хештеги/тег.
// • Актёров по лицам приложение НЕ определяет. Имя попадает в «Актёры» из подписи к фото, из текста на самой картинке
//   (если включён ИИ — он только читает текст) или вручную.
// • Данные: список `gallery` (метаданные, ключ ilife_gallery) уходит на Google Диск вместе с остальными данными, сами
//   файлы лежат в IndexedDB (BlobDB) и синхронизируются в отдельную папку «iLife/Мое_совсек» (gdrive.js, gSyncGallery).
// =====================================================================================================

let gallery = LS.get('gallery', []);
if (!Array.isArray(gallery)) gallery = [];
function saveGallery() { if (typeof cloudLocalChanged === 'function') cloudLocalChanged(); return LS.set('gallery', gallery); }

const GAL_FILE_MAX = 80 * 1048576;          // крупнее одного файла не берём
const GAL_PAGE = 120;                       // сколько плиток показывать за раз
const GAL_ZIP_PART = 1200 * 1048576;        // один архив не больше ~1,2 ГБ (иначе несколько частей)
const GAL_AI_PAUSE = { gemini: 4300, claude: 1200 };   // пауза между запросами к ИИ (у бесплатного Gemini ~15 запросов в минуту)
const GAL_ROOTS = [
    { key: 'img', name: 'Картинки', icon: 'image' },
    { key: 'gif', name: 'GIF', icon: 'gif' },
    { key: 'act', name: 'Актёры', icon: 'person' },
    { key: 'tag', name: 'Хештеги', icon: 'tag' }
];
const GAL_NOTAG = '~без-хештегов';
const galUi = Object.assign({ view: 'large', sort: 'new', ai: false }, LS.get('gallery_ui', {}));
function galUiSave() { LS.set('gallery_ui', galUi); }

let galPath = [];            // текущая папка: ['img', '2025', '03', '14'] / ['act', 'Имя'] / ['tag', 'тег'] / []
let galFlat = false;         // показывать все фото внутри папки (без подпапок)
let galLimit = GAL_PAGE;
let galSel = null;           // Set id при режиме выбора
let galCur = { folders: [], files: [] };
let galBusy = false;
let galIo = null;

// ---------- Мелочи ----------
const galSleep = ms => new Promise(r => setTimeout(r, ms));
const galMonthName = mo => capitalizeFirst(MONTHS_NOM[mo]);
const galSafe = s => String(s || '').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '_').replace(/^\.+/, '').trim().slice(0, 90) || '_';
function galParts(g) { return almatyParts(g.date || 0); }
function galExt(g) { const m = /\.([a-z0-9]{2,5})$/i.exec(g.name || ''); return m ? m[1].toLowerCase() : (g.kind === 'gif' ? 'gif' : 'jpg'); }
function galTgName(g) { return /^(photo|file|animation|image)[_-]?\d*@/i.test(g.name || '') || /^(photo|file)_\d+/i.test(g.name || '') || !g.name; }
function galFileName(g) {
    if (!galTgName(g)) return galSafe(g.name);
    const p = galParts(g);
    return p.y + '-' + pad2(p.mo + 1) + '-' + pad2(p.d) + ' ' + pad2(p.h) + '-' + pad2(p.mi) + '-' + pad2(p.s) + '.' + galExt(g);
}
function galTitle(g) { const p = galParts(g); return p.d + ' ' + MONTHS_GEN[p.mo] + ' ' + p.y + ', ' + pad2(p.h) + ':' + pad2(p.mi); }
function galCountText(n, gifOnly) { return n + (gifOnly ? ' GIF' : ' фото'); }
function galBytes(arr) { return arr.reduce((s, g) => s + (Number(g.size) || 0), 0); }
function galUniq(a) { return Array.from(new Set(a)); }
function galNormActor(s) { return String(s || '').replace(/\s+/g, ' ').trim().split(' ').map(w => w ? w.charAt(0).toLocaleUpperCase('ru-RU') + w.slice(1) : w).join(' ').slice(0, 60); }
function galParseActors(str) { return galUniq(String(str || '').split(/[,;\n]+/).map(galNormActor).filter(Boolean)).slice(0, 20); }
function galKnownActors() { const set = new Set(); gallery.forEach(g => (g.actors || []).forEach(a => set.add(a))); return Array.from(set).sort((a, b) => a.localeCompare(b, 'ru')); }
function galKnownTags() { const m = new Map(); gallery.forEach(g => (g.tags || []).forEach(t => m.set(t, (m.get(t) || 0) + 1))); return Array.from(m.entries()).sort((a, b) => b[1] - a[1]).map(x => x[0]); }
function galTgDate(name) {   // photo_1@14-03-2025_12-30-00.jpg → мс (время экспортёра принимаем за алматинское)
    const m = /@(\d{2})-(\d{2})-(\d{4})_(\d{2})-(\d{2})-(\d{2})/.exec(name || ''); if (!m) return 0;
    return Date.UTC(+m[3], +m[2] - 1, +m[1], +m[4], +m[5], +m[6]) - ALMATY_UTC_OFFSET_HOURS * 3600000;
}
function galMimeOf(blob, c) {
    const t = blob && blob.type && blob.type !== 'application/octet-stream' ? blob.type : '';
    return t || (c && c.mime && c.mime !== 'application/octet-stream' ? c.mime : '') || tgMimeByName(c && c.name) || 'image/jpeg';
}

// ---------- Отпечаток картинки (dHash) и миниатюра ----------
const galPop = x => { x = x - ((x >>> 1) & 0x55555555); x = (x & 0x33333333) + ((x >>> 2) & 0x33333333); return Math.imul((x + (x >>> 4)) & 0x0F0F0F0F, 0x01010101) >>> 24; };
const galHex8 = n => (n >>> 0).toString(16).padStart(8, '0');
function galSigParts(sig) { return [parseInt(String(sig).slice(0, 8), 16) >>> 0, parseInt(String(sig).slice(8, 16), 16) >>> 0]; }
function galDist(a, b) { return galPop((a[0] ^ b[0]) >>> 0) + galPop((a[1] ^ b[1]) >>> 0); }
function galSigOk(p) { const n = galPop(p[0]) + galPop(p[1]); return n >= 6 && n <= 58; }   // однотонные картинки отпечатком не сравниваем
// Отпечаток: 16 знаков dHash (64 бита, «светлее ли сосед справа») + 12 знаков средних цветов сетки 2×2 (по 4 бита на канал)
async function galAnalyze(file) {
    const bmp = await decodeImage(file);
    const { w, h } = bitmapSize(bmp);
    // 72×64 → усреднение блоков 8×8 → 9×8 → сравнение соседних. Так миниатюра и оригинал дают почти один и тот же отпечаток.
    const c = document.createElement('canvas'); c.width = 72; c.height = 64;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 72, 64); ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high'; ctx.drawImage(bmp, 0, 0, 72, 64);
    const px = ctx.getImageData(0, 0, 72, 64).data, g = new Float64Array(72), col = new Float64Array(12), cnt = new Float64Array(4);
    for (let y = 0; y < 64; y++) for (let x = 0; x < 72; x++) {
        const i = (y * 72 + x) * 4, q = (y < 32 ? 0 : 2) + (x < 36 ? 0 : 1);
        col[q * 3] += px[i]; col[q * 3 + 1] += px[i + 1]; col[q * 3 + 2] += px[i + 2]; cnt[q]++;
    }
    for (let by = 0; by < 8; by++) for (let bx = 0; bx < 9; bx++) {
        let s = 0;
        for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) { const i = ((by * 8 + y) * 72 + bx * 8 + x) * 4; s += px[i] * 0.299 + px[i + 1] * 0.587 + px[i + 2] * 0.114; }
        g[by * 9 + bx] = s / 64;
    }
    let hi = 0, lo = 0, bit = 0;
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) { const v = g[y * 9 + x] > g[y * 9 + x + 1] ? 1 : 0; if (bit < 32) hi = ((hi << 1) | v) >>> 0; else lo = ((lo << 1) | v) >>> 0; bit++; }
    let cs = ''; for (let k = 0; k < 12; k++) cs += Math.min(15, Math.floor(col[k] / cnt[(k / 3) | 0] / 16)).toString(16);
    const t = await canvasBlob(bmp, w, h, 480, 0.8);
    if (bmp.close) try { bmp.close(); } catch (e) {}
    return { w, h, sig: galHex8(hi) + galHex8(lo) + cs, thumb: t && t.blob || null };
}
function galColDist(a, b) {   // наибольшее расхождение средних цветов (в шагах по 16 из 256)
    const x = String(a).slice(16), y = String(b).slice(16); if (x.length < 12 || y.length < 12) return 0;
    let m = 0; for (let i = 0; i < 12; i++) m = Math.max(m, Math.abs(parseInt(x[i], 16) - parseInt(y[i], 16)));
    return m;
}
// Один и тот же снимок? 'dup' — тот же размер (пережатая копия), 'smaller' — тот же кадр в другом разрешении.
// Снимки одной серии (серийная съёмка) одинакового размера так не склеиваются: для «дубля» нужно почти полное совпадение отпечатка.
function galRelation(a, b) {
    if (!a._p || !b._p || !a.w || !b.w) return '';
    const ra = a.w / a.h, rb = b.w / b.h;
    if (Math.abs(ra - rb) / Math.max(ra, rb) > 0.02) return '';
    if (!galSigOk(a._p) || !galSigOk(b._p)) return '';
    const d = galDist(a._p, b._p), cd = galColDist(a.sig, b.sig);
    if (Math.abs(a.w - b.w) <= 1 && Math.abs(a.h - b.h) <= 1) return d <= 2 && cd <= 1 ? 'dup' : '';
    return d <= 8 && cd <= 2 ? 'smaller' : '';
}
function galBetter(a, b) {   // a лучше b: больше пикселей, а при равенстве (±1%) — тяжелее файл
    const pa = a.w * a.h, pb = b.w * b.h;
    if (Math.abs(pa - pb) / Math.max(pa, pb) > 0.01) return pa > pb;
    return (a.size || 0) > (b.size || 0);
}

// ---------- Разбор экспорта ----------
function galBaseOfThumb(path) { return String(path || '').replace(/_thumb(\.[a-z0-9]+)$/i, '$1'); }
function galIsImageName(n) { return /\.(jpe?g|png|webp|gif|bmp)$/i.test(n || ''); }
function galFromMessages(msgs, chatName, stat) {
    msgs.sort((a, b) => a.date - b.date || a.id - b.id); tgMarkAlbums(msgs);
    const gcap = new Map(); msgs.forEach(m => { if (m.gid && m.text && !gcap.has(m.gid)) gcap.set(m.gid, m.text); });
    const out = [];
    msgs.forEach(m => m.media.forEach((x, idx) => {
        if (x.kind === 'voice' || x.kind === 'audio') return;
        if (x.kind !== 'image') {
            if (/^video\//.test(x.mime || '') || /\.(mp4|mov|webm|mkv|avi|m4v)$/i.test(x.name || '')) stat.videos++;
            return;
        }
        if (x.missing || !x.get) { stat.missing++; return; }
        if (x.size > GAL_FILE_MAX) { stat.big++; return; }
        const key = 'tg:' + m.key + ':' + idx, cap = String(m.text || gcap.get(m.gid) || '').trim().slice(0, 500);
        const gif = x.mime === 'image/gif' || /\.gif$/i.test(x.name || '');
        out.push({ k: key, id: 'gl' + tgHash(key) + tgHash(key + '~'), kind: gif ? 'gif' : 'image', name: x.name || 'photo.jpg', mime: x.mime, date: m.date || galTgDate(x.name), cap, ch: chatName, get: x.get });
    }));
    return out;
}
function galFromLoose(entries, stat) {
    const resolve = tgMakeResolver(entries), out = [];
    entries.forEach(e => {
        const name = String(e.path).split('/').pop();
        if (!galIsImageName(name)) return;
        if (/_thumb\.[a-z0-9]+$/i.test(name) && resolve(galBaseOfThumb(e.path)) && resolve(galBaseOfThumb(e.path)) !== e) return;   // миниатюра, а оригинал рядом — считаем ниже
        if (e.size > GAL_FILE_MAX) { stat.big++; return; }
        const key = 'f:' + tgHash(e.path) + ':' + e.size, gif = /\.gif$/i.test(name);
        out.push({ k: key, id: 'gl' + tgHash(key) + tgHash(key + '~'), kind: gif ? 'gif' : 'image', name, mime: tgMimeByName(name), date: galTgDate(name), cap: '', ch: '', get: e.get, loose: true });
    });
    return out;
}
async function galReadSource(entries, stat) {
    const resolve = tgMakeResolver(entries), st = { missing: 0, emptyMedia: 0, notFound: 0 };
    stat.thumbs = entries.filter(e => /_thumb\.(jpe?g|png|webp|gif)$/i.test(e.path) && (() => { const b = resolve(galBaseOfThumb(e.path)); return b && b !== e; })()).length;
    let chats = [];
    const jsons = entries.filter(e => /\.json$/i.test(e.path) && e.size < 400 * 1048576).sort((a, b) => (/result\.json$/i.test(b.path) ? 1 : 0) - (/result\.json$/i.test(a.path) ? 1 : 0));
    for (const e of jsons) {
        let data = null; try { data = JSON.parse(await (await e.get()).text()); } catch (err) { continue; }
        tgChatsFromJson(data).forEach(c => chats.push(c));
        if (chats.length) break;
    }
    let msgs = null, name = '';
    if (chats.length) {
        const chat = chats.length === 1 ? chats[0] : await tgPickChat(chats);
        if (!chat) return null;
        msgs = tgNormalizeExportJson(chat, resolve, st); name = chat.name;
    } else {
        const htmls = entries.filter(e => /(^|\/)messages\d*\.html?$/i.test(e.path)).sort((a, b) => (parseInt((a.path.match(/messages(\d*)\.html?$/i) || [])[1] || '1', 10)) - (parseInt((b.path.match(/messages(\d*)\.html?$/i) || [])[1] || '1', 10)));
        if (htmls.length) {
            msgs = [];
            for (const e of htmls) {
                const html = await (await e.get()).text();
                if (!name) { const m = /<div class="text bold">\s*([^<]+?)\s*<\/div>/.exec(html); name = m ? ytDecode(m[1]) : ''; }
                tgParseHtmlExport(html, resolve, st, name || 'Telegram', 'h' + tgHash(name || 'chat')).forEach(m => msgs.push(m));
            }
        }
    }
    if (msgs) { stat.missing += st.missing; return { cands: galFromMessages(msgs, name || 'Telegram', stat), chat: name }; }
    return { cands: galFromLoose(entries, stat), chat: '', loose: true };
}

// ---------- Импорт ----------
function galProgressSheet(title) {
    const ctl = { stop: false };
    const sheet = openSheet({
        title, html: '<div class="tg-prog"><div class="lbl" data-l>Подготовка…</div><div class="progress"><i data-b></i></div></div>',
        actions: [{ label: 'Остановить', icon: 'close', onClick: () => { ctl.stop = true; const l = $('[data-l]', sheet.el); if (l) l.textContent = 'Останавливаем…'; return false; } }],
        onClose: () => { ctl.stop = true; }
    });
    return { ctl, sheet, set(label, frac) { const l = $('[data-l]', sheet.el), b = $('[data-b]', sheet.el); if (l && !ctl.stop) l.textContent = label; if (b) b.style.width = Math.round(Math.max(0, Math.min(1, frac || 0)) * 100) + '%'; }, close() { sheet.close(); } };
}
function galAutoActors(item) {   // имена, которые уже есть в «Актёрах», находим в подписи и хештегах
    const names = galKnownActors(); if (!names.length) return;
    const cap = normText(item.cap || ''), tags = new Set(item.tags || []);
    names.forEach(n => {
        const nn = normText(n);
        if (((cap && cap.includes(nn)) || tags.has(nn.replace(/\s+/g, ''))) && !(item.actors || []).includes(n)) item.actors = (item.actors || []).concat(n);
    });
}
async function galImportFiles(fileList) {
    const files = Array.from(fileList || []); if (!files.length) return;
    if (galBusy) { toast('Уже идёт обработка — подождите'); return; }
    galBusy = true; galRenderCard();
    const ui = galProgressSheet('Фото из экспорта');
    const stat = { missing: 0, videos: 0, thumbs: 0, big: 0, bad: 0, old: 0, tomb: 0, dups: 0, smaller: 0, replaced: 0, added: 0, addedGif: 0 };
    const run = async () => {
        ui.set('Читаем экспорт…', 0.02);
        const entries = await tgCollectEntries(files);
        const src = await galReadSource(entries, stat);
        if (!src) return null;                                   // чат не выбран
        const cands = src.cands;
        if (!cands.length) return { empty: true, stat };
        // 1) смотрим каждую картинку: размер в пикселях, отпечаток, миниатюра
        const known = new Set(gallery.map(g => g.k).filter(Boolean)), knownIds = new Set(gallery.map(g => g.id));
        const tomb = (typeof gMetaGet === 'function' && gMetaGet().deleted.gallery) || {};
        const fresh = [];
        for (let n = 0; n < cands.length; n++) {
            if (ui.ctl.stop) break;
            const c = cands[n];
            if (known.has(c.k) || knownIds.has(c.id)) { stat.old++; continue; }
            if (tomb[c.id]) { stat.tomb++; continue; }
            ui.set('Смотрим фото: ' + (n + 1) + ' из ' + cands.length, 0.05 + 0.6 * n / cands.length);
            try {
                const blob = await c.get();
                if (blob.size > GAL_FILE_MAX) { stat.big++; continue; }
                const a = await galAnalyze(blob);
                c.w = a.w; c.h = a.h; c.sig = a.sig; c.thumb = a.thumb; c.size = blob.size; c._p = galSigParts(a.sig);
                if (!c.date) c.date = blob.lastModified || Date.now();
                fresh.push(c);
            } catch (e) { stat.bad++; console.warn('Картинка не прочитана', c.name, e); }
            if (n % 8 === 7) await galSleep(0);
        }
        // 2) оставляем лучшие копии
        ui.set('Отбираем лучшие копии…', 0.68);
        const order = fresh.slice().sort((a, b) => galBetter(a, b) ? -1 : galBetter(b, a) ? 1 : 0);
        const pool = gallery.filter(g => g.sig && g.w).map(g => ({ g, w: g.w, h: g.h, size: g.size, sig: g.sig, _p: galSigParts(g.sig) }));
        const accepted = [];
        for (const c of order) {
            let hit = null, rel = '';
            for (const p of pool) { rel = galRelation(c, p); if (rel) { hit = p; break; } }
            if (!hit) { accepted.push(c); pool.push(c); continue; }
            if (hit.g && galBetter(c, hit)) {   // в библиотеке лежит версия хуже — заменяем
                c.inherit = hit.g; accepted.push(c); pool[pool.indexOf(hit)] = c; stat.replaced++;
            } else {
                if (!hit.g) hit.cap = hit.cap || c.cap;
                if (rel === 'dup') stat.dups++; else stat.smaller++;
            }
        }
        // 3) сохраняем
        accepted.sort((a, b) => a.date - b.date);
        const total = accepted.length, now = Date.now(); let batch = [], saved = 0;
        const flush = () => {
            if (!batch.length) return;
            const b = batch; batch = [];
            const gone = b.map(i => i._replaces).filter(Boolean);
            b.forEach(i => { delete i._replaces; });
            gone.forEach(g => { const ix = gallery.indexOf(g); if (ix >= 0) gallery.splice(ix, 1); });
            gallery.push(...b);
            if (!saveGallery()) {
                b.forEach(i => { const ix = gallery.indexOf(i); if (ix >= 0) gallery.splice(ix, 1); });
                gallery.push(...gone); b.forEach(i => BlobDB.del(i.id));
                throw new Error('Не хватило места в памяти браузера — часть фото не сохранена');
            }
            gone.forEach(g => BlobDB.del(g.id));
            saved += b.length;
        };
        try {
            for (let n = 0; n < total; n++) {
                if (ui.ctl.stop) break;
                const c = accepted[n];
                ui.set('Сохраняем: ' + (n + 1) + ' из ' + total, 0.7 + 0.3 * n / Math.max(total, 1));
                const blob = await c.get(), type = galMimeOf(blob, c);
                await BlobDB.put({ id: c.id, blob: blob.type === type ? blob : new Blob([blob], { type }), thumb: c.thumb, name: c.name, type, size: blob.size });
                const item = { id: c.id, kind: c.kind, name: c.name, size: blob.size, w: c.w, h: c.h, date: c.date, sig: c.sig, k: c.k, updatedAt: now };
                if (c.cap) item.cap = c.cap;
                if (c.ch) item.ch = c.ch;
                item.tags = extractTags(c.cap || '');
                item.actors = [];
                if (c.inherit) {
                    const o = c.inherit; item._replaces = o;
                    item.tags = galUniq(item.tags.concat(o.tags || [])); item.actors = (o.actors || []).slice();
                    if (!item.cap && o.cap) item.cap = o.cap;
                    if (o.ai) item.ai = o.ai;
                }
                galAutoActors(item);
                batch.push(item);
                if (c.kind === 'gif') stat.addedGif++; else stat.added++;
                if (batch.length >= 20) { flush(); await galSleep(0); }
            }
        } finally { try { flush(); } catch (e) { console.warn(e); } }
        return { stat, stopped: ui.ctl.stop, saved, chat: src.chat, loose: src.loose };
    };
    let summary = null, failure = null;
    try { summary = await run(); } catch (e) { failure = e; }
    ui.close(); galBusy = false;
    galRenderCard(); galRenderBody();
    if (failure) tgShowError('Не удалось прочитать экспорт', failure);
    else if (summary) {
        if ((summary.saved || 0) > 0 && !LS.get('gal_card_folded', false)) {   // после первого импорта сворачиваем блок, чтобы папки были сразу на виду (дальше — как решит пользователь)
            LS.set('gal_card_folded', true);
            const c = $('#gal-card'); if (c) { c.classList.add('is-collapsed'); collapsedCards.add('gal-card'); LS.set('collapsed', Array.from(collapsedCards)); }
        }
        galSummarySheet(summary);
    }
}
function galSummarySheet(sm) {
    const s = sm.stat, lines = [];
    const add = (icon, t) => lines.push('<li>' + ic(icon) + '<span>' + t + '</span></li>');
    if (sm.empty) {
        add('info', 'В выбранных файлах нет картинок для добавления.');
        if (s.videos) add('movie', 'Видео и GIF-анимации в формате mp4 (' + s.videos + ') пока не берём.');
        if (s.missing) add('warning', 'У части сообщений фото не скачаны при экспорте (в экспорте нет самих файлов) — таких: ' + s.missing + '. Повторите экспорт с включёнными «Фото».');
    } else {
        const n = (s.added || 0) + (s.addedGif || 0);
        add('check_circle', n ? 'Добавлено: <b>' + s.added + ' фото</b>' + (s.addedGif ? ' и <b>' + s.addedGif + ' GIF</b>' : '') + (sm.stopped ? ' (остановлено)' : '') : 'Новых фото не добавлено');
        const worse = s.thumbs + s.smaller + s.dups;
        if (worse) add('filter_none', 'Копий хуже качеством не взято: <b>' + worse + '</b>' + ' (' + [s.thumbs ? 'миниатюр экспорта: ' + s.thumbs : '', s.smaller ? 'тот же кадр в меньшем разрешении: ' + s.smaller : '', s.dups ? 'пережатых дублей: ' + s.dups : ''].filter(Boolean).join(', ') + '). Оставлена версия с лучшим разрешением. Файлы самого экспорта на вашем устройстве не тронуты — их можно удалить вручную.');
        if (s.replaced) add('swap_horiz', 'Заменено на версию лучше (были в библиотеке): ' + s.replaced);
        if (s.old) add('history', 'Уже были добавлены раньше: ' + s.old);
        if (s.tomb) add('delete', 'Ранее удалены вами и пропущены: ' + s.tomb);
        if (s.videos) add('movie', 'Видео и GIF-анимации в формате mp4 пропущены: ' + s.videos + ' (видео добавим позже)');
        if (s.missing) add('warning', 'Фото нет среди выбранных файлов или они не скачаны при экспорте: ' + s.missing);
        if (s.big) add('warning', 'Слишком крупных файлов (больше ' + fmtBytes(GAL_FILE_MAX) + '): ' + s.big);
        if (s.bad) add('error', 'Не удалось прочитать как картинку: ' + s.bad);
    }
    const todo = gallery.filter(g => !g.ai).length, canAi = galUi.ai && mvHasAi() && todo > 0;
    const actions = [{ label: 'Закрыть' }];
    if (canAi && !sm.empty) actions.push({ label: 'ИИ-разбор (' + todo + ')', icon: 'auto_awesome', onClick() { setTimeout(galAiRun, 250); } });
    if (!sm.empty && (sm.saved || 0) > 0) actions.push({ label: 'Открыть', kind: 'primary', icon: 'folder_open', onClick() { galPath = []; galFlat = false; galRenderBody(); } });
    openSheet({ title: sm.empty ? 'Фото не найдены' : 'Готово', html: '<ul class="gal-sum">' + lines.join('') + '</ul>', actions });
}

// ---------- ИИ: хештеги по содержанию и имена из текста ----------
function galAiPrompt(g) {
    return 'Ты помогаешь разложить фото по папкам. Верни ТОЛЬКО JSON без пояснений и без markdown: {"tags":["…"],"names":["…"],"text":"…"}.\n' +
        'tags — от 1 до 4 коротких хештегов на русском, строчными буквами, без «#», одно слово каждый, по тому что изображено (например: природа, еда, кошка, город, документ, скриншот, портрет, спорт, юмор, мем).\n' +
        'text — слово в слово весь читаемый текст на изображении (до 300 символов); пустая строка, если текста нет.\n' +
        'names — имена людей, которые прямо НАПИСАНЫ в подписи к фото или в тексте на изображении (титры, подпись, водяной знак). ЗАПРЕЩЕНО определять человека по лицу, внешности или голосу: если имени нет в тексте — names должен быть пустым массивом [].\n' +
        (g.cap ? 'Подпись к фото: «' + g.cap.slice(0, 400).replace(/[«»]/g, '"') + '»' : 'Подписи к фото нет.');
}
function galParseAi(raw) {
    let t = String(raw || '').replace(/```(?:json)?/gi, '').trim();
    const a = t.indexOf('{'), b = t.lastIndexOf('}'); if (a < 0 || b <= a) return null;
    try { const j = JSON.parse(t.slice(a, b + 1)); return j && typeof j === 'object' ? j : null; } catch (e) { return null; }
}
function galNameInText(name, text) {   // имя принимаем, только если его слова действительно есть в подписи / прочитанном тексте (допускаем падежные окончания)
    const hay = normText(text); if (!hay) return false;
    const words = normText(name).split(/\s+/).filter(w => w.length >= 3);
    if (!words.length) return false;
    return words.every(w => hay.includes(w.slice(0, Math.max(3, w.length - 2))));
}
function galApplyAi(g, r) {
    const tags = (Array.isArray(r.tags) ? r.tags : String(r.tags || '').split(/[\s,]+/)).map(t => normText(String(t).replace(/^#+/, '')).replace(/[^\p{L}\p{N}_]/gu, '')).filter(t => t.length >= 2 && t.length <= 24).slice(0, 4);
    const text = String(r.text || '').slice(0, 400), hay = (g.cap || '') + ' ' + text;
    const names = (Array.isArray(r.names) ? r.names : []).map(galNormActor).filter(n => n && galNameInText(n, hay)).slice(0, 5);
    g.tags = galUniq((g.tags || []).concat(tags)); if (names.length) g.actors = galUniq((g.actors || []).concat(names));
    g.ai = 1;
    return { tags: tags.length, names: names.length };
}
async function galSmallJpeg(blob) {
    const bmp = await decodeImage(blob), { w, h } = bitmapSize(bmp), r = await canvasBlob(bmp, w, h, 768, 0.8);
    if (bmp.close) try { bmp.close(); } catch (e) {}
    return r.blob;
}
async function galAiRun() {
    if (galBusy) { toast('Уже идёт обработка — подождите'); return; }
    if (!mvHasAi()) { toast('Сначала подключите ИИ: Настройки → Кино: базы и оценки', { ms: 5000 }); return; }
    const todo = gallery.filter(g => !g.ai); if (!todo.length) { toast('Все фото уже разобраны'); return; }
    galBusy = true; galRenderCard();
    const ui = galProgressSheet('ИИ разбирает фото'), pause = GAL_AI_PAUSE[mvCfg().ai] || 2000;
    let done = 0, failed = 0, tags = 0, names = 0, err = '', consecutive = 0, noFile = 0;
    try {
        for (let n = 0; n < todo.length; n++) {
            if (ui.ctl.stop) break;
            const g = todo[n];
            ui.set('Разобрано ' + done + ' из ' + todo.length + (failed ? ' · не вышло: ' + failed : ''), n / todo.length);
            const rec = await BlobDB.get(g.id); if (!rec || !rec.blob) { noFile++; continue; }
            try {
                const small = await galSmallJpeg(rec.blob);
                const raw = await mvAskAiText({ text: galAiPrompt(g), imageBlob: small, maxTokens: 500 });
                const r = galParseAi(raw);
                if (!r) { failed++; if (++consecutive >= 6) { err = 'ИИ отвечает не в том формате'; break; } continue; }
                const s = galApplyAi(g, r); tags += s.tags; names += s.names; done++; consecutive = 0;
                if (done % 5 === 0) saveGallery();
            } catch (e) {
                failed++; err = e && e.message ? e.message : String(e);
                if (e && (e.code === 429 || /quota|лимит|limit|429|ключ|key/i.test(err))) break;
                if (++consecutive >= 4) break;
            }
            await galSleep(pause);
        }
    } finally { saveGallery(); }
    ui.close(); galBusy = false; galRenderCard(); galRenderBody();
    const left = gallery.filter(g => !g.ai).length - noFile;
    toast('ИИ разобрал фото: ' + done + (tags ? ' · хештегов: ' + tags : '') + (names ? ' · имён: ' + names : '') + (err ? ' · остановка: ' + err.slice(0, 120) : left > 0 && ui.ctl.stop ? ' · осталось ' + left : ''), { ms: 6500 });
}

// ---------- Папки ----------
function galIsLeaf(path) { const r = path[0]; return r === 'img' || r === 'gif' ? path.length >= 4 : r === 'act' || r === 'tag' ? path.length >= 2 : false; }
function galItems(path) {
    const [r, a, b, c] = path; let arr = gallery;
    if (r === 'img' || r === 'gif') {
        arr = arr.filter(g => (g.kind === 'gif') === (r === 'gif'));
        if (a) arr = arr.filter(g => String(galParts(g).y) === a);
        if (b) arr = arr.filter(g => pad2(galParts(g).mo + 1) === b);
        if (c) arr = arr.filter(g => pad2(galParts(g).d) === c);
    } else if (r === 'act') {
        arr = arr.filter(g => (g.actors || []).length);
        if (a) arr = arr.filter(g => g.actors.includes(a));
    } else if (r === 'tag') {
        if (a === GAL_NOTAG) arr = arr.filter(g => !(g.tags || []).length);
        else if (a) arr = arr.filter(g => (g.tags || []).includes(a));
        else arr = arr.filter(g => (g.tags || []).length);
    }
    return arr;
}
function galFolderName(path, i) {   // название i-го элемента пути
    const k = path[i], r = path[0];
    if (i === 0) return (GAL_ROOTS.find(x => x.key === k) || {}).name || k;
    if (r === 'img' || r === 'gif') { if (i === 1) return k; if (i === 2) return galMonthName(+k - 1); if (i === 3) return +k + ' ' + MONTHS_GEN[+path[2] - 1]; }
    if (r === 'tag') return k === GAL_NOTAG ? 'Без хештегов' : '#' + k;
    return k;
}
function galFolders(path, items) {
    const sortMode = galUi.sort;
    if (!path.length) return GAL_ROOTS.map(x => { const it = galItems([x.key]); return { key: x.key, name: x.name, icon: x.icon, count: it.length, bytes: galBytes(it), cover: galNewest(it), gif: x.key === 'gif' }; });
    const r = path[0], groups = new Map(), put = (key, g) => { let v = groups.get(key); if (!v) groups.set(key, v = []); v.push(g); };
    if (r === 'img' || r === 'gif') { const lvl = path.length; items.forEach(g => { const p = galParts(g); put(lvl === 1 ? String(p.y) : lvl === 2 ? pad2(p.mo + 1) : pad2(p.d), g); }); }
    else if (r === 'act') items.forEach(g => (g.actors || []).forEach(a => put(a, g)));
    else if (r === 'tag') (path.length === 1 ? gallery : items).forEach(g => { if (!(g.tags || []).length) put(GAL_NOTAG, g); else g.tags.forEach(t => put(t, g)); });   // «Без хештегов» — только на верхнем уровне
    const list = Array.from(groups.entries()).map(([key, it]) => ({ key, name: galFolderName(path.concat(key), path.length), icon: 'folder', count: it.length, bytes: galBytes(it), cover: galNewest(it), gif: r === 'gif' }));
    if (sortMode === 'big') list.sort((a, b) => b.bytes - a.bytes);
    else if (r === 'img' || r === 'gif') list.sort((a, b) => sortMode === 'old' ? (a.key < b.key ? -1 : 1) : (a.key < b.key ? 1 : -1));
    else list.sort((a, b) => (a.key === GAL_NOTAG ? 1 : b.key === GAL_NOTAG ? -1 : a.name.localeCompare(b.name, 'ru')));
    return list;
}
function galNewest(items) { let best = null; items.forEach(g => { if (!best || g.date > best.date) best = g; }); return best; }
function galSortFiles(items) {
    const a = items.slice(), m = galUi.sort;
    a.sort(m === 'big' ? (x, y) => (y.size || 0) - (x.size || 0) : m === 'old' ? (x, y) => x.date - y.date : (x, y) => y.date - x.date);
    return a;
}

// ---------- Показ ----------
function galThumbHtml(g) { return '<span class="gal-th" data-id="' + esc(g.id) + '"><img alt="" data-gid="' + esc(g.id) + '">' + (g.kind === 'gif' ? '<span class="gal-gif">GIF</span>' : '') + '</span>'; }
function galFileMeta(g) {
    const bits = [g.w ? g.w + '×' + g.h : '', fmtBytes(g.size || 0)];
    if ((g.tags || []).length) bits.push(g.tags.slice(0, 3).map(t => '#' + t).join(' '));
    if ((g.actors || []).length) bits.push(g.actors.slice(0, 2).join(', '));
    return bits.filter(Boolean).join(' · ');
}
function galFolderHtml(f, i, view) {
    const sub = galCountText(f.count, f.gif) + (f.count ? ' · ' + fmtBytes(f.bytes) : '');
    const dl = '<button type="button" class="icon-btn gal-dl" data-save="' + i + '" aria-label="Сохранить папку «' + esc(f.name) + '»" title="Сохранить папку">' + ic('download') + '</button>';
    if (view === 'list') return '<div class="gal-row gal-frow" role="button" tabindex="0" data-f="' + i + '"><span class="gal-ico">' + ic(f.icon) + '</span><span class="tx"><span class="nm">' + esc(f.name) + '</span><span class="sub">' + esc(sub) + '</span></span>' + (f.count ? dl : '') + ic('chevron_right') + '</div>';
    return '<div class="gal-tile gal-ftile" role="button" tabindex="0" data-f="' + i + '">' + (f.cover ? galThumbHtml(f.cover) : '<span class="gal-th gal-empty"></span>') + '<span class="gal-fi">' + ic(f.icon) + '</span>' +
        '<span class="cap"><b>' + esc(f.name) + '</b><span>' + esc(sub) + '</span></span>' + (view === 'large' && f.count ? dl : '') + '</div>';
}
function galFileHtml(g, i, view) {
    const sel = galSel && galSel.has(g.id);
    const chk = galSel ? '<span class="gal-chk">' + ic('check') + '</span>' : '';
    if (view === 'list') return '<div class="gal-row' + (sel ? ' is-sel' : '') + '" role="button" tabindex="0" data-i="' + i + '">' + chk + galThumbHtml(g) + '<span class="tx"><span class="nm">' + esc(galTitle(g)) + '</span><span class="sub">' + esc(galFileMeta(g)) + '</span></span>' +
        '<button type="button" class="icon-btn gal-dl" data-dl="' + i + '" aria-label="Сохранить фото" title="Сохранить фото">' + ic('download') + '</button></div>';
    return '<div class="gal-tile' + (sel ? ' is-sel' : '') + '" role="button" tabindex="0" data-i="' + i + '">' + galThumbHtml(g) + chk +
        (view === 'large' ? '<span class="cap"><b>' + esc(fmtDateShort(g.date) + ' ' + fmtTime(g.date)) + '</b><span>' + esc(fmtBytes(g.size || 0)) + (g.w ? ' · ' + g.w + '×' + g.h : '') + '</span></span><button type="button" class="icon-btn gal-dl" data-dl="' + i + '" aria-label="Сохранить фото" title="Сохранить фото">' + ic('download') + '</button>' : '') + '</div>';
}
function galCrumbsHtml() {
    const parts = ['<button type="button" class="gal-crumb" data-p="0">' + ic('photo_library') + 'Мое_совсек</button>'];
    galPath.forEach((k, i) => {
        const last = i === galPath.length - 1, name = galFolderName(galPath.slice(0, i + 1), i);
        parts.push(ic('chevron_right') + (last ? '<span class="gal-crumb is-last">' + esc(name) + '</span>' : '<button type="button" class="gal-crumb" data-p="' + (i + 1) + '">' + esc(name) + '</button>'));
    });
    return (galPath.length ? '<button type="button" class="icon-btn gal-back" data-p="' + (galPath.length - 1) + '" aria-label="Назад" title="Назад">' + ic('arrow_back') + '</button>' : '') + '<span class="gal-trail">' + parts.join('') + '</span>';
}
function galRenderCard() {
    const card = $('#gal-card'); if (!card) return;
    const gifs = gallery.filter(g => g.kind === 'gif').length, photos = gallery.length - gifs;
    $('#gal-badge').textContent = gallery.length ? String(gallery.length) : '';
    let sync = '';
    if (typeof googleInfo === 'function') {
        const gi = googleInfo();
        sync = !gi.user ? ' Чтобы фото были на всех устройствах, подключите Google Диск (Настройки).' : !gi.cfg.media ? ' Синхронизация вложений выключена в настройках Google Диска — фото остаются только на этом устройстве.' : ' Фото синхронизируются через Google Диск (папка iLife/Мое_совсек).';
    }
    $('#gal-status').textContent = (gallery.length ? 'В библиотеке: ' + photos + ' фото' + (gifs ? ' и ' + gifs + ' GIF' : '') + ' · ' + fmtBytes(galBytes(gallery)) + '.' : 'Пока пусто. Выберите экспорт Telegram: фото разложатся по папкам год → месяц → день, GIF — в отдельную папку.') + sync;
    $('#gal-import').disabled = galBusy;
    const has = mvHasAi(), sw = $('#gal-ai');
    sw.checked = !!galUi.ai && has; sw.disabled = !has;
    $('#gal-ai-row').classList.toggle('is-disabled', !has);
    $('#gal-ai-sub').textContent = has ? 'Хештеги по тому, что на фото, и имена людей, написанные в подписи или на самой картинке. По лицам ИИ людей не определяет. Уменьшенная копия фото и подпись уходят в вашу ИИ-службу (' + (MV_AI_NAMES[mvCfg().ai] || 'ИИ') + ')'
        : 'Сначала подключите ИИ: Настройки → «Кино: базы и оценки». Без него хештеги берутся из подписей, а актёров можно добавлять вручную';
    const todo = gallery.filter(g => !g.ai).length, run = $('#gal-ai-run');
    run.hidden = !(has && galUi.ai && todo > 0); run.disabled = galBusy; run.innerHTML = ic('auto_awesome') + 'ИИ-разбор (' + todo + ')';
}
function galRenderActs(showFiles, files) {
    const el = $('#gal-acts'); if (!el) return;
    if (galSel) {
        el.innerHTML = '<div class="gal-selbar"><b>Выбрано: ' + galSel.size + '</b><span class="gal-sp"></span>' +
            '<button type="button" class="btn btn-text" data-a="all">' + ic('done_all') + 'Все</button>' +
            '<button type="button" class="btn" data-a="save"' + (galSel.size ? '' : ' disabled') + '>' + ic('download') + 'Сохранить</button>' +
            '<button type="button" class="btn" data-a="edit"' + (galSel.size ? '' : ' disabled') + '>' + ic('edit') + 'Хештеги и актёры</button>' +
            '<button type="button" class="btn btn-danger" data-a="del"' + (galSel.size ? '' : ' disabled') + '>' + ic('delete') + 'Удалить</button>' +
            '<button type="button" class="btn btn-text" data-a="done">Готово</button></div>';
        return;
    }
    const items = galItems(galPath), b = [];
    b.push('<span class="gal-info">' + esc(galCountText(items.length, galPath[0] === 'gif') + (items.length ? ' · ' + fmtBytes(galBytes(items)) : '')) + '</span><span class="gal-sp"></span>');
    const todoAi = gallery.filter(g => !g.ai).length;
    if (!galPath.length && todoAi && galUi.ai && mvHasAi()) b.push('<button type="button" class="btn" data-a="ai">' + ic('auto_awesome') + 'ИИ-разбор (' + todoAi + ')</button>');
    if (galPath.length && !galIsLeaf(galPath) && items.length) b.push('<button type="button" class="btn' + (galFlat ? ' btn-primary' : '') + '" data-a="flat" aria-pressed="' + galFlat + '">' + ic(galFlat ? 'folder' : 'photo_library') + (galFlat ? 'Показать папки' : 'Все фото внутри') + '</button>');
    if (showFiles && files.length) b.push('<button type="button" class="btn" data-a="select">' + ic('check_box') + 'Выбрать</button>');
    if (items.length) b.push('<button type="button" class="btn btn-primary" data-a="savefolder">' + ic('download') + (galPath.length ? 'Сохранить папку' : 'Сохранить всё') + '</button>');
    el.innerHTML = b.join('');
}
function galRenderBody() {
    const body = $('#gal-body'); if (!body) return;
    $('#gal-crumbs').innerHTML = galCrumbsHtml();
    $$('#gal-view [data-v]').forEach(b => b.classList.toggle('is-on', b.dataset.v === galUi.view));
    $('#gal-sort').value = galUi.sort;
    const showFiles = galIsLeaf(galPath) || (galFlat && galPath.length > 0), items = galItems(galPath);
    const folders = showFiles ? [] : galFolders(galPath, items), files = showFiles ? galSortFiles(items) : [];
    galCur = { folders, files };
    galRenderActs(showFiles, files);
    const view = galUi.view;
    let html = '';
    if (!showFiles) {
        if (!gallery.length) html = '<div class="gal-empty-state">' + ic('photo_library') + '<b>Здесь будут ваши фото и GIF</b><span>Нажмите «Выбрать экспорт» в блоке выше — папки появятся сами.</span></div>';
        else if (!folders.length) html = '<div class="gal-empty-state">' + ic('folder_open') + '<b>В этой папке пока пусто</b></div>';
        else html = '<div class="gal-' + (view === 'list' ? 'list' : 'grid') + ' gal-v-' + view + '">' + folders.map((f, i) => galFolderHtml(f, i, view)).join('') + '</div>';
    } else {
        if (!files.length) html = '<div class="gal-empty-state">' + ic('folder_open') + '<b>В этой папке пока пусто</b></div>';
        else {
            const shown = files.slice(0, galLimit);
            html = '<div class="gal-' + (view === 'list' ? 'list' : 'grid') + ' gal-v-' + view + '">' + shown.map((g, i) => galFileHtml(g, i, view)).join('') + '</div>' +
                (files.length > shown.length ? '<div class="gal-more"><button type="button" class="btn" data-a="more">Показать ещё (' + (files.length - shown.length) + ')</button></div>' : '');
        }
    }
    body.innerHTML = html;
    galHydrate(body);
}
function galHydrate(root) {
    if (galIo) { galIo.disconnect(); galIo = null; }
    const imgs = $$('img[data-gid]', root);
    const load = async im => {
        const u = await BlobDB.url(im.dataset.gid, 'thumb');
        if (u) { im.src = u; im.addEventListener('error', () => im.closest('.gal-th').classList.add('is-missing'), { once: true }); }
        else im.closest('.gal-th').classList.add('is-missing');
    };
    if (typeof IntersectionObserver === 'undefined') { imgs.forEach(load); return; }
    galIo = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { galIo.unobserve(e.target); load(e.target); } }), { rootMargin: '400px' });
    imgs.forEach(im => galIo.observe(im));
}
function renderGallery() { if (!$('#sovsek')) return; galRenderCard(); galRenderBody(); }
function galRefreshIfOpen() { const t = $('#sovsek'); if (t && t.classList.contains('is-active') && !galBusy) renderGallery(); else if (t) galRenderCard(); }
function galOpen(path) {
    galPath = path; galFlat = false; galLimit = GAL_PAGE; galSel = null;
    galRenderBody();
    const bar = $('#gal-bar'); if (bar && bar.getBoundingClientRect().top < 0) bar.scrollIntoView({ block: 'start' });
}

// ---------- ZIP (без сжатия: фото и так сжаты) ----------
const galCrcTable = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
async function galCrcBlob(blob) {
    let c = 0xFFFFFFFF;
    for (let off = 0; off < blob.size; off += 4194304) {
        const u = new Uint8Array(await blob.slice(off, off + 4194304).arrayBuffer());
        for (let i = 0; i < u.length; i++) c = galCrcTable[(c ^ u[i]) & 255] ^ (c >>> 8);
    }
    return (c ^ 0xFFFFFFFF) >>> 0;
}
function galDos(ms) { const p = almatyParts(ms || Date.now()), y = Math.max(1980, p.y); return { t: (p.h << 11) | (p.mi << 5) | (p.s >> 1), d: ((y - 1980) << 9) | ((p.mo + 1) << 5) | p.d }; }
async function galZip(files, onProgress) {
    const enc = new TextEncoder(), parts = [], central = []; let offset = 0, cdSize = 0;
    for (let n = 0; n < files.length; n++) {
        const f = files[n], name = enc.encode(f.path), size = f.blob.size, crc = await galCrcBlob(f.blob), dos = galDos(f.date);
        const lh = new DataView(new ArrayBuffer(30));
        lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true); lh.setUint16(8, 0, true); lh.setUint16(10, dos.t, true); lh.setUint16(12, dos.d, true);
        lh.setUint32(14, crc, true); lh.setUint32(18, size, true); lh.setUint32(22, size, true); lh.setUint16(26, name.length, true); lh.setUint16(28, 0, true);
        parts.push(lh.buffer, name, f.blob);
        const ch = new DataView(new ArrayBuffer(46));
        ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true); ch.setUint16(10, 0, true); ch.setUint16(12, dos.t, true); ch.setUint16(14, dos.d, true);
        ch.setUint32(16, crc, true); ch.setUint32(20, size, true); ch.setUint32(24, size, true); ch.setUint16(28, name.length, true); ch.setUint32(42, offset, true);
        central.push(ch.buffer, name); cdSize += 46 + name.length;
        offset += 30 + name.length + size;
        if (onProgress) onProgress(n + 1, files.length);
        if (n % 20 === 19) await galSleep(0);
    }
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true); end.setUint32(12, cdSize, true); end.setUint32(16, offset, true);
    return new Blob(parts.concat(central, [end.buffer]), { type: 'application/zip' });
}

// ---------- Сохранение: фото, папка, выбранное ----------
function galDirOf(path, g) {   // подпапки внутри сохраняемой папки
    const r = path[0]; if (r !== 'img' && r !== 'gif') return [];
    const p = galParts(g), dirs = [String(p.y), pad2(p.mo + 1) + ' ' + MONTHS_NOM[p.mo], pad2(p.d)];
    return dirs.slice(Math.max(0, path.length - 1));
}
function galSavePlan(path) {
    const entries = [], add = (items, top, sub) => items.forEach(g => entries.push({ g, dir: [top].concat(sub(g)).filter(Boolean) }));
    if (!path.length) {
        ['img', 'gif'].forEach(r => add(galItems([r]), 'Мое_совсек/' + (r === 'gif' ? 'GIF' : 'Картинки'), g => galDirOf([r], g)));
        return { entries, zipName: 'Мое_совсек' };
    }
    const r = path[0], date = r === 'img' || r === 'gif';
    const top = date ? (path.length === 1 ? galFolderName(path, 0) : path.slice(1).join('-')) : galFolderName(path, path.length - 1).replace(/^#/, '');
    add(galItems(path), galSafe(top), g => galDirOf(path, g));
    return { entries, zipName: 'Мое_совсек_' + path.map((k, i) => galFolderName(path.slice(0, i + 1), i).replace(/^#/, '')).map(galSafe).join('_') };
}
async function galSaveEntries(entries, zipName) {
    if (!entries.length) { toast('В этой папке пока нет фото'); return; }
    if (galBusy) { toast('Уже идёт обработка — подождите'); return; }
    galBusy = true;
    const ui = galProgressSheet('Собираем архив');
    try {
        // имена внутри папок уникальны
        const used = new Set(), files = []; let missing = 0;
        for (let n = 0; n < entries.length; n++) {
            if (ui.ctl.stop) break;
            const e = entries[n], rec = await BlobDB.get(e.g.id);
            ui.set('Читаем файлы: ' + (n + 1) + ' из ' + entries.length, 0.3 * n / entries.length);
            if (!rec || !rec.blob) { missing++; continue; }
            let base = galFileName(e.g), path = e.dir.map(galSafe).join('/') + (e.dir.length ? '/' : '') + base, k = 1;
            const m = /^(.*?)(\.[^.]*)?$/.exec(base);
            while (used.has(path.toLowerCase())) path = e.dir.map(galSafe).join('/') + (e.dir.length ? '/' : '') + m[1] + ' (' + (++k) + ')' + (m[2] || '');
            used.add(path.toLowerCase());
            files.push({ path, blob: rec.blob.type === (rec.type || rec.blob.type) ? rec.blob : new Blob([rec.blob], { type: rec.type }), date: e.g.date });
        }
        if (ui.ctl.stop) { toast('Сохранение остановлено'); return; }
        if (!files.length) { toast(missing ? 'Файлы ещё не скачаны с Google Диска — подождите синхронизации' : 'Нечего сохранять', { ms: 5000 }); return; }
        // части по размеру
        const partsList = []; let cur = [], curSize = 0;
        files.forEach(f => { if (cur.length && (curSize + f.blob.size > GAL_ZIP_PART || cur.length >= 60000)) { partsList.push(cur); cur = []; curSize = 0; } cur.push(f); curSize += f.blob.size; });
        if (cur.length) partsList.push(cur);
        let last = '';
        for (let p = 0; p < partsList.length; p++) {
            const part = partsList[p];
            if (part.length === 1 && partsList.length === 1 && entries.length === 1) {   // одно фото — само фото
                last = await deliverFile(part[0].blob, part[0].path.split('/').pop()); break;
            }
            const zip = await galZip(part, (d, t) => { if (!ui.ctl.stop) ui.set('Собираем архив' + (partsList.length > 1 ? ' (часть ' + (p + 1) + ' из ' + partsList.length + ')' : '') + ': ' + d + ' из ' + t, 0.3 + 0.7 * ((p + d / t) / partsList.length)); });
            last = await deliverFile(zip, zipName + (partsList.length > 1 ? '_часть' + (p + 1) : '') + '.zip');
            if (last === 'unsupported') break;
        }
        ui.close();
        toast(last === 'unsupported' ? 'В этом приложении сохранить файл нельзя — откройте iLife в браузере' : last === 'shared' ? 'Готово — выберите, куда отправить' : 'Сохранено файлов: ' + files.length + (partsList.length > 1 ? ' (архивов: ' + partsList.length + ')' : '') + (missing ? ' · ещё не скачано с Диска: ' + missing : ''), { ms: 5000 });
    } catch (e) { console.error(e); toast('Не удалось сохранить: ' + (e && e.message ? e.message : e), { ms: 6000 }); }
    finally { ui.close(); galBusy = false; galRenderCard(); }
}
function galSaveFolder(path) { const plan = galSavePlan(path); return galSaveEntries(plan.entries, plan.zipName); }
function galSaveOne(g) { return galSaveEntries([{ g, dir: [] }], 'Мое_совсек_фото'); }
function galSaveSelected(ids) { const set = new Set(ids); return galSaveEntries(gallery.filter(g => set.has(g.id)).map(g => ({ g, dir: [] })), 'Мое_совсек_выбранные'); }

// ---------- Правка: хештеги, актёры; удаление ----------
function galEditSheet(items, after) {
    const one = items.length === 1, g = items[0];
    const tags = one ? (g.tags || []).join(' ') : '', actors = one ? (g.actors || []).join(', ') : '';
    const dlA = '<datalist id="gal-dl-actors">' + galKnownActors().map(a => '<option value="' + esc(a) + '">').join('') + '</datalist>';
    const dlT = '<datalist id="gal-dl-tags">' + galKnownTags().slice(0, 60).map(t => '<option value="' + esc(t) + '">').join('') + '</datalist>';
    const head = one ? '<div class="gal-edit-head">' + galThumbHtml(g) + '<span class="hint">' + esc(galTitle(g) + ' · ' + (g.w ? g.w + '×' + g.h + ' · ' : '') + fmtBytes(g.size || 0)) + (g.cap ? '<br>' + esc(g.cap.slice(0, 200)) : '') + '</span></div>'
        : '<p class="hint" style="margin:0 4px 8px">Выбрано фото: ' + items.length + '. Введённое ниже будет добавлено ко всем.</p>';
    const sheet = openSheet({
        title: one ? 'Хештеги и актёры' : 'Хештеги и актёры (' + items.length + ')',
        html: head + '<label class="field-label" for="gal-e-tags">Хештеги (через пробел)</label><input type="text" id="gal-e-tags" list="gal-dl-tags" value="' + esc(tags) + '" placeholder="природа лето" autocomplete="off">' + dlT +
            '<label class="field-label" for="gal-e-actors" style="margin-top:0.75rem">Актёры и известные люди (через запятую)</label><input type="text" id="gal-e-actors" list="gal-dl-actors" value="' + esc(actors) + '" placeholder="Имя Фамилия" autocomplete="off">' + dlA +
            '<p class="hint" style="margin:0.5rem 4px 0">Людей по лицу приложение не определяет — укажите имя сами, и фото появится в папке «Актёры».</p>',
        actions: [{ label: 'Отмена' }, { label: 'Сохранить', kind: 'primary', icon: 'check', onClick(api) {
            const t = parseTagString($('#gal-e-tags', api.el).value), a = galParseActors($('#gal-e-actors', api.el).value);
            items.forEach(x => { x.tags = one ? t : galUniq((x.tags || []).concat(t)); x.actors = one ? a : galUniq((x.actors || []).concat(a)); });
            saveGallery(); galRenderCard(); galRenderBody(); if (after) after();
            toast('Сохранено');
        } }]
    });
    galHydrate(sheet.el);
}
async function galDelete(items, after) {
    if (!items.length) return false;
    const ok = await confirmSheet(items.length === 1 ? 'Удалить фото?' : 'Удалить фото: ' + items.length + '?', 'Они пропадут из «Мое_совсек» на всех ваших устройствах. Файлы в экспорте Telegram не затрагиваются.', 'Удалить', true);
    if (!ok) return false;
    const ids = new Set(items.map(g => g.id));
    gallery = gallery.filter(g => !ids.has(g.id));
    saveGallery();
    for (const id of ids) await BlobDB.del(id);
    if (galSel) { ids.forEach(id => galSel.delete(id)); }
    galRenderCard(); galRenderBody(); if (after) after();
    toast(items.length === 1 ? 'Фото удалено' : 'Удалено фото: ' + items.length);
    return true;
}

// ---------- Просмотр ----------
let galViewer = null;
function galCloseViewer() {
    if (!galViewer) return;
    document.removeEventListener('keydown', galViewer.key); galViewer.el.remove(); galViewer = null;
    if (!sheetStack.length) document.body.classList.remove('is-locked');
}
async function galOpenViewer(list, index) {
    galCloseViewer();
    if (!list.length) return;
    let i = Math.max(0, Math.min(index || 0, list.length - 1));
    const el = document.createElement('div');
    el.className = 'lightbox gal-viewer'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-label', 'Просмотр фото');
    el.innerHTML = '<img alt=""><div class="gal-vmiss" hidden>' + ic('cloud_download') + '<span>Файл ещё не скачан с Google Диска. Подождите синхронизации.</span></div>' +
        '<div class="gal-vtop"><span class="gal-vcount"></span><span class="gal-sp"></span>' +
        '<button type="button" class="lb-btn" data-v="save" aria-label="Сохранить фото" title="Сохранить фото">' + ic('download') + '</button>' +
        '<button type="button" class="lb-btn" data-v="edit" aria-label="Хештеги и актёры" title="Хештеги и актёры">' + ic('tag') + '</button>' +
        '<button type="button" class="lb-btn" data-v="del" aria-label="Удалить фото" title="Удалить фото">' + ic('delete') + '</button>' +
        '<button type="button" class="lb-btn" data-v="close" aria-label="Закрыть" title="Закрыть">' + ic('close') + '</button></div>' +
        (list.length > 1 ? '<button type="button" class="lb-btn lb-prev" data-v="prev" aria-label="Назад">' + ic('chevron_left') + '</button><button type="button" class="lb-btn lb-next" data-v="next" aria-label="Вперёд">' + ic('chevron_right') + '</button>' : '') +
        '<div class="gal-vinfo"></div>';
    document.body.appendChild(el); document.body.classList.add('is-locked');
    const img = $('img', el), miss = $('.gal-vmiss', el);
    const show = async () => {
        const g = list[i];
        $('.gal-vcount', el).textContent = (i + 1) + ' / ' + list.length;
        $('.gal-vinfo', el).innerHTML = '<b>' + esc(galTitle(g)) + '</b><span>' + esc(galFileMeta(g)) + '</span>' + (g.cap ? '<span class="cap">' + esc(g.cap.slice(0, 300)) + '</span>' : '');
        img.removeAttribute('src');
        const u = await BlobDB.url(g.id);
        if (list[i] !== g) return;
        miss.hidden = !!u; img.hidden = !u; if (u) img.src = u;
    };
    const go = d => { i = (i + d + list.length) % list.length; show(); };
    const closeAndKeep = () => galCloseViewer();
    el.addEventListener('click', async e => {
        const b = e.target.closest('[data-v]'); if (!b) { if (e.target === el) closeAndKeep(); return; }
        const act = b.dataset.v, g = list[i];
        if (act === 'close') closeAndKeep();
        else if (act === 'prev') go(-1); else if (act === 'next') go(1);
        else if (act === 'save') galSaveOne(g);
        else if (act === 'edit') galEditSheet([g], show);
        else if (act === 'del') await galDelete([g], () => { list.splice(i, 1); if (!list.length) { closeAndKeep(); return; } if (i >= list.length) i = list.length - 1; show(); });
    });
    let sx = null;
    el.addEventListener('touchstart', e => { sx = e.touches[0].clientX; }, { passive: true });
    el.addEventListener('touchend', e => { if (sx === null || list.length < 2) return; const dx = e.changedTouches[0].clientX - sx; if (Math.abs(dx) > 50) go(dx < 0 ? 1 : -1); sx = null; }, { passive: true });
    galViewer = { el, key(e) { if (sheetStack.length) return; if (e.key === 'Escape') closeAndKeep(); else if (e.key === 'ArrowRight' && list.length > 1) go(1); else if (e.key === 'ArrowLeft' && list.length > 1) go(-1); } };
    document.addEventListener('keydown', galViewer.key);
    show();
}

// ---------- События ----------
function galToggleSel(g, tile) {
    if (galSel.has(g.id)) galSel.delete(g.id); else galSel.add(g.id);
    if (tile) tile.classList.toggle('is-sel', galSel.has(g.id));
    galRenderActs(true, galCur.files);
}
function initGallery() {
    if (!$('#sovsek')) return;
    const fi = $('#gal-file');
    $('#gal-import').addEventListener('click', () => { fi.value = ''; fi.click(); });
    fi.addEventListener('change', () => { const picked = Array.from(fi.files || []); fi.value = ''; galImportFiles(picked); });
    const card = $('#gal-card');
    ['dragenter', 'dragover'].forEach(ev => card.addEventListener(ev, e => { if (e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files')) { e.preventDefault(); card.classList.add('tg-card-dragging'); } }));
    ['dragleave', 'drop'].forEach(ev => card.addEventListener(ev, () => card.classList.remove('tg-card-dragging')));
    card.addEventListener('drop', e => { if (e.dataTransfer && e.dataTransfer.files.length) { e.preventDefault(); galImportFiles(e.dataTransfer.files); } });
    $('#gal-ai').addEventListener('change', e => { galUi.ai = e.target.checked; galUiSave(); galRenderCard(); toast(e.target.checked ? 'ИИ будет подбирать хештеги и имена' : 'ИИ выключен'); });
    $('#gal-ai-run').addEventListener('click', galAiRun);
    $('#gal-save-all').addEventListener('click', () => galSaveFolder([]));
    $('#gal-view').addEventListener('click', e => { const b = e.target.closest('[data-v]'); if (!b) return; galUi.view = b.dataset.v; galUiSave(); galRenderBody(); });
    $('#gal-sort').addEventListener('change', e => { galUi.sort = e.target.value; galUiSave(); galRenderBody(); });
    $('#gal-crumbs').addEventListener('click', e => { const b = e.target.closest('[data-p]'); if (b) galOpen(galPath.slice(0, +b.dataset.p)); });
    $('#gal-acts').addEventListener('click', async e => {
        const b = e.target.closest('[data-a]'); if (!b) return;
        const a = b.dataset.a;
        if (a === 'savefolder') galSaveFolder(galPath);
        else if (a === 'ai') galAiRun();
        else if (a === 'flat') { galFlat = !galFlat; galLimit = GAL_PAGE; galRenderBody(); }
        else if (a === 'select') { galSel = new Set(); galRenderBody(); }
        else if (a === 'done') { galSel = null; galRenderBody(); }
        else if (a === 'all') { galCur.files.forEach(g => galSel.add(g.id)); galRenderBody(); }
        else if (a === 'save') galSaveSelected(Array.from(galSel));
        else if (a === 'edit') galEditSheet(gallery.filter(g => galSel.has(g.id)), () => { galSel = null; galRenderBody(); });
        else if (a === 'del') { const items = gallery.filter(g => galSel.has(g.id)); if (await galDelete(items)) { galSel = null; galRenderBody(); } }
    });
    const body = $('#gal-body');
    const act = e => {
        const more = e.target.closest('[data-a="more"]'); if (more) { galLimit += GAL_PAGE; galRenderBody(); return; }
        const sv = e.target.closest('[data-save]'); if (sv) { e.stopPropagation(); const f = galCur.folders[+sv.dataset.save]; if (f) galSaveFolder(galPath.concat(f.key)); return; }
        const dl = e.target.closest('[data-dl]'); if (dl) { e.stopPropagation(); const g = galCur.files[+dl.dataset.dl]; if (g) galSaveOne(g); return; }
        const fo = e.target.closest('[data-f]'); if (fo) { const f = galCur.folders[+fo.dataset.f]; if (f) galOpen(galPath.concat(f.key)); return; }
        const fl = e.target.closest('[data-i]'); if (fl) {
            const g = galCur.files[+fl.dataset.i]; if (!g) return;
            if (galSel) galToggleSel(g, fl); else galOpenViewer(galCur.files.slice(), +fl.dataset.i);
        }
    };
    body.addEventListener('click', act);
    body.addEventListener('keydown', e => { if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('[role="button"]')) { e.preventDefault(); act(e); } });
    renderGallery();
}
