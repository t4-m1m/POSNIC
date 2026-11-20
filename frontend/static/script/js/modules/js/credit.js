/*
 * Credit & Reminders (khata) - admin screen (a tab in Settings).
 *
 * Sets the shop's credit rules (a default credit limit, credit terms) and how it
 * reminds customers to pay. Reminders go out through the shop's own messaging
 * providers (SMS or WhatsApp). Currency-agnostic - a limit and a due are plain
 * numbers in the branch's own currency.
 */
PosnicPro.credit = {
  selectedCustomerId: null,
  esc: function (s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (m) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m];
    });
  },
  num: function (v, d) {
    var n = parseFloat(v);
    return isFinite(n) ? n : d;
  },
  sign: function () {
    return PosnicPro.local.get('currencySign') || '';
  },

  load: function () {
    PosnicPro.get('credit/settings', function (res) {
      if (res && res.type === 'success') PosnicPro.credit.render(res.data || {});
    });
    PosnicPro.credit.loadOutstanding();
  },

  render: function (c) {
    c = c || {};
    $('#credit_default_limit').val(c.default_credit_limit != null ? c.default_credit_limit : 0);
    $('#credit_terms_days').val(c.credit_terms_days != null ? c.credit_terms_days : 0);
    $('#credit_reminder_enabled').prop('checked', c.reminder_enabled === true || c.reminder_enabled === 'true');
    $('#credit_reminder_channel').val(c.reminder_channel || 'sms');
    $('#credit_reminder_template').val(c.reminder_template || '');
    $('#credit_reminder_min_due').val(c.reminder_min_due != null ? c.reminder_min_due : 0);
    $('.credit-currency-label').text(c.currency || PosnicPro.credit.sign() || 'currency');
  },

  collect: function () {
    return {
      default_credit_limit: PosnicPro.credit.num($('#credit_default_limit').val(), 0),
      credit_terms_days: PosnicPro.credit.num($('#credit_terms_days').val(), 0),
      reminder_enabled: $('#credit_reminder_enabled').is(':checked'),
      reminder_channel: $('#credit_reminder_channel').val() || 'sms',
      reminder_template: $('#credit_reminder_template').val() || '',
      reminder_min_due: PosnicPro.credit.num($('#credit_reminder_min_due').val(), 0),
    };
  },

  save: function () {
    PosnicPro.put({ url: 'credit/settings', data: JSON.stringify(PosnicPro.credit.collect()) }, function (res) {
      PosnicPro.alert((res && res.type) || 'error', (res && res.message) || 'Could not save');
      if (res && res.type === 'success') PosnicPro.credit.render(res.data || {});
    });
  },

  loadOutstanding: function () {
    PosnicPro.get('credit/outstanding', function (res) {
      var rows = (res && res.data) || [];
      var sign = PosnicPro.credit.sign();
      var body = $('#credit_outstanding_body').empty();
      if (!rows.length) {
        body.append('<tr><td colspan="4" class="text-center text-muted py-3"><lang class="lang_no_outstanding_customers">No outstanding customers.</lang></td></tr>');
        $('#credit_outstanding_total').text('0');
        return;
      }
      var total = 0;
      rows.forEach(function (r) {
        total += Number(r.due) || 0;
        body.append(
          '<tr>' +
            '<td>' + PosnicPro.credit.esc(r.name) + '</td>' +
            '<td>' + PosnicPro.credit.esc(r.phone || '') + '</td>' +
            '<td class="text-right text-danger">' + sign + (Number(r.due) || 0).toFixed(2) + '</td>' +
            '<td class="text-center text-nowrap"><button type="button" class="btn btn-sm btn-primary credit-open-ledger" data-id="' + r.customer_id + '" data-name="' + PosnicPro.credit.esc(r.name) + '">Debt / Collect</button> <a href="javascript:void(0)" class="btn btn-sm btn-outline-primary credit-remind-one" data-id="' + r.customer_id + '">Remind</a></td>' +
          '</tr>'
        );
      });
      $('#credit_outstanding_total').text(sign + total.toFixed(2));
    });
  },

  loadLedger: function (customerId, customerName) {
    PosnicPro.credit.selectedCustomerId = customerId;
    $('#credit_ledger_title').text('Debt ledger — ' + (customerName || 'Customer'));
    $('#credit_ledger_panel').show();
    $('#credit_ledger_status').text('Loading debt details…');
    $('#credit_ledger_body').empty();
    PosnicPro.get('credit/ledger/' + encodeURIComponent(customerId), function (res) {
      if (!res || res.type !== 'success') {
        $('#credit_ledger_status').text((res && res.message) || 'Could not load debt details.');
        return;
      }
      var rows = res.data || [], sign = PosnicPro.credit.sign(), body = $('#credit_ledger_body').empty();
      if (!rows.length) {
        body.append('<tr><td colspan="5" class="text-center text-muted py-3">No unpaid sale balances for this customer.</td></tr>');
        $('#credit_ledger_due').text(sign + '0.00');
        $('#credit_ledger_status').text('No outstanding debt.');
        $('#credit_settle_amount').val('');
        return;
      }
      var due = 0;
      rows.forEach(function (r) {
        due += Number(r.pending) || 0;
        var date = r.date ? new Date(r.date).toLocaleDateString() : '—';
        body.append('<tr><td>' + PosnicPro.credit.esc(date) + '</td><td>' + PosnicPro.credit.esc(r.receipt_number || r.sale_id || '—') + '</td><td>' + PosnicPro.credit.esc(r.description || 'Credit sale') + '</td><td class="text-right">' + sign + (Number(r.sale_total) || 0).toFixed(2) + '</td><td class="text-right text-danger">' + sign + (Number(r.pending) || 0).toFixed(2) + '</td></tr>');
      });
      $('#credit_ledger_due').text(sign + due.toFixed(2));
      $('#credit_settle_amount').attr('max', due.toFixed(2)).val(due.toFixed(2));
      $('#credit_ledger_status').text(rows.length + ' unpaid sale balance(s). Payments are applied oldest-first.');
    });
  },

  settle: function () {
    var customerId = PosnicPro.credit.selectedCustomerId;
    var amount = Number($('#credit_settle_amount').val());
    if (!customerId || !(amount > 0)) {
      PosnicPro.alert('error', 'Enter a valid payment amount.');
      return;
    }
    var dueText = String($('#credit_ledger_due').text() || '').replace(/[^0-9,.-]/g, '').replace(',', '.');
    var due = Number(dueText);
    if (Number.isFinite(due) && amount > due + 0.009) {
      PosnicPro.alert('error', 'Payment cannot exceed the outstanding balance.');
      return;
    }
    var button = $('#credit_settle_submit').prop('disabled', true);
    PosnicPro.post({ url: 'credit/settle/' + encodeURIComponent(customerId), data: JSON.stringify({
      amount: amount,
      method: $('#credit_settle_method').val() || 'cash',
      note: $('#credit_settle_note').val() || ''
    }) }, function (res) {
      button.prop('disabled', false);
      if (!res || res.type !== 'success') {
        PosnicPro.alert('error', (res && res.message) || 'Debt payment failed.');
        return;
      }
      PosnicPro.alert('success', 'Payment recorded: ' + PosnicPro.credit.sign() + Number((res.data || {}).amount || amount).toFixed(2));
      $('#credit_settle_note').val('');
      PosnicPro.credit.loadOutstanding();
      PosnicPro.credit.loadLedger(customerId, $('#credit_ledger_title').text().replace(/^Debt ledger — /, ''));
    }, function (xhr) {
      button.prop('disabled', false);
      PosnicPro.alert('error', (xhr && xhr.responseJSON && xhr.responseJSON.message) || 'Debt payment failed.');
    });
  },

  remindOne: function (customerId) {
    PosnicPro.post({ url: 'credit/reminder/' + customerId, data: JSON.stringify({}) }, function (res) {
      PosnicPro.alert((res && res.type) || 'error', (res && res.message) || 'Could not remind');
    });
  },

  remindAll: function (dryRun) {
    if (!dryRun && !window.confirm('Send a payment reminder to every outstanding customer now?')) return;
    // Save settings first so the run uses the latest template/channel.
    PosnicPro.put({ url: 'credit/settings', data: JSON.stringify(PosnicPro.credit.collect()) }, function () {
      PosnicPro.post({ url: 'credit/run-reminders', data: JSON.stringify({ dryRun: !!dryRun }) }, function (res) {
        if (!res || res.type !== 'success') {
          PosnicPro.alert((res && res.type) || 'error', (res && res.message) || 'Run failed');
          return;
        }
        var d = res.data || {};
        PosnicPro.alert(
          'success',
          (dryRun ? PosnicPro.i18n.t('lang_dry_run', 'Dry run: ') : PosnicPro.i18n.t('lang_reminders', 'Reminders: ')) + (d.sent || 0) + ' sent, ' + (d.failed || 0) + ' failed, ' + (d.skipped || 0) + ' skipped'
        );
      });
    });
  },
};

$(document).on('click', '#credit_save', function () {
  PosnicPro.credit.save();
});
$(document).on('click', '.credit-remind-one', function () {
  PosnicPro.credit.remindOne($(this).data('id'));
});
$(document).on('click', '#credit_remind_all', function () {
  PosnicPro.credit.remindAll(false);
});
$(document).on('click', '#credit_remind_test', function () {
  PosnicPro.credit.remindAll(true);
});

$(document).on('click', '.credit-open-ledger', function () {
  PosnicPro.credit.loadLedger($(this).data('id'), $(this).data('name'));
});
$(document).on('click', '#credit_settle_submit', function () {
  PosnicPro.credit.settle();
});
$(document).on('click', '#credit_ledger_close', function () {
  $('#credit_ledger_panel').hide();
  PosnicPro.credit.selectedCustomerId = null;
});
