'use strict';
// =====================================================================================================
// iLife — СТРАНИЦА «НАСТРОЙКИ»: Google Диск, Spotify, Кино (ключи — в js/movies.js), темы Android и шрифт, масштаб, профиль, копия данных.
// =====================================================================================================

// ---------- Google: вход и синхронизация с Google Диском (логика — js/gdrive.js) ----------
function renderGoogleCard() {
    if (!$('#google-card')) return;
    const g = googleInfo(), on = !!g.user, st = g.status.state;
    $('#g-out').hidden = on; $('#g-in').hidden = !on;

    // значок-статус
    const label = !on ? 'Не подключён' : st === 'syncing' ? 'Синхронизация…' : st === 'needs-auth' ? 'Нужен вход' : st === 'offline' ? 'Нет сети' : st === 'error' ? 'Ошибка' : 'Подключён';
    const bad = on && (st === 'needs-auth' || st === 'error'), good = on && (st === 'ok' || st === 'off');
    const badge = $('#g-badge'); badge.textContent = label;
    badge.style.background = good ? 'color-mix(in oklab, var(--md-income) 24%, var(--md-container))' : bad ? 'color-mix(in oklab, var(--md-error) 22%, var(--md-container))' : '';
    badge.style.color = good ? 'var(--md-income)' : bad ? 'var(--md-error)' : '';

    // аккаунт
    const av = $('#g-avatar');
    if (on && g.user.picture) av.innerHTML = '<img alt="" referrerpolicy="no-referrer" src="' + esc(g.user.picture) + '" style="width:100%;height:100%;border-radius:50%;object-fit:cover">';
    else av.innerHTML = ic('person');
    $('#g-state-text').innerHTML = on
        ? '<b>' + esc(g.user.name || g.user.email) + '</b><span class="hint">' + esc(g.user.email) + '</span>'
        : '<b>Аккаунт не подключён</b><span class="hint">Данные хранятся только на этом устройстве</span>';

    if (!on) {
        const inp = $('#g-client');
        if (document.activeElement !== inp) inp.value = g.source === 'config' ? '' : (g.cfg.clientId || '');
        inp.disabled = g.source === 'config';
        inp.placeholder = g.source === 'config' ? 'Взят из js/config.js' : '123456789012-abc….apps.googleusercontent.com';
        $('#g-client-src').textContent = g.source === 'config' ? 'Client ID взят из файла js/config.js — вводить его здесь не нужно.' : g.source === 'device' ? 'Client ID сохранён на этом устройстве.' : 'Client ID ещё не введён.';
        $('#g-origin').textContent = g.origin && g.origin !== 'null' ? g.origin : 'откройте iLife по адресу https://… — как файл вход Google не работает';
        const problem = g.problem || (g.clientId ? g.blocked : '');
        $('#g-problem').textContent = problem;
        $('#g-problem').style.color = problem ? 'var(--md-error)' : '';
        return;
    }

    // подключён
    const last = g.lastSync ? fmtDateTime(g.lastSync) : 'ещё не было';
    let text;
    if (st === 'syncing') text = g.status.message || 'Синхронизация…';
    else if (st === 'needs-auth') text = 'Вход устарел: нажмите «Продолжить синхронизацию» (Google просит подтверждать вход раз в час). Изменения сохранены на устройстве и уйдут на Диск после подтверждения.';
    else if (st === 'offline') text = 'Нет интернета. Изменения сохранены на устройстве и отправятся позже. Последняя синхронизация: ' + last + '.';
    else if (st === 'error') text = 'Ошибка синхронизации: ' + (g.status.message || 'неизвестная ошибка') + '. Последняя удачная: ' + last + '.';
    else if (st === 'ok') text = 'Синхронизировано. Последний раз: ' + last + '.' + (g.status.message ? ' ' + g.status.message + '.' : '');
    else text = (g.cfg.auto ? 'Готово к синхронизации.' : 'Автосинхронизация выключена — нажмите «Синхронизировать сейчас».') + ' Последний раз: ' + last + '.';
    if (g.dirty && st !== 'syncing' && st !== 'needs-auth') text += ' Есть изменения, которые ещё не ушли на Диск.';
    const el = $('#g-status'); el.textContent = text; el.style.color = st === 'error' ? 'var(--md-error)' : '';
    $('#g-reconnect').hidden = st !== 'needs-auth';
    $('#google-sync').hidden = st === 'needs-auth';
    $('#google-sync').disabled = st === 'syncing';
    const fl = $('#g-folder'); fl.hidden = !g.folderId; if (g.folderId) fl.href = 'https://drive.google.com/drive/folders/' + encodeURIComponent(g.folderId);
    const auto = $('#google-auto'); if (auto.checked !== !!g.cfg.auto) auto.checked = !!g.cfg.auto;
    const med = $('#google-media'); if (med.checked !== !!g.cfg.media) med.checked = !!g.cfg.media;
    const ky = $('#google-keys'); if (ky && ky.checked !== !!g.cfg.keys) ky.checked = !!g.cfg.keys;
    const ki = $('#google-keys-info'); if (ki) ki.textContent = keysInfoText(g);
    if (typeof renderSovStore === 'function') renderSovStore();
}
// Что сейчас с ключами на Диске — чтобы было видно, дошли ли они и какая версия приложения записала файл
function keysInfoText(g) {
    const ver = 'эта версия ' + APP_VERSION;
    if (!g.cfg.keys) return 'Синхронизация ключей на этом устройстве выключена (' + ver + ').';
    const i = g.keysInfo;
    if (!i) return 'Ключи: на Диске ещё не проверяли — нажмите «Синхронизировать сейчас» (' + ver + ').';
    const old = String(i.by).split('.').map(Number); const isOld = old[0] < 1 || (old[0] === 1 && (old[1] || 0) < 3);
    if (i.found) return 'Ключи на Диске есть' + (i.at ? ' (последняя правка ' + fmtDateTime(i.at) + ')' : '') + '. Файл записан версией ' + i.by + '; ' + ver + '. Проверено ' + fmtDateTime(i.seen) + '.';
    return 'На Диске ключей не было: файл записан версией ' + i.by + (isOld ? ', а она не умеет хранить ключи — обновите iLife на всех устройствах (закройте и откройте приложение)' : '') + '. Ключи уйдут на Диск с устройства, где они введены (' + ver + ').';
}
function initGoogleCard() {
    $('#g-client').addEventListener('change', e => {
        gCfgSave({ clientId: e.target.value.trim() });
        if (googleClientId() && !googleAuthBlockedReason()) loadGis();
        renderGoogleCard();
    });
    $('#g-copy').addEventListener('click', async () => toast((await copyText(location.origin)) ? 'Адрес скопирован' : 'Не удалось скопировать'));
    $('#google-signin').addEventListener('click', signInWithGoogle);
    $('#google-sync').addEventListener('click', syncNowButton);
    $('#g-reconnect').addEventListener('click', reconnectGoogle);
    $('#g-signout').addEventListener('click', signOutGoogle);
    $('#google-auto').addEventListener('change', e => {
        gCfgSave({ auto: e.target.checked });
        toast(e.target.checked ? 'Автосинхронизация включена' : 'Автосинхронизация выключена');
        if (e.target.checked) scheduleCloudSync(300);
        renderGoogleCard();
    });
    $('#google-media').addEventListener('change', e => {
        gCfgSave({ media: e.target.checked });
        toast(e.target.checked ? 'Вложения будут синхронизироваться' : 'Вложения не синхронизируются — только тексты');
        if (e.target.checked) { LS.del('g_media_try'); scheduleCloudSync(300); }
    });
    $('#google-keys').addEventListener('change', e => {
        gCfgSave({ keys: e.target.checked });
        toast(e.target.checked ? 'Ключи будут храниться на вашем Google Диске' : 'Ключи остаются только на этом устройстве (файл на Диске их больше не обновляет)');
        if (e.target.checked) { LS.set('g_dirty', true); scheduleCloudSync(300); }
    });
    // Мое_совсек: «Скачать все фото» и «Очистить кеш» (js/gallery.js)
    $('#sov-dl-all').addEventListener('click', () => { if (typeof GAL !== 'undefined') GAL.photo.downloadAll(); });
    $('#sov-clear').addEventListener('click', () => { if (typeof galClearCacheAll === 'function') galClearCacheAll(); });
    renderGoogleCard();
}

// ---------- Spotify ----------
function renderSpotifyCard() {
    const cfg = spCfg(), on = spotifyConnected();
    $('#sp-client').value = cfg.clientId || '';
    $('#sp-redirect').textContent = spotifyRedirectUri();
    const problem = spotifyRedirectProblem();
    $('#sp-problem').textContent = problem;
    $('#sp-problem').style.color = problem ? 'var(--md-error)' : '';
    $('#sp-badge').textContent = on ? 'Подключён' : 'Не подключён';
    $('#sp-badge').style.background = on ? 'color-mix(in oklab, var(--md-income) 24%, var(--md-container))' : '';
    $('#sp-badge').style.color = on ? 'var(--md-income)' : '';
    $('#sp-state-text').innerHTML = on ? '<b>' + esc(cfg.user ? 'Аккаунт: ' + cfg.user : 'Spotify подключён') + '</b><span class="hint">Кнопка Spotify на странице «Идеи» берёт трек из вашего аккаунта</span>'
        : '<b>Spotify не подключён</b><span class="hint">Вставьте Client ID и нажмите «Подключить»</span>';
    $('#sp-connect').hidden = on; $('#sp-disconnect').hidden = !on;
    $('#sp-connect').disabled = !!problem;
}
function initSpotifyCard() {
    $('#sp-client').addEventListener('change', e => { spSave({ clientId: e.target.value.trim() }); renderSpotifyCard(); });
    $('#sp-connect').addEventListener('click', () => { spSave({ clientId: $('#sp-client').value.trim() }); spotifyLogin(); });
    $('#sp-disconnect').addEventListener('click', async () => { if (await confirmSheet('Отключить Spotify?', 'Токены будут удалены с этого устройства. Сохранённые заметки с треками останутся.', 'Отключить', true)) { spotifyDisconnect(); renderSpotifyCard(); toast('Spotify отключён'); } });
    $('#sp-copy').addEventListener('click', async () => toast((await copyText(spotifyRedirectUri())) ? 'Адрес скопирован' : 'Не удалось скопировать'));
    renderSpotifyCard();
}

// ---------- Темы и шрифт ----------
function renderThemes() {
    $('#theme-grid').innerHTML = PALETTES.map(p =>
        '<button type="button" class="theme-swatch' + (p.id === settings.theme ? ' is-active' : '') + '" data-theme="' + p.id + '" aria-pressed="' + (p.id === settings.theme) + '">' +
        '<span class="sw-prev" style="background:' + p.surface + '"><span class="sw-pill" style="background:' + p.primary + '"></span>' +
        '<span class="sw-card" style="background:' + p.surfaceContainer + '"><i style="background:' + p.onSurface + '"></i><i style="background:' + p.onSurfaceVariant + '"></i></span>' +
        '<span class="sw-fab" style="background:' + p.tertiaryContainer + '"></span></span>' +
        '<span class="sw-check">' + ic('check') + '</span>' +
        '<span class="nm">' + esc(p.name) + (p.dark ? '<span class="dk">тёмная</span>' : '<span class="dk">светлая</span>') + '</span></button>').join('');
    $('#font-grid').innerHTML = FONTS.map(f => '<button type="button" class="font-card' + (f.id === settings.font ? ' is-active' : '') + '" data-font="' + f.id + '"><b>' + esc(f.name) + '</b><span style="font-family:' + f.stack.replace(/"/g, "'") + '">Аа Әә 123 ₸</span></button>').join('');
}
function initLook() {
    $('#theme-grid').addEventListener('click', e => { const b = e.target.closest('[data-theme]'); if (!b) return; applyTheme(b.dataset.theme); saveSettings(); renderThemes(); });
    $('#font-grid').addEventListener('click', e => { const b = e.target.closest('[data-font]'); if (!b) return; applyFont(b.dataset.font); saveSettings(); renderThemes(); });
    renderThemes();
}

// ---------- Масштаб ----------
function refreshScaleUI() {
    const pct = currentScale();
    const rng = $('#zoom-range'); if (!rng) return;
    if (document.activeElement !== rng) rng.value = pct;
    $('#zoom-val').textContent = pct + '%';
    $('#zoom-mode').textContent = settings.scaleMode === 'auto' ? 'подбирается под экран' : 'задан вручную';
    $('#zoom-auto').classList.toggle('btn-primary', settings.scaleMode === 'auto');
}
function initZoom() {
    const rng = $('#zoom-range');
    rng.min = SCALE_MIN; rng.max = SCALE_MAX; rng.step = 5;
    rng.addEventListener('input', () => { $('#zoom-val').textContent = rng.value + '%'; });
    rng.addEventListener('change', () => setScale(+rng.value, 'manual')); // применяется, когда ползунок отпущен — иначе он «убегает» из-под пальца
    $('#zoom-minus').addEventListener('click', () => setScale(currentScale() - 5, 'manual'));
    $('#zoom-plus').addEventListener('click', () => setScale(currentScale() + 5, 'manual'));
    $('#zoom-100').addEventListener('click', () => setScale(100, 'manual'));
    $('#zoom-auto').addEventListener('click', () => { setScale(0, 'auto'); toast('Масштаб подобран под экран: ' + currentScale() + '%'); });
    refreshScaleUI();
}

// ---------- Профиль ----------
function initProfile() {
    const a = $('#profile-author'); a.value = authorName();
    a.addEventListener('change', () => { settings.author = a.value.trim().slice(0, 30) || 'Александр'; a.value = settings.author; saveSettings(); updateSplashClock(); updateComposerMeta(); renderTodo(); toast('Имя автора: ' + settings.author); });
    const s = $('#profile-splash'); s.checked = !!settings.splash;
    s.addEventListener('change', () => { settings.splash = s.checked; saveSettings(); toast(s.checked ? 'Экран блокировки будет при запуске' : 'Экран блокировки выключен'); });
}

// ---------- Данные: копия и восстановление ----------
async function renderStorageInfo() {
    let text = 'Идей: ' + ideas.length + ' · дел и покупок: ' + todos.length + ' · фильмов: ' + movies.length + (gallery.length ? ' · фото и GIF: ' + gallery.length : '') + (videos.length ? ' · видео: ' + videos.length : '') + (songs.length ? ' · песен: ' + songs.length : '') + (scripts.length ? ' · сценариев: ' + scripts.length : '') + (musicFavs.length ? ' · в избранной музыке: ' + musicFavs.length : '');
    try { if (navigator.storage && navigator.storage.estimate) { const e = await navigator.storage.estimate(); if (e && e.usage != null) text += ' · занято на устройстве: ' + fmtBytes(e.usage); } } catch (e) {}
    $('#data-info').textContent = text;
}
async function backupData() {
    const btn = $('#data-backup'); btn.disabled = true;
    try {
        const media = [];
        const galIds = new Set(gallery.map(g => g.id).concat(videos.map(g => g.id), Array.from(gAllSongAudio())));   // фото, видео «Мое_совсек» и аудио песен в копию не входят: они большие и лежат на Google Диске
        for (const id of await BlobDB.ids()) { if (galIds.has(id)) continue; const rec = await BlobDB.get(id); if (rec) media.push({ id: rec.id, name: rec.name, type: rec.type, size: rec.size, data: await blobToBase64(rec.blob), thumb: rec.thumb ? await blobToBase64(rec.thumb) : null, thumbType: rec.thumb ? rec.thumb.type : null }); }
        const data = { app: 'iLife', version: APP_VERSION, exportedAt: new Date().toISOString(), settings, ideas, todos, prices, movies, songs, scripts, musicfav: musicFavs, media };
        const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
        const name = stampName('копия', 'json');
        const res = await deliverFile(blob, name);
        toast(res === 'unsupported' ? 'В этом приложении сохранить файл нельзя — откройте iLife в браузере' : res === 'shared' ? 'Копия готова — выберите, куда её отправить' : 'Копия сохранена: ' + name);
    } catch (e) { console.error(e); toast('Не удалось собрать копию'); } finally { btn.disabled = false; }
}
function b64ToBlob(b64, type) { const bin = atob(b64); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return new Blob([u], { type: type || 'application/octet-stream' }); }
async function restoreData(file) {
    let data;
    try { data = JSON.parse(await file.text()); } catch (e) { toast('Это не файл копии iLife'); return; }
    if (!data || data.app !== 'iLife' || !Array.isArray(data.ideas)) { toast('Это не файл копии iLife'); return; }
    const ok = await confirmSheet('Заменить данные копией?', 'Идей в копии: ' + data.ideas.length + ', дел и покупок: ' + (data.todos || []).length + ', фильмов: ' + (data.movies || []).length + (data.songs ? ', песен: ' + data.songs.length : '') + (data.scripts ? ', сценариев: ' + data.scripts.length : '') + '. Текущие идеи, дела, фильмы, песни, сценарии и вложения на этом устройстве будут заменены. Файлы песен и фото останутся на месте.', 'Заменить', true);
    if (!ok) return;
    try {
        const galIds = new Set(gallery.map(g => g.id).concat(videos.map(g => g.id), Array.from(gAllSongAudio()), (Array.isArray(data.songs) ? data.songs : []).map(x => x && x.audioId).filter(Boolean)));   // фото, видео «Мое_совсек» и аудио песен (нынешних и из копии) остаются на месте
        for (const id of await BlobDB.ids()) if (!galIds.has(id)) await BlobDB.del(id);
        for (const m of data.media || []) await BlobDB.put({ id: m.id, name: m.name, type: m.type, size: m.size, blob: b64ToBlob(m.data, m.type), thumb: m.thumb ? b64ToBlob(m.thumb, m.thumbType) : null });
        ideas = data.ideas; todos = data.todos || []; prices = data.prices || []; movies = Array.isArray(data.movies) ? data.movies : [];
        if (Array.isArray(data.songs)) { songs = data.songs; saveSongs(); }
        if (Array.isArray(data.scripts)) { scripts = data.scripts; saveScripts(); }
        if (Array.isArray(data.musicfav)) { musicFavs = data.musicfav; saveMusicFavs(); if (typeof muFavChanged === 'function') muFavChanged(); }
        saveIdeas(); saveTodos(); saveMovies(); IX.clear();
        renderIdeas(); renderTodo(); renderMovies(); renderSongs(); renderScripts(); renderDraft(); renderStorageInfo();
        toast('Данные восстановлены из копии');
    } catch (e) { console.error(e); toast('Не удалось восстановить данные'); }
}
function initData() {
    $('#data-backup').addEventListener('click', backupData);
    const inp = $('#data-file');
    $('#data-restore').addEventListener('click', () => { inp.value = ''; inp.click(); });
    inp.addEventListener('change', () => { if (inp.files[0]) restoreData(inp.files[0]); });
    renderStorageInfo();
}

function initSettings() { initGoogleCard(); initSpotifyCard(); initLook(); initZoom(); initProfile(); initData(); }
