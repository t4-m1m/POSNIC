(function () {
  'use strict';

  var $ = function (selector) { return document.querySelector(selector); };
  var apiBase = localStorage.getItem('posnic_companion_server') || (window.location.origin + '/api');
  var token = localStorage.getItem('posnic_companion_token') || '';
  var shop = null;
  var activeTab = 'scan';
  var queue = [];
  var cameraStream = null;
  var cameraFrame = 0;
  var detector = null;
  var scanBusy = false;

  function cleanBase(value) {
    var valueText = String(value || '').trim().replace(/\/+$/, '');
    if (!/^https?:\/\//i.test(valueText)) throw new Error('Adresse serveur invalide. Exemple : http://192.168.1.20:5555/api');
    if (/\/mobile\/v1$/i.test(valueText)) valueText = valueText.replace(/\/mobile\/v1$/i, '');
    if (!/\/api$/i.test(valueText)) valueText += '/api';
    return valueText;
  }

  function messageOf(data, fallback) {
    return data && (data.message || data.error && data.error.message) || fallback || 'Erreur serveur.';
  }

  async function request(path, options, overrideBase) {
    var opts = options || {};
    var headers = Object.assign({}, opts.headers || {});
    if (token) headers.Authorization = 'Bearer ' + token;
    if (opts.body && !(opts.body instanceof FormData)) headers['Content-Type'] = 'application/json';
    var response;
    try {
      response = await fetch((overrideBase || apiBase) + path, Object.assign({ credentials: 'omit', cache: 'no-store' }, opts, { headers: headers }));
    } catch (error) {
      throw new Error('Serveur POSNIC inaccessible. Vérifiez que le téléphone est sur le même Wi-Fi que le PC et que Windows autorise POSNIC sur le réseau privé.');
    }
    var data = {};
    try { data = await response.json(); } catch (_) {}
    if (!response.ok) {
      if (response.status === 401) {
        token = '';
        localStorage.removeItem('posnic_companion_token');
      }
      throw new Error(messageOf(data, 'Erreur serveur (' + response.status + ').'));
    }
    return data;
  }

  function toast(text) {
    var node = $('#toast');
    node.textContent = text;
    node.classList.add('show');
    window.setTimeout(function () { node.classList.remove('show'); }, 2600);
  }

  function setConnected(connected) {
    $('#connection-state').textContent = connected ? 'Connecté' : 'Hors connexion';
    $('#connection-state').classList.toggle('online', connected);
  }

  function showWorkspace() {
    $('#connect-screen').hidden = true;
    $('#workspace').hidden = false;
    $('#logout').hidden = false;
    $('#welcome-name').textContent = 'Bonjour' + (shop && shop.staffName ? ' ' + shop.staffName.split(' ')[0] : '');
    $('#welcome-branch').textContent = (shop && (shop.name || shop.branchName)) || 'Votre magasin POSNIC';
    setConnected(true);
  }

  function activate(name) {
    activeTab = name;
    document.querySelectorAll('.tab').forEach(function (button) {
      button.classList.toggle('active', button.dataset.tab === name);
    });
    document.querySelectorAll('.panel').forEach(function (panel) {
      panel.classList.toggle('active', panel.id === 'tab-' + name);
    });
    if (name === 'receive' && token) loadPendingOperations();
  }

  function deviceInfo() {
    var id = localStorage.getItem('posnic_companion_device_id');
    if (!id) {
      id = window.crypto && window.crypto.randomUUID
        ? window.crypto.randomUUID()
        : 'web-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 18);
      localStorage.setItem('posnic_companion_device_id', id);
    }
    return {
      device_id: id,
      platform: 'mobile-pos',
      app: 'POSNIC Web Companion',
      app_version: '1.1.0',
      device_model: navigator.userAgent.slice(0, 120),
      network: 'wifi',
      language: navigator.language || 'fr',
      time_zone: Intl.DateTimeFormat().resolvedOptions().timeZone || '',
      screen: window.screen.width + 'x' + window.screen.height
    };
  }

  async function pair(code, server) {
    apiBase = cleanBase(server);
    localStorage.setItem('posnic_companion_server', apiBase);
    var result = await request('/mobile/v1/pair', {
      method: 'POST',
      body: JSON.stringify({ code: String(code || '').replace(/[ -]/g, '').toUpperCase(), device: deviceInfo() })
    }, apiBase);
    if (!result.token) throw new Error('Le serveur n’a pas confirmé le jumelage.');
    token = result.token;
    localStorage.setItem('posnic_companion_token', token);
    var boot = await request('/mobile/v1/bootstrap');
    shop = boot.shop || null;
    if (!shop) throw new Error('Le serveur n’a pas retourné les informations du magasin.');
    showWorkspace();
    toast('Téléphone connecté à POSNIC');
    await Promise.all([loadCatalogue(''), loadPendingOperations()]);
  }

  async function restoreSession() {
    if (!token) return;
    try {
      apiBase = cleanBase(apiBase);
      var boot = await request('/mobile/v1/bootstrap');
      shop = boot.shop || null;
      if (!shop) throw new Error('Session invalide.');
      showWorkspace();
      await loadPendingOperations();
    } catch (error) {
      // Keep the paired token across temporary Wi-Fi loss. request() clears it
      // only for a real 401, so a network outage never forces a new pairing.
      if (token) {
        showWorkspace();
        setConnected(false);
        toast('Hors connexion · reconnexion automatique dès le retour du Wi-Fi');
      } else {
        setConnected(false);
        $('#connect-error').textContent = 'La session doit être reconnectée : ' + error.message;
      }
    }
  }

  function unwrapRows(data) {
    return Array.isArray(data.rows) ? data.rows : [];
  }

  function formatMoney(minor) {
    var amount = Number(minor || 0) / 100;
    return amount.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ' + ((shop && shop.currency) || 'DA');
  }

  function renderCatalogue(rows, host, editable) {
    host.innerHTML = '';
    if (!rows.length) {
      host.className = 'results empty-state';
      host.textContent = 'Aucun article trouvé.';
      return;
    }
    host.className = 'results';
    rows.forEach(function (item) {
      var card = document.createElement('article');
      card.className = 'product';
      if (item.image) {
        var photo = document.createElement('img');
        photo.className = 'product-photo';
        photo.src = item.image;
        photo.alt = item.name || 'Article';
        photo.loading = 'lazy';
        card.append(photo);
      }
      var body = document.createElement('div');
      body.className = 'product-body';
      var title = document.createElement('strong');
      title.textContent = item.name || 'Article';
      var meta = document.createElement('small');
      meta.textContent = 'Code : ' + (item.barcode || item.code || item.sku || '—') + ' · Stock : ' + (item.quantity == null ? '—' : Number(item.quantity / 1000).toLocaleString('fr-FR'));
      var price = document.createElement('div');
      price.className = 'price';
      price.textContent = formatMoney(item.price);
      body.append(title, meta, price);
      if (editable && item.id) {
        var edit = document.createElement('button');
        edit.type = 'button';
        edit.className = 'secondary product-edit';
        edit.textContent = 'Modifier la fiche / photo';
        edit.addEventListener('click', function () { openItemEditor(item.id); });
        body.append(edit);
      }
      card.append(body);
      host.append(card);
    });
  }

  async function loadCatalogue(query, target, editable) {
    var host = target || $('#lookup-results');
    var cacheKey = 'posnic_companion_catalogue:' + String(query || '').trim().toLowerCase();
    host.className = 'results empty-state';
    host.textContent = 'Chargement du catalogue…';
    try {
      var data = await request('/mobile/v1/inventory/catalogue?kind=items&q=' + encodeURIComponent(query || ''));
      var rows = unwrapRows(data);
      try { localStorage.setItem(cacheKey, JSON.stringify(rows)); } catch (_) {}
      renderCatalogue(rows, host, editable === true);
      return rows;
    } catch (error) {
      try {
        var cached = JSON.parse(localStorage.getItem(cacheKey) || 'null');
        if (Array.isArray(cached)) {
          renderCatalogue(cached, host, editable === true);
          toast('Catalogue en cache · mode hors connexion');
          return cached;
        }
      } catch (_) {}
      host.textContent = error.message;
      return [];
    }
  }

  function findBarcode(row, code) {
    var target = String(code || '').trim().toLowerCase();
    return [row.barcode, row.code, row.sku].some(function (value) { return String(value || '').trim().toLowerCase() === target; });
  }

  async function resolveReceiveCode(code) {
    var data = await request('/mobile/v1/inventory/catalogue?kind=items&q=' + encodeURIComponent(code));
    var rows = unwrapRows(data);
    var exact = rows.find(function (row) { return findBarcode(row, code); }) || rows.find(function (row) { return String(row.name || '').toLowerCase() === code.toLowerCase(); });
    if (!exact) throw new Error('Article introuvable. Vérifiez le code-barres ou ajoutez d’abord l’article au catalogue.');
    if (!exact.tracked) throw new Error('Le suivi de stock est désactivé pour cet article. Activez-le dans POSNIC avant réception.');
    var held = queue.find(function (line) { return line.itemId === exact.id; });
    if (held) held.quantity += 1000;
    else queue.push({ itemId: exact.id, name: exact.name, barcode: exact.barcode || exact.code || code, quantity: 1000, stock: exact.quantity, unit: exact.unit || '' });
    renderQueue();
    if (navigator.vibrate) navigator.vibrate(35);
    toast(exact.name + ' · quantité +1');
  }

  function renderQueue() {
    try { localStorage.setItem('posnic_companion_receive_queue', JSON.stringify(queue)); } catch (_) {}
    var host = $('#receive-queue');
    host.innerHTML = '';
    if (!queue.length) {
      host.className = 'results empty-state';
      host.textContent = 'Aucun article dans la réception.';
    } else {
      host.className = 'results';
      queue.forEach(function (line) {
        var row = document.createElement('div');
        row.className = 'queue-item';
        var info = document.createElement('div');
        info.className = 'queue-info';
        var name = document.createElement('strong');
        name.textContent = line.name;
        var meta = document.createElement('small');
        meta.textContent = 'Stock actuel : ' + (line.stock == null ? '—' : Number(line.stock / 1000).toLocaleString('fr-FR')) + ' · ' + line.barcode;
        info.append(name, meta);
        var controls = document.createElement('div');
        controls.className = 'quantity-controls';
        var minus = document.createElement('button');
        minus.type = 'button'; minus.textContent = '−'; minus.setAttribute('aria-label', 'Retirer une unité');
        minus.addEventListener('click', function () { line.quantity -= 1000; if (line.quantity <= 0) queue = queue.filter(function (v) { return v !== line; }); renderQueue(); });
        var qty = document.createElement('b');
        qty.textContent = String(line.quantity / 1000);
        var plus = document.createElement('button');
        plus.type = 'button'; plus.textContent = '+'; plus.setAttribute('aria-label', 'Ajouter une unité');
        plus.addEventListener('click', function () { line.quantity += 1000; renderQueue(); });
        controls.append(minus, qty, plus);
        row.append(info, controls);
        host.append(row);
      });
    }
    var total = queue.reduce(function (sum, line) { return sum + line.quantity / 1000; }, 0);
    $('#queue-count').textContent = total + ' unité' + (total > 1 ? 's' : '') + ' · ' + queue.length + ' article' + (queue.length > 1 ? 's' : '');
    $('#apply-receive').disabled = !queue.length;
  }

  async function applyReceive() {
    if (!queue.length) return;
    var button = $('#apply-receive');
    button.disabled = true;
    $('#receive-status').textContent = 'Préparation de l’opération…';
    var operationId = window.crypto && window.crypto.randomUUID ? window.crypto.randomUUID() : 'receive-' + Date.now() + '-' + Math.random().toString(36).slice(2, 12);
    try {
      var prepared = await request('/mobile/v1/inventory/operations', {
        method: 'POST',
        body: JSON.stringify({
          id: operationId,
          mode: 'receive',
          reason: $('#receive-reason').value.trim() || 'Réception marchandises',
          scope: { shopId: shop.id, branchId: shop.branchId, staffId: shop.staffId },
          lines: queue.map(function (line) { return { itemId: line.itemId, quantity: line.quantity }; })
        })
      });
      var id = prepared.operationId;
      if (!id) throw new Error('Le serveur n’a pas préparé le mouvement de stock.');
      $('#receive-status').textContent = 'Vérification des autorisations et application du stock…';
      var result = await request('/mobile/v1/inventory/operations/' + encodeURIComponent(id) + '/confirm', { method: 'POST', body: JSON.stringify({}) });
      if (result.state === 'complete') {
        queue = [];
        renderQueue();
        $('#receive-status').textContent = 'Réception enregistrée. Le stock POSNIC et son historique ont été mis à jour.';
        toast('Stock synchronisé avec POSNIC');
        await loadCatalogue($('#lookup-query').value.trim());
      } else if (result.approvalRequired || result.state === 'prepared') {
        $('#receive-status').textContent = 'Opération préparée. Une validation manager est requise avant la mise à jour du stock.';
      } else if (result.state === 'conflict') {
        $('#receive-status').textContent = 'Conflit de stock : actualisez les quantités dans POSNIC puis préparez une nouvelle réception.';
      } else {
        $('#receive-status').textContent = 'État de réception : ' + String(result.state || 'inconnu');
      }
      await loadPendingOperations();
    } catch (error) {
      $('#receive-status').textContent = error.message;
      if (/manager|approv|validation/i.test(error.message)) await loadPendingOperations();
    } finally {
      button.disabled = !queue.length;
    }
  }

  async function loadPendingOperations() {
    var host = $('#pending-operations');
    var list = $('#pending-operation-list');
    if (!host || !list || !token) return;
    try {
      var data = await request('/mobile/v1/inventory/operations');
      var rows = (data.rows || []).filter(function (operation) {
        return operation.state === 'prepared' || operation.state === 'conflict';
      });
      list.innerHTML = '';
      host.hidden = !rows.length;
      rows.forEach(function (operation) {
        var card = document.createElement('div');
        card.className = 'pending-operation';
        var title = document.createElement('strong');
        title.textContent = (operation.mode === 'receive' ? 'Réception' : 'Mouvement stock') + ' · ' + operation.lines.length + ' ligne(s)';
        var detail = document.createElement('small');
        detail.textContent = operation.reason + ' · ' + (operation.state === 'conflict' ? 'Conflit à examiner' : 'En attente');
        var action = document.createElement('button');
        action.type = 'button';
        action.className = 'primary';
        action.textContent = operation.state === 'conflict' ? 'Réexaminer' : 'Confirmer le mouvement';
        action.disabled = operation.state === 'conflict';
        action.addEventListener('click', async function () {
          action.disabled = true;
          action.textContent = 'Validation…';
          try {
            var result = await request('/mobile/v1/inventory/operations/' + encodeURIComponent(operation.operationId) + '/confirm', { method: 'POST', body: JSON.stringify({}) });
            if (result.state === 'complete') {
              toast('Mouvement de stock confirmé');
              $('#receive-status').textContent = 'Le responsable a confirmé le mouvement. Le stock POSNIC est à jour.';
              await loadCatalogue($('#lookup-query').value.trim());
            } else {
              $('#receive-status').textContent = 'État du mouvement : ' + String(result.state || 'inconnu');
            }
          } catch (error) {
            $('#receive-status').textContent = error.message;
          } finally {
            await loadPendingOperations();
          }
        });
        card.append(title, detail, action);
        list.append(card);
      });
    } catch (error) {
      host.hidden = true;
    }
  }

  async function compressPhoto(file) {
    var bitmap = await createImageBitmap(file);
    var scale = Math.min(1, 900 / bitmap.width);
    var canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    var blob = await new Promise(function (resolve) { canvas.toBlob(resolve, 'image/jpeg', 0.82); });
    if (!blob) throw new Error('Impossible de compresser la photo.');
    var data = await new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () { resolve(String(reader.result).split(',')[1]); };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
    return { name: 'mobile-' + Date.now() + '.jpg', size: blob.size, cover: 'yes', data: data };
  }

  async function openItemEditor(id) {
    activate('manage');
    $('#manage-error').textContent = '';
    $('#manage-form').hidden = true;
    try {
      var response = await request('/items/' + encodeURIComponent(id));
      var item = response.data || response.item || response;
      if (!item || !(item._id || item.id)) throw new Error(messageOf(response, 'Article introuvable.'));
      window.posnicEditingItem = item;
      $('#manage-id').value = String(item._id || item.id);
      $('#manage-name').value = item.name || item.item_name || '';
      $('#manage-price').value = Number(item.selling_price || 0);
      $('#manage-barcode').value = item.barcode_id || '';
      $('#manage-sku').value = item.sku || item.item_code || '';
      $('#manage-photo').value = '';
      $('#manage-remove-photo').checked = false;
      $('#manage-current-photo').textContent = item.image ? 'Photo actuelle enregistrée · ' + String(item.image).split('/').pop() : 'Aucune photo enregistrée.';
      $('#manage-form').hidden = false;
      $('#manage-name').focus();
    } catch (error) {
      $('#manage-error').textContent = error.message;
      $('#manage-form').hidden = false;
    }
  }

  async function saveItemEdits(event) {
    event.preventDefault();
    var original = window.posnicEditingItem;
    if (!original) return;
    var button = $('#manage-form').querySelector('button[type="submit"]');
    var payload = Object.assign({}, original, {
      name: $('#manage-name').value.trim(),
      selling_price: Number($('#manage-price').value || 0),
      barcode_id: $('#manage-barcode').value.trim(),
      sku: $('#manage-sku').value.trim()
    });
    var photo = $('#manage-photo').files[0];
    button.disabled = true;
    $('#manage-error').textContent = '';
    try {
      if (photo) {
        var uploaded = await request('/items/uploadItemMultiImage', {
          method: 'POST',
          body: JSON.stringify({ items_image: [await compressPhoto(photo)] })
        });
        var list = uploaded.data && (uploaded.data.data || uploaded.data) || [];
        if (!Array.isArray(list) || !list[0] || !list[0].name) throw new Error('La photo n’a pas été enregistrée.');
        payload.image = list[0].name;
      } else if ($('#manage-remove-photo').checked) {
        payload.image = '';
      }
      var result = await request('/items/' + encodeURIComponent($('#manage-id').value), {
        method: 'PUT',
        body: JSON.stringify(payload)
      });
      if (result.type === 'error' || result.success === false) throw new Error(messageOf(result, 'Modification impossible.'));
      window.posnicEditingItem = null;
      $('#manage-form').reset();
      $('#manage-form').hidden = true;
      await loadCatalogue(payload.name, $('#manage-results'), true);
      toast('Article et photo synchronisés avec POSNIC');
    } catch (error) {
      $('#manage-error').textContent = error.message;
    } finally {
      button.disabled = false;
    }
  }

  async function createItem(event) {
    event.preventDefault();
    var form = event.currentTarget;
    var button = form.querySelector('button[type="submit"]');
    var values = Object.fromEntries(new FormData(form).entries());
    var photo = $('#new-item-photo').files[0];
    var tracked = form.elements.track_inventory.checked;
    delete values.photo;
    delete values.track_inventory;
    values.name = String(values.name || '').trim();
    values.selling_price = Number(values.selling_price || 0);
    values.barcode_id = String(values.barcode_id || '').trim();
    values.sku = String(values.sku || '').trim();
    values.track_inventory = tracked;
    values.quantity = 0;
    values.available_quantity = 0;
    values.branch_id = shop && shop.branchId;
    button.disabled = true;
    $('#create-error').textContent = '';
    try {
      if (photo) {
        var uploaded = await request('/items/uploadItemMultiImage', { method: 'POST', body: JSON.stringify({ items_image: [await compressPhoto(photo)] }) });
        var list = uploaded.data && (uploaded.data.data || uploaded.data) || [];
        if (Array.isArray(list) && list[0] && list[0].name) values.image = list[0].name;
      }
      var result = await request('/items', { method: 'POST', body: JSON.stringify(values) });
      if (result.type === 'error' || result.success === false) throw new Error(messageOf(result, 'Création impossible.'));
      form.reset();
      form.elements.track_inventory.checked = true;
      activate('scan');
      $('#lookup-query').value = values.name;
      await loadCatalogue(values.name);
      toast('Article enregistré dans POSNIC');
    } catch (error) {
      $('#create-error').textContent = error.message;
    } finally {
      button.disabled = false;
    }
  }

  function stopCamera() {
    if (cameraFrame) cancelAnimationFrame(cameraFrame);
    cameraFrame = 0;
    if (cameraStream) cameraStream.getTracks().forEach(function (track) { track.stop(); });
    cameraStream = null;
    $('#camera-video').srcObject = null;
    $('#camera-layer').hidden = true;
    scanBusy = false;
  }

  function handleScannedValue(value) {
    if (!value || scanBusy) return;
    scanBusy = true;
    var text = String(value).trim();
    try {
      var payload = JSON.parse(text);
      if (payload && payload.server && payload.code) {
        stopCamera();
        $('#server-url').value = payload.server;
        $('#pair-code').value = payload.code;
        pair(payload.code, payload.server).catch(function (error) { $('#connect-error').textContent = error.message; });
        return;
      }
    } catch (_) {}
    stopCamera();
    if (activeTab === 'receive') {
      $('#receive-code').value = text;
      resolveReceiveCode(text).catch(function (error) { $('#receive-status').textContent = error.message; });
    } else {
      $('#lookup-query').value = text;
      loadCatalogue(text);
    }
  }

  async function openCamera() {
    $('#camera-layer').hidden = false;
    $('#camera-hint').textContent = 'Initialisation de la caméra…';
    if (!('BarcodeDetector' in window) || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      $('#camera-hint').textContent = 'La lecture caméra n’est pas disponible dans ce navigateur ou cette connexion HTTP. Utilisez le code manuel ou choisissez une photo.';
      return;
    }
    try {
      detector = new BarcodeDetector({ formats: ['qr_code', 'ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'itf'] });
      cameraStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
      var video = $('#camera-video');
      video.srcObject = cameraStream;
      await video.play();
      $('#camera-hint').textContent = 'Pointez vers le QR de jumelage ou le code-barres du produit.';
      var scan = async function () {
        if (!cameraStream || scanBusy) return;
        try {
          var codes = await detector.detect(video);
          if (codes && codes.length) { handleScannedValue(codes[0].rawValue); return; }
        } catch (_) {}
        cameraFrame = requestAnimationFrame(scan);
      };
      scan();
    } catch (error) {
      $('#camera-hint').textContent = 'Caméra inaccessible. Autorisez la caméra ou utilisez la saisie manuelle.';
    }
  }

  async function decodeImage(file) {
    if (!file) return;
    if (!('BarcodeDetector' in window)) { toast('Lecture d’image non prise en charge. Saisissez le code manuellement.'); return; }
    try {
      var image = await createImageBitmap(file);
      var codes = await new BarcodeDetector({ formats: ['qr_code', 'ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'itf'] }).detect(image);
      if (codes.length) handleScannedValue(codes[0].rawValue);
      else toast('Aucun code détecté dans cette image.');
    } catch (error) { toast('Impossible de lire cette image.'); }
  }

  $('#pair-form').addEventListener('submit', function (event) {
    event.preventDefault();
    var button = event.submitter;
    button.disabled = true;
    $('#connect-error').textContent = '';
    pair($('#pair-code').value, $('#server-url').value).catch(function (error) { $('#connect-error').textContent = error.message; }).finally(function () { button.disabled = false; });
  });
  $('#server-url').value = apiBase;
  $('#open-camera').addEventListener('click', openCamera);
  $('#scan-lookup').addEventListener('click', openCamera);
  $('#scan-receive').addEventListener('click', openCamera);
  $('#close-camera').addEventListener('click', stopCamera);
  $('#camera-image').addEventListener('change', function (event) { decodeImage(event.target.files && event.target.files[0]); event.target.value = ''; });
  $('#logout').addEventListener('click', function () {
    token = ''; shop = null; queue = [];
    localStorage.removeItem('posnic_companion_token');
    $('#workspace').hidden = true; $('#connect-screen').hidden = false; $('#logout').hidden = true;
    $('#connect-error').textContent = 'Téléphone déconnecté. Le jumelage peut être révoqué depuis POSNIC sur l’ordinateur.';
    setConnected(false); renderQueue();
  });
  document.querySelectorAll('.tab').forEach(function (button) { button.addEventListener('click', function () { activate(button.dataset.tab); }); });
  $('#lookup-form').addEventListener('submit', function (event) { event.preventDefault(); loadCatalogue($('#lookup-query').value.trim()); });
  $('#refresh-catalogue').addEventListener('click', function () { loadCatalogue($('#lookup-query').value.trim()); });
  $('#receive-form').addEventListener('submit', function (event) {
    event.preventDefault();
    var code = $('#receive-code').value.trim();
    if (!code) return;
    resolveReceiveCode(code).then(function () { $('#receive-code').value = ''; }).catch(function (error) { $('#receive-status').textContent = error.message; });
  });
  $('#clear-queue').addEventListener('click', function () { queue = []; renderQueue(); $('#receive-status').textContent = ''; });
  $('#apply-receive').addEventListener('click', applyReceive);
  $('#create-form').addEventListener('submit', createItem);
  $('#manage-search-form').addEventListener('submit', function (event) {
    event.preventDefault();
    loadCatalogue($('#manage-query').value.trim(), $('#manage-results'), true);
  });
  $('#manage-form').addEventListener('submit', saveItemEdits);
  $('#manage-cancel').addEventListener('click', function () {
    window.posnicEditingItem = null;
    $('#manage-form').hidden = true;
  });
  window.addEventListener('online', function () {
    if (token) restoreSession();
  });
  window.addEventListener('offline', function () { setConnected(false); });
  window.addEventListener('beforeunload', stopCamera);

  if ('serviceWorker' in navigator && window.isSecureContext) {
    window.addEventListener('load', function () { navigator.serviceWorker.register('/mobile/sw.js').catch(function () {}); });
  }
  try {
    var savedQueue = JSON.parse(localStorage.getItem('posnic_companion_receive_queue') || '[]');
    if (Array.isArray(savedQueue)) queue = savedQueue.filter(function (line) {
      return line && typeof line.itemId === 'string' && Number.isSafeInteger(line.quantity) && line.quantity > 0;
    });
  } catch (_) { queue = []; }
  renderQueue();
  // The Web Companion QR opens this page with a short-lived pairing grant.
  // The browser lands here already holding the correct LAN/cloud API address.
  var launchParams = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  var launchServer = launchParams.get('server');
  var launchCode = launchParams.get('code');
  if (launchServer && launchCode && !token) {
    $('#server-url').value = launchServer;
    $('#pair-code').value = launchCode;
    pair(launchCode, launchServer).catch(function (error) {
      $('#connect-error').textContent = error.message;
    }).finally(function () {
      window.history.replaceState({}, document.title, window.location.pathname);
    });
  } else {
    restoreSession();
  }
})();