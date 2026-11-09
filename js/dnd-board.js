'use strict';
// =====================================================================================================
// iLife 2.0.0 — ДОСКА (как в Miro): бесконечное поле, стикеры, карточки, текст, фигуры, рамки, картинки, рисунок, связи-стрелки.
// Один движок DndBoard обслуживает две страницы: «Конструктор» (mode 'board') и «Сюжет» (mode 'plot': блоки со стрелками).
// Данные доски — массив items внутри игры (см. js/dnd.js). Все предметы — простые объекты:
//   sticky { x,y,w,h,text,c,fs }  card { …,kind,title,text,tags[],imgId? }  text { x,y,w,text,fs,ink,al }
//   shape { …,shape,text,fill,stroke,ink,fs }  frame { …,title,c }  image { …,imgId }  pen { x,y,w,h,ow,oh,pts[[x,y]],color,width }
//   conn { from:{id,side}|{x,y}, to:{…}, style:'curve|straight|elbow', head:'end|both|none', dash, color, width, label }
//   block { …,kind,title,text,intro[],tags[],chars[],status }   — только в «Сюжете»
// Общие поля: id, t (вид), z (порядок), locked, g (группа).
// Управление: колесо — масштаб, пробел/средняя кнопка/«Рука» — сдвиг, два пальца — масштаб и сдвиг на телефоне,
// двойной щелчок — правка, Delete — удалить, Ctrl+Z / Ctrl+Shift+Z, Ctrl+C / V / D, Ctrl+A, стрелки — сдвиг.
// =====================================================================================================

function bdItem(t, p) {
    const defs = {
        sticky: { w: 200, h: 200, text: '', c: (typeof dndCfg !== 'undefined' && dndCfg.stickyColor) || '#fff3a3', fs: 18 },
        card: { w: 260, h: 170, kind: 'note', title: '', text: '', tags: [] },
        text: { w: 240, text: '', fs: 24, ink: '#1d1b20', al: 'left' },
        shape: { w: 160, h: 120, shape: 'rect', text: '', fill: '#ffffff', stroke: '#79747e', ink: '#1d1b20', fs: 18 },
        frame: { w: 480, h: 320, title: 'Рамка', c: '#8e8a98' },
        image: { w: 300, h: 200, imgId: '', name: '' },
        pen: { pts: [], w: 10, h: 10, ow: 10, oh: 10, color: '#1d1b20', width: 3 },
        conn: { from: null, to: null, style: 'curve', head: 'end', dash: false, color: '#5f5b66', width: 2, label: '' },
        block: { w: 240, h: 150, kind: 'scene', title: '', text: '', intro: [], tags: [], chars: [], status: 'plan' }
    };
    return Object.assign({ id: uid('b'), t, x: 0, y: 0, z: 0 }, JSON.parse(JSON.stringify(defs[t] || {})), p || {});
}
function bdInk(hex) {
    const c = String(hex || '#fff').replace('#', ''); if (c.length < 6) return '#1d1b20';
    const r = parseInt(c.substr(0, 2), 16), g = parseInt(c.substr(2, 2), 16), b = parseInt(c.substr(4, 2), 16);
    return (0.299 * r + 0.587 * g + 0.114 * b) < 120 ? '#ffffff' : '#1d1b20';
}
const bdClamp = (v, a, b) => Math.max(a, Math.min(b, v));
let bdClip = null, bdPasteN = 0;

class DndBoard {
    constructor(o) {
        this.o = o; this.mode = o.mode; this.host = o.host;
        this.game = null; this.model = null; this.items = [];
        this.sel = new Set(); this.view = { x: 0, y: 0, z: 1 }; this.tool = 'select'; this.toolArg = null;
        this.els = new Map(); this.cels = new Map(); this.byIdMap = new Map();
        this.hist = []; this.hi = -1; this.pointers = new Map(); this.d = null; this.space = false;
        this.editEl = null; this.editIt = null; this.hot = null; this.pendFrom = null; this.lastDown = null; this.mouseW = { x: 0, y: 0 };
        this.build(); this.bindEvents();
    }

    // ---------- Каркас ----------
    build() {
        const mode = this.mode;
        this.host.innerHTML =
            '<div class="bd" data-mode="' + mode + '">' +
            '<div class="bd-top" role="toolbar" aria-label="Доска"></div>' +
            '<div class="bd-main"><div class="bd-tools" role="toolbar" aria-label="Инструменты"></div>' +
            '<div class="bd-view" tabindex="0" aria-label="Холст">' +
            '<div class="bd-world"><svg class="bd-svg" width="1" height="1" overflow="visible"><g class="bd-conns"></g><g class="bd-tmp"></g></svg>' +
            '<div class="bd-selbox" hidden></div><div class="bd-hs" hidden>' + ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'].map(d => '<i class="bd-h" data-d="' + d + '"></i>').join('') + '</div></div>' +
            '<div class="bd-band" hidden></div><div class="bd-ctx" hidden></div><div class="bd-pop" hidden></div>' +
            '<canvas class="bd-mini" width="360" height="240" hidden></canvas>' +
            '<div class="bd-hint" hidden></div>' +
            '<div class="bd-empty" hidden></div>' +
            '</div></div>' +
            '<input type="file" class="bd-file" accept="image/*" hidden></div>';
        const q = s => this.host.querySelector(s);
        this.root = q('.bd'); this.top = q('.bd-top'); this.toolsEl = q('.bd-tools'); this.v = q('.bd-view'); this.world = q('.bd-world');
        this.svg = q('.bd-svg'); this.gConns = q('.bd-conns'); this.gTmp = q('.bd-tmp'); this.selbox = q('.bd-selbox'); this.hs = q('.bd-hs');
        this.bandEl = q('.bd-band'); this.ctx = q('.bd-ctx'); this.popEl = q('.bd-pop'); this.mini = q('.bd-mini'); this.hintEl = q('.bd-hint'); this.emptyEl = q('.bd-empty'); this.fileEl = q('.bd-file');
        if (this.buildUi) this.buildUi();
    }
    isActive() { return !!this.host.offsetParent && !!this.game; }

    // ---------- Привязка к игре ----------
    bind(game) {
        this.endEdit(); this.cancelDrag();
        this.game = game || null;
        this.sel.clear(); this.pendFrom = null;
        this.root.classList.toggle('is-nogame', !game);
        if (!game) { this.model = null; this.items = []; this.renderAll(); this.updateEmpty(); return; }
        this.model = this.mode === 'plot' ? (game.plot = game.plot || { items: [] }) : (game.board = game.board || dndEmptyBoard());
        if (!Array.isArray(this.model.items)) this.model.items = [];
        this.items = this.model.items;
        this.items.forEach(i => { if (!i.id) i.id = uid('b'); if (i.z == null) i.z = 0; });
        const views = LS.get('dnd_views', {}), vk = game.id + ':' + this.mode;
        this.view = Object.assign({ x: 40, y: 40, z: 1 }, views[vk] || {});
        this.grid = this.mode === 'plot' ? true : this.model.grid !== false; this.snap = !!this.model.snap && this.mode === 'board';
        this.hist = [JSON.stringify(this.items)]; this.hi = 0;
        this.renderAll();
        if (!views[vk] && this.items.length) this.fit(true);
        this.applyView(); this.updateEmpty(); if (this.syncUi) this.syncUi();
    }
    reload() { this.bind(this.o.getGame()); }
    byId(id) { return this.byIdMap.get(id) || null; }
    reindex() { this.byIdMap = new Map(this.items.map(i => [i.id, i])); }
    updateEmpty() {
        const e = this.emptyEl; if (!e) return;
        if (!this.game) {
            e.hidden = false; e.innerHTML = '<div class="ico-big">' + ic('casino') + '</div><b>Сначала выберите игру</b><span>Доска, персонажи и сюжет хранятся внутри игры.</span>' +
                '<div class="btn-group" style="justify-content:center;margin-top:0.75rem"><button type="button" class="btn btn-primary" data-dnd-pick>' + ic('casino') + 'Выбрать игру</button><button type="button" class="btn" data-bd-newgame>' + ic('add') + 'Новая игра</button></div>';
        } else if (!this.items.length) {
            e.hidden = false; e.classList.add('is-soft');
            e.innerHTML = this.mode === 'plot' ?
                '<div class="ico-big">' + ic('account_tree') + '</div><b>Схема сюжета пуста</b><span>Выберите инструмент «Блок» и коснитесь поля, чтобы добавить первое событие. Блоки соединяются стрелками.</span>' :
                '<div class="ico-big">' + ic('dnd_board') + '</div><b>Доска пуста</b><span>Двойной щелчок или двойное касание по полю — стикер. Инструменты рядом с полем: карточки, текст, фигуры, рамки, связи. Готовые заготовки — в меню «⋯» сверху.</span>';
        } else { e.hidden = true; e.classList.remove('is-soft'); }
    }

    // ---------- Вид: сдвиг и масштаб ----------
    toWorld(cx, cy) { const r = this.v.getBoundingClientRect(); return { x: (cx - r.left - this.view.x) / this.view.z, y: (cy - r.top - this.view.y) / this.view.z }; }
    toScreen(wx, wy) { return { x: wx * this.view.z + this.view.x, y: wy * this.view.z + this.view.y }; }
    applyView() {
        const { x, y, z } = this.view;
        this.world.style.transform = 'translate(' + x + 'px,' + y + 'px) scale(' + z + ')';
        this.v.style.setProperty('--z', z);
        const gridOn = this.grid && z >= 0.3, g = (gridOn ? 24 : 0) * z; this.v.classList.toggle('no-grid', !gridOn);   // на очень мелком масштабе точки сливаются в серое пятно — сетку прячем
        this.v.style.backgroundSize = g + 'px ' + g + 'px'; this.v.style.backgroundPosition = x + 'px ' + y + 'px';
        this.placeHandles(); this.placeCtx(); this.drawMini(); this.saveViewSoon();
        const zl = this.top.querySelector('[data-z-label]'); if (zl) zl.textContent = Math.round(z * 100) + ' %';
    }
    saveViewSoon() {
        clearTimeout(this._vt); this._vt = setTimeout(() => {
            if (!this.game) return; const views = LS.get('dnd_views', {}); views[this.game.id + ':' + this.mode] = { x: Math.round(this.view.x), y: Math.round(this.view.y), z: +this.view.z.toFixed(3) };
            const keys = Object.keys(views); if (keys.length > 60) delete views[keys[0]]; LS.set('dnd_views', views);
        }, 500);
    }
    zoomAt(cx, cy, z) {
        z = bdClamp(z, 0.08, 3); const r = this.v.getBoundingClientRect(); const px = cx - r.left, py = cy - r.top;
        const wx = (px - this.view.x) / this.view.z, wy = (py - this.view.y) / this.view.z;
        this.view.z = z; this.view.x = px - wx * z; this.view.y = py - wy * z; this.applyView();
    }
    zoomBy(f) { const r = this.v.getBoundingClientRect(); this.zoomAt(r.left + r.width / 2, r.top + r.height / 2, this.view.z * f); }
    bounds(list) {
        let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
        (list || this.items).forEach(i => { if (i.t === 'conn') return; const b = this.box(i); x0 = Math.min(x0, b.x); y0 = Math.min(y0, b.y); x1 = Math.max(x1, b.x + b.w); y1 = Math.max(y1, b.y + b.h); });
        return x0 > x1 ? null : { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
    }
    fit(quiet) {
        const b = this.bounds(); const r = this.v.getBoundingClientRect();
        if (!b || !r.width) { this.view = { x: 40, y: 40, z: 1 }; this.applyView(); return; }
        const pad = 60, z = bdClamp(Math.min((r.width - pad * 2) / Math.max(b.w, 1), (r.height - pad * 2) / Math.max(b.h, 1)), 0.08, 1.2);
        this.view.z = z; this.view.x = (r.width - b.w * z) / 2 - b.x * z; this.view.y = (r.height - b.h * z) / 2 - b.y * z; this.applyView();
    }
    centerOn(wx, wy) { const r = this.v.getBoundingClientRect(); this.view.x = r.width / 2 - wx * this.view.z; this.view.y = r.height / 2 - wy * this.view.z; this.applyView(); }
    viewCenter() { const r = this.v.getBoundingClientRect(); return this.toWorld(r.left + r.width / 2, r.top + r.height / 2); }

    // ---------- Геометрия ----------
    box(it) {
        if (it.t === 'text') { const el = this.els.get(it.id); return { x: it.x, y: it.y, w: it.w, h: (el && el.offsetHeight) || it.h || 40 }; }
        return { x: it.x, y: it.y, w: it.w || 0, h: it.h || 0 };
    }
    selBox() { const l = this.selItems().filter(i => i.t !== 'conn'); return l.length ? this.bounds(l) : null; }
    selItems() { return this.items.filter(i => this.sel.has(i.id)); }

    // ---------- Отрисовка предметов ----------
    renderAll() {
        this.reindex();
        this.els.forEach(el => el.remove()); this.els.clear(); this.cels.forEach(g => g.remove()); this.cels.clear();
        this.items.forEach(it => { if (it.t !== 'conn') this.paint(it); });
        this.items.forEach(it => { if (it.t === 'conn') this.drawConn(it); });
        this.placeHandles(); this.placeCtx(); this.drawMini();
    }
    mkEl(it) {
        const el = document.createElement('div'); el.dataset.id = it.id; this.els.set(it.id, el);
        this.world.insertBefore(el, this.selbox); return el;
    }
    dotsHtml() { return '<i class="bi-dot" data-s="t"></i><i class="bi-dot" data-s="r"></i><i class="bi-dot" data-s="b"></i><i class="bi-dot" data-s="l"></i>'; }
    place(it, el) {
        el.style.left = it.x + 'px'; el.style.top = it.y + 'px';
        if (it.t !== 'text') { el.style.width = it.w + 'px'; el.style.height = it.h + 'px'; } else el.style.width = it.w + 'px';
        el.style.zIndex = it.t === 'frame' ? 1 : 10 + (it.z || 0);
    }
    paint(it) {
        if (it.t === 'conn') { this.drawConn(it); return; }
        let el = this.els.get(it.id) || this.mkEl(it);
        el.className = 'bi bi-' + it.t + (this.sel.has(it.id) ? ' is-sel' : '') + (it.locked ? ' is-locked' : '') + (it.g ? ' is-grp' : '');
        this.place(it, el);
        const dots = this.dotsHtml(), lock = it.locked ? '<i class="bi-lock">' + ic('lock') + '</i>' : '';
        const txt = (cls, text, style) => '<div class="' + cls + '"' + (style ? ' style="' + style + '"' : '') + '>' + esc(text || '') + '</div>';
        el.style.background = ''; el.style.color = ''; el.style.border = ''; el.style.borderRadius = '';
        switch (it.t) {
            case 'sticky':
                el.style.background = it.c; el.style.color = bdInk(it.c);
                el.innerHTML = txt('bi-txt', it.text, '--fs:' + (it.fs || 18) + 'px') + dots + lock; break;
            case 'text':
                el.style.color = it.ink || ''; el.style.textAlign = it.al || 'left';
                el.innerHTML = txt('bi-txt', it.text, '--fs:' + (it.fs || 24) + 'px') + dots + lock; break;
            case 'shape': {
                const kind = it.shape || 'rect', fill = it.fill === 'none' ? 'transparent' : (it.fill || '#fff'), stroke = it.stroke || '#79747e';
                el.style.color = it.ink || bdInk(it.fill);
                let bg = '';
                if (kind === 'rect' || kind === 'round' || kind === 'ellipse') {
                    el.style.background = fill; el.style.border = '2px solid ' + stroke; el.style.borderRadius = kind === 'ellipse' ? '50%' : kind === 'round' ? '20px' : '4px';
                } else {
                    const w = it.w, h = it.h; const pts = kind === 'diamond' ? [[w / 2, 1], [w - 1, h / 2], [w / 2, h - 1], [1, h / 2]] : kind === 'triangle' ? [[w / 2, 1], [w - 1, h - 1], [1, h - 1]] : [[w * .25, 1], [w * .75, 1], [w - 1, h / 2], [w * .75, h - 1], [w * .25, h - 1], [1, h / 2]];
                    bg = '<svg class="bs-svg" viewBox="0 0 ' + w + ' ' + h + '" width="' + w + '" height="' + h + '"><polygon points="' + pts.map(p => p.join(',')).join(' ') + '" fill="' + fill + '" stroke="' + stroke + '" stroke-width="2" stroke-linejoin="round"/></svg>';
                }
                el.innerHTML = bg + txt('bi-txt' + (kind === 'triangle' ? ' is-tri' : ''), it.text, '--fs:' + (it.fs || 18) + 'px') + dots + lock; break;
            }
            case 'frame': {
                const c = it.c || '#8e8a98';
                el.style.background = 'color-mix(in srgb, ' + c + ' 9%, transparent)'; el.style.border = '2px solid color-mix(in srgb, ' + c + ' 55%, transparent)'; el.style.borderRadius = '10px';
                el.innerHTML = '<div class="bf-title" style="color:' + c + '">' + esc(it.title || 'Рамка') + '</div>' + dots + lock; break;
            }
            case 'image':
                el.innerHTML = '<img alt="' + esc(it.name || '') + '" draggable="false">' + dots + lock; this.loadImg(el.querySelector('img'), it.imgId); break;
            case 'pen': {
                const pts = (it.pts || []).map(p => p[0] + ',' + p[1]).join(' ');
                el.innerHTML = '<svg viewBox="0 0 ' + (it.ow || 1) + ' ' + (it.oh || 1) + '" width="' + it.w + '" height="' + it.h + '" preserveAspectRatio="none" style="overflow:visible"><polyline points="' + pts + '" fill="none" stroke="' + esc(it.color) + '" stroke-width="' + (it.width || 3) + '" stroke-linecap="round" stroke-linejoin="round"/></svg>' + lock; break;
            }
            case 'card': {
                const k = bdKind(BD_CARD_KINDS, it.kind), col = it.c || k.c;
                el.innerHTML = '<div class="bc-head" style="background:' + col + '">' + ic(k.i) + '<span>' + esc(k.n) + '</span></div>' + (it.imgId ? '<div class="bc-img"></div>' : '') +
                    '<div class="bc-body"><div class="bc-title' + (it.title ? '' : ' is-ph') + '">' + esc(it.title || 'Без названия') + '</div>' + (it.text ? '<div class="bc-text">' + esc(it.text) + '</div>' : '') +
                    ((it.tags || []).length ? '<div class="bc-tags">' + it.tags.map(t => '<span>#' + esc(t) + '</span>').join('') + '</div>' : '') + '</div>' + dots + lock;
                if (it.imgId) this.loadBg(el.querySelector('.bc-img'), it.imgId); break;
            }
            case 'block': {
                const k = bdKind(BD_PLOT_KINDS, it.kind), n = (it.intro || []).length, st = BD_PLOT_STATUS.find(s => s.k === it.status);
                const chars = (this.game && this.game.chars || []).filter(c => (it.chars || []).includes(c.id));
                el.classList.add('st-' + (it.status || 'plan'));
                el.innerHTML = '<div class="bc-head" style="background:' + k.c + '">' + ic(k.i) + '<span>' + esc(k.n) + '</span>' + (st && it.status !== 'plan' ? '<em class="bk-st">' + esc(st.n) + '</em>' : '') + '</div>' +
                    '<div class="bc-body"><div class="bc-title' + (it.title ? '' : ' is-ph') + '">' + esc(it.title || 'Без названия') + '</div>' + (it.text ? '<div class="bc-text">' + esc(it.text) + '</div>' : '') + '</div>' +
                    '<div class="bk-foot">' + (n ? '<span class="bk-chip">' + ic('notes') + n + '</span>' : '') + chars.slice(0, 4).map(c => '<span class="bk-av" title="' + esc(c.name) + '">' + esc((c.name || '?').trim().charAt(0).toUpperCase()) + '</span>').join('') + (chars.length > 4 ? '<span class="bk-av">+' + (chars.length - 4) + '</span>' : '') + ((it.tags || []).length ? '<span class="bk-tags">' + it.tags.map(t => '#' + esc(t)).join(' ') + '</span>' : '') + '</div>' + dots + lock;
                break;
            }
        }
    }
    async loadImg(img, id) {
        if (!img) return; const u = id ? await BlobDB.url(id, 'thumb') : ''; const full = id ? await BlobDB.url(id) : '';
        if (u || full) { img.src = full || u; } else img.parentNode && img.parentNode.classList.add('is-missing');
    }
    async loadBg(el, id) { if (!el) return; const u = await BlobDB.url(id, 'thumb'); if (u) el.style.backgroundImage = 'url("' + u + '")'; }
    refreshSel() {
        this.els.forEach((el, id) => el.classList.toggle('is-sel', this.sel.has(id)));
        this.cels.forEach((g, id) => g.classList.toggle('is-sel', this.sel.has(id)));
        this.items.forEach(i => { if (i.t === 'conn') this.drawConn(i); });
        this.placeHandles(); this.placeCtx();
    }

    // ---------- Связи ----------
    anchorOf(end, other) {
        if (end && end.id) {
            const t = this.byId(end.id);
            if (t && t.t !== 'conn') {
                const b = this.box(t); let side = end.side;
                if (!side || side === 'auto') {
                    const cx = b.x + b.w / 2, cy = b.y + b.h / 2, dx = other.x - cx, dy = other.y - cy;
                    side = Math.abs(dx) / Math.max(b.w / 2, 1) > Math.abs(dy) / Math.max(b.h / 2, 1) ? (dx > 0 ? 'r' : 'l') : (dy > 0 ? 'b' : 't');
                }
                return side === 't' ? { x: b.x + b.w / 2, y: b.y, side } : side === 'b' ? { x: b.x + b.w / 2, y: b.y + b.h, side } : side === 'l' ? { x: b.x, y: b.y + b.h / 2, side } : { x: b.x + b.w, y: b.y + b.h / 2, side };
            }
        }
        return { x: (end && end.x) || 0, y: (end && end.y) || 0, side: null };
    }
    centerOfEnd(end) {
        if (end && end.id) { const t = this.byId(end.id); if (t && t.t !== 'conn') { const b = this.box(t); return { x: b.x + b.w / 2, y: b.y + b.h / 2 }; } }
        return { x: (end && end.x) || 0, y: (end && end.y) || 0 };
    }
    connGeom(it) {
        const c1 = this.centerOfEnd(it.from), c2 = this.centerOfEnd(it.to);
        const p1 = this.anchorOf(it.from, c2), p2 = this.anchorOf(it.to, c1);
        const nv = s => s === 't' ? [0, -1] : s === 'b' ? [0, 1] : s === 'l' ? [-1, 0] : s === 'r' ? [1, 0] : null;
        const dist = Math.hypot(p2.x - p1.x, p2.y - p1.y) || 1;
        const dir = (a, b) => [(b.x - a.x) / dist, (b.y - a.y) / dist];
        let d, a1, a2, mid, pts = null;
        const style = it.style || 'curve';
        if (style === 'straight') {
            d = 'M' + p1.x + ' ' + p1.y + 'L' + p2.x + ' ' + p2.y; a2 = Math.atan2(p2.y - p1.y, p2.x - p1.x); a1 = a2 + Math.PI; mid = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
        } else if (style === 'elbow') {
            const h1 = p1.side ? (p1.side === 'l' || p1.side === 'r') : Math.abs(p2.x - p1.x) >= Math.abs(p2.y - p1.y), h2 = p2.side ? (p2.side === 'l' || p2.side === 'r') : h1;
            if (h1 && h2) { const mx = (p1.x + p2.x) / 2; pts = [[p1.x, p1.y], [mx, p1.y], [mx, p2.y], [p2.x, p2.y]]; }
            else if (!h1 && !h2) { const my = (p1.y + p2.y) / 2; pts = [[p1.x, p1.y], [p1.x, my], [p2.x, my], [p2.x, p2.y]]; }
            else if (h1) pts = [[p1.x, p1.y], [p2.x, p1.y], [p2.x, p2.y]]; else pts = [[p1.x, p1.y], [p1.x, p2.y], [p2.x, p2.y]];
            d = 'M' + pts.map(p => p[0] + ' ' + p[1]).join('L');
            const L = pts.length; a2 = Math.atan2(pts[L - 1][1] - pts[L - 2][1], pts[L - 1][0] - pts[L - 2][0]); a1 = Math.atan2(pts[0][1] - pts[1][1], pts[0][0] - pts[1][0]);
            const m = pts.length === 4 ? { x: (pts[1][0] + pts[2][0]) / 2, y: (pts[1][1] + pts[2][1]) / 2 } : pts[1]; mid = { x: m.x, y: m.y };
        } else {
            const k = Math.max(40, dist * 0.42); const n1 = nv(p1.side) || dir(p1, p2), n2 = nv(p2.side) || dir(p2, p1).map(v => v);
            const n2f = nv(p2.side) || [-(p2.x - p1.x) / dist, -(p2.y - p1.y) / dist];
            const q1 = { x: p1.x + n1[0] * k, y: p1.y + n1[1] * k }, q2 = { x: p2.x + n2f[0] * k, y: p2.y + n2f[1] * k };
            d = 'M' + p1.x + ' ' + p1.y + 'C' + q1.x + ' ' + q1.y + ' ' + q2.x + ' ' + q2.y + ' ' + p2.x + ' ' + p2.y;
            a2 = Math.atan2(p2.y - q2.y, p2.x - q2.x); a1 = Math.atan2(p1.y - q1.y, p1.x - q1.x);
            mid = { x: (p1.x + 3 * q1.x + 3 * q2.x + p2.x) / 8, y: (p1.y + 3 * q1.y + 3 * q2.y + p2.y) / 8 };
        }
        return { d, p1, p2, a1, a2, mid };
    }
    arrowPoly(p, ang, w) {
        const s = 9 + w * 1.6, ux = Math.cos(ang), uy = Math.sin(ang), px = -uy, py = ux;
        const bx = p.x - ux * s, by = p.y - uy * s, hw = s * 0.48;
        return p.x + ',' + p.y + ' ' + (bx + px * hw) + ',' + (by + py * hw) + ' ' + (bx - px * hw) + ',' + (by - py * hw);
    }
    drawConn(it, tmpGroup) {
        let g = tmpGroup || this.cels.get(it.id);
        if (!g) { g = document.createElementNS('http://www.w3.org/2000/svg', 'g'); g.dataset.id = it.id; this.gConns.appendChild(g); this.cels.set(it.id, g); }
        const geo = this.connGeom(it), w = it.width || 2, col = it.color || '#5f5b66', sel = this.sel.has(it.id);
        g.setAttribute('class', 'bc' + (sel ? ' is-sel' : '') + (it.locked ? ' is-locked' : ''));
        let h = '<path class="bc-hit" d="' + geo.d + '"/>';
        if (sel) h += '<path class="bc-glow" d="' + geo.d + '"/>';
        h += '<path class="bc-line" d="' + geo.d + '" fill="none" stroke="' + esc(col) + '" stroke-width="' + w + '" stroke-linecap="round" stroke-linejoin="round"' + (it.dash ? ' stroke-dasharray="' + (w * 3.2) + ' ' + (w * 2.6) + '"' : '') + '/>';
        if (it.head === 'end' || it.head === 'both') h += '<polygon class="bc-arrow" points="' + this.arrowPoly(geo.p2, geo.a2, w) + '" fill="' + esc(col) + '"/>';
        if (it.head === 'both') h += '<polygon class="bc-arrow" points="' + this.arrowPoly(geo.p1, geo.a1, w) + '" fill="' + esc(col) + '"/>';
        if (it.label) h += '<text class="bc-label" x="' + geo.mid.x + '" y="' + geo.mid.y + '" text-anchor="middle" dominant-baseline="central">' + esc(it.label) + '</text>';
        if (sel && !tmpGroup) h += '<circle class="bd-ep" data-end="from" cx="' + geo.p1.x + '" cy="' + geo.p1.y + '" r="7"/><circle class="bd-ep" data-end="to" cx="' + geo.p2.x + '" cy="' + geo.p2.y + '" r="7"/>';
        g.innerHTML = h;
    }
    redrawConns(ids) {
        this.items.forEach(i => { if (i.t === 'conn' && (!ids || (i.from && ids.has(i.from.id)) || (i.to && ids.has(i.to.id)))) this.drawConn(i); });
    }

    // ---------- Выделение ----------
    groupMembers(it) { return it.g ? this.items.filter(x => x.g === it.g) : [it]; }
    select(ids, add) {
        if (!add) this.sel.clear();
        (ids || []).forEach(id => { const it = this.byId(id); if (it) this.groupMembers(it).forEach(m => this.sel.add(m.id)); });
        this.refreshSel();
    }
    clearSel() { if (this.sel.size) { this.sel.clear(); this.refreshSel(); } }
    placeHandles() {
        const list = this.selItems();
        this.root.classList.toggle('is-multi', list.length > 1);   // при выборе нескольких предметов точки для стрелок не показываем
        const single = list.length === 1 ? list[0] : null;
        const b = this.selBox();
        if (!b || this.d && (this.d.type === 'move' && this.d.moved)) { this.hs.hidden = true; this.selbox.hidden = !b || !(list.length > 1); if (b) this.placeBox(this.selbox, b); return; }
        this.selbox.hidden = list.length < 2; if (list.length > 1) this.placeBox(this.selbox, b);
        const canResize = single && !single.locked && single.t !== 'conn';
        this.hs.hidden = !canResize;
        if (canResize) {
            this.placeBox(this.hs, b);
            const only = single.t === 'text' ? ['e', 'w'] : null;
            this.hs.querySelectorAll('.bd-h').forEach(h => { h.hidden = !!(only && !only.includes(h.dataset.d)); });
        }
    }
    placeBox(el, b) { el.style.left = b.x + 'px'; el.style.top = b.y + 'px'; el.style.width = b.w + 'px'; el.style.height = b.h + 'px'; }

    // ---------- Создание и удаление ----------
    nextZ() { return this.items.reduce((m, i) => Math.max(m, i.z || 0), 0) + 1; }
    addItem(it, opts) {
        opts = opts || {};
        if (it.z == null || it.t !== 'conn') it.z = this.nextZ();
        this.items.push(it); this.reindex(); this.paint(it);
        if (!opts.keepSel) { this.sel.clear(); this.sel.add(it.id); }
        this.refreshSel(); this.updateEmpty();
        if (!opts.noCommit) this.commit();
        return it;
    }
    removeItems(ids) {
        const set = new Set(ids);
        this.items.forEach(i => { if (i.t === 'conn' && ((i.from && set.has(i.from.id)) || (i.to && set.has(i.to.id)))) set.add(i.id); });
        const imgs = this.items.filter(i => set.has(i.id) && i.imgId).map(i => i.imgId);
        for (let n = this.items.length - 1; n >= 0; n--) if (set.has(this.items[n].id)) this.items.splice(n, 1);
        set.forEach(id => { const el = this.els.get(id); if (el) el.remove(); this.els.delete(id); const g = this.cels.get(id); if (g) g.remove(); this.cels.delete(id); this.sel.delete(id); });
        this.reindex(); this.refreshSel(); this.updateEmpty();
        this._dropImgs = (this._dropImgs || []).concat(imgs);
    }
    deleteSel() {
        const ids = this.selItems().filter(i => !i.locked).map(i => i.id);
        if (!ids.length) { if (this.sel.size) toast('Предмет закреплён — сначала открепите его'); return; }
        this.removeItems(ids); this.commit();
    }
    cloneItems(list, dx, dy) {
        const map = new Map(), out = [];
        list.forEach(i => { if (i.t === 'conn') return; const c = JSON.parse(JSON.stringify(i)); c.id = uid('b'); c.x += dx; c.y += dy; delete c.locked; map.set(i.id, c.id); out.push(c); });
        const gm = new Map(); out.forEach(c => { if (c.g) { if (!gm.has(c.g)) gm.set(c.g, uid('g')); c.g = gm.get(c.g); } });
        list.forEach(i => {
            if (i.t !== 'conn' || !i.from || !i.to) return;
            const fa = i.from.id ? map.get(i.from.id) : null, ta = i.to.id ? map.get(i.to.id) : null;
            if (i.from.id && !fa || i.to.id && !ta) return;
            const c = JSON.parse(JSON.stringify(i)); c.id = uid('b');
            if (fa) c.from = Object.assign({}, c.from, { id: fa }); else { c.from.x += dx; c.from.y += dy; }
            if (ta) c.to = Object.assign({}, c.to, { id: ta }); else { c.to.x += dx; c.to.y += dy; }
            out.push(c);
        });
        return out;
    }
    selWithConns() {
        const ids = this.sel; const base = this.selItems();
        const conns = this.items.filter(i => i.t === 'conn' && !ids.has(i.id) && i.from && i.to && i.from.id && i.to.id && ids.has(i.from.id) && ids.has(i.to.id));
        return base.concat(conns);
    }
    duplicate() {
        const list = this.selWithConns(); if (!list.length) return;
        const copies = this.cloneItems(list, 32, 32); let z = this.nextZ();
        copies.forEach(c => { if (c.t !== 'conn') c.z = z++; this.items.push(c); });
        this.reindex(); copies.forEach(c => this.paint(c)); this.sel.clear(); copies.forEach(c => this.sel.add(c.id)); this.refreshSel(); this.commit();
    }
    copy(cut) {
        const list = this.selWithConns(); if (!list.length) return;
        bdClip = JSON.stringify(list); bdPasteN = 0; toast(cut ? 'Вырезано: ' + list.filter(i => i.t !== 'conn').length : 'Скопировано: ' + list.filter(i => i.t !== 'conn').length);
        if (cut) this.deleteSel();
    }
    paste(at) {
        if (!bdClip) return false;
        let list; try { list = JSON.parse(bdClip); } catch (e) { return false; }
        const b = this.bounds(list.filter(i => i.t !== 'conn')); if (!b) return false;
        let dx, dy; bdPasteN++;
        if (at) { dx = at.x - (b.x + b.w / 2); dy = at.y - (b.y + b.h / 2); } else { dx = 32 * bdPasteN; dy = 32 * bdPasteN; }
        const copies = this.cloneItems(list, dx, dy); let z = this.nextZ();
        copies.forEach(c => { if (c.t !== 'conn') c.z = z++; this.items.push(c); });
        this.reindex(); copies.forEach(c => this.paint(c)); this.sel.clear(); copies.forEach(c => this.sel.add(c.id)); this.refreshSel(); this.updateEmpty(); this.commit();
        return true;
    }

    // ---------- История и сохранение ----------
    commit() {
        const s = JSON.stringify(this.items);
        if (s === this.hist[this.hi]) { this.syncUi && this.syncUi(); return; }
        this.hist.length = this.hi + 1; this.hist.push(s); if (this.hist.length > 80) this.hist.shift(); this.hi = this.hist.length - 1;
        this.persist(); this.drawMini(); this.syncUi && this.syncUi();
    }
    persist() {
        if (this.model) this.model.items = this.items;
        if (this._dropImgs && this._dropImgs.length) { const keep = dndMediaRefs(dndGames); this._dropImgs.forEach(id => { if (!keep.has(id)) { const g = this.game; if (g && g.files) delete g.files[id]; BlobDB.del(id); } }); this._dropImgs = []; }
        if (this.o.onChange) this.o.onChange(this.game);
    }
    restore(s) {
        const arr = JSON.parse(s); this.model.items = arr; this.items = arr; this.sel.forEach(id => { if (!arr.some(i => i.id === id)) this.sel.delete(id); });
        this.renderAll(); this.refreshSel(); this.updateEmpty(); this.persist();
    }
    undo() { if (this.hi > 0) { this.endEdit(true); this.hi--; this.restore(this.hist[this.hi]); this.syncUi && this.syncUi(); } }
    redo() { if (this.hi < this.hist.length - 1) { this.hi++; this.restore(this.hist[this.hi]); this.syncUi && this.syncUi(); } }

    // ---------- Правка текста на месте ----------
    startEdit(it, selectAll) {
        if (!it || it.locked) return;
        if (it.t === 'card' || it.t === 'block') { if (this.o.onEdit) this.o.onEdit(it, this); return; }
        if (it.t === 'conn') { this.editLabel(it); return; }
        const el = this.els.get(it.id); if (!el) return;
        const t = it.t === 'frame' ? el.querySelector('.bf-title') : el.querySelector('.bi-txt'); if (!t) return;
        this.endEdit();
        this.hs.hidden = true; this.ctx.hidden = true;
        t.contentEditable = 'true'; t.classList.add('is-editing'); this.editEl = t; this.editIt = it;
        t.focus({ preventScroll: true });
        try { const r = document.createRange(); r.selectNodeContents(t); if (!selectAll) r.collapse(false); const s = getSelection(); s.removeAllRanges(); s.addRange(r); } catch (e) {}
        t.onblur = () => this.endEdit();
        t.onkeydown = e => { e.stopPropagation(); if (e.key === 'Escape') { t.blur(); } else if (e.key === 'Enter' && (it.t === 'frame' || e.ctrlKey || e.metaKey)) { e.preventDefault(); t.blur(); } };
        t.onpaste = e => { e.preventDefault(); const tx = (e.clipboardData || window.clipboardData).getData('text/plain'); document.execCommand('insertText', false, tx); };
    }
    endEdit(skipCommit) {
        const t = this.editEl; if (!t) return;
        const it = this.editIt; this.editEl = null; this.editIt = null; t.onblur = null;
        t.contentEditable = 'false'; t.classList.remove('is-editing'); t.onkeydown = null; t.onpaste = null;
        const val = (t.innerText || '').replace(/\n+$/, '');
        if (it.t === 'frame') it.title = val.replace(/\n/g, ' ').trim() || 'Рамка'; else it.text = val;
        if (it.t === 'text' && !val.trim()) { this.removeItems([it.id]); } else this.paint(it);
        this.refreshSel(); if (!skipCommit) this.commit();
    }

    // ---------- Попадание ----------
    hitItem(wx, wy, skipId) {
        const list = this.items.filter(i => i.t !== 'conn' && i.t !== 'pen' && i.id !== skipId);
        list.sort((a, b) => (b.t === 'frame' ? -1e9 : b.z || 0) - (a.t === 'frame' ? -1e9 : a.z || 0));
        for (const i of list) { const b = this.box(i); if (wx >= b.x && wx <= b.x + b.w && wy >= b.y && wy <= b.y + b.h) return i; }
        return null;
    }
    setHot(id) {
        if (this.hot === id) return; const old = this.els.get(this.hot); if (old) old.classList.remove('is-hot');
        this.hot = id; const el = id && this.els.get(id); if (el) el.classList.add('is-hot');
    }
    snapV(v) { return this.snap ? Math.round(v / 24) * 24 : v; }
    cancelDrag() { if (this.d) { if (this.d.type === 'connect' || this.d.type === 'pen') this.gTmp.innerHTML = ''; this.bandEl.hidden = true; this.setHot(null); this.d = null; } }

    // ---------- События ----------
    bindEvents() {
        const v = this.v;
        v.addEventListener('pointerdown', e => this.onDown(e));
        v.addEventListener('pointermove', e => this.onMove(e));
        v.addEventListener('pointerup', e => this.onUp(e));
        v.addEventListener('pointercancel', e => this.onUp(e));
        v.addEventListener('wheel', e => {
            if (e.target.closest('.bd-ctx,.bd-pop')) return;
            e.preventDefault(); const k = e.deltaMode === 1 ? 33 : 1;
            this.zoomAt(e.clientX, e.clientY, this.view.z * Math.exp(-e.deltaY * k * (e.ctrlKey ? 0.01 : 0.0016)));
        }, { passive: false });
        v.addEventListener('dragover', e => { if (e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files')) e.preventDefault(); });
        v.addEventListener('drop', e => { if (!e.dataTransfer || !e.dataTransfer.files.length) return; e.preventDefault(); this.dropFiles(Array.from(e.dataTransfer.files), this.toWorld(e.clientX, e.clientY)); });
        document.addEventListener('keydown', e => this.onKey(e));
        document.addEventListener('keyup', e => { if (e.code === 'Space' && this.space) { this.space = false; this.v.classList.remove('is-space'); } });
        document.addEventListener('paste', e => this.onPaste(e));
        window.addEventListener('resize', debounce(() => { if (this.isActive()) this.applyView(); }, 150));
    }
    onDown(e) {
        if (e.pointerType === 'mouse' && e.button > 1) return;
        if (e.target.closest('.bd-ctx,.bd-pop,.bd-mini,.bd-empty button,.bd-hint button')) return;
        if (this.editEl && this.editEl.contains(e.target)) return;
        if (this.editEl) this.endEdit();
        this.closePop();
        this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
        try { this.v.setPointerCapture(e.pointerId); } catch (er) {}
        if (this.pointers.size === 2) { this.startPinch(); return; }
        if (this.pointers.size > 2) return;
        if (document.activeElement !== this.v && !(document.activeElement && document.activeElement.isContentEditable)) this.v.focus({ preventScroll: true });
        const tg = e.target, p = this.toWorld(e.clientX, e.clientY); this.mouseW = p;
        const touch = e.pointerType !== 'mouse';
        if (this.tool === 'hand' || this.space || e.button === 1) { e.preventDefault(); this.startPan(e); return; }
        const tool = this.tool;
        if (tool === 'pen') { this.d = { type: 'pen', pts: [[p.x, p.y]], last: p }; return; }
        if (tool === 'connect') {
            const itEl = tg.closest('.bi'); const it = itEl && this.byId(itEl.dataset.id);
            if (this.pendFrom) { if (it && it.id !== this.pendFrom) { this.makeConn({ id: this.pendFrom, side: 'auto' }, { id: it.id, side: 'auto' }); } this.pendFrom = null; this.hint(''); this.d = { type: 'none' }; return; }
            if (it) { this.d = { type: 'connect', from: { id: it.id, side: tg.closest('.bi-dot') ? tg.closest('.bi-dot').dataset.s : 'auto' }, sx: e.clientX, sy: e.clientY, moved: false }; return; }
            this.startPan(e); return;
        }
        if (tool !== 'select') { this.d = { type: 'create', tool, arg: this.toolArg, sx: e.clientX, sy: e.clientY, p0: p, moved: false }; return; }
        // --- режим «Выбор» ---
        const hnd = tg.closest('.bd-h'); if (hnd) { this.startResize(hnd.dataset.d, e); return; }
        const ep = tg.closest('.bd-ep'); if (ep) { const c = this.byId(ep.parentNode.dataset.id); if (c && !c.locked) { this.d = { type: 'reconn', it: c, end: ep.dataset.end }; return; } }
        const dot = tg.closest('.bi-dot');
        if (dot) { const it = this.byId(dot.parentNode.dataset.id); if (it) { this.d = { type: 'connect', from: { id: it.id, side: dot.dataset.s }, sx: e.clientX, sy: e.clientY, moved: false }; return; } }
        const itEl = tg.closest('.bi'); const it = itEl && this.byId(itEl.dataset.id);
        const cEl = !it && tg.closest('.bc'); const cn = cEl && this.byId(cEl.dataset.id);
        const now = performance.now(), ld = this.lastDown;
        const dbl = ld && now - ld.t < 380 && Math.hypot(e.clientX - ld.x, e.clientY - ld.y) < 14 && ((it && ld.id === it.id) || (cn && ld.id === cn.id) || (!it && !cn && !ld.id));
        this.lastDown = { t: now, x: e.clientX, y: e.clientY, id: it ? it.id : cn ? cn.id : null };
        if (dbl) { this.lastDown = null; this.onDouble(it || cn, p); this.d = { type: 'none' }; return; }
        if (it) {
            const shift = e.shiftKey || e.ctrlKey || e.metaKey;
            const was = this.sel.has(it.id);
            if (!was) { if (shift) this.select([it.id], true); else this.select([it.id]); }
            else if (shift) { this.groupMembers(it).forEach(m => this.sel.delete(m.id)); this.refreshSel(); this.d = { type: 'none' }; return; }
            if (it.locked) { this.d = { type: 'none' }; return; }
            this.startMove(it, e, was); return;
        }
        if (cn) { if (e.shiftKey) this.select([cn.id], true); else this.select([cn.id]); this.d = { type: 'none' }; return; }
        // пустое место
        if (!e.shiftKey) this.clearSel();
        if (touch) { this.startPan(e); this.d.tap = true; return; }
        this.d = { type: 'band', sx: e.clientX, sy: e.clientY, base: e.shiftKey ? new Set(this.sel) : new Set(), moved: false };
    }
    onDouble(target, p) {
        if (!target) {
            if (this.tool !== 'select') return;
            const it = this.mode === 'plot' ? this.newBlock(p.x, p.y) : bdItem('sticky', { x: p.x - 100, y: p.y - 100 });
            this.addItem(it, { noCommit: true });
            if (this.mode === 'plot') { this.commit(); if (this.o.onEdit) this.o.onEdit(it, this); } else setTimeout(() => this.startEdit(it, true), 30);
            return;
        }
        if (target.locked) { toast('Предмет закреплён'); return; }
        if (target.t === 'image') { if (this.o.onImage) this.o.onImage(target); return; }
        if (target.t === 'pen') return;
        this.startEdit(target, target.t !== 'text' || !!target.text ? false : true);
    }
    newBlock(wx, wy, kind) { return bdItem('block', { x: Math.round(wx - 120), y: Math.round(wy - 60), kind: kind || 'scene' }); }
    startPan(e) { this.d = { type: 'pan', sx: e.clientX, sy: e.clientY, vx: this.view.x, vy: this.view.y }; this.v.classList.add('is-panning'); }
    startPinch() {
        this.cancelDrag(); const [a, b] = Array.from(this.pointers.values());
        this.d = { type: 'pinch', dist: Math.hypot(a.x - b.x, a.y - b.y) || 1, z0: this.view.z, cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2, vx: this.view.x, vy: this.view.y };
    }
    startMove(it, e, wasSel) {
        const ids = new Set(this.sel);
        this.selItems().forEach(f => {
            if (f.t !== 'frame') return; const fb = this.box(f);
            this.items.forEach(o => { if (o.t === 'conn' || ids.has(o.id) || o.t === 'frame' && o.id === f.id) return; const b = this.box(o); const cx = b.x + b.w / 2, cy = b.y + b.h / 2; if (cx >= fb.x && cx <= fb.x + fb.w && cy >= fb.y && cy <= fb.y + fb.h && !o.locked) ids.add(o.id); });
        });
        const origs = new Map(); this.items.forEach(o => { if (ids.has(o.id) && o.t !== 'conn' && !o.locked) origs.set(o.id, { x: o.x, y: o.y }); });
        this.d = { type: 'move', sx: e.clientX, sy: e.clientY, origs, leader: it.id, moved: false, wasSel };
    }
    startResize(dir, e) {
        const it = this.selItems()[0]; if (!it) return;
        const b = this.box(it);
        this.d = { type: 'resize', dir, it, b0: b, sx: e.clientX, sy: e.clientY, ratio: b.w / Math.max(b.h, 1), moved: false };
    }
    onMove(e) {
        if (this.pointers.has(e.pointerId)) this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
        const p = this.toWorld(e.clientX, e.clientY); this.mouseW = p;
        const d = this.d; if (!d) return;
        const z = this.view.z;
        switch (d.type) {
            case 'pinch': {
                if (this.pointers.size < 2) return; const [a, b] = Array.from(this.pointers.values());
                const dist = Math.hypot(a.x - b.x, a.y - b.y) || 1, cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2, r = this.v.getBoundingClientRect();
                const nz = bdClamp(d.z0 * dist / d.dist, 0.08, 3);
                const wx = (d.cx - r.left - d.vx) / d.z0, wy = (d.cy - r.top - d.vy) / d.z0;
                this.view.z = nz; this.view.x = cx - r.left - wx * nz; this.view.y = cy - r.top - wy * nz; this.applyView(); break;
            }
            case 'pan': {
                const dx = e.clientX - d.sx, dy = e.clientY - d.sy; if (Math.abs(dx) + Math.abs(dy) > 3) d.moved = true;
                this.view.x = d.vx + dx; this.view.y = d.vy + dy; this.applyView(); break;
            }
            case 'band': {
                const dx = e.clientX - d.sx, dy = e.clientY - d.sy; if (!d.moved && Math.hypot(dx, dy) < 4) return; d.moved = true;
                const r = this.v.getBoundingClientRect();
                const x0 = Math.min(d.sx, e.clientX) - r.left, y0 = Math.min(d.sy, e.clientY) - r.top, w = Math.abs(dx), h = Math.abs(dy);
                this.bandEl.hidden = false; Object.assign(this.bandEl.style, { left: x0 + 'px', top: y0 + 'px', width: w + 'px', height: h + 'px' });
                const a = this.toWorld(Math.min(d.sx, e.clientX), Math.min(d.sy, e.clientY)), b = this.toWorld(Math.max(d.sx, e.clientX), Math.max(d.sy, e.clientY));
                const inside = new Set(d.base);
                this.items.forEach(i => { if (i.t === 'conn') return; const bb = this.box(i); if (bb.x < b.x && bb.x + bb.w > a.x && bb.y < b.y && bb.y + bb.h > a.y) this.groupMembers(i).forEach(m => inside.add(m.id)); });
                this.items.forEach(i => { if (i.t === 'conn' && i.from && i.to && i.from.id && i.to.id && inside.has(i.from.id) && inside.has(i.to.id)) inside.add(i.id); });
                this.sel = inside; this.els.forEach((el, id) => el.classList.toggle('is-sel', inside.has(id))); this.cels.forEach((g, id) => g.classList.toggle('is-sel', inside.has(id))); this.placeHandles(); break;
            }
            case 'move': {
                const dx = (e.clientX - d.sx) / z, dy = (e.clientY - d.sy) / z;
                if (!d.moved) { if (Math.hypot(e.clientX - d.sx, e.clientY - d.sy) < 4) return; d.moved = true; this.ctx.hidden = true; this.hs.hidden = true; this.v.classList.add('is-dragging'); }
                const lead = d.origs.get(d.leader); let sx = 0, sy = 0;
                if (this.snap && lead) { sx = this.snapV(lead.x + dx) - (lead.x + dx); sy = this.snapV(lead.y + dy) - (lead.y + dy); }
                d.origs.forEach((o, id) => { const it = this.byId(id); if (!it) return; it.x = Math.round(o.x + dx + sx); it.y = Math.round(o.y + dy + sy); const el = this.els.get(id); if (el) { el.style.left = it.x + 'px'; el.style.top = it.y + 'px'; } });
                this.redrawConns(new Set(d.origs.keys())); this.placeBox(this.selbox, this.selBox() || { x: 0, y: 0, w: 0, h: 0 }); this.selbox.hidden = this.selItems().length < 2; this.drawMini(); break;
            }
            case 'resize': this.doResize(e, d); break;
            case 'create': {
                const dx = e.clientX - d.sx, dy = e.clientY - d.sy; if (!d.moved && Math.hypot(dx, dy) < 6) return;
                if (d.tool === 'sticky' || d.tool === 'text' && false) return;
                d.moved = true; const r = this.v.getBoundingClientRect();
                this.bandEl.hidden = false; this.bandEl.classList.add('is-draw');
                Object.assign(this.bandEl.style, { left: Math.min(d.sx, e.clientX) - r.left + 'px', top: Math.min(d.sy, e.clientY) - r.top + 'px', width: Math.abs(dx) + 'px', height: Math.abs(dy) + 'px' }); break;
            }
            case 'pen': {
                const l = d.last; if (Math.hypot(p.x - l.x, p.y - l.y) * z < 2.2) return; d.pts.push([p.x, p.y]); d.last = p;
                this.gTmp.innerHTML = '<polyline class="bd-pen-tmp" points="' + d.pts.map(q => q[0] + ',' + q[1]).join(' ') + '" fill="none" stroke="' + esc(this.penColor || '#1d1b20') + '" stroke-width="' + (this.penWidth || 3) + '" stroke-linecap="round" stroke-linejoin="round"/>'; break;
            }
            case 'connect': {
                if (!d.moved && Math.hypot(e.clientX - d.sx, e.clientY - d.sy) < 5) return; d.moved = true;
                const tgt = this.hitItem(p.x, p.y, d.from.id); this.setHot(tgt ? tgt.id : null);
                const tmp = { id: '_tmp', t: 'conn', from: d.from, to: tgt ? { id: tgt.id, side: 'auto' } : { x: p.x, y: p.y }, style: this.connStyle || 'curve', head: this.connHead || 'end', color: this.connColor || '#5f5b66', width: 2, dash: false };
                this.gTmp.innerHTML = ''; const g = document.createElementNS('http://www.w3.org/2000/svg', 'g'); this.gTmp.appendChild(g); this.drawConn(tmp, g); g.setAttribute('class', 'bc is-tmp'); break;
            }
            case 'reconn': {
                d.moved = true; const tgt = this.hitItem(p.x, p.y, d.end === 'from' ? (d.it.to && d.it.to.id) : (d.it.from && d.it.from.id));
                this.setHot(tgt ? tgt.id : null); d.it[d.end] = tgt ? { id: tgt.id, side: 'auto' } : { x: p.x, y: p.y }; this.drawConn(d.it); break;
            }
            default: break;
        }
    }
    doResize(e, d) {
        const z = this.view.z, dx = (e.clientX - d.sx) / z, dy = (e.clientY - d.sy) / z, it = d.it, b = d.b0, dir = d.dir;
        if (!d.moved && Math.hypot(dx, dy) * z < 3) return; d.moved = true;
        let x = b.x, y = b.y, w = b.w, h = b.h;
        const minW = it.t === 'text' ? 60 : it.t === 'sticky' ? 70 : 50, minH = it.t === 'sticky' ? 70 : 36;
        if (dir.includes('e')) w = Math.max(minW, b.w + dx); if (dir.includes('s')) h = Math.max(minH, b.h + dy);
        if (dir.includes('w')) { w = Math.max(minW, b.w - dx); x = b.x + b.w - w; } if (dir.includes('n')) { h = Math.max(minH, b.h - dy); y = b.y + b.h - h; }
        if ((it.t === 'image' || e.shiftKey) && dir.length === 2) {
            const nh = w / d.ratio; if (dir.includes('n')) y = b.y + b.h - nh; h = nh;
        } else if (it.t === 'image' && dir.length === 1) { if (dir === 'e' || dir === 'w') h = w / d.ratio; else w = h * d.ratio; }
        if (this.snap) { w = Math.max(minW, Math.round(w / 24) * 24); if (it.t !== 'text') h = Math.max(minH, Math.round(h / 24) * 24); }
        it.x = Math.round(x); it.y = Math.round(y); it.w = Math.round(w); if (it.t !== 'text') it.h = Math.round(h);
        this.paint(it); this.redrawConns(new Set([it.id])); this.placeHandles(); this.drawMini();
    }
    onUp(e) {
        const had = this.pointers.has(e.pointerId); this.pointers.delete(e.pointerId);
        try { this.v.releasePointerCapture(e.pointerId); } catch (er) {}
        const d = this.d; if (!had) return;
        if (d && d.type === 'pinch') { if (this.pointers.size < 2) { this.d = null; this.applyView(); } return; }
        if (!d) return; this.d = null; this.v.classList.remove('is-panning', 'is-dragging');
        const p = this.toWorld(e.clientX, e.clientY);
        switch (d.type) {
            case 'pan': if (d.tap && !d.moved) { /* касание пустого места */ } if (this.tool === 'connect' && !d.moved && this.pendFrom) { this.pendFrom = null; this.hint(''); } break;
            case 'band': this.bandEl.hidden = true; this.refreshSel(); break;
            case 'move':
                if (d.moved) { this.commit(); this.placeHandles(); this.placeCtx(); }
                else if (!d.moved && d.wasSel && this.sel.size > 1 && !(e.shiftKey || e.ctrlKey || e.metaKey)) { const it = this.byId(d.leader); this.select([it.id]); }
                else { this.placeCtx(); }
                break;
            case 'resize': this.commit(); this.placeCtx(); break;
            case 'create': {
                this.bandEl.hidden = true; this.bandEl.classList.remove('is-draw');
                let rect = null;
                if (d.moved) { const a = this.toWorld(Math.min(d.sx, e.clientX), Math.min(d.sy, e.clientY)), b = this.toWorld(Math.max(d.sx, e.clientX), Math.max(d.sy, e.clientY)); rect = { x: a.x, y: a.y, w: Math.max(40, b.x - a.x), h: Math.max(30, b.y - a.y) }; }
                this.createAt(d.tool, d.arg, d.p0, rect); break;
            }
            case 'pen': this.finishPen(d); break;
            case 'connect': {
                this.gTmp.innerHTML = ''; const hot = this.hot; this.setHot(null);
                if (d.moved) {
                    const tgt = hot && this.byId(hot);
                    const c = this.makeConn(d.from, tgt ? { id: tgt.id, side: 'auto' } : { x: Math.round(p.x), y: Math.round(p.y) });
                    if (!tgt && Math.hypot(p.x - this.centerOfEnd(d.from).x, p.y - this.centerOfEnd(d.from).y) < 30) { this.removeItems([c.id]); this.commit(); }
                } else if (this.tool === 'connect') { this.pendFrom = d.from.id; this.hint('Нажмите на вторую карточку, чтобы соединить'); }
                break;
            }
            case 'reconn': this.setHot(null); if (d.moved) { this.commit(); this.refreshSel(); } break;
            default: break;
        }
    }
    hint(t) { this.hintEl.hidden = !t; this.hintEl.textContent = t || ''; }
    makeConn(from, to) {
        const c = bdItem('conn', { from, to, style: this.connStyle || 'curve', head: this.connHead || 'end', color: this.connColor || '#5f5b66' });
        c.z = 0; this.items.push(c); this.reindex(); this.sel.clear(); this.sel.add(c.id); this.drawConn(c); this.refreshSel(); this.commit(); return c;
    }

    // ---------- Создание инструментом ----------
    createAt(tool, arg, p, rect) {
        let it = null;
        const cx = p.x, cy = p.y;
        if (tool === 'sticky') it = bdItem('sticky', { x: cx - 100, y: cy - 100, c: arg || dndCfg.stickyColor });
        else if (tool === 'card') it = bdItem('card', { x: cx - 130, y: cy - 85, kind: arg || 'note' });
        else if (tool === 'block') it = this.newBlock(cx, cy, arg);
        else if (tool === 'text') it = bdItem('text', { x: cx - 20, y: cy - 16, w: rect ? rect.w : 240, text: '' });
        else if (tool === 'shape') it = bdItem('shape', { x: cx - 80, y: cy - 60, shape: arg || 'rect' });
        else if (tool === 'frame') it = bdItem('frame', { x: cx - 240, y: cy - 160 });
        if (!it) return;
        if (rect && tool !== 'sticky') { it.x = Math.round(rect.x); it.y = Math.round(rect.y); it.w = Math.round(rect.w); if (tool !== 'text') it.h = Math.round(rect.h); }
        if (tool === 'frame' || tool === 'shape' || tool === 'card' || tool === 'block' || tool === 'sticky' || tool === 'text') { it.x = Math.round(this.snapV(it.x)); it.y = Math.round(this.snapV(it.y)); }
        if (tool === 'frame') { it.z = 0; }
        this.addItem(it, { noCommit: true });
        this.setTool('select');
        if (tool === 'card' || tool === 'block') { this.commit(); if (this.o.onEdit) this.o.onEdit(it, this); }
        else if (tool === 'frame') { this.commit(); setTimeout(() => this.startEdit(it, true), 30); }
        else { this.commit(); setTimeout(() => this.startEdit(it, true), 30); }
    }
    finishPen(d) {
        this.gTmp.innerHTML = '';
        if (d.pts.length < 2) { if (d.pts.length === 1) d.pts.push([d.pts[0][0] + 0.1, d.pts[0][1] + 0.1]); else return; }
        // прореживание: оставляем точки не чаще, чем раз в 1.5 px холста
        const out = [d.pts[0]]; d.pts.forEach(q => { const l = out[out.length - 1]; if (Math.hypot(q[0] - l[0], q[1] - l[1]) > 1.5) out.push(q); });
        const last = d.pts[d.pts.length - 1]; if (out[out.length - 1] !== last) out.push(last);
        let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9; out.forEach(q => { x0 = Math.min(x0, q[0]); y0 = Math.min(y0, q[1]); x1 = Math.max(x1, q[0]); y1 = Math.max(y1, q[1]); });
        const pad = (this.penWidth || 3), w = Math.max(1, x1 - x0), h = Math.max(1, y1 - y0);
        const it = bdItem('pen', { x: Math.round(x0), y: Math.round(y0), w: Math.round(w), h: Math.round(h), ow: Math.round(w), oh: Math.round(h), pts: out.map(q => [+(q[0] - x0).toFixed(1), +(q[1] - y0).toFixed(1)]), color: this.penColor || '#1d1b20', width: this.penWidth || 3 });
        it.w = Math.max(it.w, 1); it.h = Math.max(it.h, 1);
        this.addItem(it, { keepSel: true });
    }

    // ---------- Колесо, клавиши, вставка ----------
    onKey(e) {
        if (!this.isActive()) return;
        const a = document.activeElement; if (a && (a.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName))) return;
        if (document.body.classList.contains('is-locked')) return;
        const mod = e.ctrlKey || e.metaKey, code = e.code;
        if (code === 'Space' && !mod) { e.preventDefault(); if (!this.space) { this.space = true; this.v.classList.add('is-space'); } return; }
        if (mod && code === 'KeyZ') { e.preventDefault(); e.shiftKey ? this.redo() : this.undo(); return; }
        if (mod && code === 'KeyY') { e.preventDefault(); this.redo(); return; }
        if (mod && code === 'KeyA') { e.preventDefault(); this.select(this.items.map(i => i.id)); return; }
        if (mod && code === 'KeyC') { if (this.sel.size) { e.preventDefault(); this.copy(false); } return; }
        if (mod && code === 'KeyX') { if (this.sel.size) { e.preventDefault(); this.copy(true); } return; }
        if (mod && code === 'KeyD') { e.preventDefault(); this.duplicate(); return; }
        if (mod && code === 'KeyG') { e.preventDefault(); e.shiftKey ? this.ungroup() : this.group(); return; }
        if (mod) return;
        if (code === 'Delete' || code === 'Backspace') { if (this.sel.size) { e.preventDefault(); this.deleteSel(); } return; }
        if (code === 'Escape') { if (this.pendFrom) { this.pendFrom = null; this.hint(''); } else if (this.tool !== 'select') this.setTool('select'); else this.clearSel(); this.closePop(); return; }
        if (code === 'Enter' && this.sel.size === 1) { const it = this.selItems()[0]; if (it && it.t !== 'conn') { e.preventDefault(); this.startEdit(it, false); } return; }
        if (code.startsWith('Arrow') && this.sel.size) {
            e.preventDefault(); const st = e.shiftKey ? 24 : 4, dx = code === 'ArrowLeft' ? -st : code === 'ArrowRight' ? st : 0, dy = code === 'ArrowUp' ? -st : code === 'ArrowDown' ? st : 0;
            const moved = new Set(); this.selItems().forEach(i => { if (i.t === 'conn' || i.locked) return; i.x += dx; i.y += dy; moved.add(i.id); this.paint(i); });
            this.redrawConns(moved); this.placeHandles(); this.placeCtx(); clearTimeout(this._nt); this._nt = setTimeout(() => this.commit(), 350); return;
        }
        const keys = this.mode === 'plot' ? { KeyV: 'select', KeyH: 'hand', KeyN: 'block', KeyB: 'block', KeyT: 'text', KeyF: 'frame', KeyC: 'connect' } : { KeyV: 'select', KeyH: 'hand', KeyN: 'sticky', KeyK: 'card', KeyT: 'text', KeyR: 'shape', KeyF: 'frame', KeyC: 'connect', KeyP: 'pen' };
        if (keys[code]) { e.preventDefault(); this.setTool(keys[code]); }
        if (code === 'Equal' || code === 'NumpadAdd') this.zoomBy(1.2); if (code === 'Minus' || code === 'NumpadSubtract') this.zoomBy(1 / 1.2); if (code === 'Digit0') { this.view.z = 1; this.applyView(); } if (code === 'Digit1' && e.shiftKey) this.fit();
    }
    async onPaste(e) {
        if (!this.isActive()) return;
        const a = document.activeElement; if (a && (a.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName))) return;
        if (document.body.classList.contains('is-locked')) return;
        const cd = e.clipboardData; if (!cd) return;
        const files = Array.from(cd.files || []).filter(f => /^image\//.test(f.type));
        if (files.length) { e.preventDefault(); this.dropFiles(files, this.viewCenter()); return; }
        const text = cd.getData('text/plain');
        if (text && text.trim() && !bdClip) { e.preventDefault(); const c = this.viewCenter(); this.addItem(bdItem('sticky', { x: c.x - 100, y: c.y - 100, text: text.trim().slice(0, 1200) })); return; }
        if (bdClip) { e.preventDefault(); const r = this.v.getBoundingClientRect(); this.paste(null); return; }
        if (text && text.trim()) { e.preventDefault(); const c = this.viewCenter(); this.addItem(bdItem('sticky', { x: c.x - 100, y: c.y - 100, text: text.trim().slice(0, 1200) })); }
    }
    async dropFiles(files, p) {
        if (!this.game) return; const imgs = files.filter(f => /^image\//.test(f.type) || /\.(png|jpe?g|gif|webp|svg)$/i.test(f.name)), rest = files.filter(f => !imgs.includes(f));
        let n = 0;
        for (const f of imgs) {
            try {
                const r = await dndAddImage(this.game, f); const k = Math.min(1, 360 / Math.max(r.w || 360, 1));
                const w = Math.round((r.w || 360) * k), h = Math.round((r.h || 240) * k);
                this.addItem(bdItem('image', { x: Math.round(p.x - w / 2 + n * 30), y: Math.round(p.y - h / 2 + n * 30), w, h, imgId: r.id, name: f.name }), { noCommit: true }); n++;
            } catch (e) { console.error(e); toast('Не удалось добавить картинку «' + f.name + '»'); }
        }
        if (n) this.commit();
        if (rest.length && typeof dndImportFiles === 'function') {
            const res = await dndImportFiles(rest, { mode: 'active', as: 'card', cols: dndCfg.cols });
            if (res.items.length) { const b = this.bounds(); dndShiftItems(res.items, this.items); let z = this.nextZ(); res.items.forEach(i => { i.z = z++; this.items.push(i); }); this.reindex(); this.renderAll(); this.commit(); this.fit(); toast('Добавлено: ' + (dndImportSummary(res) || 'готово')); }
            else if (res.notes.length) toast(res.notes[0]); else if (!n) toast('Этот файл не удалось добавить на доску');
        }
        this.updateEmpty();
    }

    // ---------- Группы, порядок, выравнивание ----------
    group() {
        const l = this.selItems().filter(i => i.t !== 'conn'); if (l.length < 2) { toast('Выделите несколько предметов'); return; }
        const g = uid('g'); l.forEach(i => { i.g = g; this.paint(i); }); this.refreshSel(); this.commit(); toast('Сгруппировано');
    }
    ungroup() { const l = this.selItems().filter(i => i.g); if (!l.length) return; l.forEach(i => { delete i.g; this.paint(i); }); this.refreshSel(); this.commit(); toast('Группа разобрана'); }
    toFront(back) {
        const l = this.selItems().filter(i => i.t !== 'conn'); if (!l.length) return;
        if (back) { let z = this.items.reduce((m, i) => Math.min(m, i.z || 0), 0) - l.length; l.forEach(i => { i.z = z++; }); } else { let z = this.nextZ(); l.forEach(i => { i.z = z++; }); }
        l.forEach(i => this.paint(i)); this.commit();
    }
    toggleLock() {
        const l = this.selItems(); if (!l.length) return; const to = !l.every(i => i.locked);
        l.forEach(i => { if (to) i.locked = true; else delete i.locked; this.paint(i); }); this.refreshSel(); this.commit(); toast(to ? 'Закреплено' : 'Откреплено');
    }
    align(how) {
        const l = this.selItems().filter(i => i.t !== 'conn' && !i.locked); if (l.length < 2) return;
        const bs = l.map(i => ({ i, b: this.box(i) })); const x0 = Math.min(...bs.map(o => o.b.x)), x1 = Math.max(...bs.map(o => o.b.x + o.b.w)), y0 = Math.min(...bs.map(o => o.b.y)), y1 = Math.max(...bs.map(o => o.b.y + o.b.h));
        if (how === 'dh' || how === 'dv') {
            if (l.length < 3) { toast('Для распределения нужно хотя бы три предмета'); return; }
            const h = how === 'dh'; bs.sort((a, b) => h ? a.b.x - b.b.x : a.b.y - b.b.y);
            const total = bs.reduce((s, o) => s + (h ? o.b.w : o.b.h), 0), span = h ? x1 - x0 : y1 - y0, gap = (span - total) / (bs.length - 1); let pos = h ? x0 : y0;
            bs.forEach(o => { if (h) o.i.x = Math.round(pos); else o.i.y = Math.round(pos); pos += (h ? o.b.w : o.b.h) + gap; });
        } else bs.forEach(o => {
            if (how === 'left') o.i.x = Math.round(x0); else if (how === 'right') o.i.x = Math.round(x1 - o.b.w); else if (how === 'center') o.i.x = Math.round((x0 + x1) / 2 - o.b.w / 2);
            else if (how === 'top') o.i.y = Math.round(y0); else if (how === 'bottom') o.i.y = Math.round(y1 - o.b.h); else if (how === 'middle') o.i.y = Math.round((y0 + y1) / 2 - o.b.h / 2);
        });
        l.forEach(i => this.paint(i)); this.redrawConns(new Set(l.map(i => i.id))); this.placeHandles(); this.placeCtx(); this.commit();
    }
}
