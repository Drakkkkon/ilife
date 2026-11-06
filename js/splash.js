'use strict';
// =====================================================================================================
// iLife — ЗАСТАВКА (экран блокировки как в Android): большие часы Алматы, дата, погода Алматы, ползунок «разблокируйте».
// Логика перенесена из My Money 4.8.1 (script.js: updateSplashClock, fetchWeather, initSlider, proceedFromSplash):
//   • время — Алматы, 24 часа, считается от UTC с фиксированным смещением +5 (не зависит от часового пояса устройства);
//   • погода — open-meteo.com (без ключа), обновляется каждые 10 минут и при возвращении в сеть;
//   • ползунок работает от мыши, пальца и стилуса (Pointer Events); с клавиатуры — Enter или пробел.
// Показ заставки можно выключить: Настройки → Профиль → «Экран блокировки при запуске».
// =====================================================================================================

function updateSplashClock() {
    const now = new Date();
    const p = almatyParts(now.getTime());
    const timeEl = $('#splash-time'), dateEl = $('#splash-date'), greetEl = $('#splash-greeting');
    if (timeEl) timeEl.textContent = pad2(p.h) + ':' + pad2(p.mi);
    if (dateEl) dateEl.textContent = capitalizeFirst(WEEKDAYS[p.wd]) + ', ' + p.d + ' ' + MONTHS_GEN[p.mo];
    if (greetEl) {
        let g = 'Доброй ночи';
        if (p.h >= 5 && p.h < 12) g = 'Доброе утро';
        else if (p.h >= 12 && p.h < 18) g = 'Добрый день';
        else if (p.h >= 18 && p.h < 23) g = 'Добрый вечер';
        greetEl.textContent = g + ', ' + authorName() + '!';
    }
}

const WEATHER_TEXT = {
    0: 'ясно', 1: 'преимущественно ясно', 2: 'переменная облачность', 3: 'пасмурно', 45: 'туман', 48: 'изморозь и туман',
    51: 'слабая морось', 53: 'морось', 55: 'сильная морось', 56: 'слабая ледяная морось', 57: 'ледяная морось',
    61: 'небольшой дождь', 63: 'дождь', 65: 'сильный дождь', 66: 'слабый ледяной дождь', 67: 'сильный ледяной дождь',
    71: 'небольшой снег', 73: 'снег', 75: 'сильный снег', 77: 'снежные зёрна', 80: 'кратковременный дождь', 81: 'ливень', 82: 'сильный ливень',
    85: 'снегопад', 86: 'сильный снегопад', 95: 'гроза', 96: 'гроза с небольшим градом', 99: 'гроза с сильным градом'
};
function weatherIconName(code) {
    if (code === 0) return 'wb_sunny';
    if (code === 1 || code === 2) return 'wb_cloudy';
    if (code === 3) return 'cloud';
    if (code === 45 || code === 48) return 'foggy';
    if ([51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82].includes(code)) return 'umbrella';
    if ([71, 73, 75, 77, 85, 86].includes(code)) return 'ac_unit';
    if ([95, 96, 99].includes(code)) return 'thunderstorm';
    return 'thermostat';
}

let weatherInFlight = false, lastWeatherOk = 0;
async function fetchWeather() {
    const el = $('#splash-weather');
    if (!el || weatherInFlight) return;
    weatherInFlight = true;
    const prev = el.innerHTML;
    if (!lastWeatherOk) el.innerHTML = ic('thermostat') + '<span>Алматы: загружаем погоду…</span>';
    // timezone=GMT: время наблюдения приходит в UTC и переводится в UTC+5 здесь
    const url = 'https://api.open-meteo.com/v1/forecast?latitude=43.2389&longitude=76.8897&current=temperature_2m,apparent_temperature,weather_code&timezone=GMT&temperature_unit=celsius';
    const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    let tid = 0;
    try {
        if (ctl) tid = setTimeout(() => ctl.abort(), 12000);
        const res = await fetch(url, { method: 'GET', cache: 'no-store', headers: { Accept: 'application/json' }, ...(ctl ? { signal: ctl.signal } : {}) });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const data = await res.json();
        const cur = data && data.current;
        const t = Number(cur && cur.temperature_2m);
        if (!cur || !Number.isFinite(t)) throw new Error('нет данных');
        const code = Number(cur.weather_code);
        const feels = Number(cur.apparent_temperature);
        const feelsText = Number.isFinite(feels) ? ', ощущается как ' + Math.round(feels) + '°C' : '';
        const obs = cur.time ? Date.parse(String(cur.time) + 'Z') : NaN;
        const upd = Number.isFinite(obs) ? ' · обновлено ' + fmtTime(obs) : '';
        const tt = (t > 0 ? '+' : '') + Math.round(t) + '°C';
        el.innerHTML = ic(weatherIconName(code)) + '<span>Алматы: ' + tt + ', ' + esc(WEATHER_TEXT[code] || 'текущая погода') + esc(feelsText) + '<span class="weather-updated">' + esc(upd) + '</span></span>';
        lastWeatherOk = Date.now();
    } catch (e) {
        if (!lastWeatherOk) el.innerHTML = ic('cloud_off') + '<span>Алматы: нет соединения с погодным сервисом</span>';
        else if (prev && !prev.includes('не удалось обновить')) el.innerHTML = prev + '<span class="weather-updated"> · не удалось обновить</span>';
    } finally { if (tid) clearTimeout(tid); weatherInFlight = false; }
}

function proceedFromSplash() {
    const s = $('#splash-screen');
    if (!s) return;
    s.style.opacity = '0';
    s.style.pointerEvents = 'none';
    setTimeout(() => { s.classList.add('is-gone'); }, 480);
}

let sliderReady = false;
function initSlider() {
    const thumb = $('#slider-thumb'), box = $('#slider-container');
    if (!thumb || !box || sliderReady) return;
    sliderReady = true;
    let dragging = false, pid = null, startX = 0, curX = 0, maxDrag = 0, unlocked = false;
    const measure = () => {
        const tw = thumb.getBoundingClientRect().width || thumb.offsetWidth;
        maxDrag = Math.max(0, box.clientWidth - tw - 12);
        if (!dragging && !unlocked) thumb.style.transform = 'translate3d(0,0,0)';
    };
    const finish = () => {
        unlocked = true;
        thumb.style.transition = 'transform .12s ease'; thumb.style.transform = 'translate3d(' + maxDrag + 'px,0,0)';
        box.setAttribute('aria-valuenow', '100'); box.setAttribute('aria-label', 'Разблокировано');
        setTimeout(proceedFromSplash, 140);
    };
    thumb.addEventListener('pointerdown', e => {
        if (unlocked || dragging) return;
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        measure(); if (maxDrag < 20) return;
        dragging = true; pid = e.pointerId; startX = e.clientX; curX = 0;
        thumb.style.transition = 'none'; thumb.classList.add('is-dragging');
        try { thumb.setPointerCapture(e.pointerId); } catch (_) {}
        if (e.cancelable) e.preventDefault();
    }, { passive: false });
    document.addEventListener('pointermove', e => {
        if (!dragging || (pid !== null && e.pointerId !== pid)) return;
        curX = Math.max(0, Math.min(e.clientX - startX, maxDrag));
        thumb.style.transform = 'translate3d(' + curX + 'px,0,0)';
        box.setAttribute('aria-valuenow', String(Math.round(curX / (maxDrag || 1) * 100)));
        if (e.cancelable) e.preventDefault();
    }, { passive: false });
    const end = e => {
        if (!dragging || (e && pid !== null && e.pointerId !== pid)) return;
        dragging = false; pid = null; thumb.classList.remove('is-dragging');
        if (curX >= maxDrag * 0.78) finish();
        else { thumb.style.transition = 'transform .22s ease'; thumb.style.transform = 'translate3d(0,0,0)'; curX = 0; box.setAttribute('aria-valuenow', '0'); }
    };
    document.addEventListener('pointerup', end);
    document.addEventListener('pointercancel', end);
    thumb.addEventListener('lostpointercapture', () => { if (dragging) end({ pointerId: pid }); });
    box.addEventListener('keydown', e => { if ((e.key === 'Enter' || e.key === ' ') && !unlocked) { e.preventDefault(); measure(); finish(); } });
    window.addEventListener('resize', measure);
    requestAnimationFrame(measure);
}

function initSplash(skip) {
    const s = $('#splash-screen');
    if (!s) return;
    if (skip) { s.classList.add('is-gone'); return; }
    updateSplashClock();
    setInterval(updateSplashClock, 1000);
    initSlider();
    setTimeout(fetchWeather, 250);
    setInterval(fetchWeather, 10 * 60 * 1000); // актуальная погода: обновление каждые 10 минут
    window.addEventListener('online', fetchWeather);
    document.addEventListener('visibilitychange', () => { if (!document.hidden && Date.now() - lastWeatherOk > 5 * 60 * 1000) fetchWeather(); });
}
