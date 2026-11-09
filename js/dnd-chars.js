'use strict';
// =====================================================================================================
// iLife 2.0.0 — СТРАНИЦА «ПЕРСОНАЖИ»: список персонажей выбранной игры и подробный лист с редактированием.
// Персонаж хранится в game.chars[]:
//   { id, name, type, player, race, cls, subclass, level, bg, align, age, gender, role,
//     stats{ str,dex,con,int,wis,cha }, hp, ac, speed, lang, height, weight, eyes, hair, skin, marks, look,
//     traits, ideals, bonds, flaws, goals, secrets, backstory, rel[{id,name,note}], weapons, inventory, spells, money,
//     looks[{id,title,desc,imgId}]  — стили одежды (образы) с картинками, gallery[{id,imgId,cap}], notes,
//     portraitId, hue, cardId (связь с карточкой на доске), createdAt }
// Картинки лежат в IndexedDB (BlobDB) и синхронизируются вместе с остальными вложениями (js/dnd.js → dndMediaRefs).
// =====================================================================================================

const DC_SECTIONS = [
    { k: 'basic', n: 'Основное', i: 'person' }, { k: 'stats', n: 'Характеристики и бой', i: 'shield_d' }, { k: 'look', n: 'Внешность', i: 'visibility' },
    { k: 'mind', n: 'Характер и мотивы', i: 'heart' }, { k: 'story', n: 'История', i: 'auto_stories' }, { k: 'rel', n: 'Связи', i: 'groups' },
    { k: 'gear', n: 'Снаряжение и умения', i: 'swords' }, { k: 'styles', n: 'Стили одежды', i: 'checkroom' }, { k: 'gallery', n: 'Галерея', i: 'image' }, { k: 'notes', n: 'Заметки', i: 'notes' }
];
const DC_TYPES = [{ k: 'pc', n: 'Игрок' }, { k: 'npc', n: 'NPC' }, { k: 'ally', n: 'Союзник' }, { k: 'villain', n: 'Злодей' }, { k: 'monster', n: 'Монстр' }];
const DC_ALIGN = ['', 'Законно-добрый', 'Нейтрально-добрый', 'Хаотично-добрый', 'Законно-нейтральный', 'Истинно нейтральный', 'Хаотично-нейтральный', 'Законно-злой', 'Нейтрально-злой', 'Хаотично-злой'];
const DC_STATS = [['str', 'СИЛ'], ['dex', 'ЛОВ'], ['con', 'ТЕЛ'], ['int', 'ИНТ'], ['wis', 'МДР'], ['cha', 'ХАР']];
const DC_LOOK_PRESETS = ['Повседневная', 'Парадная', 'Доспехи', 'Дорожная', 'Ритуальная', 'Ночная'];
let dcOpenId = '';
const dcUi = { q: '', type: 'all' };
let dcPick = null;

const dcType = k => DC_TYPES.find(t => t.k === k) || DC_TYPES[1];
function dndCharNew(g, p) {
    const c = Object.assign({
        id: uid('ch'), name: '', type: 'pc', player: '', race: '', cls: '', subclass: '', level: 1, bg: '', align: '', age: '', gender: '', role: '',
        stats: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 }, hp: '', ac: '', speed: '', lang: '', height: '', weight: '', eyes: '', hair: '', skin: '', marks: '', look: '',
        traits: '', ideals: '', bonds: '', flaws: '', goals: '', secrets: '', backstory: '', rel: [], weapons: '', inventory: '', spells: '', money: '',
        looks: [], gallery: [], notes: '', portraitId: '', hue: DND_HUES[(g.chars || []).length % DND_HUES.length], createdAt: Date.now()
    }, p || {});
    g.chars = g.chars || []; g.chars.push(c); dndTouch(g); return c;
}
async function dndCloneImage(g, id) {
    const rec = await BlobDB.get(id); if (!rec || !rec.blob) return '';
    const nid = uid('f'); await BlobDB.put({ id: nid, blob: rec.blob, thumb: rec.thumb || null, name: rec.name, type: rec.type, size: rec.size });
    g.files = g.files || {}; g.files[nid] = Object.assign({}, g.files[id] || { name: rec.name, type: rec.type }); return nid;
}
function dndCharFromCard(g, card) {
    const c = dndCharNew(g, { name: card.title || '', backstory: card.text || '', cardId: card.id, type: 'npc' });
    if (card.imgId) dndCloneImage(g, card.imgId).then(id => { if (id) { c.portraitId = id; dndTouch(g); if (dcOpenId === c.id || $('#dnd-chars').classList.contains('is-active')) renderDndChars(); } });
    return c;
}
function dndCharsOpenChar(id) { dcOpenId = id; showTab('dnd-chars'); renderDndChars(); }
function dndCharsOpened() { renderDndChars(); }
function dndCharsReload() { if (dcOpenId && !(dndCur() && (dndCur().chars || []).some(c => c.id === dcOpenId))) dcOpenId = ''; renderDndChars(); }

async function dcPaint(root) {
    for (const el of $$('[data-img]', root)) {
        const url = await BlobDB.url(el.dataset.img, 'thumb');
        if (url) { el.style.backgroundImage = 'url("' + url + '")'; el.classList.add('has-img'); } else el.classList.add('is-missing');
    }
}
function dcInitial(c) { return esc((c.name || '?').trim().charAt(0).toUpperCase() || '?'); }
function dcMod(v) { const m = Math.floor(((+v) - 10) / 2); return isNaN(m) ? '' : (m >= 0 ? '+' : '−') + Math.abs(m); }
const dcProf = lvl => 2 + Math.floor((Math.max(1, +lvl || 1) - 1) / 4);

// ---------- Страница ----------
function renderDndChars() {
    const host = $('#dnd-chars-body'); if (!host) return;
    const g = dndCur();
    $('#dnd-chars-head').hidden = !!dcOpenId;
    if (!g) {
        host.innerHTML = '<div class="empty"><div class="ico-big">' + ic('casino') + '</div><b>Сначала выберите игру</b>Персонажи хранятся внутри игры.' +
            '<div class="btn-group" style="justify-content:center;margin-top:1rem"><button type="button" class="btn btn-primary" data-dnd-pick>' + ic('casino') + 'Выбрать игру</button><button type="button" class="btn" data-dc="newgame">' + ic('add') + 'Новая игра</button></div></div>';
        $('#dnd-chars-new').disabled = true; $('#dnd-chars-fromboard').disabled = true; $('#dnd-chars-tools').hidden = true; return;
    }
    $('#dnd-chars-new').disabled = false; $('#dnd-chars-fromboard').disabled = false;
    const c = dcOpenId && (g.chars || []).find(x => x.id === dcOpenId);
    if (c) { $('#dnd-chars-tools').hidden = true; host.innerHTML = dcEditorHtml(g, c); host.dataset.view = 'edit'; dcPaint(host); return; }
    dcOpenId = ''; host.dataset.view = 'list'; $('#dnd-chars-tools').hidden = false;
    $$('#dnd-chars-filter button').forEach(b => b.classList.toggle('is-on', b.dataset.f === dcUi.type));
    const q = normText(dcUi.q);
    const list = (g.chars || []).filter(x => (dcUi.type === 'all' || x.type === dcUi.type) && (!q || normText([x.name, x.race, x.cls, x.player, x.role].join(' ')).includes(q)));
    $('#dnd-chars-count').textContent = (g.chars || []).length ? (list.length === g.chars.length ? dndFmtN(g.chars.length, 'персонаж', 'персонажа', 'персонажей') : list.length + ' из ' + g.chars.length) : '';
    if (!(g.chars || []).length) {
        host.innerHTML = '<div class="empty"><div class="ico-big">' + ic('groups') + '</div><b>В игре «' + esc(g.title) + '» пока нет персонажей</b>Создайте первого или заберите героев с карточек на доске.' +
            '<div class="btn-group" style="justify-content:center;margin-top:1rem"><button type="button" class="btn btn-primary" data-dc="new">' + ic('person_add') + 'Новый персонаж</button></div></div>'; return;
    }
    if (!list.length) { host.innerHTML = '<div class="empty"><div class="ico-big">' + ic('search') + '</div><b>Никого не нашли</b>Измените запрос или фильтр.</div>'; return; }
    host.innerHTML = '<div class="dc-grid">' + list.map(x => {
        const sub = [x.race, x.cls, x.level && x.cls ? x.level + ' ур.' : ''].filter(Boolean).join(' · ');
        return '<article class="dc-card" data-id="' + esc(x.id) + '" tabindex="0"><div class="dc-ph" style="--h:' + (x.hue || 265) + '"' + (x.portraitId ? ' data-img="' + esc(x.portraitId) + '"' : '') + '><span>' + dcInitial(x) + '</span></div>' +
            '<div class="dc-info"><h3>' + esc(x.name || 'Без имени') + '</h3><p>' + (esc(sub) || '<i>описание не заполнено</i>') + '</p>' +
            '<div class="dc-chips"><span class="chip is-on">' + esc(dcType(x.type).n) + '</span>' + (x.ac ? '<span class="chip">' + ic('shield_d') + esc(x.ac) + '</span>' : '') + (x.hp ? '<span class="chip">' + ic('heart') + esc(x.hp) + '</span>' : '') +
            ((x.looks || []).length ? '<span class="chip">' + ic('checkroom') + x.looks.length + '</span>' : '') + '</div></div></article>';
    }).join('') + '</div>';
    dcPaint(host);
}

// ---------- Лист персонажа ----------
function dcField(label, path, c, o) {
    o = o || {};
    const val = path.split('.').reduce((a, k) => (a == null ? a : a[k]), c);
    const id = 'dcf-' + path.replace(/\./g, '-');
    if (o.area) return '<div class="dc-f dc-wide"><label class="field-label" for="' + id + '">' + label + '</label><textarea id="' + id + '" data-f="' + path + '" rows="' + (o.rows || 3) + '" placeholder="' + esc(o.ph || '') + '">' + esc(val) + '</textarea></div>';
    if (o.select) return '<div class="dc-f"><label class="field-label" for="' + id + '">' + label + '</label><select id="' + id + '" data-f="' + path + '">' + o.select.map(s => { const k = typeof s === 'string' ? s : s.k, n = typeof s === 'string' ? (s || '—') : s.n; return '<option value="' + esc(k) + '"' + (k === val ? ' selected' : '') + '>' + esc(n) + '</option>'; }).join('') + '</select></div>';
    return '<div class="dc-f' + (o.wide ? ' dc-wide' : '') + '"><label class="field-label" for="' + id + '">' + label + '</label><input id="' + id + '" data-f="' + path + '" type="' + (o.num ? 'number' : 'text') + '"' + (o.num ? ' inputmode="numeric"' : '') + ' value="' + esc(val == null ? '' : val) + '" placeholder="' + esc(o.ph || '') + '"' + (o.list ? ' list="' + o.list + '"' : '') + '></div>';
}
function dcSec(k, c, body, extra) {
    const s = DC_SECTIONS.find(x => x.k === k); if (dndCfg.sections[k] === false) return '';
    const id = 'dc-sec-' + k;
    return '<div class="card dc-sec' + (collapsedCards.has(id) ? ' is-collapsed' : '') + '" id="' + id + '"><h3 class="card-title"><span class="ico">' + ic(s.i) + '</span><span class="ttl">' + esc(s.n) + (extra || '') + '</span><button type="button" class="icon-btn card-toggle" aria-label="Свернуть или развернуть блок">' + ic('expand_less') + '</button></h3><div class="card-body">' + body + '</div></div>';
}
function dcEditorHtml(g, c) {
    const others = (g.chars || []).filter(x => x.id !== c.id);
    const stats = '<div class="dc-stats">' + DC_STATS.map(s => '<label class="dc-st"><span>' + s[1] + '</span><input type="number" inputmode="numeric" data-f="stats.' + s[0] + '" value="' + esc(c.stats[s[0]]) + '" min="1" max="30"><b data-mod="' + s[0] + '">' + dcMod(c.stats[s[0]]) + '</b></label>').join('') + '</div>';
    const rel = '<div id="dc-rel">' + (c.rel || []).map((r, i) => '<div class="dc-rel" data-i="' + i + '"><input type="text" data-r="name" list="dc-names" placeholder="Кто" value="' + esc(r.name) + '"><input type="text" data-r="note" placeholder="Кем приходится, что между ними" value="' + esc(r.note) + '"><button type="button" class="icon-btn" data-dc="relx" aria-label="Убрать">' + ic('close') + '</button></div>').join('') + '</div>' +
        '<datalist id="dc-names">' + others.map(o => '<option value="' + esc(o.name) + '">').join('') + '</datalist><button type="button" class="btn" data-dc="reladd"><i data-i="add"></i>Добавить связь</button>';
    const looks = '<div class="dc-looks" id="dc-looks">' + (c.looks || []).map(l => dcLookHtml(l)).join('') + '</div>' +
        '<div class="dc-presets">' + DC_LOOK_PRESETS.map(p => '<button type="button" class="chip" data-dc="lookadd" data-p="' + esc(p) + '">' + ic('add') + esc(p) + '</button>').join('') + '</div>' +
        '<div class="btn-group" style="margin-top:0.5rem"><button type="button" class="btn" data-dc="lookadd" data-p=""><i data-i="add"></i>Новый образ</button><button type="button" class="btn" data-dc="lookpics"><i data-i="add_photo_alternate"></i>Образы из картинок</button></div>';
    const gal = '<div class="dc-gal" id="dc-gal">' + (c.gallery || []).map(x => '<figure class="dc-gi" data-id="' + esc(x.id) + '"><div class="dc-gimg" data-img="' + esc(x.imgId) + '" data-dc="galview"></div><input type="text" data-g="cap" placeholder="Подпись" value="' + esc(x.cap) + '"><button type="button" class="icon-btn dc-gx" data-dc="galdel" aria-label="Убрать">' + ic('close') + '</button></figure>').join('') + '</div>' +
        '<button type="button" class="btn" data-dc="galadd"><i data-i="add_photo_alternate"></i>Добавить картинки</button>';
    const html =
        '<div class="dc-edit" data-cid="' + esc(c.id) + '">' +
        '<div class="dc-bar"><button type="button" class="btn" data-dc="back"><i data-i="arrow_back"></i>К списку</button><span class="dc-saved" id="dc-saved">Сохранено</span>' +
        '<button type="button" class="icon-btn" data-dc="dup" title="Дублировать" aria-label="Дублировать">' + ic('content_copy') + '</button><button type="button" class="icon-btn" data-dc="del" title="Удалить" aria-label="Удалить">' + ic('delete') + '</button></div>' +
        '<div class="dc-hero"><div class="dc-portrait" style="--h:' + (c.hue || 265) + '"' + (c.portraitId ? ' data-img="' + esc(c.portraitId) + '"' : '') + ' data-dc="portrait" title="Сменить портрет"><span>' + dcInitial(c) + '</span><i class="dc-cam">' + ic('photo_camera') + '</i></div>' +
        '<div class="dc-hero-t"><h2 id="dc-title">' + esc(c.name || 'Без имени') + '</h2><p class="hint" id="dc-sub">' + esc([c.race, c.cls, dcType(c.type).n].filter(Boolean).join(' · ')) + '</p>' +
        '<div class="btn-group"><button type="button" class="btn" data-dc="portrait"><i data-i="add_photo_alternate"></i>' + (c.portraitId ? 'Сменить портрет' : 'Загрузить портрет') + '</button>' + (c.portraitId ? '<button type="button" class="btn btn-danger" data-dc="portraitx"><i data-i="delete"></i>Убрать</button>' : '') + '</div></div></div>' +
        dcSec('basic', c, '<div class="dc-fields">' + dcField('Имя', 'name', c, { wide: true, ph: 'Как зовут' }) + dcField('Вид', 'type', c, { select: DC_TYPES }) + dcField('Игрок', 'player', c, { ph: 'Кто играет' }) + dcField('Раса', 'race', c) + dcField('Класс', 'cls', c) + dcField('Подкласс', 'subclass', c) +
            dcField('Уровень', 'level', c, { num: true }) + dcField('Предыстория', 'bg', c, { ph: 'Солдат, мудрец…' }) + dcField('Мировоззрение', 'align', c, { select: DC_ALIGN }) + dcField('Возраст', 'age', c) + dcField('Пол / местоимения', 'gender', c) + dcField('Роль в истории', 'role', c, { wide: true, ph: 'Союзник героев, соперник, наниматель…' }) + '</div>') +
        dcSec('stats', c, stats + '<p class="hint dc-prof" id="dc-prof">Бонус мастерства: +' + dcProf(c.level) + '</p><div class="dc-fields">' + dcField('Хиты', 'hp', c, { ph: '27' }) + dcField('Класс доспеха', 'ac', c, { ph: '15' }) + dcField('Скорость', 'speed', c, { ph: '30 фт.' }) + dcField('Языки', 'lang', c, { wide: true, ph: 'Общий, эльфийский' }) + '</div>') +
        dcSec('look', c, '<div class="dc-fields">' + dcField('Рост', 'height', c) + dcField('Вес', 'weight', c) + dcField('Глаза', 'eyes', c) + dcField('Волосы', 'hair', c) + dcField('Кожа', 'skin', c) + dcField('Особые приметы', 'marks', c, { wide: true, ph: 'Шрамы, татуировки, привычки' }) + dcField('Как выглядит', 'look', c, { area: true, rows: 4, ph: 'Телосложение, осанка, одежда, первое впечатление' }) + '</div>') +
        dcSec('mind', c, '<div class="dc-fields">' + dcField('Черты характера', 'traits', c, { area: true }) + dcField('Идеалы', 'ideals', c, { area: true }) + dcField('Привязанности', 'bonds', c, { area: true }) + dcField('Слабости', 'flaws', c, { area: true }) + dcField('Цели и желания', 'goals', c, { area: true }) + dcField('Тайны (скрыто от игроков)', 'secrets', c, { area: true }) + '</div>') +
        dcSec('story', c, '<div class="dc-fields">' + dcField('История', 'backstory', c, { area: true, rows: 10, ph: 'Откуда родом, что пережил, как оказался здесь' }) + '</div>') +
        dcSec('rel', c, rel, (c.rel || []).length ? ' <small>· ' + c.rel.length + '</small>' : '') +
        dcSec('gear', c, '<div class="dc-fields">' + dcField('Оружие и доспехи', 'weapons', c, { area: true }) + dcField('Вещи', 'inventory', c, { area: true }) + dcField('Заклинания и умения', 'spells', c, { area: true, rows: 5 }) + dcField('Деньги', 'money', c, { wide: true, ph: '12 зм, 5 см' }) + '</div>') +
        dcSec('styles', c, '<p class="hint" style="margin-bottom:0.75rem">Образы персонажа: повседневная одежда, парадная, доспехи. К каждому — картинка и описание.</p>' + looks, (c.looks || []).length ? ' <small>· ' + c.looks.length + '</small>' : '') +
        dcSec('gallery', c, gal, (c.gallery || []).length ? ' <small>· ' + c.gallery.length + '</small>' : '') +
        dcSec('notes', c, '<div class="dc-fields">' + dcField('Заметки', 'notes', c, { area: true, rows: 6 }) + '</div>') +
        '<input type="file" id="dc-file" accept="image/*" multiple hidden></div>';
    setTimeout(() => hydrateIcons($('#dnd-chars-body')), 0);
    return html;
}
function dcLookHtml(l) {
    return '<article class="dc-look" data-id="' + esc(l.id) + '"><div class="dc-limg' + (l.imgId ? '' : ' is-empty') + '"' + (l.imgId ? ' data-img="' + esc(l.imgId) + '" data-dc="lookview"' : ' data-dc="lookimg"') + '>' + (l.imgId ? '' : ic('add_photo_alternate') + '<span>Добавить картинку</span>') + '</div>' +
        '<div class="dc-lbody"><input type="text" data-l="title" placeholder="Название образа" value="' + esc(l.title) + '"><textarea data-l="desc" rows="2" placeholder="Что на нём, где носит, чем запоминается">' + esc(l.desc) + '</textarea>' +
        '<div class="dc-lact"><button type="button" class="chip" data-dc="lookimg">' + ic('add_photo_alternate') + (l.imgId ? 'Заменить' : 'Картинка') + '</button>' + (l.imgId ? '<button type="button" class="chip" data-dc="lookport">' + ic('person') + 'В портрет</button>' : '') + '<button type="button" class="chip is-warn" data-dc="lookdel">' + ic('delete') + 'Удалить</button></div></div></article>';
}

// ---------- События ----------
function dcSaved() { const s = $('#dc-saved'); if (s) { s.classList.add('is-on'); clearTimeout(dcSaved.t); dcSaved.t = setTimeout(() => s.classList.remove('is-on'), 1400); } }
function dcCur() { const g = dndCur(); return g && g.chars.find(c => c.id === dcOpenId); }
async function dcAddImages(files, kind, ref) {
    const g = dndCur(), c = dcCur(); if (!g || !c) return;
    let n = 0;
    for (const f of files) {
        try {
            const r = await dndAddImage(g, f);
            if (kind === 'portrait') { if (c.portraitId) dndDropImage(g, c.portraitId); c.portraitId = r.id; }
            else if (kind === 'lookimg') { const l = c.looks.find(x => x.id === ref); if (l) { if (l.imgId) dndDropImage(g, l.imgId); l.imgId = r.id; } }
            else if (kind === 'lookpics') c.looks.push({ id: uid('lk'), title: f.name.replace(/\.[^.]+$/, ''), desc: '', imgId: r.id });
            else if (kind === 'gallery') c.gallery.push({ id: uid('gl'), imgId: r.id, cap: '' });
            n++;
        } catch (e) { console.error(e); toast('Не удалось добавить «' + f.name + '»'); }
    }
    if (n) { dndTouch(g); const keep = ['dc-sec-styles', 'dc-sec-gallery']; renderDndChars(); }
}
function initDndChars() {
    const host = $('#dnd-chars-body');
    $('#dnd-chars-new').addEventListener('click', () => { const g = dndCur(); if (!g) return; const c = dndCharNew(g, {}); dcOpenId = c.id; renderDndChars(); window.scrollTo({ top: 0 }); setTimeout(() => { const i = $('#dcf-name'); if (i) i.focus(); }, 100); });
    $('#dnd-chars-fromboard').addEventListener('click', () => {
        const g = dndCur(); if (!g) return;
        const cards = (g.board.items || []).filter(i => i.t === 'card' && i.kind === 'char' && !(i.charId && (g.chars || []).some(c => c.id === i.charId)));
        if (!cards.length) { toast('На доске нет новых карточек вида «Персонаж»'); return; }
        cards.forEach(card => { const c = dndCharFromCard(g, card); card.charId = c.id; });
        dndTouch(g); if (dndBuilder) dndBuilder._dirty = true; renderDndChars(); toast('Добавлено персонажей: ' + cards.length);
    });
    const q = $('#dnd-chars-q'); q.addEventListener('input', debounce(() => { dcUi.q = q.value; renderDndChars(); }, 150));
    $('#dnd-chars-filter').addEventListener('click', e => { const b = e.target.closest('button[data-f]'); if (!b) return; dcUi.type = b.dataset.f; renderDndChars(); });
    const file = () => $('#dc-file');
    host.addEventListener('click', async e => {
        const card = e.target.closest('.dc-card'); if (card && host.dataset.view === 'list') { dcOpenId = card.dataset.id; renderDndChars(); window.scrollTo({ top: 0 }); return; }
        const b = e.target.closest('[data-dc]'); if (!b) return; const a = b.dataset.dc, g = dndCur(); if (!g) return; const c = dcCur();
        if (a === 'new') { $('#dnd-chars-new').click(); return; }
        if (a === 'newgame') { dndGameFormSheet(null, () => dndPagesReload()); return; }
        if (!c) return;
        const pickImages = (kind, ref, multiple) => { dcPick = { kind, ref }; const f = file(); f.multiple = !!multiple; f.value = ''; f.click(); };
        if (a === 'back') { dcOpenId = ''; renderDndChars(); }
        else if (a === 'portrait') pickImages('portrait', null, false);
        else if (a === 'portraitx') { dndDropImage(g, c.portraitId); c.portraitId = ''; dndTouch(g); renderDndChars(); }
        else if (a === 'reladd') { c.rel.push({ id: uid('r'), name: '', note: '' }); dndTouch(g); renderDndChars(); setTimeout(() => { const l = $$('#dc-rel .dc-rel'); const last = l[l.length - 1]; if (last) last.querySelector('input').focus(); }, 60); }
        else if (a === 'relx') { c.rel.splice(+b.closest('.dc-rel').dataset.i, 1); dndTouch(g); renderDndChars(); }
        else if (a === 'lookadd') { c.looks.push({ id: uid('lk'), title: b.dataset.p || '', desc: '', imgId: '' }); dndTouch(g); renderDndChars(); }
        else if (a === 'lookpics') pickImages('lookpics', null, true);
        else if (a === 'lookimg') pickImages('lookimg', b.closest('.dc-look').dataset.id, false);
        else if (a === 'lookview' || a === 'galview') { const id = a === 'galview' ? b.closest('.dc-gi').dataset.id : b.closest('.dc-look').dataset.id; const it = (a === 'galview' ? c.gallery : c.looks).find(x => x.id === id); if (it) dndViewImage({ imgId: it.imgId, name: it.title || it.cap || c.name }); }
        else if (a === 'lookport') { const l = c.looks.find(x => x.id === b.closest('.dc-look').dataset.id); if (l && l.imgId) { dndCloneImage(g, l.imgId).then(nid => { if (!nid) return; if (c.portraitId) dndDropImage(g, c.portraitId); c.portraitId = nid; dndTouch(g); renderDndChars(); toast('Портрет обновлён'); }); } }
        else if (a === 'lookdel') { const i = c.looks.findIndex(x => x.id === b.closest('.dc-look').dataset.id); if (i >= 0) { dndDropImage(g, c.looks[i].imgId); c.looks.splice(i, 1); dndTouch(g); renderDndChars(); } }
        else if (a === 'galadd') pickImages('gallery', null, true);
        else if (a === 'galdel') { const i = c.gallery.findIndex(x => x.id === b.closest('.dc-gi').dataset.id); if (i >= 0) { dndDropImage(g, c.gallery[i].imgId); c.gallery.splice(i, 1); dndTouch(g); renderDndChars(); } }
        else if (a === 'dup') {
            const cp = JSON.parse(JSON.stringify(c)); cp.id = uid('ch'); cp.name = (c.name || 'Без имени') + ' (копия)'; cp.portraitId = ''; cp.looks = []; cp.gallery = []; delete cp.cardId; cp.createdAt = Date.now();
            g.chars.push(cp); dndTouch(g); dcOpenId = cp.id; renderDndChars(); toast('Копия создана (картинки не копируются)');
        } else if (a === 'del') {
            const ok = await confirmSheet('Удалить персонажа?', '«' + (c.name || 'Без имени') + '» будет удалён вместе с картинками. Отменить нельзя.', 'Удалить', true); if (!ok) return;
            [c.portraitId].concat(c.looks.map(l => l.imgId), c.gallery.map(x => x.imgId)).forEach(id => dndDropImage(g, id));
            g.chars = g.chars.filter(x => x.id !== c.id);
            (g.board.items || []).forEach(i => { if (i.charId === c.id) delete i.charId; }); (g.plot.items || []).forEach(i => { if (i.chars) i.chars = i.chars.filter(x => x !== c.id); });
            dndTouch(g); dcOpenId = ''; if (dndBuilder) dndBuilder._dirty = true; if (dndPlot) dndPlot._dirty = true; renderDndChars(); toast('Персонаж удалён');
        }
    });
    host.addEventListener('keydown', e => { const card = e.target.closest('.dc-card'); if (card && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); dcOpenId = card.dataset.id; renderDndChars(); } });
    // правка полей
    host.addEventListener('input', e => {
        const g = dndCur(), c = dcCur(); if (!g || !c) return; const t = e.target;
        if (t.dataset.f) {
            const path = t.dataset.f.split('.'); let o = c; for (let i = 0; i < path.length - 1; i++) o = o[path[i]];
            const last = path[path.length - 1]; let v = t.value;
            if (t.type === 'number') { v = t.value === '' ? '' : +t.value; }
            o[last] = v;
            if (path[0] === 'stats') { const m = host.querySelector('[data-mod="' + last + '"]'); if (m) m.textContent = dcMod(v); }
            if (last === 'level') { const p = $('#dc-prof'); if (p) p.textContent = 'Бонус мастерства: +' + dcProf(v); }
            if (last === 'name') { $('#dc-title').textContent = c.name || 'Без имени'; const ph = host.querySelector('.dc-portrait span'); if (ph) ph.textContent = (c.name || '?').trim().charAt(0).toUpperCase() || '?'; }
            if (last === 'race' || last === 'cls' || last === 'type') $('#dc-sub').textContent = [c.race, c.cls, dcType(c.type).n].filter(Boolean).join(' · ');
        } else if (t.dataset.r) { const row = t.closest('.dc-rel'); c.rel[+row.dataset.i][t.dataset.r] = t.value; }
        else if (t.dataset.l) { const l = c.looks.find(x => x.id === t.closest('.dc-look').dataset.id); if (l) l[t.dataset.l] = t.value; }
        else if (t.dataset.g) { const x = c.gallery.find(y => y.id === t.closest('.dc-gi').dataset.id); if (x) x[t.dataset.g] = t.value; }
        else return;
        dndTouch(g); dcSaved();
    });
    host.addEventListener('change', e => { if (e.target.dataset.f === 'type' || e.target.dataset.f === 'align') { const c = dcCur(); if (c) { c[e.target.dataset.f] = e.target.value; dndTouch(dndCur()); dcSaved(); } } });
    document.addEventListener('change', e => { if (e.target.id !== 'dc-file') return; const fs = Array.from(e.target.files); if (fs.length && dcPick) dcAddImages(fs, dcPick.kind, dcPick.ref); });
}
