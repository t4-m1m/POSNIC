/* Default item creator, also available through the #/items_v2/new alias. */
(function (root) {
    'use strict';
    function assess(f) {
        var tracked = f.kind !== 'service' && f.stock === 'tracked';
        var price = Number(f.price), quantity = Number(f.quantity), cost = Number(f.cost);
        if (!String(f.name || '').trim()) return { error: 'Give your item a name.', field: 'iv2-name' };
        if (![price, cost].every(function (n) { return Number.isFinite(n) && n >= 0; })) return { error: 'Enter a valid price of zero or more.', field: 'iv2-price' };
        if (tracked && (!Number.isFinite(quantity) || quantity < 0)) return { error: 'Enter an opening stock quantity of zero or more.', field: 'iv2-quantity' };
        if (!price && !f.confirmZero && !f.openPrice) return { error: 'Add a selling price, or confirm that you want to save it at zero.', field: 'iv2-confirm-zero' };
        if (tracked && !quantity && !['negative', 'later'].includes(f.zeroStock)) return { error: 'Choose how to handle this item’s zero stock.', field: 'iv2-zero-stock' };
        return { tracked: tracked, price: price, quantity: tracked ? quantity : 0, negative: tracked && f.zeroStock === 'negative', later: tracked && quantity === 0 && f.zeroStock === 'later' };
    }
    function payload(f) {
        var a = assess(f);
        if (a.error) throw new Error(a.error);
        var tier2=f.price2===''?a.price:Number(f.price2),tier3=f.price3===''?tier2:Number(f.price3);
        return { name: f.name.trim(), selling_price: a.price, selling_price_2: tier2, selling_price_3: tier3, company_price: Number(f.cost), available_quantity: a.quantity,
            inventory: a.tracked, negative_stock: a.negative, item_kind: f.kind === 'service' ? 'service' : 'product', service_unit: 'fixed',
            tax_id: f.taxId || '', tax_name: f.taxName || '', tax: Number(f.taxRate) || 0, tax_type: f.taxType,
            category_id: f.categoryId || '', category_name: f.categoryName || '', barcode_id: f.barcode.trim(), sku_id: f.sku.trim(),
            brand_abbreviation: f.brandAbbreviation || '', reference_date: f.referenceDate || '',
            description: f.description.trim(), unit: 'qty', ecommerce: false, open_price: false, item_weight_machine_based: false };
    }
    if (typeof module === 'object' && module.exports) { module.exports = { assess: assess, payload: payload }; return; }
    var P = root.PosnicPro, $ = root.jQuery;
    var businessContext = null, capabilities = {}, savedItemId = null, editing = false, savedBranch = null;
    var existingItem = null, editBaseline = null, editSequence = 0;
    function readCapabilities() {
        var settings = {};
        try { settings = JSON.parse(P.local.get('general_settings') || '{}'); } catch (_) {}
        return { restaurant: businessContext === 'restaurant' || (businessContext === null && P.local.get('table_options') === 'enable'), tax: settings.module_tax_enable !== false, weight: settings.hardware_weight_machine_enable === true, online: settings.module_online_ordering_enable !== false };
    }
    function loadRestaurantOptions() {
        function fill(id, rows, empty) {
            var box = document.getElementById(id), previous = new Set(checkedValues(id)); box.replaceChildren();
            rows.forEach(function (row) {
                if (!row.id || !row.name) return;
                var label = document.createElement('label'); label.className = 'iv2-check';
                var input = document.createElement('input'); input.type = 'checkbox'; input.value = row.id; input.checked = previous.has(String(row.id));
                label.append(input, document.createTextNode(row.name)); box.appendChild(label);
            });
            if (!box.children.length) box.textContent = empty;
        }
        P.get({ url: 'settings/group/channels', data: {} }, function (r) {
            var rows = r && r.data && r.data.values && r.data.values.menu_dayparts;
            fill('iv2-periods', Array.isArray(rows) ? rows : [], 'No serving periods set. Add them in Restaurant → Menu.');
        }, function () { text('iv2-periods', 'Serving periods could not load. You can add them from the full editor later.'); });
        P.get({ url: 'setting/modifierGroups', data: {} }, function (r) {
            fill('iv2-modifiers', r && Array.isArray(r.data) ? r.data : [], 'No modifier groups set. Add them in Restaurant settings.');
        }, function () { text('iv2-modifiers', 'Modifier groups could not load. You can add them from the full editor later.'); });
    }
    function checkedValues(id) { return Array.from(document.querySelectorAll('#' + id + ' input:checked')).map(function (el) { return el.value; }); }
    function applyBusinessContext() {
        var restaurant = businessContext === 'restaurant' || (businessContext === null && P.local.get('table_options') === 'enable');
        var kind = restaurant ? 'dish' : businessContext === 'service' ? 'service' : 'product';
        document.querySelector('#items_v2 input[name="iv2-kind"][value="' + kind + '"]').checked = true;
        document.querySelector('#items_v2 input[name="iv2-stock"][value="' + (kind === 'product' ? 'tracked' : 'untracked') + '"]').checked = true;
        text('iv2-product-label', restaurant ? PosnicPro.i18n.t('lang_packaged_product', 'Packaged product') : PosnicPro.i18n.t('lang_retail_product', 'Retail product'));
    }
    var touched = new Set();
    var bound = false, taxReady = false, taxLoading = false, busy = false, saved = false, attempted = false;
    function value(id) { return document.getElementById(id).value; }
    function selected(name) { var el = document.querySelector('#items_v2 input[name="' + name + '"]:checked'); return el ? el.value : ''; }
    function show(id, yes) { document.getElementById(id).hidden = !yes; }
    function text(id, message) { document.getElementById(id).textContent = message; }
    function fields() {
        var tax = document.getElementById('iv2-tax').selectedOptions[0];
        var category = document.getElementById('iv2-category').selectedOptions[0];
        var details = P.itemsV2Details.status();
        var quantities=details.quantities.filter(function(n){return Number.isFinite(Number(n));});
        return { name: value('iv2-name'), price: value('iv2-price'), price2: value('iv2-price2'), price3: value('iv2-price3'), cost: value('iv2-cost'), quantity: details.family ? quantities.reduce(function(sum,n){return sum+Number(n||0);},0) : value('iv2-quantity'), kind: selected('iv2-kind'), stock: selected('iv2-stock'), zeroStock: selected('iv2-zero-stock'), confirmZero: document.getElementById('iv2-confirm-zero').checked, openPrice: details.openPrice, family: details.family,
            brandAbbreviation: value('iv2-brand-abbr'), referenceDate: value('iv2-reference-date'),
            taxId: taxReady && capabilities.tax ? value('iv2-tax') : '', taxName: capabilities.tax && tax && tax.dataset.name || '', taxRate: capabilities.tax && tax && tax.dataset.rate || 0, taxType: value('iv2-tax-type'), categoryId: value('iv2-category'), categoryName: category && category.dataset.name || '', barcode: value('iv2-barcode'), sku: value('iv2-sku'), description: value('iv2-description') };
    }
    function money(n) { return (P.local.get('currencySign') || '') + Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
    var previewTimer, previewKey = '', previewSequence = 0;
    function pricePreview(f, details) {
        var params = { price: Number(f.price), tax: details.hsn ? details.tax : Number(f.taxRate), tax_type: f.taxType,
            discount_amount: details.discountType === 'amount' ? details.discount : 0,
            discount_percentage: details.discountType === 'percentage' ? details.discount : 0 };
        var key = JSON.stringify([params, f.family, f.openPrice, taxReady]);
        if (key === previewKey) return;
        previewKey = key; clearTimeout(previewTimer); var sequence = ++previewSequence;
        if (f.family || f.openPrice) {
            text('iv2-price-hint', f.family ? P.i18n.t('lang_item_price_variants', 'Each variant uses its own price and discount.') : P.i18n.t('lang_item_price_open', 'Customer price is entered at the sale.'));
            text('iv2-preview-price', f.family ? P.i18n.t('lang_variants_2', 'Variants') : P.i18n.t('lang_cashier_types_the_price', 'Cashier types the price')); return;
        }
        text('iv2-preview-price', '—');
        text('iv2-price-hint', P.i18n.t('lang_item_price_calculating', 'Checking price…'));
        if (!taxReady || !Number.isFinite(params.price)) return;
        previewTimer = setTimeout(function () {
            P.post({ url: 'items/pricePreview', data: JSON.stringify(params) }, function (r) {
                if (sequence !== previewSequence) return;
                if (!r || r.type !== 'success' || !r.data || !Number.isFinite(Number(r.data.total))) { unavailable(); return; }
                text('iv2-preview-price', money(r.data.total));
                text('iv2-price-hint', P.i18n.t('lang_item_pays_one', 'Customer pays for one: ') + money(r.data.total));
            }, unavailable);
            function unavailable() { if (sequence === previewSequence) { text('iv2-price-hint', P.i18n.t('lang_item_price_unavailable', 'Price preview unavailable. Check the price and tax before saving.')); text('iv2-preview-price', '—'); } }
        }, 200);
    }
    function render() {
        var dishChoice = document.querySelector('#items_v2 input[name="iv2-kind"][value="dish"]');
        dishChoice.closest('label').hidden = !capabilities.restaurant;
        dishChoice.disabled = !capabilities.restaurant;
        document.querySelector('#items_v2 .iv2-types').style.gridTemplateColumns = 'repeat(' + (capabilities.restaurant ? 3 : 2) + ', minmax(0, 1fr))';
        if (!capabilities.restaurant && dishChoice.checked) {
            document.querySelector('#items_v2 input[name="iv2-kind"][value="product"]').checked = true;
            document.querySelector('#items_v2 input[name="iv2-stock"][value="tracked"]').checked = true;
        }
        P.itemsV2Details.update(capabilities, selected('iv2-kind'));
        var f = fields(), a = assess(f), named = !!f.name.trim(), tracked = f.kind !== 'service' && f.stock === 'tracked';
        show('iv2-restaurant', capabilities.restaurant && f.kind !== 'service'); show('iv2-online', capabilities.online);
        var copySource = value('iv2-copy-source');
        show('iv2-copy-notice', !!copySource && !saved);
        text('iv2-copy-notice', P.i18n.t('lang_iv2_copy_notice', 'Copy of {name}. This is a new, unsaved item. The original item will not change.').replace('{name}', copySource));
        var noun = f.kind === 'dish' ? 'dish' : f.kind === 'service' ? 'service' : 'item';
        text('iv2-title', copySource ? P.i18n.t('lang_iv2_create_copy', 'Create a copy') : (editing ? PosnicPro.i18n.t('lang_edit_title', 'Edit') : PosnicPro.i18n.t('lang_po_create', 'Create')).trim() + ' ' + noun); text('iv2-name-label', noun.charAt(0).toUpperCase() + noun.slice(1) + ' name');
        document.querySelector('#items_v2 .iv2-heading p').textContent = editing ? P.i18n.t('lang_iv2_edit_hint', 'Add details to your saved item, then save your changes.') : P.i18n.t('lang_start_with_a_name_we_ll_help_you_get_it_re', 'Start with a name. We’ll help you get it ready to sell.');
        document.getElementById('iv2-name').placeholder = f.kind === 'dish' ? 'e.g. Tea, Chicken biryani, Butter naan' : f.kind === 'service' ? 'e.g. Haircut, Delivery, Repair' : 'e.g. Mineral water, Blue shirt';
        if (!busy && !saved) text('iv2-save', copySource ? P.i18n.t('lang_iv2_save_copy', 'Save as new item') + ' →' : editing ? P.i18n.t('lang_iv2_save_changes', 'Save changes') + ' →' : 'Save ' + noun + ' →');
        var details = P.itemsV2Details.status();
        if (details.hsn) f.taxRate = details.tax;
        var price = Number(f.price);
        show('iv2-zero-price', (attempted || touched.has('iv2-price')) && price === 0 && !f.openPrice);
        show('iv2-quantity-row', tracked);
        document.getElementById('iv2-quantity').readOnly = !!f.family;
        document.getElementById('iv2-quantity').disabled = editing || !tracked;
        if(f.family)document.getElementById('iv2-quantity').value=f.quantity;
        document.getElementById('iv2-has-variants').disabled = editing;
        if (editing) show('iv2-quantity-row', false);
        show('iv2-zero-stock', (attempted || touched.has('iv2-quantity')) && tracked && Number(f.quantity) === 0);
        document.querySelector('#items_v2 input[name="iv2-stock"][value="tracked"]').disabled = f.kind === 'service' || busy || saved;
        text('iv2-stock-note', tracked ? (f.zeroStock === 'negative' ? PosnicPro.i18n.t('lang_for_this_item_only_sales_can_take_its_stoc', 'For this item only: sales can take its stock below zero.') : PosnicPro.i18n.t('lang_stock_tracking_applies_to_this_item_only', 'Stock tracking applies to this item only.')) : 'This item can be sold without an opening stock quantity.');
        text('iv2-preview-name', f.name.trim() || 'Your next item');
        text('iv2-preview-tax', taxReady ? (Number(f.taxRate) ? 'Customer pays · including tax' : 'Customer pays · no tax selected') : 'Loading tax settings');
        pricePreview(f, details);
        P.itemsV2Workspace.update(capabilities);
        var title = !named ? 'Let’s get started' : a.error ? 'A little more to decide' : a.later ? PosnicPro.i18n.t('lang_saved_for_later_not_ready_to_sell', 'Saved for later, not ready to sell') : PosnicPro.i18n.t('lang_ready_to_sell', 'Ready to sell');
        var note = !named ? 'Give your item a name to begin.' : a.error ? a.error : a.later ? 'Add stock before looking for this item in sale search.' : f.openPrice ? 'The cashier enters the price when selling.' : !price ? 'This item will sell at zero. You can edit the price later.' : tracked ? 'Opening stock: ' + a.quantity + '. Your stock choice will be saved.' : 'No stock count needed. Save it and start selling.';
        var panel = document.getElementById('iv2-readiness');
        if (a.error && !attempted) { title = P.i18n.t('lang_iv2_taking_shape', 'Your item is taking shape'); note = P.i18n.t('lang_iv2_optional_hint', 'Enter the essentials. Optional tabs can wait.'); }
        if (editing && !a.error) note = P.i18n.t('lang_iv2_edit_stock_note', 'Changes update this item. Stock quantities stay unchanged.');
        if (editing) text('iv2-summary-stock', P.i18n.t('lang_iv2_stock_unchanged', 'Stock quantities unchanged'));
        panel.dataset.state = a.error && !attempted ? 'neutral' : a.error || a.later ? 'attention' : 'ready';
        panel.querySelector('strong').textContent = title; panel.querySelector('p').textContent = note;
        document.getElementById('iv2-check-name').dataset.done = String(named);
        document.getElementById('iv2-check-price').dataset.done = String(Number.isFinite(price) && (price > 0 || f.confirmZero || f.openPrice));
        document.getElementById('iv2-check-stock').dataset.done = String(!tracked || Number(f.quantity) > 0 || ['later', 'negative'].includes(f.zeroStock));
    }
    function fail(message, target) {
        text('iv2-error', message); show('iv2-error', true);
        var node = document.getElementById(target || 'iv2-error');
        if (node && node.id === 'iv2-zero-stock') node = node.querySelector('button');
        if (node) { P.itemsV2Workspace.reveal(node); var details = node.closest('details'); if (details) details.open = true; node.focus(); node.scrollIntoView({ block: 'center', behavior: 'smooth' }); }
    }
    function loadTax() {
        if (!capabilities.tax) { taxReady = true; show('iv2-tax-error', false); return; }
        if (taxLoading) return;
        taxLoading = true; taxReady = false; show('iv2-tax-error', false);
        P.get({ url: 'setting/getTaxAll', data: { tax_group: 'all' } }, function (r) {
            taxLoading = false;
            if (!r || !Array.isArray(r.data)) { show('iv2-tax-error', true); return; }
            var select = document.getElementById('iv2-tax'), previousTax = editing ? select.selectedOptions[0] && select.selectedOptions[0].cloneNode(true) : null; select.replaceChildren(new Option('No tax', ''));
            r.data.forEach(function (tax) { var option = new Option(tax.tax_name, tax.tax_id); option.dataset.name = tax.tax_name; option.dataset.rate = tax.tax_value; select.add(option); });
            var def = editing && previousTax ? previousTax.value : P.local.get('default_tax_id');
            if (editing && previousTax && !Array.from(select.options).some(function(o){return o.value===previousTax.value;})) select.add(previousTax);
            if (def && Array.from(select.options).some(function (o) { return o.value === String(def); })) select.value = def;
            select.disabled = busy || saved; taxReady = true; render();
        }, function () { taxLoading = false; show('iv2-tax-error', true); });
    }
    function reset() {
        busy = false; editing = false; savedItemId = null; savedBranch = null; existingItem = null; editBaseline = null; editSequence++;
        document.getElementById('iv2-copy-source').value = '';
        P.itemsV2Workspace.reset(); touched.clear();
        document.getElementById('iv2-form').reset(); P.itemsV2Details.reset(); applyBusinessContext(); saved = false; attempted = false;
        document.getElementById('iv2-fields').disabled = false;
        document.getElementById('iv2-save').disabled = false;
        text('iv2-save', 'Save item →'); show('iv2-success', false); show('iv2-error', false);
        document.getElementById('iv2-tax-type').value = P.local.get('tax_type') === 'exclusive' ? 'exclusive' : 'inclusive';
        var def = P.local.get('default_tax_id');
        if (def && Array.from(document.getElementById('iv2-tax').options).some(function (o) { return o.value === String(def); })) document.getElementById('iv2-tax').value = def;
        var now=new Date(),yy=String(now.getFullYear()).slice(-2),mm=String(now.getMonth()+1).padStart(2,'0');
        var dateField=document.getElementById('iv2-reference-date');if(dateField)dateField.value=yy+'-'+mm;
        ['iv2-article-type','iv2-brand-abbr','iv2-model-reference','iv2-price2','iv2-price3','iv2-price-eur','iv2-extra-cost'].forEach(function(id){var el=document.getElementById(id);if(el)el.value='';});
        var rateField=document.getElementById('iv2-exchange-rate');if(rateField)rateField.value='280';
        var costField=document.getElementById('iv2-cost');if(costField)costField.value='0.00';
        var generatedName=document.getElementById('iv2-name');if(generatedName)generatedName.value='';
        var stepOne=document.getElementById('iv2-owner-step1'),stepTwo=document.getElementById('iv2-owner-step2');
        if(stepOne&&stepTwo){stepOne.classList.add('active');stepTwo.classList.remove('active');var tabs=document.querySelectorAll('#iv2-owner-steps .iv2-owner-tabs button');if(tabs.length){tabs[0].classList.add('active');tabs[1].classList.remove('active');}}
        render(); document.getElementById('iv2-name').focus();
    }
    function save(event) {
        if (event) event.preventDefault();
        if (busy || saved) return false;
        if (P.aclLoaded && P.aclLoaded() && !P.checkAccess('item', 'write')) { fail('You don’t have permission to create items.'); return false; }
        if (editing && savedBranch !== P.local.get('branch_id_set')) { fail(P.i18n.t('lang_iv2_edit_branch_changed', 'The active branch changed. Open the item again before editing.')); return false; }
        attempted = true; render();
        if (!P.itemsV2Workspace.ready()) { fail(P.i18n.t('lang_iv2_draft_lists', 'Some draft selections are unavailable. Reload to retry, or discard the draft before saving.')); return false; }
        var f = fields(), a = assess(f);
        if (a.error) { fail(a.error, a.field); return false; }
        var tier1=Number(f.price),tier2=f.price2===''?tier1:Number(f.price2),tier3=f.price3===''?tier2:Number(f.price3);
        if(![tier1,tier2,tier3].every(function(n){return Number.isFinite(n)&&n>=0;})||tier2>tier1||tier3>tier2){fail('Selling prices must follow: Price 3 ≤ Price 2 ≤ Price 1.','iv2-price2');return false;}
        var advancedError = P.itemsV2Details.validate();
        if (advancedError) { fail(advancedError.error, advancedError.field); return false; }
        var form = document.getElementById('iv2-form');
        if (!form.reportValidity()) return false;
        if (!taxReady) { fail('Wait for tax settings to load, or choose Try again above.', 'iv2-tax-error'); return false; }
        var data = Object.assign(payload(f), P.itemsV2Details.data());
        if (capabilities.restaurant && f.kind !== 'service') {
            data.diet = value('iv2-diet'); data.daypart_ids = checkedValues('iv2-periods');
            data.modifier_group_ids = checkedValues('iv2-modifiers'); data.show_on_menu = document.getElementById('iv2-menu').checked;
        }
        if (capabilities.online) data.ecommerce = document.getElementById('iv2-orderable').checked;
        busy = true; show('iv2-error', false); document.getElementById('iv2-fields').disabled = true;
        document.getElementById('iv2-save').disabled = true; text('iv2-save', 'Saving…');
        function unlock() { busy = false; document.getElementById('iv2-fields').disabled = false; document.getElementById('iv2-save').disabled = false; text('iv2-save', 'Save item →'); render(); }
        P.itemsV2Details.upload().then(function(){
        Object.assign(data, P.itemsV2Details.data());
        var requestData = Object.assign({}, data);
        if (editing && existingItem && editBaseline) {
            var changes = {};
            Object.keys(requestData).forEach(function(k){if(JSON.stringify(requestData[k]) !== JSON.stringify(editBaseline[k])) changes[k]=requestData[k];});
            // Preserve stored fields that are hidden or not represented in this editor.
            requestData = Object.assign({}, existingItem, {sku_id:existingItem.itemid, inventory:existingItem.track_inventory,
                hsn_code:existingItem.hsncode, hsn_description:existingItem.hsndescription, position:existingItem.sort_order,
                cover_image:existingItem.image, image:existingItem.multi_image || []}, changes);
            ['_id','id','branch_id','branch_access','license','created_date','updated_date'].forEach(function(k){delete requestData[k];});
        }
        if (editing) delete requestData.available_quantity;
        P.request({ url: editing ? 'items/' + encodeURIComponent(savedItemId) + '/details' : f.family ? 'items/createFamily' : 'items', method: editing ? 'PUT' : 'POST', data: JSON.stringify(f.family ? P.itemsV2Details.family(requestData) : requestData) }, function (r) {
            unlock();
            if (!r || r.type !== 'success') { fail(r && r.message || 'Couldn’t save. Your entries are still here.'); return; }
            saved = true; document.getElementById('iv2-fields').disabled = true; document.getElementById('iv2-save').disabled = true; text('iv2-save', 'Saved');
            var id = editing ? savedItemId : r.data && (r.data.id || r.data._id || r.data.created && r.data.created[0]);
            if (editing && existingItem) { existingItem = Object.assign({}, existingItem, requestData, {itemid:requestData.sku_id,track_inventory:requestData.inventory,hsncode:requestData.hsn_code,hsndescription:requestData.hsn_description,sort_order:requestData.position,multi_image:requestData.image,image:requestData.cover_image}); editBaseline = Object.assign({}, data); }
            savedItemId = id; savedBranch = P.local.get('branch_id_set');
            if (!f.family && r.data) {
                if (r.data.itemid != null) document.getElementById('iv2-sku').value = r.data.itemid;
                if (typeof r.data.track_inventory === 'boolean') document.querySelector('#items_v2 [name="iv2-stock"][value="' + (r.data.track_inventory ? 'tracked' : 'untracked') + '"]').checked = r.data.track_inventory;
            }
            document.getElementById('iv2-copy-source').value = '';
            show('iv2-copy-notice', false);
            P.itemsV2Workspace.saved(data, id, a, f.family);
        }, function (xhr) {
            unlock(); var message = 'Couldn’t confirm the save. Check your item list before trying again.';
            try { message = JSON.parse(xhr.responseText).message || message; } catch (_) { /* preserve the form */ }
            fail(message);
        });
        }).catch(function(error){unlock();fail(error.message);});
        return false;
    }
    function bind() {
        if (bound) return; bound = true;
        var form = document.getElementById('iv2-form'); form.addEventListener('submit', save);
        form.addEventListener('focusout', function (event) { touched.add(event.target.id); if (!saved && !busy) render(); });
        form.addEventListener('input', function (event) {
            if (event.target.id === 'iv2-name' || event.target.id === 'iv2-price') document.getElementById('iv2-confirm-zero').checked = false;
            if (event.target.id === 'iv2-quantity') document.querySelectorAll('#items_v2 input[name="iv2-zero-stock"]').forEach(function (el) { el.checked = false; });
            show('iv2-error', false); render();
        });
        form.addEventListener('change', function (event) {
            var el = event.target;
            if (el.name === 'iv2-kind') {
                document.querySelector('#items_v2 input[name="iv2-stock"][value="' + (el.value === 'product' ? 'tracked' : 'untracked') + '"]').checked = true;
                document.querySelectorAll('#items_v2 input[name="iv2-zero-stock"]').forEach(function (node) { node.checked = false; });
            }
            if (el.name === 'iv2-zero-stock' && el.value === 'untracked') document.querySelector('#items_v2 input[name="iv2-stock"][value="untracked"]').checked = true;
            render();
        });
        form.addEventListener('click', function (event) {
            var button = event.target.closest('[data-iv2-action]');
            var action = button && button.dataset.iv2Action;
            if (action === 'retry') loadTax();
            if (action === 'add-stock') document.getElementById('iv2-quantity').focus();
        });
        document.getElementById('iv2-name').addEventListener('keydown', function (event) { if (event.key === 'Enter') { event.preventDefault(); document.getElementById('iv2-price').focus(); } });
        document.getElementById('iv2-price').addEventListener('keydown', function (event) { if (event.key === 'Enter') { event.preventDefault(); if (selected('iv2-stock') === 'tracked') document.getElementById('iv2-quantity').focus(); else save(); } });
    }
    function prepareCopy() {

            var originalName = value('iv2-name');
            document.getElementById('iv2-copy-source').value = originalName;
            var suffix = ' (' + P.i18n.t('lang_iv2_copy_suffix', 'copy') + ')';
            document.getElementById('iv2-name').value = originalName.slice(0, Math.max(0, 200 - suffix.length)) + suffix;
            busy = false; editing = false; savedItemId = null; savedBranch = null; existingItem = null; editBaseline = null; editSequence++;
            P.itemsV2Workspace.reset(); saved=false; attempted=false; touched.clear();
            document.getElementById('iv2-fields').disabled=false; document.getElementById('iv2-save').disabled=false;
            ['iv2-sku','iv2-barcode','iv2-gtin','iv2-plu','iv2-alt-barcodes','iv2-quantity'].forEach(function(id){document.getElementById(id).value='';});
            document.querySelectorAll('#items_v2 [name="iv2-zero-stock"]').forEach(function(e){e.checked=false;});
            P.itemsV2Details.duplicate(); render();
            var nameInput = document.getElementById('iv2-name'); nameInput.focus(); nameInput.select();
            nameInput.dispatchEvent(new Event('input', { bubbles: true }));
    }
    function prepareCustomCreateLayout() {
        var fieldsBox=document.getElementById('iv2-fields');
        if(!fieldsBox || fieldsBox.dataset.posnicTwoStep==='1') return;
        fieldsBox.dataset.posnicTwoStep='1';
        var style=document.createElement('style');
        style.textContent='#items_v2 .iv2-layout{display:block!important}#items_v2 .iv2-aside,#items_v2 .iv2-section-picker,#items_v2 .iv2-tabs{display:none!important}#items_v2 .iv2-owner-tabs{display:flex;gap:10px;border-bottom:1px solid #dce7f5;margin:0 0 18px;padding:0 0 10px}#items_v2 .iv2-owner-tabs button{border:1px solid #d5e1f0;background:#f6f9fd;color:#34506f;border-radius:8px;padding:11px 18px;font-weight:700}#items_v2 .iv2-owner-tabs button.active{background:#e8f1ff;border-color:#2672c9;color:#1557a6}#items_v2 .iv2-owner-panel{display:none}#items_v2 .iv2-owner-panel.active{display:block}#items_v2 .iv2-owner-fields{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px 18px}#items_v2 .iv2-owner-field{min-width:0;display:flex;flex-direction:column;gap:6px}#items_v2 .iv2-owner-field label{font-size:13px;font-weight:700;color:var(--theme-text-primary,#24344d)}#items_v2 .iv2-owner-field input,#items_v2 .iv2-owner-field select{min-height:40px;border:1px solid var(--theme-border-color,#d5deea);border-radius:8px;padding:8px 11px;width:100%;background:var(--theme-input-bg,#fff);color:var(--theme-text-primary,#24344d)}#items_v2 .iv2-owner-panel .iv2-section{margin:14px 0;padding:18px;border:1px solid #e2eaf4;border-radius:10px;background:var(--theme-card-bg,#fff)}#items_v2 .iv2-owner-nav{display:flex;justify-content:space-between;gap:10px;margin:18px 0 6px}#items_v2 .iv2-owner-nav button{min-height:42px;padding:9px 18px;border-radius:8px;font-weight:700}#items_v2 .iv2-owner-primary{background:#1768bd;color:#fff;border:1px solid #1768bd}#items_v2 .iv2-owner-secondary{background:#fff;color:#334155;border:1px solid #cbd5e1}#items_v2 #iv2-codes #iv2-plu,#items_v2 #iv2-codes #iv2-sku,#items_v2 #iv2-codes #iv2-gtin,#items_v2 #iv2-codes #iv2-same-sku,#items_v2 #iv2-codes #iv2-alt-barcodes,#items_v2 #iv2-codes #iv2-purchase-unit,#items_v2 #iv2-codes #iv2-pack-size{display:none!important}#items_v2 #iv2-codes label[for=iv2-plu],#items_v2 #iv2-codes label[for=iv2-sku],#items_v2 #iv2-codes label[for=iv2-gtin],#items_v2 #iv2-codes label[for=iv2-alt-barcodes],#items_v2 #iv2-codes label[for=iv2-purchase-unit],#items_v2 #iv2-codes label[for=iv2-pack-size]{display:none!important}#items_v2 #iv2-stock-intro,#items_v2 .iv2-stock-modes,#items_v2 #iv2-zero-stock,#items_v2 #iv2-tax-extra,#items_v2 #iv2-tax-field,#items_v2 .iv2-tax-row,#items_v2 #iv2-zero-price{display:none!important}#items_v2 .iv2-owner-generated input{background:#f4f7fb;font-weight:700}#items_v2 .iv2-owner-price-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}@media(max-width:760px){#items_v2 .iv2-owner-fields,#items_v2 .iv2-owner-price-grid{grid-template-columns:1fr}}';
        document.head.appendChild(style);
        var root=document.createElement('div');root.id='iv2-owner-steps';
        root.innerHTML='<nav class="iv2-owner-tabs"><button type="button" class="active">1  Basic information</button><button type="button">2  Stock &amp; pricing</button></nav><section id="iv2-owner-step1" class="iv2-owner-panel active"><section class="iv2-section" id="iv2-owner-identity"><h2>Basic information</h2><div class="iv2-owner-fields" id="iv2-owner-name-fields"></div></section><div id="iv2-owner-step1-content"></div><div class="iv2-owner-nav"><span></span><button type="button" class="iv2-owner-primary" id="iv2-owner-next">Continue to step 2 →</button></div></section><section id="iv2-owner-step2" class="iv2-owner-panel"><div class="iv2-owner-nav"><button type="button" class="iv2-owner-secondary" id="iv2-owner-back">← Back to step 1</button><span></span></div><div id="iv2-owner-step2-content"></div></section>';
        var p1=root.querySelector('#iv2-owner-step1-content'),p2=root.querySelector('#iv2-owner-step2-content'),nameFields=root.querySelector('#iv2-owner-name-fields');
        function field(labelText,id,type,required,placeholder){var wrap=document.createElement('div');wrap.className='iv2-owner-field';var lab=document.createElement('label');lab.htmlFor=id;lab.textContent=labelText;var input=document.createElement('input');input.id=id;input.type=type||'text';input.required=!!required;if(placeholder)input.placeholder=placeholder;wrap.append(lab,input);nameFields.appendChild(wrap);return input;}
        var articleType=field('Article Type / Name','iv2-article-type','text',true,'e.g. dress, robe, sneakers, pull');
        var brandAbbr=field('Brand Abbreviation','iv2-brand-abbr','text',true,'e.g. mqn, stl, hdd');brandAbbr.maxLength=20;
        var refDate=field('Reference Date (YY-MM)','iv2-reference-date','text',true,'26-11');refDate.pattern='[0-9]{2}-[0-9]{2}';
        var modelRef=field('Model Reference','iv2-model-reference','text',true,'e.g. 133, 048');
        var nameLabel=document.querySelector('label[for=iv2-name]'),nameInput=document.getElementById('iv2-name');
        var nameWrap=document.createElement('div');nameWrap.className='iv2-owner-field iv2-owner-generated';nameLabel.textContent='Generated article name';nameInput.readOnly=true;nameInput.required=true;nameWrap.append(nameLabel,nameInput);nameFields.appendChild(nameWrap);
        function move(selector,target){var node=document.querySelector(selector);if(node)target.appendChild(node);return node;}
        move('#iv2-details-extra',p1);move('#iv2-codes',p1);move('#iv2-variants',p1);
        var stockSection=document.querySelector('#iv2-panel-basics section:nth-of-type(2)');
        if(stockSection){var modes=stockSection.querySelector('.iv2-stock-modes');if(modes)modes.remove();var zero=stockSection.querySelector('#iv2-zero-stock');if(zero)zero.remove();var stockTitle=stockSection.querySelector('.iv2-section-title');if(stockTitle)stockTitle.remove();move('#iv2-quantity-row',stockSection);p2.appendChild(stockSection);}
        var priceLabel=document.querySelector('label[for=iv2-price]'),priceInput=document.getElementById('iv2-price');
        var priceSection=document.createElement('section');priceSection.className='iv2-section';priceSection.innerHTML='<h2>Selling prices (DA)</h2><div class="iv2-owner-price-grid" id="iv2-owner-price-grid"></div>';
        var priceGrid=priceSection.querySelector('#iv2-owner-price-grid'),priceWrap=document.createElement('div');priceWrap.className='iv2-owner-field';priceLabel.textContent='Selling Price 1 (DA)';priceInput.required=true;priceWrap.append(priceLabel,priceInput);priceGrid.appendChild(priceWrap);
        function tier(id,labelText){var wrap=document.createElement('div');wrap.className='iv2-owner-field';var lab=document.createElement('label');lab.htmlFor=id;lab.textContent=labelText;var input=document.createElement('input');input.id=id;input.type='number';input.min='0';input.step='any';wrap.append(lab,input);priceGrid.appendChild(wrap);}
        tier('iv2-price2','Selling Price 2 (DA)');tier('iv2-price3','Selling Price 3 (Minimum - DA)');p2.appendChild(priceSection);
        move('#iv2-pricing-extra',p2);move('#iv2-appearance',p2);
        var costLabel=document.querySelector('label[for=iv2-cost]'),costInput=document.getElementById('iv2-cost');if(costLabel)costLabel.textContent='Calculated Purchase Price (DA)';if(costInput)costInput.readOnly=true;
        var exchange=document.createElement('section');exchange.className='iv2-section';exchange.innerHTML='<h2>Purchase cost calculation</h2><div class="iv2-owner-fields" id="iv2-owner-exchange"></div>';
        var exchangeGrid=exchange.querySelector('#iv2-owner-exchange');
        function numeric(id,labelText,initial){var wrap=document.createElement('div');wrap.className='iv2-owner-field';var lab=document.createElement('label');lab.htmlFor=id;lab.textContent=labelText;var input=document.createElement('input');input.id=id;input.type='number';input.min='0';input.step='any';input.value=String(initial);wrap.append(lab,input);exchangeGrid.appendChild(wrap);return input;}
        var eur=numeric('iv2-price-eur','Price (EUR)',0),rate=numeric('iv2-exchange-rate','Taux d’échange (DA / EUR)',280),extra=numeric('iv2-extra-cost','Extra Cost (DA)',0);p2.appendChild(exchange);
        var error=document.getElementById('iv2-error'),actions=document.querySelector('.iv2-actions');if(error)p2.appendChild(error);if(actions){var save=document.getElementById('iv2-save');if(save)save.textContent='Enregistrer et Valider →';p2.appendChild(actions);}
        var nav=root.querySelector('.iv2-owner-tabs').querySelectorAll('button'),step1=root.querySelector('#iv2-owner-step1'),step2=root.querySelector('#iv2-owner-step2');
        function setStep(n){var second=n===2;step1.classList.toggle('active',!second);step2.classList.toggle('active',second);nav[0].classList.toggle('active',!second);nav[1].classList.toggle('active',second);if(second)root.scrollIntoView({behavior:'smooth',block:'start'});}
        function updateName(){var type=articleType.value.trim(),abbr=brandAbbr.value.trim().toLowerCase(),date=refDate.value.trim(),model=modelRef.value.trim();nameInput.value=type&&abbr&&date&&model?type+' '+abbr+'-'+date+'/'+model:'';nameInput.dispatchEvent(new Event('input',{bubbles:true}));}
        function updateCost(){if(costInput){costInput.value=((Number(eur.value)||0)*(Number(rate.value)||0)+(Number(extra.value)||0)).toFixed(2);costInput.dispatchEvent(new Event('input',{bubbles:true}));}}
        function continueStep(){[articleType,brandAbbr,refDate,modelRef].forEach(function(x){x.value=x.value.trim();});if(!articleType.reportValidity()||!brandAbbr.reportValidity()||!refDate.reportValidity()||!modelRef.reportValidity())return;if(refDate.value.length!==5||refDate.value.charAt(2)!=='-'||!/[0-9]/.test(refDate.value.charAt(0))||!/[0-9]/.test(refDate.value.charAt(1))||!/[0-9]/.test(refDate.value.charAt(3))||!/[0-9]/.test(refDate.value.charAt(4))){refDate.setCustomValidity('Use YY-MM, for example 26-11.');refDate.reportValidity();refDate.setCustomValidity('');return;}updateName();setStep(2);}
        nav[0].addEventListener('click',function(){setStep(1);});nav[1].addEventListener('click',continueStep);root.querySelector('#iv2-owner-next').addEventListener('click',continueStep);root.querySelector('#iv2-owner-back').addEventListener('click',function(){setStep(1);});
        [articleType,brandAbbr,refDate,modelRef].forEach(function(x){x.addEventListener('input',updateName);});[eur,rate,extra].forEach(function(x){x.addEventListener('input',updateCost);});
        var now=new Date(),yy=String(now.getFullYear()).slice(-2),mm=String(now.getMonth()+1).padStart(2,'0');refDate.value=yy+'-'+mm;
        var tracked=document.querySelector('#items_v2 input[name=iv2-stock][value=tracked]');if(tracked)tracked.checked=true;
        var oldPanels=document.querySelectorAll('#items_v2 .iv2-tab-panel');oldPanels.forEach(function(x){x.hidden=true;});var oldTypes=document.querySelector('#items_v2 .iv2-types');if(oldTypes)oldTypes.hidden=true;
        var form=document.getElementById('iv2-form');form.insertBefore(root,fieldsBox.firstChild);
        updateName();updateCost();
    }
    function open(initialName) {
        if (editing) reset();
        if (P.HideSideBarModal) P.HideSideBarModal();
        $('.page_loader,#osk-container').hide(); $('#items_v2').show();
        capabilities = readCapabilities();
        P.itemsV2Details.init();
        prepareCustomCreateLayout();
        P.itemsV2Workspace.init({refresh:render,reset:reset,edit:function () {
            if (!savedItemId || savedBranch !== P.local.get('branch_id_set')) return;
            editing = true; saved = false; attempted = false;
            document.getElementById('iv2-copy-source').value = '';
            document.getElementById('iv2-fields').disabled = false; document.getElementById('iv2-save').disabled = false;
            P.itemsV2Workspace.edit(); render();
        },duplicate:prepareCopy        });
        show('iv2-tax-field', capabilities.tax); document.getElementById('iv2-tax-type').hidden = !capabilities.tax;
        if (!bound) applyBusinessContext();
        if (capabilities.restaurant) loadRestaurantOptions();
        bind(); document.querySelectorAll('#items_v2 .iv2-currency').forEach(function (el) { el.textContent = P.local.get('currencySign') || ''; });
        if (!taxReady) { document.getElementById('iv2-tax-type').value = P.local.get('tax_type') === 'exclusive' ? 'exclusive' : 'inclusive'; loadTax(); }
        P.get({ url: 'categories/getCategoryAjaxList', data: 'query=' }, function (r) {
            var select = document.getElementById('iv2-category'), previous = select.value, previousOption = select.selectedOptions[0] && select.selectedOptions[0].cloneNode(true);
            select.replaceChildren(new Option('No category', ''));
            ((r && r.suggestions) || []).forEach(function (c) { var option = new Option(c.name, c.id); option.dataset.name = c.name; select.add(option); }); if(previousOption && !Array.from(select.options).some(function(o){return o.value===previous;})) select.add(previousOption); select.value = previous;
        }, function () { /* category is optional */ });
        if (typeof initialName === 'string') {
            reset();
            document.getElementById('iv2-name').value = initialName;
            document.getElementById('iv2-name').dispatchEvent(new Event('input', { bubbles: true }));
        }
        render(); document.getElementById('iv2-name').focus();
    }
    function showEdit(id, duplicate) {
        open(); reset();
        var sequence = ++editSequence, branch = P.local.get('branch_id_set');
        editing = true; savedItemId = String(id); savedBranch = branch; busy = true;
        P.itemsV2Workspace.edit(); render();
        document.getElementById('iv2-fields').disabled = true; document.getElementById('iv2-save').disabled = true; text('iv2-save', 'Loading…');
        function failed(message) { if(sequence!==editSequence)return; busy=true; fail(message || 'Could not load this item. Open it again to retry.'); document.getElementById('iv2-fields').disabled=true; document.getElementById('iv2-save').disabled=true; }
        P.get({url:'items/getItemDetails',data:{id:id}}, function(r) {
            if(sequence!==editSequence || branch!==P.local.get('branch_id_set'))return;
            if(!r || r.type!=='success' || !r.data)return failed(r&&r.message);
            var item = r.data; existingItem = item;
            function set(id,v){var e=document.getElementById('iv2-'+id);if(e)e.value=v==null?'':v;}
            function choice(name,v){document.querySelectorAll('#items_v2 [name="iv2-'+name+'"]').forEach(function(e){e.checked=e.value===v;});}
            choice('kind',item.item_kind==='service'?'service':'product');choice('stock',item.track_inventory?'tracked':'untracked');choice('zero-stock',item.negative_stock?'negative':'later');
            set('name',item.name);set('price',item.selling_price);set('cost',item.company_price);set('quantity',Math.max(0,Number(item.available_quantity)||0));set('sku',item.itemid);set('barcode',item.barcode_id);set('description',item.description);set('tax-type',item.tax_type||'inclusive');set('diet',item.diet);
            document.getElementById('iv2-confirm-zero').checked=Number(item.selling_price)===0;
            document.getElementById('iv2-orderable').checked=!!item.ecommerce;document.getElementById('iv2-menu').checked=item.show_on_menu!==false;
            function select(id,v,name,rate){var e=document.getElementById('iv2-'+id),o=new Option(name||'',String(v||''));o.dataset.name=name||'';o.dataset.rate=rate||0;e.add(o);e.value=String(v||'');}
            select('category',item.category_id,item.category_name);select('tax',item.tax_id,item.tax_name,item.tax);
            ['periods','modifiers'].forEach(function(key){var box=document.getElementById('iv2-'+key),values=item[key==='periods'?'daypart_ids':'modifier_group_ids']||[];values.forEach(function(v){if(!Array.from(box.querySelectorAll('input')).some(function(e){return e.value===v;})){var label=document.createElement('label'),input=document.createElement('input');input.type='checkbox';input.value=v;label.append(input,document.createTextNode(v));box.append(label);}});box.querySelectorAll('input').forEach(function(e){e.checked=values.includes(e.value);});});
            P.itemsV2Details.load(item);busy=false;document.getElementById('iv2-fields').disabled=false;document.getElementById('iv2-save').disabled=false;render();
            var f=fields();editBaseline=Object.assign(payload(f),P.itemsV2Details.data());
            if(capabilities.restaurant){editBaseline.diet=value('iv2-diet');editBaseline.daypart_ids=checkedValues('iv2-periods');editBaseline.modifier_group_ids=checkedValues('iv2-modifiers');editBaseline.show_on_menu=document.getElementById('iv2-menu').checked;}
            if(capabilities.online)editBaseline.ecommerce=document.getElementById('iv2-orderable').checked;
            document.getElementById('iv2-tab-basics').click();document.getElementById('iv2-name').focus();
            if (duplicate) prepareCopy();
        },function(){failed();});
    }
    P.items_v2 = { showEdit: showEdit, showClone: function(id){showEdit(id,true);}, showAdd: open, showDataTablePage: open, setBusinessContext: function (category) {
        businessContext = ['restaurant', 'retail', 'service'].includes(category) ? category : null;
        if (bound) { capabilities = readCapabilities(); reset(); if (capabilities.restaurant) loadRestaurantOptions(); }
    } };
}(typeof window === 'undefined' ? globalThis : window));
