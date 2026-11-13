'use strict';
// =====================================================================================================
// iLife — КИНО: ИСТОЧНИКИ ДАННЫХ, СРАВНЕНИЕ НАЗВАНИЙ, ПОИСК НАЗВАНИЙ В ТЕКСТЕ СО СКРИНШОТА, ИИ ПО КАДРУ (версия 1.2.0).
//
// Откуда берутся данные (всё напрямую из браузера, без своего сервера; ключи лежат на устройстве в «movie_cfg»,
// в файл резервной копии не попадают, а на ваш Google Диск уходят, если не выключен переключатель в Настройках → Google Диск):
//   • TMDB (themoviedb.org)  — ОСНОВА: поиск по названию, обложка, режиссёр, актёры, жанры, описание, оценка TMDB. Бесплатный ключ.
//   • OMDb (omdbapi.com)      — оценки IMDb, Rotten Tomatoes и Metacritic (по IMDb-номеру из TMDB). Бесплатный ключ.
//   • ПоискКино (poiskkino.dev, бывший kinopoisk.dev) — оценка Кинопоиска. Бесплатный ключ из Telegram-бота.
//   • ИИ по желанию (Gemini или Claude) — определяет фильм по кадру, где нет названия: афиша, сцена, субтитры.
// Каждый источник необязателен и работает сам по себе: если один не ответил, остальные оценки всё равно показываются.
// Все ответы разбираются осторожно (любое поле может отсутствовать), ошибки превращаются в понятные русские сообщения.
//
// Запись фильма в списке movies (js/movies.js):
//   { id, status: 'queue'|'watching'|'watched', type: 'movie'|'tv', title, origTitle, year, runtime, seasons, genres[], overview,
//     directors[], cast[], tmdbId, imdbId, kpId, ratings: { tmdb, imdb, kp, rt, mc }, ratingsAt, posterPath, coverId, posterUrl,
//     my (1–10|null), progress, note, addedAt, startedAt, watchedAt, updatedAt, author, src }
// =====================================================================================================

const TMDB_API = 'https://api.themoviedb.org/3';
const TMDB_IMG = 'https://image.tmdb.org/t/p/';
const OMDB_API = 'https://www.omdbapi.com/';
const KP_API = 'https://api.poiskkino.dev';   // ПоискКино (раньше api.kinopoisk.dev). Если адрес снова сменится — поправьте только эту строку
const GEMINI_API = 'https://generativelanguage.googleapis.com/v1beta/models/';
const CLAUDE_API = 'https://api.anthropic.com/v1/messages';
const MV_AI_MODELS = { gemini: 'gemini-3.8-flash', claude: 'claude-sonnet-5-5' };   // названия моделей меняются — в Настройках их можно поправить
const MV_AI_NAMES = { gemini: 'Gemini', claude: 'Claude' };
// Если основная модель перегружена (503) — приложение само пробует эти запасные (только когда вы не вписали свою модель)
const MV_AI_FALLBACKS = { gemini: ['gemini-3.6-flash', 'gemini-3.5-flash-lite'], claude: [] };
const MV_RETRY_CODES = [500, 502, 503, 504, 529];   // «сервер временно недоступен / перегружен» — имеет смысл повторить
let MV_AI_RETRY_MS = 1500;                           // пауза перед повтором
let mvAiUsedModel = '';                              // какая модель ответила в последний раз

// ---------- Настройки источников (на этом устройстве) ----------
function mvCfg() { return Object.assign({ tmdb: '', omdb: '', kp: '', ai: 'none', aiKey: '', aiModel: '', aiAuto: true }, LS.get('movie_cfg', {})); }
function mvCfgSave(patch) { const c = Object.assign(mvCfg(), patch); LS.set('movie_cfg', c); if (typeof cloudLocalChanged === 'function') cloudLocalChanged(); return c; }   // ключи уходят на Google Диск (gdrive.js)
function mvKey(name) { return String(mvCfg()[name] || '').replace(/\s+/g, ''); }
function mvHasTmdb() { return !!mvKey('tmdb'); }
function mvHasAi() { const c = mvCfg(); return (c.ai === 'gemini' || c.ai === 'claude') && !!mvKey('aiKey'); }
function mvAiModel() { const c = mvCfg(); return String(c.aiModel || '').trim() || MV_AI_MODELS[c.ai] || ''; }

// ---------- Запросы ----------
function mvErr(code, message) { const e = new Error(message); e.code = code; return e; }
function mvHttpMessage(status, apiMessage) {
    const m = String(apiMessage || '').replace(/\s+/g, ' ').slice(0, 160);
    if (status === 401 || status === 403) return 'ключ не принят' + (m ? ' (' + m + ')' : '');
    if (status === 404) return 'не найдено' + (m ? ' (' + m + ')' : '');
    if (status === 429) return 'исчерпан лимит запросов — повторите позже';
    if (status >= 500) return 'сервер временно недоступен (' + status + ')';
    return (m || 'ошибка') + ' (' + status + ')';
}
async function mvFetch(url, opts, ms) {
    const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = ctl ? setTimeout(() => ctl.abort(), ms || 15000) : 0;
    let res;
    try { res = await fetch(url, Object.assign({}, opts, ctl ? { signal: ctl.signal } : {})); }
    catch (e) {
        clearTimeout(timer);
        if (e && e.name === 'AbortError') throw mvErr('timeout', 'нет ответа (время вышло)');
        throw mvErr('network', 'нет связи с сервером или браузер закрыл доступ (CORS)');
    }
    clearTimeout(timer);
    const text = await res.text().catch(() => '');
    let body = null; try { body = text ? JSON.parse(text) : null; } catch (e) { body = null; }
    if (!res.ok) {
        const apiMsg = body && (body.status_message || body.Error || body.message || (body.error && (body.error.message || body.error)) || '');
        throw mvErr(res.status, mvHttpMessage(res.status, typeof apiMsg === 'string' ? apiMsg : ''));
    }
    return body;
}
async function mvFetchBlob(url) {
    try { const r = await fetch(url, { mode: 'cors' }); if (!r.ok) return null; const b = await r.blob(); return /^image\//.test(b.type) ? b : null; } catch (e) { return null; }
}
async function mvPool(items, n, fn) {   // выполняет fn для каждого элемента, не больше n одновременно
    const out = new Array(items.length); let next = 0;
    await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
        while (next < items.length) { const i = next++; try { out[i] = await fn(items[i], i); } catch (e) { out[i] = { error: e }; } }
    }));
    return out;
}
const mvRound1 = v => Math.round(Number(v) * 10) / 10;
const mvNum = v => { const n = parseFloat(String(v == null ? '' : v).replace(',', '.')); return Number.isFinite(n) && n > 0 ? n : null; };

// ---------- TMDB ----------
function tmdbCall(path, params) {
    const key = mvKey('tmdb');
    if (!key) return Promise.reject(mvErr('nokey', 'ключ TMDB не введён'));
    const bearer = key.length > 40;   // длинный «Read Access Token» (v4) передаётся заголовком, короткий ключ (v3, 32 символа) — параметром
    const q = new URLSearchParams(Object.assign({ language: 'ru-RU' }, params || {}));
    if (!bearer) q.set('api_key', key);
    return mvFetch(TMDB_API + path + '?' + q.toString(), bearer ? { headers: { Authorization: 'Bearer ' + key, accept: 'application/json' } } : undefined);
}
function tmdbMapHit(r, forcedType) {
    const type = forcedType || (r && r.media_type);
    if (!r || (type !== 'movie' && type !== 'tv')) return null;
    const tv = type === 'tv';
    const date = String((tv ? r.first_air_date : r.release_date) || '');
    return {
        tmdbId: r.id, type, title: (tv ? r.name : r.title) || '', origTitle: (tv ? r.original_name : r.original_title) || '',
        year: parseInt(date.slice(0, 4), 10) || null, posterPath: r.poster_path || '', popularity: Number(r.popularity) || 0,
        tmdb: Number(r.vote_count) > 0 ? mvRound1(r.vote_average) : null, overview: r.overview || ''
    };
}
async function tmdbSearch(query) {
    const j = await tmdbCall('/search/multi', { query: String(query).slice(0, 120), include_adult: 'false' });
    return ((j && j.results) || []).map(r => tmdbMapHit(r)).filter(Boolean);
}
// Фильм по IMDb-номеру (tt1234567): нужен, когда фильм выбран на другой площадке (IMDb, Кинопоиск, TVMaze), а не в TMDB
async function tmdbFindByImdb(imdbId) {
    const j = await tmdbCall('/find/' + encodeURIComponent(imdbId), { external_source: 'imdb_id' });
    const mv = ((j && j.movie_results) || [])[0], tv = ((j && j.tv_results) || [])[0];
    if (mv) return tmdbMapHit(mv, 'movie');
    if (tv) return tmdbMapHit(tv, 'tv');
    return null;
}
async function tmdbDetails(type, id) {
    const d = await tmdbCall('/' + type + '/' + id, { append_to_response: 'credits,external_ids' });
    const tv = type === 'tv', credits = d.credits || {}, crew = credits.crew || [];
    const uniq = a => Array.from(new Set(a.filter(Boolean)));
    let directors = tv ? (d.created_by || []).map(p => p.name) : [];
    if (!directors.length) directors = crew.filter(p => p.job === 'Director').map(p => p.name);
    const date = String((tv ? d.first_air_date : d.release_date) || '');
    return {
        tmdbId: d.id, type, title: (tv ? d.name : d.title) || '', origTitle: (tv ? d.original_name : d.original_title) || '',
        year: parseInt(date.slice(0, 4), 10) || null,
        runtime: tv ? ((d.episode_run_time && d.episode_run_time[0]) || null) : (d.runtime || null),
        seasons: tv ? (d.number_of_seasons || null) : null,
        genres: (d.genres || []).map(g => g.name).filter(Boolean).slice(0, 4),
        overview: d.overview || '', posterPath: d.poster_path || '',
        imdbId: d.imdb_id || (d.external_ids && d.external_ids.imdb_id) || '',
        directors: uniq(directors).slice(0, 3), cast: uniq((credits.cast || []).map(p => p.name)).slice(0, 8),
        tmdb: Number(d.vote_count) > 0 ? mvRound1(d.vote_average) : null
    };
}

// ---------- OMDb: IMDb, Rotten Tomatoes, Metacritic ----------
async function omdbRatings(imdbId) {
    const key = mvKey('omdb');
    if (!key) throw mvErr('nokey', 'ключ OMDb не введён');
    const j = await mvFetch(OMDB_API + '?apikey=' + encodeURIComponent(key) + '&i=' + encodeURIComponent(imdbId));
    if (!j || j.Response === 'False') throw mvErr('omdb', (j && j.Error) || 'нет данных');
    const out = { imdb: mvNum(j.imdbRating), rt: null, mc: mvNum(j.Metascore) };
    (j.Ratings || []).forEach(r => {
        const v = parseInt(String(r.Value || ''), 10);
        if (/Rotten/i.test(r.Source || '') && v > 0) out.rt = v;
        if (/Metacritic/i.test(r.Source || '') && v > 0) out.mc = v;
    });
    return out;
}

// ---------- ПоискКино: оценка Кинопоиска ----------
function kpPickRating(doc) { const r = doc && doc.rating; return r ? { kp: mvNum(r.kp), kpImdb: mvNum(r.imdb), kpId: doc.id || null } : null; }
async function kpRatings(m) {
    const key = mvKey('kp');
    if (!key) throw mvErr('nokey', 'ключ ПоискКино не введён');
    const opts = { headers: { 'X-API-KEY': key, accept: 'application/json' } };
    let doc = null;
    if (m.kpId) {   // фильм выбран на Кинопоиске — берём его по номеру
        try { const j = await mvFetch(KP_API + '/v1.5/movie/' + encodeURIComponent(m.kpId), opts); if (j && j.rating) doc = j; }
        catch (e) { if (e.code === 401 || e.code === 403 || e.code === 429 || e.code === 'network') throw e; }
    }
    if (!doc && m.imdbId) {
        try { const j = await mvFetch(KP_API + '/v1.5/movie?limit=1&externalId.imdb=' + encodeURIComponent(m.imdbId), opts); doc = ((j && (j.docs || j.items)) || [])[0] || null; }
        catch (e) { if (e.code === 401 || e.code === 403 || e.code === 429 || e.code === 'network') throw e; }
    }
    if (!doc || !kpPickRating(doc) || !kpPickRating(doc).kp) {
        const q = m.title || m.origTitle;
        if (!q) return doc ? kpPickRating(doc) : null;
        const j = await mvFetch(KP_API + '/v1.5/movie/search?limit=8&query=' + encodeURIComponent(q), opts);
        const hits = ((j && (j.docs || j.items)) || []).map(d => ({ doc: d, title: d.name || d.alternativeName || d.enName || '', origTitle: d.alternativeName || d.enName || '', year: d.year || null }));
        const best = mvPickBest(q, hits, m.year, { min: 0.75 });
        doc = best ? best.hit.doc : null;
    }
    return kpPickRating(doc);
}

// ---------- Сравнение названий ----------
function mvNorm(s) { return String(s == null ? '' : s).toLowerCase().replace(/ё/g, 'е').replace(/[^\p{L}\p{N}]+/gu, ' ').trim(); }
function mvLev(a, b) {
    if (a === b) return 0;
    if (!a.length) return b.length;
    if (!b.length) return a.length;
    let prev = Array.from({ length: b.length + 1 }, (_, i) => i), cur = new Array(b.length + 1);
    for (let i = 1; i <= a.length; i++) {
        cur[0] = i;
        for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
        [prev, cur] = [cur, prev];
    }
    return prev[b.length];
}
// Похожесть двух названий от 0 до 1 (учитывает опечатки распознавания и «лишние» слова вроде подзаголовка)
function mvSim(a, b) {
    a = mvNorm(a); b = mvNorm(b);
    if (!a || !b) return 0;
    if (a === b) return 1;
    const lev = 1 - mvLev(a, b) / Math.max(a.length, b.length);
    const ta = a.split(' '), tb = b.split(' ');
    const common = ta.filter(t => tb.includes(t)).length;
    const tokens = common / Math.max(ta.length, tb.length);
    // короткое название целиком входит в длинное («Дюна» → «Дюна: Часть вторая»): засчитываем неполное совпадение
    const inside = ta.length >= 2 && ta.every(t => tb.includes(t)) ? 0.86 : tb.length >= 2 && tb.every(t => ta.includes(t)) ? 0.86 : 0;
    return Math.max(lev, tokens * 0.92, inside);
}
// Лучший вариант из ответа базы для строки text: { hit, sim, score } или null, если похожего нет
function mvPickBest(text, hits, year, o) {
    o = o || {};
    let best = null;
    (hits || []).slice(0, 8).forEach(h => {
        const sim = Math.max(mvSim(text, h.title), mvSim(text, h.origTitle));
        let score = sim;
        if (year && h.year) score += year === h.year ? 0.06 : Math.abs(year - h.year) <= 1 ? 0.02 : -0.12;
        score += Math.min((h.popularity || 0) / 400, 0.04);
        if (!best || score > best.score) best = { hit: h, sim, score };
    });
    if (!best) return null;
    const need = mvNorm(text).length <= 5 ? 0.98 : (o.min || 0.8);   // очень короткие слова принимаем только при точном совпадении
    return best.sim >= need ? best : null;
}

// ---------- Поиск названий в тексте, прочитанном со скриншота ----------
// Лишние слова интерфейса и жанры: по ним базу не опрашиваем
const MV_NOISE_WORDS = ['смотреть', 'смотреть онлайн', 'трейлер', 'поделиться', 'в избранное', 'оценить', 'подписаться', 'подписка', 'реклама', 'еще', 'далее', 'назад', 'главная', 'поиск', 'профиль', 'каталог', 'подробнее', 'описание', 'отзывы', 'рецензии', 'актеры', 'жанр', 'жанры', 'рейтинг', 'купить', 'арендовать', 'бесплатно', 'скачать', 'открыть', 'закрыть', 'отмена', 'готово', 'сегодня', 'вчера', 'netflix', 'кинопоиск', 'okko', 'ivi', 'wink', 'premier', 'kion', 'more', 'share', 'play', 'trailer', 'watch', 'watch now', 'my list', 'add', 'rate', 'home', 'search', 'menu', 'back', 'episodes', 'seasons', 'trending', 'new', 'фильм', 'фильмы', 'сериал', 'сериалы', 'мультфильм', 'мультфильмы', 'аниме', 'боевик', 'драма', 'комедия', 'фантастика', 'триллер', 'ужасы', 'мелодрама', 'детектив', 'приключения', 'фэнтези', 'документальный', 'криминал', 'биография', 'история', 'военный', 'вестерн', 'мюзикл', 'семейный', 'спорт', 'для взрослых'];
const MV_NOISE_SET = new Set(MV_NOISE_WORDS);
// Похожие буквы: кириллическая и латинская «а», «о», «е»… путаются при чтении; чиним слово по большинству его букв
const MV_LAT2CYR = { a: 'а', c: 'с', e: 'е', o: 'о', p: 'р', x: 'х', y: 'у', k: 'к', A: 'А', B: 'В', C: 'С', E: 'Е', H: 'Н', K: 'К', M: 'М', O: 'О', P: 'Р', T: 'Т', X: 'Х', Y: 'У' };
const MV_CYR2LAT = (() => { const o = {}; Object.keys(MV_LAT2CYR).forEach(k => { o[MV_LAT2CYR[k]] = k; }); return o; })();
function mvFixHomoglyphs(s) {
    return String(s || '').replace(/[\p{L}]+/gu, w => {
        const cyr = (w.match(/[Ѐ-ӿ]/g) || []).length, lat = (w.match(/[A-Za-z]/g) || []).length;
        if (cyr && lat && cyr >= lat) return w.replace(/[A-Za-z]/g, ch => MV_LAT2CYR[ch] || ch);
        if (cyr && lat && lat > cyr) return w.replace(/[Ѐ-ӿ]/g, ch => MV_CYR2LAT[ch] || ch);
        return w;
    });
}
function mvIsNoise(t) { const n = mvNorm(t); return !n || MV_NOISE_SET.has(n); }
function mvTidy(t) { return String(t || '').replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}!?]+$/gu, '').replace(/\s+/g, ' ').trim(); }

// lines: [{ text, conf (0–100), h (высота строки в пикселях), y0 }] → до max вариантов названия, лучшие первыми:
// [{ text, year|null, score, why: 'quote'|'year'|'list'|'big'|'text' }]
function mvCandidatesFromOcr(lines, max) {
    max = max || 10;
    const all = (lines || []).map(l => ({ text: String(l.text || '').replace(/\s+/g, ' ').trim(), conf: l.conf == null ? 80 : Number(l.conf), h: Number(l.h) || 12, y0: Number(l.y0) || 0 })).filter(l => l.text);
    if (!all.length) return [];
    const maxH = Math.max(1, ...all.map(l => l.h));
    const found = new Map();
    const put = (raw, o) => {
        let text = mvTidy(mvFixHomoglyphs(raw));
        const letters = (text.match(/\p{L}/gu) || []).length;
        if (letters < 2 || text.length < 2 || text.length > 90 || letters / text.length < 0.5 || mvIsNoise(text)) return;
        const key = mvNorm(text); if (!key) return;
        const rel = Math.min(1, (o.h || 0) / maxH);
        const score = 0.25 * rel + 0.2 * Math.min(1, Math.max(0, (o.conf == null ? 70 : o.conf) / 100)) + (o.quote ? 0.35 : 0) + (o.year ? 0.15 : 0) + (o.list ? 0.15 : 0) + (o.merged ? 0.05 : 0);
        const why = o.quote ? 'quote' : o.year ? 'year' : o.list ? 'list' : rel >= 0.7 ? 'big' : 'text';
        const cur = found.get(key);
        if (!cur || score > cur.score) found.set(key, { text, year: o.year || (cur && cur.year) || null, score, why });
    };
    // 1) название в кавычках: «Начало», "Интерстеллар" — самый надёжный признак (ищем и внутри строки, и на стыке двух строк)
    const QUOTE = /[«„“"]\s*([^«»„“”"]{2,90}?)\s*[»”“"]/g;
    all.forEach((l, i) => {
        [l.text, i + 1 < all.length ? l.text + ' ' + all[i + 1].text : ''].forEach(chunk => {
            if (!chunk) return;
            let m; QUOTE.lastIndex = 0;
            while ((m = QUOTE.exec(chunk))) put(m[1], { quote: true, h: l.h, conf: l.conf });
        });
    });
    // 2) отдельные строки: нумерованные списки, «Название (2010)», «Название • 2010 • жанр», просто крупный текст
    const YEAR_IN = /(?:^|[^\d])((?:19[2-9]|20[0-4])\d)(?!\d)/;
    const yearLines = all.filter(l => YEAR_IN.test(l.text));
    const yearBelow = l => {   // «Начало» / «2010 • Фантастика»: год в строке чуть ниже названия относится к нему
        let best = null;
        yearLines.forEach(y => { if (y !== l && y.y0 > l.y0 && y.y0 - l.y0 <= 4 * Math.max(l.h, y.h) && (!best || y.y0 < best.y0)) best = y; });
        return best ? +YEAR_IN.exec(best.text)[1] : null;
    };
    all.forEach(l => {
        if (l.conf < 35) return;
        let t = l.text, list = false;
        const lm = t.match(/^\s*(\d{1,2})\s*[.)]\s+(.+)$/);
        if (lm) { t = lm[2]; list = true; } else t = t.replace(/^[\s\-–—•*·>]+/, '');
        const lineYear = (t.match(YEAR_IN) || [])[1] || yearBelow(l);
        t.split(/\s*[•·|]\s*|\s+\/\s+|\s+[–—]\s+/).forEach(seg => {
            seg = seg.trim();
            if (!seg || /^(?:19[2-9]|20[0-4])\d$/.test(seg)) return;   // голый год — не название
            let title = seg, year = lineYear ? +lineYear : null;
            const ym = seg.match(/^(.*?)[\s,(\[]*\b((?:19[2-9]|20[0-4])\d)\b[)\]]?\s*(?:г\.?|год)?\s*$/);   // «Начало (2010)», «Начало, 2010»
            if (ym && ym[1].trim().length >= 2) { title = ym[1]; year = +ym[2]; }
            put(title, { h: l.h, conf: l.conf, list, year });
        });
    });
    // 3) название в две-три строки одним шрифтом (афиша: «ВЛАСТЕЛИН» / «КОЛЕЦ»)
    const titleLike = l => { const n = (l.text.match(/\p{L}/gu) || []).length; return l.conf >= 35 && !mvIsNoise(l.text) && !/[•·|]/.test(l.text) && n / l.text.length >= 0.75; };
    const byY = all.filter(titleLike).sort((a, b) => a.y0 - b.y0);
    for (let i = 0; i < byY.length; i++) {
        let group = [byY[i]];
        for (let j = i + 1; j < byY.length && group.length < 3; j++) {
            const prev = group[group.length - 1], cur = byY[j];
            const sameSize = Math.abs(cur.h - prev.h) <= 0.25 * Math.max(cur.h, prev.h);
            const near = cur.y0 - prev.y0 <= 1.9 * Math.max(cur.h, prev.h);
            if (sameSize && near) group.push(cur); else break;
        }
        if (group.length >= 2) put(group.map(g => g.text).join(' '), { merged: true, h: Math.max(...group.map(g => g.h)), conf: Math.min(...group.map(g => g.conf)) });
    }
    return Array.from(found.values()).sort((a, b) => b.score - a.score).slice(0, max);
}

// ---------- Оценки: общий балл ----------
const MV_SOURCES = [
    { key: 'kp', name: 'Кинопоиск', scale: 10 }, { key: 'imdb', name: 'IMDb', scale: 10 }, { key: 'tmdb', name: 'TMDB', scale: 10 },
    { key: 'rt', name: 'Rotten Tomatoes', scale: 100, suffix: '%' }, { key: 'mc', name: 'Metacritic', scale: 100 }
];
function mvAvgRating(r) {
    r = r || {}; const v = [];
    MV_SOURCES.forEach(s => { const n = Number(r[s.key]); if (n > 0) v.push(s.scale === 100 ? n / 10 : n); });
    return v.length >= 2 ? mvRound1(v.reduce((a, b) => a + b, 0) / v.length) : null;
}
function mvRatingClass(src, value) { const v = src.scale === 100 ? value / 10 : value; return v >= 7.5 ? 'r-good' : v >= 6 ? 'r-mid' : 'r-bad'; }
function mvRatingText(src, value) { return (src.scale === 100 ? String(Math.round(value)) : String(mvRound1(value)).replace('.', ',')) + (src.suffix || ''); }

// ---------- Наполнение записи данными ----------
function mvApplyDetails(m, d) {
    ['title', 'origTitle', 'year', 'runtime', 'seasons', 'overview', 'imdbId', 'posterPath'].forEach(k => { if (d[k]) m[k] = d[k]; });
    if (d.type) m.type = d.type;
    if (d.genres && d.genres.length) m.genres = d.genres;
    if (d.directors && d.directors.length) m.directors = d.directors;
    if (d.cast && d.cast.length) m.cast = d.cast;
    m.tmdbId = d.tmdbId || m.tmdbId;
    m.ratings = Object.assign({}, m.ratings || {}, d.tmdb != null ? { tmdb: d.tmdb } : {});
}
async function mvStorePoster(m, posterPath) {
    const url = TMDB_IMG + 'w342' + posterPath;
    const blob = await mvFetchBlob(url);
    if (blob) {
        const old = m.coverId, id = uid('c');
        await BlobDB.put({ id, blob, name: 'poster.jpg', type: blob.type, size: blob.size });
        m.coverId = id; m.posterUrl = '';
        if (old) await BlobDB.del(old);
    } else if (!m.coverId) m.posterUrl = url;   // скачать не вышло — пока показываем по адресу (нужен интернет)
    m.posterPath = posterPath;
}
// Подтягивает недостающее: поиск в TMDB (если ещё не привязан), описание, режиссёров, актёров, оценки, обложку.
// Возвращает список замечаний (какой источник не ответил) — запись при этом всё равно остаётся рабочей.
async function mvEnrich(m, o) {
    o = o || {}; const warn = [];
    m.ratings = m.ratings || {};
    if (!m.tmdbId && mvHasTmdb() && m.imdbId) {   // выбран на IMDb / Кинопоиске / TVMaze: точное совпадение по IMDb-номеру
        try { const f = await tmdbFindByImdb(m.imdbId); if (f) { m.tmdbId = f.tmdbId; m.type = f.type; } } catch (e) { warn.push('TMDB: ' + e.message); }
    }
    if (!m.tmdbId && mvHasTmdb() && m.title) {
        try {
            const best = mvPickBest(m.title, await tmdbSearch(m.title), m.year, { min: 0.72 });
            if (best) { m.tmdbId = best.hit.tmdbId; m.type = best.hit.type; }
        } catch (e) { warn.push('TMDB: ' + e.message); }
    }
    if (m.tmdbId && mvHasTmdb()) {
        try {
            const d = await tmdbDetails(m.type === 'tv' ? 'tv' : 'movie', m.tmdbId);
            mvApplyDetails(m, d);
            if (d.posterPath && (d.posterPath !== m.posterPath || (!m.coverId && !m.posterUrl) || o.forcePoster)) { try { await mvStorePoster(m, d.posterPath); } catch (e) { warn.push('обложка не сохранена: ' + e.message); } }
        } catch (e) { warn.push('TMDB: ' + e.message); }
    }
    const jobs = [];
    if (mvKey('omdb') && m.imdbId) jobs.push(omdbRatings(m.imdbId).then(r => { const p = {}; ['imdb', 'rt', 'mc'].forEach(k => { if (r[k] > 0) p[k] = r[k]; }); m.ratings = Object.assign({}, m.ratings, p); }, e => { warn.push('OMDb: ' + e.message); }));
    if (mvKey('kp') && (m.title || m.imdbId)) jobs.push(kpRatings(m).then(r => { if (r) { m.kpId = r.kpId || m.kpId; if (r.kp > 0) m.ratings = Object.assign({}, m.ratings, { kp: r.kp }); if (!(m.ratings.imdb > 0) && r.kpImdb) m.ratings.imdb = r.kpImdb; } }, e => { warn.push('Кинопоиск: ' + e.message); }));
    await Promise.all(jobs);
    // обложка с другой площадки (не TMDB): по возможности сохраняем саму картинку, иначе остаётся ссылка (нужен интернет)
    if (!m.coverId && m.posterUrl && /^https?:/i.test(m.posterUrl)) {
        const blob = await mvFetchBlob(m.posterUrl);
        if (blob) { const id = uid('c'); try { await BlobDB.put({ id, blob, name: 'poster.jpg', type: blob.type, size: blob.size }); m.coverId = id; m.posterUrl = ''; } catch (e) { /* остаётся ссылка */ } }
    }
    Object.keys(m.ratings || {}).forEach(k => { if (!(m.ratings[k] > 0)) delete m.ratings[k]; });
    m.ratingsAt = Date.now();
    return warn;
}

// ---------- ИИ: определить фильм по кадру ----------
const MV_AI_PROMPT = 'Ты помогаешь вести список фильмов и сериалов. На изображении может быть: афиша или обложка, страница стримингового сервиса или Кинопоиска, подборка или список названий, пост из соцсети или мессенджера, кадр из фильма или сериала, скриншот с субтитрами или титрами.\n' +
    'Определи, какие фильмы, сериалы или аниме на изображении названы или показаны. Опирайся на видимый текст (названия, титры, субтитры, подписи), логотипы, афиши и узнаваемые сцены. Людей по лицу не определяй. Если не уверен — не угадывай и не выдумывай, верни пустой список.\n' +
    'Ответь только JSON, без пояснений: {"items":[{"title":"название на русском, как оно известно в России","original_title":"оригинальное название","year":2010,"type":"movie или tv","confidence":0.0,"evidence":"на чём основан вывод, до 12 слов"}]}\n' +
    'Если на картинке подборка — перечисли все названия (не больше 10). Если год неизвестен — null.';

function mvParseAiJson(text) {
    let s = String(text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
    let j = null;
    const tries = [s, s.slice(s.indexOf('{'), s.lastIndexOf('}') + 1), s.slice(s.indexOf('['), s.lastIndexOf(']') + 1)];
    for (const t of tries) { if (!t) continue; try { j = JSON.parse(t); break; } catch (e) { /* пробуем следующий вариант */ } }
    if (!j) return [];
    const arr = Array.isArray(j) ? j : (j.items || j.movies || j.results || []);
    return (Array.isArray(arr) ? arr : []).filter(x => x && (x.title || x.original_title)).slice(0, 12).map(x => ({
        title: String(x.title || x.original_title).slice(0, 120), origTitle: String(x.original_title || '').slice(0, 120),
        year: parseInt(x.year, 10) || null, type: x.type === 'tv' || /сериал|series|tv/i.test(String(x.type || '')) ? 'tv' : 'movie',
        confidence: Math.min(1, Math.max(0, Number(x.confidence) || 0.5)), evidence: String(x.evidence || '').slice(0, 140)
    }));
}
async function mvAiImage(file) {   // картинка для ИИ: не больше 1280 px по длинной стороне, JPEG
    const bmp = await decodeImage(file), s = bitmapSize(bmp);
    const r = await canvasBlob(bmp, s.w, s.h, 1280, 0.82);
    if (bmp.close) try { bmp.close(); } catch (e) {}
    if (!r.blob) throw mvErr('image', 'не удалось подготовить картинку');
    return r.blob;
}
function mvAiHttpError(provider, e, model) {
    if (e.code === 400 && provider === 'gemini') return 'Gemini: ' + e.message + ' (проверьте ключ и название модели)';
    if (e.code === 404) return MV_AI_NAMES[provider] + ': модель «' + (model || mvAiModel()) + '» не найдена — впишите актуальное название в Настройках';
    return MV_AI_NAMES[provider] + ': ' + e.message;
}
function mvAiModelChain() {   // основная модель и, если свою не вписывали, запасные
    const c = mvCfg(), main = mvAiModel();
    return String(c.aiModel || '').trim() ? [main] : [main].concat(MV_AI_FALLBACKS[c.ai] || []);
}
async function mvAskAiText(parts) {   // общий вызов: parts = { text, imageBlob? или imageBlobs:[…], maxTokens? } → строка ответа (его же используют разбор постов Telegram — js/telegram.js — и распознавание рецептов — js/meds-recognize.js)
    const c = mvCfg(), key = mvKey('aiKey');
    if (!mvHasAi()) throw mvErr('nokey', 'ИИ не подключён');
    const blobs = parts.imageBlobs || (parts.imageBlob ? [parts.imageBlob] : []);
    const imgs = [];
    for (const b of blobs) imgs.push(await blobToBase64(b));
    const ask = async model => {
        if (c.ai === 'gemini') {
            const body = { contents: [{ parts: [{ text: parts.text }].concat(imgs.map(d => ({ inline_data: { mime_type: 'image/jpeg', data: d } }))) }], generationConfig: Object.assign({ response_mime_type: 'application/json' }, parts.maxTokens ? { maxOutputTokens: parts.maxTokens } : {}) };
            const j = await mvFetch(GEMINI_API + encodeURIComponent(model) + ':generateContent?key=' + encodeURIComponent(key), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, 60000);
            const ps = (((j && j.candidates) || [])[0] || {}).content;
            return ((ps && ps.parts) || []).map(p => p.text || '').join('\n');
        }
        const body = { model, max_tokens: parts.maxTokens || 1200, messages: [{ role: 'user', content: imgs.map(d => ({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: d } })).concat([{ type: 'text', text: parts.text }]) }] };
        const j = await mvFetch(CLAUDE_API, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' }, body: JSON.stringify(body) }, 60000);
        return ((j && j.content) || []).map(p => p.text || '').join('\n');
    };
    // 503 и подобные — временная перегрузка у сервиса: повторяем, затем пробуем запасные модели
    const chain = mvAiModelChain(), tried = [];
    let last = null;
    for (let i = 0; i < chain.length; i++) {
        tried.push(chain[i]);
        for (let a = 0; a < 2; a++) {
            try { const t = await ask(chain[i]); mvAiUsedModel = chain[i]; return t; }
            catch (e) {
                last = e;
                if (i > 0 && e.code === 404) break;                                   // запасной модели нет у этого ключа — берём следующую
                if (MV_RETRY_CODES.indexOf(e.code) < 0) { e.message = mvAiHttpError(c.ai, e, chain[i]); throw e; }
                if (a === 0) await new Promise(r => setTimeout(r, MV_AI_RETRY_MS));
            }
        }
    }
    const e = last || mvErr('network', 'нет ответа');
    if (MV_RETRY_CODES.indexOf(e.code) >= 0) {
        e.message = MV_AI_NAMES[c.ai] + ' перегружен или временно недоступен (' + e.code + '). Приложение повторило запрос' + (tried.length > 1 ? ' и пробовало модели: ' + tried.join(', ') : '') + '. Это неполадка на стороне сервиса — попробуйте через минуту.';
    } else e.message = mvAiHttpError(c.ai, e, tried[tried.length - 1]);
    throw e;
}
async function mvAskAi(file) { return mvParseAiJson(await mvAskAiText({ text: MV_AI_PROMPT, imageBlob: await mvAiImage(file) })); }

// ---------- Проверка подключения (кнопка в Настройках) ----------
async function mvTestSources() {
    const out = [], c = mvCfg();
    const run = async (name, on, fn) => {
        if (!on) { out.push({ name, state: 'skip', msg: 'не подключён' }); return; }
        try { out.push({ name, state: 'ok', msg: (await fn()) || 'работает' }); } catch (e) { out.push({ name, state: 'fail', msg: e.message || String(e) }); }
    };
    await run('TMDB', !!mvKey('tmdb'), async () => { const h = await tmdbSearch('Начало'); return 'работает, найдено: ' + h.length; });
    await run('OMDb', !!mvKey('omdb'), async () => { const r = await omdbRatings('tt0111161'); return 'работает (IMDb ' + (r.imdb || '—') + ')'; });
    await run('Кинопоиск', !!mvKey('kp'), async () => { const r = await kpRatings({ title: 'Побег из Шоушенка', year: 1994 }); return r && r.kp ? 'работает (оценка ' + r.kp + ')' : 'ключ принят, но оценка не найдена'; });
    await run('ИИ — ' + (MV_AI_NAMES[c.ai] || ''), mvHasAi(), async () => { const t = await mvAskAiText({ text: 'Ответь JSON {"ok":true}' }); return /ok/i.test(t) ? (mvAiUsedModel && mvAiUsedModel !== mvAiModel() ? 'работает через запасную модель ' + mvAiUsedModel + ' (основная ' + mvAiModel() + ' сейчас перегружена)' : 'работает, модель ' + mvAiModel()) : 'ответил, но неожиданно: ' + String(t).slice(0, 60); });
    return out;
}
