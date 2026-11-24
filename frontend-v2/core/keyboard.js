import { state, basket } from './store.js';

export function installKeyboard({ render, focusSearch, onFunctionKey }) {
  const handler = (event) => {
    const typing = event.target?.matches?.('input,textarea,select,[contenteditable=true]');
    if (event.key === 'Escape') {
      if (state.drawer) { state.drawer = null; render(); focusSearch(); }
      return;
    }
    if ((event.ctrlKey || event.metaKey) && ['k','f'].includes(event.key.toLowerCase())) {
      event.preventDefault();
      document.querySelector('#global-search')?.focus();
      return;
    }
    if (event.ctrlKey && event.key === 'Tab') {
      event.preventDefault();
      const index = state.baskets.findIndex((entry) => entry.id === state.activeBasket);
      state.activeBasket = state.baskets[(index + 1) % state.baskets.length].id;
      render();
      return;
    }
    if (event.key === 'F6' && state.view === 'caisse' && state.tab === 0) {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      if (event.repeat) return;
      if (typeof onFunctionKey === 'function') onFunctionKey('F6');
      else document.querySelector('.fkey-grid [data-action="F6"]')?.click();
      return;
    }
    if (state.drawer) return;
    if ((event.altKey || event.ctrlKey) && event.shiftKey && /^[1-5]$/.test(event.key)) { const target = ['caisse','catalogue','achats','clients','zr-express'][Number(event.key)-1]; if (target) { event.preventDefault(); state.view=target; state.tab=0; location.hash=target; render(); } return; }
    const actions = { F1: 'F1', F2: 'F2', F3: 'F3', F4: 'F4', F5: 'F5', F6: 'F6', F7: 'F7', F8: 'F8' };
    if (actions[event.key]) {
      event.preventDefault();
      document.querySelector('.fkey-grid [data-action="' + actions[event.key] + '"]')?.click();
      return;
    }
    const scanInput = event.target?.id === 'barcode-search';
    if (event.key === '/' && !typing) { event.preventDefault(); focusSearch(); return; }
    if (typing && !scanInput) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      const rows = [...document.querySelectorAll('.cart-workspace [data-cart-line]')];
      if (!rows.length) return;
      event.preventDefault();
      const index = rows.findIndex((row) => row.classList.contains('selected'));
      rows.forEach((row) => row.classList.remove('selected'));
      const next = rows[Math.max(0, Math.min(rows.length - 1, (index < 0 ? 0 : index) + (event.key === 'ArrowDown' ? 1 : -1)))];
      rows.forEach((row) => row.classList.remove('selected'));
      next.classList.add('selected');
      state.selectedLineId = next.dataset.cartLine;
      return;
    }
    if ((event.key === '+' || event.key === '-') && basket().items.length) {
      event.preventDefault();
      const rows = [...document.querySelectorAll('.cart-workspace [data-cart-line]')];
      const index = rows.findIndex((row) => row.classList.contains('selected'));
      const item = basket().items[index < 0 ? 0 : index];
      if (item) {
        const next = item.quantity + (event.key === '+' ? 1 : -1);
        const available = Number(item.available_quantity);
        if (event.key === '+' && item.track_inventory && !item.negative_stock && available >= 0 && next > available) return;
        item.quantity = Math.max(1, next);
        state.selectedLineId = String(item._id);
        render();
      }
      return;
    }
    if (event.key === 'Delete' && basket().items.length) {
      const index = [...document.querySelectorAll('.cart-workspace [data-cart-line]')].findIndex((row) => row.classList.contains('selected'));
      basket().items.splice(index < 0 ? basket().items.length - 1 : index, 1);
      state.selectedLineId = basket().items[0] ? String(basket().items[0]._id) : null;
      render();
      return;
    }
    if (event.key.length === 1 && !event.ctrlKey && !event.altKey && !event.metaKey) {
      // The event began outside the scanner input. Prevent the browser from
      // inserting the same character again after focusSearch() moves focus.
      event.preventDefault();
      focusSearch();
      const input = document.querySelector('#barcode-search');
      if (input) {
        input.value += event.key;
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }
    }
  };
  window.addEventListener('keydown', handler, true);
  return () => window.removeEventListener('keydown', handler, true);
}
