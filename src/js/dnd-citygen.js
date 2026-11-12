'use strict';
// =====================================================================================================
// iLife 2.5.0 — «ДНД» → «ВИЖУАЛ»: ГЕНЕРАТОР КАРТ
//   dndCityGenerate({ biome, w, h, seed, towns, build, preset }) → { w, h, tiles: Uint8Array, items: [...], hub: {x, y}, towns: [...] }
//   Один и тот же набор параметров и один и тот же номер карты (seed) всегда дают одну и ту же карту.
//   Три готовые карты — это тот же генератор с записанным номером и названиями мест (DND_GEN_PRESETS).
//   Виды местности: 0 трава, 1 дорога, 2 вода, 3 площадь, 4 лес, 5 поле, 6 камень, 7 песок, 8 снег (DND_CITY_TILES в dnd-city.js).
//   Порядок работы: рельеф → поселения (площадь, улицы, здания) → особые места → дороги между поселениями → поля → декор.
// =====================================================================================================

const DND_GEN_BIOMES = [
    { id: 'land', n: 'Королевство', e: '🏰' }, { id: 'desert', n: 'Пустыня', e: '🏜️' }, { id: 'mount', n: 'Горы', e: '🏔️' }, { id: 'isles', n: 'Острова', e: '🏝️' }
];
const DND_GEN_SIZES = [{ id: 's', n: 'Малая', w: 48, h: 34, t: 2 }, { id: 'm', n: 'Средняя', w: 72, h: 50, t: 4 }, { id: 'l', n: 'Большая', w: 100, h: 70, t: 6 }];

// ---------- Названия ----------
const DND_GEN_TXT = {
    towns: {
        land: ['Заречье', 'Дубрава', 'Светлый Ключ', 'Орлиный Холм', 'Медовая Падь', 'Каменный Брод', 'Вороний Яр', 'Тихие Ивы', 'Златоградье', 'Росный Луг', 'Белая Мельница', 'Кленовая Сень'],
        desert: ['Аль-Захир', 'Сахар-Дин', 'Оазис Мираж', 'Рас-Халиль', 'Дар-Фарух', 'Нур-Эддин', 'Бир-Зайн', 'Хамсин', 'Кувейра', 'Тамир-Шаль', 'Золотые Дюны', 'Сухой Колодец'],
        mount: ['Ветрогорск', 'Серебряный Рудник', 'Ледяной Перевал', 'Каменный Рог', 'Гром-Скала', 'Вьюжный Приют', 'Железный Клык', 'Седая Гряда', 'Орлиная Тропа', 'Горный Ключ', 'Белый Утёс', 'Эхо-Лощина'],
        isles: ['Пенный Порт', 'Коралловая Бухта', 'Соляной Мыс', 'Штормовой Рейд', 'Жемчужная Гавань', 'Черепаший Берег', 'Маяк Гулль', 'Тихая Заводь', 'Рыбачья Слобода', 'Чаячий Остров', 'Янтарный Причал', 'Ракушечный Мыс']
    },
    tavern: ['Рыжий Грифон', 'Пьяный Дракон', 'Золотой Колос', 'Хромой Пони', 'Серебряная Подкова', 'Весёлый Кот', 'Ржавый Котёл', 'Три Лисы', 'Усталый Странник', 'Медный Кувшин', 'Сонный Филин', 'Дубовая Бочка'],
    inn: ['Тёплый Очаг', 'Дорожный Приют', 'Спокойный Ночлег', 'Последний Привал', 'Добрый Сон', 'Тихая Гавань'],
    shop: ['Лавка Мирны', 'Лавка старого Торина', 'Бакалея Ольвы', 'Травы и коренья', 'Всё для путника', 'Лавка редкостей', 'Пекарня Брана', 'Лавка Хельги'],
    smithy: ['Кузница Торгрима', 'Кузница «Молот и Наковальня»', 'Кузница Брага', 'Кузница Хельги', 'Оружейная Дарина'],
    guild: ['Гильдия Караванщиков', 'Гильдия Картографов', 'Гильдия Лекарей', 'Гильдия Наёмников', 'Гильдия Магов'],
    tower: ['Сторожевая башня', 'Башня Магов', 'Дозорная башня', 'Старая башня'],
    temple: { land: ['Храм Света', 'Храм Покоя', 'Часовня Трёх Дорог'], desert: ['Храм Трёх Солнц', 'Храм Песчаной Богини', 'Святилище Колодца'], mount: ['Храм Ветров', 'Приют Горного Духа', 'Часовня Вершин'], isles: ['Храм Приливов', 'Храм Морской Матери', 'Часовня Рыбаков'] },
    castle: { land: 'Замок', desert: 'Дворец Султана', mount: 'Крепость Грифона', isles: 'Крепость Прилива' },
    market: { land: 'Рынок', desert: 'Великий Базар', mount: 'Торжище', isles: 'Рыбный рынок' }
};
const DND_GEN_PAL = {   // цвета домов (в 3D это цвет крыши)
    land: ['#d7a77a', '#e8c9a0', '#c98f5c', '#e0b890', '#cfa17a', '#d9b38a'], desert: ['#e3c690', '#d9b57a', '#efd9a8', '#caa56b', '#e8cfa0', '#d8b98a'],
    mount: ['#b9a38a', '#c9b79b', '#9f8f7e', '#b0a8a0', '#a67c52', '#c2b2a0'], isles: ['#f2ede2', '#e8d9bd', '#a8c8d8', '#d9b38a', '#f0d6c0', '#c9dce6']
};

// ---------- Случайные числа и шум (всё зависит только от номера карты) ----------
function dndGenRng(seed) { let a = seed >>> 0; return function () { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function dndGenNoise(seed) {   // плавный шум 0..1 из нескольких слоёв
    const hash = (x, y) => { let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(seed | 0, 1442695041); h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
    const sm = t => t * t * (3 - 2 * t);
    const v = (x, y) => { const xi = Math.floor(x), yi = Math.floor(y), fx = sm(x - xi), fy = sm(y - yi), a = hash(xi, yi), b = hash(xi + 1, yi), c = hash(xi, yi + 1), d = hash(xi + 1, yi + 1); return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy; };
    return function (x, y, oct) { let s = 0, amp = 1, tot = 0, f = 1; for (let i = 0; i < (oct || 3); i++) { s += amp * v(x * f + i * 31.7, y * f - i * 17.3); tot += amp; amp *= 0.5; f *= 2; } return s / tot; };
}
const dndGenBiomeOf = seed => DND_GEN_BIOMES[Math.floor(dndGenRng(seed ^ 0x1b873593)() * DND_GEN_BIOMES.length)].id;

// ---------- Сама генерация ----------
function dndCityGenerate(o) {
    const W = Math.max(32, Math.min(120, o.w | 0)), H = Math.max(24, Math.min(120, o.h | 0)), seed = (o.seed | 0) || 1, P = o.preset || null, build = o.build !== false;
    const biome = o.biome && o.biome !== 'any' ? o.biome : dndGenBiomeOf(seed);
    const rnd = dndGenRng(seed), nz = dndGenNoise(seed ^ 0x51ed27), nz2 = dndGenNoise(seed ^ 0x2545f49), nz3 = dndGenNoise(seed ^ 0x7f4a7c1);
    const S = Math.max(W, H), N = W * H, idx = (x, y) => y * W + x, inb = (x, y) => x >= 0 && y >= 0 && x < W && y < H;
    const T = new Uint8Array(N), occ = new Uint8Array(N), E = new Float32Array(N), dec = new Uint8Array(N), items = [], towns = [];   // occ: 1 — здание (занято), 2 — площадь
    const R = (a, b) => a + rnd() * (b - a), RI = (a, b) => Math.floor(R(a, b + 1)), pick = a => a[Math.floor(rnd() * a.length)], dist = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);
    const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); const t = a[i]; a[i] = a[j]; a[j] = t; } return a; };
    const D4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    const quant = (arr, q) => { const s = Float32Array.from(arr).sort(); return s[Math.max(0, Math.min(s.length - 1, Math.floor(q * (s.length - 1))))]; };
    const smooth = passes => {   // убирает одиночные «крапинки» местности
        const cnt = new Uint8Array(9);
        for (let p = 0; p < passes; p++) {
            const src = T.slice();
            for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
                cnt.fill(0); for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { if (inb(x + dx, y + dy)) cnt[src[idx(x + dx, y + dy)]]++; }
                let b = src[idx(x, y)], bc = 0; for (let k = 0; k < 9; k++) if (cnt[k] > bc) { bc = cnt[k]; b = k; } if (bc >= 5) T[idx(x, y)] = b;
            }
        }
    };
    const river = (x0, y0, tx, ty, wide) => {   // извилистая река от точки к точке; остановится, дойдя до другой воды
        let x = x0, y = y0; const put = (a, b) => { if (inb(a, b)) T[idx(a, b)] = 2; };
        for (let g = 0; g < (W + H) * 4; g++) {
            if (g > 5 && T[idx(x, y)] === 2) break; put(x, y); if (wide) { put(x + 1, y); put(x, y + 1); } if (x === tx && y === ty) break;
            const dx = tx - x, dy = ty - y; let sx = 0, sy = 0;
            if (rnd() < 0.26) { if (Math.abs(dx) > Math.abs(dy)) sy = rnd() < 0.5 ? -1 : 1; else sx = rnd() < 0.5 ? -1 : 1; } else if (Math.abs(dx) * rnd() >= Math.abs(dy) * rnd()) sx = Math.sign(dx); else sy = Math.sign(dy);
            x = Math.max(0, Math.min(W - 1, x + sx)); y = Math.max(0, Math.min(H - 1, y + sy));
        }
    };
    let oases = [];

    // ===== 1. Рельеф =====
    if (biome === 'land') {
        const m = new Float32Array(N); for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { E[idx(x, y)] = nz(x / S * 3.2, y / S * 3.2, 4); m[idx(x, y)] = nz2(x / S * 5.5, y / S * 5.5, 3); }
        const qw = quant(E, 0.09), qs = quant(E, 0.965), qm = quant(m, 0.68);
        for (let i = 0; i < N; i++) T[i] = E[i] < qw ? 2 : E[i] > qs ? 6 : (m[i] > qm && E[i] > qw + 0.03 ? 4 : 0);
        smooth(2); if (rnd() < 0.9) river(RI(W * 0.15, W * 0.85), 0, RI(W * 0.15, W * 0.85), H - 1, true);
    } else if (biome === 'desert') {
        T.fill(7); for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) E[idx(x, y)] = nz(x / S * 3, y / S * 3, 4);
        const qs = quant(E, 0.93); for (let i = 0; i < N; i++) if (E[i] > qs) T[i] = 6;
        const cnt = RI(2, 3) + (S >= 90 ? 2 : S >= 60 ? 1 : 0);
        for (let t = 0; t < 300 && oases.length < cnt; t++) { const x = RI(8, W - 9), y = RI(8, H - 9); if (T[idx(x, y)] !== 6 && oases.every(a => dist(x, y, a.x, a.y) > S * 0.2)) oases.push({ x, y, rx: R(2.6, 4.4), ry: R(2.2, 3.6) }); }
        oases.forEach(a => { for (let y = Math.floor(a.y - a.ry - 4); y <= a.y + a.ry + 4; y++) for (let x = Math.floor(a.x - a.rx - 4); x <= a.x + a.rx + 4; x++) { if (!inb(x, y)) continue; const d = Math.hypot((x - a.x) / a.rx, (y - a.y) / a.ry) + (nz3(x * 0.35, y * 0.35, 2) - 0.5) * 0.55; if (d < 1) T[idx(x, y)] = 2; else if (d < 1.9 && T[idx(x, y)] !== 2) T[idx(x, y)] = 0; } });
        if (oases.length) { const a = oases[0], fromTop = rnd() < 0.5; river(fromTop ? RI(4, W - 5) : 0, fromTop ? 0 : RI(4, H - 5), a.x, a.y, false); }
        const g = T.slice(); for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) if (g[idx(x, y)] === 7 && D4.some(d => g[idx(x + d[0], y + d[1])] === 2) && rnd() < 0.85) T[idx(x, y)] = 0;
        smooth(1);
    } else if (biome === 'mount') {
        const m = new Float32Array(N); for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const e = nz(x / S * 2.4, y / S * 2.4, 4), r = 1 - Math.abs(2 * nz2(x / S * 1.7 + 3, y / S * 1.7, 3) - 1); E[idx(x, y)] = e * 0.5 + r * 0.55; m[idx(x, y)] = nz3(x / S * 5, y / S * 5, 3); }
        const qw = quant(E, 0.04), qsn = quant(E, 0.9), qst = quant(E, 0.78), qsl = quant(E, 0.58), qm = quant(m, 0.5), qm2 = quant(m, 0.75);
        for (let i = 0; i < N; i++) { const h = E[i]; T[i] = h < qw ? 2 : h > qsn ? 8 : h > qst ? 6 : h > qsl ? (m[i] > qm ? 4 : 0) : (m[i] > qm2 ? 4 : 0); }
        smooth(2);
        let top = 0; for (let i = 0; i < N; i++) if (E[i] > E[top]) top = i;   // река стекает с самой высокой точки к ближайшему озеру или к нижнему краю
        let wx = -1, wy = -1, bd = 1e9; for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (T[idx(x, y)] === 2) { const d = dist(x, y, top % W, (top / W) | 0); if (d > 6 && d < bd) { bd = d; wx = x; wy = y; } }
        river(top % W, (top / W) | 0, wx >= 0 ? wx : RI(0, W - 1), wx >= 0 ? wy : H - 1, false);
    } else {   // isles
        const cnt = RI(3, 4) + (S >= 90 ? 3 : S >= 60 ? 2 : 0), cs = [], base = Math.min(W, H);
        for (let t = 0; t < 600 && cs.length < cnt; t++) { const r = cs.length === 0 ? R(0.25, 0.31) * base : R(0.1, 0.2) * base, x = R(r, W - r), y = R(r * 0.9, H - r * 0.9); if (cs.every(c => dist(x, y, c.x, c.y) > (c.r + r) * 0.95 + 4)) cs.push({ x, y, r, rx: r * R(0.95, 1.3), ry: r * R(0.8, 1.05) }); }
        for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { let f = -1; for (const c of cs) f = Math.max(f, 1 - Math.hypot((x - c.x) / c.rx, (y - c.y) / c.ry)); E[idx(x, y)] = f + (nz(x / S * 8, y / S * 8, 3) - 0.5) * 0.55; }
        for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const i = idx(x, y), f = E[i]; T[i] = f < 0.04 ? 2 : f < 0.17 ? 7 : (f > 0.72 && nz3(x / S * 6, y / S * 6, 3) > 0.58) ? 6 : (f > 0.3 && nz2(x / S * 6, y / S * 6, 3) > 0.52) ? 4 : 0; }
        for (let k = 0, n = RI(5, 8); k < n; k++) { const cx = RI(3, W - 4), cy = RI(3, H - 4); let free = true; for (let dy = -5; dy <= 5 && free; dy++) for (let dx = -5; dx <= 5; dx++) if (inb(cx + dx, cy + dy) && T[idx(cx + dx, cy + dy)] !== 2) { free = false; break; } if (!free) continue; const r = R(1, 2.2); for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) if (Math.hypot(dx, dy) + (nz3((cx + dx) * 0.5, (cy + dy) * 0.5, 2) - 0.5) < r) { T[idx(cx + dx, cy + dy)] = 7; E[idx(cx + dx, cy + dy)] = 0.1; } }
        smooth(1);
    }
    // расстояния до воды и до камня (для выбора мест)
    const flood = (isSrc, lim) => { const d = new Int16Array(N).fill(999), q = []; for (let i = 0; i < N; i++) if (isSrc(T[i])) { d[i] = 0; q.push(i); } for (let h = 0; h < q.length; h++) { const u = q[h]; if (d[u] >= lim) continue; const ux = u % W, uy = (u / W) | 0; for (const dd of D4) { const nx = ux + dd[0], ny = uy + dd[1]; if (!inb(nx, ny)) continue; const v = idx(nx, ny); if (d[v] === 999) { d[v] = d[u] + 1; q.push(v); } } } return d; };
    const dw = flood(k => k === 2, 40), ds = flood(k => k === 6 || k === 8, 40);

    // ===== 2. Постройки =====
    const names = {}; const nameOf = (key, pool) => { if (!names[key]) names[key] = shuffle(pool.slice()); const a = names[key]; const v = a.shift(); a.push(v); return v; };
    const palette = DND_GEN_PAL[biome], tx = DND_GEN_TXT;
    const canB = k => k === 0 || k === 7 || k === 4 || k === 5;
    const fits = (bx, by, w, h, allow) => {
        if (bx < 1 || by < 1 || bx + w > W - 1 || by + h + 1 > H - 1) return false;
        for (let y = by - 1; y <= by + h; y++) for (let x = bx - 1; x <= bx + w; x++) {
            if (!inb(x, y)) return false; const i = idx(x, y), inside = x >= bx && x < bx + w && y >= by && y < by + h;
            if (inside) { const k = T[i]; if (occ[i] || !(allow ? allow.indexOf(k) >= 0 : canB(k))) return false; } else if (occ[i] === 1) return false;
        }
        return T[idx(bx + Math.floor((w - 1) / 2), by + h)] !== 2;
    };
    const doors = [];
    const commit = (bx, by, w, h, k, n, extra) => {
        for (let y = by; y < by + h; y++) for (let x = bx; x < bx + w; x++) { const i = idx(x, y); occ[i] = 1; const t = T[i]; if (t === 4 || t === 5 || t === 6 || t === 8) T[i] = 0; }
        const kd = bldKind(k), b = Object.assign({ id: uid('bl'), t: 'b', x: bx, y: by, w, h, n: n || '', k, c: k === 'house' || k === 'shop' ? pick(palette) : kd.c, lv: k === 'house' ? pick([1, 2, 2, 3]) : (kd.lv || 2), note: '' }, extra || {});
        items.push(b); doors.push({ x: bx + Math.floor((w - 1) / 2), y: by + h, b }); return b;
    };
    const bname = (k, role) => {
        if (k === 'castle') return P && P.castle || tx.castle[biome]; if (k === 'market') return P && P.market || tx.market[biome]; if (k === 'temple') return role === 'cap' && P && P.temple || nameOf('temple', tx.temple[biome]);
        if (k === 'tavern') return 'Таверна «' + nameOf('tavern', tx.tavern) + '»'; if (k === 'inn') return 'Постоялый двор «' + nameOf('inn', tx.inn) + '»'; if (k === 'shop') return nameOf('shop', tx.shop);
        if (k === 'smithy') return nameOf('smithy', tx.smithy); if (k === 'guild') return nameOf('guild', tx.guild); if (k === 'tower') return nameOf('tower', tx.tower); return '';
    };
    const placeB = (k, c, Rr, role, anchor) => {
        const kd = bldKind(k), w = k === 'house' ? 2 + (rnd() < 0.6 ? 1 : 0) : kd.w, h = k === 'house' ? 2 + (rnd() < 0.6 ? 1 : 0) : kd.h;
        for (let t = 0; t < 320; t++) {
            const rr = anchor && t < 40 ? Math.sqrt(rnd()) * 3 : Math.sqrt(rnd()) * (Rr + 1 + t / 40), a = rnd() * 6.283, ox = anchor ? anchor.x : c.x, oy = anchor ? anchor.y : c.y;
            const bx = Math.round(ox + Math.cos(a) * rr * 1.35 - w / 2), by = Math.round(oy + Math.sin(a) * rr * 0.95 - h / 2);
            if (fits(bx, by, w, h)) return commit(bx, by, w, h, k, bname(k, role));
        }
        return null;
    };
    const connectDoors = list => {   // от двери до ближайшей дороги или площади — короткая улочка
        for (const d of list) {
            const s = idx(d.x, d.y); if (T[s] === 1 || T[s] === 3) continue; const prev = new Int32Array(N).fill(-2), q = [s]; prev[s] = -1; let hit = -1;
            for (let h = 0; h < q.length && hit < 0; h++) { const u = q[h], ux = u % W, uy = (u / W) | 0; if (h > 0 && (T[u] === 1 || T[u] === 3)) { hit = u; break; } if (h > 900) break; for (const dd of D4) { const nx = ux + dd[0], ny = uy + dd[1]; if (!inb(nx, ny)) continue; const v = idx(nx, ny); if (prev[v] !== -2 || occ[v] === 1 || T[v] === 2) continue; prev[v] = u; q.push(v); } }
            if (hit >= 0) for (let v = prev[hit]; v >= 0; v = prev[v]) T[v] = 1; else if (T[s] !== 2) T[s] = 1;
            if (hit >= 0 && T[s] !== 1) T[s] = 1;
        }
    };
    const buildTown = (c, role, name) => {
        const Rr = role === 'cap' ? 10 : role === 'town' ? 7.5 : 5.5, pw = role === 'cap' ? 5 : role === 'town' ? 4 : 3, px0 = c.x - (pw >> 1), py0 = c.y - (pw >> 1), my = [];
        for (let y = py0; y < py0 + pw; y++) for (let x = px0; x < px0 + pw; x++) if (inb(x, y)) { T[idx(x, y)] = 3; occ[idx(x, y)] = 2; }
        D4.forEach((d, i) => {
            if (role === 'village' && i > 1 && rnd() < 0.5) return; const len = Math.round(R(0.55, 0.95) * Rr); let x = d[0] > 0 ? px0 + pw : d[0] < 0 ? px0 - 1 : c.x, y = d[1] > 0 ? py0 + pw : d[1] < 0 ? py0 - 1 : c.y;
            for (let s = 0; s < len; s++) { if (!inb(x, y) || T[idx(x, y)] === 2 || T[idx(x, y)] === 6 || T[idx(x, y)] === 8) break; if (T[idx(x, y)] !== 3 && occ[idx(x, y)] !== 1) T[idx(x, y)] = 1; x += d[0]; y += d[1]; }
        });
        const want = role === 'cap' ? [['castle', 1], ['temple', 1], ['market', 1], ['guild', 1], ['tavern', 2], ['inn', 1], ['smithy', 1], ['shop', 3], ['tower', 2], ['house', RI(10, 15)]]
            : role === 'town' ? [['temple', 1], ['tavern', 1], ['inn', 1], ['smithy', 1], ['shop', 2], ['tower', RI(0, 1)], ['house', RI(6, 9)]] : [['tavern', 1], ['house', RI(3, 6)], ['smithy', rnd() < 0.5 ? 1 : 0], ['temple', rnd() < 0.3 ? 1 : 0]];
        for (const [k, n] of want) for (let i = 0; i < n; i++) { const b = placeB(k, c, Rr, role, k === 'castle' ? { x: c.x, y: py0 - 5 } : null); if (b) my.push(b); }
        connectDoors(doors.filter(d => my.indexOf(d.b) >= 0));
        const t = { name, role, x: c.x, y: c.y, hub: { x: px0 + pw / 2, y: py0 + pw / 2 }, R: Rr, blds: my }; towns.push(t); return t;
    };

    // ----- выбор мест для поселений -----
    const wantTowns = Math.max(1, Math.round(o.towns || (S >= 90 ? 6 : S >= 60 ? 4 : 2)));
    const comp = new Int16Array(N).fill(-1), compArea = []; {
        let n = 0; for (let i = 0; i < N; i++) { if (T[i] === 2 || comp[i] >= 0) continue; const q = [i]; comp[i] = n; let a = 0; for (let h = 0; h < q.length; h++) { const u = q[h]; a++; const ux = u % W, uy = (u / W) | 0; for (const d of D4) { const nx = ux + d[0], ny = uy + d[1]; if (!inb(nx, ny)) continue; const v = idx(nx, ny); if (T[v] !== 2 && comp[v] < 0) { comp[v] = n; q.push(v); } } } compArea.push(a); n++; }
    }
    const cands = []; const rr = biome === 'isles' ? 3 : 5;
    for (let y = rr + 1; y < H - rr - 1; y += 2) for (let x = rr + 1; x < W - rr - 1; x += 2) {
        const k = T[idx(x, y)]; if (k !== 0 && k !== 7) continue; let ok = 0, tot = 0; for (let dy = -rr; dy <= rr; dy++) for (let dx = -rr; dx <= rr; dx++) { tot++; const kk = T[idx(x + dx, y + dy)]; if (kk === 0 || kk === 7 || kk === 5) ok++; }
        const sc = ok / tot; if (sc < (biome === 'isles' ? 0.62 : 0.7)) continue; const w2 = dw[idx(x, y)];
        const bonus = biome === 'desert' ? (w2 <= 7 ? 0.5 : 0) : (w2 >= 2 && w2 <= 9 ? 0.15 : 0);
        cands.push({ x, y, c: comp[idx(x, y)], sc: sc + bonus + rnd() * 0.18 });
    }
    cands.sort((a, b) => b.sc - a.sc);
    const picked = []; let minD = Math.max(14, Math.min(W, H) * 0.42);
    if (biome === 'isles') {   // по поселению на каждый крупный остров, потом — добавочные на самых больших
        const order = compArea.map((a, i) => [a, i]).filter(p => p[0] >= 45).sort((a, b) => b[0] - a[0]);
        for (const [, ci] of order) { if (picked.length >= wantTowns) break; const c = cands.find(c => c.c === ci); if (c) picked.push(c); }
        for (let pass = 0; pass < 3 && picked.length < wantTowns; pass++, minD *= 0.8) for (const c of cands) { if (picked.length >= wantTowns) break; if (picked.every(p => dist(p.x, p.y, c.x, c.y) >= minD)) picked.push(c); }
    } else for (let pass = 0; pass < 5 && picked.length < wantTowns; pass++, minD *= 0.86) for (const c of cands) { if (picked.length >= wantTowns) break; if (picked.every(p => dist(p.x, p.y, c.x, c.y) >= minD)) picked.push(c); }
    if (!picked.length && cands.length) picked.push(cands[0]);
    const townNames = (P && P.towns ? P.towns.slice() : []).concat(shuffle(tx.towns[biome].filter(n => !(P && P.towns && P.towns.indexOf(n) >= 0))));
    if (build && picked.length) {
        picked.forEach((c, i) => { const role = i === 0 ? 'cap' : i <= Math.ceil(picked.length / 3) ? 'town' : 'village'; buildTown(c, role, townNames[i] || ('Поселение ' + (i + 1))); });
        const cap = towns[0];
        // ----- особые места (для готовых карт) -----
        const tDist = (x, y) => towns.reduce((m, t) => Math.min(m, dist(x, y, t.x, t.y)), 1e9);
        const SC = {
            far: (x, y) => tDist(x, y), mid: (x, y) => -Math.abs(tDist(x, y) - 14) - (tDist(x, y) < 7 ? 50 : 0), water: (x, y) => -dw[idx(x, y)] - (tDist(x, y) < 7 ? 50 : 0), coast: (x, y) => -dw[idx(x, y)] * 3 + Math.min(tDist(x, y), 16) * 0.2,
            peak: (x, y) => E[idx(x, y)] * 100 - (tDist(x, y) < 8 ? 50 : 0), rock: (x, y) => -ds[idx(x, y)] * 2 + Math.min(tDist(x, y), 14) * 0.3, cap: (x, y) => -Math.abs(dist(x, y, cap.x, cap.y) - 13), islet: (x, y) => dw[idx(x, y)] * 0 + (comp[idx(x, y)] >= 0 && compArea[comp[idx(x, y)]] < 30 ? 100 : 0) + tDist(x, y)
        };
        const marks = [];
        for (const l of (P && P.places) || []) {
            const allow = l.where === 'peak' ? [0, 4, 5, 6, 7, 8] : l.where === 'rock' ? [0, 4, 5, 6, 7] : null, w = l.w || bldKind(l.k).w, h = l.h || bldKind(l.k).h; let best = null, bs = -1e9;
            for (const f of [SC[l.where] || SC.far, SC.far]) {   // если нужного места нет — самое дальнее от поселений
                for (let t = 0; t < 700; t++) { const bx = RI(2, W - w - 2), by = RI(2, H - h - 3); if (!fits(bx, by, w, h, allow)) continue; const s = f(bx + w / 2, by + h / 2) + rnd() * 0.5; if (s > bs) { bs = s; best = { bx, by }; } }
                if (best) break;
            }
            if (best) { const b = commit(best.bx, best.by, w, h, l.k, l.n, { e: l.e, note: l.note || '', lv: l.lv || bldKind(l.k).lv || 2, c: l.c || bldKind(l.k).c }); marks.push({ b, road: l.where !== 'islet' }); }
        }
        // ----- дороги между поселениями (A*; через воду — «мост») -----
        const COST = [1, 0.35, 9, 0.35, 2.6, 1.6, 4.5, 1.1, 7];
        const route = (ax, ay, bx, by) => {
            const g = new Float32Array(N).fill(1e9), f = new Float32Array(N), prev = new Int32Array(N).fill(-1), done = new Uint8Array(N), heap = [];
            const push = i => { heap.push(i); let c = heap.length - 1; while (c > 0) { const p = (c - 1) >> 1; if (f[heap[p]] <= f[heap[c]]) break; const t = heap[p]; heap[p] = heap[c]; heap[c] = t; c = p; } };
            const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let c = 0; for (;;) { const l = 2 * c + 1, r = l + 1; let m = c; if (l < heap.length && f[heap[l]] < f[heap[m]]) m = l; if (r < heap.length && f[heap[r]] < f[heap[m]]) m = r; if (m === c) break; const t = heap[m]; heap[m] = heap[c]; heap[c] = t; c = m; } } return top; };
            const s = idx(ax, ay), t = idx(bx, by); g[s] = 0; push(s);
            while (heap.length) {
                const u = pop(); if (done[u]) continue; done[u] = 1; if (u === t) break; const ux = u % W, uy = (u / W) | 0;
                for (const d of D4) { const nx = ux + d[0], ny = uy + d[1]; if (!inb(nx, ny)) continue; const v = idx(nx, ny); if (done[v] || (occ[v] === 1 && v !== t)) continue; const ng = g[u] + COST[T[v]] + ((Math.imul(v, 2654435761) >>> 0) / 4294967296) * 0.3; if (ng < g[v]) { g[v] = ng; prev[v] = u; f[v] = ng + (Math.abs(nx - bx) + Math.abs(ny - by)) * 0.35; push(v); } }
            }
            if (prev[t] < 0 && s !== t) return false; let water = 0; for (let v = t; v >= 0; v = prev[v]) if (T[v] === 2) water++; if (water > 16) return false;
            for (let v = t; v >= 0; v = prev[v]) if (T[v] !== 3 && occ[v] !== 1) T[v] = 1; return true;
        };
        const hx = t => Math.floor(t.hub.x), hy = t => Math.floor(t.hub.y), linked = [0];
        while (linked.length < towns.length) {   // каждое следующее поселение — к ближайшему из уже связанных
            let bi = -1, bj = -1, bd = 1e9; for (let j = 0; j < towns.length; j++) { if (linked.indexOf(j) >= 0) continue; for (const i of linked) { const d = dist(towns[i].x, towns[i].y, towns[j].x, towns[j].y); if (d < bd) { bd = d; bi = i; bj = j; } } }
            if (bj < 0) break; linked.push(bj); route(hx(towns[bi]), hy(towns[bi]), hx(towns[bj]), hy(towns[bj]));
        }
        if (towns.length >= 4) { let bi = 0, bj = 1, bd = 1e9; for (let i = 1; i < towns.length; i++) for (let j = i + 1; j < towns.length; j++) { const d = dist(towns[i].x, towns[i].y, towns[j].x, towns[j].y); if (d < bd) { bd = d; bi = i; bj = j; } } route(hx(towns[bi]), hy(towns[bi]), hx(towns[bj]), hy(towns[bj])); }
        for (const m of marks) { if (!m.road) continue; let bt = towns[0]; for (const t of towns) if (dist(t.x, t.y, m.b.x, m.b.y) < dist(bt.x, bt.y, m.b.x, m.b.y)) bt = t; const d = doors.find(d => d.b === m.b); if (d) route(d.x, d.y, hx(bt), hy(bt)); }
        // ----- поля вокруг поселений -----
        for (const t of towns) for (let k = 0, n = t.role === 'cap' ? 3 : t.role === 'town' ? 2 : 1 + RI(0, 1); k < n; k++) for (let tr = 0; tr < 70; tr++) {
            const w = RI(4, 7), h = RI(3, 5), a = rnd() * 6.283, d = R(t.R + 1, t.R + 7), fx = Math.round(t.x + Math.cos(a) * d * 1.3 - w / 2), fy = Math.round(t.y + Math.sin(a) * d - h / 2); let ok = fx > 0 && fy > 0 && fx + w < W && fy + h < H;
            for (let y = fy; y < fy + h && ok; y++) for (let x = fx; x < fx + w; x++) { const i = idx(x, y); if (occ[i] || !(T[i] === 0 || (T[i] === 7 && dw[i] <= 5))) { ok = false; break; } }
            if (ok) { for (let y = fy; y < fy + h; y++) for (let x = fx; x < fx + w; x++) T[idx(x, y)] = 5; break; }
        }
    }

    // ===== 3. Декор =====
    const addD = (e, x, y) => { dec[idx(x, y)] = 1; items.push({ id: uid('dc'), t: 'd', x, y, e }); };
    const scatter = (e, n, okFn) => { for (let t = 0, c = 0; t < n * 14 && c < n; t++) { const x = RI(1, W - 2), y = RI(1, H - 2), i = idx(x, y); if (occ[i] || dec[i] || !okFn(T[i], x, y, i)) continue; addD(e, x, y); c++; } };
    const A = W * H, ground = k => k === 0 || k === 7, grass = k => k === 0;
    if (biome === 'land') { scatter('🌳', A / 55, k => grass(k)); scatter('🌸', A / 160, k => grass(k)); scatter('🪨', A / 220, k => grass(k)); scatter('🐄', 3, (k, x, y) => grass(k) && ds[idx(x, y)] > 5); scatter('🐎', 2, k => grass(k)); scatter('⛺', 1, (k, x, y) => grass(k) && towns.every(t => dist(x, y, t.x, t.y) > 10)); }
    else if (biome === 'desert') { scatter('🌵', A / 45, k => k === 7); scatter('🌴', A / 110, (k, x, y, i) => k === 0 && dw[i] <= 4); scatter('🪨', A / 160, (k, x, y, i) => k === 7 && ds[i] <= 4); scatter('🏺', 4, k => k === 7); scatter('🪦', 3, (k, x, y) => k === 7 && towns.every(t => dist(x, y, t.x, t.y) > 12)); scatter('⛺', 3, (k, x, y) => k === 7 && towns.every(t => dist(x, y, t.x, t.y) > 9)); scatter('🔥', 1, (k, x, y) => k === 7 && towns.every(t => dist(x, y, t.x, t.y) > 9)); }
    else if (biome === 'mount') { scatter('🌲', A / 70, (k, x, y, i) => grass(k) && ds[i] <= 8); scatter('🪨', A / 90, (k, x, y, i) => (grass(k) || k === 6) && ds[i] <= 3); scatter('🚩', 3, (k, x, y) => grass(k) && towns.every(t => dist(x, y, t.x, t.y) > 6)); scatter('⛺', 2, (k, x, y) => grass(k) && towns.every(t => dist(x, y, t.x, t.y) > 10)); scatter('🔥', 1, (k, x, y) => grass(k) && towns.every(t => dist(x, y, t.x, t.y) > 10)); scatter('🐎', 2, k => grass(k)); }
    else { scatter('🌴', A / 38, (k, x, y, i) => ground(k) && dw[i] <= 3); scatter('🪨', A / 120, (k, x, y, i) => k === 7 && dw[i] <= 2); scatter('🪵', 4, (k, x, y, i) => k === 7 && dw[i] === 1); scatter('🌳', A / 130, k => grass(k)); scatter('⛺', 2, (k, x, y, i) => k === 7 && dw[i] <= 3 && towns.every(t => dist(x, y, t.x, t.y) > 9)); scatter('🔥', 1, (k, x, y, i) => k === 7 && dw[i] <= 3 && towns.every(t => dist(x, y, t.x, t.y) > 9)); }
    return { w: W, h: H, tiles: T, items, hub: towns[0] ? towns[0].hub : { x: W / 2, y: H / 2 }, towns: towns.map(t => ({ n: t.name, role: t.role, x: t.x, y: t.y })), seed, biome };
}

// ---------- Готовые карты ----------
const DND_GEN_PRESETS = [
    {
        id: 'desert', n: 'Пустынное царство', biome: 'desert', w: 80, h: 56, seed: 102, count: 5, e: '🏜️',
        info: 'Султанат среди дюн: оазисы, караванные дороги, столица на реке, забытые гробницы.',
        castle: 'Дворец Султана', market: 'Великий Базар', temple: 'Храм Трёх Солнц', towns: ['Аль-Захир', 'Оазис Мираж', 'Бир-Зайн', 'Рас-Халиль', 'Дар-Фарух'],
        places: [
            { k: 'temple', e: '🔺', n: 'Пирамида Забытого Царя', w: 5, h: 5, lv: 3, where: 'far', note: 'Древняя усыпальница в песках. Внутри — ловушки и проклятое золото. Жрецы Аль-Захира запрещают туда ходить.' },
            { k: 'inn', e: '🐪', n: 'Караван-сарай «Последний Колодец»', where: 'mid', note: 'Здесь останавливаются караваны. Воду продают по цене серебра.' },
            { k: 'dungeon', e: '💀', n: 'Гробницы Песчаных Царей', where: 'rock', note: 'Подземные залы под красной скалой. Говорят, мумии здесь встают по ночам.' },
            { k: 'tower', e: '🗼', n: 'Башня Песчаных Стражей', where: 'rock', note: 'Дозорный пост на скале: отсюда виден каждый караван на сутки пути.' }
        ]
    },
    {
        id: 'mount', n: 'Королевство Горного Грифона', biome: 'mount', w: 80, h: 56, seed: 203, count: 4, e: '🏔️',
        info: 'Горная страна: заснеженные хребты, долины с деревнями, серебряные рудники и крепость на скале.',
        castle: 'Крепость Грифона', market: 'Торжище', temple: 'Храм Ветров', towns: ['Грифонов Утёс', 'Ветрогорск', 'Серебряный Рудник', 'Ледяной Перевал'],
        places: [
            { k: 'temple', e: '🦅', n: 'Святилище Грифона', where: 'peak', w: 4, h: 4, lv: 3, note: 'Гнездо священных грифонов. Король приходит сюда раз в год за благословением. Чужаков стража не пускает.' },
            { k: 'dungeon', e: '⛏️', n: 'Рудники Серебряного Клыка', where: 'rock', note: 'Богатая жила серебра. Нижние штольни закрыты после обвала: оттуда доносится стук.' },
            { k: 'tower', e: '🗼', n: 'Башня Ветров', where: 'peak', w: 2, h: 2, lv: 4, note: 'Сторожевая башня на высоком перевале. Зажжённый на ней огонь зовёт гарнизон на помощь.' },
            { k: 'gate', e: '🚪', n: 'Врата Перевала', where: 'rock', w: 3, h: 1, lv: 3, note: 'Единственный проход через хребет для обозов. Пошлина — два серебряных за телегу.' }
        ]
    },
    {
        id: 'isles', n: 'Островные царства', biome: 'isles', w: 90, h: 60, seed: 302, count: 5, e: '🏝️',
        info: 'Архипелаг: большой остров с портом-столицей, малые острова с деревнями, маяк и тайная бухта пиратов.',
        castle: 'Крепость Прилива', market: 'Рыбный рынок', temple: 'Храм Приливов', towns: ['Пенный Порт', 'Коралловая Бухта', 'Маяк Гулль', 'Соляной Мыс', 'Чаячий Остров'],
        places: [
            { k: 'tower', e: '🗼', n: 'Маяк Гулль', where: 'coast', w: 2, h: 2, lv: 4, note: 'Белый маяк указывает путь кораблям. Смотритель держит под замком старый сундук.' },
            { k: 'smithy', e: '⚓', n: 'Верфь Пенного Порта', where: 'coast', w: 4, h: 3, note: 'Здесь строят быстрые шхуны. Мастер ищет смелых для пробного рейса.' },
            { k: 'dungeon', e: '🏴‍☠️', n: 'Тайная бухта пиратов', where: 'islet', note: 'Скрытая стоянка на безлюдном островке. Вход в пещеру виден только в отлив.' }
        ]
    }
];

// Маленькая картинка карты для выбора (1 клетка = 1 точка, растягивается стилями)
function dndGenPreview(cv, res) {
    cv.width = res.w; cv.height = res.h; const x = cv.getContext('2d'); x.imageSmoothingEnabled = false;
    for (let j = 0; j < res.h; j++) for (let i = 0; i < res.w; i++) { x.fillStyle = DND_TILE_COL[res.tiles[j * res.w + i]] || DND_TILE_COL[0]; x.fillRect(i, j, 1, 1); }
    for (const b of res.items) if (b.t === 'b') { x.fillStyle = b.k === 'castle' ? '#4a3f66' : '#7a5a3a'; x.fillRect(b.x, b.y, b.w, b.h); }
}
