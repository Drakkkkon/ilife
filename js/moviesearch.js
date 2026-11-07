'use strict';
// =====================================================================================================
// iLife — КИНО: ПОИСК ФИЛЬМА НА РАЗНЫХ ПЛОЩАДКАХ (версия 1.8.0).
//
// Строка «Добавить фильм или сериал» на странице «Кино»: пока вы вводите название, под строкой открывается меню с результатами
// сразу с нескольких площадок. Вверху меню — переключатель площадок («Все», «Кинопоиск», «IMDb», «TMDB», «TVMaze»), у каждой своё
// состояние (ищем / ошибка / нужен ключ). Выбранный фильм или сериал попадает в общий список «Все фильмы» (и в нужный блок:
// «Список для просмотра», «Смотрю сейчас» или «Просмотрено»). Добавление — функция mvAddMovie (js/movies.js).
//
// Откуда берутся результаты (всё напрямую из браузера, без своего сервера):
//   • Кинопоиск — через ПоискКино (poiskkino.dev), нужен бесплатный ключ из Настроек → Кино;
//   • IMDb      — открытая поисковая подсказка IMDb (ключ не нужен); если она недоступна, но введён ключ OMDb — ищем через OMDb;
//   • TMDB      — нужен бесплатный ключ из Настроек → Кино;
//   • TVMaze    — открытая база сериалов (ключ не нужен).
// Для площадки без ключа в меню есть ссылка «Искать на сайте»: можно найти фильм там и добавить его по названию вручную.
// Запись hit: { src, title, origTitle, year, type: 'movie'|'tv', posterUrl, posterPath?, overview, ratings{}, tmdbId?, imdbId?, kpId?, link }
// =====================================================================================================

const IMDB_SUGGEST = 'https://v3.sg.media-imdb.com/suggestion/';
const TVMAZE_API = 'https://api.tvmaze.com';
const MVS_PER_SOURCE = 8;      // сколько результатов берём у каждой площадки
const MVS_ALL_SHOW = 4;        // сколько показываем у каждой площадки на вкладке «Все»

const mvsEnc = encodeURIComponent;
const mvsStripHtml = s => String(s || '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/\s+/g, ' ').trim();
const mvsHttps = u => String(u || '').replace(/^http:\/\//i, 'https://');

// ---------- Площадки ----------
const MV_SEARCH_SOURCES = [
    { id: 'kp', name: 'Кинопоиск', needs: 'ПоискКино', ready: () => !!mvKey('kp'), run: mvsSearchKp, site: q => 'https://www.kinopoisk.ru/index.php?kp_query=' + mvsEnc(q) },
    { id: 'imdb', name: 'IMDb', ready: () => true, run: mvsSearchImdb, site: q => 'https://www.imdb.com/find/?q=' + mvsEnc(q) + '&s=tt' },
    { id: 'tmdb', name: 'TMDB', needs: 'TMDB', ready: () => mvHasTmdb(), run: mvsSearchTmdb, site: q => 'https://www.themoviedb.org/search?query=' + mvsEnc(q) },
    { id: 'tvmaze', name: 'TVMaze', ready: () => true, run: mvsSearchTvmaze, site: q => 'https://www.tvmaze.com/search?q=' + mvsEnc(q) }
];
const MVS_BY_ID = {}; MV_SEARCH_SOURCES.forEach(s => { MVS_BY_ID[s.id] = s; });

async function mvsSearchKp(q) {
    const j = await mvFetch(KP_API + '/v1.5/movie/search?limit=' + MVS_PER_SOURCE + '&query=' + mvsEnc(q), { headers: { 'X-API-KEY': mvKey('kp'), accept: 'application/json' } });
    return ((j && (j.docs || j.items)) || []).map(d => {
        const title = d.name || d.alternativeName || d.enName || '', ext = d.externalId || {}, r = d.rating || {};
        const ratings = {}; if (mvNum(r.kp)) ratings.kp = mvNum(r.kp); if (mvNum(r.imdb)) ratings.imdb = mvNum(r.imdb);
        return {
            src: 'kp', title, origTitle: d.alternativeName || d.enName || '', year: parseInt(d.year, 10) || null,
            type: d.isSeries || /series/i.test(String(d.type || '')) ? 'tv' : 'movie', kpId: d.id || null, imdbId: ext.imdb || '', tmdbId: parseInt(ext.tmdb, 10) || null,
            posterUrl: mvsHttps(d.poster && (d.poster.previewUrl || d.poster.url) || ''), overview: d.shortDescription || d.description || '', ratings,
            link: d.id ? 'https://www.kinopoisk.ru/' + (d.isSeries ? 'series' : 'film') + '/' + d.id + '/' : ''
        };
    }).filter(h => h.title);
}

async function mvsSearchImdb(q) {
    const first = (String(q).trim().charAt(0) || 'x').toLowerCase(), letter = /[a-z0-9]/.test(first) ? first : 'x';
    try {
        const j = await mvFetch(IMDB_SUGGEST + letter + '/' + mvsEnc(String(q).trim().toLowerCase().slice(0, 100)) + '.json');
        const out = [];
        ((j && j.d) || []).forEach(d => {
            if (!d || !/^tt\d+/.test(String(d.id || ''))) return;
            const qid = String(d.qid || d.q || '');
            if (/videoGame|episode|podcast|musicVideo|^video$/i.test(qid)) return;
            const img = d.i && d.i.imageUrl ? String(d.i.imageUrl).replace(/\._V1_.*$/, '._V1_UX200_.jpg') : '';
            out.push({ src: 'imdb', title: d.l || '', origTitle: '', year: parseInt(d.y, 10) || null, type: /series/i.test(qid) ? 'tv' : 'movie', imdbId: d.id,
                posterUrl: mvsHttps(img), overview: d.s ? 'В ролях: ' + d.s : '', ratings: {}, link: 'https://www.imdb.com/title/' + d.id + '/' });
        });
        if (out.length || !mvKey('omdb')) return out.slice(0, MVS_PER_SOURCE);
    } catch (e) { if (!mvKey('omdb')) throw e; }
    // запасной путь: поиск OMDb (если подсказка IMDb недоступна)
    const j = await mvFetch(OMDB_API + '?apikey=' + mvsEnc(mvKey('omdb')) + '&s=' + mvsEnc(q));
    if (!j || j.Response === 'False') { if (j && /not found/i.test(String(j.Error || ''))) return []; throw mvErr('omdb', (j && j.Error) || 'нет данных'); }
    return (j.Search || []).filter(d => /movie|series/i.test(d.Type || '')).slice(0, MVS_PER_SOURCE).map(d => ({
        src: 'imdb', title: d.Title || '', origTitle: '', year: parseInt(d.Year, 10) || null, type: /series/i.test(d.Type) ? 'tv' : 'movie', imdbId: d.imdbID || '',
        posterUrl: d.Poster && d.Poster !== 'N/A' ? mvsHttps(d.Poster) : '', overview: '', ratings: {}, link: d.imdbID ? 'https://www.imdb.com/title/' + d.imdbID + '/' : ''
    }));
}

async function mvsSearchTmdb(q) {
    return (await tmdbSearch(q)).slice(0, MVS_PER_SOURCE).map(h => ({
        src: 'tmdb', title: h.title, origTitle: h.origTitle, year: h.year, type: h.type, tmdbId: h.tmdbId, posterPath: h.posterPath, popularity: h.popularity,
        posterUrl: h.posterPath ? TMDB_IMG + 'w154' + h.posterPath : '', overview: h.overview, ratings: h.tmdb ? { tmdb: h.tmdb } : {},
        link: 'https://www.themoviedb.org/' + (h.type === 'tv' ? 'tv' : 'movie') + '/' + h.tmdbId
    }));
}

async function mvsSearchTvmaze(q) {
    const j = await mvFetch(TVMAZE_API + '/search/shows?q=' + mvsEnc(q));
    return (Array.isArray(j) ? j : []).slice(0, MVS_PER_SOURCE).map(x => {
        const s = x && x.show || {}, ext = s.externals || {};
        return { src: 'tvmaze', title: s.name || '', origTitle: '', year: parseInt(String(s.premiered || '').slice(0, 4), 10) || null, type: 'tv', imdbId: ext.imdb || '',
            posterUrl: mvsHttps(s.image && (s.image.medium || s.image.original) || ''), overview: mvsStripHtml(s.summary), genres: (s.genres || []).slice(0, 4),
            ratings: {}, link: s.url ? mvsHttps(s.url) : '' };
    }).filter(h => h.title);
}

// ---------- Состояние меню ----------
// res[id] = { state: 'load' | 'ok' | 'err' | 'nokey', hits: [], msg }
const mvsUi = { q: '', tab: 'all', res: {}, seq: 0 };

function mvsHitSpec(h) {
    return { title: h.title, origTitle: h.origTitle, year: h.year, type: h.type, tmdbId: h.tmdbId || null, imdbId: h.imdbId || '', kpId: h.kpId || null,
        overview: h.overview || '', posterUrl: h.posterUrl || '', posterPath: h.posterPath || '', genres: h.genres, ratings: h.ratings || {} };
}
function mvsRowHtml(h, key) {
    const dup = mvFindDup(mvsHitSpec(h));
    const cv = h.posterUrl ? '<img class="cv" alt="" loading="lazy" referrerpolicy="no-referrer" src="' + esc(h.posterUrl) + '" onerror="this.replaceWith(Object.assign(document.createElement(\'span\'),{className:\'cv\'}))">'
        : '<span class="cv">' + ic(h.type === 'tv' ? 'tv' : 'movie') + '</span>';
    const rate = Object.keys(h.ratings || {}).map(k => ({ kp: 'КП', imdb: 'IMDb', tmdb: 'TMDB' }[k] + ' ' + String(h.ratings[k]).replace('.', ',')))[0] || '';
    const meta = [h.year || '', h.type === 'tv' ? 'сериал' : 'фильм', rate].filter(Boolean).join(' · ');
    return '<div class="mv-res" data-k="' + esc(key) + '">' + cv + '<div class="tx"><div class="nm">' + esc(h.title) + '</div><div class="sub">' + esc(meta) + '</div>' +
        (h.origTitle && mvNorm(h.origTitle) !== mvNorm(h.title) ? '<div class="sub">' + esc(h.origTitle) + '</div>' : '') +
        (h.overview ? '<div class="ov">' + esc(h.overview) + '</div>' : '') + '</div>' +
        '<div class="acts">' + (dup ? '<span class="badge">Уже в списке: ' + esc(MV_STATUS[mvStatusOf(dup)]) + '</span>'
            : '<button type="button" class="btn btn-primary" data-res-add="queue">' + ic('playlist_add') + 'В список</button>' +
              '<button type="button" class="btn" data-res-add="watching">' + ic('visibility') + 'Смотрю</button>' +
              '<button type="button" class="btn btn-text" data-res-add="watched">' + ic('done_all') + 'Смотрел</button>') +
        (h.link ? '<a class="icon-btn" target="_blank" rel="noopener noreferrer" href="' + esc(h.link) + '" aria-label="Открыть на сайте ' + esc(MVS_BY_ID[h.src].name) + '" title="Открыть на сайте">' + ic('open_in_new') + '</a>' : '') + '</div></div>';
}
function mvsStateHtml(s, r, q) {
    if (r.state === 'load') return '<div class="mv-res-state">' + ic('search') + '<span>' + esc(s.name) + ': ищем «' + esc(q) + '»…</span></div>';
    if (r.state === 'nokey') return '<div class="mv-res-state">' + ic('key') + '<span>' + esc(s.name) + ': для поиска нужен бесплатный ключ ' + esc(s.needs) + '.</span><button type="button" class="btn btn-text" data-goto-settings>Подключить</button></div>';
    if (r.state === 'err') return '<div class="mv-res-state is-error">' + ic('warning') + '<span>' + esc(s.name) + ' не ответил: ' + esc(r.msg) + '</span><button type="button" class="btn btn-text" data-ms-retry="' + s.id + '">Ещё раз</button></div>';
    return '<div class="mv-res-state">' + ic('search') + '<span>' + esc(s.name) + ': ничего не нашлось. Проверьте написание или попробуйте оригинальное название.</span></div>';
}
function mvsRender() {
    const box = $('#movie-results'), q = mvsUi.q; if (!box) return;
    const tab = mvsUi.tab;
    const chip = (id, label, n) => '<button type="button" class="chip' + (tab === id ? ' is-on' : '') + '" data-ms-tab="' + id + '">' + esc(label) + (n != null && n !== '' ? ' <small>' + n + '</small>' : '') + '</button>';
    const count = s => { const r = mvsUi.res[s.id]; return !r ? '' : r.state === 'load' ? '…' : r.state === 'ok' ? r.hits.length : r.state === 'nokey' ? 'ключ' : '!'; };
    const total = MV_SEARCH_SOURCES.reduce((n, s) => n + (((mvsUi.res[s.id] || {}).hits || []).length), 0);
    let h = '<div class="mv-res-head"><div class="mv-res-tabs">' + chip('all', 'Все', total) + MV_SEARCH_SOURCES.map(s => chip(s.id, s.name, count(s))).join('') +
        '</div><button type="button" class="icon-btn" data-ms-close aria-label="Закрыть меню">' + ic('close') + '</button></div>';
    const list = tab === 'all' ? MV_SEARCH_SOURCES : [MVS_BY_ID[tab]];
    list.forEach(s => {
        const r = mvsUi.res[s.id] || { state: 'load', hits: [] };
        const shown = tab === 'all' ? r.hits.slice(0, MVS_ALL_SHOW) : r.hits;
        if (tab === 'all') h += '<div class="mv-res-group"><span>' + esc(s.name) + '</span>' + (r.hits.length > MVS_ALL_SHOW ? '<button type="button" class="linkbtn" data-ms-tab="' + s.id + '">ещё ' + (r.hits.length - MVS_ALL_SHOW) + '</button>' : '') + '</div>';
        if (r.state === 'ok' && shown.length) h += shown.map((x, i) => mvsRowHtml(x, s.id + ':' + r.hits.indexOf(x))).join('');
        else h += mvsStateHtml(s, r, q);
    });
    const sites = list.map(s => '<a class="chip" target="_blank" rel="noopener noreferrer" href="' + esc(s.site(q)) + '">' + ic('open_in_new') + 'Искать на ' + esc(s.name) + '</a>').join('');
    h += '<div class="mv-res-foot"><button type="button" class="btn btn-text" data-res-manual>' + ic('add') + 'Добавить «' + esc(q.length > 40 ? q.slice(0, 40) + '…' : q) + '» как есть</button></div><div class="mv-res-foot chips">' + sites + '</div>';
    const top = box.scrollTop;
    box.innerHTML = h; box.scrollTop = top;
}
function mvsHit(key) {
    const p = String(key || '').split(':'), r = mvsUi.res[p[0]];
    return r && r.hits ? r.hits[+p[1]] : null;
}

// ---------- Запуск поиска ----------
async function mvsRunOne(s, q, seq) {
    if (!s.ready()) { mvsUi.res[s.id] = { state: 'nokey', hits: [] }; return; }
    mvsUi.res[s.id] = { state: 'load', hits: [] };
    try {
        const hits = await s.run(q);
        if (seq !== mvsUi.seq) return;
        mvsUi.res[s.id] = { state: 'ok', hits };
    } catch (e) {
        if (seq !== mvsUi.seq) return;
        mvsUi.res[s.id] = { state: 'err', hits: [], msg: e && e.message ? e.message : 'ошибка' };
    }
}
async function mvsRunSearch(raw) {
    const q = String(raw || '').trim(), box = $('#movie-results');
    $('#movie-search-clear').hidden = !$('#movie-search').value;
    const seq = ++mvsUi.seq;
    if (q.length < 2) { box.hidden = true; box.innerHTML = ''; mvsUi.q = ''; return; }
    mvsUi.q = q; mvsUi.res = {}; box.hidden = false;
    MV_SEARCH_SOURCES.forEach(s => { mvsUi.res[s.id] = { state: s.ready() ? 'load' : 'nokey', hits: [] }; });
    mvsRender();
    await Promise.all(MV_SEARCH_SOURCES.filter(s => s.ready()).map(async s => { await mvsRunOne(s, q, seq); if (seq === mvsUi.seq) mvsRender(); }));
}
function mvsClose() { const b = $('#movie-results'); if (b) b.hidden = true; }
function mvsClear(focus) {
    const s = $('#movie-search'); s.value = ''; mvsUi.seq++; mvsUi.q = ''; mvsUi.res = {};
    const b = $('#movie-results'); b.hidden = true; b.innerHTML = ''; $('#movie-search-clear').hidden = true;
    if (focus) s.focus();
}
async function mvsAdd(h, status) {
    try {
        const r = await mvAddMovie(mvsHitSpec(h), status, { src: 'search:' + h.src });
        const where = status === 'watching' ? 'смотрю сейчас' : status === 'watched' ? 'просмотрено' : 'в списке для просмотра';
        if (r.dup) toast('«' + r.movie.title + '» уже в вашем списке');
        else {   // меню закрываем: так сразу видно, что фильм добавлен; «Показать» ведёт к блоку «Все фильмы»
            mvsClear(false);
            toast('«' + r.movie.title + '» — ' + where + (r.warn.length ? ' · ' + r.warn[0] : ''), { ms: r.warn.length ? 5600 : 4600, action: 'Показать', onAction: () => { if (typeof gotoCard === 'function') gotoCard('movies-all-card'); } });
        }
    } catch (e) { toast('Не удалось добавить: ' + e.message); }
    if (!$('#movie-results').hidden) mvsRender();
}
async function mvsAddManual(title) {
    mvsClear(false);
    try {
        const r = await mvAddMovie({ title }, 'queue', { src: 'manual' });
        toast(r.dup ? '«' + r.movie.title + '» уже в вашем списке' : '«' + r.movie.title + '» — в списке для просмотра' + (r.warn.length ? ' · ' + r.warn[0] : ''), { ms: r.warn.length ? 5200 : 3200 });
    } catch (e) { toast('Не удалось добавить: ' + e.message); }
}

function initMovieSearch() {
    const si = $('#movie-search'); if (!si) return;
    const run = debounce(() => mvsRunSearch(si.value), 420);
    si.addEventListener('input', () => { $('#movie-search-clear').hidden = !si.value; run(); });
    si.addEventListener('focus', () => { if (mvsUi.q && si.value.trim() === mvsUi.q && $('#movie-results').innerHTML) $('#movie-results').hidden = false; });
    si.addEventListener('keydown', e => {
        if (e.key === 'Enter') { e.preventDefault(); mvsRunSearch(si.value); }
        else if (e.key === 'Escape') { if (!$('#movie-results').hidden) mvsClose(); else mvsClear(false); }
    });
    $('#movie-search-clear').addEventListener('click', () => mvsClear(true));
    $('#movie-results').addEventListener('click', e => {
        const add = e.target.closest('[data-res-add]'), man = e.target.closest('[data-res-manual]'), go = e.target.closest('[data-goto-settings]');
        const tab = e.target.closest('[data-ms-tab]'), close = e.target.closest('[data-ms-close]'), retry = e.target.closest('[data-ms-retry]');
        if (go) { openMoviesSettings(); return; }
        if (close) { mvsClose(); return; }
        if (tab) { mvsUi.tab = tab.dataset.msTab; mvsRender(); return; }
        if (retry) { const s = MVS_BY_ID[retry.dataset.msRetry], seq = mvsUi.seq; mvsUi.res[s.id] = { state: 'load', hits: [] }; mvsRender(); mvsRunOne(s, mvsUi.q, seq).then(() => { if (seq === mvsUi.seq) mvsRender(); }); return; }
        if (add) { const h = mvsHit(add.closest('.mv-res').dataset.k); if (h) mvsAdd(h, add.dataset.resAdd); return; }
        if (man) { const q = si.value.trim(); if (q) mvsAddManual(q); }
    });
    // меню закрывается нажатием в стороне (текст в строке остаётся)
    document.addEventListener('pointerdown', e => {
        const box = $('#movie-results'); if (!box || box.hidden) return;
        if (e.target.closest('#mv-add') || e.target.closest('.sheet-overlay') || e.target.closest('.toast')) return;
        mvsClose();
    });
}
