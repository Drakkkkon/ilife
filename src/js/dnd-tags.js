'use strict';
// =====================================================================================================
// iLife 2.1.0 — «ДНД»: ХЕШТЕГИ И ИМЕНА.
// Сайт сам находит в тексте карточек и блоков сюжета:
//   • имена героев со страницы «Персонажи» (с падежами: «Гримбран» → «Гримбрана», «Гримбрану», «Гримбраном»);
//   • места: названия карточек вида «Локация», блоков сюжета вида «Локация» и зданий из «Вижуала»;
//   • сюжетные повороты: предательство, засада, тайна, погоня, ловушка, пророчество и другие по ключевым словам;
// и предлагает хештеги нажатием («#Гримбран», «#Таверна», «#засада»). Цвет хештега показывает, что это:
// фиолетовый — герой, бирюзовый — место, оранжевый — поворот. По тем же именам собирается колода героев на блоке сюжета.
// Хештеги по-прежнему лежат в it.tags[] (строки без «#»); ничего нового в данные игры не добавляется.
// =====================================================================================================

const DND_TAG_KINDS = { char: { n: 'Герои', c: '#7c4dff' }, loc: { n: 'Места', c: '#00897b' }, twist: { n: 'Повороты сюжета', c: '#e65100' }, free: { n: 'Свои', c: '#6750a4' } };

// Повороты: тег и начала слов, по которым он находится (проверяется с начала слова, ё = е)
const DND_TWISTS = [
    { tag: 'предательство', w: ['предат', 'предал', 'измен', 'двурушн', 'вероломн'] },
    { tag: 'засада', w: ['засад', 'подстерег', 'внезапное нападени'] },
    { tag: 'тайна', w: ['тайн', 'секрет', 'утаи', 'загадочн', 'скрывает', 'скрывал'] },
    { tag: 'раскрытие', w: ['раскры', 'выясня', 'оказывает', 'оказалос', 'на самом деле', 'разоблач'] },
    { tag: 'смерть', w: ['смерт', 'погиб', 'убит', 'убива', 'гибел', 'умирает', 'умер '] },
    { tag: 'возвращение', w: ['воскрес', 'возвращает', 'вернул'] },
    { tag: 'погоня', w: ['погон', 'преследова', 'бегств', 'сбега', 'сбежа'] },
    { tag: 'ловушка', w: ['ловушк', 'капкан', 'западн'] },
    { tag: 'пророчество', w: ['пророч', 'предсказан', 'предвещ'] },
    { tag: 'проклятие', w: ['проклят', 'проклин', 'порча'] },
    { tag: 'внезапный_поворот', w: ['внезапн', 'неожиданн', 'вдруг '] },
    { tag: 'выбор', w: ['развилк', 'дилемм', 'на выбор', 'должны выбрать', 'нужно выбрать'] },
    { tag: 'смена_сторон', w: ['перебеж', 'переходит на сторону', 'переметну'] },
    { tag: 'похищение', w: ['похити', 'похищен', 'заложник', 'в плен', 'захвачен'] },
    { tag: 'битва', w: ['битв', 'сражен', 'схватк', 'бой '] }
];
DND_TWISTS.forEach(t => { t.kind = 'twist'; t.name = t.tag.replace(/_/g, ' '); });

const dndTiCache = new WeakMap();
const dndWordRe = /[\p{L}\p{N}]+/gu;
// «Торин Дубощит» → «ТоринДубощит»; «таверна у моста» → «ТавернаУМоста»
function dndTagFromName(name) { return String(name || '').trim().split(/[^\p{L}\p{N}]+/u).filter(Boolean).map(w => w.charAt(0).toLocaleUpperCase('ru-RU') + w.slice(1)).join(''); }
function dndTagNorm(t) { return normText(String(t || '').replace(/^#+/, '')).replace(/[^\p{L}\p{N}]+/gu, ''); }

// Основы слов для поиска по падежам: у слов длиннее трёх букв отбрасывается гласная/«й»/«ь» на конце, а совпадением считается слово,
// которое начинается с основы и длиннее её не более чем на три буквы. Короткие имена (до трёх букв) ищутся только целиком.
function dndNameStems(name) {
    return normText(name).split(/[^\p{L}\p{N}]+/u).filter(t => t.length >= 3).map(t => {
        if (t.length <= 3) return { s: t, exact: true };
        let s = t;
        if (/[аяуюеыиоьй]$/.test(s)) s = s.slice(0, -1);
        return { s, exact: false };
    });
}
// text → Map(id → сколько раз встретилось). entries: [{ id, stems, mode: 'any' | 'all' }]
function dndFindNames(text, entries) {
    const toks = normText(text).match(dndWordRe) || [], hit = new Map(), per = new Map();
    for (const tk of toks) {
        let best = 0, ids = [];
        for (const e of entries) for (let i = 0; i < e.stems.length; i++) {
            const st = e.stems[i];
            const ok = st.exact ? tk === st.s : (tk.startsWith(st.s) && tk.length <= st.s.length + 3);
            if (!ok) continue;
            const L = st.s.length;
            if (L > best) { best = L; ids = [[e, i]]; } else if (L === best && !ids.some(x => x[0] === e)) ids.push([e, i]);
        }
        ids.forEach(([e, i]) => { hit.set(e.id, (hit.get(e.id) || 0) + 1); if (!per.has(e.id)) per.set(e.id, new Set()); per.get(e.id).add(i); });
    }
    const out = new Map();
    entries.forEach(e => {
        if (!hit.has(e.id)) return;
        if (e.mode === 'all') { const need = e.stems.filter(s => s.s.length >= 4).length || e.stems.length; if ((per.get(e.id) || new Set()).size < Math.min(need, e.stems.length)) return; }
        out.set(e.id, hit.get(e.id));
    });
    return out;
}

// Справочник игры: герои, места, повороты. Хранится в кеше и сбрасывается при любом изменении игры (dndTouch).
function dndTagIndex(game) {
    if (!game) return { chars: [], places: [], twists: DND_TWISTS, byTag: new Map() };
    const hit = dndTiCache.get(game); if (hit) return hit;
    const chars = (game.chars || []).filter(c => (c.name || '').trim()).map(c => ({ id: c.id, name: c.name.trim(), tag: dndTagFromName(c.name), stems: dndNameStems(c.name), mode: 'any', kind: 'char' }));
    const places = [], seen = new Set();
    const addPlace = (name, src) => {
        name = String(name || '').trim(); const k = dndTagNorm(name); if (!k || seen.has(k)) return; seen.add(k);
        places.push({ id: 'loc:' + k, name, tag: dndTagFromName(name), stems: dndNameStems(name), mode: 'all', kind: 'loc', src });
    };
    ((game.board && game.board.items) || []).forEach(i => { if (i.t === 'card' && i.kind === 'loc') addPlace(i.title, i.id); });
    ((game.plot && game.plot.items) || []).forEach(i => { if (i.t === 'block' && i.kind === 'loc') addPlace(i.title, i.id); });
    ((game.city && game.city.items) || []).forEach(i => { if (i.t === 'b' && i.name) addPlace(i.name, i.id); });
    const byTag = new Map();
    chars.forEach(c => { const k = dndTagNorm(c.tag); if (k && !byTag.has(k)) byTag.set(k, 'char'); });
    places.forEach(p => { const k = dndTagNorm(p.tag); if (k && !byTag.has(k)) byTag.set(k, 'loc'); });
    DND_TWISTS.forEach(t => { const k = dndTagNorm(t.tag); if (!byTag.has(k)) byTag.set(k, 'twist'); });
    const idx = { chars, places, twists: DND_TWISTS, byTag };
    dndTiCache.set(game, idx); return idx;
}
function dndTagReset(game) { if (game) dndTiCache.delete(game); }
function dndTagKind(game, tag) { return dndTagIndex(game).byTag.get(dndTagNorm(tag)) || 'free'; }

function dndTwistHits(text) {
    const s = ' ' + normText(text).replace(/[^\p{L}\p{N}]+/gu, ' ') + ' ';   // слова через один пробел: ищем с начала слова (пробел в конце ключа — слово целиком)
    return DND_TWISTS.filter(t => t.w.some(w => s.includes(' ' + w)));
}
// Что найдено в тексте: [{ tag, kind, name }]
function dndDetectTags(game, text) {
    const idx = dndTagIndex(game), out = [], used = new Set();
    const add = (tag, kind, name) => { const k = dndTagNorm(tag); if (!k || used.has(k)) return; used.add(k); out.push({ tag, kind, name: name || tag }); };
    const ch = dndFindNames(text, idx.chars); idx.chars.forEach(c => { if (ch.has(c.id)) add(c.tag, 'char', c.name); });
    const pl = dndFindNames(text, idx.places); idx.places.forEach(p => { if (pl.has(p.id)) add(p.tag, 'loc', p.name); });
    dndTwistHits(text).forEach(t => add(t.tag, 'twist', t.name));
    (String(text || '').match(/#[\p{L}\p{N}_]+/gu) || []).forEach(h => { const t = h.slice(1); add(t, idx.byTag.get(dndTagNorm(t)) || 'free', t); });
    return out;
}
// Какие герои упомянуты в тексте (id)
function dndDetectChars(game, text) { return Array.from(dndFindNames(text, dndTagIndex(game).chars).keys()); }

// Текст блока сюжета для поиска имён (без заметок ведущего: они не должны выдавать героя в колоде)
function dndBlockText(it) { return [it.title, it.text, it.desc].concat((it.intro || []).map(x => (x.title || '') + ' ' + (x.text || ''))).join('\n'); }
// Герои колоды блока: выбранные вручную + упомянутые в тексте (если включено) − убранные вручную
function dndBlockChars(game, it) {
    if (!game) return [];
    const set = new Set(it.chars || []);
    if (dndCfg.autoDeck !== false) dndDetectChars(game, dndBlockText(it)).forEach(id => set.add(id));
    (it.noChars || []).forEach(id => set.delete(id));
    return (game.chars || []).filter(c => set.has(c.id));
}

function dndTagsParse(s) { return String(s || '').split(/[,;\n]+|\s+(?=#)/).map(t => t.trim().replace(/^#+/, '').trim()).filter(Boolean).slice(0, 16); }

// ---------- Панель хештегов в окнах правки ----------
// o: { game, input (поле «через запятую»), getText() → строка для поиска, watch: [элементы, за которыми следим] }
function dndTagPanel(host, o) {
    const g = o.game, input = o.input;
    const cur = () => dndTagsParse(input.value);
    const seen = new Set(cur().map(dndTagNorm));
    dndDetectTags(g, o.getText()).forEach(d => seen.add(dndTagNorm(d.tag)));   // что уже было в тексте при открытии — само не добавляется
    const setTags = list => { input.value = list.join(', '); input.dispatchEvent(new Event('input', { bubbles: true })); };
    const add = tag => { const have = cur(); if (!have.some(t => dndTagNorm(t) === dndTagNorm(tag))) setTags(have.concat(tag)); };
    const chip = (tag, kind, plus) => '<button type="button" class="tg-chip tk-' + kind + '" data-tag="' + esc(tag) + '">' + (plus ? ic('add') : '') + '#' + esc(tag) + '</button>';
    const render = () => {
        const have = new Set(cur().map(dndTagNorm)), idx = dndTagIndex(g);
        const det = dndDetectTags(g, o.getText());
        if (dndCfg.autoTagsAdd !== false) {   // новые слова, которые вы печатаете сейчас, превращаются в хештеги сами
            const fresh = det.filter(d => !seen.has(dndTagNorm(d.tag)) && d.kind !== 'free');
            if (fresh.length) { fresh.forEach(d => seen.add(dndTagNorm(d.tag))); setTags(cur().concat(fresh.map(d => d.tag).filter(t => !have.has(dndTagNorm(t))))); return render(); }
        }
        const found = det.filter(d => !have.has(dndTagNorm(d.tag)));
        const grp = (kind, list) => list.length ? '<div class="tg-grp"><b class="tk-' + kind + '">' + esc(DND_TAG_KINDS[kind].n) + '</b><div class="tg-chips">' + list.map(x => chip(x.tag, kind, true)).join('') + '</div></div>' : '';
        const rest = (list, kind) => list.filter(x => !have.has(dndTagNorm(x.tag)));
        host.innerHTML =
            '<div class="tg-found"><span class="tg-lab">' + ic('tag') + 'Найдено в тексте</span>' +
            (found.length ? '<div class="tg-chips">' + found.map(d => chip(d.tag, d.kind, true)).join('') + '</div><button type="button" class="chip tg-all" data-all="1">' + ic('add') + 'Добавить все</button>' :
                '<span class="hint">' + (det.length ? 'Всё найденное уже добавлено в хештеги' : 'Имена героев, места и сюжетные повороты из текста появятся здесь') + '</span>') + '</div>' +
            '<details class="tg-more"><summary>Все имена героев, места и повороты</summary>' +
            (grp('char', rest(idx.chars)) || '<p class="hint">Героев пока нет — добавьте их на странице «Персонажи».</p>') + (grp('loc', rest(idx.places)) || '') + grp('twist', rest(idx.twists)) + '</details>';
        host._found = found;
    };
    host.addEventListener('click', e => {
        const b = e.target.closest('.tg-chip'); if (b) { add(b.dataset.tag); render(); return; }
        if (e.target.closest('[data-all]')) { (host._found || []).forEach(d => add(d.tag)); render(); }
    });
    const again = debounce(render, 250);
    (o.watch || []).forEach(el => el && el.addEventListener('input', again));
    input.addEventListener('change', render);
    input.addEventListener('blur', render);
    render();
    return { render };
}
// Цветные хештеги на карточке (общий вид)
function dndTagsHtml(game, tags, cls) {
    return (tags || []).map(t => '<span class="tk-' + dndTagKind(game, t) + (cls ? ' ' + cls : '') + '">#' + esc(t) + '</span>').join('');
}
