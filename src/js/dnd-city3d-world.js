'use strict';
// =====================================================================================================
// iLife 2.4.0 — «ДНД» → «ВИЖУАЛ» → «3D-КАРТА» (часть 1 из 2): модели и сборка мира из карты города.
//   Здесь нет ни рисования на экран, ни управления — только геометрия: функция c3World(city, g, q) читает карту
//   (game.city: tiles, items) и возвращает куски местности (chunks по 8×8 клеток), воду, светящиеся детали, подписи,
//   героев и «карту препятствий» для прогулки. Экран, камера, управление и настройки графики — в js/dnd-city3d.js.
//   МАСШТАБ: одна клетка карты = 1 единица мира ≈ 3 метра; этаж здания = 1 единица, рост человека ≈ 0,58, глаза ≈ 0,53.
//   Оси: x — вправо по карте, z — вниз по карте (север карты = −z), y — вверх.
//   МОДЕЛИ — бесплатные наборы Kenney «Fantasy Town Kit» и «Castle Kit» (лицензия CC0, www.kenney.nl),
//   упакованные tools/make-3d-pack.cjs в assets/3d/town.bin: цвета «запечены» в вершины, текстур нет.
//   Крыши, земля, вода, фонари, фигуры героев и животные строятся программно (цвет крыши = цвет здания на карте).
// =====================================================================================================

const C3 = { LIB: 'assets/3d/three.min.js', JSON: 'assets/3d/town.json', BIN: 'assets/3d/town.bin', CH: 8 };
let c3Pack = null, c3Loading = null;

// ---------- Загрузка библиотеки и моделей (только при первом включении 3D; потом лежит в кэше приложения) ----------
function c3Load() {
    if (c3Pack) return Promise.resolve();
    if (c3Loading) return c3Loading;
    const ver = '?v=' + (typeof APP_VERSION !== 'undefined' ? APP_VERSION : '');
    const lib = window.THREE ? Promise.resolve() : new Promise((ok, no) => { const s = document.createElement('script'); s.src = C3.LIB + ver; s.onload = ok; s.onerror = () => no(new Error('Не загрузилась библиотека 3D')); document.head.appendChild(s); });
    const get = (u, t) => fetch(u + ver).then(r => { if (!r.ok) throw new Error('Не загрузился файл ' + u); return t === 'j' ? r.json() : r.arrayBuffer(); });
    c3Loading = Promise.all([lib, get(C3.JSON, 'j'), get(C3.BIN, 'b')]).then(r => { c3Pack = c3Decode(r[1], r[2]); }).catch(e => { c3Loading = null; throw e; });
    return c3Loading;
}
function c3Decode(J, B) {
    const pos = new Int16Array(B, J.off.pos, J.verts * 3), nor = new Int8Array(B, J.off.nor, J.verts * 3), col = new Uint8Array(B, J.off.col, J.verts * 3), idx = new Uint16Array(B, J.off.idx, J.indices);
    const lut = new Float32Array(256); for (let i = 0; i < 256; i++) { const c = i / 255; lut[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }   // sRGB → линейный
    const cache = {};
    return {
        has: n => !!J.models[n],
        get(name) {
            if (name in cache) return cache[name];
            const m = J.models[name]; if (!m) return (cache[name] = null);
            const n3 = m.n * 3, p = new Float32Array(n3), nn = new Float32Array(n3), c = new Float32Array(n3);
            for (let k = 0; k < n3; k++) { p[k] = pos[m.v * 3 + k] / J.posScale; nn[k] = nor[m.v * 3 + k] / 127; c[k] = lut[col[m.v * 3 + k]]; }
            return (cache[name] = { p, n: nn, c, i: idx.subarray(m.i, m.i + m.m), b: m.b });
        }
    };
}

// ---------- Цвета ----------
const c3Lin = h => { const n = parseInt(String(h).replace('#', ''), 16) || 0, f = v => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return [f(n >> 16), f((n >> 8) & 255), f(n & 255)]; };
const c3Mul = (c, k) => [c[0] * k, c[1] * k, c[2] * k];
const c3Mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
function c3Hsl(h, s, l) {   // h 0–360, s, l 0–1 → линейный RGB
    const a = s * Math.min(l, 1 - l), f = n => { const k = (n + h / 30) % 12; return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)); };
    const to = v => v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); return [to(f(0)), to(f(8)), to(f(4))];
}
// Детерминированный «случайный» ноль–единица для клетки: карта всегда выглядит одинаково
function c3Hash(x, y, k) { let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(k | 0, 1274126177)) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }

// ---------- Копилка треугольников ----------
class C3Mesh {
    constructor() { this.p = []; this.n = []; this.c = []; this.i = []; this.v = 0; }
    get empty() { return !this.v; }
    // готовая модель из набора: позиция, поворот вокруг вертикали (рад), масштаб
    piece(name, x, y, z, ry, sx, sy, sz) {
        const m = c3Pack && c3Pack.get(name); if (!m) return; if (sx == null) sx = 1; if (sy == null) sy = sx; if (sz == null) sz = sx;
        const cs = Math.cos(ry || 0), sn = Math.sin(ry || 0), P = m.p, N = m.n, C = m.c, v0 = this.v, p = this.p, n = this.n, c = this.c;
        for (let k = 0; k < P.length; k += 3) {
            const px = P[k] * sx, py = P[k + 1] * sy, pz = P[k + 2] * sz;
            p.push(x + px * cs + pz * sn, y + py, z - px * sn + pz * cs);
            const nx = N[k], nz = N[k + 2]; n.push(nx * cs + nz * sn, N[k + 1], -nx * sn + nz * cs);
            c.push(C[k], C[k + 1], C[k + 2]);
        }
        const I = m.i; for (let k = 0; k < I.length; k++) this.i.push(I[k] + v0); this.v += P.length / 3;
    }
    // четырёхугольник a,b,c,d — против часовой стрелки, если смотреть снаружи; цвета углов можно задать отдельно
    quad(a, b, c, d, ca, cb, cc, cd) {
        const ux = c[0] - a[0], uy = c[1] - a[1], uz = c[2] - a[2], vx = d[0] - b[0], vy = d[1] - b[1], vz = d[2] - b[2];   // диагонали
        let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx; const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
        const v = this.v, P = [a, b, c, d], Cs = [ca, cb || ca, cc || ca, cd || ca];
        for (let k = 0; k < 4; k++) { this.p.push(P[k][0], P[k][1], P[k][2]); this.n.push(nx, ny, nz); this.c.push(Cs[k][0], Cs[k][1], Cs[k][2]); }
        this.i.push(v, v + 1, v + 2, v, v + 2, v + 3); this.v += 4;
    }
    tri(a, b, c, col) {
        const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
        let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx; const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
        const v = this.v; for (const q of [a, b, c]) { this.p.push(q[0], q[1], q[2]); this.n.push(nx, ny, nz); this.c.push(col[0], col[1], col[2]); }
        this.i.push(v, v + 1, v + 2); this.v += 3;
    }
    // коробка; sides — какие грани не рисовать: 'b' низ, 't' верх
    box(x0, y0, z0, x1, y1, z1, col, skip) {
        skip = skip || '';
        if (skip.indexOf('t') < 0) this.quad([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], col);
        if (skip.indexOf('b') < 0) this.quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], col);
        const sh = c3Mul(col, 0.86), sd = c3Mul(col, 0.74);
        this.quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], col);
        this.quad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], sh);
        this.quad([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], sd);
        this.quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], sd);
    }
    // конус (крыша круглой башни, ель) и цилиндр
    cone(cx, y, cz, r, h, seg, col, col2) {
        for (let k = 0; k < seg; k++) {
            const a0 = k / seg * Math.PI * 2, a1 = (k + 1) / seg * Math.PI * 2;
            this.tri([cx + Math.cos(a1) * r, y, cz + Math.sin(a1) * r], [cx + Math.cos(a0) * r, y, cz + Math.sin(a0) * r], [cx, y + h, cz], k % 2 && col2 ? col2 : col);
        }
    }
    cyl(cx, y0, cz, r, h, seg, col, capCol) {
        for (let k = 0; k < seg; k++) {
            const a0 = k / seg * Math.PI * 2, a1 = (k + 1) / seg * Math.PI * 2, x0 = cx + Math.cos(a0) * r, z0 = cz + Math.sin(a0) * r, x1 = cx + Math.cos(a1) * r, z1 = cz + Math.sin(a1) * r;
            this.quad([x1, y0, z1], [x0, y0, z0], [x0, y0 + h, z0], [x1, y0 + h, z1], k % 2 ? c3Mul(col, 0.93) : col);
            if (capCol) this.tri([cx, y0 + h, cz], [x1, y0 + h, z1], [x0, y0 + h, z0], capCol);
        }
    }
    sphere(cx, cy, cz, r, col, seg) {   // лёгкий «шар»: seg вокруг, seg/2 по высоте
        seg = seg || 8; const rings = Math.max(3, seg >> 1);
        const pt = (i, j) => { const a = j / seg * Math.PI * 2, b = i / rings * Math.PI; return [cx + Math.cos(a) * Math.sin(b) * r, cy + Math.cos(b) * r, cz + Math.sin(a) * Math.sin(b) * r]; };
        for (let i = 0; i < rings; i++) for (let j = 0; j < seg; j++) {
            const a = pt(i, j), b = pt(i + 1, j), c = pt(i + 1, j + 1), d = pt(i, j + 1);
            if (i === 0) this.tri(a, b, c, col); else if (i === rings - 1) this.tri(a, b, d, col); else this.quad(a, b, c, d, col);
        }
    }
    // ----- крыши. u — вдоль конька, v — поперёк; alongX = конёк идёт по оси x -----
    _roofKit(alongX) {
        return {
            P: (u, y, v) => alongX ? [u, y, v] : [v, y, u],
            Q: (a, b, c, d, cl) => alongX ? this.quad(a, b, c, d, cl) : this.quad(a, d, c, b, cl),   // оси поменяны местами — обход меняется
        };
    }
    // скат из полос разной яркости (имитация черепицы): a — край карниза слева, b — конёк слева, c — конёк справа, d — край карниза справа
    _slope(Q, a, b, c, d, col, n) {
        const L = (p, q, t) => [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t, p[2] + (q[2] - p[2]) * t];
        for (let k = 0; k < n; k++) { const t0 = k / n, t1 = (k + 1) / n; Q(L(a, b, t0), L(a, b, t1), L(d, c, t1), L(d, c, t0), k % 2 ? c3Mul(col, 0.9) : col); }
    }
    gable(x0, z0, x1, z1, y, hr, col, gcol, e, alongX) {
        const { P, Q } = this._roofKit(alongX), u0 = alongX ? x0 : z0, u1 = alongX ? x1 : z1, v0 = alongX ? z0 : x0, v1 = alongX ? z1 : x1, vc = (v0 + v1) / 2, s = hr / ((v1 - v0) / 2), yE = y - s * e, yR = y + hr;
        this._slope(Q, P(u0 - e, yE, v0 - e), P(u0 - e, yR, vc), P(u1 + e, yR, vc), P(u1 + e, yE, v0 - e), col, 4);
        this._slope(Q, P(u1 + e, yE, v1 + e), P(u1 + e, yR, vc), P(u0 - e, yR, vc), P(u0 - e, yE, v1 + e), col, 4);
        const T = (a, b, c) => alongX ? this.tri(a, b, c, gcol) : this.tri(a, c, b, gcol);
        T(P(u0, y, v0), P(u0, y, v1), P(u0, yR, vc)); T(P(u1, y, v1), P(u1, y, v0), P(u1, yR, vc));
        Q(P(u0 - e, yE, v0 - e), P(u1 + e, yE, v0 - e), P(u1 + e, yE, v1 + e), P(u0 - e, yE, v1 + e), c3Mul(col, 0.45));   // подбой карниза
        const cap = c3Mul(col, 1.18), r = 0.045;   // коньковая планка
        if (alongX) this.box(u0 - e, yR - 0.01, vc - r, u1 + e, yR + r, vc + r, cap); else this.box(vc - r, yR - 0.01, u0 - e, vc + r, yR + r, u1 + e, cap);
    }
    hip(x0, z0, x1, z1, y, hr, col, e) {
        const alongX = (x1 - x0) >= (z1 - z0), { P, Q } = this._roofKit(alongX), u0 = alongX ? x0 : z0, u1 = alongX ? x1 : z1, v0 = alongX ? z0 : x0, v1 = alongX ? z1 : x1, vc = (v0 + v1) / 2, span = v1 - v0;
        const ua = Math.min((u0 + u1) / 2, u0 + span / 2), ub = Math.max((u0 + u1) / 2, u1 - span / 2), s = hr / (span / 2), yE = y - s * e, yR = y + hr;
        this._slope(Q, P(u0 - e, yE, v0 - e), P(ua, yR, vc), P(ub, yR, vc), P(u1 + e, yE, v0 - e), col, 4);
        this._slope(Q, P(u1 + e, yE, v1 + e), P(ub, yR, vc), P(ua, yR, vc), P(u0 - e, yE, v1 + e), col, 4);
        this._slope(Q, P(u0 - e, yE, v1 + e), P(ua, yR, vc), P(ua, yR, vc), P(u0 - e, yE, v0 - e), c3Mul(col, 0.92), 3);
        this._slope(Q, P(u1 + e, yE, v0 - e), P(ub, yR, vc), P(ub, yR, vc), P(u1 + e, yE, v1 + e), c3Mul(col, 0.92), 3);
        Q(P(u0 - e, yE, v0 - e), P(u1 + e, yE, v0 - e), P(u1 + e, yE, v1 + e), P(u0 - e, yE, v1 + e), c3Mul(col, 0.45));
    }
    // чтобы создать three-геометрию из накопленного
    arrays() { return { p: new Float32Array(this.p), n: new Float32Array(this.n), c: new Float32Array(this.c), i: this.v > 65535 ? new Uint32Array(this.i) : new Uint16Array(this.i) }; }
}

// ---------- Здания ----------
const C3_WOOD = '#a9643f', C3_STONE = '#9fa4c4';
const C3_SIDES = { S: [0, 1, -Math.PI / 2], N: [0, -1, Math.PI / 2], E: [1, 0, 0], W: [-1, 0, Math.PI] };   // куда смотрит стена; поворот вокруг вертикали
const C3_STYLE = {
    wood: { wall: 'wall-wood', door: 'wall-wood-door', win: ['wall-wood-window-glass', 'wall-wood-window-shutters'], plain: ['wall-wood', 'wall-wood-detail-cross'] },
    stone: { wall: 'wall', door: 'wall-door', win: ['wall-window-glass', 'wall-window-shutters', 'wall-window-small'], plain: ['wall', 'wall'] }
};
// Оболочка здания из стеновых модулей Kenney: по клетке на каждую сторону и этаж, дверь — по центру южной стороны
function c3Shell(m, b, st, fl, o) {
    o = o || {}; const S = C3_STYLE[st], w = b.w, h = b.h, doorI = o.doorI != null ? o.doorI : Math.floor((w - 1) / 2);
    const one = (side, i, f, cx, cz) => {
        let nm;
        if (f === 0 && side === 'S' && i === doorI && !o.noDoor) nm = S.door;
        else if (o.round && f === 0 && side !== 'S') nm = (i + f) % 2 ? 'wall-window-round' : S.wall;
        else if ((i + f + (side === 'S' || side === 'N' ? 0 : 1)) % 2 === 0) nm = S.win[Math.floor(c3Hash(b.x + i, b.y + f, side.charCodeAt(0)) * S.win.length)];
        else nm = S.plain[c3Hash(b.x + i * 3, b.y + f, 7) < 0.25 ? 1 : 0];
        if (o.round && f > 0 && nm !== S.door) nm = (i + f) % 2 === 0 ? 'wall-window-round' : S.wall;
        m.piece(nm, cx, f, cz, C3_SIDES[side][2], 1);
    };
    for (let f = 0; f < fl; f++) {
        for (let i = 0; i < w; i++) { one('S', i, f, b.x + i + 0.5, b.y + h - 0.5); one('N', i, f, b.x + i + 0.5, b.y + 0.5); }
        for (let j = 0; j < h; j++) { one('E', j, f, b.x + w - 0.5, b.y + j + 0.5); one('W', j, f, b.x + 0.5, b.y + j + 0.5); }
    }
}
// Деревья и камни
const C3_TREES = ['tree', 'tree-high', 'tree-high-round', 'tree-crooked', 'tree-high-crooked'];
function c3Tree(X, m, x, z, s, variant, rot) {
    if (X.q.kit) m.piece(C3_TREES[variant % C3_TREES.length], x, 0, z, rot, s);
    else {   // простое дерево для слабых телефонов: ствол и два конуса (≈ 36 треугольников)
        const g = c3Hsl(100 + variant * 9, 0.38, 0.28 + (variant % 3) * 0.03), g2 = c3Mul(g, 1.12);
        m.cyl(x, 0, z, 0.05 * s, 0.5 * s, 4, c3Lin('#7a5230'));
        m.cone(x, 0.3 * s, z, 0.46 * s, 0.95 * s, 6, g, g2); m.cone(x, 0.85 * s, z, 0.34 * s, 0.85 * s, 6, g2, g);
    }
    X.circle(x, z, 0.13 * s);
}
function c3Rock(X, m, x, z, s, rot, solid) {
    const n = ['rock-large', 'rock-wide', 'rock-small'][Math.floor(c3Hash(x * 7, z * 9, 3) * 3)];
    if (c3Pack.has(n)) m.piece(n, x, 0, z, rot, s); else m.box(x - 0.3 * s, 0, z - 0.3 * s, x + 0.3 * s, 0.5 * s, z + 0.3 * s, c3Lin('#8b8997'));
    if (solid !== false) X.circle(x, z, 0.42 * s);
}
// Домашние животные и жетоны героев: простые фигуры из коробок
function c3Animal(X, m, x, z, rot, horse) {
    rot = Math.round(rot / (Math.PI / 2)) * Math.PI / 2;   // коробки выровнены по осям — поворачиваем только на прямой угол
    const cs = Math.cos(rot), sn = Math.sin(rot), P = (dx, dz) => [x + dx * cs + dz * sn, z - dx * sn + dz * cs];
    const body = horse ? c3Lin('#8a5a35') : c3Lin('#f0ece4'), spot = horse ? c3Lin('#3b2a1c') : c3Lin('#2f2c33'), L = horse ? 0.4 : 0.36, Hh = horse ? 0.34 : 0.27, W = 0.14;
    const bx = (dx0, dz0, dx1, dz1, y0, y1, col) => { const a = P(dx0, dz0), b = P(dx1, dz1); m.box(Math.min(a[0], b[0]), y0, Math.min(a[1], b[1]), Math.max(a[0], b[0]), y1, Math.max(a[1], b[1]), col); };
    bx(-L, -W, L, W, Hh - 0.14, Hh + 0.1, body);
    bx(L - 0.02, -0.07, L + 0.2, 0.07, Hh + 0.02, Hh + 0.2, horse ? body : spot);
    for (const [dx, dz] of [[-L + 0.06, -W + 0.04], [-L + 0.06, W - 0.04], [L - 0.06, -W + 0.04], [L - 0.06, W - 0.04]]) bx(dx - 0.03, dz - 0.03, dx + 0.03, dz + 0.03, 0, Hh - 0.14, horse ? spot : body);
    if (!horse) bx(-0.1, -W - 0.005, 0.1, W + 0.005, Hh - 0.1, Hh + 0.06, spot);
    X.circle(x, z, 0.36);
}
function c3Person(m, x, z, hue, rot) {
    const cs = Math.cos(rot), sn = Math.sin(rot), col = c3Hsl(hue, 0.55, 0.42), skin = c3Lin('#e8c4a0');
    m.cyl(x, 0.02, z, 0.085, 0.3, 7, col); m.cone(x, 0.3, z, 0.085, 0.1, 7, col);   // плащ
    m.sphere(x, 0.43, z, 0.065, skin, 8);
    m.box(x - 0.1, 0.28, z - 0.025, x - 0.07, 0.4, z + 0.025, c3Mul(col, 0.85)); m.box(x + 0.07, 0.28, z - 0.025, x + 0.1, 0.4, z + 0.025, c3Mul(col, 0.85));
}

// Одно здание карты → модели в нужном «куске» местности. Возвращает высоту (для подписи).
function c3Bld(X, b) {
    const kd = bldKind(b.k), x0 = b.x, z0 = b.y, w = b.w, h = b.h, fl = Math.max(1, Math.min(5, Math.round(b.lv || kd.lv || 2))), cx = x0 + w / 2, cz = z0 + h / 2, m = X.mAt(cx, cz);
    const roofC = c3Mul(c3Lin(b.c || kd.c), 0.92), wood = c3Lin(C3_WOOD), stone = c3Lin(C3_STONE), alongX = w >= h, k = b.k;
    X.mark(x0, z0, w, h, 1);
    m.box(x0 - 0.06, 0, z0 - 0.06, x0 + w + 0.06, 0.06, z0 + h + 0.06, c3Lin('#9a98a6'), 'b');   // фундамент
    const dx = x0 + Math.floor((w - 1) / 2) + 0.5, dz = z0 + h;   // перед дверью
    const slab = () => m.box(dx - 0.28, 0, dz, dx + 0.28, 0.035, dz + 0.4, c3Lin('#b9b6c4'), 'b');
    const chimney = (u, v, y) => m.piece('chimney', (alongX ? u : v) - 0.32, y, alongX ? v : u, 0, 1);
    const lamp = (x, z, s) => { m.piece('lantern', x, 0, z, 0, s); X.glow.sphere(x, 1.38 * s, z, 0.045 * s * 1.6, c3Lin('#ffd98a'), 6); };
    let top = fl, hr;
    switch (k) {
        case 'tower': {   // башня: каменные кубы по клеткам, острая крыша
            for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
                const px = x0 + i + 0.5, pz = z0 + j + 0.5; m.piece('c.tower-square-base', px, 0, pz, 0, 1);
                for (let f = 1; f < fl; f++) m.piece((f + i + j) % 2 ? 'c.tower-square-mid-windows' : 'c.tower-square-mid', px, f, pz, ((i + j) % 2) * Math.PI / 2, 1);
                m.piece('c.tower-square-top', px, fl, pz, 0, 1);
            }
            top = fl + 0.3; hr = Math.min(w, h) * 1.1; m.hip(x0 - 0.05, z0 - 0.05, x0 + w + 0.05, z0 + h + 0.05, top, hr, roofC, 0.12); top += hr; break;
        }
        case 'castle': {  // замок: кольцо стен, угловые башни, ворота, главная башня
            const wallH = Math.max(2, fl - 1);
            for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
                const ring = i === 0 || j === 0 || i === w - 1 || j === h - 1; if (!ring) continue;
                const px = x0 + i + 0.5, pz = z0 + j + 0.5, corner = (i === 0 || i === w - 1) && (j === 0 || j === h - 1), gate = j === h - 1 && i === Math.floor(w / 2);
                if (gate) { m.piece('c.bridge-straight', px, 0, pz, 0, 1); for (let f = 1; f < wallH; f++) m.piece('c.tower-square-mid', px, f + 0.18, pz, 0, 1); m.piece('c.tower-square-top', px, wallH + 0.18, pz, 0, 1); X.mark(Math.floor(px), Math.floor(pz), 1, 1, 0); continue; }
                const hh = corner ? wallH + 1 : wallH; m.piece('c.tower-square-base', px, 0, pz, 0, 1);
                for (let f = 1; f < hh; f++) m.piece((f + i + j) % 3 === 0 ? 'c.tower-square-mid-windows' : 'c.tower-square-mid', px, f, pz, ((i + j) % 2) * Math.PI / 2, 1);
                m.piece('c.tower-square-top', px, hh, pz, 0, 1);
                if (corner) m.hip(px - 0.55, pz - 0.55, px + 0.55, pz + 0.55, hh + 0.3, 1.25, roofC, 0.08);
            }
            const kw = Math.min(2, w - 2), kh = Math.min(2, h - 2);   // главная башня в глубине двора
            if (kw >= 1 && kh >= 1) {
                const kx = x0 + Math.floor((w - kw) / 2), kz = z0 + 1; const kf = fl + 1;
                for (let j = 0; j < kh; j++) for (let i = 0; i < kw; i++) { const px = kx + i + 0.5, pz = kz + j + 0.5; m.piece('c.tower-square-base', px, 0, pz, 0, 1); for (let f = 1; f < kf; f++) m.piece((f + i + j) % 2 ? 'c.tower-square-mid-windows' : 'c.tower-square-mid', px, f, pz, ((i + j) % 2) * Math.PI / 2, 1); m.piece('c.tower-square-top', px, kf, pz, 0, 1); }
                m.hip(kx - 0.05, kz - 0.05, kx + kw + 0.05, kz + kh + 0.05, kf + 0.3, kw * 1.3, roofC, 0.12); top = kf + 0.3 + kw * 1.3;
                // двор: плиты
                for (let j = 1; j < h - 1; j++) for (let i = 1; i < w - 1; i++) if (!(i >= kx - x0 && i < kx - x0 + kw && j >= kz - z0 && j < kz - z0 + kh)) { m.quad([x0 + i, 0.03, z0 + j + 1], [x0 + i + 1, 0.03, z0 + j + 1], [x0 + i + 1, 0.03, z0 + j], [x0 + i, 0.03, z0 + j], c3Lin((i + j) % 2 ? '#b8b4c0' : '#c4c0cc')); X.mark(x0 + i, z0 + j, 1, 1, 0); }
                X.mark(kx, kz, kw, kh, 1);
            } else top = wallH + 1.3;
            break;
        }
        case 'gate': {    // ворота: две башни и арка между ними
            for (let i = 0; i < w; i++) for (let j = 0; j < h; j++) {
                const px = x0 + i + 0.5, pz = z0 + j + 0.5, mid = i === Math.floor(w / 2) && w >= 3;
                if (mid) { m.piece('c.bridge-straight', px, 0, pz, alongX ? Math.PI / 2 : 0, 1); for (let f = 1; f < fl - 1; f++) m.piece('c.tower-square-mid', px, f + 0.18, pz, 0, 1); m.piece('c.tower-square-top', px, fl - 1 + 0.18, pz, 0, 1); X.mark(Math.floor(px), Math.floor(pz), 1, 1, 0); continue; }
                m.piece('c.tower-square-base', px, 0, pz, 0, 1); for (let f = 1; f < fl; f++) m.piece(f % 2 ? 'c.tower-square-mid-windows' : 'c.tower-square-mid', px, f, pz, 0, 1); m.piece('c.tower-square-top', px, fl, pz, 0, 1);
            }
            top = fl + 0.3; break;
        }
        case 'dungeon': { // подземелье: скалы и каменный вход
            const sx = Math.min(w, h) / 3;
            m.piece('rock-large', cx, 0, cz - 0.2, 0.4, 1.7 * sx); m.piece('rock-wide', cx - 1, 0, cz - 0.4, 2, 1.3 * sx); m.piece('rock-small', cx + 1, 0, cz - 0.3, 4, 1.4 * sx); m.piece('rock-large', cx + 0.9, 0, cz + 0.2, 1, 0.9 * sx); m.piece('rock-wide', cx - 0.9, 0, cz + 0.3, 5, 0.8 * sx);
            m.piece('wall-doorway-round', dx, 0, z0 + h - 0.5, -Math.PI / 2, 1); m.box(dx - 0.28, 0, z0 + h - 0.45, dx + 0.28, 0.9, z0 + h - 0.36, c3Lin('#2a2530'));
            top = 2.2 * sx; break;
        }
        case 'market': {  // рынок: плиты и прилавки
            X.mark(x0, z0, w, h, 0);
            for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) m.quad([x0 + i, 0.025, z0 + j + 1], [x0 + i + 1, 0.025, z0 + j + 1], [x0 + i + 1, 0.025, z0 + j], [x0 + i, 0.025, z0 + j], c3Lin((i + j) % 2 ? '#e0d4b6' : '#d6c9a8'));
            for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
                const px = x0 + i + 0.5, pz = z0 + j + 0.5, ring = i === 0 || j === 0 || i === w - 1 || j === h - 1;
                if (ring && (i + j) % 2 === 0 && !(j === h - 1 && i === Math.floor((w - 1) / 2))) { m.piece(['stall-red', 'stall-green', 'stall-red'][(i + j >> 1) % 3], px, 0, pz, j === 0 ? Math.PI : j === h - 1 ? 0 : i === 0 ? Math.PI / 2 : -Math.PI / 2, 1); X.mark(x0 + i, z0 + j, 1, 1, 1); }
                else if (!ring && (i + j) % 3 === 0 && w > 2 && h > 2) { m.piece(c3Hash(i, j, 4) < 0.5 ? 'cart' : 'stall-bench', px, 0, pz, c3Hash(i, j, 5) * 6, 1); X.circle(px, pz, 0.4); }
            }
            top = 1.3; break;
        }
        case 'temple': {  // храм: каменный зал, высокая крыша и колокольня
            c3Shell(m, b, 'stone', fl, { round: true }); slab();
            hr = Math.min(w, h) / 2 * 1.05; m.gable(x0, z0, x0 + w, z0 + h, fl, hr, roofC, stone, 0.2, alongX);
            const tx = x0 + w - 1, tz = z0, tf = fl + 2;   // колокольня в углу
            c3Shell(m, { x: tx, y: tz, w: 1, h: 1 }, 'stone', tf, { noDoor: true, round: true });
            m.hip(tx - 0.12, tz - 0.12, tx + 1.12, tz + 1.12, tf, 1.7, c3Mul(roofC, 0.8), 0.12); top = tf + 1.7; break;
        }
        case 'guild': {   // гильдия: каменная, шатровая крыша, знамёна
            c3Shell(m, b, 'stone', fl, {}); slab();
            hr = Math.min(w, h) / 2 * 0.9; m.hip(x0, z0, x0 + w, z0 + h, fl, hr, roofC, 0.2); top = fl + hr;
            for (const sx of [-1.2, 1.2]) if (dx + sx > x0 + 0.5 && dx + sx < x0 + w - 0.3) m.piece(sx < 0 ? 'banner-red' : 'banner-green', dx + sx, 0.25, z0 + h + 0.1, -Math.PI / 2, 1);
            break;
        }
        case 'smithy': {  // кузница: камень, низкая крыша, труба и горн
            c3Shell(m, b, 'stone', Math.min(fl, 2), {}); slab();
            hr = Math.min(w, h) / 2 * 0.65; m.gable(x0, z0, x0 + w, z0 + h, Math.min(fl, 2), hr, roofC, stone, 0.18, alongX); top = Math.min(fl, 2) + hr;
            const cu = alongX ? x0 + 0.7 : z0 + 0.7; chimney(cu, alongX ? cz : cx, Math.min(fl, 2) + hr * 0.35); X.glow.box(dx + 0.9, 0.1, z0 + h + 0.12, dx + 1.2, 0.3, z0 + h + 0.38, c3Lin('#ff8a3d'));
            m.piece('cart', dx - 1.0, 0, z0 + h + 0.5, 0.4, 0.9); X.circle(dx - 1.0, z0 + h + 0.5, 0.4); break;
        }
        default: {        // дом, лавка, таверна, постоялый двор, «своё здание»
            const stoneK = k === 'other' && false; c3Shell(m, b, stoneK ? 'stone' : 'wood', fl, {}); slab();
            hr = Math.min(w, h) / 2 * (k === 'shop' ? 0.62 : 0.85); m.gable(x0, z0, x0 + w, z0 + h, fl, hr, roofC, wood, 0.2, alongX); top = fl + hr;
            const cu = alongX ? x0 + w - 0.8 : z0 + h - 0.8; chimney(cu, alongX ? cz + 0.3 : cx + 0.3, fl + hr * 0.45);
            if (k === 'tavern' || k === 'inn') { chimney(alongX ? x0 + 0.8 : z0 + 0.8, alongX ? cz - 0.3 : cx - 0.3, fl + hr * 0.45); lamp(dx - 0.75, z0 + h + 0.18, 0.42); lamp(dx + 0.75, z0 + h + 0.18, 0.42); }
            if (k === 'shop') { const aw = c3Lin('#d9534f'), aw2 = c3Lin('#f2e3c3'); for (let q = 0; q < 6; q++) m.quad([dx - 0.6 + q * 0.2, 0.62, z0 + h + 0.42], [dx - 0.4 + q * 0.2, 0.62, z0 + h + 0.42], [dx - 0.4 + q * 0.2, 0.82, z0 + h], [dx - 0.6 + q * 0.2, 0.82, z0 + h], q % 2 ? aw2 : aw); }
        }
    }
    return { top, cx, cz };
}

// ---------- Всё вместе: карта города → мир ----------
// q: настройки качества (trees — деревьев на клетку леса, kit — модели деревьев из набора; иначе простые конусы)
function c3World(city, g, q) {
    const W = city.w, H = city.h, CH = C3.CH, NX = Math.ceil(W / CH), NZ = Math.ceil(H / CH), tiles = Uint8Array.from(city.tiles, ch => +ch || 0);
    const chunks = new Map(), glow = new C3Mesh(), water = new C3Mesh(), npcMesh = new C3Mesh(), solid = new Uint8Array(W * H), circ = new Map(), labels = [];
    const X = {
        W, H, q, glow, solid, water,
        mAt(x, z) { const cx = Math.max(0, Math.min(NX - 1, Math.floor(x / CH))), cz = Math.max(0, Math.min(NZ - 1, Math.floor(z / CH))), key = cz * NX + cx; let c = chunks.get(key); if (!c) { c = { cx, cz, m: new C3Mesh() }; chunks.set(key, c); } return c.m; },
        mark(xa, za, wa, ha, v) { for (let j = za; j < za + ha; j++) for (let i = xa; i < xa + wa; i++) if (i >= 0 && j >= 0 && i < W && j < H) solid[j * W + i] = v; },
        circle(x, z, r) { const k = (Math.floor(z) * W + Math.floor(x)); let a = circ.get(k); if (!a) circ.set(k, a = []); a.push(x, z, r); }
    };
    const T = (x, y) => x < 0 || y < 0 || x >= W || y >= H ? -1 : tiles[y * W + x];
    const base = [c3Lin('#79b560'), c3Lin('#bcb09a'), c3Lin('#b9a77c'), c3Lin('#dccfae'), c3Lin('#5e9a50'), c3Lin('#d9c66c'), c3Lin('#8f8c98')];   // трава, дорога, дно, площадь, лес, поле, камень
    const jit = (c, x, z, a) => c3Mul(c, 1 + (c3Hash(x * 4, z * 4, 11) - 0.5) * a);   // цвет в углу клетки: соседние клетки плавно переходят друг в друга
    const flat = (m, x, z, y, col, a) => m.quad([x, y, z + 1], [x + 1, y, z + 1], [x + 1, y, z], [x, y, z], jit(col, x, z + 1, a), jit(col, x + 1, z + 1, a), jit(col, x + 1, z, a), jit(col, x, z, a));
    // 1. местность
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const t = tiles[y * W + x], m = X.mAt(x + 0.5, y + 0.5);
        if (t === 2) {   // вода: дно, берега, поверхность
            flat(m, x, y, -0.34, base[2], 0.1); water.quad([x, -0.1, y + 1], [x + 1, -0.1, y + 1], [x + 1, -0.1, y], [x, -0.1, y], [1, 1, 1]); solid[y * W + x] = 1;
            const bk = c3Lin('#8a7a55');
            if (T(x, y - 1) !== 2 && T(x, y - 1) !== -1) m.quad([x + 1, -0.34, y], [x, -0.34, y], [x, 0, y], [x + 1, 0, y], bk);
            if (T(x, y + 1) !== 2 && T(x, y + 1) !== -1) m.quad([x, -0.34, y + 1], [x + 1, -0.34, y + 1], [x + 1, 0, y + 1], [x, 0, y + 1], bk);
            if (T(x - 1, y) !== 2 && T(x - 1, y) !== -1) m.quad([x, -0.34, y], [x, -0.34, y + 1], [x, 0, y + 1], [x, 0, y], bk);
            if (T(x + 1, y) !== 2 && T(x + 1, y) !== -1) m.quad([x + 1, -0.34, y + 1], [x + 1, -0.34, y], [x + 1, 0, y], [x + 1, 0, y + 1], bk);
            continue;
        }
        if (t === 1 || t === 3) {   // дорога и площадь: чуть выше травы, у края — тёмная кромка
            flat(m, x, y, t === 1 ? 0.018 : 0.026, t === 3 ? ((x + y) % 2 ? c3Mul(base[3], 0.96) : base[3]) : base[1], 0.05);
            const kb = c3Mul(base[t], 0.66), e = 0.07, yy = 0.03;
            if (T(x, y - 1) !== t && T(x, y - 1) !== 1 && T(x, y - 1) !== 3) m.quad([x, yy, y + e], [x + 1, yy, y + e], [x + 1, yy, y], [x, yy, y], kb);
            if (T(x, y + 1) !== t && T(x, y + 1) !== 1 && T(x, y + 1) !== 3) m.quad([x, yy, y + 1], [x + 1, yy, y + 1], [x + 1, yy, y + 1 - e], [x, yy, y + 1 - e], kb);
            if (T(x - 1, y) !== t && T(x - 1, y) !== 1 && T(x - 1, y) !== 3) m.quad([x, yy, y + 1], [x + e, yy, y + 1], [x + e, yy, y], [x, yy, y], kb);
            if (T(x + 1, y) !== t && T(x + 1, y) !== 1 && T(x + 1, y) !== 3) m.quad([x + 1 - e, yy, y + 1], [x + 1, yy, y + 1], [x + 1, yy, y], [x + 1 - e, yy, y], kb);
            // уличный фонарь у края дороги
            if (t === 1 && q.lamps && (x * 3 + y * 5) % 11 === 0 && (T(x, y + 1) === 0 || T(x + 1, y) === 0)) { const lx = T(x, y + 1) === 0 ? x + 0.5 : x + 0.92, lz = T(x, y + 1) === 0 ? y + 0.92 : y + 0.5; m.piece('lantern', lx, 0, lz, 0, 0.5); glow.sphere(lx, 1.38 * 0.5, lz, 0.06, c3Lin('#ffd98a'), 6); X.circle(lx, lz, 0.05); }
            continue;
        }
        if (t === 5) {   // поле: полосы
            for (let s = 0; s < 4; s++) { const x1 = x + s / 4, x2 = x + (s + 1) / 4, c = s % 2 ? c3Lin('#c9b45a') : c3Lin('#dcc96f'); m.quad([x1, 0.012, y + 1], [x2, 0.012, y + 1], [x2, 0.012, y], [x1, 0.012, y], jit(c, x, y, 0.1)); }
            continue;
        }
        flat(m, x, y, 0, base[t] || base[0], 0.14);
        if (t === 4) {   // лес
            for (let n = 0; n < q.trees; n++) {
                const tx = x + 0.12 + 0.76 * c3Hash(x, y, 20 + n), tz = y + 0.12 + 0.76 * c3Hash(x, y, 40 + n), sc = 0.72 + 0.45 * c3Hash(x, y, 60 + n);
                c3Tree(X, m, tx, tz, sc, Math.floor(c3Hash(x, y, 80 + n) * 5), c3Hash(x, y, 100 + n) * 6.28);
            }
        } else if (t === 6 && c3Hash(x, y, 5) < 0.55) c3Rock(X, m, x + 0.2 + 0.6 * c3Hash(x, y, 6), y + 0.2 + 0.6 * c3Hash(x, y, 7), 1.1 + 1.2 * c3Hash(x, y, 8), c3Hash(x, y, 9) * 6.28);
    }
    // 2. декор (значки с карты)
    for (const d of city.items) {
        if (d.t !== 'd') continue;
        const x = d.x + 0.5, z = d.y + 0.5, m = X.mAt(x, z), r = c3Hash(d.x, d.y, 33), rot = r * 6.28;
        switch (d.e) {
            case '🌳': c3Tree(X, m, x, z, 1.15, 2, rot); break;
            case '🌲': c3Tree(X, m, x, z, 1.15, 1, rot); break;
            case '🌴': c3Tree(X, m, x, z, 0.95, 3, rot); break;
            case '⛲': m.piece('fountain-round', x, 0, z, 0, 0.5); X.circle(x, z, 0.5); break;
            case '🪨': c3Rock(X, m, x, z, 0.7 + 0.3 * r, rot); break;
            case '🌸': for (let n = 0; n < 7; n++) { const fx = x - 0.35 + 0.7 * c3Hash(d.x, d.y, 70 + n), fz = z - 0.35 + 0.7 * c3Hash(d.x, d.y, 80 + n); m.cone(fx, 0, fz, 0.06, 0.2, 4, c3Lin('#4f9a47')); m.sphere(fx, 0.22, fz, 0.06, c3Hsl([340, 20, 50, 280, 0][n % 5], 0.7, 0.68), 5); } break;
            case '🔥': { m.piece('c.tree-trunk', x - 0.12, 0, z, 0.4, 0.6); m.piece('c.tree-trunk', x + 0.12, 0, z + 0.05, 2.2, 0.6); m.piece('c.tree-trunk', x, 0, z - 0.12, 4.1, 0.6); glow.cone(x, 0.04, z, 0.13, 0.34, 6, c3Lin('#ff8a1f'), c3Lin('#ffd24a')); glow.cone(x, 0.04, z, 0.07, 0.25, 5, c3Lin('#fff0a0')); X.circle(x, z, 0.2); break; }
            case '⛺': { const c = c3Hsl(c3Hash(d.x, d.y, 5) * 360, 0.5, 0.55); m.hip(x - 0.5, z - 0.4, x + 0.5, z + 0.4, 0, 0.62, c, 0.02); m.quad([x - 0.5, 0.01, z + 0.4], [x + 0.5, 0.01, z + 0.4], [x + 0.5, 0.01, z - 0.4], [x - 0.5, 0.01, z - 0.4], c3Mul(c, 0.5)); X.circle(x, z, 0.45); break; }
            case '🪦': m.box(x - 0.1, 0, z - 0.03, x + 0.1, 0.26, z + 0.03, c3Lin('#9a98a6')); m.box(x - 0.07, 0.26, z - 0.03, x + 0.07, 0.32, z + 0.03, c3Lin('#a8a6b4')); X.circle(x, z, 0.14); break;
            case '🌾': for (let n = 0; n < 14; n++) { const fx = x - 0.4 + 0.8 * c3Hash(d.x, d.y, 90 + n), fz = z - 0.4 + 0.8 * c3Hash(d.x, d.y, 110 + n); m.cone(fx, 0, fz, 0.035, 0.34 + 0.08 * c3Hash(n, d.x, 3), 4, c3Lin(n % 3 ? '#d8bd4a' : '#c9a93b')); } break;
            case '🏺': m.cyl(x, 0, z, 0.1, 0.26, 7, c3Lin('#b5683c'), c3Lin('#6e3f22')); m.cyl(x, 0.26, z, 0.05, 0.08, 7, c3Lin('#a35c34')); X.circle(x, z, 0.12); break;
            case '🛖': { c3Shell(m, { x: d.x, y: d.y, w: 1, h: 1 }, 'wood', 1, {}); m.piece('roof-point', x, 1, z, 0, 1); m.box(d.x - 0.03, 0, d.y - 0.03, d.x + 1.03, 0.05, d.y + 1.03, c3Lin('#9a98a6'), 'b'); X.mark(d.x, d.y, 1, 1, 1); break; }
            case '🚩': m.piece('c.flag', x, 0, z, rot, 1.3); X.circle(x, z, 0.05); break;
            case '🪵': m.piece('c.tree-trunk', x, 0, z, rot, 1.5); m.piece('c.tree-trunk', x + 0.2, 0, z + 0.1, rot + 1, 1.2); X.circle(x, z, 0.25); break;
            case '🐄': c3Animal(X, m, x, z, rot, false); break;
            case '🐎': c3Animal(X, m, x, z, rot, true); break;
            default: labels.push({ text: d.e, x, y: 0.5, z, kind: 'emoji', id: d.id }); m.cyl(x, 0, z, 0.025, 0.4, 5, c3Lin('#7a5230'));
        }
    }
    // 3. здания
    for (const b of city.items) {
        if (b.t !== 'b') continue;
        const r = c3Bld(X, b); if (b.n) labels.push({ text: b.n, x: r.cx, y: r.top + 0.45, z: r.cz, kind: 'bld', id: b.id, w: b.w, h: b.h });
    }
    // 4. герои
    const npcs = [];
    for (const p of city.items) {
        if (p.t !== 't' && p.t !== 'p') continue; const ch = p.char && g ? (g.chars || []).find(c => c.id === p.char) : null, name = ch ? ch.name : p.n;
        c3Person(npcMesh, p.x, p.y, (ch && ch.hue) || 265, 0); X.circle(p.x, p.y, 0.1); labels.push({ text: name || 'Герой', x: p.x, y: 0.78, z: p.y, kind: 'hero', id: p.id, char: ch });
        npcs.push({ x: p.x, z: p.y, id: p.id });
    }
    const out = []; chunks.forEach(c => { if (!c.m.empty) out.push({ cx: c.cx, cz: c.cz, m: c.m }); });
    return { W, H, chunks: out, glow, water, npcMesh, solid, circ, labels, npcs, tiles };
}
