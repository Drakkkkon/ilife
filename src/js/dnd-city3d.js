'use strict';
// =====================================================================================================
// iLife 2.4.0 — «ДНД» → «ВИЖУАЛ» → «3D-КАРТА» (часть 2 из 2): экран, камера, управление и настройки графики.
//   Класс City3D показывается поверх 2D-карты (кнопка «3D» в панели «Вижуала»): строит мир из карты города
//   (js/dnd-city3d-world.js), рисует его через three.js (assets/3d/three.min.js, грузится только при включении 3D)
//   и даёт погулять по городу от первого лица.
//   УПРАВЛЕНИЕ. Телефон: палец в левой части экрана — идти, в правой — смотреть. Компьютер: W A S D или стрелки,
//   мышь (клик по картине захватывает мышь, Esc отпускает), Shift — бег, F — полёт над городом, Esc — выход.
//   ГРАФИКА. Пресеты «Эконом / Баланс / Высокое / Ультра», «Авто» (по мощности устройства и с подстройкой
//   разрешения по скорости кадров) и «Своё». Самое тяжёлое — тени, сглаживание, разрешение и дальность прорисовки.
//   Настройки лежат в LS «city3d» (только на этом устройстве, на Диск не уходят).
// =====================================================================================================

(function () {
    if (!window.ICONS) return;
    const add = {
        view_in_ar: '<path d="M12 2 3 7v10l9 5 9-5V7zm0 2.3 6.5 3.6L12 11.5 5.5 7.9zM5 9.6l6 3.3v6.8l-6-3.3zm8 10.1v-6.8l6-3.3v6.8z"/>',
        fullscreen: '<path d="M7 14H5v5h5v-2H7zm-2-4h2V7h3V5H5zm12 7h-3v2h5v-5h-2zM14 5v2h3v3h2V5z"/>',
        directions_run: '<path d="M13.49 5.48c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2m-3.6 13.9 1-4.4 2.1 2v6h2v-7.5l-2.1-2 .6-3c1.3 1.5 3.3 2.5 5.5 2.5v-2c-1.9 0-3.5-1-4.3-2.4l-1-1.6c-.4-.6-1-1-1.7-1-.3 0-.5.1-.8.1l-5.2 2.2v4.7h2v-3.4l1.8-.7-1.6 8.1-4.9-1-.4 2z"/>',
        flight: '<path d="M21 16v-2l-8-5V3.5c0-.83-.67-1.5-1.5-1.5S10 2.67 10 3.5V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5z"/>',
        arrow_back: '<path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20z"/>',
        settings: '<path d="M19.14 12.94c.04-.3.06-.61.06-.94s-.02-.64-.07-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6"/>'
    };
    Object.keys(add).forEach(k => { if (!window.ICONS[k]) window.ICONS[k] = add[k]; });
})();

// ---------- Качество графики ----------
//   scale — чёткость относительно экрана (1 = родное разрешение экрана телефона, меньше — мягче, но быстрее; 1,5 — с запасом для сглаживания), dist — дальность прорисовки (клеток), shadow — размер карты теней (0 — без теней),
//   trees — деревьев на клетку леса, kit — модели деревьев из набора (иначе простые конусы), aa — сглаживание, fps — предел кадров
const C3_PRESETS = {
    eco: { n: 'Эконом', scale: 0.55, dist: 22, shadow: 0, trees: 1, kit: false, aa: false, clouds: false, lamps: false, fps: 30 },
    mid: { n: 'Баланс', scale: 0.75, dist: 34, shadow: 0, trees: 2, kit: true, aa: false, clouds: true, lamps: true, fps: 45 },
    high: { n: 'Высокое', scale: 1, dist: 50, shadow: 1024, trees: 3, kit: true, aa: true, clouds: true, lamps: true, fps: 60 },
    ultra: { n: 'Ультра', scale: 1.5, dist: 75, shadow: 2048, trees: 4, kit: true, aa: true, clouds: true, lamps: true, fps: 60 }
};
const C3_DEF = { preset: 'auto', fov: 72, sens: 1, speed: 1, labels: true, tod: 'day', fps: false, cust: { scale: 0.75, dist: 34, shadow: 0, trees: 2, kit: true, aa: false, clouds: true, lamps: true, fps: 45 } };
const C3_TOD = {
    day: { n: 'День', sky: ['#4f9be0', '#bfe0f5'], fog: '#cfe3f0', hemi: ['#ffffff', '#a59f80', 1.95], sun: ['#fff3dd', 2.2], el: 52, az: 35, cloud: '#ffffff' },
    evening: { n: 'Закат', sky: ['#3a4f93', '#ffb26e'], fog: '#efb58c', hemi: ['#ffd9b4', '#6f5b58', 1.25], sun: ['#ffa35a', 2.0], el: 13, az: 245, cloud: '#ffd0b0' },
    night: { n: 'Ночь', sky: ['#050a22', '#1c2c5a'], fog: '#18244b', hemi: ['#7f95d6', '#1d2236', 0.95], sun: ['#9fb4ff', 0.55], el: 38, az: 120, cloud: '#4a5688' }
};
function c3AutoPreset() {   // по мощности устройства; потом ещё подстраивается разрешение
    const mem = navigator.deviceMemory || 4, cores = navigator.hardwareConcurrency || 4, mobile = /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent);
    if (mobile) return mem <= 3 || cores <= 4 ? 'eco' : 'mid';
    return mem >= 8 && cores >= 8 ? 'high' : 'mid';
}

class City3D {
    constructor(root, opt) {
        this.root = root; this.opt = opt; this.city = opt.city; this.g = opt.g;
        const s = LS.get('city3d', {}); this.set = Object.assign({}, C3_DEF, s, { cust: Object.assign({}, C3_DEF.cust, s.cust || {}) });
        this.pos = { x: 0, z: 0 }; this.eye = 0.53; this.eyeNow = 0.53; this.yaw = 0; this.pitch = 0; this.fly = false; this.run = false;
        this.keys = {}; this.stick = null; this.look = null; this.mv = { x: 0, y: 0 }; this.running = false; this.dyn = 1; this.frames = 0; this.acc = 0; this.accN = 0; this.nearId = null; this.sprites = []; this.hc = 0;
        this.loop = this.loop.bind(this);
        root.innerHTML = '<div class="cy3-stage"></div>' +
            '<div class="cy3-load" id="cy3-load"><div class="cy3-spin"></div><b>Строю город…</b><small id="cy3-lp">Загружаю модели</small></div>' +
            '<div class="cy3-top"><button type="button" class="cy3-b" data-c="exit">' + ic('arrow_back') + '<span>К карте</span></button><span class="cy3-sp"></span>' +
            '<button type="button" class="cy3-b is-ic" data-c="gfx" aria-label="Настройки графики" title="Настройки графики">' + ic('settings') + '</button>' +
            '<button type="button" class="cy3-b is-ic" data-c="fs" aria-label="Во весь экран" title="Во весь экран">' + ic('fullscreen') + '</button></div>' +
            '<div class="cy3-cross" aria-hidden="true"></div><button type="button" class="cy3-near" id="cy3-near" hidden></button>' +
            '<div class="cy3-stick" id="cy3-stick" hidden><i></i></div>' +
            '<div class="cy3-btns"><button type="button" class="cy3-b" data-c="run" aria-pressed="false">' + ic('directions_run') + '<span>Бег</span></button><button type="button" class="cy3-b" data-c="fly" aria-pressed="false">' + ic('flight') + '<span>Полёт</span></button></div>' +
            '<div class="cy3-fps" id="cy3-fps" hidden></div><div class="cy3-tip" id="cy3-tip"></div>';
        hydrateIcons(root); this.$ = s => root.querySelector(s); this.stage = this.$('.cy3-stage');
        this.onKey = e => this.key(e, true); this.onKeyUp = e => this.key(e, false); this.onResize = () => this.resize();
        this.onVis = () => { if (document.hidden) this.pause(); else this.resume(); };
        this.onLock = () => { this.locked = document.pointerLockElement === this.cv; };
        this.bindUi();
    }
    // ----- настройки -----
    quality() {
        const p = this.set.preset === 'auto' ? c3AutoPreset() : this.set.preset, q = Object.assign({}, p === 'custom' ? this.set.cust : (C3_PRESETS[p] || C3_PRESETS.mid)); q.id = p; return q;
    }
    saveSet() { LS.set('city3d', this.set); }
    // ----- запуск -----
    async start() {
        this.root.hidden = false; this.running = false;
        try {
            await new Promise(r => setTimeout(r, 40)); await c3Load();
            this.$('#cy3-lp').textContent = 'Собираю здания и местность'; await new Promise(r => setTimeout(r, 30));
            this.buildAll(); this.$('#cy3-load').hidden = true;
        } catch (e) {
            this.$('#cy3-load').innerHTML = '<b>Не получилось включить 3D</b><small>' + esc(e && e.message || 'ошибка') + '. Нужен интернет при первом запуске и браузер с WebGL.</small><button type="button" class="btn btn-primary" data-c="exit">К карте</button>'; return;
        }
        document.addEventListener('keydown', this.onKey, true); document.addEventListener('keyup', this.onKeyUp, true);   // в фазе перехвата — раньше, чем Esc закроет шторку document.addEventListener('visibilitychange', this.onVis); document.addEventListener('pointerlockchange', this.onLock);
        if (window.ResizeObserver) { this.ro = new ResizeObserver(() => this.resize()); this.ro.observe(this.root); } else window.addEventListener('resize', this.onResize);
        this.resume(); const tn = LS.get('city3d_tip', 0); if (tn < 3) { LS.set('city3d_tip', tn + 1); this.tip(this.touch() ? 'Левая часть экрана — идти, правая — осмотреться.' : 'W A S D — идти, мышь — смотреть (клик по картинке), Shift — бег, F — полёт, Esc — отпустить мышь, ещё раз Esc — выйти.', 6000); }
    }
    touch() { return window.matchMedia && matchMedia('(pointer:coarse)').matches; }
    tip(t, ms) { const e = this.$('#cy3-tip'); if (!e) return; e.textContent = t; e.classList.add('is-on'); clearTimeout(this._tt); this._tt = setTimeout(() => e.classList.remove('is-on'), ms || 3500); }
    // Сцена целиком (при смене качества собирается заново; положение игрока остаётся)
    buildAll() {
        this.disposeAll(); const q = this.q = this.quality(), T = THREE;
        this.world = c3World(this.city, this.g, q);
        if (!this.placed) { this.placed = true; this.spawn(); }
        const cv = this.cv = document.createElement('canvas'); cv.className = 'cy3-cv'; this.stage.appendChild(cv);
        const r = this.r = new T.WebGLRenderer({ canvas: cv, antialias: !!q.aa, powerPreference: 'high-performance', alpha: false, stencil: false });
        r.shadowMap.enabled = q.shadow > 0; r.shadowMap.type = T.PCFSoftShadowMap;
        const sc = this.scene = new T.Scene(), cam = this.cam = new T.PerspectiveCamera(this.set.fov, 1, 0.05, 200); cam.rotation.order = 'YXZ';
        const mat = this.mat = new T.MeshLambertMaterial({ vertexColors: true });
        this.meshes = [];
        const mk = (m, material, shadow) => {
            const a = m.arrays(), geo = new T.BufferGeometry(); geo.setAttribute('position', new T.BufferAttribute(a.p, 3)); geo.setAttribute('normal', new T.BufferAttribute(a.n, 3)); geo.setAttribute('color', new T.BufferAttribute(a.c, 3)); geo.setIndex(new T.BufferAttribute(a.i, 1));
            geo.computeBoundingSphere(); const me = new T.Mesh(geo, material); if (shadow && q.shadow) { me.castShadow = true; me.receiveShadow = true; } sc.add(me); return me;
        };
        this.chunks = this.world.chunks.map(c => { const me = mk(c.m, mat, true), bs = me.geometry.boundingSphere; me.userData = { x: bs.center.x, z: bs.center.z, r: bs.radius }; return me; });
        if (!this.world.npcMesh.empty) mk(this.world.npcMesh, mat, true);
        this.glowMat = new T.MeshBasicMaterial({ vertexColors: true }); if (!this.world.glow.empty) mk(this.world.glow, this.glowMat, false);
        if (!this.world.water.empty) { const wa = this.world.water.arrays(), g = new T.BufferGeometry(); g.setAttribute('position', new T.BufferAttribute(wa.p, 3)); g.setAttribute('normal', new T.BufferAttribute(wa.n, 3)); g.setIndex(new T.BufferAttribute(wa.i, 1)); this.waterMat = new T.MeshLambertMaterial({ color: 0x3d9bd6, transparent: true, opacity: 0.8 }); this.water = new T.Mesh(g, this.waterMat); sc.add(this.water); }
        // земля за краем карты
        const W = this.world.W, H = this.world.H, S = 600; this.farMat = new T.MeshLambertMaterial({ color: 0x5f9a4e });
        for (const [x0, z0, x1, z1] of [[-S, -S, W + S, 0], [-S, H, W + S, H + S], [-S, 0, 0, H], [W, 0, W + S, H]]) {   // четыре полосы вокруг карты: посреди неё остаётся «дыра», иначе земля закрыла бы реку
            const f = new T.Mesh(new T.PlaneGeometry(x1 - x0, z1 - z0), this.farMat); f.rotation.x = -Math.PI / 2; f.position.set((x0 + x1) / 2, -0.02, (z0 + z1) / 2); sc.add(f);
        }
        // небо, солнце, облака
        this.sky = new T.Mesh(new T.SphereGeometry(1, 14, 10), new T.MeshBasicMaterial({ vertexColors: true, side: T.BackSide, fog: false, depthWrite: false })); this.sky.scale.setScalar(150); this.sky.renderOrder = -2; this.sky.frustumCulled = false; sc.add(this.sky);
        this.sunDisc = new T.Mesh(new T.SphereGeometry(5, 10, 8), new T.MeshBasicMaterial({ color: 0xfff6d0, fog: false })); this.sunDisc.frustumCulled = false; sc.add(this.sunDisc);
        this.hemi = new T.HemisphereLight(0xffffff, 0x888866, 1.5); sc.add(this.hemi);
        this.sun = new T.DirectionalLight(0xffffff, 2.2); sc.add(this.sun, this.sun.target);
        if (q.shadow) { const s = this.sun.shadow; s.mapSize.set(q.shadow, q.shadow); const k = 18; Object.assign(s.camera, { left: -k, right: k, top: k, bottom: -k, near: 1, far: 90 }); s.bias = -0.0006; s.normalBias = 0.04; this.sun.castShadow = true; }
        this.clouds = null; if (q.clouds) this.makeClouds();
        this.makeLabels();
        sc.fog = new T.Fog(0xcfe3f0, 10, 40);
        this.applyTod(); this.resize(true);
    }
    disposeAll() {
        if (this.scene) this.scene.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) { const ms = Array.isArray(o.material) ? o.material : [o.material]; ms.forEach(m => { if (m.map) m.map.dispose(); m.dispose(); }); } });
        if (this.r) { this.r.dispose(); try { this.r.forceContextLoss(); } catch (e) {} }
        if (this.cv) this.cv.remove(); this.r = this.scene = this.cv = null; this.sprites = [];
    }
    stop() {
        this.running = false; cancelAnimationFrame(this.raf); this.exitLock();
        document.removeEventListener('keydown', this.onKey, true); document.removeEventListener('keyup', this.onKeyUp, true); document.removeEventListener('visibilitychange', this.onVis); document.removeEventListener('pointerlockchange', this.onLock);
        window.removeEventListener('resize', this.onResize); if (this.ro) this.ro.disconnect();
        if (document.fullscreenElement) { try { document.exitFullscreen(); } catch (e) {} }
        this.disposeAll(); this.root.hidden = true; this.root.innerHTML = '';
    }
    pause() { this.running = false; cancelAnimationFrame(this.raf); }
    resume() { if (this.running || !this.r) return; this.running = true; this.last = performance.now(); this.lastR = 0; this.raf = requestAnimationFrame(this.loop); }
    exitLock() { try { if (document.pointerLockElement) document.exitPointerLock(); } catch (e) {} }
    // ----- размеры и качество -----
    resize(force) {
        if (this.autoPaused && this.root.offsetParent) { this.autoPaused = false; this.resume(); }
        if (!this.r) return; const w = this.root.clientWidth, h = this.root.clientHeight; if (!w || !h) return;
        const q = this.q, auto = this.set.preset === 'auto', pr = Math.max(0.4, Math.min(q.scale * (auto ? this.dyn : 1) * Math.max(1, window.devicePixelRatio || 1), 2.5));   // пикселей отрисовки на пиксель экрана
        if (!force && w === this.w && h === this.h && pr === this.pr) return; this.w = w; this.h = h; this.pr = pr;
        this.r.setPixelRatio(pr); this.r.setSize(w, h, false); this.cam.aspect = w / h; this.cam.fov = this.set.fov; this.cam.far = q.dist + 30; this.cam.updateProjectionMatrix();
        this.scene.fog.near = q.dist * 0.4; this.scene.fog.far = q.dist * 0.96;
    }
    applyTod() {
        const t = C3_TOD[this.set.tod] || C3_TOD.day, T = THREE, top = new T.Color(t.sky[0]), hor = new T.Color(t.sky[1]), fog = new T.Color(t.fog);
        const sg = this.sky.geometry, pos = sg.attributes.position, col = new Float32Array(pos.count * 3);
        for (let i = 0; i < pos.count; i++) { const y = pos.getY(i), k = Math.pow(Math.max(0, Math.min(1, y * 1.25 + 0.05)), 0.7), c = hor.clone().lerp(top, k); col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; }
        sg.setAttribute('color', new T.BufferAttribute(col, 3)); this.scene.fog.color.copy(fog); this.r.setClearColor(fog);
        this.hemi.color.set(t.hemi[0]); this.hemi.groundColor.set(t.hemi[1]); this.hemi.intensity = t.hemi[2]; this.sun.color.set(t.sun[0]); this.sun.intensity = t.sun[1];
        const el = t.el * Math.PI / 180, az = t.az * Math.PI / 180; this.sunDir = new T.Vector3(Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az));
        this.sunDisc.material.color.set(this.set.tod === 'night' ? 0xdfe6ff : this.set.tod === 'evening' ? 0xffb070 : 0xfff6d0); this.farMat.color.set(this.set.tod === 'night' ? 0x1f3320 : 0x5f9a4e);
        if (this.clouds) this.clouds.material.color.set(t.cloud);
        this.waterMat && this.waterMat.color.set(this.set.tod === 'night' ? 0x1d4a78 : 0x3d9bd6);
    }
    makeClouds() {
        const m = new C3Mesh(), col = [1, 1, 1], W = this.world.W, H = this.world.H;
        for (let i = 0; i < 12; i++) {
            const a = c3Hash(i, 1, 1) * 6.283, d = 25 + c3Hash(i, 2, 2) * 90, cx = Math.cos(a) * d, cz = Math.sin(a) * d, cy = 32 + c3Hash(i, 3, 3) * 14;
            for (let k = 0; k < 4; k++) { const dx = (k - 1.5) * 3.4 + c3Hash(i, k, 4) * 2, dz = (c3Hash(i, k, 5) - 0.5) * 4, sx = 2.6 + c3Hash(i, k, 6) * 2, sz = 2 + c3Hash(i, k, 7) * 2; m.box(cx + dx - sx, cy, cz + dz - sz, cx + dx + sx, cy + 1.6 + c3Hash(i, k, 8), cz + dz + sz, col); }
        }
        const a = m.arrays(), g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(a.p, 3)); g.setAttribute('normal', new THREE.BufferAttribute(a.n, 3)); g.setIndex(new THREE.BufferAttribute(a.i, 1));
        this.clouds = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, fog: false })); this.clouds.position.set(W / 2, 0, H / 2); this.scene.add(this.clouds);
    }
    // ----- подписи зданий и героев (картинки-таблички, видны вблизи) -----
    makeLabels() {
        this.sprites = []; const T = THREE;
        for (const l of this.world.labels) {
            if (l.kind === 'emoji') { const sp = this.sprite(l.text, null, 0.34); sp.position.set(l.x, l.y + 0.3, l.z); sp.userData = { l, base: sp.scale.clone(), far: 9 }; this.scene.add(sp); this.sprites.push(sp); continue; }
            const sp = this.sprite(l.text, l, l.kind === 'hero' ? 0.2 : 0.26); sp.position.set(l.x, l.y, l.z); sp.userData = { l, base: sp.scale.clone(), far: l.kind === 'hero' ? 9 : 17 }; this.scene.add(sp); this.sprites.push(sp);
        }
    }
    sprite(text, l, h) {
        const T = THREE, cv = document.createElement('canvas'), c = cv.getContext('2d'), hero = l && l.kind === 'hero', em = !l, fs = em ? 96 : 44, pad = 16;
        const draw = () => {
            c.font = (em ? '' : 'bold ') + fs + 'px ' + (em ? (typeof DND_EMOJI_FONT !== 'undefined' ? DND_EMOJI_FONT : 'sans-serif') : 'sans-serif'); const tw = Math.ceil(c.measureText(text).width), ph = hero ? 72 : 0, W = Math.max(em ? 112 : 96, tw + pad * 2 + ph), Hh = em ? 120 : 76;
            cv.width = W; cv.height = Hh; c.font = (em ? '' : 'bold ') + fs + 'px ' + (em ? (typeof DND_EMOJI_FONT !== 'undefined' ? DND_EMOJI_FONT : 'sans-serif') : 'sans-serif'); c.textBaseline = 'middle'; c.textAlign = 'center';
            if (!em) { c.fillStyle = 'rgba(30,25,40,.72)'; const r = 22; c.beginPath(); c.moveTo(r, 4); c.arcTo(W - 4, 4, W - 4, Hh - 4, r); c.arcTo(W - 4, Hh - 4, 4, Hh - 4, r); c.arcTo(4, Hh - 4, 4, 4, r); c.arcTo(4, 4, W - 4, 4, r); c.closePath(); c.fill(); }
            if (hero) {
                const ch = l.char, im = ch && ch.portraitId && typeof dndCityPhoto === 'function' ? dndCityPhoto(ch.portraitId, () => { draw(); tex.needsUpdate = true; }) : null, cx = pad + 30, cy = Hh / 2;
                c.save(); c.beginPath(); c.arc(cx, cy, 30, 0, 7); c.clip();
                if (im) { const s = Math.max(60 / im.naturalWidth, 60 / im.naturalHeight); c.drawImage(im, cx - im.naturalWidth * s / 2, cy - 30 - (im.naturalHeight * s - 60) * 0.15, im.naturalWidth * s, im.naturalHeight * s); }
                else { c.fillStyle = 'hsl(' + ((ch && ch.hue) || 265) + ',55%,48%)'; c.fillRect(cx - 30, cy - 30, 60, 60); c.fillStyle = '#fff'; c.font = 'bold 34px sans-serif'; c.fillText(String(text).trim().charAt(0).toLocaleUpperCase('ru-RU'), cx, cy + 2); }
                c.restore(); c.font = 'bold ' + fs + 'px sans-serif';
            }
            c.fillStyle = '#fff'; c.fillText(text, hero ? pad + 66 + tw / 2 : W / 2, Hh / 2 + 2);
        };
        const tex = new T.CanvasTexture(cv); tex.colorSpace = T.SRGBColorSpace; tex.minFilter = T.LinearFilter; tex.generateMipmaps = false; draw(); tex.needsUpdate = true;
        const sp = new T.Sprite(new T.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, fog: false })); sp.scale.set(h * cv.width / cv.height, h, 1); sp.renderOrder = 5; return sp;
    }
    // ----- положение игрока и столкновения -----
    spawn() {
        const o = this.opt.start || {}, W = this.world.W, H = this.world.H; let x = o.x != null ? o.x : W / 2, z = o.z != null ? o.z : H / 2;
        x = Math.max(0.6, Math.min(W - 0.6, x)); z = Math.max(0.6, Math.min(H - 0.6, z));
        if (this.blocked(x, z)) { let best = null, bd = 1e9; for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) { if (this.blocked(i + 0.5, j + 0.5)) continue; const d = Math.hypot(i + 0.5 - x, j + 0.5 - z); if (d < bd) { bd = d; best = [i + 0.5, j + 0.5]; } } if (best) { x = best[0]; z = best[1]; } }
        this.pos.x = x; this.pos.z = z;
        // смотрим на ближайшее здание
        let tb = null, td = 1e9; for (const b of this.city.items) if (b.t === 'b') { const d = Math.hypot(b.x + b.w / 2 - x, b.y + b.h / 2 - z); if (d < td && d > 0.5) { td = d; tb = b; } }
        this.yaw = o.yaw != null ? o.yaw : tb ? Math.atan2(-(tb.x + tb.w / 2 - x), -(tb.y + tb.h / 2 - z)) : 0;
    }
    blocked(x, z) {
        const w = this.world, W = w.W, H = w.H, r = 0.2; if (x < 0.3 || z < 0.3 || x > W - 0.3 || z > H - 0.3) return true;
        const xa = Math.floor(x - r), xb = Math.floor(x + r), za = Math.floor(z - r), zb = Math.floor(z + r);
        for (let j = za; j <= zb; j++) for (let i = xa; i <= xb; i++) if (i >= 0 && j >= 0 && i < W && j < H && w.solid[j * W + i]) return true;
        for (let j = za - 1; j <= zb + 1; j++) for (let i = xa - 1; i <= xb + 1; i++) { const a = w.circ.get(j * W + i); if (a) for (let k = 0; k < a.length; k += 3) if (Math.hypot(x - a[k], z - a[k + 1]) < r + a[k + 2]) return true; }
        return false;
    }
    // ----- управление -----
    key(e, down) {
        if (typeof sheetStack !== 'undefined' && sheetStack.length) return; const k = e.code;
        if (/^(KeyW|KeyA|KeyS|KeyD|ArrowUp|ArrowDown|ArrowLeft|ArrowRight|ShiftLeft|ShiftRight)$/.test(k)) { this.keys[k] = down; e.preventDefault(); }
        if (down && k === 'KeyF' && !e.repeat) this.toggleFly();
        if (down && k === 'Escape' && !document.pointerLockElement) this.exit();
    }
    toggleFly() { this.fly = !this.fly; this.eye = this.fly ? 14 : 0.53; if (this.fly && this.pitch > -0.5) this.pitch = -0.55; if (!this.fly) this.pitch = 0; this.$('[data-c="fly"]').setAttribute('aria-pressed', this.fly); this.$('[data-c="fly"]').classList.toggle('is-on', this.fly); if (!this.fly && this.blocked(this.pos.x, this.pos.z)) this.spawnNear(); }
    spawnNear() { const x = this.pos.x, z = this.pos.z, W = this.world.W, H = this.world.H; let best = null, bd = 1e9; for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) { if (this.blocked(i + 0.5, j + 0.5)) continue; const d = Math.hypot(i + 0.5 - x, j + 0.5 - z); if (d < bd) { bd = d; best = [i + 0.5, j + 0.5]; } } if (best) { this.pos.x = best[0]; this.pos.z = best[1]; } }
    bindUi() {
        const root = this.root, st = this.$('#cy3-stick'), knob = st.querySelector('i'), R = 54;
        root.addEventListener('click', e => {
            const b = e.target.closest('[data-c]'); if (!b) return; const c = b.dataset.c;
            if (c === 'exit') this.exit(); else if (c === 'gfx') this.gfxSheet();
            else if (c === 'fs') { const d = document.documentElement; if (document.fullscreenElement) document.exitFullscreen(); else if (d.requestFullscreen) d.requestFullscreen().catch(() => {}); else this.tip('Этот браузер не умеет во весь экран'); }
            else if (c === 'run') { this.run = !this.run; b.setAttribute('aria-pressed', this.run); b.classList.toggle('is-on', this.run); }
            else if (c === 'fly') this.toggleFly();
        });
        this.$('#cy3-near').addEventListener('click', () => { const b = this.nearB; if (b && this.opt.onBld) { this.exitLock(); this.opt.onBld(b); } });
        root.addEventListener('pointerdown', e => {
            if (e.target.closest('button') || !this.r) return; e.preventDefault(); try { root.setPointerCapture(e.pointerId); } catch (er) {}
            const rect = root.getBoundingClientRect(), x = e.clientX - rect.left;
            if (e.pointerType === 'touch' || e.pointerType === 'pen') {
                if (x < rect.width * 0.46 && !this.stick) { this.stick = { id: e.pointerId, sx: e.clientX, sy: e.clientY }; st.hidden = false; st.style.left = (e.clientX - rect.left) + 'px'; st.style.top = (e.clientY - rect.top) + 'px'; knob.style.transform = ''; }
                else if (!this.look) this.look = { id: e.pointerId, x: e.clientX, y: e.clientY, touch: true };
            } else if (!this.look) this.look = { id: e.pointerId, x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, moved: false };
        });
        root.addEventListener('pointermove', e => {
            if (this.stick && e.pointerId === this.stick.id) {
                let dx = e.clientX - this.stick.sx, dy = e.clientY - this.stick.sy; const d = Math.hypot(dx, dy); if (d > R) { dx = dx / d * R; dy = dy / d * R; }
                knob.style.transform = 'translate(' + dx + 'px,' + dy + 'px)'; this.mv.x = dx / R; this.mv.y = -dy / R; return;
            }
            if (this.look && e.pointerId === this.look.id) {
                const k = this.look.touch ? 0.0052 : 0.0034, s = this.set.sens; let dx = e.clientX - this.look.x, dy = e.clientY - this.look.y; if (this.locked) { dx = e.movementX; dy = e.movementY; }
                if (!this.look.touch && Math.hypot(e.clientX - this.look.sx, e.clientY - this.look.sy) > 4) this.look.moved = true;
                this.look.x = e.clientX; this.look.y = e.clientY; this.yaw -= dx * k * s; this.pitch = Math.max(-1.45, Math.min(1.45, this.pitch - dy * k * s));
            } else if (this.locked) { const s = this.set.sens; this.yaw -= e.movementX * 0.0022 * s; this.pitch = Math.max(-1.45, Math.min(1.45, this.pitch - e.movementY * 0.0022 * s)); }
        });
        const up = e => {
            if (this.stick && e.pointerId === this.stick.id) { this.stick = null; this.mv.x = this.mv.y = 0; st.hidden = true; }
            if (this.look && e.pointerId === this.look.id) { const l = this.look; this.look = null; if (!l.touch && !l.moved && !this.touch() && !document.pointerLockElement && root.requestPointerLock && this.cv) { try { const p = this.cv.requestPointerLock(); if (p && p.catch) p.catch(() => {}); } catch (er) {} } }
        };
        root.addEventListener('pointerup', up); root.addEventListener('pointercancel', up);
        root.addEventListener('contextmenu', e => e.preventDefault());
    }
    exit() { this.stop(); if (this.opt.onExit) this.opt.onExit(this.pos, this.yaw); }
    // ----- главный цикл -----
    loop(t) {
        if (!this.running) return; this.raf = requestAnimationFrame(this.loop);
        if (++this.hc % 30 === 0 && !this.root.offsetParent) { this.autoPaused = true; this.pause(); this.exitLock(); return; }   // открыли другую вкладку
        const q = this.q, el = t - this.last; if (el < 1000 / q.fps - 3) return;
        const dt = Math.min(0.1, el / 1000); this.last = t; this.step(dt);
        this.r.render(this.scene, this.cam); this.frames++;
        // подстройка разрешения в режиме «Авто»
        this.acc += el; this.accN++; if (this.acc > 1600) {
            const avg = this.acc / this.accN; this.acc = 0; this.accN = 0;
            if (this.set.preset === 'auto') { if (avg > 30 && this.dyn > 0.5) { this.dyn = Math.max(0.5, this.dyn * 0.86); this.resize(); } else if (avg < 19 && this.dyn < 1) { this.dyn = Math.min(1, this.dyn * 1.1); this.resize(); } }
            if (this.set.fps) { const f = this.$('#cy3-fps'); f.hidden = false; f.textContent = Math.round(1000 / avg) + ' к/с · ' + Math.round(this.pr * 100) + '% · ' + q.id + ' · ' + this.r.info.render.triangles + ' тр.'; } else this.$('#cy3-fps').hidden = true;
        }
    }
    step(dt) {
        const k = this.keys; let fx = (k.KeyD || k.ArrowRight ? 1 : 0) - (k.KeyA || k.ArrowLeft ? 1 : 0), fy = (k.KeyW || k.ArrowUp ? 1 : 0) - (k.KeyS || k.ArrowDown ? 1 : 0);
        fx += this.mv.x; fy += this.mv.y; const len = Math.hypot(fx, fy); if (len > 1) { fx /= len; fy /= len; }
        if (len > 0.01) {
            const sp = (this.fly ? 6 : 1.5) * this.set.speed * (this.run || k.ShiftLeft || k.ShiftRight ? 2.1 : 1), sn = Math.sin(this.yaw), cs = Math.cos(this.yaw);
            const dx = (fx * cs - fy * sn) * sp * dt, dz = (-fx * sn - fy * cs) * sp * dt, p = this.pos;
            if (this.fly) { p.x = Math.max(0, Math.min(this.world.W, p.x + dx)); p.z = Math.max(0, Math.min(this.world.H, p.z + dz)); }
            else { if (!this.blocked(p.x + dx, p.z)) p.x += dx; if (!this.blocked(p.x, p.z + dz)) p.z += dz; }
        }
        this.eyeNow += (this.eye - this.eyeNow) * Math.min(1, dt * 3.5);
        const cam = this.cam, p = this.pos, bob = len > 0.01 && !this.fly ? Math.sin(this.frames * 0.28) * 0.006 : 0;
        cam.position.set(p.x, this.eyeNow + bob, p.z); cam.rotation.set(this.pitch, this.yaw, 0);
        this.sky.position.copy(cam.position); this.sunDisc.position.copy(cam.position).addScaledVector(this.sunDir, 120);
        this.sun.position.set(p.x, 0, p.z).addScaledVector(this.sunDir, 40); this.sun.target.position.set(p.x, 0, p.z);
        const lim = this.q.dist + 10;
        for (const c of this.chunks) { const u = c.userData, d = Math.hypot(u.x - p.x, u.z - p.z) - u.r; c.visible = d < lim; }
        const tm = performance.now() / 1000;
        if (this.water) this.water.position.y = Math.sin(tm * 0.9) * 0.012;
        if (this.glowMat) { const f = 0.9 + 0.1 * Math.sin(tm * 11) * Math.sin(tm * 7.3); this.glowMat.color.setScalar(f); }
        if (this.clouds) this.clouds.rotation.y = tm * 0.004;
        if (this.frames % 6 === 0) this.updateLabels();
    }
    updateLabels() {
        const p = this.pos, on = this.set.labels;
        for (const sp of this.sprites) { const u = sp.userData, d = Math.hypot(sp.position.x - p.x, sp.position.z - p.z); const vis = on && (d < u.far || (this.fly && u.l.kind === 'bld' && d < 40)); sp.visible = vis; if (vis) { const k = 1 + Math.min(1.5, d * 0.1); sp.scale.set(u.base.x * k, u.base.y * k, 1); } }
        // здание рядом и перед глазами — кнопка «подробнее»
        let best = null, bd = 3.2; const fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw);
        for (const b of this.city.items) {
            if (b.t !== 'b') continue; const ex = Math.max(b.x - p.x, 0, p.x - b.x - b.w), ez = Math.max(b.y - p.z, 0, p.z - b.y - b.h), d = Math.hypot(ex, ez); if (d >= bd) continue;
            const cx = b.x + b.w / 2 - p.x, cz = b.y + b.h / 2 - p.z, l = Math.hypot(cx, cz) || 1; if ((cx * fx + cz * fz) / l < 0.35) continue; bd = d; best = b;
        }
        const nb = this.$('#cy3-near'); if (best !== this.nearB) { this.nearB = best; if (best) { nb.hidden = false; nb.innerHTML = esc((bldKind(best.k).e || '') + ' ' + (best.n || bldKind(best.k).n)) + '<small>подробнее</small>'; } else nb.hidden = true; }
    }
    // ----- настройки графики -----
    gfxSheet() {
        this.exitLock(); const me = this, S = this.set; let rebuild = false;
        const cur = () => me.quality();
        const chips = (attr, items, sel) => '<div class="cy-chips">' + items.map(i => '<button type="button" class="chip' + (i[0] === sel ? ' is-on' : '') + '" ' + attr + '="' + i[0] + '">' + esc(i[1]) + '</button>').join('') + '</div>';
        const sw = (id, t, on, hint) => '<div class="switch-row"><div class="tx"><b>' + t + '</b>' + (hint ? '<small>' + hint + '</small>' : '') + '</div><input type="checkbox" class="switch" id="' + id + '" aria-label="' + t + '"' + (on ? ' checked' : '') + '></div>';
        const rg = (id, t, min, max, step, v, unit) => '<label class="field-label" for="' + id + '">' + t + ' <b id="' + id + '-v">' + v + unit + '</b></label><input type="range" id="' + id + '" min="' + min + '" max="' + max + '" step="' + step + '" value="' + v + '" aria-label="' + t + '">';
        const html = () => { const q = cur(); return '<span class="field-label">Качество картинки</span>' + chips('data-pr', [['auto', 'Авто'], ['eco', 'Эконом'], ['mid', 'Баланс'], ['high', 'Высокое'], ['ultra', 'Ультра'], ['custom', 'Своё']], S.preset) +
            '<p class="hint">«Авто» подбирает по телефону и сам снижает чёткость, если тормозит. Для бюджетных телефонов — «Эконом». Тени и сглаживание — самое тяжёлое.</p>' +
            '<div class="c3-adv">' + rg('g-scale', 'Чёткость', 30, 150, 5, Math.round(q.scale * 100), '%') + rg('g-dist', 'Дальность прорисовки', 14, 90, 2, q.dist, ' кл.') + rg('g-trees', 'Деревьев на клетку леса', 0, 4, 1, q.trees, '') +
            '<span class="field-label">Тени</span>' + chips('data-sh', [[0, 'Нет'], [1024, 'Обычные'], [2048, 'Чёткие']], q.shadow) +
            sw('g-aa', 'Сглаживание краёв', q.aa) + sw('g-kit', 'Красивые деревья из набора', q.kit, 'выключено — простые конусы, легче') + sw('g-clouds', 'Облака', q.clouds) + sw('g-lamps', 'Уличные фонари', q.lamps) + '</div>' +
            '<span class="field-label">Время суток</span>' + chips('data-tod', Object.keys(C3_TOD).map(k => [k, C3_TOD[k].n]), S.tod) +
            rg('g-fov', 'Угол обзора', 55, 100, 1, S.fov, '°') + rg('g-sens', 'Чувствительность взгляда', 30, 250, 5, Math.round(S.sens * 100), '%') + rg('g-speed', 'Скорость ходьбы', 50, 250, 10, Math.round(S.speed * 100), '%') +
            sw('g-lab', 'Подписи зданий и героев', S.labels) + sw('g-fps', 'Показывать скорость кадров', S.fps) + '<p class="hint">Модели: Kenney (Fantasy Town Kit, Castle Kit), лицензия CC0 · движок three.js (MIT).</p>'; };
        openSheet({
            title: 'Графика 3D', html: html(), actions: [{ label: 'Готово', kind: 'primary', value: true }],
            onClose: () => { me.saveSet(); if (rebuild) me.rebuild(); },
            onOpen: ap => {
                const body = ap.body, q = s => body.querySelector(s);
                const toCustom = () => { if (S.preset !== 'custom') { S.cust = Object.assign({}, cur()); delete S.cust.id; delete S.cust.n; S.preset = 'custom'; body.querySelectorAll('[data-pr]').forEach(b => b.classList.toggle('is-on', b.dataset.pr === 'custom')); } };
                const live = () => { me.q = me.quality(); me.resize(true); };
                body.addEventListener('click', e => {
                    const p = e.target.closest('[data-pr]'), sh = e.target.closest('[data-sh]'), td = e.target.closest('[data-tod]');
                    if (p) { S.preset = p.dataset.pr; rebuild = true; body.innerHTML = html(); me.saveSet(); me.q = me.quality(); }
                    else if (sh) { toCustom(); S.cust.shadow = +sh.dataset.sh; rebuild = true; body.querySelectorAll('[data-sh]').forEach(b => b.classList.toggle('is-on', b === sh)); }
                    else if (td) { S.tod = td.dataset.tod; me.applyTod(); body.querySelectorAll('[data-tod]').forEach(b => b.classList.toggle('is-on', b === td)); }
                });
                body.addEventListener('input', e => {
                    const id = e.target.id, v = +e.target.value, set = (k, val, u) => { const o = q('#' + id + '-v'); if (o) o.textContent = val + u; };
                    if (id === 'g-scale') { toCustom(); S.cust.scale = v / 100; set(0, v, '%'); live(); }
                    else if (id === 'g-dist') { toCustom(); S.cust.dist = v; set(0, v, ' кл.'); live(); }
                    else if (id === 'g-trees') { toCustom(); S.cust.trees = v; set(0, v, ''); rebuild = true; }
                    else if (id === 'g-fov') { S.fov = v; set(0, v, '°'); live(); }
                    else if (id === 'g-sens') { S.sens = v / 100; set(0, v, '%'); }
                    else if (id === 'g-speed') { S.speed = v / 100; set(0, v, '%'); }
                });
                body.addEventListener('change', e => {
                    const id = e.target.id, on = e.target.checked;
                    if (id === 'g-aa') { toCustom(); S.cust.aa = on; rebuild = true; } else if (id === 'g-kit') { toCustom(); S.cust.kit = on; rebuild = true; }
                    else if (id === 'g-clouds') { toCustom(); S.cust.clouds = on; rebuild = true; } else if (id === 'g-lamps') { toCustom(); S.cust.lamps = on; rebuild = true; }
                    else if (id === 'g-lab') { S.labels = on; } else if (id === 'g-fps') { S.fps = on; if (!on) me.$('#cy3-fps').hidden = true; }
                });
            }
        });
    }
    async rebuild() {
        const ld = this.$('#cy3-load'); this.pause(); ld.hidden = false; ld.innerHTML = '<div class="cy3-spin"></div><b>Применяю настройки…</b>'; await new Promise(r => setTimeout(r, 40));
        try { this.dyn = 1; this.buildAll(); } catch (e) { ld.innerHTML = '<b>Не получилось применить настройки</b><small>' + esc(e.message || '') + '</small><button type="button" class="btn btn-primary" data-c="exit">К карте</button>'; return; }
        ld.hidden = true; this.resume();
    }
}
