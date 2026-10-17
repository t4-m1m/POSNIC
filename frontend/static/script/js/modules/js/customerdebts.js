/* Dedicated Clients débiteurs & crédits page. */
(function () {
  'use strict';
  PosnicPro.customerdebts = {
    load: function () {
      if (PosnicPro.credit && PosnicPro.credit.loadOutstanding) PosnicPro.credit.loadOutstanding();
    }
  };
  $(document).on('click', '#credit_debts_refresh', function () {
    PosnicPro.customerdebts.load();
  });
  // The router invokes the page module on route entry; this also handles direct
  // navigation and restored hashes after the dashboard has already initialized.
  $(function () {
    if ((window.location.hash || '').replace(/^#\//, '').split('/')[0] === 'customerdebts') {
      PosnicPro.customerdebts.load();
    }
  });
})();
