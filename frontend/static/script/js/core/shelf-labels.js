/* One label renderer for single-item, bulk, roll and A4 printing. */
(function (root, factory) {
    'use strict';
    var api = factory(root);
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.PosnicShelfLabels = api;
})(typeof window !== 'undefined' ? window : globalThis, function (root) {
    'use strict';
    function geometry(s) {
        ['width', 'height', 'margin', 'gap'].forEach(function (key) {
            if (!Number.isFinite(s[key]) || s[key] < 0) throw Error('Enter valid label dimensions.');
        });
        if (s.width < 15 || s.height < 15) throw Error('Labels must be at least 15 mm wide and high.');
        if (s.paper === 'roll') return { columns: 1, rows: 1, capacity: 1, start: 1, width: s.width, height: s.height };
        var columns = Math.floor((210 - 2 * s.margin + s.gap) / (s.width + s.gap));
        var rows = Math.floor((297 - 2 * s.margin + s.gap) / (s.height + s.gap));
        if (columns < 1 || rows < 1) throw Error('Labels do not fit on A4. Reduce size, margins or gaps.');
        var capacity = columns * rows;
        if (!Number.isInteger(s.start) || s.start < 1 || s.start > capacity) throw Error('Starting position must be between 1 and ' + capacity + '.');
        return { columns: columns, rows: rows, capacity: capacity, start: s.start, width: 210, height: 297 };
    }
    function count(entries) {
        return entries.reduce(function (n, entry) {
            if (!Number.isInteger(entry.copies) || entry.copies < 1 || entry.copies > 999) throw Error('Copies must be between 1 and 999.');
            return n + entry.copies;
        }, 0);
    }
    function slots(entries, layout, page, from, amount) {
        var total = count(entries), first = from || 1, limit = amount || total;
        if (!Number.isInteger(first) || first < 1 || first > total) throw Error('Choose a valid first label.');
        if (!Number.isInteger(limit) || limit < 1 || limit > 2000) throw Error('Print up to 2,000 labels per batch.');
        limit = Math.min(limit, total - first + 1);
        var pages = Math.ceil((layout.start - 1 + limit) / layout.capacity);
        if (!Number.isInteger(page) || page < 0 || page >= pages) throw Error('Choose a valid page.');
        var offsets = [], running = 0;
        entries.forEach(function (entry) { offsets.push(running); running += entry.copies; });
        var cells = [];
        for (var i = 0; i < layout.capacity; i++) {
            var position = page * layout.capacity + i - layout.start + 1;
            if (position < 0 || position >= limit) { cells.push(null); continue; }
            var index = first - 1 + position, owner = 0;
            while (owner + 1 < offsets.length && offsets[owner + 1] <= index) owner++;
            cells.push(entries[owner].item);
        }
        return { cells: cells, pages: pages, amount: limit, total: total };
    }
    function css(s, g) {
        return '@page{size:' + (s.paper === 'a4' ? 'A4' : s.width + 'mm ' + s.height + 'mm') + ';margin:0}' +
            'html,body{margin:0;padding:0}*{box-sizing:border-box}.sl-sheet{width:' + g.width + 'mm;height:' + g.height + 'mm;' +
            'padding:' + (s.paper === 'a4' ? s.margin : 0) + 'mm;display:grid;grid-template-columns:repeat(' + g.columns + ',' + s.width + 'mm);' +
            'grid-template-rows:repeat(' + g.rows + ',' + s.height + 'mm);gap:' + (s.paper === 'a4' ? s.gap : 0) + 'mm;break-after:page;overflow:hidden}' +
            '.sl-sheet:last-child{break-after:auto}.sl-label{position:relative;width:' + s.width + 'mm;height:' + s.height + 'mm;padding:0;overflow:hidden;' +
            'display:block;border:' + (s.guides ? '.15mm dashed #aaa' : 'none') + ';font-family:' + s.font + ';font-size:' + s.fontSize + 'px;text-align:' + s.align +
            ';font-weight:' + (s.fontOptions?.includes('bold') ? '700' : '400') + ';font-style:' + (s.fontOptions?.includes('italic') ? 'italic' : 'normal') +
            ';color:' + s.ink + ';background:' + s.background + ';print-color-adjust:exact;-webkit-print-color-adjust:exact}' +
            '.sl-label .sl-element{position:absolute;margin:0;padding:0;overflow:hidden;display:flex;align-items:center;justify-content:' + (s.align === 'left' ? 'flex-start' : s.align === 'right' ? 'flex-end' : 'center') + ';line-height:1.15;overflow-wrap:anywhere}' +
            '.sl-name{font-weight:600;white-space:pre-line}.sl-custom-text{white-space:pre-wrap}.sl-logo{object-fit:contain}.sl-price{font-weight:700;font-size:220%}.sl-label svg.sl-element{display:block;max-width:100%;max-height:100%;}' +
            '.sl-foot{font-size:75%;white-space:pre-line}.sl-design-editable .sl-element{outline:1px dashed #2563eb;cursor:move;touch-action:none}' +
            '.sl-design-editable .sl-element.sl-selected{outline:2px solid #ef4444;z-index:20;overflow:visible}' +
            '.sl-resize-handle{position:absolute;width:12px;height:12px;border:2px solid white;border-radius:2px;background:#2563eb;cursor:nwse-resize;z-index:21;transform:translate(-50%,-50%);touch-action:none}';
    }
    function validateDesign(s) {
        if (!/^[a-zA-Z ,\-]+$/.test(s.font) || !['left', 'center', 'right'].includes(s.align) || !/^#[a-f\d]{6}$/i.test(s.background) || !/^#[a-f\d]{6}$/i.test(s.ink)) throw Error('Invalid label design.');
        if (!Number.isFinite(s.fontSize) || s.fontSize < 3 || s.fontSize > 36) throw Error('Choose a font size between 3 and 36.');
    }
    var DEFAULT_ELEMENT_LAYOUT = {
        name: { x: 4, y: 2, w: 70, h: 23 },
        logo: { x: 76, y: 2, w: 20, h: 18 },
        barcode: { x: 10, y: 27, w: 80, h: 32 },
        price: { x: 5, y: 60, w: 90, h: 23 },
        details: { x: 5, y: 84, w: 90, h: 14 }
    };
    function readLogoData() {
        try {
            var value = root.localStorage.getItem('posnic.shelf-label-logo') || '';
            return /^data:image\/(png|jpeg|webp);base64,/i.test(value) ? value : '';
        } catch (_) { return ''; }
    }
    function readElementLayout() {
        var saved = {};
        try { saved = JSON.parse(root.localStorage.getItem('posnic.shelf-label-elements') || '{}') || {}; } catch (_) {}
        var result = {};
        Object.keys(DEFAULT_ELEMENT_LAYOUT).concat(Object.keys(saved).filter(function (key) { return key.indexOf('custom_') === 0 && !DEFAULT_ELEMENT_LAYOUT[key]; })).forEach(function (key) {
            var d = DEFAULT_ELEMENT_LAYOUT[key] || { x: 10, y: 10, w: 45, h: 12 }, v = saved[key] || {};
            function n(name) { var value = Number(v[name]); return Number.isFinite(value) ? value : d[name]; }
            var w = Math.max(5, Math.min(100, n('w'))), h = Math.max(5, Math.min(100, n('h')));
            var rawRotation = n('rotation');
            var rotation = Number.isFinite(rawRotation) ? ((rawRotation % 360) + 360) % 360 : 0;
            var defaultFontSize = key === 'price' ? 220 : key === 'details' ? 75 : 100;
            var fontSize = Number(v.font_size);
            if (!Number.isFinite(fontSize)) fontSize = defaultFontSize;
            fontSize = Math.max(40, Math.min(400, fontSize));
            var fontWeight = v.font_weight === 'bold' ? 'bold' : (v.font_weight === 'normal' ? 'normal' : (key === 'name' || key === 'price' ? 'bold' : 'normal'));
            var textAlign = ['left', 'center', 'right'].indexOf(v.text_align) >= 0 ? v.text_align : 'center';
            var color = /^#[0-9a-f]{6}$/i.test(String(v.color || '')) ? v.color : '#000000';
            result[key] = { x: Math.max(0, Math.min(100 - w, n('x'))), y: Math.max(0, Math.min(100 - h, n('y'))), w: w, h: h, rotation: rotation, group_id: typeof v.group_id === 'string' && v.group_id.length <= 80 ? v.group_id : '', font_size: fontSize, font_weight: fontWeight, text_align: textAlign, color: color, text: key.indexOf('custom_') === 0 ? String(v.text || 'New text') : '' };
        });
        return result;
    }
    function applyElementLayout(node, key, s) {
        var layout = (s.elementLayout || DEFAULT_ELEMENT_LAYOUT)[key] || DEFAULT_ELEMENT_LAYOUT[key];
        node.classList.add('sl-element');
        node.dataset.slElement = key;
        node.style.left = layout.x + '%';
        var top = layout.y, height = layout.h;
        if (key === 'name' && String(node.textContent || '').indexOf('\n') >= 0) height = Math.max(height, 22);
        if (key === 'barcode' && node.parentElement && node.parentElement.querySelector('.sl-name') && String(node.parentElement.querySelector('.sl-name').textContent || '').indexOf('\n') >= 0) top = Math.max(top, 27);
        node.style.top = top + '%';
        node.style.width = layout.w + '%';
        node.style.height = height + '%';
        node.style.transform = 'rotate(' + (Number(layout.rotation) || 0) + 'deg)';
        node.style.transformOrigin = 'center center';
        node.style.fontSize = (Number(layout.font_size) || 100) + '%';
        node.style.fontWeight = layout.font_weight || 'normal';
        node.style.textAlign = layout.text_align || 'center';
        node.style.color = layout.color || '#000000';
        node.style.justifyContent = layout.text_align === 'left' ? 'flex-start' : layout.text_align === 'right' ? 'flex-end' : 'center';
    }
    function label(doc, item, s, barcode) {
        if (!Number.isFinite(item.label_price)) throw Error(item.name + ': ' + (item.label_price_error || 'A fixed price is required.'));
        if (s.barcode !== false && !item.barcode_id) throw Error(item.name + ': ' + t('lang_sl_barcode_missing', 'No barcode. Switch off Show barcode to print a price label.'));
        var div = doc.createElement('div'); div.className = 'sl-label';
        function text(value, cls, key) {
            var p = doc.createElement('p'); p.className = (cls || '') + ' sl-element'; p.textContent = value;
            applyElementLayout(p, key, s); div.appendChild(p); return p;
        }
        if (s.logoData) {
            var logo = doc.createElement('img'); logo.className = 'sl-logo sl-element'; logo.alt = 'Store logo';
            logo.src = s.logoData; applyElementLayout(logo, 'logo', s); div.appendChild(logo);
        }
        var nameText = String(item.name || ''), nameParts = nameText.match(/^(.*?)-([0-9]{2}-[0-9]{2}\/[^/]+?)(?:\s+\/\s+(.+))?$/);
        if (nameParts) nameText = nameParts[1].trim() + '\n' + nameParts[2].trim() + (nameParts[3] ? ' / ' + nameParts[3].trim() : '');
        if (s.samarina) {
            var selectedVariant = String(item.variant_value || '').trim();
            var allVariants = Array.isArray(item.available_variant_values) ? item.available_variant_values : [];
            var variantNode = doc.createElement('p');
            variantNode.className = 'sl-variant-values sl-element';
            variantNode.dataset.slElement = 'variant_values';
            var variantLayout = (s.elementLayout || DEFAULT_ELEMENT_LAYOUT).variant_values || { x: 3, y: 24, w: 94, h: 17, font_size: 100, font_weight: 'normal', text_align: 'center', color: '#000000' };
            var values = allVariants.map(function (value) {
                var span = doc.createElement('span');
                span.textContent = String(value);
                if (String(value).trim().toLowerCase() === selectedVariant.toLowerCase()) {
                    span.style.fontWeight = '900';
                    span.style.textDecoration = 'underline';
                    span.setAttribute('aria-current', 'true');
                }
                variantNode.appendChild(span);
                return span;
            });
            if (!allVariants.length && selectedVariant) {
                var selected = doc.createElement('strong'); selected.textContent = selectedVariant; variantNode.appendChild(selected);
            }
            applyElementLayout(variantNode, 'variant_values', s);
            div.appendChild(variantNode);
            var nameNode = text(String(item.article_type || nameText.split(' / ')[0] || '').trim(), 'sl-name', 'name');
            nameNode.style.fontWeight = '600';
            var brand = String(item.brand_abbreviation || item.brand || '').trim();
            if (brand) nameNode.textContent = nameNode.textContent + ' · ' + brand;
            var reference = String(item.reference_date || '').trim();
            var modelReference = String(item.model_reference || '').trim();
            if (reference || modelReference) text((reference ? reference : '') + (modelReference ? ' / ' + modelReference : ''), 'sl-foot', 'details');
        } else {
            text(nameText, 'sl-name', 'name');
        }
        if (s.barcode !== false) {
            var svg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.classList.add('sl-barcode');
            applyElementLayout(svg, 'barcode', s); div.appendChild(svg);
            barcode(svg, String(item.barcode_id), { format: s.format, width: s.barWidth, height: s.barHeight, margin: s.barMargin,
            marginTop: s.top, marginBottom: s.bottom, marginLeft: s.left, marginRight: s.right,
            displayValue: s.barText, textMargin: s.textMargin, font: s.font, fontSize: s.fontSize,
            textAlign: s.align, fontOptions: s.fontOptions || '', lineColor: s.ink, background: s.background });
        }
        text(s.currency + ' ' + item.label_price.toFixed(item.label_currency_digits ?? 2), 'sl-price', 'price');
        var details = [];
        if (item.variant_value && !String(item.name || '').includes(String(item.variant_value))) details.push('Variant ' + String(item.variant_value));
        if (s.mrp && Number(item.mrp_price) > 0) details.push('MRP ' + s.currency + ' ' + Number(item.mrp_price).toFixed(item.label_currency_digits ?? 2));
        if (s.mfg && item.items_mfg_date) details.push('MFG ' + String(item.items_mfg_date).split(' ')[0]);
        if (s.exp && item.items_expiry_date) details.push('EXP ' + String(item.items_expiry_date).split(' ')[0]);
        if (s.shop) details.push(s.shop);
        if (s.address) details.push(s.address);
        if (s.date) details.push(s.printedDate);
        if (details.length) text(details.join('\n'), 'sl-foot', 'details');
        Object.keys(s.elementLayout || {}).filter(function (key) { return key.indexOf('custom_') === 0; }).forEach(function (key) {
            var custom = s.elementLayout[key];
            text(String(custom.text || 'New text'), 'sl-custom-text', key);
        });
        return div;
    }
    function sheet(doc, cells, s, barcode) {
        var page = doc.createElement('div'); page.className = 'sl-sheet';
        cells.forEach(function (item) { page.appendChild(item ? label(doc, item, s, barcode) : doc.createElement('div')); });
        return page;
    }
    var state = { entries: [], byId: new Map(), viewIds: [], filters: {}, step: 0, furthestStep: 0, page: 0, productPage: 1, totalPages: 1, total: 0, loading: false, bulkLoading: false, token: 0, loadError: null, completeKey: null };
    state.elementLayout = readElementLayout();
    var editorDrag = null;
    var searchTimer;
    function $() { return root.jQuery.apply(null, arguments); }
    function t(key, fallback) { return root.PosnicPro?.i18n?.t(key, fallback) || fallback; }
    function filters() {
        var result = Object.assign({}, state.filters), search = String($('#sl-search').val() || '').trim();
        if ($('#sl-category').val()) result.category_id = $('#sl-category').val();
        if (search) {
            var escaped = search.split('').map(function (c) { return ['.', '*', '+', '?', '^', '$', '{', '}', '(', ')', '|', '[', ']', String.fromCharCode(92)].includes(c) ? String.fromCharCode(92) + c : c; }).join('');
            var terms = { $or: [{ name: { $regex: escaped, $options: 'i' } }, { barcode_id: { $regex: escaped, $options: 'i' } }] };
            if (result.$or) { result.$and = (result.$and || []).concat([{ $or: result.$or }, terms]); delete result.$or; }
            else result.$or = terms.$or;
        }
        return result;
    }
    function settings() {
        var s = {
            elementLayout: state.elementLayout || readElementLayout(),
            logoData: readLogoData(),
            paper: $('#sl-paper').val(), width: Number($('#sl-width').val()), height: Number($('#sl-height').val()),
            samarina: $('#sl-samarina-mode').is(':checked'),
            margin: Number($('#sl-margin').val()), gap: Number($('#sl-gap').val()), start: Number($('#sl-start').val()), guides: $('#sl-guides').is(':checked'),
            font: $('#font').val(), fontSize: Number($('#bar-fontSize').val()), align: $('#view_print_lable .text-align.btn-primary').val() || 'center',
            fontOptions: $('#view_print_lable .font-option.btn-primary').map(function () { return this.value; }).get().join(' '),
            background: $('#background-color').val(), ink: $('#line-color').val(), format: $('#barcodeLabelType').val(),
            barWidth: Number($('#bar-width').val()), barHeight: Number($('#bar-height').val()), barMargin: Number($('#bar-margin').val()), textMargin: Number($('#bar-text-margin').val()),
            top: Number($('#margin_top').val()), bottom: Number($('#margin_bottom').val()), left: Number($('#margin_left').val()), right: Number($('#margin_right').val()),
            barcode: $('#sl-show-barcode').is(':checked'), barText: $('#sl-bar-text').is(':checked'), mrp: $('#sl-mrp').is(':checked'), mfg: $('#mfg_checkbox').is(':checked'), exp: $('#exp_checkbox').is(':checked'),
            shop: $('#sl-shop').is(':checked') ? root.PosnicPro.local.get('branchname') || '' : '', address: $('#address-value').val(),
            date: $('#sl-date').is(':checked'), printedDate: new Date().toLocaleDateString(), currency: root.PosnicPro.local.get('currencySign') || ''
        };
        validateDesign(s); geometry(s); return s;
    }
    function chosen() { return state.entries.filter(function (e) { return e.selected; }); }
    function error(e) { $('#sl-status').text(e.message || String(e)); $('#sl-print,#sl-test').prop('disabled', true); }
    function selectedCount() {
        var entries = chosen(), copies;
        try { copies = count(entries); } catch (_) { copies = '—'; }
        $('#sl-selection-count').text(entries.length + ' ' + t('lang_sl_products_count', 'products') + ' · ' + copies + ' ' + t('lang_sl_labels_count', 'labels'));
        $('#sl-clear').prop('disabled', !entries.length && !state.bulkLoading);
        $('#sl-apply-copies').prop('disabled', !entries.length);
        $('#sl-next-step').prop('disabled', !entries.length || state.loading || !!state.loadError);
        $('[data-sl-step]').each(function () { var step = Number(this.getAttribute('data-sl-step')); this.disabled = step > 0 && (!entries.length || step > state.furthestStep + 1 || state.loading || !!state.loadError); });
        var current = state.entries.filter(function (e) { return state.viewIds.includes(String(e.item._id)); });
        var selected = current.filter(function (e) { return e.selected; }).length;
        $('#sl-page-all').prop('checked', current.length > 0 && selected === current.length).prop('indeterminate', selected > 0 && selected < current.length).prop('disabled', !current.length);
        var complete = state.completeKey === JSON.stringify(filters());
        $('#sl-all').prop('checked', state.bulkLoading || (complete && state.total > 0 && current.length > 0 && selected === current.length && matchingEntries().every(function (e) { return e.selected; })))
            .prop('indeterminate', !state.bulkLoading && selected > 0 && !(complete && matchingEntries().every(function (e) { return e.selected; }))).prop('disabled', state.loading && !state.bulkLoading);
    }
    function matchingEntries() {
        var search = String($('#sl-search').val() || '').trim().toLowerCase(), category = $('#sl-category').val();
        return state.entries.filter(function (e) { return (!category || String(e.item.category_id) === category) && (!search || (e.item.name + ' ' + (e.item.barcode_id || '')).toLowerCase().includes(search)); });
    }
    function mountPreview(host, cells, s, g) {
        var doc = root.document, page = sheet(doc, cells, s, root.JsBarcode), style = doc.createElement('style'), allCss = css(s, g);
        // Scope preview rules: printing's html/body and @page rules never affect the application.
        style.textContent = allCss.slice(allCss.indexOf('.sl-sheet')).replace(/(^|})(\.sl-[^{]+)/g, '$1' + host + ' $2');
        var $host = $(host).empty().append(style, page);
        if (host === '#sl-sample') {
            page.querySelectorAll('.sl-label').forEach(function (label) {
                label.classList.add('sl-design-editable');
                label.querySelectorAll('[data-sl-element]').forEach(function (element) {
                    var key = element.dataset.slElement, layout = state.elementLayout[key] || DEFAULT_ELEMENT_LAYOUT[key];
                    var handle = doc.createElement('span');
                    handle.className = 'sl-resize-handle';
                    handle.dataset.slResizeFor = key;
                    handle.setAttribute('aria-hidden', 'true');
                    handle.style.left = (layout.x + layout.w) + '%';
                    handle.style.top = (layout.y + layout.h) + '%';
                    label.appendChild(handle);
                });
            });
        }
        var available = $host.parent().width() || 400;
        var scale = Math.min(1.4, available / (g.width * 96 / 25.4));
        if (s.paper === 'a4' && host !== '#sl-sample') {
            if (host === '#sl-preview' && $('#sl-preview-zoom').val() === 'actual') scale = Math.min(1, scale);
            else {
                var availableHeight = host === '#sl-preview' ? Math.max(260, $('#view_print_lable .sl-body').height() - 165) : 320;
                scale = Math.min(scale, availableHeight / (g.height * 96 / 25.4));
            }
        }
        $(page).css({ transform: 'scale(' + scale + ')', transformOrigin: 'top left' });
        $host.css({ width: g.width * 96 / 25.4 * scale + 'px', height: g.height * 96 / 25.4 * scale + 'px' });
        return page;
    }
    function refresh() {
        selectedCount();
        if (!$('#view_print_lable').hasClass('show')) return;
        $('#sl-a4-settings').prop('hidden', $('#sl-paper').val() !== 'a4');
        $('#sl-bar-text,#barcodeLabelType').prop('disabled', !$('#sl-show-barcode').is(':checked'));
        $('#sl-status').empty();
        if (state.loadError) return error(state.loadError);
        var entries = chosen();
        if (!entries.length) {
            $('#sl-sample,#sl-preview,#sl-print-sample').empty();
            $('#sl-summary').text(t('lang_select_products_to_print', 'Select products to print.'));
            $('#sl-print,#sl-test').prop('disabled', true); return;
        }
        try {
            var s = settings(), g = geometry(s), amount = Number($('#sl-batch').val()), from = Number($('#sl-from').val());
            $('#sl-start').attr('max', g.capacity); $('#sl-dimensions').text(s.width + ' × ' + s.height + ' mm');
            try { root.localStorage.setItem('posnic.shelf-label-layout', JSON.stringify({ paper: s.paper, width: s.width, height: s.height, margin: s.margin, gap: s.gap, start: s.start, guides: s.guides, barcode: s.barcode, barText: s.barText, shop: !!s.shop, date: s.date, mrp: s.mrp, mfg: s.mfg, exp: s.exp, elementLayout: s.elementLayout, logoData: s.logoData,
                design: { font: s.font, fontSize: s.fontSize, align: s.align, ink: s.ink, background: s.background, format: s.format, barWidth: s.barWidth, barHeight: s.barHeight, barMargin: s.barMargin, textMargin: s.textMargin, top: s.top, bottom: s.bottom, left: s.left, right: s.right, fontOptions: s.fontOptions } })); } catch (_) { /* Optional storage. */ }
            if (state.step === 1) {
                var sampleGeometry = geometry(Object.assign({}, s, { paper: 'roll' }));
                try { mountPreview('#sl-sample', [entries[0].item], Object.assign({}, s, { paper: 'roll' }), sampleGeometry); }
                catch (e) { $('#sl-sample').empty().append($('<p class="sl-muted">').text(e.message || String(e))); }
            }
            if (state.step < 2) return;
            var pages = Math.ceil((g.start - 1 + Math.min(amount, count(entries) - from + 1)) / g.capacity);
            state.page = Math.max(0, Math.min(state.page, pages - 1));
            var result = slots(entries, g, state.page, from, amount);
            if (state.step === 2) mountPreview('#sl-preview', result.cells, s, g);
            if (state.step === 3) mountPreview('#sl-print-sample', result.cells, s, g);
            $('#sl-summary').text(entries.length + ' ' + t('lang_sl_products_count', 'products') + ' · ' + result.total + ' ' + t('lang_sl_labels_count', 'labels') + ' · ' + result.pages + ' ' + t('lang_sl_pages_count', 'pages'));
            $('#sl-layout-summary').text(s.paper === 'a4' ? g.columns + ' × ' + g.rows + ' · A4' : s.width + ' × ' + s.height + ' mm');
            $('#sl-page').text((state.page + 1) + ' / ' + result.pages);
            $('#sl-prev').prop('disabled', state.page === 0); $('#sl-next').prop('disabled', state.page === result.pages - 1);
            $('#sl-job-paper').text(s.paper === 'a4' ? 'A4 · 210 × 297 mm' : s.width + ' × ' + s.height + ' mm');
            $('#sl-job-total').text(result.total); $('#sl-job-pages').text(result.pages);
            $('#sl-print,#sl-test').prop('disabled', state.loading);
        } catch (e) { error(e); }
    }
    function setStep(step) {
        if (step < 0 || step > 3 || step > state.furthestStep + 1) return;
        if (step > 0 && (!chosen().length || state.loading || state.loadError)) return;
        if (step >= 2) {
            try {
                var s = settings(), g = geometry(s), entries = chosen();
                // Validate every selected item, including later pages; never hide a print failure behind a good first sheet.
                entries.forEach(function (e) {
                    if (!Number.isFinite(e.item.label_price)) throw Error(e.item.name + ': ' + (e.item.label_price_error || t('lang_sl_fixed_price', 'A fixed price is required.')));
                    if (s.barcode) {
                        if (!e.item.barcode_id) throw Error(e.item.name + ': ' + t('lang_sl_barcode_missing', 'No barcode. Switch off Show barcode to print a price label.'));
                        try { root.JsBarcode({}, String(e.item.barcode_id), { format: s.format }); }
                        catch (_) { throw Error(e.item.name + ': ' + t('lang_sl_barcode_format', 'The barcode does not match this format. Choose another format or switch off Show barcode.')); }
                    }
                });
                slots(entries, g, 0, Number($('#sl-from').val()), Number($('#sl-batch').val()));
            } catch (e) { error(e); return; }
        }
        state.step = step;
        state.furthestStep = Math.max(state.furthestStep, step);
        $('[data-sl-panel]').each(function () { this.hidden = Number(this.getAttribute('data-sl-panel')) !== step; });
        $('[data-sl-step]').removeAttr('aria-current').filter('[data-sl-step="' + step + '"]').attr('aria-current', 'step');
        $('#sl-back').prop('hidden', step === 0); $('#sl-print').prop('hidden', step !== 3); $('#sl-next-step').prop('hidden', step === 3)
            .text([t('lang_sl_choose_layout', 'Choose layout →'), t('lang_sl_preview_labels', 'Preview labels →'), t('lang_sl_print_settings', 'Print settings →')][step] || '');
        $('#view_print_lable .sl-body').scrollTop(0); refresh();
    }
    function renderRows() {
        var body = $('#sl-products').empty(), current = state.entries.filter(function (e) { return state.viewIds.includes(String(e.item._id)); });
        current.forEach(function (e) {
            var row = $('<div class="sl-product-row">'), checked = $('<input type="checkbox">').prop('checked', e.selected).attr('aria-label', t('lang_select', 'Select') + ' ' + e.item.name);
            checked.on('change', function () { cancelBulk(); e.selected = this.checked; state.page = 0; state.furthestStep = 0; refresh(); });
            var name = $('<div>').text(e.item.name).append($('<small>').text(e.item.barcode_id || t('lang_sl_no_barcode', 'No barcode')));
            var money = Number.isFinite(e.item.label_price) ? (root.PosnicPro.local.get('currencySign') || '') + ' ' + e.item.label_price.toFixed(e.item.label_currency_digits ?? 2) : '—';
            var copies = $('<input type="number" min="1" max="999" class="sl-input">').val(e.copies).attr('aria-label', t('lang_print_copies', 'Copies') + ' ' + e.item.name);
            copies.on('change', function () { e.copies = Number(this.value); state.page = 0; state.furthestStep = 0; refresh(); });
            row.append(checked, name, $('<div class="sl-product-price">').text(money), copies); body.append(row);
        });
        if (!current.length) body.append($('<div class="sl-empty">').text(state.loading ? t('lang_sl_loading_products', 'Loading products…') : t('lang_sl_no_matches', 'No matching products.')));
        $('#sl-listed').text(state.productPage + ' / ' + state.totalPages + ' · ' + state.total + ' ' + t('lang_sl_products_count', 'products'));
        $('#sl-product-prev').prop('disabled', state.loading || state.productPage <= 1); $('#sl-product-next').prop('disabled', state.loading || state.productPage >= state.totalPages);
        $('#sl-product-note').text(t('lang_sl_none_automatic', 'Products are selected only when you tick them.'));
        refresh();
    }
    function request(params) {
        return new Promise(function (resolve, reject) {
            root.PosnicPro.get(params, function (r) { if (r && r.type === 'success') resolve(r.data); else reject(Error(r?.message || t('lang_sl_load_failed', 'Could not load product prices.'))); }, function () { reject(Error(t('lang_sl_load_failed', 'Could not load product prices.'))); });
        });
    }
    function remember(items, selected) {
        return items.map(function (item) {
            var existing = state.byId.get(String(item._id));
            if (existing) { existing.item = item; if (selected !== undefined) existing.selected = selected; return existing; }
            var entry = { item: item, selected: selected === true, copies: 1 }; state.entries.push(entry); state.byId.set(String(item._id), entry); return entry;
        });
    }
    function cancelBulk() {
        if (!state.bulkLoading) return;
        state.token++; state.bulkLoading = false; state.loading = false; state.completeKey = null;
        $('#sl-all').prop('disabled', false);
    }
    async function loadPage(page) {
        var token = ++state.token; state.loading = true; state.bulkLoading = false; state.loadError = null;
        state.productPage = page; renderRows();
        try {
            var data = await request({ url: 'items', data: { page: page, limit: 30, filters: JSON.stringify(filters()), label_pricing: 'true' } });
            if (state.token !== token) return;
            var current = remember(data.list || []);
            state.viewIds = current.map(function (e) { return String(e.item._id); });
            state.total = Number(data.total) || 0; state.totalPages = Math.max(1, Number(data.total_pages) || 1);
        } catch (e) { if (state.token === token) state.loadError = e; }
        finally { if (state.token === token) { state.loading = false; renderRows(); } }
    }
    async function loadAll() {
        if (state.loading) return;
        var token = ++state.token, query = filters(), key = JSON.stringify(query), loaded = [], expectedTotal;
        state.loading = true; state.bulkLoading = true; state.loadError = null; selectedCount();
        $('#sl-clear').prop('disabled', false);
        try {
            for (var page = 1, last = 1; page <= last; page++) {
                var data = await request({ url: 'items', data: { page: page, limit: 100, filters: key, label_pricing: 'true' } });
                if (state.token !== token) return;
                if (expectedTotal === undefined) expectedTotal = Number(data.total);
                if (Number(data.total) !== expectedTotal) throw Error(t('lang_sl_catalogue_changed', 'The catalogue changed while loading. Reload before printing.'));
                last = Number(data.total_pages) || 1; loaded = loaded.concat(data.list || []);
                $('#sl-product-note').text(t('lang_sl_loading_products', 'Loading products…') + ' ' + loaded.length + ' / ' + expectedTotal);
                if (loaded.length > 100000) throw Error(t('lang_sl_narrow_filter', 'Too many products. Narrow the Items filter before printing.'));
            }
            if (loaded.length !== expectedTotal || new Set(loaded.map(function (item) { return String(item._id); })).size !== loaded.length) throw Error(t('lang_sl_catalogue_changed', 'The catalogue changed while loading. Reload before printing.'));
            remember(loaded, true); state.completeKey = key; state.total = expectedTotal; state.furthestStep = 0;
        } catch (e) { if (state.token === token) state.loadError = e; }
        finally { if (state.token === token) { state.loading = false; state.bulkLoading = false; renderRows(); } }
    }
    function clear() {
        cancelBulk(); state.entries.forEach(function (e) { e.selected = false; }); state.page = 0; state.furthestStep = 0; state.loadError = null;
        setStep(0); renderRows();
    }
    function open(id) {
        state.token++; state.entries = []; state.byId = new Map(); state.viewIds = []; state.step = 0; state.furthestStep = 0; state.page = 0; state.loading = false; state.bulkLoading = false; state.loadError = null; state.completeKey = null;
        state.total = 0; state.totalPages = 1; state.productPage = 1;
        // The wizard owns its visible search/category filters. Tenant scope remains enforced by the Items API.
        state.filters = {};
        state.elementLayout = readElementLayout();
        $('#sl-search').val(''); $('#sl-category').val(''); $('#sl-from').val(1); $('#sl-batch').val(2000); $('#sl-copies').val(1);
        $('#sl-width').val(Math.round(Number($('#document_width').val()) * 25.4 * 10) / 10); $('#sl-height').val(Math.round(Number($('#document_height').val()) * 25.4 * 10) / 10);
        try {
            var saved = JSON.parse(root.localStorage.getItem('posnic.shelf-label-layout') || 'null');
            if (saved) {
                if (['a4', 'roll'].includes(saved.paper)) $('#sl-paper').val(saved.paper);
                ['width', 'height', 'margin', 'gap', 'start'].forEach(function (key) { if (Number.isFinite(saved[key])) $('#sl-' + key).val(saved[key]); });
                ['guides', 'date', 'mrp', 'shop'].forEach(function (key) { if (typeof saved[key] === 'boolean') $('#sl-' + key).prop('checked', saved[key]); });
                ['mfg', 'exp'].forEach(function (key) { if (typeof saved[key] === 'boolean') $('#' + key + '_checkbox').prop('checked', saved[key]); });
                if (typeof saved.barcode === 'boolean') $('#sl-show-barcode').prop('checked', saved.barcode);
                if (typeof saved.barText === 'boolean') $('#sl-bar-text').prop('checked', saved.barText);
                if (saved.design) {
                    var d = saved.design;
                    Object.entries({ font: 'font', fontSize: 'bar-fontSize', ink: 'line-color', background: 'background-color', format: 'barcodeLabelType', barWidth: 'bar-width', barHeight: 'bar-height', barMargin: 'bar-margin', textMargin: 'bar-text-margin', top: 'margin_top', bottom: 'margin_bottom', left: 'margin_left', right: 'margin_right' }).forEach(function (pair) { if (d[pair[0]] !== undefined) $('#' + pair[1]).val(d[pair[0]]); });
                    if (['left', 'center', 'right'].includes(d.align)) $('.text-align').removeClass('btn-primary').filter('[value="' + d.align + '"]').addClass('btn-primary');
                    $('.font-option').each(function () { $(this).toggleClass('btn-primary', typeof d.fontOptions === 'string' && d.fontOptions.split(' ').includes(this.value)); });
                }
            }
        } catch (_) { /* Use current controls if storage is unavailable. */ }
        $('#view_print_lable').modal('show'); setStep(0); renderRows();
        var scopeToken = state.token;
        root.PosnicPro.get({ url: 'categories/getCategoryAjaxList', data: 'query=' }, function (response) {
            if (!$('#view_print_lable').hasClass('show') || !response) return;
            var category = $('#sl-category').val(); $('#sl-category option:not(:first)').remove();
            (response.suggestions || []).forEach(function (item) { $('#sl-category').append($('<option>').val(item.id).text(item.name || item.value)); });
            $('#sl-category').val(category || '');
        });
        if (!id) { loadPage(1); return; }
        state.loading = true; renderRows();
        request({ url: 'items/' + id, data: { label_pricing: 'true' } }).then(function (item) {
            if (state.token !== scopeToken) return;
            remember([item], true); state.viewIds = [String(item._id)]; state.total = 1; state.loading = false; renderRows();
        }).catch(function (e) { if (state.token === scopeToken) { state.loading = false; state.loadError = e; refresh(); } });
    }
    function print(test) {
        try {
            if (state.step !== 3) throw Error(t('lang_sl_review_first', 'Review the labels before printing.'));
            if (state.loading) throw Error(t('lang_sl_wait_loading', 'Wait for products to finish loading.'));
            if (state.loadError) throw state.loadError;
            var s = settings(), g = geometry(s), entries = chosen(), from = Number($('#sl-from').val()), amount = test ? 1 : Number($('#sl-batch').val());
            var first = slots(entries, g, 0, from, amount), html = '';
            for (var i = 0; i < first.pages; i++) html += sheet(root.document, slots(entries, g, i, from, amount).cells, s, root.JsBarcode).outerHTML;
            root.printJS({ printable: html, type: 'raw-html', style: css(s, g), scanStyles: false, documentTitle: t('lang_shelf_label_products', 'Shelf label products') });
        } catch (e) { error(e); }
        return false;
    }
    function init() {
        if (!root.jQuery || !root.document) return;
        $(root.document).on('click', '[data-sl-step]', function () { setStep(Number(this.getAttribute('data-sl-step'))); });
        $(root.document).on('click', '#sl-next-step', function () { setStep(state.step + 1); });
        $(root.document).on('click', '#sl-back', function () { setStep(state.step - 1); });
        $(root.document).on('input change', '#view_print_lable input:not(#sl-search):not(#sl-all):not(#sl-page-all):not(#sl-category),#view_print_lable select:not(#sl-category),#view_print_lable textarea', function () {
            if (this.id === 'sl-width' || this.id === 'sl-height') { $('#document_width').val(Number($('#sl-width').val()) / 25.4); $('#document_height').val(Number($('#sl-height').val()) / 25.4); }
            if (state.step === 1) state.furthestStep = 1;
            state.page = 0; refresh();
            if (state.step === 1 && typeof root.newBarcode === 'function') root.newBarcode();
        });
        $(root.document).on('click', '#view_print_lable .text-align,#view_print_lable .font-option', function () {
            if ($(this).hasClass('text-align')) $('#view_print_lable .text-align').removeClass('btn-primary').filter(this).addClass('btn-primary');
            else $(this).toggleClass('btn-primary');
            state.furthestStep = 1;
            if (typeof root.newBarcode === 'function') root.newBarcode();
            refresh();
        });
        function readTemplates() {
            try {
                var saved = JSON.parse(root.localStorage.getItem('posnic.shelf-label-templates') || '[]');
                return Array.isArray(saved) ? saved.filter(function (x) { return x && typeof x.name === 'string' && x.settings; }) : [];
            } catch (_) { return []; }
        }
        function renderTemplates(selected) {
            var select = $('#sl-template-list'), templates = readTemplates();
            select.empty().append($('<option>').val('').text('Choose a saved template…'));
            templates.forEach(function (item) {
                select.append($('<option>').val(item.name).text(item.name));
            });
            if (selected) select.val(selected);
            $('#sl-template-load,#sl-template-delete').prop('disabled', !select.val());
        }
        function applyTemplate(saved) {
            if (!saved || typeof saved !== 'object') return;
            if (saved.elementLayout && typeof saved.elementLayout === 'object') {
                try {
                    root.localStorage.setItem('posnic.shelf-label-elements', JSON.stringify(saved.elementLayout));
                    state.elementLayout = readElementLayout();
                } catch (_) {}
            }
            if (typeof saved.logoData === 'string' && /^data:image\/(png|jpeg|webp);base64,/i.test(saved.logoData)) {
                try { root.localStorage.setItem('posnic.shelf-label-logo', saved.logoData); } catch (_) {}
            } else {
                try { root.localStorage.removeItem('posnic.shelf-label-logo'); } catch (_) {}
            }
            if (['a4', 'roll'].includes(saved.paper)) $('#sl-paper').val(saved.paper);
            ['width', 'height', 'margin', 'gap', 'start'].forEach(function (key) {
                if (Number.isFinite(saved[key])) $('#sl-' + key).val(saved[key]);
            });
            ['guides', 'date', 'mrp', 'shop'].forEach(function (key) {
                if (typeof saved[key] === 'boolean') $('#sl-' + key).prop('checked', saved[key]);
            });
            ['mfg', 'exp'].forEach(function (key) {
                if (typeof saved[key] === 'boolean') $('#' + key + '_checkbox').prop('checked', saved[key]);
            });
            if (typeof saved.barcode === 'boolean') $('#sl-show-barcode').prop('checked', saved.barcode);
            if (typeof saved.barText === 'boolean') $('#sl-bar-text').prop('checked', saved.barText);
            if (saved.design) {
                var d = saved.design;
                Object.entries({ font: 'font', fontSize: 'bar-fontSize', ink: 'line-color', background: 'background-color', format: 'barcodeLabelType', barWidth: 'bar-width', barHeight: 'bar-height', barMargin: 'bar-margin', textMargin: 'bar-text-margin', top: 'margin_top', bottom: 'margin_bottom', left: 'margin_left', right: 'margin_right' }).forEach(function (pair) {
                    if (d[pair[0]] !== undefined) $('#' + pair[1]).val(d[pair[0]]);
                });
                if (['left', 'center', 'right'].includes(d.align)) $('.text-align').removeClass('btn-primary').filter('[value="' + d.align + '"]').addClass('btn-primary');
                $('.font-option').each(function () { $(this).toggleClass('btn-primary', typeof d.fontOptions === 'string' && d.fontOptions.split(' ').includes(this.value)); });
            }
            refresh();
        }
        $(root.document).on('click', '#sl-template-save', function () {
            try {
                refresh();
                var name = root.prompt('Name this label template:');
                if (name === null) return;
                name = String(name).trim().slice(0, 80);
                if (!name) { $('#sl-status').text('Enter a template name.'); return; }
                var templates = readTemplates(), existing = templates.findIndex(function (x) { return x.name.toLowerCase() === name.toLowerCase(); });
                var current = JSON.parse(root.localStorage.getItem('posnic.shelf-label-layout') || 'null');
                if (!current) throw Error('Adjust the label settings before saving a template.');
                var record = { name: name, settings: current, updatedAt: new Date().toISOString() };
                if (existing >= 0) {
                    if (!root.confirm('Replace the saved template "' + templates[existing].name + '"?')) return;
                    templates[existing] = record;
                } else templates.push(record);
                root.localStorage.setItem('posnic.shelf-label-templates', JSON.stringify(templates));
                renderTemplates(name);
                $('#sl-status').text('Template "' + name + '" saved in this browser.');
            } catch (e) { error(e); }
        });
        $(root.document).on('change', '#sl-logo-file', function () {
            var file = this.files && this.files[0];
            if (!file) return;
            if (!/^image\/(png|jpeg|webp)$/i.test(file.type) || file.size > 1024 * 1024) {
                this.value = '';
                $('#sl-status').text('Choose a PNG, JPEG or WebP logo smaller than 1 MB.');
                return;
            }
            var reader = new FileReader();
            reader.onload = function () {
                try {
                    if (typeof reader.result !== 'string' || !/^data:image\/(png|jpeg|webp);base64,/i.test(reader.result)) throw Error('Could not read the logo image.');
                    root.localStorage.setItem('posnic.shelf-label-logo', reader.result);
                    state.elementLayout = state.elementLayout || readElementLayout();
                    refresh();
                    $('#sl-status').text('Store logo added to the label design.');
                } catch (e) { $('#sl-status').text(e.message || 'Could not save the logo.'); }
            };
            reader.onerror = function () { $('#sl-status').text('Could not read the logo image.'); };
            reader.readAsDataURL(file);
        });
        $(root.document).on('click', '#sl-logo-remove', function () {
            try { root.localStorage.removeItem('posnic.shelf-label-logo'); } catch (_) {}
            $('#sl-logo-file').val('');
            refresh();
            $('#sl-status').text('Store logo removed.');
        });
        $(root.document).on('change', '#sl-template-list', function () {
            $('#sl-template-load,#sl-template-delete').prop('disabled', !this.value);
        });
        $(root.document).on('click', '#sl-template-load', function () {
            var chosen = $('#sl-template-list').val(), item = readTemplates().find(function (x) { return x.name === chosen; });
            if (!item) return;
            applyTemplate(item.settings);
            $('#sl-status').text('Loaded template "' + item.name + '".');
        });
        $(root.document).on('click', '#sl-template-delete', function () {
            var chosen = $('#sl-template-list').val();
            if (!chosen || !root.confirm('Delete the template "' + chosen + '"?')) return;
            root.localStorage.setItem('posnic.shelf-label-templates', JSON.stringify(readTemplates().filter(function (x) { return x.name !== chosen; })));
            renderTemplates();
            $('#sl-status').text('Template deleted.');
        });
        $(root.document).on('pointerdown', '#sl-sample .sl-element', function (e) {
            if (e.target.closest('.sl-resize-handle')) return;
            var key = this.dataset.slElement, label = this.closest('.sl-label');
            if (!key || !label) return;
            e.preventDefault();
            if (e.shiftKey || e.ctrlKey || e.metaKey) {
                $(this).toggleClass('sl-selected');
                syncSelectionControls();
                return;
            }
            if (!$(this).hasClass('sl-selected')) {
                $('#sl-sample .sl-element').removeClass('sl-selected');
                $(this).addClass('sl-selected');
            }
            syncSelectionControls();
            var rect = label.getBoundingClientRect(), layout = state.elementLayout[key] || DEFAULT_ELEMENT_LAYOUT[key];
            var dragKeys = layout.group_id ? Object.keys(state.elementLayout).filter(function (k) { return state.elementLayout[k].group_id === layout.group_id; }) : [key];
            var initialLayouts = {};
            dragKeys.forEach(function (k) { initialLayouts[k] = Object.assign({}, state.elementLayout[k]); });
            editorDrag = { key: key, keys: dragKeys, initialLayouts: initialLayouts, mode: 'move', startX: e.clientX, startY: e.clientY, rect: rect, initial: Object.assign({}, layout) };
            if (this.setPointerCapture && e.pointerId !== undefined) { try { this.setPointerCapture(e.pointerId); } catch (_) {} }
        });
        $(root.document).on('pointerdown', '#sl-sample .sl-resize-handle', function (e) {
            var label = this.closest('.sl-label'), key = this.dataset.slResizeFor;
            if (!key || !label) return;
            e.preventDefault(); e.stopPropagation();
            $('#sl-sample .sl-element').removeClass('sl-selected');
            var selectedElement = label.querySelector('[data-sl-element="' + key + '"]');
            if (selectedElement) $(selectedElement).addClass('sl-selected');
            syncSelectionControls();
            var layout = state.elementLayout[key] || DEFAULT_ELEMENT_LAYOUT[key];
            editorDrag = { key: key, mode: 'resize', startX: e.clientX, startY: e.clientY, rect: label.getBoundingClientRect(), initial: Object.assign({}, layout) };
        });
        function syncSelectionControls() {
            var selected = $('#sl-sample .sl-element.sl-selected');
            $('#sl-rotate-element').prop('disabled', selected.length !== 1);
            $('#sl-group-elements').prop('disabled', selected.length < 2);
            $('#sl-ungroup-elements').prop('disabled', !selected.toArray().some(function (node) {
                var layout = state.elementLayout[node.dataset.slElement]; return layout && layout.group_id;
            }));
            $('#sl-apply-element-style').prop('disabled', selected.length === 0);
            var customSelected = selected.filter(function (node) { return node.dataset.slElement.indexOf('custom_') === 0; });
            $('#sl-apply-element-text').prop('disabled', customSelected.length === 0);
            $('#sl-delete-custom-element').prop('disabled', customSelected.length === 0);
            if (selected.length === 1) {
                var selectedKey = selected[0].dataset.slElement;
                $('#sl-selected-element-text').val(selectedKey.indexOf('custom_') === 0 ? (state.elementLayout[selectedKey].text || '') : '');
                var current = state.elementLayout[selected[0].dataset.slElement] || {};
                $('#sl-element-font-size').val(current.font_size || (selected[0].dataset.slElement === 'price' ? 220 : selected[0].dataset.slElement === 'details' ? 75 : 100));
                $('#sl-element-font-weight').val(current.font_weight || 'normal');
                $('#sl-element-text-align').val(current.text_align || 'center');
                $('#sl-element-color').val(current.color || '#000000');
            }
        }
        $(root.document).on('click', '#sl-add-text-element', function () {
            var value = String($('#sl-new-element-text').val() || '').trim();
            if (!value) { error('Enter the text you want to add to the label.'); return; }
            var key = 'custom_' + Date.now().toString(36);
            state.elementLayout[key] = { x: 10, y: 10, w: 45, h: 12, rotation: 0, group_id: '', font_size: 100, font_weight: 'normal', text_align: 'center', color: '#000000', text: value };
            try { root.localStorage.setItem('posnic.shelf-label-elements', JSON.stringify(state.elementLayout)); } catch (_) {}
            $('#sl-new-element-text').val('');
            refresh();
            var node = document.querySelector('#sl-sample .sl-element[data-sl-element="' + key + '"]');
            if (node) node.classList.add('sl-selected');
            syncSelectionControls();
        });
        $(root.document).on('click', '#sl-apply-element-text', function () {
            var nodes = $('#sl-sample .sl-element.sl-selected').toArray().filter(function (node) { return node.dataset.slElement.indexOf('custom_') === 0; });
            if (!nodes.length) return;
            var value = String($('#sl-selected-element-text').val() || '').trim();
            if (!value) { error('Custom text cannot be empty.'); return; }
            var keys = nodes.map(function (node) { return node.dataset.slElement; });
            keys.forEach(function (key) { state.elementLayout[key].text = value; });
            try { root.localStorage.setItem('posnic.shelf-label-elements', JSON.stringify(state.elementLayout)); } catch (_) {}
            refresh();
            keys.forEach(function (key) { var node = document.querySelector('#sl-sample .sl-element[data-sl-element="' + key + '"]'); if (node) node.classList.add('sl-selected'); });
            syncSelectionControls();
        });
        $(root.document).on('click', '#sl-delete-custom-element', function () {
            var keys = $('#sl-sample .sl-element.sl-selected').toArray().map(function (node) { return node.dataset.slElement; }).filter(function (key) { return key.indexOf('custom_') === 0; });
            if (!keys.length) return;
            keys.forEach(function (key) { delete state.elementLayout[key]; });
            try { root.localStorage.setItem('posnic.shelf-label-elements', JSON.stringify(state.elementLayout)); } catch (_) {}
            refresh(); syncSelectionControls();
        });
        $(root.document).on('click', '#sl-apply-element-style', function () {
            var nodes = $('#sl-sample .sl-element.sl-selected').toArray();
            if (!nodes.length) return;
            var fontSize = Number($('#sl-element-font-size').val());
            if (!Number.isFinite(fontSize) || fontSize < 40 || fontSize > 400) { error('Element font size must be between 40% and 400%.'); return; }
            var fontWeight = $('#sl-element-font-weight').val() === 'bold' ? 'bold' : 'normal';
            var textAlign = ['left','center','right'].indexOf($('#sl-element-text-align').val()) >= 0 ? $('#sl-element-text-align').val() : 'center';
            var color = /^#[0-9a-f]{6}$/i.test($('#sl-element-color').val()) ? $('#sl-element-color').val() : '#000000';
            nodes.forEach(function (node) {
                var key = node.dataset.slElement, current = state.elementLayout[key] || {};
                state.elementLayout[key] = Object.assign({}, current, { font_size: fontSize, font_weight: fontWeight, text_align: textAlign, color: color });
            });
            try { root.localStorage.setItem('posnic.shelf-label-elements', JSON.stringify(state.elementLayout)); } catch (_) {}
            var keys = nodes.map(function (node) { return node.dataset.slElement; });
            refresh();
            keys.forEach(function (key) { var node = document.querySelector('#sl-sample .sl-element[data-sl-element="' + key + '"]'); if (node) node.classList.add('sl-selected'); });
            syncSelectionControls();
        });
        $(root.document).on('click', '#sl-group-elements', function () {
            var keys = $('#sl-sample .sl-element.sl-selected').toArray().map(function (node) { return node.dataset.slElement; }).filter(Boolean);
            if (keys.length < 2) return;
            var groupId = 'label-group-' + Date.now();
            keys.forEach(function (key) { state.elementLayout[key].group_id = groupId; });
            try { root.localStorage.setItem('posnic.shelf-label-elements', JSON.stringify(state.elementLayout)); } catch (_) {}
            refresh();
            keys.forEach(function (key) { var node = document.querySelector('#sl-sample .sl-element[data-sl-element="' + key + '"]'); if (node) node.classList.add('sl-selected'); });
            syncSelectionControls();
        });
        $(root.document).on('click', '#sl-ungroup-elements', function () {
            var keys = $('#sl-sample .sl-element.sl-selected').toArray().map(function (node) { return node.dataset.slElement; }).filter(Boolean);
            keys.forEach(function (key) { if (state.elementLayout[key]) delete state.elementLayout[key].group_id; });
            try { root.localStorage.setItem('posnic.shelf-label-elements', JSON.stringify(state.elementLayout)); } catch (_) {}
            refresh();
            keys.forEach(function (key) { var node = document.querySelector('#sl-sample .sl-element[data-sl-element="' + key + '"]'); if (node) node.classList.add('sl-selected'); });
            syncSelectionControls();
        });
        $(root.document).on('click', '#sl-rotate-element', function () {
            var selected = document.querySelector('#sl-sample .sl-element.sl-selected');
            var key = selected && selected.dataset.slElement;
            if (!key || !state.elementLayout[key]) { $(this).prop('disabled', true); return; }
            var layout = Object.assign({}, state.elementLayout[key]);
            layout.rotation = (((Number(layout.rotation) || 0) + 90) % 360 + 360) % 360;
            state.elementLayout[key] = layout;
            selected.style.transform = 'rotate(' + layout.rotation + 'deg)';
            selected.style.transformOrigin = 'center center';
            try { root.localStorage.setItem('posnic.shelf-label-elements', JSON.stringify(state.elementLayout)); } catch (_) {}
            refresh();
            var restored = document.querySelector('#sl-sample .sl-element[data-sl-element="' + key + '"]');
            if (restored) restored.classList.add('sl-selected');
            $('#sl-rotate-element').prop('disabled', !restored);
        });
        $(root.document).on('pointermove', function (e) {
            if (!editorDrag) return;
            var drag = editorDrag, dx = (e.clientX - drag.startX) / Math.max(1, drag.rect.width) * 100;
            var dy = (e.clientY - drag.startY) / Math.max(1, drag.rect.height) * 100;
            var keys = drag.mode === 'move' ? drag.keys : [drag.key];
            keys.forEach(function (key) {
                var initial = drag.initialLayouts ? drag.initialLayouts[key] : drag.initial;
                var next = Object.assign({}, initial);
                if (drag.mode === 'move') {
                    next.x = Math.max(0, Math.min(100 - next.w, initial.x + dx));
                    next.y = Math.max(0, Math.min(100 - next.h, initial.y + dy));
                } else {
                    next.w = Math.max(5, Math.min(100 - next.x, initial.w + dx));
                    next.h = Math.max(5, Math.min(100 - next.y, initial.h + dy));
                }
                state.elementLayout[key] = next;
                var element = document.querySelector('#sl-sample [data-sl-element="' + key + '"]');
                if (element) {
                    element.style.left = next.x + '%'; element.style.top = next.y + '%';
                    element.style.width = next.w + '%'; element.style.height = next.h + '%';
                    var handle = document.querySelector('#sl-sample .sl-resize-handle[data-sl-resize-for="' + key + '"]');
                    if (handle) { handle.style.left = (next.x + next.w) + '%'; handle.style.top = (next.y + next.h) + '%'; }
                }
            });
        });
        $(root.document).on('pointerup pointercancel', function () {
            if (!editorDrag) return;
            editorDrag = null;
            try { root.localStorage.setItem('posnic.shelf-label-elements', JSON.stringify(state.elementLayout)); } catch (_) {}
            refresh();
            syncSelectionControls();
        });
                $(root.document).on('shown.bs.modal', '#view_print_lable', function () { renderTemplates(); refresh(); });
        $(root.document).on('hidden.bs.modal', '#view_print_lable', function () { state.token++; state.loading = false; state.bulkLoading = false; clearTimeout(searchTimer); });
        $(root.document).on('change', '#sl-all', function () { if (this.checked) loadAll(); else clear(); });
        $(root.document).on('change', '#sl-page-all', function () { cancelBulk(); var selected = this.checked; state.entries.forEach(function (e) { if (state.viewIds.includes(String(e.item._id))) e.selected = selected; }); state.furthestStep = 0; renderRows(); });
        $(root.document).on('click', '#sl-clear', clear);
        $(root.document).on('click', '#sl-apply-copies', function () { var n = Number($('#sl-copies').val()); if (!Number.isInteger(n) || n < 1 || n > 999) return error(Error(t('lang_sl_valid_copies', 'Copies must be between 1 and 999.'))); chosen().forEach(function (e) { e.copies = n; }); state.furthestStep = 0; renderRows(); });
        $(root.document).on('input', '#sl-search', function () { cancelBulk(); clearTimeout(searchTimer); searchTimer = setTimeout(function () { state.completeKey = null; loadPage(1); }, 250); });
        $(root.document).on('keydown', '#sl-search', function (e) { if (e.key === 'Enter') { e.preventDefault(); clearTimeout(searchTimer); loadPage(1); } });
        $(root.document).on('change', '#sl-category', function () { cancelBulk(); state.completeKey = null; loadPage(1); });
        $(root.document).on('click', '#sl-product-prev,#sl-product-next', function () { loadPage(state.productPage + (this.id === 'sl-product-next' ? 1 : -1)); });
        $(root.document).on('click', '#sl-prev,#sl-next', function () { state.page += this.id === 'sl-next' ? 1 : -1; refresh(); });
        $(root.document).on('click', '#sl-test', function () { print(true); });
        $(root.document).on('click', '#sl-print', function () { print(false); });
        $(root.document).on('change', '#sl-paper', function () { $('#sl-start').val(1); refresh(); });
        $(root).on('resize', function () { if (state.step > 0) refresh(); });
    }
    init();
    return { geometry: geometry, count: count, slots: slots, css: css, label: label, sheet: sheet, open: open, print: print, refresh: refresh };
});
