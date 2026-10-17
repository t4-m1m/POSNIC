/* Dedicated Clients débiteurs & crédits page. */
(function () {
  'use strict';
  PosnicPro.customerdebts = {
    showDataTablePage: function () {
      if (PosnicPro.HideSideBarModal) PosnicPro.HideSideBarModal();
      $('.vertical-layout').removeClass('toggle-menu');
      $('.page_loader,#osk-container').hide();
      $('#customerdebts').show();
      $('.vertical-menu li a').removeClass('active');
      $('#view_customer_debts_page').addClass('active');
      PosnicPro.customerdebts.load();
    },
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
