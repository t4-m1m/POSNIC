/* POSNIC global keyboard navigation and tab-scroll controls.
 * Intentionally does not modify the primary sidebar, its CSS, or its handlers.
 * Existing Sales function keys are not intercepted.
 */
(function () {
  'use strict';
  if (window.__posnicSafeGlobalNavigationInstalled) return;
  window.__posnicSafeGlobalNavigationInstalled = true;

  var routes = {
    '1': '#/sales/new',
    '2': '#/items',
    '3': '#/stocklogs',
    '4': '#/quickreport',
    '5': '#/settings/general'
  };

  function go(route) {
    var hash = route.replace(/^#\//, '');
    if (window.hasher && typeof window.hasher.setHash === 'function') {
      window.hasher.setHash(hash);
    } else {
      window.location.hash = route;
    }
  }

  function visible(el) {
    return !!(el && (el.offsetWidth || el.offsetHeight || el.getClientRects().length) &&
      window.getComputedStyle(el).visibility !== 'hidden');
  }

  function closeOverlay() {
    var modal = document.querySelector('dialog[open], .modal.show, .modal.in, [role="dialog"][aria-modal="true"]');
    if (modal) {
      if (modal.tagName === 'DIALOG' && typeof modal.close === 'function') {
        modal.close();
        return true;
      }
      var close = modal.querySelector('[data-dismiss="modal"], [data-bs-dismiss="modal"], [aria-label="Close"], .close');
      if (close && visible(close) && !close.disabled) {
        close.click();
        return true;
      }
      if (window.jQuery && window.jQuery.fn && typeof window.jQuery.fn.modal === 'function') {
        window.jQuery(modal).modal('hide');
        return true;
      }
    }

    var dropdown = document.querySelector('.dropdown-menu.show, .dropdown-menu[style*="display: block"]');
    if (dropdown) {
      var toggle = dropdown.parentElement && dropdown.parentElement.querySelector('[data-toggle="dropdown"], [data-bs-toggle="dropdown"]');
      if (toggle && visible(toggle)) {
        toggle.click();
        return true;
      }
    }

    var popover = document.querySelector('.popover.show, .popover[style*="display: block"]');
    if (popover) {
      var popoverClose = popover.querySelector('[aria-label="Close"], [data-dismiss="popover"], .close');
      if (popoverClose && visible(popoverClose)) {
        popoverClose.click();
        return true;
      }
    }
    return false;
  }

  function focusMainContent() {
    var candidates = ['#containerbar', '#main-content', '#content', 'main', '#sales_new', '#items'];
    for (var i = 0; i < candidates.length; i++) {
      var el = document.querySelector(candidates[i]);
      if (!visible(el)) continue;
      if (!el.hasAttribute('tabindex')) el.setAttribute('tabindex', '-1');
      try { el.focus({ preventScroll: true }); } catch (_) { el.focus(); }
      return;
    }
  }

  function confirmDialogTarget(event) {
    if (event.key !== 'Enter' || event.repeat || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return false;
    var target = event.target;
    if (!target || target.isContentEditable) return false;
    var modal = target.closest && target.closest('dialog[open], .modal.show, .modal.in, [role="dialog"][aria-modal="true"]');
    if (!modal) return false;

    // Preserve normal keyboard behavior for explicit buttons/links, text areas,
    // selects, and toggle/file controls. Text and number inputs can confirm a
    // popup just like the vendor dialog, but never by submitting an unrelated form.
    var tag = String(target.tagName || '').toUpperCase();
    var type = String(target.type || '').toLowerCase();
    if (tag === 'BUTTON' || tag === 'A' || tag === 'TEXTAREA' || tag === 'SELECT') return false;
    if (tag === 'INPUT' && ['checkbox', 'radio', 'file', 'button', 'submit', 'reset', 'image'].indexOf(type) !== -1) return false;

    var form = target.closest && target.closest('form');
    var primary = modal.querySelector('button[type="submit"], input[type="submit"], .modal-footer .btn-primary, [data-confirm]');
    if (!primary) return false;
    if (form && primary.form && primary.form !== form) return false;
    if (!visible(primary) || primary.disabled || primary.getAttribute('aria-disabled') === 'true') return false;

    event.preventDefault();
    event.stopPropagation();
    primary.click();
    return true;
  }
  document.addEventListener('keydown', function (event) {
    var key = event.key;
    var digit = /^[1-5]$/.test(key);

    // Keep navigation shortcuts separate from Sales F-keys.
    if (digit && !event.repeat && (
      (event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey) ||
      (event.ctrlKey && event.shiftKey && !event.altKey && !event.metaKey)
    )) {
      event.preventDefault();
      event.stopPropagation();
      go(routes[key]);
      return;
    }

    // Enter activates the existing primary action in a visible popup, including
    // when the cashier is focused in a text/number input. Explicit buttons and
    // native form submission keep their own behavior.
    if (confirmDialogTarget(event)) return;

    // Close overlays using their own controls and return focus to the content.
    if (key === 'Escape' && closeOverlay()) {
      event.preventDefault();
      event.stopPropagation();
      window.setTimeout(focusMainContent, 0);
    }

    // Enter on inputs/forms is deliberately left to native submission and the
    // application's existing payment handlers. Sales F-keys are never handled here.
  }, true);

  var tabSelector = '[role="tablist"], .nav-tabs, .nav-pills';
  var controlClass = 'posnic-safe-tab-scroll-control';

  function enhanceTabList(list) {
    if (!list || list.dataset.posnicSafeScroll === '1' || !list.parentElement) return;
    // Only horizontal tab strips; never wrap or restyle the primary sidebar.
    if (list.closest('#sidebar, #sidebar-wrapper, .sidebar, .main-sidebar, .primary-sidebar, nav.sidebar')) return;
    var parent = list.parentElement;
    if (parent.closest('.posnic-safe-tab-scroll-shell')) return;

    var shell = document.createElement('div');
    shell.className = 'posnic-safe-tab-scroll-shell';
    var viewport = document.createElement('div');
    viewport.className = 'posnic-safe-tab-scroll-viewport';
    var previous = document.createElement('button');
    var next = document.createElement('button');

    previous.type = next.type = 'button';
    previous.className = next.className = controlClass;
    previous.setAttribute('aria-label', 'Scroll tabs left');
    next.setAttribute('aria-label', 'Scroll tabs right');
    previous.textContent = '‹';
    next.textContent = '›';

    var style = document.createElement('style');
    style.id = 'posnic-safe-tab-scroll-style';
    style.textContent =
      '.posnic-safe-tab-scroll-shell{display:flex;align-items:center;gap:4px;min-width:0;max-width:100%;}' +
      '.posnic-safe-tab-scroll-viewport{flex:1 1 auto;min-width:0;overflow-x:auto;overflow-y:hidden;scrollbar-width:thin;scroll-behavior:smooth;}' +
      '.posnic-safe-tab-scroll-viewport::-webkit-scrollbar{height:8px;}' +
      '.posnic-safe-tab-scroll-control{flex:0 0 28px;min-width:28px;height:30px;padding:0;border:1px solid #cbd3dc;border-radius:5px;background:var(--bs-body-bg,#fff);color:inherit;cursor:pointer;line-height:1;font-size:20px;}' +
      '.posnic-safe-tab-scroll-control:disabled{opacity:.35;cursor:default;}' +
      '.posnic-safe-tab-scroll-control:focus-visible{outline:2px solid #2675d8;outline-offset:1px;}';

    if (!document.getElementById(style.id) && document.head) document.head.appendChild(style);

    parent.insertBefore(shell, list);
    shell.appendChild(previous);
    shell.appendChild(viewport);
    viewport.appendChild(list);
    shell.appendChild(next);
    list.dataset.posnicSafeScroll = '1';

    function refresh() {
      var max = Math.max(0, viewport.scrollWidth - viewport.clientWidth);
      var overflowing = max > 2;
      previous.hidden = next.hidden = !overflowing;
      previous.disabled = viewport.scrollLeft <= 1;
      next.disabled = viewport.scrollLeft >= max - 1;
      viewport.style.scrollbarWidth = overflowing ? 'thin' : 'none';
    }
    previous.addEventListener('click', function () {
      viewport.scrollBy({ left: -Math.max(120, viewport.clientWidth * 0.7), behavior: 'smooth' });
    });
    next.addEventListener('click', function () {
      viewport.scrollBy({ left: Math.max(120, viewport.clientWidth * 0.7), behavior: 'smooth' });
    });
    viewport.addEventListener('scroll', refresh, { passive: true });
    if (window.ResizeObserver) new ResizeObserver(refresh).observe(viewport);
    window.addEventListener('resize', refresh);
    refresh();
  }

  function scanTabLists(root) {
    if (!root || !root.querySelectorAll) return;
    if (root.matches && root.matches(tabSelector)) enhanceTabList(root);
    root.querySelectorAll(tabSelector).forEach(enhanceTabList);
  }

  function start() {
    scanTabLists(document);
    if (window.MutationObserver && document.body) {
      new MutationObserver(function (mutations) {
        mutations.forEach(function (mutation) {
          mutation.addedNodes.forEach(function (node) {
            if (node.nodeType === 1) scanTabLists(node);
          });
        });
      }).observe(document.body, { childList: true, subtree: true });
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();