/* The editor, tender preview and printed sale share this renderer. */
(function () {
    'use strict';
    var contract = window.PosnicReceiptDesign;
    var esc = function (v) { return PosnicPro.escapeHtml(v == null ? '' : String(v)); };
    var plain = function (v) { var inert = document.implementation.createHTMLDocument(''); inert.body.innerHTML = v || ''; return inert.body.textContent; };
    var on = function (v) { return v === true || v === 'true' || v === 'enable'; };
    var copy = function (v) { return JSON.parse(JSON.stringify(v)); };
    function label(value) { return PosnicPro.receiptDesignLabel ? PosnicPro.receiptDesignLabel(value) : value; }
    function block(type, extra) { return Object.assign({ id: 'b' + Math.random().toString(36).slice(2), type: type, align: 'left' }, extra || {}); }
    // A useful, shop-ready thermal template rather than a blank four-block skeleton.
    // Existing saved designs are preserved; this template is used for new designs
    // and when the owner explicitly chooses Reset template for a paper format.
    function standardLayout(format) {
        var sheet = !!contract.formats[format].height;
        var align = sheet ? 'left' : 'center';
        var blocks = [
            block('logo', { align: 'center', width: sheet ? 22 : 45 }),
            block('store', { align: align, fssaiInHeader: !sheet }),
            block('transaction', { align: sheet ? 'right' : 'left', showTitle: false, fontSize: 10 }),
            block('items', { itemLayout: sheet ? 'detailed' : 'columns', nameMaxChars: format === '58' ? 16 : 24, lineStyle: 'dotted', fontSize: sheet ? undefined : format === '58' ? 9 : 11 }),
            block('totals', { align: 'left' }),
            block('barcode', { align: 'center' }),
            block('text', { text: 'Merci pour votre achat !', align: 'center', fontSize: 10 })
        ];
        if (contract.fieldAvailable('sale_note', {})) blocks.push(block('field', { field: 'sale_note', align: 'center' }));
        return { fontSize: contract.formats[format].font, blocks: blocks };
    }
    function defaults(branch) {
        var result = { version: 1, defaultFormat: branch.print_type === 'a4' ? 'a4' : ['58', '80', '112'].indexOf(branch.print_width) !== -1 ? branch.print_width : '80', layouts: {} };
        Object.keys(contract.formats).forEach(function (format) {
            result.layouts[format] = standardLayout(format);
        });
        return result;
    }
    function safeImage(src) {
        if (contract.image(src)) return src;
        if (!src || /[<>"'\s]/.test(src)) return '';
        try {
            var url = new URL(src, document.baseURI);
            return url.protocol === 'https:' || (url.protocol === 'http:' && url.origin === new URL(document.baseURI).origin) ? url.href : '';
        } catch (_) { return ''; }
    }
    /*
     * Sale barcode renderer: encode the immutable sale/ticket identifier using
     * Code 128. Prefer JsBarcode on a canvas (consistent raster output in
     * Electron/Windows print dialogs); keep the legacy plugin only as fallback.
     * Human-readable text is rendered by the block itself, directly below the
     * stripes, so it cannot overlap the bars or be baked into the barcode.
     */
    function barcode(text) {
        var value = String(text == null ? '' : text).trim();
        if (!value) return '';
        if (window.JsBarcode) {
            try {
                var canvas = document.createElement('canvas');
                window.JsBarcode(canvas, value, {
                    format: 'CODE128',
                    displayValue: false,
                    width: 3,
                    height: 64,
                    margin: 0,
                    marginTop: 1,
                    marginBottom: 0,
                    background: '#ffffff',
                    lineColor: '#000000'
                });
                return canvas.toDataURL('image/png');
            } catch (_) { /* Try the bundled legacy renderer below. */ }
        }
        if ($.fn.barcode) {
            try {
                var fallback = $('<canvas>');
                fallback.barcode(value, 'code128', {
                    output: 'canvas', barWidth: 3, barHeight: 64, showHRI: false,
                    bgColor: '#ffffff', color: '#000000', barWidth: 2
                });
                return fallback[0].toDataURL('image/png');
            } catch (_) { /* A missing renderer is handled as an empty block. */ }
        }
        return '';
    }
    function formatFor(data, requested) {
        if (!data.receipt_designs) return requested;
        if (requested === 'a4' || requested === 'a5' || requested === 'letter') return requested;
        if (['58', '80', '112'].indexOf(requested) !== -1) return requested;
        if (requested === 'standard') return PosnicPro.local.get('print_width') ? PosnicPro.resolvePaperWidth() : data.receipt_designs.defaultFormat;
        if (PosnicPro.printSettings) {
            var paper = PosnicPro.printSettings.saleFormat();
            if (contract.formats[paper]) return paper;
        }
        return data.receipt_designs.defaultFormat;
    }
    function headerValue(value) {
        return '<span class="rd-header-value">' + esc(value) + '</span>';
    }
    function transactionDate(value, block, dateOrder) {
        var text = String(value || '');
        if ((!block.dateFormat || block.dateFormat === 'auto') && (!block.timeFormat || block.timeFormat === 'auto')) return text;
        // Receipt payloads use DD/MM/YYYY; do not let Date.parse reinterpret
        // an ambiguous shop-local date or change its timezone.
        var m = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[ ,]+(\d{1,2}):(\d{2})(?::\d{2})?\s*(am|pm)?)?$/i);
        var iso = !m && text.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?)?$/);
        if (iso) m = [iso[0], iso[3], iso[2], iso[1], iso[4], iso[5]];
        if (!m) return text;
        if (!iso && dateOrder === 'mdy') { var swap = m[1]; m[1] = m[2]; m[2] = swap; }
        var day = m[1].padStart(2, '0'), month = m[2].padStart(2, '0'), year = m[3];
        var originalDate = text.split(/[T ,]/)[0];
        var date = { dmy: day + '/' + month + '/' + year, 'dmy-short': day + '/' + month + '/' + year.slice(-2), mdy: month + '/' + day + '/' + year, ymd: year + '-' + month + '-' + day }[block.dateFormat] || originalDate;
        if (!m[4] || block.timeFormat === 'none') return date;
        var hour = Number(m[4]);
        if (m[6]) hour = hour % 12 + (m[6].toLowerCase() === 'pm' ? 12 : 0);
        var time = block.timeFormat === '12h' ? String(hour % 12 || 12).padStart(2, '0') + ':' + m[5] + (hour >= 12 ? ' PM' : ' AM')
            : block.timeFormat === '24h' ? String(hour).padStart(2, '0') + ':' + m[5]
            : m[4] + ':' + m[5] + (m[6] ? ' ' + m[6] : '');
        return date + ' ' + time;
    }
    function thermalDate(value) {
        // Keep the supplied locale and date order. A clock and its day period
        // travel together; narrow paper can wrap between the date and time.
        var parts = String(value || '').match(/^(.*?[\s,])(\p{Nd}{1,2}:\p{Nd}{2}.*)$/u);
        return parts ? headerValue(parts[1].trim()) + ' ' + headerValue(parts[2]) : headerValue(value);
    }
    // Group adjacent invoice blocks without changing the shop's block order.
    // A moved text/image/divider remains exactly where the designer placed it.
    function pairFields(blocks) {
        var result = [];
        for (var i = 0; i < blocks.length; i++) {
            var first = blocks[i], next = blocks[i + 1];
            if (first.half && next && next.half) {
                result.push({ type: 'fieldrow', customer: first.customer && next.customer, supporting: true,
                    html: '<div class="rd-field-row">' + first.html + next.html + '</div>' });
                i++;
            } else result.push(first);
        }
        return result;
    }
    function composeSheet(blocks) {
        var html = '', at = 0;
        while (at < blocks.length) {
            var group = [];
            var header = ['logo', 'store', 'transaction'];
            if (header.indexOf(blocks[at].type) !== -1) {
                while (at < blocks.length && header.indexOf(blocks[at].type) !== -1 && !group.some(function (b) { return b.type === blocks[at].type; })) group.push(blocks[at++]);
                var groupHtml = group.map(function (b) { return b.html; }).join('');
                html += group.some(function (b) { return b.type !== 'logo'; }) ? '<div class="rd-invoice-header' + (group.some(function (b) { return b.type === 'logo'; }) ? ' has-logo' : '') + '">' + groupHtml + '</div>' : groupHtml;
            } else if (blocks[at].customer) {
                while (at < blocks.length && blocks[at].customer) group.push(blocks[at++]);
                html += '<div class="rd-invoice-customer"><div class="rd-invoice-label">' + esc(label('Customer')) + '</div><div class="rd-invoice-customer-fields">' + group.map(function (b) { return b.html; }).join('') + '</div></div>';
            } else if (blocks[at].type === 'totals') {
                var totals = blocks[at++].html;
                while (at < blocks.length && blocks[at].supporting) group.push(blocks[at++]);
                html += '<div class="rd-invoice-summary">' + totals + (group.length ? '<div class="rd-invoice-supporting">' + group.map(function (b) { return b.html; }).join('') + '</div>' : '') + '</div>';
            } else html += blocks[at++].html;
        }
        return html;
    }
    function sheetCss(format) {
        var compact = format === 'a5';
        return '.rd-sheet{--rd-invoice-gap:' + (compact ? '5mm' : '8mm') + ';--rd-row-pad:' + (compact ? '2mm' : '3.5mm') + ';}' +
            '.rd-invoice-header{display:grid;grid-template-columns:minmax(0,1.6fr) minmax(0,1fr);gap:3mm var(--rd-invoice-gap);align-items:start;border-bottom:2px solid #202936;padding:0 0 ' + (compact ? '4mm' : '7mm') + ';margin-bottom:' + (compact ? '4mm' : '7mm') + ';break-inside:avoid;}' +
            '.rd-invoice-header>.rd-block{margin:0;min-width:0;grid-row:1;}.rd-invoice-header>.rd-block-store{grid-column:1;}.rd-invoice-header>.rd-block-transaction{grid-column:2;text-align:right!important;}' +
            '.rd-invoice-header.has-logo{grid-template-columns:' + (compact ? '12mm' : '18mm') + ' minmax(0,1.6fr) minmax(0,1fr);}' +
            '.rd-invoice-header.has-logo>.rd-block-logo{grid-column:1;}.rd-invoice-header.has-logo>.rd-block-store{grid-column:2;}.rd-invoice-header.has-logo>.rd-block-transaction{grid-column:3;}' +
            '.rd-invoice-header .rd-block-logo img{width:100%!important;max-width:none!important;max-height:none!important;object-fit:contain;}' +
            '.rd-sheet .rd-store{border:0;padding:0;}.rd-sheet .rd-store h1{font-size:' + (compact ? '1.8em' : '2.2em') + ';line-height:1.15;margin-bottom:3mm;letter-spacing:-.025em;}' +
            '.rd-sheet .rd-store-contact,.rd-sheet .rd-store p{color:#46505d;line-height:' + (compact ? '1.45' : '1.6') + ';}' +
            '.rd-invoice-title{font-size:' + (compact ? '1.7em' : '2.1em') + ';font-weight:700;letter-spacing:.08em;margin-bottom:3mm;line-height:1.2;}' +
            '.rd-invoice-meta{text-align:right;}.rd-invoice-meta dl{margin:0;}.rd-invoice-meta dt{font-size:.85em;color:#596371;margin-top:2mm;}.rd-invoice-meta dd{margin:0;font-weight:600;}' +
            '.rd-invoice-label{text-transform:uppercase;letter-spacing:.1em;font-size:.8em;font-weight:700;color:#596371;margin-bottom:2mm;}' +
            '.rd-invoice-customer{border-bottom:1px solid #ccd2d9;padding-bottom:' + (compact ? '3mm' : '4mm') + ';margin-bottom:' + (compact ? '4mm' : '5mm') + ';break-inside:avoid;}' +
            '.rd-invoice-customer-fields{display:grid;grid-template-columns:1fr 1fr;gap:1.5mm var(--rd-invoice-gap);}.rd-invoice-customer-fields .rd-block{margin:0;min-width:0;}' +
            '.rd-invoice-customer-fields .rd-field-customer_name,.rd-invoice-customer-fields .rd-field-customer_address{grid-column:1/-1;}' +
            '.rd-field-customer_name .rd-text{font-size:1.15em;font-weight:600;}.rd-invoice-customer-fields .rd-field-customer_name .rd-field-label{display:none;}' +
            '.rd-sheet .rd-block-items{margin-bottom:5mm;}' +
            '.rd-sheet th{background:#edf0f4;border-top:1px solid #202936;border-bottom:1px solid #202936;font-size:.85em;text-transform:uppercase;letter-spacing:.03em;padding:3mm 2mm;}' +
            '.rd-sheet td{padding:var(--rd-row-pad) 2mm;border-bottom:1px solid #dce0e5;}.rd-sheet .rd-number{font-variant-numeric:tabular-nums;}' +
            '.rd-invoice-summary{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:var(--rd-invoice-gap);margin-bottom:5mm;break-inside:avoid;}.rd-invoice-summary>.rd-block-totals{grid-column:2;grid-row:1;margin:0;min-width:0;}.rd-invoice-supporting{grid-column:1;grid-row:1;min-width:0;}' +
            '.rd-sheet .rd-totals{width:100%;border-top:1px solid #ccd2d9;padding-top:2mm;}.rd-sheet .rd-total-row{padding:1mm 2mm;margin:0;}' +
            '.rd-sheet .rd-grand-total{border-top:2px solid #202936;border-bottom:2px solid #202936;background:#edf0f4;padding:3mm 2mm;margin:2mm 0;font-size:1.3em;}' +
            '.rd-sheet .rd-block-totals{margin-bottom:' + (compact ? '4mm' : '8mm') + ';}.rd-invoice-end{display:flex;align-items:flex-end;gap:var(--rd-invoice-gap);border-top:1px solid #ccd2d9;margin-top:' + (compact ? '4mm' : '8mm') + ';padding-top:3mm;break-inside:avoid;}' +
            '.rd-invoice-end-notes{flex:1;min-width:0;}.rd-invoice-end .rd-terms{margin:0 0 3mm;}';
    }
    function css(format, font) {
        var f = contract.formats[format];
        var sheet = !!f.height;
        return '@page{size:' + (sheet ? f.width + 'mm ' + f.height + 'mm' : 'auto') + ';margin:' + (sheet ? '12mm' : '0') + ';}' +
            'html,body{margin:0!important;padding:0!important;background:#fff!important;color:#161b25!important;}' +
            '.rd-document,.rd-document *{box-sizing:border-box;}' +
            '.rd-signature{display:inline-block;text-align:center;vertical-align:top;}.rd-signature img{display:block;margin:0 auto;max-height:18mm;max-width:100%;}.rd-signature-blank{height:12mm;}.rd-signature-line{border-top:1px solid #777;padding-top:1mm;margin-top:1mm;font-size:.85em;}' +
            '.rd-document{width:' + f.content + 'mm;max-width:100%;margin:0 auto;font:' + font + 'px/' + (sheet ? '1.5 Arial,sans-serif' : '1.25 monospace') + ';color:#111;overflow-wrap:anywhere;}' +
            '.rd-block{margin:0 0 ' + (sheet ? '14px' : '4px') + ';break-inside:avoid;}' +
            '.rd-field-row{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);column-gap:3mm;break-inside:avoid;}.rd-field-row>.rd-block{min-width:0;}.rd-invoice-customer-fields>.rd-field-row{grid-column:1/-1;}' +
            '.rd-block-items{break-inside:auto;}.rd-document h1{font-size:1.7em;line-height:1.2;margin:0 0 5px;color:#111;}' +
            '.rd-store-contact{white-space:pre-line;}.rd-document p{margin:2px 0;}.rd-document img{height:auto;max-width:100%;object-fit:contain;}' +
            '.rd-document table{width:100%;border-collapse:collapse;table-layout:fixed;font:inherit;color:inherit;}' +
            '.rd-document th{font-weight:bold;border-top:1px solid #333;border-bottom:1px solid #333;text-align:left;padding:7px 3px;}' +
            '.rd-document td{padding:6px 3px;vertical-align:top;border-bottom:1px solid #ddd;}.rd-document tr{break-inside:avoid;}.rd-document thead{display:table-header-group;}' +
            '.rd-row-number{white-space:nowrap;vertical-align:top;text-align:left;}.rd-item-fixed{white-space:normal;overflow:visible;text-overflow:clip;overflow-wrap:anywhere;word-break:normal;}.rd-document td:not(.rd-number){overflow-wrap:anywhere;word-break:normal;}.rd-total-quantity{font-weight:bold;}' +
            '.rd-number{text-align:right!important;white-space:normal;}.rd-line-detail{font-size:.88em;color:#444;}' +
            '.rd-total-row{display:flex;justify-content:space-between;gap:12px;margin:3px 0;}.rd-grand-total{font-size:1.3em;font-weight:bold;border-top:2px solid #111;padding-top:7px;margin-top:8px;}' +
            '.rd-totals{width:' + (sheet ? '48%' : '100%') + ';margin-left:auto;}.rd-transaction{display:flex;flex-wrap:wrap;justify-content:space-between;gap:2px 12px;border-bottom:1px solid #bbb;padding-bottom:8px;}' +
            '.rd-transaction>strong,.rd-transaction-date{flex:0 0 auto;min-width:0;max-width:100%;}.rd-transaction-date{margin-left:auto;text-align:right;}' +
            '.rd-header-value{display:inline-block;max-width:100%;vertical-align:top;overflow-wrap:anywhere;}.rd-sale-meta{display:flex;justify-content:space-between;gap:4px;align-items:flex-start;}.rd-sale-meta>strong{min-width:0;overflow-wrap:anywhere;}.rd-sale-details .rd-divider{border:0;border-top:1px dashed #777;}.rd-sale-client,.rd-cashier{margin-top:2px;}' +
            '.rd-muted{color:#555;font-size:.9em;}.rd-text{white-space:pre-wrap;}.rd-divider{border:0;border-top:1px dashed #777;margin:10px 0;}' +
            '.rd-sheet .rd-store{padding-bottom:12px;border-bottom:2px solid #222;}.rd-terms{margin-top:20px;font-size:.9em;white-space:pre-line;}' +
            (sheet ? sheetCss(format) :
                '.rd-document{display:flow-root;padding:1mm 0;}.rd-block:last-child{margin-bottom:0;}' +
                '.rd-document th{padding:3px 2px;}.rd-document td{padding:3px 2px;}' +
                '.rd-document h1{margin-bottom:3px;}.rd-document p{margin:0;}' +
                '.rd-total-row{margin:1px 0;}.rd-grand-total{padding-top:4px;margin-top:4px;}' +
                '.rd-transaction{padding-bottom:4px;}.rd-divider{margin:4px 0;}' +
                '.rd-block-logo,.rd-block-image,.rd-block-qr,.rd-block-barcode{line-height:0;}.rd-document img{vertical-align:top;}') +
            '@media print{.rd-document{max-width:none!important;}body{width:auto!important;min-width:0!important;}.rd-document,.rd-document *{color:#000!important;opacity:1!important;text-shadow:none!important;-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important;}}';
    }
    function render(data, format, preview) {
        var designs = data.receipt_designs;
        format = formatFor(data, format);
        var layout = contract.layoutFor(designs, format);
        var sheet = !!contract.formats[format].height;
        var currency = (typeof data.currency_type === 'string' ? data.currency_type : '') || PosnicPro.local.get('currencySign') || '';
        var money = function (v) { return esc(currency) + ' ' + esc(Number(v || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })); };
        var pair = function (name, value, total) { return '<div class="rd-total-row' + (total ? ' rd-grand-total' : '') + '"><span>' + esc(label(name)) + '</span><span>' + value + '</span></div>'; };
        var items = data.items || [];
        // Saved/reprinted receipts can supply canonical lines without legacy items.
        // Totals and the visible rows must use the same source.
        var receiptItems = Array.isArray(data.receipt_line_rows) ? data.receipt_line_rows.map(function (line) {
            return Object.assign({}, line, { item_name: line.name, item_quantity: Number(line.qty), item_price: Number(line.rate), total_amount: line.amount, hsncode: line.hsn });
        }) : items;
        var present = function (v) { return v !== undefined && v !== null && v !== false && String(v).trim() !== ''; };
        var gstNumber = [data.customer_gstin, data.customer_gstin_number, data.customer_gst_number].find(present);
        var taxNumber = present(gstNumber) ? gstNumber : data.customer_tax_number;
        var registrationLabel = contract.taxRegistrationLabel(data, PosnicPro.local.get('country_setting'));
        var fieldLabel = function (field) { return label({ receipt_number: 'Ticket number', receipt_date: 'Date', seller_name: 'Vendeur', customer_name: 'Client', customer_phone: 'Client phone', customer_email: 'Client email', customer_address: 'Client address', customer_tax_number: present(gstNumber) ? registrationLabel : PosnicPro.i18n.t('lang_tax_id', 'Tax ID'), fssai: 'FSSAI' }[field] || contract.fields[field] || field); };
        var pendingGoods = data.pending_goods_receipt === true;
        var beforePayment = pendingGoods || preview || !data.sales_id;
        var documentTitle = pendingGoods ? label('Bill') : beforePayment ? (present(data.branch_gstin_number) || on(data.gst) ? label('Tax invoice') : label('Bill')) : label('Receipt');
        var hasField = function (field) { return layout.blocks.some(function (b) { return b.type === 'field' && b.field === field; }); };
        var values = {
            receipt_number: data.sales_id || data.sale_number || '', receipt_date: data.receipt_date || data.created_date || data.date || '', seller_name: data.cashier_name || data.seller_name || data.steward_name || data.steward || data.created_by || data.user_name,
            customer_name: data.customer_name, customer_phone: data.customer_phone, customer_email: data.customer_email,
            customer_tax_number: taxNumber,
            customer_address: data.customer_address, sale_note: data.sales_description, brand_url: data.website || PosnicPro.BRAND_URL,
            total_quantity: receiptItems.reduce(function (n, i) { return n + Number(i.item_quantity || 0); }, 0),
            table: data.table_number, order_type: data.dine_type, covers: data.covers || data.person_count,
            steward: data.cashier_name || data.seller_name || data.steward_name || data.steward || data.created_by || data.user_name, session: data.serving_session || data.session_name,
            fssai: (layout.blocks.find(function (block) { return block.type === 'store'; }) || {}).fssaiText || data.branch_fssai_number, source: data.order_source || data.source,
        };
        var fixedItems = !sheet && layout.blocks.find(function (b) { return b.type === 'items' && b.itemLayout === 'columns'; });
        var headerFssai = layout.blocks.some(function (b) { return b.type === 'store' && b.fssaiInHeader; });
        // Expand the basket's saved canvas slot to fit every printed item and
        // shift later blocks down by the extra height. This prevents totals,
        // payment details and footer blocks from colliding with long baskets.
        var dynamicItemsShift = 0;
        if (layout.canvas && !sheet) {
            var basketBlock = layout.blocks.find(function (block) { return block.type === 'items'; });
            if (basketBlock) {
                var basketHeight = (receiptItems || []).reduce(function (total, item) {
                    var itemName = PosnicPro.printItemName ? PosnicPro.printItemName(item, 'receipt') : item.item_name;
                    var lines = Math.max(1, Math.ceil(Array.from(String(itemName || '')).length / (format === '58' ? 14 : 22)));
                    return total + 18 * lines + 8;
                }, 28);
                dynamicItemsShift = Math.max(0, basketHeight - Math.max(28, Number(basketBlock.h) || 0));
            }
        }
        var rendered = layout.blocks.map(function (originalBlock) {
            var b = Object.assign({}, originalBlock);
            var basket = layout.blocks.find(function (block) { return block.type === 'items'; });
            if (dynamicItemsShift && basket && b.id !== basket.id && Number(b.y) >= Number(basket.y) + Math.max(28, Number(basket.h) || 0)) {
                b.y = Number(b.y) + dynamicItemsShift;
            }
            var content = '';
            if (b.type === 'field' && ((b.field === 'fssai' && headerFssai) || (b.field === 'total_quantity' && fixedItems))) return '';
            if (b.type === 'field' && ['receipt_number', 'receipt_date', 'seller_name'].indexOf(b.field) === -1 && !contract.fieldAvailable(b.field, data) && !(b.field === 'sale_note' && typeof b.text === 'string' && b.text.trim())) return '';
            if (b.type === 'store') {
                function storeText(key, fallback) { return String(b[key] || '').trim() || fallback || ''; }
                var storeName = storeText('nameText', data.branch_name || data.store_name || PosnicPro.local.get('branchname'));
                var storeAddress = storeText('addressText', plain(data.printing_address || data.store_address || ''));
                var storePhone = storeText('phoneText', data.store_telephone);
                var storeEmail = storeText('emailText', data.store_email);
                var storeRegistration = storeText('registrationText', data.branch_gstin_number);
                var storeFssai = storeText('fssaiText', data.branch_fssai_number);
                content = '<div class="rd-store">';
                if (b.showName !== false && storeName) content += '<h1>' + esc(storeName) + '</h1>';
                if (b.showAddress !== false && storeAddress) content += '<div class="rd-store-contact" style="white-space:pre-line">' + esc(storeAddress) + '</div>';
                if (b.showPhone !== false && storePhone) content += '<p>' + esc(storePhone) + '</p>';
                if (b.showEmail !== false && storeEmail) content += '<p>' + esc(storeEmail) + '</p>';
                if (b.showRegistration !== false && storeRegistration) content += '<p>' + esc(registrationLabel) + ': ' + esc(storeRegistration) + '</p>';
                if (contract.fieldAvailable('fssai', data) && present(storeFssai) && (headerFssai || !hasField('fssai'))) content += '<p>' + esc(fieldLabel('fssai')) + ': ' + esc(String(storeFssai).trim()) + '</p>';
                content += '</div>';
            } else if (b.type === 'transaction') {
                var receiptDate = data.receipt_date || data.created_date || data.date || '';
                var formattedDate = transactionDate(receiptDate, b, data.receipt_date_order);
                var customLabel = typeof b.labelText === 'string';
                if (sheet) {
                    content = '<div class="rd-invoice-meta"><dl>';
                    if (data.sales_id) content += '<dt>' + esc(customLabel && b.labelText ? b.labelText : 'Ticket number') + '</dt><dd>' + esc(data.sales_id) + '</dd>';
                    content += '</dl></div>';
                } else {
                    var saleNumberLabel = customLabel && b.labelText ? b.labelText : 'Ticket number';
                    content = '<div class="rd-transaction rd-sale-details"><strong>' + esc(saleNumberLabel) + (data.sales_id ? ': ' + headerValue(data.sales_id) : '') + '</strong></div>';
                }
                if (!data.sales_id && !pendingGoods) content += '<p class="rd-pending-number">' + esc(PosnicPro.i18n.t('lang_receipt_number_after_save', 'Receipt number is assigned after saving the sale.')) + '</p>';
                if (present(taxNumber) && !hasField('customer_tax_number')) content += '<p class="rd-customer-tax">' + esc(fieldLabel('customer_tax_number')) + ': ' + esc(String(taxNumber).trim()) + '</p>';
            } else if (b.type === 'items') {
                var compact = !sheet && b.itemLayout === 'compact';
                var columns = !sheet && b.itemLayout === 'columns';
                var hsnColumn = columns && format === '112' && b.hsn;
                var serialWidth = b.showRowNumbers ? (sheet ? 6 : format === '58' ? 15 : format === '80' ? 12 : 9) : 0;
                var itemWidth = (hsnColumn ? 36 : sheet ? 46 : columns ? (format === '58' ? 63 : 66) : compact ? 68 : 60) - serialWidth;
                content = '<table' + (columns ? ' class="rd-fixed-columns"' : '') + '><colgroup>' + (b.showRowNumbers ? '<col style="width:' + serialWidth + '%">' : '') + '<col style="width:' + itemWidth + '%">' + (hsnColumn ? '<col style="width:16%"><col style="width:18%"><col style="width:8%"><col style="width:22%">' : sheet ? '<col style="width:12%"><col style="width:20%"><col style="width:22%">' : columns ? (format === '58' ? '<col style="width:12%"><col style="width:25%">' : '<col style="width:10%"><col style="width:24%">') : '<col style="width:' + (compact ? '32' : '40') + '%">') + '</colgroup><thead><tr>' + (b.showRowNumbers ? '<th class="rd-row-number">' + esc(label('S.No')) + '</th>' : '') + '<th>' + esc((b.heading || (columns ? label('Item name') : label('Item'))) + (compact ? ' × ' + label('Qty') : '')) + '</th>' + (hsnColumn ? '<th class="rd-number">' + esc(PosnicPro.i18n.t('lang_hsn_2', 'HSN')) + '</th>' : '') + (sheet ? '<th class="rd-number">' + esc(label('Qty')) + '</th><th class="rd-number">' + esc(label('Unit price')) + '</th>' : columns ? '<th class="rd-number">' + esc(label('Qty')) + '</th>' : '') + '<th class="rd-number">' + esc(label('Amount')) + '</th></tr></thead><tbody>';
                receiptItems.forEach(function (item, index) {
                    var qty = Number(item.item_quantity || 0);
                    var hsn = item.hsncode || item.hsn_code || item.hsn || (/^\d{4,8}$/.test(item.tax_name || '') ? item.tax_name : '');
                    var name = PosnicPro.printItemName ? PosnicPro.printItemName(item, 'receipt') : item.item_name;
                    name = String(name == null ? '' : name);
                    content += '<tr>' + (b.showRowNumbers ? '<td class="rd-row-number">' + (index + 1) + '</td>' : '') + '<td' + (columns ? ' class="rd-item-fixed"' : '') + '>' + esc(name) + (compact ? ' × ' + esc(qty) : '') + (b.hsn && !hsnColumn && hsn ? '<div class="rd-line-detail">HSN/SAC: ' + esc(hsn) + '</div>' : '');
                    if (!sheet && !compact && !columns) content += '<div class="rd-line-detail">' + esc(qty + ' ' + (item.item_unit || '') + ' × ') + money(item.item_price) + '</div>';
                    if (Number(item.item_discount) || Number(item.item_discount_percentage)) content += '<div class="rd-line-detail">' + esc(label('Discount')) + ': ' + (Number(item.item_discount_percentage) ? esc(item.item_discount_percentage) + '%' : money(item.item_discount)) + '</div>';
                    content += '</td>' + (hsnColumn ? '<td class="rd-number rd-hsn">' + esc(hsn) + '</td>' : '') + (sheet ? '<td class="rd-number">' + esc(qty + ' ' + (item.item_unit || '')) + '</td><td class="rd-number">' + money(item.item_price) + '</td>' : columns ? '<td class="rd-number">' + esc(qty) + '</td>' : '') + '<td class="rd-number">' + (columns ? Number(item.total_amount || 0).toFixed(2) : money(item.total_amount)) + '</td></tr>';
                });
                if (columns && hasField('total_quantity')) content += '<tr class="rd-total-quantity"><td colspan="' + ((hsnColumn ? 3 : 1) + (b.showRowNumbers ? 1 : 0)) + '">' + esc(label('Total Items')) + ': ' + receiptItems.length + '</td><td class="rd-number">' + esc(values.total_quantity) + '</td><td></td></tr>';
                content += '</tbody></table>';
            } else if (b.type === 'totals') {
                content = '<div class="rd-totals">' + pair('Subtotal', money(data.items_subtotal));
                if (Number(data.discount)) content += pair('Discount', money(-Number(data.discount)));
                if (Number(data.sale_extra_discount)) content += pair('Extra discount', money(-Number(data.sale_extra_discount)));
                var igst = items.reduce(function (n, i) { return n + Number(i.igst_tax || 0); }, 0);
                var cgst = items.reduce(function (n, i) { return n + Number(i.cgst_tax || 0); }, 0);
                var sgst = items.reduce(function (n, i) { return n + Number(i.sgst_tax == null ? i.cgst_tax || 0 : i.sgst_tax); }, 0);
                if (Array.isArray(data.receipt_tax_rows) && data.receipt_tax_rows.length) data.receipt_tax_rows.forEach(function (row) { content += pair(row.label, money(row.amount)); });
                else if (igst || cgst || sgst) {
                    if (igst) content += pair('IGST', money(igst));
                    if (cgst) content += pair('CGST', money(cgst));
                    if (sgst) content += pair('SGST', money(sgst));
                }
                else if (Number(data.tax)) content += pair('Tax', money(data.tax));
                (data.charges || []).forEach(function (c) { content += pair(c.name || 'Charge', money(Number(c.amount || 0) + Number(c.tax_amount || 0))); });
                if (Number(data.round_off)) content += pair('Round Off', money(data.round_off));
                content += pair('Total', money(data.items_total), true);
                if (!beforePayment && data.sales_id) {
                    var paymentRows = PosnicSalePayments.rows(data);
                    var hasCreditAllocation = paymentRows.some(function (row) { return String(row.method || '').trim().toLowerCase() === 'credit'; });
                    if (b.showPaymentMethod !== false && paymentRows.length) {
                        paymentRows.forEach(function (row) { content += pair(row.method, money(row.amount)); });
                    } else if (b.showPaymentMethod !== false && data.payment_mode) {
                        content += pair('Payment', esc(data.payment_mode));
                    }
                    // When the tender rows already show Credit, don't repeat the same
                    // unpaid remainder as both "Payments / credits" and "Balance due".
                    if ((data.partial_check === true || data.partial_check === 'true') && !hasCreditAllocation) {
                        content += pair('Payments / credits', money(data.partial_balance)) + pair('Balance due', money(data.payment_pending));
                    }
                }
                content += '</div>';
            } else if (b.type === 'field') {
                var value = b.field === 'sale_note' && typeof b.text === 'string' && b.text.trim() ? b.text : values[b.field];
                if (b.field === 'receipt_number') value = data.sales_id || data.sale_number || '';
                if (!present(value)) return '';
                content = '<div class="rd-text">' + (b.field === 'brand_url' ? '' : '<strong class="rd-field-label">' + esc(fieldLabel(b.field)) + ':</strong> ') + esc(String(value).trim()) + '</div>';
            } else if (b.type === 'text') {
                if (!String(b.text || '').trim()) return '';
                content = '<div class="rd-text">' + esc(b.text) + '</div>';
            }
            else if (b.type === 'signature') {
                var signature = contract.image(data.quote_default_signature) ? data.quote_default_signature : '';
                var signatureLabel = PosnicPro.i18n.t('lang_authorised_signatory', 'Authorised signatory');
                content = '<div class="rd-signature" style="width:' + (b.width || 60) + '%">' +
                    (signature ? '<img src="' + esc(signature) + '" alt="' + esc(signatureLabel) + '">' : '<div class="rd-signature-blank"></div>') +
                    '<div class="rd-signature-line">' + esc(signatureLabel) + '</div></div>';
            }
            else if (b.type === 'divider') {
                var lineStyle = ['solid', 'dashed', 'dotted'].indexOf(b.lineStyle) !== -1 ? b.lineStyle : 'dashed';
                var width = Math.max(15, Math.min(100, Number(b.width) || 100));
                var thickness = Math.max(1, Math.min(4, Number(b.thickness) || 1));
                content = '<hr class="rd-divider" style="border-top-style:' + lineStyle + ';border-top-width:' + thickness + 'px;width:' + width + '%;margin-left:' + (b.align === 'center' || b.align === 'right' ? 'auto' : '0') + ';margin-right:' + (b.align === 'center' ? 'auto' : '0') + '">';
            }
            else {
                var logo = data.logo || data.branch_image;
                var saleBarcodeValue = String(data.sale_number || data.receipt_number || data.sales_id || 'PREVIEW-RECEIPT-0001').trim();
                var src = b.type === 'logo' ? safeImage(b.src || (!logo || logo === 'store.png' ? 'static/images/default/store.png' : logo)) : b.type === 'barcode' ? barcode(saleBarcodeValue) : safeImage(b.src);
                if (!src) return '';
                var imageWidth = b.type === 'logo' ? Math.max(5, Math.min(250, Number(b.w != null ? b.w : b.width) || (sheet ? 22 : 45))) : b.type === 'barcode' ? 90 : b.width;
                var imageHeight = b.type === 'logo' ? Math.max(8, Math.min(2000, Number(b.h) || 44)) : b.type === 'barcode' ? Math.max(56, Math.min(200, Number(b.h) || 56)) : Number(b.h) || 32;
                if (b.type === 'barcode') {
                    var barcodeWidth = sheet ? contract.formats[format].content * imageWidth / 100 + 'mm' : imageWidth + '%';
                    var barcodeHeight = sheet ? imageHeight * 25.4 / 96 + 'mm' : imageHeight + 'px';
                    content = '<div class="rd-sale-barcode" style="width:' + barcodeWidth + ';max-width:100%;margin:0 auto;text-align:center;line-height:0;">' +
                        '<img src="' + esc(src) + '" alt="Sale barcode ' + esc(saleBarcodeValue) + '" style="display:block;width:100%;height:' + barcodeHeight + ';max-width:100%;object-fit:fill;margin:0 auto;">' +
                        '<div class="rd-barcode-value" style="font-family:Tahoma,sans-serif;font-size:12px;font-weight:700;line-height:14px;text-align:center;letter-spacing:0;margin:0;padding:0;white-space:nowrap;display:block;">' + esc(saleBarcodeValue) + '</div></div>';
                } else {
                    content = '<img src="' + esc(src) + '" alt="' + esc(label(b.type === 'qr' ? 'QR code' : b.type === 'logo' ? 'Store logo' : label('Image'))) + '" style="display:block;width:' + (sheet ? contract.formats[format].content * imageWidth / 100 + 'mm' : imageWidth + '%') + ';height:' + (sheet ? imageHeight * 25.4 / 96 + 'mm' : imageHeight + 'px') + ';max-width:100%;object-fit:contain;margin-left:' + (b.align === 'center' ? 'auto' : '0') + ';margin-right:' + (b.align === 'left' ? 'auto' : '0') + ';">';
                }
            }
            var style = 'text-align:' + b.align;
            if (b.rotation != null && Number.isFinite(Number(b.rotation)) && Number(b.rotation) !== 0) {
                style += ';transform:rotate(' + Math.max(-180, Math.min(180, Number(b.rotation))) + 'deg);transform-origin:center center;';
            }
            if (layout.canvas && Number.isFinite(Number(b.x)) && Number.isFinite(Number(b.y))) {
                style += ';position:absolute;left:' + Math.max(-250, Math.min(300, Number(b.x))) + '%;top:' + Math.max(0, Number(b.y)) + 'px;width:' + Math.max(5, Math.min(250, Number(b.w) || 100)) + '%;margin:0;';
                if (Number.isFinite(Number(b.h)) && Number(b.h) > 0) {
                    var effectiveHeight = Number(b.h);
                    if (!sheet && b.type === 'items') {
                        var estimatedRowsHeight = receiptItems.reduce(function (total, item) {
                            var itemName = PosnicPro.printItemName ? PosnicPro.printItemName(item, 'receipt') : item.item_name;
                            var lineCount = Math.max(1, Math.ceil(Array.from(String(itemName || '')).length / (format === '58' ? 14 : 22)));
                            return total + 18 * lineCount + 8;
                        }, 28);
                        // Basket height follows the actual receipt content, not a manually saved cap.
                        effectiveHeight = Math.max(estimatedRowsHeight, 28);
                        style += 'height:auto;max-height:none;overflow:visible;';
                    } else {
                        style += 'min-height:' + Math.min(4000, effectiveHeight) + 'px;';
                    }
                };
            }
            if (contract.textTypes.indexOf(b.type) !== -1) {
                if (Number.isFinite(Number(b.fontSize)) && Number(b.fontSize) >= 8 && Number(b.fontSize) <= 96) style += ';font-size:' + Number(b.fontSize) + 'px';
                var safeFontFamilies = ['Arial, sans-serif','Tahoma, sans-serif','Verdana, sans-serif','Georgia, serif','Courier New, monospace','monospace'];
                if (safeFontFamilies.indexOf(b.fontFamily) !== -1) style += ';font-family:' + b.fontFamily;
                if (b.bold === true) style += ';font-weight:bold';
            }
            return { type: b.type, half: b.type === 'field' && b.width === 50, customer: b.type === 'field' && /^customer_/.test(b.field), supporting: b.type === 'text' || b.type === 'field' || ((b.type === 'qr' || b.type === 'image') && b.width <= 40), html: '<section class="rd-block rd-block-' + b.type + (b.type === 'field' ? ' rd-field-' + b.field : '') + '" data-block-id="' + esc(b.id) + '" style="' + style + '">' + content + '</section>' };
        }).filter(Boolean);
        rendered = pairFields(rendered);
        // Free-position mode must use the same absolute canvas for preview and
        // print. Sheet composition wraps blocks in grids, which breaks x/y
        // positioning once a block has been dragged.
        var html = sheet && !layout.canvas ? composeSheet(rendered) : rendered.map(function (b) { return b.html; }).join('');
        var canvasHeight = Math.max(80, Math.min(8000, Number(layout.canvasHeight) || 0));
        if (pendingGoods) html += '<section class="rd-block rd-payment-status" style="' + (layout.canvas ? 'position:absolute;left:0;top:' + canvasHeight + 'px;width:100%;' : '') + '">' + esc(label('Payment pending')) + '</section>';
        var canvasExtraHeight = 0;
        if (sheet) {
            var notes = '';
            if ((data.branch_gstin_number || on(data.gst)) && PosnicPro.sales && PosnicPro.sales.view && PosnicPro.sales.view._amountInWords) {
                notes += '<div class="rd-terms"><strong>' + esc(PosnicPro.i18n.t('lang_amount_in_words', 'Amount in words:')) + '</strong> ' + esc(PosnicPro.sales.view._amountInWords(data.items_total)) + '</div>';
            }
            if (data.invoice_terms) notes += '<div class="rd-terms"><strong>' + esc(PosnicPro.i18n.t('lang_terms_conditions', 'Terms & conditions')) + '</strong><br>' + esc(data.invoice_terms) + '</div>';
            if (notes) {
                canvasExtraHeight = layout.canvas ? 180 : 0;
                html += '<div class="rd-invoice-end"' + (layout.canvas ? ' style="position:absolute;left:0;top:' + (canvasHeight + 28) + 'px;width:100%;"' : '') + '><div class="rd-invoice-end-notes">' + notes + '</div></div>';
            }
        }
        var finalCanvasHeight = Math.min(8000, canvasHeight + canvasExtraHeight);
        if (layout.canvas && !sheet) {
            var measuredBottom = layout.blocks.reduce(function (bottom, b) {
                if (!Number.isFinite(Number(b.y)) || Number(b.y) < 0) return bottom;
                var height = Math.max(8, Number(b.h) || 32);
                if (b.type === 'items') {
                    var rowsHeight = receiptItems.reduce(function (total, item) {
                        var itemName = PosnicPro.printItemName ? PosnicPro.printItemName(item, 'receipt') : item.item_name;
                        var lines = Math.max(1, Math.ceil(Array.from(String(itemName || '')).length / (format === '58' ? 14 : 22)));
                        return total + 18 * lines + 8;
                    }, 28);
                    height = Math.max(height, Math.min(4000, rowsHeight));
                }
                return Math.max(bottom, Number(b.y) + height);
            }, 0);
            finalCanvasHeight = Math.min(8000, Math.max(80, measuredBottom + 38));
        }
        var canvasCss = layout.canvas ? '.rd-document{position:relative;height:' + finalCanvasHeight + 'px;min-height:' + finalCanvasHeight + 'px;overflow:visible;}.rd-document>.rd-block{box-sizing:border-box;}' : '';
        return '<style>' + css(format, layout.fontSize) + canvasCss + (fixedItems ? '.rd-fixed-columns .rd-number{white-space:nowrap;}.rd-fixed-columns td{border-bottom:0;padding-top:2px;padding-bottom:2px;}.rd-fixed-columns th,.rd-total-quantity td,.rd-grand-total{border-color:#333;border-top-style:' + (fixedItems.lineStyle || 'dotted') + ';border-bottom-style:' + (fixedItems.lineStyle || 'dotted') + ';}.rd-transaction{border-bottom-style:' + (fixedItems.lineStyle || 'dotted') + ';}.rd-total-quantity td{border-top:1px ' + (fixedItems.lineStyle || 'dotted') + ' #333;padding-top:6px;}.rd-grand-total{border-top-width:1px;border-bottom:1px ' + (fixedItems.lineStyle || 'dotted') + ' #333;padding-bottom:6px;}' : '') + '</style><article class="rd-document' + (sheet ? ' rd-sheet' : '') + '" data-receipt-design="' + format + '">' + html + '</article>';
    }
    var activeSale = false;
    var printCount = 0;
    function printProgress() {
        printCount++;
        if (!document.getElementById('receipt-print-progress')) {
            var status = $('<div id="receipt-print-progress" role="status" aria-live="polite" aria-busy="true">').css({
                position: 'fixed', bottom: '24px', left: '50%', transform: 'translateX(-50%)',
                zIndex: 11000, padding: '16px 24px', borderRadius: '10px', background: '#fff',
                color: '#172b4d', boxShadow: '0 4px 24px #0003', border: '1px solid #d9e2ef',
                display: 'flex', alignItems: 'center', gap: '12px', maxWidth: '90vw'
            });
            $('<span class="spinner-border spinner-border-sm" aria-hidden="true">').appendTo(status);
            var text = $('<div>').appendTo(status);
            $('<strong>').text(PosnicPro.i18n.t('lang_printing', 'Printing')).appendTo(text);
            $('<div>').text(PosnicPro.i18n.t('lang_preparing', 'Preparing...')).appendTo(text);
            status.appendTo('body');
        }
        return function () {
            printCount--;
            if (!printCount) $('#receipt-print-progress').remove();
        };
    }
    function print(html, format, options) {
        var finish = printProgress();
        try { return Promise.resolve(printDocument(html, format, options)).finally(finish); }
        catch (error) { finish(); throw error; }
    }
    // Compile only the already-rendered visible content: hidden fields stay hidden.
    // Unsupported graphics/text are handled by Exact design before submission.
    function fastLines(html) {
        var doc = new DOMParser().parseFromString(html, 'text/html');
        var receipt = doc.querySelector('.rd-document');
        if (!receipt || receipt.querySelector('img,svg,canvas')) return null;
        receipt.querySelectorAll('style,script,[hidden]').forEach(function (el) { el.remove(); });
        var text = '';
        function walk(node) {
            if (node.nodeType === 3) { text += node.textContent + ' '; return; }
            if (node.nodeType !== 1) return;
            if (node.style.display === 'none') return;
            var tag = node.tagName;
            if (tag === 'BR' || tag === 'HR') { text += '\n'; return; }
            var boundary = /^(DIV|P|H[1-6]|SECTION|TR|DL|DT|DD)$/.test(tag);
            if (boundary) text += '\n';
            Array.from(node.childNodes).forEach(walk);
            if (tag === 'TD' || tag === 'TH') text += ' | ';
            if (boundary) text += '\n';
        }
        walk(receipt);
        text = text.replace(/₹/g, 'Rs. ').replace(/×/g, 'x').replace(/−/g, '-').replace(/…/g, '...').replace(/\u00a0/g, ' ').replace(/\u00b7/g, '-');
        if (/[^\x09\x0a\x0d\x20-\x7e]/.test(text)) return null;
        var lines = text.split(/\r?\n/).map(function (line) { return line.replace(/\s+/g, ' ').trim().replace(/ \|$/, ''); }).filter(Boolean);
        return lines.length ? lines : null;
    }
    function printDocument(html, format, options) {
        options = options || {};
        var doc = '<!doctype html><html><head><meta charset="utf-8"><title>' + esc(label('Receipt')) + '</title></head><body>' + html + '</body></html>';
        var printer = window.electronAPI && window.electronAPI.printer;
        var failure = function (error) {
            if (options.sample) throw error;
            PosnicPro.alert('error', error.message || label('Print failed'));
        };
        var fastReceiptLines = options.target && options.target.printMode === 'fast' &&
            ['58', '80', '112'].indexOf(String(format)) !== -1 ? fastLines(html) : null;
        var useFastReceipt = !!fastReceiptLines;
        if (printer && printer.print && options.showDialog !== true) {
            return Promise.resolve(PosnicPro.syncPrinterPreferences ? PosnicPro.syncPrinterPreferences() : null)
                .catch(function () {})
                .then(function () {
                    var chosen = options.target ? options.target.name : PosnicPro.resolveReceiptPrinter();
                    if (chosen === 'default') chosen = '';
                    if (chosen) return chosen;
                    return Promise.resolve(printer.getDefault()).then(function (fallback) {
                        var name = fallback && typeof fallback === 'object' ? fallback.name : fallback;
                        if (!name || (PosnicPro._kitchenPrinters || []).indexOf(String(name).trim().toLowerCase()) !== -1) {
                            throw new Error('Choose a receipt printer in Hardware Manager.');
                        }
                        return name;
                    });
                }).then(function (name) { return printer.print(doc, { printerName: name,
                pageSize: ['58', '80', '112'].indexOf(format) !== -1 ? format + 'mm' : format,
                copies: options.target ? options.target.copies : 1,
                receiptLog: options.receiptLog || null,
                fitReceipt: ['58', '80', '112'].indexOf(format) !== -1,
                // Exact Studio layouts use Chromium + the installed printer driver,
                // matching the working sample output. Raw fast mode is used only when
                // the entire design safely reduces to printable ASCII text.
                thermalRaster: useFastReceipt,
                fastReceiptLines: useFastReceipt ? fastReceiptLines : null,
                silent: true, strictPrinter: true, forceHtml: true, printBackground: true, margins: { marginType: 'none' } }); })
                .then(function (result) {
                    if (!result || !result.success) throw new Error(result && result.error || label('Print failed'));
                    if (!options.sample && !options.batch) PosnicPro.afterPrint();
                    return result;
                }).catch(failure);
        }
        var frame = $('<iframe title="Receipt print" data-t-title="lang_receipt_print" sandbox="allow-same-origin allow-modals">').css({ position: 'fixed', left: '-10000px', top: 0, width: contract.formats[format].width + 'mm', height: '1000px', border: 0 });
        return new Promise(function (resolve, reject) {
            var loadTimeout = setTimeout(function () { frame.remove(); reject(new Error(label('Print failed'))); }, 15000);
            frame.on('load', function () {
                clearTimeout(loadTimeout);
                var win = frame[0].contentWindow;
                Promise.resolve().then(function () { return PosnicPro.waitForPrintAssets(win.document); }).then(function () {
                    window.PosnicReceiptPage.fitDocument(win.document, { usePrinterPaper: true });
                    win.onafterprint = function () { frame.remove(); resolve({ success: true, dialog: true }); };
                    win.focus(); win.print();
                    if (!options.sample) PosnicPro.afterPrint();
                }).catch(function (error) { frame.remove(); reject(error); });
            });
            frame.attr('srcdoc', doc).appendTo('body');
        }).catch(failure);
    }
    async function printSale(data, requested, kitchenBill, options) {
        options = options || {};
        var diagnostic = function (fields) { window.electronAPI?.diagnostics?.event('renderer', fields).catch(function () {}); };
        if (activeSale) return;
        activeSale = true;
        var finish = printProgress();
        diagnostic({ stage: 'sale-print-start', format: requested || 'configured' });
        try {
            if (PosnicPro.printSettings) await PosnicPro.printSettings.ready();
            // Remember whether a saved block-based design was supplied. The native
            // legacy ESC/POS renderer has its own, simpler settings schema and silently
            // ignored Receipt Studio blocks, which made test prints look right while
            // real sales printed the default POSNIC receipt.
            var hasSavedStudioDesign = !!(data && data.receipt_designs && data.receipt_designs.layouts);
            if (!data.receipt_designs) data = Object.assign({}, data, { receipt_designs: defaults(data) });
            var targets = window.electronAPI && PosnicPro.printSettings ? PosnicPro.printSettings.get('sales') : [null];
            if (window.electronAPI && PosnicPro.printSettings && ['a4', 'a5', 'letter'].indexOf(requested) !== -1) {
                // An A4 override must not silently send a sheet to the counter roll.
                targets = targets.filter(function (target) { return ['a4', 'a5', 'letter'].indexOf(target.pageSize) !== -1; });
                if (!targets.length) {
                    var invoice = PosnicPro.printSettings.get('invoice');
                    if (invoice && invoice.printerName && invoice.printerName !== 'default') {
                        targets = [{ name: invoice.printerName, pageSize: requested, copies: invoice.copies }];
                    } else throw new Error('Choose a sheet printer in Printers & paper for A4 printing. Use Thermal for the receipt printer.');
                }
            }
            for (var target of targets) {
                var paper = target ? target.pageSize.replace('mm', '') : null;
                var chosen = formatFor(data, requested === 'standard' && paper ? paper : requested || paper);
                var configuredPrinter = String((target && target.name) || PosnicPro.resolveReceiptPrinter() || '');
                var pdfTarget = /pdf/i.test(configuredPrinter);
                diagnostic({ stage: 'sale-document-render', format: chosen, pdfTarget: pdfTarget });
                // A format explicitly selected for this print takes precedence.
                if (!hasSavedStudioDesign && !pdfTarget && window.electronAPI && window.electronAPI.printer && typeof window.electronAPI.printer.printReceipt === 'function' && ['58', '80', '112'].indexOf(chosen) !== -1 && (!target || ['a4', 'a5', 'letter'].indexOf(String(target.pageSize || '').replace('mm', '')) === -1)) {
                    /*
                     * Thermal sample/designer receipts use the same native
                     * ESC/POS byte renderer and spooler as the known-good
                     * cash-closing ticket. Do not send a Chromium HTML/raster
                     * job to the Tysoo: that was the route producing garbage.
                     */
                    var nativeResult = await window.electronAPI.printer.printReceipt(data, {
                        printers: target ? [{ name: target.name, pageSize: target.pageSize, copies: target.copies }] : [],
                        printerName: target ? target.name : PosnicPro.resolveReceiptPrinter(),
                        paperWidth: chosen,
                        kind: 'receipt-design-sample',
                        source: 'Receipt designer',
                        cut: true
                    });
                    if (!nativeResult || !nativeResult.success) throw new Error(nativeResult && nativeResult.error || label('Print failed'));
                } else {
                    await print(render(data, chosen, kitchenBill), chosen, { target: target, batch: true, sample: false, showDialog: pdfTarget, receiptLog: { saleId: data.sales_id, total: data.items_total, title: kitchenBill ? label('Bill') : label('Receipt'), source: 'Till' } });
                }
            }
            if (!options.preserveWorkspace) PosnicPro.afterPrint();
            return { success: true };
        } catch (error) { diagnostic({ stage: 'sale-print-failed', success: false, message: error.message }); if (options.propagateFailure) throw error; PosnicPro.alert('error', error.message || label('Print failed')); }
        finally { activeSale = false; finish(); }
    }
    PosnicPro.receiptDesigner = { contract: contract, defaults: defaults, standardLayout: standardLayout, render: render, css: css, print: print, printSale: printSale, block: block, fastLines: fastLines, label: label, copy: copy, formatFor: formatFor };
}());
