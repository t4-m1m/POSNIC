(function (root) {
    'use strict';
    function list(value) { return Array.from(new Set(String(value || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean))); }
    function combinations(first, second) {
        var a = Array.isArray(first) ? first.slice() : list(first), b = Array.isArray(second) ? second.slice() : list(second);
        return b.length ? a.flatMap(function (x) { return b.map(function (y) { return x + ' / ' + y; }); }) : a;
    }
    function makeInternalBarcode(existing) {
        var used = new Set((existing || []).map(function (v) { return String(v || '').trim(); }).filter(Boolean));
        for (var attempt = 0; attempt < 1000; attempt++) {
            var bytes = new Uint32Array(1);
            if (root.crypto && typeof root.crypto.getRandomValues === 'function') root.crypto.getRandomValues(bytes);
            else bytes[0] = Math.floor(Math.random() * 0xFFFFFFFF);
            var code = String(1000000 + (bytes[0] % 9000000));
            if (!used.has(code)) return code;
        }
        throw new Error('Could not generate a unique seven-digit barcode.');
    }
    function validGtin(value) {
        var code = String(value || '').replace(/[\s-]/g, '');
        if (!code) return true;
        if (!/^(\d{8}|\d{12}|\d{13}|\d{14})$/.test(code)) return false;
        var sum = 0;
        for (var i = code.length - 2, weight = 3; i >= 0; i--, weight = weight === 3 ? 1 : 3) sum += Number(code[i]) * weight;
        return (10 - sum % 10) % 10 === Number(code.at(-1));
    }
    if (typeof module === 'object' && module.exports) { module.exports = { list: list, combinations: combinations, validGtin: validGtin }; return; }
    var P = root.PosnicPro, photos = [], reading = 0, generation = 0, initialized = false, variants = [], signature = '', caps = {};
    var nutrients = ['kcal', 'protein_g', 'carbs_g', 'fat_g', 'sat_fat_g', 'fibre_g', 'sugar_g', 'sodium_mg'];
    var foodTags = ['gluten_free', 'dairy_free', 'lactose_free', 'nut_free', 'organic', 'no_added_sugar'];
    var marks = ['signature', 'chefs_pick', 'house_special', 'new'];
    function el(id) { return document.getElementById('iv2-' + id); }
    function val(id) { return el(id).value.trim(); }
    function selectedValues(id) { return Array.from(el(id).querySelectorAll('input[type="checkbox"]:checked')).map(function (o) { return o.value; }).filter(Boolean); }
    function axisLabel(id) { var o = option(id); return o && o.value ? o.textContent.trim() : ''; }
    function fillVariantValues(axisId, valuesId) {
        var axis = option(axisId), target = el(valuesId), previous = new Set(selectedValues(valuesId));
        target.replaceChildren();
        var fields = [];
        try { fields = JSON.parse(axis && axis.dataset.variantFields || '[]') || []; } catch (_) {}
        var seen = new Set();
        fields.forEach(function (field, index) {
            var name = String(field && field.name != null ? field.name : '').trim(), key = name.toLocaleLowerCase();
            if (!name || seen.has(key)) return;
            seen.add(key);
            var labelNode = document.createElement('label'); labelNode.className = 'iv2-check iv2-variant-value';
            var input = document.createElement('input'); input.type = 'checkbox'; input.value = name;
            input.id = 'iv2-' + valuesId + '-' + index; input.checked = previous.has(name);
            var textNode = document.createElement('span'); textNode.textContent = name;
            labelNode.append(input, textNode); target.appendChild(labelNode);
        });
    }
    function loadVariantDefinitions() {
        P.get({ url: 'variants/getVariantsAjaxList', data: 'query=' }, function (response) {
            var rows = response && Array.isArray(response.suggestions) ? response.suggestions : response && response.data && Array.isArray(response.data.suggestions) ? response.data.suggestions : [];
            ['axis1', 'axis2'].forEach(function (id) {
                var select = el(id), prior = select.value; select.replaceChildren();
                var empty = document.createElement('option'); empty.value = ''; empty.textContent = id === 'axis2' ? 'No second variant' : 'Choose a predefined variant'; select.appendChild(empty);
                rows.forEach(function (row) {
                    if (!row || !row.id || !row.name) return;
                    var opt = document.createElement('option'); opt.value = String(row.id); opt.textContent = row.name;
                    opt.dataset.variantFields = JSON.stringify(Array.isArray(row.fields) ? row.fields : []);
                    if (String(row.id) === prior) opt.selected = true;
                    select.appendChild(opt);
                });
            });
            fillVariantValues('axis1', 'values1'); fillVariantValues('axis2', 'values2');
        }, function () { report('Could not load POSNIC predefined variants. Reopen this section or use the original item editor.'); });
    }
    function checked(id) { return el(id).checked; }
    function option(id) { return el(id).selectedOptions[0]; }
    function selected(id) { return Array.from(el(id).selectedOptions).map(function (o) { return o.value; }).filter(Boolean); }
    function label(key, fallback) { return P.i18n.t(key, fallback); }
    function error(message, field) { return { error: message, field: 'iv2-' + field }; }
    function report(message) { el('error').textContent = message; el('error').hidden = false; }
    function number(id) { return val(id) === '' ? undefined : Number(val(id)); }
    function notify() { el('form').dispatchEvent(new Event('input', { bubbles: true })); }
    var hsnRows = null, hsnLoading = false, manualPurchaseCost = false;
    function hsnSuggestions() {
        if (!caps.tax) return;
        if (hsnRows === null) {
            if (hsnLoading) return;
            hsnLoading = true;
            P.get({ url: 'items/getJSONhsncode' }, function (r) {
                hsnLoading = false;
                if (!r || !r.data || !Array.isArray(r.data.hsn)) return;
                hsnRows = r.data.hsn;
                hsnSuggestions();
            }, function () {
                hsnLoading = false;
                el('hsn-hint').textContent = P.i18n.t('lang_iv2_hsn_load_failed', 'Could not load suggestions. Enter a known HSN code or focus this field to retry.');
            });
            return;
        }
        var query = val('hsn').toLowerCase();
        var matches = hsnRows.filter(function (r) {
            return query && (String(r.value).indexOf(query) === 0 || String(r.description || '').toLowerCase().indexOf(query) !== -1);
        }).slice(0, 20);
        el('hsn-options').replaceChildren();
        matches.forEach(function (r) {
            var o = document.createElement('option'); o.value = String(r.value); o.label = String(r.description || ''); el('hsn-options').appendChild(o);
        });
        var match = hsnRows.find(function (r) { return String(r.value) === query; });
        if (match) el('hsn-description').value = match.description || '';
        // This catalogue can contain historic tax slabs. Suggest codes only;
        // never silently replace the rate the shopkeeper selected.
    }
    function button(text, action) {
        var b = document.createElement('button'); b.type = 'button'; b.className = 'iv2-secondary'; b.textContent = text; b.onclick = action; return b;
    }
    function fill(id, rows, get) {
        var select = el(id), before = select.value;
        rows.forEach(function (row) { var data = get(row); if (!data.id) return; var o = new Option(data.name, data.id); o.dataset.name = data.name; o.dataset.unit = data.unit || ''; select.add(o); });
        if (before) select.value = before;
    }
    function requestOptions(id, url, get) {
        var select = el(id); select.disabled = true;
        P.get({ url: url, data: url==='items'?{page:1,limit:500}:'query=&branch=' + encodeURIComponent(P.local.get('branch_id_set') || '') }, function (r) {
            select.disabled = false; fill(id, r && (r.suggestions || r.data && r.data.list) || [], get);
        }, function () {
            select.disabled = false;
            var retry = button(label('lang_desktop_retry', 'Try again'), function () { retry.remove(); requestOptions(id, url, get); });
            retry.title = label('lang_could_not_load_the_list', 'Could not load the list'); select.after(retry);
        });
    }
    function photoPicker() {
        var box = el('photo-list'); box.replaceChildren();
        photos.forEach(function (photo, i) {
            var tile = document.createElement('div'); tile.className = 'iv2-photo';
            var img = document.createElement('img'); img.src = photo.preview; img.alt = photo.name; tile.appendChild(img);
            var cover = button(photo.cover === 'yes' ? label('lang_cover_image', 'Cover image') : label('lang_choose_cover', 'Choose cover'), function () {
                photos.forEach(function (p) { p.cover = 'no'; }); photo.cover = 'yes'; photoPicker(); notify();
            }); cover.setAttribute('aria-pressed', String(photo.cover === 'yes')); tile.appendChild(cover);
            tile.appendChild(button(label('lang_remove', 'Remove'), function () {
                photos.splice(i, 1); if (photos.length && !photos.some(function (p) { return p.cover === 'yes'; })) photos[0].cover = 'yes';
                photoPicker(); notify();
            })); box.appendChild(tile);
        });
        document.querySelectorAll('#iv2-variant-rows [data-field="photo"]').forEach(function (select) {
            var previous = select.value; select.replaceChildren(new Option(label('lang_default', 'Default'), ''));
            photos.forEach(function (p) { select.add(new Option(p.name, p.name)); }); select.value = previous;
        });
    }
    function readPhotos(event) {
        var files = Array.from(event.target.files), token = generation;
        if (photos.length + reading + files.length > 12) { report(label('lang_you_can_upload_up_to_12_files', 'You can upload up to 12 files.')); event.target.value = ''; return; }
        if (files.some(function (f) { return !/^image\/(png|jpeg|gif|bmp)$/.test(f.type) || f.size > 5242880; })) {
            report('Choose PNG, JPEG, GIF or BMP images under 5 MB each.'); event.target.value = ''; return;
        }
        files.forEach(function (file) {
            reading++;
            var reader = new FileReader();
            reader.onload = function () {
                if (token !== generation) return;
                var name = file.name, n = 2;
                while (photos.some(function (p) { return p.name === name; })) name = n++ + '-' + file.name;
                photos.push({ name: name, size: file.size, data: String(reader.result).split(',')[1], preview: reader.result, cover: photos.length ? 'no' : 'yes' });
                reading--; photoPicker(); notify();
            };
            reader.onerror = function () { if (token === generation) { reading--; report('Could not read ' + file.name + '. Please choose it again.'); } };
            reader.readAsDataURL(file);
        }); event.target.value = '';
    }
    function variantFields() {
        return [['available_quantity','Opening stock','number'],['barcode_id','Generated barcode','text']];
    }
    function captureVariants() {
        document.querySelectorAll('#iv2-variant-rows .iv2-variant').forEach(function (card, i) {
            card.querySelectorAll('[data-field]').forEach(function (input) { variants[i][input.dataset.field] = input.value; });
        });
    }
    function variantSignature() { return JSON.stringify([val('axis1'),selectedValues('values1'),val('axis2'),selectedValues('values2')]); }
    function generate() {
        var firstValues = selectedValues('values1'), secondValues = selectedValues('values2');
        var names = combinations(firstValues, val('axis2') ? secondValues : []);
        if (!val('axis1') || firstValues.length === 0 || names.length < 1 || names.length > 50 || (val('axis2') && secondValues.length === 0)) {
            report('Choose an existing POSNIC variant and at least one of its predefined values. Create between 1 and 50 combinations.'); return;
        }
        captureVariants(); var previous = new Map(variants.map(function (r) { return [r.variant_value, r]; }));
        var usedCodes = new Set([val('barcode')].filter(Boolean));
        variants = names.map(function (name) {
            if (previous.has(name)) {
                var prior = previous.get(name);
                if (!/^\\d{7}$/.test(String(prior.barcode_id || '')) || usedCodes.has(prior.barcode_id)) prior.barcode_id = makeInternalBarcode(Array.from(usedCodes));
                usedCodes.add(prior.barcode_id);
                return prior;
            }
            var code = makeInternalBarcode(Array.from(usedCodes)); usedCodes.add(code);
            return { variant_value: name, selling_price: val('price'), available_quantity: '0', company_price: val('cost'), mrp_price: val('mrp'), position: val('position'), barcode_id: code, sku_id: '', gtin: '', discount_amount: val('discount-type') === 'amount' ? val('discount') : '', discount_percentage: val('discount-type') === 'percentage' ? val('discount') : '' };
        });
        signature = variantSignature(); var box = el('variant-rows'); box.replaceChildren();
        variants.forEach(function (row, i) {
            var card = document.createElement('div'); card.className = 'iv2-variant'; var heading = document.createElement('h3'); heading.textContent = row.variant_value; card.appendChild(heading);
            var grid = document.createElement('div'); grid.className = 'iv2-grid';
            variantFields().forEach(function (spec) {
                var wrap = document.createElement('div'), lab = document.createElement('label'), input = document.createElement('input');
                input.id = 'iv2-variant-' + i + '-' + spec[0]; lab.htmlFor = input.id; lab.textContent = spec[1]; input.dataset.field = spec[0]; input.type = spec[2];
                if (spec[2] === 'number') { input.min = '0'; input.step = 'any'; }
                if (spec[0] === 'discount_percentage') input.max = '100';
                input.value = row[spec[0]] || ''; if (spec[0] === 'barcode_id') input.readOnly = true; wrap.append(lab, input);
                grid.appendChild(wrap);
            });
            card.appendChild(grid); box.appendChild(card);
        }); notify();
    }
    function isFamily() {
        var kind = document.querySelector('#items_v2 [name="iv2-kind"]:checked');
        if (!kind || kind.value === 'service' || !el('has-variants').checked) return false;
        /* A product is not a variant family merely because it is a product.
           Only selected variant values opt into family validation and the
           atomic createFamily endpoint. An untouched/empty variant editor is
           a valid standalone item. */
        return selectedValues('values1').length > 0 || selectedValues('values2').length > 0;
    }
    function validate() {
        var invalid = document.querySelector('#iv2-fields input:invalid, #iv2-fields select:invalid, #iv2-fields textarea:invalid');
        if (invalid) return { error: invalid.validationMessage, field: invalid.id };
        if (reading) return error('Wait for the selected photos to finish loading.', 'photos');
        if (!P.itemTranslationsV2.ready()) return error(label('lang_item_ai_finish', 'Wait for the suggestion, then keep or cancel it before saving.'), 'item_translation_ai');
        if (val('cost-eur') !== '' && (!(Number(val('exchange-rate')) > 0) || !Number.isFinite(Number(val('exchange-rate'))))) return error('Exchange rate must be greater than zero.', 'exchange-rate');
        if (val('cost-eur') !== '' && (!Number.isFinite(Number(val('purchase-vat'))) || Number(val('purchase-vat')) < 0)) return error('Extra cost must be zero or greater.', 'purchase-vat');
        // Both alternate prices may be below the standard price. Price 3 may
        // be the lowest, so only enforce the ordering between tiers 2 and 3.
        if (val('price-2') !== '' && Number(val('price-2')) < 0) return error('Selling price 2 must be zero or greater.', 'price-2');
        if (val('price-3') !== '' && Number(val('price-3')) < 0) return error('Selling price 3 must be zero or greater.', 'price-3');
        if (val('price-2') !== '' && val('price-3') !== '' && Number(val('price-3')) > Number(val('price-2'))) return error('Selling price 3 must not exceed selling price 2.', 'price-3');
        if (val('pack-size') && !(Number(val('pack-size')) > 0)) return error('Units per pack must be greater than zero.', 'pack-size');
        if (val('expiry') && val('mfg') && val('expiry') < val('mfg')) return error('Expiry date must not be earlier than manufacture date.', 'expiry');
        if (!validGtin(val('gtin')) && !isFamily()) return error('Enter a valid GTIN with a matching check digit.', 'gtin');
        if (isFamily()) {
            captureVariants();
            if (variants.length < 1 || variantSignature() !== signature) return error('Generate the variants after choosing their names and values.', 'values1');
            var codes = new Set();
            for (var i=0;i<variants.length;i++) {
                var row=variants[i];
                if (!validGtin(row.gtin)) return error('Enter a valid GTIN for ' + row.variant_value + '.', 'variant-'+i+'-gtin');
                for (var code of [row.barcode_id, row.gtin].filter(Boolean)) {
                    if (codes.has(code)) return error('Each variant needs its own barcode or GTIN.', 'variant-'+i+'-barcode_id');
                }
                [row.barcode_id,row.gtin].filter(Boolean).forEach(function (code) { codes.add(code); });
            }
        }
        return null;
    }
    function upload() {
        var pending=photos.filter(function(p){return !p.uploaded;});
        if(!pending.length)return Promise.resolve();
        return new Promise(function(resolve,reject){
            P.post({url:'items/uploadItemMultiImage',data:JSON.stringify({items_image:pending.map(function(p){return {name:p.name,size:p.size,data:p.data,cover:p.cover};})})},function(r){
                if(!r||r.type!=='success'||!Array.isArray(r.data)||r.data.length!==pending.length||r.data.some(function(p){return !p.name;})){reject(new Error(r&&r.message||'Image upload failed. Your item has not been saved.'));return;}
                pending.forEach(function(p,i){p.uploaded=r.data[i].name;});resolve();
            },function(){reject(new Error('Image upload failed. Your entries are still here. Please try again.'));});
        });
    }
    function data() {
        var u = option('unit'), supplier = option('supplier'), auto = checked('auto-tile') && P.autoTile ? P.autoTile(val('name')) : null;
        var eurRaw = val('cost-eur'), eur = Number(eurRaw), rate = Number(val('exchange-rate')) || 280, extraCost = Number(val('purchase-vat'));
        var purchaseBase = eurRaw !== '' && Number.isFinite(eur) && eur >= 0 ? Math.round((eur * rate + Number.EPSILON) * 100) / 100 : null;
        var purchaseExtraCost = purchaseBase === null ? null : Math.round((Math.max(0, Number.isFinite(extraCost) ? extraCost : 0) + Number.EPSILON) * 100) / 100;
        var enteredPurchaseCost = val('cost') === '' ? null : Number(val('cost'));
        var finalPurchaseCost = manualPurchaseCost && Number.isFinite(enteredPurchaseCost) && enteredPurchaseCost >= 0 ? Math.round((enteredPurchaseCost + Number.EPSILON) * 100) / 100 : (purchaseBase === null ? null : purchaseBase + purchaseExtraCost);
        var out = { mrp_price: Number(val('mrp')), reorder_point: number('reorder'), unit_id: val('unit') === 'qty' ? '' : val('unit'), unit: u && u.dataset.unit || 'qty', supplier_id: val('supplier'), supplier_name: supplier && supplier.dataset.name || '',
            selling_price_2: val('price-2') === '' ? 0 : Number(val('price-2')), selling_price_3: val('price-3') === '' ? 0 : Number(val('price-3')), open_price: checked('open-price'), service_unit: val('service-unit'), item_weight_machine_based: caps.weight && checked('weight'),
            discount_amount: val('discount-type') === 'amount' ? Number(val('discount')) : 0, discount_percentage: val('discount-type') === 'percentage' ? Number(val('discount')) : 0,
            plu_code: val('plu'), gtin: val('gtin'), barcodes: list(val('alt-barcodes')), purchase_unit: val('purchase-unit'), conversion_factor: number('pack-size'), brand: val('brand'), article_type: val('type-name'), brand_abbreviation: val('brand-abbr'), reference_date: val('reference-date'), model_reference: val('reference'), tags: list(val('tags')), position: Number(val('position')),
            items_mfg_date: val('mfg'), items_expiry_date: val('expiry'), icon: val('icon'), tile_color: auto ? auto.color : val('tile-color'), tile_shape: auto ? auto.shape : val('tile-shape'),
            image: photos.map(function (p) { return { name:p.uploaded||p.name, size:p.size, cover:p.cover }; }),
            purchase_price_eur: purchaseBase === null ? undefined : Math.round(eur * 100) / 100,
            purchase_exchange_rate: purchaseBase === null ? undefined : rate,
            purchase_extra_cost_dzd: purchaseBase === null ? undefined : (Number.isFinite(extraCost) && extraCost >= 0 ? extraCost : 0),
            purchase_base_dzd: purchaseBase === null ? undefined : purchaseBase,
            purchase_vat_dzd: purchaseExtraCost === null ? undefined : purchaseExtraCost,
            purchase_cost_dzd: finalPurchaseCost === null ? undefined : finalPurchaseCost,
            purchase_cost_manual_override: manualPurchaseCost && finalPurchaseCost !== null,
            cover_image: (function(){var p=photos.find(function(p){return p.cover==='yes';});return p?(p.uploaded||p.name):'item.svg';}()), channel_off: selected('channel-off') };
        Object.assign(out, P.itemTranslationsV2.data());
        if (caps.tax && val('hsn')) Object.assign(out, { tax_method: 'hsn', hsn_code: val('hsn'), hsn_description: val('hsn-description'), tax: Number(val('hsn-rate')), tax_id: '', tax_name: '' });
        if (caps.restaurant && document.querySelector('#items_v2 [name="iv2-kind"]:checked').value !== 'service') {
            out.prep_minutes = Number(val('prep-minutes')); out.prep_note = val('prep-note'); out.goes_with = selected('goes-with'); out.nutrition = {};
            nutrients.forEach(function (n) { if (val('n-'+n)) out.nutrition[n]=Number(val('n-'+n)); });
            out.food_tags=foodTags.filter(function (k) {return checked('food-'+k);}); out.menu_marks=marks.filter(function (k) {return checked('mark-'+k);}); out.spice_choice=checked('spice');
        }
        return out;
    }
    function family(shared) {
        captureVariants(); return { variant_axis: [axisLabel('axis1'),axisLabel('axis2')].filter(Boolean).join(' / '), variant_parent_name: shared.name, items: variants.map(function (row) {
            var image=photos.find(function (p) {return p.name===row.photo;});
            var r=Object.assign({},shared,row,{name:shared.name+' / '+row.variant_value,barcodes:[],plu_code:'',sku_id:'',barcode_id:row.barcode_id||'',gtin:'',selling_price:shared.selling_price,company_price:shared.company_price,mrp_price:shared.mrp_price,available_quantity:shared.inventory?Number(row.available_quantity):0});
            var unitOption=Array.from(el('unit').options).find(function(o){return o.value===row.unit_id;});
            r.unit_id=row.unit_id==='qty'?'':row.unit_id||shared.unit_id;r.unit=unitOption&&unitOption.dataset.unit||shared.unit;
            r.translations=(shared.translations||[]).map(function (t) {return Object.assign({},t,{name:t.name?t.name+' / '+row.variant_value:''});});
            if(image) {r.image=[{name:image.uploaded||image.name,size:image.size,cover:'yes'}];r.cover_image=image.uploaded||image.name;}
            delete r.photo; return r;
        }) };
    }
    function status() {
        captureVariants(); return { family: isFamily(), openPrice: checked('open-price'), prices: variants.map(function(r){return Number(r.selling_price);}), quantities: variants.map(function(r){return Number(r.available_quantity);}), hsn: caps.tax && !!val('hsn'), tax: Number(val('hsn-rate')), discount: Number(val('discount')), discountType: val('discount-type') };
    }
    function update(capabilities, kind) {
        caps=capabilities;
        el('food-extra').hidden=!caps.restaurant || kind==='service'; el('tax-extra').hidden=true;
        el('service-unit').parentElement.hidden=kind!=='service'; el('variants').hidden=false; el('variant-editor').hidden=kind==='service' || !el('has-variants').checked; el('quantity-row').hidden=kind==='service' || el('has-variants').checked;
        ['food-extra','tax-extra','variants'].forEach(function(id){el(id).querySelectorAll('input,select,textarea,button').forEach(function(input){input.disabled=el(id).hidden;});});
        ['reorder','purchase-unit','pack-size','weight'].forEach(function(id){el(id).closest(id==='weight'?'label':'div').hidden=kind==='service';});
        ['plu','sku','barcode','gtin','alt-barcodes','same-sku'].forEach(function(id){el(id).disabled=isFamily();});
        el('variant-editor').querySelectorAll('input,select,button').forEach(function(input){input.disabled=kind==='service' || el('variant-editor').hidden;});
        el('quantity').disabled=kind==='service' || el('has-variants').checked;
        el('weight').closest('label').hidden=!caps.weight || kind==='service';
        el('weight').disabled=!caps.weight || kind==='service';
        el('discount').max=val('discount-type')==='percentage'?'100':'';
        el('tile-color').disabled=checked('auto-tile'); el('tile-shape').disabled=checked('auto-tile');
        if(checked('same-sku')&&!isFamily())el('barcode').value=val('sku');
        el('barcode').readOnly=checked('same-sku');
        var preview=document.querySelector('#items_v2 .iv2-item-icon');
        preview.textContent=val('icon')||'▦';
        preview.style.background=checked('auto-tile')&&P.autoTile?P.autoTile(val('name')).color:val('tile-color');preview.style.color='white';
    }
    function reset() {
        generation++; reading=0; photos=[]; variants=[]; signature='';
        el('variant-rows').replaceChildren(); el('auto-tile').checked=true;
        el('type-name').value=''; el('brand-abbr').value=''; el('reference').value='';
        el('reference-date').value=currentYYMM(); el('name').value='';
        el('type-name').required=true; el('brand-abbr').required=true; el('reference').required=true;
        el('cost-eur').value='';
        var purchaseDefaults = readPurchaseSettings();
        el('exchange-rate').value=String(purchaseDefaults.exchangeRate);
        el('purchase-vat').value=String(purchaseDefaults.extraCost);
        updatePurchaseCost(); photoPicker(); P.itemTranslationsV2.reset();
    }
    function currentYYMM() { var d = new Date(); return String(d.getFullYear()).slice(-2) + '-' + String(d.getMonth() + 1).padStart(2, '0'); }
    function syncComposedName() {
        var type = el('type-name').value.trim(), brand = el('brand-abbr').value.trim(), ref = el('reference').value.trim(), date = el('reference-date').value || currentYYMM();
        var base = [type, brand].filter(Boolean).join(' ');
        var full = base;
        if (ref) full += (full ? '-' : '') + date + '/' + ref;
        el('name').value = full;
        el('preview-name').textContent = full || label('lang_your_next_item', 'Your next item');
        notify();
    }
    function readPurchaseSettings() {
        try {
            var saved = JSON.parse(root.localStorage.getItem('posnic.purchase-cost-settings') || '{}');
            return {
                exchangeRate: Number.isFinite(Number(saved.exchangeRate)) && Number(saved.exchangeRate) > 0 ? Number(saved.exchangeRate) : 280,
                extraCost: Number.isFinite(Number(saved.extraCost)) && Number(saved.extraCost) >= 0 ? Number(saved.extraCost) : 0
            };
        } catch (_) { return { exchangeRate: 280, extraCost: 0 }; }
    }
    function updatePurchaseCost() {
        var eurRaw = el('cost-eur').value, eur = Number(eurRaw), rate = Number(el('exchange-rate').value), extraCost = Number(el('purchase-vat').value);
        if (manualPurchaseCost) {
            el('purchase-cost-summary').textContent = 'Manual final cost: ' + (Number.isFinite(Number(el('cost').value)) ? Number(el('cost').value).toFixed(2) : '—') + ' DA. Change EUR cost, exchange rate or extra cost to recalculate.';
            notify(); return;
        }
        if (!Number.isFinite(rate) || rate <= 0) rate = 280;
        if (!Number.isFinite(extraCost) || extraCost < 0) extraCost = 0;
        try { root.localStorage.setItem('posnic.purchase-cost-settings', JSON.stringify({ exchangeRate: rate, extraCost: extraCost })); } catch (_) {}
        if (eurRaw === '' || !Number.isFinite(eur) || eur < 0) {
            el('cost').value = '';
            el('purchase-cost-summary').textContent = 'Enter a purchase price in EUR to calculate the cost in DZD.';
            notify(); return;
        }
        var base = Math.round((eur * rate + Number.EPSILON) * 100) / 100;
        var extra = Math.round((extraCost + Number.EPSILON) * 100) / 100;
        var total = Math.round((base + extra + Number.EPSILON) * 100) / 100;
        el('cost').value = total.toFixed(2);
        el('purchase-cost-summary').textContent = base.toFixed(2) + ' DA + ' + extra.toFixed(2) + ' DA extra cost = ' + total.toFixed(2) + ' DA';
        notify();
    }
    function init() {
        if(initialized)return;initialized=true;
        el('reference-date').value = currentYYMM();
        ['type-name','brand-abbr','reference'].forEach(function(id){el(id).addEventListener('input',syncComposedName);});
        ['cost-eur','exchange-rate','purchase-vat'].forEach(function(id){el(id).addEventListener('input',function(){manualPurchaseCost=false;updatePurchaseCost();});});
        el('cost').addEventListener('input',function(){
            manualPurchaseCost = el('cost').value.trim() !== '' && Number.isFinite(Number(el('cost').value)) && Number(el('cost').value) >= 0;
            if(manualPurchaseCost) el('purchase-cost-summary').textContent = 'Manual final cost: ' + Number(el('cost').value).toFixed(2) + ' DA. Change EUR cost, exchange rate or extra cost to recalculate.';
            notify();
        });
        el('hsn').addEventListener('focus', hsnSuggestions);
        el('has-variants').addEventListener('change', function () {
            captureVariants();
            if (!el('has-variants').checked) { variants=[]; signature=''; el('variant-rows').replaceChildren(); }
            update(caps, document.querySelector('#items_v2 [name="iv2-kind"]:checked').value);
            notify();
        });
        el('form').addEventListener('click', function (event) {
            if (!event.target.closest('#iv2-generate-barcode')) return;
            try {
                var used = [val('barcode') === '' ? '' : val('barcode')];
                el('barcode').value = makeInternalBarcode(used);
                el('same-sku').checked = false;
                el('barcode').readOnly = false;
                notify();
            } catch (e) { report(e.message); }
        });
        el('hsn').addEventListener('input', hsnSuggestions);
        el('photos').addEventListener('change',readPhotos);
        var palette=document.createElement('div');palette.className='iv2-icon-palette';
        ['📦','👕','👟','👜','📱','📚','🧴','✂️','🔧','☕','🍵','🍛','🍜','🍕','🥪','🥗','🍰','🍨','🥤','💧'].forEach(function(icon){var pick=button(icon,function(){el('icon').value=icon;notify();});pick.setAttribute('aria-label',icon);palette.appendChild(pick);});el('icon').after(palette);
        el('form').addEventListener('click',function(e){var target=e.target.closest('[data-iv2-advanced]');if(target&&target.dataset.iv2Advanced==='generate')generate();});
        function clearGeneratedVariants(){variants=[];signature='';el('variant-rows').replaceChildren();notify();}
        el('axis1').addEventListener('change',function(){el('values1').replaceChildren();fillVariantValues('axis1','values1');clearGeneratedVariants();});
        el('axis2').addEventListener('change',function(){el('values2').replaceChildren();fillVariantValues('axis2','values2');clearGeneratedVariants();});
        loadVariantDefinitions();
        requestOptions('unit','setting/getUnitAjaxList',function(r){return {id:r.unit_id,name:r.unit_name,unit:r.unit_value};});
        requestOptions('supplier','suppliers/getSuppliersAjaxList',function(r){return {id:r.id,name:r.name};});
        requestOptions('goes-with','items',function(r){return {id:r.id||r._id,name:r.name||r.value};});
        var channels=P.itemChannels;
        if(channels) {
            var live=channels.liveChannels();fill('channel-off',channels.CHANNELS.filter(function(c){return live.includes(c.id);}),function(c){return {id:c.id,name:channels.labelFor(c)};});
            P.get({url:'settings/group/channels',data:{}},function(r){var values=r&&r.data&&r.data.values||{};fill('channel-off',(values.sales_channel_partners||[]).filter(function(p){return p.enabled!==false&&live.includes(p.channel||'marketplace');}),function(p){return {id:p.id,name:p.label||p.id};});},function(){});
        }
        reset();
    }
    function draft() { captureVariants(); return variants.map(function(row){var copy=Object.assign({},row); delete copy.photo; return copy;}); }
    function restoreDraft(rows) {
        if (!isFamily() || !Array.isArray(rows) || rows.length > 50) return;
        variants=rows.map(function(row){return Object.assign({},row,{photo:''});});
        // generate captures current controls, so start with an empty rendered list.
        el('variant-rows').replaceChildren(); generate();
    }
    function duplicate() {
        captureVariants();
        variants.forEach(function(row){['sku_id','barcode_id','gtin'].forEach(function(key){row[key]='';});row.available_quantity=0;});
        el('variant-rows').replaceChildren(); if(isFamily())generate();
    }
    function load(item) {
        reset();
        var itemName = String(item.name || '');
        var parsedName = itemName.match(/^(.*?)-([0-9]{2}-[0-9]{2})\/([^/]+)$/);
        if (item.article_type || item.brand_abbreviation || item.model_reference) {
            el('type-name').value = item.article_type || '';
            el('brand-abbr').value = item.brand_abbreviation || '';
            el('reference-date').value = item.reference_date || (parsedName && parsedName[2]) || '';
            el('reference').value = item.model_reference || (parsedName && parsedName[3]) || '';
        } else if (parsedName) {
            var nameParts = parsedName[1].trim().split(/\s+/);
            el('type-name').value = nameParts.shift() || '';
            el('brand-abbr').value = nameParts.join(' ');
            el('reference-date').value = parsedName[2];
            el('reference').value = parsedName[3];
        } else {
            el('type-name').value = itemName;
            el('brand-abbr').value = '';
            el('reference-date').value = '';
            el('reference').value = '';
            el('type-name').required = false; el('brand-abbr').required = false; el('reference').required = false;
        }
        var mapping = {mrp:'mrp_price',reorder:'reorder_point',plu:'plu_code',gtin:'gtin','purchase-unit':'purchase_unit','pack-size':'conversion_factor',brand:'brand',position:'sort_order',icon:'icon','tile-color':'tile_color','tile-shape':'tile_shape','service-unit':'service_unit','hsn':'hsncode','hsn-description':'hsndescription','hsn-rate':'tax','prep-note':'prep_note','prep-minutes':'prep_minutes'};
        Object.keys(mapping).forEach(function(id){if(item[mapping[id]] != null) el(id).value=item[mapping[id]];});
        if (item.selling_price_2 != null) el('price-2').value = item.selling_price_2; else el('price-2').value = '';
         if (item.selling_price_3 != null) el('price-3').value = item.selling_price_3; else el('price-3').value = '';
         manualPurchaseCost = false;
        if (item.purchase_price_eur != null) {
            el('cost-eur').value = item.purchase_price_eur;
            if (item.purchase_exchange_rate != null) el('exchange-rate').value = item.purchase_exchange_rate;
            if (item.purchase_extra_cost_dzd != null) el('purchase-vat').value = item.purchase_extra_cost_dzd; else if (item.purchase_vat_dzd != null) el('purchase-vat').value = item.purchase_vat_dzd;
            updatePurchaseCost();
            if (item.purchase_cost_dzd != null && Math.abs(Number(item.purchase_cost_dzd) - Number(el('cost').value)) > 0.009) {
                el('cost').value = Number(item.purchase_cost_dzd).toFixed(2);
                manualPurchaseCost = item.purchase_cost_manual_override !== false;
                if (manualPurchaseCost) el('purchase-cost-summary').textContent = 'Manual final cost: ' + Number(el('cost').value).toFixed(2) + ' DA. Change EUR cost, exchange rate or extra cost to recalculate.';
            }
        } else {
            el('cost').value = item.purchase_cost_dzd != null ? item.purchase_cost_dzd : (item.company_price != null ? item.company_price : '');
            manualPurchaseCost = item.purchase_cost_dzd != null;
        }
        if (itemName) el('name').value = itemName;
        ['mfg','expiry'].forEach(function(id){var v=item[id==='mfg'?'items_mfg_date':'items_expiry_date'];el(id).value=v?String(v).slice(0,10):'';});
        el('tags').value=(item.tags||[]).join(', '); el('alt-barcodes').value=(item.barcodes||[]).join(', ');
        el('discount-type').value=Number(item.discount_percentage)?'percentage':'amount';el('discount').value=item.discount_percentage||item.discount_amount||0;
        el('auto-tile').checked=!item.tile_color; el('open-price').checked=!!item.open_price;el('weight').checked=!!item.item_weight_machine_based;el('spice').checked=!!item.spice_choice;
        function select(id,value,name,unit) {value=String(value||'');if(value&&!Array.from(el(id).options).some(function(o){return o.value===value;})){var o=new Option(name||value,value);o.dataset.name=name||value;o.dataset.unit=unit||'';el(id).add(o);}el(id).value=value;}
        select('unit',item.unit_id||item.unit||'qty',item.unit,item.unit);select('supplier',item.supplier_id,item.supplier_name);
        ['goes-with','channel-off'].forEach(function(id){var values=item[id.replace(/-/g,'_')]||[];values.forEach(function(v){select(id,v,v);});Array.from(el(id).options).forEach(function(o){o.selected=values.includes(o.value);});});
        nutrients.forEach(function(n){el('n-'+n).value=item.nutrition&&item.nutrition[n]!=null?item.nutrition[n]:'';});
        foodTags.forEach(function(k){el('food-'+k).checked=(item.food_tags||[]).includes(k);});marks.forEach(function(k){el('mark-'+k).checked=(item.menu_marks||[]).includes(k);});
        var images=Array.isArray(item.multi_image)?item.multi_image:[];
        if(!images.length&&item.image&&item.image!=='item.svg')images=[{name:item.image,cover:'yes'}];
        photos=images.map(function(p){return {name:p.name,uploaded:p.name,preview:p.name,size:p.size,cover:p.cover|| (p.name===item.image?'yes':'no')};});photoPicker();
        P.itemTranslationsV2.reset(item);
    }
    P.itemsV2Details={load:load,draft:draft,restoreDraft:restoreDraft,duplicate:duplicate,init:init,reset:reset,upload:upload,data:data,validate:validate,update:update,status:status,family:family};
}(typeof window==='undefined'?globalThis:window));
