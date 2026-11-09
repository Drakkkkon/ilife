'use strict';
// =====================================================================================================
// iLife 2.1.0 — «ДНД»: ФОТО ГЕРОЕВ 3:4, КОЛОДА НА КАРТОЧКЕ СЮЖЕТА, «ПОЧИТАТЬ О ПЕРСОНАЖЕ».
//   • dndCropSheet — окно кадрирования фото в пропорцию 3:4 (двигать пальцем, масштаб ползунком);
//   • dndDeckHtml  — стопка маленьких фото героев (3:4) на блоке сюжета; нажатие открывает колоду;
//   • dndDeckSheet — колода: веер карточек героев и под ним рассказ о выбранном (внешность, характер, история, связи).
// Какие герои попадают в колоду — dndBlockChars (js/dnd-tags.js): выбранные вручную + упомянутые в тексте блока по имени.
// =====================================================================================================

const DND_PHOTO_RATIO = 3 / 4;

// ---------- Кадрирование ----------
// Возвращает Blob (JPEG 600×800) или null, если окно закрыли. blob — картинка (File или Blob).
function dndCropSheet(blob, o) {
    o = o || {};
    return new Promise(async resolve => {
        let bmp = null;
        try { bmp = await decodeImage(blob instanceof File ? blob : new File([blob], 'x', { type: blob.type || 'image/jpeg' })); } catch (e) { toast('Не удалось открыть картинку'); resolve(null); return; }
        const sz = bitmapSize(bmp), iw = sz.w, ih = sz.h, VW = 240, VH = 320;
        const base = Math.max(VW / iw, VH / ih);
        let z = 1, ox = (VW - iw * base) / 2, oy = (VH - ih * base) * (o.top === false ? 0.5 : 0.18);   // портрет: по умолчанию чуть выше середины — лицо обычно вверху
        const clamp = () => { const s = base * z; ox = Math.min(0, Math.max(VW - iw * s, ox)); oy = Math.min(0, Math.max(VH - ih * s, oy)); };
        const url = URL.createObjectURL(blob);
        let done = false;
        const finish = v => { if (done) return; done = true; URL.revokeObjectURL(url); if (bmp.close) try { bmp.close(); } catch (e) {} resolve(v); };
        const sh = openSheet({
            title: o.title || 'Кадр 3:4',
            html: '<p class="hint" style="margin:0 0 0.5rem">Передвиньте картинку пальцем или мышью и подберите масштаб: в кадре будет то, что видно в рамке. Пропорция 3:4 — как у карточки героя.</p>' +
                '<div class="crop-wrap"><div class="crop-vp" id="crop-vp" style="width:' + VW + 'px;height:' + VH + 'px"><img id="crop-img" alt="" draggable="false" src="' + url + '"></div></div>' +
                '<label class="field-label" for="crop-z">Масштаб</label><input type="range" id="crop-z" min="100" max="400" step="2" value="100" aria-label="Масштаб">',
            actions: [{ label: 'Отмена', value: 'x' }, { label: 'Как есть', value: 'raw', onClick: () => { finish(blob); } }, { label: 'Готово', kind: 'primary', icon: 'check', value: 'ok', onClick: async () => {
                const cv = document.createElement('canvas'); cv.width = 600; cv.height = 800; const g = cv.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, 600, 800);
                const s = base * z; g.drawImage(bmp, -ox / s, -oy / s, VW / s, VH / s, 0, 0, 600, 800);
                const out = await new Promise(res => cv.toBlob(res, 'image/jpeg', 0.9)); finish(out);
            } }],
            onClose: () => finish(null),
            onOpen: api => {
                const img = api.body.querySelector('#crop-img'), vp = api.body.querySelector('#crop-vp'), rg = api.body.querySelector('#crop-z');
                const apply = () => { clamp(); const s = base * z; img.style.width = iw * s + 'px'; img.style.height = ih * s + 'px'; img.style.transform = 'translate(' + ox + 'px,' + oy + 'px)'; };
                apply();
                rg.addEventListener('input', () => { const nz = rg.value / 100, s0 = base * z, s1 = base * nz, cx = VW / 2, cy = VH / 2; ox = cx - (cx - ox) * s1 / s0; oy = cy - (cy - oy) * s1 / s0; z = nz; apply(); });
                let drag = null;
                vp.addEventListener('pointerdown', e => { drag = { x: e.clientX, y: e.clientY, ox, oy }; try { vp.setPointerCapture(e.pointerId); } catch (er) {} e.preventDefault(); });
                vp.addEventListener('pointermove', e => { if (!drag) return; ox = drag.ox + e.clientX - drag.x; oy = drag.oy + e.clientY - drag.y; apply(); });
                const up = () => { drag = null; }; vp.addEventListener('pointerup', up); vp.addEventListener('pointercancel', up);
                vp.addEventListener('wheel', e => { e.preventDefault(); rg.value = Math.min(400, Math.max(100, +rg.value - e.deltaY * 0.3)); rg.dispatchEvent(new Event('input')); }, { passive: false });
            }
        });
    });
}

// ---------- Фото героя (3:4) ----------
function dndInitial(c) { return esc((c.name || '?').trim().charAt(0).toLocaleUpperCase('ru-RU') || '?'); }
async function dndPaintPhotos(root) {
    for (const el of $$('[data-pid]', root)) {
        const id = el.dataset.pid; if (!id) continue;
        const url = await BlobDB.url(id, 'thumb');
        if (url) { el.style.backgroundImage = 'url("' + url + '")'; el.classList.add('has-img'); }
    }
}
function dndPhotoHtml(c, cls) {
    return '<i class="' + (cls || 'bk-ph') + '" style="--h:' + (c.hue || 265) + '"' + (c.portraitId ? ' data-pid="' + esc(c.portraitId) + '"' : '') + '><span>' + dndInitial(c) + '</span></i>';
}
// Стопка фото на блоке сюжета (первые четыре, веером) и число остальных
function dndDeckHtml(chars) {
    if (!chars.length) return '';
    const shown = chars.slice(0, 4);
    return '<span class="bk-deck" data-deck="1" role="button" tabindex="0" title="Герои этой сцены — нажмите, чтобы почитать о них" aria-label="Колода героев: ' + chars.length + '">' +
        shown.map((c, i) => '<i class="bk-ph" style="--i:' + i + ';--h:' + (c.hue || 265) + '"' + (c.portraitId ? ' data-pid="' + esc(c.portraitId) + '"' : '') + '><span>' + dndInitial(c) + '</span></i>').join('') +
        (chars.length > 4 ? '<b class="bk-more">+' + (chars.length - 4) + '</b>' : '') + '</span>';
}

// ---------- Рассказ о герое ----------
function dndCharReadHtml(g, c, showSecrets) {
    const row = (k, v) => v ? '<div class="dk-kv"><span>' + esc(k) + '</span><b>' + esc(v) + '</b></div>' : '';
    const sec = (title, body, open) => body ? '<details class="dk-sec"' + (open ? ' open' : '') + '><summary>' + esc(title) + '</summary><div class="dk-body">' + body + '</div></details>' : '';
    const p = (t) => t ? '<p>' + esc(t).replace(/\n/g, '<br>') + '</p>' : '';
    const sub = [c.race, c.cls, c.level && c.cls ? c.level + ' ур.' : ''].filter(Boolean).join(' · ');
    const looks = (c.looks || []).filter(l => l.title || l.desc).map(l => '<div class="dk-look"><b>' + esc(l.title || 'Образ') + '</b>' + (l.desc ? ' — ' + esc(l.desc) : '') + '</div>').join('');
    const rels = (c.rel || []).filter(r => r.name).map(r => '<div class="dk-look"><b>' + esc(r.name) + '</b>' + (r.note ? ' — ' + esc(r.note) : '') + '</div>').join('');
    const hero =
        '<div class="dk-hero"><div class="dk-photo" style="--h:' + (c.hue || 265) + '"' + (c.portraitId ? ' data-pid="' + esc(c.portraitId) + '"' : '') + '><span>' + dndInitial(c) + '</span></div>' +
        '<div class="dk-hero-t"><h3>' + esc(c.name || 'Без имени') + '</h3>' + (sub ? '<p class="hint">' + esc(sub) + '</p>' : '') +
        '<div class="dk-chips"><span class="chip is-on">' + esc(dcType(c.type).n) + '</span>' + (c.role ? '<span class="chip">' + esc(c.role) + '</span>' : '') + (c.align ? '<span class="chip">' + esc(c.align) + '</span>' : '') + '</div>' +
        row('Возраст', c.age) + row('Пол', c.gender) + row('Игрок', c.player) + '</div></div>';
    const look = [row('Рост', c.height), row('Вес', c.weight), row('Глаза', c.eyes), row('Волосы', c.hair), row('Кожа', c.skin), row('Приметы', c.marks)].join('') + p(c.look) + looks;
    const mind = [['Черты характера', c.traits], ['Идеалы', c.ideals], ['Привязанности', c.bonds], ['Слабости', c.flaws], ['Цели и желания', c.goals]].filter(x => x[1]).map(x => '<div class="dk-kv dk-kv-col"><span>' + x[0] + '</span><b>' + esc(x[1]).replace(/\n/g, '<br>') + '</b></div>').join('');
    const gear = [row('Оружие и доспехи', c.weapons), row('Вещи', c.inventory), row('Умения', c.spells), row('Деньги', c.money)].join('');
    const html = hero + sec('Как выглядит', look, true) + sec('Характер и мотивы', mind, true) + sec('История', p(c.backstory)) + sec('Связи', rels) + sec('Снаряжение и умения', gear) + sec('Заметки', p(c.notes)) +
        (c.secrets ? '<div class="dk-secret' + (showSecrets ? ' is-open' : '') + '">' + (showSecrets ? '<b>' + ic('visibility_off') + 'Тайны (только для ведущего)</b>' + p(c.secrets) : '<button type="button" class="chip" data-dk="secrets">' + ic('visibility_off') + 'Показать тайны (для ведущего)</button>') + '</div>' : '');
    return html;
}

// ---------- Колода ----------
// chars — объекты героев; start — id героя, который открыть сразу
function dndDeckSheet(g, chars, start, title) {
    if (!chars || !chars.length) { toast('В этой сцене героев пока нет'); return null; }
    let curId = (chars.find(c => c.id === start) || chars[0]).id, secrets = false;
    const sh = openSheet({
        title: title || 'Герои сцены',
        html: '<div class="dk"><div class="dk-fan" id="dk-fan" role="listbox" aria-label="Колода героев"></div><div class="dk-read" id="dk-read"></div></div>',
        actions: [{ label: 'Закрыть', value: false }, { label: 'Открыть лист героя', kind: 'primary', icon: 'person', onClick: () => { const id = curId; setTimeout(() => dndCharsOpenChar(id), 200); } }],
        onOpen: api => {
            const fan = api.body.querySelector('#dk-fan'), read = api.body.querySelector('#dk-read');
            const draw = () => {
                fan.innerHTML = chars.map(c => '<button type="button" class="dk-card' + (c.id === curId ? ' is-on' : '') + '" role="option" aria-selected="' + (c.id === curId) + '" data-id="' + esc(c.id) + '" title="' + esc(c.name || '') + '">' +
                    '<i class="dk-ph" style="--h:' + (c.hue || 265) + '"' + (c.portraitId ? ' data-pid="' + esc(c.portraitId) + '"' : '') + '><span>' + dndInitial(c) + '</span></i><small>' + esc((c.name || 'Без имени').split(' ')[0]) + '</small></button>').join('');
                const c = chars.find(x => x.id === curId);
                read.innerHTML = dndCharReadHtml(g, c, secrets);
                dndPaintPhotos(api.body);
                const on = fan.querySelector('.is-on'); if (on && on.scrollIntoView) on.scrollIntoView({ block: 'nearest', inline: 'center' });
            };
            draw();
            fan.addEventListener('click', e => { const b = e.target.closest('.dk-card'); if (!b) return; curId = b.dataset.id; secrets = false; draw(); read.scrollTop = 0; });
            read.addEventListener('click', e => { if (e.target.closest('[data-dk="secrets"]')) { secrets = true; draw(); } });
            hydrateIcons(api.body);
        }
    });
    return sh;
}
