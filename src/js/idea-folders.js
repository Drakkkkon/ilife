'use strict';
// =====================================================================================================
// iLife 1.6.0 — «ИДЕИ»: ПАПКИ. Три режима: «По дате» (год → месяц → день), «По категориям» и «Лентой» (как раньше).
// Папки показываются крупными или мелкими плитками либо списком. Категории: дрэг, ии, книги, мемы, стендап, олдбук
// (список можно менять). ИИ проверяет каждую заметку и кладёт её в нужные категории; без ИИ работают простые правила по словам.
// В заметке: idea.cats — список категорий, idea.catSrc — 'ai' | 'user', idea.catAi — подпись списка категорий, по которому ИИ проверил.
// Поиск (js/ideas.js) ищет и по категориям; найденные заметки встают сразу под полем поиска.
// =====================================================================================================

const IDEA_CAT_DEFAULTS = [
    { n: 'дрэг', h: 'дрэг-культура: дрэг-квины и дрэг-шоу, образы, макияж, костюмы, выступления' },
    { n: 'ии', h: 'искусственный интеллект: нейросети, ChatGPT, Claude, Gemini, промпты, генерация текста и картинок' },
    { n: 'книги', h: 'книги и чтение: произведения, авторы, цитаты, рекомендации' },
    { n: 'мемы', h: 'мемы, приколы, шутки-картинки, вирусные ролики' },
    { n: 'стендап', h: 'стендап-комедия: комики, выступления, шутки и номера' },
    { n: 'олдбук', h: 'олдбук: старые книги и издания, олдскульная литература (уточните это описание под себя)' }
];
// Правила без ИИ: что считается принадлежностью к категории по словам (для своих категорий — само название в тексте или #хештег)
const IDEA_CAT_RULES = {
    'дрэг': /(?<![\p{L}])(?:дрэг|дрег|драг)|(?<![\p{L}])drag(?![\p{L}])|рупол|rupaul/u,
    'ии': /(?<![\p{L}])(?:ии|ai)(?![\p{L}])|нейросет|нейронн|искусственн\p{L}* интеллект|chatgpt|(?<![\p{L}])gpt|claude|gemini|midjourney|stable diffusion|промпт|(?<![\p{L}])llm|openai/u,
    'книги': /книг|читал|прочита|литератур|издани|библиотек|(?<![\p{L}])роман(?:ы|а|ов|ом)?(?![\p{L}])/u,
    'мемы': /(?<![\p{L}])мем|мемас|приколь?н|шитпост|(?<![\p{L}])meme/u,
    'стендап': /стенд-?ап|stand-?up|(?<![\p{L}])комик(?:ов|и|а|у|е|ом)?(?![\p{L}])|камеди|open ?mic|опенмик/u,
    'олдбук': /олд-?бук|old-?book|букинист|антикварн\p{L}* книг|старая книга|старые книги/u
};
const IDEA_NONE = '~';   // «Без категории»: ключ папки

function ideaCatsLoad() {
    const v = LS.get('idea_cats', null);
    const ok = Array.isArray(v) ? v.filter(c => c && c.n && String(c.n).trim()).map(c => ({ n: String(c.n).trim().slice(0, 30), h: String(c.h || '').slice(0, 240) })) : [];
    return ok.length ? ok : IDEA_CAT_DEFAULTS.map(c => Object.assign({}, c));
}
let ideaCats = ideaCatsLoad();
let ideaCatsVer = 1;                                   // растёт при любой смене списка категорий: сбрасывает кеш поиска и расчётов
const ideaCatMemo = new Map();
const ideaUi = Object.assign({ mode: 'date', view: 'large', auto: false }, LS.get('ideas_ui', {}));
function ideaUiSave() { LS.set('ideas_ui', ideaUi); }
let ideaPath = [];                                     // текущая папка: ['2026','11','06'] (дата) или ['книги'] (категория)
let ideaAiBusy = false;

function ideaCatNames() { return ideaCats.map(c => c.n); }
function ideaCatsPublic() { return ideaCats.map(c => ({ n: c.n, h: c.h })); }   // для общего файла на Google Диске
function ideaCatSig() { return tgHashSafe(ideaCats.map(c => normText(c.n)).sort().join('|')); }
function tgHashSafe(s) { let h = 5381; s = String(s || ''); for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return (h >>> 0).toString(36); }
function ideaCatsChanged() {
    ideaCatsVer++; ideaCatMemo.clear(); if (typeof IX !== 'undefined') IX.clear();
}
function ideaCatsSave() {
    LS.set('idea_cats', ideaCats); ideaCatsChanged();
    if (typeof cloudLocalChanged === 'function') cloudLocalChanged();
}
// Список категорий пришёл с другого устройства (Google Диск)
function ideaCatsApply(list) {
    if (!Array.isArray(list)) return false;
    const ok = list.filter(c => c && c.n && String(c.n).trim()).map(c => ({ n: String(c.n).trim().slice(0, 30), h: String(c.h || '').slice(0, 240) }));
    if (!ok.length || JSON.stringify(ok) === JSON.stringify(ideaCats)) return false;
    ideaCats = ok; LS.set('idea_cats', ideaCats); ideaCatsChanged();
    return true;
}

// ---------- Категории заметки ----------
function ideaRuleCats(idea) {
    const text = normText((idea.text || '') + ' ' + (idea.tags || []).map(t => '#' + t).join(' ') + ' ' + (idea.files || []).map(f => f.name).join(' '));
    const tags = new Set((idea.tags || []).map(normText)), out = [];
    ideaCats.forEach(c => {
        const key = normText(c.n); let hit = tags.has(key);
        if (!hit) {
            const re = IDEA_CAT_RULES[key];
            hit = re ? re.test(text) : (key.length >= 3 && text.includes(key));
        }
        if (hit) out.push(c.n);
    });
    return out;
}
function ideaCatsOf(idea) {
    const mk = idea.id + '|' + (idea.updatedAt || idea.createdAt) + '|' + ideaCatsVer;
    let r = ideaCatMemo.get(mk);
    if (r) return r;
    if (Array.isArray(idea.cats)) {
        const canon = new Map(ideaCats.map(c => [normText(c.n), c.n]));
        r = Array.from(new Set(idea.cats.map(c => canon.get(normText(c))).filter(Boolean)));
    } else r = ideaRuleCats(idea);
    ideaCatMemo.set(mk, r);
    return r;
}
function ideaNeedsAi(idea) {
    if (idea.catSrc === 'user') return false;
    if (!String(idea.text || '').trim() && !(idea.tags || []).length) return false;   // нечего читать (только вложения)
    return idea.catAi !== ideaCatSig();
}

// ---------- ИИ: раскладка заметок по категориям ----------
function ideaAiParse(raw) {
    const t = String(raw || '').replace(/```(?:json)?/gi, '').trim();
    let j = null;
    for (const s of [t, t.slice(t.indexOf('{'), t.lastIndexOf('}') + 1), t.slice(t.indexOf('['), t.lastIndexOf(']') + 1)]) {
        if (!s) continue; try { j = JSON.parse(s); break; } catch (e) { /* пробуем следующий вариант */ }
    }
    const arr = Array.isArray(j) ? j : j && (j.items || j.notes || j.result || []);
    return Array.isArray(arr) ? arr : [];
}
async function ideaAiBatch(chunk) {
    const lines = ideaCats.map(c => '- ' + c.n + (c.h ? ': ' + c.h : ''));
    const notes = chunk.map((idea, i) => {
        const tx = String(idea.text || '').replace(/\s+/g, ' ').trim().slice(0, 600);
        const tg = (idea.tags || []).length && !/#/.test(tx) ? ' ' + idea.tags.map(t => '#' + t).join(' ') : '';
        const fl = (idea.files || []).length ? ' [вложений: ' + idea.files.length + ']' : '';
        return '[' + i + '] ' + tx + tg + fl;
    });
    const text = 'Ты раскладываешь короткие личные заметки (на русском, с хештегами, ссылками и опечатками) по категориям.\n' +
        'Категории — используй ТОЛЬКО эти названия, дословно:\n' + lines.join('\n') + '\n\n' +
        'Для каждой заметки выбери от 0 до 3 подходящих категорий по смыслу (а не только по словам). Если ни одна не подходит — верни пустой список. Не выдумывай новых категорий.\n' +
        'Ответ — только JSON без пояснений: {"items":[{"i":0,"c":["название"]},{"i":1,"c":[]}]}, где i — номер заметки в квадратных скобках.\n\nЗаметки:\n' + notes.join('\n');
    const res = ideaAiParse(await mvAskAiText({ text, maxTokens: 1800 }));
    const canon = new Map(ideaCats.map(c => [normText(c.n), c.n])), out = new Map();
    res.forEach(r => {
        if (!r || typeof r !== 'object') return;
        const i = Number(r.i); if (!Number.isInteger(i) || i < 0 || i >= chunk.length) return;
        const list = Array.isArray(r.c) ? r.c : (typeof r.c === 'string' ? [r.c] : []);
        out.set(i, Array.from(new Set(list.map(x => canon.get(normText(String(x).replace(/^#/, '').trim()))).filter(Boolean))).slice(0, 3));
    });
    return out;
}
// list — заметки, которые нужно проверить. opts.silent — без окна (для новых заметок). Возвращает { done, failed, stopped, error }
async function ideaAiRun(list, opts) {
    opts = opts || {};
    const res = { done: 0, failed: 0, stopped: false, error: '' };
    if (ideaAiBusy || !list.length) return res;
    if (typeof mvHasAi !== 'function' || !mvHasAi()) { res.error = 'ИИ не подключён'; return res; }
    ideaAiBusy = true; renderIdeaBrowser();
    const prog = !opts.silent && typeof galProgressSheet === 'function' ? galProgressSheet('ИИ раскладывает заметки') : null;
    const BATCH = 12; let bad = 0;
    try {
        for (let i = 0; i < list.length; i += BATCH) {
            if (prog && prog.ctl.stop) { res.stopped = true; break; }
            if (prog) prog.set('Проверено ' + res.done + ' из ' + list.length, res.done / list.length);
            const chunk = list.slice(i, i + BATCH);
            let out;
            try { out = await ideaAiBatch(chunk); bad = 0; }
            catch (e) {
                res.failed += chunk.length; res.error = e && e.message ? e.message : String(e);
                if (e && e.code === 'nokey') break;
                if (++bad >= 2) break;
                continue;
            }
            const sig = ideaCatSig(), now = Date.now(); let n = 0;
            chunk.forEach((idea, k) => {
                if (!out.has(k)) { res.failed++; return; }   // ИИ пропустил заметку — она останется непроверенной и попадёт в следующий разбор
                if (idea.catSrc === 'user') return;          // пока шёл запрос, категории поправили вручную
                idea.cats = out.get(k); idea.catSrc = 'ai'; idea.catAi = sig; idea.updatedAt = now; n++;
            });
            res.done += chunk.length;
            if (n) { saveIdeas(); ideaCatMemo.clear(); if (typeof IX !== 'undefined') IX.clear(); renderIdeas(); }
        }
    } finally {
        ideaAiBusy = false; if (prog) prog.close(); renderIdeaBrowser();
    }
    return res;
}
function ideaAiPending() { return ideas.filter(ideaNeedsAi); }

// Кнопка «ИИ-разбор»: предупреждаем, что тексты заметок уходят в ИИ-службу
async function ideaAiManual() {
    if (ideaAiBusy) { toast('ИИ уже работает — подождите'); return; }
    if (!mvHasAi()) { toast('Сначала подключите ИИ: Настройки → «Кино: базы и оценки»', { ms: 5000 }); return; }
    const list = ideaAiPending();
    if (!list.length) { toast('Все заметки уже проверены'); return; }
    const batches = Math.ceil(list.length / 12), name = MV_AI_NAMES[mvCfg().ai] || 'ИИ';
    let auto = ideaUi.auto || !ideaUi.autoAsked;
    const sheet = openSheet({
        title: 'ИИ-разбор заметок',
        html: '<p class="hint" style="font-size:15px;color:var(--md-on-surface);margin:0 0 0.5rem">ИИ прочитает <b>' + list.length + '</b> заметок и разложит их по категориям: ' + esc(ideaCatNames().join(', ')) + '. Это ' + batches + ' запрос(ов) к ' + esc(name) + '.</p>' +
            '<p class="hint" style="margin:0 0 0.75rem">Тексты и хештеги заметок (без вложений) отправляются в вашу ИИ-службу по вашему ключу. Результат сохраняется в заметках и синхронизируется. Заметки, где категории вы поправили вручную, ИИ не трогает.</p>' +
            '<label class="switch-row"><span class="tx"><b>Раскладывать новые заметки автоматически</b><span class="sub">Сразу после сохранения идеи или импорта из Telegram. Можно выключить в «Категории»</span></span><input type="checkbox" class="switch" id="if-auto-ask"' + (auto ? ' checked' : '') + '></label>',
        actions: [{ label: 'Отмена' }, { label: 'Начать', kind: 'primary', icon: 'auto_awesome', async onClick(api) {
            ideaUi.auto = $('#if-auto-ask', api.el).checked; ideaUi.autoAsked = true; ideaUiSave();
            setTimeout(async () => {
                const r = await ideaAiRun(list, {});
                if (r.error && !r.done) toast('ИИ не справился: ' + r.error, { ms: 7000 });
                else toast('Разложено заметок: ' + r.done + (r.failed ? ' · не вышло: ' + r.failed : '') + (r.stopped ? ' · остановлено' : ''), { ms: 6000 });
            }, 60);
        } }]
    });
    return sheet;
}
// Новые заметки (сохранены вручную или из Telegram) — тихо, если включено
const ideaAutoSoon = debounce(async function () {
    if (!ideaUi.auto || ideaAiBusy || typeof mvHasAi !== 'function' || !mvHasAi()) return;
    const list = ideaAiPending();
    if (!list.length || list.length > 30) return;   // много — пусть запустят вручную: так видно, сколько запросов уйдёт
    try { const r = await ideaAiRun(list, { silent: true }); if (r.error && !r.done) console.warn('ИИ-разбор новых заметок:', r.error); } catch (e) { console.warn(e); }
}, 2500);

// ---------- Окно «Категории» ----------
function ideaCatsSheet() {
    const rows = ideaCats.map(c => ({ old: c.n, n: c.n, h: c.h }));
    const paint = () => {
        box.innerHTML = rows.map((r, i) => '<div class="if-catrow" data-r="' + i + '"><div class="if-catrow-head"><input type="text" data-f="n" maxlength="30" value="' + esc(r.n) + '" placeholder="Название категории" aria-label="Название категории">' +
            '<button type="button" class="icon-btn is-danger" data-del="' + i + '" aria-label="Удалить категорию">' + ic('delete') + '</button></div>' +
            '<input type="text" data-f="h" maxlength="240" value="' + esc(r.h) + '" placeholder="О чём эта категория (подсказка для ИИ)" aria-label="Описание категории"></div>').join('') || '<p class="hint">Категорий нет — добавьте хотя бы одну.</p>';
    };
    const html = '<p class="hint" style="margin:0 0 0.75rem">Каждая категория — отдельная папка в режиме «По категориям». Описание помогает ИИ понять, что туда класть. Заметка может лежать в нескольких папках.</p>' +
        '<div id="if-cat-rows"></div><div class="btn-group" style="margin:0.5rem 0 0.75rem"><button type="button" class="btn" id="if-cat-add">' + ic('add') + 'Добавить категорию</button></div>' +
        '<label class="switch-row"><span class="tx"><b>ИИ раскладывает новые заметки сам</b><span class="sub">После сохранения идеи и импорта из Telegram (нужен подключённый ИИ)</span></span><input type="checkbox" class="switch" id="if-auto"' + (ideaUi.auto ? ' checked' : '') + '></label>' +
        '<div class="btn-group" style="margin-top:0.5rem"><button type="button" class="btn" id="if-recheck">' + ic('refresh') + 'Перепроверить все заметки</button></div>' +
        '<p class="hint" style="margin:0.5rem 0 0">«Перепроверить» снимает отметку «проверено ИИ» со всех заметок, кроме тех, где вы выбрали категории сами; после этого нажмите «ИИ-разбор». Нужно, когда добавлена новая категория.</p>';
    const sheet = openSheet({
        title: 'Категории', html,
        actions: [{ label: 'Отмена' }, { label: 'Сохранить', kind: 'primary', icon: 'check', onClick(api) {
            const clean = rows.map(r => ({ old: r.old, n: r.n.replace(/^#/, '').trim().slice(0, 30), h: r.h.trim() })).filter(r => r.n);
            if (!clean.length) { toast('Нужна хотя бы одна категория'); return false; }
            const seen = new Set();
            for (const r of clean) { const k = normText(r.n); if (seen.has(k)) { toast('Названия категорий не должны повторяться: «' + r.n + '»'); return false; } seen.add(k); }
            const rename = new Map(), added = clean.some(r => !r.old);
            clean.forEach(r => { if (r.old && r.old !== r.n) rename.set(normText(r.old), r.n); });
            const oldSig = ideaCatSig();
            let changed = 0; const now = Date.now();
            ideaCats = clean.map(r => ({ n: r.n, h: r.h }));
            const newSig = ideaCatSig();
            ideas.forEach(i => {
                let ch = false;
                if (Array.isArray(i.cats) && i.cats.length) {   // переименованные категории переезжают в заметках, удалённые убираются
                    const next = Array.from(new Set(i.cats.map(c => rename.get(normText(c)) || c).filter(c => seen.has(normText(c)))));
                    if (JSON.stringify(next) !== JSON.stringify(i.cats)) { i.cats = next; ch = true; }
                }
                if (!added && i.catAi === oldSig && oldSig !== newSig) { i.catAi = newSig; ch = true; }   // только переименование/удаление — перепроверять не нужно
                if (ch) { i.updatedAt = now; changed++; }
            });
            ideaUi.auto = $('#if-auto', api.el).checked; ideaUiSave();
            if (changed) saveIdeas();
            ideaCatsSave(); ideaPath = []; renderIdeas();
            toast('Категории сохранены' + (added ? '. Нажмите «ИИ-разбор», чтобы ИИ пересмотрел заметки с учётом новой категории' : ''), { ms: 6000 });
        } }]
    });
    const box = $('#if-cat-rows', sheet.el);
    paint();
    box.addEventListener('input', e => { const row = e.target.closest('[data-r]'); if (!row) return; rows[+row.dataset.r][e.target.dataset.f] = e.target.value; });
    box.addEventListener('click', e => { const d = e.target.closest('[data-del]'); if (d) { rows.splice(+d.dataset.del, 1); paint(); } });
    $('#if-cat-add', sheet.el).addEventListener('click', () => { rows.push({ old: '', n: '', h: '' }); paint(); const inp = box.querySelector('[data-r]:last-child input'); if (inp) inp.focus(); });
    $('#if-recheck', sheet.el).addEventListener('click', () => {
        let n = 0; ideas.forEach(i => { if (i.catSrc !== 'user' && i.catAi) { delete i.catAi; n++; } });
        if (n) saveIdeas(); renderIdeaBrowser();
        toast(n ? 'Снята отметка у ' + n + ' заметок — нажмите «ИИ-разбор»' : 'Перепроверять нечего');
    });
    return sheet;
}

// ---------- Папки ----------
function ideaPl(n, one, few, many) { const m = n % 100, d = n % 10; return n + ' ' + (m >= 11 && m <= 14 ? many : d === 1 ? one : d >= 2 && d <= 4 ? few : many); }
function ideaNotesWord(n) { return ideaPl(n, 'заметка', 'заметки', 'заметок'); }
const ideaByNewest = (a, b) => (Number(b.createdAt) || 0) - (Number(a.createdAt) || 0);
const ideaDay = i => dayKey(Number(i.createdAt) || 0);   // день создания (время Алматы)
function ideaSnippet(idea) {
    const t = String(idea.text || '').replace(/#[\p{L}\p{N}_]+/gu, '').replace(/\s+/g, ' ').trim();
    return t ? t.slice(0, 90) : ((idea.files || []).length ? 'вложения: ' + idea.files.length : idea.track ? idea.track.title : '');
}
function ideaDayLabel(key) {
    const ms = keyToMs(key); if (isNaN(ms)) return key;
    const p = almatyParts(ms); return p.d + ' ' + MONTHS_GEN[p.mo] + ', ' + WEEKDAYS[p.wd];
}
const ideaCap = s => s.charAt(0).toUpperCase() + s.slice(1);
// Что показываем в текущей папке: { folders: [{key,name,sub,count,icon,snip}], notes: [..] | null, crumbs: [{label,path}] }
function ideaScope() {
    const path = ideaPath, sorted = ideas.slice().sort(ideaByNewest);
    const mode = ideaUi.mode;
    if (mode === 'date') {
        const crumbs = [{ label: 'По дате', path: [] }];
        if (path[0]) crumbs.push({ label: path[0], path: [path[0]] });
        if (path[1]) crumbs.push({ label: ideaCap(MONTHS_NOM[(+path[1]) - 1] || path[1]), path: [path[0], path[1]] });
        if (path[2]) crumbs.push({ label: ideaDayLabel(path.join('-')), path: path.slice(0, 3) });
        const prefix = path.join('-'), inScope = sorted.filter(i => { const k = ideaDay(i); return !prefix || k === prefix || k.startsWith(prefix + '-'); });
        if (path.length >= 3) return { folders: [], notes: inScope, crumbs };
        const groups = new Map();
        inScope.forEach(i => { const k = ideaDay(i), part = k.split('-')[path.length]; let g = groups.get(part); if (!g) groups.set(part, g = { count: 0, first: i, months: new Set() }); g.count++; if (path.length === 0) g.months.add(k.slice(5, 7)); });
        const folders = Array.from(groups.entries()).sort((a, b) => b[0].localeCompare(a[0])).map(([part, g]) => ({
            key: part, count: g.count, snip: ideaSnippet(g.first), icon: 'folder',
            name: path.length === 0 ? part : path.length === 1 ? ideaCap(MONTHS_NOM[(+part) - 1] || part) : ideaDayLabel(path.join('-') + '-' + part),
            sub: path.length === 0 ? ideaPl(g.months.size, 'месяц', 'месяца', 'месяцев') : ''
        }));
        return { folders, notes: null, crumbs };
    }
    // по категориям
    if (path.length && path[0] !== IDEA_NONE && !ideaCats.some(c => normText(c.n) === normText(path[0]))) { ideaPath = []; path.length = 0; }   // категории больше нет (удалена или переименована на другом устройстве)
    const crumbs = [{ label: 'По категориям', path: [] }];
    if (path.length) crumbs.push({ label: path[0] === IDEA_NONE ? 'Без категории' : path[0], path: [path[0]] });
    if (path.length) {
        const notes = sorted.filter(i => { const c = ideaCatsOf(i); return path[0] === IDEA_NONE ? !c.length : c.some(x => normText(x) === normText(path[0])); });
        return { folders: [], notes, crumbs };
    }
    const folders = ideaCats.map(c => {
        const list = sorted.filter(i => ideaCatsOf(i).some(x => normText(x) === normText(c.n)));
        return { key: c.n, name: c.n, count: list.length, snip: list[0] ? ideaSnippet(list[0]) : 'пока пусто', icon: 'folder', sub: '' };
    });
    const none = sorted.filter(i => !ideaCatsOf(i).length);
    if (none.length) folders.push({ key: IDEA_NONE, name: 'Без категории', count: none.length, snip: ideaSnippet(none[0]), icon: 'folder_open', sub: '' });
    return { folders, notes: null, crumbs };
}
function ideaFolderHtml(f, i) {
    return '<button type="button" class="if-tile" data-fi="' + i + '"><span class="if-ico">' + ic(f.icon) + '</span><span class="if-tx"><span class="if-name">' + esc(f.name) + '</span>' +
        '<span class="if-sub">' + ideaNotesWord(f.count) + (f.sub ? ' · ' + esc(f.sub) : '') + '</span>' +
        (f.snip ? '<span class="if-snip">' + esc(f.snip) + '</span>' : '') + '</span>' + ic('chevron_right', 'if-go') + '</button>';
}
function ideaNavigate(path) { ideaPath = path; ideasShown = 40; renderIdeaBrowser(); }
// «Открыть категорию» из карточки заметки
function ideaOpenCat(name) {
    if (ideaQuery) { ideaQuery = ''; const si = $('#idea-search'); if (si) si.value = ''; }
    ideaUi.mode = 'cat'; ideaUiSave(); ideaPath = [name]; ideasShown = 40; renderIdeas();
    const el = $('#if-bar'); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// Рисует панель, путь, плитки папок и заметки внутри папки. Вызывается из renderIdeas() (js/ideas.js), когда поиска нет.
function renderIdeaBrowser() {
    const bar = $('#if-bar'); if (!bar) return;
    const total = ideas.length, foldersEl = $('#ideas-folders'), crumbsEl = $('#if-crumbs'), list = $('#ideas-list');
    bar.hidden = !total; crumbsEl.hidden = true; foldersEl.innerHTML = ''; foldersEl.className = '';
    if (!total) { paintNotes(list, [], true); return; }
    const mode = ideaUi.mode;
    $$('#if-mode [data-m]').forEach(b => { const on = b.dataset.m === mode; b.classList.toggle('is-on', on); b.setAttribute('aria-pressed', on); });
    $$('#if-view [data-v]').forEach(b => { const on = b.dataset.v === ideaUi.view; b.classList.toggle('is-on', on); b.setAttribute('aria-pressed', on); });
    const acts = $('#if-acts');
    if (mode === 'all') {
        $('#if-view').hidden = true; acts.innerHTML = '';
        ideaPath = [];
        paintNotes(list, ideas.slice().sort(ideaByNewest));
        return;
    }
    const sc = ideaScope();
    // путь
    crumbsEl.hidden = false;
    crumbsEl.innerHTML = (ideaPath.length ? '<button type="button" class="icon-btn gal-back" data-crumb="' + (ideaPath.length - 1) + '" aria-label="Назад">' + ic('arrow_back') + '</button>' : '') +
        '<div class="gal-trail">' + sc.crumbs.map((c, i) => (i ? ic('chevron_right') : '') + '<button type="button" class="gal-crumb' + (i === sc.crumbs.length - 1 ? ' is-last' : '') + '" data-crumb="' + i + '">' + (i === 0 ? ic(mode === 'date' ? 'calendar_month' : 'folder') : '') + esc(c.label) + '</button>').join('') + '</div>';
    // кнопки
    const b = [];
    if (mode === 'cat') {
        const todo = ideaAiPending().length, has = typeof mvHasAi === 'function' && mvHasAi();
        if (!ideaPath.length) {
            if (has && todo) b.push('<button type="button" class="btn btn-primary" data-act="ai"' + (ideaAiBusy ? ' disabled' : '') + '>' + ic('auto_awesome') + 'ИИ-разбор (' + todo + ')</button>');
            b.push('<button type="button" class="btn" data-act="cats">' + ic('tune') + 'Категории</button>');
        }
    }
    acts.innerHTML = b.join('');
    // плитки папок
    $('#if-view').hidden = !sc.folders.length;
    if (sc.folders.length) {
        foldersEl.className = 'if-grid if-v-' + ideaUi.view;
        foldersEl.innerHTML = sc.folders.map(ideaFolderHtml).join('');
        foldersEl.__folders = sc.folders;
    }
    const hint = mode === 'cat' && !ideaPath.length ? (typeof mvHasAi === 'function' && mvHasAi()
        ? (ideaAiPending().length ? 'Заметок, которые ИИ ещё не проверил: ' + ideaAiPending().length + '. Пока они лежат по простым правилам (по словам).' : 'ИИ проверил все заметки.')
        : 'ИИ не подключён — заметки раскладываются по простым правилам (по словам и #хештегам). Подключите ИИ в Настройки → «Кино: базы и оценки», чтобы он читал каждую заметку.') : '';
    const hintEl = $('#if-hint'); if (hintEl) { hintEl.textContent = hint; hintEl.hidden = !hint; }
    if (sc.notes) paintNotes(list, sc.notes);
    else list.innerHTML = '';
}
function initIdeaFolders() {
    const bar = $('#if-bar'); if (!bar) return;
    $('#if-mode').addEventListener('click', e => {
        const b = e.target.closest('[data-m]'); if (!b || b.dataset.m === ideaUi.mode) return;
        ideaUi.mode = b.dataset.m; ideaUiSave(); ideaPath = []; ideasShown = 40; renderIdeaBrowser();
    });
    $('#if-view').addEventListener('click', e => { const b = e.target.closest('[data-v]'); if (!b) return; ideaUi.view = b.dataset.v; ideaUiSave(); renderIdeaBrowser(); });
    $('#if-crumbs').addEventListener('click', e => {
        const b = e.target.closest('[data-crumb]'); if (!b) return;
        const n = +b.dataset.crumb; ideaNavigate(ideaPath.slice(0, Math.min(n, ideaPath.length)));
    });
    $('#ideas-folders').addEventListener('click', e => {
        const t = e.target.closest('[data-fi]'); if (!t) return;
        const f = ($('#ideas-folders').__folders || [])[+t.dataset.fi]; if (!f) return;
        ideaNavigate(ideaPath.concat(f.key));
        const el = $('#if-bar'); if (el && el.getBoundingClientRect().top < 0) el.scrollIntoView({ block: 'start' });
    });
    $('#if-acts').addEventListener('click', e => {
        const b = e.target.closest('[data-act]'); if (!b) return;
        if (b.dataset.act === 'ai') ideaAiManual(); else if (b.dataset.act === 'cats') ideaCatsSheet();
    });
}
