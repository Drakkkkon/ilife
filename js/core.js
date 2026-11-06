'use strict';
// =====================================================================================================
// iLife — ЯДРО: настройки, хранилище, время Алматы, всплывающие подсказки, шторки, выдача файлов, курсы валют.
// Все файлы приложения — обычные скрипты (без модулей), поэтому функции и переменные общие.
// Порядок подключения см. в index.html. Данные хранятся на устройстве:
//   localStorage  — записи, дела, настройки (ключи ilife_*);
//   IndexedDB     — вложения: картинки, музыка, голосовые записи, файлы (база «ilife-media»).
// =====================================================================================================

const APP_VERSION = '1.2.0';

// ---------- Хранилище настроек ----------
const LS = {
    get(key, def) {
        try { const v = localStorage.getItem('ilife_' + key); return v === null ? def : JSON.parse(v); } catch (e) { return def; }
    },
    set(key, val) {
        try { localStorage.setItem('ilife_' + key, JSON.stringify(val)); return true; } catch (e) {
            toast('Не хватило места в памяти браузера — сохранить не удалось');
            return false;
        }
    },
    del(key) { try { localStorage.removeItem('ilife_' + key); } catch (e) {} }
};

const SETTINGS_DEFAULTS = { theme: 'android', font: 'google-sans-flex', scaleMode: 'manual', scale: 100, author: 'Александр', splash: true, lastTab: 'ideas' };
const settings = Object.assign({}, SETTINGS_DEFAULTS, LS.get('settings', {}));
function saveSettings() { if (typeof cloudLocalChanged === 'function') cloudLocalChanged(); LS.set('settings', settings); }
function authorName() { return (settings.author || '').trim() || 'Александр'; }

// ---------- Мелкие помощники ----------
function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function uid(prefix) { return (prefix || 'id') + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
function debounce(fn, ms) { let t = 0; return function () { const a = arguments, c = this; clearTimeout(t); t = setTimeout(() => fn.apply(c, a), ms); }; }
function $(sel, root) { return (root || document).querySelector(sel); }
function $$(sel, root) { return Array.from((root || document).querySelectorAll(sel)); }
function normText(s) { return String(s || '').toLowerCase().replace(/ё/g, 'е'); }
function capitalizeFirst(s) { s = String(s || '').trim(); return s ? s.charAt(0).toLocaleUpperCase('ru-RU') + s.slice(1) : s; }
function fmtBytes(n) {
    n = Number(n) || 0;
    if (n < 1024) return n + ' Б';
    if (n < 1024 * 1024) return (n / 1024).toFixed(n < 10240 ? 1 : 0).replace('.', ',') + ' КБ';
    return (n / 1048576).toFixed(n < 10485760 ? 1 : 0).replace('.', ',') + ' МБ';
}
function fmtDuration(sec) {
    sec = Math.max(0, Math.round(Number(sec) || 0));
    const m = Math.floor(sec / 60), s = sec % 60;
    return m + ':' + String(s).padStart(2, '0');
}
function isMobileDevice() { return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent || '') || (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent || '')); }

// ---------- Время Алматы ----------
// Встроенная база часовых поясов в некоторых браузерах устарела и для Asia/Almaty даёт UTC+6, поэтому время Алматы
// считаем от UTC с фиксированным смещением (+5), не завися от настроек устройства (как в My Money).
const ALMATY_UTC_OFFSET_HOURS = 5;
const MONTHS_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const MONTHS_NOM = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];
const WEEKDAYS = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'];
const pad2 = n => String(n).padStart(2, '0');

function almatyParts(ms) {
    const d = new Date((ms == null ? Date.now() : ms) + ALMATY_UTC_OFFSET_HOURS * 3600000);
    return { y: d.getUTCFullYear(), mo: d.getUTCMonth(), d: d.getUTCDate(), h: d.getUTCHours(), mi: d.getUTCMinutes(), s: d.getUTCSeconds(), wd: d.getUTCDay() };
}
function dayKey(ms) { const p = almatyParts(ms); return p.y + '-' + pad2(p.mo + 1) + '-' + pad2(p.d); }
function todayKey(shiftDays) { return dayKey(Date.now() + (shiftDays || 0) * 86400000); }
function fmtTime(ms) { const p = almatyParts(ms); return pad2(p.h) + ':' + pad2(p.mi); }
function fmtDate(ms, withYear) {
    const p = almatyParts(ms);
    const showYear = withYear === undefined ? p.y !== almatyParts().y : withYear;
    return p.d + ' ' + MONTHS_GEN[p.mo] + (showYear ? ' ' + p.y : '');
}
function fmtDateTime(ms) { return fmtDate(ms, true) + ', ' + fmtTime(ms); }
function fmtDateShort(ms) { const p = almatyParts(ms); return pad2(p.d) + '.' + pad2(p.mo + 1) + '.' + p.y; }
function keyToMs(key) { const m = String(key).match(/^(\d{4})-(\d{2})-(\d{2})$/); return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) - ALMATY_UTC_OFFSET_HOURS * 3600000 + 12 * 3600000 : NaN; }
function fmtDayKey(key, withYear) { const ms = keyToMs(key); return isNaN(ms) ? key : fmtDate(ms, withYear); }
// Заголовок группы дат: «Сегодня · 5 ноября, четверг»
function dayTitle(key) {
    const ms = keyToMs(key);
    if (isNaN(ms)) return key;
    const p = almatyParts(ms);
    const base = p.d + ' ' + MONTHS_GEN[p.mo] + (p.y !== almatyParts().y ? ' ' + p.y : '') + ', ' + WEEKDAYS[p.wd];
    if (key === todayKey()) return 'Сегодня · ' + base;
    if (key === todayKey(-1)) return 'Вчера · ' + base;
    if (key === todayKey(1)) return 'Завтра · ' + base;
    return capitalizeFirst(base);
}
function formatAlmaty(options, date) {
    const shifted = new Date((date || new Date()).getTime() + ALMATY_UTC_OFFSET_HOURS * 3600000);
    return new Intl.DateTimeFormat('ru-RU', Object.assign({ timeZone: 'UTC' }, options)).format(shifted);
}

// ---------- Всплывающие подсказки (snackbar) ----------
function toast(text, opts) {
    opts = opts || {};
    const host = document.getElementById('toast-host');
    if (!host) return;
    const el = document.createElement('div');
    el.className = 'toast';
    el.setAttribute('role', 'status');
    el.innerHTML = '<span>' + esc(text) + '</span>' + (opts.action ? '<button type="button" class="toast-act">' + esc(opts.action) + '</button>' : '');
    host.appendChild(el);
    let gone = false;
    const hide = () => { if (gone) return; gone = true; el.classList.add('is-leaving'); setTimeout(() => el.remove(), 220); };
    if (opts.action) el.querySelector('.toast-act').addEventListener('click', () => { try { opts.onAction && opts.onAction(); } finally { hide(); } });
    while (host.children.length > 3) host.firstChild.remove();
    setTimeout(hide, opts.ms || (opts.action ? 5200 : 3200));
}

// ---------- Шторка (bottom sheet на телефоне, окно по центру на ПК) ----------
const sheetStack = [];
function openSheet(opts) {
    const host = document.getElementById('sheet-host');
    const overlay = document.createElement('div');
    overlay.className = 'sheet-overlay';
    const actions = (opts.actions || []).map((a, i) =>
        '<button type="button" class="btn ' + (a.kind === 'primary' ? 'btn-primary' : a.kind === 'danger' ? 'btn-danger' : 'btn-text') + '" data-act="' + i + '">' + (a.icon ? ic(a.icon) : '') + esc(a.label) + '</button>').join('');
    overlay.innerHTML =
        '<div class="sheet" role="dialog" aria-modal="true" aria-label="' + esc(opts.title || '') + '">' +
        '<div class="sheet-head"><h3>' + esc(opts.title || '') + '</h3><button type="button" class="icon-btn" data-close aria-label="Закрыть">' + ic('close') + '</button></div>' +
        '<div class="sheet-body"></div>' + (actions ? '<div class="sheet-actions">' + actions + '</div>' : '') + '</div>';
    const body = overlay.querySelector('.sheet-body');
    if (typeof opts.html === 'string') body.innerHTML = opts.html; else if (opts.node) body.appendChild(opts.node);
    host.appendChild(overlay);
    document.body.classList.add('is-locked');
    let closed = false;
    const api = {
        el: overlay, body,
        close(result) {
            if (closed) return; closed = true;
            const i = sheetStack.indexOf(api); if (i >= 0) sheetStack.splice(i, 1);
            overlay.classList.add('is-closing');
            setTimeout(() => { overlay.remove(); if (!sheetStack.length) document.body.classList.remove('is-locked'); }, 190);
            if (opts.onClose) opts.onClose(result);
        }
    };
    overlay.addEventListener('mousedown', e => { if (e.target === overlay) api.close(); });
    overlay.querySelector('[data-close]').addEventListener('click', () => api.close());
    overlay.querySelectorAll('[data-act]').forEach(b => b.addEventListener('click', async () => {
        const a = opts.actions[+b.dataset.act];
        let keep = false;
        if (a.onClick) { const r = await a.onClick(api); keep = r === false; }
        if (!keep) api.close(a.value);
    }));
    sheetStack.push(api);
    if (opts.onOpen) opts.onOpen(api);
    return api;
}
document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && sheetStack.length) sheetStack[sheetStack.length - 1].close();
});
function confirmSheet(title, text, confirmLabel, danger) {
    return new Promise(resolve => {
        openSheet({
            title, html: '<p class="hint" style="font-size:15px;color:var(--md-on-surface)">' + esc(text) + '</p>',
            actions: [{ label: 'Отмена', value: false }, { label: confirmLabel || 'Да', kind: danger ? 'danger' : 'primary', value: true }],
            onClose: r => resolve(r === true)
        });
    });
}

// ---------- Вложения: IndexedDB ----------
// Запись: { id, blob, thumb?, name, type, size }. Если IndexedDB недоступна (приватный режим), вложения живут только до перезагрузки.
const BlobDB = (function () {
    let dbp = null; let broken = false; const mem = new Map(); const urls = new Map(); let warned = false;
    function open() {
        if (dbp) return dbp;
        dbp = new Promise((resolve, reject) => {
            try {
                const req = indexedDB.open('ilife-media', 1);
                req.onupgradeneeded = () => req.result.createObjectStore('blobs', { keyPath: 'id' });
                req.onsuccess = () => resolve(req.result);
                req.onerror = () => reject(req.error);
                req.onblocked = () => reject(new Error('blocked'));
            } catch (e) { reject(e); }
        }).catch(() => { broken = true; return null; });
        return dbp;
    }
    function warn() { if (!warned) { warned = true; toast('Память браузера для вложений недоступна — они не сохранятся после перезагрузки'); } }
    function tx(db, mode, fn) {
        return new Promise((resolve, reject) => {
            const t = db.transaction('blobs', mode); let res;
            try { res = fn(t.objectStore('blobs')); } catch (e) { reject(e); return; }
            t.oncomplete = () => resolve(res && 'result' in res ? res.result : undefined);
            t.onerror = () => reject(t.error);
            t.onabort = () => reject(t.error || new Error('abort'));
        });
    }
    return {
        async put(rec) {
            const db = await open();
            if (!db) { warn(); mem.set(rec.id, rec); return; }
            try { await tx(db, 'readwrite', s => s.put(rec)); } catch (e) {
                if (e && e.name === 'QuotaExceededError') { toast('Память устройства заполнена — файл не сохранён'); }
                throw e;
            }
        },
        async get(id) {
            const db = await open();
            if (!db) return mem.get(id) || null;
            try { return (await tx(db, 'readonly', s => s.get(id))) || null; } catch (e) { return null; }
        },
        async del(id) {
            this.revoke(id);
            const db = await open();
            if (!db) { mem.delete(id); return; }
            try { await tx(db, 'readwrite', s => s.delete(id)); } catch (e) {}
        },
        async ids() {
            const db = await open();
            if (!db) return Array.from(mem.keys());
            try { return (await tx(db, 'readonly', s => s.getAllKeys())) || []; } catch (e) { return []; }
        },
        async all() {
            const db = await open();
            if (!db) return Array.from(mem.values());
            try { return (await tx(db, 'readonly', s => s.getAll())) || []; } catch (e) { return []; }
        },
        async clear() {
            urls.forEach(u => URL.revokeObjectURL(u)); urls.clear();
            const db = await open();
            if (!db) { mem.clear(); return; }
            try { await tx(db, 'readwrite', s => s.clear()); } catch (e) {}
        },
        async url(id, variant) {
            const key = id + '|' + (variant || '');
            if (urls.has(key)) return urls.get(key);
            const rec = await this.get(id);
            if (!rec) return '';
            const b = variant === 'thumb' && rec.thumb ? rec.thumb : rec.blob;
            const u = URL.createObjectURL(b);
            urls.set(key, u);
            return u;
        },
        revoke(id) { Array.from(urls.keys()).forEach(k => { if (k.startsWith(id + '|')) { URL.revokeObjectURL(urls.get(k)); urls.delete(k); } }); },
        isBroken() { return broken; }
    };
})();
try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch (e) {}

// ---------- Выдача файла пользователю (PDF, резервная копия) ----------
// Порядок: нативный мост APK → меню «Поделиться» на телефоне → обычное скачивание. Логика как в My Money (deliverFile).
function isAndroidWebView() {
    const ua = navigator.userAgent || '';
    if (!/Android/i.test(ua) || /Firefox\//.test(ua)) return false;
    return /; wv\)/.test(ua) || /Dalvik\//.test(ua) || !/Chrome\//.test(ua) || (window.isSecureContext && typeof navigator.share !== 'function');
}
// Нативный мост из APK: window.iLifeNative.saveFile(base64, имя, mime) (или MoneyNative — тот же мост, что в My Money)
function nativeFileBridge() {
    const b = window.iLifeNative || window.MoneyNative;
    return b && typeof b.saveFile === 'function' ? b : null;
}
function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result).split(',')[1] || '');
        r.onerror = () => reject(r.error);
        r.readAsDataURL(blob);
    });
}
// Возвращает 'native' | 'shared' | 'downloaded' | 'unsupported'
async function deliverFile(blob, fileName) {
    const bridge = nativeFileBridge();
    if (bridge) {
        try {
            const ok = bridge.saveFile(await blobToBase64(blob), fileName, blob.type || 'application/octet-stream');
            if (ok !== false && ok !== 'false') return 'native';
        } catch (e) { console.warn('Нативный мост не сохранил файл', e); }
    }
    if (isAndroidWebView()) return 'unsupported';
    if (isMobileDevice() && navigator.canShare && typeof File !== 'undefined') {
        try {
            const file = new File([blob], fileName, { type: blob.type });
            if (navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: fileName }); return 'shared'; }
        } catch (e) { if (e && e.name === 'AbortError') return 'shared'; console.warn('Share не удался, пробуем скачивание', e); }
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = fileName; a.rel = 'noopener'; a.style.display = 'none';
    document.body.appendChild(a); a.click();
    setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 60000);
    return 'downloaded';
}
function stampName(prefix, ext) {
    // имя файла: дата_время_автор_раздел — как в My Money (дата_время_имя), например 2026-11-05_14-30_Александр_Идеи.pdf
    const p = almatyParts();
    return p.y + '-' + pad2(p.mo + 1) + '-' + pad2(p.d) + '_' + pad2(p.h) + '-' + pad2(p.mi) + '_' + authorName().replace(/[^\p{L}\p{N}_-]+/gu, '') + '_' + prefix + '.' + ext;
}
async function copyText(text) {
    try { if (navigator.clipboard && window.isSecureContext) { await navigator.clipboard.writeText(text); return true; } } catch (e) {}
    try {
        const ta = document.createElement('textarea'); ta.value = text; ta.setAttribute('readonly', ''); ta.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0';
        document.body.appendChild(ta); ta.select(); const ok = document.execCommand('copy'); ta.remove(); return ok;
    } catch (e) { return false; }
}

// ---------- Подгрузка внешнего скрипта (вход Google) только когда он нужен ----------
const _scriptLoads = {};
function loadScriptOnce(src) {
    if (_scriptLoads[src]) return _scriptLoads[src];
    _scriptLoads[src] = new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = src; s.async = true;
        s.onload = () => resolve(true);
        s.onerror = () => { delete _scriptLoads[src]; s.remove(); reject(new Error('Не удалось загрузить ' + src)); };
        document.head.appendChild(s);
    });
    return _scriptLoads[src];
}

// ---------- Валюты и курсы (как в My Money: тенге, доллар, евро, рубль) ----------
const TX_CURRENCIES = {
    KZT: { sign: '₸', name: 'тенге', rateKey: '' },
    USD: { sign: '$', name: 'доллар США', rateKey: 'usd' },
    EUR: { sign: '€', name: 'евро', rateKey: 'eur' },
    RUB: { sign: '₽', name: 'российский рубль', rateKey: 'rub' }
};
function cachedRates() { return LS.get('rates', null); }
function currencyRate(code) {
    if (code === 'KZT') return 1;
    const info = TX_CURRENCIES[code]; const rates = cachedRates();
    const v = rates && info ? Number(rates[info.rateKey]) : NaN;
    return Number.isFinite(v) && v > 0 ? v : null;
}
function fmtCur(n, code) {
    const digits = code === 'KZT' ? 0 : 2;
    return Number(n || 0).toLocaleString('ru-RU', { minimumFractionDigits: 0, maximumFractionDigits: digits }) + ' ' + (TX_CURRENCIES[code] || TX_CURRENCIES.KZT).sign;
}
function fmtTenge(n) { return Math.round(Number(n) || 0).toLocaleString('ru-RU') + ' ₸'; }
// Курсы тянутся из тех же источников, что в My Money; если все недоступны — остаются прежние (или пересчёта в тенге нет)
const RATE_SOURCES = [
    { url: 'https://latest.currency-api.pages.dev/v1/currencies/kzt.json', parse: d => ({ usd: 1 / d.kzt.usd, eur: 1 / d.kzt.eur, rub: 1 / d.kzt.rub, date: d.date }) },
    { url: 'https://open.er-api.com/v6/latest/KZT', parse: d => ({ usd: 1 / d.rates.USD, eur: 1 / d.rates.EUR, rub: 1 / d.rates.RUB, date: new Date(d.time_last_update_unix * 1000).toISOString().slice(0, 10) }) }
];
async function refreshRates() {
    const cached = cachedRates();
    if (cached && cached.fetchedAt && Date.now() - cached.fetchedAt < 6 * 3600000) return;
    for (const src of RATE_SOURCES) {
        try {
            const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
            const t = ctl ? setTimeout(() => ctl.abort(), 8000) : 0;
            const res = await fetch(src.url, { cache: 'no-store', ...(ctl ? { signal: ctl.signal } : {}) });
            if (t) clearTimeout(t);
            if (!res.ok) continue;
            const r = src.parse(await res.json());
            if ([r.usd, r.eur, r.rub].every(v => Number.isFinite(v) && v > 0)) {
                LS.set('rates', Object.assign(r, { fetchedAt: Date.now() }));
                if (typeof renderTodo === 'function') renderTodo();
                return;
            }
        } catch (e) { /* пробуем следующий источник */ }
    }
}
