PosnicPro.itemreport = {
    activateCustomPanel: function (panel) {
        var active = panel === 'versements' ? 'versements' : 'stock';
        window.__posnicActiveItemReportPanel = active;
        window.__posnicOpenVersements = false;
        window.__posnicOpenStockHealth = false;
        $('#stock-health-panel,#versements-panel').hide();
        if (active === 'versements') {
            $('#versements-panel').show();
            if (PosnicPro.versementsRegister) PosnicPro.versementsRegister.load();
        } else {
            $('#stock-health-panel').show();
            if (PosnicPro.stockHealthReport) PosnicPro.stockHealthReport.load();
        }
    },
    showDataTablePage: function () {
        var loader = $(".loader-item-report");
        loader.find(".loadingSpinner:first").remove();
        PosnicPro.dashboard.datePicker();
        PosnicPro.HideSideBarModal();
        $(".vertical-layout").removeClass("toggle-menu");
        $(".vertical-menu li a").removeClass("active");
        $('.dropdown-item').removeClass('active');
        $('.page_loader,#osk-container').hide();
        $('.page-title-box,#itemreport_new,.item-report-item').show();
        $('#v-pills-report-tab,#viewitemreport_page').addClass('active');
        $('#v-pills-report').addClass('show active');
        // The router may enter this page more than once for one menu click.
        // Keep the chosen sub-report until another explicit menu item replaces it.
        var requestedPanel = window.__posnicOpenVersements===true ? 'versements'
            : (window.__posnicOpenStockHealth===true ? 'stock' : '');
        window.__posnicOpenVersements=false;
        window.__posnicOpenStockHealth=false;
        var activePanel = requestedPanel || window.__posnicActiveItemReportPanel || 'stock';
        window.__posnicActiveItemReportPanel = activePanel;
        $('#stock-health-panel,#versements-panel').hide();
        PosnicPro.itemreport.activateCustomPanel(activePanel);
        if (false && $('a#item-tab-line').hasClass('active')) {
            PosnicPro.itemreport.itemTableTabClick();
        } else if ($('a#item-expiry-line').hasClass('active')) {
            PosnicPro.itemexpiry.itemExpiryTabClick();
        } else if ($('a#item-stock-line').hasClass('active')) {
            PosnicPro.itemstock.itemstockTable();
        }
        $('.hide_date_filetr,.hide_value_filetr').hide();
        if (PosnicPro.local.get('userplan') === 'free') {
            $('#item-line, #item-graph-line, #item-expiry-date, #item-stock-date').css('filter', 'blur(2px)');
            $('#itemreport_exportbtn, #itemexpiry_exportbtn, #itemstock_exportbtn').attr('disabled', true).css({
                'pointer-events': 'none',
                'cursor': 'not-allowed',
                'opacity': '0.5'
            });
            $('#items_upgrade').show();
        } else {
            $('#item-line, #item-graph-line, #item-expiry-date, #item-stock-date').css('filter', 'none');
            $('#itemreport_exportbtn,#itemexpiry_exportbtn, #itemstock_exportbtn').removeAttr('disabled').css({
                'pointer-events': 'auto',
                'cursor': 'pointer',
                'opacity': '1'
            });
            $('#items_upgrade').hide();
        }
    },
    itemreportTable: function (type) {
        var branchId = $(".item_branch_value").val().toString();
        if (branchId !== '') {
            var loader = $(".loader-item-report");
            $("<div class='loadingSpinner'></div>").appendTo(loader);
            PosnicPro.appendReportTableBody('itemreport');
            var daterange = $(".view_item_report_daterange").val();
            var fields = daterange.split('-');
            var table = $('#view_itemreport');

            if (type === 'itemreportexport') {
                var per_page = table.data('total');
            } else {
                var current_page = table.data('current_page');
                var per_page = parseInt($('#view_itemreport_per_page  option:selected').text());
            }

            var data = {
                page: current_page,
                limit: per_page,
                starting_date: fields[0],
                ending_date: fields[1],
                branch: $(".item_branch_value").val(),
                // Family view is a table-only READING rollup; the export
                // branch never sends it - exports stay per-item, always.
                group_by_family: (type !== 'itemreportexport' && $('#itemreport_group_family').is(':checked'))
                    ? 'true' : 'false'
            };
            var params = {
                url: 'sales/itemSalesReportTable',
                data: data
            };
            PosnicPro.get(params, function (response) {
                if (response.type === 'success') {
                    loader.find(".loadingSpinner:first").remove();
                    (response.data.total > 0) ? $('#itemreport_exportbtn').removeAttr('disabled') : $('#itemreport_exportbtn').attr('disabled', 'disabled');
                    if (type !== 'itemreportexport') {
                        table.data('total', response.data.total);
                        table.data('total_pages', response.data.total_pages);
                        table.data('current_page', response.data.current_page);
                        table.data('per_page', response.data.per_page);
                        PosnicPro.paging(response.data.total_pages, response.data.current_page);
                        table.children('tbody').text('');
                        $('#view_itemreport_total').text(response.data.total);
                        var rowTotal = response.data.total;
                        if (rowTotal === 0) {
                            $('.reportitem_header').hide();
                            let dateRange = $('#view_sales_daterange span span[data-toggle="tooltip"]').attr('data-original-title');
                            $('.reportitem_norecord')
                                .empty()
                                /* .text() on the part that came out of the DOM: a
                                   date range read back from an attribute is a VALUE,
                                   and concatenating it into markup is what lets a
                                   field somebody typed become a tag. */
                                .append(
                                    $('<div class="text-center text-dark"></div>').append(
                                        $('<p></p>').text('No Records on ' + dateRange)
                                    )
                                );
                            $('#reportitem_img_hide,.reportitem_norecord').show();

                        } else {
                            $('.reportitem_norecord').empty();
                            $('#reportitem_img_hide,.reportitem_norecord').hide();
                            $('.reportitem_header').show();
                        }

                        var row_total = (table.data('current_page') - 1) * table.data('per_page') + 1;
                        $('#view_itemreport_page_total').text(row_total);
                        var page_totals = (table.data('current_page') - 1) * table.data('per_page');
                        $('#view_itemreport_page_perpage_total').text(page_totals + response.data.list.length);
                        var currency = PosnicPro.local.get('currencySign');
                        for (var i = 0; i < response.data.list.length; i++) {
                            var row = response.data.list[i];
                            var row_no = (table.data('current_page') - 1) * table.data('per_page') + i + 1;
                            var familyNote = (row.family_members > 1)
                                ? ' <small class="text-muted">(' + row.family_members + ' variants)</small>' : '';
                            let trow = '<tr> <td scope="row">' + row_no + '</td> <td>' + row.name + familyNote + '</td> <td class="text-center">' + row.item_quantity + '</td> <td class="text-center">' + row.sales_count + '</td> <td class="text-right">' + currency + '&nbsp;<span>' + row.sales_profit.toFixed(2) + '</span></td> <td class="text-right">' + currency + '&nbsp;<span class="number">' + row.sales_avg + '</span></td> <td class="text-right">' + currency + '&nbsp;<span class="number">' + row.total_amount + '</span></td></tr>';
                            $('#view_itemreport').children('tbody').append(trow);
                        }
                        $('span.number').number(true, 2);
                    } else {
                        var itemreport = [];
                        data = response.data.list;
                        $(data).each(function (key, val) {
                            var name = val.name;
                            var noofsold = val.item_quantity;
                            var noofsale = val.sales_count;
                            var profit = val.sales_profit;
                            var avgsale = val.sales_avg;
                            var total = val.total_amount;
                            itemreport.push({Itemname: name, NoofSold: noofsold, NoofSale: noofsale, Profit: profit, AvgSale: avgsale, Total: total});
                        });
                        PosnicPro.JSONToCSVConvertor(itemreport, 'item-reports', true);
                        PosnicPro.itemreport.itemreportTable();
                    }
                } else {
                    PosnicPro.alert(response.type, response.message);
                }
            }, function (xhr) {
                var response = jQuery.parseJSON(xhr.responseText);
                PosnicPro.alert(response.type, response.message);
            });
        } else {
            $(".item_branch_value").focus();
        }
    },
    itemreportExport: function (index) {
        var type = $(index).data('id');
        PosnicPro.itemreport.itemreportTable(type);
    },
    itemTableTabClick: function () {
        $('#change_item_view').data('id', 'tableView');
        PosnicPro.itemreport.itemreportTable();
    }
};

PosnicPro.itemexpiry = {
    expiredItemsReportExport: function (index) {
        var type = $(index).data('id');
        PosnicPro.itemexpiry.itemexpiryTable(type);
    },
    itemexpiryTable: function (type) {
        var branchId = $(".item_branch_value").val().toString();
        if (branchId !== '') {
            var loader = $(".loader-item-report");
            $("<div class='loadingSpinner'></div>").appendTo(loader);
            PosnicPro.appendReportTableBody('itemexpiry'); // Assuming you have a function to append table body

            var daterange = $(".view_item_report_daterange").val();
            var fields = daterange.split('-');
            var table = $('#view_itemexpiry');

            if (type === 'itemexpiryexport') {
                var per_page = table.data('total');
            } else {
                var current_page = table.data('current_page');
                var per_page = parseInt($('#view_itemexpiry_per_page  option:selected').text());
            }
            var data = {
                page: current_page,
                limit: per_page,
                starting_date: fields[0],
                ending_date: fields[1],
                branch: branchId
            };

            var params = {
                url: 'sales/itemExpiryReportTable',
                data: data
            };

            PosnicPro.get(params, function (response) {
                if (response.type === 'success') {
                    loader.find(".loadingSpinner:first").remove();
                    (response.data.total > 0) ? $('#itemexpiry_exportbtn').removeAttr('disabled') : $('#itemexpiry_exportbtn').attr('disabled', 'disabled');

                    if (type !== 'itemexpiryexport') {
                        table.data('total', response.data.total);
                        table.data('total_pages', response.data.total_pages);
                        table.data('current_page', response.data.current_page);
                        table.data('per_page', response.data.per_page);
                        PosnicPro.paging(response.data.total_pages, response.data.current_page);
                        table.children('tbody').text('');
                        $('#view_itemexpiry_total').text(response.data.total);

                        var rowTotal = response.data.total;
                        if (rowTotal === 0) {
                            // No expired products: hide both the static header/pagination
                            // and the dynamic expiry header table so only the "No Records"
                            // message + illustration are visible.
                            $('.expiryreportitem_header').hide();
                            $('.view_itemexpiry_header').hide();
                            $('#view_expiryitemreport').hide();

                            let dateRange = $('#view_sales_daterange span span[data-toggle="tooltip"]').attr('data-original-title');
                            $('.expiryreportitem_norecord')
                                .empty()
                                /* .text() on the part that came out of the DOM: a
                                   date range read back from an attribute is a VALUE,
                                   and concatenating it into markup is what lets a
                                   field somebody typed become a tag. */
                                .append(
                                    $('<div class="text-center text-dark"></div>').append(
                                        $('<p></p>').text('No Records on ' + dateRange)
                                    )
                                );
                            $('#expiryreportitem_img_hide,.expiryreportitem_norecord').show();
                        } else {
                            // Data exists: show both headers/tables and hide the empty state.
                            $('.expiryreportitem_norecord').empty();
                            $('#expiryreportitem_img_hide,.expiryreportitem_norecord').hide();
                            $('.expiryreportitem_header').show();
                            $('.view_itemexpiry_header').show();
                            $('#view_expiryitemreport').show();
                        }
                        var row_total = (table.data('current_page') - 1) * table.data('per_page') + 1;
                        $('#view_itemexpiry_page_total').text(row_total);
                        var page_totals = (table.data('current_page') - 1) * table.data('per_page');
                        $('#view_itemexpiry_page_perpage_total').text(page_totals + response.data.list.length);

                        for (var i = 0; i < response.data.list.length; i++) {
                            var row = response.data.list[i];
                            var row_no = (table.data('current_page') - 1) * table.data('per_page') + i + 1;
                            let trow = '<tr> <td scope="row">' + row_no + '</td> <td>' + row.item_name + '</td> <td class="text-center">' + row.available_quantity + '</td> <td class="text-center">' + row.category_name + '</td> <td class="text-right">' + row.expiry_date + '</td></tr>';
                            $('#view_itemexpiry').children('tbody').append(trow);
                        }
                    } else {
                        PosnicPro.JSONToCSVConvertor(response.data.list, 'item-expiry-reports', true);
                        PosnicPro.itemexpiry.itemexpiryTable();
                    }
                } else {
                    PosnicPro.alert(response.type, response.message);
                }
            }, function (xhr) {
                var response = jQuery.parseJSON(xhr.responseText);
                PosnicPro.alert(response.type, response.message);
            });
        } else {
            $(".item_branch_value").focus();
        }
    },
    itemExpiryTabClick: function () {
        $('#change_item_view').data('id', 'expiryView');
        PosnicPro.itemexpiry.itemexpiryTable();
    }
};

PosnicPro.itemstock = {
    stockItemsReportExport: function (index) {
        var type = $(index).data('id');
        PosnicPro.itemstock.itemstockTable(type);
    },
    itemstockTable: function (type) {
        var branchId = $(".item_branch_value").val().toString();
        if (branchId !== '') {
            var loader = $(".loader-item-report");
            $("<div class='loadingSpinner'></div>").appendTo(loader);
            PosnicPro.appendReportTableBody('itemstock'); // Assuming you have a function to append table body

            var daterange = $(".view_item_report_daterange").val();
            var fields = daterange.split('-');
            var table = $('#view_itemstock');

            if (type === 'itemstockexport') {
                var per_page = table.data('total');
            } else {
                var current_page = table.data('current_page');
                var per_page = parseInt($('#view_itemstock_per_page  option:selected').text());
            }
            var data = {
                page: current_page,
                limit: per_page,
                starting_date: fields[0],
                ending_date: fields[1],
                branch: branchId
            };

            var params = {
                url: 'items/itemStockReportTable',
                data: data
            };

            PosnicPro.get(params, function (response) {
                if (response.type === 'success') {
                    loader.find(".loadingSpinner:first").remove();
                    (response.data.total > 0) ? $('#itemstock_exportbtn').removeAttr('disabled') : $('#itemstock_exportbtn').attr('disabled', 'disabled');

                    if (type !== 'itemstockexport') {
                        table.data('total', response.data.total);
                        table.data('total_pages', response.data.total_pages);
                        table.data('current_page', response.data.current_page);
                        table.data('per_page', response.data.per_page);
                        PosnicPro.paging(response.data.total_pages, response.data.current_page);
                        table.children('tbody').text('');
                        $('#view_itemstock_total').text(response.data.total);

                        var rowTotal = response.data.total;
                        if (rowTotal === 0) {
                            $('.stockreportitem_header').hide();
                            let dateRange = $('#view_sales_daterange span span[data-toggle="tooltip"]').attr('data-original-title');
                            $('.stockreportitem_norecord')
                                .empty()
                                /* .text() on the part that came out of the DOM: a
                                   date range read back from an attribute is a VALUE,
                                   and concatenating it into markup is what lets a
                                   field somebody typed become a tag. */
                                .append(
                                    $('<div class="text-center text-dark"></div>').append(
                                        $('<p></p>').text('No Records on ' + dateRange)
                                    )
                                );
                            $('#stockreportitem_img_hide,.stockreportitem_norecord').show();
                        } else {
                            $('.stockreportitem_norecord').empty();
                            $('#stockreportitem_img_hide,.stockreportitem_norecord').hide();
                            $('.stockreportitem_header').show();
                        }
                        var row_total = (table.data('current_page') - 1) * table.data('per_page') + 1;
                        $('#view_itemstock_page_total').text(row_total);
                        var page_totals = (table.data('current_page') - 1) * table.data('per_page');
                        $('#view_itemstock_page_perpage_total').text(page_totals + response.data.list.length);
                        var currency = PosnicPro.local.get('currencySign');
                        for (var i = 0; i < response.data.list.length; i++) {
                            var row = response.data.list[i];
                            var row_no = (table.data('current_page') - 1) * table.data('per_page') + i + 1;
                            let trow = '<tr> <td scope="row">' + row_no + '</td> <td>' + row.name + '</td> <td class="text-center">' + row.available_quantity + '</td> <td class="text-right">' + currency + '&nbsp;' + row.company_price.toFixed(2) + '</td> <td class="text-right">' + currency + '&nbsp;' + row.company_total.toFixed(2) + '</td><td class="text-right">' + currency + '&nbsp;' + row.selling_price.toFixed(2) + '</td><td class="text-right">' + currency + '&nbsp;' + row.selling_total.toFixed(2) + '</td></tr>';
                            $('#view_itemstock').children('tbody').append(trow);
                        }
                        $('.item_stock_company').text(response.data.company_total.toFixed(2));
                        $('.item_stock_selling').text(response.data.selling_total.toFixed(2));
                    } else {
                        PosnicPro.JSONToCSVConvertor(response.data.list, 'item-stock-reports', true);
                        PosnicPro.itemstock.itemstockTable();
                    }
                } else {
                    PosnicPro.alert(response.type, response.message);
                }
            }, function (xhr) {
                var response = jQuery.parseJSON(xhr.responseText);
                PosnicPro.alert(response.type, response.message);
            });
        } else {
            $(".item_branch_value").focus();
        }
    },
    itemStockTabClick: function () {
        $('#change_item_view').data('id', 'stockView');
        PosnicPro.itemstock.itemstockTable();
    }
};



PosnicPro.itemroot = {
    viewPage: function (index) {
        var type = $(index).data('id');
        if (type === 'tableView') {
            PosnicPro.itemreport.itemreportTable();
        } else if (type === 'expiryView') {
            PosnicPro.itemexpiry.itemexpiryTable();
        } else if (type === 'stockView') {
            PosnicPro.itemstock.itemstockTable();
        }
    }
};

$(document).ready(function () {
    var hash = window.location.hash.slice(1);
    if (hash === '/itemreport') {
        var loader = $(".loader-item-report");
        loader.find(".loadingSpinner:first").remove();
        PosnicPro.itemreport.itemreportTable();
    }
});



/* Stock health dashboard: theme-aware analytics over completed sales and live inventory. */
PosnicPro.stockHealthReport = (function () {
    var snapshot = null, filtered = null;
    function currency(value) { return (PosnicPro.local.get('currencySign') || '') + ' ' + (Number(value || 0)).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 }); }
    function safeCell(value) { return $('<td>').text(value == null ? '' : String(value)); }
    function filterRows(rows) {
        var q=String($('#stock-health-search').val()||'').trim().toLowerCase(), category=$('#stock-health-category').val(), brand=$('#stock-health-brand').val(), status=$('#stock-health-status').val();
        return (rows||[]).filter(function(r){
            if(q && (String(r.name||'')+' '+String(r.sku||'')).toLowerCase().indexOf(q)<0)return false;
            if(category && r.category!==category)return false; if(brand && r.brand!==brand)return false;
            if(status==='critical' && Number(r.stock)>5)return false;
            if(status==='dormant' && (r.never_sold || Number(r.days_since_sale)<Number(snapshot.dormant_days||90)))return false;
            if(status==='never' && !r.never_sold)return false;
            if(status==='active' && (r.never_sold || Number(r.days_since_sale)>=Number(snapshot.dormant_days||90)))return false;
            return true;
        });
    }
    function drawRows(selector, rows, mode) {
        var body=$(selector).empty();
        if(!rows||!rows.length){body.append($('<tr>').append($('<td colspan="8" class="text-center py-4 sh-muted">').text('Aucun produit ne correspond à ces critères.')));return;}
        rows.forEach(function(r){var tr=$('<tr>');tr.append(safeCell(r.name),safeCell(r.sku));if(mode==='all')tr.append(safeCell(r.category),safeCell(r.brand));tr.append(safeCell(r.stock));if(mode==='all')tr.append(safeCell(r.sold_quantity));if(mode==='dormant')tr.append(safeCell(r.last_sale?moment(r.last_sale).format('DD/MM/YYYY'):'—'),safeCell(r.days_since_sale));tr.append(safeCell(currency(r.stock_value)));body.append(tr);});
    }
    function renderTrend(points) {
        var holder=$('#stock-health-trend-chart').empty(), data=points||[];
        if(!data.length){holder.text('Aucune vente enregistrée sur cette période.').addClass('sh-muted');return;}
        var max=Math.max(1,...data.map(p=>Number(p.quantity)||0)), width=720, height=160, pad=12;
        var coords=data.map((p,i)=>({x:pad+i*(width-2*pad)/Math.max(1,data.length-1),y:height-pad-(Number(p.quantity)||0)/max*(height-2*pad)}));
        var line=coords.map((p,i)=>(i?'L':'M')+p.x.toFixed(1)+' '+p.y.toFixed(1)).join(' ');
        var area=line+' L '+coords[coords.length-1].x+' '+(height-pad)+' L '+coords[0].x+' '+(height-pad)+' Z';
        var svg=$('<svg viewBox="0 0 720 180" role="img" aria-label="Sales quantity trend"></svg>');
        [0,.5,1].forEach(function(v){var y=pad+v*(height-2*pad);svg.append($('<line x1="12" x2="708">').attr('y1',y).attr('y2',y).attr('stroke','var(--sh-border)').attr('stroke-dasharray','4 5'));});
        svg.append($('<path>').attr('d',area).attr('fill','var(--posnic-accent-soft,rgba(37,99,235,.12))'));
        svg.append($('<path>').attr('d',line).attr('fill','none').attr('stroke','var(--sh-accent)').attr('stroke-width','3').attr('stroke-linecap','round').attr('stroke-linejoin','round'));
        coords.forEach(function(p,i){if(i%5===0||i===coords.length-1)svg.append($('<circle>').attr('cx',p.x).attr('cy',p.y).attr('r',3.5).attr('fill','var(--sh-accent)'));});
        holder.append(svg);
        var labels=$('<div class="d-flex justify-content-between sh-muted small">').append($('<span>').text(data[0].date),$('<span>').text(data[Math.floor(data.length/2)].date),$('<span>').text(data[data.length-1].date));holder.append(labels);
        var total=data.reduce((s,p)=>s+(Number(p.quantity)||0),0);holder.append($('<div class="mt-2 small sh-muted">').text('Total vendu sur 30 jours : '+total.toLocaleString()));
    }
    function renderCategoryComparison(rows) {
        var groups = {};
        (rows || []).forEach(function (r) {
            var key = String(r.category || 'Sans catégorie');
            var quantity = Math.max(0, Number(r.stock != null ? r.stock : r.quantity) || 0);
            var unitCost = Number(r.buying_price != null ? r.buying_price : r.unit_cost);
            var unitRetail = Number(r.selling_price_1 != null ? r.selling_price_1 : r.selling_price);
            if (!groups[key]) groups[key] = { name: key, cost: 0, retail: 0, units: 0 };
            groups[key].units += quantity;
            groups[key].cost += quantity * (Number.isFinite(unitCost) ? unitCost : (Number(r.stock_value) || 0) / Math.max(1, quantity));
            groups[key].retail += quantity * (Number.isFinite(unitRetail) ? unitRetail : 0);
        });
        var cats = Object.keys(groups).map(function (key) { return groups[key]; }).sort(function (a, b) { return b.retail - a.retail; }).slice(0, 10);
        var host = $('#stock-health-category-value-chart').empty().css({ width: '100%', minHeight: '260px', height: '260px', overflowY: 'auto', overflowX: 'hidden' });
        if (!cats.length) {
            host.append($('<div class="text-center sh-muted py-5">Aucune donnée de stock disponible.</div>'));
            return;
        }
        var width = 680, rowHeight = 24, top = 12, left = 116, right = 14;
        var height = Math.max(190, top + cats.length * 43 + 28), plotWidth = width - left - right;
        var max = Math.max(1, ...cats.map(function (x) { return Math.max(x.cost, x.retail); }));
        var svg = $('<svg viewBox="0 0 ' + width + ' ' + height + '" role="img" aria-label="Grouped stock purchase and retail value by category" style="display:block;width:100%;height:' + height + 'px;min-height:260px;overflow:visible"></svg>');
        cats.forEach(function (x, index) {
            var y = top + index * 43;
            svg.append($('<text>').attr({ x: left - 8, y: y + 15, 'text-anchor': 'end', fill: 'var(--sh-text)', 'font-size': 11 }).text(x.name.length > 18 ? x.name.slice(0, 17) + '…' : x.name));
            var costWidth = x.cost / max * plotWidth, retailWidth = x.retail / max * plotWidth;
            var costBar = $('<rect>').attr({ x: left, y: y, width: Math.max(x.cost > 0 ? 1 : 0, costWidth), height: 9, rx: 4, fill: '#0d9488', style: 'cursor:pointer' });
            costBar.append($('<title>').text(x.name + ' · Coût d’achat: ' + currency(x.cost) + ' DZD · ' + x.units.toLocaleString() + ' unités'));
            var retailBar = $('<rect>').attr({ x: left, y: y + 13, width: Math.max(x.retail > 0 ? 1 : 0, retailWidth), height: 9, rx: 4, fill: '#2563eb', style: 'cursor:pointer' });
            retailBar.append($('<title>').text(x.name + ' · Valeur de vente: ' + currency(x.retail) + ' DZD · ' + x.units.toLocaleString() + ' unités'));
            svg.append(costBar, retailBar);
        });
        host.append(svg, $('<div class="d-flex flex-wrap sh-muted small mt-1" style="gap:14px">').append(
            $('<span>').html('<i style="display:inline-block;width:9px;height:9px;border-radius:2px;background:#0d9488;margin-right:5px"></i>Coût d’achat'),
            $('<span>').html('<i style="display:inline-block;width:9px;height:9px;border-radius:2px;background:#2563eb;margin-right:5px"></i>Valeur de vente')
        ));
    }
    function renderStockLevels(rows) {
        var host = $('#stock-health-stock-levels-chart').empty(), list = (rows || []).slice();
        if (!list.length) { host.text('Aucun article en stock.').addClass('sh-muted'); return; }
        var top = list.slice().sort(function (a,b) { return Number(b.stock)-Number(a.stock); }).slice(0,5);
        var low = list.slice().sort(function (a,b) { return Number(a.stock)-Number(b.stock); }).slice(0,5);
        function section(title, values, color) {
            host.append($('<div class="small font-weight-bold mb-2 mt-2">').text(title));
            var max = Math.max(1,...values.map(function(r){return Number(r.stock)||0;}));
            values.forEach(function (r) {
                var row = $('<div class="mb-2">');
                var head = $('<div class="d-flex justify-content-between small mb-1">').append($('<span class="text-truncate pr-2">').text(r.name), $('<strong>').text(Number(r.stock).toLocaleString()));
                var bar = $('<div style="height:7px;border-radius:8px;background:var(--sh-border);overflow:hidden">').append($('<div>').css({height:'100%',width:(Math.max(0,Number(r.stock)||0)/max*100)+'%',background:color,borderRadius:'8px'}));
                row.append(head,bar); host.append(row);
            });
        }
        section('Top stock',top,'#2563eb'); section('Stock faible',low,'#f59e0b');
    }
    function renderCategoryDonut(rows) {
        var groups = {};
        (rows || []).forEach(function (r) {
            var key = String(r.category || 'Sans catégorie');
            groups[key] = (groups[key] || 0) + Math.max(0, Number(r.stock != null ? r.stock : r.quantity) || 0);
        });
        var vals = Object.keys(groups).map(function (key) { return { name: key, value: groups[key] }; }).sort(function (a, b) { return b.value - a.value; });
        var total = vals.reduce(function (sum, item) { return sum + item.value; }, 0);
        var host = $('#stock-health-category-donut').empty().css({ width: '100%', minHeight: '260px', height: '260px' });
        var colors = ['#2563eb', '#0d9488', '#f59e0b', '#16a34a', '#8b5cf6', '#ec4899', '#0891b2', '#f97316'];
        var radius = 43, circumference = 2 * Math.PI * radius, offset = 0;
        var svg = $('<svg viewBox="0 0 140 140" role="img" aria-label="Stock unit distribution by category" style="width:150px;height:150px;flex:0 0 150px;display:block;overflow:visible"></svg>');
        svg.append($('<circle cx="70" cy="70" r="43" fill="none" stroke="var(--sh-border)" stroke-width="14"></circle>'));
        if (total > 0) {
            vals.forEach(function (item, index) {
                var segment = circumference * item.value / total;
                var arc = $('<circle cx="70" cy="70" r="43" fill="none" stroke-width="14" stroke-linecap="butt" style="cursor:pointer"></circle>').attr({
                    stroke: colors[index % colors.length], 'stroke-dasharray': segment + ' ' + circumference,
                    'stroke-dashoffset': -offset, transform: 'rotate(-90 70 70)'
                });
                arc.append($('<title>').text(item.name + ' · ' + item.value.toLocaleString() + ' unités · ' + (item.value / total * 100).toFixed(1) + '%'));
                svg.append(arc); offset += segment;
            });
        }
        svg.append($('<text x="70" y="67" text-anchor="middle" font-size="17" font-weight="700" fill="currentColor"></text>').text(total.toLocaleString()));
        svg.append($('<text x="70" y="81" text-anchor="middle" font-size="8" letter-spacing=".5" fill="currentColor"></text>').text('UNITÉS'));
        var legend = $('<div style="flex:1;min-width:125px;max-width:220px"></div>');
        if (!vals.length || total <= 0) {
            legend.append($('<div class="sh-muted small">Aucun article en stock.</div>'));
        } else {
            vals.forEach(function (item, index) {
                var row = $('<div class="d-flex justify-content-between align-items-center small mb-1" style="gap:8px"></div>');
                row.append($('<span class="d-flex align-items-center text-truncate" style="min-width:0"></span>').append(
                    $('<i style="display:inline-block;width:9px;height:9px;flex:0 0 9px;border-radius:50%;margin-right:6px"></i>').css('background', colors[index % colors.length]),
                    $('<span class="text-truncate"></span>').text(item.name)
                ));
                row.append($('<strong style="white-space:nowrap"></strong>').text(item.value.toLocaleString() + ' · ' + (item.value / total * 100).toFixed(1) + '%'));
                legend.append(row);
            });
        }
        host.append($('<div class="d-flex flex-wrap align-items-center justify-content-center" style="gap:14px;height:250px"></div>').append(svg, legend));
    }
    function renderTop(rows) {
        var holder=$('#stock-health-top-products').empty(), max=Math.max(1,...(rows||[]).map(r=>Number(r.sold_quantity)||0));
        if(!rows||!rows.length){holder.text('Pas encore de ventes à classer.').addClass('sh-muted');return;}
        rows.slice(0,7).forEach(function(r,i){var line=$('<div class="mb-3">'), head=$('<div class="d-flex justify-content-between small mb-1">').append($('<strong>').text((i+1)+'. '+r.name),$('<span class="sh-muted">').text(Number(r.sold_quantity).toLocaleString()));var bar=$('<div style="height:6px;border-radius:8px;background:var(--sh-border);overflow:hidden">').append($('<div style="height:100%;border-radius:8px;background:var(--sh-accent)">').css('width',(Number(r.sold_quantity)/max*100)+'%'));line.append(head,bar);holder.append(line);});
    }
    function fillSelect(selector, values, label) { var el=$(selector), prior=el.val();el.empty().append($('<option>').val('').text(label));(values||[]).forEach(v=>el.append($('<option>').val(v).text(v)));if(prior)el.val(prior); }
    function render(data) {
        snapshot=data; var t=data.totals||{}, rows=Array.isArray(data.rows)?data.rows:[], retailValue=rows.reduce(function(s,r){return s+(Number(r.stock)||0)*(Number(r.selling_price)||0);},0);
        var kpis=[['Unités en stock',Number(t.stock_units||0).toLocaleString(),'Quantité physique','sh-blue'],['Valeur d’achat',currency(t.stock_value),'Coût total immobilisé','sh-teal'],['Valeur de vente potentielle',currency(retailValue),'Au prix de vente 1','sh-amber'],['Stock faible (≤ 5)',Number(t.critical||0).toLocaleString(),'Articles à réapprovisionner','sh-green']];
        var holder=$('#stock-health-kpis').empty();kpis.forEach(function(k){holder.append($('<div class="col-6 col-md-3 mb-3">').append($('<div class="sh-kpi '+k[3]+'">').append($('<small>').text(k[2]),$('<strong>').text(k[1]),$('<div class="small mt-1">').text(k[0]))));});
        fillSelect('#stock-health-category',data.categories,'Toutes les catégories');fillSelect('#stock-health-brand',data.brands,'Toutes les marques');
        renderTrend(data.trend);renderTop(data.best_by_quantity);renderCategoryComparison(rows);renderStockLevels(rows);renderCategoryDonut(rows);
        filtered=filterRows(data.rows);drawRows('#stock-health-critical-rows',filterRows(data.critical),'critical');drawRows('#stock-health-dormant-rows',filterRows(data.dormant),'dormant');drawRows('#stock-health-never-rows',filterRows(data.never_sold),'never');drawRows('#stock-health-all-rows',filtered,'all');
        $('#stock-health-dormant-days').val(data.dormant_days||90);$('#stock-health-error').hide().text('');
    }
    function load(){var branch=$('.item_branch_value').val();if(Array.isArray(branch))branch=branch[0];if(!branch)branch=PosnicPro.local.get('branch_id')||PosnicPro.local.get('branch');if(!branch){$('#stock-health-error').text('Sélectionnez une agence pour consulter le stock.').show();return;}$('#stock-health-refresh').prop('disabled',true);PosnicPro.get({url:'stock-report',data:{branch:branch}},function(r){$('#stock-health-refresh').prop('disabled',false);if(r&&r.type==='success')render(r.data||{});else $('#stock-health-error').text(r&&r.message||'Impossible de charger le rapport.').show();},function(){$('#stock-health-refresh').prop('disabled',false);$('#stock-health-error').text('Erreur réseau lors du chargement du rapport.').show();});}
    function saveThreshold(){var branch=$('.item_branch_value').val();if(Array.isArray(branch))branch=branch[0];if(!branch)branch=PosnicPro.local.get('branch_id')||PosnicPro.local.get('branch');var days=Math.max(1,Math.min(3650,parseInt($('#stock-health-dormant-days').val(),10)||90));PosnicPro.post({url:'stock-report/settings?branch='+encodeURIComponent(branch||''),data:{dormant_days:days,branch:branch}},function(){load();},function(){load();});}
    function exportCsv(){if(!snapshot||!Array.isArray(snapshot.rows))return;var rows=[['Produit','Référence','Catégorie','Marque','Stock','Qté vendue','Dernière vente','Jours sans vente','Coût unitaire','Valeur stock']];(filtered||snapshot.rows).forEach(r=>rows.push([r.name,r.sku,r.category,r.brand,r.stock,r.sold_quantity,r.last_sale||'Jamais vendu',r.days_since_sale==null?'':r.days_since_sale,r.unit_cost,r.stock_value]));var csv=rows.map(row=>row.map(v=>'"'+String(v==null?'':v).replace(/"/g,'""')+'"').join(';')).join('\r\n');var blob=new Blob(['\ufeff'+csv],{type:'text/csv;charset=utf-8;'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='etat-de-stock.csv';document.body.appendChild(a);a.click();a.remove();URL.revokeObjectURL(url);}
    function applyFilters(){if(!snapshot)return;filtered=filterRows(snapshot.rows);renderCategoryComparison(filtered);renderCategoryDonut(filtered);drawRows('#stock-health-critical-rows',filterRows(snapshot.critical),'critical');drawRows('#stock-health-dormant-rows',filterRows(snapshot.dormant),'dormant');drawRows('#stock-health-never-rows',filterRows(snapshot.never_sold),'never');drawRows('#stock-health-all-rows',filtered,'all');}
    $(document).on('click','#stock-health-refresh',load).on('change','#stock-health-dormant-days',saveThreshold).on('click','#stock-health-export',exportCsv).on('input change','#stock-health-search,#stock-health-category,#stock-health-brand,#stock-health-status',applyFilters);
    return {load:load,render:render};
}());


/* Standalone two-stage versement register. It links to an already validated sale. */
PosnicPro.versementsRegister = (function () {
    var records = [];
    function branch() { var b = PosnicPro.local.get('branch_id_set') || PosnicPro.local.get('branch_id') || PosnicPro.local.get('branch'); return Array.isArray(b) ? b[0] : b; }
    function message(text, type) { $('#versements-message').attr('class','mt-2 alert alert-' + (type || 'info')).text(text || '').toggle(!!text); }
    function load() {
        PosnicPro.get({url:'versements',data:{branch:branch()}},function(r){
            if (!r || r.type!=='success') { message(r && r.message || 'Impossible de charger les versements.','danger'); return; }
            records = Array.isArray(r.data) ? r.data : []; render();
        },function(){ message('Erreur réseau lors du chargement des versements.','danger'); });
    }
    function renderSettlementSummary() {
        var groups = {};
        records.forEach(function (r) {
            if (r.status !== 'settled' || !r.settled_at) return;
            var date = new Date(r.settled_at);
            if (Number.isNaN(date.getTime())) return;
            var key = [date.getFullYear(), String(date.getMonth()+1).padStart(2,'0'), String(date.getDate()).padStart(2,'0')].join('-');
            if (!groups[key]) groups[key] = { date: date, amount: 0, count: 0 };
            // Recognize the complete bill on final settlement, not just the
            // last installment collected on that day.
            groups[key].amount += Number(r.sale_total) || 0;
            groups[key].count += 1;
        });
        var host = $('#versements-settlement-summary').empty();
        var keys = Object.keys(groups).sort().reverse();
        if (!keys.length) {
            host.append($('<div class="text-muted small">').text('Aucun versement entièrement réglé.'));
            return;
        }
        keys.forEach(function (key) {
            var group = groups[key], card = $('<div class="card p-3 mb-2">').css({minWidth:'190px',flex:'1 1 190px'});
            card.append($('<div class="small text-muted">').text('Ventes réglées le ' + group.date.toLocaleDateString()));
            card.append($('<strong class="h5 mb-0">').text((PosnicPro.local.get('currencySign') || 'DA') + ' ' + group.amount.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})));
            card.append($('<div class="small text-muted">').text(group.count + ' versement(s) · montant total comptabilisé'));
            host.append(card);
        });
    }
    function render() {
        renderSettlementSummary();
        var q = String($('#versements-search').val() || '').toLowerCase(), body=$('#versements-rows').empty();
        records.filter(function(r){return !q || [r.customer_name,r.phone,r.versement_number,r.sale_key].join(' ').toLowerCase().indexOf(q)>=0;}).forEach(function(r){
            var tr=$('<tr>'), add=function(v){tr.append($('<td>').text(v==null?'':String(v)));};
            add(r.versement_number); add(new Date(r.created_at||Date.now()).toLocaleString());
            add(r.settled_at ? new Date(r.settled_at).toLocaleString() : '—'); add(r.customer_name); add(r.sale_key);
            add(Number(r.sale_total||0).toFixed(2)); add(Number(r.initial_amount||0).toFixed(2)); add(Number(r.remaining||0).toFixed(2));
            add(r.status==='pending'?'En attente':r.status==='settled'?'Réglé':'Annulé');
            var cell=$('<td>');
            $('<button class="btn btn-sm btn-outline-primary mr-1">Reçu</button>').on('click',function(){printReceipt(r);}).appendTo(cell);
            $('<button class="btn btn-sm btn-outline-secondary mr-1">Détails / Historique</button>').on('click',function(){var lines=(r.history||[]).map(function(h){return (h.type||'Opération')+' · '+Number(h.amount||0).toFixed(2)+' · '+new Date(h.at||r.created_at).toLocaleString()+' · '+(h.method||'');});message(lines.join(' | ')||'Aucun historique disponible.','info');}).appendTo(cell);
            if(r.status==='pending') {
                $('<button class="btn btn-sm btn-success mr-1">Régler</button>').on('click',function(){$('#versement-settle-amount').text(Number(r.remaining||0).toFixed(2));$('#versement-settle-modal').data('id',r._id).modal('show');}).appendTo(cell);
                $('<button class="btn btn-sm btn-outline-danger">Annuler</button>').on('click',function(){PosnicPro.post({url:'versements/'+encodeURIComponent(r._id)+'/cancel',data:JSON.stringify({})},function(x){message(x.message||'Mise à jour.',x.type==='success'?'success':'danger');load();},function(){message('Annulation refusée.','danger');});}).appendTo(cell);
            } else $('<span class="text-muted">Réglé</span>').appendTo(cell);
            tr.append(cell); body.append(tr);
        });
        if(!body.children().length) body.append($('<tr>').append($('<td colspan="10" class="text-center text-muted">Aucun versement.</td>')));
    }
    function printReceipt(record) {
        if(!record)return Promise.resolve(false);
        var printer = window.electronAPI && window.electronAPI.printer;
        if (!printer || typeof printer.printReceipt !== 'function') {
            PosnicPro.alert('error', 'Impression thermique indisponible sur cet appareil. Aucun navigateur ne sera ouvert.');
            return Promise.resolve(false);
        }
        var currency = String(PosnicPro.local.get('currencySign') || 'DA');
        var total = Number(record.sale_total) || 0;
        var initial = Number(record.initial_recorded_amount != null ? record.initial_recorded_amount : record.initial_amount) || 0;
        var finalPaid = record.status === 'settled' ? Number(record.settlement && record.settlement.amount || 0) : 0;
        var paid = initial + finalPaid;
        var remaining = record.status === 'settled' ? 0 : Math.max(0, Number(record.remaining != null ? record.remaining : total - initial));
        var methods = {cash:'Espèces',tpe:'TPE',baridimob:'BaridiMob'};
        var baseSale = {
            billNo: String(record.versement_number || ''),
            title: 'VERSEMENT',
            date: new Date(record.created_at || Date.now()).toLocaleString(),
            customer_name: String(record.customer_name || ''),
            customer_phone: String(record.phone || ''),
            cashier_name: String(record.vendor_name || ''),
            customer: record.customer_name
                ? [String(record.customer_name)].concat(record.phone ? ['Téléphone: ' + String(record.phone)] : [])
                : (record.phone ? ['Téléphone: ' + String(record.phone)] : []),
            total: total,
            subTotal: total,
            items: [],
            payments: [{label:'Versement initial - '+(methods[String(record.initial_method || 'cash').toLowerCase()] || 'Espèces'),amount:initial}].concat(finalPaid>0?[{label:'Règlement final - '+(methods[String(record.settlement && record.settlement.method || 'cash').toLowerCase()] || 'Espèces'),amount:finalPaid}]:[]),
            extras: [
                {label:'Référence vente',value:String(record.sale_key || '')},
                {label:'Total',value:total.toFixed(2)+' '+currency},
                {label:'Versement (montant payé)',value:paid.toFixed(2)+' '+currency},
                {label:'Reste à payer',value:remaining.toFixed(2)+' '+currency},
                {label:'Vendeur',value:String(record.vendor_name || '')},
                {label:'Statut',value:record.status==='settled'?'Réglé':'En attente'}
            ],
            design: {
                showTitle:true, titleAlignment:'center', titleSize:'extra', titleBold:true,
                showTicket:true, showDate:true, showCustomer:true, itemsHeader:false, showSubtotal:false,
                showTaxes:false, showDiscount:false, showPayments:true, showChange:false,
                showCashier:false, showBranch:false
            }
        };
        var receiptId = String(record._id || record.versement_number || 'receipt');
        function printCopy(copyLabel, copyIndex) {
            var sale = Object.assign({}, baseSale, {
                extras: baseSale.extras.concat([{label:'VERSION',value:copyLabel === 'CLIENT' ? 'CLIENT' : 'VENDEUR'}])
            });
            return Promise.resolve(printer.printReceipt(sale, {
                copies: 1,
                kind: 'versement',
                docName: 'Versement ' + copyLabel + ' ' + String(record.versement_number || ''),
                source: 'F6 Versement',
                openDrawer: false,
                jobId: 'versement:' + receiptId + ':' + copyIndex + ':' + Date.now()
            })).then(function (result) {
                if (!result || !result.success) throw new Error(result && result.error || 'Échec de l’impression thermique du versement (' + copyLabel + ').');
                return result;
            });
        }
        // Two separate jobs, sent sequentially through the exact same
        // electronAPI.printer.printReceipt route used by designed sale receipts.
        // This keeps the saved receipt design and guarantees client first,
        // seller second, without invoking a browser or a second print engine.
        return printCopy('CLIENT', 1).then(function (clientResult) {
            return printCopy('VENDEUR', 2).then(function (sellerResult) {
                return {success:true, client:clientResult, seller:sellerResult};
            });
        }).catch(function (error) {
            PosnicPro.alert('error', error && error.message || 'Échec de l’impression du versement.');
            return false;
        });
    }
    $('#versement-settle-confirm').off('click').on('click',function(){var id=$('#versement-settle-modal').data('id'),method=String($('#versement-settle-method').val()||'cash');if(!id)return;var registerId=PosnicPro.sales&&typeof PosnicPro.sales.saleRegisterId==='function'?PosnicPro.sales.saleRegisterId():'';$(this).prop('disabled',true);PosnicPro.post({url:'versements/'+encodeURIComponent(id)+'/settle',data:JSON.stringify({method:method,register_id:registerId})},function(x){$('#versement-settle-confirm').prop('disabled',false);$('#versement-settle-modal').modal('hide');message(x.message||'Règlement enregistré.',x.type==='success'?'success':'danger');load();},function(){$('#versement-settle-confirm').prop('disabled',false);message('Échec du règlement.','danger');});});
    $(document).on('click','#versements-refresh',load).on('input','#versements-search',render);

    return {load:load,printReceipt:printReceipt};
}());
