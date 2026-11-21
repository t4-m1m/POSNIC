// SamarinaPOS V2 navigation contract. Settings is pinned in the rail footer,
// while the six operational areas remain the only primary navigation sections.
export const modules = [
  { id: 'caisse', icon: 'terminal', label: 'Caisse', tabs: ['Vente', 'Historique des ventes'] },
  { id: 'catalogue', icon: 'boxes', label: 'Catalogue & Stock', tabs: ['Catalogue Produits', 'Journal d’Inventaire', 'Alertes Stock Faible', 'Designer d’Étiquettes'] },
  { id: 'achats', icon: 'truck', label: 'Achats', tabs: ['Nouvelle Réception / Facture', 'Historique des Achats'] },
  { id: 'clients', icon: 'users', label: 'Clients & Crédits', tabs: ['Répertoire Clients', 'Suivi Crédits & Dettes', 'Règlements TPE / BaridiMob'] },
  { id: 'zr-express', icon: 'route', label: 'ZR Express', tabs: ['Colis & Expéditions', 'Créer un Colis'] },
  { id: 'rapports', icon: 'chart', label: 'Rapports & Clôture', tabs: ['Clôture de Caisse (Z-Report)', 'Tableau de Bord & Statistiques', 'Calendrier des Ventes', 'Rapport Achats & Marges', 'Rapports complémentaires', 'Zakat'] },
  { id: 'parametres', icon: 'sliders', label: 'Paramètres', tabs: ['Boutique & Général', 'Devises & Formule EUR → DZD', 'Imprimantes & Ticket Studio', 'WhatsApp & Notifications', 'ZR Express API', 'Compagnon Mobile, Utilisateurs & Sauvegarde'] }
];

export const primaryModules = modules.filter(module => module.id !== 'parametres');
export const pinnedModules = [{ id: 'companion', label: 'Compagnon Mobile' }, { id: 'theme', label: 'Thème' }, modules.find(module => module.id === 'parametres'), { id: 'logout', label: 'Déconnexion' }];

export const current = state => modules.find(module => module.id === state.view) || modules[0];
