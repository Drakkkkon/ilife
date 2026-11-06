'use strict';
// =====================================================================================================
// iLife — YOUTUBE (версия 1.4.0): найти песню на YouTube в таком же окне, как у Spotify — обложка, название, исполнитель, длина.
//
// Откуда берутся данные (напрямую из браузера, без своего сервера):
//   • Поиск        — YouTube Data API v3: GET /search (режим «Музыка» — категория 10, «Все видео» — без категории), длина — GET /videos.
//                    Нужен бесплатный ключ API (Настройки → YouTube). Один поиск стоит 100 «единиц» из 10 000 в сутки.
//   • По ссылке    — youtu.be/…, youtube.com/watch?v=…, /shorts/…, music.youtube.com/…: с ключом берётся из /videos, без ключа — из oEmbed
//                    (название и канал, без ключа и без квоты). Если и это не вышло — песню можно дописать вручную.
//   • Недавние     — последние 10 выбранных песен хранятся на этом устройстве (ключ «yt_recent»).
// Название вида «Исполнитель - Песня (Official Video)» разбирается на исполнителя и песню; из названия убираются «Official Video», «Lyrics» и т. п.
// Выбранная песня сохраняется в идее как track { title, artist, album, url, src: 'youtube', coverId | coverUrl } — так же, как песня из Spotify.
// =====================================================================================================

const YT_API = 'https://www.googleapis.com/youtube/v3';
const YT_OEMBED = 'https://www.youtube.com/oembed';

function ytCfg() { return LS.get('youtube', {}) || {}; }
function ytKey() { return String(ytCfg().key || '').replace(/\s+/g, ''); }
function ytSave(patch) { LS.set('youtube', Object.assign(ytCfg(), patch)); if ('key' in patch && typeof cloudLocalChanged === 'function') cloudLocalChanged(); }   // ключ уходит на Google Диск (gdrive.js)
function ytErr(code, message) { const e = new Error(message); e.code = code; return e; }

// ---------- Разбор названий ----------
function ytDecode(s) { const t = document.createElement('textarea'); t.innerHTML = String(s == null ? '' : s); return t.value; }   // API отдаёт «&amp;», «&#39;»
function ytParseDuration(iso) {
    const m = /^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(String(iso || ''));
    return m ? (+m[1] || 0) * 86400 + (+m[2] || 0) * 3600 + (+m[3] || 0) * 60 + (+m[4] || 0) : 0;
}
const YT_NOISE_WORDS = 'official|video|audio|lyrics?|lyric video|visuali[sz]er|music video|full album|клип|официальн\\w*|премьера|текст|hd|4k|mv|m\\/v';
const YT_NOISE_BRACKETS = new RegExp('\\s*[\\(\\[\\{【][^\\)\\]\\}】]*?(?:' + YT_NOISE_WORDS + ')[^\\)\\]\\}】]*?[\\)\\]\\}】]', 'gi');
const YT_NOISE_TAIL = new RegExp('\\s*[|｜]\\s*(?:' + YT_NOISE_WORDS + ').*$', 'i');
function ytSplitTitle(rawTitle, channel) {
    const t = ytDecode(rawTitle).replace(YT_NOISE_BRACKETS, '').replace(YT_NOISE_TAIL, '').replace(/\s{2,}/g, ' ').trim();
    const ch = ytDecode(channel).replace(/\s*[-–—]\s*Topic$/i, '').replace(/VEVO$/i, '').replace(/\s*Official$/i, '').trim();
    const m = t.match(/^(.{1,70}?)\s+[-–—]\s+(.+)$/);
    if (m && m[1].trim() && m[2].trim()) return { artist: m[1].trim(), title: m[2].trim() };
    return { artist: ch || 'Неизвестный исполнитель', title: t || ytDecode(rawTitle).trim() };
}
function ytCover(id) { return 'https://i.ytimg.com/vi/' + id + '/mqdefault.jpg'; }
function ytMapItem(id, snippet, dur) {
    snippet = snippet || {};
    const s = ytSplitTitle(snippet.title, snippet.channelTitle);
    return { id, title: s.title, artist: s.artist, album: '', url: 'https://www.youtube.com/watch?v=' + id, remoteCover: ytCover(id), dur: dur || 0, src: 'youtube' };
}
function ytVideoId(s) {   // из ссылки или самого 11-символьного кода
    s = String(s || '').trim(); if (!s) return '';
    if (/^[\w-]{11}$/.test(s)) return s;
    let u; try { u = new URL(/^https?:\/\//i.test(s) ? s : 'https://' + s); } catch (e) { return ''; }
    const h = u.hostname.replace(/^(www|m|music)\./i, '');
    if (h === 'youtu.be') { const id = u.pathname.slice(1).split('/')[0]; return /^[\w-]{11}$/.test(id) ? id : ''; }
    if (/(^|\.)youtube(-nocookie)?\.com$/i.test(h)) {
        const v = u.searchParams.get('v'); if (/^[\w-]{11}$/.test(v || '')) return v;
        const m = u.pathname.match(/^\/(?:shorts|embed|live|v)\/([\w-]{11})/); if (m) return m[1];
    }
    return '';
}

// ---------- Запросы ----------
function ytExplain(status, j) {
    const er = (j && j.error) || {}, reason = ((er.errors || [])[0] || {}).reason || '', msg = String(er.message || '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ');
    if (/quota|dailyLimit|rateLimit/i.test(reason)) return 'Исчерпан суточный лимит YouTube (10 000 единиц, один поиск — 100). Он обновится ночью (по тихоокеанскому времени). Ссылка и ручной ввод работают.';
    if (reason === 'keyInvalid' || /API key not valid|API_KEY_INVALID/i.test(msg)) return 'Ключ YouTube не принят — проверьте, что он скопирован целиком';
    if (/referer|referrer/i.test(msg) || /Referer/i.test(reason)) return 'Ключ ограничен другими сайтами: в Google Cloud добавьте адрес этого сайта в «Application restrictions → Websites» (с «/*» на конце)';
    if (reason === 'accessNotConfigured' || /has not been used|is disabled|SERVICE_DISABLED/i.test(msg)) return 'В проекте не включён YouTube Data API v3 (APIs & Services → Library → YouTube Data API v3 → Enable)';
    if (status >= 500) return 'YouTube временно недоступен (' + status + ')';
    return 'YouTube: ошибка ' + status + (msg ? ' — ' + msg.slice(0, 140) : '');
}
async function ytApi(path, params) {
    const key = ytKey();
    if (!key) throw ytErr('nokey', 'Ключ YouTube не введён: Настройки → YouTube');
    let res;
    try { res = await fetch(YT_API + path + '?' + new URLSearchParams(Object.assign({}, params, { key })).toString()); }
    catch (e) { throw ytErr('network', 'Нет связи с YouTube'); }
    const j = await res.json().catch(() => null);
    if (!res.ok) throw ytErr(res.status, ytExplain(res.status, j));
    return j || {};
}
async function ytSearch(q, music) {
    const params = { part: 'snippet', type: 'video', maxResults: '10', q };
    if (music) params.videoCategoryId = '10';
    const items = ((await ytApi('/search', params)).items || []).filter(i => i.id && i.id.videoId);
    const durs = {};
    if (items.length) {
        try { ((await ytApi('/videos', { part: 'contentDetails', id: items.map(i => i.id.videoId).join(',') })).items || []).forEach(v => { durs[v.id] = ytParseDuration(v.contentDetails && v.contentDetails.duration); }); }
        catch (e) { /* длина необязательна */ }
    }
    return items.map(i => ytMapItem(i.id.videoId, i.snippet, durs[i.id.videoId] || 0));
}
async function ytVideoInfo(id) {
    if (ytKey()) {
        try {
            const v = ((await ytApi('/videos', { part: 'snippet,contentDetails', id })).items || [])[0];
            if (v) return ytMapItem(id, v.snippet, ytParseDuration(v.contentDetails && v.contentDetails.duration));
            throw ytErr(404, 'Видео не найдено или закрыто');
        } catch (e) { if (e.code === 404) throw e; /* квота, сеть и т. п. — пробуем oEmbed */ }
    }
    let res;
    try { res = await fetch(YT_OEMBED + '?format=json&url=' + encodeURIComponent('https://www.youtube.com/watch?v=' + id)); }
    catch (e) { throw ytErr('network', 'Не удалось получить название (нет связи или доступ закрыт) — впишите песню вручную ниже'); }
    if (!res.ok) throw ytErr(res.status, res.status === 404 || res.status === 401 || res.status === 403 ? 'Видео не найдено или закрыто для встраивания' : 'YouTube не ответил (' + res.status + ')');
    const j = await res.json().catch(() => ({}));
    return ytMapItem(id, { title: j.title, channelTitle: j.author_name }, 0);
}

// ---------- Недавно выбранные ----------
function ytRecent() { const r = LS.get('yt_recent', []); return Array.isArray(r) ? r : []; }
function ytRemember(t) {
    if (!t || !t.id) return;
    const keep = { id: t.id, title: t.title, artist: t.artist, url: t.url, remoteCover: t.remoteCover, dur: t.dur || 0, src: 'youtube', album: '' };
    LS.set('yt_recent', [keep].concat(ytRecent().filter(x => x && x.id !== t.id)).slice(0, 10));
}

// ---------- Окно выбора песни ----------
function ytRowHtml(t, i) {
    return '<button type="button" class="track-row" data-i="' + i + '"><span class="cv-wrap">' +
        (t.remoteCover ? '<img class="cv" alt="" src="' + esc(t.remoteCover) + '" loading="lazy">' : '<span class="cv">' + ic('music_note') + '</span>') + '<span class="yt-dot">' + ic('youtube') + '</span></span>' +
        '<span class="tx"><div class="nm">' + esc(t.title) + '</div><div class="sub">' + esc(t.artist) + '</div></span>' + (t.dur ? '<span class="dur">' + fmtDuration(t.dur) + '</span>' : '') + '</button>';
}
function openYoutubePicker() {
    return new Promise(resolve => {
        let result = null; const hasKey = !!ytKey();
        const status = hasKey
            ? '<div class="sp-status">' + ic('check_circle') + '<span>YouTube подключён (ключ API): поиск по песням и видео.</span></div>'
            : '<div class="sp-status">' + ic('info') + '<span>Для поиска нужен бесплатный ключ YouTube Data API. Песню можно добавить и без него — по ссылке или вручную.</span></div>' +
              '<button type="button" class="btn btn-primary btn-wide sp-now" id="yt-go-settings" style="margin-top:0.5rem">' + ic('settings') + 'Открыть настройки YouTube</button>';
        const mode0 = LS.get('yt_mode', 'music') === 'all' ? 'all' : 'music';
        const search = hasKey
            ? '<div class="sp-section">Найти на YouTube</div><div class="searchbar" style="box-shadow:none;background:var(--md-container-highest)">' + ic('search') + '<input type="search" id="yt-q" placeholder="Название песни или исполнитель" autocomplete="off" enterkeyhint="search"></div>' +
              '<div class="seg yt-seg" id="yt-mode" role="group" aria-label="Что искать"><button type="button" data-m="music" class="' + (mode0 === 'music' ? 'is-on' : '') + '">' + ic('music_note') + 'Музыка</button><button type="button" data-m="all" class="' + (mode0 === 'all' ? 'is-on' : '') + '">' + ic('youtube') + 'Все видео</button></div>' +
              '<div id="yt-found" style="margin-top:6px"></div>'
            : '';
        const link = '<div class="sp-section">По ссылке</div><div class="yt-linkrow"><input type="url" id="yt-link" placeholder="Ссылка на видео YouTube" autocomplete="off" spellcheck="false" inputmode="url">' +
            '<button type="button" class="btn" id="yt-paste" aria-label="Вставить из буфера обмена">' + ic('content_paste') + '</button><button type="button" class="btn btn-primary" id="yt-link-go">' + ic('check') + 'Найти</button></div>' +
            '<p class="hint" id="yt-msg" style="margin:6px 4px 0"></p><div id="yt-linked"></div>';
        const recent = ytRecent();
        const rec = '<div class="sp-section">Недавно выбирали</div><div id="yt-recent">' + (recent.length ? recent.map(ytRowHtml).join('') : '<p class="hint" style="margin:0 4px">Пока пусто — здесь появятся песни, которые вы выбрали.</p>') + '</div>';
        const manual = '<div class="sp-section">Ввести вручную</div><div class="stack"><input type="text" id="yt-m-title" placeholder="Название песни" maxlength="120"><input type="text" id="yt-m-artist" placeholder="Исполнитель" maxlength="120">' +
            '<input type="url" id="yt-m-url" placeholder="Ссылка (необязательно)" autocomplete="off" spellcheck="false" inputmode="url"><button type="button" class="btn btn-wide" id="yt-m-add">' + ic('check') + 'Добавить трек</button></div>';
        const sheet = openSheet({ title: 'Песня с YouTube', html: status + search + link + rec + manual, onClose: () => resolve(result) });
        const root = sheet.el;
        const pick = async t => {
            ytRemember(t);
            const cover = await spFetchCover(t.remoteCover);
            result = Object.assign({}, t, { coverBlob: cover, coverUrl: cover ? URL.createObjectURL(cover) : t.remoteCover });
            sheet.close();
        };
        // вручную
        $('#yt-m-add', root).addEventListener('click', () => {
            const title = $('#yt-m-title', root).value.trim(), artist = $('#yt-m-artist', root).value.trim(); let url = $('#yt-m-url', root).value.trim();
            if (!title) { toast('Впишите название песни'); return; }
            if (url && !/^https?:\/\//i.test(url)) url = 'https://' + url;
            const id = ytVideoId(url);
            result = { id, title, artist: artist || 'Неизвестный исполнитель', album: '', url: /^https?:\/\/[^\s]+$/i.test(url) ? url : '', remoteCover: id ? ytCover(id) : '', coverBlob: null, coverUrl: id ? ytCover(id) : '', src: id ? 'youtube' : '' };
            sheet.close();
        });
        // по ссылке
        let linked = null;
        const msg = $('#yt-msg', root);
        const goLink = async () => {
            const raw = $('#yt-link', root).value.trim(); const id = ytVideoId(raw);
            if (!raw) { msg.textContent = 'Вставьте ссылку на видео или песню YouTube.'; return; }
            if (!id) { msg.textContent = 'Не удалось найти видео в этой ссылке. Нужна ссылка вида youtu.be/… или youtube.com/watch?v=…'; return; }
            msg.textContent = 'Спрашиваем YouTube…'; $('#yt-linked', root).innerHTML = '';
            try { linked = await ytVideoInfo(id); msg.textContent = ''; $('#yt-linked', root).innerHTML = ytRowHtml(linked, 0); }
            catch (e) {
                msg.textContent = e.message || String(e);
                if (e.code === 'network' || (e.code !== 404 && e.code !== 401 && e.code !== 403)) { const u = $('#yt-m-url', root); if (u && !u.value) u.value = raw; }
            }
        };
        $('#yt-link-go', root).addEventListener('click', goLink);
        $('#yt-link', root).addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); goLink(); } });
        $('#yt-link', root).addEventListener('paste', () => setTimeout(goLink, 60));
        $('#yt-paste', root).addEventListener('click', async () => {
            try { const t = await navigator.clipboard.readText(); if (t) { $('#yt-link', root).value = t.trim(); goLink(); } else msg.textContent = 'В буфере обмена пусто.'; }
            catch (e) { msg.textContent = 'Браузер не дал прочитать буфер обмена — вставьте ссылку в поле вручную.'; }
        });
        $('#yt-linked', root).addEventListener('click', e => { if (e.target.closest('[data-i]') && linked) pick(linked); });
        // недавние
        $('#yt-recent', root).addEventListener('click', e => { const b = e.target.closest('[data-i]'); if (b && recent[+b.dataset.i]) pick(recent[+b.dataset.i]); });
        // нет ключа — только кнопка в настройки
        if (!hasKey) {
            $('#yt-go-settings', root).addEventListener('click', () => { sheet.close(); showTab('settings'); setTimeout(() => { const c = $('#yt-card'); if (c) { c.classList.remove('is-collapsed'); c.scrollIntoView({ behavior: 'smooth', block: 'start' }); } }, 350); });
            return;
        }
        // поиск (с запоминанием ответов: переключение режимов и повторные запросы не тратят квоту)
        let found = []; let mode = mode0; const cache = new Map(); let seq = 0;
        const box = $('#yt-found', root);
        const runSearch = async () => {
            const q = $('#yt-q', root).value.trim();
            if (q.length < 2) { box.innerHTML = ''; return; }
            const ck = mode + '|' + q.toLowerCase(), my = ++seq;
            if (cache.has(ck)) { found = cache.get(ck); box.innerHTML = found.length ? found.map(ytRowHtml).join('') : '<p class="hint" style="margin:0 4px">Ничего не нашлось.</p>'; return; }
            box.innerHTML = '<p class="hint" style="margin:0 4px">Ищем на YouTube…</p>';
            try {
                const list = await ytSearch(q, mode === 'music'); cache.set(ck, list);
                if (my !== seq) return;
                found = list; box.innerHTML = list.length ? list.map(ytRowHtml).join('') : '<p class="hint" style="margin:0 4px">Ничего не нашлось' + (mode === 'music' ? ' в музыке — попробуйте «Все видео»' : '') + '.</p>';
            } catch (e) { if (my === seq) box.innerHTML = '<p class="hint" style="margin:0 4px;color:var(--md-error)">' + esc(e.message || String(e)) + '</p>'; }
        };
        const q = $('#yt-q', root);
        q.addEventListener('input', debounce(runSearch, 700));   // каждый поиск стоит 100 единиц квоты — не дёргаем на каждую букву
        q.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); runSearch(); } });
        box.addEventListener('click', e => { const b = e.target.closest('[data-i]'); if (b && found[+b.dataset.i]) pick(found[+b.dataset.i]); });
        $('#yt-mode', root).addEventListener('click', e => {
            const b = e.target.closest('[data-m]'); if (!b || b.dataset.m === mode) return;
            mode = b.dataset.m; LS.set('yt_mode', mode);
            $$('#yt-mode button', root).forEach(x => x.classList.toggle('is-on', x === b));
            if (q.value.trim().length >= 2) runSearch();
        });
    });
}

// ---------- Настройки → YouTube ----------
function renderYoutubeCard() {
    if (!$('#yt-card')) return;
    const k = ytKey(), inp = $('#yt-key');
    if (document.activeElement !== inp) inp.value = k;
    const b = $('#yt-badge'); b.textContent = k ? 'Ключ введён' : 'Не подключён';
    b.style.background = k ? 'color-mix(in oklab, var(--md-income) 24%, var(--md-container))' : ''; b.style.color = k ? 'var(--md-income)' : '';
}
function initYoutube() {
    if (!$('#yt-card')) return;
    const inp = $('#yt-key');
    inp.addEventListener('change', () => { ytSave({ key: inp.value.replace(/\s+/g, '') }); renderYoutubeCard(); });
    $('#yt-show').addEventListener('click', () => {
        const show = inp.type === 'password'; inp.type = show ? 'text' : 'password';
        $('#yt-show').innerHTML = ic(show ? 'lock' : 'visibility') + (show ? 'Скрыть ключ' : 'Показать ключ');
    });
    $('#yt-test').addEventListener('click', async () => {
        ytSave({ key: inp.value.replace(/\s+/g, '') }); renderYoutubeCard();
        const out = $('#yt-test-out'), btn = $('#yt-test'); btn.disabled = true;
        out.innerHTML = '<div class="mv-test"><span class="dot"></span><b>YouTube</b><span>проверяем…</span></div>';
        let state = 'ok', text = '';
        try {
            if (!ytKey()) throw ytErr('nokey', 'ключ не введён');
            const v = ((await ytApi('/videos', { part: 'snippet', id: 'jNQXAC9IVRw' })).items || [])[0];
            text = v ? 'работает — запрос выполнен (поиск тоже должен работать)' : 'ключ принят, но тестовое видео не вернулось';
        } catch (e) { state = 'fail'; text = e.message || String(e); }
        out.innerHTML = '<div class="mv-test is-' + state + '"><span class="dot"></span><b>YouTube Data API</b><span>' + esc(text) + '</span></div>';
        btn.disabled = false;
    });
    renderYoutubeCard();
}
