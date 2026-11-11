'use strict';
// =====================================================================================================
// iLife — ТЕМЫ «ANDROID», МАСШТАБ, ШРИФТ, ШИРИНА МАКЕТА.
// Пять вариантов цвета перенесены из My Money 4.8.1 (js/themes.js → ANDROID_PALETTES): Лаванда, Океан, Мята (светлые),
// Закат и Ночная роза (тёмные). Цвета — тональные палитры Material 3. Здесь они записываются в переменные --md-* у <html>
// (css/android.css), поэтому всё приложение перекрашивается мгновенно, без перезагрузки.
// Масштаб: 50–200 % меняет font-size у <html> (весь интерфейс в rem). «Под экран» подбирает масштаб по ширине экрана устройства.
// Макет: html[data-layout="compact"] — телефон (нижняя навигация-пилюля), "wide" — ПК/планшет (боковая панель).
// Ширину считаем с учётом масштаба: при 150 % «телефонный» макет включается раньше, чем при 100 %.
// =====================================================================================================

const PALETTES = [
    { id: 'android', name: 'Лаванда', v: 'violet', dark: false,
      primary: '#6750a4', onPrimary: '#ffffff', primaryContainer: '#eaddff', secondaryContainer: '#e8def8',
      surface: '#fef7ff', surfaceLowest: '#ffffff', surfaceContainer: '#f3edf7', surfaceHigh: '#ece6f0', surfaceHighest: '#e6e0e9',
      onSurface: '#1d1b20', onSurfaceVariant: '#49454f', outline: '#79747e', outlineVariant: '#cac4d0', income: '#146c2e', expense: '#b3261e',
      tertiary: '#7d5260', tertiaryContainer: '#ffd8e4', onTertiaryContainer: '#31111d' },
    { id: 'android-ocean', name: 'Океан', v: 'ocean', dark: false,
      primary: '#005ac8', onPrimary: '#ffffff', primaryContainer: '#dde1ff', secondaryContainer: '#dde1ff',
      surface: '#f8f9ff', surfaceLowest: '#ffffff', surfaceContainer: '#ededf5', surfaceHigh: '#e7e8f0', surfaceHighest: '#e1e2ea',
      onSurface: '#1b1b21', onSurfaceVariant: '#454652', outline: '#757683', outlineVariant: '#c4c6d4', income: '#146c2e', expense: '#b3261e',
      tertiary: '#9b3978', tertiaryContainer: '#ffd7ed', onTertiaryContainer: '#4a0030' },
    { id: 'android-mint', name: 'Мята', v: 'mint', dark: false,
      primary: '#056c48', onPrimary: '#ffffff', primaryContainer: '#9cf4c9', secondaryContainer: '#caead9',
      surface: '#f2fcf6', surfaceLowest: '#ffffff', surfaceContainer: '#e7f0eb', surfaceHigh: '#e1eae5', surfaceHighest: '#dce5e0',
      onSurface: '#161d19', onSurfaceVariant: '#3c4a43', outline: '#6c7a72', outlineVariant: '#bacac1', income: '#146c2e', expense: '#b3261e',
      tertiary: '#006a78', tertiaryContainer: '#99f0ff', onTertiaryContainer: '#002431' },
    { id: 'android-sunset', name: 'Закат', v: 'sunset', dark: true,
      primary: '#ffb691', onPrimary: '#552100', primaryContainer: '#862300', secondaryContainer: '#653d28',
      surface: '#19120e', surfaceLowest: '#150c07', surfaceContainer: '#251e1b', surfaceHigh: '#302825', surfaceHighest: '#3b3330',
      onSurface: '#eae1dc', onSurfaceVariant: '#d4c3bc', outline: '#9d8e86', outlineVariant: '#51443e', income: '#80d485', expense: '#ffb4a9',
      tertiary: '#c9cc6b', tertiaryContainer: '#424c00', onTertiaryContainer: '#e5e886' },
    { id: 'android-orchid', name: 'Ночная роза', v: 'orchid', dark: true,
      primary: '#ffafcf', onPrimary: '#5e0033', primaryContainer: '#8d0053', secondaryContainer: '#643a4b',
      surface: '#191114', surfaceLowest: '#150b0f', surfaceContainer: '#251e20', surfaceHigh: '#30282b', surfaceHighest: '#3b3336',
      onSurface: '#eae0e3', onSurfaceVariant: '#d4c2c8', outline: '#9d8c92', outlineVariant: '#524348', income: '#80d485', expense: '#ffb4a9',
      tertiary: '#ffb597', tertiaryContainer: '#773215', onTertiaryContainer: '#ffdbcd' }
];
function paletteById(id) { return PALETTES.find(p => p.id === id) || PALETTES[0]; }

function applyTheme(id) {
    const p = paletteById(id); const root = document.documentElement;
    const set = (k, v) => root.style.setProperty(k, v);
    set('--md-primary', p.primary); set('--md-on-primary', p.onPrimary);
    set('--md-primary-container', p.primaryContainer); set('--md-secondary-container', p.secondaryContainer);
    set('--md-surface', p.surface); set('--md-container', p.surfaceContainer); set('--md-container-high', p.surfaceHigh); set('--md-container-highest', p.surfaceHighest);
    // «Плитки» внутри карточек: у светлых тем — самый светлый слой, у тёмных — слой выше карточки (как в My Money)
    set('--md-tile', p.dark ? p.surfaceHigh : p.surfaceLowest);
    set('--md-on-surface', p.onSurface); set('--md-on-variant', p.onSurfaceVariant);
    set('--md-outline', p.outline); set('--md-outline-variant', p.outlineVariant);
    set('--md-error', p.expense); set('--md-income', p.income);
    set('--md-tertiary', p.tertiary); set('--md-tertiary-container', p.tertiaryContainer); set('--md-on-tertiary-container', p.onTertiaryContainer);
    root.dataset.mode = p.dark ? 'dark' : 'light';
    root.dataset.variant = p.v;
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', p.surface);
    settings.theme = p.id;
}

// ---------- Шрифты (группа «Android» из My Money) ----------
const FONTS = [
    { id: 'google-sans-flex', name: 'Google Sans Flex', stack: "'Google Sans Flex', 'Google Sans', 'Roboto Flex', 'Roboto', 'Noto Sans', system-ui, sans-serif", css: 'Google+Sans+Flex:wght@400;500;700' },
    { id: 'roboto-flex', name: 'Roboto Flex', stack: "'Roboto Flex', 'Roboto', 'Noto Sans', system-ui, sans-serif", css: 'Roboto+Flex:wght@400;500;700' },
    { id: 'system', name: 'Системный', stack: "system-ui, -apple-system, 'Segoe UI', Roboto, 'Noto Sans', sans-serif", css: '' }
];
function applyFont(id) {
    const f = FONTS.find(x => x.id === id) || FONTS[0];
    document.documentElement.style.setProperty('--md-font', f.stack);
    if (f.css && !document.querySelector('link[data-font="' + f.id + '"]')) {
        const l = document.createElement('link');
        l.rel = 'stylesheet'; l.dataset.font = f.id; l.href = 'https://fonts.googleapis.com/css2?family=' + f.css + '&display=swap';
        document.head.appendChild(l);
    }
    settings.font = f.id;
}

// ---------- Масштаб и ширина макета ----------
const SCALE_MIN = 50, SCALE_MAX = 200;
// «Под экран»: телефон ≈ 85–115 % (около 100 % на 400 px), планшет / ПК 90–150 % по мере роста экрана (как в My Money)
function autoScalePercent() {
    const w = Math.max(window.screen && window.screen.width || 0, 0) || window.innerWidth;
    const shortSide = Math.min(w, (window.screen && window.screen.height) || w);
    const base = isMobileDevice() ? shortSide : w;
    let pct;
    if (base <= 600) pct = 85 + (Math.max(base, 320) - 320) / (480 - 320) * 30;
    else pct = 90 + (Math.min(base, 1920) - 600) / (1920 - 600) * 60;
    pct = Math.max(85, Math.min(150, pct));
    return Math.round(pct / 5) * 5;
}
function currentScale() {
    const v = settings.scaleMode === 'auto' ? autoScalePercent() : Number(settings.scale);
    return Math.max(SCALE_MIN, Math.min(SCALE_MAX, Number.isFinite(v) ? v : 100));
}
function applyScale() {
    const pct = currentScale();
    document.documentElement.style.fontSize = (16 * pct / 100) + 'px';
    applyLayout();
    return pct;
}
function applyLayout() {
    const pct = currentScale();
    const remWidth = window.innerWidth / (16 * pct / 100);
    document.documentElement.dataset.layout = remWidth <= 48 ? 'compact' : 'wide';
}
function setScale(pct, mode) {
    settings.scaleMode = mode || 'manual';
    if (settings.scaleMode === 'manual') settings.scale = Math.max(SCALE_MIN, Math.min(SCALE_MAX, Math.round(pct / 5) * 5));
    saveSettings();
    const shown = applyScale();
    if (typeof refreshScaleUI === 'function') refreshScaleUI();
    return shown;
}
window.addEventListener('resize', debounce(() => { if (settings.scaleMode === 'auto') applyScale(); else applyLayout(); if (typeof refreshScaleUI === 'function') refreshScaleUI(); }, 80));
window.addEventListener('orientationchange', () => setTimeout(() => { if (settings.scaleMode === 'auto') applyScale(); else applyLayout(); }, 200));

// Применяется до отрисовки страницы, чтобы не было мигания
applyTheme(settings.theme);
applyFont(settings.font);
applyScale();
