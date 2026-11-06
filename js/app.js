'use strict';
// =====================================================================================================
// iLife — ЗАПУСК И НАВИГАЦИЯ: переключение разделов, плавающая кнопка, сворачивание блоков, служебный воркер (работа без сети).
// =====================================================================================================

const TABS = ['ideas', 'todo', 'movies', 'settings'];

function showTab(id) {
    if (!TABS.includes(id)) id = 'ideas';
    $$('.tab').forEach(t => t.classList.toggle('is-active', t.id === id));
    $$('[data-tab]').forEach(b => { if (b.tagName === 'BUTTON') { const on = b.dataset.tab === id; b.classList.toggle('active', on); b.setAttribute('aria-current', on ? 'page' : 'false'); } });
    $('#fab').classList.toggle('is-hidden', id === 'settings');
    settings.lastTab = id; saveSettings();
    try { history.replaceState(null, '', location.pathname + location.search + '#' + id); } catch (e) {}
    window.scrollTo({ top: 0, behavior: 'instant' in window ? 'instant' : 'auto' });
    if (id === 'settings') { renderStorageInfo(); renderSpotifyCard(); renderGoogleCard(); renderMoviesCard(); if (googleClientId() && !gisReady()) loadGis(); }
    if (id === 'movies') renderMovies();
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
    const collapsed = new Set(LS.get('collapsed', []));
    $$('.card[id]').forEach(c => { if (collapsed.has(c.id)) c.classList.add('is-collapsed'); });
    document.addEventListener('click', e => {
        const t = e.target.closest('.card-toggle'); if (!t) return;
        const card = t.closest('.card'); card.classList.toggle('is-collapsed');
        if (card.id) { card.classList.contains('is-collapsed') ? collapsed.add(card.id) : collapsed.delete(card.id); LS.set('collapsed', Array.from(collapsed)); }
    });
    $$('.app-ver').forEach(e => { e.textContent = APP_VERSION; });
}

async function bootstrap() {
    hydrateIcons();
    // Возврат со страницы входа Spotify (?code=…) — заставку пропускаем, открываем «Настройки»
    const spReturn = /[?&](code|error)=/.test(location.search) && !!LS.get('sp_auth', null);
    initSplash(!settings.splash || spReturn);
    initNav();
    initIdeas();
    initTodo();
    initMovies();
    initSettings();
    initCloud();
    let start = (location.hash || '').replace('#', '');
    if (!TABS.includes(start)) start = settings.lastTab;
    if (spReturn) { await spotifyHandleRedirect(); start = 'settings'; renderSpotifyCard(); }
    showTab(start);
    refreshRates();
    if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) navigator.serviceWorker.register('sw.js').catch(() => {});
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bootstrap); else bootstrap();
