'use strict';
// =====================================================================================================
// iLife — МУЗЫКА: ЧТЕНИЕ ТЕГОВ ИЗ ФАЙЛА (версия 1.8.0).
//
// Чтобы собрать коллекцию из папки Google Диска, приложение не скачивает песни целиком: у каждого файла запрашивается только
// начало (и, для некоторых M4A, нужный кусок из конца) — по HTTP-заголовку Range. Из него читаются:
//   • MP3  — теги ID3v2 (2.2, 2.3, 2.4): название, исполнитель, альбом, исполнитель альбома, композитор, жанр, год, номер дорожки, обложка;
//            длительность — по заголовку Xing/VBRI или по размеру файла и битрейту;
//   • M4A / MP4 / AAC в контейнере — атомы moov → udta → meta → ilst (©nam, ©ART, ©alb, aART, ©wrt, ©gen, ©day, trkn, disk, covr), длительность из mvhd;
//   • FLAC — блоки STREAMINFO (длительность), VORBIS_COMMENT (теги), PICTURE (обложка);
//   • OGG / OPUS — комментарии Vorbis (без обложки и длительности).
// Что не нашлось (WAV, теги без текста), восстанавливается по имени файла и папкам в js/music.js.
// Русские теги в старой кодировке Windows-1251 (частая беда ID3v2 с кодировкой «0») распознаются автоматически.
//
// Читалка получает функцию range(начало, конец) → Uint8Array (конец не включается). Все ошибки сворачиваются в пустой результат —
// файл без читаемых тегов всё равно попадёт в коллекцию (с названием из имени файла).
// =====================================================================================================

const MT_WIN1251 = (() => { try { return new TextDecoder('windows-1251'); } catch (e) { return null; } })();
const MT_UTF8 = new TextDecoder('utf-8');
const MT_UTF8_STRICT = new TextDecoder('utf-8', { fatal: true });
const MT_COVER_MAX = 3 * 1048576;           // обложка крупнее этого размера не читается
const mtU32 = (b, o) => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
const mtU32le = (b, o) => ((b[o + 3] << 24) | (b[o + 2] << 16) | (b[o + 1] << 8) | b[o]) >>> 0;
const mtSync = (b, o) => ((b[o] & 0x7f) << 21) | ((b[o + 1] & 0x7f) << 14) | ((b[o + 2] & 0x7f) << 7) | (b[o + 3] & 0x7f);
const mtStr4 = (b, o) => String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]);

// Строка из байтов с учётом кодировки ID3 (0 — Latin-1 / Windows-1251, 1 — UTF-16 с BOM, 2 — UTF-16BE, 3 — UTF-8)
function mtDecode(bytes, enc) {
    if (!bytes.length) return '';
    let s;
    if (enc === 1) {
        if (bytes[0] === 0xff && bytes[1] === 0xfe) s = new TextDecoder('utf-16le').decode(bytes.subarray(2));
        else if (bytes[0] === 0xfe && bytes[1] === 0xff) s = new TextDecoder('utf-16be').decode(bytes.subarray(2));
        else s = new TextDecoder('utf-16le').decode(bytes);
    } else if (enc === 2) s = new TextDecoder('utf-16be').decode(bytes);
    else if (enc === 3) s = MT_UTF8.decode(bytes);
    else {
        let high = false; for (let i = 0; i < bytes.length; i++) if (bytes[i] > 0x7f) { high = true; break; }
        if (!high) s = String.fromCharCode.apply(null, Array.from(bytes));
        else { try { s = MT_UTF8_STRICT.decode(bytes); } catch (e) { s = MT_WIN1251 ? MT_WIN1251.decode(bytes) : String.fromCharCode.apply(null, Array.from(bytes)); } }
    }
    return s.replace(/\u0000+$/g, '').replace(/\u0000/g, '; ').replace(/^﻿/, '').trim();
}

// ---------- Окно чтения: кусочки файла подгружаются по мере надобности ----------
function mtReader(range, size) {
    let win = { start: 0, bytes: new Uint8Array(0) };
    return {
        size,
        async read(off, len) {
            off = Math.max(0, off); len = Math.max(0, Math.min(len, size - off));
            if (!len) return new Uint8Array(0);
            if (off >= win.start && off + len <= win.start + win.bytes.length) return win.bytes.subarray(off - win.start, off - win.start + len);
            const want = Math.min(size - off, Math.max(len, 65536));
            const bytes = await range(off, off + want);
            win = { start: off, bytes };
            return bytes.subarray(0, Math.min(len, bytes.length));
        }
    };
}

// ---------- MP3: ID3v2 ----------
const MT_ID3_NAMES = { TIT2: 'title', TPE1: 'artist', TALB: 'album', TPE2: 'albumArtist', TCOM: 'composer', TCON: 'genre', TRCK: 'track', TPOS: 'disc', TYER: 'year', TDRC: 'year', TLEN: 'lenMs',
    TT2: 'title', TP1: 'artist', TAL: 'album', TP2: 'albumArtist', TCM: 'composer', TCO: 'genre', TRK: 'track', TPA: 'disc', TYE: 'year', TLE: 'lenMs' };
const MT_ID3_GENRES = ['Blues', 'Classic Rock', 'Country', 'Dance', 'Disco', 'Funk', 'Grunge', 'Hip-Hop', 'Jazz', 'Metal', 'New Age', 'Oldies', 'Other', 'Pop', 'R&B', 'Rap', 'Reggae', 'Rock', 'Techno', 'Industrial', 'Alternative', 'Ska', 'Death Metal', 'Pranks', 'Soundtrack', 'Euro-Techno', 'Ambient', 'Trip-Hop', 'Vocal', 'Jazz+Funk', 'Fusion', 'Trance', 'Classical', 'Instrumental', 'Acid', 'House', 'Game', 'Sound Clip', 'Gospel', 'Noise', 'AlternRock', 'Bass', 'Soul', 'Punk', 'Space', 'Meditative', 'Instrumental Pop', 'Instrumental Rock', 'Ethnic', 'Gothic', 'Darkwave', 'Techno-Industrial', 'Electronic', 'Pop-Folk', 'Eurodance', 'Dream', 'Southern Rock', 'Comedy', 'Cult', 'Gangsta', 'Top 40', 'Christian Rap', 'Pop/Funk', 'Jungle', 'Native American', 'Cabaret', 'New Wave', 'Psychedelic', 'Rave', 'Showtunes', 'Trailer', 'Lo-Fi', 'Tribal', 'Acid Punk', 'Acid Jazz', 'Polka', 'Retro', 'Musical', 'Rock & Roll', 'Hard Rock'];
function mtGenreFix(g) {   // «(17)» и «17» — номера жанров ID3v1
    const m = String(g || '').match(/^\(?(\d{1,3})\)?$/);
    return m ? (MT_ID3_GENRES[+m[1]] || '') : String(g || '').replace(/\((\d{1,3})\)/g, (x, n) => MT_ID3_GENRES[+n] || '').trim();
}
function mtPicture(bytes, v22) {   // кадр APIC / PIC → { mime, bytes }
    if (!bytes.length) return null;
    const enc = bytes[0]; let p = 1, mime = 'image/jpeg';
    if (v22) { const f = String.fromCharCode(bytes[1], bytes[2], bytes[3]).toUpperCase(); mime = f === 'PNG' ? 'image/png' : 'image/jpeg'; p = 4; }
    else { let e = p; while (e < bytes.length && bytes[e] !== 0) e++; mime = String.fromCharCode.apply(null, Array.from(bytes.subarray(p, e))).toLowerCase() || 'image/jpeg'; p = e + 1; }
    p += 1;   // тип картинки
    if (enc === 1 || enc === 2) { while (p + 1 < bytes.length && !(bytes[p] === 0 && bytes[p + 1] === 0)) p += 2; p += 2; }   // описание в UTF-16 — до двойного нуля
    else { while (p < bytes.length && bytes[p] !== 0) p++; p += 1; }
    const img = bytes.subarray(p);
    if (img.length < 100) return null;
    if (img[0] === 0x89 && img[1] === 0x50) mime = 'image/png'; else if (img[0] === 0xff && img[1] === 0xd8) mime = 'image/jpeg';
    if (!/^image\//.test(mime) || /\//.test(mime) === false) mime = 'image/jpeg';
    return { mime, bytes: img };
}
async function mtId3(rd, needCover) {
    const h = await rd.read(0, 10);
    if (h.length < 10 || h[0] !== 0x49 || h[1] !== 0x44 || h[2] !== 0x33) return null;
    const ver = h[3], flags = h[5], tagEnd = Math.min(rd.size, 10 + mtSync(h, 6));
    const out = { _audioStart: tagEnd };
    let pos = 10;
    if (flags & 0x40) { const eh = await rd.read(pos, 6); pos += ver === 4 ? mtSync(eh, 0) : mtU32(eh, 0) + 4; }   // расширенный заголовок
    const idLen = ver === 2 ? 3 : 4, hdLen = ver === 2 ? 6 : 10;
    let pic = null;
    while (pos + hdLen <= tagEnd) {
        const fh = await rd.read(pos, hdLen);
        if (fh.length < hdLen || fh[0] === 0) break;   // дальше — выравнивающие нули
        const id = String.fromCharCode.apply(null, Array.from(fh.subarray(0, idLen)));
        const sz = ver === 2 ? (fh[3] << 16) | (fh[4] << 8) | fh[5] : ver === 4 ? mtSync(fh, 4) : mtU32(fh, 4);
        const fl = ver === 2 ? 0 : fh[9];
        if (!/^[A-Z0-9]+$/.test(id) || sz <= 0 || pos + hdLen + sz > tagEnd + 1) break;
        const name = MT_ID3_NAMES[id];
        if (name && sz < 4096 && !(fl & 0x0c)) {   // текстовые кадры (без сжатия и шифрования)
            const body = await rd.read(pos + hdLen, sz);
            let t = mtDecode(body.subarray(1), body[0]);
            if (name === 'genre') t = mtGenreFix(t);
            if (!out[name] && t) out[name] = t;
        } else if ((id === 'APIC' || id === 'PIC') && !pic && !(fl & 0x0c)) {
            pic = { off: pos + hdLen, len: sz, v22: ver === 2 };
        }
        pos += hdLen + sz;
    }
    if (pic && pic.len <= MT_COVER_MAX && (!needCover || needCover(out))) {
        const body = await rd.read(pic.off, pic.len);
        out.cover = mtPicture(body, pic.v22);
    }
    return out;
}
// Длительность MP3 по первому кадру (Xing / VBRI — точно; иначе по размеру и битрейту)
const MT_BR = { '3-3': [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320], '3-2': [0, 32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384], '3-1': [0, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448],
    '2-3': [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160], '2-2': [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160], '2-1': [0, 32, 48, 56, 64, 80, 96, 112, 128, 144, 160, 176, 192, 224, 256] };
const MT_SR = { 3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000] };
async function mtMp3Duration(rd, start) {
    const b = await rd.read(start, 8192);
    for (let i = 0; i + 4 < b.length; i++) {
        if (b[i] !== 0xff || (b[i + 1] & 0xe0) !== 0xe0) continue;
        const ver = (b[i + 1] >> 3) & 3, layer = (b[i + 1] >> 1) & 3, bi = b[i + 2] >> 4, si = (b[i + 2] >> 2) & 3, mode = (b[i + 3] >> 6) & 3;
        if (ver === 1 || layer === 0 || bi === 0 || bi === 15 || si === 3) continue;
        const l = 4 - layer, vk = ver === 3 ? 3 : 2, br = (MT_BR[vk + '-' + l] || [])[bi] * 1000, sr = MT_SR[ver][si];
        if (!br || !sr) continue;
        const spf = l === 1 ? 384 : (l === 3 && ver !== 3) ? 576 : 1152;
        const side = ver === 3 ? (mode === 3 ? 17 : 32) : (mode === 3 ? 9 : 17);
        const x = i + 4 + (b[i + 1] & 1 ? 0 : 2) + side;
        const tag = x + 4 <= b.length ? mtStr4(b, x) : '';
        if ((tag === 'Xing' || tag === 'Info') && x + 12 <= b.length && (b[x + 7] & 1)) return mtU32(b, x + 8) * spf / sr;
        const vb = i + 4 + 32; if (vb + 18 <= b.length && mtStr4(b, vb) === 'VBRI') return mtU32(b, vb + 14) * spf / sr;
        return Math.max(0, rd.size - (start + i)) * 8 / br;
    }
    return 0;
}

// ---------- M4A / MP4 ----------
function mtAtoms(b, s, e) {
    const list = []; let p = s;
    while (p + 8 <= e) {
        let sz = mtU32(b, p), hl = 8; const type = mtStr4(b, p + 4);
        if (sz === 1) { sz = mtU32(b, p + 8) * 4294967296 + mtU32(b, p + 12); hl = 16; } else if (sz === 0) sz = e - p;
        if (sz < hl || p + sz > e) { if (sz >= hl && p + hl <= e) { list.push({ type, ds: p + hl, de: e }); } break; }
        list.push({ type, ds: p + hl, de: p + sz }); p += sz;
    }
    return list;
}
async function mtMp4(rd, needCover) {
    let pos = 0, moov = null;
    for (let hop = 0; hop < 24 && pos + 8 <= rd.size; hop++) {
        const h = await rd.read(pos, 16);
        if (h.length < 8) break;
        let sz = mtU32(h, 0), hl = 8; const type = mtStr4(h, 4);
        if (sz === 1 && h.length >= 16) { sz = mtU32(h, 8) * 4294967296 + mtU32(h, 12); hl = 16; } else if (sz === 0) sz = rd.size - pos;
        if (sz < hl) break;
        if (type === 'moov') { if (sz > 24 * 1048576) return null; moov = await rd.read(pos + hl, sz - hl); break; }
        pos += sz;
    }
    if (!moov || !moov.length) return null;
    const out = {}, top = mtAtoms(moov, 0, moov.length);
    const mvhd = top.find(a => a.type === 'mvhd');
    if (mvhd) {
        const v = moov[mvhd.ds], ts = v === 1 ? mtU32(moov, mvhd.ds + 20) : mtU32(moov, mvhd.ds + 12);
        const dur = v === 1 ? mtU32(moov, mvhd.ds + 24) * 4294967296 + mtU32(moov, mvhd.ds + 28) : mtU32(moov, mvhd.ds + 16);
        if (ts) out.dur = dur / ts;
    }
    const udta = top.find(a => a.type === 'udta'); if (!udta) return out;
    const meta = mtAtoms(moov, udta.ds, udta.de).find(a => a.type === 'meta'); if (!meta) return out;
    const ilst = mtAtoms(moov, meta.ds + 4, meta.de).find(a => a.type === 'ilst'); if (!ilst) return out;
    const NAMES = { '©nam': 'title', '©ART': 'artist', '©alb': 'album', 'aART': 'albumArtist', '©wrt': 'composer', '©gen': 'genre', '©day': 'year' };
    mtAtoms(moov, ilst.ds, ilst.de).forEach(it => {
        const data = mtAtoms(moov, it.ds, it.de).find(a => a.type === 'data'); if (!data) return;
        const val = moov.subarray(data.ds + 8, data.de), name = NAMES[it.type];
        if (name) { const t = mtDecode(val, 3); if (t && !out[name]) out[name] = t; }
        else if (it.type === 'trkn' && val.length >= 4) out.track = String((val[2] << 8) | val[3]);
        else if (it.type === 'disk' && val.length >= 4) out.disc = String((val[2] << 8) | val[3]);
        else if (it.type === 'covr' && !out.cover && val.length > 100 && val.length <= MT_COVER_MAX && (!needCover || needCover(out))) out.cover = { mime: moov[data.ds + 3] === 14 ? 'image/png' : 'image/jpeg', bytes: val };
    });
    return out;
}

// ---------- FLAC и комментарии Vorbis ----------
function mtVorbisComments(b, p, e, out) {
    if (p + 4 > e) return;
    p += 4 + mtU32le(b, p);                       // строка производителя
    const n = mtU32le(b, p); p += 4;
    const KEYS = { TITLE: 'title', ARTIST: 'artist', ALBUM: 'album', ALBUMARTIST: 'albumArtist', 'ALBUM ARTIST': 'albumArtist', COMPOSER: 'composer', GENRE: 'genre', DATE: 'year', YEAR: 'year', TRACKNUMBER: 'track', DISCNUMBER: 'disc' };
    for (let i = 0; i < n && p + 4 <= e; i++) {
        const len = mtU32le(b, p); p += 4;
        if (len > 65536 || p + len > e) break;
        const s = MT_UTF8.decode(b.subarray(p, p + len)), eq = s.indexOf('='); p += len;
        if (eq < 1) continue;
        const k = KEYS[s.slice(0, eq).toUpperCase()], v = s.slice(eq + 1).trim();
        if (k && v) { if (out[k]) { if (k === 'artist' || k === 'composer' || k === 'genre') out[k] += '; ' + v; } else out[k] = v; }
    }
}
async function mtFlac(rd, needCover) {
    if (mtStr4(await rd.read(0, 4), 0) !== 'fLaC') return null;
    const out = {}; let pos = 4;
    for (let i = 0; i < 40; i++) {
        const h = await rd.read(pos, 4); if (h.length < 4) break;
        const last = h[0] >> 7, type = h[0] & 0x7f, len = (h[1] << 16) | (h[2] << 8) | h[3];
        if (type === 0 && len >= 34) {
            const b = await rd.read(pos + 4, 34), sr = (b[10] << 12) | (b[11] << 4) | (b[12] >> 4), total = (b[13] & 0x0f) * 4294967296 + mtU32(b, 14);
            if (sr && total) out.dur = total / sr;
        } else if (type === 4 && len < 262144) {
            const b = await rd.read(pos + 4, len); mtVorbisComments(b, 0, b.length, out);
        } else if (type === 6 && !out.cover && len <= MT_COVER_MAX && (!needCover || needCover(out))) {
            const b = await rd.read(pos + 4, len); out.cover = mtFlacPicture(b);
        }
        pos += 4 + len; if (last) break;
    }
    return out;
}
function mtFlacPicture(b) {   // блок PICTURE: тип, MIME, описание, размеры, данные (все числа — big-endian)
    try {
        let p = 4; const ml = mtU32(b, p); p += 4; const mime = String.fromCharCode.apply(null, Array.from(b.subarray(p, p + ml))).toLowerCase(); p += ml;
        const dl = mtU32(b, p); p += 4 + dl + 16; const n = mtU32(b, p); p += 4;
        const img = b.subarray(p, p + n); if (img.length < 100) return null;
        return { mime: /^image\//.test(mime) ? mime : (img[0] === 0x89 ? 'image/png' : 'image/jpeg'), bytes: img };
    } catch (e) { return null; }
}
async function mtOgg(rd) {
    const b = await rd.read(0, 65536);
    if (mtStr4(b, 0) !== 'OggS') return null;
    const out = {}; let hit = -1, skip = 0, rate = 0, pre = 0, opus = false;
    for (let i = 0; i + 8 < b.length; i++) {
        if (b[i] === 0x4f && mtStr4(b, i) === 'Opus' && mtStr4(b, i + 4) === 'Tags') { hit = i; skip = 8; opus = true; break; }
        if (b[i] === 3 && mtStr4(b, i + 1) === 'vorb') { hit = i; skip = 7; break; }
    }
    if (hit >= 0) mtVorbisComments(b, hit + skip, b.length, out);
    // частота: заголовок Vorbis («\x01vorbis», частота со смещения 12) или Opus («OpusHead», всегда 48 кГц, с поправкой pre-skip)
    for (let i = 0; i + 20 < Math.min(b.length, 4096); i++) {
        if (b[i] === 1 && mtStr4(b, i + 1) === 'vorb') { rate = mtU32le(b, i + 12); break; }
        if (b[i] === 0x4f && mtStr4(b, i) === 'Opus' && mtStr4(b, i + 4) === 'Head') { rate = 48000; pre = b[i + 10] | (b[i + 11] << 8); opus = true; break; }
    }
    // длительность: «позиция» последней страницы файла (число отсчётов)
    if (rate && rd.size > 0) {
        try {
            const tail = await rd.read(Math.max(0, rd.size - 65536), 65536);
            for (let i = tail.length - 14; i >= 0; i--) {
                if (tail[i] === 0x4f && mtStr4(tail, i) === 'OggS') {
                    const g = mtU32le(tail, i + 6) + mtU32le(tail, i + 10) * 4294967296;
                    if (g > 0 && g < 1e13) out.dur = Math.max(0, g - (opus ? pre : 0)) / rate;
                    break;
                }
            }
        } catch (e) { /* без длительности */ }
    }
    return out;
}
// WAV: длительность = размер данных / байт в секунду (теги в WAV мы не читаем — название берётся из имени файла)
async function mtWav(rd) {
    const b = await rd.read(0, 4096);
    if (mtStr4(b, 0) !== 'RIFF' || mtStr4(b, 8) !== 'WAVE') return null;
    let o = 12, byteRate = 0;
    while (o + 8 <= b.length) {
        const id = mtStr4(b, o); let sz = mtU32le(b, o + 4);
        if (id === 'fmt ') byteRate = mtU32le(b, o + 16);
        if (id === 'data') {
            if (!sz || sz > rd.size - (o + 8)) sz = rd.size - (o + 8);
            return byteRate ? { dur: sz / byteRate } : {};
        }
        o += 8 + sz + (sz & 1);
    }
    return {};
}
async function mtReadTags(range, size, ext, needCover) {
    const rd = mtReader(range, size); ext = String(ext || '').toLowerCase();
    let t = null;
    try {
        if (ext === 'wav') t = await mtWav(rd);
        else if (ext === 'mp3' || ext === 'aac') {
            t = await mtId3(rd, needCover);
            if (ext === 'mp3') {
                const start = t ? t._audioStart : 0;
                if (!(t && t.lenMs)) { const d = await mtMp3Duration(rd, start); t = t || {}; if (d) t.dur = d; } else t.dur = parseInt(t.lenMs, 10) / 1000;
            }
        } else if (ext === 'm4a' || ext === 'mp4' || ext === 'm4b') t = await mtMp4(rd, needCover);
        else if (ext === 'flac') t = await mtFlac(rd, needCover);
        else if (ext === 'ogg' || ext === 'oga' || ext === 'opus') t = await mtOgg(rd);
        else {   // расширение подвело: пробуем по содержимому
            const h = await rd.read(0, 12);
            if (h[0] === 0x49 && h[1] === 0x44 && h[2] === 0x33) t = await mtId3(rd, needCover);
            else if (mtStr4(h, 0) === 'fLaC') t = await mtFlac(rd, needCover);
            else if (mtStr4(h, 4) === 'ftyp') t = await mtMp4(rd, needCover);
        }
    } catch (e) { console.warn('Теги не прочитаны', e); }
    t = t || {}; delete t._audioStart;
    return t;
}
