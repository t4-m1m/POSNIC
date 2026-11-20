'use strict';
const $ = (id) => document.getElementById(id);
let csrf = '';
const branchId = new URLSearchParams(location.search).get('branch_id') || '';
const statusUrl = '/api/samarina/v1/setup/status?branch_id=' + encodeURIComponent(branchId);
async function request(url, options, retryCsrf) {
  const opts = options || {};
  const method = String(opts.method || 'GET').toUpperCase();
  if (!['GET', 'HEAD', 'OPTIONS'].includes(method) && !csrf && retryCsrf !== false) {
    await request(statusUrl, null, false);
  }
  const headers = Object.assign({ 'Content-Type': 'application/json' }, opts.headers || {});
  if (csrf && !['GET', 'HEAD', 'OPTIONS'].includes(method)) headers['X-XSRF-TOKEN'] = csrf;
  const response = await fetch(url, Object.assign({ credentials: 'same-origin', cache: 'no-store' }, opts, { headers }));
  csrf = response.headers.get('X-CSRF-TOKEN') || csrf;
  const data = await response.json().catch(() => ({}));
  const message = data.error?.message || data.message || '';
  if (!response.ok) {
    if (response.status === 403 && retryCsrf !== false && /security token is missing or expired/i.test(message)) {
      await request(statusUrl, null, false);
      return request(url, opts, false);
    }
    throw new Error(message || 'Erreur de connexion.');
  }
  return data;
}
function renderQr(rows) {
  const host = $('qr-list'); host.replaceChildren();
  if (!rows.length) { host.textContent = 'Aucune adresse réseau disponible. Vérifiez que le PC est connecté au Wi-Fi ou au réseau local.'; return; }
  rows.forEach((row) => {
    const card = document.createElement('article'); card.className = 'qr-card';
    const img = document.createElement('img'); img.src = row.qr; img.alt = 'QR code Samarina Companion';
    const strong = document.createElement('strong'); strong.textContent = 'Ouvrir sur le téléphone';
    const small = document.createElement('small'); small.textContent = row.url + (row.protocol === 'https' ? ' · HTTPS sécurisé' : ' · HTTP (photo / saisie manuelle)');
    card.append(img, strong, small);
    if (row.certificateUrl) {
      const cert = document.createElement('a'); cert.href = row.certificateUrl; cert.textContent = 'Télécharger le certificat pour faire confiance au PC'; cert.className = 'certificate-link';
      card.append(cert);
    }
    host.append(card);
  });
}
async function init() {
  $('generate').disabled = true;
  const data = await request(statusUrl);
  $('branch').textContent = data.branch;
  if (!data.canPair) { $('generate').disabled = true; $('status').textContent = 'Seul un propriétaire ou administrateur peut jumeler un téléphone.'; }
  else $('generate').disabled = false;
}
$('generate').addEventListener('click', async () => {
  const button = $('generate'); button.disabled = true; $('status').textContent = 'Création du QR code…';
  try {
    const data = await request('/api/samarina/v1/setup/pairing-code', { method: 'POST', body: JSON.stringify({ branch_id: new URLSearchParams(location.search).get('branch_id') || '' }) });
    $('code').textContent = data.code; $('expiry').textContent = 'Expire à ' + new Date(data.expiresAt).toLocaleTimeString();
    renderQr(data.pairingQr || []); $('trust-instructions').hidden = !(data.pairingQr || []).some(row => row.protocol === 'https'); $('status').textContent = 'Scannez un QR HTTPS après avoir installé le certificat sur le téléphone. Le code de jumelage ne fonctionne qu’une seule fois.';
  } catch (error) { $('status').textContent = error.message; }
  finally { button.disabled = false; }
});
init().catch((error) => { $('status').textContent = error.message; });
