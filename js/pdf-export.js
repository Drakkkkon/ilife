'use strict';
// =====================================================================================================
// iLife — ВЫВОД В PDF: отдельные кнопки «PDF» на страницах «Идеи», «Дела» и «Кино».
//   Идеи  — все записи или только найденные по текущему поиску; с картинками (по желанию); у каждой записи дата, автор,
//           хештеги, трек Spotify с обложкой, перечень аудио и файлов (сами аудиофайлы в PDF не вкладываются).
//   Дела  — всё, только покупки или только дела; можно оставить только невыполненное; записи по датам, с ценами и сроками.
//   Кино  — все списки или один из них (смотрю / хочу посмотреть / просмотрено); обложка, название, оценки, режиссёр, актёры, ваша оценка.
// Файл отдаётся так же, как в My Money: нативный мост APK → меню «Поделиться» на телефоне → скачивание.
// =====================================================================================================

function pdfAccent() { const p = paletteById(settings.theme); return p.dark ? '#6750a4' : p.primary; }

function pdfHeader(pdf, title, subtitle, accent) {
    pdf.rect(pdf.mx, pdf.y, 30, 30, accent, 9);
    pdf.textAt('i', pdf.mx + 15, pdf.y + 21, 17, { bold: true, color: '#ffffff', align: 'center' });
    pdf.textAt('iLife', pdf.mx + 40, pdf.y + 20, 14, { bold: true, color: accent });
    pdf.textAt(fmtDateTime(Date.now()), pdf.W - pdf.mx, pdf.y + 19, 9, { color: '#79747e', align: 'right' });
    pdf.y += 42;
    pdf.para(title, { size: 30, bold: true, color: '#1d1b20', lh: 1.1 });
    pdf.gap(2);
    pdf.para(subtitle, { size: 10, color: '#49454f' });
    pdf.gap(8); pdf.line(pdf.mx, pdf.y, pdf.W - pdf.mx, pdf.y, accent, 1.2); pdf.gap(14);
}

async function finishPdf(pdf, baseName) {
    const blob = await pdf.build();
    const name = stampName(baseName, 'pdf');
    const res = await deliverFile(blob, name);
    if (res === 'native') toast('PDF сохранён: ' + name);
    else if (res === 'shared') toast('PDF готов — выберите, куда его отправить');
    else if (res === 'downloaded') toast('PDF скачан: ' + name);
    else toast('В этом приложении сохранить PDF нельзя — откройте iLife в браузере (Chrome)', { ms: 6000 });
    return blob;
}

// ---------- Идеи ----------
function openIdeasPdfSheet() {
    const searching = queryTokens(ideaQuery).length > 0;
    const found = filteredIdeas();
    if (!ideas.length) { toast('Пока нечего выводить в PDF'); return; }
    const html =
        '<p class="hint" style="margin:0 4px 8px">В PDF попадут текст, хештеги, дата и автор каждой идеи, трек Spotify с обложкой и список вложений. Картинки можно вставить в страницы.</p>' +
        '<label class="opt-row"><input type="radio" name="pdf-scope" value="all" ' + (searching ? '' : 'checked') + '><span><b>Все идеи</b><span class="sub">' + ideas.length + ' шт.</span></span></label>' +
        (searching ? '<label class="opt-row"><input type="radio" name="pdf-scope" value="found" checked><span><b>Только найденные по поиску</b><span class="sub">«' + esc(ideaQuery) + '» — ' + found.length + ' шт.</span></span></label>' : '') +
        '<label class="opt-row"><span style="flex:1"><b>Вставить картинки</b><span class="sub">Файл получится больше</span></span><input type="checkbox" class="switch" id="pdf-imgs" checked></label>';
    const sheet = openSheet({
        title: 'Идеи в PDF', html,
        actions: [{ label: 'Отмена' }, { label: 'Сохранить PDF', kind: 'primary', icon: 'picture_as_pdf', async onClick(s) {
            const btn = $('.btn-primary', s.el); btn.disabled = true; btn.textContent = 'Готовим PDF…';
            try {
                const scope = ($('input[name="pdf-scope"]:checked', s.el) || {}).value || 'all';
                await exportIdeasPdf(scope === 'found' ? found : ideas.slice(), { images: $('#pdf-imgs', s.el).checked, filter: scope === 'found' ? ideaQuery : '' });
            } catch (e) { console.error(e); toast('Не удалось собрать PDF'); }
        } }]
    });
    return sheet;
}

async function exportIdeasPdf(list, o) {
    const accent = pdfAccent();
    const pdf = new PdfWriter({ title: 'iLife — Идеи', footer: 'iLife · Идеи · ' + authorName() });
    const authors = Array.from(new Set(list.map(i => i.author || 'Александр'))).join(', ');
    pdfHeader(pdf, 'Идеи', 'Автор: ' + (authors || authorName()) + '  ·  записей: ' + list.length + (o.filter ? '  ·  поиск: «' + o.filter + '»' : ''), accent);
    for (const idea of list) {
        const files = idea.files || [];
        const imgs = files.filter(f => f.kind === 'image');
        pdf.ensure(imgs.length && o.images ? 230 : 70); // шапка записи не отрывается от своих картинок
        // шапка записи: дата и автор
        pdf.textAt(fmtDateTime(idea.createdAt), pdf.mx, pdf.y + 9, 9.5, { bold: true, color: accent });
        pdf.textAt(idea.author || 'Александр', pdf.W - pdf.mx, pdf.y + 9, 9.5, { color: '#49454f', align: 'right' });
        pdf.y += 17;
        if (idea.text) pdf.para(idea.text, { size: 11.5, lh: 1.38 });
        const inText = new Set(extractTags(idea.text || '')), extraTags = (idea.tags || []).filter(t => !inText.has(t)); // хештеги из текста уже видны в тексте
        if (extraTags.length) { pdf.gap(2); pdf.para(extraTags.map(t => '#' + t).join('  '), { size: 10, bold: true, color: accent }); }
        // трек Spotify
        if (idea.track) {
            pdf.gap(6); pdf.ensure(52);
            const cover = idea.track.coverId ? await BlobDB.get(idea.track.coverId) : null;
            const img = cover ? await pdfImageFromBlob(cover.blob, 300, 0.85) : null;
            const y0 = pdf.y; pdf.rect(pdf.mx, y0, pdf.cw, 48, '#f3edf7', 10);
            let tx = pdf.mx + 12;
            if (img) { pdf.image(img, pdf.mx + 4, y0 + 4, 40, 40); tx = pdf.mx + 52; }
            pdf.textAt(idea.track.title, tx, y0 + 20, 11, { bold: true, color: '#1d1b20' });
            pdf.textAt((idea.track.artist || '') + (idea.track.album ? ' · ' + idea.track.album : ''), tx, y0 + 35, 9.5, { color: '#49454f' });
            pdf.textAt('Spotify', pdf.W - pdf.mx - 12, y0 + 20, 8.5, { bold: true, color: accent, align: 'right' });
            pdf.y = y0 + 52;
        }
        // картинки: сетка по 3 в ряд
        if (imgs.length && o.images) {
            pdf.gap(6);
            const take = imgs.slice(0, 9), cols = 3, gapPt = 6, cellW = (pdf.cw - gapPt * (cols - 1)) / cols, maxH = 150;
            for (let i = 0; i < take.length; i += cols) {
                const row = [];
                for (const f of take.slice(i, i + cols)) { const rec = await BlobDB.get(f.id); row.push(rec ? await pdfImageFromBlob(rec.blob, 900, 0.8) : null); }
                const hRow = Math.max(40, ...row.map(im => im ? Math.min(maxH, cellW * im.h / im.w) : 0));
                pdf.ensure(hRow + gapPt);
                row.forEach((im, j) => { if (im) pdf.image(im, pdf.mx + j * (cellW + gapPt), pdf.y, cellW, maxH); });
                pdf.y += hRow + gapPt;
            }
            if (imgs.length > 9) pdf.para('…и ещё картинок: ' + (imgs.length - 9), { size: 9.5, color: '#79747e' });
        } else if (imgs.length) {
            pdf.gap(4); pdf.para('Картинки: ' + imgs.length + ' шт. (' + imgs.slice(0, 4).map(f => f.name).join(', ') + (imgs.length > 4 ? '…' : '') + ')', { size: 9.5, color: '#49454f' });
        }
        // аудио и файлы — списком
        files.filter(f => f.kind !== 'image').forEach(f => {
            const kind = f.kind === 'voice' ? 'Голосовая запись' : f.kind === 'audio' ? 'Музыка' : 'Файл';
            pdf.para(kind + ': ' + f.name + ' (' + (f.dur ? fmtDuration(f.dur) + ', ' : '') + fmtBytes(f.size) + ')', { size: 9.5, color: '#49454f' });
        });
        pdf.gap(8); pdf.ensure(14);
        pdf.line(pdf.mx, pdf.y, pdf.W - pdf.mx, pdf.y, '#e6e0e9', 0.8); pdf.gap(12);
    }
    return finishPdf(pdf, 'Идеи');
}

// ---------- Дела ----------
function openTodoPdfSheet() {
    if (!todos.length) { toast('Пока нечего выводить в PDF'); return; }
    const html =
        '<p class="hint" style="margin:0 4px 8px">Список выводится так же, как в приложении: по датам, с галочками, ценами и сроками. У каждой записи указан автор.</p>' +
        '<label class="opt-row"><input type="radio" name="pdf-kind" value="all" ' + (todoFilter === 'all' ? 'checked' : '') + '><span><b>Всё</b><span class="sub">покупки и дела</span></span></label>' +
        '<label class="opt-row"><input type="radio" name="pdf-kind" value="buy" ' + (todoFilter === 'buy' ? 'checked' : '') + '><span><b>Только покупки</b></span></label>' +
        '<label class="opt-row"><input type="radio" name="pdf-kind" value="task" ' + (todoFilter === 'task' ? 'checked' : '') + '><span><b>Только дела</b></span></label>' +
        '<label class="opt-row"><span style="flex:1"><b>Только невыполненное</b><span class="sub">без отмеченных галочкой</span></span><input type="checkbox" class="switch" id="pdf-active"></label>';
    openSheet({
        title: 'Дела в PDF', html,
        actions: [{ label: 'Отмена' }, { label: 'Сохранить PDF', kind: 'primary', icon: 'picture_as_pdf', async onClick(s) {
            const btn = $('.btn-primary', s.el); btn.disabled = true; btn.textContent = 'Готовим PDF…';
            try { await exportTodoPdf({ kind: ($('input[name="pdf-kind"]:checked', s.el) || {}).value || 'all', onlyActive: $('#pdf-active', s.el).checked }); }
            catch (e) { console.error(e); toast('Не удалось собрать PDF'); }
        } }]
    });
}

async function exportTodoPdf(o) {
    const accent = pdfAccent();
    const items = todos.filter(i => (o.kind === 'all' || i.type === o.kind) && (!o.onlyActive || !i.done));
    if (!items.length) { toast('По выбранным условиям записей нет'); return; }
    const pdf = new PdfWriter({ title: 'iLife — Дела и покупки', footer: 'iLife · Дела · ' + authorName() });
    const buy = items.filter(i => i.type === 'buy'), task = items.filter(i => i.type === 'task');
    const total = buy.reduce((s, i) => s + (i.price ? (priceInTenge(i) || 0) : 0), 0);
    const sum = [];
    if (buy.length) sum.push('Покупки: осталось ' + buy.filter(i => !i.done).length + ' из ' + buy.length + (total ? ', по ценам ≈ ' + fmtTenge(total) : ''));
    if (task.length) sum.push('Дела: осталось ' + task.filter(i => !i.done).length + ' из ' + task.length);
    pdfHeader(pdf, o.kind === 'buy' ? 'Список покупок' : o.kind === 'task' ? 'Список дел' : 'Дела и покупки', sum.join('   ·   '), accent);
    const groups = new Map();
    items.forEach(i => { const k = dayKey(i.addedAt); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(i); });
    Array.from(groups.keys()).sort().reverse().forEach(k => {
        const arr = groups.get(k).sort((a, b) => (a.done - b.done) || (a.addedAt - b.addedAt));
        pdf.ensure(60);
        pdf.textAt(dayTitle(k), pdf.mx, pdf.y + 11, 12, { bold: true, color: accent });
        pdf.textAt(authorName(), pdf.W - pdf.mx, pdf.y + 11, 9.5, { color: '#79747e', align: 'right' });
        pdf.y += 18; pdf.line(pdf.mx, pdf.y, pdf.W - pdf.mx, pdf.y, '#cac4d0', 0.6); pdf.gap(7);
        arr.forEach(it => {
            const nameW = pdf.cw - 30 - (it.type === 'buy' && it.price ? 90 : 0);
            const title = it.name + (it.qty ? '  — ' + it.qty : '');
            const lines = pdf.wrap(title, 11.5, false, nameW);
            const h = lines.length * 15 + 15;
            pdf.ensure(h + 4);
            const y0 = pdf.y;
            pdf.box(pdf.mx, y0 + 1.5, 11, it.done ? '#79747e' : accent, it.done);
            lines.forEach((l, li) => pdf.textAt(l, pdf.mx + 22, y0 + 11 + li * 15, 11.5, { color: it.done ? '#79747e' : '#1d1b20', strike: it.done }));
            if (it.type === 'buy' && it.price) pdf.textAt(fmtCur(it.price, it.currency || 'KZT'), pdf.W - pdf.mx, y0 + 11, 11, { bold: true, color: it.done ? '#79747e' : '#1d1b20', align: 'right' });
            const meta = [];
            if (it.type === 'task' && (it.due || it.time)) meta.push((!it.done && it.due && it.due < todayKey() ? 'просрочено: ' : '') + dueLabel(it.due, it.time));
            if (it.store) meta.push('магазин: ' + it.store);
            meta.push((it.author || 'Александр') + ', ' + fmtTime(it.addedAt));
            const overdue = it.type === 'task' && !it.done && it.due && it.due < todayKey();
            pdf.textAt(meta.join('  ·  '), pdf.mx + 22, y0 + lines.length * 15 + 8, 8.8, { color: overdue ? '#b3261e' : '#79747e' });
            pdf.y = y0 + h + 3;
        });
        pdf.gap(8);
    });
    return finishPdf(pdf, o.kind === 'buy' ? 'Покупки' : o.kind === 'task' ? 'Дела_список' : 'Дела');
}

// ---------- Кино ----------
function openMoviesPdfSheet() {
    if (!movies.length) { toast('Пока нечего выводить в PDF'); return; }
    const n = st => movies.filter(m => mvStatusOf(m) === st).length;
    const row = (v, title, sub, on) => '<label class="opt-row"><input type="radio" name="pdf-mv" value="' + v + '"' + (on ? ' checked' : '') + '><span><b>' + title + '</b><span class="sub">' + sub + '</span></span></label>';
    const html = '<p class="hint" style="margin:0 4px 8px">В PDF попадут обложка, название, оценки сервисов, режиссёр, актёры, ваша оценка и заметка.</p>' +
        row('all', 'Всё', movies.length + ' шт.', true) +
        row('queue', 'Список для просмотра', n('queue') + ' шт.', false) +
        row('watching', 'Смотрю сейчас', n('watching') + ' шт.', false) +
        row('watched', 'Просмотрено', n('watched') + ' шт.', false) +
        '<label class="opt-row"><span style="flex:1"><b>Вставить обложки</b><span class="sub">Файл получится больше</span></span><input type="checkbox" class="switch" id="pdf-mv-img" checked></label>';
    openSheet({
        title: 'Кино в PDF', html,
        actions: [{ label: 'Отмена' }, { label: 'Сохранить PDF', kind: 'primary', icon: 'picture_as_pdf', async onClick(s) {
            const btn = $('.btn-primary', s.el); btn.disabled = true; btn.textContent = 'Готовим PDF…';
            try { await exportMoviesPdf({ scope: ($('input[name="pdf-mv"]:checked', s.el) || {}).value || 'all', images: $('#pdf-mv-img', s.el).checked }); }
            catch (e) { console.error(e); toast('Не удалось собрать PDF'); }
        } }]
    });
}

async function exportMoviesPdf(o) {
    const accent = pdfAccent();
    const groups = [['watching', 'Смотрю сейчас'], ['queue', 'Список для просмотра'], ['watched', 'Просмотрено']]
        .filter(g => o.scope === 'all' || o.scope === g[0])
        .map(g => [g[1], movies.filter(m => mvStatusOf(m) === g[0]).sort(g[0] === 'watched' ? (a, b) => (b.watchedAt || 0) - (a.watchedAt || 0) : (a, b) => (b.addedAt || 0) - (a.addedAt || 0)), g[0]])
        .filter(g => g[1].length);
    if (!groups.length) { toast('По выбранным условиям фильмов нет'); return; }
    const total = groups.reduce((s, g) => s + g[1].length, 0);
    const pdf = new PdfWriter({ title: 'iLife — Кино', footer: 'iLife · Кино · ' + authorName() });
    pdfHeader(pdf, 'Кино', 'Фильмов и сериалов: ' + total + '  ·  ' + groups.map(g => g[0].toLowerCase() + ': ' + g[1].length).join('  ·  '), accent);
    for (const [title, list, st] of groups) {
        pdf.ensure(110);
        pdf.textAt(title, pdf.mx, pdf.y + 12, 13, { bold: true, color: accent });
        pdf.y += 20; pdf.line(pdf.mx, pdf.y, pdf.W - pdf.mx, pdf.y, '#cac4d0', 0.6); pdf.gap(9);
        for (const m of list) {
            const rec = o.images && m.coverId ? await BlobDB.get(m.coverId) : null;
            const img = rec ? await pdfImageFromBlob(rec.blob, 360, 0.8) : null;
            const coverW = 54, coverH = 81, tx = pdf.mx + (img ? coverW + 14 : 0), textW = pdf.cw - (img ? coverW + 14 : 0);
            const rows = [];   // строки текста: [текст, размер, жирный, цвет]
            const add = (text, size, bold, color) => pdf.wrap(text, size, bold, textW).forEach(l => rows.push([l, size, bold, color]));
            add(m.title, 12.5, true, '#1d1b20');
            if (m.origTitle && mvNorm(m.origTitle) !== mvNorm(m.title)) add(m.origTitle, 9.5, false, '#79747e');
            add(mvMetaLine(m), 9.5, false, '#49454f');
            const rates = [];
            MV_SOURCES.forEach(s => { const v = Number((m.ratings || {})[s.key]); if (v > 0) rates.push(s.name + ' ' + mvRatingText(s, v)); });
            const avg = mvAvgRating(m.ratings); if (avg) rates.push('среднее ' + String(avg).replace('.', ','));
            if (rates.length) add(rates.join('  ·  '), 9.5, true, accent);
            const d = m.directors || [];
            if (d.length) add((m.type === 'tv' ? 'Создатель: ' : 'Режиссёр: ') + d.join(', '), 9.5, false, '#1d1b20');
            if ((m.cast || []).length) add('В ролях: ' + m.cast.slice(0, 8).join(', '), 9.5, false, '#1d1b20');
            if (m.myRating) add('Моя оценка: ' + m.myRating + ' из 10' + (m.note ? ' — ' + m.note : ''), 10, true, '#146c2e');
            else if (m.note) add('Заметка: ' + m.note, 9.5, false, '#49454f');
            add(mvWhen(m), 8.8, false, '#79747e');
            const textH = rows.reduce((s, r) => s + r[1] * 1.3, 0), h = Math.max(img ? coverH : 0, textH);
            pdf.ensure(h + 6);
            const y0 = pdf.y;
            if (img) pdf.image(img, pdf.mx, y0, coverW, coverH);
            let y = y0;
            rows.forEach(r => { pdf.textAt(r[0], tx, y + r[1] * 0.95, r[1], { bold: r[2], color: r[3] }); y += r[1] * 1.3; });
            pdf.y = y0 + h + 6;
            pdf.line(pdf.mx, pdf.y, pdf.W - pdf.mx, pdf.y, '#e6e0e9', 0.6); pdf.gap(9);
        }
        pdf.gap(6);
    }
    return finishPdf(pdf, 'Кино');
}
