/* POSNIC theme-matched draggable vertical scrollbars.
 * Enhances only real vertical overflow; native scroll position remains the source of truth.
 */
(function () {
  'use strict';
  if (window.__posnicOverlayScrollbarsStarted) return;
  window.__posnicOverlayScrollbarsStarted = true;

  var active = new Map();
  var scheduled = false;
  var minThumb = 34;
  var root = function () { return document.scrollingElement || document.documentElement; };

  function isRootScroller(el) {
    return el === document.documentElement || el === document.body || el === root();
  }

  function canScrollVertically(el) {
    if (!el || el.nodeType !== 1) return false;
    var style = window.getComputedStyle(el);
    var overflow = style.overflowY;
    if (el === document.documentElement || el === document.body) {
      var scrolling = root();
      return scrolling.scrollHeight > window.innerHeight + 2;
    }
    return (overflow === 'auto' || overflow === 'scroll' || overflow === 'overlay') &&
      el.scrollHeight > el.clientHeight + 2 && el.clientHeight > 0;
  }

  function makeScroller(el) {
    var existing = active.get(el);
    if (existing) return existing;
    var bar = document.createElement('div');
    bar.className = 'posnic-overlay-scrollbar';
    bar.setAttribute('role', 'scrollbar');
    bar.setAttribute('aria-label', 'Vertical page scroll');
    bar.setAttribute('aria-orientation', 'vertical');
    bar.setAttribute('tabindex', '0');
    var thumb = document.createElement('div');
    thumb.className = 'posnic-overlay-scrollbar-thumb';
    bar.appendChild(thumb);
    document.body.appendChild(bar);

    var state = { el: el, bar: bar, thumb: thumb, dragging: false, startY: 0, startScroll: 0, frame: 0 };
    active.set(el, state);
    el.classList.add('posnic-overlay-scroll-active');

    function onPointerDown(event) {
      if (event.button !== 0) return;
      event.preventDefault();
      if (event.target !== thumb) {
        var trackRect = bar.getBoundingClientRect();
        var trackRatio = (event.clientY - trackRect.top - thumb.offsetHeight / 2) /
          Math.max(1, trackRect.height - thumb.offsetHeight - 4);
        setScrollTop(el, Math.max(0, Math.min(1, trackRatio)) * getMaxScroll(el));
        update(state);
      }
      state.dragging = true;
      state.startY = event.clientY;
      state.startScroll = getScrollTop(el);
      bar.classList.add('is-dragging');
      try { bar.setPointerCapture(event.pointerId); } catch (_) {}
    }
    function onPointerMove(event) {
      if (!state.dragging) return;
      var maxScroll = getMaxScroll(el);
      var maxThumbTravel = Math.max(1, bar.clientHeight - thumb.offsetHeight - 4);
      var delta = event.clientY - state.startY;
      setScrollTop(el, state.startScroll + delta / maxThumbTravel * maxScroll);
      update(state);
    }
    function onPointerUp() {
      state.dragging = false;
      bar.classList.remove('is-dragging');
      update(state);
    }
    function onTrackDown(event) {
      if (event.target === thumb || event.button !== 0) return;
      var rect = bar.getBoundingClientRect();
      var thumbTop = parseFloat(thumb.style.top) || 2;
      var direction = event.clientY < rect.top + thumbTop ? -1 : 1;
      setScrollTop(el, getScrollTop(el) + direction * Math.max(80, getClientHeight(el) * .8));
      update(state);
    }
    function onKeyDown(event) {
      var amount = Math.max(40, getClientHeight(el) * .15);
      if (event.key === 'ArrowDown') setScrollTop(el, getScrollTop(el) + amount);
      else if (event.key === 'ArrowUp') setScrollTop(el, getScrollTop(el) - amount);
      else if (event.key === 'PageDown') setScrollTop(el, getScrollTop(el) + getClientHeight(el) * .85);
      else if (event.key === 'PageUp') setScrollTop(el, getScrollTop(el) - getClientHeight(el) * .85);
      else if (event.key === 'Home') setScrollTop(el, 0);
      else if (event.key === 'End') setScrollTop(el, getMaxScroll(el));
      else return;
      event.preventDefault();
      update(state);
    }

    bar.addEventListener('pointerdown', onPointerDown);
    bar.addEventListener('pointermove', onPointerMove);
    bar.addEventListener('pointerup', onPointerUp);
    bar.addEventListener('pointercancel', onPointerUp);
    bar.addEventListener('click', onTrackDown);
    bar.addEventListener('keydown', onKeyDown);
    state.cleanup = function () {
      bar.removeEventListener('pointerdown', onPointerDown);
      bar.removeEventListener('pointermove', onPointerMove);
      bar.removeEventListener('pointerup', onPointerUp);
      bar.removeEventListener('pointercancel', onPointerUp);
      bar.removeEventListener('click', onTrackDown);
      bar.removeEventListener('keydown', onKeyDown);
      bar.remove();
      el.classList.remove('posnic-overlay-scroll-active');
      active.delete(el);
    };
    el.addEventListener('scroll', function () { scheduleUpdate(state); }, { passive: true });
    if (window.ResizeObserver) {
      state.resizeObserver = new ResizeObserver(function () { scheduleUpdate(state); });
      state.resizeObserver.observe(el);
    }
    return state;
  }

  function getScrollTop(el) { return isRootScroller(el) ? root().scrollTop : el.scrollTop; }
  function setScrollTop(el, value) {
    if (isRootScroller(el)) root().scrollTop = value;
    else el.scrollTop = value;
  }
  function getScrollHeight(el) { return isRootScroller(el) ? root().scrollHeight : el.scrollHeight; }
  function getClientHeight(el) { return isRootScroller(el) ? window.innerHeight : el.clientHeight; }
  function getMaxScroll(el) { return Math.max(0, getScrollHeight(el) - getClientHeight(el)); }

  function update(state) {
    var el = state.el;
    if (!el.isConnected || !canScrollVertically(el)) {
      state.bar.classList.remove('is-visible');
      if (!el.isConnected) state.cleanup();
      return;
    }
    var rect;
    if (isRootScroller(el)) {
      rect = { top: 0, right: window.innerWidth, bottom: window.innerHeight, height: window.innerHeight, left: 0, width: window.innerWidth };
    } else {
      rect = el.getBoundingClientRect();
    }
    var clientHeight = getClientHeight(el);
    var scrollHeight = getScrollHeight(el);
    var maxScroll = Math.max(1, scrollHeight - clientHeight);
    var trackHeight = Math.max(0, rect.height);
    var thumbHeight = Math.min(trackHeight, Math.max(minThumb, trackHeight * clientHeight / scrollHeight));
    var travel = Math.max(0, trackHeight - thumbHeight - 4);
    var top = 2 + (getScrollTop(el) / maxScroll) * travel;
    state.bar.style.left = Math.max(0, Math.min(window.innerWidth - 12, rect.right - 12)) + 'px';
    state.bar.style.top = Math.max(0, rect.top) + 'px';
    state.bar.style.height = Math.max(0, Math.min(rect.bottom || rect.top + rect.height, window.innerHeight) - Math.max(0, rect.top)) + 'px';
    state.thumb.style.height = thumbHeight + 'px';
    state.thumb.style.top = top + 'px';
    state.bar.classList.toggle('is-visible', rect.height > 0 && rect.bottom > 0 && rect.top < window.innerHeight);
    state.bar.setAttribute('aria-valuemin', '0');
    state.bar.setAttribute('aria-valuemax', String(Math.round(maxScroll)));
    state.bar.setAttribute('aria-valuenow', String(Math.round(getScrollTop(el))));
  }

  function scheduleUpdate(state) {
    if (state.frame) return;
    state.frame = window.requestAnimationFrame(function () {
      state.frame = 0;
      update(state);
    });
  }
  function scan(rootNode) {
    if (!rootNode || !rootNode.querySelectorAll) return;
    var candidates = [];
    if (rootNode.nodeType === 1 && canScrollVertically(rootNode)) candidates.push(rootNode);
    rootNode.querySelectorAll('*').forEach(function (el) {
      if (canScrollVertically(el)) candidates.push(el);
    });
    candidates.forEach(function (el) { update(makeScroller(el)); });
    active.forEach(function (state, el) {
      if (!el.isConnected || !canScrollVertically(el)) {
        state.bar.classList.remove('is-visible');
        if (!el.isConnected) state.cleanup();
      } else scheduleUpdate(state);
    });
  }

  function start() {
    scan(document);
    window.addEventListener('resize', function () { active.forEach(scheduleUpdate); }, { passive: true });
    window.addEventListener('scroll', function () { active.forEach(scheduleUpdate); }, { passive: true, capture: true });
    if (window.MutationObserver && document.body) {
      new MutationObserver(function (mutations) {
        var needsScan = false;
        mutations.forEach(function (m) {
          if (m.addedNodes.length || m.removedNodes.length || m.type === 'attributes') needsScan = true;
        });
        if (!needsScan || scheduled) return;
        scheduled = true;
        window.requestAnimationFrame(function () { scheduled = false; scan(document); });
      }).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style', 'hidden'] });
    }
    if (window.ResizeObserver && document.body) {
      new ResizeObserver(function () { active.forEach(scheduleUpdate); }).observe(document.body);
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();