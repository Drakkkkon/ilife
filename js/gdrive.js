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
    { key: 'movies', get: () => movies, set: v => { movies = v; } }
];

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
    if (prev && prev.email && prev.email !== gUser.email) ['g_folder', 'g_media_folder', 'g_file', 'g_remote_mod', 'g_last', 'g_up'].forEach(k => LS.del(k));
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
    ['g_user', 'g_folder', 'g_media_folder', 'g_file', 'g_remote_mod', 'g_last', 'g_up', 'g_dirty'].forEach(k => LS.del(k));
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
        if (attempt < 2) { await gSleep(700 * (attempt + 1)); return gFetch(url, options, attempt + 1); }
        throw gErr('network', 'нет связи с Google');
    }
    if (res.status === 401) { gDropToken(); throw gErr('auth'); }
    if ((res.status === 429 || res.status >= 500) && attempt < 2) { await gSleep(900 * (attempt + 1)); return gFetch(url, options, attempt + 1); }
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
    } while (page && out.length < (max && max < 1000 ? max : 10000));
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

function gScalars() { return { author: authorName(), theme: settings.theme, font: settings.font }; }
function gScalarsJson() { return JSON.stringify(gScalars()); }
function gItemJson(item) { const rest = Object.assign({}, item); delete rest.updatedAt; return JSON.stringify(rest); }
function gAsList(v) { return Array.isArray(v) ? v.filter(i => i && i.id) : (v && typeof v === 'object' ? Object.values(v).filter(i => i && i.id) : []); }

// Записям без времени изменения (дела и цены версии 1.0.0) ставим время создания/выполнения — чтобы слияние было честным
function gLegacyStamp() {
    ideas.forEach(i => { if (!i.updatedAt) i.updatedAt = i.createdAt || 0; });
    todos.forEach(t => { if (!t.updatedAt) t.updatedAt = Math.max(Number(t.addedAt) || 0, Number(t.doneAt) || 0); });
    prices.forEach(p => { if (!p.updatedAt) { const ms = keyToMs(p.date); p.updatedAt = isNaN(ms) ? 0 : ms; } });
    movies.forEach(m => { if (!m.updatedAt) m.updatedAt = Math.max(Number(m.addedAt) || 0, Number(m.watchedAt) || 0); });
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
        ideas, todos, prices, movies, scalars: gScalars(), scalarsAt: meta.scalarsAt, deleted: meta.deleted };
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
// Все файлы, на которые ссылаются данные: вложения идей, обложки треков и обложки фильмов
function gAllMediaRefs() { const s = mediaRefs(ideas); mediaRefs(movies).forEach(id => s.add(id)); return s; }
function gDraftIds() { const s = new Set(); try { (draft.files || []).forEach(f => s.add(f.id)); } catch (e) {} return s; }

// Применяет слитые данные на этом устройстве
async function gApply(merged) {
    gApplying = true;
    try {
        const oldRefs = gAllMediaRefs();
        ideas = merged.ideas; todos = merged.todos; prices = merged.prices; movies = merged.movies || [];
        const sc = merged.scalars || {};
        if (sc.author && sc.author !== settings.author) settings.author = String(sc.author).slice(0, 30);
        if (sc.theme && sc.theme !== settings.theme && PALETTES.some(p => p.id === sc.theme)) applyTheme(sc.theme);
        if (sc.font && sc.font !== settings.font && FONTS.some(f => f.id === sc.font)) applyFont(sc.font);
        LS.set('settings', settings); LS.set('ideas', ideas); LS.set('todos', todos); LS.set('prices', prices); LS.set('movies', movies);
        // ключи: берём с Диска только если синхронизация ключей включена (иначе метки времени остаются своими)
        const metaNow = gMetaGet(); let keysChanged = false, keysAt = metaNow.keysAt;
        if (gCfg().keys && merged.keys) { keysChanged = gApplyKeys(merged.keys); keysAt = gKeysAtNorm(merged.keysAt); }
        gMetaSave({ scalarsAt: Number(merged.scalarsAt) || 0, keysAt, deleted: merged.deleted });
        gInitBaseline();
        // вложения записей, удалённых или изменённых на другом устройстве, здесь больше не нужны
        const newRefs = gAllMediaRefs(), keep = gDraftIds();
        for (const id of oldRefs) if (!newRefs.has(id) && !keep.has(id)) await BlobDB.del(id);
        IX.clear(); renderIdeas(); renderTodo(); renderMovies(); renderDraft(); renderThemes();
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
async function gListMedia(folderId) {
    const files = await gList("'" + folderId + "' in parents and trashed=false", 'id,name,size,modifiedTime,mimeType,appProperties', 0);
    const map = new Map();
    files.forEach(f => {
        const mid = (f.appProperties && f.appProperties.mid) || (String(f.name || '').split('__')[0] || '');
        if (mid && !map.has(mid)) map.set(mid, f);
    });
    return map;
}
async function gUploadMedia(folderId, id) {
    const rec = await BlobDB.get(id);
    if (!rec || !rec.blob) return 'missing';
    if (rec.blob.size > G_MEDIA_MAX) return 'big';
    const mime = rec.type || rec.blob.type || 'application/octet-stream';
    const mp = gMultipart({ name: gMediaFileName(id, rec), parents: [folderId], mimeType: mime, appProperties: { mid: id } }, rec.blob, mime);
    await gFetch(G_UPLOAD_API + '/files?uploadType=multipart&fields=id', { method: 'POST', headers: { 'Content-Type': mp.type }, body: mp.body });
    return 'ok';
}
async function gMakeThumb(blob, type) {
    if (!/^image\/(jpeg|png|webp)$/.test(type || '')) return null;
    try { const bmp = await decodeImage(blob); const { w, h } = bitmapSize(bmp); const t = await canvasBlob(bmp, w, h, 480, 0.8); if (bmp.close) try { bmp.close(); } catch (e) {} return t && t.blob || null; } catch (e) { return null; }
}
async function gDownloadMedia(id, f, meta) {
    const r = await gFetch(G_DRIVE_API + '/files/' + encodeURIComponent(f.id) + '?alt=media');
    const type = f.mimeType || meta.type || 'application/octet-stream';
    const blob = new Blob([await r.blob()], { type });
    const name = meta.name || String(f.name || '').replace(/^[^_]*__/, '') || 'file';
    await BlobDB.put({ id, blob, thumb: await gMakeThumb(blob, type), name, type, size: blob.size });
}
function gMediaMeta(id) {
    for (const i of ideas) {
        const f = (i.files || []).find(x => x && x.id === id); if (f) return { name: f.name, type: f.type };
        if (i.track && i.track.coverId === id) return { name: 'cover.jpg', type: 'image/jpeg' };
    }
    for (const m of movies) if (m.coverId === id) return { name: 'poster.jpg', type: 'image/jpeg' };
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
