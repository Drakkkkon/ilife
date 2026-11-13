'use strict';
// =====================================================================================================
// iLife 2.6.0 — РАЗДЕЛ «ЛЕКАРСТВА» (часть 4): страница «Назначение врача» —
//   1. кнопка «Распознать»: фото и файлы из «Рецептов» (и новые снимки, PDF) → текст → назначение по пунктам
//      (врач, клиника, дата, пациент, диагноз, лекарства с дозами, рекомендации, повторный приём…);
//   2. картинки лекарств из интернета (Wikimedia Commons — свободная фотобаза, без ключа), можно выбрать другую или своё фото;
//   3. пластинки таблеток вверху страницы: после каждого приёма из пластинки пропадает таблетка.
//
// Как читается текст:
//   • если в «Настройки → Кино» подключён ИИ (Gemini или Claude) — фото уходит туда: ИИ читает и рукописный почерк врача,
//     расшифровывает сокращения рецепта (Rp., D.S., t.i.d.) и возвращает пункты сразу разложенными по полям;
//   • без ИИ — Tesseract на самом устройстве (тот же модуль, что в «Кино», js/recognize.js). Он хорошо читает печатный текст,
//     рукописный — плохо; пункты раскладываются по ключевым словам («Врач», «Диагноз», «Rp.», «мг», «дней»…).
//   • PDF: если в файле есть текстовый слой — берётся он, иначе страницы (до 4) превращаются в картинки (pdf.js, jsDelivr).
// Новые снимки и страницы PDF сохраняются в «Рецепты» отдельным документом и привязываются к назначению.
//
// Данные: в назначении (kind:'order') добавились поля clinic, extra:[{ k, v }] (остальные пункты) и ocrText (прочитанный текст);
// у лекарства — latin (латинское название), img (картинка-вложение), imgSrc (страница источника), imgAuto (подобрана сама),
// imgTried (когда искали). Картинки лежат в IndexedDB и синхронизируются, как остальные вложения (js/gdrive.js → mediaRefs).
// =====================================================================================================

(function () {
    if (!window.ICONS) return;
    Object.assign(window.ICONS, {
        document_scanner: '<path d="M7 3H4v3H2V1h5zm15 3V1h-5v2h3v3zM7 21H4v-3H2v5h5zm13-3v3h-3v2h5v-5zM19 18c0 1.1-.9 2-2 2H7c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2zM15 8H9v2h6zm0 3H9v2h6zm0 3H9v2h6z"/>',
        pill: '<path d="M4.22 11.29 11.29 4.22a6 6 0 0 1 8.49 8.49l-7.07 7.07a6 6 0 0 1-8.49-8.49m1.42 1.42a4 4 0 0 0 5.65 5.65l3.54-3.54-5.65-5.65z"/>'
    });
})();

const MED_PDFJS = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js';
const MED_PDFJS_WORKER = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js';
const MED_COMMONS_API = 'https://commons.wikimedia.org/w/api.php';
const MED_PDF_PAGES = 4;        // сколько страниц PDF читать
const MED_AI_BATCH = 2;         // сколько картинок за один запрос к ИИ
const MED_MONTHS_RX = ['январ', 'феврал', 'март', 'апрел', 'ма', 'июн', 'июл', 'август', 'сентябр', 'октябр', 'ноябр', 'декабр'];

// =====================================================================================================
// 1. РАСПОЗНАВАНИЕ РЕЦЕПТА
// =====================================================================================================

// ---------- Подготовка источников: фото из «Рецептов», новые фото, PDF ----------
async function medPdfLib() {
    if (!window.pdfjsLib) {
        try { await loadScriptOnce(MED_PDFJS); } catch (e) { throw new Error('не удалось загрузить модуль PDF — нужен интернет при первом запуске'); }
    }
    if (!window.pdfjsLib) throw new Error('модуль PDF не запустился');
    try { pdfjsLib.GlobalWorkerOptions.workerSrc = MED_PDFJS_WORKER; } catch (e) {}
    return window.pdfjsLib;
}
// PDF → { text, pages:[jpeg-blob] }: текстовый слой (если есть) и картинки первых страниц
async function medPdfRead(file) {
    const lib = await medPdfLib();
    const doc = await lib.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
    const n = Math.min(doc.numPages, MED_PDF_PAGES), pages = [];
    let text = '';
    for (let i = 1; i <= n; i++) {
        const page = await doc.getPage(i);
        try {
            const tc = await page.getTextContent();
            let line = '', lastY = null;
            tc.items.forEach(it => {
                const y = it.transform ? Math.round(it.transform[5]) : 0;
                if (lastY !== null && Math.abs(y - lastY) > 3) { text += line.trim() + '\n'; line = ''; }
                line += it.str + (it.hasEOL ? '\n' : ' '); lastY = y;
            });
            text += line.trim() + '\n';
        } catch (e) {}
        const vp0 = page.getViewport({ scale: 1 });
        const scale = Math.min(3, 1700 / Math.max(vp0.width, vp0.height));
        const vp = page.getViewport({ scale });
        const c = document.createElement('canvas'); c.width = Math.round(vp.width); c.height = Math.round(vp.height);
        const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
        await page.render({ canvasContext: ctx, viewport: vp }).promise;
        const b = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.88));
        if (b) pages.push(b);
    }
    try { doc.destroy(); } catch (e) {}
    return { text: text.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim(), pages };
}
function medIsPdf(f) { return /pdf/i.test(f.type || '') || /\.pdf$/i.test(f.name || ''); }
function medIsImg(f) { return /^image\//.test(f.type || '') || /\.(jpe?g|png|webp|heic|heif|gif|bmp)$/i.test(f.name || ''); }
// Выбор фото или PDF
function medPickRxFiles(camera) {
    return new Promise(resolve => {
        const inp = document.createElement('input');
        inp.type = 'file'; inp.accept = camera ? 'image/*' : 'image/*,application/pdf,.pdf'; inp.style.display = 'none';
        if (camera) inp.setAttribute('capture', 'environment'); else inp.multiple = true;
        document.body.appendChild(inp);
        let done = false;
        const fin = () => { if (done) return; done = true; const files = Array.from(inp.files || []); setTimeout(() => inp.remove(), 0); resolve(files); };
        inp.addEventListener('change', fin); inp.addEventListener('cancel', fin);
        inp.click();
    });
}

// ---------- Окно «Распознать» ----------
function medRecognizeSheet(preRx) {
    const docs = medList('rx').sort((a, b) => (b.date || '').localeCompare(a.date || '') || (b.createdAt || 0) - (a.createdAt || 0));
    const sel = new Set(preRx ? [preRx] : (docs[0] ? [docs[0].id] : []));
    let fresh = [];          // новые файлы: { file, kind:'img'|'pdf', url }
    let busy = false;
    const ai = mvHasAi();
    const node = document.createElement('div'); node.className = 'med-form med-scan';
    node.innerHTML =
        '<div class="med-scan-engine' + (ai ? ' is-ai' : '') + '">' + ic(ai ? 'auto_awesome' : 'document_scanner') + '<div><b>' + (ai ? 'Читает ИИ — ' + esc(MV_AI_NAMES[mvCfg().ai] || '') : 'Читает Tesseract на этом устройстве') + '</b><small>' +
        (ai ? 'Разбирает и рукописный почерк врача, расшифровывает сокращения рецепта.' : 'Хорошо читает печатный текст, рукописный — плохо. Для рукописных рецептов подключите ИИ.') + '</small></div></div>' +
        '<p class="instr-row" style="margin:0.375rem 0 0"><button type="button" class="linkbtn instr-link" data-instr="instr-med-scan"><i data-i="help"></i>Как работает распознавание — инструкция</button></p>' +
        (docs.length ? '<label class="field-label">Фото из «Рецептов»</label><div class="med-scan-docs" id="msc-docs">' + docs.map(d => {
            const f = (d.files || [])[0];
            return '<button type="button" class="med-scan-doc' + (sel.has(d.id) ? ' is-on' : '') + '" data-id="' + esc(d.id) + '"><span class="med-thumb">' + (f ? '<img alt="" data-blob="' + esc(f.id) + '">' : ic('image')) + '<span class="med-scan-tick">' + ic('check') + '</span></span><span class="med-scan-cap">' + esc(medRxTitle(d)) + '<small>' + esc(medDateLabel(d.date)) + ((d.files || []).length > 1 ? ' · ' + d.files.length + ' фото' : '') + '</small></span></button>';
        }).join('') + '</div>' : '<p class="hint" style="margin:0.75rem 0 0">В «Рецептах» пока нет фото — снимите рецепт здесь или выберите фото или PDF.</p>') +
        '<label class="field-label">Новые фото и файлы</label><div class="med-photos" id="msc-fresh"></div>' +
        '<div class="btn-group" style="margin-top:0.5rem"><button type="button" class="btn" id="msc-cam">' + ic('photo_camera') + 'Сфотографировать</button><button type="button" class="btn" id="msc-file">' + ic('upload_file') + 'Фото или PDF</button></div>' +
        '<label class="med-scan-keep"><input type="checkbox" class="switch" id="msc-keep" checked><span>Сохранить новые фото в «Рецепты»</span></label>' +
        '<div class="med-scan-status" id="msc-status" aria-live="polite" hidden></div>';
    if (typeof hydrateIcons === 'function') hydrateIcons(node);
    medFillThumbs(node);
    const docsBox = $('#msc-docs', node);
    if (docsBox) docsBox.addEventListener('click', e => {
        const b = e.target.closest('[data-id]'); if (!b || busy) return;
        const id = b.dataset.id; if (sel.has(id)) sel.delete(id); else sel.add(id);
        b.classList.toggle('is-on', sel.has(id));
    });
    const freshBox = $('#msc-fresh', node);
    const drawFresh = () => {
        freshBox.innerHTML = fresh.length ? fresh.map((x, i) => '<div class="med-thumb">' + (x.kind === 'img' ? '<img alt="" src="' + x.url + '">' : '<span class="med-scan-pdf">' + ic('picture_as_pdf') + '<small>' + esc(x.file.name || 'PDF') + '</small></span>') +
            '<button type="button" class="med-thumb-x" data-x="' + i + '" aria-label="Убрать">' + ic('close') + '</button></div>').join('') :
            '<p class="hint" style="margin:0">Можно добавить несколько фото или PDF — всё прочитается вместе как одно назначение.</p>';
    };
    const addFiles = files => {
        files.forEach(f => {
            if (medIsPdf(f)) fresh.push({ file: f, kind: 'pdf' });
            else if (medIsImg(f)) fresh.push({ file: f, kind: 'img', url: URL.createObjectURL(f) });
            else toast('Это не фото и не PDF: ' + (f.name || 'файл'));
        });
        drawFresh();
    };
    freshBox.addEventListener('click', e => { const x = e.target.closest('[data-x]'); if (!x || busy) return; const it = fresh.splice(+x.dataset.x, 1)[0]; if (it && it.url) URL.revokeObjectURL(it.url); drawFresh(); });
    $('#msc-cam', node).addEventListener('click', async () => addFiles(await medPickRxFiles(true)));
    $('#msc-file', node).addEventListener('click', async () => addFiles(await medPickRxFiles(false)));
    drawFresh();
    const statusEl = $('#msc-status', node);
    const status = (t, err) => { statusEl.hidden = !t; statusEl.classList.toggle('is-err', !!err); statusEl.innerHTML = t ? (err ? ic('error') : '<span class="med-spin"></span>') + '<span>' + esc(t) + '</span>' : ''; };
    node.addEventListener('click', e => { if (e.target.closest('[data-instr]') && sheetApi) sheetApi.close(); });   // ссылка на инструкцию уводит в «Настройки»
    const sheetApi = openSheet({
        title: 'Распознать рецепт', node,
        actions: [{ label: 'Отмена', value: false }, {
            label: 'Распознать', kind: 'primary', icon: 'document_scanner',
            onClick: async api => {
                if (busy) return false;
                if (!sel.size && !fresh.length) { toast('Выберите фото из «Рецептов» или добавьте новое'); return false; }
                busy = true; node.classList.add('is-busy');
                const btn = api.el.querySelector('.sheet-actions .btn-primary'); if (btn) btn.disabled = true;
                try {
                    const res = await medRecognizeRun({ rxIds: Array.from(sel), fresh: fresh.slice(), keep: $('#msc-keep', node).checked, status });
                    if (!res) { busy = false; node.classList.remove('is-busy'); if (btn) btn.disabled = false; return false; }
                    setTimeout(() => medOrderFormSheet(null, res), 220);
                } catch (e) {
                    console.error(e); status('Не удалось распознать: ' + (e.message || e), true);
                    busy = false; node.classList.remove('is-busy'); if (btn) btn.disabled = false; return false;
                }
            }
        }],
        onClose: () => fresh.forEach(x => { if (x.url) URL.revokeObjectURL(x.url); })
    });
}

// ---------- Сам разбор ----------
async function medRecognizeRun(o) {
    const status = o.status || (() => {});
    const pages = [];            // { blob, text? } — что читаем
    const rxIds = o.rxIds.slice();
    // фото из «Рецептов»
    let missing = 0;
    for (const id of o.rxIds) {
        const d = medById(id); if (!d) continue;
        for (const f of d.files || []) { const rec = await BlobDB.get(f.id); if (rec && rec.blob) pages.push({ blob: rec.blob }); else missing++; }
    }
    if (missing) toast('Фото ещё не скачано с Google Диска: ' + missing + ' — пропущено');
    // новые фото и PDF
    const newAtts = [];
    for (const x of o.fresh) {
        if (x.kind === 'img') {
            try { const a = await makeAttachment(x.file, 'image'); newAtts.push(a); pages.push({ blob: a.blob }); } catch (e) { toast('Не удалось прочитать фото: ' + (x.file.name || '')); }
        } else {
            status('Открываем PDF «' + (x.file.name || '') + '»…');
            const r = await medPdfRead(x.file);
            for (let i = 0; i < r.pages.length; i++) {
                const file = new File([r.pages[i]], (x.file.name || 'рецепт').replace(/\.pdf$/i, '') + (r.pages.length > 1 ? '_стр' + (i + 1) : '') + '.jpg', { type: 'image/jpeg' });
                try { const a = await makeAttachment(file, 'image'); newAtts.push(a); pages.push({ blob: a.blob, text: i === 0 && r.text.length > 40 ? r.text : '' }); } catch (e) {}
            }
            if (!r.pages.length && r.text) pages.push({ blob: null, text: r.text });
        }
    }
    if (!pages.length) { status('Нечего распознавать: фото не найдены (возможно, ещё не скачаны с Google Диска)', true); return null; }

    // чтение
    let data = null, engine = '', aiErr = '', aiRaw = '';
    const pdfText = pages.map(p => p.text).filter(Boolean).join('\n\n');
    if (mvHasAi()) {
        try { data = await medRecognizeAi(pages, status); engine = 'ai'; }
        catch (e) { console.warn(e); aiErr = e.message || 'ИИ не ответил'; aiRaw = e.raw || ''; status(aiErr + ' — читаю на устройстве…'); }
    }
    if (!data) {
        let text = pdfText;
        if (!text) {
            const lines = [];
            const imgs = pages.filter(p => p.blob);
            for (let i = 0; i < imgs.length; i++) {
                const t = await medOcrBlob(imgs[i].blob, pr => status('Читаем текст' + (imgs.length > 1 ? ' (' + (i + 1) + ' из ' + imgs.length + ')' : '') + '… ' + pr + '%'), s => status(s));
                if (t) lines.push(t);
            }
            if (typeof ocrRelease === 'function') ocrRelease();
            text = lines.join('\n\n');
        }
        if (!text.trim()) { status((aiErr ? aiErr + '. Без ИИ' : 'Без ИИ') + ' текст тоже не найден — попробуйте фото ровнее и при хорошем свете', true); return null; }
        data = medParseRxText(text); engine = 'ocr';
    }
    status('Готовим назначение…');

    // новые фото → документ в «Рецептах»
    if (newAtts.length && o.keep) {
        try {
            for (const a of newAtts) await persistAttachment(a);
            const doc = { id: uid('mr'), kind: 'rx', type: 'recipe', title: 'Рецепт' + (data.doctor ? ' — ' + data.doctor : ''), doctor: data.doctor || '', date: data.date || todayKey(), note: data.diagnosis ? 'Диагноз: ' + data.diagnosis : '', files: newAtts.map(attachmentMeta), createdAt: Date.now(), author: authorName() };
            meds.unshift(doc); rxIds.push(doc.id); saveMeds();
        } catch (e) { toast('Не удалось сохранить новые фото в «Рецепты»'); }
    }
    const pre = medRxDataToPreset(data, rxIds, engine);
    if (aiErr) { pre.aiError = aiErr; if (aiRaw) pre.ocrText = (pre.ocrText ? pre.ocrText + '\n\n' : '') + '— Ответ ИИ, который не удалось разобрать —\n' + String(aiRaw).slice(0, 3000); }
    return pre;
}

// Tesseract (модуль из js/recognize.js): blob → текст
async function medOcrBlob(blob, onPct, onStatus) {
    if (typeof ocrGetWorker !== 'function') throw new Error('модуль распознавания не найден');
    ocrLogTo = m => {
        if (!m || !m.status) return;
        if (m.status === 'recognizing text') onPct(Math.round((m.progress || 0) * 100));
        else if (OCR_STATUS[m.status]) onStatus(OCR_STATUS[m.status]);
    };
    try {
        const w = await ocrGetWorker();
        try { await w.setParameters({ tessedit_pageseg_mode: '3' }); } catch (e) {}
        const prep = await ocrPrepare(blob, false);
        const r = await w.recognize(prep.blob);
        return String((r && r.data && r.data.text) || '').replace(/[ \t]+/g, ' ').trim();
    } finally { ocrLogTo = null; }
}

// ---------- ИИ ----------
function medAiPrompt() { return 'Сегодня ' + todayKey() + '. Если в дате на документе не дописан или неразборчив год, бери ближайший к сегодняшнему дню прошедший год.\n' + MED_AI_PROMPT; }
const MED_AI_PROMPT = 'На фото — рецепт, назначение или заключение врача (может быть написан от руки, на русском, казахском или латыни). ' +
    'Внимательно прочитай всё и верни ТОЛЬКО JSON без пояснений, такого вида:\n' +
    '{"doctor":"ФИО врача как написано, например Иванов И.И.","specialty":"специальность врача","clinic":"название клиники, поликлиники или больницы","clinicAddress":"адрес или телефон клиники",' +
    '"date":"дата приёма или выписки рецепта в формате ГГГГ-ММ-ДД","patient":"ФИО пациента","patientBirth":"дата рождения или возраст пациента","diagnosis":"диагноз словами (и код МКБ, если есть)",' +
    '"drugs":[{"name":"название препарата как в рецепте, кириллицей, если это возможно","latin":"латинское или международное название","form":"таблетки | капсулы | сироп | капли | мазь | уколы | порошок | спрей | другое",' +
    '"strength":"дозировка препарата, например 500 мг","dose":"сколько за один приём, например 1 таблетка","how":"как принимать: сколько раз в день, до или после еды, утром или вечером","days":число дней курса или null}],' +
    '"recommendations":"остальные назначения: режим, диета, процедуры, анализы","nextVisit":"когда прийти снова","other":[{"label":"название пункта","value":"значение"}],"text":"прочитанный текст коротко, не длиннее 1500 знаков"}\n' +
    'Правила: ничего не выдумывай — чего нет на фото, оставь пустой строкой. Сокращения рецепта (Rp., D.S., S., t.i.d., b.i.d., p.o., №10) переведи в поле how на понятный русский. ' +
    'Номер рецепта, печать, подпись, номер полиса и прочие пункты, которым нет своего поля, положи в other. Если фото несколько — это страницы одного документа.';
function medJsonFrom(text) {
    const s = String(text || '').replace(/```(?:json)?/gi, '').trim();
    const pick = v => Array.isArray(v) ? (v.find(x => x && typeof x === 'object') || null) : v && typeof v === 'object' ? v : null;
    try { const v = pick(JSON.parse(s)); if (v) return v; } catch (e) {}
    const a = s.indexOf('{'), b = s.lastIndexOf('}');
    if (a < 0) return null;
    if (b > a) { try { const v = pick(JSON.parse(s.slice(a, b + 1))); if (v) return v; } catch (e) {} }
    // ответ оборвался на середине — закрываем кавычки и скобки и берём, что успело прийти
    let t = s.slice(a);
    let inStr = false, esc = false; const st = [];
    for (const ch of t) {
        if (inStr) { if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === '"') inStr = false; continue; }
        if (ch === '"') inStr = true; else if (ch === '{') st.push('}'); else if (ch === '[') st.push(']'); else if (ch === '}' || ch === ']') st.pop();
    }
    if (inStr) t += '"';
    t = t.replace(/,\s*$/, '').replace(/,\s*"[^"]*"\s*:?\s*$/, '').replace(/:\s*$/, ': ""');
    try { return pick(JSON.parse(t + st.reverse().join(''))); } catch (e) { return null; }
}
async function medAiImage(blob) {   // для почерка нужна картинка крупнее, чем для кадров кино
    let bmp;
    try { bmp = await decodeImage(blob); }
    catch (e) { if (/^image\/(jpeg|png|webp|heic|heif)$/.test(blob.type || '') && blob.size < 7e6) return blob; throw new Error('не удалось открыть фото (формат ' + (blob.type || 'неизвестен') + ')'); }
    const s = bitmapSize(bmp);
    const r = await canvasBlob(bmp, s.w, s.h, 1400, 0.85);
    if (bmp.close) try { bmp.close(); } catch (e) {}
    if (!r.blob) throw new Error('не удалось подготовить картинку');
    return r.blob;
}
// Один запрос к ИИ. Сырой ответ сохраняется (med_ai_last) — его видно в «Распознанном тексте», если разобрать не вышло
async function medAiAsk(blobs, extra, status, label) {
    const name = MV_AI_NAMES[mvCfg().ai] || 'ИИ';
    let t0 = Date.now(), got = 0, model = '';
    const tick = () => { const sec = Math.round((Date.now() - t0) / 1000); status(name + label + (model ? ' (модель ' + model + ')' : '') + (got ? ' пишет ответ: ' + got + ' знаков' : ' читает рецепт') + ' · ' + sec + ' с'); };
    tick(); const timer = setInterval(tick, 1000);
    let ans;
    try { ans = await mvAskAiText({ text: medAiPrompt() + extra, imageBlobs: blobs, maxTokens: 8192, timeout: 240000, idle: 45000, stream: true, fast: true, safetyOff: true, onProgress: n => { got = n; }, onModel: m => { model = m; got = 0; t0 = Date.now(); } }); }   // молчит 45 с — модель зависла, берём запасную
    finally { clearInterval(timer); }
    LS.set('med_ai_last', String(ans || '').slice(0, 6000));
    const j = medJsonFrom(ans);
    if (!j) { const e = new Error(name + ' ответил не по форме'); e.code = 'format'; e.raw = ans; throw e; }
    return j;
}
async function medRecognizeAi(pages, status) {
    const imgs = pages.filter(p => p.blob), texts = pages.map(p => p.text).filter(Boolean);
    const extra0 = texts.length ? '\n\nТекстовый слой PDF (может помочь): \n' + texts.join('\n').slice(0, 6000) : '';
    const blobs = [];
    for (const p of imgs) blobs.push(await medAiImage(p.blob));
    const out = [], batches = [];
    for (let i = 0; i < blobs.length; i += MED_AI_BATCH) batches.push(blobs.slice(i, i + MED_AI_BATCH));
    if (!batches.length) batches.push([]);
    for (let i = 0; i < batches.length; i++) {
        const label = batches.length > 1 ? ' (' + (i + 1) + ' из ' + batches.length + ')' : '';
        const extra = i === 0 ? extra0 : '';
        try { out.push(await medAiAsk(batches[i], extra, status, label)); }
        catch (e) {
            // несколько фото за раз не прошли (долго, обрыв, не по форме) — пробуем по одному
            if (batches[i].length < 2 || ['nokey', 401, 403, 429, 'blocked', 'network'].indexOf(e.code) >= 0) throw e;
            for (let k = 0; k < batches[i].length; k++) out.push(await medAiAsk([batches[i][k]], k === 0 ? extra : '', status, ' (фото ' + (k + 1) + ' из ' + batches[i].length + ')'));
        }
    }
    // несколько частей — склеиваем: пустые поля дополняются, лекарства и пункты складываются
    const r = Object.assign({}, out[0]);
    out.slice(1).forEach(j => {
        Object.keys(j).forEach(k => {
            if (k === 'drugs' || k === 'other') r[k] = (r[k] || []).concat(j[k] || []);
            else if (k === 'text') r.text = [r.text, j.text].filter(Boolean).join('\n\n');
            else if (!r[k] && j[k]) r[k] = j[k];
        });
    });
    return medNormRxData(r);
}
function medNormDate(v) {
    const s = String(v || '').trim(); if (!s) return '';
    let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (m) return m[1] + '-' + pad2(+m[2]) + '-' + pad2(+m[3]);
    m = s.match(/(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{2,4})/);
    if (m) { let y = +m[3]; if (y < 100) y += 2000; if (+m[2] >= 1 && +m[2] <= 12 && +m[1] >= 1 && +m[1] <= 31) return y + '-' + pad2(+m[2]) + '-' + pad2(+m[1]); }
    m = normText(s).match(/(\d{1,2})\s+([а-я]+)\s+(\d{4})/);
    if (m) { const mo = MED_MONTHS_RX.findIndex((p, i) => i === 4 ? /^ма[йя]/.test(m[2]) : m[2].startsWith(p)); if (mo >= 0) return m[3] + '-' + pad2(mo + 1) + '-' + pad2(+m[1]); }
    return '';
}
function medNormRxData(j) {
    const str = v => (v == null ? '' : String(v)).replace(/\s+/g, ' ').trim().slice(0, 600);
    const drugs = (Array.isArray(j.drugs) ? j.drugs : []).map(d => {
        d = d || {};
        const days = parseInt(d.days, 10);
        const name = str(d.name || d.latin);
        const dose = [str(d.strength), str(d.dose)].filter(Boolean).join(', ');
        return { name, latin: str(d.latin), form: str(d.form), dose, how: str(d.how), days: days > 0 && days < 1000 ? String(days) : '' };
    }).filter(d => d.name);
    const other = (Array.isArray(j.other) ? j.other : []).map(x => ({ k: str(x && (x.label || x.k)), v: str(x && (x.value || x.v)) })).filter(x => x.v);
    return {
        doctor: str(j.doctor), specialty: str(j.specialty), clinic: str(j.clinic), clinicAddress: str(j.clinicAddress), date: medNormDate(j.date),
        patient: str(j.patient), patientBirth: str(j.patientBirth), diagnosis: str(j.diagnosis), drugs,
        recommendations: str(j.recommendations), nextVisit: str(j.nextVisit), other, text: String(j.text || '').trim().slice(0, 8000)
    };
}

// ---------- Разбор текста без ИИ (по ключевым словам) ----------
function medParseRxText(text) {
    const lines = String(text || '').split(/\n/).map(l => l.replace(/[|_]{2,}/g, ' ').replace(/\s+/g, ' ').trim()).filter(l => l.length > 1);
    const r = { doctor: '', specialty: '', clinic: '', clinicAddress: '', date: '', patient: '', patientBirth: '', diagnosis: '', drugs: [], recommendations: '', nextVisit: '', other: [], text: lines.join('\n') };
    const after = (l, re) => { const m = l.match(re); return m ? l.slice(m.index + m[0].length).replace(/^[\s:.\-–—]+/, '').trim() : ''; };
    const NAME = /[А-ЯЁA-Z][а-яёa-z]+(?:-[А-ЯЁ][а-яё]+)?\s+[А-ЯЁA-Z]\.\s?[А-ЯЁA-Z]\.?|[А-ЯЁ][а-яё]+\s+[А-ЯЁ][а-яё]+\s+[А-ЯЁ][а-яё]+(?:вич|вна|ич|кызы|улы)/;
    const CLINIC = /(поликлиник|клиник|больниц|госпитал|амбулатор|диспансер|медицинск\p{L}* центр|мед\.? ?центр|медцентр|(?<!\p{L})(гкп|кгп|тоо)(?!\p{L})|на пхв|центр семейн|центр здоров)/u;
    const recs = [], used = new Set();
    lines.forEach((l, i) => {
        const n = normText(l);
        if (!r.date) { const d = medNormDate(l); if (d && !/рожд|д\.р|г\.р/.test(n)) { r.date = d; } }
        if (CLINIC.test(n)) { if (!r.clinic) r.clinic = l.slice(0, 160); used.add(i); return; }
        if (/(пациент|больно\p{L}*)(?!\p{L})/u.test(n) && !r.patient) { const v = after(l, /(пациент\p{L}*|больно\p{L}*)/iu) || (lines[i + 1] || ''); r.patient = (v.match(NAME) || [v])[0].slice(0, 100); used.add(i); return; }
        if (/(дата рожд|д\.\s?р\.|г\.\s?р\.|возраст)/.test(n) && !r.patientBirth) { r.patientBirth = after(l, /(дата рожд\p{L}*|д\.\s?р\.|г\.\s?р\.|возраст)/iu).slice(0, 40); used.add(i); return; }
        if (/(врач|доктор|ф\.?\s*и\.?\s*о\.?\s*врача|лечащ)/.test(n) && !r.doctor) {
            const v = after(l, /(ф\.?\s*и\.?\s*о\.?\s*)?(лечащий\s+)?(врач\p{L}*|доктор)/iu);
            const nm = (v || l).match(NAME) || (lines[i + 1] || '').match(NAME);
            r.doctor = (nm ? nm[0] : v).slice(0, 80);
            const sp = n.match(/(терапевт|педиатр|хирург|невролог|кардиолог|лор|отоларинголог|офтальмолог|окулист|гинеколог|уролог|эндокринолог|дерматолог|гастроэнтеролог|стоматолог|травматолог|ортопед|пульмонолог|аллерголог|психиатр|психотерапевт|ревматолог|онколог|инфекционист|семейн\p{L}* врач|врач общей практики)/u);
            if (sp) r.specialty = sp[1];
            used.add(i); return;
        }
        if (/^(ds|d-?s)(?![a-z.])/.test(n) || /(?<!\p{L})диагноз(?!\p{L})/u.test(n)) { const v = after(l, /(диагноз\p{L}*|^ds|^d-?s)/iu) || (lines[i + 1] || ''); if (!r.diagnosis) r.diagnosis = v.slice(0, 300); used.add(i); return; }
        if (/(явк|повторн\p{L}* (при[её]м|осмотр|визит)|контрольн\p{L}* (при[её]м|осмотр)|следующ\p{L}* при[её]м)/u.test(n)) { r.nextVisit = after(l, /(явк\p{L}*|повторн\p{L}*\s+\p{L}+|контрольн\p{L}*\s+\p{L}+|следующ\p{L}*\s+при[её]м)/iu) || l; used.add(i); return; }
        if (/(рекоменд|режим|диета|наблюдение|анализ)/.test(n) && !/^(rp|1[.)])/.test(n)) { recs.push(after(l, /(рекомендац\p{L}*|рекомендовано)/iu) || l); used.add(i); }
    });
    // лекарства: «Rp.», нумерованные строки с дозировкой; «D.S.», «S.», «Принимать…» — к предыдущему лекарству
    const DOSE = /(\d+[.,]?\d*\s?(мг|mg|мкг|г(?!\p{L})|g(?!\p{L})|мл|ml|ме|ед|%)|таб|tab|капс|caps|амп|amp|сироп|капл|мазь|крем|спрей|суспенз|порош|саше|свеч|№\s?\d+\s*$|n\s?\d+(?!\p{L}))/iu;
    let cur = null;
    lines.forEach((l, i) => {
        if (used.has(i)) return;
        const n = normText(l);
        const sig = n.match(/^(d\.?\s?s\.?|s\.|signa|sig\.?|принимать|применять|по\s+\d+\s*(таб|капс|мл|капл)|внутрь|наносить|закапывать)/);
        if (sig && !cur) return;
        if (sig && cur) { const v = after(l, /^(d\.?\s?s\.?|s\.|signa|sig\.?)/i) || l; cur.how = [cur.how, v].filter(Boolean).join(' ').slice(0, 160); const dm = n.match(/(\d+)\s*(дн|день|дня|дней|сут)/); if (dm && !cur.days) cur.days = dm[1]; return; }
        const rp = l.match(/^(rp|рп)\s*[.:]+\s*(.+)/i);
        const num = l.match(/^\d{1,2}\s*[.)]\s*(.+)/);
        const body = rp ? rp[2] : num ? num[1] : (DOSE.test(l) && /^[A-Za-zА-ЯЁа-яё]/.test(l) && l.length < 90 ? l : '');
        if (!body || !DOSE.test(body + ' ' + (lines[i + 1] || '')) && !rp) return;
        const nm = body.match(/^([A-Za-zА-ЯЁа-яё][A-Za-zА-ЯЁа-яё\- ]{1,40}?)(?=\s+\d|\s+(таб|tab|капс|caps|сироп|мазь|р-р|раствор)|[,(]|$)/i);
        const name = (nm ? nm[1] : body.split(/[,\d]/)[0]).replace(/\s+(tab|tabl|caps)\.?$/i, '').trim();
        if (!name || name.length < 3) return;
        const dose = (body.match(/\d+[.,]?\d*\s?(мг|mg|мкг|г\b|g\b|мл|ml|ме|ед|%)/i) || [''])[0];
        const days = (normText(body).match(/(\d+)\s*(дн|день|дня|дней|сут)/) || [])[1] || '';
        const how = (body.match(/(\d\s*раз\p{L}*\s*в\s*(день|сутки)|утром|вечером|на ночь|до еды|после еды|во время еды)/iu) || [''])[0];
        const nn = normText(name);
        const dup = r.drugs.find(x => normText(x.name) === nn);   // одна и та же страница из фото и из PDF
        if (dup) { cur = null; return; }
        cur = { name: name.charAt(0).toUpperCase() + name.slice(1), latin: /^[A-Za-z]/.test(name) ? name : '', form: '', dose, how, days };
        r.drugs.push(cur);
    });
    r.recommendations = Array.from(new Set(recs.filter(Boolean))).join('; ').slice(0, 600);
    return medNormRxData(r);
}

// Распознанное → заготовка для формы назначения
function medRxDataToPreset(d, rxIds, engine) {
    const extra = [];
    if (d.specialty) extra.push({ k: 'Специальность', v: d.specialty });
    if (d.clinicAddress) extra.push({ k: 'Адрес клиники', v: d.clinicAddress });
    if (d.patient) extra.push({ k: 'Пациент', v: d.patient });
    if (d.patientBirth) extra.push({ k: 'Дата рождения', v: d.patientBirth });
    if (d.nextVisit) extra.push({ k: 'Повторный приём', v: d.nextVisit });
    (d.other || []).forEach(x => extra.push({ k: x.k || 'Пункт', v: x.v }));
    return {
        date: d.date || todayKey(), doctor: d.doctor, clinic: d.clinic, diagnosis: d.diagnosis,
        drugs: d.drugs.map(x => ({ id: uid('md'), name: x.name, latin: x.latin, dose: x.dose, how: x.how, days: x.days })),
        comment: d.recommendations, extra, rxIds, ocrText: d.text, recognized: engine || 'ocr'
    };
}

// =====================================================================================================
// 2. КАРТИНКИ ЛЕКАРСТВ ИЗ ИНТЕРНЕТА (Wikimedia Commons)
// =====================================================================================================
const MED_IMG_BAD = /(structur|substance|powder|formula|molecul|synthes|crystal|skeletal|ball[- ]and[- ]stick|space[- ]?fill|3d|chemical|reaction|mechanism|spectrum|graph|chart|diagram|map\b|logo|microscop|plant|flower|leaf|herb|seed|portrait|building|factory|headquarter|\.svg|\.pdf|\.tif)/i;
const MED_IMG_GOOD = /(pack|box|blister|tablet|tabs|pill|capsul|bottle|syrup|ampoul|vial|tube|sachet|упаков|таблет|капсул|блистер|флакон|сироп|ампул|коробк|pharmacy|аптек)/i;
let medImgBusy = false;
const medImgCache = new Map();
async function medCommonsSearch(q, limit) {
    const url = MED_COMMONS_API + '?action=query&format=json&origin=*&generator=search&gsrnamespace=6&gsrlimit=' + (limit || 20) +
        '&gsrsearch=' + encodeURIComponent(q + ' filetype:bitmap') + '&prop=imageinfo&iiprop=url|mime|size&iiurlwidth=480';
    const j = await mvFetch(url, { headers: { 'Api-User-Agent': 'iLife/' + APP_VERSION + ' (personal non-commercial app)' } }, 12000);   // так Wikimedia просит подписывать запросы из браузера
    const pages = (j && j.query && j.query.pages) ? Object.values(j.query.pages) : [];
    return pages.sort((a, b) => (a.index || 0) - (b.index || 0)).map(p => {
        const ii = (p.imageinfo || [])[0] || {};
        return { title: String(p.title || '').replace(/^File:/, ''), thumb: ii.thumburl || ii.url, page: ii.descriptionurl || '', mime: ii.mime || '', w: ii.width || 0, h: ii.height || 0 };
    }).filter(x => x.thumb && /jpe?g|png|webp/i.test(x.mime) && !MED_IMG_BAD.test(x.title) && Math.min(x.w, x.h) >= 160);
}
const MED_TRANSLIT = { а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'kh', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya' };
function medTranslit(s) { return String(s || '').toLowerCase().split('').map(c => MED_TRANSLIT[c] !== undefined ? MED_TRANSLIT[c] : c).join('').replace(/^\w/, c => c.toUpperCase()); }
// Форма препарата по тексту назначения: картинки той же формы (таблетки, капсулы, сироп…) идут выше
const MED_FORMS = [
    { k: 'tab', re: /таблет|табл|драже|tab/i, img: /tablet|tabs|pill|blister|таблет|блистер/i },
    { k: 'caps', re: /капсул|caps/i, img: /capsul|капсул/i },
    { k: 'syr', re: /сироп|суспенз|syrup|susp|мл\b|ml\b/i, img: /syrup|suspension|сироп|bottle|флакон/i },
    { k: 'drop', re: /капл|drop|спрей|spray/i, img: /drop|spray|капл|спрей/i },
    { k: 'oint', re: /мазь|крем|гель|ointment|cream|gel/i, img: /ointment|cream|gel|tube|мазь|крем|гель/i },
    { k: 'inj', re: /ампул|укол|инъек|amp|inj/i, img: /ampoul|ampul|vial|inject|ампул/i }
];
function medDrugForm(drug) { const t = [drug.form, drug.dose, drug.how, drug.name].join(' '); return MED_FORMS.find(f => f.re.test(t)) || null; }
// латинские написания сводятся к одному виду: Amoksitsillin ≈ Amoxicillin, Tsiprofloksatsin ≈ Ciprofloxacin
function medLatKey(s) { return medTranslit(normText(s)).toLowerCase().replace(/ks/g, 'x').replace(/ts/g, 'c').replace(/kh/g, 'h').replace(/ph/g, 'f').replace(/y/g, 'i').replace(/k/g, 'c'); }
const medSleep = ms => new Promise(r => setTimeout(r, ms));
function medDrugWords(name) { return normText(name).replace(/[^a-zа-я0-9 \-]/g, ' ').split(/\s+/).filter(w => w.length > 2 && !/^(таб|табл|капс|мг|мл|раствор|сироп|мазь|tab|tabl|caps)$/.test(w)); }
// Варианты картинок для лекарства: лучшие сверху
async function medDrugImgCandidates(drug, query) {
    const name = String(drug.name || '').trim(), latin = String(drug.latin || '').trim();
    const key = normText(query || (name + '|' + latin));
    if (medImgCache.has(key)) return medImgCache.get(key);
    const brand = /[а-яё]/i.test(name) ? medTranslit(name.split(/[\s,(]/)[0]) : '';   // «Нурофен» → «Nurofen»
    const qs = query ? [query] : Array.from(new Set([brand, latin, name].filter(Boolean)));
    const seen = new Set(), out = [];
    const words = medDrugWords(name + ' ' + latin + ' ' + brand), brandW = normText(brand), form = medDrugForm(drug);
    let lastErr = null;
    for (let qi = 0; qi < qs.length; qi++) {
        if (qi) await medSleep(350);   // Wikimedia не любит частые запросы
        let list = null;
        for (let a = 0; a < 2 && !list; a++) {
            try { list = await medCommonsSearch(qs[qi], 20); }
            catch (e) { lastErr = e; if (e.code === 429 && a === 0) await medSleep(1600); else break; }
        }
        if (!list) continue;
        list.forEach(x => {
            if (seen.has(x.thumb)) return; seen.add(x.thumb);
            const t = normText(x.title), tl = medLatKey(x.title);
            const hit = words.filter(w => t.includes(w) || (w.length > 4 && tl.includes(medLatKey(w)))).length;
            x.hit = hit;
            x.score = (MED_IMG_GOOD.test(x.title) ? 3 : 0) + hit * 2 - (hit ? 0 : 3) + (brandW && t.includes(brandW) ? 2 : 0);
            if (form) { if (form.img.test(x.title)) x.score += 3; else if (MED_FORMS.some(f => f !== form && f.img.test(x.title))) x.score -= 2; }
            out.push(x);
        });
        if (out.filter(x => x.score >= 6).length >= 6) break;
    }
    if (!out.length && lastErr) throw lastErr;
    out.sort((a, b) => b.score - a.score);
    medImgCache.set(key, out);
    return out;
}
// Скачивает картинку и кладёт её лекарству (старую убирает)
async function medDrugSetImage(drug, blob, src, auto) {
    const file = new File([blob], 'лекарство.jpg', { type: blob.type || 'image/jpeg' });
    const a = await makeAttachment(file, 'image');
    await persistAttachment(a);
    if (drug.img && drug.img.id) BlobDB.del(drug.img.id);
    drug.img = attachmentMeta(a); drug.imgSrc = src || ''; drug.imgAuto = !!auto; drug.imgTried = Date.now();
}
function medDrugClearImage(drug) { if (drug.img && drug.img.id) BlobDB.del(drug.img.id); delete drug.img; delete drug.imgSrc; delete drug.imgAuto; drug.imgTried = Date.now(); drug.imgNone = true; }
// Сама подбирает картинки лекарствам, у которых их ещё нет (по одной, в фоне)
async function medDrugImgsAuto() {
    if (medImgBusy || (typeof navigator !== 'undefined' && navigator.onLine === false)) return;
    const todo = [];
    medList('order').forEach(o => (o.drugs || []).forEach(d => { if (d.name && !d.img && !d.imgTried && !d.imgNone) todo.push(d); }));
    if (!todo.length) return;
    medImgBusy = true;
    let changed = 0;
    try {
        for (const d of todo.slice(0, 12)) {
            await medSleep(400);
            try {
                const list = await medDrugImgCandidates(d);
                const best = list.find(x => x.hit && x.score >= 2) || null;
                d.imgTried = Date.now();
                if (best) { const b = await mvFetchBlob(best.thumb); if (b) { await medDrugSetImage(d, b, best.page, true); changed++; } }
            } catch (e) { if (e && (e.code === 'network' || e.code === 'timeout' || e.code === 429 || e.code >= 500)) break; d.imgTried = Date.now(); }   // временная ошибка — попробуем при следующем открытии
        }
    } finally {
        medImgBusy = false;
        saveMeds();
        if (changed) { renderMedOrders(); }
    }
}
// Окно выбора картинки лекарства
function medDrugImgSheet(order, drug) {
    const node = document.createElement('div'); node.className = 'med-form med-imgpick';
    node.innerHTML =
        '<div class="med-imgpick-cur"><span class="med-thumb" id="mip-cur">' + (drug.img ? '<img alt="" data-blob="' + esc(drug.img.id) + '">' : ic('pill')) + '</span><div><b>' + esc(drug.name) + '</b>' +
        (drug.latin ? '<small>' + esc(drug.latin) + '</small>' : '') + (drug.img ? '<small>' + (drug.imgAuto ? 'Подобрана сама — проверьте, тот ли это препарат' : drug.imgSrc ? 'Выбрана из интернета' : 'Ваше фото') + '</small>' : '<small>Картинки пока нет</small>') +
        (drug.imgSrc ? '<a class="linkbtn" href="' + esc(drug.imgSrc) + '" target="_blank" rel="noopener noreferrer">' + ic('open_in_new') + 'Источник и лицензия</a>' : '') + '</div></div>' +
        '<div class="btn-group" style="margin-top:0.75rem"><button type="button" class="btn" id="mip-cam">' + ic('photo_camera') + 'Сфотографировать упаковку</button><button type="button" class="btn" id="mip-file">' + ic('add_photo_alternate') + 'Своё фото</button>' +
        (drug.img ? '<button type="button" class="btn" id="mip-del">' + ic('delete') + 'Убрать</button>' : '') + '</div>' +
        '<label class="field-label" for="mip-q">Поиск в интернете (Wikimedia Commons)</label><div class="med-imgpick-q"><input type="search" id="mip-q" maxlength="80" value="' + esc(drug.latin || drug.name) + '"><button type="button" class="btn" id="mip-go">' + ic('image_search') + 'Найти</button></div>' +
        '<div class="med-imgpick-grid" id="mip-grid"></div>' +
        '<p class="hint" style="margin-top:0.5rem">Свободная фотобаза: есть не все препараты, а упаковка может быть другой страны. Самое точное — сфотографировать свою упаковку.</p>';
    medFillThumbs(node);
    let sheet = null;
    const grid = $('#mip-grid', node);
    let cands = [];
    const done = msg => { saveMeds(); renderMedOrders(); if (sheet) sheet.close(); toast(msg); };
    const run = async q => {
        grid.innerHTML = '<p class="hint med-imgpick-wait"><span class="med-spin"></span>Ищем картинки…</p>';
        try {
            cands = await medDrugImgCandidates(drug, q);
            grid.innerHTML = cands.length ? cands.slice(0, 24).map((c, i) => '<button type="button" class="med-thumb" data-c="' + i + '" title="' + esc(c.title) + '"><img alt="" loading="lazy" src="' + esc(c.thumb) + '"></button>').join('') :
                '<p class="hint">Ничего не нашлось. Попробуйте латинское название (например, Ibuprofen) или сфотографируйте упаковку.</p>';
        } catch (e) { grid.innerHTML = '<p class="hint">Не удалось связаться с Wikimedia Commons: ' + esc(e.message || e) + '</p>'; }
    };
    grid.addEventListener('click', async e => {
        const b = e.target.closest('[data-c]'); if (!b) return;
        const c = cands[+b.dataset.c]; if (!c) return;
        b.classList.add('is-loading');
        const blob = await mvFetchBlob(c.thumb);
        if (!blob) { b.classList.remove('is-loading'); toast('Картинка не скачалась — выберите другую'); return; }
        await medDrugSetImage(drug, blob, c.page, false); delete drug.imgNone;
        done('Картинка выбрана: ' + drug.name);
    });
    const own = async camera => {
        const files = (await medPickRxFiles(camera)).filter(medIsImg);
        if (!files.length) return;
        await medDrugSetImage(drug, files[0], '', false); delete drug.imgNone;
        done('Фото упаковки сохранено');
    };
    $('#mip-cam', node).addEventListener('click', () => own(true));
    $('#mip-file', node).addEventListener('click', () => own(false));
    const del = $('#mip-del', node); if (del) del.addEventListener('click', () => { medDrugClearImage(drug); done('Картинка убрана'); });
    const q = $('#mip-q', node);
    $('#mip-go', node).addEventListener('click', () => run(q.value.trim() || drug.name));
    q.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); run(q.value.trim() || drug.name); } });
    sheet = openSheet({ title: 'Картинка лекарства', node, actions: [{ label: 'Закрыть', value: false }] });
    run('');
}
// Картинка лекарства для приёма в графике (по связи с назначением или по названию)
function medPlanDrug(p) {
    if (p.orderId) { const o = medById(p.orderId); const d = o && (o.drugs || []).find(x => x.id === p.drugId); if (d) return d; }
    const n = normText(p.drug).trim(); let found = null;
    medList('order').forEach(o => (o.drugs || []).forEach(d => { if (!found && d.img && normText(d.name).trim() === n) found = d; }));
    return found;
}

// =====================================================================================================
// 3. ПЛАСТИНКИ ТАБЛЕТОК (вверху «Назначения врача»)
// =====================================================================================================
const medBlisterSeen = new Map();   // plan.id → сколько уже выдавлено (для анимации «таблетка пропала»)
function medHash(s) { let h = 0; for (const ch of String(s)) h = (h * 31 + ch.codePointAt(0)) >>> 0; return h; }
// Все приёмы курса: [{ day, time }] (для курса без конца — пусто)
function medCourseDoses(p) {
    if (!p.to || !p.from || p.to < p.from) return null;
    const out = []; const n = Math.min(400, medDaysBetween(p.from, p.to));
    for (let i = 0; i <= n; i++) { const k = medDayAdd(p.from, i); if (medPlanActiveOn(p, k)) (p.times || []).forEach(t => out.push({ day: k, time: t })); }
    return out;
}
function medTakenCount(p) { let n = 0; Object.keys(p.taken || {}).forEach(k => { if (k >= (p.from || '') && (!p.to || k <= p.to)) n += (p.taken[k] || []).length; }); return n; }
// Что рисовать: { cells, used, pack, packs, total, taken }
function medBlisterModel(p) {
    const course = medCourseDoses(p), taken = medTakenCount(p), per = Math.max(1, (p.times || []).length);
    if (course && course.length) {
        const total = course.length;
        const pack = total <= 30 ? total : per * 7 <= 28 ? per * 7 : 10;
        const packs = Math.ceil(total / pack);
        const idx = Math.min(packs - 1, Math.floor(Math.min(taken, total - 1) / pack));
        const cells = Math.min(pack, total - idx * pack);
        const used = Math.max(0, Math.min(cells, taken - idx * pack));
        return { cells, used, pack: idx + 1, packs, total, taken: Math.min(taken, total) };
    }
    const pack = 10, idx = Math.floor(taken / pack);
    return { cells: pack, used: taken - idx * pack, pack: idx + 1, packs: 0, total: 0, taken };
}
function medIsCapsule(p) { return /капс|caps/i.test((p.dose || '') + ' ' + (p.drug || '')); }
function medBlisterSvg(p, m, popIdx) {
    const n = m.cells, rows = n <= 5 ? 1 : n <= 16 ? 2 : 3, cols = Math.ceil(n / rows);
    const caps = medIsCapsule(p), hue = medHash(p.drug) % 360;
    const cw = caps ? 44 : 34, ch = caps ? 26 : 34, gx = 10, gy = 12, pad = 14;
    const W = pad * 2 + cols * cw + (cols - 1) * gx, H = pad * 2 + rows * ch + (rows - 1) * gy + 14;
    const gid = 'mb' + medHash(p.id);
    let cells = '';
    for (let i = 0; i < n; i++) {
        const r = Math.floor(i / cols), c = i % cols;
        const x = pad + c * (cw + gx), y = pad + r * (ch + gy), cx = x + cw / 2, cy = y + ch / 2;
        const empty = i < m.used && i !== popIdx;
        // лунка (пузырёк пластика)
        const well = caps ? '<rect x="' + (x - 2) + '" y="' + (y - 2) + '" width="' + (cw + 4) + '" height="' + (ch + 4) + '" rx="' + (ch / 2 + 2) + '"' : '<circle cx="' + cx + '" cy="' + cy + '" r="' + (cw / 2 + 2) + '"';
        if (empty) {
            // таблетку выдавили: порванная фольга
            const rr = caps ? ch / 2 : cw / 2 - 1; let pts = '';
            for (let a = 0; a < 18; a++) { const ang = a / 18 * Math.PI * 2, k = (a % 2 ? 0.84 : 0.97) - ((medHash(p.id + i + a) % 10) / 90); pts += (cx + Math.cos(ang) * (caps ? cw / 2 - 2 : rr) * k).toFixed(1) + ',' + (cy + Math.sin(ang) * rr * k).toFixed(1) + ' '; }
            cells += '<g class="mb-cell is-empty">' + well + ' class="mb-well"/><polygon class="mb-hole" points="' + pts.trim() + '"/><path class="mb-flap" d="M' + (cx - 4) + ' ' + (cy + rr * 0.55) + ' l6 7 l5 -6 z"/></g>';
        } else {
            const pill = caps ?
                '<g class="mb-pill"><rect x="' + x + '" y="' + y + '" width="' + cw + '" height="' + ch + '" rx="' + ch / 2 + '" fill="hsl(' + hue + ' 60% 55%)"/><path d="M' + (x + cw / 2) + ' ' + y + 'h' + (cw / 2 - ch / 2) + 'a' + ch / 2 + ' ' + ch / 2 + ' 0 0 1 0 ' + ch + 'h-' + (cw / 2 - ch / 2) + 'z" fill="#f4f1ea"/><rect x="' + (x + 5) + '" y="' + (y + 4) + '" width="' + (cw / 2 - 6) + '" height="4" rx="2" fill="#fff" opacity=".45"/></g>' :
                '<g class="mb-pill"><circle cx="' + cx + '" cy="' + cy + '" r="' + (cw / 2 - 1) + '" fill="url(#' + gid + 'p)"/><line x1="' + (cx - cw / 2 + 7) + '" y1="' + cy + '" x2="' + (cx + cw / 2 - 7) + '" y2="' + cy + '" class="mb-score"/><ellipse cx="' + (cx - 5) + '" cy="' + (cy - 7) + '" rx="6" ry="3" fill="#fff" opacity=".7"/></g>';
            cells += '<g class="mb-cell' + (i === popIdx ? ' is-pop' : '') + '" style="--ox:' + cx + 'px;--oy:' + cy + 'px">' + well + ' class="mb-well"/>' + pill + '</g>';
        }
    }
    const label = String(p.drug || '').toUpperCase().slice(0, 34);
    return '<svg class="med-blister-svg" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc(p.drug + ': осталось ' + (n - m.used) + ' из ' + n) + '">' +
        '<defs><linearGradient id="' + gid + 'f" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#eef0f3"/><stop offset=".45" stop-color="#c9ced6"/><stop offset=".55" stop-color="#dfe3e8"/><stop offset="1" stop-color="#b3bac4"/></linearGradient>' +
        '<radialGradient id="' + gid + 'p" cx=".38" cy=".32" r=".75"><stop offset="0" stop-color="#ffffff"/><stop offset=".7" stop-color="#f1efe9"/><stop offset="1" stop-color="#d9d5cc"/></radialGradient></defs>' +
        '<rect class="mb-foil" x="1" y="1" width="' + (W - 2) + '" height="' + (H - 2) + '" rx="12" fill="url(#' + gid + 'f)"/>' +
        '<rect x="5" y="5" width="' + (W - 10) + '" height="' + (H - 10) + '" rx="9" class="mb-perf"/>' +
        cells + '<text x="' + W / 2 + '" y="' + (H - 7) + '" class="mb-text" text-anchor="middle">' + esc(label) + '</text></svg>';
}
function medBlisterNext(p) {
    const today = todayKey();
    if (!medPlanActiveOn(p, today)) return null;
    const t = (p.times || []).slice().sort().find(x => !medIsTaken(p, today, x));
    return t ? { day: today, time: t } : null;
}
function renderMedBlisters() {
    const host = $('#med-blisters'); if (!host) return;
    const today = todayKey();
    const plans = medList('plan').filter(p => (p.times || []).length && p.from && p.from <= today && (!p.to || p.to >= today))
        .sort((a, b) => String(a.drug).localeCompare(String(b.drug), 'ru'));
    if (!plans.length) {
        const demo = { id: 'demo', drug: 'Пример', dose: '', times: ['08:00'] };
        host.innerHTML = '<div class="med-blisters-empty"><div class="med-blister is-demo" aria-hidden="true">' + medBlisterSvg(demo, { cells: 10, used: 3 }, -1) + '</div>' +
            '<p class="hint">Здесь появится пластинка таблеток для каждого лекарства из «Графика приёма». После каждого приёма из неё пропадает одна таблетка. Нажмите «В график» у лекарства в назначении.</p></div>';
        return;
    }
    host.innerHTML = '<div class="med-blisters-row">' + plans.map(p => {
        const m = medBlisterModel(p), seen = medBlisterSeen.get(p.id);
        const pop = seen !== undefined && m.used > seen && m.used <= m.cells ? m.used - 1 : -1;
        medBlisterSeen.set(p.id, m.used);
        const next = medBlisterNext(p), d = medPlanDrug(p);
        const left = m.cells - m.used;
        const cap = m.total ? 'Осталось ' + left + ' из ' + m.cells + (m.packs > 1 ? ' · пластинка ' + m.pack + ' из ' + m.packs : '') + ' · за курс принято ' + m.taken + ' из ' + m.total
            : 'Осталось ' + left + ' из ' + m.cells + (m.pack > 1 ? ' · пластинка ' + m.pack : '') + ' · принято всего ' + m.taken;
        return '<article class="med-blister" data-id="' + esc(p.id) + '">' +
            '<div class="med-blister-h">' + (d && d.img ? '<span class="med-thumb med-blister-img"><img alt="" data-blob="' + esc(d.img.id) + '"></span>' : '<span class="med-blister-ico">' + ic('pill') + '</span>') +
            '<div><b>' + esc(p.drug) + '</b><small>' + esc([p.dose, (p.times || []).join(', ')].filter(Boolean).join(' · ')) + '</small></div></div>' +
            '<button type="button" class="med-blister-btn" data-take title="' + (next ? 'Нажмите, когда примете: ' + next.time : 'На сегодня всё принято') + '">' + medBlisterSvg(p, m, pop) + '</button>' +
            '<p class="med-blister-cap">' + esc(cap) + '</p>' +
            '<p class="med-blister-next' + (next ? '' : ' is-done') + '">' + (next ? ic('alarm') + '<span>Следующий приём сегодня в <b>' + esc(next.time) + '</b> — нажмите на пластинку, когда примете</span>' : ic('check_circle') + '<span>На сегодня всё принято</span>') + '</p></article>';
    }).join('') + '</div>';
    medFillThumbs(host);
}
function medBlisterTake(p) {
    const next = medBlisterNext(p);
    if (!next) { toast('На сегодня ' + p.drug + ' уже принят'); return; }
    medSetTaken(p, next.day, next.time, true); saveMeds();
    medScheduleChanged();   // перерисует пластинки: выдавленная таблетка улетает
    toast('Принято: ' + p.drug + ' · ' + next.time, { action: 'Отменить', ms: 6000, onAction: () => { medSetTaken(p, next.day, next.time, false); medBlisterSeen.delete(p.id); saveMeds(); medScheduleChanged(); } });
}
function initMedRecognize() {
    const b = $('#med-orders-scan'); if (b) b.addEventListener('click', () => medRecognizeSheet());
    const host = $('#med-blisters');
    if (host) host.addEventListener('click', e => {
        const t = e.target.closest('[data-take]'); if (!t) return;
        const card = t.closest('.med-blister'); const p = card && medById(card.dataset.id); if (p) medBlisterTake(p);
    });
    window.addEventListener('online', () => { if ($('#med-orders') && $('#med-orders').classList.contains('is-active')) medDrugImgsAuto(); });
}
