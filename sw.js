// iLife — служебный воркер: приложение открывается и без интернета (кроме погоды, курсов, шрифта Google, входа Google, Spotify, YouTube, Telegram, ИИ и баз фильмов).
// Файлы приложения кешируются при первом открытии; при выходе новой версии меняйте CACHE (число в конце) — старый кеш удалится сам.
const CACHE = 'ilife-v1.6.0';
const CORE = [
    './', 'index.html', 'manifest.webmanifest', 'favicon.ico',
    'css/android.css', 'css/app.css',
    'js/icons.js', 'js/core.js', 'js/theme.js', 'js/pdf-fonts.js', 'js/android.js', 'js/media.js', 'js/splash.js', 'js/spotify.js', 'js/youtube.js',
    'js/ideas.js', 'js/idea-folders.js', 'js/telegram.js', 'js/gallery.js', 'js/todo.js', 'js/moviedb.js', 'js/recognize.js', 'js/movies.js', 'js/gdrive.js', 'js/pdf.js', 'js/pdf-export.js', 'js/settings.js', 'js/app.js',
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
