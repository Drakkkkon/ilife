'use strict';
// =====================================================================================================
// iLife — СТРАНИЦА «МУЗЫКА»: коллекция из папки Google Диска, списки песен / альбомов / исполнителей / композиторов / жанров,
// избранное. Воспроизведение, кеш и загрузки — в js/musicplayer.js; чтение тегов из файлов — в js/musictags.js.
//
// Как это устроено:
//   • Вы выбираете папку с музыкой на своём Google Диске (Музыка → «Выбрать папку»). Приложение обходит её вместе с вложенными
//     папками, находит звуковые файлы (MP3, M4A, FLAC, OGG/OPUS, WAV, AAC) и читает теги — только начало каждого файла, без полной загрузки.
//   • Доступ к чужим для приложения файлам Диска выдаётся отдельным разрешением «только чтение» (drive.readonly) и отдельным
//     токеном: он не мешает обычной синхронизации iLife (drive.file). Токен действует час; потом нужно нажать «Подтвердить доступ».
//   • Список песен, обложки альбомов и скачанные песни лежат на устройстве, в IndexedDB «ilife-music» (stores tracks, covers, audio).
//     Без интернета коллекция открывается; играть без сети можно скачанное.
//   • Избранное (песни, альбомы, исполнители, композиторы) — список musicFavs, он синхронизируется между устройствами через
//     общий файл iLife на Google Диске (G_LISTS в js/gdrive.js, ключ musicfav). Сама коллекция на каждом устройстве читается заново.
//
// Запись песни (tracks): { id (id файла на Диске), name, size, mod, sig (подпись для поиска изменений), ext, mime, path[] (папки), title, artist, album,
//   albumArtist, composer, genre, year, track, disc, dur (секунды), ak (ключ альбома), added }
// Запись избранного (musicFavs): { id: 't:<id песни>' | 'a:<ключ альбома>' | 'p:<исполнитель>' | 'c:<композитор>', name, updatedAt }
// =====================================================================================================

const MU_SCOPE = 'https://www.googleapis.com/auth/drive.readonly';
const MU_EXT_RE = /\.(mp3|m4a|m4b|aac|flac|ogg|oga|opus|wav)$/i;
const MU_COVER_NAME_RE = /^(cover|folder|front|album|albumart|artwork)\.(jpe?g|png|webp)$/i;
const MU_MIME = { mp3: 'audio/mpeg', m4a: 'audio/mp4', m4b: 'audio/mp4', aac: 'audio/aac', flac: 'audio/flac', ogg: 'audio/ogg', oga: 'audio/ogg', opus: 'audio/ogg', wav: 'audio/wav' };
const MU_TABS = [['songs', 'Песни', 'music_note'], ['albums', 'Альбомы', 'album'], ['artists', 'Исполнители', 'person'], ['composers', 'Композиторы', 'edit_note'], ['genres', 'Жанры', 'queue_music'], ['fav', 'Избранное', 'favorite']];
const MU_PAGE = 80;                    // сколько строк показываем сразу
const MU_FOLDER_MIME = 'application/vnd.google-apps.folder';

// ---------- Настройки на этом устройстве ----------
function muCfg() { return Object.assign({ folderId: '', folderName: '', auto: true, tempMB: 150, view: 'covers', tab: 'songs', sort: 'title', favTab: 'songs', last: 0 }, LS.get('mu_cfg', {})); }
function muCfgSave(patch) { const c = Object.assign(muCfg(), patch); LS.set('mu_cfg', c); return c; }

// ---------- Избранное (синхронизируется через Google Диск) ----------
let musicFavs = LS.get('musicfav', []);
if (!Array.isArray(musicFavs)) musicFavs = [];
function saveMusicFavs() { if (typeof cloudLocalChanged === 'function') cloudLocalChanged(); return LS.set('musicfav', musicFavs); }
function muFavChanged() { muFavRebuild(); if (typeof renderMusic === 'function' && $('#music') && $('#music').classList.contains('is-active')) renderMusic(); if (typeof muPlayerSync === 'function') muPlayerSync(); }
const muFavSet = new Set();
function muFavRebuild() { muFavSet.clear(); musicFavs.forEach(f => f && f.id && muFavSet.add(f.id)); }
const muIsFav = (kind, key) => muFavSet.has(kind + ':' + key);
function muToggleFav(kind, key, name) {
    const id = kind + ':' + key, i = musicFavs.findIndex(f => f.id === id);
    if (i >= 0) { musicFavs.splice(i, 1); toast('Убрано из избранного'); } else { musicFavs.push({ id, name: String(name || '').slice(0, 120), updatedAt: Date.now() }); toast('В избранном: ' + String(name || '').slice(0, 60)); }
    saveMusicFavs(); muFavRebuild(); muRefreshFavButtons(); if (muCfg().tab === 'fav') renderMusicBody(); if (typeof muPlayerSync === 'function') muPlayerSync();
}
function muRefreshFavButtons() {
    $$('#music [data-fav]').forEach(b => { const on = muFavSet.has(b.dataset.fav); b.classList.toggle('is-on', on); b.setAttribute('aria-pressed', on ? 'true' : 'false'); b.innerHTML = ic(on ? 'favorite' : 'favorite_border'); });
}

// ---------- Хранилище: IndexedDB «ilife-music» ----------
const MuDB = (function () {
    let dbp = null; const mem = { tracks: new Map(), covers: new Map(), audio: new Map() };
    function open() {
        if (dbp) return dbp;
        dbp = new Promise((resolve, reject) => {
            try {
                const r = indexedDB.open('ilife-music', 1);
                r.onupgradeneeded = () => { ['tracks', 'covers', 'audio'].forEach(n => r.result.createObjectStore(n, { keyPath: 'id' })); };
                r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); r.onblocked = () => reject(new Error('blocked'));
            } catch (e) { reject(e); }
        }).catch(() => null);
        return dbp;
    }
    function run(db, store, mode, fn) {
        return new Promise((resolve, reject) => {
            const t = db.transaction(store, mode); let r;
            try { r = fn(t.objectStore(store)); } catch (e) { reject(e); return; }
            t.oncomplete = () => resolve(r && 'result' in r ? r.result : undefined); t.onerror = () => reject(t.error); t.onabort = () => reject(t.error || new Error('abort'));
        });
    }
    return {
        async all(store) { const db = await open(); if (!db) return Array.from(mem[store].values()); try { return (await run(db, store, 'readonly', s => s.getAll())) || []; } catch (e) { return []; } },
        async get(store, id) { const db = await open(); if (!db) return mem[store].get(id) || null; try { return (await run(db, store, 'readonly', s => s.get(id))) || null; } catch (e) { return null; } },
        async put(store, rec) { const db = await open(); if (!db) { mem[store].set(rec.id, rec); return; } await run(db, store, 'readwrite', s => s.put(rec)); },
        async putMany(store, recs) { if (!recs.length) return; const db = await open(); if (!db) { recs.forEach(r => mem[store].set(r.id, r)); return; } await run(db, store, 'readwrite', s => { recs.forEach(r => s.put(r)); return null; }); },
        async del(store, id) { const db = await open(); if (!db) { mem[store].delete(id); return; } try { await run(db, store, 'readwrite', s => s.delete(id)); } catch (e) {} },
        async delMany(store, ids) { if (!ids.length) return; const db = await open(); if (!db) { ids.forEach(i => mem[store].delete(i)); return; } try { await run(db, store, 'readwrite', s => { ids.forEach(i => s.delete(i)); return null; }); } catch (e) {} },
        async clear(store) { const db = await open(); if (!db) { mem[store].clear(); return; } try { await run(db, store, 'readwrite', s => s.clear()); } catch (e) {} },
        async sizes(store) {   // Map id → размер, не читая сами файлы
            const db = await open(), out = new Map();
            if (!db) { mem[store].forEach((r, id) => out.set(id, Number(r.size) || 0)); return out; }
            return new Promise(resolve => {
                try { const req = db.transaction(store, 'readonly').objectStore(store).openCursor(); req.onsuccess = () => { const c = req.result; if (!c) { resolve(out); return; } out.set(c.key, Number(c.value.size) || 0); c.continue(); }; req.onerror = () => resolve(out); } catch (e) { resolve(out); }
            });
        }
    };
})();

// ---------- Состояние ----------
const mu = {
    tracks: [], by: new Map(), albums: new Map(), artists: new Map(), composers: new Map(), genres: new Map(),
    coverKeys: new Set(), covUrl: new Map(), offline: new Map(),   // offline: id песни → размер скачанного файла
    temp: new Map(), tempBytes: 0,                                  // временный кеш (только в памяти, пропадает при закрытии)
    loaded: false, scanning: false, scanInfo: null, q: '', detail: null, shown: MU_PAGE, ctxIds: [], lastErr: ''
};
const muNorm = s => String(s == null ? '' : s).toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim();
const muSplit = s => Array.from(new Set(String(s || '').split(/\s*[;]\s*/).map(x => x.trim()).filter(Boolean)));
const muTitle = t => t.title || t.name.replace(MU_EXT_RE, '');
const muArtist = t => t.artist || 'Неизвестный исполнитель';
const muAlbumName = t => t.album || 'Без альбома';
function muPlural(n, one, few, many) { const a = Math.abs(n) % 100, b = a % 10; return a > 10 && a < 20 ? many : b > 1 && b < 5 ? few : b === 1 ? one : many; }
const muSongsWord = n => n + ' ' + muPlural(n, 'песня', 'песни', 'песен');
function muFmtDur(sec) { sec = Math.round(Number(sec) || 0); if (sec <= 0) return ''; const h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60), s = sec % 60; return h ? h + ':' + pad2(m) + ':' + pad2(s) : m + ':' + pad2(s); }
function muFmtTotal(sec) { sec = Math.round(Number(sec) || 0); if (sec < 60) return ''; const h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60); return h ? h + ' ч ' + m + ' мин' : m + ' мин'; }
function muExt(name) { const m = String(name || '').match(/\.([A-Za-z0-9]+)$/); return m ? m[1].toLowerCase() : ''; }
function muAlbumKey(artist, album) { return muNorm(artist) + '|' + muNorm(album); }
function muByAlpha(a, b) { return String(a).localeCompare(String(b), 'ru', { sensitivity: 'base', numeric: true }); }

// Индексы: альбомы, исполнители, композиторы, жанры
function muBuild() {
    mu.by = new Map(); mu.albums = new Map(); mu.artists = new Map(); mu.composers = new Map(); mu.genres = new Map();
    const grp = (map, key, name) => { let g = map.get(key); if (!g) { g = { key, name, tracks: [], albums: new Set() }; map.set(key, g); } return g; };
    mu.tracks.forEach(t => {
        mu.by.set(t.id, t);
        let al = mu.albums.get(t.ak);
        if (!al) { al = { key: t.ak, title: muAlbumName(t), artist: t.albumArtist || t.artist || '', year: 0, tracks: [], artists: new Set() }; mu.albums.set(t.ak, al); }
        al.tracks.push(t); al.artists.add(muNorm(t.albumArtist || t.artist)); if (t.year && !al.year) al.year = t.year;
        muSplit(t.artist || 'Неизвестный исполнитель').forEach(n => { const g = grp(mu.artists, muNorm(n), n); g.tracks.push(t); g.albums.add(t.ak); });
        muSplit(t.composer).forEach(n => { const g = grp(mu.composers, muNorm(n), n); g.tracks.push(t); g.albums.add(t.ak); });
        muSplit(t.genre).forEach(n => { const g = grp(mu.genres, muNorm(n), n); g.tracks.push(t); g.albums.add(t.ak); });
    });
    mu.albums.forEach(al => {
        al.tracks.sort((a, b) => (a.disc || 1) - (b.disc || 1) || (a.track || 999) - (b.track || 999) || muByAlpha(muTitle(a), muTitle(b)));
        if (al.artists.size > 1 && !al.tracks.every(t => t.albumArtist)) al.artist = 'Разные исполнители';
        al.dur = al.tracks.reduce((s, t) => s + (t.dur || 0), 0);
    });
    [mu.artists, mu.composers, mu.genres].forEach(m => m.forEach(g => { g.dur = g.tracks.reduce((s, t) => s + (t.dur || 0), 0); }));
}
function muTrackSort(list, key) {
    const a = list.slice();
    if (key === 'artist') a.sort((x, y) => muByAlpha(muArtist(x), muArtist(y)) || muByAlpha(muTitle(x), muTitle(y)));
    else if (key === 'album') a.sort((x, y) => muByAlpha(muAlbumName(x), muAlbumName(y)) || (x.disc || 1) - (y.disc || 1) || (x.track || 999) - (y.track || 999));
    else if (key === 'added') a.sort((x, y) => (y.added || 0) - (x.added || 0) || muByAlpha(muTitle(x), muTitle(y)));
    else a.sort((x, y) => muByAlpha(muTitle(x), muTitle(y)));
    return a;
}

// ---------- Токен Google для чтения Диска (отдельный от токена синхронизации) ----------
let muToken = null, muTokenExp = 0;
(function () { const s = LS.get('mu_token', null); if (s && s.token && s.expiry > Date.now() + 60000) { muToken = s.token; muTokenExp = s.expiry; } })();
function muHasToken() { return !!muToken && muTokenExp > Date.now() + 60000; }
function muStoreToken(token, sec) { muToken = token; muTokenExp = Date.now() + (Number(sec) || 3600) * 1000; LS.set('mu_token', { token, expiry: muTokenExp }); }
function muDropToken() { muToken = null; muTokenExp = 0; LS.del('mu_token'); }
function muErr(code, message) { const e = new Error(message || code); e.code = code; return e; }
// Окно Google открывается только по нажатию: вызывайте прямо из обработчика кнопки
function muRequestToken() {
    return new Promise((resolve, reject) => {
        const blocked = typeof googleAuthBlockedReason === 'function' ? googleAuthBlockedReason() : '';
        if (blocked) { reject(muErr('blocked', blocked)); return; }
        if (!gisReady()) { loadGis(); reject(muErr('gis', 'Модуль входа Google ещё загружается — нажмите ещё раз через пару секунд')); return; }
        const client = google.accounts.oauth2.initTokenClient({
            client_id: googleClientId(), scope: MU_SCOPE, hint: typeof gUser !== 'undefined' && gUser ? gUser.email : undefined,
            callback: resp => {
                if (!resp || resp.error) { reject(muErr('denied', resp && (resp.error_description || resp.error))); return; }
                if (google.accounts.oauth2.hasGrantedAllScopes && !google.accounts.oauth2.hasGrantedAllScopes(resp, MU_SCOPE)) { reject(muErr('scope', 'Не выдан доступ к чтению Google Диска')); return; }
                muStoreToken(resp.access_token, resp.expires_in); resolve(resp.access_token);
            },
            error_callback: err => reject(muErr('popup', err && err.type))
        });
        client.requestAccessToken({ prompt: '' });
    });
}
function muErrText(e) {
    const c = e && e.code;
    if (c === 'popup') return 'Окно входа Google закрыто или заблокировано. Разрешите всплывающие окна для сайта и попробуйте снова.';
    if (c === 'scope') return 'В окне Google нужно отметить галочку доступа к просмотру файлов Google Диска.';
    if (c === 'denied') return 'Доступ не выдан' + (e.message && e.message !== 'denied' ? ' (' + e.message + ')' : '') + '. Если Google пишет «access_denied», добавьте право drive.readonly в «Data access» проекта (инструкция внизу «Настроек»).';
    if (c === 'auth') return 'Доступ к Google Диску истёк — нажмите «Подтвердить доступ».';
    if (c === 'api') return e.message;
    if (c === 'network') return 'Нет связи с Google Диском.';
    return e && e.message ? e.message : String(e);
}
async function muFetch(url, opts, attempt) {
    attempt = attempt || 0;
    if (!muHasToken()) throw muErr('auth');
    let res;
    try { res = await fetch(url, Object.assign({}, opts, { headers: Object.assign({}, opts && opts.headers, { Authorization: 'Bearer ' + muToken }) })); }
    catch (e) {
        if (e && e.name === 'AbortError') throw e;
        if (attempt < 2) { await new Promise(r => setTimeout(r, 700 * (attempt + 1))); return muFetch(url, opts, attempt + 1); }
        throw muErr('network', 'нет связи с Google');
    }
    if (res.status === 401) { muDropToken(); throw muErr('auth'); }
    if ((res.status === 429 || res.status >= 500) && attempt < 3) { await new Promise(r => setTimeout(r, 900 * (attempt + 1))); return muFetch(url, opts, attempt + 1); }
    if (!res.ok) {
        let detail = ''; try { detail = (await res.text()).slice(0, 400); } catch (e) {}
        if (res.status === 403 && /rateLimitExceeded|userRateLimitExceeded/i.test(detail) && attempt < 4) { await new Promise(r => setTimeout(r, 1200 * (attempt + 1))); return muFetch(url, opts, attempt + 1); }
        if (res.status === 403 && /accessNotConfigured|SERVICE_DISABLED|has not been used in project/i.test(detail)) throw muErr('api', 'В проекте Google Cloud не включён Google Drive API (APIs & Services → Library → Google Drive API → Enable).');
        if (res.status === 403 && /insufficient|SCOPE_INSUFFICIENT/i.test(detail)) throw muErr('scope', 'Не выдан доступ к чтению Google Диска');
        if (res.status === 404) throw muErr('notfound', 'Файл или папка не найдены (возможно, удалены или нет доступа)');
        throw muErr('http', 'Google Диск: HTTP ' + res.status + (detail ? ' — ' + detail.replace(/\s+/g, ' ').slice(0, 140) : ''));
    }
    return res;
}
async function muListAll(q, fields, orderBy, max) {
    const out = []; let page = '';
    do {
        const url = G_DRIVE_API + '/files?q=' + encodeURIComponent(q) + '&pageSize=1000&supportsAllDrives=true&includeItemsFromAllDrives=true' + (orderBy ? '&orderBy=' + encodeURIComponent(orderBy) : '') +
            '&fields=' + encodeURIComponent('nextPageToken,files(' + fields + ')') + (page ? '&pageToken=' + encodeURIComponent(page) : '');
        const j = await (await muFetch(url)).json();
        out.push(...(j.files || [])); page = j.nextPageToken || '';
    } while (page && out.length < (max || 20000));
    return out;
}
// Кусок файла [start, end) — для чтения тегов
async function muRange(id, start, end) {
    const res = await muFetch(G_DRIVE_API + '/files/' + encodeURIComponent(id) + '?alt=media&supportsAllDrives=true', { headers: { Range: 'bytes=' + start + '-' + (end - 1) } });
    const buf = new Uint8Array(await res.arrayBuffer());
    return res.status === 200 ? buf.subarray(start, end) : buf;   // сервер мог отдать файл целиком
}

// ---------- Загрузка коллекции с устройства ----------
async function muLoad() {
    mu.tracks = await MuDB.all('tracks');
    const covs = await MuDB.sizes('covers'); mu.coverKeys = new Set(covs.keys());
    mu.offline = await MuDB.sizes('audio');
    muFavRebuild(); muBuild(); mu.loaded = true;
}

// ---------- Обложки ----------
async function muCoverUrl(ak) {
    if (mu.covUrl.has(ak)) return mu.covUrl.get(ak);
    const rec = await MuDB.get('covers', ak), u = rec && rec.blob ? URL.createObjectURL(rec.blob) : '';
    mu.covUrl.set(ak, u); return u;
}
function muCoverHtml(ak, cls) { return '<span class="mu-cov' + (cls ? ' ' + cls : '') + '">' + ic('music_note') + (ak && mu.coverKeys.has(ak) ? '<img alt="" data-cov="' + esc(ak) + '">' : '') + '</span>'; }
function muHydrate(root) {
    (root || document).querySelectorAll('img[data-cov]').forEach(async im => {
        const u = await muCoverUrl(im.dataset.cov);
        if (u) im.src = u; else im.remove();
    });
}
// Обложка из байтов тега → JPEG 360 px
async function muMakeCover(bytes, mime) {
    const file = new Blob([bytes], { type: mime || 'image/jpeg' });
    const bmp = await decodeImage(file), s = bitmapSize(bmp);
    const r = await canvasBlob(bmp, s.w, s.h, 360, 0.82);
    if (bmp.close) try { bmp.close(); } catch (e) {}
    return r.blob || null;
}

// ---------- Разбор имени файла и папок (когда тегов нет) ----------
function muFromNames(f) {
    const base = f.name.replace(MU_EXT_RE, '').replace(/_/g, ' ').trim(), out = {};
    let m = base.match(/^(\d{1,3})\s*[-.)\s]\s*(.+)$/);
    let rest = base;
    if (m) { out.track = +m[1]; rest = m[2].trim(); }
    m = rest.match(/^(.+?)\s+[-–—]\s+(.+)$/);
    if (m) { out.artistGuess = m[1].trim(); out.title = m[2].trim(); } else out.title = rest;
    const p = f.path || [];
    if (p.length >= 1) out.albumGuess = p[p.length - 1];
    if (p.length >= 2) out.artistFolder = p[p.length - 2];
    return out;
}
function muBuildTrack(f, tags, old) {
    const g = muFromNames(f), t = tags || {};
    const clean = v => String(v || '').replace(/\s+/g, ' ').trim();
    const num = v => { const n = parseInt(String(v || '').split('/')[0], 10); return n > 0 ? n : 0; };
    const title = clean(t.title) || g.title, artist = clean(t.artist) || g.artistGuess || '';
    const album = clean(t.album) || g.albumGuess || '';
    const albumArtist = clean(t.albumArtist);
    return {
        id: f.id, name: f.name, size: Number(f.size) || 0, mod: f.modifiedTime || '', sig: f.sig, ext: muExt(f.name), mime: f.mimeType || '', path: f.path || [], folderId: f.folderId,
        title, artist, album, albumArtist, composer: clean(t.composer), genre: clean(t.genre).slice(0, 60), year: parseInt(String(t.year || '').slice(0, 4), 10) || 0,
        track: num(t.track) || g.track || 0, disc: num(t.disc), dur: Number(t.dur) || (old && old.dur) || 0,
        ak: muAlbumKey(albumArtist || artist, album), added: old && old.added || Date.now()
    };
}

// ---------- Синхронизация: обход папки, чтение тегов ----------
const muSig = f => (f.md5Checksum || f.modifiedTime || '') + '|' + (f.size || '');
async function muSync(o) {
    o = o || {};
    const cfg = muCfg();
    if (mu.scanning) return;
    if (!cfg.folderId) { if (!o.silent) toast('Сначала выберите папку с музыкой'); return; }
    if (!muHasToken()) { if (!o.silent) toast('Нужно подтвердить доступ к Google Диску'); renderMusicConnect(); return; }
    if (!navigator.onLine) { if (!o.silent) toast('Нет интернета — коллекция обновится позже'); return; }
    mu.scanning = true; mu.lastErr = ''; mu.scanInfo = { phase: 'folders', folders: 0, files: 0, read: 0, total: 0 }; renderMusicConnect();
    try {
        // 1) обход папок (по 4 одновременно)
        const files = [], coverImgs = new Map(), queue = [{ id: cfg.folderId, path: [] }];
        let active = 0, failure = null;
        await new Promise((resolve, reject) => {
            const pump = () => {
                if (failure) { if (!active) reject(failure); return; }
                while (active < 4 && queue.length) {
                    const fo = queue.shift(); active++;
                    muListAll("'" + fo.id + "' in parents and trashed = false", 'id,name,mimeType,size,modifiedTime,md5Checksum', 'name').then(list => {
                        mu.scanInfo.folders++;
                        list.forEach(f => {
                            if (f.mimeType === MU_FOLDER_MIME) queue.push({ id: f.id, path: fo.path.concat(f.name) });
                            else if ((/^audio\//.test(f.mimeType || '') && !/wma/i.test(f.mimeType) || MU_EXT_RE.test(f.name)) && !/^application\/vnd\.google-apps/.test(f.mimeType || '') && (Number(f.size) || 0) > 1024) {
                                files.push({ id: f.id, name: f.name, size: f.size, modifiedTime: f.modifiedTime, mimeType: f.mimeType, md5Checksum: f.md5Checksum, path: fo.path, folderId: fo.id, sig: muSig(f) });
                            } else if (MU_COVER_NAME_RE.test(f.name) && (Number(f.size) || 0) < 3 * 1048576 && !coverImgs.has(fo.id)) coverImgs.set(fo.id, f.id);
                        });
                        mu.scanInfo.files = files.length; renderMusicConnect();
                    }).catch(e => { failure = failure || e; }).then(() => { active--; if (!queue.length && !active) { failure ? reject(failure) : resolve(); } else pump(); });
                }
                if (!queue.length && !active && !failure) resolve();
            };
            pump();
        });
        // 2) что изменилось
        const have = new Map(mu.tracks.map(t => [t.id, t])), seen = new Set(files.map(f => f.id));
        const todo = files.filter(f => { const t = have.get(f.id); return !t || t.sig !== f.sig; });
        const gone = mu.tracks.filter(t => !seen.has(t.id)).map(t => t.id);
        mu.scanInfo = { phase: 'tags', folders: mu.scanInfo.folders, files: files.length, read: 0, total: todo.length }; renderMusicConnect();
        // 3) теги и обложки
        const fresh = new Map(), newCovers = [], pendingCover = new Map();   // pendingCover: ключ альбома → id картинки в папке
        let next = 0;
        const worker = async () => {
            while (next < todo.length) {
                const f = todo[next++];
                try {
                    const guess = muFromNames(f);
                    const needCover = tags => { const ak = muAlbumKey(tags.albumArtist || tags.artist || guess.artistGuess, tags.album || guess.albumGuess); return !mu.coverKeys.has(ak) && !newCovers.some(c => c.id === ak); };
                    const tags = await mtReadTags((s, e) => muRange(f.id, s, e), Number(f.size) || 0, muExt(f.name), needCover);
                    const tr = muBuildTrack(f, tags, have.get(f.id));
                    fresh.set(f.id, tr);
                    if (tags.cover && !mu.coverKeys.has(tr.ak) && !newCovers.some(c => c.id === tr.ak)) {
                        try { const blob = await muMakeCover(tags.cover.bytes, tags.cover.mime); if (blob) newCovers.push({ id: tr.ak, blob, size: blob.size }); } catch (e) { /* без обложки */ }
                    }
                    if (!mu.coverKeys.has(tr.ak) && !newCovers.some(c => c.id === tr.ak) && coverImgs.has(f.folderId)) pendingCover.set(tr.ak, coverImgs.get(f.folderId));
                } catch (e) {
                    if (e && (e.code === 'auth' || e.code === 'scope')) throw e;
                    fresh.set(f.id, muBuildTrack(f, null, have.get(f.id)));   // файл без читаемых тегов — берём названия из имени
                }
                mu.scanInfo.read++; if (mu.scanInfo.read % 5 === 0) renderMusicConnect();
            }
        };
        await Promise.all([worker(), worker(), worker(), worker()]);
        // обложки из файлов cover.jpg / folder.jpg (если в тегах их не было)
        for (const [ak, imgId] of pendingCover) {
            if (newCovers.some(c => c.id === ak)) continue;
            try {
                const res = await muFetch(G_DRIVE_API + '/files/' + encodeURIComponent(imgId) + '?alt=media&supportsAllDrives=true');
                const blob = await muMakeCover(new Uint8Array(await res.arrayBuffer()), '');
                if (blob) newCovers.push({ id: ak, blob, size: blob.size });
            } catch (e) { if (e && e.code === 'auth') throw e; }
        }
        // 4) сохраняем
        const keep = mu.tracks.filter(t => seen.has(t.id) && !fresh.has(t.id));
        const all = keep.concat(Array.from(fresh.values()));
        await MuDB.putMany('tracks', Array.from(fresh.values()));
        await MuDB.delMany('tracks', gone);
        await MuDB.putMany('covers', newCovers); newCovers.forEach(c => { mu.coverKeys.add(c.id); mu.covUrl.delete(c.id); });
        if (gone.length) { await MuDB.delMany('audio', gone.filter(id => mu.offline.has(id))); gone.forEach(id => { mu.offline.delete(id); }); }
        mu.tracks = all; muBuild();
        // обложки, на которые больше не ссылается ни один альбом
        const live = new Set(all.map(t => t.ak)), dead = Array.from(mu.coverKeys).filter(k => !live.has(k));
        if (dead.length) { await MuDB.delMany('covers', dead); dead.forEach(k => { mu.coverKeys.delete(k); mu.covUrl.delete(k); }); }
        muCfgSave({ last: Date.now() });
        if (!o.silent || todo.length || gone.length) toast(todo.length || gone.length ? 'Коллекция обновлена: ' + muSongsWord(all.length) + (todo.length ? ', новых и изменённых: ' + todo.length : '') + (gone.length ? ', убрано: ' + gone.length : '') : 'Коллекция актуальна: ' + muSongsWord(all.length));
    } catch (e) {
        console.warn('Синхронизация музыки', e);
        mu.lastErr = muErrText(e);
        if (!o.silent || (e && e.code !== 'auth')) toast('Не удалось обновить коллекцию: ' + mu.lastErr, { ms: 6000 });
    }
    mu.scanning = false; mu.scanInfo = null;
    renderMusic();
}

// ---------- Выбор папки на Google Диске ----------
function muFolderIdFromText(s) {
    s = String(s || '').trim();
    let m = s.match(/\/folders\/([A-Za-z0-9_-]{10,})/) || s.match(/[?&]id=([A-Za-z0-9_-]{10,})/);
    if (m) return m[1];
    return /^[A-Za-z0-9_-]{20,}$/.test(s) ? s : '';
}
async function muEnsureAccess() {   // вызывать из обработчика нажатия
    if (muHasToken()) return true;
    try { await muRequestToken(); return true; }
    catch (e) { gExplain('Нужен доступ к Google Диску', muErrText(e)); return false; }
}
async function muPickFolder() {
    if (!googleClientId()) { gExplain('Сначала подключите вход Google', 'Музыка читается с вашего Google Диска. Откройте «Настройки → Google Диск» и вставьте Client ID — тот же, что для синхронизации. Шаги — в блоке «Сайты и инструкции» внизу «Настроек».'); return; }
    if (!(await muEnsureAccess())) { renderMusicConnect(); return; }
    renderMusicConnect();
    const stack = [{ id: 'root', name: 'Мой диск' }]; let chosen = null;
    const sheet = openSheet({
        title: 'Папка с музыкой',
        html: '<p class="hint" style="margin:0 4px 0.5rem">Откройте папку с музыкой (вместе с вложенными папками) и нажмите «Выбрать эту папку». Можно вставить ссылку на папку.</p>' +
            '<div class="mu-link"><input type="text" id="mu-pk-link" placeholder="Ссылка на папку Google Диска" aria-label="Ссылка на папку"><button type="button" class="btn" id="mu-pk-go">Открыть</button></div>' +
            '<div class="mu-crumbs" id="mu-pk-crumbs"></div><div id="mu-pk-list" class="mu-pk-list"></div>',
        actions: [{ label: 'Отмена' }, { label: 'Выбрать эту папку', kind: 'primary', icon: 'check', async onClick() {
            const cur = stack[stack.length - 1];
            if (cur.id === 'root' || cur.id === 'shared') { toast('Откройте нужную папку и нажмите снова'); return false; }
            chosen = cur;
            const changed = cur.id !== muCfg().folderId;
            muCfgSave({ folderId: cur.id, folderName: cur.name });
            if (changed) { mu.tracks = []; await MuDB.clear('tracks'); await MuDB.clear('covers'); mu.coverKeys.clear(); mu.covUrl.clear(); muBuild(); }
            renderMusic(); muSync();
        } }]
    });
    const crumbs = $('#mu-pk-crumbs', sheet.el), list = $('#mu-pk-list', sheet.el);
    const paint = async () => {
        const cur = stack[stack.length - 1];
        crumbs.innerHTML = stack.map((s, i) => '<button type="button" class="chip' + (i === stack.length - 1 ? ' is-on' : '') + '" data-i="' + i + '">' + esc(s.name) + '</button>').join('');
        list.innerHTML = '<div class="mv-res-state">' + ic('search') + '<span>Читаем папки…</span></div>';
        try {
            const folders = await muListAll(cur.id === 'shared' ? "sharedWithMe = true and mimeType = '" + MU_FOLDER_MIME + "' and trashed = false" : "'" + cur.id + "' in parents and mimeType = '" + MU_FOLDER_MIME + "' and trashed = false", 'id,name', 'name', 2000);
            if (stack[stack.length - 1] !== cur) return;
            let h = cur.id === 'root' ? '<button type="button" class="mu-pk-row" data-id="shared" data-name="Доступные мне">' + ic('groups') + '<span>Доступные мне</span></button>' : '';
            h += folders.map(f => '<button type="button" class="mu-pk-row" data-id="' + esc(f.id) + '" data-name="' + esc(f.name) + '">' + ic('folder') + '<span>' + esc(f.name) + '</span></button>').join('');
            list.innerHTML = h || '<div class="mv-res-state">' + ic('folder_open') + '<span>В этой папке нет вложенных папок. Если музыка лежит здесь — нажмите «Выбрать эту папку».</span></div>';
        } catch (e) { list.innerHTML = '<div class="mv-res-state is-error">' + ic('warning') + '<span>' + esc(muErrText(e)) + '</span></div>'; }
    };
    sheet.el.addEventListener('click', async e => {
        const c = e.target.closest('#mu-pk-crumbs .chip'), r = e.target.closest('.mu-pk-row'), go = e.target.closest('#mu-pk-go');
        if (c) { stack.length = +c.dataset.i + 1; paint(); }
        else if (r) { stack.push({ id: r.dataset.id, name: r.dataset.name }); paint(); }
        else if (go) {
            const id = muFolderIdFromText($('#mu-pk-link', sheet.el).value);
            if (!id) { toast('Не удалось найти номер папки в ссылке'); return; }
            try { const f = await (await muFetch(G_DRIVE_API + '/files/' + encodeURIComponent(id) + '?fields=id,name,mimeType&supportsAllDrives=true')).json(); if (f.mimeType !== MU_FOLDER_MIME) { toast('Это не папка'); return; } stack.length = 1; stack.push({ id: f.id, name: f.name }); paint(); }
            catch (err) { toast(muErrText(err)); }
        }
    });
    paint();
}

// ---------- Показ страницы ----------
function muSearchTokens() { return muNorm(mu.q).split(' ').filter(Boolean); }
function muMatch(hay, toks) { const h = muNorm(hay); return toks.every(t => h.includes(t)); }
function muTrackHay(t) { return [muTitle(t), t.artist, t.album, t.albumArtist, t.composer, t.genre, t.name].join(' '); }

function muSongRow(t, o) {
    o = o || {};
    const now = typeof mp !== 'undefined' && mp.cur && mp.cur.id === t.id, off = mu.offline.has(t.id), fav = muIsFav('t', t.id), d = muFmtDur(t.dur);
    const sub = muArtist(t) + (o.noAlbum ? '' : ' · ' + muAlbumName(t));
    return '<div class="mu-song' + (o.covers ? '' : ' is-plain') + (now ? ' is-now' : '') + '" data-id="' + esc(t.id) + '">' +
        '<button type="button" class="mu-song-main" data-mu="play" aria-label="Играть: ' + esc(muTitle(t)) + '">' +
        (o.covers ? muCoverHtml(t.ak, 'sm') : '<span class="mu-num">' + (o.num ? o.num : ic('music_note')) + '</span>') +
        '<span class="mu-song-tx"><b>' + esc(muTitle(t)) + '</b><span>' + esc(sub) + '</span></span></button>' +
        '<span class="mu-song-meta">' + (off ? '<span class="mu-off" title="Скачано на устройство">' + ic('cloud_done') + '</span>' : '') + (d ? '<span class="mu-dur">' + d + '</span>' : '') + '</span>' +
        '<button type="button" class="icon-btn mu-fav' + (fav ? ' is-on' : '') + '" data-mu="fav" data-fav="t:' + esc(t.id) + '" aria-pressed="' + fav + '" aria-label="В избранное">' + ic(fav ? 'favorite' : 'favorite_border') + '</button>' +
        '<button type="button" class="icon-btn" data-mu="more" aria-label="Ещё">' + ic('more_vert') + '</button></div>';
}
function muSongsHtml(list, o) {
    o = o || {}; const covers = muCfg().view === 'covers', shown = list.slice(0, mu.shown);
    mu.ctxIds = list.map(t => t.id);
    return '<div class="mu-rows">' + shown.map((t, i) => muSongRow(t, { covers, noAlbum: o.noAlbum, num: o.numbered ? (t.track || i + 1) : 0 })).join('') + '</div>' +
        (list.length > shown.length ? '<div class="mu-more"><button type="button" class="btn" data-mu="more-rows">Показать ещё (' + (list.length - shown.length) + ')</button></div>' : '');
}
// Карточки групп (альбомы, исполнители, композиторы, жанры): с обложками — сеткой, без — списком
function muGroupCard(kind, g, covers) {
    const fav = muIsFav(kind === 'album' ? 'a' : kind === 'artist' ? 'p' : 'c', g.key);
    const ak = kind === 'album' ? g.key : (g.tracks.find(t => mu.coverKeys.has(t.ak)) || g.tracks[0] || {}).ak;
    const sub = kind === 'album' ? [g.artist, g.year || '', muSongsWord(g.tracks.length)].filter(Boolean).join(' · ') : [muSongsWord(g.tracks.length), g.albums && g.albums.size > 1 ? g.albums.size + ' ' + muPlural(g.albums.size, 'альбом', 'альбома', 'альбомов') : ''].filter(Boolean).join(' · ');
    const title = kind === 'album' ? g.title : g.name, round = kind === 'artist' || kind === 'composer';
    const favKind = kind === 'album' ? 'a' : kind === 'artist' ? 'p' : kind === 'composer' ? 'c' : '';
    if (covers) return '<div class="mu-card" data-kind="' + kind + '" data-key="' + esc(g.key) + '"><button type="button" class="mu-card-main" data-mu="open">' + muCoverHtml(ak, 'lg' + (round ? ' round' : '')) +
        '<b>' + esc(title) + '</b><span>' + esc(sub) + '</span></button>' + (favKind ? '<button type="button" class="icon-btn mu-card-fav' + (fav ? ' is-on' : '') + '" data-mu="fav-group" data-fav="' + favKind + ':' + esc(g.key) + '" aria-pressed="' + fav + '" aria-label="В избранное">' + ic(fav ? 'favorite' : 'favorite_border') + '</button>' : '') + '</div>';
    return '<div class="mu-song is-plain" data-kind="' + kind + '" data-key="' + esc(g.key) + '"><button type="button" class="mu-song-main" data-mu="open"><span class="mu-num">' + ic(kind === 'album' ? 'album' : kind === 'genre' ? 'queue_music' : 'person') + '</span>' +
        '<span class="mu-song-tx"><b>' + esc(title) + '</b><span>' + esc(sub) + '</span></span></button>' +
        (favKind ? '<button type="button" class="icon-btn mu-fav' + (fav ? ' is-on' : '') + '" data-mu="fav-group" data-fav="' + favKind + ':' + esc(g.key) + '" aria-pressed="' + fav + '" aria-label="В избранное">' + ic(fav ? 'favorite' : 'favorite_border') + '</button>' : '') +
        '<span class="mu-chev">' + ic('chevron_right') + '</span></div>';
}
function muGroupsHtml(kind, groups) {
    const covers = muCfg().view === 'covers' && kind !== 'genre', shown = groups.slice(0, mu.shown);
    return '<div class="' + (covers ? 'mu-grid' : 'mu-rows') + '">' + shown.map(g => muGroupCard(kind, g, covers)).join('') + '</div>' +
        (groups.length > shown.length ? '<div class="mu-more"><button type="button" class="btn" data-mu="more-rows">Показать ещё (' + (groups.length - shown.length) + ')</button></div>' : '');
}
function muSortGroups(list, kind, sort) {
    const a = list.slice(), nm = g => kind === 'album' ? g.title : g.name;
    if (sort === 'count') a.sort((x, y) => y.tracks.length - x.tracks.length || muByAlpha(nm(x), nm(y)));
    else if (sort === 'artist' && kind === 'album') a.sort((x, y) => muByAlpha(x.artist, y.artist) || muByAlpha(x.title, y.title));
    else if (sort === 'year' && kind === 'album') a.sort((x, y) => (y.year || 0) - (x.year || 0) || muByAlpha(x.title, y.title));
    else a.sort((x, y) => muByAlpha(nm(x), nm(y)));
    return a;
}
function muFilterGroups(map, kind, toks) {
    let list = Array.from(map.values());
    if (toks.length) list = list.filter(g => muMatch(kind === 'album' ? g.title + ' ' + g.artist : g.name, toks));
    return list;
}
const MU_SORTS = {
    songs: [['title', 'По названию'], ['artist', 'По исполнителю'], ['album', 'По альбому'], ['added', 'Недавно добавленные']],
    albums: [['title', 'По названию'], ['artist', 'По исполнителю'], ['year', 'По году'], ['count', 'По числу песен']],
    other: [['title', 'А–Я'], ['count', 'По числу песен']]
};
function muPlayAllBar(ids, label) {
    return '<div class="mu-actions"><button type="button" class="btn btn-primary" data-mu="play-all">' + ic('play_arrow') + 'Играть' + (label || '') + '</button><button type="button" class="btn" data-mu="shuffle-all">' + ic('shuffle') + 'Перемешать</button></div>';
}

function muDetailHtml() {
    const d = mu.detail, covers = muCfg().view === 'covers';
    let g, tracks, head = '', kind = d.kind;
    if (kind === 'album') {
        g = mu.albums.get(d.key); if (!g) return '';
        tracks = g.tracks;
        head = muCoverHtml(g.key, 'xl') + '<div class="mu-dh-tx"><h2>' + esc(g.title) + '</h2><p>' + esc([g.artist, g.year || ''].filter(Boolean).join(' · ')) + '</p><p>' + esc([muSongsWord(tracks.length), muFmtTotal(g.dur)].filter(Boolean).join(' · ')) + '</p></div>';
    } else {
        const map = kind === 'artist' ? mu.artists : kind === 'composer' ? mu.composers : mu.genres; g = map.get(d.key); if (!g) return '';
        tracks = muTrackSort(g.tracks, 'album');
        const ak = (g.tracks.find(t => mu.coverKeys.has(t.ak)) || g.tracks[0]).ak;
        head = muCoverHtml(ak, 'xl' + (kind === 'genre' ? '' : ' round')) + '<div class="mu-dh-tx"><h2>' + esc(g.name) + '</h2><p>' + esc(kind === 'artist' ? 'Исполнитель' : kind === 'composer' ? 'Композитор' : 'Жанр') + '</p><p>' + esc([muSongsWord(tracks.length), muFmtTotal(g.dur)].filter(Boolean).join(' · ')) + '</p></div>';
    }
    const favKind = kind === 'album' ? 'a' : kind === 'artist' ? 'p' : kind === 'composer' ? 'c' : '', fid = favKind + ':' + g.key;
    const albumsHtml = kind === 'artist' || kind === 'composer' ? (() => {
        const al = Array.from(g.albums).map(k => mu.albums.get(k)).filter(Boolean).sort((a, b) => (b.year || 0) - (a.year || 0) || muByAlpha(a.title, b.title));
        return al.length > 1 ? '<h3 class="mu-h">Альбомы</h3>' + '<div class="' + (covers ? 'mu-grid' : 'mu-rows') + '">' + al.map(a => muGroupCard('album', a, covers)).join('') + '</div>' : '';
    })() : '';
    const toks = muSearchTokens(); if (toks.length) tracks = tracks.filter(t => muMatch(muTrackHay(t), toks));
    return '<div class="mu-detail"><button type="button" class="btn btn-text mu-back" data-mu="back">' + ic('arrow_back') + 'Назад</button>' +
        '<div class="mu-dh">' + head + '</div>' +
        '<div class="mu-actions"><button type="button" class="btn btn-primary" data-mu="play-all">' + ic('play_arrow') + 'Играть</button><button type="button" class="btn" data-mu="shuffle-all">' + ic('shuffle') + 'Перемешать</button>' +
        (favKind ? '<button type="button" class="btn mu-fav-btn' + (muFavSet.has(fid) ? ' is-on' : '') + '" data-mu="fav-detail" data-fav="' + esc(fid) + '" aria-pressed="' + muFavSet.has(fid) + '">' + ic(muFavSet.has(fid) ? 'favorite' : 'favorite_border') + 'В избранное</button>' : '') +
        (tracks.length && tracks.every(t => mu.offline.has(t.id)) ? '<button type="button" class="btn" data-mu="rm-detail">' + ic('cloud_done') + 'На устройстве · удалить</button>' : '<button type="button" class="btn" data-mu="dl-detail">' + ic('cloud_download') + 'Скачать</button>') + '</div>' +
        albumsHtml + (albumsHtml ? '<h3 class="mu-h">Песни</h3>' : '') +
        muSongsHtml(tracks, { noAlbum: kind === 'album', numbered: kind === 'album' }) + '</div>';
}

function renderMusicConnect() {
    const box = $('#mu-connect'); if (!box) return;
    const cfg = muCfg();
    const sync = $('#mu-sync'); if (sync) { sync.disabled = mu.scanning; sync.classList.toggle('is-spin', mu.scanning); }
    let h = '';
    if (mu.scanning && mu.scanInfo) {
        const i = mu.scanInfo, pct = i.phase === 'tags' && i.total ? Math.round(i.read / i.total * 100) : 0;
        h = '<div class="mu-note is-busy">' + ic('sync') + '<div class="tx"><b>' + (i.phase === 'folders' ? 'Ищем песни в папке…' : 'Читаем теги и обложки…') + '</b><span>' +
            (i.phase === 'folders' ? 'Папок просмотрено: ' + i.folders + ' · найдено песен: ' + i.files : 'Готово ' + i.read + ' из ' + i.total + ' · всего песен в папке: ' + i.files) + '</span>' +
            (i.phase === 'tags' ? '<div class="mu-prog"><i style="width:' + pct + '%"></i></div>' : '') + '</div></div>';
    } else if (!googleClientId()) {
        h = '<div class="mu-note">' + ic('key') + '<div class="tx"><b>Сначала подключите вход Google</b><span>Музыка читается с вашего Google Диска: в «Настройках → Google Диск» нужен Client ID.</span></div>' +
            '<button type="button" class="btn btn-primary" data-mu="settings">' + ic('settings') + 'Настройки</button></div>';
    } else if (!cfg.folderId) {
        h = '<div class="mu-note">' + ic('folder_open') + '<div class="tx"><b>Выберите папку с музыкой</b><span>Укажите папку на Google Диске — приложение соберёт из неё коллекцию: песни, альбомы, исполнителей и композиторов.</span></div>' +
            '<button type="button" class="btn btn-primary" data-mu="pick">' + ic('folder_open') + 'Выбрать папку</button>' +
            '<p class="instr-row"><button type="button" class="linkbtn instr-link" data-instr="instr-music">' + ic('help') + 'Инструкция</button></p></div>';
    } else if (!muHasToken()) {
        h = '<div class="mu-note">' + ic('lock') + '<div class="tx"><b>Подтвердите доступ к Google Диску</b><span>Папка «' + esc(cfg.folderName) + '». Доступ только на чтение, действует час. Скачанные песни играют и без него.' + (mu.lastErr ? ' ' + esc(mu.lastErr) : '') + '</span></div>' +
            '<button type="button" class="btn btn-primary" data-mu="auth">' + ic('lock_open') + 'Подтвердить доступ</button>' +
            '<p class="instr-row"><button type="button" class="linkbtn instr-link" data-instr="instr-music">' + ic('help') + 'Инструкция</button></p></div>';
    } else if (mu.lastErr) {
        h = '<div class="mu-note is-error">' + ic('warning') + '<div class="tx"><b>Не удалось обновить</b><span>' + esc(mu.lastErr) + '</span></div><button type="button" class="btn" data-mu="sync">' + ic('refresh') + 'Ещё раз</button></div>';
    }
    box.innerHTML = h;
    const sub = $('#mu-sub');
    if (sub) sub.textContent = cfg.folderId ? 'Папка «' + cfg.folderName + '» · ' + muSongsWord(mu.tracks.length) + (cfg.last ? ' · обновлено ' + fmtDate(cfg.last) + ', ' + fmtTime(cfg.last) : '') : '';
}
function renderMusicTabs() {
    const cfg = muCfg(), host = $('#mu-tabs'); if (!host) return;
    const cnt = { songs: mu.tracks.length, albums: mu.albums.size, artists: mu.artists.size, composers: mu.composers.size, genres: mu.genres.size, fav: musicFavs.length };
    host.innerHTML = MU_TABS.map(t => '<button type="button" class="chip' + (!mu.detail && cfg.tab === t[0] ? ' is-on' : '') + '" data-tab-mu="' + t[0] + '">' + ic(t[2]) + t[1] + (cnt[t[0]] ? ' <small>' + cnt[t[0]] + '</small>' : '') + '</button>').join('');
    const bar = $('#mu-bar'); if (!bar) return;
    bar.hidden = !mu.tracks.length; host.hidden = !mu.tracks.length;
    const add = $('#mu-add'); if (add) add.hidden = !mu.tracks.length;
    $$('#mu-view button').forEach(b => { const on = b.dataset.view === cfg.view; b.classList.toggle('is-on', on); b.setAttribute('aria-pressed', on ? 'true' : 'false'); });
    const sortSel = $('#mu-sort'), opts = MU_SORTS[cfg.tab === 'songs' ? 'songs' : cfg.tab === 'albums' ? 'albums' : 'other'];
    sortSel.hidden = !!mu.detail || cfg.tab === 'fav';
    sortSel.innerHTML = opts.map(o => '<option value="' + o[0] + '">' + o[1] + '</option>').join('');
    sortSel.value = opts.some(o => o[0] === cfg.sort) ? cfg.sort : opts[0][0];
}
function renderMusicBody() {
    const body = $('#mu-body'); if (!body) return;
    const cfg = muCfg();
    if (!mu.tracks.length) {
        body.innerHTML = mu.scanning ? '' : '<div class="empty"><div class="ico-big">' + ic('library_music') + '</div><b>' + (cfg.folderId ? 'В папке пока нет песен' : 'Коллекция пуста') + '</b>' +
            (cfg.folderId ? 'Нажмите «Обновить» вверху: приложение найдёт MP3, M4A, FLAC, OGG и WAV в папке «' + esc(cfg.folderName) + '».' : 'Выберите папку с музыкой на Google Диске — песни появятся здесь.') + '</div>';
        return;
    }
    if (mu.detail) { body.innerHTML = muDetailHtml() || ''; if (!body.innerHTML) { mu.detail = null; return renderMusicBody(); } muHydrate(body); return; }
    const toks = muSearchTokens(); let h = '';
    if (cfg.tab === 'songs') {
        let list = mu.tracks; if (toks.length) list = list.filter(t => muMatch(muTrackHay(t), toks));
        list = muTrackSort(list, cfg.sort);
        h = (list.length ? muPlayAllBar() + muSongsHtml(list) : '<div class="mu-empty">' + ic('search') + '<span>Ничего не нашлось.</span></div>');
    } else if (cfg.tab === 'albums' || cfg.tab === 'artists' || cfg.tab === 'composers' || cfg.tab === 'genres') {
        const kind = { albums: 'album', artists: 'artist', composers: 'composer', genres: 'genre' }[cfg.tab], map = mu[cfg.tab];
        const list = muSortGroups(muFilterGroups(map, kind, toks), kind, cfg.sort);
        h = list.length ? muGroupsHtml(kind, list) : '<div class="mu-empty">' + ic(map.size ? 'search' : 'info') + '<span>' + (map.size ? 'Ничего не нашлось.' : cfg.tab === 'composers' ? 'В тегах песен не указаны композиторы.' : cfg.tab === 'genres' ? 'В тегах песен не указаны жанры.' : 'Пусто.') + '</span></div>';
    } else if (cfg.tab === 'fav') {
        const ft = cfg.favTab || 'songs';
        const favT = mu.tracks.filter(t => muFavSet.has('t:' + t.id)), favA = Array.from(mu.albums.values()).filter(a => muFavSet.has('a:' + a.key)),
            favP = Array.from(mu.artists.values()).filter(a => muFavSet.has('p:' + a.key)), favC = Array.from(mu.composers.values()).filter(a => muFavSet.has('c:' + a.key));
        const sub = [['songs', 'Песни', favT.length], ['albums', 'Альбомы', favA.length], ['artists', 'Исполнители', favP.length], ['composers', 'Композиторы', favC.length]];
        h = '<div class="chips mu-subtabs">' + sub.map(s => '<button type="button" class="chip' + (ft === s[0] ? ' is-on' : '') + '" data-fav-tab="' + s[0] + '">' + s[1] + (s[2] ? ' <small>' + s[2] + '</small>' : '') + '</button>').join('') + '</div>';
        if (ft === 'songs') { let l = favT; if (toks.length) l = l.filter(t => muMatch(muTrackHay(t), toks)); l = muTrackSort(l, 'title'); h += l.length ? muPlayAllBar() + muSongsHtml(l) : muFavEmpty('песни'); }
        else { const kind = { albums: 'album', artists: 'artist', composers: 'composer' }[ft], l0 = { albums: favA, artists: favP, composers: favC }[ft], l = muSortGroups(toks.length ? l0.filter(g => muMatch(kind === 'album' ? g.title + ' ' + g.artist : g.name, toks)) : l0, kind, 'title'); h += l.length ? muGroupsHtml(kind, l) : muFavEmpty(ft === 'albums' ? 'альбомы' : ft === 'artists' ? 'исполнителей' : 'композиторов'); }
    }
    body.innerHTML = h; muHydrate(body);
}
function muFavEmpty(what) { return '<div class="mu-empty">' + ic('favorite_border') + '<span>Здесь будут ваши избранные ' + what + '. Нажмите сердечко рядом с любой записью.</span></div>'; }

function renderMusic() {
    if (!$('#music')) return;
    renderMusicConnect(); renderMusicTabs(); renderMusicBody();
    if (typeof renderMusicCache === 'function') renderMusicCache();
    if (typeof muPlayerSync === 'function') muPlayerSync();
}

// ---------- События страницы ----------
function muOpenGroup(kind, key) { mu.detail = { kind, key }; mu.shown = MU_PAGE; renderMusicTabs(); renderMusicBody(); window.scrollTo({ top: 0, behavior: 'auto' }); }
function muDetailName() {
    const d = mu.detail; if (!d) return '';
    if (d.kind === 'album') return (mu.albums.get(d.key) || {}).title || '';
    const m = d.kind === 'artist' ? mu.artists : d.kind === 'composer' ? mu.composers : mu.genres; return (m.get(d.key) || {}).name || '';
}
function muGroupTracks(kind, key) {
    if (kind === 'album') { const a = mu.albums.get(key); return a ? a.tracks : []; }
    const m = kind === 'artist' ? mu.artists : kind === 'composer' ? mu.composers : mu.genres, g = m.get(key);
    return g ? (kind === 'genre' ? muTrackSort(g.tracks, 'artist') : muTrackSort(g.tracks, 'album')) : [];
}
function initMusic() {
    if (!$('#music')) return;
    muLoad().then(() => { renderMusic(); if (typeof muPlayerBoot === 'function') muPlayerBoot(); });
    const root = $('#music');
    const si = $('#mu-search');
    si.addEventListener('input', debounce(() => { mu.q = si.value; mu.shown = MU_PAGE; $('#mu-search-clear').hidden = !si.value; renderMusicBody(); }, 200));
    $('#mu-search-clear').addEventListener('click', () => { si.value = ''; mu.q = ''; $('#mu-search-clear').hidden = true; renderMusicBody(); });
    $('#mu-tabs').addEventListener('click', e => { const b = e.target.closest('[data-tab-mu]'); if (!b) return; mu.detail = null; mu.shown = MU_PAGE; muCfgSave({ tab: b.dataset.tabMu }); renderMusicTabs(); renderMusicBody(); });
    $('#mu-view').addEventListener('click', e => { const b = e.target.closest('[data-view]'); if (!b) return; muCfgSave({ view: b.dataset.view === 'list' ? 'list' : 'covers' }); mu.shown = MU_PAGE; renderMusicTabs(); renderMusicBody(); });
    $('#mu-sort').addEventListener('change', e => { muCfgSave({ sort: e.target.value }); mu.shown = MU_PAGE; renderMusicBody(); });
    $('#mu-sync').addEventListener('click', async () => { if (!muHasToken() && !(await muEnsureAccess())) { renderMusicConnect(); return; } muSync(); });
    $('#mu-menu').addEventListener('click', () => muOpenSettings());
    root.addEventListener('click', async e => {
        const fav = e.target.closest('[data-fav-tab]');
        if (fav) { muCfgSave({ favTab: fav.dataset.favTab }); mu.shown = MU_PAGE; renderMusicBody(); return; }
        const b = e.target.closest('[data-mu]'); if (!b) return;
        const act = b.dataset.mu, row = b.closest('.mu-song, .mu-card'), id = row && row.dataset.id;
        if (act === 'pick') muPickFolder();
        else if (act === 'settings') showTab('settings');
        else if (act === 'auth') { if (await muEnsureAccess()) { mu.lastErr = ''; renderMusic(); if (muCfg().folderId && (!mu.tracks.length || Date.now() - muCfg().last > 10 * 60000)) muSync({ silent: true }); } }
        else if (act === 'sync') { if (muHasToken() || await muEnsureAccess()) muSync(); }
        else if (act === 'more-rows') { mu.shown += MU_PAGE; renderMusicBody(); }
        else if (act === 'back') { mu.detail = null; mu.shown = MU_PAGE; renderMusicTabs(); renderMusicBody(); }
        else if (act === 'open') { const r = b.closest('[data-kind]'); if (r) muOpenGroup(r.dataset.kind, r.dataset.key); }
        else if (act === 'play' && id) muStart(mu.ctxIds, mu.ctxIds.indexOf(id), {});
        else if (act === 'more' && id) muTrackMenu(id);
        else if (act === 'fav' && id) { const t = mu.by.get(id); if (t) muToggleFav('t', id, muTitle(t) + ' — ' + muArtist(t)); }
        else if (act === 'fav-group' || act === 'fav-detail') {
            const p = String(b.dataset.fav).split(':'), kind = p[0], key = p.slice(1).join(':');
            const name = kind === 'a' ? (mu.albums.get(key) || {}).title : ((kind === 'p' ? mu.artists : mu.composers).get(key) || {}).name;
            muToggleFav(kind, key, name || key); if (act === 'fav-detail') renderMusicBody();
        }
        else if (act === 'play-all') muStart(mu.detail ? muGroupTracks(mu.detail.kind, mu.detail.key).map(t => t.id) : mu.ctxIds, 0, { shuffle: false });
        else if (act === 'shuffle-all') muStart(mu.detail ? muGroupTracks(mu.detail.kind, mu.detail.key).map(t => t.id) : mu.ctxIds, 0, { shuffle: true });
        else if (act === 'dl-detail') { const ids = muGroupTracks(mu.detail.kind, mu.detail.key).map(t => t.id); muConfirmDownload(ids, 'Скачать «' + muDetailName() + '»?'); }
        else if (act === 'rm-detail') { const ids = muGroupTracks(mu.detail.kind, mu.detail.key).map(t => t.id).filter(i => mu.offline.has(i)); if (ids.length) muRemoveOffline(ids); }
        else if (act === 'cache-download') muOpenDownloadSheet();
        else if (act === 'cache-all') muDownloadAllCloud();
        else if (act === 'cache-clear') muClearAllCache();
        else if (act === 'dl-cancel') { dl.cancel = true; }
        else if (act === 'dl-resume') muResumeDownload();
    });
    // возвращение на вкладку / в приложение: подтянуть изменения в папке, если доступ ещё действует
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState !== 'visible' || !$('#music').classList.contains('is-active')) return;
        renderMusicConnect();
    });
    window.addEventListener('online', () => { if ($('#music').classList.contains('is-active')) renderMusicConnect(); });
}
// Вызывается при открытии вкладки
function musicTabOpened() {
    if (googleClientId() && !gisReady()) loadGis();
    renderMusic();
    const cfg = muCfg();
    if (cfg.auto && cfg.folderId && muHasToken() && !mu.scanning && navigator.onLine && Date.now() - cfg.last > 10 * 60000) muSync({ silent: true });
}
