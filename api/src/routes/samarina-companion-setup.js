'use strict';
const $ = (id) => document.getElementById(id);
let csrf = '';
async function request(url, options) {
  const response = await fetch(url, Object.assign({ credentials: 'same-origin', cache: 'no-store' }, options || {}, {
    headers: Object.assign({ 'Content-Type': 'application/json', 'X-XSRF-TOKEN': csrf }, options?.headers || {})
  }));
  csrf = response.headers.get('X-CSRF-TOKEN') || csrf;
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error?.message || data.message || 'Erreur de connexion.');
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
  const data = await request('/api/samarina/v1/setup/status?branch_id='+encodeURIComponent(new URLSearchParams(location.search).get('branch_id')||''));
  $('branch').textContent = data.branch;
  if (!data.canPair) { $('generate').disabled = true; $('status').textContent = 'Seul un propriétaire ou administrateur peut jumeler un téléphone.'; }
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
