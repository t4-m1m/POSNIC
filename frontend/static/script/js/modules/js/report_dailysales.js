PosnicPro.quickreport = {
  meal: 'full',
  chooseRange: function (preset) {
    var zone = PosnicPro.timeZone();
    var start = moment.tz ? moment.tz(zone) : moment();
    if (preset === 'yesterday') start.subtract(1, 'day');
    if (preset === 'last-month') start.subtract(1, 'month');
    var monthly = preset === 'month' || preset === 'last-month';
    var end = start.clone().endOf(monthly ? 'month' : 'day');
    start.startOf(monthly ? 'month' : 'day');
    var field = $('#view_dailysale_report_daterange'), picker = field.data('daterangepicker');
    if (picker) { picker.setStartDate(start); picker.setEndDate(end); }
    var text = start.format('YYYY/MM/DD h:mm A') + ' - ' + end.format('YYYY/MM/DD h:mm A');
    field.val(text).find('span').first().text(text);
    this.salereportTable(monthly ? PosnicPro.i18n.t('lang_monthly', 'Monthly') : PosnicPro.i18n.t('lang_daily', 'Daily'));
  },
  periodParams: function () {
    var meal = this.meal || 'full';

    if (meal === 'full') return {};
    if (meal !== 'custom') return { serving_period: meal.replace(/^period:/, '') };
    var times = [$('#daily-meal-from').val(), $('#daily-meal-to').val()];
    if (!times || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(times[0] || '') || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(times[1] || '') || times[0] === times[1]) {
      PosnicPro.alert('warning', PosnicPro.i18n.t('lang_choose_different_valid_start_and_end_times', 'Choose different valid start and end times.'));
      return null;
    }
    return { start_time: times[0], end_time: times[1] };
  },
  loadPeriods: function (ready) {
    PosnicPro.mountServingPeriodFilter({ host: '#daily-meal-filter', select: '#daily-serving-period', hint: '#daily-period-hint',
      branch: $('#dailysale_branch_value').val(), custom: true,
      change: function (value) { PosnicPro.quickreport.chooseMeal(value === '__custom' ? 'custom' : value ? 'period:' + value : 'full'); },
      ready: function (value) {
        PosnicPro.quickreport.meal = value === '__custom' ? 'custom' : value ? 'period:' + value : 'full';
        $('#daily-meal-custom').toggle(value === '__custom');
        if (ready) ready();
      }
    });
  },
  renderPeriods: function (branch) {
    $('#daily-meal-filter').toggle(branch.restaurant_enabled === true);
    if (!branch.restaurant_enabled) this.meal = 'full';
  },
  chooseMeal: function (meal) {
    this.meal = meal;
    $('#daily-serving-period').val(meal === 'full' ? '' : meal === 'custom' ? '__custom' : meal.replace(/^period:/, ''));
    $('#daily-meal-custom').toggle(meal === 'custom');
    if (meal === 'custom') { $('#daily-meal-from').trigger('focus'); $('#daily-meal-status').text(PosnicPro.i18n.t('lang_choose_your_hours_then_apply_the_report_be', 'Choose your hours, then apply. The report below keeps its last applied period.')); }
    else this.salereportTable('VIEW');
  },
  showDataTablePage: function () {
    var loader = $(".loader-dailysale-report");
    loader.find(".loadingSpinner:first").remove();
    PosnicPro.HideSideBarModal();
    $(".vertical-layout").removeClass("toggle-menu");
    $(".vertical-menu li a").removeClass("active");
    $("#dailysale-view-tab-line,.dropdown-item").removeClass("active");
    $(".page_loader,#osk-container").hide();
    $(".page-title-box,#dailyreport_new").show();
    $("#v-pills-report-tab,#viewdailyreport_page").addClass("active");
    $(".custom-daily-sale-nav-menu").addClass("active");
    $("#v-pills-report").addClass("show active");
    PosnicPro.quickreport.loadPeriods(function () { PosnicPro.quickreport.salereportTable("Daily"); });
    if (PosnicPro.local.get("userplan") === "free") {
      $("#dailysale-view-line").css("filter", "blur(2px)");
      $("#export_daily_report, .blur_val").attr("disabled", true).css({
        "pointer-events": "none",
        cursor: "not-allowed",
        opacity: "0.5",
      });
      $("#dailysale_upgrade").show();
    } else {
      $("#dailysale-view-line").css("filter", "none");
      $("#export_daily_report, .blur_val").removeAttr("disabled").css({
        "pointer-events": "auto",
        cursor: "pointer",
        opacity: "1",
      });
      $("#dailysale_upgrade").hide();
    }
  },
  salereportTable: function (type) {
    // helpers (ES5-safe)
    function esc(s) {
      s = s == null ? "" : String(s);
      return s.replace(/[&<>"']/g, function (m) {
        return {
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        }[m];
      });
    }
    function safeNum(n) {
      n = parseFloat(n);
      return isFinite(n) ? n : 0;
    }
    function trim(s) {
      return (s || "").replace(/^\s+|\s+$/g, "");
    }

    var branchId = String($("#dailysale_branch_value").val() || "");
    if (!branchId) {
      $("#dailysale_branch_value").focus();
      return;
    }

    var periodParams = PosnicPro.quickreport.periodParams();
    if (!periodParams) return;
    var requestId = (PosnicPro.quickreport.requestId || 0) + 1;
    PosnicPro.quickreport.requestId = requestId;
    PosnicPro.quickreport.lastReport = null;
    $('#daily-meal-status').text('Updating report…');
    var loader = $(".loader-dailysale-report");
    loader.find(".loadingSpinner").remove();
    $("<div class='loadingSpinner'></div>").appendTo(loader);

    var daterange = String($("#view_dailysale_report_daterange").val() || "");
    var fields =
      daterange.indexOf(" - ") > -1
        ? daterange.split(" - ")
        : daterange.split("-");
    var startDate = trim(fields[0]);
    var endDate = trim(fields[1]);

    if (!startDate || !endDate) {
      loader.find(".loadingSpinner:first").remove();
      PosnicPro.alert("error", "Select a valid date range");
      return;
    }

    var params = {
      url: "sales/dailySalesReports",
      data: {
        branch: branchId,
        starting_date: startDate,
        ending_date: endDate,
        serving_period: periodParams.serving_period,
        start_time: periodParams.start_time,
        end_time: periodParams.end_time,
        type: type, // 'VIEW' | 'CSV' | 'PDF' etc.
      },
    };

    PosnicPro.get(
      params,
      function (response) {
        if (requestId !== PosnicPro.quickreport.requestId) return;
        loader.find(".loadingSpinner:first").remove();
        if (response.type !== "success") {
          $("#daily-meal-status").text("Could not update the report.");
          PosnicPro.alert(response.type, response.message);
          return;
        }

        var currency = PosnicPro.local.get("currencySign") || "₹";

        // ---- Branch ----
        var branchData =
          response.data && response.data.branch_details
            ? response.data.branch_details
            : {};
        $("#daily_report_date").html(
          PosnicPro.convertDate(branchData.date || "")
        );
        PosnicPro.quickreport.renderPeriods(branchData);
        $('#daily-report-period, #daily-meal-status').text(branchData.period_label || 'Full day');
        $("#daily_report_fromdate").text(startDate);
        $("#daily_report_todate").text(endDate);
        $("#daily_report_branchname").html(esc(branchData.branch_name));
        $("#daily_report_branchaddress").html(esc(branchData.branch_address));
        $("#daily_report_branchphone").html(esc(branchData.branch_phone));
        $("#daily_report_branchemail").html(esc(branchData.branch_email));

        var branchHeaderRow = [
          "fromDate",
          "toDate",
          "branchName",
          "branchAddress",
          "branchPhone",
          "branchEmail",
          "salesPeriod",
        ];
        var branchDataRow = [
          branchData.from_date,
          branchData.to_date,
          branchData.branch_name,
          branchData.branch_address,
          branchData.branch_phone,
          branchData.branch_email,
          branchData.period_label,
        ];

        // ---- Products ----
        var productData =
          response.data && response.data.product_details
            ? response.data.product_details
            : [];

        if (productData.length > 0) {
          $(".hide-show-dailyimgreport").hide();
          $(".hide-show-dailyreport").show();
        } else {
          $(".hide-show-dailyimgreport").show();
          $(".hide-show-dailyreport").hide();
        }

        $("#daily_report_product_details tbody").children("tr").remove();

        var qty = 0,
          price = 0,
          total = 0,
          profit = 0;
        var productHeaderRow = [
          "productName",
          "productSku",
          "productQty",
          "productSubtotal",
          "productDiscount",
          "productTax",
          "productTotal",
        ];
        var productAllDataRow = [];

        for (var i = 0; i < productData.length; i++) {
          var p = productData[i];
          var pQty = safeNum(p.product_qty);
          var pSubtotal = safeNum(p.product_subtotal);
          var pTotal = safeNum(p.product_total);
          var pProfit = safeNum(p.product_profit);
          var pDiscount = safeNum(p.product_discount);
          var pTax = safeNum(p.product_tax);

          qty += pQty;
          price += pSubtotal;
          total += pTotal;
          profit += pProfit;

          if (pSubtotal > 0) {
            var rowHTMLLine =
              " <tr> " +
              '   <td class="font-12 text-center">' +
              (i + 1) +
              "</td>" +
              '   <td class="font-12 text-left">' +
              esc(p.product_name) +
              "</td>" +
              '   <td class="font-12 text-left">' +
              esc(p.product_sku) +
              "</td>" +
              '   <td class="font-12 text-center">' +
              pQty +
              "</td>" +
              '   <td class="font-12 text-right">' +
              currency +
              '&nbsp;<span class="number">' +
              pSubtotal +
              "</span> </td>" +
              '   <td class="font-12 text-right">-' +
              currency +
              '&nbsp;<span class="number">' +
              pDiscount +
              "</span> </td>" +
              '   <td class="font-12 text-right">' +
              currency +
              '&nbsp;<span class="number">' +
              pTax +
              "</span> </td>" +
              '   <td class="font-12 text-right">' +
              currency +
              '&nbsp;<span class="number">' +
              pTotal +
              "</span> </td>" +
              " </tr>";

            $("#daily_report_product_details tbody").append(rowHTMLLine);
            productAllDataRow.push([
              p.product_name,
              p.product_sku,
              pQty,
              pSubtotal,
              pDiscount,
              pTax,
              pTotal,
            ]);
          }
        }


        // Qty is a count, so avoid showing .00 when it's a whole number
        var qtyValue = safeNum(qty);
        var qtyDecimals = qtyValue % 1 === 0 ? 0 : 2;
        $(".daily_report_qty_price").number(qtyValue, qtyDecimals);

        $(".daily_report_product_price").number(safeNum(price), 2);
        $(".daily_report_product_total").number(safeNum(total), 2);
        // $('.daily_report_product_profit').number(safeNum(profit), 2);

        // ---- Payments ----
        var paymentData =
          response.data && response.data.payment_details
            ? response.data.payment_details
            : [];
        var debtPaymentData = response.data && Array.isArray(response.data.debt_payment_details)
          ? response.data.debt_payment_details : [];
        var debtMethodLabels = { cash: 'Cash', card: 'Card', tpe: 'TPE', baridimob: 'BaridiMob', bank_transfer: 'Bank Transfer', other: 'Other' };
        paymentData = paymentData.slice();
        debtPaymentData.forEach(function (debt) {
          var raw = String(debt.payment_mode || 'other').toLowerCase();
          var label = debtMethodLabels[raw] || raw;
          paymentData.push({ payment_mode: label, sale_payment: safeNum(debt.amount), is_debt_collection: true });
        });
        $("#daily_report_tender_details tbody").children("tr").remove();
        var tenderTotal = 0;
        var paymentHeaderRow = ["paymentMode", "amount"];
        var paymentAllDataRow = [];

        // Group payment modes case/whitespace-insensitively so that
        // variants like "Upi" and "upi" are combined into one row.
        var groupedPayments = {};
        var paymentKeys = [];
        for (var j = 0; j < paymentData.length; j++) {
          var pm = paymentData[j] || {};
          var rawMode = trim(pm.payment_mode || "");
          var key = rawMode.toLowerCase();
          var amt = safeNum(pm.sale_payment);

          if (!groupedPayments[key]) {
            groupedPayments[key] = {
              label: rawMode || "Unknown",
              amount: 0,
            };
            paymentKeys.push(key);
          }
          groupedPayments[key].amount += amt;
        }

        // Additional Discount - show detailed breakdown by type (calculate before tender)
        let extraDiscountData = response.data && response.data.extra_discount ? response.data.extra_discount : {};
        let total_sale_extra_discount = safeNum(extraDiscountData.total_sale_extra_discount) || 0;
        let extraDiscountByType = extraDiscountData.by_type || [];

        // Hide table if no payment details
        if (!paymentData || paymentData.length === 0 || paymentKeys.length === 0) {
          $("#tender_type_heading").hide();
          $("#daily_report_tender_details").closest(".col-sm-12").hide();
        } else {
          $("#tender_type_heading").show();
          $("#daily_report_tender_details").closest(".col-sm-12").show();
        }

        for (var g = 0; g < paymentKeys.length; g++) {
          var k = paymentKeys[g];
          var entry = groupedPayments[k];
          var label = entry.label;
          var totalAmt = entry.amount;
          tenderTotal += totalAmt;

          var rowHTMLLine2 =
            " <tr> " +
            '   <td class="font-12 text-center">' +
            (g + 1) +
            "</td>" +
            '   <td class="font-12 text-left">' +
            esc(label) +
            "</td>" +
            '   <td class="font-12 text-right">' +
            currency +
            '&nbsp;<span class="number">' +
            totalAmt +
            "</span> </td>" +
            " </tr>";

          $("#daily_report_tender_details tbody").append(rowHTMLLine2);
          paymentAllDataRow.push([label, totalAmt]);
        }
        
        // Re-check after loop to hide if total is still 0
        if (tenderTotal <= 0) {
          $("#tender_type_heading").hide();
          $("#daily_report_tender_details").closest(".col-sm-12").hide();
        }
        
        // Display tender total as-is (backend already accounts for discounts)
        $(".daily_report_product_tender_total").number(safeNum(tenderTotal), 2);

        /*
         * Keep the figures the screen just showed, for the printed slip.
         *
         * The slip has to agree with the page to the paisa, and the page does
         * real work to get here: payment modes are grouped so that "Upi" and
         * "upi" become one row, and the totals are summed from the line
         * detail. Recomputing any of that separately is how a printed report
         * and the screen it came from end up disagreeing with each other.
         */
        PosnicPro.quickreport.lastReport = {
          branch: branchData,
          period: branchData.period_label || 'Full day',
          from: startDate,
          to: endDate,
          qty: safeNum(qty),
          subtotal: safeNum(price),
          total: safeNum(total),
          payments: paymentAllDataRow.map(function (row) {
            return { label: row[0], amount: safeNum(row[1]) };
          }),
          tenderTotal: safeNum(tenderTotal),
          products: productAllDataRow.map(function (row) {
            return { name: row[0], qty: safeNum(row[2]), total: safeNum(row[6]) };
          }),
          profit: safeNum(profit),
          cost_of_goods: Math.max(0, safeNum(total) - safeNum(profit)),
          gross_profit: safeNum(profit),
          sales_count: response.data && (response.data.sales_count != null ? response.data.sales_count : response.data.number_of_sales != null ? response.data.number_of_sales : response.data.total_sales_count != null ? response.data.total_sales_count : response.data.salesCount),
          expenses: response.data && (response.data.expenses_total != null ? response.data.expenses_total : response.data.total_expenses != null ? response.data.total_expenses : response.data.expenses != null ? response.data.expenses : response.data.expense_total),
          debt_payment_total: safeNum(response.data && response.data.debt_payment_total),
          debt_payments: debtPaymentData.map(function (row) { return { method: row.payment_mode, amount: safeNum(row.amount), count: safeNum(row.count) }; }),
        };
        $(document).trigger('dayCloseReportUpdated', [PosnicPro.quickreport.lastReport]);

        var summaryCash = 0, summaryCard = 0;
        PosnicPro.quickreport.lastReport.payments.forEach(function (payment) {
          if (/^cash$/i.test(payment.label)) summaryCash += payment.amount;
          if (/^card$/i.test(payment.label)) summaryCard += payment.amount;
        });
        var summary = $('#daily-payment-summary').empty().addClass('d-flex flex-wrap');
        summary.css('gap', '16px');
        [['Cash received', summaryCash], ['Card received', summaryCard], ['Total payments received', tenderTotal]].forEach(function (entry) {
          var card = $('<div class="card p-3 mb-1">');
          $('<span>').text(entry[0]).appendTo(card);
          $('<strong class="h4 mb-0">').text((PosnicPro.local.get('currencySign') || '') + safeNum(entry[1]).toFixed(2)).appendTo(card);
          summary.append(card);
        });

        // The PDF's Summary section - the on-screen stat cards are divs the
        // exporter cannot gather, so the numbers ride this hidden table.
        (function () {
          var money = function (n) { return Number(n || 0).toFixed(2); };
          var rows = '<tr><td><lang class="lang_total_sales">Total sales</lang></td><td class="text-right">' + money(PosnicPro.quickreport.lastReport.total) + '</td></tr>'
            + '<tr><td><lang class="lang_items_sold">Items sold</lang></td><td class="text-right">' + PosnicPro.quickreport.lastReport.qty + '</td></tr>'
            + '<tr><td><lang class="lang_payments_received">Payments received</lang></td><td class="text-right">' + money(PosnicPro.quickreport.lastReport.tenderTotal) + '</td></tr>';
          PosnicPro.quickreport.lastReport.payments.forEach(function (p) {
            rows += '<tr><td>' + $('<i>').text(p.label).html() + '</td><td class="text-right">' + money(p.amount) + '</td></tr>';
          });
          $('#dayend_export_summary_body').html(rows);
        })();
        
        // Clear existing rows
        $("#daily_report_extra_discount_details tbody").children("tr").remove();
        
        // Hide table if no extra discount
        if (total_sale_extra_discount <= 0) {
          $("#extra_discount_heading").hide();
          $("#daily_report_extra_discount_details").closest(".col-sm-12").hide();
        } else {
          $("#extra_discount_heading").show();
          $("#daily_report_extra_discount_details").closest(".col-sm-12").show();
          
          // Add rows for each discount type
          if (extraDiscountByType.length > 0) {
            let currency = PosnicPro.local.get('currencySign') || '₹';
            
            extraDiscountByType.forEach(function(item) {
              let discountType = item.type || 'amount';
              let discountAmount = safeNum(item.sale_extra_discount_total) || 0;
              let discountValue = safeNum(item.extra_discount_total) || 0;
              
              if (discountAmount > 0) {
                let typeLabel = '';
                if (discountType === 'percent' || discountType === 'percentage') {
                  typeLabel = 'Percentage Discount (' + discountValue + '%)';
                } else if (discountType === 'amount' || discountType === 'price') {
                  typeLabel = 'Amount Discount';
                } else {
                  typeLabel = 'Additional Discount';
                }
                
                let rowHTML = '<tr>' +
                  '<td class="text-left">' + typeLabel + '</td>' +
                  '<td class="text-right">' + currency + ' <span class="number">' + discountAmount.toFixed(2) + '</span></td>' +
                  '</tr>';
                
                $("#daily_report_extra_discount_details tbody").append(rowHTML);
              }
            });
          }
        }
        
        $(".daily_report_extra_discount_total").number(total_sale_extra_discount, 2);

        // ---- Table-wise totals ----
        var tableSummary =
          response.data && response.data.table_summary
            ? response.data.table_summary
            : [];

        if (PosnicPro.local.get("table_options") !== "enable") {
          $("#daily_report_table_summary tbody").children("tr").remove();
          $(".daily_report_table_total").text("0.00");
          $(".daily_report_table_pax").text("");
          $("#daily_report_table_summary").closest(".col-sm").hide();
          $(".table-dine-summary-section").hide();
        } else {
          $(".table-dine-summary-section").show();
          $("#daily_report_table_summary").closest(".col-sm").show();
          $("#daily_report_table_summary tbody").children("tr").remove();

          var tableTotal = 0;
          var tablePaxTotal = 0;
          for (var s = 0; s < tableSummary.length; s++) {
            var row = tableSummary[s];
            var name = row.name || "" + (row.table_number || "");
            var amt = safeNum(row.total_amount);
            var pax = safeNum(row.table_pax);

            tableTotal += amt;
            if (pax > 0) {
              tablePaxTotal += pax;
            } else {
              pax = "";
            }

            var rowHTMLTable =
              " <tr> " +
              '   <td class="font-12 text-center">' +
              (s + 1) +
              "</td>" +
              '   <td class="font-12 text-left">' +
              esc(name) +
              "</td>" +
              '   <td class="font-12 text-center">' +
              pax +
              "</td>" +
              '   <td class="font-12 text-right">' +
              currency +
              '&nbsp;<span class="number">' +
              amt +
              "</span> </td>" +
              " </tr>";

            $("#daily_report_table_summary tbody").append(rowHTMLTable);
          }

          $(".daily_report_table_total").number(safeNum(tableTotal), 2);
          $(".daily_report_table_pax").text(
            tablePaxTotal > 0 ? tablePaxTotal : ""
          );

          // Show/hide Pax column itself based on whether we have any positive pax
          var $tablePaxCells = $(
            "#daily_report_table_summary thead td:nth-child(3)," +
              "#daily_report_table_summary tbody td:nth-child(3)," +
              "#daily_report_table_summary tfoot td:nth-child(3)"
          );
          if (tablePaxTotal > 0) {
            $tablePaxCells.show();
          } else {
            $tablePaxCells.hide();
          }
        }
        // ---- Taxes (aggregated from API) ----
        var taxDetails =
          response.data && response.data.tax_details
            ? response.data.tax_details
            : [];
        $("#daily_report_tax_details tbody").children("tr").remove();

        var taxTotal = 0;
        var taxHeaderRow = ["taxName", "amount"];
        var taxAllDataRow = [];

        // Hide table if no tax details
        if (!taxDetails || taxDetails.length === 0) {
          $("#tax_type_heading").hide();
          $("#daily_report_tax_details").closest(".col-sm-12").hide();
        } else {
          $("#tax_type_heading").show();
          $("#daily_report_tax_details").closest(".col-sm-12").show();
        }

        for (var t = 0; t < taxDetails.length; t++) {
          var row = taxDetails[t];
          var taxName = row.tax_name;
          var totalTax = safeNum(row.total_tax);
          taxTotal += totalTax;

          var rowHTMLTaxLine =
            " <tr> " +
            '   <td class="font-12 text-center">' +
            (t + 1) +
            "</td>" +
            '   <td class="font-12 text-left">' +
            esc(taxName) +
            "</td>" +
            '   <td class="font-12 text-right">' +
            currency +
            '&nbsp;<span class="number">' +
            totalTax +
            "</span> </td>" +
            " </tr>";

          $("#daily_report_tax_details tbody").append(rowHTMLTaxLine);
          taxAllDataRow.push([taxName, totalTax]);
        }
        
        // Re-check after loop to hide if total is still 0
        if (taxTotal <= 0) {
          $("#tax_type_heading").hide();
          $("#daily_report_tax_details").closest(".col-sm-12").hide();
        }
        
        $(".daily_report_product_tax_total").number(safeNum(taxTotal), 2);
        
        if (PosnicPro.local.get("table_options") === "enable") {
          $("#daily_report_dine_details").show();
        } else {
          $("#daily_report_dine_details").hide();
        }

        // ---- Dine Type (aggregated from API) ----
        var dineDetails =
          response.data && response.data.dine_details
            ? response.data.dine_details
            : [];
        $("#daily_report_dine_details tbody").children("tr").remove();

        var dineCountTotal = 0;
        var dinePaxTotal = 0;
        var dineAmountTotal = 0;
        var dineHeaderRow = ["Dine Type", "Count", "Pax", "Amount"];
        var dineAllDataRow = [];

        for (var d = 0; d < dineDetails.length; d++) {
          var row = dineDetails[d];
          var dType = row.dine_type || "Unknown";
          var dCount = safeNum(row.dine_count);

          // Support different backend field names for pax
          var rawPax = null;
          if (row.dine_pax != null) {
            rawPax = row.dine_pax;
          } else if (row.pax != null) {
            rawPax = row.pax;
          } else if (row.person_count != null) {
            rawPax = row.person_count;
          }
          var dPax = safeNum(rawPax);

          var dAmount = safeNum(row.dine_amount);

          dineCountTotal += dCount;
          // Only accumulate pax when it is a positive number
          if (dPax > 0) {
            dinePaxTotal += dPax;
          } else {
            dPax = "";
          }
          dineAmountTotal += dAmount;

          var rowHTMLDine =
            " <tr> " +
            '   <td class="font-12 text-center">' +
            (d + 1) +
            "</td>" +
            '   <td class="font-12 text-left">' +
            esc(dType) +
            "</td>" +
            '   <td class="font-12 text-center">' +
            dCount +
            "</td>" +
            '   <td class="font-12 text-center">' +
            dPax +
            "</td>" +
            '   <td class="font-12 text-right">' +
            currency +
            '&nbsp;<span class="number">' +
            dAmount +
            "</span> </td>" +
            " </tr>";

          $("#daily_report_dine_details tbody").append(rowHTMLDine);
          dineAllDataRow.push([dType, dCount, dPax, dAmount]);
        }
        $(".daily_report_dine_count").text(dineCountTotal);
        // If total pax is 0, keep footer blank instead of showing 0
        $(".daily_report_dine_pax").text(dinePaxTotal > 0 ? dinePaxTotal : "");
        $(".daily_report_dine_total").number(safeNum(dineAmountTotal), 2);

        // Show/hide Pax column itself based on whether we have any positive pax
        // Note: the header uses <td>, not <th>, so target td in thead.
        var $paxCells = $(
          "#daily_report_dine_details thead td:nth-child(4)," +
            "#daily_report_dine_details tbody td:nth-child(4)," +
            "#daily_report_dine_details tfoot td:nth-child(4)"
        );
        if (dinePaxTotal > 0) {
          $paxCells.show();
        } else {
          $paxCells.hide();
        }

        // format numeric spans
        $("span.number").number(true, 2);

        // ---- CSV Export (ES5-safe) ----
        if (type === "CSV") {
          var csv = [];
          var k;

          // products
          csv.push(productHeaderRow);
          for (k = 0; k < productAllDataRow.length; k++) {
            csv.push(productAllDataRow[k]);
          }

          // branch
          csv.push(branchHeaderRow);
          csv.push(branchDataRow);

          // payments
          csv.push(paymentHeaderRow);
          for (k = 0; k < paymentAllDataRow.length; k++) {
            csv.push(paymentAllDataRow[k]);
          }

          // dine types
          csv.push(dineHeaderRow);
          for (k = 0; k < dineAllDataRow.length; k++) {
            csv.push(dineAllDataRow[k]);
          }

          // taxes
          csv.push(taxHeaderRow);
          for (k = 0; k < taxAllDataRow.length; k++) {
            csv.push(taxAllDataRow[k]);
          }

          PosnicPro.JSONToCSVConvertor(csv, "Daily", true);
        }
      },
      function (xhr) {
        if (requestId !== PosnicPro.quickreport.requestId) return;
        $("#daily-meal-status").text("Could not update the report. Please try again.");
        loader.find(".loadingSpinner:first").remove();
        var response;
        try {
          response = jQuery.parseJSON(xhr.responseText || "{}");
        } catch (e) {
          response = { type: "error", message: "Request failed" };
        }
        PosnicPro.alert(
          response.type || "error",
          response.message || "Request failed"
        );
      }
    );
  },

  viewReportSaleExport: function (index) {
    var type = $(index).data("id");
    PosnicPro.quickreport.salereportTable(type);
  },
  saleTableTabClick: function () {
    $("#change_sale_view").data("id", "tableView");
    $(".hide-sale-details").prop("disabled", false);
  },
  dailyReportCsv: function () {
    PosnicPro.quickreport.salereportTable("CSV");
  },

  /*
   * Print the daily report to the till printer.
   *
   * On a roll this is not the report with columns removed - it is a cash-up
   * slip, which is a different document with a different job. The A4 report is
   * an accounting record that wants every line; the slip is what somebody
   * tears off at closing, counts the drawer against, signs, and puts in the
   * cash bag. So it leads with what was sold, what of it was cash and what was
   * UPI, and ends with somewhere to write the count.
   *
   * Per-product detail is deliberately not on it. A grocery sells four hundred
   * lines a day, and printing them is several feet of paper nobody reads. The
   * ten largest by value are worth having; the rest is what the A4 copy and
   * the emailed PDF are for.
   *
   * On A4 nothing changes: the page prints as a page, because it is one.
   */
  printDailyReport: function () {
    var report = PosnicPro.quickreport.lastReport;
    if (!report) {
      PosnicPro.alert('warning', PosnicPro.i18n.t('lang_run_the_report_first_then_print_it', 'Run the report first, then print it.'));
      return false;
    }

    var width = PosnicPro.resolvePaperWidth();

    // A4 is a sheet, and the browser has no raw printer to send bytes to
    // either. Both go through the page path that already exists.
    if (width === 'a4' || !window.electronAPI || !window.electronAPI.printer
        || !window.electronAPI.printer.printReport) {
      // Web / A4: a real vector PDF on its own white palette - never a
      // themed screenshot (owner: professional A4 layout, theme-free).
      PosnicPro.reportExport.printPdf('export_daily_report', PosnicPro.quickreport._exportMeta());
      return false;
    }

    PosnicPro.quickreport._printSlipElectron(report, width);
    return false;
  },

  /* Export identity shared by PDF / CSV / Excel. */
  _exportMeta: function () {
    var report = PosnicPro.quickreport.lastReport || {};
    var b = report.branch || {};
    return {
      shop: b.branch_name || '',
      address: b.branch_address || b.address || '',
      phone: b.branch_telephone || b.phone || '',
      title: PosnicPro.i18n.t('lang_day_end_summary', 'Day-End Summary'),
      range: (report.from && report.to) ? report.from + ' - ' + report.to + ' · ' + (report.period || 'Full day') : '',
      filename: 'day-end-summary'
    };
  },

  exportCsv: function () {
    if (!PosnicPro.quickreport.lastReport) { PosnicPro.alert('warning', PosnicPro.i18n.t('lang_run_the_report_first_then_export_it', 'Run the report first, then export it.')); return false; }
    PosnicPro.reportExport.csv('export_daily_report', PosnicPro.quickreport._exportMeta());
    return false;
  },

  exportXls: function () {
    if (!PosnicPro.quickreport.lastReport) { PosnicPro.alert('warning', PosnicPro.i18n.t('lang_run_the_report_first_then_export_it', 'Run the report first, then export it.')); return false; }
    PosnicPro.reportExport.xls('export_daily_report', PosnicPro.quickreport._exportMeta());
    return false;
  },

  /*
   * The dedicated day-close slip (owner: many shops have ONLY thermal
   * printers). Desktop prints through the thermal rail; the web renders
   * the same slip narrow and hands it to the browser's print dialog, so
   * a driver-connected thermal printer works there too.
   */
  printDaySlip: function () {
    var report = PosnicPro.quickreport.lastReport;
    if (!report) { PosnicPro.alert('warning', PosnicPro.i18n.t('lang_run_the_report_first_then_print_the_slip', 'Run the report first, then print the slip.')); return false; }
    var width = PosnicPro.resolvePaperWidth();
    if (window.electronAPI && window.electronAPI.printer && window.electronAPI.printer.printReport
        && width !== 'a4') {
      PosnicPro.quickreport._printSlipElectron(report, width);
      return false;
    }
    var doc = PosnicPro.quickreport._slipDoc(report);
    var esc = function (v) { return $('<i>').text(v == null ? '' : v).html(); };
    var h = '<div class="slip">';
    h += '<div class="c b big">' + esc(doc.shop) + '</div>';
    h += '<div class="c b">' + esc(doc.title) + '</div><hr>';
    doc.meta.forEach(function (m) { h += '<div class="r"><span>' + esc(m.label) + '</span><span>' + esc(m.value) + '</span></div>'; });
    doc.sections.forEach(function (sec) {
      h += '<hr>';
      if (sec.name) { h += '<div class="b">' + esc(sec.name) + '</div>'; }
      if (sec.type === 'pairs' || sec.type === 'blanks') {
        (sec.rows || []).forEach(function (row) {
          if (typeof row === 'string') { h += '<div class="r"><span>' + esc(row) + '</span><span class="fill"></span></div>'; }
          else { h += '<div class="r"><span>' + esc(row.label) + '</span><span>' + esc(row.value) + '</span></div>'; }
        });
        if (sec.total) { h += '<div class="r b"><span>' + esc(sec.total.label) + '</span><span>' + esc(sec.total.value) + '</span></div>'; }
      } else if (sec.type === 'total') {
        h += '<div class="r b big"><span>' + esc(sec.label) + '</span><span>' + esc(sec.value) + '</span></div>';
      } else if (sec.type === 'items') {
        (sec.rows || []).forEach(function (row) {
          h += '<div class="r"><span>' + esc(row.name) + ' x' + esc(row.qty) + '</span><span>' + esc(row.amount) + '</span></div>';
        });
      } else if (sec.type === 'note') {
        h += '<div class="note">' + esc(sec.text) + '</div>';
      }
    });
    h += '</div>';
    var w = window.open('', '_blank');
    if (!w) { PosnicPro.alert('warning', PosnicPro.i18n.t('lang_allow_pop_ups_so_the_slip_can_print', 'Allow pop-ups so the slip can print.')); return false; }
    w.document.write('<html><head><title>Day-Close Slip</title><style>'
      + '@page{margin:4mm;}body{margin:0;font-family:Consolas,Menlo,monospace;font-size:12px;color:#000;background:#fff;}'
      + '.slip{width:72mm;}.c{text-align:center;}.b{font-weight:700;}.big{font-size:15px;}'
      + '.r{display:flex;justify-content:space-between;gap:6px;padding:1px 0;}'
      + '.fill{flex:1;border-bottom:1px dotted #000;margin-left:6px;}'
      + 'hr{border:none;border-top:1px dashed #000;margin:5px 0;}.note{margin-top:6px;font-size:10px;}'
      + '</style></head><body>' + h
      + '<script>setTimeout(function(){window.focus();window.print();},80);<' + '/script></body></html>');
    w.document.close();
    return false;
  },

  /* The slip document, one builder for both print rails. */
  _slipDoc: function (report) {
    var money = function (n) { return Number(n || 0).toFixed(2); };

    // Cash is the figure the slip exists for, so it is named rather than left
    // for the reader to find among the other tenders.
    var cash = 0;
    for (var i = 0; i < report.payments.length; i++) {
      if (/^cash$/i.test(report.payments[i].label)) cash += report.payments[i].amount;
    }

    var top = report.products.slice().sort(function (a, b) {
      return b.total - a.total;
    }).slice(0, 10);

    var doc = {
      shop: report.branch.branch_name || '',
      title: PosnicPro.i18n.t('lang_daily_sales', 'DAILY SALES'),
      meta: [
        { label: PosnicPro.i18n.t('lang_from', 'From'), value: report.from },
        { label: PosnicPro.i18n.t('lang_to_2', 'To'), value: report.to },
        { label: PosnicPro.i18n.t('lang_sales_period', 'Sales period'), value: report.period || 'Full day' },
        { label: PosnicPro.i18n.t('lang_printed_2', 'Printed'), value: new Date().toLocaleString('en-IN') },
        { label: PosnicPro.i18n.t('lang_by', 'By'), value: PosnicPro.local.get('loginuser_name') || '' }
      ],
      sections: [
        { type: 'pairs', name: 'SALES', rows: [
          { label: PosnicPro.i18n.t('lang_items_sold', 'Items sold'), value: String(report.qty) },
          { label: PosnicPro.i18n.t('lang_subtotal', 'Subtotal'), value: money(report.subtotal) }
        ] },
        { type: 'total', label: PosnicPro.i18n.t('lang_total_sales_2', 'TOTAL SALES'), value: money(report.total) },
        { type: 'pairs', name: 'PAYMENTS',
          rows: report.payments.map(function (p) {
            return { label: p.label, value: money(p.amount) };
          }),
          total: { label: PosnicPro.i18n.t('lang_total_received', 'Total received'), value: money(report.tenderTotal) } },
        /*
         * The cash figure sits at the head of the handover block, directly
         * above the line the count goes on, because that is the comparison
         * the person signing is making.
         *
         * The rest is left blank on purpose. The app cannot know what is
         * physically in the drawer, and across a date range it cannot
         * honestly work out what ought to be either - a range can span
         * several register sessions, each with its own opening float.
         * Printing a computed "expected" from incomplete information would be
         * worse than printing a line to write on.
         */
        { type: 'blanks', name: 'HANDOVER', rows: [
          { label: PosnicPro.i18n.t('lang_cash_sales', 'Cash sales'), value: money(cash) },
          'Opening float', 'Cash counted', 'Difference', 'Handed to', 'Signature'
        ] },
        { type: 'items', name: 'TOP ITEMS BY VALUE',
          rows: top.map(function (p) {
            return { name: p.name, qty: String(p.qty), amount: money(p.total) };
          }) },
        { type: 'note', text: 'Full item detail is on the A4 copy and the emailed PDF.' }
      ]
    };
    return doc;
  },

  _printSlipElectron: function (report, width) {
    var doc = PosnicPro.quickreport._slipDoc(report);
    Promise.resolve(PosnicPro.resolveReceiptPrinter())
    .then(function (chosen) {
      return chosen || window.electronAPI.printer.getDefault();
    })
    .then(function (printerName) {
      if (printerName && typeof printerName === 'object') printerName = printerName.name || null;
      if (!printerName) {
        throw new Error('No printer found. Choose one in Hardware Manager, Receipt Printer.');
      }
      return window.electronAPI.printer.printReport(doc, {
        printerName: printerName,
        paperWidth: width,
        docName: 'Daily Sales'
      });
    })
    .then(function (result) {
      if (!result || !result.success) {
        PosnicPro.alert('error', (result && result.error) || 'Print failed');
      }
    })
    .catch(function (err) {
      PosnicPro.alert('error', (err && err.message) ? err.message : PosnicPro.i18n.t('lang_print_failed', 'Print failed'));
    });

    return false;
  },

  // Shared: render the on-screen report body (#export_daily_report) to a canvas
  // so Print and Download produce the SAME thing the user sees - no separate
  // server template, no blank page. White background keeps it print-clean on
  // any theme (dark themes included).
  _captureReport: function (onCanvas) {
    var el = document.getElementById('export_daily_report');
    if (!el) { PosnicPro.alert('warning', PosnicPro.i18n.t('lang_run_the_report_first_then_try_again', 'Run the report first, then try again.')); return; }
    /* html2canvas loads on first use. This also FIXES the dashboard: the
       library was only ever bundled into the mail-print page, so this check
       used to fail on every till with "Report tools not loaded". */
    PosnicPro.lazy.load('html2canvas').then(function () {
      var scale = Math.min(3, Math.max(2, (window.devicePixelRatio || 1) * 1.5));
      window.html2canvas(el, {
        scale: scale,
        useCORS: true,
        backgroundColor: '#ffffff',
        width: el.scrollWidth,
        height: el.scrollHeight,
        windowWidth: el.scrollWidth,
        logging: false
      }).then(function (canvas) {
        onCanvas(canvas);
      }).catch(function (err) {
        PosnicPro.alert('error', 'Could not render the report: ' + (err && err.message ? err.message : err));
      });
    });
  },

  dailyReportPdf: function () {
    var report = PosnicPro.quickreport.lastReport;
    if (!report) { PosnicPro.alert('warning', PosnicPro.i18n.t('lang_run_the_report_first_then_download_it', 'Run the report first, then download it.')); return false; }
    PosnicPro.lazy.load('jspdf').then(function () {
      PosnicPro.quickreport._buildPdf();
    });
    return false;
  },

  _buildPdf: function () {
    PosnicPro.reportExport.pdf('export_daily_report', PosnicPro.quickreport._exportMeta());
    return false;
  },

  _buildPdfLegacyScreenshot: function () {
    // The bundled jsPDF exposes its constructor differently across builds:
    // window.jspdf.jsPDF (2.x UMD returning {jsPDF}), window.jsPDF (1.x global),
    // or window.jspdf itself when the UMD returns the constructor directly (our
    // bundle) - the last case made "window.jspdf.jsPDF" undefined and threw
    // "jsPDF is not a constructor". Resolve it robustly.
    var jsPDFCtor = (window.jspdf && typeof window.jspdf.jsPDF === 'function') ? window.jspdf.jsPDF
                  : (typeof window.jsPDF === 'function') ? window.jsPDF
                  : (typeof window.jspdf === 'function') ? window.jspdf
                  : null;
    if (!jsPDFCtor) { PosnicPro.alert('error', PosnicPro.i18n.t('lang_pdf_tools_not_loaded_refresh_and_retry', 'PDF tools not loaded - refresh and retry.')); return false; }
    PosnicPro.quickreport._captureReport(function (canvas) {
      var imgData = canvas.toDataURL('image/png');
      var pageW = 210, pageH = 297, margin = 8;         // A4 portrait, mm
      var contentW = pageW - margin * 2;
      var imgH = (canvas.height * contentW) / canvas.width;
      var pageContentH = pageH - margin * 2;
      var pdf = new jsPDFCtor({ unit: 'mm', format: 'a4', orientation: 'portrait' });
      var position = margin;
      var heightLeft = imgH;
      pdf.addImage(imgData, 'PNG', margin, position, contentW, imgH, undefined, 'FAST');
      heightLeft -= pageContentH;
      while (heightLeft > 0) {
        position = margin - (imgH - heightLeft);
        pdf.addPage();
        pdf.addImage(imgData, 'PNG', margin, position, contentW, imgH, undefined, 'FAST');
        heightLeft -= pageContentH;
      }
      pdf.save('quick-sale-report.pdf');
    });
    return false;
  },

  dailyReportEmail: function () {
    $("#to_email_value").val("");
    $("#to_email_modal").modal("show");
  },

  emailFormSubmit: function () {
    const email = ($("#to_email_value").val() || "").trim();
    const branchId = ($("#dailysale_branch_value").val() || "")
      .toString()
      .trim();
    const daterange = ($("#view_dailysale_report_daterange").val() || "").trim();

    // basic guards
    if (!branchId) {
      PosnicPro.alert("error", "Choose a shop");
      return;
    }
    if (!daterange) {
      PosnicPro.alert("error", "Choose a date range");
      return;
    }
    // quick email check (client-side only; server still validates)
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      PosnicPro.alert("error", "Enter a valid email address");
      return;
    }

    // robust split: "MM/DD/YYYY - MM/DD/YYYY"
    let fields = daterange.split(" - ");
    if (fields.length !== 2) fields = daterange.split("-").map((s) => s.trim());
    const startDate = (fields[0] || "").trim();
    const endDate = (fields[1] || "").trim();
    if (!startDate || !endDate) {
      PosnicPro.alert("error", "Select a valid date range");
      return;
    }

    const periodParams = PosnicPro.quickreport.periodParams();
    if (!periodParams) return;
    // fetch report data (use a stable type; do NOT read from date label)
    const getParams = {
      url: "sales/dailySalesReports",
      data: {
        branch: branchId,
        starting_date: startDate,
        ending_date: endDate,
        serving_period: periodParams.serving_period,
        start_time: periodParams.start_time,
        end_time: periodParams.end_time,
        type: "VIEW", // we just need the data payload for the email
      },
    };

    PosnicPro.get(
      getParams,
      function (resp1) {
        if (resp1.type !== "success") {
          PosnicPro.alert(resp1.type, resp1.message);
          return;
        }

        // send email with the fetched data
        const postParams = {
          url: "sales/dailySalesMail",
          data: JSON.stringify({
            email: email,
            data: resp1.data,
          }),
        };

        PosnicPro.post(
          postParams,
          function (resp2) {
            $("#to_email_value").val("");
            $("#to_email_modal").modal("hide");
            PosnicPro.alert(resp2.type, resp2.message);
          },
          function (xhr2) {
            let r = {};
            try {
              r = jQuery.parseJSON(xhr2.responseText || "{}");
            } catch (e) {}
            PosnicPro.alert(
              r.type || "error",
              r.message || "Email request failed"
            );
          }
        );
      },
      function (xhr1) {
        let r = {};
        try {
          r = jQuery.parseJSON(xhr1.responseText || "{}");
        } catch (e) {}
        PosnicPro.alert(
          r.type || "error",
          r.message || "Report request failed"
        );
      }
    );
  },
};

$(document).ready(function () {
  setTimeout(function () {
    var fullHash = window.location.hash;
    var hash = fullHash.replace(/^#\/?/, "");
    if (hash === "quickreport") {
      var loader = $(".loader-dailysale-report");
      loader.find(".loadingSpinner:first").remove();
      $("#view_dailysale_report_daterange")
        .data("daterangepicker")
        .setStartDate(moment().startOf("day"));
      $("#view_dailysale_report_daterange")
        .data("daterangepicker")
        .setEndDate(moment().endOf("day"));
      $("#view_dailysale_report_daterange span").html(
        '<span><lang class="lang_this_day">Today</lang></span>&nbsp;&nbsp;<span data-toggle="tooltip" data-placement="bottom" data-original-title="' +
          moment().startOf("day").format("YYYY/MM/DD h:mm A") +
          " - " +
          moment().endOf("day").format("YYYY/MM/DD h:mm A") +
          '"><i class="feather icon-help-circle setfeather_font"></i></span>'
      );
      $("#view_dailysale_report_daterange").val(
        moment().startOf("day").format("YYYY/MM/DD h:mm A") +
          " - " +
          moment().endOf("day").format("YYYY/MM/DD h:mm A")
      );

      PosnicPro.quickreport.salereportTable();
    }
  }, 3000);
});

// validate signup form on keyup and submit
$(".to_email_form").validate({
  highlight: function (element, errorClass) {
    $(element).css("border-color", "#f9616d");
  },
  unhighlight: function (element, errorClass) {
    $(element).css("border-color", "#eae8e8");
  },
  rules: {
    to_email_value: {
      required: true,
      email: true,
      emailExt: true,
      maxlength: 250,
    },
  },
  messages: {
    to_email_value: {
      required: "Enter a valid email address",
      maxlength: "Email should not be more than 250 Characters",
    },
  },
});

$("#to_email_modal").on("shown.bs.modal", function () {
  $(this).find("#to_email_value").focus();
});

$(".to_email_form").submit(function (event) {
  event.preventDefault();
  if ($(".to_email_form").valid()) {
    // checks form for validity
    PosnicPro.quickreport.emailFormSubmit();
  }
});

$(document).on('click', '#daily-meal-apply', function () { PosnicPro.quickreport.salereportTable('VIEW'); });

$(document).on('change', '#dailysale_branch_value', function () {
  PosnicPro.quickreport.meal = 'full';
  $('#daily-meal-custom').hide();
  PosnicPro.quickreport.loadPeriods();
  $('#daily-serving-period').val('');
});


/* Cash closing Ticket Studio: Receipt Studio print route + date agenda. */
(function($){
'use strict';
var key='posnic_day_close_studio_v2', historyKey='posnic_day_close_history', selected=null, blocks=[], reportCache=null;
var agendaDate=new Date(), selectedDate=new Date(), loadingDay=false;
var defaults=[['title','CLÔTURE DE CAISSE'],['date','Date de clôture'],['sales','Ventes'],['cost','Coût des marchandises'],['gross','Bénéfice brut'],['expenses','Dépenses'],['net','Bénéfice net'],['payments','Détail des paiements'],['debt','Encaissements de dettes'],['count','Nombre de ventes'],['footer','Clôture effectuée. Merci.']];
var labels={title:'CLÔTURE DE CAISSE',date:'Date de clôture',sales:'Ventes',cost:'Coût des marchandises',gross:'Bénéfice brut',expenses:'Dépenses',net:'Bénéfice net',payments:'Détail des paiements',debt:'Encaissements de dettes',count:'Nombre de ventes',text:'Texte libre',divider:'',footer:'Clôture effectuée. Merci.'};
function id(){return 'dc-'+Math.random().toString(36).slice(2,10);}
function iso(d){return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');}
function load(){try{var d=JSON.parse(localStorage.getItem(key)||'null');if(d&&Array.isArray(d.blocks)){blocks=d.blocks;['expenses','count','debt'].forEach(function(type){if(!blocks.some(function(b){return b.type===type;})){var at=type==='debt'?blocks.findIndex(function(b){return b.type==='payments';}):-1;blocks.splice(at>=0?at+1:blocks.length,0,{id:id(),type:type,label:labels[type],size:12,align:'left'});}});$('#dc-studio-width').val(d.width||'80');return;}}catch(e){}blocks=defaults.map(function(x){return {id:id(),type:x[0],label:x[1],size:x[0]==='title'?16:12,align:x[0]==='title'?'center':'left'};});}
function save(){try{localStorage.setItem(key,JSON.stringify({blocks:blocks,width:$('#dc-studio-width').val()||'80'}));$('#day-close-save-status').text('Modèle enregistré sur cet appareil.');}catch(e){$('#day-close-save-status').text('Impossible d’enregistrer le modèle.');}}
function esc(v){return $('<div>').text(v==null?'':String(v)).html();}
function num(v){var n=Number(v);return isFinite(n)?n:0;}
function metrics(){
 var r=PosnicPro.quickreport&&PosnicPro.quickreport.lastReport||reportCache||{}, payments=Array.isArray(r.payments)?r.payments:[], total=num(r.total!=null?r.total:r.sales_total), gross=num(r.gross_profit!=null?r.gross_profit:r.profit), cost=num(r.cost_of_goods!=null?r.cost_of_goods:(total-gross));
 var expenseRaw=r.expenses!=null?r.expenses:(r.expenses_total!=null?r.expenses_total:r.total_expenses), expensesAvailable=expenseRaw!=null&&typeof expenseRaw!=='object', expenses=num(expensesAvailable?expenseRaw:0);
 var pay={cash:0,credit:0,tpe:0,baridimob:0,other:0};
 payments.forEach(function(p){var l=String(p.label||p.name||'').trim().toLowerCase(),a=num(p.amount!=null?p.amount:p.total);if(/cash|esp[eè]ce/.test(l))pay.cash+=a;else if(/credit|cr[eé]dit|debt|dette/.test(l))pay.credit+=a;else if(/baridi/.test(l))pay.baridimob+=a;else if(/tpe|card|carte/.test(l))pay.tpe+=a;else pay.other+=a;});
 /* Some older API responses expose only the aggregate debt collection total. In that case, include it as cash, without double-counting when method-level debt details have already been merged into payments. */
 var debtDetails=Array.isArray(r.debt_payments)?r.debt_payments:[], debtTotal=num(r.debt_payment_total);
 if(!debtDetails.length&&debtTotal>0&&!payments.some(function(p){return p.is_debt_collection;})){pay.cash+=debtTotal;}
 var date=r.from||r.starting_date||iso(selectedDate), rawCount=r.sales_count!=null?r.sales_count:(r.number_of_sales!=null?r.number_of_sales:(r.total_sales_count!=null?r.total_sales_count:(Array.isArray(r.sales)?r.sales.length:null))), count=rawCount==null?null:num(rawCount);
 return {date:date,sales:total,cost:cost,gross:gross,expenses:expenses,expensesAvailable:expensesAvailable,net:gross-expenses,count:count,pay:pay,payments:payments,report:r};
}
function money(v){return num(v).toLocaleString('fr-DZ',{minimumFractionDigits:2,maximumFractionDigits:2})+' DA';}
function value(b,m){switch(b.type){case'date':return m.date;case'sales':return money(m.sales);case'cost':return m.report.cost_of_goods!=null||m.report.total_cost!=null?money(m.cost):'Non disponible dans le rapport';case'gross':return m.report.gross_profit!=null||m.report.profit!=null?money(m.gross):'Non disponible dans le rapport';case'expenses':return m.expensesAvailable?money(m.expenses):'Non disponible dans le rapport';case'net':return (m.report.gross_profit!=null||m.report.profit!=null)?money(m.net):'Non disponible dans le rapport';case'count':return m.count==null?'Non disponible dans le rapport':String(m.count);case'payments':var rows=m.payments.map(function(p){return String(p.label||p.name||'Autre')+': '+money(p.amount!=null?p.amount:p.total);});if(!m.payments.length){rows=['Cash: '+money(m.pay.cash),'Crédit: '+money(m.pay.credit),'TPE: '+money(m.pay.tpe),'BaridiMob: '+money(m.pay.baridimob)];if(m.pay.other)rows.push('Autres: '+money(m.pay.other));}else if(!m.report.debt_payments||!m.report.debt_payments.length){var debt=num(m.report.debt_payment_total);if(debt>0&&!m.payments.some(function(p){return p.is_debt_collection;})){rows.push('Cash (encaissements de dettes): '+money(debt));}}return rows.join('\n');case'debt':return money(m.report.debt_payment_total||0);default:return '';}}
function render(){
 var m=metrics(),$p=$('#day-close-ticket-preview').empty().css('width',($('#dc-studio-width').val()||80)+'mm');
 if(!blocks.length)$p.append('<div class="dc-studio-drop-hint">Glissez des éléments ici</div>');
 blocks.forEach(function(b){var val=value(b,m),isText=['title','text','footer','divider'].indexOf(b.type)>=0;var $b=$('<div class="dc-studio-block" draggable="true"></div>').attr({'data-dc-id':b.id,'data-dc-type':b.type,'style':'font-size:'+num(b.size||12)+'px;text-align:'+(b.align||'left')}).toggleClass('is-selected',b.id===selected);if(b.type==='divider')$b.html('&nbsp;');else if(isText)$b.text(b.label||labels[b.type]||'Texte libre');else $b.append($('<span>').text(b.label||labels[b.type]||b.type),$('<strong class="dc-value">').text(val));$p.append($b);});
 var b=blocks.find(function(x){return x.id===selected;});$('#dc-studio-label').val(b?b.label:'').prop('disabled',!b);$('#dc-studio-size').val(b?String(b.size||12):'12').prop('disabled',!b);$('#dc-studio-align').val(b?b.align||'left':'left').prop('disabled',!b);
}
function add(type,index){var b={id:id(),type:type,label:labels[type]||'Texte libre',size:type==='title'?16:12,align:['title','text','footer'].indexOf(type)>=0?'center':'left'};if(type==='text')b.label='Votre texte';blocks.splice(index==null?blocks.length:index,0,b);selected=b.id;render();}
function historySave(){try{var m=metrics(),hist=JSON.parse(localStorage.getItem(historyKey)||'[]'),day=iso(selectedDate),entry={date:day,title:'Clôture de caisse',report:m.report,blocks:blocks.slice(),width:$('#dc-studio-width').val()||'80'};hist=hist.filter(function(x){return x.date!==day;});hist.push(entry);localStorage.setItem(historyKey,JSON.stringify(hist.slice(-400)));}catch(e){}}
function printTicket(snapshot){
 if(snapshot){if(snapshot.blocks)blocks=snapshot.blocks;reportCache=snapshot.report||reportCache;selectedDate=new Date((snapshot.date||iso(new Date()))+'T12:00:00');}
 render();
 var engine=PosnicPro.receiptDesigner;
 if(!engine||typeof engine.print!=='function'){PosnicPro.alert('error','Receipt Studio print engine is unavailable.');return;}
 var width=Number($('#dc-studio-width').val()||snapshot&&snapshot.width||80), html='<!doctype html><html><head><meta charset="utf-8"><style>@page{size:'+width+'mm auto;margin:2mm}html,body{margin:0;padding:0;background:#fff;color:#111;font:12px/1.4 Arial,sans-serif}.dc-print-paper{box-sizing:border-box;width:'+(width-8)+'mm;padding:0 1mm;margin:0 auto}.dc-studio-block{display:flex;justify-content:space-between;gap:6px;align-items:flex-start;padding:4px 1px;white-space:pre-wrap;overflow-wrap:anywhere}.dc-studio-block[data-dc-type=title],.dc-studio-block[data-dc-type=text],.dc-studio-block[data-dc-type=footer]{display:block;text-align:center}.dc-studio-block .dc-value{font-weight:700;text-align:right}.dc-studio-block[data-dc-type=divider]{height:1px;border-top:1px dashed #111;margin:4px 0;padding:0}</style></head><body><main class="dc-print-paper">'+$('#day-close-ticket-preview').html()+'</main></body></html>';
 try{var result=engine.print(html,width===58?'58':'80',{showDialog:true,showPreview:true,title:'Clôture de caisse'});if(result&&typeof result.then==='function')result.then(function(r){if(r&&r.success===false)PosnicPro.alert('error',r.message||'Impossible d’ouvrir l’impression.');}).catch(function(e){PosnicPro.alert('error',e.message||'Erreur d’impression.');});}
 catch(e){PosnicPro.alert('error',e.message||'Erreur lors de la préparation du ticket.');}
}
function renderAgenda(){
 var $a=$('#dc-studio-agenda').empty(),y=agendaDate.getFullYear(),mo=agendaDate.getMonth(),first=new Date(y,mo,1),days=new Date(y,mo+1,0).getDate(),offset=(first.getDay()+6)%7;
 $('#dc-agenda-month').text(agendaDate.toLocaleDateString('fr-FR',{month:'long',year:'numeric'}));
 ['Lun','Mar','Mer','Jeu','Ven','Sam','Dim'].forEach(function(w){$a.append($('<div class="dc-agenda-weekday">').text(w));});
 for(var i=0;i<offset;i++)$a.append('<button type="button" class="dc-agenda-day is-empty" tabindex="-1" aria-hidden="true"></button>');
 var today=iso(new Date()),chosen=iso(selectedDate);
 for(var d=1;d<=days;d++){var date=new Date(y,mo,d),keyDate=iso(date),$btn=$('<button type="button" class="dc-agenda-day">').text(d).attr('data-date',keyDate);if(keyDate===today)$btn.addClass('is-today');if(keyDate===chosen)$btn.addClass('is-selected');$a.append($btn);}
}
function loadDay(date){
 selectedDate=new Date(date+'T12:00:00');renderAgenda();$('#dc-agenda-status').text('Chargement du rapport réel pour '+date+'…');loadingDay=true;
 var start=moment(selectedDate).startOf('day').format('YYYY/MM/DD h:mm A'),end=moment(selectedDate).endOf('day').format('YYYY/MM/DD h:mm A');
 var $range=$('#view_dailysale_report_daterange');$range.val(start+' - '+end);$range.find('span').first().text(start+' - '+end);
 if(typeof PosnicPro.quickreport.salereportTable==='function')PosnicPro.quickreport.salereportTable('VIEW');
 else $('#dc-agenda-status').text('Le rapport des ventes est indisponible.');
}
$(function(){
 if(!$('#day-close-ticket-tools').length)return;load();render();renderAgenda();
 $('#dc-studio-palette').on('click','button',function(){add($(this).data('dc-type'));}).on('dragstart','button',function(e){e.originalEvent.dataTransfer.setData('text/plain',$(this).data('dc-type'));});
 $('#day-close-ticket-preview').on('dragover',function(e){e.preventDefault();}).on('drop',function(e){e.preventDefault();var t=e.originalEvent.dataTransfer.getData('text/plain');if(t.indexOf('move:')===0)return;add(t);}).on('click','.dc-studio-block',function(){selected=$(this).data('dc-id');render();}).on('dragstart','.dc-studio-block',function(e){e.originalEvent.dataTransfer.setData('text/plain','move:'+$(this).data('dc-id'));}).on('dragover','.dc-studio-block',function(e){e.preventDefault();}).on('drop','.dc-studio-block',function(e){e.preventDefault();var raw=e.originalEvent.dataTransfer.getData('text/plain'),target=blocks.findIndex(function(b){return b.id===$(this).data('dc-id');}.bind(this));if(raw.indexOf('move:')===0){var from=blocks.findIndex(function(b){return b.id===raw.slice(5);});if(from>=0&&target>=0){var moved=blocks.splice(from,1)[0];blocks.splice(target,0,moved);selected=moved.id;render();}}else add(raw,target);});
 $('#dc-studio-label').on('input',function(){var b=blocks.find(function(x){return x.id===selected;});if(b){b.label=this.value;var pos=this.selectionStart;render();$('#dc-studio-label').trigger('focus').get(0).setSelectionRange(pos,pos);}});
 $('#dc-studio-size').on('change',function(){var b=blocks.find(function(x){return x.id===selected;});if(b){b.size=num(this.value);render();}});
 $('#dc-studio-align').on('change',function(){var b=blocks.find(function(x){return x.id===selected;});if(b){b.align=this.value;render();}});
 $('#dc-studio-delete').on('click',function(){blocks=blocks.filter(function(b){return b.id!==selected;});selected=null;render();});
 function move(n){var i=blocks.findIndex(function(b){return b.id===selected;}),j=i+n;if(i>=0&&j>=0&&j<blocks.length){var x=blocks.splice(i,1)[0];blocks.splice(j,0,x);render();}}
 $('#dc-studio-up').on('click',function(){move(-1);});$('#dc-studio-down').on('click',function(){move(1);});$('#dc-studio-width').on('change',render);$('#dc-studio-save').on('click',save);
 $('#day-close-ticket-print').off('click').on('click',function(){printTicket();});$('#day-close-history-refresh').off('click').on('click',function(){renderAgenda();});
 $('#dc-agenda-prev').on('click',function(){agendaDate=new Date(agendaDate.getFullYear(),agendaDate.getMonth()-1,1);renderAgenda();});
 $('#dc-agenda-next').on('click',function(){agendaDate=new Date(agendaDate.getFullYear(),agendaDate.getMonth()+1,1);renderAgenda();});
 $('#dc-studio-agenda').on('click','.dc-agenda-day[data-date]',function(){loadDay($(this).data('date'));});
 $(document).on('dayCloseReportUpdated',function(e,report){if(!report)return;reportCache=report;render();historySave();$('#dc-agenda-status').text('Rapport chargé pour '+iso(selectedDate)+'. Aperçu actualisé avec les données disponibles.');loadingDay=false;});
 var original=PosnicPro.quickreport.salereportTable;
 PosnicPro.quickreport.salereportTable=function(){var ret=original.apply(this,arguments);return ret;};
});
})(jQuery);
