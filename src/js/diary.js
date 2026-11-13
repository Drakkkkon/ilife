'use strict';
// =====================================================================================================
// iLife 2.7.0 — РАЗДЕЛ «ДНЕВНИК»: своё меню с кнопкой «Назад» и две страницы.
//   «Запись дня» — большое поле с оформлением текста (жирный, курсив, подчёркнутый, зачёркнутый, маркер, заголовки,
//                  цитата, списки, отмена), записи по дням (‹ день ›, «Сегодня», выбор даты), фото и видео дня.
//                  Запись сохраняется сама через полсекунды после правки.
//   «Полка»       — каждый день с записью — книга, каждая полка — месяц. Рисунок в духе «Геометрии Полки»: белый фон,
//                  светлая рамка с тонкой тёмной обводкой, сетка, размерная линия с подписью, пять цветов корешков.
//                  Толщина книги — длина записи, на корешке — число, день недели и первые слова. Нажатие — открыть день.
// Данные — список diary (ключ ilife_diary), одна запись на день: { id:'dy'+дата, date, html, text, files:[вложения], createdAt, author }.
// Фото и видео лежат в IndexedDB (BlobDB) и синхронизируются с Google Диском как остальные вложения (видео до 50 МБ).
// =====================================================================================================

(function () {
    if (!window.ICONS) return;
    Object.assign(window.ICONS, {
        sticky_note: '<path d="M19 3H4.99C3.89 3 3 3.9 3 5l.01 14c0 1.1.89 2 1.99 2h10l6-6V5c0-1.1-.9-2-2-2M7 8h10v2H7zm5 6H7v-2h5zm2 5.5V14h5.5z"/>',
        perm_media: '<path d="M2 6H0v5h.01L0 20c0 1.1.9 2 2 2h18v-2H2zm20-2h-8l-2-2H6c-1.1 0-1.99.9-1.99 2L4 16c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2M7 15l4.5-6 3.5 4.51 2.5-3.01L21 15z"/>',
        auto_stories: '<path d="M19 1l-5 5v11l5-4.5zM1 6v14.65c0 .25.25.5.5.5.1 0 .15-.05.25-.05C3.1 20.45 5.05 20 6.5 20c1.95 0 4.05.4 5.5 1.5V6c-1.45-1.1-3.55-1.5-5.5-1.5S2.45 4.9 1 6m22 13.5V6c-.6-.45-1.25-.75-2-1v13.5c-1.1-.35-2.3-.5-3.5-.5-1.7 0-4.15.65-5.5 1.5v2c1.35-.85 3.8-1.5 5.5-1.5 1.65 0 3.35.3 4.75 1.05.1.05.15.05.25.05.25 0 .5-.25.5-.5z"/>',
        shelf: '<path d="M3 3h2v18H3zm16 0h2v18h-2zM5 19h14v2H5zm0-8h14v2H5zm1-1h2V5H6zm3 0h2V6H9zm3 0h2.5V4.5H12zM6 18h2v-4H6zm3 0h2.5v-3.5H9zm3.5 0h2v-5h-2z"/>',
        format_quote: '<path d="M6 17h3l2-4V7H5v6h3zm8 0h3l2-4V7h-6v6h3z"/>',
        format_list_bulleted: '<path d="M4 10.5c-.83 0-1.5.67-1.5 1.5s.67 1.5 1.5 1.5 1.5-.67 1.5-1.5-.67-1.5-1.5-1.5m0-6c-.83 0-1.5.67-1.5 1.5S3.17 7.5 4 7.5 5.5 6.83 5.5 6 4.83 4.5 4 4.5m0 12c-.83 0-1.5.68-1.5 1.5s.68 1.5 1.5 1.5 1.5-.68 1.5-1.5-.67-1.5-1.5-1.5M7 19h14v-2H7zm0-6h14v-2H7zm0-8v2h14V5z"/>',
        redo: '<path d="M18.4 10.6C16.55 8.99 14.15 8 11.5 8c-4.65 0-8.58 3.03-9.96 7.22L3.9 16c1.05-3.19 4.05-5.5 7.6-5.5 1.95 0 3.73.72 5.12 1.88L13 16h9V7z"/>',
        format_clear: '<path d="M3.27 5 2 6.27l6.97 6.97L6.5 19h3l1.57-3.66L16.73 21 18 19.73 3.55 5.27zM6 5v.18L8.82 8h2.4l-.72 1.68 2.1 2.1L14.21 8H20V5z"/>',
        videocam: '<path d="M17 10.5V7c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.55 0 1-.45 1-1v-3.5l4 4v-11z"/>'
    });
})();

const DY_PALETTE = ['#9b2f3f', '#2f6a50', '#2e5a8a', '#a96a14', '#66417a'];   // цвета корешков — как в «Геометрии Полки»
const DY_WD = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
const DY_VIDEO_MAX = 50 * 1048576;   // крупнее — не уйдёт на Google Диск (G_MEDIA_MAX)

let diary = LS.get('diary', []);
if (!Array.isArray(diary)) diary = [];
let dyDay = todayKey(), dyQuery = '';
let dySaveT = 0, dyDirty = false;

function saveDiary() { if (typeof cloudLocalChanged === 'function') cloudLocalChanged(); LS.set('diary', diary); }
function dyGet(day) { return diary.find(e => e && e.date === day) || null; }
function dyHash(s) { let h = 2166136261; for (const ch of String(s)) { h ^= ch.codePointAt(0); h = Math.imul(h, 16777619) >>> 0; } return h; }
function dyDayLabel(day) {
    const p = almatyParts(keyToMs(day)), t = todayKey();
    const rel = day === t ? 'Сегодня, ' : day === todayKey(-1) ? 'Вчера, ' : day === todayKey(1) ? 'Завтра, ' : '';
    return { main: p.d + ' ' + MONTHS_GEN[p.mo] + ' ' + p.y, sub: rel + WEEKDAYS[p.wd] };
}
function dyAfterSync() {
    const a = (document.querySelector('.tab.is-active') || {}).id;
    if (a === 'diary' && !dyDirty) dyLoad(); else if (a === 'diary-shelf') renderDiaryShelf();
}

// ---------- Очистка HTML: только простое оформление ----------
const DY_TAGS = { B: 'b', STRONG: 'b', I: 'i', EM: 'i', U: 'u', S: 's', STRIKE: 's', DEL: 's', MARK: 'mark', H1: 'h2', H2: 'h2', H3: 'h3', H4: 'h3', P: 'p', DIV: 'div', BR: 'br', UL: 'ul', OL: 'ol', LI: 'li', BLOCKQUOTE: 'blockquote' };
function dyClean(html) {
    const doc = new DOMParser().parseFromString('<body>' + String(html || '') + '</body>', 'text/html');
    const walk = (node, out) => {
        node.childNodes.forEach(n => {
            if (n.nodeType === 3) { out.appendChild(document.createTextNode(n.nodeValue)); return; }
            if (n.nodeType !== 1) return;
            const tag = DY_TAGS[n.tagName];
            if (!tag) { if (!/^(SCRIPT|STYLE|IFRAME|OBJECT|EMBED|IMG|VIDEO|AUDIO|SVG|TEMPLATE)$/.test(n.tagName)) walk(n, out); return; }   // прочие теги — без оформления, текст остаётся
            const el = document.createElement(tag);
            if (tag !== 'br') walk(n, el);
            out.appendChild(el);
        });
    };
    const box = document.createElement('div'); walk(doc.body, box);
    return box.innerHTML.replace(/(<br>\s*){3,}/g, '<br><br>').trim();
}
function dyPlain(html) {
    const box = document.createElement('div'); box.innerHTML = String(html || '').replace(/<\/(p|div|h2|h3|li|blockquote)>/g, '$&\n').replace(/<br>/g, '\n');
    return (box.textContent || '').replace(/\n{3,}/g, '\n\n').trim();
}

// ---------- Запись дня ----------
function dyLoad() {
    const ed = $('#dy-editor'); if (!ed) return;
    clearTimeout(dySaveT); dyDirty = false;
    const e = dyGet(dyDay), l = dyDayLabel(dyDay);
    $('#dy-date-main').textContent = l.main; $('#dy-date-sub').textContent = l.sub; $('#dy-date').value = dyDay;
    ed.innerHTML = e ? dyClean(e.html) : '';
    $('#dy-saved').textContent = e ? 'Сохранено' : '';
    dyCount(); renderDyMedia();
}
function dyCount() {
    const t = ($('#dy-editor').innerText || '').trim(), n = t ? t.split(/\s+/).length : 0;
    $('#dy-words').textContent = n ? medFmtN(n, 'слово', 'слова', 'слов') + ' · ' + medFmtN(t.length, 'знак', 'знака', 'знаков') : '';
}
function dySaveNow() {
    clearTimeout(dySaveT);
    if (!dyDirty) return;
    dyDirty = false;
    const ed = $('#dy-editor'); if (!ed) return;
    const html = dyClean(ed.innerHTML), text = dyPlain(html);
    let e = dyGet(dyDay);
    if (!text && (!e || !(e.files || []).length)) { if (e) { diary = diary.filter(x => x !== e); saveDiary(); } $('#dy-saved').textContent = ''; return; }
    if (!e) { e = { id: 'dy' + dyDay, date: dyDay, html: '', text: '', files: [], createdAt: Date.now(), author: authorName() }; diary.push(e); }
    if (e.html === html) { $('#dy-saved').textContent = 'Сохранено'; return; }
    e.html = html; e.text = text.slice(0, 20000);
    saveDiary();
    $('#dy-saved').textContent = 'Сохранено · ' + fmtTime(Date.now());
}
function dyChanged() { dyDirty = true; $('#dy-saved').textContent = 'Сохраняется…'; dyCount(); clearTimeout(dySaveT); dySaveT = setTimeout(dySaveNow, 600); }
function dyGo(day) { dySaveNow(); dyDay = day; dyLoad(); }

// оформление
function dyMark() {
    const sel = window.getSelection(); if (!sel.rangeCount) return;
    const r = sel.getRangeAt(0), ed = $('#dy-editor');
    if (!ed.contains(r.commonAncestorContainer)) return;
    const inMark = (r.startContainer.nodeType === 1 ? r.startContainer : r.startContainer.parentElement).closest('mark');
    if (inMark && ed.contains(inMark)) { const p = inMark.parentNode; while (inMark.firstChild) p.insertBefore(inMark.firstChild, inMark); p.removeChild(inMark); }
    else if (!r.collapsed) { const m = document.createElement('mark'); try { m.appendChild(r.extractContents()); r.insertNode(m); sel.removeAllRanges(); const nr = document.createRange(); nr.selectNodeContents(m); sel.addRange(nr); } catch (e) {} }
    dyChanged();
}
function dyBlock(tag) {
    const sel = window.getSelection(); let cur = '';
    if (sel.rangeCount) { const n = sel.getRangeAt(0).startContainer; const el = (n.nodeType === 1 ? n : n.parentElement).closest('h2,h3,blockquote,p,div'); if (el && $('#dy-editor').contains(el)) cur = el.tagName.toLowerCase(); }
    document.execCommand('formatBlock', false, cur === tag ? 'p' : tag);
    dyChanged();
}
function dyToolState() {
    $$('#dy-tools [data-cmd]').forEach(b => { const c = b.dataset.cmd; if (/^(bold|italic|underline|strikeThrough|insertUnorderedList|insertOrderedList)$/.test(c)) { let on = false; try { on = document.queryCommandState(c); } catch (e) {} b.classList.toggle('is-on', on); } });
}

// фото и видео
function dyPick(accept, capture) {
    return new Promise(resolve => {
        const inp = document.createElement('input'); inp.type = 'file'; inp.accept = accept; inp.multiple = !capture; inp.style.display = 'none';
        if (capture) inp.setAttribute('capture', 'environment');
        document.body.appendChild(inp);
        let done = false; const fin = () => { if (done) return; done = true; const f = Array.from(inp.files || []); setTimeout(() => inp.remove(), 0); resolve(f); };
        inp.addEventListener('change', fin); inp.addEventListener('cancel', fin); inp.click();
    });
}
function dyVideoThumb(file) {
    return new Promise(resolve => {
        const v = document.createElement('video'), url = URL.createObjectURL(file); let done = false;
        const fin = b => { if (done) return; done = true; URL.revokeObjectURL(url); resolve(b); };
        v.muted = true; v.playsInline = true; v.preload = 'metadata';
        v.onloadeddata = () => { try { v.currentTime = Math.min(0.5, (v.duration || 1) / 3); } catch (e) { fin(null); } };
        v.onseeked = () => { try { const k = Math.min(1, 480 / Math.max(v.videoWidth, v.videoHeight)); const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(v.videoWidth * k)); c.height = Math.max(1, Math.round(v.videoHeight * k)); c.getContext('2d').drawImage(v, 0, 0, c.width, c.height); c.toBlob(b => fin(b), 'image/jpeg', 0.8); } catch (e) { fin(null); } };
        v.onerror = () => fin(null); setTimeout(() => fin(null), 6000); v.src = url;
    });
}
async function dyAddFiles(files) {
    if (!files.length) return;
    let e = dyGet(dyDay);
    if (!e) { dySaveNow(); e = dyGet(dyDay); }
    if (!e) { e = { id: 'dy' + dyDay, date: dyDay, html: dyClean($('#dy-editor').innerHTML), text: '', files: [], createdAt: Date.now(), author: authorName() }; e.text = dyPlain(e.html); diary.push(e); }
    let big = 0, n = 0;
    for (const f of files) {
        try {
            if (/^video\//.test(f.type) || /\.(mp4|mov|webm|m4v|3gp|mkv)$/i.test(f.name || '')) {
                if (f.size > DY_VIDEO_MAX) big++;
                const a = { id: uid('f'), kind: 'video', name: f.name || 'видео.mp4', type: f.type || 'video/mp4', size: f.size, blob: f, thumb: await dyVideoThumb(f) };
                await persistAttachment(a); e.files.push(attachmentMeta(a)); n++;
            } else if (/^image\//.test(f.type) || /\.(jpe?g|png|webp|heic|heif|gif)$/i.test(f.name || '')) {
                const a = await makeAttachment(f, 'image'); await persistAttachment(a); e.files.push(attachmentMeta(a)); n++;
            } else toast('Это не фото и не видео: ' + (f.name || 'файл'));
        } catch (err) { toast('Не удалось добавить: ' + (f.name || 'файл')); }
    }
    if (n) { saveDiary(); renderDyMedia(); toast('Добавлено: ' + n); }
    if (big) toast('Видео крупнее 50 МБ останется только на этом устройстве (на Google Диск не уйдёт): ' + big, { ms: 7000 });
}
async function renderDyMedia() {
    const host = $('#dy-media'); if (!host) return;
    const e = dyGet(dyDay), files = (e && e.files) || [];
    host.innerHTML = files.map((f, i) => '<div class="dy-m" data-i="' + i + '"><img alt="" hidden>' +
        '<button type="button" class="dy-open" aria-label="' + (f.kind === 'video' ? 'Смотреть видео' : 'Открыть фото') + '"></button>' +
        (f.kind === 'video' ? '<span class="dy-play">' + ic('play_arrow') + '</span>' : '') +
        '<button type="button" class="med-thumb-x" data-x="' + i + '" aria-label="Убрать">' + ic('close') + '</button></div>').join('');
    for (let i = 0; i < files.length; i++) {
        const box = host.querySelector('.dy-m[data-i="' + i + '"]'); if (!box) continue;
        const img = box.querySelector('img');
        const u = await BlobDB.url(files[i].id, 'thumb') || (files[i].kind !== 'video' ? await BlobDB.url(files[i].id) : null);
        if (u) { img.src = u; img.hidden = false; } else if (!(await BlobDB.get(files[i].id))) box.classList.add('is-missing');
    }
}
async function dyOpenMedia(i) {
    const e = dyGet(dyDay); if (!e) return;
    const f = e.files[i]; if (!f) return;
    if (f.kind !== 'video') { const imgs = e.files.filter(x => x.kind !== 'video'); openLightbox(imgs.map(x => x.id), imgs.indexOf(f)); return; }
    const u = await BlobDB.url(f.id);
    if (!u) { toast('Видео ещё не скачано с Google Диска'); return; }
    openSheet({ title: f.name || 'Видео', html: '<div class="dy-video-sheet"><video src="' + u + '" controls playsinline autoplay></video></div>', actions: [{ label: 'Закрыть' }] });
}
async function dyRemoveMedia(i) {
    const e = dyGet(dyDay); if (!e || !e.files[i]) return;
    if (!(await confirmSheet('Убрать из дня?', (e.files[i].kind === 'video' ? 'Видео' : 'Фото') + ' будет удалено из записи.', 'Убрать', true))) return;
    const [f] = e.files.splice(i, 1); BlobDB.del(f.id);
    if (!e.files.length && !e.text) diary = diary.filter(x => x !== e);
    saveDiary(); renderDyMedia();
}

// ---------- Полка ----------
function dyMonthTitle(y, mo) { return capitalizeFirst(MONTHS_NOM[mo]) + ' ' + y; }
function dyMatches(e, q) { if (!q) return true; const h = normText(e.text + ' ' + dyDayLabel(e.date).main + ' ' + dyDayLabel(e.date).sub); return q.split(/\s+/).every(w => h.includes(w)); }
function dySpineWords(text, n) { return String(text || '').replace(/\s+/g, ' ').trim().split(' ').slice(0, n).join(' '); }
// Месяц — стеллаж в две полки: дни 1–15 сверху, 16–31 снизу (так книги крупнее на телефоне)
function dyShelfSvg(y, mo, entries, q) {
    const W = 660, IX = 52, IW = 576, IH = 206, BOARD = 26;
    const tiers = [{ y0: 62, from: 1, to: 15 }, { y0: 62 + IH + BOARD, from: 16, to: 31 }];
    const days = new Date(Date.UTC(y, mo + 1, 0)).getUTCDate(), H = tiers[1].y0 + IH + 54;
    const today = todayKey(), curMonth = today.slice(0, 7) === y + '-' + pad2(mo + 1);
    let s = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="group" aria-label="Полка «' + esc(dyMonthTitle(y, mo)) + '»: книг ' + entries.length + '">';
    // размерная линия с подписью месяца (как «1000 мм» в «Геометрии Полки»)
    s += '<g class="sh-dim"><path d="M' + IX + ' 18V40M' + (IX + IW) + ' 18V40M' + IX + ' 24H' + (IX + IW) + '"/><path class="arr" d="M' + IX + ' 24l12-4v8zM' + (IX + IW) + ' 24l-12-4v8z"/>' +
        '<text x="' + (IX + IW / 2) + '" y="16" text-anchor="middle">' + esc(dyMonthTitle(y, mo)) + ' · ' + medFmtN(entries.length, 'книга', 'книги', 'книг') + '</text></g>';
    // рамка стеллажа: наружный контур и два проёма
    let frame = 'M' + (IX - 20) + ' ' + (tiers[0].y0 - 20) + 'H' + (IX + IW + 20) + 'V' + (tiers[1].y0 + IH + 20) + 'H' + (IX - 20) + 'Z';
    tiers.forEach(t => {
        s += '<rect class="sh-in" x="' + IX + '" y="' + t.y0 + '" width="' + IW + '" height="' + IH + '"/>';
        for (let gx = IX + 48; gx < IX + IW; gx += 48) s += '<path class="sh-grid" d="M' + gx + ' ' + t.y0 + 'V' + (t.y0 + IH) + '"/>';
        for (let gy = t.y0 + 48; gy < t.y0 + IH; gy += 48) s += '<path class="sh-grid" d="M' + IX + ' ' + gy + 'H' + (IX + IW) + '"/>';
        frame += ' M' + IX + ' ' + t.y0 + 'V' + (t.y0 + IH) + 'H' + (IX + IW) + 'V' + t.y0 + 'Z';
        const toDay = Math.min(t.to, days);
        s += '<g class="sh-dim"><text transform="translate(' + (IX - 28) + ' ' + (t.y0 + IH / 2) + ') rotate(-90)" text-anchor="middle" style="font-size:12px">' + t.from + '–' + toDay + '</text></g>';
        const FLOOR = t.y0 + IH;
        let x = IX + 6;
        entries.filter(e => { const d = +e.date.slice(8, 10); return d >= t.from && d <= t.to; }).forEach(e => {
            const p = almatyParts(keyToMs(e.date)), len = (e.text || '').length + (e.files || []).length * 200;
            const bw = Math.round(Math.max(22, Math.min(34, 18 + Math.sqrt(len) * 0.5)));
            const h = 150 + (dyHash(e.date) % 46), top = FLOOR - h, c = DY_PALETTE[dyHash(e.id) % DY_PALETTE.length];
            const dim = q && !dyMatches(e, q), cx = x + bw / 2;
            const words = dySpineWords(e.text, 6) || ((e.files || []).length ? 'фото и видео' : '');
            const dfs = Math.min(17, bw * 0.6), fs = Math.max(9.5, Math.min(13, bw * 0.42));
            s += '<g class="bk' + (e.date === today ? ' is-today' : '') + '" data-day="' + e.date + '" tabindex="0" role="button" aria-label="' + esc(dyDayLabel(e.date).main + ', ' + dyDayLabel(e.date).sub) + '"' + (dim ? ' opacity=".18"' : '') + '>' +
                '<title>' + esc(dyDayLabel(e.date).main + ' · ' + (dySpineWords(e.text, 14) || 'фото и видео')) + '</title>' +
                '<rect class="b" x="' + x + '" y="' + top + '" width="' + bw + '" height="' + h + '" fill="' + c + '"/>' +
                '<rect class="band" x="' + x + '" y="' + (top + 8) + '" width="' + bw + '" height="3"/><rect class="band" x="' + x + '" y="' + (FLOOR - 11) + '" width="' + bw + '" height="3"/>' +
                '<text class="sp" x="' + cx + '" y="' + (FLOOR - 17) + '" font-size="' + dfs.toFixed(1) + '" text-anchor="middle" font-weight="700">' + p.d + '</text>' +
                '<text class="sp" x="' + cx + '" y="' + (FLOOR - 19 - dfs) + '" font-size="' + (fs * 0.82).toFixed(1) + '" text-anchor="middle" fill-opacity=".85">' + DY_WD[p.wd] + '</text>';
            if (words) {
                const room = h - 58 - dfs, maxCh = Math.max(4, Math.floor(room / (fs * 0.55)));
                const line = words.length > maxCh ? words.slice(0, maxCh - 1) + '…' : words;
                s += '<text class="sp" transform="translate(' + (cx + fs * 0.36).toFixed(1) + ' ' + (top + 18) + ') rotate(90)" font-size="' + fs.toFixed(1) + '">' + esc(line) + '</text>';
            }
            if ((e.files || []).length) s += '<circle cx="' + cx + '" cy="' + (top + 4.5) + '" r="2.2" fill="#fff" fill-opacity=".85"/>';
            s += '</g>';
            x += bw;
        });
        // сегодняшний день ещё без записи — пустое место для книги
        const td = +today.slice(8, 10);
        if (curMonth && td >= t.from && td <= t.to && !entries.some(e => e.date === today) && x + 30 < IX + IW) {
            s += '<g class="bk ghost" data-day="' + today + '" tabindex="0" role="button" aria-label="Написать запись за сегодня"><rect x="' + (x + 4) + '" y="' + (FLOOR - 170) + '" width="26" height="170"/>' +
                '<text transform="translate(' + (x + 21) + ' ' + (FLOOR - 160) + ') rotate(90)" style="font-size:12px">+ сегодня</text></g>';
        }
    });
    s += '<path class="sh-frame" fill-rule="evenodd" d="' + frame + '"/>';
    return s + '</svg>';
}
function renderDiaryShelf() {
    const host = $('#dy-shelves'); if (!host) return;
    const q = normText(dyQuery).trim();
    const list = diary.filter(e => e && e.date && ((e.text || '').trim() || (e.files || []).length)).sort((a, b) => a.date.localeCompare(b.date));
    const months = new Map();
    list.forEach(e => { const k = e.date.slice(0, 7); if (!months.has(k)) months.set(k, []); months.get(k).push(e); });
    const curKey = todayKey().slice(0, 7);
    if (!months.has(curKey)) months.set(curKey, []);
    const keys = Array.from(months.keys()).sort().reverse();
    const found = q ? list.filter(e => dyMatches(e, q)).length : 0;
    host.innerHTML = (q ? '<p class="hint" style="margin:0 0.25rem">Найдено дней: ' + found + '</p>' : '') + keys.map((k, i) => {
        const [y, m] = k.split('-').map(Number), ent = months.get(k);
        if (q && !ent.some(e => dyMatches(e, q))) return '';
        const chars = ent.reduce((a, e) => a + (e.text || '').length, 0), media = ent.reduce((a, e) => a + (e.files || []).length, 0);
        return '<section class="dy-shelf"><div class="dy-shelf-h"><b>Полка ' + (keys.length - i) + ' · ' + esc(dyMonthTitle(y, m - 1)) + '</b><small>' + medFmtN(ent.length, 'день', 'дня', 'дней') + (media ? ' · фото и видео: ' + media : '') + '</small></div>' +
            dyShelfSvg(y, m - 1, ent, q) + '<p class="dy-shelf-cap">' + (ent.length ? 'Всего ' + medFmtN(chars, 'знак', 'знака', 'знаков') + ' · самая толстая книга — ' + dyDayLabel(ent.slice().sort((a, b) => (b.text || '').length - (a.text || '').length)[0].date).main : 'Полка пока пустая — напишите первую запись месяца') + '</p></section>';
    }).join('');
}

// ---------- PDF: записи месяца ----------
async function exportDiaryPdf() {
    dySaveNow();
    const ym = dyDay.slice(0, 7), [y, m] = ym.split('-').map(Number);
    const list = diary.filter(e => e.date && e.date.slice(0, 7) === ym && ((e.text || '').trim() || (e.files || []).length)).sort((a, b) => a.date.localeCompare(b.date));
    if (!list.length) { toast('В этом месяце записей нет'); return; }
    try {
        const accent = pdfAccent();
        const pdf = new PdfWriter({ title: 'iLife — Дневник', footer: 'iLife · Дневник · ' + authorName() });
        pdfHeader(pdf, 'Дневник', dyMonthTitle(y, m - 1) + '  ·  ' + medFmtN(list.length, 'день', 'дня', 'дней'), accent);
        for (const e of list) {
            const l = dyDayLabel(e.date);
            pdf.ensure(60);
            pdf.textAt(l.main, pdf.mx, pdf.y + 13, 14, { bold: true, color: '#1d1b20' });
            pdf.textAt(l.sub.replace(/^[^,]+, /, ''), pdf.W - pdf.mx, pdf.y + 13, 10, { color: accent, bold: true, align: 'right' });
            pdf.y += 20; pdf.line(pdf.mx, pdf.y, pdf.W - pdf.mx, pdf.y, '#cac4d0', 0.6); pdf.gap(7);
            if (e.text) pdf.para(e.text, { size: 11, color: '#1d1b20', lh: 1.4 });
            const imgs = (e.files || []).filter(f => f.kind !== 'video').slice(0, 6), vids = (e.files || []).filter(f => f.kind === 'video').length;
            if (imgs.length) {
                pdf.gap(6);
                const cols = 3, gapPt = 6, cellW = (pdf.cw - gapPt * (cols - 1)) / cols, maxH = 140;
                for (let i = 0; i < imgs.length; i += cols) {
                    const row = [];
                    for (const f of imgs.slice(i, i + cols)) { const rec = await BlobDB.get(f.id); row.push(rec ? await pdfImageFromBlob(rec.blob, 900, 0.8) : null); }
                    const hRow = Math.max(40, ...row.map(im => im ? Math.min(maxH, cellW * im.h / im.w) : 0));
                    pdf.ensure(hRow + gapPt);
                    row.forEach((im, j) => { if (im) pdf.image(im, pdf.mx + j * (cellW + gapPt), pdf.y, cellW, maxH); });
                    pdf.y += hRow + gapPt;
                }
            }
            if (vids) pdf.para('Видео в записи: ' + vids + ' (смотрите в iLife)', { size: 9, color: '#79747e' });
            pdf.gap(16);
        }
        await finishPdf(pdf, 'Дневник_' + ym);
    } catch (err) { console.error(err); toast('Не удалось собрать PDF'); }
}

function diaryTabOpened(id) {
    if (id === 'diary') dyLoad();
    if (id === 'diary-shelf') { dySaveNow(); renderDiaryShelf(); }
}
function initDiary() {
    const ed = $('#dy-editor'); if (!ed) return;
    ed.addEventListener('input', dyChanged);
    ed.addEventListener('blur', dySaveNow);
    ed.addEventListener('paste', e => {   // вставка — простым текстом, чтобы чужое оформление не ломало запись
        const t = e.clipboardData && e.clipboardData.getData('text/plain'); if (t == null) return;
        e.preventDefault(); document.execCommand('insertText', false, t);
    });
    ed.addEventListener('keyup', dyToolState); ed.addEventListener('mouseup', dyToolState);
    document.addEventListener('selectionchange', () => { if (document.activeElement === ed) dyToolState(); });
    try { document.execCommand('defaultParagraphSeparator', false, 'p'); } catch (e) {}
    $('#dy-tools').addEventListener('mousedown', e => { if (e.target.closest('button')) e.preventDefault(); });   // не терять выделение в поле
    $('#dy-tools').addEventListener('click', e => {
        const b = e.target.closest('button'); if (!b) return;
        if (b.id === 'dy-photo') { dyPick('image/*').then(dyAddFiles); return; }
        if (b.id === 'dy-video') { dyPick('video/*').then(dyAddFiles); return; }
        if (b.id === 'dy-cam') { dyPick('image/*,video/*', true).then(dyAddFiles); return; }
        ed.focus();
        if (b.dataset.cmd === 'mark') dyMark();
        else if (b.dataset.block) dyBlock(b.dataset.block);
        else if (b.dataset.cmd) { document.execCommand(b.dataset.cmd, false, null); dyChanged(); }
        dyToolState();
    });
    $('#dy-prev').addEventListener('click', () => dyGo(dayKey(keyToMs(dyDay) - 86400000)));
    $('#dy-next').addEventListener('click', () => dyGo(dayKey(keyToMs(dyDay) + 86400000)));
    $('#dy-today').addEventListener('click', () => dyGo(todayKey()));
    $('#dy-date-btn').addEventListener('click', () => { const d = $('#dy-date'); try { d.showPicker(); } catch (e) { d.click(); } });
    $('#dy-date').addEventListener('change', e => { if (e.target.value) dyGo(e.target.value); });
    $('#dy-media').addEventListener('click', e => {
        const x = e.target.closest('[data-x]'); if (x) { dyRemoveMedia(+x.dataset.x); return; }
        const m = e.target.closest('.dy-m'); if (m) dyOpenMedia(+m.dataset.i);
    });
    $('#dy-pdf').addEventListener('click', exportDiaryPdf);
    $('#dy-shelf-write').addEventListener('click', () => { dyDay = todayKey(); showTab('diary'); });
    const q = $('#dy-q'); q.addEventListener('input', debounce(() => { dyQuery = q.value; renderDiaryShelf(); }, 180));
    const open = e => { const g = e.target.closest('.bk[data-day]'); if (!g) return; dySaveNow(); dyDay = g.dataset.day; showTab('diary'); };
    $('#dy-shelves').addEventListener('click', open);
    $('#dy-shelves').addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(e); } });
    window.addEventListener('pagehide', dySaveNow);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') dySaveNow(); });
}
