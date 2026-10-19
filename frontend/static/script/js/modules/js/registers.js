PosnicPro.registers = {
    addLineTable: [],
    // Cash Register lives under Config > Modules now (user call): the old
    // #/registers route lands on Config with the Cash Register pane active.
    showDataTablePage: function () {
        PosnicPro.settings.showDataTablePage();
        $('#v-pills-cashregister-tab').click();
        PosnicPro.registers.paneInit();
    },
    paneInit: function () {
        $('#hide_show_cashbutton').hide();
        $('#cash_button_amount').hide();
        PosnicPro.users.registerMenuDetails();
        PosnicPro.registers.renderOverview();
        $('#user_name').html(PosnicPro.local.get('username'));
        $('#cash_outbutton_amount').hide();
        if ($("#denomTotal").is(":empty")) {
            $('#delete_denomination_modal').modal('hide');
            $("#delete").attr('disabled', true).css({"cursor": 'not-allowed', "color": '#d8d3d3', "border-color": '#d8d3d3'});
        } else {
            $("#delete").removeAttr('disabled', false).css({"cursor": 'pointer', "color": '#f9616d', "border-color": '#f9616d'});
        }
    },
    /*
     * The branch's registers and who holds each, at a glance - the page used
     * to show NOTHING unless you were mid-open or mid-close. Reuses the
     * annotated register list; pass data when a caller already fetched it.
     */
    renderOverview: function (data) {
        var paint = function (d) {
            var rows = (d && d.register_data) || [];
            PosnicPro.registers._overviewRows = rows;
            $('#register_overview_branch').text(
                PosnicPro.local.get('branchname') ? ' — ' + PosnicPro.local.get('branchname') : '');
            var html = '';
            for (var i = 0; i < rows.length; i++) {
                var r = rows[i];
                var status, action = '';
                if (r.in_use && r.in_use_by_me) {
                    status = '<span class="badge badge-success"><lang class="lang_open_your_session">Open, your session</lang></span>';
                    // Resume covers the browser that lost its local session
                    // record; when the session is already live here the
                    // details below the table are the whole story.
                    if (r.resume_required !== false || PosnicPro.local.get('userRegisterStatus') !== 'Open') {
                        action = '<button type="button" class="btn btn-primary btn-sm register-open-btn" data-idx="' + i + '"><i class="feather icon-unlock"></i> Resume</button>';
                    }
                } else if (r.in_use) {
                    status = '<span class="badge badge-warning">Open, ' +
                        $('<span>').text(r.in_use_by || 'another till').html() + '</span>';
                } else {
                    status = '<span class="badge badge-light"><lang class="lang_closed">Closed</lang></span>';
                    action = '<button type="button" class="btn btn-primary btn-sm register-open-btn" data-idx="' + i + '"><i class="feather icon-unlock"></i> Open</button>';
                }
                html += '<tr><td>' + (i + 1) + '</td><td>' +
                    $('<span>').text(r.register_name).html() + '</td><td>' + status +
                    '</td><td class="text-right">' + action + '</td></tr>';
            }
            if (!html) {
                html = '<tr><td colspan="4" class="text-muted"><lang class="lang_no_registers_configured_for_this_branch_ad">No registers configured for this branch - add them in Settings &gt; Branch.</lang></td></tr>';
            }
            $('#register_overview_body').html(html);
        };
        if (data && data.register_data) { paint(data); return; }
        PosnicPro.get({
            url: 'branches/userRegisterBranchSelect',
            data: { id: PosnicPro.local.get('branch_id_set') }
        }, function (response) {
            if (response.type === 'success') paint(response.data);
        }, function () { /* the page's other cards still render */ });
    },

    /* Row's Open/Resume button -> ask for the float -> open. */
    promptOpen: function (idx) {
        var r = (PosnicPro.registers._overviewRows || [])[idx];
        if (!r) return;
        PosnicPro.registers._openTarget = r;
        $('#register_open_name').text(r.register_name);
        $('#register_open_float').val('0.00');
        $('#register_open_modal').modal('show');
    },
    confirmOpen: function () {
        var r = PosnicPro.registers._openTarget;
        if (!r) return false;
        var params = {
            method: 'POST',
            url: 'registers/registerAdd',
            data: JSON.stringify({
                register_name: r.register_name,
                register_Id: r.register_id,
                opening_float: $('#register_open_float').val()
            })
        };
        PosnicPro.request(params, function (response) {
            if (response.type === 'success') {
                $('#register_open_modal').modal('hide');
                db.currentregister.put({id: '1', register_id: r.register_id,
                    register_name: r.register_name, register_status: 'open'});
                // Session locking: the server only accepts sales from the
                // session THIS open created - set every local the sale
                // payload reads, exactly like the login-path open does.
                PosnicPro.local.set('cash_register_id', response.data);
                PosnicPro.local.set('register_id', r.register_id);
                PosnicPro.local.set('register_name', r.register_name);
                PosnicPro.local.set('userRegisterStatus', 'Open');
                PosnicPro.local.set('hourAlertregister', 'false');
                PosnicPro.users.registerMenuDetails();
                PosnicPro.registers.renderOverview();
                PosnicPro.alert(response.type, response.message);
            } else {
                PosnicPro.alert(response.type, response.message);
            }
        }, function (xhr) {
            var response = jQuery.parseJSON(xhr.responseText);
            PosnicPro.alert(response.type, response.message);
        });
        return false;
    },

    showDelete: function (id) {
        PosnicPro.deleteTableRowData(id, 'registers');
    },
    showDetails: function (id) {
        var loader = $(".loader-view-register");
        loader.find(".loadingSpinner:first").remove();
        PosnicPro.showViewModal('registers');
        PosnicPro.registers.viewRegister(id);
    },
    /*To display the registers details form*/
    viewRegister: function (id) {
        var loader = $(".loader-view-register");
        $("<div class='loadingSpinner'></div>").appendTo(loader);
        $('#registers_view').modal('show');
        PosnicPro.get('registers/' + id, function (response) {
            if (response.type === 'success') {
                var data = response.data;
                PosnicPro.record_id = id;
                $('#register_view_name').text(data.register_name);
                $('#register_view_amount').text(data.register_amount.toFixed(2));
                $('#register_view_branch_name').text(data.branch_name);
                $('#register_view_sale_id').text(data.sales_id);
                var updateDate = PosnicPro.convertDate(data.date);
                $('#register_view_date').text(updateDate);
                $('#register_view_created_by').text(data.created_by);
                loader.find(".loadingSpinner:first").remove();
            } else {
                PosnicPro.alert(response.type, response.message);
            }
        });

    },
    deleteSelectedRegisters: function () {
        PosnicPro.deleteTableData(PosnicPro.registers_checkbox, 'registers');
    },

    //  Get cash register data and display function on whole
    cashReportRegister: function (id) {
        let loader = $(".loader-table-cashRegister");
        $("<div class='loadingSpinner'></div>").appendTo(loader);
        let params = {
            url: 'registers/cashRegisterOpenManual',
            data: {
                id: id
            }
        };
        PosnicPro.get(params, function (response) {
            $('#open_date').html($('#registeropen_date').html());
            if (response.type === 'success') {
                var data = response.data;
                PosnicPro.record_id = data._id;
                // Initialize denomination buttons
                PosnicPro.registers.initRegisterDenominationButtons();
                
                if (data.cashDenomDetail && Array.isArray(data.cashDenomDetail)) {
                    PosnicPro.registers.viewDenomination(data.cashDenomDetail['0']);
                    $('#updateDenominationBtn').show();
                    $('#saveDenominationBtn').hide();
                    PosnicPro.registers.hasDenominationData = true;
                } else {
                    // $('#addCashcalculation').show(); // Hidden by user request
                    $('#editCashcalculation').hide();
                    $('#saveDenominationBtn').show();
                    $('#updateDenominationBtn').hide();
                    PosnicPro.registers.hasDenominationData = false;
                    // Disable delete button when no denomination data
                    $("#delete").attr('disabled', true).css({"cursor": 'not-allowed', "color": '#d8d3d3', "border-color": '#d8d3d3'});
                    // Disable Update Denomination button when no denomination data
                    $("#updateDenominationBtn").attr('disabled', true).css({"cursor": 'not-allowed', "opacity": '0.5'});
                }
                PosnicPro.local.set('openDate', data.register_opendate);
                $('#reg_upd_id').val(data._id);
                PosnicPro.local.set('cash_register_id', data._id);
                
                // Get register_id - handle both ObjectId format and string
                console.log('Raw data.register_id:', data.register_id, 'Type:', typeof data.register_id);
                
                var registerId = data.register_id;
                if (registerId && typeof registerId === 'object' && registerId.$oid) {
                    registerId = registerId.$oid;
                    console.log('Extracted registerId from $oid:', registerId);
                } else if (registerId && typeof registerId === 'string') {
                    console.log('registerId is already a string:', registerId);
                } else {
                    console.log('registerId is undefined or invalid, using data._id as fallback');
                }
                
                PosnicPro.local.set('register_id', registerId || data._id);
                PosnicPro.local.set('register_name', data.register_name);
                
                // Store register_id in hidden field for reliable access
                $('#register_id_hidden').val(registerId || data._id);
                
                // Debug logging
                console.log('Final values - cash_register_id:', data._id, 'register_id:', registerId || data._id, 'hidden field:', $('#register_id_hidden').val());
                $('#expected_card_amount,#expected_cheque_amount,#expected_cash_amount').html('0.00');
                let cashGetAmount = data.countedAmount && data.countedAmount['0'] && data.countedAmount['0'].paymenttype == 'cash' ? data.countedAmount['0'].value : 0
                var diffrent_cash = parseFloat(cashGetAmount) - parseFloat($('#expected_cash_amount').html());
                $('#diffrent_cash_amount').html(diffrent_cash.toFixed(2));
                $('#counted_cash_amount').editable('setValue', cashGetAmount);
                let cardGetAmount = data.countedAmount && data.countedAmount['1'] && data.countedAmount['1'].paymenttype == 'card' ? data.countedAmount['1'].value : 0
                var diffrent_card = parseFloat(cardGetAmount) - parseFloat($('#expected_card_amount').html());
                $('#diffrent_card_amount').html(diffrent_card.toFixed(2));
                $('#counted_card_amount').editable('setValue', cardGetAmount);
                let chequeGetAmount = data.countedAmount && data.countedAmount['2'] && data.countedAmount['2'].paymenttype == 'cheque' ? data.countedAmount['2'].value : 0
                $('#counted_cheque_amount').editable('setValue', chequeGetAmount);
                var diffrent_cheque = parseFloat(chequeGetAmount) - parseFloat($('#expected_cheque_amount').html());
                $('#diffrent_cheque_amount').html(diffrent_cheque.toFixed(2));
                $('.cash_Intable').empty();
                $('.cash_Outtable').empty();
                $('#register_name').html(data.register_name).css('textTransform', 'capitalize');
                $('#register_opening_amount').number(data.opening_float, 2);
                $('#open_date').html(data.register_opendate);
                $('#register_user,.register_user_fields,.currentUser').html(data.current_user);
                var currency = PosnicPro.local.get('currencySign');
                var total_sum = 0;
                var return_sum = 0;
                var total_cash_sum = 0;
                var total_cheque_sum = 0;
                var total_card_sum = 0;
                var total_pending_sum = 0;
                var open_amountAdd = 0;
                var tota_cashAmountFinal = 0;
                var cash_Amount = 0;
                var cash_inData = 0;
                var cash_outData = 0;
                var appendcash_in = 0;
                var appendcash_out = 0;

                $.each(data.cashInOutDetail, function (index, val) {
                    cash_inData += parseFloat(val.cashin_amount);
                    cash_outData += parseFloat(val.cashout_amount);
                    appendcash_in = val.cashin_amount.toFixed(2);
                    appendcash_out = val.cashout_amount.toFixed(2);
                    if (appendcash_in > 0) {
                        var trow = '<tr class="cashinout-row" data-type="in" data-amount="' + appendcash_in + '" data-index="' + index + '">' +
                                '<td><span class="register_cashin_username register_user_fields" id="register_cashin_username">' + data.current_user + '</span></td>' +
                                '<td><span class="register_price_fields" name="register_cash_in" id="register_cash_in"> ' + currency + '&nbsp;' + appendcash_in + '</span></td>' +
                                '<td><button type="button" class="btn btn-outline-danger btn-sm delete-cashinout-btn" aria-label="Delete" data-t-aria-label="lang_delete"><i class="feather icon-trash"></i></button></td>' +
                                '</tr>';
                        $('.cash_Intable').append(trow);
                    }

                    if (appendcash_out > 0) {
                        var trow = '<tr class="cashinout-row" data-type="out" data-amount="' + appendcash_out + '" data-index="' + index + '">' +
                                '<td><span class="register_cashout_username register_user_fields" id="register_cashout_username">' + data.current_user + '</span></td>' +
                                '<td><span class="register_price_outfields" name="register_cash_out" id="register_cash_out"> ' + currency + '&nbsp;' + appendcash_out + '</span></td>' +
                                '<td><button type="button" class="btn btn-outline-danger btn-sm delete-cashinout-btn" aria-label="Delete" data-t-aria-label="lang_delete"><i class="feather icon-trash"></i></button></td>' +
                                '</tr>';
                        $('.cash_Outtable').append(trow);
                    }

                });

                // Build Payment Tally dynamically from API data
                if (data.paymentTally) {
                    var currency = PosnicPro.local.get('currencySign');
                    $('#payment_tally_tbody').empty();
                    
                    // Calculate denomination total for cash
                    var denomTotal = 0;
                    if (data.cashDenomDetail && Array.isArray(data.cashDenomDetail)) {
                        $.each(data.cashDenomDetail['0'], function (index, val) {
                            for (var i = 0; i < val.length; i++) {
                                denomTotal += parseFloat(val[i].amount);
                            }
                        });
                    }
                    
                    // Store counted amounts from database
                    var countedAmounts = {};
                    if (data.countedAmount && Array.isArray(data.countedAmount)) {
                        data.countedAmount.forEach(function(item) {
                            if (item.paymenttype) {
                                countedAmounts[item.paymenttype.toLowerCase()] = item.value || 0;
                            }
                        });
                    }
                    
                    // Build rows for each payment method in paymentTally
                    $.each(data.paymentTally, function(method, expectedAmount) {
                        var methodLower = method.toLowerCase();
                        var methodId = methodLower.replace(/\s+/g, '_');
                        var countedAmount = countedAmounts[methodLower] || 0;
                        var difference = countedAmount - expectedAmount;
                        
                        var displayName = method;
                        if (methodLower === 'cash') {
                            displayName = 'Cash(net cash payment)';
                        }
                        
                        var trow = '<tr>' +
                            '<th>' + displayName + '</th>' +
                            '<td><span class="sign display-currency">' + currency + '</span>&nbsp;<span class="expected_' + methodId + ' register_price_fields" id="expected_' + methodId + '_amount">' + expectedAmount.toFixed(2) + '</span></td>' +
                            '<td><div class="form-group mb-0">' +
                            '<a href="#" id="counted_' + methodId + '_amount" data-type="text" data-pk="1" data-title="Enter ' + method + ' Amount" class="editable editable-click profile_username">' + countedAmount.toFixed(2) + '</a>' +
                            '</div></td>' +
                            '<td><span class="sign display-currency">' + currency + '</span>&nbsp;<span class="diffrence_' + methodId + ' register_price_fields" id="diffrent_' + methodId + '_amount">' + difference.toFixed(2) + '</span></td>' +
                            '<input type="hidden" class="form-control cart-qty" name="return_' + methodId + '_amount" id="return_' + methodId + '_amount">' +
                            '</tr>';
                        
                        $('#payment_tally_tbody').append(trow);
                        
                        // Initialize editable for counted amount with backend save
                        $('#counted_' + methodId + '_amount').editable({
                            type: 'text',
                            pk: 1,
                            emptytext: '..',
                            title: PosnicPro.i18n.t('lang_enter', 'Enter ') + method + ' Amount',
                            inputclass: 'form-control form-control-sm',
                            validate: function (value) {
                                if ($.trim(value) == '') {
                                    return 'Counted ' + method + ' Amount is required.';
                                }
                                if (!$.isNumeric(value)) {
                                    return 'Only numbers allowed';
                                }
                            },
                            success: function (k, val) {
                                var countedData = {
                                    register_row_Id: $('#reg_upd_id').val(),
                                    countedAmount: parseFloat(val),
                                    payment_Type: methodLower
                                };
                                var params = {
                                    method: 'POST',
                                    url: 'registers/registerCountedAmount',
                                    data: JSON.stringify(countedData)
                                };
                                PosnicPro.request(params, function (response) {
                                    if (response.type === 'success') {
                                        // Update difference
                                        var expected = parseFloat($('#expected_' + methodId + '_amount').text()) || 0;
                                        var counted = parseFloat(val) || 0;
                                        var diff = counted - expected;
                                        $('#diffrent_' + methodId + '_amount').text(diff.toFixed(2));
                                    }
                                }, function (xhr) {
                                    var response = jQuery.parseJSON(xhr.responseText);
                                    PosnicPro.alert(response.type, response.message);
                                });
                            }
                        });
                        
                        $('#counted_' + methodId + '_amount').editable('setValue', countedAmount);
                        
                        // Store totals for sales summary calculation
                        if (methodLower === 'cash') {
                            total_cash_sum = expectedAmount - parseFloat(data.opening_float) - cash_inData + cash_outData;
                        } else if (methodLower === 'card') {
                            total_card_sum = expectedAmount;
                        } else if (methodLower === 'cheque') {
                            total_cheque_sum = expectedAmount;
                        }
                    });
                }
                
                $.each(data.register_sales, function (index, val) {
                    total_sum = data.register_sales.length;
                    return_sum += val.registerItems_return_total;
                    if (val.register_paymentmode === 'Pending') {
                        total_pending_sum += val.register_amount;
                    }
                });
                $('#register_refund').html(return_sum.toFixed(2));
                $('#register_transaction').html(total_sum);
                
                // Calculate total from all payment methods in paymentTally
                var total_amount = 0;
                if (data.paymentTally) {
                    $.each(data.paymentTally, function(method, amount) {
                        var methodLower = method.toLowerCase();
                        if (methodLower === 'cash') {
                            // For cash, subtract opening float and cash in/out to get actual sales
                            total_amount += amount - parseFloat(data.opening_float) - cash_inData + cash_outData;
                        } else {
                            // For other payment methods, add the full amount
                            total_amount += amount;
                        }
                    });
                }
                
                var total_saleAmount = total_amount + total_pending_sum;
                $('#register_total_sales').html(total_saleAmount.toFixed(2));
                var payment_receive_sum = parseFloat(total_amount + return_sum);
                $('#payment_receive').html(payment_receive_sum.toFixed(2));
                var net_amount = payment_receive_sum - return_sum;
                $('#net_receipt').html(net_amount.toFixed(2));
                
                // Disable denomination buttons if total sales is 0
                PosnicPro.registers.checkDenominationAccess(total_saleAmount);
                (data.payment_note !== '') ? $('#register_add_payment_description').editable('setValue', data.payment_note) :
                        $('#register_add_payment_description').editable('setValue', '');
                loader.find(".loadingSpinner:first").remove();
            }
        }, function (xhr) {
            var response = jQuery.parseJSON(xhr.responseText);
            PosnicPro.alert(response.type, response.message);
        });

        var register_Name = PosnicPro.local.get('RegisterName');
        var register_Id = PosnicPro.local.get('RegisterId');
        var payment_description = $("#register_add_payment_description").val();
        let counted_cash_amount = $('#counted_cash_amount').text();
        let counted_card_amount = $('#counted_card_amount').text();
        let counted_cheque_amount = $('#counted_cheque_amount').text();
        let counted_amount = parseFloat(counted_cash_amount) + parseFloat(counted_card_amount) + parseFloat(counted_cheque_amount);
        var registerNameClose = {
            register_name: register_Name,
            register_Id: register_Id,
            payment_note: payment_description,
            counted_amount: counted_amount
        };
        PosnicPro.registers.addLineTable = registerNameClose
    },
    viewDenomination: function (data) {
        $("#denomination_table tbody tr").remove();
        $('#addCashcalculation').hide();
        $('#editCashcalculation').hide();
        var currency = PosnicPro.local.get('currencySign');
        
        // Reset denomination counts
        if (PosnicPro.registers.registerDenominationCounts) {
            for (let denom in PosnicPro.registers.registerDenominationCounts) {
                PosnicPro.registers.registerDenominationCounts[denom] = 0;
            }
        }
        
        var denomTotal = 0;
        $.each(data, function (index, val) {
            for (var i = 0; i < val.length; i++) {
                denomTotal += parseFloat(val[i].amount);
                
                // Update denomination button counts
                let denomValue = parseFloat(val[i].cash);
                let count = parseInt(val[i].value);
                if (PosnicPro.registers.registerDenominationCounts && PosnicPro.registers.registerDenominationCounts.hasOwnProperty(denomValue)) {
                    PosnicPro.registers.registerDenominationCounts[denomValue] = count;
                    
                    // Update UI
                    let $countBadge = $('#register-count-' + denomValue);
                    let $denomBtn = $('#register-denom-btn-' + denomValue);
                    let $controls = $('#register-controls-' + denomValue);
                    
                    $countBadge.text(count);
                    if (count > 0) {
                        $countBadge.css('display', 'inline-block');
                        $controls.css('display', 'flex');
                        $denomBtn.css({
                            'background': '#3498db',
                            'color': '#fff',
                            'border-color': '#3498db'
                        });
                    }
                }
            }
        });
        $('#denomTotal').number(denomTotal, 2);
        $('span.number').number(true, 2);
        
        // Enable/disable Update Denomination and Delete buttons based on denomination total
        if (denomTotal > 0) {
            $("#updateDenominationBtn").show().removeAttr('disabled').css({"cursor": 'pointer', "opacity": '1'});
            $("#delete").removeAttr('disabled').css({"cursor": 'pointer', "color": '#f9616d', "border-color": '#f9616d'});
        } else {
            $("#updateDenominationBtn").show().attr('disabled', true).css({"cursor": 'not-allowed', "opacity": '0.5'});
            $("#delete").attr('disabled', true).css({"cursor": 'not-allowed', "color": '#d8d3d3', "border-color": '#d8d3d3'});
        }

    },
    deleteCashcalculation: function () {
        if ($("#denomTotal").is(":empty")) {
            $('#delete_denomination_modal').modal('hide');
            $("#delete").attr('disabled', true).css({"cursor": 'not-allowed', "color": '#d8d3d3', "border-color": '#d8d3d3'});
        } else {
            $('#delete_denomination_modal').modal('show');
        }
    },
    deleteDenominationConfirmed: function () {
        var params = {
            url: 'registers/deleteCashDenomination',
            data: JSON.stringify({
                id: PosnicPro.record_id
            })
        };
        PosnicPro.delete(params, function (response) {
            if (response.type === 'success') {
                // Reset displayed total but keep the Total row structure so it can be updated again
                $("#denomTotal").html('');
                // $('#addCashcalculation').show(); // Hidden by user request
                $('#editCashcalculation').hide();
                $('#delete_denomination_modal').modal('hide');
                // Reset in-memory denomination state
                if (PosnicPro.registers.registerDenominationCounts) {
                    for (let denom in PosnicPro.registers.registerDenominationCounts) {
                        PosnicPro.registers.registerDenominationCounts[denom] = 0;
                    }
                }
                PosnicPro.registers.hasDenominationData = false;

                // Reset denomination buttons/badges UI
                $('#register_render_amount').find('[id^="register-count-"]').each(function () {
                    $(this).text('0').css('display', 'none');
                });
                $('#register_render_amount').find('[id^="register-controls-"]').css('display', 'none');
                $('#register_render_amount').find('[id^="register-denom-btn-"]').css({
                    'background': '#fff',
                    'color': '#3498db',
                    'border-color': '#3498db'
                });

                // After delete, user should create new denomination set
                $('#saveDenominationBtn').show();
                $('#updateDenominationBtn').hide().attr('disabled', true).css({"cursor": 'not-allowed', "opacity": '0.5'});

                PosnicPro.alert(response.type, response.message);
                $("#delete").attr('disabled', true).css({"cursor": 'not-allowed', "color": '#d8d3d3', "border-color": '#d8d3d3'});
            } else {
                PosnicPro.alert(response.type, response.message);
            }
        }, function (xhr) {
            var response = jQuery.parseJSON(xhr.responseText);
            PosnicPro.alert(response.type, response.message);
        });
    },
    //register closing form when click close button on cash register
    registercloseFormSubmit: function () {
        let registerCloseData = {
            cash_register_id: PosnicPro.local.get('cash_register_id')
        };
        let params = {
            method: 'POST',
            url: 'registers/registerClose',
            data: JSON.stringify(Object.assign(registerCloseData))
        };
        PosnicPro.request(params, function (response) {
            if (response.type === 'success') {
                db.currentregister.put({id: '1', register_id: PosnicPro.local.get('register_id'),
                    register_name: PosnicPro.local.get('register_name'), register_status: 'close'});
                $(".cash_Intable").empty('');
                $(".cash_Outtable").empty('');
                $("#register_open_float").val('0.00');
                $("#register_add_payment_description").val('');
                $("#denomination_table tbody tr").html('');
                $("#denomTotal").html('');
                // $('#addCashcalculation').show(); // Hidden by user request
                $('#editCashcalculation').hide();
                PosnicPro.local.set('Registerstatus', 'Closed');
                PosnicPro.local.set('userRegisterStatus', 'Closed');
                PosnicPro.registers.printRegisterscreen(PosnicPro.local.get('cash_register_id'));
                $('.register_details_data').hide();
                PosnicPro.registers.renderOverview();
                $(".register_details_visibledata").hide();
                PosnicPro.commonDate();
                PosnicPro.alert(response.type, response.message);
            } else {
                PosnicPro.alert(response.type, response.message);
            }
        }, function (xhr) {
            var response = jQuery.parseJSON(xhr.responseText);
            PosnicPro.alert(response.type, response.message);
        });
        return false;
    },

    branchChangeCloseRegisterFormSubmit: function () {
        let registerCloseData = {
            cash_register_id: PosnicPro.local.get('cash_register_id')
        };
        let params = {
            method: 'POST',
            url: 'registers/registerClose',
            data: JSON.stringify(Object.assign(registerCloseData))
        };
        PosnicPro.request(params, function (response) {
            if (response.type === 'success') {
                db.currentregister.put({id: '1', register_id: PosnicPro.local.get('register_id'),
                    register_name: PosnicPro.local.get('register_name'), register_status: 'close'});
                let branch_id = PosnicPro.local.get('changebranchid');
                PosnicPro.local.set('cash_register_id', '');
                PosnicPro.settings.listBranchName(branch_id);
                PosnicPro.alert(response.type, response.message);
            } else {
                PosnicPro.alert(response.type, response.message);
            }
        }, function (xhr) {
            var response = jQuery.parseJSON(xhr.responseText);
            PosnicPro.alert(response.type, response.message);
        });
        return false;
    },

    // Editable cash-closing preview with draggable blocks and direct text editing.
    openClosingStudio: function (html) {
        var existing = $('#posnic-closing-studio');
        if (existing.length) existing.remove();
        var style = '<style>.pcs-shell{position:fixed;inset:3vh 3vw;z-index:20000;background:#f4f7fb;border:1px solid #d7dfeb;border-radius:14px;box-shadow:0 24px 80px #10182855;display:flex;flex-direction:column;color:#26364d;font:13px/1.45 Arial,sans-serif}.pcs-head{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:14px 18px;background:#fff;border-bottom:1px solid #dfe6ef}.pcs-head h3{margin:0;font-size:18px}.pcs-actions{display:flex;gap:8px;flex-wrap:wrap}.pcs-btn{border:1px solid #cbd5e1;background:#fff;border-radius:7px;padding:8px 12px;font-weight:600;cursor:pointer}.pcs-primary{background:#2563eb;border-color:#2563eb;color:#fff}.pcs-body{display:grid;grid-template-columns:180px minmax(0,1fr);gap:14px;padding:14px;overflow:auto;min-height:0;flex:1}.pcs-library,.pcs-canvas{background:#fff;border:1px solid #dfe6ef;border-radius:10px;padding:12px}.pcs-library button{display:block;width:100%;text-align:left;margin:5px 0;padding:8px;border:1px solid #e2e8f0;border-radius:6px;background:#fff;cursor:grab}.pcs-paper{background:#fff;min-height:400px;padding:24px;box-shadow:0 3px 15px #10182812;outline:1px dashed #cbd5e1}.pcs-paper [data-pcs-block]{position:relative;padding:5px;margin:4px 0;border:1px dashed transparent;cursor:move;white-space:normal}.pcs-paper [data-pcs-block]:hover,.pcs-paper [data-pcs-block]:focus{border-color:#2563eb;outline:0}.pcs-paper [data-pcs-block].pcs-selected{border-color:#2563eb;background:#eff6ff}.pcs-toolbar{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:0 0 10px;padding:8px;background:#f8fafc;border:1px solid #dfe6ef;border-radius:8px}.pcs-toolbar label{display:flex;align-items:center;gap:5px;font-size:11px;color:#475569}.pcs-toolbar select{border:1px solid #cbd5e1;border-radius:5px;padding:5px;background:#fff}.pcs-toolbar input[type=color]{width:32px;height:28px;padding:1px;border:1px solid #cbd5e1;border-radius:5px;background:#fff}.pcs-hint{color:#64748b;font-size:11px;margin:0 0 10px}@media(max-width:700px){.pcs-shell{inset:1vh 1vw}.pcs-body{grid-template-columns:1fr}.pcs-library{display:flex;flex-wrap:wrap;gap:5px}.pcs-library button{width:auto}}</style>';
        var shell = $('<div id="posnic-closing-studio" class="pcs-shell" role="dialog" aria-modal="true"></div>');
        shell.html(style + '<div class="pcs-head"><div><h3>Clôture de caisse · Receipt Studio</h3><div style="color:#64748b;font-size:11px">Modifiez les textes, glissez-déposez les blocs, puis imprimez ou enregistrez en PDF.</div></div><div class="pcs-actions"><button type="button" class="pcs-btn pcs-reset">Réinitialiser</button><button type="button" class="pcs-btn pcs-save-template">Enregistrer le modèle</button><button type="button" class="pcs-btn pcs-close">Fermer</button><label class="pcs-paper-choice" style="display:flex;align-items:center;gap:6px;font-size:12px">Papier <select class="pcs-print-format" style="padding:7px;border:1px solid #cbd5e1;border-radius:6px"><option value="80">Thermique 80 mm</option><option value="58">Thermique 58 mm</option><option value="112">Thermique 112 mm</option><option value="a4">A4 · PDF</option></select></label><button type="button" class="pcs-btn pcs-primary pcs-print">Imprimer</button></div></div><div class="pcs-body"><aside class="pcs-library"><strong>Éléments</strong><p class="pcs-hint">Glissez les blocs pour les réordonner. Cliquez sur le texte pour le modifier.</p><button type="button" draggable="true" data-add="heading">＋ Titre</button><button type="button" draggable="true" data-add="text">＋ Texte libre</button><button type="button" draggable="true" data-add="separator">＋ Séparateur</button><button type="button" draggable="true" data-add="note">＋ Note de clôture</button><button type="button" draggable="true" data-add="field-sales-count">＋ Nombre de ventes</button><button type="button" draggable="true" data-add="field-sales-total">＋ Total des ventes</button><button type="button" draggable="true" data-add="field-cost">＋ Coût des marchandises</button><button type="button" draggable="true" data-add="field-gross">＋ Bénéfice brut</button><button type="button" draggable="true" data-add="field-expenses">＋ Dépenses</button><button type="button" draggable="true" data-add="field-net">＋ Bénéfice net</button><button type="button" draggable="true" data-add="field-cash">＋ Total espèces</button><button type="button" draggable="true" data-add="field-credit">＋ Total crédit</button><button type="button" draggable="true" data-add="field-tpe">＋ Total TPE</button><button type="button" draggable="true" data-add="field-bm">＋ Total BaridiMob</button></aside><section class="pcs-canvas"><p class="pcs-hint">Live print preview · select an element to format it, edit text directly, or drag blocks to reorder.</p><div class="pcs-toolbar"><label>Taille <select class="pcs-font-size"><option value="">Auto</option><option value="10px">10</option><option value="12px">12</option><option value="14px">14</option><option value="16px">16</option><option value="20px">20</option><option value="24px">24</option><option value="28px">28</option></select></label><label>Alignement <select class="pcs-align"><option value="">Auto</option><option value="left">Gauche</option><option value="center">Centre</option><option value="right">Droite</option></select></label><label>Couleur <input type="color" class="pcs-color" value="#222222" aria-label="Couleur du texte"></label><button type="button" class="pcs-btn pcs-delete-selected">Supprimer l’élément</button></div><div class="pcs-paper" contenteditable="false"></div></section></div>');
        $('body').append(shell);
        var paper = shell.find('.pcs-paper');
        var doc = $('<div></div>').html(html);
        doc.find('script,iframe,object,embed').remove();
        var content = doc.html();
        var dynamicValues = {};
        doc.find("[data-closing-value]").each(function(){dynamicValues[$(this).attr("data-closing-value")]=$(this).text();});
        try { var savedClosing = localStorage.getItem("posnicClosingStudioTemplateV3"); if (savedClosing) content = savedClosing; } catch (e) {}
        paper.html(content);
        paper.find("[data-closing-value]").each(function(){var key=$(this).attr("data-closing-value");if(Object.prototype.hasOwnProperty.call(dynamicValues,key))$(this).text(dynamicValues[key]);});
        paper.find('> *').each(function(){ $(this).attr('data-pcs-block','1').attr('draggable','true'); });
        paper.find('td,th,span,p,h1,h2,h3,h4,address').attr('contenteditable','true');
        var dragNode = null;
        var selectedBlock = paper.find("[data-pcs-block]").first().addClass("pcs-selected")[0] || null;
        paper.on('dragstart', '[data-pcs-block]', function(e){dragNode=this;e.originalEvent.dataTransfer.setData('text/plain','block');});
        shell.on('dragstart','[data-add]',function(e){e.originalEvent.dataTransfer.setData('application/x-posnic-closing-block',$(this).attr('data-add'));});
        paper.on('dragover',function(e){e.preventDefault();});
        paper.on('drop',function(e){var type=e.originalEvent.dataTransfer.getData('application/x-posnic-closing-block');if(!type)return;e.preventDefault();shell.find('[data-add="'+type+'"]').trigger('click');});
        paper.on('dragover', '[data-pcs-block]', function(e){e.preventDefault();});
        paper.on('drop', '[data-pcs-block]', function(e){e.preventDefault();if(dragNode&&dragNode!==this)$(this).before(dragNode);});
        paper.on('click', '[data-pcs-block]', function () {
            selectedBlock = this;
            paper.find('[data-pcs-block]').removeClass('pcs-selected');
            $(this).addClass('pcs-selected');
            shell.find('.pcs-font-size').val(this.style.fontSize || '');
            shell.find('.pcs-align').val(this.style.textAlign || '');
            var color = this.style.color || '#222222';
            if (/^#[0-9a-f]{6}$/i.test(color)) shell.find('.pcs-color').val(color);
        });
        shell.on('change', '.pcs-font-size', function () { if (selectedBlock) selectedBlock.style.fontSize = this.value; });
        shell.on('change', '.pcs-align', function () { if (selectedBlock) selectedBlock.style.textAlign = this.value; });
        shell.on('change', '.pcs-color', function () { if (selectedBlock) selectedBlock.style.color = this.value; });
        shell.on('click', '.pcs-delete-selected', function () {
            if (!selectedBlock) return;
            var next = $(selectedBlock).next('[data-pcs-block]')[0] || $(selectedBlock).prev('[data-pcs-block]')[0];
            $(selectedBlock).remove();
            selectedBlock = next || paper.find('[data-pcs-block]').first()[0] || null;
            paper.find('[data-pcs-block]').removeClass('pcs-selected');
            if (selectedBlock) $(selectedBlock).addClass('pcs-selected');
        });
        shell.on('click','.pcs-close',function(){shell.remove();});
        shell.on('click','[data-add]',function(){
            var type=$(this).attr('data-add'), node;
            if(type==='heading') node=$('<h2 data-pcs-block="1" draggable="true" contenteditable="true">Clôture de caisse</h2>');
            else if(type==='separator') node=$('<hr data-pcs-block="1" draggable="true">');
            else if(type==='note') node=$('<p data-pcs-block="1" draggable="true" contenteditable="true">Remarques : </p>');
            else if(type==='field-sales-count') node=$('<p data-pcs-block="1" draggable="true" contenteditable="true"><strong>Nombre de ventes :</strong> <span data-closing-value="sales-count">0</span></p>');
            else if(type==='field-sales-total') node=$('<p data-pcs-block="1" draggable="true" contenteditable="true"><strong>Total des ventes :</strong> <span data-closing-value="sales-total">0,00</span></p>');
            else if(type==='field-cost') node=$('<p data-pcs-block="1" draggable="true" contenteditable="true"><strong>Coût des marchandises :</strong> <span data-closing-value="cost">—</span></p>');
            else if(type==='field-gross') node=$('<p data-pcs-block="1" draggable="true" contenteditable="true"><strong>Bénéfice brut :</strong> <span data-closing-value="gross">—</span></p>');
            else if(type==='field-expenses') node=$('<p data-pcs-block="1" draggable="true" contenteditable="true"><strong>Dépenses :</strong> <span data-closing-value="expenses">0,00</span></p>');
            else if(type==='field-net') node=$('<p data-pcs-block="1" draggable="true" contenteditable="true"><strong>Bénéfice net :</strong> <span data-closing-value="net">—</span></p>');
            else if(type==='field-cash') node=$('<p data-pcs-block="1" draggable="true" contenteditable="true"><strong>Total espèces :</strong> <span data-closing-value="cash">0,00</span></p>');
            else if(type==='field-credit') node=$('<p data-pcs-block="1" draggable="true" contenteditable="true"><strong>Total crédit :</strong> <span data-closing-value="credit">0,00</span></p>');
            else if(type==='field-tpe') node=$('<p data-pcs-block="1" draggable="true" contenteditable="true"><strong>Total TPE :</strong> <span data-closing-value="tpe">0,00</span></p>');
            else if(type==='field-bm') node=$('<p data-pcs-block="1" draggable="true" contenteditable="true"><strong>Total BaridiMob :</strong> <span data-closing-value="baridimob">0,00</span></p>');
            else node=$('<p data-pcs-block="1" draggable="true" contenteditable="true">Texte personnalisable</p>');
            paper.append(node);
        });
        shell.on('click','.pcs-reset',function(){paper.html(content);paper.find('> *').attr('data-pcs-block','1').attr('draggable','true');paper.find('td,th,span,p,h1,h2,h3,h4,address').attr('contenteditable','true');});
        shell.on('click','.pcs-save-template',function(){try{localStorage.setItem('posnicClosingStudioTemplateV3',paper.html());PosnicPro.alert('success','Modèle de clôture enregistré sur cet appareil.');}catch(e){PosnicPro.alert('error','Impossible d’enregistrer le modèle sur cet appareil.');}});
        shell.on('click','.pcs-print',function(){
            var format = shell.find('.pcs-print-format').val() || '80';
            var isThermal = ['58','80','112'].indexOf(format) !== -1;
            var clean = paper.clone();
            clean.find('[contenteditable="true"]').removeAttr('contenteditable');
            clean.find('[draggable="true"]').removeAttr('draggable');
            clean.find('[data-pcs-block]').removeAttr('data-pcs-block').removeClass('pcs-selected');
            clean.find('.pcs-selected').removeClass('pcs-selected');
            var styles = isThermal
                ? '<style>html,body{font-family:Arial,Helvetica,sans-serif;color:#000;margin:0;padding:1mm;font-size:10px}*{box-sizing:border-box}body{width:100%}.pcs-paper{padding:0;min-height:0;box-shadow:none;outline:0}.pcs-paper>*{break-inside:avoid;page-break-inside:avoid}table{width:100%;border-collapse:collapse;table-layout:fixed}th,td{padding:2px 0;border-bottom:1px solid #aaa;text-align:left;overflow-wrap:anywhere}hr{border:0;border-top:1px solid #555}@page{size:' + format + 'mm auto;margin:0}</style>'
                : '<style>html,body{font-family:Arial,Helvetica,sans-serif;color:#222;margin:0;padding:10mm}*{box-sizing:border-box}.pcs-paper{padding:0;min-height:0;box-shadow:none;outline:0}table{width:100%;border-collapse:collapse}th,td{padding:6px;border-bottom:1px solid #ddd;text-align:left}hr{border:0;border-top:1px solid #999}@page{size:A4;margin:10mm}</style>';
            var printContent = styles + clean.html();
            try { localStorage.setItem('posnicClosingStudioTemplateV3', paper.html()); } catch (e) {}
            var receiptEngine = PosnicPro.receiptDesigner;
            if (!receiptEngine || typeof receiptEngine.print !== 'function') {
                PosnicPro.alert('error', 'Le moteur d’impression du ticket est indisponible. Rechargez l’application puis réessayez.');
                return;
            }
            var printButton = shell.find('.pcs-print');
            printButton.prop('disabled', true).text('Impression…');
            var printOptions = { sample: true };
            if (!isThermal) printOptions.showDialog = true;
            Promise.resolve(receiptEngine.print(printContent, format, printOptions)).then(function (result) {
                if (result && result.success) PosnicPro.alert('success', isThermal ? 'Ticket envoyé à l’imprimante thermique.' : 'Fenêtre d’impression ouverte. Choisissez Microsoft Print to PDF pour enregistrer le ticket.');
                else PosnicPro.alert('error', 'L’impression n’a pas été confirmée.');
            }).catch(function (err) {
                PosnicPro.alert('error', err && err.message || 'Impossible d’imprimer la clôture.');
            }).finally(function () { printButton.prop('disabled', false).text('Imprimer'); });
        });
    },

    // cash register button closed then click print screen function
    printRegisterscreen: function (id) {
        var params = {
            url: 'registers/getCashRegister',
            data: { id: id }
        };
        PosnicPro.get(params, function (response) {
            if (!response || response.type !== 'success' || !response.data) {
                PosnicPro.alert(response && response.type || 'error', response && response.message || 'Impossible de charger la clôture de caisse.');
                return;
            }
            var data = response.data;
            var cashIn = 0;
            var cashOut = 0;
            $.each(data.cashInOutDetail || [], function (index, item) {
                cashIn += Number(item.cashin_amount) || 0;
                cashOut += Number(item.cashout_amount) || 0;
            });
            $('.print_register_name').text(data.register_name || '');
            $('.print_registeropendate').text(data.register_opendate || '');
            $('.print_registerclosedate').text(data.register_closedate || '');
            $('.currentUser').text(data.current_user || '');
            $('#opening_Amount').text(data.opening_float == null ? '0' : data.opening_float);
            $('#in_Amount').text(cashIn);
            $('#out_Amount').text(cashOut);
            $('#received_Amount').text($('#payment_receive').text());
            $('#refund_Amount').text($('#register_refund').text());
            $('#net_Amount').text($('#net_receipt').text());
            $('#total_sale').text($('#register_total_sales').text());
            $('#total_transaction').text($('#register_transaction').text());

            // Generate the new closing-slip document directly from this register record.
            // Do not read #printRegister_a4_form: that was the legacy, non-editable designer.
            var esc = function (value) {
                return String(value == null ? '' : value).replace(/[&<>"]/g, function (character) {
                    return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[character];
                });
            };
            var moneyText = function (value) { return (Number(value) || 0).toFixed(2); };
            var salesTotal = $('#register_total_sales').text() || data.register_amount || data.total_sales || 0;
            var transactionCount = $('#register_transaction').text() || data.transaction_count || data.total_transaction || 0;
            var netAmount = $('#net_receipt').text() || data.net_amount || 0;
            var tallyRows = '';
            if (data.paymentTally && typeof data.paymentTally === 'object') {
                Object.keys(data.paymentTally).forEach(function (method) {
                    tallyRows += '<tr><th>' + esc(method) + '</th><td style="text-align:right"><span data-closing-value="tender-' + esc(method.toLowerCase().replace(/[^a-z0-9]+/g, '-')) + '">' + moneyText(data.paymentTally[method]) + '</span></td></tr>';
                });
            }
            var contents = '<div class="closing-slip-default">' +
                '<h2 data-closing-value="title" style="text-align:center">Clôture de caisse</h2>' +
                '<p><strong>Caisse :</strong> <span data-closing-value="register-name">' + esc(data.register_name || '') + '</span></p>' +
                '<p><strong>Ouverture :</strong> <span data-closing-value="opened-at">' + esc(data.register_opendate || '') + '</span></p>' +
                '<p><strong>Clôture :</strong> <span data-closing-value="closed-at">' + esc(data.register_closedate || '') + '</span></p>' +
                '<p><strong>Utilisateur :</strong> <span data-closing-value="user">' + esc(data.current_user || '') + '</span></p><hr>' +
                '<p><strong>Fond de caisse :</strong> <span data-closing-value="opening-float">' + moneyText(data.opening_float) + '</span></p>' +
                '<p><strong>Total des ventes :</strong> <span data-closing-value="sales-total">' + esc(salesTotal) + '</span></p>' +
                '<p><strong>Nombre de transactions :</strong> <span data-closing-value="transactions">' + esc(transactionCount) + '</span></p>' +
                '<p><strong>Entrées espèces :</strong> <span data-closing-value="cash-in">' + moneyText(cashIn) + '</span></p>' +
                '<p><strong>Sorties espèces :</strong> <span data-closing-value="cash-out">' + moneyText(cashOut) + '</span></p>' +
                '<p><strong>Net :</strong> <span data-closing-value="net">' + esc(netAmount) + '</span></p>' +
                (tallyRows ? '<hr><h3>Récapitulatif par mode de paiement</h3><table style="width:100%;border-collapse:collapse"><thead><tr><th>Mode</th><th style="text-align:right">Montant attendu</th></tr></thead><tbody>' + tallyRows + '</tbody></table>' : '') +
                '<hr><p contenteditable="true" data-pcs-block="1">Signature / remarques :</p></div>';
            PosnicPro.registers.openClosingStudio(contents);
        }, function (xhr) {
            var response = {};
            try { response = jQuery.parseJSON(xhr.responseText); } catch (error) {}
            PosnicPro.alert(response.type || 'error', response.message || 'Impossible de charger la clôture de caisse.');
        });
        return false;
    },
    registerInOutSubmit: function () {
        let inAmountDescription = $('#cash_button_note').val();
        let outAmountDescription = $('#cash_outbutton_note').val();
        let inAmount = $('#cash_button_amount').val() || 0;
        let outAmount = $('#cash_outbutton_amount').val() || 0;
        $("#cash_button_amount").click(function () {
            $('#cash_outbutton_amount').val('');
            $('#cash_outbutton_note').val('');
        });
        $("#cash_outbutton_amount").click(function () {
            $('#cash_button_amount').val('');
            $('#cash_button_note').val('');
        });
        if (outAmount > parseInt($('#expected_cash_amount').html())) {
            PosnicPro.alert('error', PosnicPro.i18n.t('lang_the_cash_till_does_not_have_enough_funds', 'The cash till does not have enough funds.'));
            return false;
        } else {
            var inOutAmountType = {
                in_amount: inAmount,
                out_amount: outAmount,
                in_description: inAmountDescription,
                out_description: outAmountDescription,
                cash_register_id: $('#reg_upd_id').val()
            };
            var method = 'POST';
            var url = 'registers/registerInDetail';
            var params = {
                method: method,
                url: url,
                data: JSON.stringify(Object.assign(inOutAmountType))
            };
            PosnicPro.request(params, function (response) {
                if (response.type === 'success') {
                    var savedInAmount = parseFloat(inAmount) || 0;
                    var savedOutAmount = parseFloat(outAmount) || 0;
                    var currency = PosnicPro.local.get('currencySign');
                    var currentUser = PosnicPro.local.get('userName') || 'User';
                    
                    // Get current number of Cash In/Out entries to determine index
                    var currentIndex = $('.cashinout-row').length;
                    
                    // Add Cash In entry to table if amount > 0
                    if (savedInAmount > 0) {
                        var trow = '<tr class="cashinout-row" data-type="in" data-amount="' + savedInAmount.toFixed(2) + '" data-index="' + currentIndex + '">' +
                                '<td><span class="register_cashin_username register_user_fields">' + currentUser + '</span></td>' +
                                '<td><span class="register_price_fields"> ' + currency + '&nbsp;' + savedInAmount.toFixed(2) + '</span></td>' +
                                '<td><button type="button" class="btn btn-outline-danger btn-sm delete-cashinout-btn" aria-label="Delete" data-t-aria-label="lang_delete"><i class="feather icon-trash"></i></button></td>' +
                                '</tr>';
                        $('.cash_Intable').append(trow);
                        
                        // Update Expected amount for Cash
                        var currentExpected = parseFloat($('#expected_cash_amount').text()) || 0;
                        var newExpected = currentExpected + savedInAmount;
                        $('#expected_cash_amount').text(newExpected.toFixed(2));
                        
                        // Update difference
                        var counted = parseFloat($('#counted_cash_amount').text()) || 0;
                        var newDiff = counted - newExpected;
                        $('#diffrent_cash_amount').text(newDiff.toFixed(2));
                    }
                    
                    // Add Cash Out entry to table if amount > 0
                    if (savedOutAmount > 0) {
                        var trow = '<tr class="cashinout-row" data-type="out" data-amount="' + savedOutAmount.toFixed(2) + '" data-index="' + currentIndex + '">' +
                                '<td><span class="register_cashout_username register_user_fields">' + currentUser + '</span></td>' +
                                '<td><span class="register_price_outfields"> ' + currency + '&nbsp;' + savedOutAmount.toFixed(2) + '</span></td>' +
                                '<td><button type="button" class="btn btn-outline-danger btn-sm delete-cashinout-btn" aria-label="Delete" data-t-aria-label="lang_delete"><i class="feather icon-trash"></i></button></td>' +
                                '</tr>';
                        $('.cash_Outtable').append(trow);
                        
                        // Update Expected amount for Cash
                        var currentExpected = parseFloat($('#expected_cash_amount').text()) || 0;
                        var newExpected = currentExpected - savedOutAmount;
                        $('#expected_cash_amount').text(newExpected.toFixed(2));
                        
                        // Update difference
                        var counted = parseFloat($('#counted_cash_amount').text()) || 0;
                        var newDiff = counted - newExpected;
                        $('#diffrent_cash_amount').text(newDiff.toFixed(2));
                    }
                    
                    // Clear form fields
                    $('#cash_outbutton_amount').val('');
                    $('#cash_outbutton_note').val('');
                    $('#cash_button_amount').val('');
                    $('#cash_button_note').val('');
                    $('#hide_show_cashbutton').hide();
                    
                    // Show success message
                    PosnicPro.alert(response.type, response.message);
                    
                    // Reload register data to get updated Expected amounts from backend
                    var register_id = $('#register_id_hidden').val();
                    if (register_id) {
                        setTimeout(function() {
                            PosnicPro.registers.cashReportRegister(register_id);
                        }, 500);
                    }
                }
            }, function (xhr) {
                var response = jQuery.parseJSON(xhr.responseText);
                PosnicPro.alert(response.type, response.message);
            });
            return false;
        }
    },
    //different cash,card calculation
    cashOnRegisterValueCheck: function (val) {
        if ($('#counted_cash_amount').text() !== '') {
            let cash_Amount = isNaN(val) ? 0 : val
            var diffrent_cash = parseFloat(cash_Amount) - parseFloat($('#expected_cash_amount').html());
            $('#diffrent_cash_amount').html(diffrent_cash.toFixed(2));
        } else if (($('#counted_cash_amount').text() == '') && $('#expected_cash_amount').html() !== '') {
            var diffrent_cash = -$('#expected_cash_amount').html();
            $('#diffrent_cash_amount').html(diffrent_cash.toFixed(2));
        } else {
            $('#diffrent_cash_amount').html('0.00');
        }
    },
    creditOnRegisterValueCheck: function (val) {
        if ($('#counted_card_amount').text() !== '') {
            let card_Amount = isNaN(val) ? 0 : val
            var diffrent_card = parseFloat(card_Amount) - parseFloat($('#expected_card_amount').html());
            $('#diffrent_card_amount').html(diffrent_card.toFixed(2));
        } else if (($('#counted_card_amount').text() == '') && $('#expected_card_amount').html() !== '') {
            var diffrent_card = -$('#expected_card_amount').html();
            $('#diffrent_card_amount').html(diffrent_card.toFixed(2));
        } else {
            $('#diffrent_card_amount').html('0.00');
        }
    },
    chequeOnRegisterValueCheck: function (chequevalue) {
        if ($('#counted_cheque_amount').text() !== '') {
            let cheque_Amount = isNaN(chequevalue) ? 0 : chequevalue
            var diffrent_cheque = parseFloat(cheque_Amount) - parseFloat($('#expected_cheque_amount').html());
            $('#diffrent_cheque_amount').html(diffrent_cheque.toFixed(2));
        } else if (($('#counted_cheque_amount').text() == '') && $('#expected_cheque_amount').html() !== '') {
            var diffrent_cheque = -$('#expected_cheque_amount').html();
            $('#diffrent_cheque_amount').html(diffrent_cheque.toFixed(2));
        } else {
            $('#diffrent_cheque_amount').html('0.00');
        }
    },

    registerCheckTime: function () {
        if (PosnicPro.local.get('Registerstatus') !== 'Closed' && PosnicPro.local.get('RegisterId') !== null) {
            var register_Name = PosnicPro.local.get('RegisterName');
            var register_Id = PosnicPro.local.get('RegisterId');
            var url = 'registers/registeropendateFilter';
            var params = {
                url: url,
                data: {
                    register_name: register_Name,
                    register_Id: register_Id
                }
            };
            PosnicPro.get(params, function (response) {
                if (response.type === 'success') {
                    var data = response.data;
                    var register_opendate = data.register_opendate;
                    var currentDate = moment(new Date(), "MM/DD/YYYY HH:mm:ss a");
                    var registerDate = moment(register_opendate, "MM/DD/YYYY HH:mm:ss a");
                    var hoursDiff = moment(currentDate).diff(moment(registerDate), 'hours');
                    var dayDiff = currentDate.diff(registerDate, 'day');

                    if (hoursDiff > '24') {
                        $('#register_time_track').modal('show');
                        var regsiterName = data.register_name;
                        $('.cash_register_name').html(regsiterName);
                        $('.register_day_differ').html(dayDiff);
                        $('.cash_register_date').html(PosnicPro.local.get('openDate'));
                    } else {
                        $('#register_time_track').modal('hide');
                    }
                }
            }, function (xhr) {
                var response = jQuery.parseJSON(xhr.responseText);
                PosnicPro.alert(response.type, response.message);
            });
        }
    },
    // register cash denomination 
    cashdenomValueCheck: function (value, field, id) {
        $("#total_" + id).text('');
        var line_total = (value * field);
        $("#total_" + id).text(line_total, 2);
        var granadTotal = 0;
        $('.totaldenom_value').each(function () {
            granadTotal += parseFloat(this.innerHTML);
        });
        $('#TotalCashValue').number(granadTotal, 2);
    },
    addCashcalculation: function () {
        $(".infobar-settings-sidebar-overlay").css({"background": "rgba(0,0,0,0.4)", "position": "fixed"});
        $("#infobar-settings-sidebar-denom").addClass("sidebarshow");
        $(".denomination_title_name").html(PosnicPro.i18n.t('lang_nav_add', 'Add'));
        $('.denomination_submit_button').html(PosnicPro.i18n.t('lang_save_title', 'Save'));
        var params = {
            url: 'registers/getcashField'
        };
        PosnicPro.get(params, function (response) {
            if (response.type === 'success') {
                var data = response.data;
                if (data !== null) {
                    $('.hide_null_denomination').show();
                    $('.total_pading,#denom_datastore').css("visibility", "visible");
                    $('#denom_addnewfield').css("visibility", "hidden");
                    $('#denom_append tbody').children("tr").remove();
                    $("#TotalCashValue").html('0');
                    var currency = PosnicPro.local.get('currencySign');
                    for (var i = 0; i < data.length; i++) {
                        var row = data[i];
                        var data_item = row.cashfield;
                        var id = row.cashfiled_id.$oid;
                        var trow = '<tr id="denom_' + (i + 1) + '" >' +
                                '<td id="denomLineId_' + id + '" style="display:none;">' + id + '</td>' +
                                '<td id="denomLineItemId_' + (i + 1) + '" style="display:none;">' + (row.cashfiled_id.$oid) + '</td>' +
                                '<td id="denom_cash_' + row.cashfiled_id.$oid + '" class="col-sm-2">' + row.cashfield + '</td>' +
                                '<td class="col-sm-1"><span>x</span></td>' +
                                '<td id="denom_value_' + row.cashfiled_id.$oid + '" class="col-sm-4"><input class="form-control border-control" id="inputdenom_value_' + row.cashfiled_id.$oid + '" type="number" name="countcash_value[]" value="" onkeypress="return PosnicPro.isNumber(event)" onchange="PosnicPro.registers.cashdenomValueCheck(this.value,' + data_item + ',\'' + id + '\');"  min="0" step="1" minlength="1" maxlength="20" placeholder="0" style=" width: 70px; height: 40px;"></td>' +
                                '<td class="col-sm-1"><span>=</span></td>' +
                                '<td class="text-right">' + currency + '</td><td id="denom_amount_' + row.cashfiled_id.$oid + '" class="col-sm-3"><div class="totaldenom_value" name="totalDenomAmonut[]" id="total_' + row.cashfiled_id.$oid + '">0</td></tr>';
                        $('#denom_append tbody').append(trow);
                    }
                } else {
                    $('.total_pading,#denom_datastore').css("visibility", "hidden");
                    $('#denom_addnewfield').css("visibility", "visible");
                    $('.hide_null_denomination').hide();
                }
            } else {
                PosnicPro.alert(response.type, response.message);
            }
        }, function (xhr) {
            var response = jQuery.parseJSON(xhr.responseText);
            PosnicPro.alert(response.type, response.message);
        });
    },
    editCashcalculation: function () {
        $(".infobar-settings-sidebar-overlay").css({"background": "rgba(0,0,0,0.4)", "position": "fixed"});
        $("#infobar-settings-sidebar-denom").addClass("sidebarshow");
        $(".denomination_title_name").html(PosnicPro.i18n.t('lang_edit_title', 'Edit'));
        $('.denomination_submit_button').show().html(PosnicPro.i18n.t('lang_refresh_title', 'Update'));
        $('#denom_datastore').css("visibility", "visible");
        var url = 'registers/editCashDenomination';
        var params = {
            url: url,
            data: {
                id: PosnicPro.record_id
            }
        };
        PosnicPro.get(params, function (response) {
            if (response.type === 'success') {
                var data = response.data.cashfield['0'];
                $('#denom_append tbody').children("tr").remove();
                var total = 0;
                var currency = PosnicPro.local.get('currencySign');
                for (var i = 0; i < data.length; i++) {
                    var row = data[i];
                    var data_item = parseFloat(row.cash);
                    total += parseFloat(row.amount);
                    var id = row.id;
                    var value = parseFloat(row.value);
                    var trow = '<tr id="denom_' + (i + 1) + '" >' +
                            '<td id="denomLineId_' + id + '" style="display:none;">' + id + '</td>' +
                            '<td id="denomLineItemId_' + (i + 1) + '" style="display:none;">' + id + '</td>' +
                            '<td id="denom_cash_' + id + '" class="col-sm-2">' + data_item + '</td>' +
                            '<td class="col-sm-1"><span>x</span></td>' +
                            '<td id="denom_value_' + id + '" class="col-sm-4"><input class="form-control border-control" id="inputdenom_value_' + id + '" type="number" name="countcash_value[]" value=' + value + ' onkeypress="return PosnicPro.isNumber(event)" onchange="PosnicPro.registers.cashdenomValueCheck(this.value,' + data_item + ',\'' + id + '\');"  min="0" step="1" minlength="1" maxlength="20" placeholder="0"></td>' +
                            '<td class="col-sm-1"><span>=</span></td>' +
                            '<td class="text-right">' + currency + '</td><td id="denom_amount_' + id + '" class="col-sm-3"><div class="totaldenom_value" name="totalDenomAmonut[]" id="total_' + id + '">' + parseFloat(row.amount).toFixed(2) + '</td></tr>';
                    $('#denom_append tbody').append(trow);

                }
                $('#TotalCashValue').number(total, 2);
                $('span.number').number(true, 2);
            } else {
                PosnicPro.alert(response.type, response.message);
            }
        }, function (xhr) {
            var response = jQuery.parseJSON(xhr.responseText);
            PosnicPro.alert(response.type, response.message);
        });
    },
    //cash denom value saved collection
    registerDenomSubmit: function () {
        var denom_detail = $('#denom_append tbody tr').map(function () {
            var itemid = $(this).find('td:first-child').text();
            return {
                id: $('#denomLineId_' + itemid).text(),
                cash: $('#denom_cash_' + itemid).text(),
                value: $('#inputdenom_value_' + itemid).val(),
                amount: $('#denom_amount_' + itemid).text()
            };
        }).get(denom_detail);
        var register_data = {
            register_id: PosnicPro.record_id
        };
        var denom_data = {
            denomination_values: denom_detail
        };
        var method = 'POST';
        var url = 'registers/registerDenomsubmit';
        var params = {
            method: method,
            url: url,
            data: JSON.stringify(Object.assign(denom_data, register_data))
        };
        PosnicPro.request(params, function (response) {
            if (response.type === 'success') {
                PosnicPro.registers.viewDenomination(response.data.cashfield);
                $(".infobar-settings-sidebar-overlay").css({"background": "transparent", "position": "initial"});
                $("#infobar-settings-sidebar-denom").removeClass("sidebarshow");
                PosnicPro.alert(response.type, response.message);
                $("#delete").removeAttr('disabled', false).css({"cursor": 'pointer', "color": '#f9616d', "border-color": '#f9616d'});
            } else {
                PosnicPro.alert(response.type, response.message);
            }
        }, function (xhr) {
            var response = jQuery.parseJSON(xhr.responseText);
            PosnicPro.alert(response.type, response.message);
        });
        return false;
    }
};

$("#cash_button_in").click(function () {
    $('#hide_show_cashbutton').show();
    $('.cash_outbutton,.cash_button_Outcheck').hide();
    $('.cash_inbutton,.cash_button_Incheck').show();
});

$("#cash_button_out").click(function () {
    $('#hide_show_cashbutton').show();
    $('.cash_outbutton,.cash_button_Outcheck').show();
    $('.cash_inbutton,.cash_button_Incheck').hide();
});

$('#cash_button_Incheck').click(function () {
    // Cash In/Out is now handled by registerInOutSubmit function
    // which saves to database and reloads the page data
});

$('#cash_button_Outcheck').click(function () {
    // Cash In/Out is now handled by registerInOutSubmit function
    // which saves to database and reloads the page data
});

jQuery('#open_register_log').click(function () {
    $(this).data('clicked', true);
    $("#register_status").val("Opened");
});
jQuery('#register_cloeButton').click(function () {
    $(this).data('clicked', true);
    $("#register_status").val("Closed");
});

jQuery('.close_cashinOutbutton').click(function () {
    $('#cash_button_amount').val('');
    $('#cash_outbutton_amount').val('');
    $('#hide_show_cashbutton').hide();

});

// Check if denomination should be accessible based on total sales
PosnicPro.registers.checkDenominationAccess = function(totalSales) {
    if (totalSales <= 0) {
        // Disable all denomination buttons
        $('[id^="register-denom-btn-"]').prop('disabled', true).css({
            'opacity': '0.5',
            'cursor': 'not-allowed'
        });
        // Disable save/update buttons
        $('#saveDenominationBtn, #updateDenominationBtn').prop('disabled', true).css({
            'opacity': '0.5',
            'cursor': 'not-allowed'
        });
    } else {
        // Enable all denomination buttons
        $('[id^="register-denom-btn-"]').prop('disabled', false).css({
            'opacity': '1',
            'cursor': 'pointer'
        });
        // Enable save/update buttons
        $('#saveDenominationBtn, #updateDenominationBtn').prop('disabled', false).css({
            'opacity': '1',
            'cursor': 'pointer'
        });
    }
};

// Initialize denomination buttons for Cash Register
PosnicPro.registers.initRegisterDenominationButtons = function() {
    $('#register_render_amount').html('');
    PosnicPro.registers.registerDenominationCounts = {};
    
    var currency = PosnicPro.local.get('currencySign');
    
    // Get denominations from database or use default
    let denominations = [];
    if (PosnicPro.sales.SaleDenomination && PosnicPro.sales.SaleDenomination.length > 0) {
        denominations = PosnicPro.sales.SaleDenomination.map(d => parseFloat(d.amount)).sort((a, b) => a - b);
    } else {
        denominations = PosnicPro.sales.defaultDenominations();
    }
    
    // Build denomination HTML
    let renderAmount = '';
    denominations.forEach((denom) => {
        PosnicPro.registers.registerDenominationCounts[denom] = 0;
        
        renderAmount += 
            '<div class="col-3 mb-2" style="padding: 3px;">' +
                '<div class="register-denom-card-' + denom + '" style="border: 1px solid #ddd; border-radius: 6px; padding: 6px; background: #fff; box-shadow: 0 1px 3px rgba(0,0,0,0.06);">' +
                    '<div id="register-controls-' + denom + '" style="display: none; align-items: center; gap: 4px; margin-bottom: 4px;">' +
                        '<button onclick="PosnicPro.registers.decreaseRegisterDenom(' + denom + '); return false;" style="flex: 1; height: 28px; padding: 0; font-size: 20px; line-height: 28px; font-weight: 600; border-radius: 4px; background: #f8b4b4; color: #fff; border: none; cursor: pointer;">−</button>' +
                        '<button onclick="PosnicPro.registers.increaseRegisterDenom(' + denom + '); return false;" style="flex: 1; height: 28px; padding: 0; font-size: 20px; line-height: 28px; font-weight: 600; border-radius: 4px; background: #90ee90; color: #fff; border: none; cursor: pointer;">+</button>' +
                    '</div>' +
                    '<div style="position: relative;">' +
                        '<span id="register-count-' + denom + '" style="position: absolute; top: -4px; left: -4px; display: none; font-size: 11px; min-width: 20px; padding: 2px 5px; background: #34495e; color: #fff; border-radius: 10px; font-weight: 700; text-align: center; z-index: 10; box-shadow: 0 1px 3px rgba(0,0,0,0.3);">0</span>' +
                        '<button id="register-denom-btn-' + denom + '" onclick="PosnicPro.registers.increaseRegisterDenom(' + denom + '); return false;" style="width: 100%; font-weight: 600; font-size: 13px; padding: 6px 4px; background: #fff; color: #3498db; border: 1.5px solid #3498db; border-radius: 4px; cursor: pointer; transition: all 0.2s;">' + 
                            currency + ' ' + denom.toFixed(2) +
                        '</button>' +
                    '</div>' +
                '</div>' +
            '</div>';
    });
    
    $('#register_render_amount').append(renderAmount);
    
    // Initialize total to 0.00
    $('#denomTotal').text('0.00');
};

PosnicPro.registers.increaseRegisterDenom = function(denom) {
    if (!PosnicPro.registers.registerDenominationCounts[denom]) {
        PosnicPro.registers.registerDenominationCounts[denom] = 0;
    }
    PosnicPro.registers.registerDenominationCounts[denom]++;
    
    let $countBadge = $('#register-count-' + denom);
    let $denomBtn = $('#register-denom-btn-' + denom);
    let $controls = $('#register-controls-' + denom);
    
    $countBadge.text(PosnicPro.registers.registerDenominationCounts[denom]);
    
    if (PosnicPro.registers.registerDenominationCounts[denom] > 0) {
        $countBadge.css('display', 'inline-block');
        $controls.css('display', 'flex');
        $denomBtn.css({
            'background': '#3498db',
            'color': '#fff',
            'border-color': '#3498db'
        });
    }
    
    PosnicPro.registers.updateRegisterDenomTotal();
};

PosnicPro.registers.decreaseRegisterDenom = function(denom) {
    if (!PosnicPro.registers.registerDenominationCounts[denom]) {
        PosnicPro.registers.registerDenominationCounts[denom] = 0;
    }
    if (PosnicPro.registers.registerDenominationCounts[denom] > 0) {
        PosnicPro.registers.registerDenominationCounts[denom]--;
        
        let $countBadge = $('#register-count-' + denom);
        let $denomBtn = $('#register-denom-btn-' + denom);
        let $controls = $('#register-controls-' + denom);
        
        $countBadge.text(PosnicPro.registers.registerDenominationCounts[denom]);
        
        if (PosnicPro.registers.registerDenominationCounts[denom] === 0) {
            $countBadge.css('display', 'none');
            $controls.css('display', 'none');
            $denomBtn.css({
                'background': '#fff',
                'color': '#3498db',
                'border-color': '#3498db'
            });
        }
        
        PosnicPro.registers.updateRegisterDenomTotal();
    }
};

PosnicPro.registers.updateRegisterDenomTotal = function() {
    let total = 0;
    let hasAnyCount = false;
    
    for (let denom in PosnicPro.registers.registerDenominationCounts) {
        let count = PosnicPro.registers.registerDenominationCounts[denom] || 0;
        total += (parseFloat(denom) * count);
        if (count > 0) {
            hasAnyCount = true;
        }
    }
    
    $('#denomTotal').text(total.toFixed(2));
    
    // Enable/disable Update Denomination and Delete buttons based on whether any denomination exists
    if (hasAnyCount) {
        $("#updateDenominationBtn").removeAttr('disabled').css({"cursor": 'pointer', "opacity": '1'});
        $("#delete").removeAttr('disabled').css({"cursor": 'pointer', "color": '#f9616d', "border-color": '#f9616d'});
    } else {
        $("#updateDenominationBtn").attr('disabled', true).css({"cursor": 'not-allowed', "opacity": '0.5'});
        $("#delete").attr('disabled', true).css({"cursor": 'not-allowed', "color": '#d8d3d3', "border-color": '#d8d3d3'});
    }
};

PosnicPro.registers.saveDenominationData = function() {
    // Prepare denomination data in API format
    let denomData = [];
    for (let denom in PosnicPro.registers.registerDenominationCounts) {
        let count = PosnicPro.registers.registerDenominationCounts[denom] || 0;
        if (count > 0) {
            denomData.push({
                cash: denom.toString(),
                value: count.toString(),
                amount: (parseFloat(denom) * count).toString()
            });
        }
    }
    
    let params = {
        method: 'POST',
        url: 'registers/registerDenomsubmit',
        data: JSON.stringify({
            register_id: PosnicPro.record_id,
            denomination_values: denomData
        })
    };
    
    PosnicPro.request(params, function(response) {
        if (response.type === 'success') {
            PosnicPro.alert(response.type, response.message);
            $('#saveDenominationBtn').hide();
            $('#updateDenominationBtn').show();
            PosnicPro.registers.hasDenominationData = true;
        } else {
            PosnicPro.alert(response.type, response.message);
        }
    });
};

PosnicPro.registers.updateDenominationData = function() {
    // Prepare denomination data in API format
    let denomData = [];
    for (let denom in PosnicPro.registers.registerDenominationCounts) {
        let count = PosnicPro.registers.registerDenominationCounts[denom] || 0;
        if (count > 0) {
            denomData.push({
                cash: denom.toString(),
                value: count.toString(),
                amount: (parseFloat(denom) * count).toString()
            });
        }
    }
    
    let params = {
        method: 'POST',
        url: 'registers/registerDenomsubmit',
        data: JSON.stringify({
            register_id: PosnicPro.record_id,
            denomination_values: denomData
        })
    };
    
    PosnicPro.request(params, function(response) {
        if (response.type === 'success') {
            PosnicPro.alert(response.type, response.message);
        } else {
            PosnicPro.alert(response.type, response.message);
        }
    });
};

// Overview table row action -> open flow (delegated: rows repaint)
$(document).on('click', '.register-open-btn', function () {
    PosnicPro.registers.promptOpen(parseInt($(this).data('idx'), 10));
});

// Delete Cash In/Out functionality - API based
$(document).on('click', '.delete-cashinout-btn', function() {
    var $row = $(this).closest('tr');
    var type = $row.data('type');
    var index = $row.data('index');
    
    // Set the type text in modal
    $('#cashinout_type_text').text(type === 'in' ? PosnicPro.i18n.t('lang_cash_in_title', 'Cash In') : PosnicPro.i18n.t('lang_cash_out_title', 'Cash Out'));
    
    // Store index and type for confirmation
    $('#confirm_delete_cashinout').data('index', index);
    $('#confirm_delete_cashinout').data('type', type);
    
    // Show modal
    $('#delete_cashinout_modal').modal('show');
});

// Confirm delete Cash In/Out - API based
$('#confirm_delete_cashinout').off('click').on('click', function() {
    var index = $(this).data('index');
    var type = $(this).data('type');
    
    // Get _id from reg_upd_id (MongoDB document _id)
    var register_id = $('#reg_upd_id').val();
    
    // Debug logging
    console.log('Delete Cash In/Out - Index:', index, 'Type:', type, 'Register ID (_id):', register_id, 'From reg_upd_id:', $('#reg_upd_id').val());
    
    if (!register_id || register_id === 'undefined' || register_id === '') {
        PosnicPro.alert('error', PosnicPro.i18n.t('lang_register_not_found_please_reload_the_page', 'Register not found. Please reload the page.'));
        $('#delete_cashinout_modal').modal('hide');
        return;
    }
    
    var params = {
        method: 'POST',
        url: 'registers/deleteCashInOut',
        data: JSON.stringify({
            register_id: register_id,
            index: index,
            type: type
        })
    };
    
    PosnicPro.request(params, function(response) {
        if (response.type === 'success') {
            $('#delete_cashinout_modal').modal('hide');
            PosnicPro.alert(response.type, response.message);
            
            // Reload register data to refresh all calculations
            let reload_register_id = PosnicPro.local.get('register_id');
            if (reload_register_id) {
                setTimeout(function() {
                    PosnicPro.registers.cashReportRegister(reload_register_id);
                }, 500);
            }
        } else {
            $('#delete_cashinout_modal').modal('hide');
            PosnicPro.alert(response.type, response.message);
        }
    }, function(xhr) {
        $('#delete_cashinout_modal').modal('hide');
        var response = jQuery.parseJSON(xhr.responseText);
        PosnicPro.alert(response.type, response.message);
    });
});
