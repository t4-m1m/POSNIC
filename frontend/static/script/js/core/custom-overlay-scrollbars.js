/* Custom overlay scrollbar UI disabled by request.
 * Keep native scrolling and the app-wide keyboard arrow navigation untouched.
 * The old overlay injected fixed bars/arrows and performed repeated full-page
 * scans on low-power tills, so do not initialize that UI or its observers.
 */
(function () {
  'use strict';
  if (window.__posnicOverlayScrollbarsStarted) return;
  window.__posnicOverlayScrollbarsStarted = true;
  // Deliberately no visual scrollbar injection. Native overflow remains intact.
})();
