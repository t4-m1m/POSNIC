'use strict';

const fs = require('fs').promises;
const path = require('path');
const BASE_URL = 'https://api.zrexpress.app/api/v1';
const REQUEST_TIMEOUT_MS = 20000;

function credentialsOf(value) {
  const tenantId = String(value && (value.tenantId || value.tenant_id) || '').trim();
  const apiKey = String(value && (value.apiKey || value.api_key) || '').trim();
  if (!tenantId || !apiKey) throw new Error('ZR Express Tenant ID and API Key must be configured in Settings.');
  return { tenantId, apiKey };
}

async function request(credentials, method, path, body) {
  const auth = credentialsOf(credentials);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(BASE_URL + '/' + String(path).replace(/^\/+/, ''), {
      method,
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        'X-Tenant': auth.tenantId,
        'X-Api-Key': auth.apiKey
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: controller.signal
    });
    const text = await response.text();
    let data = {};
    try { data = text ? JSON.parse(text) : {}; } catch (_) { data = { message: text.slice(0, 500) }; }
    if (!response.ok) {
      const validation = Array.isArray(data.errors) ? data.errors.map(function (item) {
        return [item.field || item.property || '', item.message || item.error || item.code || 'Invalid value'].filter(Boolean).join(': ');
      }).filter(Boolean).join('; ') : '';
      const message = validation || data.message || data.title || data.detail || ('ZR Express returned HTTP ' + response.status);
      throw new Error(String(message).slice(0, 700));
    }
    return data;
  } finally {
    clearTimeout(timer);
  }
}

async function searchAll(credentials, path, baseBody) {
  const all = [];
  let pageNumber = 1;
  for (let page = 0; page < 30; page += 1) {
    const result = await request(credentials, 'POST', path, { ...baseBody, pageNumber });
    const rows = Array.isArray(result.items) ? result.items : Array.isArray(result.data) ? result.data : [];
    all.push(...rows);
    if (!result.hasNext || rows.length === 0) break;
    pageNumber += 1;
  }
  return all;
}

async function getCatalog(credentials) {
  const [wilayas, rates, hubs] = await Promise.all([
    searchAll(credentials, 'territories/search', {
      pageSize: 1000,
      orderBy: ['code asc'],
      advancedFilter: { logic: 'and', filters: [{ field: 'level', operator: 'eq', value: 'wilaya' }] }
    }),
    request(credentials, 'GET', 'delivery-pricing/rates'),
    searchAll(credentials, 'hubs/search', { pageSize: 1000, includeServices: false })
  ]);
  const territories = wilayas.map(item => ({
    id: item.id,
    code: Number(item.code || 0),
    name: String(item.name || ''),
    nameArabic: item.nameArabic || '',
    hasHomeDelivery: !!(item.delivery && (item.delivery.hasHomeDelivery === true || item.delivery.hasHomeDelivery === 1)),
    hasPickupPoint: !!(item.delivery && (item.delivery.hasPickupPoint === true || item.delivery.hasPickupPoint === 1))
  })).filter(item => item.id && item.code >= 1 && item.code <= 58);
  const offices = hubs.map(hub => ({
    id: hub.id,
    name: String(hub.name || ''),
    isPickupPoint: hub.isPickupPoint === true || hub.isPickupPoint === 1,
    cityTerritoryId: hub.address && hub.address.cityTerritoryId || null,
    districtTerritoryId: hub.address && hub.address.districtTerritoryId || null,
    city: hub.address && hub.address.city || '',
    commune: hub.address && hub.address.district || '',
    address: hub.address && hub.address.street || ''
  }));
  return { wilayas: territories, rates: Array.isArray(rates.rates) ? rates.rates : [], hubs: offices };
}

async function getCommunes(credentials, wilayaUuid) {
  if (!wilayaUuid) throw new Error('Select a wilaya first.');
  const rows = await searchAll(credentials, 'territories/search', {
    pageSize: 1000,
    orderBy: ['code asc'],
    advancedFilter: { logic: 'and', filters: [
      { field: 'level', operator: 'eq', value: 'commune' },
      { field: 'parentId', operator: 'eq', value: wilayaUuid }
    ] }
  });
  return rows.map(item => ({ id: item.id, code: Number(item.code || 0), name: String(item.name || ''), nameArabic: item.nameArabic || '' }));
}

async function readyState(credentials) {
  const workflows = await request(credentials, 'POST', 'workflows/search', { pageNumber: 1, pageSize: 100 });
  const items = Array.isArray(workflows.items) ? workflows.items : Array.isArray(workflows.data) ? workflows.data : [];
  const states = items.flatMap(item => item.states || item.workflowStates || [item]);
  const ready = states.find(item => String(item.name || '').toLowerCase().replace(/[\s_-]/g, '') === 'readytodispatch');
  return ready && ready.id || undefined;
}

function intlPhone(value) {
  let digits = String(value || '').replace(/[^\d+]/g, '');
  if (!digits) return null;
  if (digits.startsWith('+')) return digits;
  digits = digits.replace(/\D/g, '');
  if (digits.startsWith('00213')) return '+' + digits.slice(2);
  if (digits.startsWith('213')) return '+' + digits;
  if (digits.startsWith('0')) return '+213' + digits.slice(1);
  if (digits.length === 9) return '+213' + digits;
  return '+' + digits;
}

async function resolveCustomer(auth, parcel, phone) {
  const rows = await searchAll(auth, 'customers/search', { pageSize: 100, keyword: phone, includeAllAddresses: true });
  const digits = phone.replace(/\\D/g, '');
  const match = rows.find(item => {
    const p = item.phone || {};
    return [p.number1, p.number2, item.phoneNumber, item.phone].some(value => String(value || '').replace(/\\D/g, '') === digits);
  }) || rows.find(item => String(item.name || '').trim().toLowerCase() === String(parcel.customerName || '').trim().toLowerCase());
  if (match && match.id) return String(match.id);
  const created = await request(auth, 'POST', 'customers/individual', {
    name: String(parcel.customerName || '').trim(),
    phone: { number1: phone, number2: intlPhone(parcel.phoneAlt) },
    addresses: [{
      street: String(parcel.address || '').slice(0, 500),
      cityTerritoryId: String(parcel.cityTerritoryId),
      districtTerritoryId: String(parcel.districtTerritoryId),
      isPrimary: true
    }]
  });
  const customerId = created && (created.id || created.customerId || created.customer && created.customer.id);
  if (!customerId) throw new Error('ZR Express did not return the new customer ID.');
  return String(customerId);
}

async function resolveProduct(auth, item) {
  const name = String(item.name || 'Article').trim().slice(0, 200) || 'Article';
  const sku = 'POSNIC-' + require('crypto').createHash('sha1').update(name.toLowerCase()).digest('hex').slice(0, 12).toUpperCase();
  const rows = await searchAll(auth, 'products/search', { pageSize: 100, keyword: sku });
  let product = rows.find(row => String(row.sku || row.productSku || '').toUpperCase() === sku);
  if (!product) {
    const created = await request(auth, 'POST', 'products', { name, sku, localStock: 0, basePrice: Math.max(0, Number(item.unitPrice) || 0) });
    product = created && (created.product || created);
  }
  const productId = product && (product.id || product.productId);
  const productSku = product && (product.sku || product.productSku) || sku;
  if (!productId) throw new Error('ZR Express could not create or resolve a catalog product for "' + name + '". Check Products permissions in your ZR account.');
  return { productId: String(productId), productSku: String(productSku), productName: name };
}

async function createParcel(credentials, input) {
  const auth = credentialsOf(credentials);
  const parcel = input || {};
  const items = Array.isArray(parcel.items) ? parcel.items : [];
  const customerName = String(parcel.customerName || '').trim();
  const phone = intlPhone(parcel.phone);
  const deliveryType = parcel.deliveryType === 'pickup-point' ? 'pickup-point' : 'home';
  if (!customerName || !phone || !parcel.cityTerritoryId || !parcel.districtTerritoryId || !items.length) {
    throw new Error('Customer, valid phone, wilaya, commune and at least one item are required.');
  }
  if (deliveryType === 'pickup-point' && !parcel.sourceHubId) throw new Error('Select a ZR Express pickup point for bureau delivery.');
  const totalCod = Number(parcel.codTotal);
  if (!Number.isFinite(totalCod) || totalCod < 0 || totalCod > 150000) throw new Error('COD amount must be between 0 and 150,000 DZD.');
  const customerId = await resolveCustomer(auth, parcel, phone);
  const orderedProducts = [];
  for (const item of items) {
    const resolved = await resolveProduct(auth, item);
    const quantity = Number(item.quantity || 1);
    const unitPrice = Number(item.unitPrice || 0);
    if (!Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(unitPrice) || unitPrice < 0) {
      throw new Error('Invalid quantity or unit price for "' + resolved.productName + '".');
    }
    orderedProducts.push({
      productId: resolved.productId,
      productSku: resolved.productSku,
      productName: resolved.productName,
      unitPrice,
      quantity,
      stockType: 'none'
    });
  }
  const productDescription = String(parcel.description || items.map(item => item.name + ' x' + item.quantity).join(', ')).slice(0, 250);
  const body = {
    customer: {
      customerId,
      name: customerName,
      phone: { number1: phone, number2: intlPhone(parcel.phoneAlt) }
    },
    deliveryAddress: {
      cityTerritoryId: String(parcel.cityTerritoryId),
      districtTerritoryId: String(parcel.districtTerritoryId),
      street: String(parcel.address || '').slice(0, 500)
    },
    orderedProducts,
    deliveryType,
    description: productDescription,
    amount: totalCod,
    weight: { weight: 1 },
    externalId: String(parcel.externalId || ('POSNIC-' + Date.now())).slice(0, 100)
  };
  if (deliveryType === 'pickup-point') body.hubId = String(parcel.sourceHubId);
  let stateId;
  try { stateId = await readyState(auth); } catch (error) { console.warn('[ZR Express] workflow lookup:', error.message); }
  if (stateId) body.stateId = stateId;
  const created = await request(auth, 'POST', 'parcels', body);
  if (!created || !created.id) throw new Error('ZR Express did not return a parcel ID.');
  const details = await request(auth, 'GET', 'parcels/' + encodeURIComponent(created.id));
  const trackingNumber = details.trackingNumber || details.tracking_number || details.tracking || created.trackingNumber || '';
  if (!trackingNumber) throw new Error('Parcel created, but ZR Express did not return a tracking number. Parcel ID: ' + created.id);
  return { id: created.id, trackingNumber, status: details.state && details.state.name || 'OrderReceived', raw: details };
}

async function cancelParcel(credentials, parcelId) { const value=String(parcelId||'').trim(); if(!value) throw new Error('Parcel ID is required.'); return request(credentials,'DELETE','parcels/'+encodeURIComponent(value)); }

async function getParcel(credentials, tracking) {
  const value = String(tracking || '').trim();
  if (!value) throw new Error('Tracking number is required.');
  return request(credentials, 'GET', 'parcels/' + encodeURIComponent(value));
}

function register({ ipcMain, getWindow, BrowserWindow, dialog, app, safeStorage }) {
  const credentialFile = path.join(app.getPath('userData'), 'zr-express-credentials.enc');
  async function saveCredentials(credentials) {
    const auth = credentialsOf(credentials);
    if (!safeStorage || !safeStorage.isEncryptionAvailable()) throw new Error('Secure credential storage is unavailable.');
    await fs.writeFile(credentialFile, safeStorage.encryptString(JSON.stringify(auth)), { mode: 0o600 });
    return { saved: true };
  }
  async function readCredentials() {
    try { if (!safeStorage || !safeStorage.isEncryptionAvailable()) return null; return JSON.parse(safeStorage.decryptString(await fs.readFile(credentialFile))); }
    catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  }

  ipcMain.handle('zr:catalog', async (_event, credentials) => getCatalog(credentials));
  ipcMain.handle('zr:credentials-save', async (_event, credentials) => saveCredentials(credentials));
  ipcMain.handle('zr:credentials-get', async () => readCredentials());
  ipcMain.handle('zr:communes', async (_event, credentials, wilayaUuid) => getCommunes(credentials, wilayaUuid));
  ipcMain.handle('zr:createParcel', async (_event, credentials, parcel) => createParcel(credentials, parcel));
  ipcMain.handle('zr:getParcel', async (_event, credentials, tracking) => getParcel(credentials, tracking));
  ipcMain.handle('zr:cancelParcel', async (_event, credentials, parcelId) => cancelParcel(credentials, parcelId));
  ipcMain.handle('zr:save-bordereau', async (_event, html) => {
    if (typeof html !== 'string' || !html.includes('<html') || html.length > 200000) throw new Error('Invalid bordereau document.');
    const owner = getWindow && getWindow();
    const choice = await dialog.showSaveDialog(owner || undefined, { title:'Enregistrer le bordereau ZR Express', defaultPath:'Bordereau-ZR-Express.pdf', filters:[{name:'PDF',extensions:['pdf']}] });
    if (choice.canceled || !choice.filePath) return { saved:false };
    const win = new BrowserWindow({ show:false, width:480, height:720, webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false} });
    try {
      await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
      const pdf = await win.webContents.printToPDF({printBackground:true,pageSize:{width:100000,height:150000},margins:{top:0,bottom:0,left:0,right:0}});
      await fs.writeFile(choice.filePath,pdf);
      return {saved:true,filePath:choice.filePath};
    } finally { if (!win.isDestroyed()) win.destroy(); }
  });
}

module.exports = { register, getCatalog, getCommunes, createParcel, getParcel, cancelParcel };
