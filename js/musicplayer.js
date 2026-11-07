'use strict';
// =====================================================================================================
// iLife — МУЗЫКА: ПЛЕЕР, ВРЕМЕННЫЙ КЕШ И ЗАГРУЗКИ НА УСТРОЙСТВО (дополнение к js/music.js)
//
// Откуда берётся звук (по порядку):
//   1) «Скачано на устройство» — файл лежит в IndexedDB «ilife-music», store audio; играет без интернета и без доступа к Диску;
//   2) временный кеш — только в оперативной памяти вкладки: песня, которую только что слушали или которую плеер заранее
//      подгрузил как следующую. На устройство (в хранилище) это НЕ записывается и пропадает при закрытии приложения;
//      размер ограничен (настройка «Временный кеш», по умолчанию 150 МБ), старое вытесняется;
//   3) Google Диск — файл целиком скачивается в память (с индикатором), потом играет.
// Так что «слушать с интернетом — качается в кеш, но не сохраняется» и «скачать, чтобы слушать без интернета» — два разных, явных действия.
// =====================================================================================================

const mp = {
    base: [], list: [], idx: -1, cur: null,       // base — очередь по порядку, list — как играет (с учётом «вперемешку»)
    shuffle: false, repeat: 'off',                // repeat: off | all | one
    loading: false, loadPct: 0, err: '',
    seq: 0, ctrl: null, url: '', startAt: 0, fails: 0, full: false, seeking: false, painted: '', pfId: '', pfCtrl: null, pfPromise: null
};
let muAudio = null;
const MP_STATE = 'mu_player', MP_POS = 'mu_pos', MU_DLQ = 'mu_dlq';
const mpAbort = () => (typeof DOMException === 'function' ? new DOMException('Aborted', 'AbortError') : Object.assign(new Error('Aborted'), { name: 'AbortError' }));

// ---------- Звук: получение файла ----------
async function muFetchAudio(t, o) {   // o: { signal, onProgress(share, bytes), shouldStop() }
    o = o || {};
    const res = await muFetch(G_DRIVE_API + '/files/' + encodeURIComponent(t.id) + '?alt=media&supportsAllDrives=true', { signal: o.signal });
    const total = Number(res.headers.get('content-length')) || t.size || 0;
    const type = MU_MIME[t.ext] || (res.headers.get('content-type') || '').split(';')[0] || 'audio/mpeg';
    if (!res.body || !res.body.getReader) { const b = await res.blob(); if (o.onProgress) o.onProgress(1, b.size); return b.slice(0, b.size, type); }
    const rd = res.body.getReader(), parts = []; let got = 0;
    for (;;) {
        if (o.shouldStop && o.shouldStop()) { try { rd.cancel(); } catch (e) {} throw mpAbort(); }
        const r = await rd.read(); if (r.done) break;
        parts.push(r.value); got += r.value.length;
        if (o.onProgress) o.onProgress(total ? Math.min(1, got / total) : 0, got);
    }
    return new Blob(parts, { type });
}
function muTempGet(id) { const e = mu.temp.get(id); if (!e) return null; e.t = Date.now(); return e.blob; }
function muTempTrim(keepId) {
    const limit = Math.max(20, Number(muCfg().tempMB) || 150) * 1048576, keep = new Set([keepId, mp.cur && mp.cur.id]);
    while (mu.tempBytes > limit && mu.temp.size > 1) {
        let oldest = null;
        mu.temp.forEach((e, k) => { if (!keep.has(k) && (!oldest || e.t < oldest.t)) oldest = { k, t: e.t }; });
        if (!oldest) break;
        mu.tempBytes -= mu.temp.get(oldest.k).blob.size; mu.temp.delete(oldest.k);
    }
}
function muTempPut(id, blob) {
    const old = mu.temp.get(id); if (old) mu.tempBytes -= old.blob.size;
    mu.temp.set(id, { blob, t: Date.now() }); mu.tempBytes += blob.size;
    muTempTrim(id); renderMusicCache();
}
function muTempClear() { mu.temp.clear(); mu.tempBytes = 0; }
async function muGetBlob(t, o) {
    const off = await MuDB.get('audio', t.id);
    if (off && off.blob) return { blob: off.blob, from: 'device' };
    if (mp.pfId === t.id && mp.pfPromise) { try { await mp.pfPromise; } catch (e) {} }
    const tmp = muTempGet(t.id);
    if (tmp) return { blob: tmp, from: 'temp' };
    if (!navigator.onLine) throw muErr('offline', 'Нет интернета, а эта песня не скачана на устройство');
    if (!muHasToken()) throw muErr('auth');
    const blob = await muFetchAudio(t, o);
    muTempPut(t.id, blob);
    return { blob, from: 'cloud' };
}

// ---------- Очередь и управление ----------
function muShuffleArr(arr, firstId) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); const x = a[i]; a[i] = a[j]; a[j] = x; }
    if (firstId) { const k = a.indexOf(firstId); if (k > 0) { a.splice(k, 1); a.unshift(firstId); } }
    return a;
}
function muStart(ids, index, o) {
    o = o || {};
    ids = Array.from(new Set((ids || []).filter(id => mu.by.has(id))));
    if (!ids.length) { toast('Нет песен для воспроизведения'); return; }
    muPlayerInit();
    const first = index >= 0 && index < (ids.length) ? ids[index] : ids[0];
    mp.base = ids.slice();
    if (o.shuffle === true) mp.shuffle = true; else if (o.shuffle === false) mp.shuffle = false;
    if (mp.shuffle) { mp.list = muShuffleArr(ids, o.shuffle === true ? ids[Math.floor(Math.random() * ids.length)] : first); mp.idx = 0; }
    else { mp.list = ids.slice(); mp.idx = Math.max(0, ids.indexOf(first)); }
    muSaveQueue(); muPlayIdx(mp.idx);
}
function muSetShuffle(on) {
    mp.shuffle = !!on; const cid = mp.cur && mp.cur.id;
    if (mp.shuffle) { mp.list = muShuffleArr(mp.base, cid); mp.idx = cid ? 0 : -1; }
    else { mp.list = mp.base.slice(); mp.idx = cid ? mp.list.indexOf(cid) : -1; }
    muSaveQueue(); muPlayerSync();
}
function muCycleRepeat() { mp.repeat = mp.repeat === 'off' ? 'all' : mp.repeat === 'all' ? 'one' : 'off'; muSaveQueue(); muPlayerSync(); }
function muQueueAdd(id, next) {
    if (!mp.list.length) { muStart([id], 0, {}); return; }
    mp.list = mp.list.filter((x, i) => x !== id || i === mp.idx); mp.base = mp.base.filter(x => x !== id || (mp.cur && x === mp.cur.id));
    const li = mp.idx + 1, bi = mp.cur ? mp.base.indexOf(mp.cur.id) + 1 : mp.base.length;
    if (next) { mp.list.splice(li, 0, id); mp.base.splice(bi, 0, id); } else { mp.list.push(id); mp.base.push(id); }
    muSaveQueue(); toast(next ? 'Сыграет следом' : 'Добавлено в очередь'); muPlayerSync();
}
function muPeekNext() {
    if (mp.repeat === 'one' || !mp.list.length) return '';
    if (mp.idx + 1 < mp.list.length) return mp.list[mp.idx + 1];
    return mp.repeat === 'all' ? mp.list[0] : '';
}
function muNext(auto) {
    if (!mp.list.length) return;
    if (auto && mp.repeat === 'one') { muAudio.currentTime = 0; muAudio.play().catch(() => {}); return; }
    let i = mp.idx + 1;
    if (i >= mp.list.length) {
        if (mp.repeat === 'all') i = 0;
        else if (auto) { muAudio.pause(); muAudio.currentTime = 0; muPlayerSync(); return; }
        else { toast('Это последняя песня в очереди'); return; }
    }
    muPlayIdx(i);
}
function muPrev() {
    if (!mp.list.length) return;
    if (muAudio.currentTime > 3 || mp.idx <= 0 && mp.repeat !== 'all') { muAudio.currentTime = 0; return; }
    muPlayIdx(mp.idx <= 0 ? mp.list.length - 1 : mp.idx - 1);
}
function muToggle() {
    if (!mp.cur) return;
    if (mp.loading) return;
    if (!muAudio.src || !mp.url) { muPlayIdx(mp.idx, { startAt: mp.startAt }); return; }
    if (muAudio.paused) muAudio.play().catch(() => {}); else muAudio.pause();
}
function muStopPrefetch() { if (mp.pfCtrl) { try { mp.pfCtrl.abort(); } catch (e) {} } mp.pfCtrl = null; mp.pfId = ''; mp.pfPromise = null; }
async function muPrefetchNext() {
    const id = muPeekNext(), t = id && mu.by.get(id);
    if (!t || !navigator.onLine || !muHasToken() || mu.offline.has(id) || mu.temp.has(id) || mp.pfId === id) return;
    if ((t.size || 0) > (Number(muCfg().tempMB) || 150) * 1048576 / 2) return;
    muStopPrefetch();
    const ctrl = new AbortController(); mp.pfCtrl = ctrl; mp.pfId = id;
    const p = muFetchAudio(t, { signal: ctrl.signal }).then(blob => { if (!ctrl.signal.aborted) muTempPut(id, blob); });
    mp.pfPromise = p;
    try { await p; } catch (e) { /* не страшно: песня загрузится, когда до неё дойдёт очередь */ }
    if (mp.pfCtrl === ctrl) { mp.pfCtrl = null; mp.pfId = ''; mp.pfPromise = null; }
}
async function muPlayIdx(i, o) {
    o = o || {};
    if (!muAudio) muPlayerInit();
    const t = mu.by.get(mp.list[i]);
    if (!t) { toast('Песня больше не найдена в коллекции'); return; }
    mp.idx = i; mp.cur = t; mp.startAt = o.startAt || 0; mp.err = '';
    const seq = ++mp.seq;
    if (mp.ctrl) { try { mp.ctrl.abort(); } catch (e) {} }
    mp.ctrl = new AbortController();
    try { muAudio.pause(); } catch (e) {}
    mp.loading = true; mp.loadPct = 0;
    if (mp.pfId && mp.pfId !== t.id) muStopPrefetch();
    muPlayerSync(); muSaveQueue();
    try {
        const r = await muGetBlob(t, { signal: mp.ctrl.signal, onProgress: p => { if (seq === mp.seq) { mp.loadPct = p; muPaintLoad(); } } });
        if (seq !== mp.seq) return;
        const url = URL.createObjectURL(r.blob), old = mp.url;
        mp.url = url; muAudio.src = url; if (old) URL.revokeObjectURL(old);
        mp.loading = false; muPlayerSync();
        try { await muAudio.play(); } catch (e) { if (!e || e.name !== 'NotAllowedError') { if (e && e.name === 'AbortError') return; throw e; } }
    } catch (e) {
        if (seq !== mp.seq) return;
        mp.loading = false;
        if (e && e.name === 'AbortError') { muPlayerSync(); return; }
        if (e && e.name === 'NotSupportedError') { muPlayerSync(); return; }
        console.warn('Воспроизведение', e);
        if (e && e.code === 'auth') {
            mp.err = 'Нужно подтвердить доступ к Google Диску';
            toast('Доступ к Google Диску истёк', { action: 'Подтвердить', ms: 8000, onAction: () => { muEnsureAccess().then(ok => { if (ok && mp.cur && mp.cur.id === t.id) muPlayIdx(mp.idx, o); renderMusicConnect(); }); } });
        } else { mp.err = muErrText(e); toast(mp.err, { ms: 5000 }); }
        muPlayerSync();
    }
}
function muSaveQueue() {
    if (!mp.cur) return;
    LS.set(MP_STATE, { base: mp.base, list: mp.list, cur: mp.cur.id, shuffle: mp.shuffle, repeat: mp.repeat });
}
let muPosSaved = 0;
function muSavePos(force) { if (!force && Date.now() - muPosSaved < 4000) return; muPosSaved = Date.now(); if (mp.cur && muAudio && isFinite(muAudio.currentTime) && muAudio.currentTime > 0) LS.set(MP_POS, { id: mp.cur.id, pos: Math.floor(muAudio.currentTime) }); }
function muRestorePlayer() {
    const s = LS.get(MP_STATE, null); if (!s || !Array.isArray(s.list) || !s.cur) return;
    const ok = id => mu.by.has(id);
    mp.base = (s.base || []).filter(ok); mp.list = s.list.filter(ok); mp.shuffle = !!s.shuffle; mp.repeat = s.repeat === 'all' || s.repeat === 'one' ? s.repeat : 'off';
    const i = mp.list.indexOf(s.cur); if (i < 0) { mp.list = []; mp.base = []; return; }
    mp.idx = i; mp.cur = mu.by.get(s.cur);
    const p = LS.get(MP_POS, null); mp.startAt = p && p.id === s.cur ? Number(p.pos) || 0 : 0;
}

// ---------- Оформление: мини-плеер и полный плеер ----------
function muPlayerMarkup() {
    return '<div class="mu-mini" id="mu-mini" hidden>' +
        '<div class="mu-mini-prog" aria-hidden="true"><i></i></div>' +
        '<button type="button" class="mu-mini-main" data-mp="open" aria-label="Открыть плеер"><span class="mu-mini-cov"></span><span class="mu-mini-tx"><b></b><span></span></span></button>' +
        '<button type="button" class="icon-btn mu-mini-play" data-mp="toggle" aria-label="Играть"></button>' +
        '<button type="button" class="icon-btn" data-mp="next" aria-label="Следующая песня">' + ic('skip_next') + '</button></div>' +
        '<div class="mu-full" id="mu-full" hidden role="dialog" aria-modal="true" aria-label="Плеер">' +
        '<div class="mu-full-top"><button type="button" class="icon-btn" data-mp="close" aria-label="Свернуть">' + ic('expand_more') + '</button><span>Сейчас играет</span><button type="button" class="icon-btn" data-mp="menu" aria-label="Ещё">' + ic('more_vert') + '</button></div>' +
        '<div class="mu-full-art"><span class="mu-full-cov"></span></div>' +
        '<div class="mu-full-info"><div class="mu-full-tx"><h2 data-f="title"></h2><p data-f="artist"></p><small data-f="status"></small></div>' +
        '<button type="button" class="icon-btn mu-fav" data-mp="fav" aria-label="В избранное">' + ic('favorite_border') + '</button></div>' +
        '<div class="mu-seekwrap"><div class="mu-wave" id="mu-wave"><i class="mu-wave-off"></i><i class="mu-wave-on"></i></div>' +
        '<input type="range" class="mu-seek" id="mu-seek" min="0" max="1000" value="0" step="1" aria-label="Перемотка"></div>' +
        '<div class="mu-times"><span data-f="cur">0:00</span><span data-f="dur">0:00</span></div>' +
        '<div class="mu-ctrl"><button type="button" class="icon-btn" data-mp="shuffle" aria-label="Вперемешку">' + ic('shuffle') + '</button>' +
        '<button type="button" class="mu-ctrl-btn" data-mp="prev" aria-label="Предыдущая песня">' + ic('skip_previous') + '</button>' +
        '<button type="button" class="mu-ctrl-play" data-mp="toggle" aria-label="Играть"></button>' +
        '<button type="button" class="mu-ctrl-btn" data-mp="next" aria-label="Следующая песня">' + ic('skip_next') + '</button>' +
        '<button type="button" class="icon-btn" data-mp="repeat" aria-label="Повтор">' + ic('repeat') + '</button></div>' +
        '<div class="mu-full-foot"><button type="button" class="btn" data-mp="queue">' + ic('queue_music') + 'Очередь</button>' +
        '<button type="button" class="btn" data-mp="offline" data-f="offline">' + ic('cloud_download') + 'Скачать</button></div></div>';
}
function muEl(sel) { return document.querySelector(sel); }
const muTints = new Map();
async function muTintFor(ak) {
    if (muTints.has(ak)) return muTints.get(ak);
    let col = '';
    try {
        const u = await muCoverUrl(ak);
        if (u) {
            const img = new Image(); img.src = u; await img.decode();
            const c = document.createElement('canvas'); c.width = c.height = 8; const x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(img, 0, 0, 8, 8);
            const d = x.getImageData(0, 0, 8, 8).data; let r = 0, g = 0, b = 0, w = 0;
            for (let i = 0; i < d.length; i += 4) { const mx = Math.max(d[i], d[i + 1], d[i + 2]), mn = Math.min(d[i], d[i + 1], d[i + 2]), k = 0.15 + (mx - mn) / 255; r += d[i] * k; g += d[i + 1] * k; b += d[i + 2] * k; w += k; }
            col = 'rgb(' + Math.round(r / w) + ',' + Math.round(g / w) + ',' + Math.round(b / w) + ')';
        }
    } catch (e) { col = ''; }
    muTints.set(ak, col); return col;
}
function muPaintLoad() {
    const mini = muEl('#mu-mini'); if (!mini) return;
    const pct = Math.round(mp.loadPct * 100);
    if (mp.loading) { mini.querySelector('.mu-mini-prog i').style.width = pct + '%'; const st = muEl('#mu-full [data-f="status"]'); if (st) st.textContent = 'Загрузка ' + (pct ? pct + '%' : '…'); }
}
function muPaintTime() {
    const a = muAudio; if (!a || !mp.cur) return;
    const dur = isFinite(a.duration) && a.duration > 0 ? a.duration : (mp.cur.dur || 0), pos = a.currentTime || 0, share = dur ? Math.min(1, pos / dur) : 0;
    if (!mp.loading) { const bar = muEl('#mu-mini .mu-mini-prog i'); if (bar) bar.style.width = (share * 100) + '%'; }
    const wave = muEl('#mu-wave'); if (wave && !mp.seeking) { wave.style.setProperty('--p', (share * 100) + '%'); const sk = muEl('#mu-seek'); if (sk) sk.value = Math.round(share * 1000); }
    const cu = muEl('#mu-full [data-f="cur"]'), du = muEl('#mu-full [data-f="dur"]');
    if (cu && !mp.seeking) cu.textContent = fmtDuration(pos);
    if (du) du.textContent = dur ? fmtDuration(dur) : '';
}
let muPaintRaf = 0;
function muPaintTimeSoon() { if (muPaintRaf) return; muPaintRaf = requestAnimationFrame(() => { muPaintRaf = 0; muPaintTime(); }); }
function muPlayerSync() {
    // подсветка играющей песни в списках
    const cid = mp.cur && mp.cur.id;
    $$('#music .mu-song[data-id]').forEach(el => el.classList.toggle('is-now', el.dataset.id === cid));
    const mini = muEl('#mu-mini'), full = muEl('#mu-full'); if (!mini || !full) return;
    const t = mp.cur;
    mini.hidden = !t; document.body.classList.toggle('has-mini', !!t);
    if (!t) { if (!full.hidden) muCloseFull(); return; }
    const playing = !!muAudio && !muAudio.paused && !muAudio.ended && !mp.loading;
    if (mp.painted !== t.id) {
        mp.painted = t.id;
        mini.querySelector('.mu-mini-cov').innerHTML = muCoverHtml(t.ak, 'sm'); muHydrate(mini);
        full.querySelector('.mu-full-cov').innerHTML = muCoverHtml(t.ak, 'full'); muHydrate(full);
        mini.querySelector('.mu-mini-tx b').textContent = muTitle(t); mini.querySelector('.mu-mini-tx span').textContent = muArtist(t);
        full.querySelector('[data-f="title"]').textContent = muTitle(t); full.querySelector('[data-f="artist"]').textContent = muArtist(t) + (t.album ? ' · ' + t.album : '');
        const ak = t.ak; muTintFor(ak).then(c => { if (mp.cur && mp.cur.ak === ak) full.style.setProperty('--mu-tint', c || ''); });
        muMediaMeta(); muPaintTime();
    }
    const playIc = mp.loading ? '<span class="mu-spinner" aria-hidden="true"></span>' : ic(playing ? 'pause' : 'play_arrow');
    mini.querySelector('.mu-mini-play').innerHTML = playIc; mini.querySelector('.mu-mini-play').setAttribute('aria-label', playing ? 'Пауза' : 'Играть');
    const big = full.querySelector('.mu-ctrl-play'); big.innerHTML = playIc; big.setAttribute('aria-label', playing ? 'Пауза' : 'Играть'); big.classList.toggle('is-playing', playing);
    full.classList.toggle('is-playing', playing); full.classList.toggle('is-loading', mp.loading); mini.classList.toggle('is-loading', mp.loading);
    const sh = full.querySelector('[data-mp="shuffle"]'); sh.classList.toggle('is-on', mp.shuffle); sh.setAttribute('aria-pressed', mp.shuffle ? 'true' : 'false');
    const rp = full.querySelector('[data-mp="repeat"]'); rp.classList.toggle('is-on', mp.repeat !== 'off'); rp.innerHTML = ic(mp.repeat === 'one' ? 'repeat_one' : 'repeat'); rp.setAttribute('aria-label', mp.repeat === 'off' ? 'Повтор выключен' : mp.repeat === 'all' ? 'Повторять всё' : 'Повторять песню');
    const fav = muIsFav('t', t.id), fb = full.querySelector('[data-mp="fav"]'); fb.classList.toggle('is-on', fav); fb.innerHTML = ic(fav ? 'favorite' : 'favorite_border'); fb.setAttribute('aria-pressed', fav ? 'true' : 'false');
    const off = mu.offline.has(t.id), ob = full.querySelector('[data-f="offline"]');
    ob.innerHTML = ic(off ? 'cloud_done' : 'cloud_download') + (off ? 'На устройстве' : 'Скачать'); ob.classList.toggle('is-on', off);
    const st = full.querySelector('[data-f="status"]');
    st.textContent = mp.loading ? 'Загрузка ' + (mp.loadPct ? Math.round(mp.loadPct * 100) + '%' : '…') : mp.err ? mp.err : (!mp.url ? 'Нажмите ▶, чтобы продолжить' : off ? 'Играет с устройства' : mu.temp.has(t.id) ? 'Из временного кеша' : '');
    st.classList.toggle('is-error', !!mp.err);
}
function muOpenFull() {
    const full = muEl('#mu-full'); if (!full || !mp.cur) return;
    full.hidden = false; mp.full = true; document.body.classList.add('is-locked'); muPaintTime();
    requestAnimationFrame(() => full.classList.add('is-open'));
    setTimeout(() => { const b = full.querySelector('[data-mp="close"]'); if (b) b.focus({ preventScroll: true }); }, 60);
}
function muCloseFull() {
    const full = muEl('#mu-full'); if (!full || full.hidden) return;
    full.classList.remove('is-open'); mp.full = false;
    setTimeout(() => { if (!mp.full) { full.hidden = true; if (!sheetStack.length) document.body.classList.remove('is-locked'); } }, 220);
}

// ---------- Системный плеер (экран блокировки, уведомление, наушники) ----------
async function muMediaMeta() {
    if (!('mediaSession' in navigator) || !mp.cur || typeof MediaMetadata !== 'function') return;
    const t = mp.cur; let art = [];
    try { const u = await muCoverUrl(t.ak); if (u) art = [{ src: u, sizes: '360x360', type: 'image/jpeg' }]; } catch (e) {}
    if (mp.cur !== t) return;
    try { navigator.mediaSession.metadata = new MediaMetadata({ title: muTitle(t), artist: muArtist(t), album: t.album || '', artwork: art }); } catch (e) {}
}
function muMediaInit() {
    if (!('mediaSession' in navigator)) return;
    const set = (n, f) => { try { navigator.mediaSession.setActionHandler(n, f); } catch (e) {} };
    set('play', () => muToggle()); set('pause', () => { if (muAudio && !muAudio.paused) muAudio.pause(); });
    set('previoustrack', () => muPrev()); set('nexttrack', () => muNext(false));
    set('seekto', d => { if (muAudio && d && isFinite(d.seekTime)) muAudio.currentTime = d.seekTime; });
    set('seekbackward', d => { if (muAudio) muAudio.currentTime = Math.max(0, muAudio.currentTime - ((d && d.seekOffset) || 10)); });
    set('seekforward', d => { if (muAudio) muAudio.currentTime = Math.min(muAudio.duration || 1e9, muAudio.currentTime + ((d && d.seekOffset) || 10)); });
}
let muPosStamp = 0;
function muMediaPos() {
    if (!('mediaSession' in navigator) || !muAudio || !isFinite(muAudio.duration) || !(muAudio.duration > 0)) return;
    const now = Date.now(); if (now - muPosStamp < 900) return; muPosStamp = now;
    try { navigator.mediaSession.setPositionState({ duration: muAudio.duration, playbackRate: muAudio.playbackRate || 1, position: Math.min(muAudio.currentTime, muAudio.duration) }); } catch (e) {}
}

// ---------- Запуск плеера ----------
function muPlayerInit() {
    if (muAudio) return;
    muAudio = new Audio(); muAudio.preload = 'auto'; muAudio.setAttribute('playsinline', '');
    const wrap = document.createElement('div'); wrap.id = 'mu-player-host'; wrap.innerHTML = muPlayerMarkup(); document.body.appendChild(wrap);
    const a = muAudio;
    a.addEventListener('play', () => { muPlayerSync(); if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'playing'; });
    a.addEventListener('pause', () => { muPlayerSync(); muSavePos(true); if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'paused'; });
    a.addEventListener('playing', () => { mp.fails = 0; muPlayerSync(); muPrefetchNext(); });
    a.addEventListener('waiting', muPlayerSync);
    a.addEventListener('timeupdate', () => { muPaintTimeSoon(); muMediaPos(); muSavePos(); });
    a.addEventListener('durationchange', () => {
        muPaintTimeSoon();
        if (mp.cur && isFinite(a.duration) && a.duration > 1 && !mp.cur.dur) { mp.cur.dur = Math.round(a.duration); MuDB.put('tracks', mp.cur).catch(() => {}); muBuild(); }
    });
    a.addEventListener('loadedmetadata', () => { if (mp.startAt > 0 && isFinite(a.duration) && mp.startAt < a.duration - 1) { try { a.currentTime = mp.startAt; } catch (e) {} } mp.startAt = 0; muPaintTime(); });
    a.addEventListener('ended', () => muNext(true));
    a.addEventListener('error', () => {
        if (!mp.url || !mp.cur) return;
        const bad = mp.cur; mp.fails++;
        mp.err = 'Не удалось воспроизвести «' + muTitle(bad) + '» — формат не поддерживается этим устройством или файл повреждён';
        toast(mp.err, { ms: 5000 }); muPlayerSync();
        if (mp.fails < 3 && mp.list.length > 1 && mp.idx + 1 < mp.list.length) setTimeout(() => { if (mp.cur === bad) muNext(true); }, 800);
    });
    const mini = muEl('#mu-mini'), full = muEl('#mu-full');
    const onAct = e => {
        const b = e.target.closest('[data-mp]'); if (!b) return;
        const act = b.dataset.mp;
        if (act === 'open') muOpenFull(); else if (act === 'close') muCloseFull();
        else if (act === 'toggle') muToggle(); else if (act === 'next') muNext(false); else if (act === 'prev') muPrev();
        else if (act === 'shuffle') muSetShuffle(!mp.shuffle); else if (act === 'repeat') muCycleRepeat();
        else if (act === 'fav' && mp.cur) muToggleFav('t', mp.cur.id, muTitle(mp.cur) + ' — ' + muArtist(mp.cur));
        else if (act === 'queue') muOpenQueue();
        else if (act === 'menu' && mp.cur) muTrackMenu(mp.cur.id);
        else if (act === 'offline' && mp.cur) { if (mu.offline.has(mp.cur.id)) muRemoveOffline([mp.cur.id]); else muConfirmDownload([mp.cur.id]); }
    };
    mini.addEventListener('click', onAct); full.addEventListener('click', onAct);
    const seek = muEl('#mu-seek'), wave = muEl('#mu-wave');
    seek.addEventListener('pointerdown', () => { mp.seeking = true; });
    seek.addEventListener('input', () => {
        mp.seeking = true; const dur = isFinite(a.duration) ? a.duration : (mp.cur && mp.cur.dur) || 0;
        wave.style.setProperty('--p', (seek.value / 10) + '%'); const cu = muEl('#mu-full [data-f="cur"]'); if (cu) cu.textContent = fmtDuration(dur * seek.value / 1000);
    });
    seek.addEventListener('change', () => {
        if (isFinite(a.duration) && a.duration > 0) a.currentTime = a.duration * seek.value / 1000;
        mp.seeking = false; muPaintTime();
    });
    seek.addEventListener('pointerup', () => { setTimeout(() => { mp.seeking = false; }, 60); });
    document.addEventListener('keydown', e => {
        if (e.key === 'Escape' && mp.full && !sheetStack.length) muCloseFull();
    });
    window.addEventListener('pagehide', () => muSavePos(true));
    window.addEventListener('beforeunload', () => muSavePos(true));
    muMediaInit();
}
// Первый запуск плеера после загрузки коллекции: вернуть очередь, на которой остановились
function muPlayerBoot() {
    muPlayerInit();
    if (!mp.cur) { muRestorePlayer(); }
    muPlayerSync();
    renderMusicCache();
}

// ---------- Очередь (шторка) ----------
function muOpenQueue() {
    if (!mp.list.length) { toast('Очередь пуста'); return; }
    const from = Math.max(0, mp.idx - 25), max = 300;
    const sheet = openSheet({ title: 'Очередь · ' + muSongsWord(mp.list.length), html: '<div class="mu-rows mu-queue" id="mu-queue"></div>', actions: [{ label: 'Закрыть' }] });
    const host = $('#mu-queue', sheet.el);
    host.innerHTML = mp.list.slice(from, from + max).map((id, k) => {
        const t = mu.by.get(id); if (!t) return '';
        const i = from + k, now = i === mp.idx;
        return '<button type="button" class="mu-song-main mu-q-row' + (now ? ' is-now' : '') + '" data-i="' + i + '">' + muCoverHtml(t.ak, 'sm') + '<span class="mu-song-tx"><b>' + esc(muTitle(t)) + '</b><span>' + esc(muArtist(t)) + '</span></span>' +
            (now ? '<span class="mu-chev">' + ic('graphic_eq') + '</span>' : '') + '</button>';
    }).join('') + (mp.list.length > from + max ? '<p class="hint" style="margin:0.5rem 0.75rem">…и ещё ' + (mp.list.length - from - max) + '</p>' : '');
    muHydrate(host);
    host.addEventListener('click', e => { const b = e.target.closest('.mu-q-row'); if (!b) return; sheet.close(); muPlayIdx(+b.dataset.i); });
    const now = host.querySelector('.is-now'); if (now) setTimeout(() => now.scrollIntoView({ block: 'center' }), 60);
}

// ---------- Меню песни ----------
function muGotoGroup(kind, key) {
    muCloseFull();
    if (!$('#music').classList.contains('is-active')) showTab('music');
    muCfgSave({ tab: kind === 'album' ? 'albums' : kind === 'artist' ? 'artists' : 'composers' }); mu.q = ''; const si = $('#mu-search'); if (si) { si.value = ''; $('#mu-search-clear').hidden = true; }
    muOpenGroup(kind, key);
}
function muTrackMenu(id) {
    const t = mu.by.get(id); if (!t) return;
    const off = mu.offline.has(id), fav = muIsFav('t', id), artist = muSplit(t.artist)[0], comp = muSplit(t.composer)[0];
    const items = [
        ['next', 'playlist_play', 'Играть следом'], ['queue', 'queue_music', 'Добавить в очередь'],
        ['fav', fav ? 'favorite' : 'favorite_border', fav ? 'Убрать из избранного' : 'В избранное'],
        off ? ['rm', 'delete', 'Удалить с устройства'] : ['dl', 'cloud_download', 'Скачать на устройство'],
        ['album', 'album', 'К альбому «' + muAlbumName(t) + '»']
    ];
    if (artist) items.push(['artist', 'person', 'К исполнителю: ' + artist]);
    if (comp) items.push(['composer', 'edit_note', 'К композитору: ' + comp]);
    items.push(['info', 'info', 'О песне']);
    const sheet = openSheet({
        title: muTitle(t),
        html: '<p class="hint" style="margin:-0.25rem 0.25rem 0.5rem">' + esc(muArtist(t)) + '</p><div class="mu-menu">' + items.map(i => '<button type="button" class="mu-menu-row" data-a="' + i[0] + '">' + ic(i[1]) + '<span>' + esc(i[2]) + '</span></button>').join('') + '</div>'
    });
    sheet.el.addEventListener('click', e => {
        const b = e.target.closest('.mu-menu-row'); if (!b) return; const a = b.dataset.a; sheet.close();
        if (a === 'next') muQueueAdd(id, true); else if (a === 'queue') muQueueAdd(id, false);
        else if (a === 'fav') muToggleFav('t', id, muTitle(t) + ' — ' + muArtist(t));
        else if (a === 'dl') muConfirmDownload([id]); else if (a === 'rm') muRemoveOffline([id]);
        else if (a === 'album') muGotoGroup('album', t.ak);
        else if (a === 'artist') muGotoGroup('artist', muNorm(artist)); else if (a === 'composer') muGotoGroup('composer', muNorm(comp));
        else if (a === 'info') muTrackInfo(t);
    });
}
function muTrackInfo(t) {
    const rows = [['Название', muTitle(t)], ['Исполнитель', t.artist], ['Альбом', t.album], ['Исполнитель альбома', t.albumArtist], ['Композитор', t.composer], ['Жанр', t.genre], ['Год', t.year || ''], ['Номер', t.track ? (t.disc ? t.disc + '-' : '') + t.track : ''], ['Длительность', muFmtDur(t.dur)], ['Формат', (t.ext || '').toUpperCase() + (t.size ? ' · ' + fmtBytes(t.size) : '')], ['Папка', (t.path || []).join(' / ')], ['Файл', t.name]];
    openSheet({ title: 'О песне', html: '<dl class="mu-info">' + rows.filter(r => r[1]).map(r => '<dt>' + esc(r[0]) + '</dt><dd>' + esc(r[1]) + '</dd>').join('') + '</dl>', actions: [{ label: 'Закрыть' }] });
}

// ---------- Загрузки на устройство ----------
const dl = { active: false, cancel: false, pause: '', queue: LS.get(MU_DLQ, []), done: 0, total: 0, bytes: 0, bytesTotal: 0, fail: 0, startedAt: 0 };
if (!Array.isArray(dl.queue)) dl.queue = [];
function muDlSave() { if (dl.queue.length) LS.set(MU_DLQ, dl.queue); else LS.del(MU_DLQ); }
let muDlRaf = 0;
function muDlPaintSoon() { if (muDlRaf) return; muDlRaf = requestAnimationFrame(() => { muDlRaf = 0; renderMusicCache(); }); }
function muDlPause(reason) {
    dl.pause = reason;
    if (reason === 'auth') toast('Загрузка приостановлена: истёк доступ к Диску', { action: 'Продолжить', ms: 9000, onAction: () => muResumeDownload() });
    else if (reason === 'net') toast('Загрузка приостановлена: нет связи. Продолжите, когда появится интернет.', { ms: 6000 });
    else if (reason === 'quota') toast('Не хватило места на устройстве — загрузка остановлена', { ms: 7000 });
}
async function muDownload(ids) {
    const have = new Set(dl.queue);
    ids = Array.from(new Set(ids)).filter(id => mu.by.has(id) && !mu.offline.has(id) && !have.has(id));
    if (ids.length) { dl.queue.push(...ids); dl.total += ids.length; dl.bytesTotal += ids.reduce((s, id) => s + (mu.by.get(id).size || 0), 0); }
    muDlSave();
    if (dl.active) { muDlPaintSoon(); return; }
    if (!dl.queue.length) { toast('Всё это уже на устройстве'); return; }
    if (!dl.total) { dl.total = dl.queue.length; dl.bytesTotal = dl.queue.reduce((s, id) => s + ((mu.by.get(id) || {}).size || 0), 0); }
    dl.active = true; dl.cancel = false; dl.pause = ''; dl.fail = 0; dl.startedAt = Date.now(); renderMusicCache();
    try { if (navigator.storage && navigator.storage.persist) await navigator.storage.persist(); } catch (e) {}
    let savedBytes = 0, savedN = 0;
    const worker = async () => {
        while (!dl.cancel && !dl.pause) {
            const id = dl.queue.shift(); if (!id) return;
            const t = mu.by.get(id);
            if (!t || mu.offline.has(id)) { dl.done++; muDlSave(); continue; }
            let last = 0;
            try {
                const blob = await muFetchAudio(t, { shouldStop: () => dl.cancel, onProgress: (p, got) => { dl.bytes += got - last; last = got; muDlPaintSoon(); } });
                await MuDB.put('audio', { id, blob, size: blob.size, t: Date.now() });
                mu.offline.set(id, blob.size); dl.done++; savedBytes += blob.size; savedN++;
            } catch (e) {
                dl.bytes -= last;
                if (dl.cancel || (e && e.name === 'AbortError')) { /* отменено */ }
                else if (e && e.code === 'auth') { dl.queue.unshift(id); muDlPause('auth'); }
                else if (e && (e.name === 'QuotaExceededError' || /quota/i.test(String(e && e.message)))) { dl.queue.unshift(id); muDlPause('quota'); }
                else if (e && e.code === 'network' || !navigator.onLine) { dl.queue.unshift(id); muDlPause('net'); }
                else { dl.fail++; dl.done++; console.warn('Загрузка песни', t.name, e); }
            }
            muDlSave(); muDlPaintSoon();
        }
    };
    await Promise.all([worker(), worker()]);
    dl.active = false;
    if (dl.cancel) { dl.queue = []; muDlSave(); }
    const left = dl.queue.length;
    if (!left || dl.cancel) { dl.total = 0; dl.done = 0; dl.bytes = 0; dl.bytesTotal = 0; }
    if (dl.cancel) toast(savedN ? 'Загрузка отменена. Уже скачано: ' + muSongsWord(savedN) : 'Загрузка отменена');
    else if (!dl.pause) toast('Скачано на устройство: ' + muSongsWord(savedN) + ' (' + fmtBytes(savedBytes) + ')' + (dl.fail ? ', не удалось: ' + dl.fail : ''), { ms: 5000 });
    renderMusic();
}
async function muResumeDownload() {
    if (!dl.queue.length) { dl.pause = ''; renderMusicCache(); return; }
    if (!muHasToken() && !(await muEnsureAccess())) return;
    muDownload([]);
}
async function muStartDownload(ids) {
    ids = Array.from(new Set(ids)).filter(id => mu.by.has(id) && !mu.offline.has(id));
    if (!ids.length) { toast('Эти песни уже на устройстве'); return; }
    if (!muHasToken() && !(await muEnsureAccess())) { renderMusicConnect(); return; }
    muDownload(ids);
}
async function muConfirmDownload(ids, title) {
    ids = Array.from(new Set(ids)).filter(id => mu.by.has(id));
    const todo = ids.filter(id => !mu.offline.has(id));
    if (!todo.length) { toast('Эти песни уже на устройстве'); return; }
    const bytes = todo.reduce((s, id) => s + (mu.by.get(id).size || 0), 0);
    let free = null; try { const e = await navigator.storage.estimate(); if (e && e.quota) free = e.quota - (e.usage || 0); } catch (e) {}
    const low = free != null && bytes > free * 0.85;
    const ok = await confirmSheet(title || 'Скачать на устройство?', muSongsWord(todo.length) + ', около ' + fmtBytes(bytes) + '. Они сохранятся в памяти устройства и будут играть без интернета.' + (low ? ' Внимание: свободного места может не хватить (доступно примерно ' + fmtBytes(free) + ').' : ''), 'Скачать');
    if (ok) muStartDownload(todo);
}
function muDownloadAllCloud() { muConfirmDownload(mu.tracks.map(t => t.id), 'Скачать всё из облака?'); }
async function muRemoveOffline(ids) {
    ids = ids.filter(id => mu.offline.has(id)); if (!ids.length) return;
    await MuDB.delMany('audio', ids); ids.forEach(id => mu.offline.delete(id));
    toast('Удалено с устройства: ' + muSongsWord(ids.length)); renderMusic();
}
async function muClearAllCache() {
    const n = mu.offline.size; let bytes = 0; mu.offline.forEach(v => { bytes += v; });
    if (!n && !mu.tempBytes && !dl.queue.length) { toast('Кеш уже пуст'); return; }
    const ok = await confirmSheet('Удалить всё из кеша?', 'С устройства будут удалены скачанные песни (' + muSongsWord(n) + ', ' + fmtBytes(bytes) + ') и временный кеш (' + fmtBytes(mu.tempBytes) + '). Коллекция в облаке и список песен останутся.', 'Удалить', true);
    if (!ok) return;
    dl.cancel = true; dl.queue = []; muDlSave();
    muStopPrefetch();
    await MuDB.clear('audio'); mu.offline = new Map(); muTempClear();
    toast('Кеш очищен'); renderMusic();
}

// Шторка «Скачать…»: что именно скачать
function muFavTrackIds() {
    const s = new Set();
    mu.tracks.forEach(t => { if (muFavSet.has('t:' + t.id) || muFavSet.has('a:' + t.ak)) s.add(t.id); });
    mu.artists.forEach(g => { if (muFavSet.has('p:' + g.key)) g.tracks.forEach(t => s.add(t.id)); });
    mu.composers.forEach(g => { if (muFavSet.has('c:' + g.key)) g.tracks.forEach(t => s.add(t.id)); });
    return Array.from(s);
}
function muOpenDownloadSheet() {
    if (!mu.tracks.length) { toast('Сначала загрузите коллекцию'); return; }
    const st = { scope: 'all', pick: new Set(), q: '' };
    const scopes = [['all', 'cloud_download', 'Всё из облака'], ['fav', 'favorite', 'Всё избранное'], ['albums', 'album', 'Выбрать альбомы'], ['artists', 'person', 'Выбрать исполнителей'], ['songs', 'music_note', 'Выбрать песни']];
    const idsFor = () => {
        if (st.scope === 'all') return mu.tracks.map(t => t.id);
        if (st.scope === 'fav') return muFavTrackIds();
        if (st.scope === 'albums') return [].concat(...Array.from(st.pick).map(k => (mu.albums.get(k) || { tracks: [] }).tracks.map(t => t.id)));
        if (st.scope === 'artists') return [].concat(...Array.from(st.pick).map(k => (mu.artists.get(k) || { tracks: [] }).tracks.map(t => t.id)));
        return Array.from(st.pick);
    };
    const need = () => { const ids = Array.from(new Set(idsFor())).filter(id => mu.by.has(id) && !mu.offline.has(id)); return { ids, bytes: ids.reduce((s, id) => s + (mu.by.get(id).size || 0), 0) }; };
    const sheet = openSheet({
        title: 'Скачать на устройство',
        html: '<p class="hint" style="margin:-0.25rem 0.25rem 0.5rem">Скачанные песни играют без интернета и занимают место в памяти устройства.</p><div class="mu-scopes" id="mu-dl-scopes"></div><div id="mu-dl-pick"></div>',
        actions: [{ label: 'Отмена' }, { label: 'Скачать', kind: 'primary', icon: 'cloud_download', async onClick() {
            if (!muHasToken()) { if (!(await muEnsureAccess())) return false; }
            const n = need(); if (!n.ids.length) { toast(st.scope === 'all' || st.scope === 'fav' ? 'Всё это уже на устройстве' : 'Отметьте, что скачать'); return false; }
            let free = null; try { const e = await navigator.storage.estimate(); if (e && e.quota) free = e.quota - (e.usage || 0); } catch (e) {}
            if (free != null && n.bytes > free * 0.85) { const ok = await confirmSheet('Может не хватить места', 'Нужно около ' + fmtBytes(n.bytes) + ', доступно примерно ' + fmtBytes(free) + '. Всё равно начать?', 'Скачать'); if (!ok) return false; }
            muDownload(n.ids);
        } }]
    });
    const scopesEl = $('#mu-dl-scopes', sheet.el), pickEl = $('#mu-dl-pick', sheet.el), go = sheet.el.querySelector('[data-act="1"]');
    const sum = () => { const n = need(); go.innerHTML = ic('cloud_download') + (n.ids.length ? 'Скачать · ' + n.ids.length + ' · ' + fmtBytes(n.bytes) : 'Скачать'); return n; };
    const paintScopes = () => {
        const n0 = { all: mu.tracks.length, fav: muFavTrackIds().length };
        scopesEl.innerHTML = scopes.map(s => '<label class="mu-scope' + (st.scope === s[0] ? ' is-on' : '') + '"><input type="radio" name="mu-dl-scope" value="' + s[0] + '"' + (st.scope === s[0] ? ' checked' : '') + '>' + ic(s[1]) + '<span>' + s[2] + '</span>' + (n0[s[0]] != null ? '<small>' + n0[s[0]] + '</small>' : '') + '</label>').join('');
    };
    const paintPick = () => {
        if (st.scope === 'all' || st.scope === 'fav') { pickEl.innerHTML = st.scope === 'fav' && !muFavTrackIds().length ? '<div class="mu-empty">' + ic('favorite_border') + '<span>В избранном пока пусто.</span></div>' : ''; sum(); return; }
        const toks = muNorm(st.q).split(' ').filter(Boolean);
        let rows;
        if (st.scope === 'albums') rows = Array.from(mu.albums.values()).filter(g => !toks.length || muMatch(g.title + ' ' + g.artist, toks)).sort((a, b) => muByAlpha(a.title, b.title)).map(g => [g.key, g.title, g.artist + ' · ' + muSongsWord(g.tracks.length)]);
        else if (st.scope === 'artists') rows = Array.from(mu.artists.values()).filter(g => !toks.length || muMatch(g.name, toks)).sort((a, b) => muByAlpha(a.name, b.name)).map(g => [g.key, g.name, muSongsWord(g.tracks.length)]);
        else rows = mu.tracks.filter(t => !toks.length || muMatch(muTrackHay(t), toks)).sort((a, b) => muByAlpha(muTitle(a), muTitle(b))).map(t => [t.id, muTitle(t), muArtist(t) + (mu.offline.has(t.id) ? ' · уже на устройстве' : '')]);
        const total = rows.length; rows = rows.slice(0, 200);
        pickEl.innerHTML = '<div class="searchwrap mu-pick-search">' + ic('search') + '<input type="search" id="mu-dl-q" placeholder="Поиск" value="' + esc(st.q) + '" aria-label="Поиск"></div>' +
            '<div class="mu-chk-list">' + (rows.map(r => '<label class="mu-chk"><input type="checkbox" class="check" value="' + esc(r[0]) + '"' + (st.pick.has(r[0]) ? ' checked' : '') + '><span class="mu-chk-tx"><b>' + esc(r[1]) + '</b><span>' + esc(r[2]) + '</span></span></label>').join('') || '<div class="mu-empty">' + ic('search') + '<span>Ничего не нашлось.</span></div>') + '</div>' +
            (total > rows.length ? '<p class="hint" style="margin:0.5rem 0.75rem">Показаны первые 200 из ' + total + ' — уточните поиск.</p>' : '');
        sum();
    };
    scopesEl.addEventListener('change', e => { if (e.target.name !== 'mu-dl-scope') return; st.scope = e.target.value; st.pick = new Set(); st.q = ''; paintScopes(); paintPick(); });
    pickEl.addEventListener('change', e => { if (e.target.type !== 'checkbox') return; e.target.checked ? st.pick.add(e.target.value) : st.pick.delete(e.target.value); sum(); });
    pickEl.addEventListener('input', debounce(e => { if (e.target.id !== 'mu-dl-q') return; st.q = e.target.value; const pos = e.target.selectionStart; paintPick(); const q = $('#mu-dl-q', sheet.el); if (q) { q.focus(); try { q.setSelectionRange(pos, pos); } catch (x) {} } }, 180));
    paintScopes(); paintPick();
}

// ---------- Блок «Кеш и загрузки» на странице ----------
function renderMusicCache() {
    const host = $('#mu-cache'); if (!host) return;
    const card = $('#mu-cache-card'); if (card) card.hidden = !mu.tracks.length && !mu.offline.size && !dl.queue.length;
    let offBytes = 0; mu.offline.forEach(v => { offBytes += v; });
    let h = '<div class="mu-cache-stat"><div>' + ic('cloud_done') + '<span><b>' + muSongsWord(mu.offline.size) + ' на устройстве</b><small>' + fmtBytes(offBytes) + ' · играют без интернета</small></span></div>' +
        '<div>' + ic('memory') + '<span><b>Временный кеш: ' + fmtBytes(mu.tempBytes) + '</b><small>только в памяти, при закрытии исчезнет · лимит ' + (Number(muCfg().tempMB) || 150) + ' МБ</small></span></div></div>';
    if (dl.active || dl.queue.length) {
        const pct = dl.bytesTotal ? Math.min(100, Math.round(dl.bytes / dl.bytesTotal * 100)) : dl.total ? Math.round(dl.done / dl.total * 100) : 0;
        h += '<div class="mu-note' + (dl.active && !dl.pause ? ' is-busy' : '') + '">' + ic(dl.active && !dl.pause ? 'cloud_download' : 'pause_circle') + '<div class="tx"><b>' +
            (dl.active && !dl.pause ? 'Скачиваем: ' + dl.done + ' из ' + dl.total : dl.pause === 'auth' ? 'Загрузка приостановлена — истёк доступ' : dl.pause === 'quota' ? 'Загрузка остановлена — нет места' : dl.pause === 'net' ? 'Загрузка приостановлена — нет связи' : 'Незавершённая загрузка: осталось ' + dl.queue.length) +
            '</b><span>' + (dl.bytesTotal ? fmtBytes(dl.bytes) + ' из ' + fmtBytes(dl.bytesTotal) : '') + '</span>' +
            (dl.active ? '<div class="mu-prog"><i style="width:' + pct + '%"></i></div>' : '') + '</div>' +
            (dl.active && !dl.pause ? '<button type="button" class="btn" data-mu="dl-cancel">' + ic('close') + 'Отмена</button>' : '<button type="button" class="btn btn-primary" data-mu="dl-resume">' + ic('play_arrow') + 'Продолжить</button><button type="button" class="btn" data-mu="dl-cancel">' + ic('close') + 'Сбросить</button>') + '</div>';
    }
    h += '<div class="btn-group mu-cache-btns"><button type="button" class="btn" data-mu="cache-download">' + ic('cloud_download') + 'Скачать…</button><button type="button" class="btn" data-mu="cache-all">' + ic('download_for_offline') + 'Скачать всё с облака</button>' +
        '<button type="button" class="btn btn-danger" data-mu="cache-clear">' + ic('delete_sweep') + 'Удалить всё из кеша</button></div>';
    host.innerHTML = h;
}

// ---------- Настройки музыки ----------
function muOpenSettings() {
    const cfg = muCfg();
    const sheet = openSheet({
        title: 'Настройки музыки',
        html: '<div class="mu-set">' +
            '<div class="mu-set-row">' + ic('folder') + '<div class="tx"><b>' + (cfg.folderId ? esc(cfg.folderName) : 'Папка не выбрана') + '</b><span>Папка с музыкой на Google Диске</span></div><button type="button" class="btn" data-s="pick">' + (cfg.folderId ? 'Сменить' : 'Выбрать') + '</button></div>' +
            '<label class="mu-set-row">' + ic('sync') + '<div class="tx"><b>Обновлять при открытии</b><span>Если доступ к Диску подтверждён, новые песни подтянутся сами</span></div><input type="checkbox" class="switch" id="mu-s-auto"' + (cfg.auto ? ' checked' : '') + '></label>' +
            '<div class="mu-set-row">' + ic('memory') + '<div class="tx"><b>Временный кеш</b><span>Сколько памяти занимает «слушаю с интернетом». На устройство не записывается</span></div>' +
            '<select id="mu-s-temp">' + [50, 150, 300, 600].map(v => '<option value="' + v + '"' + (Number(cfg.tempMB) === v ? ' selected' : '') + '>' + v + ' МБ</option>').join('') + '</select></div>' +
            '<div class="mu-set-row">' + ic('refresh') + '<div class="tx"><b>Перечитать всю коллекцию</b><span>Заново найти песни, теги и обложки</span></div><button type="button" class="btn" data-s="rescan">Перечитать</button></div>' +
            '<div class="mu-set-row">' + ic('link_off') + '<div class="tx"><b>Отключить музыку</b><span>Забыть папку и список песен на этом устройстве (избранное и облако не затрагиваются)</span></div><button type="button" class="btn btn-danger" data-s="reset">Отключить</button></div>' +
            '<p class="instr-row"><button type="button" class="linkbtn instr-link" data-instr="instr-music">' + ic('help') + 'Инструкция</button></p></div>',
        actions: [{ label: 'Готово' }]
    });
    $('#mu-s-auto', sheet.el).addEventListener('change', e => muCfgSave({ auto: e.target.checked }));
    $('#mu-s-temp', sheet.el).addEventListener('change', e => { muCfgSave({ tempMB: +e.target.value }); muTempTrim(); renderMusicCache(); });
    sheet.el.addEventListener('click', async e => {
        const b = e.target.closest('[data-s]'); if (b) {
            const a = b.dataset.s;
            if (a === 'pick') { sheet.close(); muPickFolder(); }
            else if (a === 'rescan') {
                if (!muCfg().folderId) { toast('Сначала выберите папку'); return; }
                if (!muHasToken() && !(await muEnsureAccess())) return;
                sheet.close(); mu.tracks = []; await MuDB.clear('tracks'); await MuDB.clear('covers'); mu.coverKeys.clear(); mu.covUrl.clear(); muBuild(); renderMusic(); muSync();
            } else if (a === 'reset') {
                const ok = await confirmSheet('Отключить музыку?', 'Список песен, обложки и скачанные песни будут удалены с этого устройства. Папка на Google Диске и ваши файлы не затрагиваются. Избранное сохранится.', 'Отключить', true);
                if (!ok) return;
                sheet.close();
                if (muAudio) { muAudio.pause(); muAudio.removeAttribute('src'); muAudio.load(); }
                if (mp.url) { URL.revokeObjectURL(mp.url); mp.url = ''; }
                mp.base = []; mp.list = []; mp.idx = -1; mp.cur = null; mp.painted = ''; LS.del(MP_STATE); LS.del(MP_POS);
                dl.cancel = true; dl.queue = []; muDlSave(); muStopPrefetch();
                await Promise.all([MuDB.clear('tracks'), MuDB.clear('covers'), MuDB.clear('audio')]);
                mu.tracks = []; mu.offline = new Map(); mu.coverKeys.clear(); mu.covUrl.clear(); muTempClear(); muBuild(); mu.detail = null;
                muDropToken(); muCfgSave({ folderId: '', folderName: '', last: 0 });
                renderMusic(); toast('Музыка отключена на этом устройстве');
            }
        }
    });
}
