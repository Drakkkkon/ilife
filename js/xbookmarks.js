'use strict';
// =====================================================================================================
// iLife — МОЕ_СОВСЕК: фото и видео из закладок X (Твиттер). Блок вверху страницы «Мое_совсек» (с версии 1.9.0).
//
// Откуда берутся данные — три способа, дальше все идут через один и тот же импорт xbImport():
//  1) «Скрипт»: код xbCollector() копируется в консоль браузера на x.com. Он сам пролистывает «Закладки», перехватывает ответы
//     самого X и сохраняет файл ilife-x-bookmarks_*.json (ссылки на фото и видео, текст, автор, дата) либо ZIP с самими файлами.
//     Скрипт ничего никуда не отправляет: всё остаётся у вас на компьютере.
//  2) «Готовый экспорт»: JSON / CSV других инструментов (например, Twitter Web Exporter), ZIP или папка с уже скачанными
//     файлами (gallery-dl и т. п.). Формат определяется сам; в крайнем случае ссылки pbs.twimg.com / video.twimg.com
//     ищутся прямо в тексте файла.
//  3) «Ссылки на посты»: ссылки вставляются в поле, фото и видео подсказывает общедоступный сервис FxTwitter (api.fxtwitter.com).
//
// Куда складывается: фото → страница «Фото и GIF», видео и GIF-анимации X (это mp4) → страница «Видео». На обеих — своя папка
// «X (Твиттер)» (год → месяц → день по дате поста) и «X · авторы» (по @имени). Файлы из X помечены src:'x' и с файлами из Telegram
// не смешиваются. Хештеги берутся из текста поста. Записи, как и остальное «Мое_совсек», уходят в Google Диск (gallery.js, gdrive.js).
//
// Официальный архив X закладок НЕ содержит, а официальный API платный — поэтому API здесь не используется.
// =====================================================================================================

const XB_PHOTO_MAX = 80 * 1048576;       // как у «Фото из Telegram»
const XB_VIDEO_MAX = 1024 * 1048576;     // как у «Видео из Telegram»
const XB_TEXT_MAX = 500;                 // подпись = текст поста, не длиннее
let xbBusy = false;
const xbUi = Object.assign({ method: 'script', photo: true, video: true, gif: true }, LS.get('xb_ui', {}));
function xbUiSave() { LS.set('xb_ui', xbUi); }

// =====================================================================================================
// 1. РАЗБОР «УЗЛА ТВИТА» из ответов X (используется и скриптом на странице X, и импортом здесь).
//    Функция самодостаточна: скрипт получает её текст и выполняет на x.com, поэтому внешних переменных у неё нет.
//    seen — Set с номерами уже учтённых медиа (чтобы один файл не попал дважды).
// =====================================================================================================
function xbTweetFromNode(node, seen) {
    var l = node && node.legacy;
    if (!l || typeof l !== 'object') return null;
    var id = String(node.rest_id || l.id_str || '');
    if (!/^\d+$/.test(id)) return null;
    if (l.retweeted_status_result || l.retweeted_status) return null;   // репост: фото и видео возьмём у исходного поста, он лежит рядом
    var ee = (l.extended_entities && l.extended_entities.media) || (l.entities && l.entities.media) || [];
    if (!ee.length) return null;
    var u = (node.core && node.core.user_results && node.core.user_results.result) || {};
    var ul = u.legacy || {}, uc = u.core || {};
    var nt = node.note_tweet && node.note_tweet.note_tweet_results && node.note_tweet.note_tweet_results.result;
    var text = String((nt && nt.text) || l.full_text || l.text || '')
        .replace(/https:\/\/t\.co\/\w+/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/[ \t]+\n/g, '\n').trim();
    var date = 0;
    try { date = Number(BigInt(id) >> BigInt(22)) + 1288834974657; } catch (e) { date = Date.parse(l.created_at || '') || 0; }   // дата поста зашита в его номере
    var user = uc.screen_name || ul.screen_name || '';
    var out = [];
    ee.forEach(function (m) {
        var mid = String(m.id_str || m.media_key || '');
        if (!mid || (seen && seen.has(mid))) return;
        var type = m.type === 'photo' ? 'photo' : m.type === 'animated_gif' ? 'gif' : m.type === 'video' ? 'video' : '';
        if (!type) return;
        var o = { id: mid, type: type, thumb: m.media_url_https || '', w: (m.original_info && m.original_info.width) || 0, h: (m.original_info && m.original_info.height) || 0 };
        if (type === 'photo') o.url = m.media_url_https || '';
        else {
            var vs = ((m.video_info && m.video_info.variants) || []).filter(function (v) { return /mp4/i.test(v.content_type || '') && v.url; });
            vs.sort(function (a, b) { return (b.bitrate || 0) - (a.bitrate || 0); });   // лучшее качество — первым
            if (!vs.length) return;
            o.url = vs[0].url; o.dur = Math.round(((m.video_info && m.video_info.duration_millis) || 0) / 1000);
        }
        if (!o.url) return;
        if (seen) seen.add(mid);
        out.push(o);
    });
    if (!out.length) return null;
    return { id: id, user: user, name: uc.name || ul.name || '', text: text, date: date, url: 'https://x.com/' + (user || 'i') + '/status/' + id, media: out };
}

// =====================================================================================================
// 2. СКРИПТ ДЛЯ СТРАНИЦЫ X. Копируется кнопкой «Скопировать скрипт» и вставляется в консоль браузера на x.com.
//    Это обычный код, его можно прочитать целиком. Он: (а) подслушивает ответы, которые X сам присылает странице
//    «Закладки»; (б) сам пролистывает список вниз; (в) по кнопке сохраняет у вас на компьютере файл-список или ZIP.
//    Ничего никуда не отправляет, пароли и ключи не читает.
// =====================================================================================================
function xbCollector(tweetFromNode) {
    var W = window, D = document;
    if (W.__ilifeX && W.__ilifeX.panel && D.body.contains(W.__ilifeX.panel)) { W.__ilifeX.panel.style.display = 'block'; return 'iLife: панель уже открыта'; }
    var tweets = new Map(), seen = new Set();
    var st = { running: false, done: false, quiet: 0, reqs: 0, lastReqs: -1, lastHeight: 0, pausedUntil: 0, startedAt: 0, busy: false };
    var timer = 0, hooked = false;

    // ---------- Панель ----------
    function el(tag, css, text) { var e = D.createElement(tag); if (css) e.style.cssText = css; if (text != null) e.textContent = text; return e; }
    function mkBtn(label, primary) {
        var b = el('button', 'cursor:pointer;border:0;border-radius:20px;padding:8px 14px;font:inherit;font-weight:600;' + (primary ? 'background:#d0bcff;color:#381e72' : 'background:#4a4458;color:#e8def8'), label);
        b.type = 'button'; return b;
    }
    var panel = el('div', 'position:fixed;right:16px;bottom:16px;z-index:2147483647;width:330px;max-width:calc(100vw - 32px);padding:14px 16px;border-radius:20px;background:#1d1b20;color:#e6e0e9;font:14px/1.45 system-ui,Segoe UI,Roboto,sans-serif;box-shadow:0 8px 32px rgba(0,0,0,.55);border:1px solid #49454f');
    var head = el('div', 'display:flex;align-items:center;gap:8px;margin-bottom:6px');
    head.appendChild(el('b', 'flex:1;font-size:15px', 'iLife · закладки X'));
    var hide = mkBtn('✕'); hide.style.padding = '2px 10px'; hide.title = 'Скрыть панель (сбор не остановится)';
    head.appendChild(hide);
    var cnt = el('div', 'font-weight:600;margin-bottom:2px');
    var msg = el('div', 'color:#cac4d0;font-size:13px;margin-bottom:10px;min-height:36px');
    var bar = el('div', 'height:6px;border-radius:3px;background:#36343b;overflow:hidden;margin-bottom:10px;display:none');
    var barIn = el('div', 'height:100%;width:0;background:#d0bcff'); bar.appendChild(barIn);
    var row = el('div', 'display:flex;flex-wrap:wrap;gap:8px');
    var bGo = mkBtn('Начать', true), bJson = mkBtn('Скачать файл (.json)'), bZip = mkBtn('Скачать с файлами (ZIP)');
    row.appendChild(bGo); row.appendChild(bJson); row.appendChild(bZip);
    panel.appendChild(head); panel.appendChild(cnt); panel.appendChild(msg); panel.appendChild(bar); panel.appendChild(row);
    D.body.appendChild(panel);

    function counts() {
        var ph = 0, vd = 0, gf = 0;
        tweets.forEach(function (t) { t.media.forEach(function (m) { if (m.type === 'photo') ph++; else if (m.type === 'gif') gf++; else vd++; }); });
        return { posts: tweets.size, photo: ph, video: vd, gif: gf };
    }
    function say(t) { msg.textContent = t; }
    function paint() {
        var c = counts();
        cnt.textContent = 'Постов с медиа: ' + c.posts + ' · фото: ' + c.photo + ' · видео: ' + c.video + ' · GIF: ' + c.gif;
        bGo.textContent = st.running ? 'Остановить' : (c.posts ? 'Продолжить' : 'Начать');
        bGo.disabled = st.busy; bJson.disabled = st.busy; bZip.disabled = st.busy;
        bJson.style.display = c.posts ? '' : 'none'; bZip.style.display = c.posts ? '' : 'none';
        bJson.style.opacity = bZip.style.opacity = bGo.style.opacity = st.busy ? '.5' : '1';
    }

    // ---------- Разбор ответов X ----------
    function walk(n, d) {
        if (!n || typeof n !== 'object' || d > 60) return;
        if (Array.isArray(n)) { for (var i = 0; i < n.length; i++) walk(n[i], d + 1); return; }
        if (n.legacy && typeof n.legacy === 'object' && (n.rest_id || n.legacy.id_str)) {
            try {
                var t = tweetFromNode(n, seen);
                if (t) { var cur = tweets.get(t.id); if (cur) t.media.forEach(function (m) { cur.media.push(m); }); else tweets.set(t.id, t); }
            } catch (e) { /* странный узел — пропускаем */ }
        }
        for (var k in n) { var v = n[k]; if (v && typeof v === 'object') walk(v, d + 1); }
    }
    function feed(json) { st.reqs++; walk(json, 0); paint(); }
    function rate() { st.pausedUntil = Date.now() + 65000; }
    function isBm(u) { return /\/graphql\/[^\/]+\/(Bookmarks|BookmarkFolderTimeline|BookmarkSearchTimeline)\b/.test(String(u || '')); }
    function hook() {
        if (hooked) return; hooked = true;
        var of = W.fetch;
        if (of) W.fetch = function () {
            var a = arguments, p = of.apply(this, a);
            try {
                var u = typeof a[0] === 'string' ? a[0] : (a[0] && a[0].url) || '';
                if (isBm(u)) p.then(function (r) { if (r.status === 429) { rate(); return; } r.clone().json().then(feed).catch(function () {}); }, function () {});
            } catch (e) { /* не мешаем странице */ }
            return p;
        };
        var X = W.XMLHttpRequest && W.XMLHttpRequest.prototype;
        if (X) {
            var oo = X.open, os = X.send;
            X.open = function (m, u) { this.__ilifeUrl = u; return oo.apply(this, arguments); };
            X.send = function () {
                var x = this;
                if (isBm(x.__ilifeUrl)) x.addEventListener('load', function () { try { if (x.status === 429) { rate(); return; } feed(JSON.parse(x.responseText)); } catch (e) { /* не JSON */ } });
                return os.apply(this, arguments);
            };
        }
    }

    // ---------- Пролистывание ----------
    function finish(why) {
        st.running = false; st.done = true; clearTimeout(timer);
        var c = counts();
        say(why || ('Готово: закладки закончились. Найдено фото: ' + c.photo + ', видео: ' + c.video + ', GIF: ' + c.gif + '. Теперь нажмите «Скачать».'));
        paint();
    }
    function loop() {
        if (!st.running) return;
        var now = Date.now();
        if (now < st.pausedUntil) { say('X просит подождать (ограничение частоты). Продолжу через ' + Math.ceil((st.pausedUntil - now) / 1000) + ' с…'); timer = setTimeout(loop, 1000); return; }
        var h = D.documentElement.scrollHeight;
        W.scrollTo(0, h);
        setTimeout(function () { W.scrollBy(0, -500); setTimeout(function () { W.scrollTo(0, D.documentElement.scrollHeight); }, 300); }, 600);   // «подёргивание» вверх-вниз: так X надёжнее подгружает следующую порцию
        var c = counts();
        if (st.reqs === 0) {
            if (now - st.startedAt > 25000) say('Пока ничего не поймано. Нажмите вручную в меню слева «Главная», затем «Закладки» — сбор начнётся сам.');
            else say('Ждём ответ X…');
            st.quiet = 0;
        } else {
            var progressed = st.reqs !== st.lastReqs || h !== st.lastHeight;
            st.lastReqs = st.reqs; st.lastHeight = h;
            st.quiet = progressed ? 0 : st.quiet + 1;
            say('Листаю закладки… загружено порций: ' + st.reqs + '. Не закрывайте вкладку.');
            if (st.quiet >= 7) { finish(); return; }
        }
        paint();
        timer = setTimeout(loop, 1500 + Math.random() * 900);
    }
    function start() {
        hook();
        st.running = true; st.done = false; st.quiet = 0; st.startedAt = Date.now(); st.lastReqs = -1;
        say('Запускаю…'); paint();
        if (st.reqs === 0) {   // страница «Закладки» уже загружена без нас — перезагружаем её переходом «Главная» → «Закладки» внутри X
            var home = D.querySelector('a[href="/home"]'), bm = D.querySelector('a[href="/i/bookmarks"]');
            if (/\/i\/bookmarks/.test(location.pathname)) {
                if (home && bm) { home.click(); setTimeout(function () { var b = D.querySelector('a[href="/i/bookmarks"]'); if (b) b.click(); }, 1800); }
                else say('Нажмите в меню слева «Главная», а потом «Закладки».');
            } else if (bm) bm.click();
            else say('Откройте «Закладки» в меню слева — сбор начнётся сам.');
        }
        timer = setTimeout(loop, 3500);
    }
    function stop() { st.running = false; clearTimeout(timer); say('Остановлено. Можно скачать то, что собрано, или нажать «Продолжить».'); paint(); }

    // ---------- Сохранение: файл-список и ZIP с файлами ----------
    function stamp() { var d = new Date(), p = function (n) { return String(n).padStart(2, '0'); }; return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()); }
    function saveBlob(blob, name) {
        var url = URL.createObjectURL(blob), a = D.createElement('a');
        a.href = url; a.download = name; a.style.display = 'none'; D.body.appendChild(a); a.click();
        setTimeout(function () { a.remove(); URL.revokeObjectURL(url); }, 60000);
    }
    function payload(list) { return { format: 'ilife-x-bookmarks', version: 1, exportedAt: new Date().toISOString(), tweets: list || Array.from(tweets.values()) }; }
    function saveJson() {
        saveBlob(new Blob([JSON.stringify(payload())], { type: 'application/json' }), 'ilife-x-bookmarks_' + stamp() + '.json');
        say('Файл сохранён (папка «Загрузки»). Откройте iLife → Мое_совсек → «Скрипт» → «Выбрать файл от скрипта».');
    }
    var crcT = null;
    function crcTable() { if (crcT) return crcT; crcT = new Uint32Array(256); for (var n = 0; n < 256; n++) { var c = n; for (var k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; crcT[n] = c >>> 0; } return crcT; }
    async function crcBlob(b) {
        var t = crcTable(), c = 0xFFFFFFFF;
        for (var o = 0; o < b.size; o += 4194304) { var u = new Uint8Array(await b.slice(o, o + 4194304).arrayBuffer()); for (var i = 0; i < u.length; i++) c = t[(c ^ u[i]) & 255] ^ (c >>> 8); }
        return (c ^ 0xFFFFFFFF) >>> 0;
    }
    async function makeZip(files) {   // ZIP без сжатия: фото и видео и так сжаты
        var enc = new TextEncoder(), parts = [], central = [], offset = 0, cd = 0, now = new Date();
        var dt = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate(), tm = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
        for (var n = 0; n < files.length; n++) {
            var f = files[n], name = enc.encode(f.name), size = f.blob.size, crc = await crcBlob(f.blob);
            var lh = new DataView(new ArrayBuffer(30));
            lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true); lh.setUint16(8, 0, true); lh.setUint16(10, tm, true); lh.setUint16(12, dt, true);
            lh.setUint32(14, crc, true); lh.setUint32(18, size, true); lh.setUint32(22, size, true); lh.setUint16(26, name.length, true); lh.setUint16(28, 0, true);
            parts.push(lh.buffer, name, f.blob);
            var ch = new DataView(new ArrayBuffer(46));
            ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true); ch.setUint16(10, 0, true); ch.setUint16(12, tm, true); ch.setUint16(14, dt, true);
            ch.setUint32(16, crc, true); ch.setUint32(20, size, true); ch.setUint32(24, size, true); ch.setUint16(28, name.length, true); ch.setUint32(42, offset, true);
            central.push(ch.buffer, name); cd += 46 + name.length; offset += 30 + name.length + size;
        }
        var end = new DataView(new ArrayBuffer(22));
        end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true); end.setUint32(12, cd, true); end.setUint32(16, offset, true);
        return new Blob(parts.concat(central, [end.buffer]), { type: 'application/zip' });
    }
    function photoUrls(u) {   // самый крупный вариант картинки; если не вышло — запасные
        var m = /^(https?:\/\/pbs\.twimg\.com\/media\/[^?.:\/]+)(?:\.(\w+))?/.exec(u);
        if (!m) return [u];
        var f = (m[2] || 'jpg').toLowerCase();
        return [m[1] + '?format=' + f + '&name=orig', m[1] + '?format=' + f + '&name=4096x4096', m[1] + '.' + f];
    }
    async function fetchMedia(m) {
        var urls = m.type === 'photo' ? photoUrls(m.url) : [m.url], last = null;
        for (var i = 0; i < urls.length; i++) {
            try { var r = await fetch(urls[i], { credentials: 'omit' }); if (r.ok) return await r.blob(); last = new Error('HTTP ' + r.status); } catch (e) { last = e; }
        }
        throw last || new Error('нет ответа');
    }
    function safe(s) { return String(s || '').replace(/[^A-Za-z0-9_\-]+/g, '_').slice(0, 40) || 'x'; }
    async function saveZip() {
        if (st.busy) return;
        st.busy = true; paint(); bar.style.display = 'block';
        var LIMIT = 600 * 1048576, part = [], partTweets = new Map(), size = 0, partNo = 0, ok = 0, fail = 0, total = 0, doneN = 0, tag = stamp();
        tweets.forEach(function (t) { total += t.media.length; });
        async function flushPart() {
            if (!part.length) return;
            partNo++;
            var json = new Blob([JSON.stringify(payload(Array.from(partTweets.values())))], { type: 'application/json' });
            var z = await makeZip([{ name: 'bookmarks.json', blob: json }].concat(part));
            saveBlob(z, 'ilife-x-bookmarks_' + tag + '_part' + partNo + '.zip');
            part = []; partTweets = new Map(); size = 0;
        }
        try {
            var list = Array.from(tweets.values());
            for (var a = 0; a < list.length; a++) {
                var t = list[a];
                for (var b = 0; b < t.media.length; b++) {
                    var m = t.media[b];
                    say('Скачиваю файлы: ' + (doneN + 1) + ' из ' + total + (fail ? ' · не вышло: ' + fail : '') + '. Не закрывайте вкладку.');
                    barIn.style.width = Math.round(100 * doneN / Math.max(total, 1)) + '%';
                    doneN++;
                    try {
                        var blob = await fetchMedia(m);
                        var ext = m.type === 'photo' ? (blob.type === 'image/png' ? 'png' : blob.type === 'image/webp' ? 'webp' : blob.type === 'image/gif' ? 'gif' : 'jpg') : 'mp4';
                        var file = (m.type === 'photo' ? 'photos/' : 'videos/') + safe(t.user) + '_' + t.id + '_' + (b + 1) + '.' + ext;
                        part.push({ name: file, blob: blob }); size += blob.size; ok++;
                        var pt = partTweets.get(t.id);
                        if (!pt) { pt = Object.assign({}, t, { media: [] }); partTweets.set(t.id, pt); }
                        pt.media.push(Object.assign({}, m, { file: file }));
                        if (size > LIMIT) await flushPart();
                    } catch (e) { fail++; }
                }
            }
            await flushPart();
            barIn.style.width = '100%';
            say(ok ? 'Готово: файлов ' + ok + (fail ? ', не скачались: ' + fail : '') + '. Архивов: ' + partNo + ' (папка «Загрузки»). Выберите их в iLife все сразу. Если браузер спрашивает про несколько загрузок — разрешите.' : 'Не удалось скачать ни одного файла.');
        } catch (e) { say('Ошибка: ' + (e && e.message ? e.message : e)); }
        st.busy = false; bar.style.display = 'none'; paint();
    }

    bGo.addEventListener('click', function () { if (st.running) stop(); else start(); });
    bJson.addEventListener('click', saveJson);
    bZip.addEventListener('click', saveZip);
    hide.addEventListener('click', function () { panel.style.display = 'none'; });
    W.__ilifeX = { panel: panel, tweets: tweets, state: st, start: start };
    hook();   // подслушивать начинаем сразу, ещё до кнопки «Начать»
    say('Нажмите «Начать»: скрипт сам откроет «Закладки» и пролистает их до конца.');
    paint();
    return 'iLife: панель открыта в правом нижнем углу страницы';
}
function xbScriptText() {
    return '/* iLife — сбор фото и видео из закладок X. Запускать только на странице x.com. Скрипт ничего никуда не отправляет: файлы сохраняются у вас на компьютере. */\n' +
        '(' + xbCollector.toString() + ')(' + xbTweetFromNode.toString() + ');\n';
}

// =====================================================================================================
// 3. ЧТЕНИЕ ТОГО, ЧТО ПРИНЕСЛИ: JSON, CSV/текст, ZIP, файлы, ссылки
//    Всё приводится к одному виду: пост { id, user, name, text, date, media: [{ id, type: photo|video|gif, url, thumb, w, h, dur, get?, entry?, name? }] }
// =====================================================================================================
const XB_IMG_RE = /\.(jpe?g|png|webp|gif|bmp)$/i, XB_VID_RE = /\.(mp4|mov|webm|mkv|m4v)$/i;
function xbSnowDate(id) { try { const ms = Number(BigInt(String(id)) >> BigInt(22)) + 1288834974657; return ms > 1141000000000 && ms < Date.now() + 864e5 ? ms : 0; } catch (e) { return 0; } }
function xbMediaTypeOfName(name) { return XB_VID_RE.test(name || '') ? 'video' : XB_IMG_RE.test(name || '') ? 'photo' : ''; }
function xbExtOf(s) {
    s = String(s || ''); const f = /[?&]format=([a-z0-9]{2,4})/i.exec(s); if (f) return f[1].toLowerCase();
    const m = /\.([a-z0-9]{2,4})$/i.exec(s.split(/[?#]/)[0].replace(/:(orig|large|medium|small|thumb)$/i, '')); return m ? m[1].toLowerCase() : '';
}
function xbNormType(t, url) {
    t = String(t || '').toLowerCase();
    if (t === 'photo' || t === 'image' || t === 'img') return 'photo';
    if (t === 'animated_gif' || t === 'gif') return 'gif';
    if (t === 'video') return 'video';
    return XB_VID_RE.test(String(url || '').split(/[?#]/)[0]) ? 'video' : 'photo';
}
// Приводит пост из любого источника к общему виду; file — путь файла внутри ZIP/папки (если скрипт положил файлы рядом)
function xbNormPost(p, resolve) {
    const id = p.id != null ? String(p.id) : '';
    const post = { id: /^\d+$/.test(id) ? id : '', user: String(p.user || '').replace(/^@/, ''), name: String(p.name || ''), text: String(p.text || ''), date: Number(p.date) || 0, media: [] };
    if (!post.date && post.id) post.date = xbSnowDate(post.id);
    (p.media || []).forEach((m, i) => {
        const url = String(m.url || ''), file = m.file ? String(m.file) : '';
        const entry = file && resolve ? resolve(file) : null;
        if (!url && !entry && !m.get) return;
        post.media.push({ id: String(m.id || m.media_key || ('i' + i + tgHash(url || file))), type: xbNormType(m.type, url || file), url, thumb: String(m.thumb || ''), w: +m.w || 0, h: +m.h || 0, dur: +m.dur || 0, entry, name: m.name || '', get: m.get || (entry ? () => entry.get() : null) });
    });
    return post;
}
function xbPostFromLoose(o) {   // «похожий на пост» объект из чужого экспорта (Twitter Web Exporter и т. п.)
    const list = [];
    (o.media || []).forEach((m, i) => {
        if (!m || typeof m !== 'object') return;
        const url = [m.original, m.url, m.media_url_https, m.src, m.download_url, m.video_url].find(x => typeof x === 'string' && /^https?:/i.test(x));
        if (!url) return;
        list.push({ id: m.id_str || m.id || m.media_key || ('i' + i), type: xbNormType(m.type, url), url, thumb: m.thumbnail || m.thumb || m.preview_image_url || m.media_url_https || '', w: m.width || (m.original_info && m.original_info.width) || 0, h: m.height || (m.original_info && m.original_info.height) || 0, dur: m.duration || 0 });
    });
    if (!list.length) return null;
    const u = o.user || o.author || {}, ts = o.created_at || o.date || o.created_timestamp;
    return { id: o.id_str || o.rest_id || o.tweet_id || o.id, user: o.screen_name || o.username || u.screen_name || u.username || '', name: o.name || u.name || '', text: o.full_text || o.text || '', date: typeof ts === 'number' ? (ts < 1e12 ? ts * 1000 : ts) : Date.parse(ts || '') || 0, media: list };
}
function xbPostsFromJson(data, resolve) {
    if (data && data.format === 'ilife-x-bookmarks' && Array.isArray(data.tweets)) return data.tweets.map(t => xbNormPost(t, resolve)).filter(p => p.media.length);
    const seen = new Set(), posts = new Map();
    const add = p => {
        if (!p || !p.media.length) return;
        const k = p.id || ('n' + posts.size), cur = posts.get(k);
        if (!cur) { posts.set(k, p); return; }
        p.media.forEach(m => { if (!cur.media.some(x => x.id === m.id || (x.url && x.url === m.url))) cur.media.push(m); });
    };
    (function walk(n, d, key) {
        if (!n || typeof n !== 'object' || d > 60) return;
        if (Array.isArray(n)) { n.forEach(x => walk(x, d + 1, key)); return; }
        // «entities»/«extended_entities» — это уже разобранное содержимое поста: заново как отдельный «свободный» пост их не читаем (иначе дубли без номера поста)
        const inside = key === 'entities' || key === 'extended_entities';
        let g = null;
        if (!inside) {
            g = xbTweetFromNode(n, seen);
            // старый формат (API v1.1, архив tweets.js): поля поста лежат прямо в объекте, автор — в user
            if (!g && n.id_str && n.extended_entities && typeof n.extended_entities === 'object') g = xbTweetFromNode({ rest_id: n.id_str, legacy: n, core: { user_results: { result: { legacy: n.user || {} } } } }, seen);
            if (g) add(xbNormPost(g, resolve));
            else if (Array.isArray(n.media) && n.media.length && typeof n.media[0] === 'object') { const p = xbPostFromLoose(n); if (p) add(xbNormPost(p, resolve)); }
        }
        for (const k in n) { const v = n[k]; if (v && typeof v === 'object') walk(v, d + 1, k); }
    })(data, 0, '');
    return Array.from(posts.values());
}
// Запасной путь: в любом тексте (CSV, неизвестный JSON) ищем адреса картинок и видео X. Номер поста берём из «…/status/123» в той же строке.
function xbPostsFromText(text) {
    const re = /https?:\/\/(?:pbs\.twimg\.com\/media\/[\w\-]+(?:\.\w{2,4})?(?:\?[^\s"'<>,)\\]*)?|video\.twimg\.com\/[^\s"'<>,)\\]+?\.mp4(?:\?[^\s"'<>,)\\]*)?)/g;
    const posts = new Map(); let n = 0;
    String(text || '').replace(/\\\//g, '/').split(/\r?\n/).forEach(line => {
        const urls = line.match(re); if (!urls) return;
        const sm = /(?:x|twitter)\.com\/(?:([A-Za-z0-9_]{1,15})\/)?status\/(\d{15,20})/i.exec(line), id = sm ? sm[2] : '';
        const k = id || ('l' + (n++));
        let p = posts.get(k); if (!p) posts.set(k, p = { id, user: sm && sm[1] && sm[1].toLowerCase() !== 'i' ? sm[1] : '', name: '', text: '', date: 0, media: [] });
        Array.from(new Set(urls)).forEach(u => { if (!p.media.some(x => x.url === u)) p.media.push({ id: 'u' + tgHash(u.split('?')[0]), type: xbNormType('', u), url: u }); });
    });
    return Array.from(posts.values()).map(p => xbNormPost(p));
}
// Файлы, которые просто лежат в папке или ZIP (например, из gallery-dl: «twitter/ИМЯ/1234567890123456789_1.jpg»)
function xbPostsFromFiles(entries) {
    const map = new Map();
    entries.forEach((e, i) => {
        const path = String(e.path || '').replace(/\\/g, '/'), parts = path.split('/'), name = parts.pop(), dir = parts.pop() || '';
        const idm = /(?:^|[^0-9])(\d{15,20})(?=[_\-.]|$)/.exec(name), id = idm && xbSnowDate(idm[1]) ? idm[1] : '';
        const um = /^([A-Za-z0-9_]{1,15})[-_]\d{15,20}/.exec(name);
        const user = um ? um[1] : (/^[A-Za-z0-9_]{1,15}$/.test(dir) && !/^(twitter|x|photos|videos|media|images?|pictures|bookmarks?|downloads?|gallery-dl|data)$/i.test(dir) ? dir : '');
        const k = id || ('f' + i);
        let p = map.get(k); if (!p) map.set(k, p = { id, user, name: '', text: '', date: 0, media: [] });
        p.media.push({ id: 'f' + tgHash(path) + '-' + (e.size || 0), type: xbMediaTypeOfName(name) || 'photo', url: '', name, entry: e, get: () => e.get() });
    });
    return Array.from(map.values()).map(p => xbNormPost(p));
}
// Ссылки на посты → фото и видео через FxTwitter
function xbParseLinks(text) {
    const out = new Map(), re = /(?:https?:\/\/)?(?:www\.|mobile\.)?(?:x|twitter|fxtwitter|vxtwitter|fixupx|fixvx)\.com\/(?:([A-Za-z0-9_]{1,15})\/)?status(?:es)?\/(\d{6,20})/gi;
    let m; while ((m = re.exec(String(text || '')))) { if (!out.has(m[2])) out.set(m[2], { id: m[2], user: m[1] && m[1].toLowerCase() !== 'i' ? m[1] : '' }); }
    return Array.from(out.values());
}
async function xbFetchFx(link, signal) {
    let res;
    try { res = await fetch('https://api.fxtwitter.com/' + encodeURIComponent(link.user || 'i') + '/status/' + link.id, { mode: 'cors', credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store', signal }); }
    catch (e) { const er = new Error('Не удалось связаться с сервисом FxTwitter'); er.code = e && e.name === 'AbortError' ? 'abort' : 'net'; throw er; }
    if (res.status === 404) { const er = new Error('Пост не найден или закрыт'); er.code = 'gone'; throw er; }
    if (!res.ok) { const er = new Error('FxTwitter ответил ошибкой ' + res.status); er.code = 'http'; throw er; }
    const j = await res.json(), t = j && j.tweet; if (!t) { const er = new Error('Пост не найден'); er.code = 'gone'; throw er; }
    const all = (t.media && (t.media.all || [].concat(t.media.photos || [], t.media.videos || []))) || [];
    return xbNormPost({ id: t.id || link.id, user: (t.author && t.author.screen_name) || link.user, name: t.author && t.author.name, text: t.text, date: t.created_timestamp ? t.created_timestamp * 1000 : 0,
        media: all.map((x, i) => ({ id: x.id || ('i' + i + tgHash(x.url)), type: x.type === 'photo' ? 'photo' : x.type === 'gif' ? 'gif' : 'video', url: x.url, thumb: x.thumbnail_url || '', w: x.width, h: x.height, dur: x.duration })).filter(x => x.url) });
}

// =====================================================================================================
// 4. СКАЧИВАНИЕ И СОХРАНЕНИЕ
// =====================================================================================================
async function xbFetchBlob(url, o) {
    o = o || {}; let res;
    try { res = await fetch(url, { mode: 'cors', credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store', signal: o.signal }); }
    catch (e) { const er = new Error('network'); er.code = e && e.name === 'AbortError' ? 'abort' : 'net'; throw er; }
    if (!res.ok) { const er = new Error('HTTP ' + res.status); er.code = 'http'; er.status = res.status; throw er; }
    const tooBig = () => { const er = new Error('big'); er.code = 'big'; return er; };
    const total = Number(res.headers.get('content-length')) || 0;
    if (o.max && total > o.max) throw tooBig();
    const type = (res.headers.get('content-type') || '').split(';')[0].trim();
    if (!res.body || !res.body.getReader) { const b = await res.blob(); if (o.max && b.size > o.max) throw tooBig(); return b; }
    const rd = res.body.getReader(), chunks = []; let got = 0;
    for (;;) {
        let r; try { r = await rd.read(); } catch (e) { const er = new Error('network'); er.code = e && e.name === 'AbortError' ? 'abort' : 'net'; throw er; }
        if (r.done) break;
        chunks.push(r.value); got += r.value.length;
        if (o.max && got > o.max) { try { rd.cancel(); } catch (e) { /* уже закрыт */ } throw tooBig(); }
        if (o.onProgress) o.onProgress(got, total);
    }
    return new Blob(chunks, type ? { type } : {});
}
function xbPhotoUrls(u) {   // сначала самый крупный вариант (name=orig), потом запасные
    const m = /^(https?:\/\/pbs\.twimg\.com\/media\/[^?.:\/]+)(?:\.(\w+))?/.exec(String(u));
    if (!m) return [u];
    const f = (m[2] || 'jpg').toLowerCase();
    return [m[1] + '?format=' + f + '&name=orig', m[1] + '?format=' + f + '&name=4096x4096', m[1] + '.' + f];
}
async function xbFetchFirst(urls, o) {
    let last = null;
    for (const u of urls) {
        for (let attempt = 0; attempt < 2; attempt++) {
            try { return await xbFetchBlob(u, o); }
            catch (e) { last = e; if (e.code === 'abort' || e.code === 'big') throw e; if (e.code === 'http') break; if (attempt === 0) await galSleep(700); }
        }
    }
    throw last || new Error('network');
}
function xbWanted() { return { photo: !!xbUi.photo, video: !!xbUi.video, gif: !!xbUi.gif }; }
function xbExtForBlob(blob, c) {
    const t = (blob.type || '').toLowerCase();
    if (/png/.test(t)) return 'png'; if (/webp/.test(t)) return 'webp'; if (/gif/.test(t)) return 'gif'; if (/jpe?g/.test(t)) return 'jpg';
    if (/mp4/.test(t)) return 'mp4'; if (/quicktime/.test(t)) return 'mov'; if (/webm/.test(t)) return 'webm';
    return xbExtOf(c.m.name || c.m.url) || (c.sec === 'video' ? 'mp4' : 'jpg');
}
function xbPlan(posts) {   // пост → список файлов с указанием, на какую страницу они пойдут
    const out = [];
    posts.forEach(p => (p.media || []).forEach(m => {
        const ext = xbExtOf(m.name || m.url);
        let sec, kind;
        if (m.type === 'gif') { if (ext === 'gif') { sec = 'photo'; kind = 'gif'; } else { sec = 'video'; kind = 'anim'; } }   // X отдаёт GIF как mp4-петлю
        else if (m.type === 'video') { sec = 'video'; kind = 'video'; }
        else { sec = 'photo'; kind = ext === 'gif' ? 'gif' : 'image'; }
        const key = p.id ? 'x:' + p.id + ':' + m.id : 'x:' + (m.entry ? 'f:' + tgHash(m.entry.path) + ':' + m.entry.size : 'u:' + tgHash(String(m.url).split('?')[0]));
        out.push({ p, m, sec, kind, key });
    }));
    return out;
}
function xbGuard() {
    if (xbBusy || GAL.photo.isBusy() || GAL.video.isBusy()) { toast('Уже идёт обработка — подождите'); return true; }
    return false;
}

// Главный импорт. posts — в общем виде (см. выше). Возвращает итог (для окна «Готово») или null, если ничего не запускалось.
async function xbImport(posts, opts) {
    opts = opts || {};
    if (xbGuard()) return null;
    const want = xbWanted(), stat = { posts: posts.length, off: 0, old: 0, tomb: 0, bad: 0, big: 0, gone: 0, net: 0, added: { photo: 0, video: 0, gif: 0 }, failed: [], stopped: false, cors: false };
    const plan = xbPlan(posts).filter(c => {
        const ok = c.kind === 'gif' || c.kind === 'anim' ? want.gif : c.sec === 'photo' ? want.photo : want.video;
        if (!ok) stat.off++;
        return ok;
    });
    const secs = { photo: GAL.photo, video: GAL.video }, dkey = { photo: 'gallery', video: 'videos' };
    const known = { photo: new Set(), video: new Set() };
    ['photo', 'video'].forEach(s => secs[s].list().forEach(g => { if (g.k) known[s].add(g.k); known[s].add(g.id); }));
    const meta = typeof gMetaGet === 'function' ? gMetaGet() : { deleted: {} };
    const todo = [];
    plan.forEach(c => {
        c.id = secs[c.sec].makeId(c.key);
        if (known[c.sec].has(c.key) || known[c.sec].has(c.id)) { stat.old++; return; }
        if (((meta.deleted || {})[dkey[c.sec]] || {})[c.id]) { stat.tomb++; return; }
        todo.push(c);
    });
    if (!todo.length) return { stat, empty: true };

    xbBusy = true; GAL.photo.setBusy(true); GAL.video.setBusy(true); xbRender();
    const ui = galProgressSheet('Фото и видео из X'), ctl = ui.ctl, abort = typeof AbortController !== 'undefined' ? new AbortController() : null;
    let stopped = false;   // «Остановить» или закрытие окна: заодно обрываем скачивание, которое сейчас идёт
    Object.defineProperty(ctl, 'stop', { configurable: true, get: () => stopped, set(v) { stopped = !!v; if (stopped && abort) { try { abort.abort(); } catch (e) { /* уже прервано */ } } } });
    const photos = todo.filter(c => c.sec === 'photo'), vids = todo.filter(c => c.sec === 'video');
    let done = 0, netFails = 0, okAny = false, vidLabel = '';
    const total = todo.length;
    const paint = () => ui.set('Скачиваем: ' + done + ' из ' + total + ' · фото ' + stat.added.photo + ', видео ' + (stat.added.video + stat.added.gif) + (stat.failed.length ? ' · не вышло: ' + stat.failed.length : '') + vidLabel, done / Math.max(total, 1));
    const fail = (c, e) => {
        const code = e && e.code;
        if (code === 'big') stat.big++; else if (code === 'http' && (e.status === 404 || e.status === 403 || e.status === 410)) stat.gone++; else if (code === 'bad') stat.bad++; else { stat.net++; if (code === 'net') netFails++; }
        stat.failed.push({ c, url: c.m.url || '', why: code || 'net' });
    };
    // Сохранение пачками; на каждую страницу — своя очередь, чтобы записи не перемешивались
    const queue = { photo: [], video: [] }, chain = { photo: Promise.resolve(), video: Promise.resolve() };
    const flush = (sec, force) => {
        if (!queue[sec].length || (!force && queue[sec].length < (sec === 'video' ? 4 : 16))) return;
        const batch = queue[sec].splice(0);
        chain[sec] = chain[sec].then(async () => {
            const n = await secs[sec].addExternal(batch.map(b => b.item));
            batch.forEach(b => { stat.added[b.counter]++; }); return n;
        });
    };
    const processOne = async c => {
        const m = c.m, p = c.p, isVid = c.sec === 'video';
        let blob;
        if (m.get) blob = await m.get();
        else {
            if (!m.url) { const er = new Error('нет адреса'); er.code = 'gone'; throw er; }
            blob = await xbFetchFirst(isVid ? [m.url] : xbPhotoUrls(m.url), { max: isVid ? XB_VIDEO_MAX : XB_PHOTO_MAX, signal: abort && abort.signal, onProgress: isVid ? (g, t) => { vidLabel = ' · видео ' + fmtBytes(g) + (t ? ' из ' + fmtBytes(t) : ''); paint(); } : null });
        }
        vidLabel = '';
        if (blob.size > (isVid ? XB_VIDEO_MAX : XB_PHOTO_MAX)) { const er = new Error('big'); er.code = 'big'; throw er; }
        const rec = { w: m.w || 0, h: m.h || 0, dur: m.dur || 0, thumb: null };
        if (isVid) {
            if (m.thumb && !m.get) { try { const tb = await xbFetchBlob(m.thumb, { max: 5 * 1048576, signal: abort && abort.signal }); const f = await galFitThumb(tb); if (f) rec.thumb = f.blob; } catch (e) { /* возьмём кадр из самого видео */ } }
            if (!rec.w || !rec.dur || !rec.thumb) {
                const pr = await galVideoProbe(blob, !rec.thumb);
                if (pr.w && !rec.w) { rec.w = pr.w; rec.h = pr.h; }
                if (pr.dur && !rec.dur) rec.dur = pr.dur;
                if (pr.poster && !rec.thumb) { const f = await galFitThumb(pr.poster); rec.thumb = f ? f.blob : pr.poster; }
            }
        } else {
            let a; try { a = await galAnalyze(blob); } catch (e) { const er = new Error('не картинка'); er.code = 'bad'; throw er; }
            rec.w = a.w; rec.h = a.h; rec.thumb = a.thumb;
        }
        const ext = xbExtForBlob(blob, c), idx = p.media.indexOf(m) + 1;
        const name = m.name && !m.url ? m.name : (p.user || 'x') + '_' + (p.id || tgHash(m.url)) + '_' + idx + '.' + ext;
        const date = p.date || (blob.lastModified ? blob.lastModified : Date.now());
        const item = { id: c.id, k: c.key, kind: c.kind, name: galSafe(name), date, cap: String(p.text || '').slice(0, XB_TEXT_MAX), blob, thumb: rec.thumb, w: rec.w, h: rec.h, dur: rec.dur, src: 'x', xu: p.user || '', xi: p.id || '' };
        queue[c.sec].push({ item, counter: c.kind === 'gif' || c.kind === 'anim' ? 'gif' : c.sec });
        okAny = true; netFails = 0;
        flush(c.sec, false);
    };
    const lane = async (list, parallel) => {
        let next = 0;
        const worker = async () => {
            while (next < list.length && !ctl.stop) {
                if (!okAny && netFails >= 6) { stat.cors = true; ctl.stop = true; break; }   // шесть сетевых отказов подряд и ни одного успеха — браузер не пускает к серверам X
                const c = list[next++];
                try { await processOne(c); } catch (e) { if (e && e.code === 'abort') break; fail(c, e); if (e && e.code !== 'net' && e.code !== 'http' && e.code !== 'big' && e.code !== 'bad' && e.code !== 'gone') console.warn('X: файл не обработан', c.key, e); }
                done++; paint();
            }
        };
        await Promise.all(Array.from({ length: Math.min(parallel, list.length) }, worker));
    };
    let failure = null;
    try { paint(); await Promise.all([lane(photos, 3), lane(vids, 1)]); }
    catch (e) { failure = e; }
    stat.stopped = !!ctl.stop && !stat.cors;
    try { flush('photo', true); flush('video', true); await Promise.all([chain.photo, chain.video]); }
    catch (e) { failure = failure || e; }
    ui.close(); xbBusy = false; GAL.photo.setBusy(false); GAL.video.setBusy(false);
    LS.set('xb_last', { at: Date.now(), photo: stat.added.photo, video: stat.added.video + stat.added.gif });
    xbRender();
    return { stat, failure };
}

// ---------- Итоговое окно ----------
function xbSummary(r) {
    if (!r) return;
    const s = r.stat, li = [], add = (icon, t) => li.push('<li>' + ic(icon) + '<span>' + t + '</span></li>');
    if (r.failure) add('error', 'Остановилось с ошибкой: ' + esc(r.failure && r.failure.message ? r.failure.message : String(r.failure)));
    const nPh = s.added.photo, nVd = s.added.video, nGf = s.added.gif;
    if (r.empty) {
        add('info', s.posts ? 'Новых файлов для добавления нет.' : 'В выбранном не нашлось ни фото, ни видео из X.');
        if (s.old) add('history', 'Уже были добавлены раньше: ' + s.old);
        if (s.tomb) add('delete', 'Ранее удалены вами и пропущены: ' + s.tomb);
        if (s.off) add('filter_list', 'Не выбраны в «Что брать»: ' + s.off + '. Включите нужные типы и повторите.');
    } else {
        if (nPh || nVd || nGf || !s.cors) add(nPh || nVd || nGf ? 'check_circle' : 'info', 'Добавлено: <b>' + nPh + ' фото</b>, <b>' + nVd + ' видео</b>' + (nGf ? ' и <b>' + nGf + ' GIF-анимаций</b>' : '') + (s.stopped ? ' (остановлено)' : ''));
        if (nPh || nVd || nGf) add('folder_open', 'Фото лежат в «Фото и GIF → X (Твиттер)», видео и GIF-анимации — в «Видео → X (Твиттер)»; по именам авторов — в «X · авторы».');
        if (s.old) add('history', 'Уже были добавлены раньше: ' + s.old);
        if (s.tomb) add('delete', 'Ранее удалены вами и пропущены: ' + s.tomb);
        if (s.off) add('filter_list', 'Не выбраны в «Что брать»: ' + s.off);
        if (s.gone) add('link_off', 'Файла больше нет в X (пост удалён, закрыт или ссылка устарела): ' + s.gone);
        if (s.big) add('warning', 'Слишком крупных файлов: ' + s.big);
        if (s.bad) add('error', 'Не удалось прочитать как картинку: ' + s.bad);
        if (s.net && !s.cors) add('wifi_off', 'Не скачалось из-за сети: ' + s.net + '. Повторите — добавятся только недостающие.');
    }
    if (s.cors) add('warning', '<b>Браузер не даёт iLife скачивать файлы прямо с серверов X</b> (так бывает). Выход: в скрипте на странице X нажмите «Скачать с файлами (ZIP)» и выберите полученные архивы здесь же. Ссылки на непрошедшие файлы можно сохранить списком.');
    const actions = [{ label: 'Закрыть' }];
    if (s.failed.length && s.failed.some(f => f.url)) actions.push({ label: 'Сохранить ссылки (' + s.failed.filter(f => f.url).length + ')', icon: 'download', onClick() { xbSaveFailedLinks(s.failed); return false; } });
    if (nPh || nVd || nGf) actions.push({ label: nPh >= nVd + nGf ? 'Открыть фото' : 'Открыть видео', kind: 'primary', icon: 'folder_open', onClick() { setTimeout(() => xbOpenFolder(nPh >= nVd + nGf ? 'photo' : 'video'), 200); } });
    openSheet({ title: r.empty ? 'Нечего добавлять' : (s.cors && !nPh && !nVd && !nGf ? 'Не получилось скачать' : 'Готово'), html: '<ul class="gal-sum">' + li.join('') + '</ul>', actions });
}
async function xbSaveFailedLinks(failed) {
    const text = failed.filter(f => f.url).map(f => f.url).join('\n');
    const res = await deliverFile(new Blob([text], { type: 'text/plain' }), 'x-ссылки-не-скачались.txt');
    toast(res === 'unsupported' ? 'В этом приложении сохранить файл нельзя — откройте iLife в браузере' : res === 'shared' ? 'Готово — выберите, куда отправить' : 'Список сохранён', { ms: 4000 });
}
function xbOpenFolder(k) {
    if (typeof galShowTab === 'function') galShowTab(k);
    GAL[k].open(['x']);
    const sw = $('#sov-switch'); if (sw) sw.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// =====================================================================================================
// 5. ВХОДЫ: файлы, ссылки
// =====================================================================================================
async function xbImportFiles(fileList) {
    const files = Array.from(fileList || []); if (!files.length) return;
    if (xbGuard()) return;
    const ui = galProgressSheet('Читаем файлы'), posts = new Map(), used = new Set();
    const addPost = p => {
        if (!p || !p.media.length) return;
        const k = p.id || ('n' + posts.size + tgHash(JSON.stringify(p.media.map(m => m.url || (m.entry && m.entry.path)))));
        const cur = posts.get(k);
        if (!cur) { posts.set(k, p); return; }
        p.media.forEach(m => { if (!cur.media.some(x => x.id === m.id || (x.url && x.url === m.url))) cur.media.push(m); });
        if (!cur.text && p.text) cur.text = p.text; if (!cur.user && p.user) cur.user = p.user;
    };
    let result = null, failure = null;
    try {
        ui.set('Открываем архивы…', 0.05);
        const entries = await tgCollectEntries(files), resolve = tgMakeResolver(entries);
        const jsons = entries.filter(e => /\.json$/i.test(e.path) && e.size < 400 * 1048576);
        const texts = entries.filter(e => /\.(csv|txt|tsv|md|html?)$/i.test(e.path) && e.size < 100 * 1048576);
        for (let i = 0; i < jsons.length; i++) {
            ui.set('Читаем список: ' + (i + 1) + ' из ' + jsons.length, 0.1 + 0.5 * i / jsons.length);
            let text = ''; try { text = await (await jsons[i].get()).text(); } catch (e) { continue; }
            let found = [];
            try { found = xbPostsFromJson(JSON.parse(text), resolve); } catch (e) { /* не JSON — ниже поищем адреса в тексте */ }
            if (!found.length) found = xbPostsFromText(text);
            found.forEach(p => { p.media.forEach(m => { if (m.entry) used.add(m.entry); }); addPost(p); });
        }
        for (let i = 0; i < texts.length; i++) {
            ui.set('Читаем таблицы: ' + (i + 1) + ' из ' + texts.length, 0.6 + 0.1 * i / texts.length);
            let text = ''; try { text = await (await texts[i].get()).text(); } catch (e) { continue; }
            xbPostsFromText(text).forEach(addPost);
        }
        const loose = entries.filter(e => !used.has(e) && xbMediaTypeOfName(String(e.path).split('/').pop()) && !/_thumb\.[a-z0-9]+$/i.test(e.path));
        if (loose.length) xbPostsFromFiles(loose).forEach(addPost);
    } catch (e) { failure = e; }
    ui.close();
    if (failure) { tgShowError('Не удалось прочитать файлы', failure); return; }
    const list = Array.from(posts.values());
    if (!list.length) { xbSummary({ stat: { posts: 0, off: 0, old: 0, tomb: 0, added: { photo: 0, video: 0, gif: 0 }, failed: [] }, empty: true }); return; }
    xbSummary(await xbImport(list));
}
async function xbImportLinks(text) {
    const links = xbParseLinks(text);
    if (!links.length) { toast('Не нашёл ссылок на посты X. Пример: https://x.com/имя/status/1234567890', { ms: 5000 }); return; }
    if (xbGuard()) return;
    const ui = galProgressSheet('Ищем фото и видео в постах'), posts = []; let gone = 0, net = 0, last = '';
    try {
        for (let i = 0; i < links.length; i++) {
            if (ui.ctl.stop) break;
            ui.set('Пост ' + (i + 1) + ' из ' + links.length, i / links.length);
            try { posts.push(await xbFetchFx(links[i])); }
            catch (e) { if (e.code === 'abort') break; if (e.code === 'gone') gone++; else { net++; last = e.message; if (net >= 5 && !posts.length) break; } }
            await galSleep(350);
        }
    } finally { ui.close(); }
    if (!posts.length) {
        openSheet({ title: 'Не получилось', html: '<p class="hint" style="font-size:15px;color:var(--md-on-surface)">' + esc(net ? (last || 'Сервис FxTwitter недоступен.') + ' Возможно, браузер или сеть не пускают к api.fxtwitter.com. Попробуйте способ «Скрипт» или «Готовый экспорт».' : 'В этих постах нет доступных фото и видео (или посты закрыты/удалены): ' + gone + '.') + '</p>', actions: [{ label: 'Закрыть' }] });
        return;
    }
    const withMedia = posts.filter(p => p.media.length);
    if (!withMedia.length) {
        openSheet({ title: 'Фото и видео не найдены', html: '<p class="hint" style="font-size:15px;color:var(--md-on-surface)">В этих постах нет фото и видео' + (gone ? ' (недоступных постов: ' + gone + ')' : '') + '.</p>', actions: [{ label: 'Закрыть' }] });
        return;
    }
    const r = await xbImport(withMedia);
    if (r) { if (gone) r.stat.gone += gone; if (net) r.stat.net += net; xbSummary(r); }
}

// =====================================================================================================
// 6. БЛОК НА СТРАНИЦЕ «МОЕ_СОВСЕК»
// =====================================================================================================
const XB_METHODS = [
    { key: 'script', icon: 'terminal', name: 'Скрипт' },
    { key: 'file', icon: 'extension', name: 'Экспорт' },
    { key: 'links', icon: 'link', name: 'Ссылки' }
];
function xbCounts() {
    const f = g => g.src === 'x';
    const p = GAL.photo.list().filter(f), v = GAL.video.list().filter(f);
    return { photos: p.length, videos: v.filter(g => g.kind === 'video').length, anims: v.filter(g => g.kind === 'anim').length };
}
function xbTemplate() {
    const chip = (k, t) => '<button type="button" class="chip' + (xbUi[k] ? ' is-on' : '') + '" data-xb-want="' + k + '" aria-pressed="' + !!xbUi[k] + '">' + (xbUi[k] ? ic('check') : '') + t + '</button>';
    return '<div class="card xb-card" id="xb-card">' +
        '<h3 class="card-title"><span class="ico"><i data-i="public"></i></span><span class="ttl">Фото и видео из X (Твиттер)</span><span class="badge" id="xb-badge"></span>' +
        '<button type="button" class="icon-btn card-toggle" aria-label="Свернуть или развернуть блок"><i data-i="expand_less"></i></button></h3>' +
        '<div class="card-body">' +
        '<p class="hint" id="xb-status" style="margin-bottom:0.75rem"></p>' +
        '<div class="seg xb-seg" id="xb-seg" role="group" aria-label="Способ">' +
        XB_METHODS.map(m => '<button type="button" data-xb-m="' + m.key + '"><i data-i="' + m.icon + '"></i><span>' + m.name + '</span></button>').join('') + '</div>' +

        '<div class="xb-pane" data-xb-pane="script"><div class="tg-mode"><b><i data-i="terminal"></i>Скрипт на странице «Закладки» — рекомендуется</b>' +
        '<span class="hint">Бесплатно и без ключей. На компьютере в браузере, где вы вошли в X, запускается маленький скрипт: он сам пролистывает ваши закладки и сохраняет файл со ссылками на фото и видео. Дальше файлы скачает iLife.</span>' +
        '<div class="btn-group"><button type="button" class="btn btn-primary" id="xb-copy"><i data-i="content_copy"></i>Скопировать скрипт</button>' +
        '<button type="button" class="btn" id="xb-pick-script"><i data-i="upload_file"></i>Выбрать файл от скрипта</button></div>' +
        '<p class="instr-row"><button type="button" class="linkbtn instr-link" data-instr="instr-x"><i data-i="help"></i>Инструкция: как запустить скрипт</button></p></div></div>' +

        '<div class="xb-pane" data-xb-pane="file" hidden><div class="tg-mode"><b><i data-i="extension"></i>Готовый экспорт или скачанные файлы</b>' +
        '<span class="hint">Подойдут: экспорт закладок из расширения Twitter Web Exporter (JSON или CSV), любой список с адресами pbs.twimg.com / video.twimg.com, а также ZIP или папка с уже скачанными фото и видео (например, из gallery-dl). Формат определяется сам.</span>' +
        '<div class="btn-group"><button type="button" class="btn btn-primary" id="xb-pick-any"><i data-i="upload_file"></i>Выбрать файлы или ZIP</button>' +
        '<button type="button" class="btn" id="xb-pick-dir"><i data-i="folder_open"></i>Выбрать папку</button></div>' +
        '<p class="instr-row"><button type="button" class="linkbtn instr-link" data-instr="instr-x"><i data-i="help"></i>Инструкция: чем сделать экспорт</button></p></div></div>' +

        '<div class="xb-pane" data-xb-pane="links" hidden><div class="tg-mode"><b><i data-i="link"></i>Ссылки на посты</b>' +
        '<span class="hint">Вставьте ссылки на посты X (по одной в строке) — iLife найдёт в них фото и видео. Удобно для отдельных постов. Ссылки уходят общедоступному сервису FxTwitter (api.fxtwitter.com), больше никому.</span>' +
        '<textarea id="xb-links" rows="4" placeholder="https://x.com/имя/status/1234567890" spellcheck="false" autocomplete="off" aria-label="Ссылки на посты X"></textarea>' +
        '<div class="btn-group"><button type="button" class="btn btn-primary" id="xb-go-links"><i data-i="cloud_download"></i>Скачать фото и видео</button></div>' +
        '<p class="instr-row"><button type="button" class="linkbtn instr-link" data-instr="instr-x"><i data-i="help"></i>Инструкция</button></p></div></div>' +

        '<div class="xb-want"><span class="hint">Что брать:</span><div class="chips">' + chip('photo', 'Фото') + chip('video', 'Видео') + chip('gif', 'GIF') + '</div></div>' +
        '<div class="btn-group xb-folders"><button type="button" class="btn" id="xb-open-photo"><i data-i="photo_library"></i>Фото из X</button><button type="button" class="btn" id="xb-open-video"><i data-i="movie"></i>Видео из X</button></div>' +
        '<input type="file" id="xb-file-script" accept=".json,.zip,application/json,application/zip" multiple hidden>' +
        '<input type="file" id="xb-file-any" accept=".json,.csv,.txt,.zip,.html,image/*,video/*,application/json,application/zip" multiple hidden>' +
        '<input type="file" id="xb-file-dir" webkitdirectory hidden>' +
        '</div></div>';
}
function xbRefresh() {
    const st = $('#xb-status'); if (!st) return;
    const c = xbCounts(), last = LS.get('xb_last', null), n = c.photos + c.videos + c.anims;
    $('#xb-badge').textContent = n ? String(n) : '';
    st.textContent = n
        ? 'Из X сохранено: ' + c.photos + ' фото, ' + c.videos + ' видео' + (c.anims ? ' и ' + c.anims + ' GIF-анимаций' : '') + (last && last.at ? ' · последний импорт ' + fmtDate(last.at) + ' в ' + fmtTime(last.at) : '') + '. Фото лежат в «Фото и GIF», видео — в «Видео», каждое в своей папке «X (Твиттер)».'
        : 'Скачайте фото и видео из закладок вашего аккаунта X. Фото попадут на страницу «Фото и GIF», видео — на страницу «Видео», каждое в свою папку «X (Твиттер)» (по дате и по авторам). Выберите способ:';
    $$('#xb-seg [data-xb-m]').forEach(b => { const on = b.dataset.xbM === xbUi.method; b.classList.toggle('is-on', on); b.setAttribute('aria-pressed', on); });
    $$('.xb-pane').forEach(p => { p.hidden = p.dataset.xbPane !== xbUi.method; });
    $$('[data-xb-want]').forEach(b => { const on = !!xbUi[b.dataset.xbWant]; b.classList.toggle('is-on', on); b.setAttribute('aria-pressed', on); b.innerHTML = (on ? ic('check') : '') + esc(b.textContent.trim()); });
    ['xb-copy', 'xb-pick-script', 'xb-pick-any', 'xb-pick-dir', 'xb-go-links'].forEach(id => { const b = $('#' + id); if (b) b.disabled = xbBusy; });
}
function xbRender() { xbRefresh(); }
async function xbCopyScript() {
    const text = xbScriptText();
    if (await copyText(text)) { toast('Скрипт скопирован. Дальше — по инструкции: откройте x.com на компьютере, консоль браузера (F12) и вставьте его.', { ms: 7000 }); return; }
    const sheet = openSheet({ title: 'Скрипт для X', html: '<p class="hint" style="margin:0 4px 8px">Браузер не дал скопировать сам. Нажмите в поле, выделите всё (Ctrl+A), скопируйте (Ctrl+C).</p><textarea id="xb-script-text" readonly rows="10" spellcheck="false" style="font-family:ui-monospace,Menlo,Consolas,monospace;font-size:0.75rem"></textarea>', actions: [{ label: 'Закрыть' }] });
    const ta = $('#xb-script-text', sheet.el); if (ta) { ta.value = text; ta.focus(); ta.select(); }
}
function initXBookmarks() {
    const host = $('#xb-host'); if (!host) return;
    host.innerHTML = xbTemplate(); hydrateIcons(host);
    const card = $('#xb-card'); if (collapsedCards.has('xb-card')) card.classList.add('is-collapsed');
    const pick = (inputId, btnId) => {
        const fi = $('#' + inputId);
        $('#' + btnId).addEventListener('click', () => { fi.value = ''; fi.click(); });
        fi.addEventListener('change', () => { const picked = Array.from(fi.files || []); fi.value = ''; xbImportFiles(picked); });
    };
    pick('xb-file-script', 'xb-pick-script'); pick('xb-file-any', 'xb-pick-any'); pick('xb-file-dir', 'xb-pick-dir');
    $('#xb-copy').addEventListener('click', xbCopyScript);
    document.addEventListener('click', e => { if (e.target.closest('[data-xb-copy]')) xbCopyScript(); });   // такая же кнопка есть в инструкции («Настройки → Сайты и инструкции»)
    $('#xb-go-links').addEventListener('click', () => xbImportLinks($('#xb-links').value));
    $('#xb-seg').addEventListener('click', e => { const b = e.target.closest('[data-xb-m]'); if (!b) return; xbUi.method = b.dataset.xbM; xbUiSave(); xbRefresh(); });
    card.addEventListener('click', e => {
        const w = e.target.closest('[data-xb-want]'); if (!w) return;
        const k = w.dataset.xbWant; xbUi[k] = !xbUi[k];
        if (!xbUi.photo && !xbUi.video && !xbUi.gif) { xbUi[k] = true; toast('Нужно оставить хотя бы один тип'); }
        xbUiSave(); xbRefresh();
    });
    $('#xb-open-photo').addEventListener('click', () => xbOpenFolder('photo'));
    $('#xb-open-video').addEventListener('click', () => xbOpenFolder('video'));
    ['dragenter', 'dragover'].forEach(ev => card.addEventListener(ev, e => { if (e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files')) { e.preventDefault(); card.classList.add('tg-card-dragging'); } }));
    ['dragleave', 'drop'].forEach(ev => card.addEventListener(ev, () => card.classList.remove('tg-card-dragging')));
    card.addEventListener('drop', e => { if (e.dataTransfer && e.dataTransfer.files.length) { e.preventDefault(); xbImportFiles(e.dataTransfer.files); } });
    xbRefresh();
}
