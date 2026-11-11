'use strict';
// =====================================================================================================
// iLife — ЗАПУСК И НАВИГАЦИЯ: переключение разделов, плавающая кнопка, сворачивание блоков, версия → журнал изменений,
// служебный воркер (работа без сети).
// =====================================================================================================

const TABS = ['ideas', 'todo', 'movies', 'music', 'scripts', 'sovsek', 'settings', 'dnd-games', 'dnd-builder', 'dnd-chars', 'dnd-visual', 'dnd-plot', 'dnd-settings', 'med-rx', 'med-orders', 'med-schedule'];   // с 2.0.0 — страницы раздела «ДНД» (js/dnd.js), с 2.2.0 — раздела «Лекарства» (js/meds.js)
const collapsedCards = new Set(LS.get('collapsed', []));   // свёрнутые блоки; состояние запоминается

let hashTab = null;   // вкладка, адрес которой (#id) ещё не записан в строку браузера
function syncHash(id) { try { history.replaceState(null, '', location.pathname + location.search + '#' + id); } catch (e) {} }
window.addEventListener('load', () => setTimeout(() => { if (hashTab) { syncHash(hashTab); hashTab = null; } }, 0));
function showTab(id) {
    if (!TABS.includes(id)) id = 'ideas';
    $$('.tab').forEach(t => t.classList.toggle('is-active', t.id === id));
    $$('[data-tab]').forEach(b => { if (b.tagName === 'BUTTON') { const on = b.dataset.tab === id; b.classList.toggle('active', on); b.setAttribute('aria-current', on ? 'page' : 'false'); } });
    $('#fab').classList.toggle('is-hidden', id === 'settings' || id === 'sovsek' || id === 'scripts' || id === 'music' || id.startsWith('dnd-') || id.startsWith('med-'));
    if (typeof dndNavSync === 'function') dndNavSync(id);   // меню: главное или меню «ДНД» с кнопкой «Назад»
    if (typeof medNavSync === 'function') medNavSync(id);   // …или меню «Лекарства»
    settings.lastTab = id; saveSettings();
    if (document.readyState === 'complete') syncHash(id); else hashTab = id;   // пока страница грузится, адрес не трогаем: иначе Chrome «прокручивает к якорю» #id и сдвигает верх страницы
    window.scrollTo({ top: 0, behavior: 'instant' in window ? 'instant' : 'auto' });
    if (id === 'settings') { renderStorageInfo(); renderSpotifyCard(); renderYoutubeCard(); renderTelegramCard(); renderGoogleCard(); renderMoviesCard(); if (googleClientId() && !gisReady()) loadGis(); }
    if (id === 'ideas') renderTelegramBlock();
    if (id === 'movies') renderMovies();
    if (id === 'music') musicTabOpened();
    if (id === 'sovsek') renderGallery();
    if (id === 'scripts') renderScripts();
    if (id === 'ideas') renderSongs();
    if (id.startsWith('dnd-') && typeof dndTabOpened === 'function') dndTabOpened(id);
    if (id.startsWith('med-') && typeof medTabOpened === 'function') medTabOpened(id);
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

// Раскрывает блок «Сайты и инструкции» и нужную инструкцию (по умолчанию и после перезапуска всё свёрнуто) и подводит к ней
function flashEl(el) { el.classList.add('is-flash'); setTimeout(() => el.classList.remove('is-flash'), 1900); }
function openInstruction(id) {
    const d = document.getElementById(id), card = document.getElementById('links-card'); if (!d || !card) return;
    const away = !$('#settings').classList.contains('is-active');   // ссылка «Инструкция» может стоять на другой странице (например, «Музыка»)
    if (away) showTab('settings');
    card.classList.remove('is-collapsed'); d.open = true;
    setTimeout(() => { d.scrollIntoView({ behavior: 'smooth', block: 'start' }); flashEl(d); }, away ? 160 : 80);
}
function gotoCard(id) {
    const c = document.getElementById(id); if (!c) return;
    c.classList.remove('is-collapsed');
    setTimeout(() => { c.scrollIntoView({ behavior: 'smooth', block: 'start' }); flashEl(c); }, 80);
}

function initNav() {
    $$('.sidebar-nav button, .mobile-nav button').forEach(b => { if (b.dataset.tab) b.addEventListener('click', () => showTab(b.dataset.tab)); });   // «ДНД» и «Назад» устроены отдельно (js/dnd.js)
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
    // «Инструкция» в блоках ключей → нужная инструкция в блоке «Сайты и инструкции» внизу настроек; «К блоку» → обратно к блоку ключей
    document.addEventListener('click', e => {
        const i = e.target.closest('[data-instr]'), c = e.target.closest('[data-card]'), m = e.target.closest('[data-goto-music]'), x = e.target.closest('[data-goto-xb]'), tc = e.target.closest('[data-tabcard]');
        if (tc) { const parts = tc.dataset.tabcard.split('|'); showTab(parts[0]); setTimeout(() => gotoCard(parts[1]), 140); } else if (i) openInstruction(i.dataset.instr); else if (c) gotoCard(c.dataset.card); else if (m) showTab('music'); else if (x) { showTab('sovsek'); setTimeout(() => gotoCard('xb-card'), 120); }
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
    initXBookmarks();
    initTodo();
    initMovies();
    initMusic();
    initSongs();
    initScripts();
    initDnd();
    initMeds();
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
