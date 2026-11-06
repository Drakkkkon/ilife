'use strict';
// =====================================================================================================
// iLife — SPOTIFY: взять название песни, исполнителя и обложку альбома из ЛИЧНОГО аккаунта Spotify.
//
// Как это устроено: вход «Authorization Code with PKCE» — без серверов и без секретного ключа, всё в браузере.
// Вам нужен только Client ID вашего приложения из https://developer.spotify.com/dashboard (подробная инструкция — в
// Настройки → Spotify → «Как подключить» и в README_RU.txt). Токены хранятся только на этом устройстве (localStorage).
// Права (scope): user-read-currently-playing, user-read-playback-state, user-read-recently-played — только чтение.
//   • «Сейчас играет»  — GET /v1/me/player/currently-playing  (204 — ничего не играет);
//   • «Недавно слушали» — GET /v1/me/player/recently-played?limit=10;
//   • «Поиск»           — GET /v1/search?type=track&limit=10 (с февраля 2026 Spotify разрешает не больше 10 результатов).
// Обложка скачивается и сохраняется в памяти устройства вместе с заметкой (работает без интернета, попадает в PDF).
// Если Spotify не подключён, трек можно ввести вручную (название и исполнитель).
// =====================================================================================================

const SP_SCOPES = 'user-read-currently-playing user-read-playback-state user-read-recently-played';
const SP_AUTH = 'https://accounts.spotify.com/authorize';
const SP_TOKEN = 'https://accounts.spotify.com/api/token';
const SP_API = 'https://api.spotify.com/v1';

function spCfg() { return LS.get('spotify', {}) || {}; }
function spSave(patch) { const c = Object.assign(spCfg(), patch); LS.set('spotify', c); return c; }
function spotifyRedirectUri() {
    // Адрес страницы без параметров и без index.html: именно его нужно вписать в Redirect URIs на developer.spotify.com
    return location.origin + location.pathname.replace(/index\.html$/, '');
}
function spotifyConnected() { const c = spCfg(); return !!(c.clientId && c.refresh); }
function spotifyRedirectProblem() {
    if (location.protocol === 'file:') return 'Приложение открыто как файл. Spotify требует адрес сайта: https://… (например, GitHub Pages) или http://127.0.0.1:порт.';
    if (location.hostname === 'localhost') return 'Spotify не принимает «localhost». Откройте приложение по адресу http://127.0.0.1:порт или по https://…';
    if (location.protocol !== 'https:' && !/^(127\.0\.0\.1|\[::1\])$/.test(location.hostname)) return 'Spotify принимает адрес перенаправления только с https:// (или http://127.0.0.1).';
    if (!window.crypto || !crypto.subtle) return 'Браузер не поддерживает безопасный вход (нужен https).';
    return '';
}

// ---------- Вход (PKCE) ----------
function spRandom(n) {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
    const a = new Uint8Array(n); crypto.getRandomValues(a);
    return Array.from(a, v => chars[v % chars.length]).join('');
}
function spB64url(buf) { return btoa(String.fromCharCode.apply(null, new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
async function spotifyLogin() {
    const cfg = spCfg();
    if (!cfg.clientId) { toast('Сначала вставьте Client ID'); return; }
    const problem = spotifyRedirectProblem();
    if (problem) { toast(problem, { ms: 7000 }); return; }
    const verifier = spRandom(96), state = spRandom(24);
    const challenge = spB64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
    LS.set('sp_auth', { verifier, state, redirect: spotifyRedirectUri(), at: Date.now() });
    const q = new URLSearchParams({ client_id: cfg.clientId, response_type: 'code', redirect_uri: spotifyRedirectUri(), scope: SP_SCOPES, state, code_challenge_method: 'S256', code_challenge: challenge });
    location.href = SP_AUTH + '?' + q.toString();
}
// Вызывается при запуске: если Spotify вернул нас с ?code=… — обменивает код на токены. Возвращает true, если вход обработан.
async function spotifyHandleRedirect() {
    const p = new URLSearchParams(location.search);
    if (!p.has('code') && !p.has('error')) return false;
    const auth = LS.get('sp_auth', null);
    const clean = () => { history.replaceState(null, '', location.pathname + location.hash); LS.del('sp_auth'); };
    if (!auth || p.get('state') !== auth.state) { if (p.has('state')) { clean(); toast('Вход в Spotify отклонён: не совпал проверочный код. Попробуйте ещё раз'); return true; } return false; }
    if (p.has('error')) { clean(); toast('Spotify: ' + (p.get('error') === 'access_denied' ? 'вы отказались от доступа' : p.get('error'))); return true; }
    try {
        const cfg = spCfg();
        const res = await fetch(SP_TOKEN, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ grant_type: 'authorization_code', code: p.get('code'), redirect_uri: auth.redirect, client_id: cfg.clientId, code_verifier: auth.verifier }) });
        const data = await res.json();
        if (!res.ok || !data.access_token) throw new Error(data.error_description || data.error || ('HTTP ' + res.status));
        spSave({ access: data.access_token, refresh: data.refresh_token || cfg.refresh, expires: Date.now() + (data.expires_in || 3600) * 1000 });
        clean();
        try { const me = await spotifyApi('/me'); if (me) spSave({ user: me.display_name || me.id || '' }); } catch (e) { /* имя необязательно */ }
        toast('Spotify подключён' + (spCfg().user ? ': ' + spCfg().user : ''));
    } catch (e) {
        clean(); toast('Не удалось войти в Spotify: ' + (e.message || e), { ms: 6000 });
    }
    return true;
}
function spotifyDisconnect() { const c = spCfg(); LS.set('spotify', { clientId: c.clientId || '' }); }

// ---------- Запросы ----------
async function spRefresh() {
    const cfg = spCfg();
    if (!cfg.refresh || !cfg.clientId) throw new Error('Spotify не подключён');
    const res = await fetch(SP_TOKEN, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: cfg.refresh, client_id: cfg.clientId }) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.access_token) { if (res.status === 400 || res.status === 401) spSave({ access: '', refresh: '' }); throw new Error('Сессия Spotify истекла: подключитесь заново в Настройках'); }
    spSave({ access: data.access_token, refresh: data.refresh_token || cfg.refresh, expires: Date.now() + (data.expires_in || 3600) * 1000 });
}
async function spotifyApi(path, retry) {
    let cfg = spCfg();
    if (!cfg.access || (cfg.expires || 0) < Date.now() + 60000) { await spRefresh(); cfg = spCfg(); }
    let res;
    try { res = await fetch(SP_API + path, { headers: { Authorization: 'Bearer ' + cfg.access } }); } catch (e) { throw new Error('Нет связи со Spotify'); }
    if (res.status === 401 && !retry) { await spRefresh(); return spotifyApi(path, true); }
    if (res.status === 204) return null;
    if (res.status === 429) throw new Error('Spotify просит подождать (слишком много запросов) — повторите через минуту');
    if (res.status === 403) throw new Error('Spotify отказал в доступе (403). Проверьте: у владельца приложения активна подписка Premium, ваш аккаунт добавлен в User Management приложения, при входе вы дали все разрешения');
    if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error('Spotify: ' + ((d.error && d.error.message) || ('ошибка ' + res.status))); }
    return res.json();
}
function spMapTrack(item) {
    if (!item || item.type === 'episode') return null;
    const imgs = (item.album && item.album.images || []).slice().sort((a, b) => (b.width || 0) - (a.width || 0));
    const cover = (imgs.find(i => (i.width || 0) <= 400 && (i.width || 0) >= 200) || imgs[imgs.length - 1] || {}).url || '';
    return { id: item.id, title: item.name, artist: (item.artists || []).map(a => a.name).join(', '), album: item.album ? item.album.name : '', url: item.external_urls ? item.external_urls.spotify : '', remoteCover: cover };
}
async function spNowPlaying() { const d = await spotifyApi('/me/player/currently-playing?additional_types=track'); return d && d.item ? spMapTrack(d.item) : null; }
async function spRecent() {
    const d = await spotifyApi('/me/player/recently-played?limit=10'); const seen = new Set(), out = [];
    (d && d.items || []).forEach(x => { const t = spMapTrack(x.track); if (t && !seen.has(t.id)) { seen.add(t.id); out.push(t); } });
    return out;
}
async function spSearch(q) { const d = await spotifyApi('/search?type=track&limit=10&q=' + encodeURIComponent(q)); return ((d && d.tracks && d.tracks.items) || []).map(spMapTrack).filter(Boolean); }
async function spFetchCover(url) {
    if (!url) return null;
    try { const r = await fetch(url, { mode: 'cors' }); if (!r.ok) return null; const b = await r.blob(); return b.type.startsWith('image/') ? b : null; } catch (e) { return null; }
}

// ---------- Окно выбора трека ----------
function trackRowHtml(t, i) {
    return '<button type="button" class="track-row" data-i="' + i + '">' + (t.remoteCover ? '<img class="cv" alt="" src="' + esc(t.remoteCover) + '" loading="lazy">' : '<span class="cv">' + ic('music_note') + '</span>') +
        '<span class="tx"><div class="nm">' + esc(t.title) + '</div><div class="sub">' + esc(t.artist) + (t.album ? ' · ' + esc(t.album) : '') + '</div></span></button>';
}
function openSpotifyPicker() {
    return new Promise(resolve => {
        let result = null; const connected = spotifyConnected();
        const manual = '<div class="sp-section">Ввести вручную</div><div class="stack"><input type="text" id="sp-m-title" placeholder="Название песни" maxlength="120"><input type="text" id="sp-m-artist" placeholder="Исполнитель" maxlength="120">' +
            '<button type="button" class="btn btn-wide" id="sp-m-add">' + ic('check') + 'Добавить трек</button></div>';
        const html = connected
            ? '<div class="sp-status">' + ic('check_circle') + '<span>Spotify подключён' + (spCfg().user ? ': <b>' + esc(spCfg().user) + '</b>' : '') + '</span></div>' +
              '<button type="button" class="btn btn-primary btn-wide sp-now" id="sp-now">' + ic('headphones') + 'Взять то, что играет сейчас</button><p class="hint" id="sp-msg" style="margin:6px 4px 0"></p>' +
              '<div class="sp-section">Недавно слушали</div><div id="sp-recent"><p class="hint" style="margin:0 4px">Загружаем…</p></div>' +
              '<div class="sp-section">Найти в Spotify</div><div class="searchbar" style="box-shadow:none;background:var(--md-container-highest)">' + ic('search') + '<input type="search" id="sp-q" placeholder="Название или исполнитель" autocomplete="off"></div><div id="sp-found" style="margin-top:6px"></div>' + manual
            : '<div class="sp-status">' + ic('info') + '<span>Spotify ещё не подключён. Подключите его один раз — и кнопка будет подставлять песню, исполнителя и обложку из вашего аккаунта.</span></div>' +
              '<button type="button" class="btn btn-primary btn-wide sp-now" id="sp-go-settings">' + ic('settings') + 'Открыть настройки Spotify</button>' + manual;
        const sheet = openSheet({ title: 'Трек из Spotify', html, onClose: () => resolve(result) });
        const pick = async t => {
            const cover = await spFetchCover(t.remoteCover);
            result = Object.assign({}, t, { coverBlob: cover, coverUrl: cover ? URL.createObjectURL(cover) : t.remoteCover });
            sheet.close();
        };
        const root = sheet.el;
        $('#sp-m-add', root).addEventListener('click', () => {
            const title = $('#sp-m-title', root).value.trim(), artist = $('#sp-m-artist', root).value.trim();
            if (!title) { toast('Впишите название песни'); return; }
            result = { title, artist: artist || 'Неизвестный исполнитель', album: '', url: '', remoteCover: '', coverBlob: null, coverUrl: '' }; sheet.close();
        });
        if (!connected) { $('#sp-go-settings', root).addEventListener('click', () => { sheet.close(); showTab('settings'); setTimeout(() => { const c = $('#spotify-card'); if (c) c.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 350); }); return; }
        const msg = $('#sp-msg', root); let recent = [], found = [];
        const fail = e => { msg.textContent = e.message || String(e); };
        $('#sp-now', root).addEventListener('click', async () => {
            msg.textContent = 'Спрашиваем Spotify…';
            try { const t = await spNowPlaying(); if (t) await pick(t); else msg.textContent = 'Сейчас ничего не играет. Включите песню в Spotify или выберите из списка ниже.'; } catch (e) { fail(e); }
        });
        spRecent().then(list => { recent = list; $('#sp-recent', root).innerHTML = list.length ? list.map(trackRowHtml).join('') : '<p class="hint" style="margin:0 4px">История пуста.</p>'; }).catch(e => { $('#sp-recent', root).innerHTML = '<p class="hint" style="margin:0 4px">' + esc(e.message) + '</p>'; });
        $('#sp-recent', root).addEventListener('click', e => { const b = e.target.closest('[data-i]'); if (b) pick(recent[+b.dataset.i]); });
        $('#sp-found', root).addEventListener('click', e => { const b = e.target.closest('[data-i]'); if (b) pick(found[+b.dataset.i]); });
        $('#sp-q', root).addEventListener('input', debounce(async ev => {
            const q = ev.target.value.trim(); const box = $('#sp-found', root);
            if (q.length < 2) { box.innerHTML = ''; return; }
            try { found = await spSearch(q); box.innerHTML = found.length ? found.map(trackRowHtml).join('') : '<p class="hint" style="margin:0 4px">Ничего не нашлось.</p>'; } catch (e) { box.innerHTML = '<p class="hint" style="margin:0 4px">' + esc(e.message) + '</p>'; }
        }, 350));
    });
}
