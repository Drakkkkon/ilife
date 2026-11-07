'use strict';
// =====================================================================================================
// iLife — МОЕ_СОВСЕК: фото, GIF и видео из экспорта Telegram. Две страницы («Фото и GIF», «Видео») с ОДНОЙ и той же логикой:
// каждая страница — отдельный экземпляр, созданный функцией createGalSection(cfg) (ниже), со своим списком и своими папками.
//
// • Импорт: ZIP / result.json / messages.html (или просто файлы). Разбор экспорта — те же функции, что у блока «Telegram-канал»
//   на странице «Идеи» (telegram.js).
// • Превью (с 1.6.0): уменьшенные копии из экспорта («…_thumb.jpg» рядом с фото, «…mp4_thumb.jpg» у видео) НЕ выбрасываются:
//   они становятся превью — значками в папках и сетке. Слишком большие превью (крупнее 480 px или тяжелее ~90 КБ) приводятся
//   к JPEG 480 px. Нет превью в экспорте — оно делается из самого файла (у видео — кадр).
// • Хранение: в IndexedDB (BlobDB) лежит запись { blob (оригинал, может быть null), thumb (превью) }. Синхронизация между
//   устройствами передаёт ПРЕВЬЮ (папка Диска iLife/Мое_совсек_превью), а оригиналы — по требованию: при просмотре, кнопкой
//   «Скачать все» или при сохранении папки. «Очистить кеш» убирает оригиналы с устройства, но не с Диска (gdrive.js).
// • Копии хуже качеством (только у фото) отбрасываются: «тот же снимок, но меньше» (отпечаток dHash и пропорции).
// • Папки — виртуальные (файлы не дублируются): Картинки|Видео / GIF|Анимации — год/месяц/день, Актёры/Имя, Хештеги/тег.
// • Актёров по лицам приложение НЕ определяет: имя берётся из подписи, из текста на картинке (ИИ только читает текст) или вручную.
// • Данные: списки `gallery` (фото) и `videos` (видео) — метаданные (ключи ilife_gallery, ilife_videos) уходят на Google Диск
//   вместе с остальными данными (gdrive.js).
// =====================================================================================================

let gallery = LS.get('gallery', []);
if (!Array.isArray(gallery)) gallery = [];
let videos = LS.get('videos', []);
if (!Array.isArray(videos)) videos = [];
function saveGallery() { if (typeof cloudLocalChanged === 'function') cloudLocalChanged(); return LS.set('gallery', gallery); }
function saveVideos() { if (typeof cloudLocalChanged === 'function') cloudLocalChanged(); return LS.set('videos', videos); }

const GAL_PAGE = 120;                       // сколько плиток показывать за раз
const GAL_ZIP_PART = 1200 * 1048576;        // один архив не больше ~1,2 ГБ (иначе несколько частей)
const GAL_AI_PAUSE = { gemini: 4300, claude: 1200 };   // пауза между запросами к ИИ (у бесплатного Gemini ~15 запросов в минуту)
const GAL_NOTAG = '~без-хештегов';
const GAL_THUMB_SIDE = 480;                 // превью: длинная сторона не больше
const GAL_THUMB_KEEP = 90 * 1024;           // превью легче этого и не крупнее GAL_THUMB_SIDE — берём как есть
const GAL_VIDEO_RE = /\.(mp4|mov|webm|mkv|avi|m4v)$/i;

// ---------- Мелочи (общие для обеих страниц) ----------
const galSleep = ms => new Promise(r => setTimeout(r, ms));
const galMonthName = mo => capitalizeFirst(MONTHS_NOM[mo]);
const galSafe = s => String(s || '').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '_').replace(/^\.+/, '').trim().slice(0, 90) || '_';
const galUniq = a => Array.from(new Set(a));
const galBytes = arr => arr.reduce((s, g) => s + (Number(g.size) || 0), 0);
function galParts(g) { return almatyParts(g.date || 0); }
function galNormActor(s) { return String(s || '').replace(/\s+/g, ' ').trim().split(' ').map(w => w ? w.charAt(0).toLocaleUpperCase('ru-RU') + w.slice(1) : w).join(' ').slice(0, 60); }
function galParseActors(str) { return galUniq(String(str || '').split(/[,;\n]+/).map(galNormActor).filter(Boolean)).slice(0, 20); }
function galTgDate(name) {   // photo_1@14-03-2025_12-30-00.jpg → мс (время экспортёра принимаем за алматинское)
    const m = /@(\d{2})-(\d{2})-(\d{4})_(\d{2})-(\d{2})-(\d{2})/.exec(name || ''); if (!m) return 0;
    return Date.UTC(+m[3], +m[2] - 1, +m[1], +m[4], +m[5], +m[6]) - ALMATY_UTC_OFFSET_HOURS * 3600000;
}
function galMimeOf(blob, c, def) {
    const t = blob && blob.type && blob.type !== 'application/octet-stream' ? blob.type : '';
    return t || (c && c.mime && c.mime !== 'application/octet-stream' ? c.mime : '') || tgMimeByName(c && c.name) || def || 'image/jpeg';
}
function galIsImageName(n) { return /\.(jpe?g|png|webp|gif|bmp)$/i.test(n || ''); }
function galIsVideoName(n) { return GAL_VIDEO_RE.test(n || ''); }
function galIsVidMedia(x) { return x.kind === 'file' && (/^video\//.test(x.mime || '') || galIsVideoName(x.name || x.path)); }
function galPlural(n, one, few, many) { const a = Math.abs(n) % 100, b = a % 10; return a > 10 && a < 20 ? many : b > 1 && b < 5 ? few : b === 1 ? one : many; }

// ---------- Превью из экспорта Telegram ----------
// Все пути «…_thumb…», которыми Telegram мог подписать уменьшенную копию файла path
function galThumbPaths(path, hint) {
    const p = String(path || ''), out = [];
    if (hint && !/^\(.*\)$/.test(String(hint).trim())) out.push(String(hint));
    out.push(p.replace(/(\.[a-z0-9]+)$/i, '_thumb$1'), p.replace(/\.[a-z0-9]+$/i, '_thumb.jpg'), p + '_thumb.jpg');
    return galUniq(out.filter(x => x && x !== p));
}
function galFindThumbEntry(resolve, path, hint) {
    const own = resolve(path);
    for (const c of galThumbPaths(path, hint)) { const e = resolve(c); if (e && e !== own) return e; }
    return null;
}
// Если entry — это превью другого файла из экспорта, вернёт файл-владельца
function galThumbOwner(resolve, entry) {
    const p = String(entry.path || ''); if (!/_thumb\.[a-z0-9]+$/i.test(p)) return null;
    const cands = [p.replace(/_thumb(\.[a-z0-9]+)$/i, '$1'), p.replace(/_thumb\.[a-z0-9]+$/i, '')];
    ['jpg', 'jpeg', 'png', 'webp', 'gif'].forEach(x => cands.push(p.replace(/_thumb\.[a-z0-9]+$/i, '.' + x)));
    for (const c of cands) { const e = resolve(c); if (e && e !== entry) return e; }
    return null;
}
// Превью → JPEG не крупнее GAL_THUMB_SIDE и не тяжелее GAL_THUMB_KEEP (если нужно — пережимаем). Возвращает { blob, converted } или null
async function galFitThumb(blob) {
    if (!blob || !blob.size) return null;
    let bmp; try { bmp = await decodeImage(blob); } catch (e) { return null; }
    const { w, h } = bitmapSize(bmp);
    if (Math.max(w, h) <= GAL_THUMB_SIDE && blob.size <= GAL_THUMB_KEEP && (blob.type === 'image/jpeg' || !blob.type)) {
        if (bmp.close) try { bmp.close(); } catch (e) {}
        return { blob: blob.type ? blob : new Blob([blob], { type: 'image/jpeg' }), converted: false };
    }
    let r = await canvasBlob(bmp, w, h, GAL_THUMB_SIDE, 0.8);
    if (r.blob && r.blob.size > GAL_THUMB_KEEP * 1.6) r = await canvasBlob(bmp, w, h, GAL_THUMB_SIDE, 0.62);
    if (bmp.close) try { bmp.close(); } catch (e) {}
    return r.blob ? { blob: r.blob, converted: true } : null;
}
// Видео: размеры, длительность и (по желанию) кадр-превью, считанные самим браузером. Если формат не поддерживается — пусто.
function galVideoProbe(blob, wantPoster) {
    return new Promise(resolve => {
        const url = URL.createObjectURL(blob), v = document.createElement('video'); let done = false, tm = 0;
        const fin = r => { if (done) return; done = true; clearTimeout(tm); try { v.removeAttribute('src'); v.load(); } catch (e) {} URL.revokeObjectURL(url); resolve(r || {}); };
        tm = setTimeout(() => fin({}), 12000);
        v.muted = true; v.preload = 'auto'; v.playsInline = true;
        v.onerror = () => fin({});
        v.onloadedmetadata = () => {
            const info = { w: v.videoWidth || 0, h: v.videoHeight || 0, dur: isFinite(v.duration) ? v.duration : 0 };
            if (!wantPoster || !info.w) { fin(info); return; }
            v.onseeked = () => {
                try {
                    const k = Math.min(1, GAL_THUMB_SIDE / Math.max(info.w, info.h)), c = document.createElement('canvas');
                    c.width = Math.max(1, Math.round(info.w * k)); c.height = Math.max(1, Math.round(info.h * k));
                    c.getContext('2d').drawImage(v, 0, 0, c.width, c.height);
                    c.toBlob(b => { info.poster = b; fin(info); }, 'image/jpeg', 0.8);
                } catch (e) { fin(info); }
            };
            try { v.currentTime = Math.min(1, (info.dur || 2) / 3); } catch (e) { fin(info); }
        };
        v.src = url;
    });
}

// ---------- Отпечаток картинки (dHash) и миниатюра (только фото) ----------
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
    const t = await canvasBlob(bmp, w, h, GAL_THUMB_SIDE, 0.8);
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

// ---------- Окно хода работы ----------
function galProgressSheet(title) {
    const ctl = { stop: false };
    const sheet = openSheet({
        title, html: '<div class="tg-prog"><div class="lbl" data-l>Подготовка…</div><div class="progress"><i data-b></i></div></div>',
        actions: [{ label: 'Остановить', icon: 'close', onClick: () => { ctl.stop = true; const l = $('[data-l]', sheet.el); if (l) l.textContent = 'Останавливаем…'; return false; } }],
        onClose: () => { ctl.stop = true; }
    });
    return { ctl, sheet, set(label, frac) { const l = $('[data-l]', sheet.el), b = $('[data-b]', sheet.el); if (l && !ctl.stop) l.textContent = label; if (b) b.style.width = Math.round(Math.max(0, Math.min(1, frac || 0)) * 100) + '%'; }, close() { sheet.close(); } };
}

// ---------- ИИ: хештеги по содержанию и имена из текста ----------
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
async function galSmallJpeg(blob) {
    const bmp = await decodeImage(blob), { w, h } = bitmapSize(bmp), r = await canvasBlob(bmp, w, h, 768, 0.8);
    if (bmp.close) try { bmp.close(); } catch (e) {}
    return r.blob;
}

// ---------- ZIP (без сжатия: фото и видео и так сжаты) ----------
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

// =====================================================================================================
// СТРАНИЦА (экземпляр): всё, что зависит от списка, — внутри. cfg описывает отличия фото от видео.
// =====================================================================================================
function createGalSection(cfg) {
    const P = cfg.p, K = cfg.key, isVideo = K === 'video';
    const S = n => '#' + P + '-' + n;
    const L = () => cfg.get();
    const W = isVideo ? 'видео' : 'фото';
    const rootOf = key => cfg.roots.find(x => x.key === key);
    const ui = Object.assign({ view: 'large', sort: 'new', ai: false }, LS.get(cfg.uiKey, {}));
    const uiSave = () => LS.set(cfg.uiKey, ui);

    let path = [];            // текущая папка: ['img', '2025', '03', '14'] / ['act', 'Имя'] / ['tag', 'тег'] / []
    let flat = false;         // показывать всё внутри папки одним списком (без подпапок)
    let limit = GAL_PAGE;
    let sel = null;           // Set id при режиме выбора
    let cur = { folders: [], files: [] };
    let busy = false, io = null, viewer = null;
    let local = null;         // Map id → { full, thumb }: что лежит на этом устройстве (null — ещё не узнали)

    // ---------- Что есть на устройстве ----------
    const hasFull = id => !local || !!(local.get(id) || {}).full;
    async function refreshLocal() {
        try { local = await BlobDB.index(); } catch (e) { local = new Map(); }
        paintCloud(); renderCardLine();
    }
    const paintLineSoon = debounce(() => { try { renderCardLine(); } catch (e) {} }, 400);
    function paintCloud() {
        if (!local) return;
        $$(S('body') + ' .gal-th[data-id], .gal-viewer .gal-th[data-id]').forEach(el => el.classList.toggle('is-cloud', !(local.get(el.dataset.id) || {}).full));
    }
    function cloudReady() { if (typeof googleInfo !== 'function') return false; const gi = googleInfo(); return !!(gi.user && gi.cfg.media); }
    function deviceCounts() {
        const items = L(); let full = 0, fullBytes = 0, thumbs = 0;
        items.forEach(g => { const r = local && local.get(g.id); if (!local || (r && r.full)) { full++; fullBytes += Number(g.size) || 0; } if (r && r.thumb) thumbs++; });
        return { total: items.length, full, fullBytes, thumbs };
    }

    // ---------- Имена и подписи ----------
    function ext(g) { const m = /\.([a-z0-9]{2,5})$/i.exec(g.name || ''); return m ? m[1].toLowerCase() : (g.kind === 'gif' ? 'gif' : isVideo ? 'mp4' : 'jpg'); }
    function tgName(g) { return /^(photo|file|animation|image|video)[_-]?\d*@/i.test(g.name || '') || /^(photo|file|video)_\d+/i.test(g.name || '') || !g.name; }
    function fileName(g) {
        if (!tgName(g)) return galSafe(g.name);
        const p = galParts(g);
        return p.y + '-' + pad2(p.mo + 1) + '-' + pad2(p.d) + ' ' + pad2(p.h) + '-' + pad2(p.mi) + '-' + pad2(p.s) + '.' + ext(g);
    }
    function title(g) { const p = galParts(g); return p.d + ' ' + MONTHS_GEN[p.mo] + ' ' + p.y + ', ' + pad2(p.h) + ':' + pad2(p.mi); }
    function countText(n, rootKey) { const r = rootOf(rootKey); return n + ' ' + (r && r.badge ? r.badge : W); }
    function fileMeta(g) {
        const bits = [g.w ? g.w + '×' + g.h : '', g.dur ? fmtDuration(g.dur) : '', fmtBytes(g.size || 0)];
        if ((g.tags || []).length) bits.push(g.tags.slice(0, 3).map(t => '#' + t).join(' '));
        if ((g.actors || []).length) bits.push(g.actors.slice(0, 2).join(', '));
        return bits.filter(Boolean).join(' · ');
    }

    // ---------- Разбор экспорта ----------
    function fromMessages(msgs, chatName, stat, resolve) {
        msgs.sort((a, b) => a.date - b.date || a.id - b.id); tgMarkAlbums(msgs);
        const gcap = new Map(); msgs.forEach(m => { if (m.gid && m.text && !gcap.has(m.gid)) gcap.set(m.gid, m.text); });
        const out = [];
        msgs.forEach(m => m.media.forEach((x, idx) => {
            if (x.kind === 'voice' || x.kind === 'audio') return;
            const vid = galIsVidMedia(x), mine = isVideo ? vid : x.kind === 'image';
            if (!mine) { if (isVideo ? x.kind === 'image' : vid) stat.other++; return; }
            if (x.missing || !x.get) { stat.missing++; return; }
            if (x.size > cfg.fileMax) { stat.big++; return; }
            const key = 'tg:' + m.key + ':' + idx, cap = String(m.text || gcap.get(m.gid) || '').trim().slice(0, 500);
            let kind;
            if (isVideo) kind = x.mt === 'animation' || /^animation_/i.test(x.name || '') ? 'anim' : 'video';
            else kind = x.mime === 'image/gif' || /\.gif$/i.test(x.name || '') ? 'gif' : 'image';
            out.push({ k: key, id: cfg.idp + tgHash(key) + tgHash(key + '~'), kind, name: x.name || (isVideo ? 'video.mp4' : 'photo.jpg'), mime: x.mime, date: m.date || galTgDate(x.name), cap, ch: chatName, get: x.get, size: x.size,
                w: x.w || 0, h: x.h || 0, dur: x.dur || 0, thumbEntry: x.path ? galFindThumbEntry(resolve, x.path, x.thumb) : null });
        }));
        return out;
    }
    function fromLoose(entries, stat, resolve) {
        const out = [];
        entries.forEach(e => {
            const name = String(e.path).split('/').pop(), img = galIsImageName(name), vid = galIsVideoName(name);
            if (!(isVideo ? vid : img)) { if (isVideo ? img && !/_thumb\./i.test(name) : vid) stat.other++; return; }
            if (/_thumb\.[a-z0-9]+$/i.test(name) && galThumbOwner(resolve, e)) return;   // это превью другого файла — подберём его при разборе того файла
            if (e.size > cfg.fileMax) { stat.big++; return; }
            const key = 'f:' + tgHash(e.path) + ':' + e.size, kind = isVideo ? (/^animation_/i.test(name) ? 'anim' : 'video') : (/\.gif$/i.test(name) ? 'gif' : 'image');
            out.push({ k: key, id: cfg.idp + tgHash(key) + tgHash(key + '~'), kind, name, mime: tgMimeByName(name), date: galTgDate(name), cap: '', ch: '', get: e.get, size: e.size, w: 0, h: 0, dur: 0, loose: true, thumbEntry: galFindThumbEntry(resolve, e.path, '') });
        });
        return out;
    }
    async function readSource(entries, stat) {
        const resolve = tgMakeResolver(entries), st = { missing: 0, emptyMedia: 0, notFound: 0 };
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
        if (msgs) { stat.missing += st.missing; return { cands: fromMessages(msgs, name || 'Telegram', stat, resolve), chat: name }; }
        return { cands: fromLoose(entries, stat, resolve), chat: '', loose: true };
    }

    // ---------- Импорт ----------
    function autoActors(item) {   // имена, которые уже есть в «Актёрах», находим в подписи и хештегах
        const names = knownActors(); if (!names.length) return;
        const cap = normText(item.cap || ''), tags = new Set(item.tags || []);
        names.forEach(n => {
            const nn = normText(n);
            if (((cap && cap.includes(nn)) || tags.has(nn.replace(/\s+/g, ''))) && !(item.actors || []).includes(n)) item.actors = (item.actors || []).concat(n);
        });
    }
    function knownActors() { const set = new Set(); L().forEach(g => (g.actors || []).forEach(a => set.add(a))); return Array.from(set).sort((a, b) => a.localeCompare(b, 'ru')); }
    function knownTags() { const m = new Map(); L().forEach(g => (g.tags || []).forEach(t => m.set(t, (m.get(t) || 0) + 1))); return Array.from(m.entries()).sort((a, b) => b[1] - a[1]).map(x => x[0]); }

    // Превью кандидата: из экспорта (если есть и годится) или сделанное самим приложением
    async function exportThumb(c, stat) {
        if (!c.thumbEntry) return null;
        try {
            let tb = await c.thumbEntry.get();
            if (!tb.type) tb = new Blob([tb], { type: tgMimeByName(c.thumbEntry.path) || 'image/jpeg' });
            const f = await galFitThumb(tb);
            if (f) { stat.thumbs++; if (f.converted) stat.thumbsConv++; return f.blob; }
        } catch (e) { console.warn('Превью из экспорта не прочитано', c.name, e); }
        return null;
    }
    async function importFiles(fileList) {
        const files = Array.from(fileList || []); if (!files.length) return;
        if (busy) { toast('Уже идёт обработка — подождите'); return; }
        busy = true; renderCard();
        const ui_ = galProgressSheet(isVideo ? 'Видео из экспорта' : 'Фото из экспорта');
        const stat = { missing: 0, other: 0, thumbs: 0, thumbsConv: 0, noThumb: 0, big: 0, bad: 0, old: 0, tomb: 0, dups: 0, smaller: 0, replaced: 0, added: 0, addedAlt: 0 };
        const run = async () => {
            ui_.set('Читаем экспорт…', 0.02);
            const entries = await tgCollectEntries(files);
            const src = await readSource(entries, stat);
            if (!src) return null;                                   // чат не выбран
            const cands = src.cands;
            if (!cands.length) return { empty: true, stat };
            // 1) смотрим каждый файл: размер в пикселях, отпечаток (фото), превью
            const known = new Set(L().map(g => g.k).filter(Boolean)), knownIds = new Set(L().map(g => g.id));
            const tomb = (typeof gMetaGet === 'function' && gMetaGet().deleted[cfg.dkey]) || {};
            const fresh = [];
            for (let n = 0; n < cands.length; n++) {
                if (ui_.ctl.stop) break;
                const c = cands[n];
                if (known.has(c.k) || knownIds.has(c.id)) { stat.old++; continue; }
                if (tomb[c.id]) { stat.tomb++; continue; }
                ui_.set('Смотрим ' + W + ': ' + (n + 1) + ' из ' + cands.length, 0.05 + 0.6 * n / cands.length);
                try {
                    if (isVideo) {
                        c.thumb = await exportThumb(c, stat);
                        if (!c.date) c.date = Date.now();
                        fresh.push(c);
                    } else {
                        const blob = await c.get();
                        if (blob.size > cfg.fileMax) { stat.big++; continue; }
                        const a = await galAnalyze(blob);
                        c.w = a.w; c.h = a.h; c.sig = a.sig; c.size = blob.size; c._p = galSigParts(a.sig);
                        c.thumb = (await exportThumb(c, stat)) || a.thumb;
                        if (!c.date) c.date = blob.lastModified || Date.now();
                        fresh.push(c);
                    }
                } catch (e) { stat.bad++; console.warn('Файл не прочитан', c.name, e); }
                if (n % 8 === 7) await galSleep(0);
            }
            // 2) оставляем лучшие копии (только фото: тот же кадр в разных разрешениях)
            ui_.set('Отбираем лучшие копии…', 0.68);
            const accepted = [];
            if (isVideo) fresh.forEach(c => accepted.push(c));
            else {
                const order = fresh.slice().sort((a, b) => galBetter(a, b) ? -1 : galBetter(b, a) ? 1 : 0);
                const pool = L().filter(g => g.sig && g.w).map(g => ({ g, w: g.w, h: g.h, size: g.size, sig: g.sig, _p: galSigParts(g.sig) }));
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
            }
            // 3) сохраняем
            accepted.sort((a, b) => a.date - b.date);
            const total = accepted.length, now = Date.now(); let batch = [], saved = 0;
            const flush = () => {
                if (!batch.length) return;
                const b = batch; batch = [];
                const gone = b.map(i => i._replaces).filter(Boolean);
                b.forEach(i => { delete i._replaces; });
                gone.forEach(g => { const ix = L().indexOf(g); if (ix >= 0) L().splice(ix, 1); });
                L().push(...b);
                if (!save()) {
                    b.forEach(i => { const ix = L().indexOf(i); if (ix >= 0) L().splice(ix, 1); });
                    L().push(...gone); b.forEach(i => BlobDB.del(i.id));
                    throw new Error('Не хватило места в памяти браузера — часть файлов не сохранена');
                }
                gone.forEach(g => BlobDB.del(g.id));
                saved += b.length;
            };
            try {
                for (let n = 0; n < total; n++) {
                    if (ui_.ctl.stop) break;
                    const c = accepted[n];
                    ui_.set('Сохраняем: ' + (n + 1) + ' из ' + total, 0.7 + 0.3 * n / Math.max(total, 1));
                    const blob = await c.get(), type = galMimeOf(blob, c, isVideo ? 'video/mp4' : 'image/jpeg');
                    if (isVideo) {   // чего не хватило в экспорте (HTML не хранит размеры и длительность) — узнаём у самого файла
                        if (!c.w || !c.dur || !c.thumb) {
                            const pr = await galVideoProbe(blob, !c.thumb);
                            if (pr.w && !c.w) { c.w = pr.w; c.h = pr.h; }
                            if (pr.dur && !c.dur) c.dur = pr.dur;
                            if (pr.poster && !c.thumb) { const f = await galFitThumb(pr.poster); c.thumb = f ? f.blob : pr.poster; }
                        }
                        if (!c.thumb) stat.noThumb++;
                    }
                    await BlobDB.put({ id: c.id, blob: blob.type === type ? blob : new Blob([blob], { type }), thumb: c.thumb || null, name: c.name, type, size: blob.size });
                    const item = { id: c.id, kind: c.kind, name: c.name, size: blob.size, w: c.w || 0, h: c.h || 0, date: c.date, k: c.k, updatedAt: now };
                    if (c.sig) item.sig = c.sig;
                    if (c.dur) item.dur = Math.round(c.dur);
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
                    autoActors(item);
                    batch.push(item);
                    if (c.kind === 'gif' || c.kind === 'anim') stat.addedAlt++; else stat.added++;
                    if (batch.length >= (isVideo ? 5 : 20)) { flush(); await galSleep(0); }
                }
            } finally { try { flush(); } catch (e) { console.warn(e); } }
            return { stat, stopped: ui_.ctl.stop, saved, chat: src.chat, loose: src.loose };
        };
        let summary = null, failure = null;
        try { summary = await run(); } catch (e) { failure = e; }
        ui_.close(); busy = false;
        await refreshLocal(); renderCard(); renderBody(); renderSwitch();
        if (failure) tgShowError('Не удалось прочитать экспорт', failure);
        else if (summary) {
            if ((summary.saved || 0) > 0 && !LS.get(P + '_card_folded', false)) {   // после первого импорта сворачиваем блок, чтобы папки были сразу на виду (дальше — как решит пользователь)
                LS.set(P + '_card_folded', true);
                const c = $(S('card')); if (c) { c.classList.add('is-collapsed'); collapsedCards.add(P + '-card'); LS.set('collapsed', Array.from(collapsedCards)); }
            }
            summarySheet(summary);
        }
    }
    function summarySheet(sm) {
        const s = sm.stat, lines = [];
        const add = (icon, t) => lines.push('<li>' + ic(icon) + '<span>' + t + '</span></li>');
        const other = isVideo ? 'Фото и GIF-файлы в экспорте (' + s.other + ') — их добавляйте на странице «Фото и GIF».' : 'Видео и GIF-анимации в формате mp4 (' + s.other + ') — их добавляйте на странице «Видео».';
        if (sm.empty) {
            add('info', isVideo ? 'В выбранных файлах нет видео для добавления.' : 'В выбранных файлах нет картинок для добавления.');
            if (s.other) add('movie', other);
            if (s.missing) add('warning', isVideo
                ? 'У части сообщений видео не скачаны при экспорте — таких: ' + s.missing + '. Повторите экспорт с включёнными «Видеофайлами» и размером лимита побольше (по умолчанию Telegram не выгружает файлы крупнее 8 МБ).'
                : 'У части сообщений фото не скачаны при экспорте (в экспорте нет самих файлов) — таких: ' + s.missing + '. Повторите экспорт с включёнными «Фото».');
        } else {
            const n = (s.added || 0) + (s.addedAlt || 0);
            add('check_circle', n ? 'Добавлено: <b>' + s.added + ' ' + W + '</b>' + (s.addedAlt ? ' и <b>' + s.addedAlt + (isVideo ? ' GIF-анимаций' : ' GIF') + '</b>' : '') + (sm.stopped ? ' (остановлено)' : '') : 'Новых ' + (isVideo ? 'видео' : 'фото') + ' не добавлено');
            if (s.thumbs) add('image', 'Превью из экспорта сохранены и используются как значки: <b>' + s.thumbs + '</b>' + (s.thumbsConv ? ' (слишком крупные пережаты до JPEG ' + GAL_THUMB_SIDE + ' px: ' + s.thumbsConv + ')' : '') + '.');
            if (isVideo && s.noThumb) add('warning', 'Не удалось сделать превью (браузер не читает этот формат видео): ' + s.noThumb + ' — у них будет значок-заглушка.');
            const worse = s.smaller + s.dups;
            if (worse) add('filter_none', 'Копий хуже качеством не взято: <b>' + worse + '</b> (' + [s.smaller ? 'тот же кадр в меньшем разрешении: ' + s.smaller : '', s.dups ? 'пережатых дублей: ' + s.dups : ''].filter(Boolean).join(', ') + '). Оставлена версия с лучшим разрешением. Файлы самого экспорта на вашем устройстве не тронуты — их можно удалить вручную.');
            if (s.replaced) add('swap_horiz', 'Заменено на версию лучше (были в библиотеке): ' + s.replaced);
            if (s.old) add('history', 'Уже были добавлены раньше: ' + s.old);
            if (s.tomb) add('delete', 'Ранее удалены вами и пропущены: ' + s.tomb);
            if (s.other) add('movie', other);
            if (s.missing) add('warning', W[0].toUpperCase() + W.slice(1) + ' нет среди выбранных файлов или они не скачаны при экспорте: ' + s.missing);
            if (s.big) add('warning', 'Слишком крупных файлов (больше ' + fmtBytes(cfg.fileMax) + '): ' + s.big);
            if (s.bad) add('error', 'Не удалось прочитать: ' + s.bad);
        }
        const todo = L().filter(g => !g.ai).length, canAi = ui.ai && mvHasAi() && todo > 0;
        const actions = [{ label: 'Закрыть' }];
        if (canAi && !sm.empty) actions.push({ label: 'ИИ-разбор (' + todo + ')', icon: 'auto_awesome', onClick() { setTimeout(aiRun, 250); } });
        if (!sm.empty && (sm.saved || 0) > 0) actions.push({ label: 'Открыть', kind: 'primary', icon: 'folder_open', onClick() { path = []; flat = false; renderBody(); } });
        openSheet({ title: sm.empty ? (isVideo ? 'Видео не найдены' : 'Фото не найдены') : 'Готово', html: '<ul class="gal-sum">' + lines.join('') + '</ul>', actions });
    }
    function save() { return cfg.save(); }

    // ---------- ИИ: хештеги по содержанию и имена из текста ----------
    function aiPrompt(g) {
        return 'Ты помогаешь разложить ' + (isVideo ? 'видео по папкам (тебе показан один кадр из видео)' : 'фото по папкам') + '. Верни ТОЛЬКО JSON без пояснений и без markdown: {"tags":["…"],"names":["…"],"text":"…"}.\n' +
            'tags — от 1 до 4 коротких хештегов на русском, строчными буквами, без «#», одно слово каждый, по тому что изображено (например: природа, еда, кошка, город, документ, скриншот, портрет, спорт, юмор, мем).\n' +
            'text — слово в слово весь читаемый текст на изображении (до 300 символов); пустая строка, если текста нет.\n' +
            'names — имена людей, которые прямо НАПИСАНЫ в подписи или в тексте на изображении (титры, подпись, водяной знак). ЗАПРЕЩЕНО определять человека по лицу, внешности или голосу: если имени нет в тексте — names должен быть пустым массивом [].\n' +
            (g.cap ? 'Подпись: «' + g.cap.slice(0, 400).replace(/[«»]/g, '"') + '»' : 'Подписи нет.');
    }
    function applyAi(g, r) {
        const tags = (Array.isArray(r.tags) ? r.tags : String(r.tags || '').split(/[\s,]+/)).map(t => normText(String(t).replace(/^#+/, '')).replace(/[^\p{L}\p{N}_]/gu, '')).filter(t => t.length >= 2 && t.length <= 24).slice(0, 4);
        const text = String(r.text || '').slice(0, 400), hay = (g.cap || '') + ' ' + text;
        const names = (Array.isArray(r.names) ? r.names : []).map(galNormActor).filter(n => n && galNameInText(n, hay)).slice(0, 5);
        g.tags = galUniq((g.tags || []).concat(tags)); if (names.length) g.actors = galUniq((g.actors || []).concat(names));
        g.ai = 1;
        return { tags: tags.length, names: names.length };
    }
    async function aiRun() {
        if (busy) { toast('Уже идёт обработка — подождите'); return; }
        if (!mvHasAi()) { toast('Сначала подключите ИИ: Настройки → Кино: базы и оценки', { ms: 5000 }); return; }
        const todo = L().filter(g => !g.ai); if (!todo.length) { toast('Все ' + W + ' уже разобраны'); return; }
        busy = true; renderCard();
        const u = galProgressSheet('ИИ разбирает ' + W), pause = GAL_AI_PAUSE[mvCfg().ai] || 2000;
        let done = 0, failed = 0, tags = 0, names = 0, err = '', consecutive = 0, noFile = 0;
        try {
            for (let n = 0; n < todo.length; n++) {
                if (u.ctl.stop) break;
                const g = todo[n];
                u.set('Разобрано ' + done + ' из ' + todo.length + (failed ? ' · не вышло: ' + failed : ''), n / todo.length);
                const rec = await BlobDB.get(g.id); const srcBlob = rec && (rec.blob && !isVideo ? rec.blob : rec.thumb || (!isVideo ? rec.blob : null));
                if (!srcBlob) { noFile++; continue; }
                try {
                    const small = await galSmallJpeg(srcBlob);
                    const raw = await mvAskAiText({ text: aiPrompt(g), imageBlob: small, maxTokens: 500 });
                    const r = galParseAi(raw);
                    if (!r) { failed++; if (++consecutive >= 6) { err = 'ИИ отвечает не в том формате'; break; } continue; }
                    const s = applyAi(g, r); tags += s.tags; names += s.names; done++; consecutive = 0;
                    if (done % 5 === 0) save();
                } catch (e) {
                    failed++; err = e && e.message ? e.message : String(e);
                    if (e && (e.code === 429 || /quota|лимит|limit|429|ключ|key/i.test(err))) break;
                    if (++consecutive >= 4) break;
                }
                await galSleep(pause);
            }
        } finally { save(); }
        u.close(); busy = false; renderCard(); renderBody();
        const left = L().filter(g => !g.ai).length - noFile;
        toast('ИИ разобрал ' + W + ': ' + done + (tags ? ' · хештегов: ' + tags : '') + (names ? ' · имён: ' + names : '') + (err ? ' · остановка: ' + err.slice(0, 120) : left > 0 && u.ctl.stop ? ' · осталось ' + left : '') + (noFile ? ' · нет превью у ' + noFile + ' (дождитесь синхронизации)' : ''), { ms: 6500 });
    }

    // ---------- Папки ----------
    function isLeaf(p) { const r = rootOf(p[0]); return r && r.kind ? p.length >= 4 : (p[0] === 'act' || p[0] === 'tag') ? p.length >= 2 : false; }
    function itemsOf(p) {
        const [r, a, b, c] = p; let arr = L(); const root = rootOf(r);
        if (root && root.kind) {
            arr = arr.filter(g => g.kind === root.kind);
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
    function folderName(p, i) {   // название i-го элемента пути
        const k = p[i], r = rootOf(p[0]);
        if (i === 0) return (rootOf(k) || {}).name || k;
        if (r && r.kind) { if (i === 1) return k; if (i === 2) return galMonthName(+k - 1); if (i === 3) return +k + ' ' + MONTHS_GEN[+p[2] - 1]; }
        if (p[0] === 'tag') return k === GAL_NOTAG ? 'Без хештегов' : '#' + k;
        return k;
    }
    function newest(items) { let best = null; items.forEach(g => { if (!best || g.date > best.date) best = g; }); return best; }
    function foldersOf(p, items) {
        const sortMode = ui.sort;
        if (!p.length) return cfg.roots.map(x => { const it = itemsOf([x.key]); return { key: x.key, name: x.name, icon: x.icon, count: it.length, bytes: galBytes(it), cover: newest(it), rk: x.key }; });
        const r = p[0], groups = new Map(), put = (key, g) => { let v = groups.get(key); if (!v) groups.set(key, v = []); v.push(g); }, root = rootOf(r);
        if (root && root.kind) { const lvl = p.length; items.forEach(g => { const q = galParts(g); put(lvl === 1 ? String(q.y) : lvl === 2 ? pad2(q.mo + 1) : pad2(q.d), g); }); }
        else if (r === 'act') items.forEach(g => (g.actors || []).forEach(a => put(a, g)));
        else if (r === 'tag') (p.length === 1 ? L() : items).forEach(g => { if (!(g.tags || []).length) put(GAL_NOTAG, g); else g.tags.forEach(t => put(t, g)); });   // «Без хештегов» — только на верхнем уровне
        const list = Array.from(groups.entries()).map(([key, it]) => ({ key, name: folderName(p.concat(key), p.length), icon: 'folder', count: it.length, bytes: galBytes(it), cover: newest(it), rk: r }));
        if (sortMode === 'big') list.sort((a, b) => b.bytes - a.bytes);
        else if (root && root.kind) list.sort((a, b) => sortMode === 'old' ? (a.key < b.key ? -1 : 1) : (a.key < b.key ? 1 : -1));
        else list.sort((a, b) => (a.key === GAL_NOTAG ? 1 : b.key === GAL_NOTAG ? -1 : a.name.localeCompare(b.name, 'ru')));
        return list;
    }
    function sortFiles(items) {
        const a = items.slice(), m = ui.sort;
        a.sort(m === 'big' ? (x, y) => (y.size || 0) - (x.size || 0) : m === 'old' ? (x, y) => x.date - y.date : (x, y) => y.date - x.date);
        return a;
    }

    // ---------- Показ ----------
    function thumbHtml(g) {
        const alt = g.kind === 'gif' || g.kind === 'anim';
        return '<span class="gal-th" data-id="' + esc(g.id) + '"><img alt="" data-gid="' + esc(g.id) + '">' +
            (alt ? '<span class="gal-gif">GIF</span>' : '') +
            (isVideo ? '<span class="gal-play">' + ic('play_arrow') + (g.dur && !alt ? '<b>' + fmtDuration(g.dur) + '</b>' : '') + '</span>' : '') +
            '<span class="gal-cloud" title="Оригинал в облаке: откроется с Google Диска">' + ic('cloud_download') + '</span></span>';
    }
    function folderHtml(f, i, view) {
        const sub = countText(f.count, f.rk) + (f.count ? ' · ' + fmtBytes(f.bytes) : '');
        const dl = '<button type="button" class="icon-btn gal-dl" data-save="' + i + '" aria-label="Сохранить папку «' + esc(f.name) + '»" title="Сохранить папку">' + ic('download') + '</button>';
        if (view === 'list') return '<div class="gal-row gal-frow" role="button" tabindex="0" data-f="' + i + '"><span class="gal-ico">' + ic(f.icon) + '</span><span class="tx"><span class="nm">' + esc(f.name) + '</span><span class="sub">' + esc(sub) + '</span></span>' + (f.count ? dl : '') + ic('chevron_right') + '</div>';
        return '<div class="gal-tile gal-ftile" role="button" tabindex="0" data-f="' + i + '">' + (f.cover ? thumbHtml(f.cover) : '<span class="gal-th gal-empty"></span>') + '<span class="gal-fi">' + ic(f.icon) + '</span>' +
            '<span class="cap"><b>' + esc(f.name) + '</b><span>' + esc(sub) + '</span></span>' + (view === 'large' && f.count ? dl : '') + '</div>';
    }
    function fileHtml(g, i, view) {
        const on = sel && sel.has(g.id);
        const chk = sel ? '<span class="gal-chk">' + ic('check') + '</span>' : '';
        if (view === 'list') return '<div class="gal-row' + (on ? ' is-sel' : '') + '" role="button" tabindex="0" data-i="' + i + '">' + chk + thumbHtml(g) + '<span class="tx"><span class="nm">' + esc(title(g)) + '</span><span class="sub">' + esc(fileMeta(g)) + '</span></span>' +
            '<button type="button" class="icon-btn gal-dl" data-dl="' + i + '" aria-label="Сохранить ' + W + '" title="Сохранить ' + W + '">' + ic('download') + '</button></div>';
        return '<div class="gal-tile' + (on ? ' is-sel' : '') + '" role="button" tabindex="0" data-i="' + i + '">' + thumbHtml(g) + chk +
            (view === 'large' ? '<span class="cap"><b>' + esc(fmtDateShort(g.date) + ' ' + fmtTime(g.date)) + '</b><span>' + esc(fmtBytes(g.size || 0)) + (g.dur ? ' · ' + fmtDuration(g.dur) : g.w ? ' · ' + g.w + '×' + g.h : '') + '</span></span><button type="button" class="icon-btn gal-dl" data-dl="' + i + '" aria-label="Сохранить ' + W + '" title="Сохранить ' + W + '">' + ic('download') + '</button>' : '') + '</div>';
    }
    function crumbsHtml() {
        const parts = ['<button type="button" class="gal-crumb" data-p="0">' + ic(isVideo ? 'movie' : 'photo_library') + esc(cfg.rootLabel) + '</button>'];
        path.forEach((k, i) => {
            const last = i === path.length - 1, name = folderName(path.slice(0, i + 1), i);
            parts.push(ic('chevron_right') + (last ? '<span class="gal-crumb is-last">' + esc(name) + '</span>' : '<button type="button" class="gal-crumb" data-p="' + (i + 1) + '">' + esc(name) + '</button>'));
        });
        return (path.length ? '<button type="button" class="icon-btn gal-back" data-p="' + (path.length - 1) + '" aria-label="Назад" title="Назад">' + ic('arrow_back') + '</button>' : '') + '<span class="gal-trail">' + parts.join('') + '</span>';
    }
    function renderCardLine() {
        const el = $(S('status')); if (!el) return;
        const items = L(), alt = items.filter(g => g.kind === 'gif' || g.kind === 'anim').length, main = items.length - alt;
        let t = items.length ? 'В библиотеке: ' + main + ' ' + W + (alt ? ' и ' + alt + (isVideo ? ' GIF-анимаций' : ' GIF') : '') + ' · ' + fmtBytes(galBytes(items)) + '.' : (isVideo
            ? 'Пока пусто. Выберите экспорт Telegram: видео разложатся по папкам год → месяц → день, как и фото.'
            : 'Пока пусто. Выберите экспорт Telegram: фото разложатся по папкам год → месяц → день, GIF — в отдельную папку.');
        if (items.length && local) {
            const d = deviceCounts();
            t += d.full < d.total ? ' На этом устройстве целиком: ' + d.full + ' из ' + d.total + ' (' + fmtBytes(d.fullBytes) + '), у остальных — только превью; полный файл загрузится с Google Диска при открытии.' : '';
        }
        if (typeof googleInfo === 'function') {
            const gi = googleInfo();
            t += !gi.user ? ' Чтобы ' + W + ' были на всех устройствах, подключите Google Диск (Настройки).' : !gi.cfg.media ? ' Синхронизация вложений выключена в настройках Google Диска — ' + W + ' остаются только на этом устройстве.' : ' Между устройствами идут превью (папка iLife/Мое_совсек_превью), оригиналы лежат в папке iLife/' + cfg.driveName + '.';
        }
        el.textContent = t;
        const dl = $(S('dlall'));
        if (dl) {
            const miss = local ? items.filter(g => !hasFull(g.id)).length : 0;
            dl.hidden = !(miss > 0 && cloudReady()); dl.disabled = busy; dl.innerHTML = ic('cloud_download') + 'Скачать все (' + miss + ')';
        }
    }
    function renderCard() {
        const card = $(S('card')); if (!card) return;
        $(S('badge')).textContent = L().length ? String(L().length) : '';
        renderCardLine();
        $(S('import')).disabled = busy;
        const has = mvHasAi(), sw = $(S('ai'));
        sw.checked = !!ui.ai && has; sw.disabled = !has;
        $(S('ai-row')).classList.toggle('is-disabled', !has);
        $(S('ai-sub')).textContent = has ? 'Хештеги по тому, что ' + (isVideo ? 'в кадре' : 'на фото') + ', и имена людей, написанные в подписи или на самой картинке. По лицам ИИ людей не определяет. Уменьшенный кадр и подпись уходят в вашу ИИ-службу (' + (MV_AI_NAMES[mvCfg().ai] || 'ИИ') + ')'
            : 'Сначала подключите ИИ: Настройки → «Кино: базы и оценки». Без него хештеги берутся из подписей, а актёров можно добавлять вручную';
        const todo = L().filter(g => !g.ai).length, run = $(S('ai-run'));
        run.hidden = !(has && ui.ai && todo > 0); run.disabled = busy; run.innerHTML = ic('auto_awesome') + 'ИИ-разбор (' + todo + ')';
    }
    function renderActs(showFiles, files) {
        const el = $(S('acts')); if (!el) return;
        if (sel) {
            el.innerHTML = '<div class="gal-selbar"><b>Выбрано: ' + sel.size + '</b><span class="gal-sp"></span>' +
                '<button type="button" class="btn btn-text" data-a="all">' + ic('done_all') + 'Все</button>' +
                '<button type="button" class="btn" data-a="save"' + (sel.size ? '' : ' disabled') + '>' + ic('download') + 'Сохранить</button>' +
                '<button type="button" class="btn" data-a="edit"' + (sel.size ? '' : ' disabled') + '>' + ic('edit') + 'Хештеги и актёры</button>' +
                '<button type="button" class="btn btn-danger" data-a="del"' + (sel.size ? '' : ' disabled') + '>' + ic('delete') + 'Удалить</button>' +
                '<button type="button" class="btn btn-text" data-a="done">Готово</button></div>';
            return;
        }
        const items = itemsOf(path), b = [];
        b.push('<span class="gal-info">' + esc(countText(items.length, path[0]) + (items.length ? ' · ' + fmtBytes(galBytes(items)) : '')) + '</span><span class="gal-sp"></span>');
        const todoAi = L().filter(g => !g.ai).length;
        if (!path.length && todoAi && ui.ai && mvHasAi()) b.push('<button type="button" class="btn" data-a="ai">' + ic('auto_awesome') + 'ИИ-разбор (' + todoAi + ')</button>');
        if (path.length && !isLeaf(path) && items.length) b.push('<button type="button" class="btn' + (flat ? ' btn-primary' : '') + '" data-a="flat" aria-pressed="' + flat + '">' + ic(flat ? 'folder' : (isVideo ? 'movie' : 'photo_library')) + (flat ? 'Показать папки' : 'Всё внутри') + '</button>');
        if (showFiles && files.length) b.push('<button type="button" class="btn" data-a="select">' + ic('check_box') + 'Выбрать</button>');
        if (items.length) b.push('<button type="button" class="btn btn-primary" data-a="savefolder">' + ic('download') + (path.length ? 'Сохранить папку' : 'Сохранить всё') + '</button>');
        el.innerHTML = b.join('');
    }
    function renderBody() {
        const body = $(S('body')); if (!body) return;
        $(S('crumbs')).innerHTML = crumbsHtml();
        $$(S('view') + ' [data-v]').forEach(b => b.classList.toggle('is-on', b.dataset.v === ui.view));
        $(S('sort')).value = ui.sort;
        const showFiles = isLeaf(path) || (flat && path.length > 0), items = itemsOf(path);
        const folders = showFiles ? [] : foldersOf(path, items), files = showFiles ? sortFiles(items) : [];
        cur = { folders, files };
        renderActs(showFiles, files);
        const view = ui.view;
        let html = '';
        if (!showFiles) {
            if (!L().length) html = '<div class="gal-empty-state">' + ic(isVideo ? 'movie' : 'photo_library') + '<b>Здесь будут ваши ' + (isVideo ? 'видео' : 'фото и GIF') + '</b><span>Нажмите «Выбрать экспорт» в блоке выше — папки появятся сами.</span></div>';
            else if (!folders.length) html = '<div class="gal-empty-state">' + ic('folder_open') + '<b>В этой папке пока пусто</b></div>';
            else html = '<div class="gal-' + (view === 'list' ? 'list' : 'grid') + ' gal-v-' + view + '">' + folders.map((f, i) => folderHtml(f, i, view)).join('') + '</div>';
        } else {
            if (!files.length) html = '<div class="gal-empty-state">' + ic('folder_open') + '<b>В этой папке пока пусто</b></div>';
            else {
                const shown = files.slice(0, limit);
                html = '<div class="gal-' + (view === 'list' ? 'list' : 'grid') + ' gal-v-' + view + '">' + shown.map((g, i) => fileHtml(g, i, view)).join('') + '</div>' +
                    (files.length > shown.length ? '<div class="gal-more"><button type="button" class="btn" data-a="more">Показать ещё (' + (files.length - shown.length) + ')</button></div>' : '');
            }
        }
        body.innerHTML = html;
        hydrate(body); paintCloud();
    }
    function hydrate(root) {
        if (io) { io.disconnect(); io = null; }
        const imgs = $$('img[data-gid]', root);
        const load = async im => {
            const u = await BlobDB.url(im.dataset.gid, 'thumb');
            if (u) { im.src = u; im.addEventListener('error', () => im.closest('.gal-th').classList.add('is-missing'), { once: true }); }
            else im.closest('.gal-th').classList.add('is-missing');
        };
        if (typeof IntersectionObserver === 'undefined') { imgs.forEach(load); return; }
        io = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { io.unobserve(e.target); load(e.target); } }), { rootMargin: '400px' });
        imgs.forEach(im => io.observe(im));
    }
    function renderSwitch() { if (typeof galRenderSwitch === 'function') galRenderSwitch(); }
    function render() { if (!$(S('body'))) return; renderCard(); renderBody(); }
    function isActive() { const t = $('#sovsek'), pane = $('#sov-' + K); return !!(t && t.classList.contains('is-active') && pane && !pane.hidden); }
    function refreshIfOpen() {
        refreshLocal();
        if (isActive() && !busy) render(); else renderCard();
    }
    function open(p) {
        path = p; flat = false; limit = GAL_PAGE; sel = null;
        renderBody();
        const bar = $(S('bar')); if (bar && bar.getBoundingClientRect().top < 0) bar.scrollIntoView({ block: 'start' });
    }

    // ---------- Скачивание оригиналов с Google Диска (по требованию) ----------
    function needGoogle() {
        const gi = typeof googleInfo === 'function' ? googleInfo() : null;
        if (!gi || !gi.user) { toast('Оригинал лежит на Google Диске: подключите Google в Настройках', { ms: 5000 }); return false; }
        if (!gi.cfg.media) { toast('Синхронизация вложений выключена в настройках Google Диска', { ms: 5000 }); return false; }
        if (!gi.hasToken) { toast('Нужно подтвердить вход в Google', { action: 'Продолжить', onAction: reconnectGoogle, ms: 7000 }); return false; }
        return true;
    }
    async function fetchFull(ids, progress, ctl) {
        if (!needGoogle()) return { done: 0, failed: ids.length, missing: 0, stopped: false, noAuth: true };
        try { return await gGalFetchFull(K, ids, { onProgress: progress, ctl }); }
        catch (e) { if (e && e.code === 'auth') { toast('Вход в Google устарел', { action: 'Продолжить', onAction: reconnectGoogle, ms: 7000 }); return { done: 0, failed: ids.length, missing: 0, stopped: false, noAuth: true }; } throw e; }
    }
    async function downloadAll() {
        if (busy) { toast('Уже идёт обработка — подождите'); return; }
        await refreshLocal();
        const need = L().filter(g => !hasFull(g.id));
        if (!need.length) { toast('Все ' + (isVideo ? 'видео' : 'фото') + ' уже на устройстве'); return; }
        if (!needGoogle()) return;
        const bytes = galBytes(need);
        if (!(await confirmSheet('Скачать ' + need.length + ' ' + (isVideo ? 'видео' : 'фото') + '?', 'С Google Диска будет загружено примерно ' + fmtBytes(bytes) + ' — столько места они займут на этом устройстве. Позже их можно убрать кнопкой «Очистить кеш» (с Диска они не удаляются).', 'Скачать'))) return;
        busy = true; renderCard();
        const u = galProgressSheet('Скачиваем ' + (isVideo ? 'видео' : 'фото') + ' с Диска');
        let r = null, err = '';
        try { r = await fetchFull(need.map(g => g.id), (d, t) => u.set('Скачано ' + d + ' из ' + t, d / Math.max(t, 1)), u.ctl); } catch (e) { err = e && e.message ? e.message : String(e); }
        u.close(); busy = false;
        await refreshLocal(); render(); renderSwitch();
        if (typeof renderSovStore === 'function') renderSovStore();
        if (err) toast('Не удалось скачать: ' + err, { ms: 7000 });
        else if (r && !r.noAuth) toast('Скачано: ' + r.done + (r.failed ? ' · не вышло: ' + r.failed : '') + (r.missing ? ' · нет на Диске: ' + r.missing : '') + (r.stopped ? ' · остановлено' : ''), { ms: 6000 });
    }
    // Что можно безопасно убрать с устройства: оригиналы, которые точно лежат на Google Диске
    async function cacheInfo() {
        const idx = await BlobDB.index(), have = L().filter(g => (idx.get(g.id) || {}).full);
        let safe = new Set(), live = false;
        if (have.length && typeof gGalConfirmedIds === 'function') { const r = await gGalConfirmedIds(K); safe = r.set; live = r.live; }
        const ok = have.filter(g => safe.has(g.id));
        return { have: have.length, haveBytes: galBytes(have), safe: ok.length, safeBytes: galBytes(ok), ids: ok.map(g => g.id), live, thumbs: L().filter(g => (idx.get(g.id) || {}).thumb).length };
    }
    async function clearCache(ids, dropThumbs) {
        let n = 0;
        for (const id of ids) { if (await BlobDB.dropFull(id, dropThumbs)) n++; if (n % 25 === 0) await galSleep(0); }
        await refreshLocal(); render(); renderSwitch();
        return n;
    }

    // ---------- Сохранение: файл, папка, выбранное ----------
    function dirOf(p, g) {   // подпапки внутри сохраняемой папки
        const root = rootOf(p[0]); if (!root || !root.kind) return [];
        const q = galParts(g), dirs = [String(q.y), pad2(q.mo + 1) + ' ' + MONTHS_NOM[q.mo], pad2(q.d)];
        return dirs.slice(Math.max(0, p.length - 1));
    }
    function savePlan(p) {
        const entries = [], add = (items, top, sub) => items.forEach(g => entries.push({ g, dir: [].concat(top, sub(g)).filter(Boolean) }));
        if (!p.length) {
            cfg.roots.filter(r => r.kind).forEach(r => add(itemsOf([r.key]), [cfg.zipRoot, r.name], g => dirOf([r.key], g)));
            return { entries, zipName: cfg.zipRoot };
        }
        const root = rootOf(p[0]), date = root && root.kind;
        const top = date ? (p.length === 1 ? folderName(p, 0) : p.slice(1).join('-')) : folderName(p, p.length - 1).replace(/^#/, '');
        add(itemsOf(p), galSafe(top), g => dirOf(p, g));
        return { entries, zipName: cfg.zipRoot + '_' + p.map((k, i) => folderName(p.slice(0, i + 1), i).replace(/^#/, '')).map(galSafe).join('_') };
    }
    async function saveEntries(entries, zipName) {
        if (!entries.length) { toast('В этой папке пока ничего нет'); return; }
        if (busy) { toast('Уже идёт обработка — подождите'); return; }
        busy = true;
        const u = galProgressSheet('Собираем архив');
        try {
            // оригиналы, которых нет на устройстве (остались только превью), сначала докачиваем с Google Диска
            await refreshLocal();
            const lack = entries.filter(e => !hasFull(e.g.id)).map(e => e.g.id);
            let fetched = null;
            if (lack.length && needGoogle()) {
                fetched = await fetchFull(lack, (d, t) => u.set('Скачиваем с Google Диска: ' + d + ' из ' + t, 0.3 * d / Math.max(t, 1)), u.ctl);
                await refreshLocal();
            }
            // имена внутри папок уникальны
            const used = new Set(), files = []; let missing = 0;
            for (let n = 0; n < entries.length; n++) {
                if (u.ctl.stop) break;
                const e = entries[n], rec = await BlobDB.get(e.g.id);
                u.set('Читаем файлы: ' + (n + 1) + ' из ' + entries.length, 0.3 + 0.1 * n / entries.length);
                if (!rec || !rec.blob) { missing++; continue; }
                let base = fileName(e.g), pth = e.dir.map(galSafe).join('/') + (e.dir.length ? '/' : '') + base, k = 1;
                const m = /^(.*?)(\.[^.]*)?$/.exec(base);
                while (used.has(pth.toLowerCase())) pth = e.dir.map(galSafe).join('/') + (e.dir.length ? '/' : '') + m[1] + ' (' + (++k) + ')' + (m[2] || '');
                used.add(pth.toLowerCase());
                files.push({ path: pth, blob: rec.blob.type === (rec.type || rec.blob.type) ? rec.blob : new Blob([rec.blob], { type: rec.type }), date: e.g.date });
            }
            if (u.ctl.stop) { toast('Сохранение остановлено'); return; }
            if (!files.length) { toast(missing ? 'Файлы ещё не скачаны с Google Диска — подключите Диск или нажмите «Скачать все»' : 'Нечего сохранять', { ms: 5000 }); return; }
            // части по размеру
            const partsList = []; let curP = [], curSize = 0;
            files.forEach(f => { if (curP.length && (curSize + f.blob.size > GAL_ZIP_PART || curP.length >= 60000)) { partsList.push(curP); curP = []; curSize = 0; } curP.push(f); curSize += f.blob.size; });
            if (curP.length) partsList.push(curP);
            let last = '';
            for (let p = 0; p < partsList.length; p++) {
                const part = partsList[p];
                if (part.length === 1 && partsList.length === 1 && entries.length === 1) {   // один файл — сам файл
                    last = await deliverFile(part[0].blob, part[0].path.split('/').pop()); break;
                }
                const zip = await galZip(part, (d, t) => { if (!u.ctl.stop) u.set('Собираем архив' + (partsList.length > 1 ? ' (часть ' + (p + 1) + ' из ' + partsList.length + ')' : '') + ': ' + d + ' из ' + t, 0.4 + 0.6 * ((p + d / t) / partsList.length)); });
                last = await deliverFile(zip, zipName + (partsList.length > 1 ? '_часть' + (p + 1) : '') + '.zip');
                if (last === 'unsupported') break;
            }
            u.close();
            toast(last === 'unsupported' ? 'В этом приложении сохранить файл нельзя — откройте iLife в браузере' : last === 'shared' ? 'Готово — выберите, куда отправить' : 'Сохранено файлов: ' + files.length + (partsList.length > 1 ? ' (архивов: ' + partsList.length + ')' : '') + (missing ? ' · нет на устройстве и на Диске: ' + missing : '') + (fetched && fetched.done ? ' · докачано с Диска: ' + fetched.done : ''), { ms: 5000 });
        } catch (e) { console.error(e); toast('Не удалось сохранить: ' + (e && e.message ? e.message : e), { ms: 6000 }); }
        finally { u.close(); busy = false; renderCard(); }
    }
    function saveFolder(p) { const plan = savePlan(p); return saveEntries(plan.entries, plan.zipName); }
    function saveOne(g) { return saveEntries([{ g, dir: [] }], cfg.zipRoot + '_' + W); }
    function saveSelected(ids) { const set = new Set(ids); return saveEntries(L().filter(g => set.has(g.id)).map(g => ({ g, dir: [] })), cfg.zipRoot + '_выбранные'); }

    // ---------- Правка: хештеги, актёры; удаление ----------
    function editSheet(items, after) {
        const one = items.length === 1, g = items[0];
        const tags = one ? (g.tags || []).join(' ') : '', actors = one ? (g.actors || []).join(', ') : '';
        const dlA = '<datalist id="' + P + '-dl-actors">' + knownActors().map(a => '<option value="' + esc(a) + '">').join('') + '</datalist>';
        const dlT = '<datalist id="' + P + '-dl-tags">' + knownTags().slice(0, 60).map(t => '<option value="' + esc(t) + '">').join('') + '</datalist>';
        const head = one ? '<div class="gal-edit-head">' + thumbHtml(g) + '<span class="hint">' + esc(title(g) + ' · ' + (g.w ? g.w + '×' + g.h + ' · ' : '') + fmtBytes(g.size || 0)) + (g.cap ? '<br>' + esc(g.cap.slice(0, 200)) : '') + '</span></div>'
            : '<p class="hint" style="margin:0 4px 8px">Выбрано: ' + items.length + '. Введённое ниже будет добавлено ко всем.</p>';
        const sheet = openSheet({
            title: one ? 'Хештеги и актёры' : 'Хештеги и актёры (' + items.length + ')',
            html: head + '<label class="field-label" for="' + P + '-e-tags">Хештеги (через пробел)</label><input type="text" id="' + P + '-e-tags" list="' + P + '-dl-tags" value="' + esc(tags) + '" placeholder="природа лето" autocomplete="off">' + dlT +
                '<label class="field-label" for="' + P + '-e-actors" style="margin-top:0.75rem">Актёры и известные люди (через запятую)</label><input type="text" id="' + P + '-e-actors" list="' + P + '-dl-actors" value="' + esc(actors) + '" placeholder="Имя Фамилия" autocomplete="off">' + dlA +
                '<p class="hint" style="margin:0.5rem 4px 0">Людей по лицу приложение не определяет — укажите имя сами, и ' + (isVideo ? 'видео' : 'фото') + ' появится в папке «Актёры».</p>',
            actions: [{ label: 'Отмена' }, { label: 'Сохранить', kind: 'primary', icon: 'check', onClick(api) {
                const t = parseTagString($('#' + P + '-e-tags', api.el).value), a = galParseActors($('#' + P + '-e-actors', api.el).value);
                items.forEach(x => { x.tags = one ? t : galUniq((x.tags || []).concat(t)); x.actors = one ? a : galUniq((x.actors || []).concat(a)); });
                save(); renderCard(); renderBody(); if (after) after();
                toast('Сохранено');
            } }]
        });
        hydrate(sheet.el); paintCloud();
    }
    async function deleteItems(items, after) {
        if (!items.length) return false;
        const ok = await confirmSheet(items.length === 1 ? 'Удалить?' : 'Удалить: ' + items.length + '?', 'Они пропадут из «Мое_совсек» на всех ваших устройствах. Файлы в экспорте Telegram не затрагиваются, а копии на Google Диске уйдут в корзину Диска при ближайшей ручной синхронизации (не раньше чем через сутки).', 'Удалить', true);
        if (!ok) return false;
        const ids = new Set(items.map(g => g.id));
        cfg.set(L().filter(g => !ids.has(g.id)));
        save();
        for (const id of ids) await BlobDB.del(id);
        if (sel) ids.forEach(id => sel.delete(id));
        await refreshLocal(); renderCard(); renderBody(); renderSwitch(); if (after) after();
        toast(items.length === 1 ? 'Удалено' : 'Удалено: ' + items.length);
        return true;
    }

    // ---------- Просмотр ----------
    function closeViewer() {
        if (!viewer) return;
        document.removeEventListener('keydown', viewer.key);
        if (viewer.stop) viewer.stop();   // предзагрузка соседних фото живёт только пока открыт просмотр
        const v = viewer.el.querySelector('video'); if (v) { try { v.pause(); v.removeAttribute('src'); v.load(); } catch (e) {} }
        viewer.el.remove(); viewer = null;
        if (!sheetStack.length) document.body.classList.remove('is-locked');
    }
    async function openViewer(list, index) {
        closeViewer();
        if (!list.length) return;
        let i = Math.max(0, Math.min(index || 0, list.length - 1)), token = 0;
        const el = document.createElement('div');
        el.className = 'lightbox gal-viewer'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-label', isVideo ? 'Просмотр видео' : 'Просмотр фото');
        el.innerHTML = (isVideo ? '<video controls playsinline preload="metadata" hidden></video><img class="gal-poster" alt="" hidden>' : '<img alt="">') +
            '<div class="gal-vmiss" hidden>' + ic('cloud_download') + '<span data-m>Оригинала нет на устройстве.</span><button type="button" class="btn btn-primary" data-v="fetch">' + ic('cloud_download') + '<span>Загрузить с Google Диска</span></button></div>' +
            '<div class="gal-vtop"><span class="gal-vcount"></span><span class="gal-vpf" hidden title="Подгружаем соседние фото с Google Диска">' + ic('cloud_download') + '<b></b></span><span class="gal-sp"></span>' +
            '<button type="button" class="lb-btn" data-v="save" aria-label="Сохранить" title="Сохранить">' + ic('download') + '</button>' +
            '<button type="button" class="lb-btn" data-v="edit" aria-label="Хештеги и актёры" title="Хештеги и актёры">' + ic('tag') + '</button>' +
            '<button type="button" class="lb-btn" data-v="del" aria-label="Удалить" title="Удалить">' + ic('delete') + '</button>' +
            '<button type="button" class="lb-btn" data-v="close" aria-label="Закрыть" title="Закрыть">' + ic('close') + '</button></div>' +
            (list.length > 1 ? '<button type="button" class="lb-btn lb-prev" data-v="prev" aria-label="Назад">' + ic('chevron_left') + '</button><button type="button" class="lb-btn lb-next" data-v="next" aria-label="Вперёд">' + ic('chevron_right') + '</button>' : '') +
            '<div class="gal-vinfo"></div>';
        document.body.appendChild(el); document.body.classList.add('is-locked');
        const media = isVideo ? $('video', el) : $('img', el), poster = $('.gal-poster', el), miss = $('.gal-vmiss', el), msg = $('[data-m]', miss), fetchBtn = $('[data-v="fetch"]', el);
        const pfBadge = $('.gal-vpf', el), pfNum = $('b', pfBadge);

        // ---- Динамическая подгрузка соседних фото (только пока открыт просмотр) ----
        // Когда вы открываете фото, которого нет на устройстве, приложение качает с Google Диска его самого и сразу несколько соседних
        // (по ходу листания — больше вперёд), чтобы следующие снимки открывались мгновенно. Как только просмотр закрыт, всё останавливается;
        // в обычных списках и при синхронизации ничего лишнего не качается.
        const PF = { ahead: 4, behind: 2, parallel: 3, maxBytes: 25 * 1048576 };
        const pfAbort = typeof AbortController !== 'undefined' ? new AbortController() : null;
        const jobs = new Map();   // id → { frac, subs, p }: что качается прямо сейчас
        let queue = [], running = 0, dir = 1, stopped = false;
        const pfAllowed = () => !isVideo && !stopped && navigator.onLine !== false && !(navigator.connection && navigator.connection.saveData);
        const pfReady = () => !stopped && cloudReady() && googleInfo().hasToken;
        const pfPaint = () => { const n = running + queue.length; pfBadge.hidden = !n; pfNum.textContent = String(n); };
        const markLocal = id => {
            if (!local) local = new Map();
            local.set(id, Object.assign({}, local.get(id), { full: true }));
            paintCloud(); paintLineSoon();
        };
        function startJob(g, fresh) {
            let job = jobs.get(g.id); if (job) return job;
            job = { frac: 0, subs: new Set() };
            job.p = gGalFetchOne(K, g.id, { fresh: !!fresh, refreshOnMiss: true, ttl: 600000, signal: pfAbort ? pfAbort.signal : undefined, onFrac: f => { job.frac = f; job.subs.forEach(fn => fn(f)); } })
                .catch(e => (e && e.code === 'auth') ? 'auth' : 'failed')
                .then(r => { jobs.delete(g.id); if (r === 'done') markLocal(g.id); return r; });
            jobs.set(g.id, job);
            return job;
        }
        function pump() {
            while (running < PF.parallel && queue.length && pfAllowed() && pfReady()) {
                const id = queue.shift(), g = list.find(x => x.id === id);
                if (!g || hasFull(id) || jobs.has(id)) continue;
                running++;
                startJob(g, false).p.then(r => { running--; if (r === 'auth' || r === 'aborted') queue = []; pump(); pfPaint(); });
            }
            pfPaint();
        }
        // порядок: ближайшие первыми; в сторону листания берём дальше
        function plan() {
            if (!pfAllowed() || list.length < 2) { queue = []; pfPaint(); return; }
            const n = list.length, fw = dir >= 0 ? PF.ahead : PF.behind, bw = dir >= 0 ? PF.behind : PF.ahead, ids = [];
            for (let d = 1; d <= Math.max(fw, bw); d++) {
                if (d <= fw) ids.push(list[(i + dir * d + n * 8) % n].id);
                if (d <= bw) ids.push(list[(i - dir * d + n * 8) % n].id);
            }
            queue = galUniq(ids).filter(id => { const g = list.find(x => x.id === id); return g && g.id !== list[i].id && !hasFull(id) && !jobs.has(id) && (Number(g.size) || 0) <= PF.maxBytes; });
            pump();
        }
        const planSoon = async () => { if (!local) await refreshLocal(); plan(); };

        const show = async () => {
            const g = list[i], my = ++token;
            $('.gal-vcount', el).textContent = (i + 1) + ' / ' + list.length;
            $('.gal-vinfo', el).innerHTML = '<b>' + esc(title(g)) + '</b><span>' + esc(fileMeta(g)) + '</span>' + (g.cap ? '<span class="cap">' + esc(g.cap.slice(0, 300)) + '</span>' : '');
            if (isVideo) { try { media.pause(); } catch (e) {} media.removeAttribute('src'); media.hidden = true; poster.hidden = true; poster.removeAttribute('src'); } else media.removeAttribute('src');
            miss.hidden = true;
            const u = await BlobDB.url(g.id);
            if (token !== my) return;
            if (u) { media.hidden = false; media.src = u; if (isVideo) { try { media.play(); } catch (e) {} } planSoon(); return; }
            // оригинала нет: показываем превью и предлагаем загрузить (фото — сразу, если лёгкое)
            const tu = await BlobDB.url(g.id, 'thumb');
            if (token !== my) return;
            if (tu) { if (isVideo) { poster.src = tu; poster.hidden = false; } else { media.hidden = false; media.src = tu; media.classList.add('is-preview'); } }
            miss.hidden = false; msg.textContent = 'Оригинала (' + fmtBytes(g.size || 0) + ') нет на этом устройстве — он лежит на Google Диске.'; fetchBtn.disabled = false;
            if (!isVideo && (g.size || 0) <= 25 * 1048576 && cloudReady() && googleInfo().hasToken) fetchOne(g, my);
            planSoon();
        };
        const fetchOne = async (g, my, manual) => {
            fetchBtn.disabled = true; msg.textContent = 'Загружаем с Google Диска…';
            let r = null, job = jobs.get(g.id);
            if (!job && manual) {   // кнопка «Загрузить»: прежний путь, с подсказками про вход в Google
                try { r = await fetchFull([g.id], (d, t, frac) => { if (token === my && frac != null) msg.textContent = 'Загружаем с Google Диска: ' + Math.round(frac * 100) + '%'; }); } catch (e) { toast('Не удалось загрузить: ' + (e && e.message ? e.message : e), { ms: 6000 }); }
            } else {
                // это фото могло уже качаться как соседнее — присоединяемся к той же загрузке
                if (!job) job = startJob(g, false);
                const sub = f => { if (token === my) msg.textContent = 'Загружаем с Google Диска: ' + Math.round(f * 100) + '%'; };
                job.subs.add(sub);
                const res = await job.p; job.subs.delete(sub);
                r = { done: res === 'done' ? 1 : 0, missing: res === 'missing' ? 1 : 0 };
            }
            await refreshLocal();
            if (token !== my) return;
            if (r && r.done) { media.classList.remove('is-preview'); show(); renderBody(); }
            else { fetchBtn.disabled = false; msg.textContent = r && r.missing ? 'Этого файла нет на Google Диске (возможно, он ещё не выгружен с другого устройства).' : 'Не удалось загрузить оригинал.'; }
        };
        const go = d => { dir = d >= 0 ? 1 : -1; i = (i + d + list.length) % list.length; media.classList && media.classList.remove('is-preview'); show(); };
        el.addEventListener('click', async e => {
            const b = e.target.closest('[data-v]'); if (!b) { if (e.target === el) closeViewer(); return; }
            const act = b.dataset.v, g = list[i];
            if (act === 'close') closeViewer();
            else if (act === 'prev') go(-1); else if (act === 'next') go(1);
            else if (act === 'save') saveOne(g);
            else if (act === 'fetch') fetchOne(g, token, true);
            else if (act === 'edit') editSheet([g], show);
            else if (act === 'del') await deleteItems([g], () => { list.splice(i, 1); if (!list.length) { closeViewer(); return; } if (i >= list.length) i = list.length - 1; show(); });
        });
        let sx = null;
        el.addEventListener('touchstart', e => { sx = e.touches[0].clientX; }, { passive: true });
        el.addEventListener('touchend', e => { if (sx === null || list.length < 2 || (isVideo && e.target.closest('video'))) { sx = null; return; } const dx = e.changedTouches[0].clientX - sx; if (Math.abs(dx) > 50) go(dx < 0 ? 1 : -1); sx = null; }, { passive: true });
        viewer = { el, stop() { stopped = true; queue = []; if (pfAbort) { try { pfAbort.abort(); } catch (e) {} } jobs.clear(); }, key(e) { if (sheetStack.length) return; if (e.key === 'Escape') closeViewer(); else if (e.key === 'ArrowRight' && list.length > 1) go(1); else if (e.key === 'ArrowLeft' && list.length > 1) go(-1); } };
        document.addEventListener('keydown', viewer.key);
        show();
    }

    // ---------- Разметка страницы ----------
    function template() {
        const importHint = isVideo
            ? 'В Telegram Desktop: «Экспорт истории чата» (JSON или HTML) → отметьте «Видеофайлы» (и «GIF», «Видеосообщения»), а «Ограничение размера» поставьте побольше: по умолчанию Telegram не выгружает файлы крупнее 8 МБ. Выберите ZIP-архив или файлы из него. Берутся видео до ' + fmtBytes(cfg.fileMax) + '; превью из экспорта (…mp4_thumb.jpg) становятся значками.'
            : 'В Telegram Desktop: «Экспорт истории чата» (JSON или HTML, с включёнными «Фото»). Выберите ZIP-архив или файлы из него. Берутся картинки и GIF; из копий остаётся версия с лучшим разрешением, а уменьшенные копии из экспорта (…_thumb.jpg) становятся значками. Видео — на странице «Видео».';
        return '<div class="card gal-card" id="' + P + '-card">' +
            '<h3 class="card-title"><span class="ico"><i data-i="' + (isVideo ? 'movie' : 'send') + '"></i></span><span class="ttl">' + (isVideo ? 'Видео из Telegram' : 'Фото из Telegram') + '</span><span class="badge" id="' + P + '-badge"></span>' +
            '<button type="button" class="icon-btn card-toggle" aria-label="Свернуть или развернуть блок"><i data-i="expand_less"></i></button></h3>' +
            '<div class="card-body">' +
            '<p class="hint" id="' + P + '-status" style="margin-bottom:0.75rem"></p>' +
            '<div class="tg-modes"><div class="tg-mode"><b><i data-i="upload_file"></i>Из экспорта Telegram</b>' +
            '<span class="hint">' + esc(importHint) + '</span>' +
            '<button type="button" class="btn btn-primary" id="' + P + '-import"><i data-i="upload_file"></i>Выбрать экспорт</button></div></div>' +
            '<input type="file" id="' + P + '-file" multiple hidden>' +
            '<div class="switch-row" id="' + P + '-ai-row"><div class="tx"><b>ИИ подбирает хештеги и имена</b><span class="sub" id="' + P + '-ai-sub"></span></div>' +
            '<input type="checkbox" class="switch" id="' + P + '-ai" aria-label="ИИ подбирает хештеги и имена"></div>' +
            '<div class="btn-group" style="margin-top:0.25rem">' +
            '<button type="button" class="btn" id="' + P + '-ai-run" hidden><i data-i="auto_awesome"></i>ИИ-разбор</button>' +
            '<button type="button" class="btn" id="' + P + '-dlall" hidden><i data-i="cloud_download"></i>Скачать все</button></div>' +
            '</div></div>' +
            '<div class="gal-bar" id="' + P + '-bar"><nav class="gal-crumbs" id="' + P + '-crumbs" aria-label="Путь"></nav>' +
            '<div class="gal-tools"><div class="seg" id="' + P + '-view" role="group" aria-label="Вид">' +
            '<button type="button" data-v="list" title="Список"><i data-i="view_list"></i><span>Список</span></button>' +
            '<button type="button" data-v="small" title="Мелкие значки"><i data-i="apps"></i><span>Мелкие</span></button>' +
            '<button type="button" data-v="large" title="Крупные значки"><i data-i="grid_view"></i><span>Крупные</span></button></div>' +
            '<select id="' + P + '-sort" aria-label="Порядок"><option value="new">Сначала новые</option><option value="old">Сначала старые</option><option value="big">Сначала тяжёлые</option></select></div>' +
            '<div class="gal-acts" id="' + P + '-acts"></div></div>' +
            '<div id="' + P + '-body"></div>';
    }
    function toggleSel(g, tile) {
        if (sel.has(g.id)) sel.delete(g.id); else sel.add(g.id);
        if (tile) tile.classList.toggle('is-sel', sel.has(g.id));
        renderActs(true, cur.files);
    }
    function init() {
        const host = $('#sov-' + K); if (!host) return;
        host.innerHTML = template(); hydrateIcons(host);
        const card = $(S('card')); if (collapsedCards.has(P + '-card')) card.classList.add('is-collapsed');
        const fi = $(S('file'));
        $(S('import')).addEventListener('click', () => { fi.value = ''; fi.click(); });
        fi.addEventListener('change', () => { const picked = Array.from(fi.files || []); fi.value = ''; importFiles(picked); });
        ['dragenter', 'dragover'].forEach(ev => card.addEventListener(ev, e => { if (e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files')) { e.preventDefault(); card.classList.add('tg-card-dragging'); } }));
        ['dragleave', 'drop'].forEach(ev => card.addEventListener(ev, () => card.classList.remove('tg-card-dragging')));
        card.addEventListener('drop', e => { if (e.dataTransfer && e.dataTransfer.files.length) { e.preventDefault(); importFiles(e.dataTransfer.files); } });
        $(S('ai')).addEventListener('change', e => { ui.ai = e.target.checked; uiSave(); renderCard(); toast(e.target.checked ? 'ИИ будет подбирать хештеги и имена' : 'ИИ выключен'); });
        $(S('ai-run')).addEventListener('click', aiRun);
        $(S('dlall')).addEventListener('click', downloadAll);
        $(S('view')).addEventListener('click', e => { const b = e.target.closest('[data-v]'); if (!b) return; ui.view = b.dataset.v; uiSave(); renderBody(); });
        $(S('sort')).addEventListener('change', e => { ui.sort = e.target.value; uiSave(); renderBody(); });
        $(S('crumbs')).addEventListener('click', e => { const b = e.target.closest('[data-p]'); if (b) open(path.slice(0, +b.dataset.p)); });
        $(S('acts')).addEventListener('click', async e => {
            const b = e.target.closest('[data-a]'); if (!b) return;
            const a = b.dataset.a;
            if (a === 'savefolder') saveFolder(path);
            else if (a === 'ai') aiRun();
            else if (a === 'flat') { flat = !flat; limit = GAL_PAGE; renderBody(); }
            else if (a === 'select') { sel = new Set(); renderBody(); }
            else if (a === 'done') { sel = null; renderBody(); }
            else if (a === 'all') { cur.files.forEach(g => sel.add(g.id)); renderBody(); }
            else if (a === 'save') saveSelected(Array.from(sel));
            else if (a === 'edit') editSheet(L().filter(g => sel.has(g.id)), () => { sel = null; renderBody(); });
            else if (a === 'del') { const items = L().filter(g => sel.has(g.id)); if (await deleteItems(items)) { sel = null; renderBody(); } }
        });
        const body = $(S('body'));
        const act = e => {
            const more = e.target.closest('[data-a="more"]'); if (more) { limit += GAL_PAGE; renderBody(); return; }
            const sv = e.target.closest('[data-save]'); if (sv) { e.stopPropagation(); const f = cur.folders[+sv.dataset.save]; if (f) saveFolder(path.concat(f.key)); return; }
            const dl = e.target.closest('[data-dl]'); if (dl) { e.stopPropagation(); const g = cur.files[+dl.dataset.dl]; if (g) saveOne(g); return; }
            const fo = e.target.closest('[data-f]'); if (fo) { const f = cur.folders[+fo.dataset.f]; if (f) open(path.concat(f.key)); return; }
            const fl = e.target.closest('[data-i]'); if (fl) {
                const g = cur.files[+fl.dataset.i]; if (!g) return;
                if (sel) toggleSel(g, fl); else openViewer(cur.files.slice(), +fl.dataset.i);
            }
        };
        body.addEventListener('click', act);
        body.addEventListener('keydown', e => { if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('[role="button"]')) { e.preventDefault(); act(e); } });
        render(); refreshLocal();
    }

    return {
        key: K, init, render, renderCard, refreshIfOpen, refreshLocal, open, downloadAll, cacheInfo, clearCache,
        list: L, label: W, isBusy: () => busy, count: () => L().length
    };
}

// ---------- Две страницы: фото и видео ----------
const GAL = {
    photo: createGalSection({
        key: 'photo', p: 'gal', idp: 'gl', dkey: 'gallery', uiKey: 'gallery_ui', fileMax: 80 * 1048576, rootLabel: 'Мое_совсек', zipRoot: 'Мое_совсек', driveName: 'Мое_совсек',
        get: () => gallery, set: v => { gallery = v; }, save: saveGallery,
        roots: [
            { key: 'img', name: 'Картинки', icon: 'image', kind: 'image' },
            { key: 'gif', name: 'GIF', icon: 'gif', kind: 'gif', badge: 'GIF' },
            { key: 'act', name: 'Актёры', icon: 'person' },
            { key: 'tag', name: 'Хештеги', icon: 'tag' }
        ]
    }),
    video: createGalSection({
        key: 'video', p: 'vid', idp: 'gv', dkey: 'videos', uiKey: 'videos_ui', fileMax: 1024 * 1048576, rootLabel: 'Видео', zipRoot: 'Мое_совсек_видео', driveName: 'Мое_совсек_видео',
        get: () => videos, set: v => { videos = v; }, save: saveVideos,
        roots: [
            { key: 'vid', name: 'Видео', icon: 'movie', kind: 'video' },
            { key: 'anim', name: 'GIF-анимации', icon: 'gif', kind: 'anim', badge: 'GIF' },
            { key: 'act', name: 'Актёры', icon: 'person' },
            { key: 'tag', name: 'Хештеги', icon: 'tag' }
        ]
    })
};

// ---------- Переключатель «Фото и GIF | Видео» ----------
let galTab = LS.get('sov_tab', 'photo');
function galRenderSwitch() {
    $$('#sov-switch [data-sov]').forEach(b => {
        const on = b.dataset.sov === galTab; b.classList.toggle('is-on', on); b.setAttribute('aria-pressed', on);
        const n = b.querySelector('.cnt'); if (n) n.textContent = GAL[b.dataset.sov].count() ? String(GAL[b.dataset.sov].count()) : '';
    });
    $$('.sov-pane').forEach(p => { p.hidden = p.id !== 'sov-' + galTab; });
}
function galShowTab(k) {
    if (!GAL[k]) k = 'photo';
    galTab = k; LS.set('sov_tab', k); galRenderSwitch(); GAL[k].refreshIfOpen(); GAL[k].render();
}

// ---------- Общие функции для остального приложения ----------
function renderGallery() { if (!$('#sovsek')) return; galRenderSwitch(); GAL[galTab].refreshIfOpen(); GAL[galTab].render(); }
function galRefreshIfOpen() { galRenderSwitch(); GAL.photo.refreshIfOpen(); GAL.video.refreshIfOpen(); if (typeof renderSovStore === 'function') renderSovStore(); }
function initGallery() {
    if (!$('#sovsek')) return;
    GAL.photo.init(); GAL.video.init();
    $('#sov-switch').addEventListener('click', e => { const b = e.target.closest('[data-sov]'); if (b) galShowTab(b.dataset.sov); });
    galRenderSwitch(); renderGallery();
}

// ---------- Настройки → Google Диск: «Мое_совсек на этом устройстве» (кнопки «Скачать все фото» и «Очистить кеш») ----------
async function renderSovStore() {
    const info = $('#sov-store-info'); if (!info) return;
    try {
        const idx = await BlobDB.index(), part = (list) => { let full = 0, thumbs = 0, bytes = 0; list.forEach(g => { const r = idx.get(g.id); if (r && r.full) { full++; bytes += Number(g.size) || 0; } if (r && r.thumb) thumbs++; }); return { total: list.length, full, thumbs, bytes }; };
        const p = part(gallery), v = part(videos);
        info.textContent = 'Фото и GIF: ' + p.total + ' · превью на устройстве: ' + p.thumbs + ' · полных файлов: ' + p.full + ' (' + fmtBytes(p.bytes) + ').' +
            (v.total ? ' Видео: ' + v.total + ' · превью: ' + v.thumbs + ' · полных файлов: ' + v.full + ' (' + fmtBytes(v.bytes) + ').' : '');
        const miss = p.total - p.full;
        const dl = $('#sov-dl-all'); if (dl) { dl.disabled = !miss; dl.innerHTML = ic('cloud_download') + 'Скачать все фото в Мое_совсек' + (miss ? ' (' + miss + ')' : ''); }
        const cl = $('#sov-clear'); if (cl) cl.disabled = !(p.full || v.full);
    } catch (e) { info.textContent = ''; }
}
async function galClearCacheAll() {
    const parts = [GAL.photo, GAL.video];
    if (parts.some(s => s.isBusy())) { toast('Идёт обработка — подождите'); return; }
    let infos;
    try { infos = await Promise.all(parts.map(s => s.cacheInfo())); } catch (e) { toast('Не удалось проверить Google Диск: ' + (e && e.message ? e.message : e), { ms: 6000 }); return; }
    const have = infos.reduce((s, i) => s + i.have, 0), safe = infos.reduce((s, i) => s + i.safe, 0), safeBytes = infos.reduce((s, i) => s + i.safeBytes, 0);
    if (!have) { toast('На устройстве нет загруженных оригиналов'); return; }
    if (!safe) { toast('Ничего не удалено: оригиналов, которые точно лежат на Google Диске, нет. Сначала дождитесь синхронизации.', { ms: 7000 }); return; }
    const live = infos.every(i => !i.have || i.live), kept = have - safe;
    const thumbs = infos.reduce((s, i) => s + i.thumbs, 0);
    const sheet = openSheet({
        title: 'Очистить кеш?',
        html: '<p class="hint" style="font-size:15px;color:var(--md-on-surface);margin:0 0 0.5rem">С устройства будут удалены полные фото, GIF и видео из «Мое_совсек»: <b>' + safe + '</b> (' + fmtBytes(safeBytes) + '). В облаке (Google Диск) они остаются, и при открытии скачиваются снова.</p>' +
            (kept ? '<p class="hint" style="margin:0 0 0.5rem">Не тронуты ' + kept + ' файл(ов): их ещё нет на Google Диске, удалять их с устройства нельзя.</p>' : '') +
            (live ? '' : '<p class="hint" style="margin:0 0 0.5rem">Вход в Google устарел, поэтому наличие файлов на Диске взято по отметкам последней синхронизации.</p>') +
            '<label class="switch-row" style="margin-top:0.25rem"><span class="tx"><b>Удалить и превью</b><span class="sub">Значки в папках (' + thumbs + ') тоже уйдут с устройства; после синхронизации они скачаются заново. Обычно это не нужно</span></span><input type="checkbox" class="switch" id="sov-clear-th"></label>',
        actions: [{ label: 'Отмена' }, { label: 'Очистить', kind: 'danger', icon: 'delete', async onClick(api) {
            const dropThumbs = $('#sov-clear-th', api.el).checked; let n = 0;
            for (let k = 0; k < parts.length; k++) if (infos[k].ids.length) n += await parts[k].clearCache(infos[k].ids, dropThumbs);
            renderSovStore();
            toast('Кеш очищен: удалено полных файлов ' + n + ' (' + fmtBytes(safeBytes) + '). В облаке они сохранены.', { ms: 6000 });
        } }]
    });
    return sheet;
}
