'use strict';
// =====================================================================================================
// iLife — ПЕСНИ-КОНТЕЙНЕРЫ (версия 1.7.0). Для сценарной работы, не для прослушивания.
//
// Идея: вы загружаете СВОЙ аудиофайл (из Spotify полную песню получить нельзя — это запрещено правилами сервиса), приложение рисует
// форму волны и позволяет разрезать песню на блоки ЛЮБОЙ длительности. У каждого блока есть подпись (до 50 символов), заметка, картинки
// и голосовые записи. Песня становится контейнером для подробной записи: «что происходит в сцене под этот отрезок музыки».
//
// Запись песни: { id, title, artist, noteTitle, createdAt, updatedAt, author, audioId, audioName, audioType, audioSize, dur,
//                 coverId?, peaks (base64, форма волны), blocks[] }
// Блок:         { id, start, end (секунды), h (оттенок цвета), label (≤ 50 символов), note, imgs[], voices[], at }
//   imgs / voices — метаданные вложений (как у идей), сами файлы лежат в IndexedDB (BlobDB) под тем же id.
// Аудио: на устройстве (BlobDB, id = audioId) и на Google Диске в папке iLife/Песни/<ГГГГ-ММ-ДД>/ под именем
//        автор_название_дата_названиезаметки.mp3 (js/gdrive.js → gSyncSongs). Остальное — в общем файле данных.
// Ссылки из сценариев: у сцены может быть отметка «музыка» { s: id песни, b: id блока } (js/scripts.js).
// =====================================================================================================

let songs = LS.get('songs', []);
if (!Array.isArray(songs)) songs = [];
function saveSongs() { if (typeof cloudLocalChanged === 'function') cloudLocalChanged(); return LS.set('songs', songs); }
const saveSongsSoon = debounce(() => saveSongs(), 600);

const SONG_LABEL_MAX = 50;
const SONG_FILE_MAX = 200 * 1048576;
const SONG_ZOOMS = [1, 2, 4, 8, 16];
const SONG_RATES = [0.5, 0.75, 1, 1.25, 1.5, 2];
const songById = id => songs.find(s => s.id === id) || null;
const songBlocks = sg => (sg.blocks || []).slice().sort((a, b) => a.start - b.start);
const songBlockAt = (sg, t) => (sg.blocks || []).find(b => t >= b.start && t < b.end) || null;

// ---------- Время: 1:05 ↔ секунды ----------
function fmtClock(t, dec) {
    t = Math.max(0, Number(t) || 0);
    const h = Math.floor(t / 3600), m = Math.floor(t % 3600 / 60), s = t % 60;
    const sec = dec ? s.toFixed(1).padStart(4, '0') : String(Math.floor(s)).padStart(2, '0');
    return h ? h + ':' + pad2(m) + ':' + sec : m + ':' + sec;
}
function parseClock(str) {
    str = String(str == null ? '' : str).trim().replace(',', '.').replace(/\s+/g, '');
    if (!str) return NaN;
    let m;
    if ((m = str.match(/^(?:(\d+):)?(\d{1,2}):(\d{1,2}(?:\.\d+)?)$/))) return (+m[1] || 0) * 3600 + (+m[2]) * 60 + parseFloat(m[3]);
    if ((m = str.match(/^(\d+(?:\.\d+)?)(с|c|s|сек)?$/i))) return parseFloat(m[1]);
    if ((m = str.match(/^(\d+(?:\.\d+)?)(м|m|мин)$/i))) return parseFloat(m[1]) * 60;
    return NaN;
}
function fmtSpan(sec) {
    sec = Math.max(0, Number(sec) || 0);
    if (sec < 60) return (Math.round(sec * 10) / 10).toString().replace('.', ',') + ' с';
    const m = Math.floor(sec / 60), s = Math.round(sec % 60);
    return m + ' мин' + (s ? ' ' + s + ' с' : '');
}

// ---------- Имена файлов: автор_название_дата_названиезаметки ----------
const songSafe = (s, max) => String(s || '').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '_').replace(/\s+/g, ' ').replace(/^\.+/, '').trim().slice(0, max || 60);
function songExt(sg) {
    const m = /\.([a-z0-9]{2,5})$/i.exec(sg.audioName || '');
    if (m) return m[1].toLowerCase();
    const t = sg.audioType || '';
    return /mp4|m4a|aac/.test(t) ? 'm4a' : /ogg|opus/.test(t) ? 'ogg' : /wav/.test(t) ? 'wav' : /flac/.test(t) ? 'flac' : /webm/.test(t) ? 'webm' : 'mp3';
}
function songFileName(sg) {
    const parts = [sg.artist, sg.title, dayKey(sg.createdAt), sg.noteTitle].map(x => songSafe(x)).filter(Boolean);
    return parts.join('_') + '.' + songExt(sg);
}
function songDrivePath(sg) { return 'iLife / ' + G_SONG_FOLDER_NAME + ' / ' + dayKey(sg.createdAt) + ' / ' + songFileName(sg); }
function songGuessFromFile(name) {
    const base = String(name || '').replace(/\.[^.]+$/, '').replace(/[_]+/g, ' ').trim();
    const m = base.match(/^(.+?)\s+[-–—]\s+(.+)$/);
    return m ? { artist: m[1].trim(), title: m[2].trim() } : { artist: '', title: base };
}
function songTitleOf(sg) { return (sg.title || 'Без названия') + (sg.artist ? ' — ' + sg.artist : ''); }

// ---------- Теги MP3 (ID3v2): название, исполнитель, обложка ----------
async function songReadId3(file) {
    const head = new Uint8Array(await file.slice(0, 10).arrayBuffer());
    if (head.length < 10 || head[0] !== 0x49 || head[1] !== 0x44 || head[2] !== 0x33) return {};
    const ver = head[3], sync = (a, i) => ((a[i] & 0x7f) << 21) | ((a[i + 1] & 0x7f) << 14) | ((a[i + 2] & 0x7f) << 7) | (a[i + 3] & 0x7f);
    const size = sync(head, 6), buf = new Uint8Array(await file.slice(0, Math.min(10 + size, 8 * 1048576)).arrayBuffer());
    if (ver < 3) return {};
    const out = {}; let p = 10;
    if (head[5] & 0x40) { const ext = ver === 4 ? sync(buf, p) : ((buf[p] << 24) | (buf[p + 1] << 16) | (buf[p + 2] << 8) | buf[p + 3]) + 4; p += ext; }
    const dec = (bytes, enc) => {
        try {
            if (enc === 1 || enc === 2) { let le = true, b = bytes; if (enc === 1 && b.length >= 2) { if (b[0] === 0xfe && b[1] === 0xff) { le = false; b = b.subarray(2); } else if (b[0] === 0xff && b[1] === 0xfe) b = b.subarray(2); } else if (enc === 2) le = false; return new TextDecoder(le ? 'utf-16le' : 'utf-16be').decode(b); }
            if (enc === 3) return new TextDecoder('utf-8').decode(bytes);
            return new TextDecoder(bytes.some(x => x >= 0x80) ? 'windows-1251' : 'iso-8859-1').decode(bytes);   // русские теги в старых файлах — в кодировке Windows-1251
        } catch (e) { return ''; }
    };
    const clean = s => s.replace(/\u0000+$/g, '').replace(/^﻿/, '').trim();
    while (p + 10 <= buf.length && p < 10 + size) {
        const id = String.fromCharCode(buf[p], buf[p + 1], buf[p + 2], buf[p + 3]);
        if (!/^[A-Z0-9]{4}$/.test(id)) break;
        const fs = ver === 4 ? sync(buf, p + 4) : ((buf[p + 4] << 24) | (buf[p + 5] << 16) | (buf[p + 6] << 8) | buf[p + 7]) >>> 0;
        const body = buf.subarray(p + 10, p + 10 + fs); p += 10 + fs;
        if (!fs || !body.length) continue;
        if (id === 'TIT2' || id === 'TPE1' || id === 'TALB') { const v = clean(dec(body.subarray(1), body[0])); if (v) out[id === 'TIT2' ? 'title' : id === 'TPE1' ? 'artist' : 'album'] = v; }
        else if (id === 'APIC' && !out.cover) {
            const enc = body[0]; let q = 1, mime = '';
            while (q < body.length && body[q] !== 0) mime += String.fromCharCode(body[q++]);
            q += 2;   // конец строки типа и байт «вид картинки»
            if (enc === 1 || enc === 2) { while (q + 1 < body.length && !(body[q] === 0 && body[q + 1] === 0)) q += 2; q += 2; } else { while (q < body.length && body[q] !== 0) q++; q++; }
            const data = body.subarray(q);
            if (data.length > 200) out.cover = new Blob([data], { type: /png/i.test(mime) ? 'image/png' : 'image/jpeg' });
        }
    }
    return out;
}

// ---------- Форма волны ----------
// Файл раскодируется один раз с пониженной частотой (16 кГц) — это экономит память; результат — до 2400 столбиков по 1 байту,
// хранится в записи песни (base64), поэтому волна видна и на устройстве, где аудио ещё не скачано.
async function songComputePeaks(blob, dur) {
    const AC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    if (!AC || blob.size > 120 * 1048576 || (dur && dur > 40 * 60)) return null;
    const buf = await blob.arrayBuffer();
    let ctx; try { ctx = new AC(1, 1, 16000); } catch (e) { ctx = new AC(1, 1, 22050); }
    const audio = await new Promise((res, rej) => { try { const p = ctx.decodeAudioData(buf, res, rej); if (p && p.catch) p.catch(rej); } catch (e) { rej(e); } });
    const n = Math.max(800, Math.min(2400, Math.round(audio.duration * 5))), out = new Uint8Array(n), chs = [];
    for (let c = 0; c < audio.numberOfChannels; c++) chs.push(audio.getChannelData(c));
    const len = audio.length, per = len / n; let top = 0;
    const raw = new Float32Array(n);
    for (let i = 0; i < n; i++) {
        const a = Math.floor(i * per), b = Math.max(a + 1, Math.floor((i + 1) * per)); let m = 0;
        for (const ch of chs) for (let k = a; k < b && k < len; k += 2) { const v = Math.abs(ch[k]); if (v > m) m = v; }
        raw[i] = m; if (m > top) top = m;
        if ((i & 255) === 255) await new Promise(r => setTimeout(r, 0));   // не замораживаем страницу
    }
    const sorted = Float32Array.from(raw).sort(); const ref = Math.max(sorted[Math.floor(n * 0.985)] || top, 1e-4);   // ровняем по почти максимальному значению
    for (let i = 0; i < n; i++) out[i] = Math.round(Math.min(1, Math.pow(raw[i] / ref, 0.8)) * 255);
    let bin = ''; for (let i = 0; i < n; i += 4096) bin += String.fromCharCode.apply(null, out.subarray(i, i + 4096));
    return { peaks: btoa(bin), dur: audio.duration };
}
function songPeaksDecode(str) {
    if (!str) return null;
    try { const bin = atob(str), a = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i); return a; } catch (e) { return null; }
}

// ---------- Блоки: операции над разметкой ----------
const SONG_MIN = 0.2;   // минимальная длина блока, с
function songNextHue(sg) { return ((sg.blocks || []).length * 53 + 255) % 360; }
function songFreeAround(sg, start, end, exceptId) {   // пересекается ли отрезок с другими блоками; возвращает пересекающийся блок или null
    return (sg.blocks || []).find(b => b.id !== exceptId && start < b.end - 0.001 && end > b.start + 0.001) || null;
}
function songMakeBlock(sg, start, end, label) {
    return { id: uid('b'), start: Math.max(0, start), end: Math.min(sg.dur || end, end), h: songNextHue(sg), label: String(label || '').slice(0, SONG_LABEL_MAX), note: '', imgs: [], voices: [], at: Date.now() };
}
// Нарезка равными частями по step секунд. keep — сохранить существующие блоки (заполнить только пустые места), иначе разметка заменяется.
function songAutoSplit(sg, step, keep) {
    const dur = sg.dur || 0; if (!(dur > 0) || !(step >= 1)) return 0;
    const kept = keep ? songBlocks(sg) : [];
    const gaps = []; let cur = 0;
    kept.forEach(b => { if (b.start - cur > SONG_MIN) gaps.push([cur, b.start]); cur = Math.max(cur, b.end); });
    if (dur - cur > SONG_MIN) gaps.push([cur, dur]);
    const made = [];
    gaps.forEach(([ga, gb]) => {
        for (let a = ga; a < gb - 0.001;) {
            let b = Math.min(gb, a + step);
            if (gb - b < Math.min(step * 0.3, 3) && gb - b > 0) b = gb;   // совсем короткий хвост присоединяем к последнему блоку
            made.push([a, b]); a = b;
        }
    });
    if (!keep) sg.blocks = [];
    const all = (sg.blocks || []).slice();
    sg.blocks = all;
    made.forEach(([a, b]) => { const blk = songMakeBlock(sg, a, b, ''); sg.blocks.push(blk); });
    sg.blocks.sort((x, y) => x.start - y.start);
    return made.length;
}

// =====================================================================================================
// СТРАНИЦА «ИДЕИ»: блок «Песни-контейнеры»
// =====================================================================================================
let songsQuery = '';
let songsRenderSeq = 0;
function songCloudInfo(sg, idx) {
    const rec = idx && idx.get(sg.audioId), onDevice = !!(rec && rec.full), onDrive = typeof gSongOnDrive === 'function' && gSongOnDrive(sg);
    if (onDevice && onDrive) return { icon: 'cloud', text: 'на Диске', cls: 'is-ok' };
    if (onDevice) return { icon: 'cloud_off', text: 'только здесь', cls: '' };
    return { icon: 'cloud_download', text: 'аудио на Диске', cls: 'is-warn' };
}
function songStripHtml(sg) {
    const dur = sg.dur || 0; if (!dur || !(sg.blocks || []).length) return '';
    return '<span class="sg-strip" aria-hidden="true">' + songBlocks(sg).map(b => '<i style="left:' + (b.start / dur * 100).toFixed(2) + '%;width:' + Math.max(0.6, (b.end - b.start) / dur * 100).toFixed(2) + '%;--sb-h:' + b.h + '"></i>').join('') + '</span>';
}
async function renderSongs() {
    const host = $('#songs-list'); if (!host) return;
    const seq = ++songsRenderSeq;
    const badge = $('#songs-badge'); if (badge) badge.textContent = songs.length ? String(songs.length) : '';
    const q = normText(songsQuery).trim();
    let list = songs.slice().sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    if (q) list = list.filter(sg => normText([sg.title, sg.artist, sg.noteTitle, (sg.blocks || []).map(b => b.label + ' ' + b.note).join(' ')].join(' ')).includes(q));
    const idx = await BlobDB.index(); if (seq !== songsRenderSeq) return;
    const bar = $('#songs-q-wrap'); if (bar) bar.hidden = songs.length < 4;
    if (!list.length) {
        host.innerHTML = '<div class="empty"><div class="ico-big">' + ic(songs.length ? 'search' : 'library_music') + '</div><b>' + (songs.length ? 'Ничего не найдено' : 'Пока нет песен') + '</b>' +
            (songs.length ? 'Измените запрос.' : 'Нажмите «Загрузить песню», выберите аудиофайл — и режьте его на блоки с заметками, картинками и голосом.') + '</div>';
        return;
    }
    const days = new Map();
    list.forEach(sg => { const k = dayKey(sg.createdAt); if (!days.has(k)) days.set(k, []); days.get(k).push(sg); });
    host.innerHTML = Array.from(days.entries()).map(([k, arr]) => '<section class="sg-day"><h4 class="sg-daytitle">' + ic('folder') + '<span>' + esc(dayTitle(k)) + '</span><small>' + arr.length + '</small></h4>' +
        arr.map(sg => {
            const ci = songCloudInfo(sg, idx), nb = (sg.blocks || []).length;
            return '<button type="button" class="sg-row" data-song="' + sg.id + '">' +
                '<span class="sg-cv">' + (sg.coverId ? '<img alt="" data-blob="' + sg.coverId + '">' : ic('music_note')) + '</span>' +
                '<span class="sg-tx"><b>' + esc(sg.title || 'Без названия') + '</b><span class="sg-sub">' + esc([sg.artist, sg.noteTitle].filter(Boolean).join(' · ') || 'без автора') + '</span>' +
                '<span class="sg-meta">' + (sg.dur ? ic('schedule') + fmtClock(sg.dur) : '') + '<span>блоков: ' + nb + '</span><span class="chip sg-cloud ' + ci.cls + '">' + ic(ci.icon) + ci.text + '</span></span>' + songStripHtml(sg) + '</span>' +
                ic('chevron_right') + '</button>';
        }).join('') + '</section>').join('');
    host.querySelectorAll('img[data-blob]').forEach(async im => { const u = await BlobDB.url(im.dataset.blob, 'thumb'); if (u) im.src = u; else im.remove(); });
}

// ---------- Окно «данные песни» (новая / правка) ----------
function songInfoSheet(init, mode) {
    return new Promise(resolve => {
        const probe = { artist: init.artist || '', title: init.title || '', noteTitle: init.noteTitle || '', createdAt: init.createdAt || Date.now(), audioName: init.fileName || '', audioType: init.fileType || '' };
        const html =
            '<p class="hint" style="margin-bottom:12px">' + (mode === 'new' ? 'Файл «' + esc(init.fileName || '') + '» будет храниться на устройстве и на вашем Google Диске. ' : '') +
            'Имя файла на Диске складывается из этих полей: <b>автор_название_дата_названиезаметки</b>.</p>' +
            '<label class="field-label" for="si-artist">Автор (исполнитель)</label><input type="text" id="si-artist" maxlength="60" autocomplete="off" placeholder="Кто исполняет">' +
            '<label class="field-label" for="si-title" style="margin-top:12px">Название песни</label><input type="text" id="si-title" maxlength="80" autocomplete="off" placeholder="Как называется">' +
            '<label class="field-label" for="si-note" style="margin-top:12px">Название заметки</label><input type="text" id="si-note" maxlength="60" autocomplete="off" placeholder="Например: сцена в машине">' +
            '<div class="si-path"><span class="lbl">Так файл будет называться на Диске:</span><code id="si-name"></code></div>';
        const sheet = openSheet({
            title: mode === 'new' ? 'Новая песня-контейнер' : 'Данные песни', html,
            actions: [{ label: 'Отмена' }, { label: mode === 'new' ? 'Создать' : 'Сохранить', kind: 'primary', icon: 'check', async onClick() {
                const title = $('#si-title', sheet.el).value.trim();
                if (!title) { toast('Напишите название песни'); return false; }
                done = { artist: $('#si-artist', sheet.el).value.trim(), title, noteTitle: $('#si-note', sheet.el).value.trim() };
            } }],
            onClose() { resolve(done); }
        });
        let done = null;
        const A = $('#si-artist', sheet.el), T = $('#si-title', sheet.el), N = $('#si-note', sheet.el), out = $('#si-name', sheet.el);
        A.value = probe.artist; T.value = probe.title; N.value = probe.noteTitle;
        const upd = () => { probe.artist = A.value; probe.title = T.value; probe.noteTitle = N.value; out.textContent = songFileName(probe); };
        [A, T, N].forEach(x => x.addEventListener('input', upd)); upd();
        setTimeout(() => { try { (T.value ? N : T).focus(); } catch (e) {} }, 250);
    });
}

// ---------- Загрузка аудиофайла ----------
async function songCreateFromFile(file) {
    if (!file) return;
    if (!/^audio\//.test(file.type) && !/\.(mp3|m4a|aac|flac|ogg|oga|opus|wav|wma|webm)$/i.test(file.name)) { toast('Это не аудиофайл'); return; }
    if (file.size > SONG_FILE_MAX) { toast('Файл больше ' + fmtBytes(SONG_FILE_MAX) + ' — для заметок хватит версии поменьше (mp3, m4a)', { ms: 6000 }); return; }
    let tags = {}; try { tags = await songReadId3(file); } catch (e) { tags = {}; }
    const guess = songGuessFromFile(file.name);
    const info = await songInfoSheet({ artist: tags.artist || guess.artist, title: tags.title || guess.title, noteTitle: '', fileName: file.name, fileType: file.type }, 'new');
    if (!info) return;
    const now = Date.now(), audioId = uid('sa');
    const type = file.type || (/\.m4a$/i.test(file.name) ? 'audio/mp4' : /\.flac$/i.test(file.name) ? 'audio/flac' : /\.wav$/i.test(file.name) ? 'audio/wav' : /\.(ogg|oga|opus)$/i.test(file.name) ? 'audio/ogg' : 'audio/mpeg');
    try {
        await BlobDB.put({ id: audioId, blob: file, name: file.name, type, size: file.size });
        let coverId = '';
        if (tags.cover) {
            try { const p = await prepareImage(new File([tags.cover], 'cover.jpg', { type: tags.cover.type })); coverId = uid('sc'); await BlobDB.put({ id: coverId, blob: p.blob, thumb: p.thumb || null, name: 'cover.jpg', type: p.type, size: p.size }); } catch (e) { coverId = ''; }
        }
        const dur = await audioDuration(file);
        const sg = { id: uid('s'), title: info.title, artist: info.artist, noteTitle: info.noteTitle, createdAt: now, updatedAt: now, author: authorName(), audioId, audioName: file.name, audioType: type, audioSize: file.size, dur: dur || 0, peaks: '', blocks: [] };
        if (coverId) sg.coverId = coverId;
        songs.unshift(sg);
        if (!saveSongs()) { songs.shift(); throw new Error('storage'); }
        renderSongs(); toast('Песня добавлена: ' + sg.title);
        openSongStudio(sg.id);
    } catch (e) { console.warn(e); toast('Не удалось сохранить песню'); }
}

// ---------- Удаление ----------
async function songRemoveMedia(sg) {
    for (const b of sg.blocks || []) { for (const f of b.imgs || []) await BlobDB.del(f.id); for (const f of b.voices || []) await BlobDB.del(f.id); }
    if (sg.coverId) await BlobDB.del(sg.coverId);
    if (sg.audioId) await BlobDB.del(sg.audioId);
}
async function songDelete(id) {
    const sg = songById(id); if (!sg) return false;
    const ok = await confirmSheet('Удалить песню?', '«' + songTitleOf(sg) + '» вместе с блоками, заметками, картинками и голосовыми записями будет удалена с этого устройства. Файл на Google Диске уйдёт в корзину Диска примерно через сутки.', 'Удалить', true);
    if (!ok) return false;
    await songRemoveMedia(sg);
    songs = songs.filter(x => x.id !== id);
    saveSongs(); renderSongs(); toast('Песня удалена');
    return true;
}

// ---------- Конспект в текстовый файл ----------
function songNotesText(sg) {
    const lines = [songTitleOf(sg), 'Заметка: ' + (sg.noteTitle || '—'), 'Дата: ' + fmtDateShort(sg.createdAt) + ' · автор записи: ' + (sg.author || authorName()) + (sg.dur ? ' · длина ' + fmtClock(sg.dur) : ''), ''];
    const blocks = songBlocks(sg);
    if (!blocks.length) lines.push('(блоков пока нет)');
    blocks.forEach((b, i) => {
        lines.push((i + 1) + '. [' + fmtClock(b.start, true) + ' – ' + fmtClock(b.end, true) + ', ' + fmtSpan(b.end - b.start) + '] ' + (b.label || 'без подписи'));
        if (b.note) lines.push(b.note.split('\n').map(l => '   ' + l).join('\n'));
        const extra = []; if ((b.imgs || []).length) extra.push('картинок: ' + b.imgs.length); if ((b.voices || []).length) extra.push('голосовых записей: ' + b.voices.length);
        if (extra.length) lines.push('   (' + extra.join(', ') + ')');
        lines.push('');
    });
    return lines.join('\n');
}
async function songExportNotes(sg) {
    const blob = new Blob(['﻿' + songNotesText(sg)], { type: 'text/plain;charset=utf-8' });
    const name = songFileName(sg).replace(/\.[^.]+$/, '') + '_конспект.txt';
    const res = await deliverFile(blob, name);
    toast(res === 'unsupported' ? 'В этом приложении сохранить файл нельзя — откройте iLife в браузере' : res === 'shared' ? 'Конспект готов — выберите, куда отправить' : 'Конспект сохранён: ' + name);
}

// ---------- Выбор блока для сценария (используется js/scripts.js) ----------
function songRefLabel(ref) {
    const sg = ref && songById(ref.s); if (!sg) return 'песня удалена';
    const b = (sg.blocks || []).find(x => x.id === ref.b);
    return (sg.title || 'Без названия') + (b ? ' · ' + (b.label || fmtClock(b.start) + '–' + fmtClock(b.end)) : '');
}
function songPickBlock() {
    return new Promise(resolve => {
        if (!songs.length) { toast('Сначала загрузите песню на странице «Идеи»'); resolve(null); return; }
        let picked = null, openId = songs[0].id;
        const html = '<div id="spb"></div>';
        const sheet = openSheet({ title: 'Музыка в сцене', html, actions: [{ label: 'Отмена' }], onClose() { resolve(picked); } });
        const box = $('#spb', sheet.el);
        const paint = () => {
            box.innerHTML = '<p class="hint" style="margin-bottom:10px">Выберите песню и блок: в сцене появится отметка, по которой песня откроется на нужном месте.</p>' +
                songs.slice().sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)).map(sg => {
                    const open = sg.id === openId, bl = songBlocks(sg);
                    return '<div class="spb-song' + (open ? ' is-open' : '') + '"><button type="button" class="spb-head" data-sg="' + sg.id + '">' + ic('music_note') + '<span><b>' + esc(sg.title || 'Без названия') + '</b><small>' + esc(sg.artist || '') + ' · блоков: ' + bl.length + '</small></span>' + ic(open ? 'expand_less' : 'expand_more') + '</button>' +
                        (open ? '<div class="spb-blocks">' + (bl.length ? bl.map(b => '<button type="button" class="spb-blk" data-sg="' + sg.id + '" data-b="' + b.id + '" style="--sb-h:' + b.h + '"><i></i><span>' + esc(b.label || 'без подписи') + '</span><small>' + fmtClock(b.start) + ' – ' + fmtClock(b.end) + '</small></button>').join('') : '<p class="hint">В этой песне ещё нет блоков.</p>') +
                            '<button type="button" class="spb-blk spb-whole" data-sg="' + sg.id + '" data-b="">' + ic('library_music') + '<span>Вся песня целиком</span></button></div>' : '') + '</div>';
                }).join('');
        };
        paint();
        box.addEventListener('click', e => {
            const head = e.target.closest('.spb-head'), blk = e.target.closest('.spb-blk');
            if (head) { openId = openId === head.dataset.sg ? '' : head.dataset.sg; paint(); }
            else if (blk) { picked = { s: blk.dataset.sg, b: blk.dataset.b || '' }; sheet.close(); }
        });
    });
}
// В каких сценариях используется песня / блок (для подсказки в блоке)
function songUsage(songId, blockId) {
    const out = [];
    (typeof scripts !== 'undefined' ? scripts : []).forEach(sc => {
        let scene = 0;
        (sc.els || []).forEach(el => {
            if (el.t === 's') scene++;
            (el.m || []).forEach(m => { if (m.s === songId && (!blockId || m.b === blockId)) out.push({ script: sc, scene, id: sc.id }); });
        });
    });
    return out;
}

// =====================================================================================================
// СТУДИЯ ПЕСНИ: волна, блоки, воспроизведение
// =====================================================================================================
let songStudio = null;

function openSongStudio(songId, blockId) {
    closeSongStudio();
    const sg = songById(songId); if (!sg) return;
    if (!Array.isArray(sg.blocks)) sg.blocks = [];
    const reduceMotion = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
    const st = {
        sg, audio: null, hasAudio: false, zoom: 1, follow: true, activeId: null, openId: blockId || null, selection: null, playRange: null,
        loop: false, rate: 1, level: 0, peaks: songPeaksDecode(sg.peaks), computing: false, rec: null, recBlock: null, drag: null, dirty: true, raf: 0, closed: false,
        fetchCtl: null
    };
    const el = document.createElement('div');
    el.className = 'song-studio'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-label', 'Песня-контейнер');
    el.innerHTML =
        '<header class="ss-top"><button type="button" class="icon-btn" data-ss="close" aria-label="Закрыть">' + ic('arrow_back') + '</button>' +
        '<div class="ss-ttl"><b class="ss-name"></b><span class="ss-sub"></span></div>' +
        '<span class="chip ss-cloud"></span>' +
        '<button type="button" class="icon-btn" data-ss="menu" aria-label="Меню песни">' + ic('more_vert') + '</button></header>' +
        '<div class="ss-body">' +
        '<section class="ss-card ss-wave-card">' +
        '<div class="ss-wavebox" tabindex="-1"><div class="ss-wavein"><canvas class="ss-cv ss-cv-wave"></canvas><canvas class="ss-cv ss-cv-over"></canvas></div></div>' +
        '<div class="ss-selbar" hidden><span class="ss-seltxt"></span><button type="button" class="btn" data-ss="selplay">' + ic('play_arrow') + 'Слушать</button><button type="button" class="btn btn-primary" data-ss="selblock">' + ic('add') + 'Блок из выделенного</button><button type="button" class="icon-btn" data-ss="selclear" aria-label="Снять выделение">' + ic('close') + '</button></div>' +
        '<div class="ss-miss" hidden>' + ic('cloud_download') + '<span data-m></span><div class="btn-group"><button type="button" class="btn btn-primary" data-ss="fetch">' + ic('cloud_download') + 'Загрузить с Google Диска</button><button type="button" class="btn" data-ss="pickfile">' + ic('file_upload') + 'Выбрать файл</button></div></div>' +
        '</section>' +
        '<section class="ss-card ss-transport">' +
        '<div class="ss-tr-main"><button type="button" class="icon-btn" data-ss="prevblk" aria-label="Предыдущий блок">' + ic('skip_previous') + '</button><button type="button" class="icon-btn" data-ss="back" aria-label="Назад на 5 секунд">' + ic('replay_10') + '</button>' +
        '<button type="button" class="ss-play" data-ss="play" aria-label="Воспроизвести">' + ic('play_arrow') + '</button>' +
        '<button type="button" class="icon-btn" data-ss="fwd" aria-label="Вперёд на 5 секунд">' + ic('forward_10') + '</button><button type="button" class="icon-btn" data-ss="nextblk" aria-label="Следующий блок">' + ic('skip_next') + '</button></div>' +
        '<div class="ss-tr-info"><span class="ss-clock"><b class="ss-cur">0:00</b> / <span class="ss-tot">0:00</span></span><canvas class="ss-eq" width="112" height="32" aria-hidden="true"></canvas></div>' +
        '<div class="ss-tr-opts"><label class="ss-rate" title="Скорость"><span>Скорость</span><select data-ss="rate">' + SONG_RATES.map(r => '<option value="' + r + '"' + (r === 1 ? ' selected' : '') + '>' + String(r).replace('.', ',') + '×</option>').join('') + '</select></label>' +
        '<button type="button" class="chip" data-ss="loop" aria-pressed="false">' + ic('repeat') + 'Повтор блока</button>' +
        '<button type="button" class="chip is-on" data-ss="follow" aria-pressed="true">' + ic('visibility') + 'Следить</button></div>' +
        '</section>' +
        '<section class="ss-tools">' +
        '<button type="button" class="btn btn-tertiary" data-ss="split" title="Разрезать на текущей позиции (клавиша M)">' + ic('content_cut') + 'Разрезать здесь</button>' +
        '<button type="button" class="btn" data-ss="auto">' + ic('splitscreen') + 'Нарезать по длительности</button>' +
        '<button type="button" class="btn" data-ss="newblk">' + ic('add') + 'Новый блок</button>' +
        '<span class="ss-zoom"><button type="button" class="icon-btn tonal" data-ss="zoomout" aria-label="Уменьшить масштаб волны">' + ic('zoom_out') + '</button><button type="button" class="icon-btn tonal" data-ss="zoomin" aria-label="Увеличить масштаб волны">' + ic('zoom_in') + '</button></span>' +
        '</section>' +
        '<section class="ss-blocks"><div class="list-head"><h2>Блоки</h2><span class="count ss-bcount"></span></div><div class="ss-list"></div></section>' +
        '<p class="hint ss-keys">Пробел — пуск/пауза · M — разрезать здесь · ← → — на 5 с · [ ] — прошлый/следующий блок · Esc — закрыть</p>' +
        '</div>' +
        '<input type="file" class="ss-file" accept="audio/*,.mp3,.m4a,.aac,.flac,.ogg,.oga,.opus,.wav,.wma" hidden><input type="file" class="ss-img" accept="image/*" multiple hidden>';
    document.body.appendChild(el); document.body.classList.add('is-locked');
    requestAnimationFrame(() => el.classList.add('is-in'));

    const q = s => $(s, el);
    const box = q('.ss-wavebox'), wavein = q('.ss-wavein'), cvW = q('.ss-cv-wave'), cvO = q('.ss-cv-over'), eq = q('.ss-eq');
    const list = q('.ss-list'), playBtn = q('[data-ss="play"]'), selbar = q('.ss-selbar');
    const WAVE_H = 112, RULER_H = 20, LANE_H = 40, H = WAVE_H + RULER_H + LANE_H;
    let W = 300, ratio = 1;
    const dur = () => st.sg.dur || (st.audio && isFinite(st.audio.duration) ? st.audio.duration : 0) || 0;
    const t2x = t => dur() ? t / dur() * W : 0;
    const x2t = x => dur() ? Math.max(0, Math.min(dur(), x / W * dur())) : 0;
    const cur = () => (st.audio ? st.audio.currentTime : st.t || 0);
    const cssVar = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim() || '#888';
    const dark = () => document.documentElement.dataset.mode === 'dark';
    const hsl = (h, s, l, a) => 'hsla(' + h + ',' + s + '%,' + l + '%,' + (a == null ? 1 : a) + ')';
    const sortedBlocks = () => songBlocks(st.sg);
    const save = () => saveSongsSoon();
    const saveNow = () => { st.sg.updatedAt = Date.now(); saveSongs(); };
    const draw = () => { st.dirty = true; if (!st.raf) st.raf = requestAnimationFrame(frame); };

    // ----- заголовок и облако -----
    async function paintHead() {
        q('.ss-name').textContent = st.sg.title || 'Без названия';
        q('.ss-sub').textContent = [st.sg.artist, st.sg.noteTitle && '«' + st.sg.noteTitle + '»'].filter(Boolean).join(' · ') || 'без автора';
        const idx = await BlobDB.index(), ci = songCloudInfo(st.sg, idx), c = q('.ss-cloud');
        c.className = 'chip ss-cloud ' + ci.cls; c.innerHTML = ic(ci.icon) + ci.text;
        q('.ss-tot').textContent = fmtClock(dur());
    }

    // ----- аудио -----
    async function ensureAudio() {
        if (st.audio) return st.audio;
        const url = await BlobDB.url(st.sg.audioId);
        if (!url) return null;
        const a = new Audio(); a.preload = 'auto'; a.src = url; a.playbackRate = st.rate; try { a.preservesPitch = true; a.webkitPreservesPitch = true; } catch (e) {}
        a.addEventListener('loadedmetadata', () => {
            if (isFinite(a.duration) && a.duration > 0 && Math.abs((st.sg.dur || 0) - a.duration) > 0.5) { st.sg.dur = a.duration; save(); layout(); renderBlocks(); paintHead(); }
        });
        a.addEventListener('play', () => { if (typeof playingAudio !== 'undefined' && playingAudio && playingAudio !== a) playingAudio.pause(); playingAudio = a; setPlayIcon(true); draw(); });
        a.addEventListener('pause', () => { setPlayIcon(false); draw(); });
        a.addEventListener('ended', () => { st.playRange = null; setPlayIcon(false); draw(); });
        a.addEventListener('error', () => { setPlayIcon(false); toast('Не удалось воспроизвести этот файл'); });
        st.audio = a; return a;
    }
    function setPlayIcon(on) { playBtn.innerHTML = ic(on ? 'pause' : 'play_arrow'); playBtn.setAttribute('aria-label', on ? 'Пауза' : 'Воспроизвести'); el.classList.toggle('is-playing', on); }
    const isPlaying = () => !!(st.audio && !st.audio.paused && !st.audio.ended);
    async function seek(t, noDraw) {
        t = Math.max(0, Math.min(dur() || t, t));
        const a = await ensureAudio();
        if (a) { try { a.currentTime = t; } catch (e) {} } else st.t = t;
        if (!noDraw) draw();
    }
    async function play(range) {
        const a = await ensureAudio();
        if (!a) { showMissing(); return; }
        st.playRange = range || null;
        if (range) a.currentTime = range.start;
        else if (a.ended || (dur() && a.currentTime >= dur() - 0.05)) a.currentTime = 0;
        try { await a.play(); } catch (e) { toast('Не удалось начать воспроизведение — нажмите ещё раз'); }
    }
    function pause() { if (st.audio) st.audio.pause(); }
    async function toggle() { if (isPlaying()) pause(); else await play(null); }
    const playBlock = id => { const b = st.sg.blocks.find(x => x.id === id); if (b) play({ start: b.start, end: b.end }); };

    // ----- волна: размеры и рисование -----
    function layout() {
        const vw = Math.max(box.clientWidth, 120);
        const keepT = box.scrollWidth > box.clientWidth ? x2t(box.scrollLeft + box.clientWidth / 2) : null;
        W = Math.round(vw * st.zoom);
        ratio = Math.min(window.devicePixelRatio || 1, 8192 / W, 3);
        wavein.style.width = W + 'px'; wavein.style.height = H + 'px';
        [cvW, cvO].forEach(c => { c.width = Math.round(W * ratio); c.height = Math.round(H * ratio); c.style.width = W + 'px'; c.style.height = H + 'px'; });
        if (keepT != null) box.scrollLeft = Math.max(0, t2x(keepT) - box.clientWidth / 2);
        drawWave(); draw();
    }
    function peakAt(f0, f1) {
        const P = st.peaks; if (!P) return 0.12;
        const n = P.length; let i0 = Math.floor(f0 * n), i1 = Math.max(i0 + 1, Math.ceil(f1 * n)), m = 0;
        for (let i = i0; i < i1 && i < n; i++) if (P[i] > m) m = P[i];
        return m / 255;
    }
    function drawWave() {
        const ctx = cvW.getContext('2d'); ctx.setTransform(ratio, 0, 0, ratio, 0, 0); ctx.clearRect(0, 0, W, H);
        const D = dur(), blocks = sortedBlocks(), isDark = dark();
        const neutral = cssVar('--md-outline'), txt = cssVar('--md-on-variant'), primary = cssVar('--md-primary');
        const barW = 3, gap = 2, step = barW + gap, n = Math.max(1, Math.floor(W / step)), mid = WAVE_H / 2;
        // столбики волны: внутри блока — цветом блока, вне блоков — серые
        for (let k = 0; k < n; k++) {
            const f0 = k / n, f1 = (k + 1) / n, tm = (f0 + f1) / 2 * D, v = peakAt(f0, f1);
            const blk = D ? blocks.find(b => tm >= b.start && tm < b.end) : null;
            const h = Math.max(3, v * (WAVE_H - 10));
            ctx.fillStyle = blk ? hsl(blk.h, isDark ? 60 : 55, isDark ? 68 : 46, 0.95) : neutral;
            ctx.globalAlpha = blk ? 1 : 0.45;
            const x = k * step + (W - n * step) / 2;
            ctx.beginPath(); if (ctx.roundRect) ctx.roundRect(x, mid - h / 2, barW, h, 1.5); else ctx.rect(x, mid - h / 2, barW, h); ctx.fill();
        }
        ctx.globalAlpha = 1;
        // линейка времени
        ctx.fillStyle = txt; ctx.strokeStyle = txt; ctx.font = '11px ' + cssVar('--md-font'); ctx.textBaseline = 'middle'; ctx.lineWidth = 1;
        if (D) {
            const steps = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1200, 1800, 3600];
            const tick = steps.find(s => s / D * W >= 64) || 3600;
            for (let t = 0; t <= D + 0.001; t += tick) {
                const x = Math.round(t2x(t)) + 0.5;
                ctx.globalAlpha = 0.5; ctx.beginPath(); ctx.moveTo(x, WAVE_H); ctx.lineTo(x, WAVE_H + 6); ctx.stroke(); ctx.globalAlpha = 0.9;
                ctx.textAlign = x < 20 ? 'left' : 'center'; ctx.fillText(fmtClock(t), Math.max(x, 2), WAVE_H + 13);
            }
            ctx.globalAlpha = 1;
        }
        // дорожка блоков
        const ly = WAVE_H + RULER_H + 2, lh = LANE_H - 6;
        ctx.fillStyle = neutral; ctx.globalAlpha = 0.1; ctx.fillRect(0, ly, W, lh); ctx.globalAlpha = 1;
        blocks.forEach((b, i) => {
            const x1 = t2x(b.start), x2 = t2x(b.end), w = Math.max(2, x2 - x1 - 2), act = b.id === st.activeId || b.id === st.openId;
            ctx.fillStyle = hsl(b.h, isDark ? 55 : 60, isDark ? 40 : 82, act ? 1 : 0.85);
            ctx.beginPath(); if (ctx.roundRect) ctx.roundRect(x1 + 1, ly, w, lh, 8); else ctx.rect(x1 + 1, ly, w, lh); ctx.fill();
            ctx.lineWidth = act ? 2 : 1; ctx.strokeStyle = hsl(b.h, 60, isDark ? 70 : 42, act ? 1 : 0.6); ctx.stroke();
            if (w > 26) {
                ctx.save(); ctx.beginPath(); ctx.rect(x1 + 6, ly, w - 12, lh); ctx.clip();
                ctx.fillStyle = isDark ? '#fff' : hsl(b.h, 60, 18, 1); ctx.textAlign = 'left'; ctx.font = '600 11px ' + cssVar('--md-font');
                ctx.fillText((i + 1) + (b.label ? '  ' + b.label : ''), x1 + 7, ly + lh / 2 + 0.5); ctx.restore();
            }
        });
        if (!st.peaks) {   // волны нет (считается или файл не поддерживается): тонкая линия
            ctx.strokeStyle = neutral; ctx.globalAlpha = 0.5; ctx.setLineDash([4, 5]); ctx.beginPath(); ctx.moveTo(0, mid + 0.5); ctx.lineTo(W, mid + 0.5); ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = 1;
        }
        void primary;
    }
    function drawOver(now) {
        const ctx = cvO.getContext('2d'); ctx.setTransform(ratio, 0, 0, ratio, 0, 0); ctx.clearRect(0, 0, W, H);
        const D = dur(); if (!D) return;
        const t = cur(), x = t2x(t), primary = cssVar('--md-primary'), isDark = dark();
        const blocks = sortedBlocks(), act = blocks.find(b => b.id === st.activeId);
        // сыгранная часть
        ctx.fillStyle = primary; ctx.globalAlpha = 0.1; ctx.fillRect(0, 0, x, WAVE_H); ctx.globalAlpha = 1;
        // выделение
        if (st.selection) {
            const a = t2x(st.selection.a), b = t2x(st.selection.b);
            ctx.fillStyle = primary; ctx.globalAlpha = 0.18; ctx.fillRect(a, 0, b - a, WAVE_H + RULER_H); ctx.globalAlpha = 1;
            ctx.strokeStyle = primary; ctx.lineWidth = 2; ctx.setLineDash([5, 4]); ctx.strokeRect(a + 1, 1, Math.max(0, b - a - 2), WAVE_H + RULER_H - 2); ctx.setLineDash([]);
        }
        // активный блок: подсветка и «дыхание» в такт музыке
        if (act) {
            const a = t2x(act.start), b = t2x(act.end), pulse = reduceMotion ? 0 : st.level;
            ctx.fillStyle = hsl(act.h, 70, isDark ? 65 : 50, 0.10 + pulse * 0.10); ctx.fillRect(a, 0, b - a, WAVE_H);
            const ly = WAVE_H + RULER_H + 2, lh = LANE_H - 6;
            ctx.strokeStyle = hsl(act.h, 80, isDark ? 70 : 45, 0.9); ctx.lineWidth = 2 + pulse * 2.5; ctx.shadowColor = hsl(act.h, 80, 55, 0.8); ctx.shadowBlur = 6 + pulse * 12;
            ctx.beginPath(); if (ctx.roundRect) ctx.roundRect(a + 1, ly, Math.max(2, b - a - 2), lh, 8); else ctx.rect(a + 1, ly, Math.max(2, b - a - 2), lh); ctx.stroke(); ctx.shadowBlur = 0;
        }
        // отрезок, который сейчас проигрывается «только блок»
        if (st.playRange) { ctx.fillStyle = primary; ctx.globalAlpha = 0.85; ctx.fillRect(t2x(st.playRange.start), 0, Math.max(2, t2x(st.playRange.end) - t2x(st.playRange.start)), 3); ctx.globalAlpha = 1; }
        // головка воспроизведения
        const pulseR = reduceMotion ? 0 : st.level;
        ctx.save(); ctx.shadowColor = primary; ctx.shadowBlur = 8 + pulseR * 14;
        ctx.strokeStyle = primary; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x + 0.5, 0); ctx.lineTo(x + 0.5, WAVE_H + RULER_H + LANE_H); ctx.stroke();
        ctx.fillStyle = primary; ctx.beginPath(); ctx.arc(x + 0.5, 6, 5 + pulseR * 3, 0, Math.PI * 2); ctx.fill(); ctx.restore();
        if (isPlaying() && !reduceMotion) {   // кольцо, расходящееся от головки
            const ph = (now / 900) % 1; ctx.strokeStyle = primary; ctx.globalAlpha = (1 - ph) * 0.5; ctx.lineWidth = 1.5;
            ctx.beginPath(); ctx.arc(x + 0.5, 6, 5 + ph * 16, 0, Math.PI * 2); ctx.stroke(); ctx.globalAlpha = 1;
        }
    }
    function drawEq(now) {
        const ctx = eq.getContext('2d'), w = eq.width, h = eq.height; ctx.clearRect(0, 0, w, h);
        const primary = cssVar('--md-primary'), D = dur(), t = cur(), playing = isPlaying(), bars = 16, bw = w / bars;
        for (let k = 0; k < bars; k++) {
            const tt = t + (k - bars / 2) * 0.4, v = D && tt >= 0 && tt <= D ? peakAt(tt / D, tt / D + 0.002) : 0;
            const shimmer = playing && !reduceMotion ? 0.7 + 0.3 * Math.sin(now / 130 + k * 1.3) : 1;
            const hh = Math.max(2, (playing ? v : v * 0.25) * (h - 2) * shimmer);
            ctx.fillStyle = primary; ctx.globalAlpha = 0.35 + 0.65 * (1 - Math.abs(k - bars / 2) / (bars / 2));
            ctx.beginPath(); if (ctx.roundRect) ctx.roundRect(k * bw + 1, (h - hh) / 2, bw - 2.5, hh, 2); else ctx.rect(k * bw + 1, (h - hh) / 2, bw - 2.5, hh); ctx.fill();
        }
        ctx.globalAlpha = 1;
    }

    // ----- кадр: позиция, активный блок, границы воспроизведения -----
    function frame(now) {
        st.raf = 0; if (st.closed) return;
        const a = st.audio, t = cur(), playing = isPlaying();
        if (playing) {
            if (st.playRange) {
                const r = st.playRange;
                if (t >= r.end - 0.02) { if (st.loop) a.currentTime = r.start; else { a.pause(); a.currentTime = r.end; st.playRange = null; } }
            } else if (st.loop) {
                const cb = songBlockAt(st.sg, t);
                if (cb && t >= cb.end - 0.03) a.currentTime = cb.start;
            }
        }
        const act = songBlockAt(st.sg, cur()), actId = act ? act.id : null;
        if (actId !== st.activeId) { st.activeId = actId; onActiveChanged(); drawWave(); }
        const target = playing && st.peaks ? peakAt(Math.min(1, t / Math.max(dur(), 1)), Math.min(1, t / Math.max(dur(), 1) + 0.004)) : 0;
        st.level += (target - st.level) * 0.25;
        q('.ss-cur').textContent = fmtClock(t);
        if (playing && st.follow && st.zoom > 1) {
            const x = t2x(t), sl = box.scrollLeft, vw = box.clientWidth;
            if (x < sl + vw * 0.08 || x > sl + vw * 0.86) box.scrollTo({ left: Math.max(0, x - vw * 0.3), behavior: reduceMotion ? 'auto' : 'smooth' });
        }
        drawOver(now || performance.now()); drawEq(now || performance.now());
        if (playing || st.level > 0.01 || st.dirty) { st.dirty = false; st.raf = requestAnimationFrame(frame); }
    }
    function onActiveChanged() {
        $$('.sb', list).forEach(c => c.classList.toggle('is-active', c.dataset.id === st.activeId));
        if (st.activeId && isPlaying() && st.follow) {
            const c = $('.sb[data-id="' + st.activeId + '"]', list);
            if (c) c.scrollIntoView({ block: 'nearest', behavior: reduceMotion ? 'auto' : 'smooth' });
        }
    }

    // ----- блок: показать «аудио нет на устройстве» -----
    async function checkAudio() {
        const idx = await BlobDB.index(), rec = idx.get(st.sg.audioId); st.hasAudio = !!(rec && rec.full);
        const miss = q('.ss-miss');
        miss.hidden = st.hasAudio;
        if (!st.hasAudio) q('[data-m]', miss).textContent = 'Аудиофайла нет на этом устройстве' + (typeof gSongOnDrive === 'function' && gSongOnDrive(st.sg) ? ' — он лежит на вашем Google Диске.' : '. Загрузите его с Google Диска или выберите файл вручную.') + ' Заметки и блоки при этом можно править.';
        el.classList.toggle('no-audio', !st.hasAudio);
        paintHead();
    }
    function showMissing() { checkAudio(); toast('Аудио нет на устройстве — загрузите его с Google Диска'); }
    async function fetchAudio() {
        const btn = q('[data-ss="fetch"]'), msg = q('[data-m]', q('.ss-miss'));
        if (typeof googleInfo !== 'function') return;
        const gi = googleInfo();
        if (!gi.user) { toast('Подключите Google в Настройках — тогда песня скачается с Диска', { ms: 5000 }); return; }
        if (!gi.hasToken) { toast('Нужно подтвердить вход в Google', { action: 'Продолжить', onAction: reconnectGoogle, ms: 7000 }); return; }
        btn.disabled = true; msg.textContent = 'Загружаем с Google Диска…';
        st.fetchCtl = typeof AbortController !== 'undefined' ? new AbortController() : null;
        let r = 'failed';
        try { r = await gSongFetchAudio(st.sg, f => { msg.textContent = 'Загружаем с Google Диска: ' + Math.round(f * 100) + '%'; }, st.fetchCtl && st.fetchCtl.signal); }
        catch (e) { if (e && e.code === 'auth') toast('Вход в Google устарел', { action: 'Продолжить', onAction: reconnectGoogle, ms: 7000 }); }
        btn.disabled = false; if (st.closed) return;
        if (r === 'done') { st.audio = null; await checkAudio(); toast('Аудио загружено'); computePeaksIfNeeded(); }
        else { msg.textContent = r === 'missing' ? 'На Google Диске этого файла нет — возможно, он ещё не выгружен с другого устройства. Откройте iLife там, где песню загружали.' : 'Не удалось загрузить аудио.'; }
    }
    async function pickFile(file) {
        if (!file) return;
        BlobDB.revoke(st.sg.audioId);
        await BlobDB.put({ id: st.sg.audioId, blob: file, name: st.sg.audioName || file.name, type: file.type || st.sg.audioType || 'audio/mpeg', size: file.size });
        st.audio = null; await checkAudio(); toast('Аудио добавлено на это устройство'); computePeaksIfNeeded();
    }
    async function computePeaksIfNeeded() {
        if (st.peaks || st.computing || !st.hasAudio) return;
        const rec = await BlobDB.get(st.sg.audioId); if (!rec || !rec.blob) return;
        st.computing = true; wavein.classList.add('is-computing');
        try {
            const r = await songComputePeaks(rec.blob, st.sg.dur);
            if (r && !st.closed) { st.sg.peaks = r.peaks; st.peaks = songPeaksDecode(r.peaks); if (!st.sg.dur && r.dur) st.sg.dur = r.dur; saveNow(); }
        } catch (e) { console.warn('Форма волны не построена', e); }
        st.computing = false; wavein.classList.remove('is-computing');
        if (!st.closed) { layout(); renderBlocks(); }
    }

    // ----- операции над блоками -----
    function selectBlock(id, opts) {
        opts = opts || {};
        st.openId = id; st.selection = null; selbar.hidden = true;
        renderBlocks(); drawWave(); draw();
        if (opts.seek) { const b = st.sg.blocks.find(x => x.id === id); if (b) seek(b.start); }
        if (opts.scroll) { const c = $('.sb[data-id="' + id + '"]', list); if (c) c.scrollIntoView({ block: 'center', behavior: reduceMotion ? 'auto' : 'smooth' }); }
        if (opts.zoomTo) scrollWaveTo(id);
    }
    function scrollWaveTo(id) {
        const b = st.sg.blocks.find(x => x.id === id); if (!b || st.zoom <= 1) return;
        box.scrollTo({ left: Math.max(0, (t2x(b.start) + t2x(b.end)) / 2 - box.clientWidth / 2), behavior: reduceMotion ? 'auto' : 'smooth' });
    }
    function addBlock(start, end, label) {
        const D = dur();
        if (!(D > 0)) { toast('Сначала нужна длина песни — дождитесь загрузки аудио'); return null; }
        start = Math.max(0, start); end = Math.min(D, end);
        if (end - start < SONG_MIN) { toast('Блок слишком короткий'); return null; }
        const hit = songFreeAround(st.sg, start, end);
        if (hit) { toast('Здесь уже есть блок «' + (hit.label || fmtClock(hit.start) + '–' + fmtClock(hit.end)) + '». Сдвиньте края или выберите свободное место.', { ms: 4500 }); return null; }
        const b = songMakeBlock(st.sg, start, end, label); st.sg.blocks.push(b); st.sg.blocks.sort((x, y) => x.start - y.start);
        saveNow(); return b;
    }
    function splitHere() {
        const D = dur(), t = cur();
        if (!(D > 0)) { toast('Сначала нужна длина песни'); return; }
        const blocks = sortedBlocks();
        const inside = blocks.find(b => t > b.start + 0.3 && t < b.end - 0.3);
        if (inside) {   // режем блок на два: заметка и картинки остаются в первой половине
            const nb = songMakeBlock(st.sg, t, inside.end, ''); inside.end = t; nb.h = (inside.h + 47) % 360;
            st.sg.blocks.push(nb); st.sg.blocks.sort((x, y) => x.start - y.start); saveNow();
            selectBlock(nb.id, {}); toast('Блок разрезан на ' + fmtClock(t, true));
            return;
        }
        if (blocks.some(b => t >= b.start - 0.3 && t <= b.end + 0.3)) { toast('Слишком близко к краю блока — сдвиньте позицию'); return; }
        // в «пустом» месте: блок от конца предыдущего (или от нуля) до текущей позиции — так можно размечать на ходу, нажимая M во время песни
        const prev = blocks.filter(b => b.end <= t + 0.001).pop(), from = prev ? prev.end : 0;
        const nb = addBlock(from, t, ''); if (!nb) return;
        selectBlock(nb.id, {}); toast('Блок ' + fmtClock(nb.start) + ' – ' + fmtClock(nb.end) + ' создан');
    }
    function mergeNext(id) {
        const bl = sortedBlocks(), i = bl.findIndex(b => b.id === id); if (i < 0 || i >= bl.length - 1) return;
        const a = bl[i], b = bl[i + 1];
        a.end = b.end; a.label = a.label || b.label; a.note = [a.note, b.note].filter(Boolean).join('\n\n');
        a.imgs = (a.imgs || []).concat(b.imgs || []); a.voices = (a.voices || []).concat(b.voices || []);
        st.sg.blocks = st.sg.blocks.filter(x => x.id !== b.id); saveNow();
        selectBlock(a.id, {}); toast('Блоки склеены');
    }
    async function deleteBlock(id) {
        const b = st.sg.blocks.find(x => x.id === id); if (!b) return;
        const has = (b.note || '').trim() || (b.imgs || []).length || (b.voices || []).length;
        if (has && !(await confirmSheet('Удалить блок?', 'Вместе с заметкой, картинками и голосовыми записями этого блока.', 'Удалить', true))) return;
        for (const f of b.imgs || []) await BlobDB.del(f.id);
        for (const f of b.voices || []) await BlobDB.del(f.id);
        st.sg.blocks = st.sg.blocks.filter(x => x.id !== id); if (st.openId === id) st.openId = null; saveNow();
        renderBlocks(); drawWave(); draw(); toast('Блок удалён');
    }
    function setBlockTime(b, field, val) {   // val — секунды; края не залезают на соседей и не пересекаются
        const bl = sortedBlocks(), i = bl.findIndex(x => x.id === b.id), D = dur();
        const lo = i > 0 ? bl[i - 1].end : 0, hi = i < bl.length - 1 ? bl[i + 1].start : D;
        if (field === 'start') b.start = Math.max(lo, Math.min(val, b.end - SONG_MIN)); else b.end = Math.min(hi, Math.max(val, b.start + SONG_MIN));
    }

    // ----- список блоков -----
    function blockHtml(b, i) {
        const open = b.id === st.openId, act = b.id === st.activeId, imgs = b.imgs || [], voices = b.voices || [];
        const used = songUsage(st.sg.id, b.id), recHere = st.recBlock === b.id;
        return '<article class="sb' + (open ? ' is-open' : '') + (act ? ' is-active' : '') + '" data-id="' + b.id + '" style="--sb-h:' + b.h + '">' +
            '<header class="sb-head"><button type="button" class="sb-play" data-b="play" aria-label="Проиграть блок ' + (i + 1) + '"><span class="sb-num">' + (i + 1) + '</span>' + ic('play_arrow') + '<span class="sb-eqi"><i></i><i></i><i></i></span></button>' +
            '<div class="sb-main"><input type="text" class="sb-label" maxlength="' + SONG_LABEL_MAX + '" placeholder="Подпись блока (до ' + SONG_LABEL_MAX + ' символов)" value="' + esc(b.label) + '" aria-label="Подпись блока">' +
            '<div class="sb-meta"><button type="button" class="sb-time" data-b="seek">' + ic('schedule') + '<span>' + fmtClock(b.start) + ' – ' + fmtClock(b.end) + '</span></button><span>' + fmtSpan(b.end - b.start) + '</span>' +
            ((b.note || '').trim() ? '<span class="sb-badge" title="Есть заметка">' + ic('notes') + '</span>' : '') + (imgs.length ? '<span class="sb-badge" title="Картинки">' + ic('image') + imgs.length + '</span>' : '') + (voices.length ? '<span class="sb-badge" title="Голосовые записи">' + ic('mic') + voices.length + '</span>' : '') +
            (used.length ? '<span class="sb-badge" title="Используется в сценариях">' + ic('theaters') + used.length + '</span>' : '') + '<span class="sb-cnt">' + b.label.length + '/' + SONG_LABEL_MAX + '</span></div></div>' +
            '<button type="button" class="icon-btn sb-chev" data-b="toggle" aria-label="Развернуть блок" aria-expanded="' + open + '">' + ic('expand_more') + '</button></header>' +
            '<div class="sb-bodywrap"><div class="sb-body">' +
            '<div class="sb-times"><label><span>Начало</span><input type="text" inputmode="decimal" data-f="start" value="' + fmtClock(b.start, true) + '"></label><button type="button" class="icon-btn tonal" data-b="setstart" title="Начало = текущая позиция" aria-label="Начало блока — текущая позиция">' + ic('flag') + '</button>' +
            '<label><span>Конец</span><input type="text" inputmode="decimal" data-f="end" value="' + fmtClock(b.end, true) + '"></label><button type="button" class="icon-btn tonal" data-b="setend" title="Конец = текущая позиция" aria-label="Конец блока — текущая позиция">' + ic('flag') + '</button></div>' +
            '<label class="field-label" for="n-' + b.id + '">Заметка</label><textarea class="sb-note" id="n-' + b.id + '" rows="4" placeholder="Что происходит в этом отрезке: сцена, образ, настроение, реплика, идея для монтажа…">' + esc(b.note) + '</textarea>' +
            ((imgs.length || voices.length) ? '<div class="sb-media">' + imgs.map((f, k) => '<div class="sb-img"><button type="button" data-b="img" data-k="' + k + '" aria-label="Открыть картинку"><img alt="' + esc(f.name) + '" data-blob="' + f.id + '" data-variant="thumb"></button><button type="button" class="x" data-b="rmimg" data-id="' + f.id + '" aria-label="Убрать картинку">' + ic('close') + '</button></div>').join('') +
                voices.map(f => '<div class="sb-voice"><div data-player="' + f.id + '"></div><button type="button" class="icon-btn is-danger" data-b="rmvoice" data-id="' + f.id + '" aria-label="Удалить запись">' + ic('delete') + '</button></div>').join('') + '</div>' : '') +
            (recHere ? '<div class="recorder sb-rec"><span class="rec-dot"></span><span class="rec-time sb-rec-time">0:00</span><span class="rec-bars sb-rec-bars"></span><button type="button" class="icon-btn" data-b="reccancel" aria-label="Отменить запись">' + ic('delete') + '</button><button type="button" class="icon-btn is-recording" data-b="recstop" aria-label="Остановить и сохранить запись">' + ic('stop') + '</button></div>' : '') +
            '<div class="btn-group sb-acts"><button type="button" class="btn" data-b="addimg">' + ic('add_photo_alternate') + 'Картинка</button><button type="button" class="btn" data-b="rec"' + (recHere ? ' disabled' : '') + '>' + ic('mic') + 'Голос</button>' +
            '<button type="button" class="btn" data-b="merge">' + ic('swap_horiz') + 'Склеить со следующим</button><button type="button" class="btn btn-danger" data-b="del">' + ic('delete') + 'Удалить</button></div>' +
            (used.length ? '<p class="hint sb-used">' + ic('theaters') + 'В сценариях: ' + used.map(u => '<button type="button" class="linkbtn" data-b="openscript" data-id="' + u.id + '">' + esc(u.script.title || 'Без названия') + ' (сцена ' + u.scene + ')</button>').join(', ') + '</p>' : '') +
            '</div></div></article>';
    }
    function renderBlocks() {
        const bl = sortedBlocks();
        q('.ss-bcount').textContent = bl.length ? 'всего ' + bl.length : '';
        if (!bl.length) {
            list.innerHTML = '<div class="empty"><div class="ico-big">' + ic('content_cut') + '</div><b>Блоков пока нет</b>Нажимайте «Разрезать здесь» во время прослушивания, выделите отрезок мышью/пальцем на волне или нарежьте песню равными частями.</div>';
        } else {
            list.innerHTML = bl.map(blockHtml).join('');
            list.querySelectorAll('img[data-blob]').forEach(async im => { const u = await BlobDB.url(im.dataset.blob, im.dataset.variant); if (u) im.src = u; else im.style.display = 'none'; });
            bl.forEach(b => (b.voices || []).forEach(f => { const slot = list.querySelector('[data-player="' + f.id + '"]'); if (slot) slot.replaceWith(buildPlayer(Object.assign({ kind: 'voice' }, f))); }));
            if (st.rec && st.recBlock) wireRecorderUi();
        }
        paintHead();
    }
    function refreshBlockHead(id) {   // без перерисовки карточки (чтобы не терять фокус при вводе)
        const b = st.sg.blocks.find(x => x.id === id), c = $('.sb[data-id="' + id + '"]', list); if (!b || !c) return;
        $('.sb-time span', c).textContent = fmtClock(b.start) + ' – ' + fmtClock(b.end);
        const cnt = $('.sb-cnt', c); if (cnt) cnt.textContent = b.label.length + '/' + SONG_LABEL_MAX;
    }

    // ----- голосовая запись в блок -----
    function wireRecorderUi() {
        const bars = $('.sb-rec-bars', list); if (!bars) return;
        bars.innerHTML = '<i></i>'.repeat(24); st.recBars = bars.children;
    }
    async function recStart(id) {
        if (st.rec) return;
        if (!VoiceRecorder.supported()) { toast('Диктофон не поддерживается в этом браузере'); return; }
        pause();
        st.rec = new VoiceRecorder(); st.recBlock = id; renderBlocks(); let n = 0;
        try {
            await st.rec.start(sec => { const tEl = $('.sb-rec-time', list); if (tEl) tEl.textContent = fmtDuration(sec); }, lvl => {
                if ((n++ % 3) === 0 && st.recBars) { const els = st.recBars; for (let i = 0; i < els.length - 1; i++) els[i].style.height = els[i + 1].style.height || '4px'; els[els.length - 1].style.height = Math.max(4, Math.round(4 + lvl * 28)) + 'px'; }
            });
        } catch (e) { st.rec = null; st.recBlock = null; renderBlocks(); toast(e && e.name === 'NotAllowedError' ? 'Нет доступа к микрофону: разрешите его в настройках браузера или приложения' : 'Не удалось включить микрофон'); }
    }
    async function recFinish(cancel) {
        if (!st.rec) return;
        const r = st.rec, id = st.recBlock; st.rec = null; st.recBlock = null;
        const res = cancel ? await r.cancel() : await r.stop();
        const b = st.sg.blocks.find(x => x.id === id);
        if (res && !cancel && b) {
            const f = { id: uid('f'), kind: 'voice', name: 'Голос ' + fmtClock(b.start).replace(':', '-') + (b.label ? ' ' + songSafe(b.label, 24) : '') + '.' + voiceExt(res.type), type: res.type, size: res.blob.size, dur: res.dur };
            try { await BlobDB.put({ id: f.id, blob: res.blob, name: f.name, type: f.type, size: f.size }); b.voices = (b.voices || []).concat([f]); saveNow(); toast('Голосовая запись добавлена в блок'); } catch (e) { toast('Не удалось сохранить запись'); }
        } else if (!cancel && !res) toast('Запись получилась пустой');
        renderBlocks();
    }
    async function addImages(id, files) {
        const b = st.sg.blocks.find(x => x.id === id); if (!b) return; let ok = 0;
        for (const file of Array.from(files || [])) {
            if (!/^image\//.test(file.type)) continue;
            try { const a = await makeAttachment(file, 'image'); await persistAttachment(a); b.imgs = (b.imgs || []).concat([attachmentMeta(a)]); ok++; } catch (e) { toast('Не удалось добавить: ' + file.name); }
        }
        if (ok) { saveNow(); renderBlocks(); }
    }

    // ----- события: список блоков -----
    let imgTarget = null;
    list.addEventListener('click', async e => {
        const btn = e.target.closest('[data-b]'); if (!btn) return;
        const card = btn.closest('.sb'), id = card && card.dataset.id, b = id && st.sg.blocks.find(x => x.id === id), act = btn.dataset.b;
        if (act === 'openscript') { closeSongStudio(); if (typeof openScript === 'function') { showTab('scripts'); openScript(btn.dataset.id); } return; }
        if (!b) return;
        if (act === 'play') { if (isPlaying() && st.playRange && st.activeId === id) pause(); else { st.openId = st.openId; playBlock(id); } }
        else if (act === 'seek') { seek(b.start); selectBlock(id, { zoomTo: true }); }
        else if (act === 'toggle') { st.openId = st.openId === id ? null : id; renderBlocks(); drawWave(); draw(); if (st.openId) { const c = $('.sb[data-id="' + id + '"]', list); if (c) c.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); scrollWaveTo(id); } }
        else if (act === 'setstart') { setBlockTime(b, 'start', cur()); saveNow(); renderBlocks(); drawWave(); draw(); }
        else if (act === 'setend') { setBlockTime(b, 'end', cur()); saveNow(); renderBlocks(); drawWave(); draw(); }
        else if (act === 'del') deleteBlock(id);
        else if (act === 'merge') mergeNext(id);
        else if (act === 'rec') recStart(id);
        else if (act === 'recstop') recFinish(false);
        else if (act === 'reccancel') recFinish(true);
        else if (act === 'addimg') { imgTarget = id; const inp = q('.ss-img'); inp.value = ''; inp.click(); }
        else if (act === 'img') { openLightbox((b.imgs || []).map(f => f.id), +btn.dataset.k || 0); }
        else if (act === 'rmimg') { b.imgs = (b.imgs || []).filter(f => f.id !== btn.dataset.id); await BlobDB.del(btn.dataset.id); saveNow(); renderBlocks(); }
        else if (act === 'rmvoice') { b.voices = (b.voices || []).filter(f => f.id !== btn.dataset.id); await BlobDB.del(btn.dataset.id); saveNow(); renderBlocks(); }
    });
    list.addEventListener('input', e => {
        const card = e.target.closest('.sb'); if (!card) return;
        const b = st.sg.blocks.find(x => x.id === card.dataset.id); if (!b) return;
        if (e.target.classList.contains('sb-label')) { if (e.target.value.length > SONG_LABEL_MAX) e.target.value = e.target.value.slice(0, SONG_LABEL_MAX); b.label = e.target.value; refreshBlockHead(b.id); save(); drawWaveSoon(); }
        else if (e.target.classList.contains('sb-note')) { b.note = e.target.value; save(); }
    });
    const drawWaveSoon = debounce(() => { if (!st.closed) drawWave(); }, 250);
    list.addEventListener('change', e => {
        const inp = e.target.closest('[data-f]'); if (!inp) return;
        const card = inp.closest('.sb'), b = st.sg.blocks.find(x => x.id === card.dataset.id), v = parseClock(inp.value);
        if (!b) return;
        if (isNaN(v)) { inp.value = fmtClock(b[inp.dataset.f], true); toast('Время вводится так: 1:05 или 1:05.5 или 65'); return; }
        setBlockTime(b, inp.dataset.f, v); inp.value = fmtClock(b[inp.dataset.f], true);
        saveNow(); refreshBlockHead(b.id); drawWave(); draw();
        const other = $('[data-f="' + (inp.dataset.f === 'start' ? 'end' : 'start') + '"]', card); if (other) other.value = fmtClock(b[inp.dataset.f === 'start' ? 'end' : 'start'], true);
    });
    q('.ss-img').addEventListener('change', e => { const files = Array.from(e.target.files || []); e.target.value = ''; if (imgTarget) addImages(imgTarget, files); });
    q('.ss-file').addEventListener('change', e => { const f = e.target.files && e.target.files[0]; e.target.value = ''; pickFile(f); });

    // ----- события: волна (выделение, перемотка, края блоков) -----
    const lanePos = () => ({ y0: WAVE_H + RULER_H, y1: H });
    function posOf(ev) { const r = cvO.getBoundingClientRect(); return { x: ev.clientX - r.left, y: ev.clientY - r.top }; }
    function edgeHit(x, y) {
        const lp = lanePos(); if (y < lp.y0) return null;
        for (const b of sortedBlocks()) {
            if (Math.abs(x - t2x(b.start)) <= 9) return { b, edge: 'start' };
            if (Math.abs(x - t2x(b.end)) <= 9) return { b, edge: 'end' };
        }
        return null;
    }
    cvO.addEventListener('pointerdown', ev => {
        if (!dur()) return;
        const { x, y } = posOf(ev), lp = lanePos(), t = x2t(x);
        cvO.setPointerCapture(ev.pointerId);
        if (y >= WAVE_H && y < lp.y0) { st.drag = { type: 'pan', x0: ev.clientX, sl0: box.scrollLeft }; return; }
        if (y >= lp.y0) {
            const hit = edgeHit(x, y);
            if (hit) { st.drag = { type: 'edge', b: hit.b, edge: hit.edge, moved: false }; return; }
            const b = songBlockAt(st.sg, t);
            st.drag = { type: 'lane', b, t, x0: x, moved: false }; return;
        }
        st.drag = { type: 'range', x0: x, t0: t, moved: false };
    });
    cvO.addEventListener('pointermove', ev => {
        const { x, y } = posOf(ev), d = st.drag;
        if (!d) { cvO.style.cursor = edgeHit(x, y) ? 'ew-resize' : (y >= WAVE_H + RULER_H ? 'pointer' : 'crosshair'); return; }
        if (d.type === 'pan') { box.scrollLeft = d.sl0 - (ev.clientX - d.x0); return; }
        if (d.type === 'edge') { d.moved = true; setBlockTime(d.b, d.edge, x2t(x)); drawWave(); draw(); refreshBlockHead(d.b.id); return; }
        if (Math.abs(x - d.x0) > 6) d.moved = true;
        if (d.type === 'range' && d.moved) { const t = x2t(x); st.selection = { a: Math.min(d.t0, t), b: Math.max(d.t0, t) }; draw(); }
    });
    const endDrag = ev => {
        const d = st.drag; st.drag = null; if (!d) return;
        const { x } = posOf(ev);
        if (d.type === 'edge') { if (d.moved) { saveNow(); renderBlocks(); } return; }
        if (d.type === 'lane') { if (!d.moved) { if (d.b) selectBlock(d.b.id, { seek: true, scroll: true }); else seek(d.t); } return; }
        if (d.type === 'range') {
            if (!d.moved) { st.selection = null; selbar.hidden = true; seek(d.t0); return; }
            const s = st.selection; if (!s || s.b - s.a < 0.3) { st.selection = null; selbar.hidden = true; draw(); return; }
            q('.ss-seltxt').textContent = 'Выделено ' + fmtClock(s.a, true) + ' – ' + fmtClock(s.b, true) + ' (' + fmtSpan(s.b - s.a) + ')'; selbar.hidden = false;
        }
    };
    cvO.addEventListener('pointerup', endDrag); cvO.addEventListener('pointercancel', endDrag);
    box.addEventListener('wheel', ev => { if (ev.ctrlKey || ev.metaKey) { ev.preventDefault(); setZoom(st.zoom * (ev.deltaY < 0 ? 2 : 0.5)); } }, { passive: false });
    function setZoom(z) {
        const i = Math.max(0, Math.min(SONG_ZOOMS.length - 1, SONG_ZOOMS.reduce((best, v, k) => Math.abs(v - z) < Math.abs(SONG_ZOOMS[best] - z) ? k : best, 0)));
        if (SONG_ZOOMS[i] === st.zoom) return; st.zoom = SONG_ZOOMS[i]; layout();
        const x = t2x(cur()); box.scrollLeft = Math.max(0, x - box.clientWidth / 2);
    }

    // ----- события: кнопки студии -----
    async function menu() {
        const sheet = openSheet({
            title: 'Песня', html: '<div class="ss-menu">' +
                '<button type="button" class="btn btn-wide" data-m="edit">' + ic('edit') + 'Автор, название, название заметки</button>' +
                '<button type="button" class="btn btn-wide" data-m="auto">' + ic('splitscreen') + 'Нарезать по длительности…</button>' +
                '<button type="button" class="btn btn-wide" data-m="notes">' + ic('description') + 'Сохранить конспект (.txt)</button>' +
                '<button type="button" class="btn btn-wide" data-m="audio">' + ic('download') + 'Скачать аудиофайл</button>' +
                '<button type="button" class="btn btn-wide" data-m="sync">' + ic('sync') + 'Синхронизировать с Google Диском</button>' +
                '<p class="hint si-path-line">' + ic('folder') + '<span>' + esc(songDrivePath(st.sg)) + '</span></p>' +
                '<button type="button" class="btn btn-danger btn-wide" data-m="del">' + ic('delete') + 'Удалить песню</button></div>',
            actions: [{ label: 'Закрыть' }]
        });
        sheet.body.addEventListener('click', async e => {
            const b = e.target.closest('[data-m]'); if (!b) return; const m = b.dataset.m; sheet.close();
            if (m === 'edit') {
                const info = await songInfoSheet({ artist: st.sg.artist, title: st.sg.title, noteTitle: st.sg.noteTitle, createdAt: st.sg.createdAt, fileName: st.sg.audioName, fileType: st.sg.audioType }, 'edit');
                if (info) { Object.assign(st.sg, info); saveNow(); paintHead(); toast('Сохранено' + (typeof gSongOnDrive === 'function' && gSongOnDrive(st.sg) ? ' — файл на Диске переименуется при синхронизации' : '')); }
            } else if (m === 'auto') autoSplitSheet();
            else if (m === 'notes') songExportNotes(st.sg);
            else if (m === 'audio') {
                const rec = await BlobDB.get(st.sg.audioId); if (!rec || !rec.blob) { toast('Аудио нет на этом устройстве'); return; }
                const res = await deliverFile(rec.blob, songFileName(st.sg));
                toast(res === 'unsupported' ? 'В этом приложении сохранить файл нельзя — откройте iLife в браузере' : res === 'shared' ? 'Выберите, куда отправить файл' : 'Файл скачан: ' + songFileName(st.sg));
            } else if (m === 'sync') { if (typeof syncNowButton === 'function') syncNowButton(); }
            else if (m === 'del') { if (await songDelete(st.sg.id)) closeSongStudio(true); }
        });
    }
    function autoSplitSheet() {
        const D = dur(); if (!(D > 0)) { toast('Сначала нужна длина песни'); return; }
        const has = st.sg.blocks.length > 0, presets = [10, 15, 30, 60, 120];
        const sheet = openSheet({
            title: 'Нарезать по длительности',
            html: '<p class="hint" style="margin-bottom:10px">Песня (' + fmtClock(D) + ') будет поделена на равные блоки. Дальше любой блок можно подвинуть, разрезать или склеить.</p>' +
                '<label class="field-label" for="as-step">Длина одного блока (секунды или м:сс)</label><input type="text" id="as-step" inputmode="decimal" value="30" autocomplete="off">' +
                '<div class="chips" id="as-chips" style="margin-top:8px">' + presets.map(p => '<button type="button" class="chip" data-p="' + p + '">' + (p < 60 ? p + ' с' : (p / 60) + ' мин') + '</button>').join('') + '</div>' +
                '<p class="hint" id="as-info" style="margin-top:10px"></p>' +
                (has ? '<div class="seg" id="as-mode" style="margin-top:12px"><button type="button" class="is-on" data-k="1">Заполнить пустые места</button><button type="button" data-k="0">Заменить всю разметку</button></div><p class="hint" id="as-warn" style="margin-top:6px">Существующие блоки с заметками останутся нетронутыми.</p>' : ''),
            actions: [{ label: 'Отмена' }, { label: 'Нарезать', kind: 'primary', icon: 'check', async onClick() {
                const step = parseClock($('#as-step', sheet.el).value);
                if (!(step >= 1)) { toast('Длина блока — не меньше секунды, например 30 или 0:45'); return false; }
                const keep = !has || $('#as-mode .is-on', sheet.el).dataset.k === '1';
                if (!keep && !(await confirmSheet('Заменить разметку?', 'Все текущие блоки с заметками, картинками и голосом будут удалены.', 'Заменить', true))) return false;
                if (!keep) { for (const b of st.sg.blocks) { for (const f of b.imgs || []) await BlobDB.del(f.id); for (const f of b.voices || []) await BlobDB.del(f.id); } }
                const n = songAutoSplit(st.sg, step, keep); saveNow(); st.openId = null; renderBlocks(); drawWave(); draw();
                toast(n ? 'Создано блоков: ' + n : 'Свободных мест для блоков нет');
            } }]
        });
        const inp = $('#as-step', sheet.el), info = $('#as-info', sheet.el);
        const upd = () => { const s = parseClock(inp.value); info.textContent = s >= 1 ? 'Получится примерно ' + Math.max(1, Math.ceil(D / s)) + ' блоков.' : ''; };
        inp.addEventListener('input', upd); upd();
        $('#as-chips', sheet.el).addEventListener('click', e => { const c = e.target.closest('[data-p]'); if (c) { inp.value = c.dataset.p; upd(); } });
        const seg = $('#as-mode', sheet.el);
        if (seg) seg.addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; $$('button', seg).forEach(x => x.classList.toggle('is-on', x === b)); $('#as-warn', sheet.el).textContent = b.dataset.k === '1' ? 'Существующие блоки с заметками останутся нетронутыми.' : 'Внимание: все текущие блоки будут заменены новыми.'; });
    }
    function newBlockSheet() {
        const D = dur(); if (!(D > 0)) { toast('Сначала нужна длина песни'); return; }
        const sel = st.selection, a0 = sel ? sel.a : cur(), b0 = sel ? sel.b : Math.min(D, cur() + 15);
        const sheet = openSheet({
            title: 'Новый блок',
            html: '<div class="sb-times"><label><span>Начало</span><input type="text" id="nb-a" inputmode="decimal" autocomplete="off"></label><label><span>Конец</span><input type="text" id="nb-b" inputmode="decimal" autocomplete="off"></label></div>' +
                '<label class="field-label" for="nb-l" style="margin-top:12px">Подпись (до ' + SONG_LABEL_MAX + ' символов)</label><input type="text" id="nb-l" maxlength="' + SONG_LABEL_MAX + '" autocomplete="off" placeholder="Например: герой входит в комнату">',
            actions: [{ label: 'Отмена' }, { label: 'Создать', kind: 'primary', icon: 'check', onClick() {
                const a = parseClock($('#nb-a', sheet.el).value), b = parseClock($('#nb-b', sheet.el).value);
                if (isNaN(a) || isNaN(b)) { toast('Время вводится так: 1:05 или 65'); return false; }
                const nb = addBlock(Math.min(a, b), Math.max(a, b), $('#nb-l', sheet.el).value.trim()); if (!nb) return false;
                st.selection = null; selbar.hidden = true; selectBlock(nb.id, { scroll: true });
            } }]
        });
        $('#nb-a', sheet.el).value = fmtClock(a0, true); $('#nb-b', sheet.el).value = fmtClock(b0, true);
    }
    el.addEventListener('click', async e => {
        const b = e.target.closest('[data-ss]'); if (!b) return; const act = b.dataset.ss;
        if (act === 'close') closeSongStudio();
        else if (act === 'menu') menu();
        else if (act === 'play') toggle();
        else if (act === 'back') seek(cur() - 5);
        else if (act === 'fwd') seek(cur() + 5);
        else if (act === 'prevblk') { const bl = sortedBlocks(), t = cur(); const p = bl.filter(x => x.start < t - 1.2).pop(); if (p) { selectBlock(p.id, { seek: true, scroll: true, zoomTo: true }); if (isPlaying()) playBlock(p.id); } else seek(0); }
        else if (act === 'nextblk') { const bl = sortedBlocks(), t = cur(); const n = bl.find(x => x.start > t + 0.05); if (n) { selectBlock(n.id, { seek: true, scroll: true, zoomTo: true }); if (isPlaying()) playBlock(n.id); } }
        else if (act === 'split') splitHere();
        else if (act === 'auto') autoSplitSheet();
        else if (act === 'newblk') newBlockSheet();
        else if (act === 'zoomin') setZoom(st.zoom * 2);
        else if (act === 'zoomout') setZoom(st.zoom / 2);
        else if (act === 'loop') { st.loop = !st.loop; b.classList.toggle('is-on', st.loop); b.setAttribute('aria-pressed', String(st.loop)); if (st.playRange) st.playRange.loop = st.loop; }
        else if (act === 'follow') { st.follow = !st.follow; b.classList.toggle('is-on', st.follow); b.setAttribute('aria-pressed', String(st.follow)); }
        else if (act === 'selplay' && st.selection) play({ start: st.selection.a, end: st.selection.b });
        else if (act === 'selclear') { st.selection = null; selbar.hidden = true; draw(); }
        else if (act === 'selblock' && st.selection) { const nb = addBlock(st.selection.a, st.selection.b, ''); if (nb) { st.selection = null; selbar.hidden = true; selectBlock(nb.id, { scroll: true }); } }
        else if (act === 'fetch') fetchAudio();
        else if (act === 'pickfile') q('.ss-file').click();
    });
    el.addEventListener('change', e => { const s = e.target.closest('[data-ss="rate"]'); if (s) { st.rate = parseFloat(s.value) || 1; if (st.audio) st.audio.playbackRate = st.rate; } });
    const onKey = e => {
        if (sheetStack.length || st.closed) return;
        const tag = (e.target.tagName || '').toLowerCase(); if (tag === 'input' || tag === 'textarea' || tag === 'select') { if (e.key === 'Escape') e.target.blur(); return; }
        if (e.ctrlKey || e.metaKey || e.altKey) return;
        if (e.key === 'Escape') closeSongStudio();
        else if (e.key === ' ') { e.preventDefault(); toggle(); }
        else if (e.key === 'm' || e.key === 'M' || e.key === 'ь' || e.key === 'Ь') { e.preventDefault(); splitHere(); }
        else if (e.key === 'ArrowLeft') { e.preventDefault(); seek(cur() - 5); } else if (e.key === 'ArrowRight') { e.preventDefault(); seek(cur() + 5); }
        else if (e.key === '[' || e.key === 'х' || e.key === 'Х') el.querySelector('[data-ss="prevblk"]').click(); else if (e.key === ']' || e.key === 'ъ' || e.key === 'Ъ') el.querySelector('[data-ss="nextblk"]').click();
    };
    document.addEventListener('keydown', onKey);
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(debounce(() => { if (!st.closed && Math.abs(box.clientWidth * st.zoom - W) > 2) layout(); }, 80)) : null;
    if (ro) ro.observe(box);
    if (!ro) window.addEventListener('resize', layout);

    songStudio = {
        el, st, onKey,
        stop(removeOnly) {
            st.closed = true; if (st.raf) cancelAnimationFrame(st.raf);
            document.removeEventListener('keydown', onKey); if (ro) ro.disconnect(); else window.removeEventListener('resize', layout);
            if (st.fetchCtl) { try { st.fetchCtl.abort(); } catch (e) {} }
            if (st.rec) { try { st.rec.cancel(); } catch (e) {} st.rec = null; }
            if (st.audio) { try { st.audio.pause(); st.audio.removeAttribute('src'); st.audio.load(); } catch (e) {} if (typeof playingAudio !== 'undefined' && playingAudio === st.audio) playingAudio = null; }
            if (!removeOnly) { saveSongsSoon.flush ? saveSongsSoon.flush() : null; st.sg.updatedAt = Date.now(); saveSongs(); }
        }
    };

    // ----- старт -----
    paintHead();
    q('.ss-tot').textContent = fmtClock(dur());
    renderBlocks();
    layout();
    checkAudio().then(async () => {
        if (st.hasAudio) { await ensureAudio(); computePeaksIfNeeded(); }
        q('.ss-tot').textContent = fmtClock(dur()); layout();
        if (blockId) { const b = st.sg.blocks.find(x => x.id === blockId); if (b) { selectBlock(blockId, { seek: true, scroll: true, zoomTo: true }); } }
    });
    if (st.openId && !blockId) { const c = $('.sb[data-id="' + st.openId + '"]', list); if (c) c.scrollIntoView({ block: 'center' }); }
    draw();
}

function closeSongStudio(skipSave) {
    if (!songStudio) return;
    const s = songStudio; songStudio = null;
    s.stop(!!skipSave);
    s.el.classList.remove('is-in'); s.el.classList.add('is-out');
    setTimeout(() => s.el.remove(), 220);
    if (!sheetStack.length) document.body.classList.remove('is-locked');
    renderSongs();
}

// =====================================================================================================
// Подключение событий страницы «Идеи»
// =====================================================================================================
function initSongs() {
    const pickBtns = ['#songs-add', '#btn-song'];
    const inp = $('#file-song');
    pickBtns.forEach(sel => { const b = $(sel); if (b && inp) b.addEventListener('click', () => { inp.value = ''; inp.click(); }); });
    if (inp) inp.addEventListener('change', () => { const f = inp.files && inp.files[0]; inp.value = ''; songCreateFromFile(f); });
    const list = $('#songs-list');
    if (list) list.addEventListener('click', e => { const r = e.target.closest('[data-song]'); if (r) openSongStudio(r.dataset.song); });
    const q = $('#songs-q'); if (q) q.addEventListener('input', debounce(() => { songsQuery = q.value; renderSongs(); }, 150));
    renderSongs();
}
