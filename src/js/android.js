'use strict';
// --- ВОЛНА-ОТКЛИК ПРИ НАЖАТИИ (как у кнопок Android) — перенесено из My Money 4.8.1 (js/android.js) ---
// От точки касания по элементу расходится светлая волна. Файл разметку не меняет: он лишь ставит элементу переменные
// --rx / --ry (точка нажатия) и на полсекунды класс md-rip; сама волна рисуется в css/android.css (раздел «Волна»).
// Выключается, если в системе включено «Уменьшить анимацию» (prefers-reduced-motion).
(function () {
    const TARGETS = [
        'button:not(.slider-thumb):not(.lb-btn):not(.x):not(.chip-x)', 'label.btn', '.theme-swatch', '.font-card', '.track-row', '.file-row', '.opt-row', 'summary', '.note-media button'
    ].join(',');
    const reduce = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };

    document.addEventListener('pointerdown', function (e) {
        if (reduce.matches) return;
        if (e.button && e.button !== 0) return;
        const el = e.target.closest && e.target.closest(TARGETS);
        if (!el || el.disabled) return;
        const r = el.getBoundingClientRect();
        const x = e.clientX - r.left, y = e.clientY - r.top;
        const far = Math.hypot(Math.max(x, r.width - x), Math.max(y, r.height - y)); // радиус — до самого дальнего угла
        el.style.setProperty('--rx', Math.round(x) + 'px');
        el.style.setProperty('--ry', Math.round(y) + 'px');
        el.style.setProperty('--rmax', Math.ceil(far) + 'px');
        el.classList.remove('md-rip');
        void el.offsetWidth; // перезапуск анимации при быстрых повторных нажатиях
        el.classList.add('md-rip');
        clearTimeout(el._mdRipTimer);
        el._mdRipTimer = setTimeout(function () { el.classList.remove('md-rip'); }, 620);
    }, true);
})();
