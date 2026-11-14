// iLife — служебный воркер: приложение открывается и без интернета (кроме погоды, курсов, шрифта Google, входа Google, Spotify, YouTube, Telegram, ИИ, баз фильмов и новых песен с Google Диска; скачанные песни играют и без сети).
// Файлы приложения кешируются при первом открытии; при выходе новой версии меняйте CACHE (число в конце) — старый кеш удалится сам.
const CACHE = 'ilife-v2.9.0';
const CORE = [
    './', 'index.html', 'manifest.webmanifest', 'favicon.ico',
    'css/android.css', 'css/app.css',
    'css/dnd.css', 'css/meds.css', 'css/diary.css', 'js/icons.js', 'js/dnd-icons.js', 'js/core.js', 'js/theme.js', 'js/pdf-fonts.js', 'js/android.js', 'js/media.js', 'js/splash.js', 'js/spotify.js', 'js/youtube.js',
    'js/ideas.js', 'js/idea-folders.js', 'js/telegram.js', 'js/gallery.js', 'js/xbookmarks.js', 'js/todo.js', 'js/moviedb.js', 'js/moviesearch.js', 'js/recognize.js', 'js/movies.js', 'js/songs.js', 'js/scripts.js', 'js/dnd.js', 'js/dnd-board.js', 'js/dnd-board-ui.js', 'js/dnd-pages.js', 'js/dnd-chars.js', 'js/dnd-tags.js', 'js/dnd-deck.js', 'js/dnd-emoji.js', 'js/dnd-emoji-ui.js', 'js/dnd-city.js', 'js/dnd-citygen.js', 'js/dnd-export.js', 'js/meds.js', 'js/meds-schedule.js', 'js/meds-mood.js', 'js/meds-recognize.js', 'js/dayplan.js', 'js/diary.js', 'js/comics.js', 'comics/index.html', 'js/dnd-city3d-world.js', 'js/dnd-city3d.js', 'js/gdrive.js', 'js/musictags.js', 'js/music.js', 'js/musicplayer.js', 'js/pdf.js', 'js/pdf-export.js', 'js/settings.js', 'js/mm-account.js', 'js/account.js', 'js/app.js',
    'images/icon-192.png', 'images/icon-512.png', 'images/icon-maskable-192.png', 'images/icon-maskable-512.png', 'images/apple-touch-icon.png',
    'images/favicon-32.png', 'images/favicon-48.png', 'images/logo.png'
];
self.addEventListener('install', e => {
    e.waitUntil(caches.open(CACHE).then(c => c.addAll(CORE)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
    e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('ilife-') && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
    const req = e.request; const url = new URL(req.url);
    if (req.method !== 'GET' || url.origin !== location.origin) return; // чужие адреса (Spotify, YouTube, Telegram, погода, шрифты) — напрямую
    // сначала сеть (чтобы новые версии подхватывались), при отсутствии сети — из кеша; параметры адреса (?code=…, ?v=…) игнорируются
    e.respondWith(
        fetch(req, { cache: 'no-cache' }).then(res => {
            if (res && res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
            return res;
        }).catch(() => caches.match(req, { ignoreSearch: true }).then(r => r || (req.mode === 'navigate' ? caches.match('index.html', { ignoreSearch: true }) : Response.error())))
    );
});

// Нажатие на уведомление: «пора принять лекарство» (js/meds-schedule.js, кнопка «Принял») или «дела на сегодня»
// (js/dayplan.js, кнопка «Сделано»). Нажатие на само уведомление открывает нужную страницу. Если iLife закрыт — открывается заново.
self.addEventListener('notificationclick', e => {
    const data = e.notification.data || {}; const keys = Array.isArray(data.keys) ? data.keys : [];
    const taken = e.action === 'taken', plan = data.type === 'plan-notify';
    e.notification.close();
    e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
        const c = list[0];
        if (c) { c.postMessage({ type: plan ? 'plan-notify' : 'med-notify', keys, taken }); return taken || !c.focus ? undefined : c.focus(); }
        const q = plan ? 'plan' : 'med', hash = plan ? '#todo' : '#med-schedule';
        const url = new URL('./?' + q + '=' + (taken ? 'taken:' + encodeURIComponent(keys.join(',')) : 'open') + hash, self.registration.scope).href;
        return self.clients.openWindow ? self.clients.openWindow(url) : undefined;
    }));
});
