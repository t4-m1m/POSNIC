// SamarinaPOS V2 navigation contract. Settings is pinned in the rail footer.
export const modules = [
  { id: 'caisse', icon: 'terminal', label: 'Caisse', tabs: ['Vente', 'Historique des ventes'] },
  { id: 'catalogue', icon: 'boxes', label: 'Catalogue & Stock', tabs: ['Catalogue Produits', 'Journal d’Inventaire', 'Alertes Stock Faible', 'Designer d’Étiquettes', 'Tableau de bord Catalogue'] },
  { id: 'achats', icon: 'truck', label: 'Achats', tabs: ['Nouvelle Réception / Facture', 'Historique des Achats'] },
  { id: 'clients', icon: 'users', label: 'Clients & Crédits', tabs: ['Répertoire Clients', 'Suivi Crédits & Dettes', 'Règlements TPE / BaridiMob', 'Versements'] },
  { id: 'zr-express', icon: 'route', label: 'ZR Express', tabs: ['Colis & Expéditions', 'Créer un Colis'] },
  { id: 'rapports', icon: 'chart', label: 'Rapports & Clôture', tabs: ['Clôture de caisse · Ticket Studio', 'Tableau de bord & statistiques', 'Zakat'] },
  { id: 'rh', icon: 'users', label: 'RH & Salaires', tabs: ['Employés & Paie'] },
  { id: 'parametres', icon: 'sliders', label: 'Paramètres', tabs: ['Boutique & Général', 'Imprimantes & Ticket Studio', 'WhatsApp & Notifications', 'ZR Express API', 'Vendeurs & Utilisateurs', 'Mises à jour'] }
];
export const isAdminRole = user => {
  const candidates = [], queue = [{ value: user, depth: 0 }], seen = new Set();
  while (queue.length) {
    const entry = queue.shift(), value = entry?.value;
    if (!value || typeof value !== 'object' || seen.has(value) || entry.depth > 5) continue;
    seen.add(value); candidates.push(value);
    for (const key of ['user','data','profile','account','currentUser','current_user','auth','session']) if (value[key] && typeof value[key] === 'object') queue.push({ value: value[key], depth: entry.depth + 1 });
  }
  const roleKeys = ['usertype','role','role_name','roleName','user_type','userType','type','account_type','accountType','access_role','user_role','userRole','role_label','roleLabel','designation'];
  const roles = [];
  for (const candidate of candidates) for (const key of roleKeys) {
    const value = candidate?.[key];
    if (value && typeof value === 'object') for (const nested of [value.name,value.label,value.role,value.usertype,value.key,value.type,value.title,value.slug]) if (nested != null) roles.push(nested);
    else if (value != null) roles.push(value);
  }
  const normalized = roles.map(value => String(value).trim().toLowerCase().normalize('NFD').replace(/[\\u0300-\\u036f]/g,'').replace(/[^a-z0-9]/g,''));
  const permissionValues = candidates.flatMap(candidate => [...(Array.isArray(candidate.permissions)?candidate.permissions:[]),...(Array.isArray(candidate.permission)?candidate.permission:[])]).map(value => String(value && typeof value === 'object' ? (value.key||value.name||value.permission||value.module||'') : value).trim().toLowerCase().replace(/[^a-z0-9*]/g,''));
  const adminRoles = new Set(['admin','adminuser','administrator','superadmin','superadministrator','owner','platformadmin','root','superuser']);
  const truthy = value => value === true || value === 1 || ['true','1','yes'].includes(String(value ?? '').trim().toLowerCase());
  const hasFullAdminMatrix = access => {
    if (!access || typeof access !== 'object') return false;
    const full = key => access[key] && typeof access[key] === 'object' && truthy(access[key].read) && truthy(access[key].write) && truthy(access[key].delete);
    return ['sales','receiving','customer','supplier','category','item','expense','branch','report','user'].every(full) && truthy(access.dashboard?.read) && truthy(access.dashboard?.financials) && truthy(access.plan?.read);
  };
  return normalized.some(role => adminRoles.has(role) || role.includes('superadmin')) ||
    permissionValues.some(value => ['*','all','admin','superadmin','fullaccess'].includes(value)) ||
    candidates.some(candidate => ['is_admin','isAdmin','is_super_admin','isSuperAdmin','is_superadmin','isSuperadmin','admin','super_admin','full_admin_access'].some(key => truthy(candidate?.[key]))) ||
    candidates.some(candidate => { const access = candidate?.access || candidate?.permissions?.access || {}; return truthy(access.admin) || truthy(access.all) || truthy(access.full_access) || hasFullAdminMatrix(access); });
};
export const allowedTabsFor = (user, module) => {
  if (isAdminRole(user)) return module.tabs.map((label, index) => ({ label, index }));
  const allowed = module.id === 'caisse' ? [0, 1] : module.id === 'clients' ? [1, 3] : [];
  return module.tabs.map((label, index) => ({ label, index })).filter(tab => allowed.includes(tab.index));
};
export const canAccessRoute = (user, moduleId, tabIndex = 0) => {
  const module = modules.find(item => item.id === moduleId);
  return !!module && allowedTabsFor(user, module).some(tab => tab.index === Number(tabIndex));
};
export const primaryModules = modules.filter(module => module.id !== 'parametres');
export const pinnedModules = [{ id: 'companion', label: 'Compagnon Mobile' }, { id: 'theme', label: 'Thème' }, modules.find(module => module.id === 'parametres'), { id: 'logout', label: 'Déconnexion' }];
export const current = state => modules.find(module => module.id === state.view) || modules[0];
