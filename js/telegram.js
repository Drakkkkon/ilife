'use strict';
// =====================================================================================================
// iLife — TELEGRAM-КАНАЛ (версия 1.4.0): превращает посты вашего канала в идеи. Два способа — две кнопки на странице «Идеи».
//
//  1) «Забрать из канала» — сайт сам читает канал через вашего бота (Bot API, прямо из браузера, без своего сервера):
//       getUpdates (channel_post) → очередь постов (localStorage «tg_inbox») → разбор → идеи. Фото, голосовые, аудио и файлы
//       (до 20 МБ — предел Telegram для ботов) скачиваются через getFile и прикрепляются к идее.
//       Бот хранит посты только 24 часа, поэтому очередь сохраняется на устройстве, а «Настройки → Telegram → Забирать
//       автоматически» подхватывает новое при каждом открытии приложения. Старые посты — только вторым способом.
//  2) «Выбрать экспорт» — файлы из Telegram Desktop («Экспорт истории чата»): ZIP целиком, result.json или messages.html
//       (+ при желании сами фото). ZIP читается в браузере (DecompressionStream), ничего никуда не загружается.
//
//  Общий конвейер:  сообщения → альбомы склеиваются в один пост → уже добавленные пропускаются → ИИ (по желанию) → окно со
//  списком будущих идей и галочками → идеи с вложениями. ИИ — тот же Gemini или Claude, что в «Настройки → Кино: базы и оценки»;
//  он получает только ТЕКСТЫ постов (картинки не отправляются) и для каждого поста предлагает хештеги, дату события и,
//  если в посте несколько несвязанных мыслей, разбивку на отдельные идеи. Оригинальный текст ИИ не переписывает.
//  Без ИИ каждый пост (или альбом) — одна идея, хештеги берутся из самого поста.
//
//  Идея запоминает ИСХОДНУЮ дату поста (createdAt), а найденную ИИ дату события — в eventDate (ищется в поиске, видна в заметке).
//  Идентификатор идеи вычисляется из номера канала и сообщения (tg<канал>_<сообщение>): одно и то же сообщение, пришедшее с телефона
//  и с компьютера, при синхронизации Google Диска сливается в одну идею, а удалённая вами идея не воскресает.
// =====================================================================================================

const TG_API = 'https://api.telegram.org/';
const TG_BOT_FILE_MAX = 20 * 1048576;      // getFile у ботов отдаёт файлы только до 20 МБ
const TG_FILE_MAX = 100 * 1048576;         // из экспорта крупнее не берём (память телефона)
const TG_AI_CHUNK = 10;                    // постов в одном запросе к ИИ
const TG_POSTS_MAX = 1500;                 // за один заход
let tgBusy = false;

function tgErr(code, message) { const e = new Error(message); e.code = code; return e; }
// Короткий устойчивый хеш названия (русские буквы в \W не входят, поэтому «убрать не-буквы» для кириллицы давало бы одинаковый пустой идентификатор у всех каналов)
function tgHash(s) { let h = 5381; s = String(s == null ? '' : s); for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return (h >>> 0).toString(36); }
function tgChatNorm(id) { return String(id == null ? '' : id).replace(/^-100/, ''); }   // у каналов Bot API даёт «-100…», экспорт — просто число

// ---------- Настройки и состояние на этом устройстве ----------
function tgCfg() { return Object.assign({ token: '', chat: '', ai: true, tag: true, media: true, auto: false }, LS.get('tg', {})); }
function tgSave(patch) {
    LS.set('tg', Object.assign(tgCfg(), patch));
    if (('token' in patch || 'chat' in patch) && typeof cloudLocalChanged === 'function') cloudLocalChanged();   // токен и канал уходят на Google Диск (gdrive.js)
}
function tgToken() { return String(tgCfg().token || '').replace(/\s+/g, ''); }
function tgState() { return Object.assign({ offset: 0, last: 0, lastAdded: 0 }, LS.get('tg_state', {})); }
function tgStateSave(p) { LS.set('tg_state', Object.assign(tgState(), p)); }
function tgInbox() { const a = LS.get('tg_inbox', []); return Array.isArray(a) ? a : []; }
function tgInboxSave(a) { LS.set('tg_inbox', a.slice(-800)); }
function tgSeenAdd(keys) { if (!keys.length) return; const set = new Set(LS.get('tg_seen', [])); keys.forEach(k => set.add(k)); LS.set('tg_seen', Array.from(set).slice(-12000)); }
function tgChatsKnown() { return LS.get('tg_chats', {}) || {}; }
function tgChatRemember(n) { const c = tgChatsKnown(); c[n.chat] = { title: n.ch || (c[n.chat] && c[n.chat].title) || '', user: n.cu || (c[n.chat] && c[n.chat].user) || '' }; LS.set('tg_chats', c); }
// Всё, что уже обработано: запомненные номера и ссылки в уже существующих идеях (в том числе пришедших с другого устройства)
function tgKnownKeys() {
    const s = new Set(LS.get('tg_seen', []));
    ideas.forEach(i => { if (i.tg && Array.isArray(i.tg.m)) i.tg.m.forEach(id => s.add(tgChatNorm(i.tg.c) + ':' + id)); });
    return s;
}
function tgChatMatches(n, want) {
    want = String(want || '').trim(); if (!want) return true;
    return tgChatNorm(want) === n.chat || want.replace(/^@/, '').toLowerCase() === String(n.cu || '').toLowerCase();
}

// ---------- Bot API ----------
async function tgFetchJson(url, ms) {
    const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = ctl ? setTimeout(() => ctl.abort(), ms || 20000) : 0;
    let res;
    try { res = await fetch(url, ctl ? { signal: ctl.signal } : {}); }
    catch (e) {
        clearTimeout(timer);
        if (e && e.name === 'AbortError') throw tgErr('timeout', 'Telegram не ответил (время вышло)');
        throw tgErr('network', 'Нет связи с Telegram (или браузер закрыл доступ к api.telegram.org)');
    }
    clearTimeout(timer);
    return { res, j: await res.json().catch(() => null) };
}
function tgExplain(code, desc) {
    const d = String(desc || '');
    if (code === 409 && /webhook/i.test(d)) return 'У бота включён вебхук, поэтому читать канал нельзя';
    if (code === 409) return 'Бота сейчас читает другая программа (конфликт getUpdates) — подождите минуту и повторите';
    if (code === 401 || (code === 404 && !/chat|file/i.test(d))) return 'Токен бота не принят — проверьте, что он скопирован целиком (вид 123456789:AA…)';
    if (code === 429) return 'Telegram просит подождать (слишком много запросов) — повторите через минуту';
    if (/chat not found/i.test(d)) return 'Канал не найден или бот не добавлен в канал: добавьте бота администратором канала';
    if (/file is too big/i.test(d)) return 'файл больше 20 МБ — ботам Telegram такие файлы не отдаются';
    if (/not enough rights|forbidden/i.test(d)) return 'у бота нет доступа к каналу: добавьте его администратором';
    return 'Telegram: ' + (d || 'ошибка') + ' (' + code + ')';
}
async function tgApi(method, params) {
    const token = tgToken();
    if (!token) throw tgErr('nokey', 'Токен бота не введён: Настройки → Telegram-канал');
    const q = new URLSearchParams();
    Object.entries(params || {}).forEach(([k, v]) => { if (v !== undefined && v !== null) q.set(k, typeof v === 'object' ? JSON.stringify(v) : String(v)); });   // GET без заголовков — запрос «простой», без предварительной проверки CORS
    const { res, j } = await tgFetchJson(TG_API + 'bot' + token + '/' + method + (q.toString() ? '?' + q.toString() : ''), method === 'getUpdates' ? 30000 : 20000);
    if (!j || j.ok !== true) {
        const code = (j && j.error_code) || res.status, d = (j && j.description) || '';
        throw tgErr(code === 409 && /webhook/i.test(d) ? 'webhook' : code, tgExplain(code, d));
    }
    return j.result;
}
async function tgDownloadFile(fid) {
    const f = await tgApi('getFile', { file_id: fid });
    if (!f || !f.file_path) throw tgErr('file', 'Telegram не отдал файл');
    const res = await fetch(TG_API + 'file/bot' + tgToken() + '/' + f.file_path).catch(() => { throw tgErr('network', 'Нет связи с Telegram'); });
    if (!res.ok) throw tgErr(res.status, 'Файл не скачался (' + res.status + ')');
    return res.blob();
}

// ---------- Сообщения Bot API → единый вид ----------
// { key: 'канал:номер', chat, ch (название), cu (@имя), id, date (мс), text, gid (альбом), from, media: [{ kind, name, mime, size, fid | get }] }
function tgAppendLinks(text, entities) {
    if (!text || !Array.isArray(entities)) return text || '';
    let out = text;
    entities.filter(e => e && e.type === 'text_link' && e.url).sort((a, b) => b.offset - a.offset).forEach(e => {
        const end = e.offset + e.length;
        if (out.slice(e.offset, end).trim() !== e.url) out = out.slice(0, end) + ' (' + e.url + ')' + out.slice(end);   // с конца к началу: смещения не сбиваются
    });
    return out;
}
function tgMediaOf(m) {
    const out = [], id = m.message_id;
    if (Array.isArray(m.photo) && m.photo.length) {
        const p = m.photo.slice().sort((a, b) => (a.file_size || a.width * a.height || 0) - (b.file_size || b.width * b.height || 0)).pop();
        out.push({ kind: 'image', fid: p.file_id, name: 'photo_' + id + '.jpg', mime: 'image/jpeg', size: p.file_size || 0 });
    }
    if (m.voice) out.push({ kind: 'voice', fid: m.voice.file_id, name: 'voice_' + id + '.ogg', mime: m.voice.mime_type || 'audio/ogg', size: m.voice.file_size || 0 });
    if (m.audio) out.push({ kind: 'audio', fid: m.audio.file_id, name: m.audio.file_name || ([m.audio.performer, m.audio.title].filter(Boolean).join(' - ') || 'audio_' + id) + '.mp3', mime: m.audio.mime_type || 'audio/mpeg', size: m.audio.file_size || 0 });
    if (m.document) { const mt = m.document.mime_type || ''; out.push({ kind: /^image\//.test(mt) ? 'image' : /^audio\//.test(mt) ? 'audio' : 'file', fid: m.document.file_id, name: m.document.file_name || 'file_' + id, mime: mt || 'application/octet-stream', size: m.document.file_size || 0 }); }
    else if (m.video) out.push({ kind: 'file', fid: m.video.file_id, name: m.video.file_name || 'video_' + id + '.mp4', mime: m.video.mime_type || 'video/mp4', size: m.video.file_size || 0 });
    else if (m.video_note) out.push({ kind: 'file', fid: m.video_note.file_id, name: 'video_note_' + id + '.mp4', mime: 'video/mp4', size: m.video_note.file_size || 0 });
    return out;
}
function tgFromBotMessage(m) {
    const chat = m.chat || {};
    return { key: tgChatNorm(chat.id) + ':' + m.message_id, chat: tgChatNorm(chat.id), ch: chat.title || chat.username || '', cu: chat.username || '', id: m.message_id, date: (m.date || 0) * 1000,
        text: tgAppendLinks(m.text || m.caption || '', m.entities || m.caption_entities), gid: m.media_group_id || '', from: String(m.sender_chat && m.sender_chat.id || ''), media: tgMediaOf(m) };
}

// Забрать новое из канала в очередь. Очередь пишется на устройство ДО подтверждения позиции у Telegram — при сбое посты не теряются.
async function tgFetchNew() {
    const cfg = tgCfg(); let st = tgState(); const inbox = tgInbox(); const known = tgKnownKeys();
    let added = 0, pages = 0;
    for (;;) {
        const updates = await tgApi('getUpdates', { offset: st.offset || undefined, limit: 100, timeout: 0, allowed_updates: ['channel_post', 'edited_channel_post'] });
        pages++; let maxId = 0;
        for (const u of updates) {
            maxId = Math.max(maxId, u.update_id);
            const m = u.channel_post || u.edited_channel_post; if (!m) continue;
            const n = tgFromBotMessage(m); tgChatRemember(n);
            if (!tgChatMatches(n, cfg.chat) || (!n.text.trim() && !n.media.length) || known.has(n.key)) continue;
            const i = inbox.findIndex(x => x.key === n.key);
            if (i >= 0) inbox[i] = n; else { inbox.push(n); added++; }   // правка поста, который ещё в очереди, — заменяет его
        }
        if (maxId) { st.offset = maxId + 1; tgInboxSave(inbox); tgStateSave({ offset: st.offset }); }
        if (updates.length < 100 || pages >= 30) break;
    }
    tgStateSave({ last: Date.now() });
    return { added, queue: inbox.length };
}

// ---------- Посты, ИИ, план идей ----------
function tgBuildPosts(msgs) {
    const byGroup = new Map(), posts = [];
    msgs.slice().sort((a, b) => a.date - b.date || a.id - b.id).forEach(m => {
        const gk = m.gid ? m.chat + '|' + m.gid : '';
        if (gk && byGroup.has(gk)) {   // альбом: все сообщения — один пост
            const p = byGroup.get(gk); p.refs.push(m.key); p.ids.push(m.id); p.media.push(...m.media);
            if (m.text && !p.text) p.text = m.text; else if (m.text && m.text !== p.text) p.text += '\n' + m.text;
            return;
        }
        const p = { key: m.key, refs: [m.key], chat: m.chat, ch: m.ch, ids: [m.id], date: m.date, text: m.text || '', media: m.media.slice() };
        posts.push(p); if (gk) byGroup.set(gk, p);
    });
    return posts;
}
function tgValidEventDate(v, postDate) {
    const s = String(v || '').trim(); const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s); if (!m) return null;
    const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
    if (d.getUTCFullYear() !== +m[1] || d.getUTCMonth() !== +m[2] - 1 || d.getUTCDate() !== +m[3]) return null;
    return Math.abs(d.getTime() - postDate) < 3 * 365 * 86400000 ? s : null;
}
function tgAiPrompt(chunk, topTags) {
    const data = chunk.map((p, n) => ({ n, date: dayKey(p.date) + ' ' + fmtTime(p.date), weekday: WEEKDAYS[almatyParts(p.date).wd], text: p.text.slice(0, 1500),
        images: p.media.filter(m => m.kind === 'image').length, files: p.media.filter(m => m.kind !== 'image').length }));
    return 'Ты помогаешь вести личный дневник идей. Ниже — посты из личного Telegram-канала автора (JSON). Для каждого поста подготовь данные для заметок в приложении.\n' +
        'Правила:\n' +
        '1. Текст не переписывай, не сокращай и не исправляй. Обычный пост — это ОДНА идея: верни для неё "text": null (приложение возьмёт оригинал). Разделяй пост на несколько идей только если в нём явно несколько несвязанных мыслей (например, список разных идей, каждая на своей строке или с номером); тогда для каждой идеи верни её фрагмент дословно, без номеров и маркеров списка. Если у списка есть общий заголовок («Купить:», «Идеи для ремонта:»), поставь его в начало каждого фрагмента, чтобы фрагмент был понятен сам по себе.\n' +
        '2. "tags" — от 1 до 5 коротких хештегов по смыслу: слова в нижнем регистре, без «#» и пробелов, существительные в начальной форме («идея», «работа», «фильм», «покупки»). Хештеги, уже стоящие в тексте, оставь. Если подходит тег из списка уже используемых — возьми его, а не придумывай синоним. Если текста нет — "tags": [].\n' +
        '3. "date" — дата, к которой относится идея (встреча, срок, событие), в формате ГГГГ-ММ-ДД, если она названа в тексте явно или однозначно следует из слов вроде «завтра», «в пятницу», «через неделю» относительно даты поста. Иначе null. Дату публикации поста не указывай.\n' +
        '4. Ничего не выдумывай. Если не уверен — верни null или пустой список.\n' +
        'Уже используемые теги: ' + JSON.stringify(topTags) + '\nСегодня: ' + todayKey() + '\n' +
        'Ответь только JSON без пояснений: {"posts":[{"n":0,"ideas":[{"text":null,"tags":["идея"],"date":null}]}]}\n' +
        'Посты:\n' + JSON.stringify(data);
}
function tgParseAi(text, chunk) {
    const s = String(text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
    let j = null;
    for (const t of [s, s.slice(s.indexOf('{'), s.lastIndexOf('}') + 1), s.slice(s.indexOf('['), s.lastIndexOf(']') + 1)]) { if (!t) continue; try { j = JSON.parse(t); break; } catch (e) { /* следующий вариант */ } }
    const arr = j && (Array.isArray(j) ? j : (j.posts || j.items || []));
    const out = new Array(chunk.length).fill(null);
    (Array.isArray(arr) ? arr : []).forEach(x => {
        const n = Number(x && x.n); if (!Number.isInteger(n) || n < 0 || n >= chunk.length) return;
        const ideas = (Array.isArray(x.ideas) ? x.ideas : []).filter(Boolean).slice(0, 12).map(i => ({
            text: typeof i.text === 'string' && i.text.trim() ? i.text.trim() : null,
            tags: parseTagString(Array.isArray(i.tags) ? i.tags.join(' ') : String(i.tags || '')).slice(0, 6),
            date: tgValidEventDate(i.date, chunk[n].date)
        }));
        if (ideas.length) out[n] = ideas;
    });
    return out;
}
async function tgAiAll(posts, onProgress, ctl) {
    const chunks = []; for (let i = 0; i < posts.length; i += TG_AI_CHUNK) chunks.push(posts.slice(i, i + TG_AI_CHUNK));
    const top = allTags().slice(0, 40).map(x => x[0]);
    const result = new Map(); let done = 0, failed = 0, lastErr = '', next = 0;
    const worker = async () => {
        while (next < chunks.length && !ctl.stop) {
            const chunk = chunks[next++];
            try {
                const parsed = tgParseAi(await mvAskAiText({ text: tgAiPrompt(chunk, top), maxTokens: 4000 }), chunk);
                chunk.forEach((p, k) => { if (parsed[k]) result.set(p.key, parsed[k]); });
            } catch (e) {
                failed++; lastErr = e.message || String(e);
                if (e.code === 401 || e.code === 403 || e.code === 429 || e.code === 'nokey') ctl.stop = true;   // ключ не принят или лимит — дальше не пытаемся
            }
            done++; if (onProgress) onProgress(done, chunks.length);
        }
    };
    await Promise.all(Array.from({ length: Math.min(3, chunks.length) }, worker));
    return { result, failed, lastErr, stopped: ctl.stop };
}
const tgUniq = a => Array.from(new Set(a));
// Одна идея или несколько — с защитой: если ИИ «потерял» текст, остаётся оригинал целиком
function tgPlanPost(post, ai) {
    const orig = post.text.trim(), own = extractTags(orig);
    if (!ai || !ai.length) return [{ text: orig, tags: own, eventDate: null }];
    const merged = () => ({ text: orig, tags: tgUniq([...own, ...ai.flatMap(i => i.tags)]).slice(0, 8), eventDate: (ai.find(i => i.date) || {}).date || null });
    if (ai.length === 1 || !orig) return [merged()];
    const texts = ai.map(i => i.text);
    const core = orig.replace(/^\s*(?:\d+[.)]|[-•*–—])\s+/gm, '').replace(/\s+/g, ' ');   // без номеров и маркеров списка, которые ИИ убирает сам
    if (texts.some(t => !t) || texts.join(' ').length < core.length * 0.5) return [merged()];
    return ai.map(i => ({ text: i.text, tags: tgUniq([...extractTags(i.text), ...i.tags]).slice(0, 8), eventDate: i.date }));
}
function tgIdeaId(p, k) { return 'tg' + p.chat.replace(/\W/g, '_') + '_' + p.ids[0] + (k ? '_' + k : ''); }
function tgPlans(posts, aiMap, cfg) {
    const rows = [];
    posts.forEach(p => {
        tgPlanPost(p, aiMap && aiMap.get(p.key)).forEach((it, k) => {
            const tags = tgUniq([...it.tags, ...(cfg.tag ? ['telegram'] : [])]);
            rows.push({ id: tgIdeaId(p, k), post: p, text: it.text, tags, eventDate: it.eventDate, date: p.date, media: k === 0 ? p.media : [], on: true });
        });
    });
    return rows;
}

// ---------- Вложения ----------
const TG_MIME = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', ogg: 'audio/ogg', oga: 'audio/ogg', opus: 'audio/ogg', mp3: 'audio/mpeg', m4a: 'audio/mp4', wav: 'audio/wav', flac: 'audio/flac', mp4: 'video/mp4', pdf: 'application/pdf', txt: 'text/plain' };
function tgMimeByName(name) { return TG_MIME[String(name || '').split('.').pop().toLowerCase()] || ''; }
async function tgAttach(m) {
    const blob = m.get ? await m.get() : await tgDownloadFile(m.fid);
    const type = (blob.type && blob.type !== 'application/octet-stream' ? blob.type : '') || m.mime || tgMimeByName(m.name) || 'application/octet-stream';
    const file = new File([blob], m.name || 'file', { type });
    let att;
    if (m.kind === 'image') { try { att = await makeAttachment(file, 'image'); } catch (e) { att = await makeAttachment(file, 'file'); } }
    else if (m.kind === 'audio' || m.kind === 'voice') { att = await makeAttachment(file, 'audio'); att.kind = m.kind; }
    else att = await makeAttachment(file, 'file');
    await persistAttachment(att);
    return attachmentMeta(att);
}

// ---------- Добавление идей ----------
// rows — план идей (r.on — выбрана ли галочкой). Сохраняет пачками по 25: если закрыть окно или вкладку, готовое не теряется.
async function tgCommit(rows, ui) {
    const cfg = tgCfg(); ui = ui || {};
    const deleted = (typeof gMetaGet === 'function' && gMetaGet().deleted.ideas) || {};
    const have = new Set(ideas.map(i => i.id));
    const stat = { added: 0, dup: 0, mediaFail: 0, mediaBig: 0, mediaMissing: 0, skipped: 0 };
    let batch = [], batchPosts = new Set(); const donePosts = new Set(), emptyPosts = new Set();
    const flush = () => {
        if (!batch.length) return;
        ideas.push(...batch);
        if (!saveIdeas()) { batch.forEach(i => { ideas.splice(ideas.indexOf(i), 1); (i.files || []).forEach(f => BlobDB.del(f.id)); }); batch = []; throw tgErr('storage', 'Не хватило места в памяти браузера — идеи не сохранены'); }
        stat.added += batch.length; batch = [];
        tgSeenAdd(Array.from(batchPosts).flatMap(p => p.refs)); batchPosts = new Set();
        tgInboxSave(tgInbox().filter(x => !donePosts.has(x.key))); IX.clear(); renderIdeas();
    };
    const sel = rows.filter(r => r.on);
    try {
        for (let n = 0; n < sel.length; n++) {
            if (ui.cancelled) break;
            const r = sel[n]; if (ui.progress) ui.progress(n, sel.length);
            if (have.has(r.id) || deleted[r.id]) { stat.dup++; continue; }
            const files = [];
            if (cfg.media) for (const m of r.media) {
                try {
                    if (m.missing) { stat.mediaMissing++; continue; }
                    if ((m.fid && m.size > TG_BOT_FILE_MAX) || (m.size > TG_FILE_MAX)) { stat.mediaBig++; continue; }
                    files.push(await tgAttach(m));
                } catch (e) { stat.mediaFail++; console.warn('Вложение не добавлено', m.name, e); }
            }
            if (!r.text && !files.length) { stat.skipped++; emptyPosts.add(r.post); continue; }   // добавлять нечего (файл недоступен) — пост не помечаем обработанным
            const idea = { id: r.id, text: r.text, tags: r.tags, createdAt: r.date, updatedAt: Date.now(), author: authorName(), files, track: null, tg: { c: r.post.chat, m: r.post.ids, ch: r.post.ch } };
            if (r.eventDate) idea.eventDate = r.eventDate;
            batch.push(idea); batchPosts.add(r.post); donePosts.add(r.post.key); have.add(r.id);
            if (batch.length >= 25) flush();
        }
        flush();
    } finally { try { flush(); } catch (e) { /* уже сообщили */ } }
    if (!ui.cancelled) {   // снятые с галочки и разобранные посты больше не предлагаются; пропущенные «пустые» — из очереди уходят, но при повторном импорте с файлами вернутся
        const seen = rows.filter(r => !r.on).flatMap(r => r.post.refs), drop = seen.slice();
        sel.forEach(r => { drop.push(...r.post.refs); if (!emptyPosts.has(r.post)) seen.push(...r.post.refs); });
        tgSeenAdd(seen);
        const dropSet = new Set(drop); tgInboxSave(tgInbox().filter(x => !dropSet.has(x.key)));
    }
    tgStateSave({ lastAdded: Date.now() });
    return stat;
}
function tgStatText(s) {
    let t = s.added ? 'Добавлено идей: ' + s.added : 'Новых идей не добавлено';
    if (s.dup) t += ' · уже были: ' + s.dup;
    if (s.mediaFail) t += ' · не скачано вложений: ' + s.mediaFail;
    if (s.mediaBig) t += ' · слишком крупных вложений: ' + s.mediaBig;
    if (s.mediaMissing) t += ' · вложений нет в выбранных файлах: ' + s.mediaMissing;
    if (s.skipped) t += ' · пропущено постов без текста, чьи файлы недоступны: ' + s.skipped;
    return t;
}

// ---------- Окна ----------
function tgRowHtml(r, i) {
    const imgs = r.media.filter(m => m.kind === 'image').length, rest = r.media.length - imgs;
    const meta = [ic('calendar_today') + esc(fmtDateTime(r.date))];
    if (imgs) meta.push(ic('image') + imgs);
    if (rest) meta.push(ic('attach_file') + rest);
    if (r.eventDate) meta.push('<span class="evt">' + ic('event') + 'на ' + esc(fmtDayKey(r.eventDate)) + '</span>');
    return '<label class="tg-row"><input type="checkbox" class="check" data-i="' + i + '" checked aria-label="Добавить эту идею"><span class="tx"><span class="dt">' + meta.map(x => '<span>' + x + '</span>').join('') + '</span>' +
        '<div class="body' + (r.text ? '' : ' is-empty') + '">' + esc(r.text ? r.text.slice(0, 400) : 'без текста — только вложения') + '</div>' +
        (r.tags.length ? '<div class="chips">' + r.tags.map(t => '<span class="chip tag">#' + esc(t) + '</span>').join('') + '</div>' : '') + '</span></label>';
}
function tgPreviewSheet(rows, info) {
    return new Promise(resolve => {
        const posts = new Set(rows.map(r => r.post)).size;
        const html = '<p class="hint tg-sum">Постов: ' + posts + ' → идей: ' + rows.length + '. ' + esc(info.ai) + ' Уберите галочки с лишнего. Снятые посты больше не появятся в очереди.</p>' +
            '<div class="tg-tools"><button type="button" class="btn btn-text" data-all="1">' + ic('check_box') + 'Выбрать все</button><button type="button" class="btn btn-text" data-all="0">' + ic('check_box_outline_blank') + 'Снять все</button></div>' +
            '<div class="tg-list">' + rows.map(tgRowHtml).join('') + '</div>' +
            '<div class="tg-prog" id="tg-prog" hidden><div class="lbl" id="tg-prog-l"></div><div class="progress"><i id="tg-prog-b"></i></div></div>';
        const ui = { cancelled: false, running: false };
        let result = null;
        const sheet = openSheet({
            title: 'Идеи из Telegram', html,
            actions: [{ label: 'Отмена' }, { label: 'Добавить', kind: 'primary', icon: 'check', async onClick(api) {
                const btn = $('.sheet-actions [data-act="1"]', api.el); if (ui.running) return false;
                ui.running = true; btn.disabled = true;
                $('#tg-prog', api.el).hidden = false;
                ui.progress = (n, total) => { $('#tg-prog-l', api.el).textContent = 'Сохраняем: ' + (n + 1) + ' из ' + total + ' (картинки и файлы скачиваются)…'; $('#tg-prog-b', api.el).style.width = Math.round(n / Math.max(total, 1) * 100) + '%'; };
                try { result = await tgCommit(rows, ui); toast(tgStatText(result), { ms: 5200 }); }
                catch (e) { toast(e.message || 'Не удалось добавить идеи', { ms: 6000 }); }
                ui.running = false;
            } }],
            onClose: () => { ui.cancelled = true; resolve(result); }
        });
        const root = sheet.el, addBtn = $('.sheet-actions [data-act="1"]', root);
        const refresh = () => { const n = rows.filter(r => r.on).length; addBtn.innerHTML = ic('check') + 'Добавить (' + n + ')'; addBtn.disabled = ui.running || !n; };
        $('.tg-list', root).addEventListener('change', e => { const c = e.target.closest('input[data-i]'); if (c) { rows[+c.dataset.i].on = c.checked; refresh(); } });
        $('.tg-tools', root).addEventListener('click', e => {
            const b = e.target.closest('[data-all]'); if (!b) return;
            const on = b.dataset.all === '1'; rows.forEach(r => { r.on = on; }); $$('.tg-list input[data-i]', root).forEach(c => { c.checked = on; }); refresh();
        });
        refresh();
    });
}
function tgAiSheet() {
    const ctl = { stop: false };
    const sheet = openSheet({
        title: 'ИИ разбирает посты',
        html: '<p class="hint" style="font-size:0.875rem;color:var(--md-on-surface)">Тексты постов отправляются в ' + esc(MV_AI_NAMES[mvCfg().ai] || 'ИИ') + ' (картинки — нет). Это займёт немного времени.</p><div class="tg-prog"><div class="lbl" id="tgai-l">Подготовка…</div><div class="progress"><i id="tgai-b"></i></div></div>',
        actions: [{ label: 'Без ИИ', icon: 'close', onClick: () => { ctl.stop = true; return false; } }],
        onClose: () => { ctl.stop = true; }
    });
    return { ctl, sheet, set(done, total) { const l = $('#tgai-l', sheet.el), b = $('#tgai-b', sheet.el); if (l) l.textContent = 'Готово ' + done + ' из ' + total; if (b) b.style.width = Math.round(done / Math.max(total, 1) * 100) + '%'; } };
}

// Общий конвейер для обоих способов: msgs — сообщения в едином виде
async function tgProcess(msgs, opts) {
    opts = opts || {}; const cfg = tgCfg();
    const known = tgKnownKeys();
    const fresh = msgs.filter(m => !known.has(m.key));
    if (msgs.length > fresh.length && opts.queue) tgInboxSave(tgInbox().filter(x => !known.has(x.key)));
    let posts = tgBuildPosts(fresh);
    if (!posts.length) { if (!opts.auto) toast(msgs.length ? 'Все эти посты уже добавлены раньше' : 'Нет постов для добавления', { ms: 4200 }); return null; }
    let note = '';
    if (posts.length > TG_POSTS_MAX) { posts = posts.slice(-TG_POSTS_MAX); note = ' Взяты последние ' + TG_POSTS_MAX + ' постов — остальные добавьте отдельным заходом (период по дате).'; }
    let aiMap = null, aiNote = 'ИИ не использовался: каждый пост — одна идея.';
    const aiPosts = posts.filter(p => p.text.trim());   // посты только с вложениями ИИ не нужны — разбирать нечего
    if (cfg.ai && mvHasAi() && aiPosts.length) {
        const ui = opts.auto ? { ctl: { stop: false }, set() {}, sheet: { close() {} } } : tgAiSheet();
        const r = await tgAiAll(aiPosts, (d, t) => ui.set(d, t), ui.ctl);
        ui.sheet.close();
        aiMap = r.result;
        aiNote = r.failed || aiMap.size < aiPosts.length   // в том числе когда ИИ ответил не JSON-ом
            ? 'ИИ разобрал ' + aiMap.size + ' из ' + aiPosts.length + (r.lastErr ? ' (' + r.lastErr.slice(0, 120) + ')' : '') + '; остальные — без ИИ.'
            : 'ИИ разобрал посты: теги, даты событий, разбивка списков.';
    }
    const rows = tgPlans(posts, aiMap, cfg);
    if (opts.auto) {
        const s = await tgCommit(rows, {});
        if (s.added) toast('Из Telegram добавлено идей: ' + s.added, { ms: 4200 });
        return s;
    }
    return tgPreviewSheet(rows, { ai: aiNote + note });
}

// ---------- Способ 1: «Забрать из канала» ----------
function tgOpenSettings() { showTab('settings'); setTimeout(() => { const c = $('#tg-cfg-card'); if (c) { c.classList.remove('is-collapsed'); collapsedCards.delete('tg-cfg-card'); c.scrollIntoView({ behavior: 'smooth', block: 'start' }); } }, 350); }
function tgShowError(title, e) { const t = e && e.message ? e.message : String(e); if (typeof gExplain === 'function') gExplain(title, t); else toast(t, { ms: 7000 }); }
async function tgSyncFromChannel(opts) {
    opts = opts || {};
    if (tgBusy) { if (!opts.auto) toast('Уже идёт обработка — подождите'); return; }
    if (!tgToken()) { if (!opts.auto) { toast('Сначала введите токен бота'); tgOpenSettings(); } return; }
    if (!navigator.onLine) { if (!opts.auto) toast('Нет интернета'); return; }
    tgBusy = true; renderTelegramBlock();
    try {
        let r;
        try { r = await tgFetchNew(); }
        catch (e) {
            if (e.code !== 'webhook' || opts.auto) throw e;
            if (!(await confirmSheet('У бота включён вебхук', 'Пока вебхук включён, Telegram не отдаёт посты через getUpdates. Отключить вебхук? Если вы используете этого бота ещё где-то, он перестанет получать сообщения.', 'Отключить', true))) return;
            await tgApi('deleteWebhook', { drop_pending_updates: false });
            r = await tgFetchNew();
        }
        const inbox = tgInbox();
        if (!inbox.length) { if (!opts.auto) gExplainSafe('Новых постов нет', 'Бот видит только посты, опубликованные после добавления его в канал, и не старше суток. Если вы публиковали пост только что — убедитесь, что бот добавлен администратором канала, и нажмите «Проверить бота и канал» в «Настройки → Telegram-канал». Старые посты загрузите вторым способом: «Выбрать экспорт».'); return; }
        await tgProcess(inbox, { auto: !!opts.auto, queue: true });
    } catch (e) { if (opts.auto) console.warn('Telegram:', e); else tgShowError('Не удалось забрать посты', e); }
    finally { tgBusy = false; renderTelegramBlock(); }
}
function gExplainSafe(t, m) { if (typeof gExplain === 'function') gExplain(t, m); else toast(m, { ms: 7000 }); }

// ---------- Способ 2: экспорт Telegram Desktop ----------
async function tgReadZip(file) {
    const size = file.size, tailLen = Math.min(size, 65557 + 22 + 20);
    const tail = new DataView(await file.slice(size - tailLen).arrayBuffer());
    let eocd = -1; for (let i = tail.byteLength - 22; i >= 0; i--) if (tail.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    if (eocd < 0) throw tgErr('zip', 'Не удалось прочитать ZIP: это не архив или он повреждён');
    let count = tail.getUint16(eocd + 10, true), cdSize = tail.getUint32(eocd + 12, true), cdOff = tail.getUint32(eocd + 16, true);
    if ((cdOff === 0xFFFFFFFF || count === 0xFFFF || cdSize === 0xFFFFFFFF) && eocd >= 20 && tail.getUint32(eocd - 20, true) === 0x07064b50) {   // ZIP64
        const z64 = new DataView(await file.slice(Number(tail.getBigUint64(eocd - 20 + 8, true)), Number(tail.getBigUint64(eocd - 20 + 8, true)) + 56).arrayBuffer());
        if (z64.getUint32(0, true) === 0x06064b50) { count = Number(z64.getBigUint64(32, true)); cdSize = Number(z64.getBigUint64(40, true)); cdOff = Number(z64.getBigUint64(48, true)); }
    }
    const cd = new DataView(await file.slice(cdOff, cdOff + cdSize).arrayBuffer()), dec = new TextDecoder('utf-8');
    const out = []; let p = 0;
    for (let n = 0; n < count && p + 46 <= cd.byteLength; n++) {
        if (cd.getUint32(p, true) !== 0x02014b50) break;
        const flags = cd.getUint16(p + 8, true), method = cd.getUint16(p + 10, true);
        let csize = cd.getUint32(p + 20, true), usize = cd.getUint32(p + 24, true), lho = cd.getUint32(p + 42, true);
        const nlen = cd.getUint16(p + 28, true), elen = cd.getUint16(p + 30, true), clen = cd.getUint16(p + 32, true);
        const name = dec.decode(new Uint8Array(cd.buffer, cd.byteOffset + p + 46, nlen));
        if (usize === 0xFFFFFFFF || csize === 0xFFFFFFFF || lho === 0xFFFFFFFF) {
            let q = p + 46 + nlen; const end = q + elen;
            while (q + 4 <= end) {
                const id = cd.getUint16(q, true), len = cd.getUint16(q + 2, true);
                if (id === 1) { let r = q + 4; if (usize === 0xFFFFFFFF) { usize = Number(cd.getBigUint64(r, true)); r += 8; } if (csize === 0xFFFFFFFF) { csize = Number(cd.getBigUint64(r, true)); r += 8; } if (lho === 0xFFFFFFFF) { lho = Number(cd.getBigUint64(r, true)); } }
                q += 4 + len;
            }
        }
        p += 46 + nlen + elen + clen;
        if (name.endsWith('/') || (flags & 1)) continue;   // папка или файл с паролем
        const e = { method, csize, lho };
        out.push({ path: name, size: usize, get: () => tgZipEntryBlob(file, e) });
    }
    return out;
}
async function tgZipEntryBlob(file, e) {
    const h = new DataView(await file.slice(e.lho, e.lho + 30).arrayBuffer());
    if (h.getUint32(0, true) !== 0x04034b50) throw tgErr('zip', 'ZIP повреждён');
    const start = e.lho + 30 + h.getUint16(26, true) + h.getUint16(28, true), raw = file.slice(start, start + e.csize);
    if (e.method === 0) return raw;
    if (e.method === 8) {
        if (typeof DecompressionStream === 'undefined') throw tgErr('zip', 'Этот браузер не умеет распаковывать ZIP — распакуйте архив и выберите файлы по отдельности');
        return new Response(raw.stream().pipeThrough(new DecompressionStream('deflate-raw'))).blob();
    }
    throw tgErr('zip', 'В ZIP использован неподдерживаемый способ сжатия (' + e.method + ')');
}
async function tgCollectEntries(files) {
    const entries = [];
    for (const f of files) {
        if (/\.zip$/i.test(f.name) || /zip/.test(f.type || '')) (await tgReadZip(f)).forEach(e => entries.push(e));
        else entries.push({ path: f.webkitRelativePath || f.name, size: f.size, get: async () => f });
    }
    return entries;
}
const tgNormPath = p => String(p || '').replace(/\\/g, '/').replace(/^\.?\//, '').toLowerCase();
function tgMakeResolver(entries) {   // путь из сообщения («photos/photo_1@….jpg») → файл среди выбранных (по любому хвосту пути)
    const map = new Map();
    entries.forEach(e => { const parts = tgNormPath(e.path).split('/'); for (let i = 0; i < parts.length; i++) { const k = parts.slice(i).join('/'); if (!map.has(k)) map.set(k, e); } });
    return path => {
        let raw = String(path || ''), found = map.get(tgNormPath(raw));
        if (!found) { try { found = map.get(tgNormPath(decodeURIComponent(raw))); } catch (e) { /* не URL-кодировка */ } }
        return found || map.get(tgNormPath(raw).split('/').pop()) || null;
    };
}
function tgMediaFromExport(path, kind, name, mime, resolve, stat) {
    if (!path || /^\(.*\)$/.test(String(path).trim())) { stat.missing++; return null; }   // «(File not included…)» — при экспорте не отметили скачивание
    const e = resolve(path);
    if (!e) stat.notFound++;   // в сообщении есть вложение, а среди выбранных файлов его нет
    const base = String(path).split('/').pop();
    return { kind, name: name || base, mime: mime || tgMimeByName(name || base), size: e ? e.size : 0, get: e ? () => e.get() : null, missing: !e };
}
// --- JSON (result.json)
function tgExportText(t) {
    if (typeof t === 'string') return t;
    if (!Array.isArray(t)) return '';
    return t.map(p => typeof p === 'string' ? p : (p && p.type === 'text_link' && p.href && p.href !== p.text ? p.text + ' (' + p.href + ')' : (p && p.text) || '')).join('');
}
function tgChatsFromJson(data) {
    const out = [], add = c => { if (c && Array.isArray(c.messages)) out.push({ name: c.name || 'Чат', type: String(c.type || ''), id: c.id == null ? '' : String(c.id), messages: c.messages }); };
    if (data && Array.isArray(data.messages)) add(data); else if (data && data.chats && Array.isArray(data.chats.list)) data.chats.list.forEach(add);
    return out;
}
function tgNormalizeExportJson(chat, resolve, stat) {
    const chatId = tgChatNorm(chat.id || ('x' + tgHash(chat.name)));
    const out = [];
    chat.messages.forEach(m => {
        if (!m || m.type !== 'message') return;
        const text = tgExportText(m.text);
        const unix = Number(m.date_unixtime), date = unix ? unix * 1000 : (Date.parse(m.date) || 0);
        const media = [];
        if (m.photo) { const x = tgMediaFromExport(m.photo, 'image', '', 'image/jpeg', resolve, stat); if (x) media.push(x); }
        if (m.file && m.media_type !== 'sticker') {
            const mt = m.mime_type || '', mtype = m.media_type || '';
            const kind = mtype === 'voice_message' ? 'voice' : mtype === 'audio_file' || /^audio\//.test(mt) ? 'audio' : /^image\//.test(mt) ? 'image' : 'file';
            const x = tgMediaFromExport(m.file, kind, m.file_name || '', mt, resolve, stat); if (x) media.push(x);
        }
        if (!text.trim() && !media.length) { if (m.photo || m.file) stat.emptyMedia++; return; }
        out.push({ key: chatId + ':' + m.id, chat: chatId, ch: chat.name, cu: '', id: Number(m.id), date, text, gid: '', from: String(m.from_id || m.from || ''), media });
    });
    return out;
}
// --- HTML (messages.html, messages2.html …)
function tgHtmlText(node) {
    let out = '';
    node.childNodes.forEach(n => {
        if (n.nodeType === 3) out += n.nodeValue;
        else if (n.nodeName === 'BR') out += '\n';
        else if (n.nodeName === 'A') {
            const t = tgHtmlText(n), h = n.getAttribute('href') || '';
            out += /^https?:\/\//i.test(h) && h.replace(/\/$/, '') !== t.trim().replace(/\/$/, '') ? t + ' (' + h + ')' : t;
        } else out += tgHtmlText(n);
    });
    return out;
}
function tgParseHtmlDate(s) {
    const m = /(\d{2})\.(\d{2})\.(\d{4}) (\d{2}):(\d{2}):(\d{2})(?: UTC([+-]\d{2}):(\d{2}))?/.exec(String(s || '')); if (!m) return 0;
    const off = m[7] ? (parseInt(m[7], 10) < 0 || m[7][0] === '-' ? -1 : 1) * (Math.abs(parseInt(m[7], 10)) * 60 + parseInt(m[8], 10)) : -new Date().getTimezoneOffset();
    return Date.UTC(+m[3], +m[2] - 1, +m[1], +m[4], +m[5], +m[6]) - off * 60000;
}
function tgParseHtmlExport(htmlText, resolve, stat, chatName, chatId) {
    const doc = new DOMParser().parseFromString(htmlText, 'text/html');
    const out = [];
    doc.querySelectorAll('.message').forEach(el => {
        if (el.classList.contains('service')) return;
        const id = Number(String(el.id || '').replace(/\D/g, '')); if (!id) return;
        const t = el.querySelector('.body .text'), text = t ? tgHtmlText(t).replace(/\n{3,}/g, '\n\n').trim() : '';
        const date = tgParseHtmlDate((el.querySelector('.date.details') || el.querySelector('.date') || {}).title || '');
        const media = [];
        el.querySelectorAll('a[href]').forEach(a => {
            const h = a.getAttribute('href') || ''; const m = /^(photos|files|voice_messages|video_files|round_video_messages|audio_files?)\//i.exec(h); if (!m) return;
            if (/_thumb\./i.test(h)) return;
            const folder = m[1].toLowerCase(), kind = folder === 'photos' ? 'image' : folder === 'voice_messages' ? 'voice' : /^audio/.test(folder) ? 'audio' : (tgMimeByName(h).startsWith('image/') ? 'image' : tgMimeByName(h).startsWith('audio/') ? 'audio' : 'file');
            const x = tgMediaFromExport(h, kind, '', '', resolve, stat); if (x) media.push(x);
        });
        if (!text && !media.length) return;
        out.push({ key: chatId + ':' + id, chat: chatId, ch: chatName, cu: '', id, date, text, gid: '', from: ((el.querySelector('.from_name') || {}).textContent || '').trim(), media });
    });
    return out;
}
// Альбомы в экспорте не помечены — склеиваем подряд идущие сообщения с вложениями, отправленные в одну секунду
function tgMarkAlbums(msgs) {
    let grp = null;
    msgs.forEach(n => {
        if (n.media.length && grp && Math.abs(n.date - grp.date) <= 1500 && (!n.text || !grp.text) && grp.from === n.from) { n.gid = grp.gid; if (n.text) grp.text = true; grp.date = n.date; }
        else if (n.media.length) { grp = { gid: 'g' + n.id, date: n.date, text: !!n.text, from: n.from }; n.gid = grp.gid; }
        else grp = null;
    });
    return msgs;
}
function tgChatLabel(type) { return /channel/.test(type) ? 'канал' : /group/.test(type) ? 'группа' : /saved/.test(type) ? '«Избранное»' : /personal|private/.test(type) ? 'личный чат' : ''; }
function tgPickChat(chats) {
    return new Promise(resolve => {
        const list = chats.slice().sort((a, b) => b.messages.length - a.messages.length).slice(0, 60);
        let picked = null;
        const sheet = openSheet({ title: 'Какой чат взять?', html: '<p class="hint" style="margin:0 4px 8px">В экспорте несколько чатов. Выберите тот, где лежат ваши идеи.</p>' +
            list.map((c, i) => '<button type="button" class="track-row" data-i="' + i + '"><span class="cv">' + ic('send') + '</span><span class="tx"><div class="nm">' + esc(c.name) + '</div><div class="sub">' + [tgChatLabel(c.type), 'сообщений: ' + c.messages.length].filter(Boolean).join(' · ') + '</div></span></button>').join(''),
            onClose: () => resolve(picked) });
        sheet.el.addEventListener('click', e => { const b = e.target.closest('[data-i]'); if (b) { picked = list[+b.dataset.i]; sheet.close(); } });
    });
}
// Период: если новых сообщений много — спросить, сколько брать
function tgPeriodSheet(msgs) {
    return new Promise(resolve => {
        const dates = msgs.map(m => m.date).filter(Boolean).sort((a, b) => a - b);
        const range = dates.length ? fmtDate(dates[0], true) + ' — ' + fmtDate(dates[dates.length - 1], true) : '';
        let result = null;
        const sheet = openSheet({
            title: 'Что добавить?',
            html: '<p class="hint" style="margin:0 4px 8px">Новых сообщений: <b>' + msgs.length + '</b>' + (range ? ' (' + esc(range) + ')' : '') + '.</p><div class="tg-opts">' +
                '<label class="tg-opt"><input type="radio" name="tgp" value="all" checked><span>Всё</span></label>' +
                '<label class="tg-opt"><input type="radio" name="tgp" value="30"><span>За последние 30 дней</span></label>' +
                '<label class="tg-opt"><input type="radio" name="tgp" value="date"><span>Начиная с даты</span><input type="date" id="tgp-date" aria-label="Начиная с даты"></label></div>',
            actions: [{ label: 'Отмена' }, { label: 'Продолжить', kind: 'primary', icon: 'check', onClick() {
                const v = (sheet.el.querySelector('input[name="tgp"]:checked') || {}).value; let from = 0;
                if (v === '30') from = Date.now() - 30 * 86400000;
                else if (v === 'date') { const d = $('#tgp-date', sheet.el).value; if (!d) { toast('Выберите дату'); return false; } from = keyToMs(d) - 12 * 3600000; }
                result = msgs.filter(m => m.date >= from);
            } }],
            onClose: () => resolve(result)
        });
        $('#tgp-date', sheet.el).addEventListener('focus', () => { const r = sheet.el.querySelector('input[value="date"]'); if (r) r.checked = true; });
    });
}
async function tgImportFiles(fileList) {
    const files = Array.from(fileList || []); if (!files.length) return;
    if (tgBusy) { toast('Уже идёт обработка — подождите'); return; }
    tgBusy = true; renderTelegramBlock();
    try {
        toast('Читаем экспорт…', { ms: 2500 });
        const entries = await tgCollectEntries(files);
        const resolve = tgMakeResolver(entries), stat = { missing: 0, emptyMedia: 0, notFound: 0 };
        let chats = [];
        // 1) JSON
        const jsons = entries.filter(e => /\.json$/i.test(e.path) && e.size < 400 * 1048576).sort((a, b) => (/result\.json$/i.test(b.path) ? 1 : 0) - (/result\.json$/i.test(a.path) ? 1 : 0));
        for (const e of jsons) {
            let data = null; try { data = JSON.parse(await (await e.get()).text()); } catch (err) { continue; }
            tgChatsFromJson(data).forEach(c => chats.push({ name: c.name, type: c.type, id: c.id, messages: c.messages, json: true }));
            if (chats.length) break;
        }
        let msgs = null, chat = null;
        if (chats.length) {
            chat = chats.length === 1 ? chats[0] : await tgPickChat(chats);
            if (!chat) return;
            msgs = tgNormalizeExportJson(chat, resolve, stat);
        } else {
            // 2) HTML
            const htmls = entries.filter(e => /(^|\/)messages\d*\.html?$/i.test(e.path)).sort((a, b) => (parseInt((a.path.match(/messages(\d*)\.html?$/i) || [])[1] || '1', 10)) - (parseInt((b.path.match(/messages(\d*)\.html?$/i) || [])[1] || '1', 10)));
            if (!htmls.length) throw tgErr('format', 'В выбранных файлах нет экспорта Telegram. Нужен ZIP с экспортом, файл result.json (формат JSON) или messages.html (формат HTML) из «Экспорт истории чата» в Telegram Desktop.');
            msgs = [];
            let name = '';
            for (const e of htmls) {
                const textHtml = await (await e.get()).text();
                if (!name) { const m = /<div class="text bold">\s*([^<]+?)\s*<\/div>/.exec(textHtml); name = m ? ytDecode(m[1]) : ''; }
                const known = Object.entries(tgChatsKnown()).find(([, c]) => name && (c.title === name || c.user === name));   // номер канала из прежних заходов бота — чтобы не было дублей
                const chatId = known ? known[0] : 'h' + tgHash(name || 'chat');
                tgParseHtmlExport(textHtml, resolve, stat, name || 'Telegram', chatId).forEach(m => msgs.push(m));
            }
            chat = { name: name || 'Telegram' };
        }
        msgs.sort((a, b) => a.date - b.date || a.id - b.id); tgMarkAlbums(msgs);
        if (!msgs.length) throw tgErr('empty', 'В экспорте нет сообщений с текстом или вложениями.');
        // уже добавленные — не считаем
        const known = tgKnownKeys(); let fresh = msgs.filter(m => !known.has(m.key));
        if (!fresh.length) { toast('Все сообщения из этого экспорта уже добавлены раньше', { ms: 4500 }); return; }
        if (fresh.length > 30) { fresh = await tgPeriodSheet(fresh); if (!fresh || !fresh.length) return; }
        if (stat.notFound && !files.some(f => /\.zip$/i.test(f.name))) toast('В экспорте есть вложения, но самих файлов среди выбранных нет — будут только тексты. Выберите ZIP целиком или добавьте файлы из папок photos, files, voice_messages.', { ms: 7000 });
        else if (stat.missing) toast('При экспорте не были скачаны фото и файлы («File not included») — будут только тексты. Повторите экспорт с включёнными «Фото» и «Файлы».', { ms: 7000 });
        await tgProcess(fresh, { auto: false, queue: false });
    } catch (e) { tgShowError('Не удалось прочитать экспорт', e); }
    finally { tgBusy = false; renderTelegramBlock(); }
}

// ---------- Блок на странице «Идеи» ----------
function renderTelegramBlock() {
    const card = $('#tg-card'); if (!card) return;
    const cfg = tgCfg(), st = tgState(), q = tgInbox().length, has = !!tgToken(), ai = mvHasAi();
    let s;
    if (!has) s = 'Бот ещё не подключён: «Забрать из канала» заработает после ввода токена в «Настройки → Telegram-канал». Способ «Из экспорта» работает и без бота.';
    else s = 'Бот подключён · ' + (cfg.chat ? 'канал: ' + cfg.chat : 'все каналы, где бот администратор') + ' · ' + (st.last ? 'проверка: ' + fmtDateTime(st.last) : 'ещё не проверяли') + (cfg.auto ? ' · автоматически' : '') + '.';
    $('#tg-status').textContent = s;
    $('#tg-badge').textContent = q ? 'в очереди: ' + q : '';
    const sw = $('#tg-ai'); sw.checked = !!cfg.ai && ai; sw.disabled = !ai;
    $('#tg-ai-row').classList.toggle('is-disabled', !ai);
    $('#tg-ai-sub').textContent = ai ? 'Свои хештеги, даты событий, разбивка списков на отдельные идеи. Картинки ИИ не отправляются' : 'ИИ не подключён: выберите Gemini или Claude и вставьте ключ в «Настройки → Кино: базы и оценки». Без ИИ посты становятся идеями как есть';
    $('#tg-sync').disabled = tgBusy; $('#tg-import').disabled = tgBusy;
}

// ---------- Настройки → Telegram-канал ----------
function renderTelegramCard() {
    if (!$('#tg-cfg-card')) return;
    const cfg = tgCfg();
    const tok = $('#tgc-token'); if (document.activeElement !== tok) tok.value = cfg.token;
    const ch = $('#tgc-chat'); if (document.activeElement !== ch) ch.value = cfg.chat;
    $('#tgc-tag').checked = !!cfg.tag; $('#tgc-media').checked = !!cfg.media; $('#tgc-auto').checked = !!cfg.auto;
    const b = $('#tgc-badge'), on = !!tgToken(); b.textContent = on ? 'Бот введён' : 'Не настроено';
    b.style.background = on ? 'color-mix(in oklab, var(--md-income) 24%, var(--md-container))' : ''; b.style.color = on ? 'var(--md-income)' : '';
    $('#tgc-ai-info').textContent = mvHasAi()
        ? 'ИИ для разбора постов: ' + (MV_AI_NAMES[mvCfg().ai] || '') + (cfg.ai ? ' (включён' : ' (выключен') + ' переключателем на странице «Идеи»).'
        : 'ИИ не подключён (блок «Кино: базы и оценки» ниже) — посты будут добавляться без ИИ.';
}
async function tgTest() {
    const out = $('#tgc-out'), rows = [];
    const paint = () => { out.innerHTML = rows.map(r => '<div class="mv-test is-' + r.state + '"><span class="dot"></span><b>' + esc(r.name) + '</b><span>' + (r.html || esc(r.msg)) + '</span></div>').join(''); };
    const add = (state, name, msg, html) => { rows.push({ state, name, msg, html }); paint(); };
    rows.length = 0; out.innerHTML = '<div class="mv-test"><span class="dot"></span><b>Telegram</b><span>проверяем…</span></div>';
    let me;
    try { me = await tgApi('getMe'); rows.length = 0; add('ok', 'Бот', '@' + me.username + (me.first_name ? ' («' + me.first_name + '»)' : '') + ' — токен принят'); }
    catch (e) { rows.length = 0; add('fail', 'Бот', e.message); return; }
    let webhook = false;
    try { const w = await tgApi('getWebhookInfo'); if (w && w.url) { webhook = true; add('fail', 'Вебхук', '', 'у бота включён вебхук — читать канал нельзя. <button type="button" class="btn btn-text" id="tgc-del-wh" style="min-height:2rem;padding:0 0.5rem">Отключить вебхук</button>'); } else add('ok', 'Вебхук', 'нет — всё в порядке'); }
    catch (e) { add('fail', 'Вебхук', e.message); }
    if (!webhook) {
        try {
            const ups = await tgApi('getUpdates', { limit: 100, timeout: 0, allowed_updates: ['channel_post'] });   // без offset — только посмотреть, позицию не двигаем
            ups.forEach(u => { if (u.channel_post) tgChatRemember(tgFromBotMessage(u.channel_post)); });
            const known = Object.entries(tgChatsKnown());
            if (known.length) add('ok', 'Каналы', '', known.map(([id, c]) => esc((c.title || '(без названия)') + (c.user ? ' @' + c.user : '') + ' — номер -100' + id)).join('<br>'));
            else add('fail', 'Каналы', 'бот пока не видел ни одного поста. Добавьте его администратором канала, опубликуйте пост и проверьте ещё раз.');
        } catch (e) { add('fail', 'Каналы', e.message); }
    }
    const want = tgCfg().chat.trim();
    if (want) {
        try {
            const chat = await tgApi('getChat', { chat_id: /^-?\d+$/.test(want) ? (want.startsWith('-') ? want : '-100' + want) : (want.startsWith('@') ? want : '@' + want) });
            let role = ''; try { const mem = await tgApi('getChatMember', { chat_id: chat.id, user_id: me.id }); role = mem.status === 'administrator' || mem.status === 'creator' ? ', бот — администратор' : ', но бот не администратор (' + mem.status + ')'; } catch (e) { /* роль необязательна */ }
            add(role.includes('не администратор') ? 'fail' : 'ok', 'Канал', '«' + (chat.title || chat.username) + '»' + role);
        } catch (e) { add('fail', 'Канал', e.message); }
    }
}
function initTelegram() {
    if (!$('#tg-card')) return;
    // страница «Идеи»
    $('#tg-sync').addEventListener('click', () => tgSyncFromChannel());
    const fi = $('#tg-file');
    $('#tg-import').addEventListener('click', () => { fi.value = ''; fi.click(); });
    fi.addEventListener('change', () => { const picked = Array.from(fi.files || []); fi.value = ''; tgImportFiles(picked); });
    $('#tg-setup').addEventListener('click', tgOpenSettings);
    $('#tg-ai').addEventListener('change', e => { tgSave({ ai: e.target.checked }); toast(e.target.checked ? 'ИИ будет разбирать посты' : 'ИИ выключен: посты станут идеями как есть'); renderTelegramCard(); });
    const card = $('#tg-card');   // можно перетащить ZIP или файлы экспорта прямо на блок
    ['dragenter', 'dragover'].forEach(ev => card.addEventListener(ev, e => { if (e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files')) { e.preventDefault(); card.classList.add('tg-card-dragging'); } }));
    ['dragleave', 'drop'].forEach(ev => card.addEventListener(ev, () => card.classList.remove('tg-card-dragging')));
    card.addEventListener('drop', e => { if (e.dataTransfer && e.dataTransfer.files.length) { e.preventDefault(); tgImportFiles(e.dataTransfer.files); } });
    // настройки
    const tok = $('#tgc-token'), ch = $('#tgc-chat');
    tok.addEventListener('change', () => { tgSave({ token: tok.value.replace(/\s+/g, '') }); renderTelegramCard(); renderTelegramBlock(); });
    ch.addEventListener('change', () => { tgSave({ chat: ch.value.trim() }); renderTelegramCard(); renderTelegramBlock(); });
    $('#tgc-tag').addEventListener('change', e => tgSave({ tag: e.target.checked }));
    $('#tgc-media').addEventListener('change', e => tgSave({ media: e.target.checked }));
    $('#tgc-auto').addEventListener('change', e => { tgSave({ auto: e.target.checked }); toast(e.target.checked ? 'Новые посты будут добавляться сами' : 'Автоматическое добавление выключено'); renderTelegramBlock(); if (e.target.checked) tgSyncFromChannel({ auto: true }); });
    $('#tgc-show').addEventListener('click', () => { const show = tok.type === 'password'; tok.type = show ? 'text' : 'password'; $('#tgc-show').innerHTML = ic(show ? 'lock' : 'visibility') + (show ? 'Скрыть токен' : 'Показать токен'); });
    $('#tgc-test').addEventListener('click', async () => { tgSave({ token: tok.value.replace(/\s+/g, ''), chat: ch.value.trim() }); renderTelegramCard(); const b = $('#tgc-test'); b.disabled = true; try { await tgTest(); } finally { b.disabled = false; renderTelegramBlock(); } });
    $('#tgc-out').addEventListener('click', async e => {
        if (!e.target.closest('#tgc-del-wh')) return;
        try { await tgApi('deleteWebhook', { drop_pending_updates: false }); toast('Вебхук отключён'); tgTest(); } catch (err) { toast(err.message || 'Не получилось', { ms: 5000 }); }
    });
    $('#tgc-reset').addEventListener('click', async () => {
        if (!(await confirmSheet('Сбросить очередь и историю?', 'Очередь ещё не добавленных постов очистится, а приложение забудет, какие посты уже обрабатывались: при повторном импорте они снова будут предложены. Добавленные идеи не затрагиваются.', 'Сбросить', true))) return;
        ['tg_inbox', 'tg_seen', 'tg_state', 'tg_chats'].forEach(k => LS.del(k)); renderTelegramBlock(); toast('Очередь и история сброшены');
    });
    renderTelegramCard(); renderTelegramBlock();
    // автоматический режим: при открытии, при возвращении на вкладку и раз в 5 минут
    const auto = () => { if (tgCfg().auto && tgToken() && !document.hidden) tgSyncFromChannel({ auto: true }); };
    setTimeout(auto, 3500);
    document.addEventListener('visibilitychange', () => { if (!document.hidden && Date.now() - tgState().last > 120000) auto(); });
    setInterval(auto, 5 * 60000);
}
