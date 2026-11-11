'use strict';
// =====================================================================================================
// iLife — ВЛОЖЕНИЯ: картинки (сжатие и миниатюры), аудиоплеер, диктофон, просмотр картинок, значки файлов.
// Вложение в записи — это метаданные { id, kind: image|audio|voice|file, name, type, size, dur?, w?, h? }, сам файл лежит
// в IndexedDB (BlobDB в core.js) под тем же id.
// =====================================================================================================

// ---------- Картинки ----------
async function decodeImage(file) {
    try { return await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch (e) { /* пробуем через <img> */ }
    return new Promise((resolve, reject) => {
        const url = URL.createObjectURL(file); const img = new Image();
        img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
        img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Не удалось прочитать картинку')); };
        img.src = url;
    });
}
function bitmapSize(b) { return { w: b.naturalWidth || b.width, h: b.naturalHeight || b.height }; }
function canvasBlob(source, srcW, srcH, maxSide, quality) {
    const k = Math.min(1, maxSide / Math.max(srcW, srcH));
    const w = Math.max(1, Math.round(srcW * k)), h = Math.max(1, Math.round(srcH * k));
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h); ctx.drawImage(source, 0, 0, w, h);
    return new Promise(res => c.toBlob(b => res({ blob: b, w, h }), 'image/jpeg', quality));
}
// Большие фото сжимаются до 2000 px (JPEG), обычные остаются как есть. Миниатюра 480 px — для списка заметок.
async function prepareImage(file) {
    const keepAsIs = /^image\/(gif|svg\+xml)$/.test(file.type);
    let bmp = null;
    try { bmp = await decodeImage(file); } catch (e) { if (!keepAsIs) throw e; }
    if (!bmp) return { blob: file, thumb: null, type: file.type, name: file.name, size: file.size };
    const { w, h } = bitmapSize(bmp);
    let blob = file, type = file.type || 'image/jpeg', name = file.name || 'картинка.jpg', rw = w, rh = h;
    const lossy = !/^image\/(jpeg|png|webp)$/.test(type);
    if (!keepAsIs && (Math.max(w, h) > 2000 || file.size > 2.5 * 1048576 || lossy)) {
        const r = await canvasBlob(bmp, w, h, 2000, 0.86);
        if (r.blob) { blob = r.blob; type = 'image/jpeg'; rw = r.w; rh = r.h; name = name.replace(/\.[^.]+$/, '') + '.jpg'; }
    }
    const t = keepAsIs ? null : await canvasBlob(bmp, w, h, 480, 0.8);
    if (bmp.close) try { bmp.close(); } catch (e) {}
    return { blob, thumb: t && t.blob || null, type, name, size: blob.size, w: rw, h: rh };
}
function audioDuration(blob) {
    return new Promise(resolve => {
        const a = new Audio(); const url = URL.createObjectURL(blob); let done = false;
        const fin = v => { if (done) return; done = true; URL.revokeObjectURL(url); resolve(v); };
        a.preload = 'metadata'; a.onloadedmetadata = () => fin(isFinite(a.duration) ? a.duration : 0); a.onerror = () => fin(0);
        setTimeout(() => fin(0), 2500); a.src = url;
    });
}
// Файл → черновик вложения (в памяти; в IndexedDB попадёт при сохранении записи)
async function makeAttachment(file, kind) {
    if (kind === 'image') {
        const p = await prepareImage(file);
        return { id: uid('f'), kind: 'image', name: p.name, type: p.type, size: p.size, w: p.w, h: p.h, blob: p.blob, thumb: p.thumb };
    }
    if (kind === 'audio') {
        const dur = await audioDuration(file);
        return { id: uid('f'), kind: 'audio', name: file.name, type: file.type || 'audio/mpeg', size: file.size, dur, blob: file };
    }
    return { id: uid('f'), kind: 'file', name: file.name, type: file.type || 'application/octet-stream', size: file.size, blob: file };
}
function attachmentMeta(a) { const m = { id: a.id, kind: a.kind, name: a.name, type: a.type, size: a.size }; if (a.dur) m.dur = a.dur; if (a.w) { m.w = a.w; m.h = a.h; } return m; }
async function persistAttachment(a) { await BlobDB.put({ id: a.id, blob: a.blob, thumb: a.thumb || null, name: a.name, type: a.type, size: a.size }); }
function fileIconName(f) {
    const t = (f.type || '') + ' ' + (f.name || '').toLowerCase();
    if (f.kind === 'voice') return 'mic';
    if (f.kind === 'audio' || /audio|\.mp3|\.wav|\.m4a|\.flac|\.ogg/.test(t)) return 'audiotrack';
    if (/image/.test(t)) return 'image';
    if (/pdf/.test(t)) return 'picture_as_pdf';
    if (/\.(doc|docx|txt|rtf|odt)\b|text\//.test(t)) return 'description';
    return 'insert_drive_file';
}

// ---------- Аудиоплеер (музыка и голосовые записи) ----------
let playingAudio = null;
function buildPlayer(f) {
    const el = document.createElement('div');
    el.className = 'player';
    const title = f.kind === 'voice' ? f.name.replace(/\.[^.]+$/, '') : f.name.replace(/\.[^.]+$/, '');
    el.innerHTML =
        '<button type="button" class="play" aria-label="Воспроизвести">' + ic('play_arrow') + '</button>' +
        '<div class="pinfo"><div class="pname">' + ic(f.kind === 'voice' ? 'mic' : 'music_note') + '<span>' + esc(title) + '</span></div>' +
        '<input type="range" min="0" max="1000" value="0" step="1" aria-label="Перемотка">' +
        '<div class="pmeta"><span class="cur">0:00</span><span class="tot">' + (f.dur ? fmtDuration(f.dur) : '') + '</span></div></div>';
    const btn = el.querySelector('.play'), range = el.querySelector('input'), cur = el.querySelector('.cur'), tot = el.querySelector('.tot');
    let audio = null, seeking = false, total = f.dur || 0;
    const setIcon = playing => { btn.innerHTML = ic(playing ? 'pause' : 'play_arrow'); btn.setAttribute('aria-label', playing ? 'Пауза' : 'Воспроизвести'); el.classList.toggle('is-playing', playing); };
    async function ensure() {
        if (audio) return audio;
        const url = await BlobDB.url(f.id);
        if (!url) { toast('Файл не найден в памяти устройства'); return null; }
        audio = new Audio(); audio.preload = 'metadata'; audio.src = url;
        audio.addEventListener('loadedmetadata', () => {
            if (audio.duration === Infinity) { // у записей MediaRecorder длина неизвестна — «подталкиваем» браузер, чтобы он её вычислил
                const fix = () => { audio.removeEventListener('timeupdate', fix); audio.currentTime = 0; };
                audio.addEventListener('timeupdate', fix); audio.currentTime = 1e7;
            } else if (isFinite(audio.duration)) { total = audio.duration; tot.textContent = fmtDuration(total); }
        });
        audio.addEventListener('durationchange', () => { if (isFinite(audio.duration) && audio.duration > 0) { total = audio.duration; tot.textContent = fmtDuration(total); } });
        audio.addEventListener('timeupdate', () => {
            const d = total || audio.duration || 0;
            cur.textContent = fmtDuration(audio.currentTime);
            if (!seeking && d) range.value = String(Math.round(audio.currentTime / d * 1000));
        });
        audio.addEventListener('play', () => { if (playingAudio && playingAudio !== audio) playingAudio.pause(); playingAudio = audio; setIcon(true); });
        audio.addEventListener('pause', () => setIcon(false));
        audio.addEventListener('ended', () => { setIcon(false); range.value = '0'; cur.textContent = '0:00'; audio.currentTime = 0; });
        audio.addEventListener('error', () => { setIcon(false); toast('Не удалось воспроизвести: ' + f.name); });
        return audio;
    }
    btn.addEventListener('click', async () => {
        const a = await ensure(); if (!a) return;
        if (a.paused) { try { await a.play(); } catch (e) { toast('Не удалось воспроизвести: ' + f.name); } } else a.pause();
    });
    range.addEventListener('input', () => { seeking = true; const d = total || (audio && audio.duration) || 0; cur.textContent = fmtDuration(d * range.value / 1000); });
    range.addEventListener('change', async () => {
        const a = await ensure(); const d = total || (a && a.duration) || 0;
        if (a && d) a.currentTime = d * range.value / 1000;
        seeking = false;
    });
    return el;
}

// ---------- Диктофон ----------
class VoiceRecorder {
    constructor() { this.stream = null; this.rec = null; this.chunks = []; this.t0 = 0; this.timer = 0; this.raf = 0; this.ctx = null; this.cancelled = false; }
    static supported() { return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && typeof MediaRecorder !== 'undefined'); }
    async start(onTick, onLevel) {
        this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const mimes = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];
        const mime = mimes.find(m => { try { return MediaRecorder.isTypeSupported(m); } catch (e) { return false; } });
        this.rec = mime ? new MediaRecorder(this.stream, { mimeType: mime }) : new MediaRecorder(this.stream);
        this.chunks = [];
        this.rec.ondataavailable = e => { if (e.data && e.data.size) this.chunks.push(e.data); };
        this.rec.start(250);
        this.t0 = Date.now();
        this.timer = setInterval(() => onTick && onTick((Date.now() - this.t0) / 1000), 200);
        try {
            const AC = window.AudioContext || window.webkitAudioContext;
            this.ctx = new AC();
            const src = this.ctx.createMediaStreamSource(this.stream); const an = this.ctx.createAnalyser(); an.fftSize = 256; src.connect(an);
            const data = new Uint8Array(an.frequencyBinCount);
            const loop = () => { an.getByteTimeDomainData(data); let peak = 0; for (let i = 0; i < data.length; i++) peak = Math.max(peak, Math.abs(data[i] - 128)); onLevel && onLevel(Math.min(1, peak / 80)); this.raf = requestAnimationFrame(loop); };
            loop();
        } catch (e) { /* без индикатора уровня запись всё равно идёт */ }
    }
    cleanup() {
        clearInterval(this.timer); cancelAnimationFrame(this.raf);
        if (this.ctx) { try { this.ctx.close(); } catch (e) {} this.ctx = null; }
        if (this.stream) { this.stream.getTracks().forEach(t => t.stop()); this.stream = null; }
    }
    stop() {
        return new Promise(resolve => {
            const dur = (Date.now() - this.t0) / 1000;
            const type = (this.rec && this.rec.mimeType) || 'audio/webm';
            if (!this.rec || this.rec.state === 'inactive') { this.cleanup(); resolve(null); return; }
            this.rec.onstop = () => { this.cleanup(); resolve(this.cancelled || !this.chunks.length ? null : { blob: new Blob(this.chunks, { type }), dur, type }); };
            try { this.rec.stop(); } catch (e) { this.cleanup(); resolve(null); }
        });
    }
    cancel() { this.cancelled = true; return this.stop(); }
}
function voiceExt(type) { return /mp4/.test(type) ? 'm4a' : /ogg/.test(type) ? 'ogg' : 'webm'; }

// ---------- Просмотр картинок ----------
let lightbox = null;
async function openLightbox(ids, index) {
    closeLightbox();
    let i = Math.max(0, Math.min(index || 0, ids.length - 1));
    const el = document.createElement('div');
    el.className = 'lightbox'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-label', 'Просмотр картинки');
    el.innerHTML = '<img alt=""><button type="button" class="lb-btn lb-close" aria-label="Закрыть">' + ic('close') + '</button>' +
        (ids.length > 1 ? '<button type="button" class="lb-btn lb-prev" aria-label="Назад">' + ic('chevron_left') + '</button><button type="button" class="lb-btn lb-next" aria-label="Вперёд">' + ic('chevron_right') + '</button><div class="lb-count"></div>' : '');
    document.body.appendChild(el); document.body.classList.add('is-locked');
    const img = el.querySelector('img'), count = el.querySelector('.lb-count');
    async function show() { img.removeAttribute('src'); img.src = await BlobDB.url(ids[i]); if (count) count.textContent = (i + 1) + ' / ' + ids.length; }
    const go = d => { i = (i + d + ids.length) % ids.length; show(); };
    el.querySelector('.lb-close').addEventListener('click', closeLightbox);
    if (ids.length > 1) { el.querySelector('.lb-prev').addEventListener('click', () => go(-1)); el.querySelector('.lb-next').addEventListener('click', () => go(1)); }
    el.addEventListener('click', e => { if (e.target === el) closeLightbox(); });
    let sx = null;
    el.addEventListener('touchstart', e => { sx = e.touches[0].clientX; }, { passive: true });
    el.addEventListener('touchend', e => { if (sx === null || ids.length < 2) return; const dx = e.changedTouches[0].clientX - sx; if (Math.abs(dx) > 50) go(dx < 0 ? 1 : -1); sx = null; }, { passive: true });
    lightbox = { el, key(e) { if (e.key === 'Escape') closeLightbox(); else if (e.key === 'ArrowRight' && ids.length > 1) go(1); else if (e.key === 'ArrowLeft' && ids.length > 1) go(-1); } };
    document.addEventListener('keydown', lightbox.key);
    show();
}
function closeLightbox() {
    if (!lightbox) return;
    document.removeEventListener('keydown', lightbox.key); lightbox.el.remove(); lightbox = null;
    if (!sheetStack.length) document.body.classList.remove('is-locked');
}
