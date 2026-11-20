(function () {
  'use strict';
  if (window.__posnicNativeShortcutsBound) return;
  window.__posnicNativeShortcutsBound = true;

  var routes = {
    'new-sale': 'sales/new',
    'sales-history': 'sales',
    'versements': 'itemreport'
  };

  function navigate(route) {
    if (window.hasher && typeof window.hasher.setHash === 'function') {
      window.hasher.setHash(route);
    } else {
      window.location.hash = '#/' + route;
    }
  }

  document.addEventListener('click', function (event) {
    var button = event.target && event.target.closest
      ? event.target.closest('.posnic-cashier-shortcuts [data-posnic-shortcut]')
      : null;
    if (!button) return;
    var action = button.getAttribute('data-posnic-shortcut');
    var route = routes[action];
    if (!route || button.disabled) return;

    event.preventDefault();
    event.stopPropagation();
    if (typeof event.stopImmediatePropagation === 'function') event.stopImmediatePropagation();

    if (action === 'versements') {
      window.__posnicOpenVersements = true;
      window.__posnicOpenStockHealth = false;
    } else {
      window.__posnicOpenVersements = false;
    }
    navigate(route);
  }, true);
})();
