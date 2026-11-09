'use strict';
// =====================================================================================================
// iLife — ВХОД ЧЕРЕЗ GOOGLE И СИНХРОНИЗАЦИЯ С GOOGLE ДИСКОМ (версия 1.1.0, с 1.2.0 — и фильмы).
// Схема перенесена из My Money 4.8.1 (js/cloud.js) и дополнена вложениями.
//
// Что и где лежит на Диске пользователя (виден в обычном интерфейсе Google Диска):
//   iLife/ilife_data.json   — идеи, дела, история цен, фильмы, имя автора, тема и шрифт;
//   iLife/Вложения/…        — картинки, музыка, голосовые записи и файлы из идей и обложки фильмов (по одному файлу на вложение).
// Доступ drive.file: приложение видит только файлы, которые создало само, а не весь Диск.
//
// Как синхронизируется: при каждом изменении (через 2 секунды), при открытии приложения, при возвращении на вкладку,
// при появлении интернета и раз в минуту, пока приложение на экране. Записи сливаются поштучно (по id и времени
// изменения updatedAt), удаления передаются «надгробиями» — правки с телефона и ПК не затирают друг друга.
// Вход Google (токен) действует 1 час: потом нужно нажать «Продолжить синхронизацию» — без нажатия окно Google
// браузер не откроет. Изменения до этого не теряются: они лежат на устройстве и уйдут после подтверждения.
//
// Client ID (не секрет) берётся из js/config.js (window.ILIFE_CONFIG.googleClientId), а если там пусто — из поля
// в Настройках (хранится на этом устройстве). Интерфейс карточки — в settings.js (renderGoogleCard).
// =====================================================================================================

const G_FOLDER_NAME = 'iLife';
const G_MEDIA_FOLDER_NAME = 'Вложения';
const G_GALLERY_FOLDER_NAME = 'Мое_совсек';   // оригиналы фото и GIF страницы «Мое_совсек» лежат в отдельной папке iLife/Мое_совсек
const G_VIDEO_FOLDER_NAME = 'Мое_совсек_видео';   // оригиналы видео — iLife/Мое_совсек_видео (отдельно, чтобы старые версии приложения их не трогали)
const G_THUMB_FOLDER_NAME = 'Мое_совсек_превью';  // превью (значки) фото и видео — iLife/Мое_совсек_превью: именно они скачиваются при синхронизации
const G_GAL_BUDGET = 70000;                    // за один заход фото передаются не дольше ~70 с, остальное — следующим заходом
const G_VIDEO_MAX = 1024 * 1048576;            // видео крупнее на Диск не отправляются
const G_SONG_FOLDER_NAME = 'Песни';        // iLife/Песни/<ГГГГ-ММ-ДД>/автор_название_дата_названиезаметки.mp3 — аудио песен-контейнеров (1.7.0)
const G_SONG_MAX = 200 * 1048576;           // аудио крупнее на Диск не отправляется
const G_FILE_NAME = 'ilife_data.json';
const G_SCOPES = 'https://www.googleapis.com/auth/drive.file openid email profile';
const G_DRIVE_API = 'https://www.googleapis.com/drive/v3';
const G_UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3';
const G_FOLDER_MIME = 'application/vnd.google-apps.folder';
const G_CLIENT_RE = /^\d+-[a-z0-9_-]+\.apps\.googleusercontent\.com$/i;
const G_TOMBSTONE_TTL = 180 * 86400000;   // как долго помнить удалённые записи
const G_MEDIA_MAX = 50 * 1048576;         // вложения крупнее не отправляются на Диск
const G_ORPHAN_GRACE = 24 * 3600000;      // «ничьи» файлы на Диске убираются в корзину не раньше чем через сутки
const G_SYNC_DELAY = 2000;

// Какие списки сливаются поштучно
const G_LISTS = [
    { key: 'ideas', get: () => ideas, set: v => { ideas = v; } },
    { key: 'todos', get: () => todos, set: v => { todos = v; } },
    { key: 'prices', get: () => prices, set: v => { prices = v; } },
    { key: 'movies', get: () => movies, set: v => { movies = v; } },
    { key: 'gallery', get: () => gallery, set: v => { gallery = v; } },
    { key: 'videos', get: () => videos, set: v => { videos = v; } },
    { key: 'songs', get: () => songs, set: v => { songs = v; } },         // песни-контейнеры: блоки, подписи, заметки (1.7.0)
    { key: 'scripts', get: () => scripts, set: v => { scripts = v; } },   // сценарии (1.7.0)
    { key: 'musicfav', get: () => musicFavs, set: v => { musicFavs = v; } },   // избранное в «Музыке» (1.8.0): песни, альбомы, исполнители, композиторы
    { key: 'dnd', get: () => dndGames, set: v => { dndGames = v; } }   // игры раздела «ДНД» (2.0.0): доска, персонажи, сюжет — одной записью на игру
];
// Две страницы «Мое_совсек»: где лежат оригиналы и какие отметки «уже на Диске» хранятся на этом устройстве
const G_GAL_SECS = {
    photo: { key: 'photo', folder: G_GALLERY_FOLDER_NAME, folderKey: 'g_gallery_folder', up: 'g_gal_up', tup: 'g_gal_tup', max: G_MEDIA_MAX, list: () => gallery, mime: g => g.kind === 'gif' ? 'image/gif' : 'image/jpeg', resumable: false },
    video: { key: 'video', folder: G_VIDEO_FOLDER_NAME, folderKey: 'g_video_folder', up: 'g_vid_up', tup: 'g_vid_tup', max: G_VIDEO_MAX, list: () => videos, mime: g => 'video/mp4', resumable: true }
};
// Всё, что запоминается про Диск на этом устройстве (при смене или выходе из аккаунта забываем)
const G_CACHE_KEYS = ['g_folder', 'g_media_folder', 'g_gallery_folder', 'g_video_folder', 'g_gal_thumb_folder', 'g_file', 'g_remote_mod', 'g_last', 'g_up', 'g_gal_up', 'g_gal_tup', 'g_vid_up', 'g_vid_tup', 'g_gal_try', 'g_gal_orphan', 'g_song_folder', 'g_song_dirs', 'g_song_up', 'g_song_names', 'g_song_try', 'g_song_orphan'];

let gToken = null, gTokenExpiry = 0;
let gUser = null;            // { email, name, picture }
let gTimer = 0, gRunning = false, gAgain = false, gApplying = false;
let gBaseline = null;        // снимок данных после последней загрузки/синхронизации
let gEditSeq = 0;            // счётчик локальных правок (чтобы не потерять правки, сделанные во время синхронизации)
let gStatus = { state: 'off', message: '' };
let gNagAt = 0;

const gSleep = ms => new Promise(r => setTimeout(r, ms));
function gErr(code, message) { const e = new Error(message || code); e.code = code; return e; }

// ---------- Настройки Google на этом устройстве ----------
function gCfg() { return Object.assign({ clientId: '', auto: true, media: true, keys: true }, LS.get('google', {})); }
function gCfgSave(patch) { LS.set('google', Object.assign(gCfg(), patch)); }

function gConfigFileId() { return String((window.ILIFE_CONFIG && window.ILIFE_CONFIG.googleClientId) || '').replace(/\s+/g, ''); }
function gRawClientId() { const f = gConfigFileId(); return G_CLIENT_RE.test(f) ? f : String(gCfg().clientId || '').replace(/\s+/g, ''); }
function googleClientId() { const id = gRawClientId(); return G_CLIENT_RE.test(id) ? id : ''; }
function googleClientSource() { return G_CLIENT_RE.test(gConfigFileId()) ? 'config' : googleClientId() ? 'device' : ''; }
// Причина, по которой введённый Client ID не принят (пусто — всё в порядке или ещё не введён)
function googleClientProblem() {
    const id = gRawClientId();
    if (!id) return '';
    if (!G_CLIENT_RE.test(id)) return 'Client ID записан неправильно: «' + id.slice(0, 40) + (id.length > 40 ? '…' : '') + '». Нужен вид 123456789012-abc123.apps.googleusercontent.com — без https://, без пробелов и кавычек.';
    return '';
}
function googleAuthBlockedReason() {
    if (!googleClientId()) return googleClientProblem() || 'Сначала вставьте Client ID из Google Cloud (шаги — в блоке «Как подключить» ниже).';
    if (location.protocol === 'file:') return 'Вход через Google не работает, когда iLife открыт как файл. Откройте его по адресу https://… (GitHub Pages) или http://localhost:8080/.';
    if (isAndroidWebView()) return 'Google не разрешает вход во встроенном окне приложения (APK). Откройте iLife в Chrome или установите его на главный экран из Chrome.';
    if (!window.isSecureContext) return 'Вход через Google работает только на https:// (и на http://localhost).';
    return '';
}

// ---------- Токен Google ----------
function gisReady() { return !!(window.google && google.accounts && google.accounts.oauth2); }
function loadGis() { return loadScriptOnce('https://accounts.google.com/gsi/client').then(gisReady).catch(() => false); }
function hasValidToken() { return !!gToken && gTokenExpiry > Date.now() + 60000; }
function gStoreToken(token, expiresInSec) {
    gToken = token; gTokenExpiry = Date.now() + (Number(expiresInSec) || 3600) * 1000;
    LS.set('g_token', { token, expiry: gTokenExpiry });
}
function gDropToken() { gToken = null; gTokenExpiry = 0; LS.del('g_token'); }

// Окно Google открывается только по нажатию пользователя: вызывайте прямо из обработчика кнопки.
function requestGoogleToken() {
    return new Promise((resolve, reject) => {
        const client = google.accounts.oauth2.initTokenClient({
            client_id: googleClientId(),
            scope: G_SCOPES,
            hint: gUser ? gUser.email : undefined,
            callback: resp => {
                if (!resp || resp.error) { reject(gErr('denied', resp && (resp.error_description || resp.error))); return; }
                if (google.accounts.oauth2.hasGrantedAllScopes && !google.accounts.oauth2.hasGrantedAllScopes(resp, 'https://www.googleapis.com/auth/drive.file')) {
                    reject(gErr('scope', 'Не выдан доступ к Google Диску')); return;
                }
                gStoreToken(resp.access_token, resp.expires_in);
                resolve(resp.access_token);
            },
            error_callback: err => reject(gErr('popup', err && err.type))
        });
        client.requestAccessToken({ prompt: '' });
    });
}
function describeAuthError(e) {
    if (e && e.code === 'popup') return 'Окно входа Google закрыто или заблокировано. Разрешите всплывающие окна для сайта и попробуйте снова.';
    if (e && e.code === 'scope') return 'Для синхронизации нужно разрешить доступ к Google Диску (галочка в окне Google).';
    if (e && e.code === 'denied') return 'Вход через Google отменён' + (e.message && e.message !== 'denied' ? ' (' + e.message + ')' : '') + '.';
    return 'Не удалось войти через Google: ' + (e && e.message ? e.message : e);
}
function gExplain(title, text) {
    openSheet({ title, html: '<p style="font-size:15px;line-height:1.55;margin:0">' + esc(text) + '</p>', actions: [{ label: 'Понятно', kind: 'primary' }] });
}

async function gFetchProfile() {
    const res = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', { headers: { Authorization: 'Bearer ' + gToken } });
    if (!res.ok) throw gErr('profile', 'Профиль Google недоступен (HTTP ' + res.status + ')');
    const p = await res.json();
    const prev = gUser;
    gUser = { email: p.email || '', name: p.name || '', picture: p.picture || '' };
    // Другой аккаунт Google — забываем файлы прошлого аккаунта: на новом Диске их нет
    if (prev && prev.email && prev.email !== gUser.email) G_CACHE_KEYS.forEach(k => LS.del(k));
    LS.set('g_user', gUser);
    return gUser;
}

// Кнопка «Войти через Google»
function signInWithGoogle() {
    const blocked = googleAuthBlockedReason();
    if (blocked) { gExplain('Вход через Google пока невозможен', blocked); return; }
    if (!gisReady()) { loadGis(); toast('Модуль входа Google ещё загружается — нажмите ещё раз через пару секунд'); return; }
    requestGoogleToken()
        .then(gFetchProfile)
        .then(() => { setCloudStatus('syncing'); LS.set('g_dirty', true); return runCloudSync({ manual: true }); })
        .then(ok => { if (ok) toast('Google подключён: данные на Google Диске'); })
        .catch(e => { console.warn(e); renderGoogleCardSafe(); gExplain('Не удалось войти', describeAuthError(e)); });
}
// Повторное подтверждение, когда токен истёк (Google выдаёт его на 1 час)
function reconnectGoogle() {
    const blocked = googleAuthBlockedReason();
    if (blocked) { gExplain('Вход через Google пока невозможен', blocked); return; }
    if (!gisReady()) { loadGis(); toast('Модуль входа Google ещё загружается — нажмите ещё раз через пару секунд'); return; }
    requestGoogleToken()
        .then(() => runCloudSync({ manual: true }))
        .then(ok => { if (ok) toast('Синхронизировано с Google Диском'); })
        .catch(e => { console.warn(e); renderGoogleCardSafe(); gExplain('Не удалось продолжить', describeAuthError(e)); });
}
async function signOutGoogle() {
    if (!(await confirmSheet('Выйти из аккаунта Google?', 'Данные останутся на этом устройстве и на вашем Google Диске, но перестанут синхронизироваться.', 'Выйти', true))) return;
    try { if (gToken && gisReady()) google.accounts.oauth2.revoke(gToken, () => {}); } catch (e) {}
    gDropToken(); gUser = null;
    ['g_user', 'g_dirty'].concat(G_CACHE_KEYS).forEach(k => LS.del(k));
    setCloudStatus('off');
    toast('Вы вышли из аккаунта Google');
}
// Кнопка «Синхронизировать сейчас»
async function syncNowButton() {
    if (!gUser) { signInWithGoogle(); return; }
    if (!hasValidToken()) { reconnectGoogle(); return; }
    const ok = await runCloudSync({ manual: true });
    toast(ok ? 'Синхронизировано с Google Диском' : gStatus.state === 'offline' ? 'Нет интернета — синхронизация позже' : 'Синхронизация не удалась: ' + (gStatus.message || 'ошибка'));
}

// ---------- Google Диск API ----------
async function gFetch(url, options, attempt) {
    attempt = attempt || 0;
    if (!hasValidToken()) throw gErr('auth');
    let res;
    try {
        res = await fetch(url, Object.assign({}, options, { headers: Object.assign({}, options && options.headers, { Authorization: 'Bearer ' + gToken }) }));
    } catch (e) {
        if (e && e.name === 'AbortError') throw e;   // загрузку отменили (например, закрыли просмотр фото) — не повторяем
        if (attempt < 2) { await gSleep(700 * (attempt + 1)); return gFetch(url, options, attempt + 1); }
        throw gErr('network', 'нет связи с Google');
    }
    if (res.status === 401) { gDropToken(); throw gErr('auth'); }
    if ((res.status === 429 || res.status >= 500) && attempt < 2) { await gSleep(900 * (attempt + 1)); return gFetch(url, options, attempt + 1); }
    if (res.status === 403 && attempt < 5) {   // Диск ограничивает частоту создания файлов — подождать и повторить
        let t = ''; try { t = await res.clone().text(); } catch (e) {}
        if (/rateLimitExceeded|userRateLimitExceeded/i.test(t)) { await gSleep(1200 * (attempt + 1)); return gFetch(url, options, attempt + 1); }
    }
    if (!res.ok) {
        let detail = ''; try { detail = (await res.text()).slice(0, 300); } catch (e) {}
        if (res.status === 403 && /accessNotConfigured|SERVICE_DISABLED|has not been used in project/i.test(detail)) throw gErr('api', 'в проекте Google Cloud не включён Google Drive API (APIs & Services → Library → Google Drive API → Enable)');
        if (res.status === 403 && /storageQuotaExceeded|quota/i.test(detail)) throw gErr('quota', 'на Google Диске закончилось место');
        throw gErr('http', 'Google Диск: HTTP ' + res.status + (detail ? ' — ' + detail.replace(/\s+/g, ' ').slice(0, 160) : ''));
    }
    return res;
}
async function gList(q, fields, max, orderBy) {
    const out = []; let page = '';
    do {
        const url = G_DRIVE_API + '/files?q=' + encodeURIComponent(q) + '&spaces=drive&pageSize=' + (max && max < 1000 ? max : 1000) +
            (orderBy ? '&orderBy=' + encodeURIComponent(orderBy) : '') + '&fields=' + encodeURIComponent('nextPageToken,files(' + fields + ')') + (page ? '&pageToken=' + encodeURIComponent(page) : '');
        const j = await (await gFetch(url)).json();
        out.push(...(j.files || [])); page = j.nextPageToken || '';
    } while (page && out.length < (max && max < 1000 ? max : max >= 1000 ? max : 10000));
    return out;
}
// Папка по имени (самая старая из найденных — чтобы все устройства выбирали одну и ту же); при отсутствии создаётся
async function gEnsureFolder(name, parentId, cacheKey) {
    const cached = LS.get(cacheKey, '');
    if (cached) {
        try { const f = await (await gFetch(G_DRIVE_API + '/files/' + encodeURIComponent(cached) + '?fields=id,trashed')).json(); if (!f.trashed) return cached; }
        catch (e) { if (e.code === 'auth') throw e; }
        LS.del(cacheKey);
    }
    const found = await gList("name='" + name + "' and mimeType='" + G_FOLDER_MIME + "' and trashed=false" + (parentId ? " and '" + parentId + "' in parents" : '') + " and 'me' in owners", 'id', 20, 'createdTime');
    if (found[0]) { LS.set(cacheKey, found[0].id); return found[0].id; }
    const meta = { name, mimeType: G_FOLDER_MIME }; if (parentId) meta.parents = [parentId];
    const r = await gFetch(G_DRIVE_API + '/files?fields=id', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(meta) });
    const id = (await r.json()).id; LS.set(cacheKey, id); return id;
}
async function gFindDataFile(folderId) {
    const known = LS.get('g_file', '');
    if (known) {
        try { const f = await (await gFetch(G_DRIVE_API + '/files/' + encodeURIComponent(known) + '?fields=id,modifiedTime,trashed')).json(); if (!f.trashed) return f; }
        catch (e) { if (e.code === 'auth') throw e; }
        LS.del('g_file');
    }
    const files = await gList("name='" + G_FILE_NAME + "' and '" + folderId + "' in parents and trashed=false and 'me' in owners", 'id,modifiedTime', 20, 'createdTime');
    if (files[0]) LS.set('g_file', files[0].id);
    return files[0] || null;
}
function gMultipart(meta, blob, mime) {
    const boundary = 'ilife' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    const head = '--' + boundary + '\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n' + JSON.stringify(meta) + '\r\n--' + boundary + '\r\nContent-Type: ' + mime + '\r\n\r\n';
    return { type: 'multipart/related; boundary=' + boundary, body: new Blob([head, blob, '\r\n--' + boundary + '--']) };
}
async function gCreateDataFile(folderId, data) {
    const mp = gMultipart({ name: G_FILE_NAME, mimeType: 'application/json', parents: [folderId], description: 'Данные приложения iLife' }, JSON.stringify(data), 'application/json; charset=UTF-8');
    const f = await (await gFetch(G_UPLOAD_API + '/files?uploadType=multipart&fields=id,modifiedTime', { method: 'POST', headers: { 'Content-Type': mp.type }, body: mp.body })).json();
    LS.set('g_file', f.id); return f;
}
async function gReadJson(id) {
    const text = await (await gFetch(G_DRIVE_API + '/files/' + encodeURIComponent(id) + '?alt=media')).text();
    let j; try { j = JSON.parse(text); } catch (e) { throw gErr('format', 'файл данных на Google Диске повреждён'); }
    if (!j || typeof j !== 'object') throw gErr('format', 'файл данных на Google Диске повреждён');
    return j;
}
async function gWriteJson(id, data) {
    return (await gFetch(G_UPLOAD_API + '/files/' + encodeURIComponent(id) + '?uploadType=media&fields=id,modifiedTime', { method: 'PATCH', headers: { 'Content-Type': 'application/json; charset=UTF-8' }, body: JSON.stringify(data) })).json();
}

// ---------- Отметки изменений, надгробия, слияние ----------
function gMetaGet() {
    const m = LS.get('g_meta', {}); const deleted = {};
    G_LISTS.forEach(l => { deleted[l.key] = Object.assign({}, m.deleted && m.deleted[l.key]); });
    return { scalarsAt: Number(m.scalarsAt) || 0, keysAt: gKeysAtNorm(m.keysAt), deleted };
}
function gMetaSave(meta) { LS.set('g_meta', meta); }
// ---------- Ключи (TMDB, OMDb, ПоискКино, ИИ, Client ID Spotify, ключ YouTube, токен и канал Telegram): у каждого поля своё время правки ----------
// Так ключ, введённый на телефоне, не затирает остальные ключи с компьютера, а новый телефон просто получает всё готовым.
const G_KEY_FIELDS = ['tmdb', 'omdb', 'kp', 'ai', 'aiKey', 'aiModel', 'aiAuto', 'spClientId', 'ytKey', 'tgToken', 'tgChat'];
const G_KEY_DEFAULTS = { tmdb: '', omdb: '', kp: '', ai: 'none', aiKey: '', aiModel: '', aiAuto: true, spClientId: '', ytKey: '', tgToken: '', tgChat: '' };
function gKeysAtNorm(v) { const o = {}; G_KEY_FIELDS.forEach(f => { o[f] = Number(v && v[f]) || 0; }); return o; }
function gKeysObj() {   // текущие значения на этом устройстве, всегда в одном порядке
    const c = typeof mvCfg === 'function' ? mvCfg() : {}, sp = typeof spCfg === 'function' ? spCfg() : {};
    const yt = typeof ytCfg === 'function' ? ytCfg() : {}, tg = typeof tgCfg === 'function' ? tgCfg() : {};
    const t = x => String(x == null ? '' : x).replace(/\s+/g, '');
    return { tmdb: t(c.tmdb), omdb: t(c.omdb), kp: t(c.kp), ai: c.ai === 'gemini' || c.ai === 'claude' ? c.ai : 'none', aiKey: t(c.aiKey),
        aiModel: String(c.aiModel || '').trim(), aiAuto: c.aiAuto !== false, spClientId: t(sp.clientId),
        ytKey: t(yt.key), tgToken: t(tg.token), tgChat: String(tg.chat || '').trim() };
}
function gKeysJsonMap(o) { const m = {}; G_KEY_FIELDS.forEach(f => { m[f] = JSON.stringify(o[f]); }); return m; }
// Слияние по полям: у кого время правки позже, того значение и берём (при равенстве — своё)
function gMergeKeys(lk, lat, rk, rat) {
    if (!lk && !rk) return { keys: undefined, at: undefined };
    const keys = {}, at = {};
    G_KEY_FIELDS.forEach(f => {
        const hasL = !!lk && f in lk, hasR = !!rk && typeof rk === 'object' && f in rk;
        const tl = Number(lat && lat[f]) || 0, tr = Number(rat && rat[f]) || 0;
        if (hasL && (!hasR || tl >= tr)) { keys[f] = lk[f]; at[f] = tl; }
        else if (hasR) { keys[f] = rk[f]; at[f] = tr; }
    });
    return { keys, at };
}
// Запоминаем, что нашли на Диске (есть ли ключи, чья версия записала файл) — показывается в Настройках → Google Диск
function gKeysInfoSave(remote) {
    const at = Math.max(0, ...Object.values((remote && remote.keysAt) || {}).map(Number).filter(n => n > 0));
    LS.set('g_keys_info', { found: !!(remote && remote.keys && typeof remote.keys === 'object'), by: String((remote && remote.appVersion) || '?'), at, seen: Date.now() });
}
// Применяет полученные с Диска ключи на этом устройстве; возвращает, изменилось ли что-то
function gApplyKeys(k) {
    if (!k || typeof k !== 'object' || typeof mvCfg !== 'function') return false;
    const cur = gKeysObj(); let changed = false;
    const patch = {};
    ['tmdb', 'omdb', 'kp', 'aiKey', 'aiModel'].forEach(f => { if (typeof k[f] === 'string' && k[f] !== cur[f]) { patch[f] = k[f]; changed = true; } });
    if ((k.ai === 'none' || k.ai === 'gemini' || k.ai === 'claude') && k.ai !== cur.ai) { patch.ai = k.ai; changed = true; }
    if (typeof k.aiAuto === 'boolean' && k.aiAuto !== cur.aiAuto) { patch.aiAuto = k.aiAuto; changed = true; }
    if (Object.keys(patch).length) LS.set('movie_cfg', Object.assign(mvCfg(), patch));
    if (typeof k.spClientId === 'string' && k.spClientId !== cur.spClientId && typeof spCfg === 'function') {
        LS.set('spotify', Object.assign(spCfg(), { clientId: k.spClientId })); changed = true;
    }
    if (typeof k.ytKey === 'string' && k.ytKey !== cur.ytKey && typeof ytCfg === 'function') { LS.set('youtube', Object.assign(ytCfg(), { key: k.ytKey })); changed = true; }
    if (typeof tgCfg === 'function') {
        const tp = {};
        if (typeof k.tgToken === 'string' && k.tgToken !== cur.tgToken) tp.token = k.tgToken;
        if (typeof k.tgChat === 'string' && k.tgChat !== cur.tgChat) tp.chat = k.tgChat;
        if (Object.keys(tp).length) { LS.set('tg', Object.assign(tgCfg(), tp)); changed = true; }
    }
    return changed;
}

function gScalars() { return { author: authorName(), theme: settings.theme, font: settings.font, cats: typeof ideaCatsPublic === 'function' ? ideaCatsPublic() : undefined }; }   // cats — категории «Идей» (1.6.0)
function gScalarsJson() { return JSON.stringify(gScalars()); }
function gItemJson(item) { const rest = Object.assign({}, item); delete rest.updatedAt; return JSON.stringify(rest); }
function gAsList(v) { return Array.isArray(v) ? v.filter(i => i && i.id) : (v && typeof v === 'object' ? Object.values(v).filter(i => i && i.id) : []); }

// Записям без времени изменения (дела и цены версии 1.0.0) ставим время создания/выполнения — чтобы слияние было честным
function gLegacyStamp() {
    ideas.forEach(i => { if (!i.updatedAt) i.updatedAt = i.createdAt || 0; });
    todos.forEach(t => { if (!t.updatedAt) t.updatedAt = Math.max(Number(t.addedAt) || 0, Number(t.doneAt) || 0); });
    prices.forEach(p => { if (!p.updatedAt) { const ms = keyToMs(p.date); p.updatedAt = isNaN(ms) ? 0 : ms; } });
    movies.forEach(m => { if (!m.updatedAt) m.updatedAt = Math.max(Number(m.addedAt) || 0, Number(m.watchedAt) || 0); });
    gallery.forEach(g => { if (!g.updatedAt) g.updatedAt = Number(g.date) || 1; });
    videos.forEach(g => { if (!g.updatedAt) g.updatedAt = Number(g.date) || 1; });
    songs.forEach(x => { if (!x.updatedAt) x.updatedAt = x.createdAt || 1; });
    scripts.forEach(x => { if (!x.updatedAt) x.updatedAt = x.createdAt || 1; });
    dndGames.forEach(x => { if (!x.updatedAt) x.updatedAt = x.createdAt || 1; });
    musicFavs.forEach(x => { if (!x.updatedAt) x.updatedAt = 1; });
    // ключи, введённые до появления синхронизации ключей: ставим им время, чтобы они ушли на Диск (пустые и «по умолчанию» не трогаем)
    const meta = gMetaGet(), cur = gKeysObj(); let ch = false;
    G_KEY_FIELDS.forEach(f => { if (!meta.keysAt[f] && JSON.stringify(cur[f]) !== JSON.stringify(G_KEY_DEFAULTS[f])) { meta.keysAt[f] = Date.now(); ch = true; } });
    if (ch) { gMetaSave(meta); LS.set('g_dirty', true); }
}
function gInitBaseline() {
    gBaseline = { scalars: gScalarsJson(), keys: gKeysJsonMap(gKeysObj()) };
    G_LISTS.forEach(l => { gBaseline[l.key] = new Map(l.get().filter(i => i && i.id).map(i => [String(i.id), gItemJson(i)])); });
}
// Вызывается из saveIdeas / saveTodos / saveSettings ДО записи в хранилище: ставит время изменения новым и
// изменённым записям и «надгробия» удалённым.
function gStamp() {
    const meta = gMetaGet(); const now = Date.now(); let changed = false;
    G_LISTS.forEach(l => {
        const prev = gBaseline[l.key], next = new Map(), list = l.get(), dels = meta.deleted[l.key];
        list.forEach(item => {
            if (!item) return;
            if (!item.id) item.id = uid('x');
            const id = String(item.id), json = gItemJson(item);
            if (prev.get(id) !== json) { item.updatedAt = Math.max(now, (Number(item.updatedAt) || 0) + 1); changed = true; delete dels[id]; }
            next.set(id, json);
        });
        prev.forEach((_, id) => { if (!next.has(id)) { dels[id] = now; changed = true; } });
        gBaseline[l.key] = next;
    });
    const sc = gScalarsJson();
    if (sc !== gBaseline.scalars) { meta.scalarsAt = now; gBaseline.scalars = sc; changed = true; }
    const kj = gKeysJsonMap(gKeysObj());
    G_KEY_FIELDS.forEach(f => { if (kj[f] !== (gBaseline.keys || {})[f]) { meta.keysAt[f] = now; changed = true; } });
    gBaseline.keys = kj;
    if (changed) { gMetaSave(meta); LS.set('g_dirty', true); gEditSeq++; }
    return changed;
}
// Хук для остального кода приложения
function cloudLocalChanged() {
    if (!gBaseline || gApplying) return;
    if (gStamp() && gUser && gCfg().auto) scheduleCloudSync(G_SYNC_DELAY);
}

function gLocalSnapshot() {
    const meta = gMetaGet();
    const snap = { app: 'ilife', format: 1, appVersion: APP_VERSION, savedAt: Date.now(),
        ideas, todos, prices, movies, gallery, videos, songs, scripts, dnd: dndGames, musicfav: musicFavs, scalars: gScalars(), scalarsAt: meta.scalarsAt, deleted: meta.deleted };
    if (gCfg().keys) { snap.keys = gKeysObj(); snap.keysAt = meta.keysAt; }   // выключатель «Ключи тоже на Диск»
    return snap;
}
function gMergeLists(a, b, delA, delB) {
    const deleted = {}; const cutoff = Date.now() - G_TOMBSTONE_TTL;
    [delA || {}, delB || {}].forEach(d => Object.entries(d).forEach(([id, ts]) => { if (Number(ts) > cutoff) deleted[id] = Math.max(deleted[id] || 0, Number(ts) || 0); }));
    const map = new Map();
    [...gAsList(a), ...gAsList(b)].forEach(item => {
        const id = String(item.id), cur = map.get(id);
        if (!cur || (Number(item.updatedAt) || 0) > (Number(cur.updatedAt) || 0)) map.set(id, item);
    });
    // запись удалена, если надгробие не старше последней её правки
    const list = [...map.values()].filter(item => !(deleted[String(item.id)] && deleted[String(item.id)] >= (Number(item.updatedAt) || 0)));
    return { list, deleted };
}
function gMerge(local, remote) {
    const r = remote || {}; const out = { app: 'ilife', format: 1, appVersion: APP_VERSION, savedAt: Date.now() }; const deleted = {};
    G_LISTS.forEach(l => {
        const m = gMergeLists(local[l.key], r[l.key], local.deleted && local.deleted[l.key], r.deleted && r.deleted[l.key]);
        out[l.key] = m.list; deleted[l.key] = m.deleted;
    });
    const remoteNewer = (Number(r.scalarsAt) || 0) > (Number(local.scalarsAt) || 0);
    const src = remoteNewer && r.scalars && typeof r.scalars === 'object' ? r.scalars : local.scalars;
    out.scalars = Object.assign({}, local.scalars, src);
    out.scalarsAt = Math.max(Number(local.scalarsAt) || 0, Number(r.scalarsAt) || 0);
    out.deleted = deleted;
    // ключи: если на этом устройстве синхронизация ключей выключена, чужие ключи просто переносим в файл как есть
    const mk = gMergeKeys(local.keys, local.keysAt, r.keys, r.keysAt);
    if (mk.keys) { out.keys = mk.keys; out.keysAt = mk.at; }
    return out;
}
// Сравнение без учёта времени сохранения и порядка записей
function gKey(s, withKeys) {
    const byId = list => gAsList(list).map(i => JSON.stringify(i)).sort();
    const sortedDel = d => G_LISTS.map(l => Object.entries((d && d[l.key]) || {}).sort((x, y) => x[0] < y[0] ? -1 : 1));
    const keys = withKeys === false ? null : [G_KEY_FIELDS.map(f => (s.keys || {})[f]), G_KEY_FIELDS.map(f => Number((s.keysAt || {})[f]) || 0)];
    return JSON.stringify([G_LISTS.map(l => byId(s[l.key])), s.scalars, s.scalarsAt, sortedDel(s.deleted), keys]);
}

function mediaRefs(list) {
    const set = new Set();
    gAsList(list).forEach(i => { (i.files || []).forEach(f => f && f.id && set.add(f.id)); if (i.track && i.track.coverId) set.add(i.track.coverId); if (i.coverId) set.add(i.coverId); });
    return set;
}
// Картинки и голосовые записи в блоках песен (само аудио песни идёт отдельно — папка «Песни», см. gSyncSongs)
function songMediaRefs(list) {
    const set = new Set();
    gAsList(list).forEach(sg => { if (sg.coverId) set.add(sg.coverId); (sg.blocks || []).forEach(b => { (b.imgs || []).forEach(f => f && f.id && set.add(f.id)); (b.voices || []).forEach(f => f && f.id && set.add(f.id)); }); });
    return set;
}
// Все файлы, на которые ссылаются данные: вложения идей, обложки треков и обложки фильмов, картинки и голос в блоках песен
function gAllMediaRefs() { const s = mediaRefs(ideas); mediaRefs(movies).forEach(id => s.add(id)); songMediaRefs(songs).forEach(id => s.add(id)); if (typeof dndMediaRefs === 'function') dndMediaRefs(dndGames).forEach(id => s.add(id)); return s; }
function gAllSongAudio() { return new Set(gAsList(songs).map(x => x.audioId).filter(Boolean)); }
function gDraftIds() { const s = new Set(); try { (draft.files || []).forEach(f => s.add(f.id)); } catch (e) {} return s; }

// Применяет слитые данные на этом устройстве
async function gApply(merged) {
    gApplying = true;
    try {
        const oldRefs = gAllMediaRefs(), oldGal = new Set(gallery.map(g => g.id).concat(videos.map(g => g.id))), oldAudio = gAllSongAudio();
        songs = Array.isArray(merged.songs) ? merged.songs : []; scripts = Array.isArray(merged.scripts) ? merged.scripts : []; dndGames = Array.isArray(merged.dnd) ? merged.dnd : []; musicFavs = Array.isArray(merged.musicfav) ? merged.musicfav : [];
        ideas = merged.ideas; todos = merged.todos; prices = merged.prices; movies = merged.movies || []; gallery = Array.isArray(merged.gallery) ? merged.gallery : []; videos = Array.isArray(merged.videos) ? merged.videos : [];
        const sc = merged.scalars || {};
        if (sc.author && sc.author !== settings.author) settings.author = String(sc.author).slice(0, 30);
        if (sc.theme && sc.theme !== settings.theme && PALETTES.some(p => p.id === sc.theme)) applyTheme(sc.theme);
        if (sc.font && sc.font !== settings.font && FONTS.some(f => f.id === sc.font)) applyFont(sc.font);
        if (Array.isArray(sc.cats) && typeof ideaCatsApply === 'function') ideaCatsApply(sc.cats);
        LS.set('settings', settings); LS.set('ideas', ideas); LS.set('todos', todos); LS.set('prices', prices); LS.set('movies', movies); LS.set('gallery', gallery); LS.set('videos', videos); LS.set('songs', songs); LS.set('scripts', scripts); LS.set('dnd_games', dndGames); LS.set('musicfav', musicFavs);
        // ключи: берём с Диска только если синхронизация ключей включена (иначе метки времени остаются своими)
        const metaNow = gMetaGet(); let keysChanged = false, keysAt = metaNow.keysAt;
        if (gCfg().keys && merged.keys) { keysChanged = gApplyKeys(merged.keys); keysAt = gKeysAtNorm(merged.keysAt); }
        gMetaSave({ scalarsAt: Number(merged.scalarsAt) || 0, keysAt, deleted: merged.deleted });
        gInitBaseline();
        // вложения записей, удалённых или изменённых на другом устройстве, здесь больше не нужны
        const newRefs = gAllMediaRefs(), keep = gDraftIds();
        for (const id of oldRefs) if (!newRefs.has(id) && !keep.has(id)) await BlobDB.del(id);
        const newGal = new Set(gallery.map(g => g.id).concat(videos.map(g => g.id)));   // фото и видео, удалённые на другом устройстве
        for (const id of oldGal) if (!newGal.has(id)) await BlobDB.del(id);
        const newAudio = gAllSongAudio();   // аудио песен, удалённых на другом устройстве
        for (const id of oldAudio) if (!newAudio.has(id)) await BlobDB.del(id);
        IX.clear(); renderIdeas(); renderTodo(); renderMovies(); renderDraft(); renderThemes();
        if (typeof galRefreshIfOpen === 'function') galRefreshIfOpen();
        if (typeof renderSongs === 'function') renderSongs();
        if (typeof renderScripts === 'function') renderScripts();
        if (typeof dndAfterSync === 'function') dndAfterSync();
        if (typeof muFavChanged === 'function') muFavChanged();
        if (keysChanged) {
            try {
                if (typeof renderMoviesCard === 'function') renderMoviesCard(); if (typeof renderSpotifyCard === 'function' && $('#sp-client')) renderSpotifyCard();
                if (typeof renderYoutubeCard === 'function') renderYoutubeCard(); if (typeof renderTelegramCard === 'function') renderTelegramCard(); if (typeof renderTelegramBlock === 'function') renderTelegramBlock();
            } catch (e) { console.warn(e); }
            toast('Ключи подтянуты с Google Диска');
        }
        const pa = $('#profile-author'); if (pa) pa.value = authorName();
        if (typeof updateSplashClock === 'function') updateSplashClock();
        if (typeof updateComposerMeta === 'function') updateComposerMeta();
        if (typeof renderStorageInfo === 'function') renderStorageInfo();
    } finally { gApplying = false; }
}

// ---------- Вложения ----------
function gMediaFileName(id, rec) { return id + '__' + String((rec && rec.name) || 'file').replace(/[\\/\r\n]+/g, '_').slice(0, 120); }
async function gListMedia(folderId, cap) {
    const files = await gList("'" + folderId + "' in parents and trashed=false", 'id,name,size,modifiedTime,mimeType,appProperties', cap || 0);
    const map = new Map();
    files.forEach(f => {
        const mid = (f.appProperties && f.appProperties.mid) || (String(f.name || '').split('__')[0] || '');
        if (mid && !map.has(mid)) map.set(mid, f);
    });
    return map;
}
async function gUploadBlob(folderId, name, mid, blob, mime) {
    const mp = gMultipart({ name, parents: [folderId], mimeType: mime, appProperties: { mid } }, blob, mime);
    await gFetch(G_UPLOAD_API + '/files?uploadType=multipart&fields=id', { method: 'POST', headers: { 'Content-Type': mp.type }, body: mp.body });
}
async function gUploadMedia(folderId, id) {
    const rec = await BlobDB.get(id);
    if (!rec || !rec.blob) return 'missing';
    if (rec.blob.size > G_MEDIA_MAX) return 'big';
    const mime = rec.type || rec.blob.type || 'application/octet-stream';
    await gUploadBlob(folderId, gMediaFileName(id, rec), id, rec.blob, mime);
    return 'ok';
}
// Крупные файлы (видео): сначала сеанс «докачиваемой» загрузки, затем сам файл одним запросом
async function gUploadResumable(folderId, id, rec, maxBytes) {
    if (!rec || !rec.blob) return 'missing';
    if (rec.blob.size > maxBytes) return 'big';
    const mime = rec.type || rec.blob.type || 'application/octet-stream';
    const init = await gFetch(G_UPLOAD_API + '/files?uploadType=resumable&fields=id', { method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Type': mime, 'X-Upload-Content-Length': String(rec.blob.size) },
        body: JSON.stringify({ name: gMediaFileName(id, rec), parents: [folderId], mimeType: mime, appProperties: { mid: id } }) });
    const loc = init.headers.get('Location');
    if (!loc) throw gErr('http', 'Google Диск не выдал адрес для загрузки файла');
    await gFetch(loc, { method: 'PUT', headers: { 'Content-Type': mime }, body: rec.blob });
    return 'ok';
}
// Скачивание файла с Диска; onFrac(0..1) — ход загрузки, если известен размер
async function gDownloadStream(fileId, onFrac, signal) {
    const r = await gFetch(G_DRIVE_API + '/files/' + encodeURIComponent(fileId) + '?alt=media', signal ? { signal } : undefined);
    const len = Number(r.headers.get('content-length')) || 0;
    if (!onFrac || !len || !r.body || !r.body.getReader) return r.blob();
    const reader = r.body.getReader(), chunks = []; let got = 0;
    for (;;) { const x = await reader.read(); if (x.done) break; chunks.push(x.value); got += x.value.length; onFrac(Math.min(1, got / len)); }
    return new Blob(chunks, { type: r.headers.get('content-type') || '' });
}
async function gPool(items, n, fn) {   // fn(item) вызывается в n потоков; если вернула false — остальные не запускаются
    const q = items.slice();
    await Promise.all(Array.from({ length: Math.min(n, q.length) }, async () => { while (q.length) { const it = q.shift(); if ((await fn(it)) === false) q.length = 0; } }));
}
async function gRootFolder() { return LS.get('g_folder', '') || gEnsureFolder(G_FOLDER_NAME, '', 'g_folder'); }
async function gMakeThumb(blob, type, withGif) {
    if (!(withGif ? /^image\/(jpeg|png|webp|gif)$/ : /^image\/(jpeg|png|webp)$/).test(type || '')) return null;
    try { const bmp = await decodeImage(blob); const { w, h } = bitmapSize(bmp); const t = await canvasBlob(bmp, w, h, 480, 0.8); if (bmp.close) try { bmp.close(); } catch (e) {} return t && t.blob || null; } catch (e) { return null; }
}
async function gDownloadMedia(id, f, meta) {
    const r = await gFetch(G_DRIVE_API + '/files/' + encodeURIComponent(f.id) + '?alt=media');
    const type = f.mimeType || meta.type || 'application/octet-stream';
    const blob = new Blob([await r.blob()], { type });
    const name = meta.name || String(f.name || '').replace(/^[^_]*__/, '') || 'file';
    await BlobDB.put({ id, blob, thumb: await gMakeThumb(blob, type, meta.gallery), name, type, size: blob.size });
}
function gMediaMeta(id) {
    for (const i of ideas) {
        const f = (i.files || []).find(x => x && x.id === id); if (f) return { name: f.name, type: f.type };
        if (i.track && i.track.coverId === id) return { name: 'cover.jpg', type: 'image/jpeg' };
    }
    for (const m of movies) if (m.coverId === id) return { name: 'poster.jpg', type: 'image/jpeg' };
    for (const sg of songs) {
        if (sg.coverId === id) return { name: 'cover.jpg', type: 'image/jpeg' };
        for (const b of sg.blocks || []) { const f = (b.imgs || []).concat(b.voices || []).find(x => x && x.id === id); if (f) return { name: f.name, type: f.type }; }
    }
    if (typeof dndMediaMeta === 'function') { const dm = dndMediaMeta(id); if (dm) return dm; }
    return {};
}
// Отправляет недостающие вложения на Диск, скачивает чужие, убирает в корзину «ничьи» файлы.
// Возвращает { up, down, big, missing, warn }
async function gSyncMedia(opts) {
    const res = { up: 0, down: 0, big: 0, missing: 0, warn: '' };
    const refs = gAllMediaRefs();
    const localIds = new Set(await BlobDB.ids());
    const uploaded = new Set(LS.get('g_up', []));
    const pendUp = [...refs].filter(id => localIds.has(id) && !uploaded.has(id));
    const pendDown = [...refs].filter(id => !localIds.has(id));
    const lastTry = LS.get('g_media_try', 0);
    const orphanDue = opts.manual && Date.now() - LS.get('g_orphan_at', 0) > G_ORPHAN_GRACE;
    if (!pendUp.length && !pendDown.length && !orphanDue) return res;
    if (!pendUp.length && !opts.manual && !opts.remoteChanged && Date.now() - lastTry < 5 * 60000) return res; // скачивать нечего или чужие вложения ещё не выложены — не дёргаем Диск каждую минуту
    LS.set('g_media_try', Date.now());
    const folderId = await gEnsureFolder(G_MEDIA_FOLDER_NAME, LS.get('g_folder', ''), 'g_media_folder');
    const remote = await gListMedia(folderId);
    remote.forEach((_, id) => uploaded.add(id));
    let n = 0; const total = pendUp.filter(id => !remote.has(id)).length + pendDown.filter(id => remote.has(id)).length;
    for (const id of pendUp) {
        if (remote.has(id)) continue;
        setCloudStatus('syncing', 'Вложения: ' + (++n) + ' из ' + total);
        const r = await gUploadMedia(folderId, id);
        if (r === 'ok') { uploaded.add(id); res.up++; } else if (r === 'big') { res.big++; uploaded.add(id); } else res.missing++;
    }
    for (const id of pendDown) {
        const f = remote.get(id);
        if (!f) { res.missing++; continue; }
        setCloudStatus('syncing', 'Вложения: ' + (++n) + ' из ' + total);
        try { await gDownloadMedia(id, f, gMediaMeta(id)); res.down++; } catch (e) { if (e.code === 'auth') throw e; console.warn('Вложение не скачалось', id, e); res.missing++; }
    }
    if (res.down) { IX.clear(); renderIdeas(); renderMovies(); if (typeof renderStorageInfo === 'function') renderStorageInfo(); }
    // «ничьи» файлы (запись удалена на каком-то устройстве) — в корзину Диска, но не раньше чем через сутки
    if (orphanDue) {
        LS.set('g_orphan_at', Date.now());
        for (const [mid, f] of remote) {
            if (refs.has(mid)) continue;
            const mt = Date.parse(f.modifiedTime); if (!mt || Date.now() - mt < G_ORPHAN_GRACE) continue;
            try { await gFetch(G_DRIVE_API + '/files/' + encodeURIComponent(f.id) + '?fields=id', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ trashed: true }) }); uploaded.delete(mid); } catch (e) { if (e.code === 'auth') throw e; }
        }
    }
    LS.set('g_up', [...uploaded].filter(id => refs.has(id)));
    if (res.big) res.warn = 'Вложений крупнее ' + fmtBytes(G_MEDIA_MAX) + ' не отправлено: ' + res.big;
    return res;
}

// ---------- Мое_совсек (фото, GIF, видео) ----------
// На Диске: iLife/Мое_совсек (оригиналы фото и GIF), iLife/Мое_совсек_видео (оригиналы видео), iLife/Мое_совсек_превью (значки).
// Синхронизация передаёт ПРЕВЬЮ: на другом устройстве скачиваются именно они. Оригиналы с Диска берутся по требованию
// (просмотр, «Скачать все», сохранение папки — gGalFetchFull); а загружаются на Диск с того устройства, где они лежат.
let gGalMore = false;   // прошлый заход не успел передать все файлы — следующий не ждёт 5 минут
const gRemoteCache = {};   // кратко помним список оригиналов на Диске (для докачки по требованию)
async function gGalRemote(secKey, force, ttl) {
    const c = gRemoteCache[secKey];
    if (!force && c && Date.now() - c.at < (ttl || 90000)) return c.map;
    const sec = G_GAL_SECS[secKey];
    const folderId = await gEnsureFolder(sec.folder, await gRootFolder(), sec.folderKey);
    const map = await gListMedia(folderId, 60000);
    gRemoteCache[secKey] = { at: Date.now(), map };
    return map;
}
async function gTrashOrphans(remote, refs, label) {   // файлы без записи в списке — в корзину Диска, но не раньше чем через сутки
    for (const [mid, f] of remote) {
        if (refs.has(mid)) continue;
        const mt = Date.parse(f.modifiedTime); if (!mt || Date.now() - mt < G_ORPHAN_GRACE) continue;
        try { await gFetch(G_DRIVE_API + '/files/' + encodeURIComponent(f.id) + '?fields=id', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ trashed: true }) }); } catch (e) { if (e.code === 'auth') throw e; }
    }
}
async function gSyncGalleryAll(opts) {
    const res = { up: 0, upThumb: 0, down: 0, big: 0, waiting: 0, more: false, warn: '' };
    const secs = Object.values(G_GAL_SECS);
    if (!secs.some(sec => sec.list().length)) { gGalMore = false; return res; }
    const idx = await BlobDB.index();
    // Фото, пришедшие из версии 1.5.0 без превью: делаем превью из полного файла, чтобы его можно было выложить на Диск
    for (const g of gallery.filter(g => { const r = idx.get(g.id); return r && r.full && !r.thumb; }).slice(0, 40)) {
        try {
            const rec = await BlobDB.get(g.id); if (!rec || !rec.blob) continue;
            const th = await gMakeThumb(rec.blob, rec.type || rec.blob.type, true);
            if (th) { await BlobDB.putThumb(g.id, th, {}); idx.set(g.id, Object.assign({}, idx.get(g.id), { thumb: true })); }
        } catch (e) { console.warn('Превью не создано', g.id, e); }
    }
    const st = secs.map(sec => {
        const ids = sec.list().map(g => g.id), idset = new Set(ids), up = new Set(LS.get(sec.up, [])), tup = new Set(LS.get(sec.tup, []));
        return { sec, ids, idset, up, tup, waiting: 0,
            pendUp: ids.filter(id => (idx.get(id) || {}).full && !up.has(id)),
            pendTUp: ids.filter(id => (idx.get(id) || {}).thumb && !tup.has(id)),
            pendTDown: ids.filter(id => !(idx.get(id) || {}).thumb) };
    });
    const anyUp = st.some(x => x.pendUp.length || x.pendTUp.length), anyDown = st.some(x => x.pendTDown.length);
    const orphanDue = opts.manual && Date.now() - LS.get('g_gal_orphan', 0) > G_ORPHAN_GRACE;
    if (!anyUp && !anyDown && !orphanDue) { gGalMore = false; return res; }
    if (!anyUp && !opts.manual && !opts.remoteChanged && !gGalMore && Date.now() - LS.get('g_gal_try', 0) < 5 * 60000) return res;
    LS.set('g_gal_try', Date.now());
    const root = await gRootFolder();
    const thumbFolder = await gEnsureFolder(G_THUMB_FOLDER_NAME, root, 'g_gal_thumb_folder');
    const remoteT = await gListMedia(thumbFolder, 60000);
    st.forEach(x => x.ids.forEach(id => { if (remoteT.has(id)) x.tup.add(id); }));
    const t0 = Date.now(), over = () => Date.now() - t0 > G_GAL_BUDGET;
    const downT = [], upT = [];
    st.forEach(x => {
        x.pendTDown.forEach(id => { if (remoteT.has(id)) downT.push({ x, id }); else x.waiting++; });
        x.pendTUp.forEach(id => { if (!remoteT.has(id)) upT.push({ x, id }); });
    });
    let n = 0; const total = downT.length + upT.length + st.reduce((s, x) => s + x.pendUp.length, 0);
    // 1) превью с Диска на это устройство
    await gPool(downT, 5, async ({ x, id }) => {
        if (over()) { res.more = true; return false; }
        setCloudStatus('syncing', 'Мое_совсек: превью ' + (++n) + ' из ' + total);
        const g = x.sec.list().find(i => i.id === id) || {};
        try {
            const b = await (await gFetch(G_DRIVE_API + '/files/' + encodeURIComponent(remoteT.get(id).id) + '?alt=media')).blob();
            await BlobDB.putThumb(id, new Blob([b], { type: 'image/jpeg' }), { name: g.name || 'file', type: x.sec.mime(g), size: g.size || 0 });
            x.tup.add(id); res.down++;
        } catch (e) { if (e.code === 'auth') throw e; console.warn('Превью не скачалось', id, e); x.waiting++; }
    });
    // 2) превью с этого устройства на Диск
    await gPool(upT, 3, async ({ x, id }) => {
        if (over()) { res.more = true; return false; }
        setCloudStatus('syncing', 'Мое_совсек: превью ' + (++n) + ' из ' + total);
        const rec = await BlobDB.get(id); if (!rec || !rec.thumb) return;
        await gUploadBlob(thumbFolder, id + '__preview.jpg', id, rec.thumb, 'image/jpeg');
        x.tup.add(id); res.upThumb++;
    });
    // 3) оригиналы с этого устройства на Диск
    const remotes = {};
    for (const x of st) {
        if (!x.pendUp.length && !(orphanDue && !res.more)) continue;
        const folderId = await gEnsureFolder(x.sec.folder, root, x.sec.folderKey);
        const remote = await gListMedia(folderId, 60000);
        gRemoteCache[x.sec.key] = { at: Date.now(), map: remote }; remotes[x.sec.key] = remote;
        remote.forEach((_, id) => x.up.add(id));
        for (const id of x.pendUp) {
            if (remote.has(id)) continue;
            if (over()) { res.more = true; break; }
            setCloudStatus('syncing', 'Мое_совсек: ' + (x.sec.resumable ? 'видео' : 'файл') + ' ' + (++n) + ' из ' + total);
            const r = x.sec.resumable ? await gUploadResumable(folderId, id, await BlobDB.get(id), x.sec.max) : await gUploadMedia(folderId, id);
            if (r === 'ok') { x.up.add(id); res.up++; } else if (r === 'big') { res.big++; x.up.add(id); }
        }
    }
    // 4) «ничьи» файлы (запись удалена на каком-то устройстве) — в корзину Диска, но не раньше чем через сутки
    if (orphanDue && !res.more) {
        LS.set('g_gal_orphan', Date.now());
        const all = new Set(); st.forEach(x => x.ids.forEach(id => all.add(id)));
        await gTrashOrphans(remoteT, all, 'превью');
        for (const x of st) if (remotes[x.sec.key]) await gTrashOrphans(remotes[x.sec.key], x.idset, 'оригиналы');
    }
    st.forEach(x => { LS.set(x.sec.up, [...x.up].filter(id => x.idset.has(id))); LS.set(x.sec.tup, [...x.tup].filter(id => x.idset.has(id))); });
    gGalMore = res.more;
    res.waiting = st.reduce((s, x) => s + x.waiting, 0);
    if (res.down && typeof galRefreshIfOpen === 'function') { galRefreshIfOpen(); if (typeof renderStorageInfo === 'function') renderStorageInfo(); }
    if (res.big) res.warn = 'Файлов крупнее лимита не отправлено на Диск: ' + res.big;
    else if (res.waiting) res.warn = 'Мое_совсек: превью для ' + res.waiting + ' файлов ещё не выложено с другого устройства';
    return res;
}
// Какие оригиналы точно лежат на Диске (для «Очистить кеш»): по свежему списку Диска, а без входа — по отметкам синхронизации
async function gGalConfirmedIds(secKey) {
    const sec = G_GAL_SECS[secKey];
    if (gUser && hasValidToken() && navigator.onLine) {
        try { const remote = await gGalRemote(secKey, true); return { set: new Set(remote.keys()), live: true }; } catch (e) { if (e.code !== 'auth') throw e; }
    }
    return { set: new Set(LS.get(sec.up, [])), live: false };
}
// Скачивает ОДИН оригинал с Диска. o: { onFrac(0..1), signal (AbortSignal), fresh (заново прочитать список Диска), refreshOnMiss (если файла нет в запомненном списке — прочитать заново), ttl (сколько мс верить запомненному списку) }.
// Возвращает 'done' | 'missing' | 'failed' | 'aborted'; при просроченном входе бросает ошибку auth. Используется и для просмотра фото (с предзагрузкой соседей), и для пакетной докачки.
async function gGalFetchOne(secKey, id, o) {
    o = o || {};
    if (!gUser || !hasValidToken()) throw gErr('auth');
    const sec = G_GAL_SECS[secKey], g = sec.list().find(x => x && x.id === id);
    if (!g) return 'missing';
    try {
        let remote = await gGalRemote(secKey, !!o.fresh, o.ttl);
        let f = remote.get(id);
        if (!f && o.refreshOnMiss && !o.fresh) { remote = await gGalRemote(secKey, true); f = remote.get(id); }
        if (!f) return 'missing';
        const raw = await gDownloadStream(f.id, o.onFrac || null, o.signal);
        const type = (f.mimeType && f.mimeType !== 'application/octet-stream' ? f.mimeType : '') || sec.mime(g), blob = new Blob([raw], { type });
        const had = await BlobDB.get(id);
        await BlobDB.putFull(id, blob, { name: g.name || 'file', type });
        if (!had || !had.thumb) {   // превью не было — делаем из файла
            let th = null;
            if (secKey === 'video') { const pr = await galVideoProbe(blob, true); th = pr.poster || null; } else th = await gMakeThumb(blob, type, true);
            if (th) await BlobDB.putThumb(id, th, {});
        }
        const up = new Set(LS.get(sec.up, [])); up.add(id);
        LS.set(sec.up, [...up]);
        return 'done';
    } catch (e) {
        if (e && e.code === 'auth') throw e;
        if (e && e.name === 'AbortError') return 'aborted';
        console.warn('Файл не скачался', id, e);
        return 'failed';
    }
}
// Скачивает оригиналы с Диска по требованию. opts: { onProgress(готово, всего, доляТекущего), ctl: { stop } }. Возвращает { done, failed, missing, stopped }
async function gGalFetchFull(secKey, ids, opts) {
    opts = opts || {};
    if (!gUser || !hasValidToken()) throw gErr('auth');
    const sec = G_GAL_SECS[secKey], meta = new Set(sec.list().map(g => g.id));
    await gGalRemote(secKey, true);   // список Диска читаем заново один раз, дальше берём из запомненного
    const res = { done: 0, failed: 0, missing: 0, stopped: false };
    const total = ids.length, report = fr => opts.onProgress && opts.onProgress(res.done + res.failed + res.missing, total, fr);
    const queue = ids.slice();
    await gPool(queue, secKey === 'video' ? 1 : 3, async id => {
        if (opts.ctl && opts.ctl.stop) { res.stopped = true; return false; }
        if (!meta.has(id)) { res.missing++; report(1); return; }
        const r = await gGalFetchOne(secKey, id, { ttl: 3600000, onFrac: total === 1 ? fr => report(fr) : null });
        if (r === 'done') res.done++; else if (r === 'missing') res.missing++; else res.failed++;
        report(1);
    });
    return res;
}


// ---------- Песни-контейнеры (1.7.0) ----------
// На Диске: iLife/Песни/<ГГГГ-ММ-ДД>/автор_название_дата_названиезаметки.mp3 — по папке на каждый день, когда песню загрузили.
// Файл помечен appProperties { kind: 'song', mid: <id аудио> }, поэтому находится по метке, а не по имени (имя можно менять).
// Блоки, подписи, заметки — в общем файле данных (список songs); картинки и голос блоков — в «Вложения» (как вложения идей).
// Аудио уходит на Диск с того устройства, где его загрузили; на других оно скачивается по требованию (gSongFetchAudio).
const gSongDirCache = {};
async function gSongDir(day) {
    if (gSongDirCache[day]) return gSongDirCache[day];
    const root = await gEnsureFolder(G_SONG_FOLDER_NAME, await gRootFolder(), 'g_song_folder');
    const dirs = LS.get('g_song_dirs', {});
    if (dirs[day]) {
        try { const f = await (await gFetch(G_DRIVE_API + '/files/' + encodeURIComponent(dirs[day]) + '?fields=id,trashed')).json(); if (!f.trashed) return (gSongDirCache[day] = dirs[day]); }
        catch (e) { if (e.code === 'auth') throw e; }
        delete dirs[day];
    }
    const found = await gList("name='" + day + "' and mimeType='" + G_FOLDER_MIME + "' and trashed=false and '" + root + "' in parents and 'me' in owners", 'id', 20, 'createdTime');
    let id = found[0] && found[0].id;
    if (!id) {
        const r = await gFetch(G_DRIVE_API + '/files?fields=id', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: day, mimeType: G_FOLDER_MIME, parents: [root] }) });
        id = (await r.json()).id;
    }
    dirs[day] = id; LS.set('g_song_dirs', dirs);
    return (gSongDirCache[day] = id);
}
async function gListSongFiles() {
    const files = await gList("appProperties has { key='kind' and value='song' } and trashed=false", 'id,name,size,modifiedTime,mimeType,parents,appProperties', 5000);
    const map = new Map();
    files.forEach(f => { const mid = f.appProperties && f.appProperties.mid; if (mid && !map.has(mid)) map.set(mid, f); });
    return map;
}
async function gUploadSong(sg, rec) {
    const dir = await gSongDir(dayKey(sg.createdAt));
    const mime = rec.type || rec.blob.type || 'audio/mpeg', name = songFileName(sg);
    const init = await gFetch(G_UPLOAD_API + '/files?uploadType=resumable&fields=id', { method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Type': mime, 'X-Upload-Content-Length': String(rec.blob.size) },
        body: JSON.stringify({ name, parents: [dir], mimeType: mime, description: 'Песня-контейнер iLife', appProperties: { mid: sg.audioId, kind: 'song' } }) });
    const loc = init.headers.get('Location');
    if (!loc) throw gErr('http', 'Google Диск не выдал адрес для загрузки файла');
    await gFetch(loc, { method: 'PUT', headers: { 'Content-Type': mime }, body: rec.blob });
    const names = LS.get('g_song_names', {}); names[sg.audioId] = name; LS.set('g_song_names', names);
}
// Отправляет аудио новых песен, переименовывает файлы при смене автора / названия / названия заметки, убирает в корзину «ничьи» файлы.
// Возвращает { up, renamed, big, warn }
async function gSyncSongs(opts) {
    const res = { up: 0, renamed: 0, big: 0, warn: '' };
    const uploaded = new Set(LS.get('g_song_up', [])), names = LS.get('g_song_names', {});
    if (!songs.length && !uploaded.size) return res;
    const idx = await BlobDB.index();
    const local = songs.filter(sg => sg.audioId && idx.get(sg.audioId) && idx.get(sg.audioId).full);
    const pend = local.filter(sg => !uploaded.has(sg.audioId));
    const renameDue = songs.some(sg => sg.audioId && uploaded.has(sg.audioId) && names[sg.audioId] && names[sg.audioId] !== songFileName(sg));
    const orphanDue = !!opts.manual && Date.now() - LS.get('g_song_orphan', 0) > G_ORPHAN_GRACE;
    if (!pend.length && !renameDue && !orphanDue) return res;
    if (!pend.length && !opts.manual && Date.now() - LS.get('g_song_try', 0) < 5 * 60000) return res;
    LS.set('g_song_try', Date.now());
    const remote = await gListSongFiles();
    remote.forEach((_, mid) => uploaded.add(mid));
    let n = 0; const total = local.filter(sg => !remote.has(sg.audioId)).length;
    for (const sg of local) {
        const f = remote.get(sg.audioId);
        if (!f) {   // на Диске нет (не загружали или файл убрали) — отправляем
            const rec = await BlobDB.get(sg.audioId);
            if (!rec || !rec.blob) continue;
            if (rec.blob.size > G_SONG_MAX) { res.big++; uploaded.add(sg.audioId); continue; }
            setCloudStatus('syncing', 'Песни: ' + (++n) + ' из ' + total);
            await gUploadSong(sg, rec); uploaded.add(sg.audioId); res.up++;
        } else if (f.name !== songFileName(sg)) {   // имя на Диске устарело
            try {
                await gFetch(G_DRIVE_API + '/files/' + encodeURIComponent(f.id) + '?fields=id', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: songFileName(sg) }) });
                names[sg.audioId] = songFileName(sg); res.renamed++;
            } catch (e) { if (e.code === 'auth') throw e; }
        } else names[sg.audioId] = f.name;
    }
    if (orphanDue) {   // файл песни, которой больше нет в списке, — в корзину Диска, но не раньше чем через сутки
        LS.set('g_song_orphan', Date.now());
        const live = gAllSongAudio();
        for (const [mid, f] of remote) {
            if (live.has(mid)) continue;
            const mt = Date.parse(f.modifiedTime); if (!mt || Date.now() - mt < G_ORPHAN_GRACE) continue;
            try { await gFetch(G_DRIVE_API + '/files/' + encodeURIComponent(f.id) + '?fields=id', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ trashed: true }) }); uploaded.delete(mid); } catch (e) { if (e.code === 'auth') throw e; }
        }
    }
    const live = gAllSongAudio();
    LS.set('g_song_up', [...uploaded].filter(id => live.has(id)));
    LS.set('g_song_names', Object.fromEntries(Object.entries(names).filter(([id]) => live.has(id))));
    if (res.big) res.warn = 'Песен крупнее ' + fmtBytes(G_SONG_MAX) + ' не отправлено на Диск: ' + res.big;
    return res;
}
// Скачивает аудио песни с Диска по требованию. Возвращает 'done' | 'missing' | 'failed' | 'aborted'; при просроченном входе бросает ошибку auth
async function gSongFetchAudio(sg, onFrac, signal) {
    if (!gUser || !hasValidToken()) throw gErr('auth');
    try {
        const f = (await gListSongFiles()).get(sg.audioId);
        if (!f) return 'missing';
        const raw = await gDownloadStream(f.id, onFrac || null, signal);
        const type = sg.audioType || (f.mimeType && f.mimeType !== 'application/octet-stream' ? f.mimeType : 'audio/mpeg');
        BlobDB.revoke(sg.audioId);
        await BlobDB.put({ id: sg.audioId, blob: new Blob([raw], { type }), name: sg.audioName || f.name, type, size: raw.size });
        const up = new Set(LS.get('g_song_up', [])); up.add(sg.audioId); LS.set('g_song_up', [...up]);
        return 'done';
    } catch (e) {
        if (e && e.code === 'auth') throw e;
        if (e && e.name === 'AbortError') return 'aborted';
        console.warn('Аудио песни не скачалось', e); return 'failed';
    }
}
function gSongOnDrive(sg) { return !!sg && new Set(LS.get('g_song_up', [])).has(sg.audioId); }

// ---------- Синхронизация ----------
function scheduleCloudSync(delay) {
    if (!gUser) return;
    clearTimeout(gTimer);
    gTimer = setTimeout(() => runCloudSync(), delay == null ? G_SYNC_DELAY : delay);
}
async function runCloudSync(opts) {
    opts = opts || {}; const manual = !!opts.manual;
    if (!gUser) return false;
    if (gRunning) { gAgain = true; return false; }
    if (!hasValidToken()) { setCloudStatus('needs-auth'); return false; }
    if (!navigator.onLine) { setCloudStatus('offline'); return false; }
    gRunning = true; setCloudStatus('syncing');
    const seq0 = gEditSeq;
    let mediaWarn = '';
    try {
        const folderId = await gEnsureFolder(G_FOLDER_NAME, '', 'g_folder');
        const file = await gFindDataFile(folderId);
        const cfg = gCfg();
        let remote = null, remoteChanged = false;
        if (file) {
            remoteChanged = file.modifiedTime !== LS.get('g_remote_mod', '');
            if (remoteChanged || LS.get('g_dirty', false) || manual) remote = await gReadJson(file.id);
        }
        if (remote) gKeysInfoSave(remote);   // для строки-подсказки в Настройках: что было на Диске при проверке
        // слияние считаем сразу после чтения, чтобы не потерять правки, сделанные во время загрузки
        const local = gLocalSnapshot();
        const merged = remote ? gMerge(local, remote) : local;
        const kk = !!local.keys;   // сравниваем ключи, только если их синхронизация включена на этом устройстве
        if (remote && gKey(merged, kk) !== gKey(local, kk)) await gApply(merged);
        const final = remote ? gLocalSnapshot() : merged;
        if (remote && !final.keys && remote.keys) { final.keys = remote.keys; final.keysAt = remote.keysAt; }   // чужие ключи в файле не теряем
        // вложения идут раньше данных: другое устройство, увидев запись, сразу найдёт и её файлы
        if (cfg.media) {
            try {
                const m = await gSyncMedia({ manual, remoteChanged });
                mediaWarn = m.warn || (m.missing ? 'Не все вложения доступны: ' + m.missing : '');
            } catch (e) { if (e.code === 'auth') throw e; console.warn('Синхронизация вложений не удалась', e); mediaWarn = 'Вложения не синхронизированы: ' + e.message; }
            try {
                const gm = await gSyncGalleryAll({ manual, remoteChanged });
                if (gm.more) gAgain = true;
                if (gm.warn && !mediaWarn) mediaWarn = gm.warn;
            } catch (e) { if (e.code === 'auth') throw e; console.warn('Синхронизация фото не удалась', e); if (!mediaWarn) mediaWarn = 'Фото «Мое_совсек» не синхронизированы: ' + e.message; }
            try {
                const sm = await gSyncSongs({ manual, remoteChanged });
                if (sm.warn && !mediaWarn) mediaWarn = sm.warn;
                if (sm.up || sm.renamed) { try { renderSongs(); } catch (e) {} }
            } catch (e) { if (e.code === 'auth') throw e; console.warn('Синхронизация песен не удалась', e); if (!mediaWarn) mediaWarn = 'Песни не синхронизированы: ' + e.message; }
        }
        if (!file) {
            const created = await gCreateDataFile(folderId, final);
            LS.set('g_remote_mod', created.modifiedTime || '');
        } else if (remote) {
            if (gKey(final) !== gKey(remote)) { const saved = await gWriteJson(file.id, final); LS.set('g_remote_mod', saved.modifiedTime || ''); }
            else LS.set('g_remote_mod', file.modifiedTime || '');
        }
        if (gEditSeq === seq0) LS.del('g_dirty'); else gAgain = true;
        LS.set('g_last', Date.now());
        setCloudStatus('ok', mediaWarn);
        return true;
    } catch (e) {
        console.warn('Синхронизация с Google Диском не удалась', e);
        if (e.code === 'auth') setCloudStatus('needs-auth'); else setCloudStatus('error', e.message);
        LS.set('g_dirty', true);
        return false;
    } finally {
        gRunning = false;
        if (gAgain) { gAgain = false; scheduleCloudSync(400); }
    }
}

// ---------- Состояние для интерфейса ----------
function setCloudStatus(state, message) { gStatus = { state, message: message || '' }; renderGoogleCardSafe(); }
function renderGoogleCardSafe() { try { if (typeof renderGoogleCard === 'function') renderGoogleCard(); } catch (e) { console.warn(e); } }
function googleInfo() {
    return { user: gUser, status: gStatus, lastSync: LS.get('g_last', 0), cfg: gCfg(), clientId: googleClientId(), source: googleClientSource(), problem: googleClientProblem(),
        blocked: googleAuthBlockedReason(), hasToken: hasValidToken(), keysInfo: LS.get('g_keys_info', null), dirty: !!LS.get('g_dirty', false), folderId: LS.get('g_folder', ''), origin: location.origin };
}
// Просьба подтвердить вход, когда токен истёк (кнопка в уведомлении = нажатие пользователя, окно Google откроется)
function gNagAuth() {
    if (!gUser || !gCfg().auto || Date.now() - gNagAt < 10 * 60000) return;
    gNagAt = Date.now();
    toast('Google Диск: подтвердите вход, чтобы продолжить синхронизацию', { action: 'Продолжить', onAction: reconnectGoogle, ms: 9000 });
}

function initCloud() {
    gLegacyStamp();
    gInitBaseline();
    gUser = LS.get('g_user', null);
    const t = LS.get('g_token', null);
    if (t && t.token && t.expiry > Date.now() + 60000) { gToken = t.token; gTokenExpiry = t.expiry; }
    if (googleClientId() && !googleAuthBlockedReason()) loadGis();
    if (gUser) {
        if (hasValidToken()) { if (gCfg().auto) runCloudSync(); else setCloudStatus('off'); }
        else { setCloudStatus('needs-auth'); setTimeout(gNagAuth, 2500); }
    }
    renderGoogleCardSafe();
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState !== 'visible' || !gUser || !gCfg().auto) return;
        if (hasValidToken()) runCloudSync(); else { setCloudStatus('needs-auth'); gNagAuth(); }
    });
    window.addEventListener('online', () => { if (gUser && gCfg().auto && hasValidToken()) runCloudSync(); });
    window.addEventListener('offline', () => { if (gUser) setCloudStatus('offline'); });
    setInterval(() => { if (gUser && gCfg().auto && document.visibilityState === 'visible' && hasValidToken()) runCloudSync(); }, 60000);
}
