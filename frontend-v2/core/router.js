// SamarinaPOS V2 navigation contract. Settings is pinned in the rail footer.
export const modules = [
  { id: 'caisse', icon: 'terminal', label: 'Caisse', tabs: ['Vente', 'Historique des ventes'] },
  { id: 'catalogue', icon: 'boxes', label: 'Catalogue & Stock', tabs: ['Catalogue Produits', 'Journal d’Inventaire', 'Alertes Stock Faible', 'Designer d’Étiquettes'] },
  { id: 'achats', icon: 'truck', label: 'Achats', tabs: ['Nouvelle Réception / Facture', 'Historique des Achats'] },
  { id: 'clients', icon: 'users', label: 'Clients & Crédits', tabs: ['Répertoire Clients', 'Suivi Crédits & Dettes', 'Règlements TPE / BaridiMob', 'Versements'] },
  { id: 'zr-express', icon: 'route', label: 'ZR Express', tabs: ['Colis & Expéditions', 'Créer un Colis'] },
  { id: 'rapports', icon: 'chart', label: 'Rapports & Clôture', tabs: ['Clôture de caisse · Ticket Studio', 'Tableau de bord & statistiques', 'Zakat'] },
  { id: 'rh', icon: 'users', label: 'RH & Salaires', tabs: ['Employés & Paie'] },
  { id: 'parametres', icon: 'sliders', label: 'Paramètres', tabs: ['Boutique & Général', 'Imprimantes & Ticket Studio', 'WhatsApp & Notifications', 'ZR Express API', 'Vendeurs & Utilisateurs', 'Mises à jour'] }
];
export const isAdminRole = user => {
  const roles = [user?.usertype, user?.role, user?.role_name, user?.roleName]
    .filter(value => value !== undefined && value !== null)
    .map(value => String(value).trim().toLowerCase().replace(/[\s-]+/g, '_'));
  return roles.some(role => ['admin', 'super_admin', 'superadmin', 'owner'].includes(role)) ||
    user?.is_admin === true || user?.isAdmin === true ||
    user?.is_super_admin === true || user?.isSuperAdmin === true;
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
