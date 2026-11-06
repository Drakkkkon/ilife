'use strict';
// =====================================================================================================
// iLife — СВОЙ ПИСАТЕЛЬ PDF (без внешних библиотек, работает без интернета и без сервера).
// Текст — настоящий (выделяется и ищется): шрифт Carlito встроен в файл как TrueType (Type0 / Identity-H, js/pdf-fonts.js),
// картинки — JPEG (DCTDecode). Страница A4, вёрстка сверху вниз с автоматическим переносом строк и страниц.
// Использование: const pdf = new PdfWriter({ title, footer }); pdf.text(...); pdf.image(...); const blob = await pdf.build();
// Символы, которых нет в шрифте (эмодзи и т. п.), в PDF пропускаются; «₽» заменяется на «руб.».
// =====================================================================================================

class PdfWriter {
    constructor(opts) {
        opts = opts || {};
        this.W = 595.28; this.H = 841.89; this.mx = 44; this.mt = 50; this.mb = 54;
        this.title = opts.title || 'iLife'; this.footer = opts.footer || 'iLife';
        this.fonts = { regular: window.PDF_FONTS.regular, bold: window.PDF_FONTS.bold };
        this.pages = []; this.images = []; this.y = 0;
        this.newPage();
    }
    get cw() { return this.W - this.mx * 2; }
    newPage() { this.cur = { ops: [], imgs: new Set() }; this.pages.push(this.cur); this.y = this.mt; }
    ensure(h) { if (this.y + h > this.H - this.mb) this.newPage(); }
    gap(h) { this.y += h; }

    // --- текст ---
    clean(s) {
        return String(s == null ? '' : s).replace(/₽/g, 'руб.').replace(/≈/g, '~').replace(/≠/g, '!=').replace(/≤/g, '<=').replace(/≥/g, '>=').replace(/[✓✔]/g, 'v').replace(/✗/g, 'x').replace(/‑/g, '-').replace(/[​-‏︎️⁠]/g, '')
            .replace(/\p{Extended_Pictographic}/gu, '').replace(/[  ]/g, ' ').replace(/\t/g, '  ').replace(/\r/g, '');
    }
    gid(font, cp) { const g = font.cmap[cp]; return g === undefined ? (font.cmap[63] || 0) : g; }
    width(str, size, bold) {
        const f = bold ? this.fonts.bold : this.fonts.regular; let w = 0;
        for (const ch of str) w += f.widths[this.gid(f, ch.codePointAt(0))] || 0;
        return w * size / 1000;
    }
    wrap(str, size, bold, maxW) {
        const lines = [];
        this.clean(str).split('\n').forEach(par => {
            if (!par.trim()) { lines.push(''); return; }
            let line = '';
            par.split(' ').forEach(word => {
                if (word === '') { line += ' '; return; }
                const test = line ? line + ' ' + word : word;
                if (this.width(test, size, bold) <= maxW) { line = test; return; }
                if (line) { lines.push(line); line = ''; }
                if (this.width(word, size, bold) <= maxW) { line = word; return; }
                let chunk = ''; // слово длиннее строки — режем по символам
                for (const ch of word) { if (this.width(chunk + ch, size, bold) > maxW && chunk) { lines.push(chunk); chunk = ''; } chunk += ch; }
                line = chunk;
            });
            lines.push(line);
        });
        return lines;
    }
    rgb(hex) { const h = String(hex || '#000000').replace('#', ''); return [0, 2, 4].map(i => (parseInt(h.substr(i, 2), 16) / 255).toFixed(3)).join(' '); }
    // Одна строка с базовой линией на высоте y (от верха страницы)
    textAt(str, x, y, size, o) {
        o = o || {}; const f = o.bold ? this.fonts.bold : this.fonts.regular; const s = this.clean(str);
        let hex = ''; for (const ch of s) hex += this.gid(f, ch.codePointAt(0)).toString(16).padStart(4, '0');
        if (!hex) return 0;
        const w = this.width(s, size, o.bold);
        if (o.align === 'right') x -= w; else if (o.align === 'center') x -= w / 2;
        this.cur.ops.push('BT /' + (o.bold ? 'F2' : 'F1') + ' ' + size + ' Tf ' + this.rgb(o.color || '#1d1b20') + ' rg 1 0 0 1 ' + x.toFixed(2) + ' ' + (this.H - y).toFixed(2) + ' Tm <' + hex + '> Tj ET');
        if (o.strike) this.line(x, y - size * 0.28, x + w, y - size * 0.28, o.color || '#79747e', 0.7);
        return w;
    }
    // Абзац с переносами; возвращает высоту
    para(str, o) {
        o = o || {}; const size = o.size || 11, lh = (o.lh || 1.32) * size, x = this.mx + (o.indent || 0), maxW = (o.width || this.cw - (o.indent || 0));
        const lines = this.wrap(str, size, o.bold, maxW); let used = 0;
        lines.forEach(l => {
            this.ensure(lh);
            if (l) this.textAt(l, x, this.y + size * 0.92, size, o);
            this.y += lh; used += lh;
        });
        return used;
    }
    // --- рисование ---
    line(x1, y1, x2, y2, color, w) { this.cur.ops.push((w || 0.6) + ' w ' + this.rgb(color) + ' RG ' + x1.toFixed(2) + ' ' + (this.H - y1).toFixed(2) + ' m ' + x2.toFixed(2) + ' ' + (this.H - y2).toFixed(2) + ' l S'); }
    rect(x, y, w, h, fill, r) {
        const Y = this.H - y - h;
        if (!r) { this.cur.ops.push(this.rgb(fill) + ' rg ' + x.toFixed(2) + ' ' + Y.toFixed(2) + ' ' + w.toFixed(2) + ' ' + h.toFixed(2) + ' re f'); return; }
        r = Math.min(r, w / 2, h / 2); const k = 0.5523 * r;
        const p = [x + r, Y, x + w - r, Y]; let d = p[0].toFixed(2) + ' ' + p[1].toFixed(2) + ' m ' + p[2].toFixed(2) + ' ' + p[3].toFixed(2) + ' l ';
        d += (x + w - r + k).toFixed(2) + ' ' + Y.toFixed(2) + ' ' + (x + w).toFixed(2) + ' ' + (Y + r - k).toFixed(2) + ' ' + (x + w).toFixed(2) + ' ' + (Y + r).toFixed(2) + ' c ';
        d += (x + w).toFixed(2) + ' ' + (Y + h - r).toFixed(2) + ' l ' + (x + w).toFixed(2) + ' ' + (Y + h - r + k).toFixed(2) + ' ' + (x + w - r + k).toFixed(2) + ' ' + (Y + h).toFixed(2) + ' ' + (x + w - r).toFixed(2) + ' ' + (Y + h).toFixed(2) + ' c ';
        d += (x + r).toFixed(2) + ' ' + (Y + h).toFixed(2) + ' l ' + (x + r - k).toFixed(2) + ' ' + (Y + h).toFixed(2) + ' ' + x.toFixed(2) + ' ' + (Y + h - r + k).toFixed(2) + ' ' + x.toFixed(2) + ' ' + (Y + h - r).toFixed(2) + ' c ';
        d += x.toFixed(2) + ' ' + (Y + r).toFixed(2) + ' l ' + x.toFixed(2) + ' ' + (Y + r - k).toFixed(2) + ' ' + (x + r - k).toFixed(2) + ' ' + Y.toFixed(2) + ' ' + (x + r).toFixed(2) + ' ' + Y.toFixed(2) + ' c f';
        this.cur.ops.push(this.rgb(fill) + ' rg ' + d);
    }
    box(x, y, size, color, checked) { // квадратик «галочки»: рамка или залитый с белой галочкой
        if (checked) {
            this.rect(x, y, size, size, color, 2.2);
            this.cur.ops.push('1 1 1 RG ' + (size * 0.16).toFixed(2) + ' w 1 J 1 j ' + (x + size * 0.24).toFixed(2) + ' ' + (this.H - y - size * 0.52).toFixed(2) + ' m ' + (x + size * 0.43).toFixed(2) + ' ' + (this.H - y - size * 0.72).toFixed(2) + ' l ' + (x + size * 0.78).toFixed(2) + ' ' + (this.H - y - size * 0.28).toFixed(2) + ' l S');
        } else {
            this.rect(x, y, size, size, color, 2.2); this.rect(x + 1.1, y + 1.1, size - 2.2, size - 2.2, '#ffffff', 1.4);
        }
    }
    // JPEG: { bytes, w, h }; вписывается в рамку mw × mh в точке (x, y) (верхний левый угол)
    image(img, x, y, mw, mh) {
        const k = Math.min(mw / img.w, mh / img.h); const w = img.w * k, h = img.h * k;
        let idx = this.images.indexOf(img); if (idx < 0) { this.images.push(img); idx = this.images.length - 1; }
        this.cur.imgs.add(idx);
        this.cur.ops.push('q ' + w.toFixed(2) + ' 0 0 ' + h.toFixed(2) + ' ' + x.toFixed(2) + ' ' + (this.H - y - h).toFixed(2) + ' cm /Im' + idx + ' Do Q');
        return { w, h };
    }

    // --- сборка файла ---
    async build() {
        const enc = new TextEncoder(); const objs = []; // objs[id-1] = Uint8Array
        const str = s => enc.encode(s);
        const cat = (...parts) => { let n = 0; parts.forEach(p => n += p.length); const o = new Uint8Array(n); let i = 0; parts.forEach(p => { o.set(p, i); i += p.length; }); return o; };
        const reserve = () => { objs.push(null); return objs.length; };
        const set = (id, bytes) => { objs[id - 1] = bytes; };
        const add = body => { const id = reserve(); set(id, typeof body === 'string' ? str(body) : body); return id; };
        const deflate = async u8 => {
            if (typeof CompressionStream === 'undefined') return null;
            const cs = new CompressionStream('deflate'); const w = cs.writable.getWriter(); w.write(u8); w.close();
            return new Uint8Array(await new Response(cs.readable).arrayBuffer());
        };
        const stream = async (dict, data, flate) => {
            let body = data, extra = '';
            if (flate) { const z = await deflate(data); if (z) { body = z; extra = ' /Filter /FlateDecode'; } }
            return cat(str('<< ' + dict + extra + ' /Length ' + body.length + ' >>\nstream\n'), body, str('\nendstream'));
        };
        const catalog = reserve(), pagesId = reserve();
        // шрифты
        const fontRefs = {};
        for (const key of ['regular', 'bold']) {
            const f = this.fonts[key]; const tag = key === 'bold' ? 'BBBBBB' : 'AAAAAA'; const base = tag + '+' + f.name;
            const ttf = Uint8Array.from(atob(f.ttf), c => c.charCodeAt(0));
            const fileId = add(await stream('/Length1 ' + ttf.length, ttf, true));
            const descId = add('<< /Type /FontDescriptor /FontName /' + base + ' /Flags 32 /FontBBox [' + f.bbox.join(' ') + '] /ItalicAngle 0 /Ascent ' + f.asc + ' /Descent ' + f.desc + ' /CapHeight ' + f.cap + ' /StemV ' + (key === 'bold' ? 120 : 80) + ' /FontFile2 ' + fileId + ' 0 R >>');
            const cidId = add('<< /Type /Font /Subtype /CIDFontType2 /BaseFont /' + base + ' /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /FontDescriptor ' + descId + ' 0 R /DW 500 /W [0 [' + f.widths.join(' ') + ']] /CIDToGIDMap /Identity >>');
            // ToUnicode: чтобы текст в PDF можно было выделять, копировать и искать
            const rev = {}; Object.keys(f.cmap).forEach(cp => { const g = f.cmap[cp]; if (rev[g] === undefined) rev[g] = +cp; });
            const entries = Object.keys(rev).map(g => '<' + (+g).toString(16).padStart(4, '0') + '> <' + (rev[g] > 0xFFFF ? '' : rev[g].toString(16).padStart(4, '0')) + '>').filter(e => !/<>$/.test(e));
            let cmap = '/CIDInit /ProcSet findresource begin\n12 dict begin\nbegincmap\n/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def\n/CMapName /Adobe-Identity-UCS def\n/CMapType 2 def\n1 begincodespacerange\n<0000> <FFFF>\nendcodespacerange\n';
            for (let i = 0; i < entries.length; i += 100) { const part = entries.slice(i, i + 100); cmap += part.length + ' beginbfchar\n' + part.join('\n') + '\nendbfchar\n'; }
            cmap += 'endcmap\nCMapName currentdict /CMap defineresource pop\nend\nend';
            const tuId = add(await stream('', str(cmap), true));
            fontRefs[key] = add('<< /Type /Font /Subtype /Type0 /BaseFont /' + base + ' /Encoding /Identity-H /DescendantFonts [' + cidId + ' 0 R] /ToUnicode ' + tuId + ' 0 R >>');
        }
        // картинки
        const imgIds = [];
        for (const im of this.images) imgIds.push(add(cat(str('<< /Type /XObject /Subtype /Image /Width ' + im.w + ' /Height ' + im.h + ' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ' + im.bytes.length + ' >>\nstream\n'), im.bytes, str('\nendstream'))));
        // колонтитулы
        const total = this.pages.length;
        this.pages.forEach((pg, i) => {
            this.cur = pg;
            this.line(this.mx, this.H - 38, this.W - this.mx, this.H - 38, '#cac4d0', 0.5);
            this.textAt(this.footer, this.mx, this.H - 26, 8.5, { color: '#79747e' });
            this.textAt('Стр. ' + (i + 1) + ' из ' + total, this.W - this.mx, this.H - 26, 8.5, { color: '#79747e', align: 'right' });
        });
        // страницы
        const pageIds = [];
        for (const pg of this.pages) {
            const content = await stream('', str(pg.ops.join('\n')), true);
            const cid = add(content);
            const xo = Array.from(pg.imgs).map(i => '/Im' + i + ' ' + imgIds[i] + ' 0 R').join(' ');
            pageIds.push(add('<< /Type /Page /Parent ' + pagesId + ' 0 R /MediaBox [0 0 ' + this.W + ' ' + this.H + '] /Resources << /Font << /F1 ' + fontRefs.regular + ' 0 R /F2 ' + fontRefs.bold + ' 0 R >>' + (xo ? ' /XObject << ' + xo + ' >>' : '') + ' >> /Contents ' + cid + ' 0 R >>'));
        }
        set(pagesId, str('<< /Type /Pages /Kids [' + pageIds.map(i => i + ' 0 R').join(' ') + '] /Count ' + pageIds.length + ' >>'));
        set(catalog, str('<< /Type /Catalog /Pages ' + pagesId + ' 0 R >>'));
        const hexTitle = 'FEFF' + Array.from(this.title).map(ch => { const c = ch.codePointAt(0); return c > 0xFFFF ? '' : c.toString(16).padStart(4, '0'); }).join('').toUpperCase();
        const d = new Date(); const ds = 'D:' + d.getUTCFullYear() + pad2(d.getUTCMonth() + 1) + pad2(d.getUTCDate()) + pad2(d.getUTCHours()) + pad2(d.getUTCMinutes()) + pad2(d.getUTCSeconds()) + 'Z';
        const infoId = add('<< /Title <' + hexTitle + '> /Producer (iLife ' + APP_VERSION + ') /Creator (iLife) /CreationDate (' + ds + ') >>');
        // файл: заголовок, объекты, таблица смещений
        const parts = [str('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n')]; let pos = parts[0].length; const offs = [];
        objs.forEach((o, i) => { offs.push(pos); const head = str((i + 1) + ' 0 obj\n'), tail = str('\nendobj\n'); parts.push(head, o, tail); pos += head.length + o.length + tail.length; });
        let xref = 'xref\n0 ' + (objs.length + 1) + '\n0000000000 65535 f \n';
        offs.forEach(o => { xref += String(o).padStart(10, '0') + ' 00000 n \n'; });
        parts.push(str(xref + 'trailer\n<< /Size ' + (objs.length + 1) + ' /Root ' + catalog + ' 0 R /Info ' + infoId + ' 0 R >>\nstartxref\n' + pos + '\n%%EOF\n'));
        return new Blob(parts, { type: 'application/pdf' });
    }
}

// Картинка из хранилища → JPEG для PDF (PDF не умеет WebP/GIF, поэтому всё перекодируется)
async function pdfImageFromBlob(blob, maxSide, quality) {
    try {
        const file = blob instanceof File ? blob : new File([blob], 'x', { type: blob.type });
        const bmp = await decodeImage(file); const s = bitmapSize(bmp);
        const r = await canvasBlob(bmp, s.w, s.h, maxSide || 1000, quality || 0.82);
        if (bmp.close) try { bmp.close(); } catch (e) {}
        if (!r.blob) return null;
        return { bytes: new Uint8Array(await r.blob.arrayBuffer()), w: r.w, h: r.h };
    } catch (e) { return null; }
}
