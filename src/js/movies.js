'use strict';
// =====================================================================================================
// iLife — СТРАНИЦА «КИНО»: поиск фильма по названию, «Смотрю сейчас», распознавание скриншотов (js/recognize.js),
// «Список для просмотра» и «Просмотрено». Источники данных и оценок — js/moviedb.js. PDF — js/pdf-export.js.
//
// Запись: { id, status: 'queue'|'watching'|'watched', type: 'movie'|'tv', title, origTitle, year, runtime, seasons, genres[],
//           directors[], cast[], overview, tmdbId, imdbId, kpId, posterPath, coverId (обложка в IndexedDB), posterUrl,
//           ratings: { kp, imdb, tmdb, rt, mc }, ratingsAt, myRating (1–10|null), note, src, addedAt, startedAt, watchedAt, updatedAt }
// Записи сливаются между устройствами через Google Диск так же, как идеи и дела (см. G_LISTS в js/gdrive.js);
// обложки — как вложения. Ключи сервисов (TMDB, OMDb, Кинопоиск, ИИ) не входят в копию данных, но синхронизируются через Google Диск (gdrive.js).
// =====================================================================================================

let movies = LS.get('movies', []);
if (!Array.isArray(movies)) movies = [];
const mvUi = Object.assign({ sort: 'new', view: 'cards', allSort: 'new', allFilter: 'all' }, LS.get('movie_ui', {}));   // view: 'cards' (с обложками) | 'list' (списком, без обложек)
const mvShown = { queue: 24, watched: 24, all: 24, watching: 24 };
const mvBusy = new Set();           // id фильмов, у которых прямо сейчас подгружаются данные
let mvRefreshing = false;

const MV_STATUS = { queue: 'Хочу посмотреть', watching: 'Смотрю', watched: 'Просмотрено' };
const MV_SHORT = { kp: 'Кинопоиск', imdb: 'IMDb', tmdb: 'TMDB', rt: 'Rotten T.', mc: 'Metacritic' };
const MV_RATE_WORDS = ['', 'Ужасно', 'Очень плохо', 'Плохо', 'Слабо', 'Средне', 'Неплохо', 'Хорошо', 'Очень хорошо', 'Отлично', 'Шедевр'];
const MV_FIELDS = ['title', 'origTitle', 'year', 'runtime', 'seasons', 'overview', 'imdbId', 'posterPath', 'posterUrl', 'coverId', 'genres', 'directors', 'cast', 'tmdbId', 'type', 'ratings', 'ratingsAt', 'kpId'];

function saveMovies() { if (typeof cloudLocalChanged === 'function') cloudLocalChanged(); return LS.set('movies', movies); }
function mvById(id) { return movies.find(m => m.id === id); }
function mvPlural(n, one, few, many) { const a = Math.abs(n) % 100, b = a % 10; return a > 10 && a < 20 ? many : b > 1 && b < 5 ? few : b === 1 ? one : many; }
function mvStatusOf(m) { return m.status === 'watching' || m.status === 'watched' ? m.status : 'queue'; }
function mvJoin(list, n) { return (list || []).slice(0, n).join(', '); }

// ---------- Поиск повторов ----------
function mvFindDup(spec) {
    const nt = mvNorm(spec.title), nto = mvNorm(spec.origTitle), tid = spec.tmdbId, ty = spec.type === 'tv' ? 'tv' : 'movie';
    return movies.find(m => {
        const mty = m.type === 'tv' ? 'tv' : 'movie';
        if (spec.imdbId && m.imdbId && spec.imdbId === m.imdbId) return true;                          // один и тот же фильм, выбранный на разных площадках
        if (spec.kpId && m.kpId && String(spec.kpId) === String(m.kpId)) return true;
        if (tid && m.tmdbId) return m.tmdbId === tid && mty === ty;
        if (mty !== ty) return false;
        const mt = mvNorm(m.title), mo = mvNorm(m.origTitle);
        const same = (nt && (nt === mt || nt === mo)) || (nto && (nto === mt || nto === mo));
        if (!same) return false;
        return !(spec.year && m.year && spec.year !== m.year);
    });
}

// ---------- Добавление и подгрузка данных ----------
// Обложка из скриншота — на случай, когда фильма нет в базе: лучше кадр, чем пустая рамка
async function mvStoreShotCover(file) {
    const bmp = await decodeImage(file), s = bitmapSize(bmp);
    const r = await canvasBlob(bmp, s.w, s.h, 420, 0.8);
    if (bmp.close) try { bmp.close(); } catch (e) {}
    if (!r.blob) throw new Error('не удалось подготовить обложку');
    const id = uid('c');
    await BlobDB.put({ id, blob: r.blob, name: 'screenshot.jpg', type: 'image/jpeg', size: r.blob.size });
    return id;
}
// Работаем с копией и переносим результат в текущую запись: за время загрузки её могли изменить или заменить синхронизацией
async function mvEnrichInPlace(id, o) {
    o = o || {};
    const src = mvById(id); if (!src) return [];
    mvBusy.add(id); renderMovies();
    const work = JSON.parse(JSON.stringify(src));
    let warn = [];
    try { warn = await mvEnrich(work, { forcePoster: !!o.forcePoster }); } catch (e) { warn = [e.message || 'ошибка']; }
    const cur = mvById(id);
    mvBusy.delete(id);
    if (!cur) { if (work.coverId && work.coverId !== src.coverId) await BlobDB.del(work.coverId); renderMovies(); return warn; }
    MV_FIELDS.forEach(k => { if (work[k] !== undefined) cur[k] = work[k]; });
    if (!cur.coverId && !cur.posterUrl && o.fallbackFile) { try { cur.coverId = await mvStoreShotCover(o.fallbackFile); } catch (e) { /* без обложки */ } }
    saveMovies(); renderMovies();
    return warn;
}
// spec: результат поиска в TMDB или просто { title, year?, type? }. Возвращает { movie, dup, warn[] }
async function mvAddMovie(spec, status, o) {
    o = o || {};
    const title = String(spec.title || '').replace(/\s+/g, ' ').trim().slice(0, 160);
    if (!title) throw new Error('пустое название');
    const dup = mvFindDup(Object.assign({}, spec, { title }));
    if (dup) return { dup: true, movie: dup, warn: [] };
    const now = Date.now(), st = status === 'watching' || status === 'watched' ? status : 'queue';
    const m = { id: uid('m'), status: st, type: spec.type === 'tv' ? 'tv' : 'movie', title, origTitle: spec.origTitle || '', year: spec.year || null, tmdbId: spec.tmdbId || null,
        posterPath: spec.posterPath || '', overview: spec.overview || '', ratings: {}, myRating: null, note: '', src: o.src || 'search', addedAt: now, updatedAt: now };
    if (spec.imdbId) m.imdbId = spec.imdbId;                       // фильм выбран на другой площадке (Кинопоиск, IMDb, TVMaze): запоминаем её номера и обложку
    if (spec.kpId) m.kpId = spec.kpId;
    if (spec.posterUrl && (!spec.tmdbId || !mvHasTmdb())) m.posterUrl = spec.posterUrl;
    if (spec.genres && spec.genres.length) m.genres = spec.genres.slice(0, 4);
    if (spec.ratings) Object.keys(spec.ratings).forEach(k => { if (spec.ratings[k] > 0) m.ratings[k] = spec.ratings[k]; });
    if (spec.tmdb) m.ratings.tmdb = spec.tmdb;
    if (st === 'watching') m.startedAt = now;
    if (st === 'watched') m.watchedAt = now;
    movies.unshift(m);
    if (!saveMovies()) { movies.shift(); throw new Error('не хватило места в памяти браузера'); }
    renderMovies();
    const warn = await mvEnrichInPlace(m.id, { fallbackFile: o.fallbackFile });
    return { dup: false, movie: mvById(m.id) || m, warn };
}

// ---------- Смена статуса, оценка, удаление ----------
function mvSnapshot(m) { return { status: m.status, startedAt: m.startedAt, watchedAt: m.watchedAt, myRating: m.myRating, note: m.note }; }
function mvRestore(id, snap) {
    const cur = mvById(id); if (!cur) return;
    Object.keys(snap).forEach(k => { if (snap[k] === undefined) delete cur[k]; else cur[k] = snap[k]; });
    saveMovies(); renderMovies();
}
function mvSetStatus(id, status, extra) {
    const m = mvById(id); if (!m) return;
    const snap = mvSnapshot(m), now = Date.now();
    m.status = status;
    if (status === 'watching') m.startedAt = now;
    if (status === 'watched') m.watchedAt = now;
    Object.assign(m, extra || {});
    saveMovies(); renderMovies();
    const what = status === 'watching' ? 'смотрю сейчас' : status === 'watched' ? 'просмотрено' : 'в списке для просмотра';
    toast('«' + m.title + '» — ' + what, { action: 'Отменить', onAction: () => mvRestore(id, snap) });
}
// Оценка 1–10 и заметка. watchMode: фильм ещё не отмечен просмотренным — кнопка «Посмотрел» делает обе вещи сразу
function openRateSheet(id, watchMode) {
    const m = mvById(id); if (!m) return;
    let val = m.myRating || 0;
    const html = '<p class="hint" style="margin-bottom:0.75rem">' + esc(m.title) + (m.year ? ' (' + m.year + ')' : '') + '</p>' +
        '<div class="rate-grid" id="rate-grid">' + [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(n => '<button type="button" class="rate-btn' + (n === val ? ' is-on' : '') + '" data-r="' + n + '" aria-label="Оценка ' + n + '">' + n + '</button>').join('') + '</div>' +
        '<p class="rate-word" id="rate-word"></p>' +
        '<label class="field-label" for="rate-note" style="margin-top:0.5rem">Заметка (необязательно)</label><textarea id="rate-note" rows="3" maxlength="600" placeholder="Что понравилось, с кем смотрели…"></textarea>';
    const paint = el => {
        $$('.rate-btn', el).forEach(b => b.classList.toggle('is-on', +b.dataset.r === val));
        $('#rate-word', el).textContent = val ? val + ' из 10 — ' + MV_RATE_WORDS[val] : (watchMode ? 'Оценку можно не ставить — просто нажмите «Посмотрел»' : 'Выберите оценку');
    };
    const read = el => ({ rating: val || null, note: $('#rate-note', el).value.trim() });
    const actions = [{ label: 'Отмена' }];
    if (!watchMode && m.myRating) actions.push({ label: 'Убрать оценку', kind: 'danger', onClick(sh) { const c = mvById(id); if (c) { c.myRating = null; c.note = $('#rate-note', sh.el).value.trim(); saveMovies(); renderMovies(); toast('Оценка убрана'); } } });
    actions.push({ label: watchMode ? 'Посмотрел' : 'Сохранить', kind: 'primary', icon: 'check', onClick(sh) {
        const { rating, note } = read(sh.el), c = mvById(id); if (!c) return;
        if (watchMode) { mvSetStatus(id, 'watched', { myRating: rating || c.myRating || null, note: note || c.note || '' }); return; }
        c.myRating = rating; c.note = note; saveMovies(); renderMovies(); toast(rating ? 'Ваша оценка: ' + rating + ' из 10' : 'Заметка сохранена');
    } });
    const sheet = openSheet({ title: watchMode ? 'Фильм просмотрен' : 'Моя оценка', html, actions });
    $('#rate-note', sheet.el).value = m.note || '';
    paint(sheet.el);
    $('#rate-grid', sheet.el).addEventListener('click', e => { const b = e.target.closest('.rate-btn'); if (!b) return; val = val === +b.dataset.r && !watchMode ? 0 : +b.dataset.r; paint(sheet.el); });
}
async function mvDelete(id) {
    const m = mvById(id); if (!m) return;
    if (!(await confirmSheet('Удалить «' + m.title + '»?', 'Фильм исчезнет из списка на всех ваших устройствах (если подключён Google Диск). Оценка и заметка тоже будут удалены.', 'Удалить', true))) return;
    if (m.coverId) await BlobDB.del(m.coverId);
    movies = movies.filter(x => x.id !== id);
    saveMovies(); renderMovies(); toast('Фильм удалён');
}
async function mvRefreshOne(id) {
    const m = mvById(id); if (!m || mvBusy.has(id)) return;
    if (!mvHasTmdb() && !mvKey('omdb') && !mvKey('kp')) { toast('Чтобы подтянуть данные, подключите ключи в Настройках → Кино'); return; }
    const warn = await mvEnrichInPlace(id, {});
    toast(warn.length ? 'Обновлено не полностью: ' + warn[0] : 'Данные и оценки обновлены', { ms: warn.length ? 5200 : 3200 });
}
async function mvRefreshAll() {
    if (mvRefreshing) return;
    const ids = movies.filter(m => mvStatusOf(m) !== 'watched').map(m => m.id);
    if (!ids.length) { toast('В списке нет фильмов для обновления'); return; }
    if (!mvHasTmdb() && !mvKey('omdb') && !mvKey('kp')) { toast('Чтобы подтянуть оценки, подключите ключи в Настройках → Кино'); return; }
    mvRefreshing = true; const btn = $('#movies-refresh'); btn.disabled = true;
    toast('Обновляем данные: ' + ids.length + '…');
    try {
        const res = await mvPool(ids, 2, id => mvEnrichInPlace(id, {}));
        const bad = res.filter(r => !r || r.error || r.length).length;
        toast(bad ? 'Обновлено: ' + (ids.length - bad) + ' из ' + ids.length + '. Остальные источники не ответили — попробуйте позже' : 'Оценки обновлены у ' + ids.length + ' ' + mvPlural(ids.length, 'фильма', 'фильмов', 'фильмов'), { ms: 5000 });
    } finally { mvRefreshing = false; btn.disabled = false; }
}

// ---------- Показ: карточка фильма ----------
function mvScore(m) {
    const r = m.ratings || {}, a = mvAvgRating(r); if (a) return a;
    for (const s of MV_SOURCES) { const v = Number(r[s.key]); if (v > 0) return s.scale === 100 ? v / 10 : v; }
    return 0;
}
function mvMetaLine(m) {
    const p = [];
    if (m.year) p.push(m.year);
    p.push(m.type === 'tv' ? 'сериал' + (m.seasons ? ', ' + m.seasons + ' ' + mvPlural(m.seasons, 'сезон', 'сезона', 'сезонов') : '') : 'фильм');
    if (m.runtime) p.push(m.runtime + ' мин');
    if (m.genres && m.genres.length) p.push(m.genres.slice(0, 3).join(', '));
    return p.join(' · ');
}
function mvWhen(m) {
    const st = mvStatusOf(m);
    if (st === 'watching') return 'Смотрю с ' + fmtDate(m.startedAt || m.addedAt);
    if (st === 'watched') return 'Просмотрено ' + fmtDate(m.watchedAt || m.updatedAt, true);
    return 'Добавлено ' + fmtDate(m.addedAt);
}
function mvPosterHtml(m) {
    const ph = '<span class="ph">' + ic(m.type === 'tv' ? 'tv' : 'movie') + '</span>';
    if (m.coverId) return ph + '<img alt="" loading="lazy" data-blob="' + esc(m.coverId) + '">';
    if (m.posterUrl) return ph + '<img alt="" loading="lazy" referrerpolicy="no-referrer" src="' + esc(m.posterUrl) + '">';
    return ph;
}
function mvRatesHtml(m, full) {
    const r = m.ratings || {}, t = [];
    MV_SOURCES.forEach(s => {
        const v = Number(r[s.key]);
        if (v > 0) t.push('<span class="rt ' + mvRatingClass(s, v) + '" title="' + esc(s.name) + '"><b>' + esc(mvRatingText(s, v)) + '</b><i>' + esc(full ? s.name : MV_SHORT[s.key]) + '</i></span>');
    });
    const avg = mvAvgRating(r);
    if (avg) t.push('<span class="rt rt-avg" title="Среднее по источникам (шкалы приведены к 10)"><b>' + String(avg).replace('.', ',') + '</b><i>Среднее</i></span>');
    return t.join('');
}
function mvPeopleHtml(m, all) {
    let h = '';
    const d = m.directors || [];
    if (d.length) h += '<div><b>' + (m.type === 'tv' ? (d.length > 1 ? 'Создатели' : 'Создатель') : (d.length > 1 ? 'Режиссёры' : 'Режиссёр')) + ':</b> ' + esc(d.join(', ')) + '</div>';
    if ((m.cast || []).length) h += '<div><b>В ролях:</b> ' + esc(mvJoin(m.cast, all ? 12 : 5)) + '</div>';
    return h;
}
function mvCardHtml(m) {
    const st = mvStatusOf(m), busy = mvBusy.has(m.id);
    const rates = mvRatesHtml(m), people = mvPeopleHtml(m, false);
    const anyKey = mvHasTmdb() || mvKey('omdb') || mvKey('kp');
    let note = '';
    if (busy) note = 'Загружаем данные…';
    else if (!rates) note = anyKey ? 'Оценок пока нет — нажмите «Обновить» (значок со стрелками)' : 'Оценки, режиссёр и актёры появятся после подключения ключей: Настройки → Кино';
    const acts = st === 'queue' ? [['start', 'Смотрю', 'visibility', 'btn'], ['watch', 'Посмотрел', 'done_all', 'btn btn-primary']]
        : st === 'watching' ? [['queue', 'В список', 'undo', 'btn'], ['watch', 'Посмотрел', 'done_all', 'btn btn-primary']]
        : [['queue', 'Смотреть снова', 'playlist_add', 'btn']];
    return '<article class="movie' + (busy ? ' is-busy' : '') + '" data-id="' + esc(m.id) + '">' +
        '<button type="button" class="mv-poster" data-mv="info" aria-label="Подробнее: ' + esc(m.title) + '">' + mvPosterHtml(m) + '</button>' +
        '<div class="mv-main"><button type="button" class="mv-name" data-mv="info">' + esc(m.title) + '</button>' +
        '<div class="mv-sub">' + esc(mvMetaLine(m)) + '</div>' +
        (m.origTitle && mvNorm(m.origTitle) !== mvNorm(m.title) ? '<div class="mv-orig">' + esc(m.origTitle) + '</div>' : '') +
        (rates ? '<div class="mv-rates">' + rates + '</div>' : '') +
        (note ? '<p class="hint mv-hint">' + esc(note) + '</p>' : '') +
        (people ? '<div class="mv-people">' + people + '</div>' : '') +
        '<div class="mv-when">' + esc(mvWhen(m)) + '</div></div>' +
        (m.note ? '<p class="mv-comment">«' + esc(m.note) + '»</p>' : '') +
        '<div class="mv-mine"><button type="button" class="btn mv-rate' + (m.myRating ? ' is-set' : '') + '" data-mv="rate">' + ic(m.myRating ? 'star' : 'star_border') + (m.myRating ? 'Моя оценка: ' + m.myRating + '/10' : 'Моя оценка') + '</button>' +
        '<span class="grow"></span>' +
        '<button type="button" class="icon-btn" data-mv="refresh" aria-label="Обновить данные и оценки"' + (busy ? ' disabled' : '') + '>' + ic('refresh') + '</button>' +
        '<button type="button" class="icon-btn is-danger" data-mv="del" aria-label="Удалить">' + ic('delete') + '</button></div>' +
        '<div class="mv-acts">' + acts.map(a => '<button type="button" class="' + a[3] + '" data-mv="' + a[0] + '">' + ic(a[2]) + a[1] + '</button>').join('') + '</div>' +
        '</article>';
}

// ---------- Показ: страница ----------
function mvSorted(list, key) {
    const a = list.slice();
    if (key === 'rating') a.sort((x, y) => mvScore(y) - mvScore(x) || (y.addedAt || 0) - (x.addedAt || 0));
    else if (key === 'title') a.sort((x, y) => String(x.title).localeCompare(String(y.title), 'ru'));
    else if (key === 'year') a.sort((x, y) => (y.year || 0) - (x.year || 0) || (y.addedAt || 0) - (x.addedAt || 0));
    else a.sort((x, y) => (y.addedAt || 0) - (x.addedAt || 0));
    return a;
}
function mvHydrate(root) {
    root.querySelectorAll('img[data-blob]').forEach(async im => {
        const u = await BlobDB.url(im.dataset.blob);
        if (u) im.src = u; else im.style.display = 'none';
    });
}
// Строка списка без обложки (вид «Списком»): название, год и тип, среднее по оценкам, ваша оценка, статус и меню действий
const MV_ST_ICON = { queue: 'bookmark', watching: 'visibility', watched: 'done_all' };
function mvRowHtml(m, showStatus) {
    const st = mvStatusOf(m), sc = mvScore(m), busy = mvBusy.has(m.id);
    const cls = sc >= 7.5 ? 'r-good' : sc >= 6 ? 'r-mid' : 'r-bad';
    return '<article class="mv-row' + (busy ? ' is-busy' : '') + '" data-id="' + esc(m.id) + '">' +
        '<button type="button" class="mv-row-main" data-mv="info" aria-label="Подробнее: ' + esc(m.title) + '"><span class="mv-row-title">' + esc(m.title) + '</span>' +
        '<span class="mv-row-sub">' + esc(mvMetaLine(m)) + (m.origTitle && mvNorm(m.origTitle) !== mvNorm(m.title) ? ' · ' + esc(m.origTitle) : '') + '</span></button>' +
        (m.myRating ? '<span class="mv-row-mine" title="Моя оценка">' + ic('star') + m.myRating + '</span>' : '') +
        (sc ? '<span class="rt ' + cls + ' mv-row-rt" title="Среднее по источникам"><b>' + String(mvRound1(sc)).replace('.', ',') + '</b></span>' : '') +
        (showStatus ? '<span class="mv-row-st st-' + st + '" title="' + esc(MV_STATUS[st]) + '">' + ic(MV_ST_ICON[st]) + '</span>' : '') +
        '<button type="button" class="icon-btn" data-mv="menu" aria-label="Действия: ' + esc(m.title) + '">' + ic('more_vert') + '</button></article>';
}
function mvListHtml(list, key, showStatus) {
    const slice = list.slice(0, mvShown[key] || 9999), list_ = mvUi.view === 'list';
    return '<div class="' + (list_ ? 'mv-rows' : 'mv-items') + '">' + slice.map(m => list_ ? mvRowHtml(m, !!showStatus) : mvCardHtml(m)).join('') + '</div>' +
        (list.length > slice.length ? '<div style="text-align:center;margin:0.75rem 0 0.25rem"><button type="button" class="btn" data-mv="more" data-list="' + key + '">Показать ещё (' + (list.length - slice.length) + ')</button></div>' : '');
}
function mvAllList() {
    let a = movies.slice();
    if (mvUi.allFilter !== 'all') a = a.filter(m => mvStatusOf(m) === mvUi.allFilter);
    return mvSorted(a, mvUi.allSort);
}
function renderMovies() {
    if (!$('#movies-queue')) return;
    const by = s => movies.filter(m => mvStatusOf(m) === s);
    const watching = by('watching').sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0));
    const queue = mvSorted(by('queue'), mvUi.sort);
    const watched = by('watched').sort((a, b) => (b.watchedAt || 0) - (a.watchedAt || 0));
    const all = mvAllList();
    $('#movies-watching-n').textContent = watching.length || '';
    $('#movies-queue-n').textContent = queue.length || '';
    $('#movies-watched-n').textContent = watched.length || '';
    $('#movies-all-n').textContent = movies.length || '';
    $('#movies-watching').innerHTML = watching.length ? mvListHtml(watching, 'watching')
        : '<div class="mv-empty">' + ic('tv') + '<span>Сейчас ничего не смотрите. Нажмите «Смотрю» у фильма из списка — он появится здесь.</span></div>';
    $('#movies-queue').innerHTML = queue.length ? mvListHtml(queue, 'queue')
        : '<div class="empty"><div class="ico-big">' + ic('bookmark') + '</div><b>Список пока пуст</b>Найдите фильм по названию в строке «Добавить фильм» сверху или загрузите скриншоты — найденное появится здесь.</div>';
    $('#movies-watched').innerHTML = watched.length ? mvListHtml(watched, 'watched')
        : '<div class="mv-empty">' + ic('done_all') + '<span>Здесь будут фильмы, которые вы отметили кнопкой «Посмотрел», — с вашими оценками.</span></div>';
    $('#movies-all').innerHTML = all.length ? mvListHtml(all, 'all', true)
        : movies.length ? '<div class="mv-empty">' + ic('filter_list') + '<span>В этом разделе фильмов нет — выберите другой фильтр.</span></div>'
        : '<div class="mv-empty">' + ic('movie') + '<span>Все фильмы и сериалы, которые вы добавили, собираются здесь — что бы вы с ними ни делали. Начните с строки «Добавить фильм» сверху.</span></div>';
    $$('#movies-sort button').forEach(b => b.classList.toggle('is-on', b.dataset.sort === mvUi.sort));
    $$('#movies-view button').forEach(b => { const on = b.dataset.view === mvUi.view; b.classList.toggle('is-on', on); b.setAttribute('aria-pressed', on ? 'true' : 'false'); });
    $$('#movies-all-filter button').forEach(b => b.classList.toggle('is-on', b.dataset.f === mvUi.allFilter));
    $('#movies-all-sort').value = mvUi.allSort;
    $('#movies-sort').hidden = queue.length < 2;
    $('#movies-all-bar').hidden = !movies.length;
    $('#movies-refresh').hidden = !queue.length && !watching.length;
    $('#movies-pdf').disabled = !movies.length;
    const keys = mvHasTmdb();
    $('#movies-banner').hidden = keys;
    mvHydrate($('#movies'));
    if (typeof renderScanEngines === 'function') renderScanEngines();
}

// Меню действий у строки списка (в виде «Списком» кнопок на строке мало, остальное — здесь)
function openMovieMenu(id) {
    const m = mvById(id); if (!m) return;
    const st = mvStatusOf(m), rows = [['info', 'info', 'О фильме']];
    if (st !== 'watching') rows.push(['start', 'visibility', 'Смотрю сейчас']);
    if (st !== 'watched') rows.push(['watch', 'done_all', 'Посмотрел' + '…']);
    if (st !== 'queue') rows.push(['queue', 'bookmark', st === 'watched' ? 'Смотреть снова' : 'Вернуть в список']);
    rows.push(['rate', m.myRating ? 'star' : 'star_border', m.myRating ? 'Моя оценка: ' + m.myRating + '/10' : 'Моя оценка']);
    rows.push(['refresh', 'refresh', 'Обновить данные и оценки']);
    rows.push(['edit', 'edit', 'Изменить']);
    rows.push(['del', 'delete', 'Удалить']);
    const html = '<p class="hint" style="margin:0 4px 8px">' + esc(m.title) + (m.year ? ' (' + m.year + ')' : '') + ' · ' + esc(MV_STATUS[st]) + '</p><div class="mv-menu">' +
        rows.map(r => '<button type="button" class="mv-menu-row' + (r[0] === 'del' ? ' is-danger' : '') + '" data-m="' + r[0] + '">' + ic(r[1]) + '<span>' + esc(r[2]) + '</span></button>').join('') + '</div>';
    const sheet = openSheet({ title: 'Фильм', html, actions: [{ label: 'Закрыть' }] });
    sheet.el.addEventListener('click', e => {
        const b = e.target.closest('[data-m]'); if (!b) return;
        const act = b.dataset.m; sheet.close();
        setTimeout(() => {
            if (act === 'info') openMovieInfo(id); else if (act === 'rate') openRateSheet(id, false); else if (act === 'watch') openRateSheet(id, true);
            else if (act === 'start') mvSetStatus(id, 'watching'); else if (act === 'queue') mvSetStatus(id, 'queue');
            else if (act === 'refresh') mvRefreshOne(id); else if (act === 'edit') openMovieEdit(id); else if (act === 'del') mvDelete(id);
        }, 200);
    });
}

// ---------- Подробности и правка ----------
function openMovieInfo(id) {
    const m = mvById(id); if (!m) return;
    const links = [];
    if (m.imdbId) links.push(['IMDb', 'https://www.imdb.com/title/' + encodeURIComponent(m.imdbId) + '/']);
    if (m.kpId) links.push(['Кинопоиск', 'https://www.kinopoisk.ru/film/' + encodeURIComponent(m.kpId) + '/']);
    if (m.tmdbId) links.push(['TMDB', 'https://www.themoviedb.org/' + (m.type === 'tv' ? 'tv' : 'movie') + '/' + encodeURIComponent(m.tmdbId)]);
    const rates = mvRatesHtml(m, true);
    const html = '<div class="mv-info"><div class="mv-info-top"><div class="mv-poster is-static">' + mvPosterHtml(m) + '</div><div class="mv-main">' +
        '<h4 class="mv-info-title">' + esc(m.title) + '</h4><div class="mv-sub">' + esc(mvMetaLine(m)) + '</div>' +
        (m.origTitle && mvNorm(m.origTitle) !== mvNorm(m.title) ? '<div class="mv-orig">' + esc(m.origTitle) + '</div>' : '') +
        '<div class="mv-when">' + esc(MV_STATUS[mvStatusOf(m)] + ' · ' + mvWhen(m)) + '</div></div></div>' +
        (rates ? '<div class="mv-rates">' + rates + '</div>' : '<p class="hint">Оценок пока нет.</p>') +
        (m.myRating ? '<p class="mv-mine-line">' + ic('star') + 'Моя оценка: <b>' + m.myRating + ' из 10</b> — ' + esc(MV_RATE_WORDS[m.myRating]) + '</p>' : '') +
        (m.note ? '<p class="mv-comment">«' + esc(m.note) + '»</p>' : '') +
        '<div class="mv-people">' + mvPeopleHtml(m, true) + '</div>' +
        (m.overview ? '<p class="mv-over">' + esc(m.overview) + '</p>' : '') +
        (links.length ? '<div class="chips">' + links.map(l => '<a class="chip" target="_blank" rel="noopener noreferrer" href="' + esc(l[1]) + '">' + ic('open_in_new') + esc(l[0]) + '</a>').join('') + '</div>' : '') + '</div>';
    const sheet = openSheet({ title: 'О фильме', html, actions: [{ label: 'Закрыть' }, { label: 'Изменить', icon: 'edit', onClick() { setTimeout(() => openMovieEdit(id), 220); } }] });
    mvHydrate(sheet.el);
}
function openMovieEdit(id) {
    const m = mvById(id); if (!m) return;
    const html = '<label class="field-label" for="me-title">Название</label><input type="text" id="me-title" maxlength="160">' +
        '<div class="mv-edit-pair"><div><label class="field-label" for="me-year">Год</label><input type="number" id="me-year" inputmode="numeric" min="1888" max="2100"></div>' +
        '<div><label class="field-label" for="me-type">Тип</label><select id="me-type"><option value="movie">Фильм</option><option value="tv">Сериал</option></select></div></div>' +
        '<label class="field-label" for="me-dir" style="margin-top:0.75rem">Режиссёр (через запятую)</label><input type="text" id="me-dir" maxlength="200">' +
        '<label class="field-label" for="me-cast" style="margin-top:0.75rem">В ролях (через запятую)</label><input type="text" id="me-cast" maxlength="400">' +
        '<label class="field-label" for="me-note" style="margin-top:0.75rem">Заметка</label><textarea id="me-note" rows="3" maxlength="600"></textarea>' +
        '<p class="hint" style="margin-top:0.5rem">Если исправили название или год, нажмите значок обновления у карточки — данные и оценки подтянутся заново.</p>';
    const split = s => Array.from(new Set(String(s || '').split(/[,;]+/).map(x => x.trim()).filter(Boolean))).slice(0, 12);
    const sheet = openSheet({ title: 'Изменить', html, actions: [{ label: 'Отмена' }, { label: 'Сохранить', kind: 'primary', icon: 'check', onClick(sh) {
        const c = mvById(id); if (!c) return;
        const title = $('#me-title', sh.el).value.replace(/\s+/g, ' ').trim();
        if (!title) { toast('Название не может быть пустым'); return false; }
        const year = parseInt($('#me-year', sh.el).value, 10);
        const retitled = mvNorm(title) !== mvNorm(c.title) || (year || null) !== (c.year || null);
        c.title = title; c.year = year > 1800 && year < 2200 ? year : null; c.type = $('#me-type', sh.el).value === 'tv' ? 'tv' : 'movie';
        c.directors = split($('#me-dir', sh.el).value); c.cast = split($('#me-cast', sh.el).value); c.note = $('#me-note', sh.el).value.trim();
        if (retitled && c.tmdbId) { c.tmdbId = null; c.imdbId = ''; c.kpId = null; }   // название изменили — старая привязка к базе больше не верна
        saveMovies(); renderMovies(); toast(retitled && mvHasTmdb() ? 'Сохранено. Нажмите значок обновления, чтобы найти фильм в базе' : 'Изменения сохранены');
    } }] });
    $('#me-title', sheet.el).value = m.title || ''; $('#me-year', sheet.el).value = m.year || ''; $('#me-type', sheet.el).value = m.type === 'tv' ? 'tv' : 'movie';
    $('#me-dir', sheet.el).value = (m.directors || []).join(', '); $('#me-cast', sheet.el).value = (m.cast || []).join(', '); $('#me-note', sheet.el).value = m.note || '';
}

// ---------- Поиск фильма по названию: см. js/moviesearch.js (меню с результатами с нескольких площадок) ----------

// ---------- Настройки → Кино (ключи: на устройстве и, по желанию, на вашем Google Диске) ----------
function renderMoviesCard() {
    if (!$('#movies-cfg-card')) return;
    const c = mvCfg();
    const set = (sel, v) => { const el = $(sel); if (el && document.activeElement !== el) el.value = v || ''; };
    set('#mvc-tmdb', c.tmdb); set('#mvc-omdb', c.omdb); set('#mvc-kp', c.kp); set('#mvc-ai', c.ai || 'none'); set('#mvc-aikey', c.aiKey); set('#mvc-aimodel', c.aiModel);
    $('#mvc-aimodel').placeholder = MV_AI_MODELS[c.ai] || 'название модели';
    $('#mvc-aiauto').checked = !!c.aiAuto;
    $('#mvc-ai-fields').hidden = !(c.ai === 'gemini' || c.ai === 'claude');
    $('#mvc-ai-link').innerHTML = c.ai === 'gemini' ? 'Ключ Gemini бесплатно: <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener noreferrer">aistudio.google.com/apikey</a> (есть бесплатный лимит).'
        : c.ai === 'claude' ? 'Ключ Claude: <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener noreferrer">console.anthropic.com</a> (оплата по факту использования, один скриншот стоит доли цента).' : '';
    const on = [];
    if (mvHasTmdb()) on.push('TMDB');
    if (mvKey('omdb')) on.push('OMDb');
    if (mvKey('kp')) on.push('Кинопоиск');
    if (mvHasAi()) on.push('ИИ');
    const badge = $('#mvc-badge'); badge.textContent = on.length ? on.join(' · ') : 'Не настроено';
    badge.style.background = mvHasTmdb() ? 'color-mix(in oklab, var(--md-income) 24%, var(--md-container))' : '';
    badge.style.color = mvHasTmdb() ? 'var(--md-income)' : '';
}
function initMoviesCard() {
    if (!$('#movies-cfg-card')) return;
    const bind = (sel, key, label) => $(sel).addEventListener('change', e => {
        mvCfgSave({ [key]: e.target.value.trim() });
        renderMoviesCard(); renderMovies();
        toast(e.target.value.trim() ? label + ': сохранено' + (typeof gCfg === 'function' && gCfg().keys && gUser ? ' (и на Google Диске)' : ' на этом устройстве') : label + ': ключ удалён');
    });
    bind('#mvc-tmdb', 'tmdb', 'TMDB'); bind('#mvc-omdb', 'omdb', 'OMDb'); bind('#mvc-kp', 'kp', 'Кинопоиск'); bind('#mvc-aikey', 'aiKey', 'Ключ ИИ'); bind('#mvc-aimodel', 'aiModel', 'Модель ИИ');
    $('#mvc-ai').addEventListener('change', e => { mvCfgSave({ ai: e.target.value }); renderMoviesCard(); renderMovies(); });
    $('#mvc-aiauto').addEventListener('change', e => { mvCfgSave({ aiAuto: e.target.checked }); renderScanEngines(); });
    $('#mvc-show').addEventListener('click', () => {
        const shown = $('#mvc-tmdb').type === 'text', t = shown ? 'password' : 'text';
        $$('#movies-cfg-card input[data-secret]').forEach(i => { i.type = t; });
        $('#mvc-show').innerHTML = ic(shown ? 'visibility' : 'lock') + (shown ? 'Показать ключи' : 'Скрыть ключи');
    });
    $('#mvc-test').addEventListener('click', async () => {
        const btn = $('#mvc-test'), out = $('#mvc-test-out'); btn.disabled = true;
        out.innerHTML = '<p class="hint">Проверяем подключение…</p>';
        try {
            const res = await mvTestSources();
            out.innerHTML = res.map(r => '<div class="mv-test is-' + r.state + '"><span class="dot"></span><b>' + esc(r.name) + '</b><span>' + esc(r.msg) + '</span></div>').join('');
        } catch (e) { out.innerHTML = '<p class="hint" style="color:var(--md-error)">Проверка не удалась: ' + esc(e.message) + '</p>'; }
        btn.disabled = false;
    });
    renderMoviesCard();
}
function openMoviesSettings() {
    showTab('settings');
    const c = $('#movies-cfg-card'); if (!c) return;
    c.classList.remove('is-collapsed');
    setTimeout(() => c.scrollIntoView({ behavior: 'smooth', block: 'start' }), 80);
}

// ---------- Подключение событий ----------
function initMovies() {
    initMovieSearch();
    $('#movies-banner').addEventListener('click', e => { if (e.target.closest('[data-goto-settings]')) openMoviesSettings(); });

    // карточки и строки: одна обработка кликов на всю страницу
    $('#movies').addEventListener('click', e => {
        const b = e.target.closest('[data-mv]'); if (!b) return;
        const card = b.closest('.movie, .mv-row'), id = card && card.dataset.id, act = b.dataset.mv;
        if (act === 'more') { mvShown[b.dataset.list] = (mvShown[b.dataset.list] || 24) + 24; renderMovies(); return; }
        if (!id) return;
        if (act === 'info') openMovieInfo(id);
        else if (act === 'menu') openMovieMenu(id);
        else if (act === 'rate') openRateSheet(id, false);
        else if (act === 'watch') openRateSheet(id, true);
        else if (act === 'start') mvSetStatus(id, 'watching');
        else if (act === 'queue') mvSetStatus(id, 'queue');
        else if (act === 'refresh') mvRefreshOne(id);
        else if (act === 'del') mvDelete(id);
    });
    $('#movies-sort').addEventListener('click', e => {
        const b = e.target.closest('[data-sort]'); if (!b) return;
        mvUi.sort = b.dataset.sort; LS.set('movie_ui', mvUi); renderMovies();
    });
    $('#movies-view').addEventListener('click', e => {
        const b = e.target.closest('[data-view]'); if (!b) return;
        mvUi.view = b.dataset.view === 'list' ? 'list' : 'cards'; LS.set('movie_ui', mvUi); renderMovies();
    });
    $('#movies-all-filter').addEventListener('click', e => {
        const b = e.target.closest('[data-f]'); if (!b) return;
        mvUi.allFilter = b.dataset.f; mvShown.all = 24; LS.set('movie_ui', mvUi); renderMovies();
    });
    $('#movies-all-sort').addEventListener('change', e => { mvUi.allSort = e.target.value; LS.set('movie_ui', mvUi); renderMovies(); });
    $('#movies-refresh').addEventListener('click', mvRefreshAll);
    $('#movies-pdf').addEventListener('click', openMoviesPdfSheet);

    initScan();
    initMoviesCard();
    renderMovies();
}
