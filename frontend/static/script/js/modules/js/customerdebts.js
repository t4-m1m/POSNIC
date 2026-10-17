/* Dedicated customer debt page: balances, original sale ledger and collections. */
(function () {
  'use strict';
  var selectedCustomerId = null;
  var selectedCustomerName = '';

  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }
  function sign() { return PosnicPro.local.get('currencySign') || ''; }
  function money(value) { return sign() + (Number(value) || 0).toFixed(2); }

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
      $('#debts_outstanding_body').html('<tr><td colspan="4" class="text-center text-muted py-3">Loading outstanding customers…</td></tr>');
      PosnicPro.get('credit/outstanding', function (res) {
        if (!res || res.type !== 'success') {
          $('#debts_outstanding_body').html('<tr><td colspan="4" class="text-center text-danger py-3">' + esc((res && res.message) || 'Could not load customer debts.') + '</td></tr>');
          return;
        }
        var rows = res.data || [], total = 0, body = $('#debts_outstanding_body').empty();
        if (!rows.length) {
          body.html('<tr><td colspan="4" class="text-center text-muted py-3">No outstanding customer balances.</td></tr>');
          $('#debts_outstanding_total').text(money(0));
          return;
        }
        rows.forEach(function (row) {
          var due = Number(row.due) || 0;
          total += due;
          body.append('<tr><td><strong>' + esc(row.name || 'Customer') + '</strong></td><td>' + esc(row.phone || '—') + '</td><td class="text-right text-danger">' + money(due) + '</td><td class="text-center text-nowrap"><button type="button" class="btn btn-sm btn-primary debts-open-ledger" data-id="' + esc(row.customer_id) + '" data-name="' + esc(row.name || 'Customer') + '">Debt / Collect</button></td></tr>');
        });
        $('#debts_outstanding_total').text(money(total));
        var pendingCustomer = PosnicPro.sales && PosnicPro.sales._debtCustomerToOpen;
        if (pendingCustomer && pendingCustomer.id) {
          PosnicPro.sales._debtCustomerToOpen = null;
          PosnicPro.customerdebts.openLedger(pendingCustomer.id, pendingCustomer.name);
        }
      });
    },
    openLedger: function (customerId, name) {
      selectedCustomerId = customerId;
      selectedCustomerName = name || 'Customer';
      $('#debts_ledger_title').text('Debt ledger — ' + selectedCustomerName);
      $('#debts_ledger_panel').show();
      $('#debts_ledger_status').text('Loading unpaid sale balances…');
      $('#debts_ledger_body').empty();
      PosnicPro.get('credit/ledger/' + encodeURIComponent(customerId), function (res) {
        if (!res || res.type !== 'success') {
          $('#debts_ledger_status').text((res && res.message) || 'Could not load debt details.');
          return;
        }
        var rows = res.data || [], due = 0, body = $('#debts_ledger_body').empty();
        if (!rows.length) {
          body.html('<tr><td colspan="5" class="text-center text-muted py-3">No unpaid sale balances for this customer.</td></tr>');
          $('#debts_ledger_due').text(money(0));
          $('#debts_settle_amount').val('');
          $('#debts_ledger_status').text('No outstanding debt.');
          return;
        }
        rows.forEach(function (row) {
          due += Number(row.pending) || 0;
          var date = row.date ? new Date(row.date).toLocaleDateString() : '—';
          body.append('<tr><td>' + esc(date) + '</td><td>' + esc(row.receipt_number || row.sale_id || '—') + '</td><td>' + esc(row.description || 'Credit sale') + '</td><td class="text-right">' + money(row.sale_total) + '</td><td class="text-right text-danger">' + money(row.pending) + '</td></tr>');
        });
        $('#debts_ledger_due').text(money(due));
        $('#debts_settle_amount').attr('max', due.toFixed(2)).val(due.toFixed(2));
        $('#debts_ledger_status').text(rows.length + ' unpaid sale balance(s). Payments are applied to the oldest sale first.');
      });
    },
    settle: function () {
      if (!selectedCustomerId) return PosnicPro.alert('error', 'Select a customer first.');
      var amount = Number($('#debts_settle_amount').val());
      var dueText = String($('#debts_ledger_due').text() || '').replace(/[^0-9,.-]/g, '').replace(',', '.');
      var due = Number(dueText);
      if (!(amount > 0) || (Number.isFinite(due) && amount > due + 0.009)) {
        return PosnicPro.alert('error', 'Enter a valid payment amount no greater than the outstanding balance.');
      }
      var button = $('#debts_settle_submit').prop('disabled', true);
      PosnicPro.post({ url: 'credit/settle/' + encodeURIComponent(selectedCustomerId), data: JSON.stringify({
        amount: amount,
        method: $('#debts_settle_method').val() || 'cash',
        note: $('#debts_settle_note').val() || ''
      }) }, function (res) {
        button.prop('disabled', false);
        if (!res || res.type !== 'success') return PosnicPro.alert('error', (res && res.message) || 'Debt payment failed.');
        PosnicPro.alert('success', 'Payment recorded: ' + money((res.data || {}).amount || amount));
        $('#debts_settle_note').val('');
        PosnicPro.customerdebts.load();
        PosnicPro.customerdebts.openLedger(selectedCustomerId, selectedCustomerName);
      }, function (xhr) {
        button.prop('disabled', false);
        PosnicPro.alert('error', (xhr && xhr.responseJSON && xhr.responseJSON.message) || 'Debt payment failed.');
      });
    }
  };

  $(document).on('click', '#credit_debts_refresh', function () { PosnicPro.customerdebts.load(); });
  $(document).on('click', '.debts-open-ledger', function () {
    PosnicPro.customerdebts.openLedger($(this).data('id'), $(this).data('name'));
  });
  $(document).on('click', '#debts_settle_submit', function () { PosnicPro.customerdebts.settle(); });
  $(document).on('click', '#debts_ledger_close', function () {
    $('#debts_ledger_panel').hide();
    selectedCustomerId = null;
    selectedCustomerName = '';
  });
  $(function () {
    if ((window.location.hash || '').replace(/^#\//, '').split('/')[0] === 'customerdebts') {
      PosnicPro.customerdebts.load();
    }
  });
})();
