'use strict';
// =====================================================================================================
// iLife — СБОРКА СО СЖАТИЕМ (esbuild).
//   Исходный, читаемый код лежит в папке src/ (src/js, src/css, src/sw.js) — правки вносятся ТОЛЬКО там.
//   Эта программа сжимает каждый файл и кладёт его под тем же именем в корень сайта (js/, css/, sw.js) —
//   именно эти сжатые файлы открывает браузер. Файлы сжимаются по одному и не склеиваются: порядок
//   подключения в index.html и общие для всех файлов имена функций остаются прежними.
//   Файлы js/config.js и js/config.example.js в сборке не участвуют (их правит владелец сайта).
// Запуск:  npm install   (один раз, ставит esbuild)   →   node build.cjs
// Проверка без записи файлов:  node build.cjs --check   (сообщает, если сжатые файлы отстали от src/)
// =====================================================================================================
const fs = require('fs');
const path = require('path');
const esbuild = require('esbuild');

const ROOT = __dirname, SRC = path.join(ROOT, 'src');
const checkOnly = process.argv.includes('--check');
const version = (fs.readFileSync(path.join(SRC, 'js', 'core.js'), 'utf8').match(/APP_VERSION\s*=\s*'([^']+)'/) || [])[1] || '?';
const banner = '/* iLife ' + version + ' — сжатый файл, собран из src/ (node build.cjs). Читаемый код с комментариями и сведениями о лицензиях — в папке src/. Этот файл не править. */';

const jobs = [];
for (const f of fs.readdirSync(path.join(SRC, 'js')).filter(f => f.endsWith('.js')).sort()) jobs.push({ from: path.join('src', 'js', f), to: path.join('js', f), loader: 'js' });
for (const f of fs.readdirSync(path.join(SRC, 'css')).filter(f => f.endsWith('.css')).sort()) jobs.push({ from: path.join('src', 'css', f), to: path.join('css', f), loader: 'css' });
jobs.push({ from: path.join('src', 'sw.js'), to: 'sw.js', loader: 'js' });

let before = 0, after = 0, stale = 0;
for (const j of jobs) {
    const code = fs.readFileSync(path.join(ROOT, j.from), 'utf8');
    // charset utf8 — русские буквы остаются буквами (иначе файл раздувается); имена верхнего уровня не переименовываются:
    // файлы — обычные скрипты без import/export, esbuild такие имена не трогает.
    const out = esbuild.transformSync(code, { loader: j.loader, minify: true, charset: 'utf8', legalComments: 'none', target: j.loader === 'js' ? 'es2020' : undefined, banner, sourcefile: j.from });
    if (out.warnings.length) console.warn(esbuild.formatMessagesSync(out.warnings, { kind: 'warning' }).join('\n'));
    const dest = path.join(ROOT, j.to);
    before += Buffer.byteLength(code); after += Buffer.byteLength(out.code);
    if (checkOnly) { if (!fs.existsSync(dest) || fs.readFileSync(dest, 'utf8') !== out.code) { stale++; console.log('отстал: ' + j.to); } continue; }
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, out.code);
}
const kb = n => (n / 1024).toFixed(0) + ' КБ';
if (checkOnly) { console.log(stale ? 'Сжатые файлы отстали от src/: ' + stale + '. Запустите node build.cjs' : 'Сжатые файлы совпадают с src/ (' + jobs.length + ')'); process.exit(stale ? 1 : 0); }
console.log('iLife ' + version + ': сжато файлов — ' + jobs.length + ', было ' + kb(before) + ', стало ' + kb(after) + ' (−' + Math.round((1 - after / before) * 100) + '%)');
