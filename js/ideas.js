'use strict';
// =====================================================================================================
// iLife — СТРАНИЦА «ИДЕИ»: поиск сверху, блок «Новая идея» (текст, хештеги, картинки, музыка, диктофон, файлы, Spotify),
// список заметок с датой создания и автором внизу каждой. PDF — кнопка в заголовке страницы (js/pdf-export.js).
//
// Запись: { id, text, tags[], createdAt, updatedAt, author, files[], track|null }
//   tags  — хештеги в нижнем регистре без «#» (из текста вида #идея + добавленные отдельно);
//   files — метаданные вложений (сами файлы в IndexedDB, см. media.js);
//   track — трек Spotify { title, artist, album, url, coverId?, coverUrl? }.
// Поиск (индекс собирается по каждой записи): слова из текста, названия файлов и треков; хештеги (#тег);
// даты — 05.11.2026, 05.11, 2026-11-05, 2026, «ноябрь», «ноября», «четверг», «сегодня», «вчера».
// Несколько слов через пробел — запись должна подходить под все.
// =====================================================================================================

let ideas = LS.get('ideas', []);
if (!Array.isArray(ideas)) ideas = [];
const draft = { files: [], track: null, extraTags: [] };
let ideaQuery = '';
let ideasShown = 40;
let recorder = null;

function saveIdeas() { if (typeof cloudLocalChanged === 'function') cloudLocalChanged(); return LS.set('ideas', ideas); }

// ---------- Хештеги и текст ----------
const TAG_RE = /(?<![\p{L}\p{N}_\/&])#([\p{L}\p{N}_]{1,40})/gu;
function extractTags(text) {
    const out = []; let m; TAG_RE.lastIndex = 0;
    while ((m = TAG_RE.exec(text || ''))) { const t = normText(m[1]); if (!out.includes(t)) out.push(t); }
    return out;
}
function parseTagString(str) {
    return Array.from(new Set(String(str || '').split(/[\s,;]+/).map(s => normText(s.replace(/^#+/, '')).replace(/[^\p{L}\p{N}_]/gu, '')).filter(Boolean))).slice(0, 30);
}
function richText(text) {
    const re = /(https?:\/\/[^\s<>"']+)|(?<![\p{L}\p{N}_\/&])#([\p{L}\p{N}_]{1,40})/gu;
    let out = '', last = 0, m;
    while ((m = re.exec(text))) {
        out += esc(text.slice(last, m.index));
        if (m[1]) {
            let url = m[1], trail = ''; const t = url.match(/[.,;:!?)\]»]+$/);
            if (t) { trail = t[0]; url = url.slice(0, -trail.length); }
            out += '<a href="' + esc(url) + '" target="_blank" rel="noopener noreferrer">' + esc(url) + '</a>' + esc(trail);
        } else out += '<button type="button" class="htag" data-tag="' + esc(normText(m[2])) + '">#' + esc(m[2]) + '</button>';
        last = re.lastIndex;
    }
    return out + esc(text.slice(last));
}

// Подпись «кто и когда» в блоке ввода (вызывается по таймеру и при смене имени автора)
function updateComposerMeta() {
    const n = $('#composer-now'), a = $('#composer-author'); if (!n || !a) return;
    n.textContent = fmtDate(Date.now(), false) + ', ' + fmtTime(Date.now()); a.textContent = authorName();
}

// ---------- Поиск: индекс и разбор запроса ----------
const IX = new Map();
function dateStrings(ms) {
    const p = almatyParts(ms), mm = pad2(p.mo + 1), dd = pad2(p.d);
    return [p.y + '-' + mm + '-' + dd, dd + '.' + mm + '.' + p.y, p.d + '.' + (p.mo + 1) + '.' + p.y, dd + '.' + mm, p.d + '.' + (p.mo + 1), p.y + '-' + mm, mm + '.' + p.y, String(p.y),
        MONTHS_NOM[p.mo], MONTHS_GEN[p.mo], p.d + ' ' + MONTHS_GEN[p.mo], p.d + ' ' + MONTHS_GEN[p.mo] + ' ' + p.y, WEEKDAYS[p.wd]];
}
function ideaIndex(idea) {
    const key = idea.id + '|' + (idea.updatedAt || idea.createdAt);
    let ix = IX.get(key);
    if (ix) return ix;
    const parts = [idea.text, idea.author, (idea.files || []).map(f => f.name).join(' '), idea.track ? [idea.track.title, idea.track.artist, idea.track.album].join(' ') : ''];
    ix = { text: normText(parts.join(' \n ')), tags: idea.tags || [], dates: dateStrings(idea.createdAt).map(normText) };
    IX.set(key, ix);
    return ix;
}
function isDateToken(t) { return /^\d{1,4}([.\-\/]\d{1,4}){1,2}$/.test(t) || /^(19|20)\d\d$/.test(t); }
function matchToken(ix, t) {
    if (t.startsWith('#')) { const q = t.slice(1); return !q || ix.tags.some(g => g.startsWith(q)); }
    if (t === 'сегодня') return ix.dates[0] === todayKey();
    if (t === 'вчера') return ix.dates[0] === todayKey(-1);
    if (t === 'позавчера') return ix.dates[0] === todayKey(-2);
    if (ix.text.includes(t)) return true;
    if (/^\d{1,2} [а-я]+( \d{4})?$/.test(t)) return ix.dates.some(s => s.startsWith(t));
    if (isDateToken(t)) { const d = t.replace(/\//g, '.'); return ix.dates.some(s => s.startsWith(d)); }
    if (/^[а-яa-z]{3,}$/.test(t)) return ix.dates.some(s => /[а-я]/.test(s) && s.includes(t));
    return false;
}
// «5 ноября» / «5 нояб 2026» — число и месяц склеиваются в одну дату; остальные слова ищутся по отдельности (все должны совпасть)
function monthIndexByWord(w) {
    if (w.length < 3) return -1;
    return MONTHS_GEN.findIndex((m, i) => normText(m).startsWith(w) || normText(MONTHS_NOM[i]).startsWith(w));
}
function queryTokens(q) {
    const raw = normText(q).split(/\s+/).filter(Boolean), out = [];
    for (let i = 0; i < raw.length; i++) {
        const mi = /^\d{1,2}$/.test(raw[i]) && raw[i + 1] ? monthIndexByWord(raw[i + 1]) : -1;
        if (mi >= 0) {
            let tok = (+raw[i]) + ' ' + normText(MONTHS_GEN[mi]); i++;
            if (raw[i + 1] && /^(19|20)\d\d$/.test(raw[i + 1])) { tok += ' ' + raw[i + 1]; i++; }
            out.push(tok);
        } else out.push(raw[i]);
    }
    return out;
}
function filteredIdeas() {
    const tokens = queryTokens(ideaQuery);
    if (!tokens.length) return ideas.slice();
    return ideas.filter(i => { const ix = ideaIndex(i); return tokens.every(t => matchToken(ix, t)); });
}
function setQuery(q, focus) {
    ideaQuery = q; ideasShown = 40;
    const inp = $('#idea-search'); if (inp && inp.value !== q) inp.value = q;
    renderIdeas();
    if (focus && inp) inp.focus();
}
function toggleQueryToken(tok) {
    const tokens = ideaQuery.split(/\s+/).filter(Boolean);
    const i = tokens.findIndex(t => normText(t) === tok);
    if (i >= 0) tokens.splice(i, 1); else tokens.push(tok);
    setQuery(tokens.join(' '));
}
function allTags() {
    const m = new Map();
    ideas.forEach(i => (i.tags || []).forEach(t => m.set(t, (m.get(t) || 0) + 1)));
    return Array.from(m.entries()).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'ru'));
}

// ---------- Черновик (блок «Новая идея») ----------
function draftTags() {
    const ta = $('#idea-text');
    return Array.from(new Set([...extractTags(ta ? ta.value : ''), ...draft.extraTags]));
}
function renderDraft() {
    const ta = $('#idea-text');
    const textTags = extractTags(ta ? ta.value : '');
    const row = $('#draft-tags');
    row.innerHTML = draftTags().map(t => '<span class="chip tag" data-t="' + esc(t) + '">#' + esc(t) +
        '<button type="button" class="icon-btn chip-x" aria-label="Убрать #' + esc(t) + '" data-rm-tag="' + esc(t) + '">' + ic('close') + '</button></span>').join('');
    // подсказки: частые хештеги, которых ещё нет в черновике
    const have = new Set(draftTags());
    const sugg = allTags().filter(([t]) => !have.has(t)).slice(0, 8);
    $('#tag-sugg').innerHTML = sugg.length ? '<span class="lbl">Уже использовали:</span><div class="chips">' + sugg.map(([t, n]) => '<button type="button" class="chip" data-add-tag="' + esc(t) + '">#' + esc(t) + ' <small>' + n + '</small></button>').join('') + '</div>' : '';
    // вложения
    const box = $('#draft-attachments');
    const imgs = draft.files.filter(f => f.kind === 'image');
    const rest = draft.files.filter(f => f.kind !== 'image');
    box.innerHTML = imgs.map(f => '<div class="thumb"><img alt="" data-draft-img="' + f.id + '"><button type="button" class="x" data-rm-file="' + f.id + '" aria-label="Убрать">' + ic('close') + '</button></div>').join('') +
        rest.map(f => '<div class="file-chip"><span class="fi-i" style="display:inline-flex">' + ic(fileIconName(f)) + '</span><span class="nm">' + esc(f.name) + '</span><span class="sz">' + (f.dur ? fmtDuration(f.dur) + ' · ' : '') + fmtBytes(f.size) + '</span>' +
            '<button type="button" class="icon-btn" data-rm-file="' + f.id + '" aria-label="Убрать">' + ic('close') + '</button></div>').join('') +
        (draft.track ? '<div class="file-chip is-track">' + (draft.track.coverUrl ? '<img class="cv" alt="" src="' + esc(draft.track.coverUrl) + '">' : ic('music_note')) +
            '<span class="nm">' + esc(draft.track.title) + ' — ' + esc(draft.track.artist) + '</span><button type="button" class="icon-btn" data-rm-track aria-label="Убрать трек">' + ic('close') + '</button></div>' : '');
    imgs.forEach(f => { const im = box.querySelector('[data-draft-img="' + f.id + '"]'); if (im) { f._url = f._url || URL.createObjectURL(f.thumb || f.blob); im.src = f._url; } });
    $('#idea-save').disabled = !((ta.value || '').trim() || draft.files.length || draft.track);
    LS.set('draft', ta.value || '');
}
function dropDraftFile(id) {
    const i = draft.files.findIndex(f => f.id === id);
    if (i >= 0) { if (draft.files[i]._url) URL.revokeObjectURL(draft.files[i]._url); draft.files.splice(i, 1); }
}
async function addFiles(list, hint) {
    const files = Array.from(list || []); if (!files.length) return;
    let ok = 0;
    for (const file of files) {
        let kind = hint;
        if (!kind || kind === 'any') kind = /^image\//.test(file.type) ? 'image' : /^audio\//.test(file.type) ? 'audio' : 'file';
        if (kind === 'image' && !/^image\//.test(file.type)) kind = 'file';
        if (kind === 'audio' && !/^audio\//.test(file.type) && !/\.(mp3|m4a|aac|flac|ogg|oga|opus|wav|wma)$/i.test(file.name)) kind = 'file';
        try { draft.files.push(await makeAttachment(file, kind)); ok++; } catch (e) {
            try { draft.files.push(await makeAttachment(file, 'file')); ok++; } catch (e2) { toast('Не удалось добавить: ' + file.name); }
        }
    }
    if (ok) renderDraft();
}

async function saveIdea() {
    const ta = $('#idea-text'); const text = (ta.value || '').trim();
    if (!text && !draft.files.length && !draft.track) return;
    const btn = $('#idea-save'); btn.disabled = true;
    try {
        for (const f of draft.files) await persistAttachment(f);
        let track = null;
        if (draft.track) {
            track = { title: draft.track.title, artist: draft.track.artist, album: draft.track.album || '', url: draft.track.url || '' };
            if (draft.track.coverBlob) { const cid = uid('c'); await BlobDB.put({ id: cid, blob: draft.track.coverBlob, name: 'cover.jpg', type: draft.track.coverBlob.type, size: draft.track.coverBlob.size }); track.coverId = cid; }
            else if (draft.track.remoteCover) track.coverUrl = draft.track.remoteCover;
        }
        const now = Date.now();
        const idea = { id: uid('i'), text, tags: draftTags(), createdAt: now, updatedAt: now, author: authorName(), files: draft.files.map(attachmentMeta), track };
        draft.files.forEach(f => { if (f._url) URL.revokeObjectURL(f._url); });
        ideas.unshift(idea);
        if (!saveIdeas()) { ideas.shift(); throw new Error('storage'); }
        draft.files = []; draft.track = null; draft.extraTags = []; ta.value = ''; LS.del('draft');
        renderDraft(); renderIdeas();
        toast('Идея сохранена');
    } catch (e) {
        console.warn(e); toast('Не удалось сохранить идею');
    } finally { btn.disabled = false; renderDraft(); }
}

// ---------- Список заметок ----------
function noteHtml(idea) {
    const imgs = (idea.files || []).filter(f => f.kind === 'image');
    const players = (idea.files || []).filter(f => f.kind === 'audio' || f.kind === 'voice');
    const others = (idea.files || []).filter(f => f.kind === 'file');
    const inText = new Set(extractTags(idea.text));
    const extra = (idea.tags || []).filter(t => !inText.has(t));
    let h = '<article class="note" data-id="' + idea.id + '">';
    if (idea.text) h += '<div class="note-text">' + richText(idea.text) + '</div>';
    if (extra.length) h += '<div class="chips">' + extra.map(t => '<button type="button" class="chip tag" data-tag="' + esc(t) + '">#' + esc(t) + '</button>').join('') + '</div>';
    if (imgs.length) {
        const shown = imgs.slice(0, 6);
        const cls = imgs.length === 1 ? 'is-single' : imgs.length >= 5 ? 'is-multi3' : '';
        h += '<div class="note-media ' + cls + '">' + shown.map((f, i) => '<button type="button" data-lb="' + i + '" aria-label="Открыть картинку">' +
            '<img alt="' + esc(f.name) + '" loading="lazy" data-blob="' + f.id + '" data-variant="thumb">' +
            (i === 5 && imgs.length > 6 ? '<span class="more">+' + (imgs.length - 6) + '</span>' : '') + '</button>').join('') + '</div>';
    }
    if (players.length || others.length || idea.track) {
        h += '<div class="note-attach">';
        players.forEach(f => { h += '<div data-player="' + f.id + '"></div>'; });
        if (idea.track) {
            const t = idea.track;
            h += '<' + (t.url ? 'a href="' + esc(t.url) + '" target="_blank" rel="noopener noreferrer"' : 'div') + ' class="track-card">' +
                (t.coverId ? '<img class="cv" alt="" data-blob="' + t.coverId + '">' : t.coverUrl ? '<img class="cv" alt="" src="' + esc(t.coverUrl) + '">' : '<span class="cv">' + ic('album') + '</span>') +
                '<span class="tx"><span class="nm">' + esc(t.title) + '</span><br><span class="sub">' + esc(t.artist) + (t.album ? ' · ' + esc(t.album) : '') + '</span></span>' +
                (t.url ? '<span class="lnk">' + ic('open_in_new') + '</span>' : '') + '</' + (t.url ? 'a' : 'div') + '>';
        }
        others.forEach(f => {
            h += '<button type="button" class="file-row" data-file="' + f.id + '"><span class="fi">' + ic(fileIconName(f)) + '</span><span class="tx"><div class="nm">' + esc(f.name) + '</div><div class="sub">' + fmtBytes(f.size) + ' · нажмите, чтобы открыть</div></span>' + ic('download') + '</button>';
        });
        h += '</div>';
    }
    h += '<div class="note-foot"><div class="meta"><button type="button" class="meta-btn" data-date="' + dayKey(idea.createdAt) + '" title="Показать записи за этот день">' + ic('calendar_today') + esc(fmtDateTime(idea.createdAt)) + '</button>' +
        '<span>' + ic('person') + esc(idea.author || 'Александр') + '</span></div>' +
        '<button type="button" class="icon-btn" data-edit="' + idea.id + '" aria-label="Изменить">' + ic('edit') + '</button>' +
        '<button type="button" class="icon-btn is-danger" data-del="' + idea.id + '" aria-label="Удалить">' + ic('delete') + '</button></div></article>';
    return h;
}
function renderTagbar() {
    const tags = allTags().slice(0, 30);
    const active = new Set(queryTokens(ideaQuery));
    $('#tagbar').innerHTML = tags.map(([t, n]) => '<button type="button" class="chip' + (active.has('#' + t) ? ' is-on' : '') + '" data-q-tag="' + esc(t) + '">#' + esc(t) + ' <small>' + n + '</small></button>').join('');
}
function renderIdeas() {
    const list = $('#ideas-list');
    const found = filteredIdeas();
    const total = ideas.length;
    const searching = queryTokens(ideaQuery).length > 0;
    $('#ideas-count').textContent = total ? (searching ? 'найдено ' + found.length + ' из ' + total : 'всего ' + total) : '';
    $('#idea-search-clear').hidden = !ideaQuery;
    $('#search-status').textContent = searching ? (found.length ? 'Найдено: ' + found.length + ' из ' + total : 'Ничего не найдено. Попробуйте другое слово, #хештег или дату (например, 05.11.2026 или «ноябрь»).') : '';
    renderTagbar();
    if (!found.length) {
        list.innerHTML = searching
            ? '<div class="empty"><div class="ico-big">' + ic('search') + '</div><b>Ничего не найдено</b>Измените запрос или нажмите на крестик, чтобы показать все идеи.</div>'
            : '<div class="empty"><div class="ico-big">' + ic('lightbulb') + '</div><b>Пока нет идей</b>Напишите первую в блоке выше: текст, #хештеги, картинки, музыку или голосовую запись.</div>';
        $('#ideas-pdf').disabled = !total;
        return;
    }
    $('#ideas-pdf').disabled = false;
    const slice = found.slice(0, ideasShown);
    list.innerHTML = slice.map(noteHtml).join('') +
        (found.length > slice.length ? '<div style="text-align:center;margin:8px 0 16px"><button type="button" class="btn" id="ideas-more">Показать ещё (' + (found.length - slice.length) + ')</button></div>' : '');
    hydrateNotes(list, slice);
}
function hydrateNotes(root, slice) {
    root.querySelectorAll('img[data-blob]').forEach(async im => { const u = await BlobDB.url(im.dataset.blob, im.dataset.variant); if (u) im.src = u; else im.closest('button,a,div') && (im.style.display = 'none'); });
    slice.forEach(idea => {
        const card = root.querySelector('.note[data-id="' + idea.id + '"]'); if (!card) return;
        (idea.files || []).filter(f => f.kind === 'audio' || f.kind === 'voice').forEach(f => {
            const slot = card.querySelector('[data-player="' + f.id + '"]'); if (slot) slot.replaceWith(buildPlayer(f));
        });
    });
}

async function openStoredFile(id, name) {
    const rec = await BlobDB.get(id);
    if (!rec) { toast('Файл не найден в памяти устройства'); return; }
    const res = await deliverFile(rec.blob, name || rec.name);
    if (res === 'unsupported') toast('В этом приложении сохранить файл нельзя — откройте iLife в браузере');
    else if (res === 'downloaded') toast('Файл скачан: ' + (name || rec.name));
}

// ---------- Правка и удаление ----------
function editIdea(id) {
    const idea = ideas.find(i => i.id === id); if (!idea) return;
    const inText = new Set(extractTags(idea.text));
    const extra = (idea.tags || []).filter(t => !inText.has(t));
    const removed = new Set(); let dropTrack = false;
    const files = (idea.files || []);
    const html = '<label class="field-label" for="edit-text">Текст</label><textarea id="edit-text" rows="6"></textarea>' +
        '<label class="field-label" for="edit-tags" style="margin-top:12px">Дополнительные хештеги (через пробел)</label><input type="text" id="edit-tags" placeholder="#идея #работа">' +
        ((files.length || idea.track) ? '<div class="edit-attach" id="edit-attach"></div>' : '');
    const sheet = openSheet({
        title: 'Изменить идею', html,
        actions: [{ label: 'Отмена' }, { label: 'Сохранить', kind: 'primary', icon: 'check', async onClick() {
            const text = $('#edit-text', sheet.el).value.trim();
            const tags = Array.from(new Set([...extractTags(text), ...parseTagString($('#edit-tags', sheet.el).value)]));
            if (!text && files.length === removed.size && (!idea.track || dropTrack)) { toast('Запись не может быть пустой — удалите её кнопкой с корзиной'); return false; }
            for (const fid of removed) await BlobDB.del(fid);
            idea.files = files.filter(f => !removed.has(f.id));
            if (dropTrack && idea.track) { if (idea.track.coverId) await BlobDB.del(idea.track.coverId); idea.track = null; }
            idea.text = text; idea.tags = tags; idea.updatedAt = Date.now();
            saveIdeas(); renderIdeas(); toast('Изменения сохранены');
        } }]
    });
    $('#edit-text', sheet.el).value = idea.text || '';
    $('#edit-tags', sheet.el).value = extra.map(t => '#' + t).join(' ');
    const box = $('#edit-attach', sheet.el);
    if (box) {
        const paint = () => {
            box.innerHTML = '<span class="field-label">Вложения (нажмите на корзину, чтобы убрать)</span>' +
                files.filter(f => !removed.has(f.id)).map(f => '<div class="file-chip"><span style="display:inline-flex">' + ic(fileIconName(f)) + '</span><span class="nm">' + esc(f.name) + '</span><span class="sz">' + fmtBytes(f.size) + '</span><button type="button" class="icon-btn is-danger" data-rm="' + f.id + '" aria-label="Убрать">' + ic('delete') + '</button></div>').join('') +
                (idea.track && !dropTrack ? '<div class="file-chip is-track"><span style="display:inline-flex">' + ic('music_note') + '</span><span class="nm">' + esc(idea.track.title) + ' — ' + esc(idea.track.artist) + '</span><button type="button" class="icon-btn is-danger" data-rm-track aria-label="Убрать трек">' + ic('delete') + '</button></div>' : '');
        };
        paint();
        box.addEventListener('click', e => {
            const b = e.target.closest('button'); if (!b) return;
            if (b.dataset.rm) removed.add(b.dataset.rm); else if (b.hasAttribute('data-rm-track')) dropTrack = true;
            paint();
        });
    }
}
async function deleteIdea(id) {
    const idea = ideas.find(i => i.id === id); if (!idea) return;
    const ok = await confirmSheet('Удалить идею?', 'Запись и все её вложения будут удалены с этого устройства без возможности восстановления.', 'Удалить', true);
    if (!ok) return;
    for (const f of idea.files || []) await BlobDB.del(f.id);
    if (idea.track && idea.track.coverId) await BlobDB.del(idea.track.coverId);
    ideas = ideas.filter(i => i.id !== id);
    saveIdeas(); renderIdeas(); toast('Идея удалена');
}

// ---------- Диктофон ----------
async function toggleRecorder() {
    const panel = $('#recorder'), btn = $('[data-attach="voice"]');
    if (recorder) { await finishRecording(false); return; }
    if (!VoiceRecorder.supported()) { toast('Диктофон не поддерживается в этом браузере'); return; }
    recorder = new VoiceRecorder();
    const bars = $('#rec-bars'); bars.innerHTML = '<i></i>'.repeat(28);
    const els = bars.children; let n = 0;
    try {
        await recorder.start(sec => { $('#rec-time').textContent = fmtDuration(sec); }, lvl => {
            if ((n++ % 3) === 0) { for (let i = 0; i < els.length - 1; i++) els[i].style.height = els[i + 1].style.height || '4px'; els[els.length - 1].style.height = Math.max(4, Math.round(4 + lvl * 28)) + 'px'; }
        });
    } catch (e) {
        recorder = null;
        toast(e && e.name === 'NotAllowedError' ? 'Нет доступа к микрофону: разрешите его в настройках браузера или приложения' : 'Не удалось включить микрофон');
        return;
    }
    panel.hidden = false; $('#rec-time').textContent = '0:00';
    btn.classList.add('is-on');
}
async function finishRecording(cancel) {
    if (!recorder) return;
    const r = recorder; recorder = null;
    $('#recorder').hidden = true; $('[data-attach="voice"]').classList.remove('is-on');
    const res = cancel ? await r.cancel() : await r.stop();
    if (!res) { if (!cancel) toast('Запись получилась пустой'); return; }
    const p = almatyParts();
    const name = 'Голосовая запись ' + p.d + ' ' + MONTHS_GEN[p.mo].slice(0, 3) + ' ' + pad2(p.h) + '-' + pad2(p.mi) + '.' + voiceExt(res.type);
    draft.files.push({ id: uid('f'), kind: 'voice', name, type: res.type, size: res.blob.size, dur: res.dur, blob: res.blob });
    renderDraft(); toast('Голосовая запись добавлена');
}

// ---------- Подключение событий ----------
function initIdeas() {
    const ta = $('#idea-text');
    ta.value = LS.get('draft', '') || '';
    ta.addEventListener('input', renderDraft);
    ta.addEventListener('keydown', e => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); saveIdea(); } });
    ta.addEventListener('paste', e => {
        const imgs = Array.from(e.clipboardData && e.clipboardData.files || []).filter(f => /^image\//.test(f.type));
        if (imgs.length) { e.preventDefault(); addFiles(imgs, 'image'); }
    });
    $('#idea-save').addEventListener('click', saveIdea);

    // вложения: кнопки
    const pick = { image: '#file-image', audio: '#file-audio', file: '#file-any' };
    $$('[data-attach]').forEach(b => b.addEventListener('click', () => {
        const k = b.dataset.attach;
        if (k === 'voice') toggleRecorder(); else { const inp = $(pick[k]); inp.value = ''; inp.click(); }
    }));
    // список файлов копируем и сбрасываем поле: иначе повторный выбор того же файла не вызовет событие «change»
    $$('#file-image,#file-audio,#file-any').forEach(inp => inp.addEventListener('change', () => { const picked = Array.from(inp.files || []); inp.value = ''; addFiles(picked, inp.id === 'file-image' ? 'image' : inp.id === 'file-audio' ? 'audio' : 'any'); }));
    $('#rec-stop').addEventListener('click', () => finishRecording(false));
    $('#rec-cancel').addEventListener('click', () => finishRecording(true));
    $('#btn-spotify').addEventListener('click', async () => { const t = await openSpotifyPicker(); if (t) { draft.track = t; renderDraft(); toast('Трек добавлен: ' + t.title); } });

    // перетаскивание файлов на блок
    const comp = $('#composer');
    ['dragenter', 'dragover'].forEach(ev => comp.addEventListener(ev, e => { if (e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files')) { e.preventDefault(); comp.style.outline = '3px dashed var(--md-primary)'; } }));
    ['dragleave', 'drop'].forEach(ev => comp.addEventListener(ev, () => { comp.style.outline = ''; }));
    comp.addEventListener('drop', e => { if (e.dataTransfer && e.dataTransfer.files.length) { e.preventDefault(); addFiles(e.dataTransfer.files, 'any'); } });

    // хештеги в блоке
    const addTag = () => { const inp = $('#idea-tag-input'); parseTagString(inp.value).forEach(t => { if (!draft.extraTags.includes(t)) draft.extraTags.push(t); }); inp.value = ''; renderDraft(); };
    $('#idea-tag-add').addEventListener('click', addTag);
    $('#idea-tag-input').addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addTag(); } });
    comp.addEventListener('click', e => {
        const rm = e.target.closest('[data-rm-tag]'), ad = e.target.closest('[data-add-tag]'), rf = e.target.closest('[data-rm-file]');
        if (rm) {
            const t = rm.dataset.rmTag;
            draft.extraTags = draft.extraTags.filter(x => x !== t);
            if (extractTags(ta.value).includes(t)) ta.value = ta.value.replace(new RegExp('(?<![\\p{L}\\p{N}_\\/&])#' + t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?![\\p{L}\\p{N}_])', 'giu'), '').replace(/[ \t]{2,}/g, ' ');
            renderDraft();
        } else if (ad) { const t = ad.dataset.addTag; if (!draft.extraTags.includes(t)) draft.extraTags.push(t); renderDraft(); }
        else if (rf) { dropDraftFile(rf.dataset.rmFile); renderDraft(); }
        else if (e.target.closest('[data-rm-track]')) { draft.track = null; renderDraft(); }
    });

    // поиск
    const si = $('#idea-search');
    si.addEventListener('input', debounce(() => { ideaQuery = si.value; ideasShown = 40; renderIdeas(); }, 120));
    $('#idea-search-clear').addEventListener('click', () => setQuery('', true));
    const di = $('#idea-date-input');
    di.addEventListener('click', () => { try { if (di.showPicker) di.showPicker(); } catch (e) {} });
    di.addEventListener('change', () => {
        if (!di.value) return;
        const toks = ideaQuery.split(/\s+/).filter(t => t && !/^\d{4}-\d{2}-\d{2}$/.test(t)); toks.push(di.value);
        setQuery(toks.join(' ')); di.value = '';
    });
    $('#tagbar').addEventListener('click', e => { const b = e.target.closest('[data-q-tag]'); if (b) toggleQueryToken('#' + b.dataset.qTag); });

    // список заметок
    $('#ideas-list').addEventListener('click', e => {
        const t = e.target;
        const tag = t.closest('[data-tag]'), edit = t.closest('[data-edit]'), del = t.closest('[data-del]'), lb = t.closest('[data-lb]'), fl = t.closest('[data-file]'), dt = t.closest('[data-date]');
        if (tag) { const tok = '#' + tag.dataset.tag; if (!queryTokens(ideaQuery).includes(tok)) setQuery((ideaQuery ? ideaQuery + ' ' : '') + tok); window.scrollTo({ top: 0, behavior: 'smooth' }); }
        else if (edit) editIdea(edit.dataset.edit);
        else if (del) deleteIdea(del.dataset.del);
        else if (lb) {
            const idea = ideas.find(i => i.id === lb.closest('.note').dataset.id);
            openLightbox((idea.files || []).filter(f => f.kind === 'image').map(f => f.id), +lb.dataset.lb);
        } else if (fl) { const idea = ideas.find(i => i.id === fl.closest('.note').dataset.id); const f = (idea.files || []).find(x => x.id === fl.dataset.file); openStoredFile(fl.dataset.file, f && f.name); }
        else if (dt) { setQuery(dt.dataset.date); window.scrollTo({ top: 0, behavior: 'smooth' }); }
        else if (t.closest('#ideas-more')) { ideasShown += 40; renderIdeas(); }
    });
    $('#ideas-pdf').addEventListener('click', openIdeasPdfSheet);

    // подпись «кто и когда» в блоке
    updateComposerMeta(); setInterval(updateComposerMeta, 20000);

    renderDraft(); renderIdeas();
}
