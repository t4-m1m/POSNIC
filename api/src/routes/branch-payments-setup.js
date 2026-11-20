'use strict';
const $ = id => document.getElementById(id);
let csrf = '', state = {};
async function call(body) {
  const response = await fetch('/api/branch-payments', {
    credentials: 'same-origin', cache: 'no-store',
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json', 'X-XSRF-TOKEN': csrf },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  csrf = response.headers.get('X-CSRF-TOKEN') || csrf;
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error?.message || data.message || 'Impossible de charger les comptes de paiement.');
  return data;
}
function account(row) {
  const box = document.createElement('div'); box.className = 'account'; box.dataset.id = row.id || (crypto.randomUUID ? crypto.randomUUID() : 'upi-'+Date.now()+'-'+Math.random().toString(36).slice(2));
  const name = document.createElement('input'); name.className = 'name'; name.required = true; name.maxLength = 80; name.placeholder = 'Nom du compte'; name.value = row.name || '';
  const vpa = document.createElement('input'); vpa.className = 'vpa'; vpa.required = true; vpa.placeholder = 'Identifiant UPI'; vpa.value = row.vpa || '';
  const label = document.createElement('label'), radio = document.createElement('input'); radio.type = 'radio'; radio.name = 'default'; radio.checked = row.id === state.defaultUpiAccountId || !$('accounts').children.length; label.append(radio, ' Par défaut');
  const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = 'Supprimer'; remove.onclick = () => { box.remove(); const first = document.querySelector('input[name=default]'); if (first && !document.querySelector('input[name=default]:checked')) first.checked = true; };
  box.append(name,vpa,label,remove); $('accounts').append(box);
}
async function init() {
  state = await call(); $('branch').textContent = state.branch || 'Magasin actif';
  (state.upiAccounts || []).forEach(account);
}
$('add').onclick = () => account({});
$('settings').addEventListener('submit', async event => {
  event.preventDefault();
  try {
    const rows = [...document.querySelectorAll('.account')];
    await call({
      upiAccounts: rows.map(row => ({ id: row.dataset.id, name: row.querySelector('.name').value.trim(), vpa: row.querySelector('.vpa').value.trim() })),
      defaultUpiAccountId: rows.find(row => row.querySelector('input[type=radio]').checked)?.dataset.id || ''
    });
    $('message').textContent = 'Comptes de paiement enregistrés.';
  } catch (error) { $('message').textContent = error.message; }
});
init().catch(error => $('message').textContent = error.message);
