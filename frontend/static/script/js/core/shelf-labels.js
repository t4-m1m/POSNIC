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
            '.sl-label .sl-element{position:absolute;margin:0;padding:0;overflow:visible;display:flex;align-items:center;justify-content:' + (s.align === 'left' ? 'flex-start' : s.align === 'right' ? 'flex-end' : 'center') + ';line-height:1.15;overflow-wrap:anywhere}' +
            '.sl-name{font-weight:600;white-space:pre-line}.sl-custom-text{white-space:pre-wrap}.sl-logo{object-fit:contain}.sl-price{font-weight:700}.sl-variant-values{display:block!important;white-space:pre-line}.sl-variant-line{display:block;width:100%;line-height:1.15}.sl-label svg.sl-element{display:block;width:100%;height:100%;max-width:none;max-height:none;overflow:visible;}' +
            '.sl-foot{font-size:75%;white-space:pre-line}.sl-barcode-visual{display:flex!important;align-items:center;justify-content:center;overflow:hidden}.sl-barcode-visual svg.sl-barcode{display:block;width:auto!important;max-width:100%;height:100%;max-height:100%;overflow:hidden}.sl-design-editable .sl-element{outline:1px dashed #2563eb;cursor:move;touch-action:none}' +
            '.sl-design-editable .sl-element.sl-selected{outline:2px solid #ef4444;z-index:20;overflow:visible}' +
            '.sl-resize-handle{position:absolute;width:12px;height:12px;border:2px solid white;border-radius:2px;background:#2563eb;cursor:nwse-resize;z-index:21;transform:translate(-50%,-50%);touch-action:none}' +
            '.sl-rotate-handle{position:absolute;width:13px;height:13px;border:2px solid white;border-radius:50%;background:#f97316;cursor:grab;z-index:22;transform:translate(-50%,-50%);touch-action:none;box-shadow:0 0 0 1px #c2410c}' +
            '.sl-rotate-handle:after{content:"";position:absolute;width:2px;height:7px;background:#f97316;left:4px;top:-7px}';
    }
    function validateDesign(s) {
        if (!/^[a-zA-Z ,\-]+$/.test(s.font) || !['left', 'center', 'right'].includes(s.align) || !/^#[a-f\d]{6}$/i.test(s.background) || !/^#[a-f\d]{6}$/i.test(s.ink)) throw Error('Invalid label design.');
        if (!Number.isFinite(s.fontSize) || s.fontSize < 3 || s.fontSize > 36) throw Error('Choose a font size between 3 and 36.');
    }
    var DEFAULT_ELEMENT_LAYOUT = {
        name: { x: 4, y: 2, w: 92, h: 16, rotation: 0, font_size: 100, font_weight: 'bold', text_align: 'center', color: '#000000' },
        price: { x: 8, y: 78, w: 84, h: 16, font_size: 220, font_weight: 'bold', text_align: 'center', color: '#000000' },
        variant_values: { x: 3, y: 20, w: 94, h: 14, font_size: 100, font_weight: 'normal', text_align: 'center', color: '#000000' },
        brand: { x: 5, y: 35, w: 90, h: 10, font_size: 90, font_weight: 'bold', text_align: 'center', color: '#000000' },
        reference: { x: 5, y: 45, w: 90, h: 10, font_size: 75, font_weight: 'normal', text_align: 'center', color: '#000000' },
        barcode: { x: 20, y: 54, w: 60, h: 42, rotation: 0, font_size: 70 },
        custom_text: { x: 5, y: 44, w: 90, h: 12, rotation: 0, text: '' },
        image: { x: 3, y: 3, w: 20, h: 15, rotation: 0 }
    };
    function readElementLayout() {
        var saved = {};
        try { saved = JSON.parse(root.localStorage.getItem('posnic.shelf-label-elements') || '{}') || {}; } catch (_) {}
        var result = {};
        Object.keys(DEFAULT_ELEMENT_LAYOUT).forEach(function (key) {
            var d = DEFAULT_ELEMENT_LAYOUT[key] || { x: 10, y: 10, w: 45, h: 12 }, v = saved[key] || {};
            function n(name) { var value = Number(v[name]); return Number.isFinite(value) ? value : d[name]; }
            var w = Math.max(5, Math.min(300, n('w'))), h = Math.max(5, Math.min(300, n('h')));
            var rawRotation = n('rotation');
            var rotation = Number.isFinite(rawRotation) ? ((rawRotation % 360) + 360) % 360 : 0;
            var defaultFontSize = key === 'price' ? 220 : key === 'details' ? 75 : 100;
            var fontSize = Number(v.font_size);
            if (!Number.isFinite(fontSize)) fontSize = defaultFontSize;
            fontSize = Math.max(25, Math.min(600, fontSize));
            var fontWeight = v.font_weight === 'bold' ? 'bold' : (v.font_weight === 'normal' ? 'normal' : (key === 'name' || key === 'price' ? 'bold' : 'normal'));
            var textAlign = ['left', 'center', 'right'].indexOf(v.text_align) >= 0 ? v.text_align : 'center';
            var color = /^#[0-9a-f]{6}$/i.test(String(v.color || '')) ? v.color : '#000000';
            var emphasis = v.emphasis === true;
            if (key === 'barcode' && Number(v.w) === 80 && Number(v.h) === 38 && Number(v.x) === 10 && Number(v.y) === 57) { v = Object.assign({}, v, { x: 22, y: 56, w: 56, h: 38 }); w = 56; h = 38; }
            if (key === 'barcode' && Number(v.w) === 70 && Number(v.h) === 22 && Number(v.x) === 15 && Number(v.y) === 62) { v = Object.assign({}, v, { x: 22, y: 56, w: 56, h: 38 }); w = 56; h = 38; }
            result[key] = { x: Math.max(-300, Math.min(300, n('x'))), y: Math.max(-300, Math.min(300, n('y'))), w: w, h: h, rotation: rotation, group_id: typeof v.group_id === 'string' && v.group_id.length <= 80 ? v.group_id : '', font_size: fontSize, font_weight: fontWeight, emphasis: emphasis, text_align: textAlign, color: color, text: typeof v.text === 'string' ? v.text.slice(0, 120) : '' };
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
        node.style.top = top + '%';
        node.style.width = layout.w + '%';
        node.style.height = height + '%';
        node.style.transform = 'rotate(' + (Number(layout.rotation) || 0) + 'deg)';
        node.style.transformOrigin = 'center center';
        node.style.fontSize = ((Number(s.fontSize) || 12) * (Number(layout.font_size) || 100) / 100) + 'px';
        node.style.fontWeight = layout.font_weight || 'normal';
        node.style.textDecoration = layout.emphasis ? 'underline' : 'none';
        node.style.textAlign = layout.text_align || 'center';
        node.style.color = layout.color || '#000000';
        node.style.transform = 'rotate(' + (Number(layout.rotation) || 0) + 'deg)';
        node.style.transformOrigin = 'center center';
        node.style.justifyContent = layout.text_align === 'left' ? 'flex-start' : layout.text_align === 'right' ? 'flex-end' : 'center';
    }
    function label(doc, item, s, barcode) {
        if (s.barcode !== false && !item.barcode_id) throw Error(item.name + ': ' + t('lang_sl_barcode_missing', 'No barcode is stored for this item.'));
        var div = doc.createElement('div'); div.className = 'sl-label';
        function text(value, cls, key) {
            var p = doc.createElement('p'); p.className = (cls || '') + ' sl-element'; p.textContent = value;
            applyElementLayout(p, key, s); div.appendChild(p); return p;
        }
        var rawName = String(item.name || '').trim();
        var nameParts = rawName.match(/^(.*?)-([0-9]{2}-[0-9]{2}\/[^/]+?)(?:\s+\/\s+(.+))?$/);
        var baseName = nameParts ? nameParts[1].trim() : rawName;
        var brand = s.enabledFields.includes('brand') ? String(item.brand_abbreviation || item.brand_abbreviation_short || item.brand || '').trim() : '';
        var nameText = [baseName, brand].filter(Boolean).join(' · ');
        if (s.enabledFields.includes('name') && nameText.trim()) text(nameText, 'sl-name', 'name');
        if (s.enabledFields.includes('image') && s.logoData) {
            var logo = doc.createElement('img');
            logo.className = 'sl-element sl-logo'; logo.dataset.slElement = 'image';
            logo.alt = 'Label logo'; logo.src = s.logoData;
            applyElementLayout(logo, 'image', s); div.appendChild(logo);
        }
        {
            var selectedVariant = String(item.variant_value || '').trim();
            var selectedAxisParts = String(item.variant_axis || '').split(/\s*\/\s*|\s*,\s*/).map(function (v) { return v.trim(); }).filter(Boolean);
            var selectedValueParts = selectedVariant.split(/\s*\/\s*|\s*,\s*/).map(function (v) { return v.trim(); }).filter(Boolean);
            var selectedByAxis = {};
            selectedAxisParts.forEach(function (axis, index) {
                if (selectedValueParts[index]) selectedByAxis[axis.toLocaleLowerCase()] = selectedValueParts[index].toLocaleLowerCase();
            });
            var allVariants = Array.isArray(item.available_variant_values) ? item.available_variant_values : [];
            var variantOptions = item.available_variant_options && typeof item.available_variant_options === 'object' ? item.available_variant_options : null;
            if (s.enabledFields.includes('variant_values')) {
                var variantNode = doc.createElement('div');
                variantNode.className = 'sl-variant-values sl-element';
                variantNode.dataset.slElement = 'variant_values';
                function appendVariantValue(axis, value) {
                    var span = doc.createElement('span');
                    span.textContent = value;
                    var selected = selectedByAxis[String(axis).toLocaleLowerCase()] === String(value).trim().toLocaleLowerCase();
                    if (selected) {
                        span.style.fontWeight = '900';
                        span.style.textDecoration = 'underline';
                        span.style.backgroundColor = 'rgba(37,99,235,.10)';
                        span.setAttribute('aria-current', 'true');
                    }
                    return span;
                }
                if (variantOptions && Object.keys(variantOptions).length) {
                    Object.keys(variantOptions).sort(function (a, b) {
                        function rank(axis) {
                            var key = String(axis).toLocaleLowerCase();
                            if (/taille|size|pointure|shoe/.test(key)) return 0;
                            if (/couleur|color|colour/.test(key)) return 1;
                            return 2;
                        }
                        return rank(a) - rank(b) || a.localeCompare(b);
                    }).forEach(function (axis) {
                        var line = doc.createElement('div');
                        line.className = 'sl-variant-line';
                        var heading = doc.createElement('strong');
                        heading.textContent = axis + ': ';
                        line.appendChild(heading);
                        variantOptions[axis].forEach(function (value, index) {
                            if (index) line.appendChild(doc.createTextNode(' '));
                            line.appendChild(appendVariantValue(axis, value));
                        });
                        variantNode.appendChild(line);
                    });
                } else {
                    var fallback = doc.createElement('div');
                    fallback.className = 'sl-variant-line';
                    fallback.textContent = selectedVariant;
                    variantNode.appendChild(fallback);
                }
                applyElementLayout(variantNode, 'variant_values', s);
                div.appendChild(variantNode);
            }
            var reference = String(item.reference_date || item.mm_yy || '').trim();
            var modelReference = String(item.model_reference || item.reference || item.ref || '').trim();
            var referenceText = nameParts ? String(nameParts[2] || '').trim() : ((reference ? reference : '') + (reference && modelReference ? ' / ' : '') + modelReference);
            if ((referenceText || modelReference) && s.enabledFields.includes('reference')) text(referenceText || modelReference, 'sl-reference', 'reference');
        }
        if (s.barcode !== false && s.enabledFields.includes('barcode')) {
            var barcodeBox = doc.createElement('div');
            barcodeBox.className = 'sl-element sl-barcode-visual';
            applyElementLayout(barcodeBox, 'barcode', s);
            var svg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.classList.add('sl-barcode');
            barcodeBox.appendChild(svg); div.appendChild(barcodeBox);
            barcode(svg, String(item.barcode_id), { format: s.format || 'CODE128', width: Math.max(0.65, Math.min(1, Number(s.barWidth) || 0.85)), height: 30, margin: 0,
            marginTop: 0, marginBottom: 0, marginLeft: 0, marginRight: 0,
            displayValue: true, textMargin: 2, font: 'monospace', fontSize: 12,
            textAlign: 'center', fontOptions: s.fontOptions || '', lineColor: s.ink, background: s.background });
            svg.style.width = 'auto'; svg.style.maxWidth = '100%'; svg.style.height = '100%'; svg.style.maxHeight = '100%';
        }
        if (s.enabledFields.includes('price') && Number.isFinite(item.label_price)) text(s.currency + ' ' + item.label_price.toFixed(item.label_currency_digits ?? 2), 'sl-price', 'price');
        return div;
    }
    function sheet(doc, cells, s, barcode) {
        var page = doc.createElement('div'); page.className = 'sl-sheet';
        cells.forEach(function (item) { page.appendChild(item ? label(doc, item, s, barcode) : doc.createElement('div')); });
        return page;
    }
    var state = { entries: [], byId: new Map(), viewIds: [], filters: {}, step: 0, furthestStep: 0, page: 0, productPage: 1, totalPages: 1, total: 0, loading: false, bulkLoading: false, token: 0, loadError: null, completeKey: null, selectedElementKey: null };
    // Start blank and clear every saved preset from the retired designer.
    try {
        if (root.localStorage.getItem('posnic.shelf-label-minimal-v3') !== '1') {
            ['posnic.shelf-label-layout', 'posnic.shelf-label-elements',
             'posnic.shelf-label-enabled-fields', 'posnic.shelf-label-templates',
             'posnic.shelf-label-logo'].forEach(function (key) { root.localStorage.removeItem(key); });
            root.localStorage.setItem('posnic.shelf-label-minimal-v3', '1');
        }
    } catch (_) {}
    state.elementLayout = readElementLayout();
    var DEFAULT_ENABLED_FIELDS = [];
    function readEnabledFields() {
        try {
            var saved = JSON.parse(root.localStorage.getItem('posnic.shelf-label-enabled-fields') || 'null');
            if (Array.isArray(saved)) return saved.filter(function (key, index, arr) { return ['variant_values','name','brand','reference','barcode','custom_text','image','price'].includes(key) && arr.indexOf(key) === index; });
        } catch (_) {}
        return DEFAULT_ENABLED_FIELDS.slice();
    }
    state.enabledFields = readEnabledFields();
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
            enabledFields: state.enabledFields || readEnabledFields(),
            paper: $('#sl-paper').val(), width: Number($('#sl-width').val()), height: Number($('#sl-height').val()),
            margin: Number($('#sl-margin').val()), gap: Number($('#sl-gap').val()), start: Number($('#sl-start').val()), guides: $('#sl-guides').is(':checked'),
            logoData: (function () { try { return root.localStorage.getItem('posnic.shelf-label-logo') || ''; } catch (_) { return ''; } })(),
            font: $('#font').val(), fontSize: Number($('#bar-fontSize').val()), align: $('#view_print_lable .text-align.btn-primary').val() || 'center',
            fontOptions: $('#view_print_lable .font-option.btn-primary').map(function () { return this.value; }).get().join(' '),
            background: $('#background-color').val(), ink: $('#line-color').val(), format: $('#barcodeLabelType').val(),
            barWidth: Number($('#bar-width').val()), barHeight: Number($('#bar-height').val()), barMargin: Number($('#bar-margin').val()), textMargin: Number($('#bar-text-margin').val()),
            top: Number($('#margin_top').val()), bottom: Number($('#margin_bottom').val()), left: Number($('#margin_left').val()), right: Number($('#margin_right').val()),
            barcode: (state.enabledFields || readEnabledFields()).includes('barcode'), barText: true, mrp: false, mfg: false, exp: false,
            shop: $('#sl-shop').is(':checked') ? root.PosnicPro.local.get('branchname') || '' : '', address: $('#address-value').val(),
            date: $('#sl-date').is(':checked'), printedDate: new Date().toLocaleDateString(), currency: root.PosnicPro.local.get('currencySign') || ''
        };
        if (s.elementLayout && s.elementLayout.barcode) {
            var labelWidthMm = Math.max(1, Number(s.width) || 45);
            var labelHeightMm = Math.max(1, Number(s.height) || 30);
            var barcodeMaxWidth = Math.min(100, 25 / labelWidthMm * 100);
            var barcodeMaxHeight = Math.min(100, 20 / labelHeightMm * 100);
            s.elementLayout.barcode.w = Math.min(barcodeMaxWidth, Math.max(5, Number(s.elementLayout.barcode.w) || barcodeMaxWidth));
            s.elementLayout.barcode.h = Math.min(barcodeMaxHeight, Math.max(5, Number(s.elementLayout.barcode.h) || barcodeMaxHeight));
            s.elementLayout.barcode.x = Math.max(0, Math.min(100 - s.elementLayout.barcode.w, Number(s.elementLayout.barcode.x) || 0));
            s.elementLayout.barcode.y = Math.max(0, Math.min(100 - s.elementLayout.barcode.h, Number(s.elementLayout.barcode.y) || 0));
        }
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
            style.textContent += '\n#sl-sample .sl-sheet{overflow:visible!important}#sl-sample .sl-label.sl-design-editable{overflow:visible!important}#sl-sample .sl-resize-handle,#sl-sample .sl-rotate-handle{pointer-events:auto}';
            page.querySelectorAll('.sl-label').forEach(function (label) {
                label.classList.add('sl-design-editable');
                label.querySelectorAll('[data-sl-element]').forEach(function (element) {
                    var key = element.dataset.slElement, layout = state.elementLayout[key] || DEFAULT_ELEMENT_LAYOUT[key] || { x: 5, y: 5, w: 90, h: 12, rotation: 0 };
                    var handle = doc.createElement('span');
                    handle.className = 'sl-resize-handle';
                    handle.dataset.slResizeFor = key;
                    handle.setAttribute('aria-hidden', 'true');
                    handle.style.left = (layout.x + layout.w) + '%';
                    handle.style.top = (layout.y + layout.h) + '%';
                    label.appendChild(handle);
                    var rotateHandle = doc.createElement('span');
                    rotateHandle.className = 'sl-rotate-handle';
                    rotateHandle.dataset.slRotateFor = key;
                    rotateHandle.setAttribute('aria-label', 'Rotate element');
                    rotateHandle.style.left = (layout.x + layout.w / 2) + '%';
                    rotateHandle.style.top = Math.max(1, layout.y - 4) + '%';
                    label.appendChild(rotateHandle);
                });
            });
        }
        if (host === '#sl-sample') {
            var selectedKey = state.selectedElementKey;
            var selectedNode = selectedKey && page.querySelector('[data-sl-element="' + selectedKey + '"]');
            if (!selectedNode) { selectedNode = page.querySelector('[data-sl-element]'); state.selectedElementKey = selectedNode ? selectedNode.dataset.slElement : null; }
            if (selectedNode) selectedNode.classList.add('sl-selected');
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
            try { root.localStorage.setItem('posnic.shelf-label-layout', JSON.stringify({ paper: s.paper, width: s.width, height: s.height, margin: s.margin, gap: s.gap, start: s.start, guides: s.guides, barcode: s.barcode, barText: s.barText, enabledFields: s.enabledFields, shop: !!s.shop, date: s.date, mrp: s.mrp, mfg: s.mfg, exp: s.exp, elementLayout: s.elementLayout, logoData: s.logoData,
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
    async function enrichVariantValues(items) {
        var parents = Array.from(new Set((items || []).map(function (item) {
            return String(item.variant_parent_name || '').trim();
        }).filter(Boolean)));
        for (var parent of parents) {
            try {
                var data = await request({ url: 'items', data: { page: 1, limit: 100, filters: JSON.stringify({ variant_parent_name: parent }), label_pricing: 'true' } });
                var rows = Array.isArray(data.list) ? data.list : [];
                var values = Array.from(new Set(rows.map(function (row) { return String(row.variant_value || '').trim(); }).filter(Boolean)));
                var axes = {};
                function splitParts(value) { return String(value || '').split(/\s*\/\s*|\s*,\s*/).map(function (part) { return part.trim(); }).filter(Boolean); }
                rows.forEach(function (row) {
                    var axisParts = splitParts(row.variant_axis), valueParts = splitParts(row.variant_value);
                    axisParts.forEach(function (axis, index) {
                        var value = valueParts[index];
                        if (!axis || !value) return;
                        var canonical = axis.toLocaleLowerCase();
                        var key = Object.keys(axes).find(function (existing) { return existing.toLocaleLowerCase() === canonical; }) || axis;
                        if (!axes[key]) axes[key] = [];
                        if (!axes[key].some(function (existing) { return existing.toLocaleLowerCase() === value.toLocaleLowerCase(); })) axes[key].push(value);
                    });
                });
                state.entries.forEach(function (entry) {
                    if (String(entry.item.variant_parent_name || '').trim() === parent) {
                        entry.item.available_variant_values = values;
                        entry.item.available_variant_options = axes;
                    }
                });
            } catch (_) { /* Keep printing the selected variant even if sibling lookup is unavailable. */ }
        }
        refresh();
    }
    async function loadPage(page) {
        var token = ++state.token; state.loading = true; state.bulkLoading = false; state.loadError = null;
        state.productPage = page; renderRows();
        try {
            var data = await request({ url: 'items', data: { page: page, limit: 30, filters: JSON.stringify(filters()), label_pricing: 'true' } });
            if (state.token !== token) return;
            var current = remember(data.list || []);
            state.viewIds = current.map(function (e) { return String(e.item._id); });
            enrichVariantValues(data.list || []);
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
        $('#sl-width').val(45); $('#sl-height').val(30); $('#sl-paper').val('roll');
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
    function labelPrinterName() {
        try { return root.localStorage.getItem('posnic.shelf-label-printer') || 'default'; } catch (_) { return 'default'; }
    }
    function loadLabelPrinters() {
        var select = $('#sl-printer');
        if (!select.length) return;
        var api = root.electronAPI && root.electronAPI.printer;
        if (!api || typeof api.list !== 'function') {
            select.html('<option value="default">Browser print dialog</option>').prop('disabled', true);
            return;
        }
        select.prop('disabled', true).html('<option value="default">Loading printers…</option>');
        Promise.resolve(api.list()).then(function (printers) {
            var saved = labelPrinterName(), html = '<option value="default">System default printer</option>';
            (Array.isArray(printers) ? printers : []).forEach(function (printer) {
                if (!printer || !printer.name) return;
                var name = String(printer.name);
                html += '<option value="' + $('<span>').text(name).html().replace(/"/g, '&quot;') + '">' + $('<span>').text(printer.displayName || name).html() + '</option>';
            });
            select.html(html).val(saved);
            if (!select.val()) select.val('default');
            select.prop('disabled', false);
        }).catch(function () {
            select.html('<option value="default">System default printer</option>').val('default').prop('disabled', false);
        });
    }
    function print(test) {
        try {
            if (state.step !== 3) throw Error(t('lang_sl_review_first', 'Review the labels before printing.'));
            if (state.loading) throw Error(t('lang_sl_wait_loading', 'Wait for products to finish loading.'));
            if (state.loadError) throw state.loadError;
            var s = settings(), g = geometry(s), entries = chosen(), from = Number($('#sl-from').val()), amount = test ? 1 : Number($('#sl-batch').val());
            var first = slots(entries, g, 0, from, amount), html = '';
            for (var i = 0; i < first.pages; i++) html += sheet(root.document, slots(entries, g, i, from, amount).cells, s, root.JsBarcode).outerHTML;
            var printer = root.electronAPI && root.electronAPI.printer;
            var selectedPrinter = String($('#sl-printer').val() || labelPrinterName() || 'default');
            try { root.localStorage.setItem('posnic.shelf-label-printer', selectedPrinter); } catch (_) {}
            if (printer && typeof printer.print === 'function') {
                var pageWidth = s.paper === 'a4' ? 210 : s.width;
                var pageHeight = s.paper === 'a4' ? 297 : s.height;
                var documentHtml = '<!doctype html><html><head><meta charset="utf-8"><title>Shelf labels</title><style>' + css(s, g) + '</style></head><body>' + html + '</body></html>';
                Promise.resolve(printer.print(documentHtml, {
                    printerName: selectedPrinter === 'default' ? '' : selectedPrinter,
                    pageSize: 'custom',
                    customPageSize: { width: pageWidth, height: pageHeight },
                    copies: 1, silent: true, strictPrinter: true, forceHtml: true,
                    printBackground: true, margins: { marginType: 'none' }
                })).then(function (result) {
                    if (!result || !result.success) error(new Error(result && result.error || 'Label printing failed.'));
                    else $('#sl-status').text(test ? 'Test label sent to ' + (selectedPrinter === 'default' ? 'the system default printer' : selectedPrinter) + '.' : 'Labels sent to ' + (selectedPrinter === 'default' ? 'the system default printer' : selectedPrinter) + '.');
                }).catch(error);
            } else {
                root.printJS({ printable: html, type: 'raw-html', style: css(s, g), scanStyles: false, documentTitle: t('lang_shelf_label_products', 'Shelf label products') });
            }
        } catch (e) { error(e); }
        return false;
    }
    function init() {
        if (!root.jQuery || !root.document) return;
        $(root.document).on('click', '[data-sl-step]', function () { setStep(Number(this.getAttribute('data-sl-step'))); });
        $(root.document).on('click', '#sl-next-step', function () { setStep(state.step + 1); });
        $(root.document).on('click', '#sl-back', function () { setStep(state.step - 1); });
        $(root.document).on('input change', '#view_print_lable input:not(#sl-search):not(#sl-all):not(#sl-page-all):not(#sl-category):not(#sl-selected-font-size):not(#sl-rotation):not(#sl-selected-bold):not(#sl-selected-emphasis),#view_print_lable select:not(#sl-category),#view_print_lable textarea', function () {
            if (this.id === 'sl-width' || this.id === 'sl-height') { $('#document_width').val(Number($('#sl-width').val()) / 25.4); $('#document_height').val(Number($('#sl-height').val()) / 25.4); }
            if (state.step === 1) state.furthestStep = 1;
            state.page = 0; refresh();
            if (state.step === 1 && typeof root.newBarcode === 'function') root.newBarcode();
            if (typeof syncSelectionControls === 'function') syncSelectionControls();
        });
        $(root.document).on('click', '#view_print_lable .text-align,#view_print_lable .font-option', function () {
            if ($(this).hasClass('text-align')) $('#view_print_lable .text-align').removeClass('btn-primary').filter(this).addClass('btn-primary');
            else $(this).toggleClass('btn-primary');
            state.furthestStep = 1;
            if (typeof root.newBarcode === 'function') root.newBarcode();
            refresh();
        });
        function persistEnabledFields() {
            try { root.localStorage.setItem('posnic.shelf-label-enabled-fields', JSON.stringify(state.enabledFields)); } catch (_) {}
            $('.sl-element-toggle').each(function () {
                var active = state.enabledFields.includes(this.dataset.slField);
                $(this).toggleClass('is-active', active).attr('aria-pressed', active ? 'true' : 'false');
                this.textContent = (active ? '✓ ' : '+ ') + ({variant_values:'Variants',name:'Article name',brand:'Brand abbreviation',reference:'MM-YY / reference',barcode:'Compact barcode',custom_text:'Custom text',image:'Uploaded image',price:'Selling price'}[this.dataset.slField] || this.dataset.slField.replace(/_/g,' '));
            });
}
        $(root.document).on('click', '.sl-element-toggle', function () {
            var key = this.dataset.slField;
            if (!['variant_values','name','brand','reference','barcode','custom_text','image','price'].includes(key)) return;
            if (state.enabledFields.includes(key)) state.enabledFields = state.enabledFields.filter(function (field) { return field !== key; });
            else state.enabledFields.push(key);
            persistEnabledFields();
            state.furthestStep = Math.min(state.furthestStep, 1);
            refresh();
        });
persistEnabledFields();        $(root.document).on('pointerdown', '#sl-sample .sl-element', function (e) {
            if (e.target.closest('.sl-resize-handle')) return;
            var key = this.dataset.slElement, label = this.closest('.sl-label');
            if (!key || !label) return;
            state.selectedElementKey = key;
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
            editorDrag = { key: key, keys: dragKeys, initialLayouts: initialLayouts, mode: 'move', startX: e.clientX, startY: e.clientY, rect: rect, initial: Object.assign({}, layout), moved: false };
            if (this.setPointerCapture && e.pointerId !== undefined) { try { this.setPointerCapture(e.pointerId); } catch (_) {} }
        });
        $(root.document).on('pointerdown', '#sl-sample .sl-rotate-handle', function (e) {
            var label = this.closest('.sl-label'), key = this.dataset.slRotateFor;
            var selectedElement = label && label.querySelector('[data-sl-element="' + key + '"]');
            if (!key || !label || !selectedElement) return;
            e.preventDefault(); e.stopPropagation();
            $('#sl-sample .sl-element').removeClass('sl-selected');
            $(selectedElement).addClass('sl-selected');
            state.selectedElementKey = key;
            syncSelectionControls();
            var rect = selectedElement.getBoundingClientRect();
            var cx = rect.left + rect.width / 2, cy = rect.top + rect.height / 2;
            editorDrag = { key: key, mode: 'rotate', startX: e.clientX, startY: e.clientY, centerX: cx, centerY: cy, moved: false,
                startAngle: Math.atan2(e.clientY - cy, e.clientX - cx) * 180 / Math.PI,
                initial: Object.assign({}, state.elementLayout[key] || DEFAULT_ELEMENT_LAYOUT[key]) };
        });
        $(root.document).on('pointerdown', '#sl-sample .sl-resize-handle', function (e) {
            var label = this.closest('.sl-label'), key = this.dataset.slResizeFor;
            if (!key || !label) return;
            e.preventDefault(); e.stopPropagation();
            $('#sl-sample .sl-element').removeClass('sl-selected');
            var selectedElement = label.querySelector('[data-sl-element="' + key + '"]');
            if (selectedElement) $(selectedElement).addClass('sl-selected');
            state.selectedElementKey = key;
            syncSelectionControls();
            var layout = state.elementLayout[key] || DEFAULT_ELEMENT_LAYOUT[key];
            editorDrag = { key: key, mode: 'resize', startX: e.clientX, startY: e.clientY, rect: label.getBoundingClientRect(), initial: Object.assign({}, layout), moved: false };
        });
        function syncSelectionControls() {
            var selected = $('#sl-sample .sl-element.sl-selected').first();
            if (!selected.length) {
                var remembered = state.selectedElementKey && $('#sl-sample [data-sl-element="' + state.selectedElementKey + '"]').first();
                selected = remembered && remembered.length ? remembered : $('#sl-sample .sl-element').first();
                if (selected.length) { selected.addClass('sl-selected'); state.selectedElementKey = selected.attr('data-sl-element'); }
            }
            var key = selected.attr('data-sl-element');
            var layout = key ? (state.elementLayout[key] || DEFAULT_ELEMENT_LAYOUT[key]) : null;
            var baseSize = Math.max(3, Number($('#bar-fontSize').val()) || 12);
            $('#sl-rotation').val(layout ? (Number(layout.rotation) || 0) : 0).prop('disabled', false);
            $('#sl-selected-font-size').val(layout ? Math.max(3, Math.min(72, Math.round(baseSize * (Number(layout.font_size) || 100) / 100))) : baseSize).prop('disabled', false);
            $('#sl-selected-bold').prop('checked', !!layout && layout.font_weight === 'bold').prop('disabled', !layout);
            $('#sl-selected-emphasis').prop('checked', !!layout && layout.emphasis === true).prop('disabled', !layout);
        }
        function updateSelectedLayout(patch, render) {
            var selected = $('#sl-sample .sl-element.sl-selected').first(), key = selected.attr('data-sl-element');
            if (!key) return;
            var layout = Object.assign({}, state.elementLayout[key] || DEFAULT_ELEMENT_LAYOUT[key], patch);
            state.elementLayout[key] = layout;
            try { root.localStorage.setItem('posnic.shelf-label-elements', JSON.stringify(state.elementLayout)); } catch (_) {}
            if (render) {
                refresh();
                $('#sl-sample [data-sl-element="' + key + '"]').addClass('sl-selected');
                syncSelectionControls();
            } else {
                var node = document.querySelector('#sl-sample [data-sl-element="' + key + '"]');
                if (node) applyElementLayout(node, key, { elementLayout: state.elementLayout, fontSize: Math.max(3, Number($('#bar-fontSize').val()) || 12) });
            }
        }
        $(root.document).on('input change', '#sl-selected-font-size', function () {
            var value = Number(this.value), baseSize = Math.max(3, Number($('#bar-fontSize').val()) || 12);
            if (!Number.isFinite(value) || value < 3 || value > 72) return;
            updateSelectedLayout({ font_size: Math.max(25, Math.min(600, value / baseSize * 100)) }, false);
        });
        $(root.document).on('change', '#sl-selected-bold', function () { updateSelectedLayout({ font_weight: this.checked ? 'bold' : 'normal' }, false); });
        $(root.document).on('change', '#sl-selected-emphasis', function () { updateSelectedLayout({ emphasis: this.checked }, false); });
        function rotateSelected(delta) {
            var selected = $('#sl-sample .sl-element.sl-selected').first();
            var key = selected.attr('data-sl-element');
            if (!key) {
                selected = $('#sl-sample .sl-element').first().addClass('sl-selected');
                key = selected.attr('data-sl-element');
            }
            if (!key) return;
            var layout = Object.assign({}, state.elementLayout[key] || DEFAULT_ELEMENT_LAYOUT[key]);
            layout.rotation = Math.max(-180, Math.min(180, (Number(layout.rotation) || 0) + delta));
            state.elementLayout[key] = layout;
            try { root.localStorage.setItem('posnic.shelf-label-elements', JSON.stringify(state.elementLayout)); } catch (_) {}
            refresh();
            var updated = $('#sl-sample [data-sl-element="' + key + '"]');
            updated.addClass('sl-selected');
            syncSelectionControls();
        }
        $(root.document).on('click', '#sl-rotate-left', function () { rotateSelected(-15); });
        $(root.document).on('click', '#sl-rotate-right', function () { rotateSelected(15); });
        $(root.document).on('change input', '#sl-rotation', function () {
            var selected = $('#sl-sample .sl-element.sl-selected').first(), key = selected.attr('data-sl-element');
            if (!key) return;
            var value = Number(this.value);
            if (!Number.isFinite(value)) return;
            var layout = Object.assign({}, state.elementLayout[key] || DEFAULT_ELEMENT_LAYOUT[key]);
            layout.rotation = Math.max(-180, Math.min(180, value));
            state.elementLayout[key] = layout;
            try { root.localStorage.setItem('posnic.shelf-label-elements', JSON.stringify(state.elementLayout)); } catch (_) {}
            var element = $('#sl-sample [data-sl-element="' + key + '"]');
            if (element.length) element.css('transform', 'rotate(' + layout.rotation + 'deg)');
        });
        $(root.document).on('input', '#sl-custom-text-input', function () {
            var value = String(this.value || '').slice(0, 120);
            try { root.localStorage.setItem('posnic.shelf-label-custom-text', value); } catch (_) {}
            var node = document.querySelector('#sl-sample [data-sl-element="custom_text"]');
            if (node) node.textContent = value || 'Custom text';
        });
        $(root.document).on('change', '#sl-custom-text-input', function () { refresh(); });
        $(root.document).on('change', '#sl-image-upload', function () {
            var file = this.files && this.files[0];
            if (!file) return;
            if (['image/png', 'image/jpeg', 'image/webp'].indexOf(file.type) === -1 || file.size > 1024 * 1024) {
                error(new Error('Choose a PNG, JPEG or WebP image no larger than 1 MB.'));
                this.value = '';
                return;
            }
            var reader = new FileReader();
            reader.onload = function () {
                try { root.localStorage.setItem('posnic.shelf-label-logo', String(reader.result)); }
                catch (_) { error(new Error('Image could not be saved. Use an image smaller than 1 MB.')); return; }
                if (!state.enabledFields.includes('image')) {
                    state.enabledFields.push('image');
                    persistEnabledFields();
                }
                refresh();
            };
            reader.onerror = function () { error(new Error('Could not read the selected image.')); };
            reader.readAsDataURL(file);
        });
        $(root.document).on('pointermove', function (e) {
            if (!editorDrag) return;
            var drag = editorDrag;
            if (!drag.moved && Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) < 3) return;
            drag.moved = true;
            if (drag.mode === 'rotate') {
                var angle = Math.atan2(e.clientY - drag.centerY, e.clientX - drag.centerX) * 180 / Math.PI;
                var delta = angle - drag.startAngle;
                if (delta > 180) delta -= 360;
                if (delta < -180) delta += 360;
                var rotated = Object.assign({}, drag.initial, { rotation: Math.max(-180, Math.min(180, (Number(drag.initial.rotation) || 0) + delta)) });
                state.elementLayout[drag.key] = rotated;
                var rotatingNode = document.querySelector('#sl-sample [data-sl-element="' + drag.key + '"]');
                if (rotatingNode) rotatingNode.style.transform = 'rotate(' + rotated.rotation + 'deg)';
                var rotationInput = document.querySelector('#sl-rotation');
                if (rotationInput) rotationInput.value = Math.round(rotated.rotation);
                return;
            }
            var dx = (e.clientX - drag.startX) / Math.max(1, drag.rect.width) * 100;
            var dy = (e.clientY - drag.startY) / Math.max(1, drag.rect.height) * 100;
            var keys = drag.mode === 'move' ? drag.keys : [drag.key];
            keys.forEach(function (key) {
                var initial = drag.initialLayouts ? drag.initialLayouts[key] : drag.initial;
                var next = Object.assign({}, initial);
                if (drag.mode === 'move') {
                    next.x = Math.max(-300, Math.min(300, initial.x + dx));
                    next.y = Math.max(-300, Math.min(300, initial.y + dy));
                } else {
                    next.w = Math.max(5, Math.min(500, initial.w + dx));
                    next.h = Math.max(5, Math.min(500, initial.h + dy));
                }
                state.elementLayout[key] = next;
                var element = document.querySelector('#sl-sample [data-sl-element="' + key + '"]');
                if (element) {
                    element.style.left = next.x + '%'; element.style.top = next.y + '%';
                    element.style.width = next.w + '%'; element.style.height = next.h + '%';
                    var handle = document.querySelector('#sl-sample .sl-resize-handle[data-sl-resize-for="' + key + '"]');
                    if (handle) { handle.style.left = (next.x + next.w) + '%'; handle.style.top = (next.y + next.h) + '%'; }
                    var rotateHandle = document.querySelector('#sl-sample .sl-rotate-handle[data-sl-rotate-for="' + key + '"]');
                    if (rotateHandle) { rotateHandle.style.left = (next.x + next.w / 2) + '%'; rotateHandle.style.top = Math.max(1, next.y - 4) + '%'; }
                }
            });
        });
        $(root.document).on('pointerup pointercancel', function () {
            if (!editorDrag) return;
            var selectedKey = editorDrag.key;
            state.selectedElementKey = selectedKey;
            editorDrag = null;
            try { root.localStorage.setItem('posnic.shelf-label-elements', JSON.stringify(state.elementLayout)); } catch (_) {}
            refresh();
            $('#sl-sample [data-sl-element="' + selectedKey + '"]').addClass('sl-selected');
            syncSelectionControls();
        });        $(root.document).on('shown.bs.modal', '#view_print_lable', function () { loadLabelPrinters(); refresh(); });
        $(root.document).on('change', '#sl-printer', function () {
            try { root.localStorage.setItem('posnic.shelf-label-printer', String(this.value || 'default')); } catch (_) {}
        });
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
        $(root.document).on('change', '#sl-paper', function () { $('#sl-start').val(1); refresh(); });        $(root).on('resize', function () { if (state.step > 0) refresh(); });
    }
    init();
    return { geometry: geometry, count: count, slots: slots, css: css, label: label, sheet: sheet, open: open, print: print, refresh: refresh };
});
