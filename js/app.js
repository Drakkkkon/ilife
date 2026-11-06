'use strict';
// =====================================================================================================
// iLife — ЗАПУСК И НАВИГАЦИЯ: переключение разделов, плавающая кнопка, сворачивание блоков, версия → журнал изменений,
// служебный воркер (работа без сети).
// =====================================================================================================

const TABS = ['ideas', 'todo', 'movies', 'sovsek', 'settings'];
const collapsedCards = new Set(LS.get('collapsed', []));   // свёрнутые блоки; состояние запоминается

let hashTab = null;   // вкладка, адрес которой (#id) ещё не записан в строку браузера
function syncHash(id) { try { history.replaceState(null, '', location.pathname + location.search + '#' + id); } catch (e) {} }
window.addEventListener('load', () => setTimeout(() => { if (hashTab) { syncHash(hashTab); hashTab = null; } }, 0));
function showTab(id) {
    if (!TABS.includes(id)) id = 'ideas';
    $$('.tab').forEach(t => t.classList.toggle('is-active', t.id === id));
    $$('[data-tab]').forEach(b => { if (b.tagName === 'BUTTON') { const on = b.dataset.tab === id; b.classList.toggle('active', on); b.setAttribute('aria-current', on ? 'page' : 'false'); } });
    $('#fab').classList.toggle('is-hidden', id === 'settings' || id === 'sovsek');
    settings.lastTab = id; saveSettings();
    if (document.readyState === 'complete') syncHash(id); else hashTab = id;   // пока страница грузится, адрес не трогаем: иначе Chrome «прокручивает к якорю» #id и сдвигает верх страницы
    window.scrollTo({ top: 0, behavior: 'instant' in window ? 'instant' : 'auto' });
    if (id === 'settings') { renderStorageInfo(); renderSpotifyCard(); renderYoutubeCard(); renderTelegramCard(); renderGoogleCard(); renderMoviesCard(); if (googleClientId() && !gisReady()) loadGis(); }
    if (id === 'ideas') renderTelegramBlock();
    if (id === 'movies') renderMovies();
    if (id === 'sovsek') renderGallery();
}

// Нажатие на версию (рядом с логотипом): открыть «Настройки → О приложении → Журнал изменений»
function goToChangelog() {
    const splash = $('#splash-screen');
    if (splash && !splash.classList.contains('is-gone') && typeof proceedFromSplash === 'function') proceedFromSplash();
    showTab('settings');
    const card = $('#about-card');
    if (card && card.classList.contains('is-collapsed')) { card.classList.remove('is-collapsed'); collapsedCards.delete('about-card'); LS.set('collapsed', Array.from(collapsedCards)); }
    setTimeout(() => {
        const target = $('#changelog'); if (!target) return;
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
        target.classList.add('is-flash'); setTimeout(() => target.classList.remove('is-flash'), 1800);
    }, 380);
}

function initNav() {
    $$('.sidebar-nav button, .mobile-nav button').forEach(b => b.addEventListener('click', () => showTab(b.dataset.tab)));
    $('#fab').addEventListener('click', () => {
        const active = (document.querySelector('.tab.is-active') || {}).id;
        const target = active === 'todo' ? $('#todo-input') : active === 'movies' ? $('#movie-search') : $('#idea-text');
        const card = target.closest('.card'); if (card && card.classList.contains('is-collapsed')) card.classList.remove('is-collapsed');
        target.scrollIntoView({ behavior: 'smooth', block: 'center' });
        setTimeout(() => target.focus({ preventScroll: true }), 350);
    });
    // свернуть / развернуть блок; состояние запоминается
    $$('.card[id]').forEach(c => { if (collapsedCards.has(c.id)) c.classList.add('is-collapsed'); });
    document.addEventListener('click', e => {
        const t = e.target.closest('.card-toggle'); if (!t) return;
        const card = t.closest('.card'); card.classList.toggle('is-collapsed');
        if (card.id) { card.classList.contains('is-collapsed') ? collapsedCards.add(card.id) : collapsedCards.delete(card.id); LS.set('collapsed', Array.from(collapsedCards)); }
    });
    // версия рядом с логотипом (главная, заставка, боковая панель) → журнал изменений
    document.addEventListener('click', e => { const v = e.target.closest('[data-goto-changelog]'); if (v) { e.preventDefault(); goToChangelog(); } });
    $$('.app-ver').forEach(e => { e.textContent = APP_VERSION; });
}

async function bootstrap() {
    hydrateIcons();
    // Возврат со страницы входа Spotify (?code=…) — заставку пропускаем, открываем «Настройки»
    const spReturn = /[?&](code|error)=/.test(location.search) && !!LS.get('sp_auth', null);
    const wantChangelog = (location.hash || '') === '#changelog';
    initSplash(!settings.splash || spReturn || wantChangelog);
    initNav();
    initIdeas();
    initYoutube();
    initTelegram();
    initGallery();
    initTodo();
    initMovies();
    initSettings();
    initCloud();
    let start = (location.hash || '').replace('#', '');
    if (!TABS.includes(start)) start = settings.lastTab;
    if (spReturn) { await spotifyHandleRedirect(); start = 'settings'; renderSpotifyCard(); }
    showTab(wantChangelog ? 'settings' : start);
    if (wantChangelog) goToChangelog();
    refreshRates();
    if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) navigator.serviceWorker.register('sw.js').catch(() => {});
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bootstrap); else bootstrap();
