'use strict';
// =====================================================================================================
// iLife — КИНО: РАСПОЗНАВАНИЕ СКРИНШОТОВ (блок на странице «Кино»).
//
// Как это работает, по шагам, для каждого скриншота (по очереди — телефон не перегружается):
//   1. Текст на картинке читает Tesseract.js (русский + английский) прямо на устройстве; сама картинка никуда не отправляется.
//      Модуль подгружается из интернета при первом запуске (jsDelivr, около 15 МБ) и дальше берётся из кеша браузера.
//   2. Из прочитанных строк выбираются «похожие на название» (в кавычках, с годом, пункты списка, самые крупные, афиша в две
//      строки) — см. mvCandidatesFromOcr в js/moviedb.js — и каждая проверяется поиском в TMDB.
//   3. Если по тексту ничего не нашлось (кадр без названия, афиша с рисованными буквами) и подключён ИИ — картинка уходит в
//      Gemini или Claude (в Настройках → Кино) с просьбой назвать фильм по афише, титрам, субтитрам и узнаваемой сцене;
//      ответ тоже проверяется по TMDB. Кнопка «Спросить ИИ» есть у каждого скриншота и для ручного запуска.
//   4. Найденное показывается списком с галочками. Уверенные совпадения отмечены сами, остальное — по вашему выбору.
//      «Добавить выбранные» кладёт фильмы в «Список для просмотра» с обложкой, оценками, режиссёром и актёрами.
// Если ключа TMDB нет, строки-кандидаты всё равно показываются — их можно добавить как есть, данные подтянутся позже.
// =====================================================================================================

const TESS_SRC = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';
const SCAN_MAX = 30;
const OCR_STATUS = {
    'loading tesseract core': 'Загружаем модуль распознавания…', 'initializing tesseract': 'Запускаем модуль…',
    'loading language traineddata': 'Загружаем словари (один раз)…', 'initializing api': 'Готовим распознавание…', 'recognizing text': 'Читаем текст'
};
let ocrWorker = null, ocrWorkerP = null, ocrLogTo = null, ocrIdle = 0;
const scan = { items: [], running: false };

// ---------- Tesseract ----------
async function ocrGetWorker() {
    clearTimeout(ocrIdle);
    if (ocrWorker) return ocrWorker;
    if (!ocrWorkerP) {
        ocrWorkerP = (async () => {
            try { await loadScriptOnce(TESS_SRC); } catch (e) { throw new Error('не удалось загрузить модуль распознавания — нужен интернет при первом запуске'); }
            if (!window.Tesseract || !Tesseract.createWorker) throw new Error('модуль распознавания не запустился');
            ocrWorker = await Tesseract.createWorker('rus+eng', 1, { logger: m => { if (ocrLogTo) ocrLogTo(m); } });
            return ocrWorker;
        })();
        ocrWorkerP.then(() => { ocrWorkerP = null; }, () => { ocrWorkerP = null; });
    }
    return ocrWorkerP;
}
// Модуль занимает сотню мегабайт памяти: после очереди освобождаем через 45 секунд простоя
function ocrRelease() {
    clearTimeout(ocrIdle);
    ocrIdle = setTimeout(async () => { const w = ocrWorker; ocrWorker = null; if (w) { try { await w.terminate(); } catch (e) {} } }, 45000);
}
// Скриншот → чёрно-белая картинка не крупнее 1800 px. Светлый текст на тёмном фоне Tesseract читает хуже, поэтому тёмные
// скриншоты (стриминговые сервисы, тёмная тема) переворачиваем в «чёрное на белом».
async function ocrPrepare(file, invert) {
    const bmp = await decodeImage(file), s = bitmapSize(bmp);
    const k = Math.min(1, 1800 / Math.max(s.w, s.h)), W = Math.max(1, Math.round(s.w * k)), H = Math.max(1, Math.round(s.h * k));
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H); ctx.drawImage(bmp, 0, 0, W, H);
    if (bmp.close) try { bmp.close(); } catch (e) {}
    const img = ctx.getImageData(0, 0, W, H), d = img.data;
    let sum = 0, n = 0;
    for (let i = 0; i < d.length; i += 32) { sum += d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114; n++; }
    const dark = sum / Math.max(1, n) < 110, inv = invert === undefined ? dark : invert;
    for (let i = 0; i < d.length; i += 4) { const g = d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114; d[i] = d[i + 1] = d[i + 2] = inv ? 255 - g : g; }
    ctx.putImageData(img, 0, 0);
    const blob = await new Promise(res => c.toBlob(res, 'image/png'));
    if (!blob) throw new Error('не удалось подготовить картинку');
    return { blob, inverted: inv, dark };
}
function ocrExtractLines(data) {
    let raw = data && data.lines;
    if (!raw || !raw.length) { raw = []; ((data && data.blocks) || []).forEach(b => (b.paragraphs || []).forEach(p => (p.lines || []).forEach(l => raw.push(l)))); }
    if (!raw.length && data && data.text) return String(data.text).split('\n').map(t => t.trim()).filter(Boolean).map((t, i) => ({ text: t, conf: data.confidence != null ? Number(data.confidence) : 70, h: 20, y0: i * 30 }));
    return raw.map(l => ({ text: String(l.text || '').replace(/\s+/g, ' ').trim(), conf: Number(l.confidence), h: l.bbox ? Math.max(1, l.bbox.y1 - l.bbox.y0) : 20, y0: l.bbox ? l.bbox.y0 : 0 })).filter(l => l.text);
}
async function ocrRecognize(blob, it, sparse) {
    ocrLogTo = m => {
        if (!m || !m.status) return;
        const base = OCR_STATUS[m.status]; if (!base) return;
        scanStatus(it, base + (m.status === 'recognizing text' ? '… ' + Math.round((m.progress || 0) * 100) + '%' : ''));
    };
    try {
        const w = await ocrGetWorker();
        try { await w.setParameters({ tessedit_pageseg_mode: sparse ? '11' : '3' }); } catch (e) { /* не критично */ }
        const { data } = await w.recognize(blob);
        return ocrExtractLines(data);
    } finally { ocrLogTo = null; }
}

// ---------- Предложения ----------
function scanClamp(v) { return Math.max(0, Math.min(1, v)); }
function scanProp(o) { return Object.assign({ id: uid('p'), hit: null, title: '', year: null, type: 'movie', conf: 0, src: 'ocr', why: '', checked: false, unverified: false }, o); }
function scanSpec(p) { const h = p.hit; return h ? { tmdbId: h.tmdbId, type: h.type, title: h.title, origTitle: h.origTitle, year: h.year } : { title: p.title, year: p.year, type: p.type }; }
function scanMerge(it, props) {
    props.forEach(p => {
        if (mvFindDup(scanSpec(p))) p.checked = false;   // этот фильм уже в списке — по умолчанию не добавляем второй раз
        const same = it.props.find(q => (p.hit && q.hit && p.hit.tmdbId === q.hit.tmdbId && p.hit.type === q.hit.type) || (!p.hit && !q.hit && mvNorm(p.title) === mvNorm(q.title)));
        if (same) { if (p.conf > same.conf) { same.conf = p.conf; same.checked = same.checked || p.checked; } if (p.src !== same.src) same.why += ' · ' + p.why; return; }
        it.props.push(p);
    });
    it.props.sort((a, b) => (b.checked - a.checked) || (b.conf - a.conf));
}
// Строки со скриншота → предложения: каждая проверяется поиском в TMDB
async function scanResolveText(it, cands) {
    if (!mvHasTmdb()) {   // без базы: показываем сами строки, пусть выберет человек
        return cands.slice(0, 6).map(c => scanProp({ title: c.text, year: c.year, conf: Math.min(0.5, c.score), why: 'Строка с картинки — база TMDB не подключена', unverified: true }));
    }
    const res = await mvPool(cands, 3, async c => { const best = mvPickBest(c.text, await tmdbSearch(c.text), c.year); return best ? { c, best } : null; });
    const out = [];
    res.forEach(r => {
        if (!r) return;
        if (r.error) { it.searchError = r.error.message; return; }
        const { c, best } = r, h = best.hit;
        const conf = scanClamp(best.sim * 0.75 + Math.min(c.score, 0.8) * 0.3);
        const why = c.why === 'quote' ? 'в кавычках: «' + c.text + '»' : c.why === 'list' ? 'пункт списка: ' + c.text : c.why === 'big' ? 'крупный текст: ' + c.text : 'в тексте: ' + c.text;
        out.push(scanProp({ hit: h, title: h.title, year: h.year, type: h.type, conf, why: 'Нашли ' + why, checked: best.sim >= 0.9 && c.score >= 0.28 }));
    });
    return out;
}
// Ответ ИИ → предложения (каждое название тоже проверяется по TMDB)
async function scanResolveAi(items) {
    const res = await mvPool(items, 3, async x => {
        if (!mvHasTmdb()) return { x, best: null };
        let best = null;
        for (const q of [x.origTitle, x.title]) {
            if (!q) continue;
            const b = mvPickBest(q, await tmdbSearch(q), x.year, { min: 0.72 });
            if (b && (!best || b.score > best.score)) best = b;
        }
        return { x, best };
    });
    const out = [];
    res.forEach(r => {
        if (!r || r.error) return;
        const { x, best } = r;
        const why = 'ИИ' + (x.evidence ? ': ' + x.evidence : ' узнал фильм');
        if (best) out.push(scanProp({ hit: best.hit, title: best.hit.title, year: best.hit.year, type: best.hit.type, conf: scanClamp(x.confidence * (0.5 + 0.5 * best.sim)), src: 'ai', why, checked: x.confidence >= 0.7 }));
        else out.push(scanProp({ title: x.title, year: x.year, type: x.type, conf: Math.min(0.5, x.confidence * 0.6), src: 'ai', why: why + (mvHasTmdb() ? ' (в базе не найден)' : ' (база TMDB не подключена)'), unverified: true }));
    });
    return out;
}

// ---------- Обработка одного скриншота ----------
async function scanAi(it) {
    scanStatus(it, 'Спрашиваем ИИ (' + MV_AI_NAMES[mvCfg().ai] + ')…', 'work');
    it.aiTried = true; it.aiError = '';
    try {
        const items = await mvAskAi(it.file);
        if (!items.length) { it.aiNone = true; return 0; }
        const props = await scanResolveAi(items);
        scanMerge(it, props);
        return props.length;
    } catch (e) { it.aiError = e.message; return 0; }
}
async function scanOne(it) {
    scanStatus(it, 'Читаем текст…', 'work');
    let lines = [], inverted = false;
    try {
        const prep = await ocrPrepare(it.file);
        inverted = prep.inverted;
        lines = await ocrRecognize(prep.blob, it, false);
        it.lines = lines.length;
        const run = async ls => { const c = mvCandidatesFromOcr(ls, 10); it.cands = c; if (c.length) { scanStatus(it, 'Ищем в базе…', 'work'); scanMerge(it, await scanResolveText(it, c)); } };
        await run(lines);
        // ничего не нашлось и ИИ не поможет — второй проход: другая полярность и поиск разрозненного текста
        const good = () => it.props.some(p => !p.unverified);
        if (!good() && !(mvHasAi() && mvCfg().aiAuto)) {
            scanStatus(it, 'Пробуем ещё раз другим способом…', 'work');
            const prep2 = await ocrPrepare(it.file, !inverted);
            await run(await ocrRecognize(prep2.blob, it, true));
        }
    } catch (e) { it.ocrError = e.message; }
    // ИИ — если по тексту нет уверенного совпадения (или текста почти нет)
    const strong = it.props.some(p => !p.unverified && p.conf >= 0.8);
    if (mvHasAi() && mvCfg().aiAuto && (!strong || lines.length < 3)) await scanAi(it);
    scanStatus(it, '', 'done');
}
async function scanRun() {
    if (scan.running) return;
    scan.running = true; clearTimeout(ocrIdle);
    try {
        let it;
        while ((it = scan.items.find(x => x.state === 'queued'))) {
            it.state = 'work'; renderScan();
            try { await scanOne(it); } catch (e) { it.ocrError = it.ocrError || e.message; }
            it.state = 'done'; renderScan();
        }
    } finally { scan.running = false; ocrRelease(); renderScan(); }
}

// ---------- Добавление скриншотов ----------
async function scanThumb(file) {
    try { const bmp = await decodeImage(file), s = bitmapSize(bmp); const r = await canvasBlob(bmp, s.w, s.h, 240, 0.78); if (bmp.close) try { bmp.close(); } catch (e) {} return r.blob ? URL.createObjectURL(r.blob) : ''; } catch (e) { return ''; }
}
async function scanAdd(list) {
    const files = Array.from(list || []).filter(f => /^image\//.test(f.type) || /\.(png|jpe?g|webp|heic|heif|bmp|gif)$/i.test(f.name || ''));
    if (!files.length) { toast('Выберите картинки (скриншоты)'); return; }
    const room = SCAN_MAX - scan.items.length;
    if (room <= 0) { toast('В очереди уже ' + SCAN_MAX + ' скриншотов — сначала обработайте их'); return; }
    if (files.length > room) toast('Взяли первые ' + room + ' из ' + files.length + ' (за раз — не больше ' + SCAN_MAX + ')');
    for (const f of files.slice(0, room)) scan.items.push({ id: uid('s'), file: f, name: f.name || 'скриншот', thumb: '', state: 'queued', msg: 'В очереди', props: [], lines: 0, cands: [], aiTried: false, aiError: '', aiNone: false, ocrError: '', searchError: '' });
    renderScan(); $('#movies-scan-card').classList.remove('is-collapsed');
    for (const it of scan.items) if (!it.thumb) { it.thumb = await scanThumb(it.file); renderScan(); }
    scanRun();
}
function scanRemove(id) {
    const i = scan.items.findIndex(x => x.id === id); if (i < 0) return;
    const it = scan.items[i]; if (it.state === 'work') { toast('Подождите, скриншот ещё обрабатывается'); return; }
    if (it.thumb) URL.revokeObjectURL(it.thumb);
    scan.items.splice(i, 1); renderScan();
}

// ---------- Показ ----------
function scanStatus(it, text, state) {
    if (state) it.state = state === 'done' ? 'done' : 'work';
    it.msg = text;
    const el = document.querySelector('[data-sid="' + it.id + '"] [data-status]');
    if (el && it.state === 'work') el.textContent = text;
}
function scanPropHtml(it, p) {
    const h = p.hit, src = h && h.posterPath ? TMDB_IMG + 'w92' + h.posterPath : '';
    const meta = [p.year || '', p.type === 'tv' ? 'сериал' : 'фильм', h && h.tmdb ? 'TMDB ' + String(h.tmdb).replace('.', ',') : ''].filter(Boolean).join(' · ');
    const dup = mvFindDup(scanSpec(p));
    return '<label class="sc-prop' + (p.unverified ? ' is-unverified' : '') + '"><input type="checkbox" class="check" data-sc-check="' + p.id + '"' + (p.checked ? ' checked' : '') + ' aria-label="Добавить ' + esc(p.title) + '">' +
        (src ? '<img class="cv" alt="" loading="lazy" src="' + esc(src) + '">' : '<span class="cv">' + ic('movie') + '</span>') +
        '<span class="tx"><span class="nm">' + esc(p.title) + '</span><span class="sub">' + esc(meta) + '</span><span class="why">' + esc(p.why) + (p.unverified ? ' · не подтверждено базой' : '') + '</span>' + (dup ? '<span class="why is-dup">Уже в вашем списке: ' + esc(MV_STATUS[mvStatusOf(dup)].toLowerCase()) + '</span>' : '') + '</span></label>';
}
function scanItemHtml(it) {
    const working = it.state === 'work' || it.state === 'queued';
    let status = '', cls = '';
    if (working) { status = it.msg || 'В очереди'; cls = 'is-work'; }
    else if (it.props.length) { const n = it.props.length; status = 'Найдено: ' + n + ' ' + (n === 1 ? 'вариант' : n < 5 ? 'варианта' : 'вариантов') + (it.props.some(p => p.src === 'ai') ? ' (с помощью ИИ)' : ''); cls = 'is-done'; }
    else { status = 'Фильм не найден'; cls = 'is-empty'; }
    const notes = [];
    if (!working) {
        if (it.ocrError) notes.push('Текст не прочитан: ' + it.ocrError);
        if (it.searchError) notes.push('Поиск в TMDB: ' + it.searchError);
        if (it.aiError) notes.push('ИИ: ' + it.aiError);
        else if (it.aiNone && !it.props.length) notes.push('ИИ не смог определить фильм по этому изображению.');
        if (!it.props.length && !it.ocrError && !it.aiTried) notes.push(it.lines ? 'Среди прочитанного текста нет похожего на название.' : 'На картинке не удалось прочитать текст.');
    }
    const aiBtn = mvHasAi() && !working ? '<button type="button" class="btn" data-sc-ai="' + it.id + '"><i data-i="auto_awesome"></i>' + (it.aiTried ? 'Спросить ИИ ещё раз' : 'Спросить ИИ') + '</button>' : '';
    const manual = !working ? '<button type="button" class="btn" data-sc-manual="' + it.id + '"><i data-i="search"></i>Найти вручную</button>' : '';
    return '<div class="scan-item" data-sid="' + it.id + '"><div class="sc-head">' +
        (it.thumb ? '<img class="sc-thumb" alt="" src="' + it.thumb + '">' : '<span class="sc-thumb">' + ic('image') + '</span>') +
        '<div class="sc-info"><div class="sc-name">' + esc(it.name) + '</div><div class="sc-status ' + cls + '" data-status>' + esc(status) + '</div></div>' +
        '<button type="button" class="icon-btn" data-sc-remove="' + it.id + '" aria-label="Убрать скриншот">' + ic('close') + '</button></div>' +
        (it.props.length ? '<div class="sc-props">' + it.props.map(p => scanPropHtml(it, p)).join('') + '</div>' : '') +
        (notes.length ? '<p class="hint sc-note">' + notes.map(esc).join('<br>') + '</p>' : '') +
        (aiBtn || manual ? '<div class="sc-actions">' + aiBtn + manual + '</div>' : '') + '</div>';
}
function renderScan() {
    const box = $('#scan-list'); if (!box) return;
    box.innerHTML = scan.items.map(scanItemHtml).join('');
    hydrateIcons(box);
    const picked = scan.items.reduce((n, it) => n + it.props.filter(p => p.checked).length, 0);
    const busy = scan.items.some(it => it.state === 'work' || it.state === 'queued');
    $('#scan-foot').hidden = !scan.items.length;
    $('#scan-add').disabled = !picked || busy;
    $('#scan-add-n').textContent = picked ? ' (' + picked + ')' : '';
    renderScanEngines();
}
function renderScanEngines() {
    const box = $('#scan-engines'); if (!box) return;
    const c = mvCfg();
    const chip = (ok, text, icon) => '<button type="button" class="chip ' + (ok ? 'is-ok' : '') + '" data-goto-settings title="Открыть настройки Кино">' + ic(icon) + text + '</button>';
    box.innerHTML = chip(true, 'Текст на картинке', 'text_snippet') +
        chip(mvHasTmdb(), mvHasTmdb() ? 'База: TMDB' : 'База не подключена', 'movie') +
        chip(mvHasAi(), mvHasAi() ? 'ИИ: ' + MV_AI_NAMES[c.ai] : 'ИИ не подключён', 'auto_awesome');
    const sw = $('#scan-ai-row'); if (sw) { sw.hidden = !mvHasAi(); $('#scan-ai-auto').checked = !!c.aiAuto; }
}

// ---------- Добавление найденного в список ----------
async function scanAddSelected() {
    const picks = [];
    scan.items.forEach(it => it.props.forEach(p => { if (p.checked) picks.push({ it, p }); }));
    if (!picks.length) return;
    const btn = $('#scan-add'); btn.disabled = true;
    let added = 0, dup = 0; const warn = new Set(), done = new Set();
    toast('Добавляем в список: ' + picks.length + '…');
    const res = await mvPool(picks, 3, async ({ it, p }) => {
        const spec = p.hit ? p.hit : { title: p.title, year: p.year, type: p.type };
        const r = await mvAddMovie(spec, 'queue', { src: 'screenshot', fallbackFile: it.file });
        done.add(p.id);
        return r;
    });
    res.forEach(r => {
        if (!r) return;
        if (r.error) { console.warn(r.error); warn.add(r.error.message || 'не удалось добавить'); return; }
        if (r.dup) dup++; else added++;
        r.warn.forEach(w => warn.add(w));
    });
    scan.items.forEach(it => { it.props = it.props.filter(p => !done.has(p.id)); });
    // скриншоты, из которых всё добавлено, убираем
    scan.items = scan.items.filter(it => { const keep = it.props.length || it.state !== 'done' || (!picks.some(x => x.it === it)); if (!keep && it.thumb) URL.revokeObjectURL(it.thumb); return keep; });
    renderScan(); renderMovies();
    toast((added ? 'Добавлено в список: ' + added : 'Ничего не добавлено') + (dup ? ' · уже были: ' + dup : '') + (warn.size ? ' · ' + Array.from(warn)[0] : ''), { ms: 5200 });
    if (added) { const l = $('#movies-queue-head'); if (l) l.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
}

// ---------- Подключение событий ----------
function initScan() {
    const file = $('#scan-file'), drop = $('#scan-drop');
    $('#scan-pick').addEventListener('click', () => { file.value = ''; file.click(); });
    file.addEventListener('change', () => { const picked = Array.from(file.files || []); file.value = ''; scanAdd(picked); });
    ['dragenter', 'dragover'].forEach(ev => drop.addEventListener(ev, e => { if (e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files')) { e.preventDefault(); drop.classList.add('is-over'); } }));
    ['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, () => drop.classList.remove('is-over')));
    drop.addEventListener('drop', e => { if (e.dataTransfer && e.dataTransfer.files.length) { e.preventDefault(); scanAdd(e.dataTransfer.files); } });
    // вставка скриншота из буфера обмена (Ctrl+V), пока открыта страница «Кино»
    document.addEventListener('paste', e => {
        const active = document.querySelector('.tab.is-active');
        if (!active || active.id !== 'movies') return;
        const t = e.target; if (t && /^(INPUT|TEXTAREA)$/.test(t.tagName) && t.type !== 'search') return;
        const imgs = Array.from(e.clipboardData && e.clipboardData.files || []).filter(f => /^image\//.test(f.type));
        if (imgs.length) { e.preventDefault(); scanAdd(imgs); }
    });
    $('#scan-list').addEventListener('change', e => {
        const cb = e.target.closest('[data-sc-check]'); if (!cb) return;
        scan.items.forEach(it => it.props.forEach(p => { if (p.id === cb.dataset.scCheck) p.checked = cb.checked; }));
        const picked = scan.items.reduce((n, it) => n + it.props.filter(p => p.checked).length, 0);
        $('#scan-add').disabled = !picked || scan.items.some(it => it.state === 'work' || it.state === 'queued');
        $('#scan-add-n').textContent = picked ? ' (' + picked + ')' : '';
    });
    $('#scan-list').addEventListener('click', async e => {
        const rm = e.target.closest('[data-sc-remove]'), ai = e.target.closest('[data-sc-ai]'), man = e.target.closest('[data-sc-manual]');
        if (rm) scanRemove(rm.dataset.scRemove);
        else if (ai) {
            const it = scan.items.find(x => x.id === ai.dataset.scAi); if (!it || scan.running) { if (scan.running) toast('Подождите, идёт обработка'); return; }
            it.state = 'work'; renderScan(); await scanAi(it); it.state = 'done'; scanStatus(it, '', 'done'); renderScan();
        } else if (man) {
            const it = scan.items.find(x => x.id === man.dataset.scManual);
            const q = it && it.cands && it.cands[0] ? it.cands[0].text : '';
            const s = $('#movie-search'); s.value = q; s.focus(); s.dispatchEvent(new Event('input')); window.scrollTo({ top: 0, behavior: 'smooth' });
        }
    });
    $('#scan-add').addEventListener('click', scanAddSelected);
    $('#scan-clear').addEventListener('click', () => { if (scan.items.some(i => i.state === 'work')) { toast('Подождите, идёт обработка'); return; } scan.items.forEach(i => i.thumb && URL.revokeObjectURL(i.thumb)); scan.items = []; renderScan(); });
    $('#scan-ai-auto').addEventListener('change', e => { mvCfgSave({ aiAuto: e.target.checked }); toast(e.target.checked ? 'ИИ будет подключаться, если по тексту не нашлось' : 'ИИ — только по кнопке «Спросить ИИ»'); });
    $('#movies-scan-card').addEventListener('click', e => { if (e.target.closest('[data-goto-settings]')) openMoviesSettings(); });
    renderScan();
}
