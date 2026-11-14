'use strict';
// =====================================================================================================
// iLife 2.9.0 — РАЗДЕЛ «КОМИКСЫ»: встроенная программа My_topsecret (библиотека и читалка комиксов).
//   • Сама программа — файл comics/index.html (копия index.html из репозитория Drakkkkon/topsecret, версия 0.5.0+),
//     открывается внутри страницы с ?embed=ilife: без своего меню и логотипа, в цветах и шрифте темы iLife.
//   • Меню раздела в iLife (Избранное, Хранилище, Категории, Telegram и интернет, Настройки) переключает страницы
//     программы сообщением { type:'ts-tab', tab }; программа отвечает { type:'ts-route', tab, reader, detail }.
//   • Пока открыта читалка, меню iLife прячется — комикс читается на весь экран.
//   • Данные (комиксы, папки, оценки, место чтения) — в хранилище браузера адреса drakkkkon.github.io: они общие
//     с отдельным сайтом My_topsecret. Облако — синхронизация программы через Google Диск («My_topsecret sync») и общий
//     аккаунт; загрузка из Telegram — бот программы (Настройки → Интернет → Telegram).
// =====================================================================================================

(function () {
    if (!window.ICONS) return;
    Object.assign(window.ICONS, {
        comic: '<path d="M21 3H3c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h18c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2M3 5h8v7H3zm0 14v-5h5v5zm7 0v-5h11v5zm11-7h-8V5h8z"/>',
        library_books: '<path d="M4 6H2v14c0 1.1.9 2 2 2h14v-2H4zm16-4H8c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2m-1 9H9V9h10zm-4 4H9v-2h6zm4-8H9V5h10z"/>'
    });
})();

const CX_TABS = ['home', 'storage', 'categories', 'web', 'prefs'];
let cxFrame = null, cxTab = LS.get('cx_tab', 'storage');

function cxPost(msg) { try { if (cxFrame && cxFrame.contentWindow) cxFrame.contentWindow.postMessage(msg, location.origin); } catch (e) {} }
function cxMark(tab) { $$('[data-comics-tab]').forEach(b => { const on = b.dataset.comicsTab === tab; b.classList.toggle('active', on); if (on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); }); }
function cxEnsure() {
    if (cxFrame) return;
    const host = $('#cx-host'); if (!host) return;
    cxFrame = document.createElement('iframe');
    cxFrame.className = 'cx-frame'; cxFrame.title = 'Комиксы';
    cxFrame.setAttribute('allow', 'fullscreen; clipboard-write');
    cxFrame.src = 'comics/index.html?embed=ilife#' + (CX_TABS.includes(cxTab) ? cxTab : 'storage');
    cxFrame.addEventListener('load', () => { const w = $('#cx-wait'); if (w) w.remove(); });
    host.appendChild(cxFrame);
}
function cxOpenTab(tab) {
    if (!CX_TABS.includes(tab)) return;
    cxTab = tab; LS.set('cx_tab', tab); cxMark(tab);
    if (settings.lastTab !== 'comics') showTab('comics');
    if (!cxFrame) cxEnsure(); else cxPost({ type: 'ts-tab', tab });
}
function comicsTabOpened() { cxEnsure(); cxMark(cxTab); }
function comicsThemeChanged() { cxPost({ type: 'ilife-theme' }); }

function initComics() {
    $$('[data-comics-tab]').forEach(b => b.addEventListener('click', () => cxOpenTab(b.dataset.comicsTab)));
    window.addEventListener('message', e => {
        if (e.origin !== location.origin || !cxFrame || e.source !== cxFrame.contentWindow) return;
        const d = e.data || {};
        if (d.type !== 'ts-route') return;
        if (CX_TABS.includes(d.tab)) { cxTab = d.tab; LS.set('cx_tab', d.tab); cxMark(d.tab); }
        document.documentElement.toggleAttribute('data-cx-reader', !!d.reader);   // читалка — на весь экран, меню iLife прячется
    });
}
