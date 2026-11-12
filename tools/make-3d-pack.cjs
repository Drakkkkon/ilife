'use strict';
// =====================================================================================================
// iLife 2.4.0 — упаковщик 3D-моделей для режима «3D-карта» (ДНД → Вижуал). Запускается вручную и ТОЛЬКО при смене набора моделей.
//   Читает .glb из бесплатных наборов Kenney (лицензия CC0): «Fantasy Town Kit» и «Castle Kit»
//   (скачиваются с https://opengameart.org/content/fantasy-town-kit и https://opengameart.org/content/castle-kit),
//   сливает их в один компактный файл: assets/3d/town.bin (+ описание town.json).
//   Цвет модели в наборах хранится в палитре-картинке (colormap.png) — здесь он «запекается» в цвета вершин,
//   поэтому в игре не нужны ни текстуры, ни загрузчик glTF: меньше файл и быстрее на слабых телефонах.
//   Формат town.bin (порядок: позиции, нормали, цвета, индексы; каждый раздел выровнен по 4 байтам):
//     позиции  Int16 ×3   (деление на town.json.posScale = метры «клетки» набора), нормали Int8 ×3 (деление на 127),
//     цвета    Uint8 ×3   (sRGB), индексы Uint16 (внутри модели — от нуля).
// Запуск:  NODE_PATH=<папка с node_modules, где есть sharp> node tools/make-3d-pack.cjs <папка_town_kit> <папка_castle_kit> [куда]
// =====================================================================================================
const fs = require('fs'), path = require('path');
const sharp = require('sharp');
const [townDir, castleDir, outDir = path.join(__dirname, '..', 'assets', '3d')] = process.argv.slice(2);
if (!townDir || !castleDir) { console.error('Укажите папки наборов: <town_kit> <castle_kit> [куда]'); process.exit(1); }
const POS_SCALE = 4096;

function parseGlb(file) {
    const b = fs.readFileSync(file); let off = 12, json, bin;
    while (off < b.length) { const len = b.readUInt32LE(off), type = b.readUInt32LE(off + 4), data = b.subarray(off + 8, off + 8 + len); if (type === 0x4E4F534A) json = JSON.parse(data.toString('utf8')); else if (type === 0x004E4942) bin = Buffer.from(data); off += 8 + len; }
    return { json, bin };
}
function readAcc(g, idx) {
    const a = g.json.accessors[idx], v = g.json.bufferViews[a.bufferView], n = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[a.type];
    const CT = { 5120: Int8Array, 5121: Uint8Array, 5122: Int16Array, 5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array }[a.componentType], sz = CT.BYTES_PER_ELEMENT;
    const stride = v.byteStride || n * sz, base = (v.byteOffset || 0) + (a.byteOffset || 0), out = new Float64Array(a.count * n), dv = new DataView(g.bin.buffer, g.bin.byteOffset);
    const get = { 5120: 'getInt8', 5121: 'getUint8', 5122: 'getInt16', 5123: 'getUint16', 5125: 'getUint32', 5126: 'getFloat32' }[a.componentType];
    for (let i = 0; i < a.count; i++) for (let k = 0; k < n; k++) out[i * n + k] = dv[get](base + i * stride + k * sz, true);
    return out;
}
// 4×4 матрицы (по столбцам, как в glTF)
const mul = (a, b) => { const o = new Array(16).fill(0); for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k]; return o; };
function nodeMat(n) {
    if (n.matrix) return n.matrix.slice();
    const t = n.translation || [0, 0, 0], q = n.rotation || [0, 0, 0, 1], s = n.scale || [1, 1, 1], [x, y, z, w] = q;
    return [(1 - 2 * (y * y + z * z)) * s[0], (2 * (x * y + z * w)) * s[0], (2 * (x * z - y * w)) * s[0], 0, (2 * (x * y - z * w)) * s[1], (1 - 2 * (x * x + z * z)) * s[1], (2 * (y * z + x * w)) * s[1], 0, (2 * (x * z + y * w)) * s[2], (2 * (y * z - x * w)) * s[2], (1 - 2 * (x * x + y * y)) * s[2], 0, t[0], t[1], t[2], 1];
}
async function loadPalette(file) { const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true }); return { data, w: info.width, h: info.height }; }
function sample(p, u, v) {   // билинейная выборка палитры (u, v по правилам glTF: v=0 — верх картинки)
    const x = Math.max(0, Math.min(p.w - 1, u * p.w - 0.5)), y = Math.max(0, Math.min(p.h - 1, v * p.h - 0.5)), x0 = Math.floor(x), y0 = Math.floor(y), x1 = Math.min(p.w - 1, x0 + 1), y1 = Math.min(p.h - 1, y0 + 1), fx = x - x0, fy = y - y0, o = [0, 0, 0];
    for (let c = 0; c < 3; c++) { const g = (xx, yy) => p.data[(yy * p.w + xx) * 4 + c]; o[c] = (g(x0, y0) * (1 - fx) + g(x1, y0) * fx) * (1 - fy) + (g(x0, y1) * (1 - fx) + g(x1, y1) * fx) * fy; }
    return o;
}
function convert(g, pal) {   // g.name — имя модели
    const pos = [], nor = [], col = [], idx = []; let vbase = 0;
    const visit = (ni, parent) => {
        const n = g.json.nodes[ni], m = mul(parent, nodeMat(n));
        if (n.mesh != null) for (const prim of g.json.meshes[n.mesh].primitives) {
            const P = readAcc(g, prim.attributes.POSITION), N = readAcc(g, prim.attributes.NORMAL), T = readAcc(g, prim.attributes.TEXCOORD_0), I = readAcc(g, prim.indices), cnt = P.length / 3;
            for (let i = 0; i < cnt; i++) {
                const x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2];
                pos.push(m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14]);
                const nx = N[i * 3], ny = N[i * 3 + 1], nz = N[i * 3 + 2]; let ax = m[0] * nx + m[4] * ny + m[8] * nz, ay = m[1] * nx + m[5] * ny + m[9] * nz, az = m[2] * nx + m[6] * ny + m[10] * nz; const l = Math.hypot(ax, ay, az) || 1; nor.push(ax / l, ay / l, az / l);
                let cc = sample(pal, T[i * 2], T[i * 2 + 1]); if (cc[0] + cc[1] + cc[2] < 24 || (/fountain/.test(g.name) && cc[0] > cc[2] + 30)) cc = [96, 172, 222];   // вода в фонтанах: в палитре она полупрозрачная — красим в голубой
                col.push(...cc);
            }
            for (let i = 0; i < I.length; i++) idx.push(I[i] + vbase); vbase += cnt;
        }
        for (const c of n.children || []) visit(c, m);
    };
    const sc = g.json.scenes[g.json.scene || 0]; for (const r of sc.nodes) visit(r, [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
    return { pos, nor, col, idx };
}

(async () => {
    const kits = [
        { dir: path.join(townDir, 'Models', 'GLB format'), prefix: '', pal: path.join(townDir, 'Models', 'GLB format', 'Textures', 'colormap.png'), skip: /^(windmill|watermill-wide|ground)/ },
        { dir: path.join(castleDir, 'Models', 'GLB format'), prefix: 'c.', pal: path.join(castleDir, 'Models', 'GLB format', 'Textures', 'colormap.png'), skip: /(demolished|siege-|^ground)/ }
    ];
    const P = [], N = [], C = [], I = [], models = {}; let vOff = 0, iOff = 0, skipped = 0;
    for (const k of kits) {
        const pal = await loadPalette(k.pal);
        for (const f of fs.readdirSync(k.dir).filter(f => f.endsWith('.glb')).sort()) {
            const name = f.replace(/\.glb$/, ''); if (k.skip.test(name)) { skipped++; continue; }
            const gl = parseGlb(path.join(k.dir, f)); gl.name = name; const r = convert(gl, pal), vn = r.pos.length / 3; if (vn > 60000) throw new Error(name + ' слишком большая');
            for (const v of r.pos) P.push(Math.max(-32767, Math.min(32767, Math.round(v * POS_SCALE))));
            for (const v of r.nor) N.push(Math.round(v * 127));
            for (let i = 0; i < r.col.length; i++) C.push(Math.max(0, Math.min(255, Math.round(r.col[i]))));
            for (const v of r.idx) I.push(v);
            const mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9]; for (let i = 0; i < r.pos.length; i++) { mn[i % 3] = Math.min(mn[i % 3], r.pos[i]); mx[i % 3] = Math.max(mx[i % 3], r.pos[i]); }
            models[k.prefix + name] = { v: vOff, n: vn, i: iOff, m: r.idx.length, b: mn.concat(mx).map(x => Math.round(x * 1000) / 1000) };
            vOff += vn; iOff += r.idx.length;
        }
    }
    const pad4 = n => (4 - n % 4) % 4;
    const bPos = Buffer.from(new Int16Array(P).buffer), bNor = Buffer.from(new Int8Array(N).buffer), bCol = Buffer.from(new Uint8Array(C).buffer), bIdx = Buffer.from(new Uint16Array(I).buffer);
    const parts = [bPos, bNor, bCol, bIdx], offs = []; let o = 0, chunks = [];
    for (const b of parts) { offs.push(o); chunks.push(b); o += b.length; const p = pad4(o); if (p) { chunks.push(Buffer.alloc(p)); o += p; } }
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, 'town.bin'), Buffer.concat(chunks));
    fs.writeFileSync(path.join(outDir, 'town.json'), JSON.stringify({ v: 1, posScale: POS_SCALE, verts: vOff, indices: iOff, off: { pos: offs[0], nor: offs[1], col: offs[2], idx: offs[3] }, models }));
    console.log('моделей:', Object.keys(models).length, 'пропущено:', skipped, 'вершин:', vOff, 'индексов:', iOff, 'town.bin:', (o / 1024).toFixed(0) + ' КБ');
})().catch(e => { console.error(e); process.exit(1); });
