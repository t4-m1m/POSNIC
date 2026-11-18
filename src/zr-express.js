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
      const message = data.message || data.title || data.detail || ('ZR Express returned HTTP ' + response.status);
      throw new Error(String(message).slice(0, 500));
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

async function createParcel(credentials, input) {
  const auth = credentialsOf(credentials);
  const parcel = input || {};
  const items = Array.isArray(parcel.items) ? parcel.items : [];
  const customerName = String(parcel.customerName || '').trim();
  const phone = intlPhone(parcel.phone);
  if (!customerName || !phone || !parcel.cityTerritoryId || !parcel.districtTerritoryId || !parcel.sourceHubId || !items.length) {
    throw new Error('Customer, phone, wilaya, commune, source hub and at least one item are required.');
  }
  const productDescription = String(parcel.description || items.map(item => item.name + ' x' + item.quantity).join(', ')).slice(0, 250);
  const orderedProducts = items.map(item => ({
    productName: String(item.name || 'Article').slice(0, 200),
    unitPrice: Number(item.unitPrice || 0),
    quantity: Math.max(1, Number(item.quantity || 1)),
    stockType: 'none'
  }));
  const totalCod = Number(parcel.codTotal);
  if (!Number.isFinite(totalCod) || totalCod < 0 || totalCod > 150000) throw new Error('COD amount must be between 0 and 150,000 DZD.');
  const body = {
    hubId: String(parcel.sourceHubId),
    customer: {
      customerId: require('crypto').randomUUID(),
      name: customerName,
      phone: { number1: phone, number2: intlPhone(parcel.phoneAlt) }
    },
    deliveryAddress: {
      cityTerritoryId: String(parcel.cityTerritoryId),
      districtTerritoryId: String(parcel.districtTerritoryId),
      street: String(parcel.address || '').slice(0, 500) || null
    },
    orderedProducts,
    deliveryType: parcel.deliveryType === 'pickup-point' ? 'pickup-point' : 'home',
    description: productDescription,
    amount: totalCod,
    externalId: String(parcel.externalId || ('POSNIC-' + Date.now())).slice(0, 100)
  };
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
}

module.exports = { register, getCatalog, getCommunes, createParcel, getParcel };
