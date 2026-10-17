/* Navigation and recovery for the item editor. Business validation stays in items_v2. */
(function () {
    'use strict';
    var P = window.PosnicPro, active = 'step1', bound = false, callbacks, timer, key, restoring = false, pending = [], pendingVariants = null, locked = false;
    function el(id) { return document.getElementById('iv2-' + id); }
    function scope() { var user = P.local.get('username'), branch = P.local.get('branch_id_set'); return user && branch ? 'posnic.item-v2.draft:' + JSON.stringify([user, branch]) : null; }
    function tabs() { return Array.from(document.querySelectorAll('#items_v2 [role="tab"]')); }
    function select(id, focus) {
        id = id === 'step2' || id === 'details' || id === 'more' || id === 'languages' ? 'step2' : 'step1';
        var tab = el('tab-' + id); if (!tab) return;
        active = id;
        tabs().forEach(function (b) { var yes = b.dataset.section === id; b.setAttribute('aria-selected', String(yes)); b.tabIndex = yes ? 0 : -1; });
        ['basics','stock','details','more','languages'].forEach(function (panel) {
            var node = el('panel-' + panel);
            if (node) node.hidden = id === 'step1' ? !['basics','stock'].includes(panel) : !['details','more'].includes(panel);
        });
        el('section-select').value = id;
        el('prev-step').hidden = id !== 'step2';
        el('next-step').hidden = id !== 'step1';
        el('save').hidden = id !== 'step2';
        el('step-help').textContent = id === 'step1'
            ? 'Step 1 of 2 · Enter the article information and all selling prices.'
            : 'Step 2 of 2 · Choose variants, generate unique barcodes, add photos and describe the article.';
        if (focus) tab.focus();
    }
    function reveal(node) { var panel = node && node.closest('.iv2-tab-panel'); if (panel) select(['iv2-panel-details','iv2-panel-more'].includes(panel.id) ? 'step2' : 'step1'); }
    function update(caps) {
        // Restaurant controls are optional and may not be present in the retail editor.
        var restaurantTab = el('tab-restaurant');
        if (restaurantTab) restaurantTab.hidden = !caps.restaurant;
        var option = el('section-select').querySelector('[value="restaurant"]');
        if (option) option.hidden = option.disabled = !caps.restaurant;
        if (!caps.restaurant && active === 'restaurant') select('step1');
        var optional = P.i18n.t('lang_optional_2', 'Optional');
        el('summary-basics').textContent = el('name').value.trim() ? P.i18n.t('lang_item_name', 'Item name') : P.i18n.t('lang_iv2_start_here', 'Start here');
        el('summary-stock').textContent = document.querySelector('#items_v2 [name="iv2-stock"]:checked').value === 'untracked' ? P.i18n.t('lang_iv2_not_tracked', 'Stock not tracked') : P.i18n.t('lang_opening_stock', 'Opening stock') + ': ' + (el('quantity').value || '0');
        el('summary-details').textContent = el('photo-list').children.length ? P.i18n.t('lang_item_photos_title', 'Photos') + ': ' + el('photo-list').children.length : optional;
        var count = P.itemTranslationsV2.data().translations.length;
        el('summary-languages').textContent = count ? P.i18n.t('lang_item_translations', 'Translations') + ': ' + count : optional;
        el('summary-more').textContent = el('has-variants').checked ? P.i18n.t('lang_variants_2', 'Variants') : el('sku').value || optional;
        if (el('summary-step1')) el('summary-step1').textContent = el('name').value.trim() ? 'Name & prices' : 'Start here';
        if (el('summary-step2')) el('summary-step2').textContent = el('has-variants').checked ? 'Variants selected' : (el('photo-list').children.length ? 'Photos selected' : optional);
        if (el('summary-restaurant')) el('summary-restaurant').textContent = optional;
    }
    function controls() { return Array.from(el('fields').querySelectorAll('input,select,textarea')).filter(function (e) { return e.type !== 'file' && e.id !== 'iv2-section-select' && !e.id.startsWith('iv2-item_') && !e.closest('#iv2-variant-rows'); }); }
    function snapshot() {
        return { version: 1, controls: controls().map(function (e) { return { id: e.id, name: e.name, parent: e.parentElement.parentElement.id, value: e.value, checked: e.checked, values: e.multiple ? Array.from(e.selectedOptions).map(function (o) { return o.value; }) : null }; }), translations: P.itemTranslationsV2.data(), variants: P.itemsV2Details.draft() };
    }
    function find(row) { return controls().find(function (e) { return row.id ? e.id === row.id : e.name === row.name && e.value === row.value && e.parentElement.parentElement.id === row.parent; }); }
    function apply(row) {
        var e = find(row); if (!e) return false;
        if (e.type === 'checkbox' || e.type === 'radio') e.checked = !!row.checked;
        else if (e.tagName === 'SELECT') {
            var values = row.values || [row.value];
            if (values.some(function (v) { return v && !Array.from(e.options).some(function (o) { return o.value === v; }); })) return false;
            if (e.multiple) Array.from(e.options).forEach(function (o) { o.selected = values.includes(o.value); }); else e.value = row.value;
        } else e.value = row.value;
        return true;
    }
    function persist() {
        if (!key || key !== scope() || locked || restoring || pending.length || pendingVariants) return;
        try { localStorage.setItem(key, JSON.stringify(snapshot())); el('draft-note').textContent = P.i18n.t('lang_iv2_draft_saved', 'Text draft saved on this device. Photos are not included.'); }
        catch (_) { el('draft-note').textContent = P.i18n.t('lang_iv2_draft_unavailable', 'Draft storage unavailable. Keep this page open until saved.'); }
    }
    function changed() { clearTimeout(timer); if (!locked) timer = setTimeout(persist, 500); }
    function clear() { clearTimeout(timer); pending = []; pendingVariants = null; try { if (key) localStorage.removeItem(key); } catch (_) {} }
    function restoreVariants() {
        if (!pendingVariants || pending.length) return;
        var available = Array.from(el('unit').options).map(function (o) { return o.value; });
        if (pendingVariants.some(function (row) { return row.unit_id && !available.includes(row.unit_id); })) return;
        var rows = pendingVariants; pendingVariants = null; P.itemsV2Details.restoreDraft(rows);
    }
    function reset() { clear(); locked = false; el('layout').hidden = false; el('success').hidden = true; el('draft-notice').hidden = true; el('draft-note').textContent = ''; select('step1'); }
    function button(text, action) { var b = document.createElement('button'); b.type = 'button'; b.textContent = text; b.onclick = action; return b; }
    function init(actions) {
        callbacks = actions; if (bound) return; bound = true;
        document.querySelector('#items_v2 .iv2-layout').id = 'iv2-layout';
        el('section-select').addEventListener('change', function () { select(this.value); });
        el('next-step').addEventListener('click', function () { select('step2', true); });
        el('prev-step').addEventListener('click', function () { select('step1', true); });
        tabs().forEach(function (b) {
            b.onclick = function () { select(b.dataset.section); };
            b.onkeydown = function (e) {
                var visible = tabs().filter(function (t) { return !t.hidden; }), index = visible.indexOf(b);
                if (!['ArrowLeft','ArrowRight','Home','End'].includes(e.key)) return;
                e.preventDefault(); index = e.key === 'Home' ? 0 : e.key === 'End' ? visible.length - 1 : (index + (e.key === 'ArrowRight' ? 1 : -1) + visible.length) % visible.length;
                select(visible[index].dataset.section, true);
            };
        });
        el('form').addEventListener('input', changed); el('form').addEventListener('change', changed);
        el('form').addEventListener('invalid', function (e) { reveal(e.target); }, true);
        var note = document.createElement('small'); note.id = 'iv2-draft-note'; document.querySelector('#items_v2 .iv2-actions p').append(document.createElement('br'), note);
        var notice = document.createElement('div'); notice.id = 'iv2-draft-notice'; notice.className = 'iv2-draft-notice'; notice.hidden = true; el('layout').before(notice);
        key = scope();
        try {
            var draft = key && JSON.parse(localStorage.getItem(key) || 'null');
            if (draft && draft.version === 1 && Array.isArray(draft.controls)) {
                locked = true; notice.hidden = false;
                notice.append(document.createTextNode(P.i18n.t('lang_iv2_draft_found', 'An unfinished text draft is available. Photos must be selected again.')));
                notice.append(button(P.i18n.t('lang_iv2_restore', 'Restore draft'), function () {
                    restoring = true; pending = draft.controls.filter(function (row) { return !apply(row); });
                    P.itemTranslationsV2.reset(draft.translations); pendingVariants = Array.isArray(draft.variants) ? draft.variants : null; restoreVariants();
                    restoring = false; locked = false; notice.hidden = true; callbacks.refresh(); select('basics');
                }), button(P.i18n.t('lang_iv2_discard', 'Discard draft'), function () { clear(); locked = false; notice.hidden = true; }));
            }
        } catch (_) { /* Unavailable or invalid storage never blocks creating an item. */ }
        new MutationObserver(function () { if (pending.length) pending = pending.filter(function (row) { return !apply(row); }); restoreVariants(); }).observe(el('fields'), { childList: true, subtree: true });
        select('basics');
    }
    function ready() { clearTimeout(timer); return key === scope() && !pending.length && !pendingVariants; }
    function saved(data, id, assessment, family) {
        clear(); locked = true; el('draft-notice').hidden = true;
        var box = el('success'); box.replaceChildren(); box.className = 'iv2-success iv2-result';
        var heading = document.createElement('h2'); heading.textContent = data.name;
        var state = document.createElement('p'); state.textContent = P.i18n.t('lang_iv2_item_saved', 'Item saved') + ' · ' + (assessment.later ? P.i18n.t('lang_saved_for_later_not_ready_to_sell', 'Saved for later, not ready to sell') : P.i18n.t('lang_ready_to_sell', 'Ready to sell'));
        var price = document.createElement('strong'); price.className = 'iv2-result-price'; price.textContent = family ? P.i18n.t('lang_variants_2', 'Variants') : data.open_price ? P.i18n.t('lang_cashier_types_the_price', 'Cashier types the price') : '…';
        var stock = document.createElement('p'); stock.textContent = data.inventory ? P.i18n.t('lang_opening_stock', 'Opening stock') + ': ' + (family ? P.i18n.t('lang_variants_2', 'Variants') : data.available_quantity) : P.i18n.t('lang_iv2_not_tracked', 'Stock not tracked');
        var actions = document.createElement('div'); actions.className = 'iv2-result-actions';
        var another = button(P.i18n.t('lang_iv2_another', 'Create another'), callbacks.reset); actions.append(another);
        if (id && /^[a-zA-Z0-9_-]+$/.test(String(id))) {
            [['', P.i18n.t('lang_iv2_view', 'View item')]].forEach(function (entry) { var a = document.createElement('a'); a.href = '#/items/' + encodeURIComponent(id) + entry[0]; a.textContent = entry[1]; actions.append(a); });
        }
        if (id && !family) actions.append(button(P.i18n.t('lang_iv2_add_details', 'Add more details'), callbacks.edit));
        if (id && family) { var manage = document.createElement('a'); manage.href = '#/items/' + encodeURIComponent(id) + '/edit'; manage.textContent = P.i18n.t('lang_manage_variants', 'Manage variants'); actions.append(manage); }
        actions.append(button(P.i18n.t('lang_iv2_duplicate', 'Duplicate this item'), function () { callbacks.duplicate(); }));
        box.append(state, heading, price, stock, actions); el('layout').hidden = true; box.hidden = false; another.focus(); box.scrollIntoView({ block: 'start' });
        if (!family && !data.open_price) P.post({ url: 'items/pricePreview', data: JSON.stringify({ price: Number(data.selling_price), tax: Number(data.tax) || 0, tax_type: data.tax_type, discount_amount: Number(data.discount_amount) || 0, discount_percentage: Number(data.discount_percentage) || 0 }) }, function (r) {
            price.textContent = r && r.type === 'success' && r.data && Number.isFinite(Number(r.data.total)) ? (P.local.get('currencySign') || '') + Number(r.data.total).toFixed(2) : '—';
        }, function () { price.textContent = '—'; });
    }
    function edit() { clear(); locked = true; el('layout').hidden = false; el('success').hidden = true; el('draft-note').textContent = P.i18n.t('lang_iv2_edit_draft_note', 'Editing a saved item. Save your changes before leaving.'); select('step1', true); }
    P.itemsV2Workspace = { edit: edit, init: init, update: update, reveal: reveal, reset: reset, ready: ready, saved: saved };
}());
