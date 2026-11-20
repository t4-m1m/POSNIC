PosnicPro.itemreport = {
    activateCustomPanel: function (panel) {
        var active = ['versements','zakat'].indexOf(panel) >= 0 ? panel : 'stock';
        window.__posnicActiveItemReportPanel = active;
        window.__posnicOpenVersements = false;
        window.__posnicOpenStockHealth = false;
        window.__posnicOpenZakat = false;
        $('#stock-health-panel,#versements-panel,#zakat-panel').hide();
        if (active === 'versements') {
            $('#versements-panel').show();
            if (PosnicPro.versementsRegister) PosnicPro.versementsRegister.load();
        } else if (active === 'zakat') {
            $('#zakat-panel').show();
            PosnicPro.itemreport.loadZakatSnapshot();
        } else {
            $('#stock-health-panel').show();
            if (PosnicPro.stockHealthReport) PosnicPro.stockHealthReport.load();
        }
    },
    _zakatSnapshot: null,
    _zakatMoney: function (value) { return (Number(value)||0).toLocaleString('fr-DZ',{minimumFractionDigits:2,maximumFractionDigits:2})+' '+(PosnicPro.local.get('currencySign')||'DA'); },
    loadZakatSnapshot: function () {
        $('#zakat-data-status').text('Actualisation des données…');
        PosnicPro.get({url:'sales/zakatSnapshot',data:{}},function(r){
            if(!r||r.type!=='success'||!r.data){$('#zakat-data-status').text(r&&r.message||'Impossible de charger les données.');return;}
            PosnicPro.itemreport._zakatSnapshot=r.data;
            $('#zakat-stock').val(PosnicPro.itemreport._zakatMoney(r.data.stockValue));
            $('#zakat-receivables').val(PosnicPro.itemreport._zakatMoney(r.data.receivables));
            $('#zakat-data-status').text('Données du magasin actualisées.');
            PosnicPro.itemreport.calculateZakat();
        },function(){ $('#zakat-data-status').text('Erreur de connexion pendant l’actualisation.'); });
    },
    calculateZakat: function () {
        var gold=Number($('#zakat-gold-gram').val())||0,nisab=gold*85;
        var stock=Number(PosnicPro.itemreport._zakatSnapshot&&PosnicPro.itemreport._zakatSnapshot.stockValue)||0;
        var receivables=Number(PosnicPro.itemreport._zakatSnapshot&&PosnicPro.itemreport._zakatSnapshot.receivables)||0;
        var cash=Math.max(0,Number($('#zakat-cash').val())||0),liabilities=Math.max(0,Number($('#zakat-liabilities').val())||0);
        var net=Math.max(0,cash+stock+receivables-liabilities),eligible=nisab>0&&net>=nisab,hawl=$('#zakat-hawl').prop('checked');
        var estimate=eligible?net*.025:0,payable=eligible&&hawl?estimate:0;
        $('#zakat-nisab').val(gold>0?PosnicPro.itemreport._zakatMoney(nisab):'Saisir le prix de l’or');
        $('#zakat-result').html('<div class="card" style="border:1px solid var(--theme-border-color,#e2e8f0);border-radius:14px"><div class="card-body"><div class="row"><div class="col-md-4 mb-3"><small class="text-muted">Patrimoine net zakatable</small><h4>'+PosnicPro.itemreport._zakatMoney(net)+'</h4></div><div class="col-md-4 mb-3"><small class="text-muted">Nissab</small><h4>'+PosnicPro.itemreport._zakatMoney(nisab)+'</h4></div><div class="col-md-4 mb-3"><small class="text-muted">Zakat estimée · 2,5 %</small><h4 class="text-primary">'+PosnicPro.itemreport._zakatMoney(estimate)+'</h4></div></div><div class="alert '+(payable>0?'alert-success':'alert-warning')+' mb-0"><strong>'+(payable>0?'Montant à verser estimé : '+PosnicPro.itemreport._zakatMoney(payable):!eligible?'Nissab non atteint : aucune zakat due selon ce calcul.':'Nissab atteint : confirmez le hawl pour valider l’exigibilité.')+'</strong></div></div></div>');
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
        var requestedPanel = window.__posnicOpenZakat===true ? 'zakat' : (window.__posnicOpenVersements===true ? 'versements'
            : (window.__posnicOpenStockHealth===true ? 'stock' : ''));
        window.__posnicOpenVersements=false;
        window.__posnicOpenStockHealth=false;
        window.__posnicOpenZakat=false;
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




/* POSNIC DataChartCanvas: dependency-free, DPR-aware canvas renderer for Electron. */
function DataChartCanvas(host, config) {
 if(!host)return;var canvas=document.createElement('canvas');canvas.setAttribute('role','img');canvas.setAttribute('aria-label',config.label||'Live chart');canvas.style.cssText='display:block;width:100%;height:240px;min-height:240px;touch-action:pan-y;';
 host.innerHTML='';host.style.cssText+=';display:block;width:100%;height:240px;min-height:240px;position:relative;';host.appendChild(canvas);
 var tip=document.createElement('div');tip.style.cssText='display:none;position:absolute;z-index:5;pointer-events:none;padding:7px 10px;border-radius:7px;background:#111827;color:#fff;font:12px Arial,sans-serif;box-shadow:0 3px 14px rgba(0,0,0,.2);white-space:nowrap;';host.appendChild(tip);
 var points=[],width=600,raf=0;
 function money(v){return (Number(v)||0).toLocaleString(undefined,{maximumFractionDigits:2})+' DZD';}
 function roundRect(c,x,y,w,h,r){r=Math.min(r,w/2,h/2);c.beginPath();c.moveTo(x+r,y);c.arcTo(x+w,y,x+w,y+h,r);c.arcTo(x+w,y+h,x,y+h,r);c.arcTo(x,y+h,x,y,r);c.arcTo(x,y,x+w,y,r);c.closePath();}
 function draw(){
  raf=0;var rect=host.getBoundingClientRect(),w=Math.max(1,rect.width||host.clientWidth||600),h=240,dpr=Math.max(1,Math.min(3,window.devicePixelRatio||1));width=w;
  canvas.width=Math.round(w*dpr);canvas.height=Math.round(h*dpr);canvas.style.width=w+'px';canvas.style.height=h+'px';
  var c=canvas.getContext('2d');if(!c)return;c.setTransform(dpr,0,0,dpr,0,0);c.clearRect(0,0,w,h);points=[];
  var data=config.data||[],pad={l:48,r:16,t:18,b:34},pw=Math.max(10,w-pad.l-pad.r),ph=h-pad.t-pad.b;
  if(config.type==='line'){
   var vals=data.map(function(d){return Math.max(0,Number(d.value)||0);}),max=Math.max(1,...vals),axis=Math.ceil(max/4)*4||4;
   c.font='10px Arial';c.fillStyle='#64748b';c.strokeStyle='rgba(148,163,184,.35)';
   for(var g=0;g<=4;g++){var gy=pad.t+ph*g/4;c.setLineDash([4,5]);c.beginPath();c.moveTo(pad.l,gy);c.lineTo(w-pad.r,gy);c.stroke();c.setLineDash([]);c.textAlign='right';c.fillText(Math.round(axis*(1-g/4)).toLocaleString(),pad.l-7,gy+3);}
   var coords=data.map(function(d,i){return{x:pad.l+(data.length===1?pw/2:i*pw/Math.max(1,data.length-1)),y:pad.t+ph-(Math.max(0,Number(d.value)||0)/axis)*ph,value:Number(d.value)||0,label:d.label||''};});
   if(coords.length){var grad=c.createLinearGradient(0,pad.t,0,pad.t+ph);grad.addColorStop(0,'rgba(37,99,235,.26)');grad.addColorStop(1,'rgba(37,99,235,.01)');c.beginPath();coords.forEach(function(p,i){i?c.lineTo(p.x,p.y):c.moveTo(p.x,p.y);});c.lineTo(coords[coords.length-1].x,pad.t+ph);c.lineTo(coords[0].x,pad.t+ph);c.closePath();c.fillStyle=grad;c.fill();
    c.beginPath();coords.forEach(function(p,i){i?c.lineTo(p.x,p.y):c.moveTo(p.x,p.y);});c.strokeStyle=config.color||'#2563eb';c.lineWidth=3;c.lineJoin='round';c.stroke();
    c.beginPath();coords.forEach(function(p,i){var a=vals.slice(Math.max(0,i-2),i+1),v=a.reduce(function(s,x){return s+x;},0)/a.length,x=p.x,y=pad.t+ph-v/axis*ph;i?c.lineTo(x,y):c.moveTo(x,y);});c.strokeStyle='#f59e0b';c.lineWidth=2;c.setLineDash([6,4]);c.stroke();c.setLineDash([]);
    coords.forEach(function(p){c.beginPath();c.arc(p.x,p.y,4.5,0,Math.PI*2);c.fillStyle='#fff';c.fill();c.strokeStyle=config.color||'#2563eb';c.lineWidth=2;c.stroke();points.push({x:p.x,y:p.y,label:p.label,display:money(p.value)});});
    if(data.length<=7){c.fillStyle='#64748b';c.textAlign='center';coords.forEach(function(p){c.fillText(String(p.label).slice(0,10),p.x,h-12);});}
   }else{c.beginPath();c.moveTo(pad.l,pad.t+ph);c.lineTo(w-pad.r,pad.t+ph);c.stroke();c.beginPath();c.arc(pad.l+pw/2,pad.t+ph/2,6,0,Math.PI*2);c.fillStyle='#2563eb';c.fill();}
  }else if(config.type==='donut'){
   var total=data.reduce(function(s,d){return s+Math.max(0,Number(d.value)||0);},0),cx=Math.min(w*.32,105),cy=120,rad=Math.min(74,Math.max(48,w*.18)),colors=config.colors||['#2563eb','#38bdf8','#5e6ad2','#f59e0b','#16a34a','#f87171'];
   c.beginPath();c.arc(cx,cy,rad,0,Math.PI*2);c.strokeStyle='#e5e7eb';c.lineWidth=19;c.stroke();var angle=-Math.PI/2;
   if(total>0)data.forEach(function(d,i){var v=Math.max(0,Number(d.value)||0),sweep=v/total*Math.PI*2;c.beginPath();c.arc(cx,cy,rad,angle,angle+sweep);c.strokeStyle=colors[i%colors.length];c.lineWidth=19;c.lineCap='round';c.stroke();var mid=angle+sweep/2;points.push({x:cx+Math.cos(mid)*rad,y:cy+Math.sin(mid)*rad,label:d.label,display:d.unit==='qty'?v.toLocaleString()+' units':money(v)});angle+=sweep;});
   c.textAlign='center';c.fillStyle='#111827';c.font='bold 14px Arial';c.fillText(config.center||total.toLocaleString(),cx,cy+3);c.font='9px Arial';c.fillStyle='#64748b';c.fillText(config.centerLabel||'TOTAL',cx,cy+17);
   var lx=Math.min(w-135,Math.max(cx+rad+18,w*.58)),ly=30;c.font='10px Arial';data.slice(0,8).forEach(function(d,i){var y=ly+i*24;c.fillStyle=colors[i%colors.length];c.beginPath();c.arc(lx,y-3,4,0,Math.PI*2);c.fill();c.fillStyle='#475569';c.textAlign='left';c.fillText(String(d.label||'').slice(0,16),lx+10,y);c.textAlign='right';c.fillText((total?((Number(d.value)||0)/total*100):0).toFixed(1)+'%',w-8,y);});
   if(!total){c.fillStyle='#64748b';c.textAlign='center';c.fillText('No data',cx,cy+rad+25);}
  }else if(config.type==='bars'){
   var maxBar=Math.max(1,...data.map(function(d){return Math.max(Number(d.a)||0,Number(d.b)||0);})),groupH=ph/Math.max(1,data.length),barH=Math.max(5,Math.min(10,(groupH-5)/2));
   data.forEach(function(d,i){var y=pad.t+i*groupH;c.fillStyle='#64748b';c.textAlign='right';c.font='10px Arial';c.fillText(String(d.label||'').slice(0,14),pad.l-7,y+12);[['a','#06b6d4'],['b','#2563eb']].forEach(function(pair,j){var v=Math.max(0,Number(d[pair[0]])||0),bw=v/maxBar*pw,yy=y+j*(barH+3);roundRect(c,pad.l,yy,Math.max(v?2:0,bw),barH,barH/2);c.fillStyle=pair[1];c.fill();points.push({x:pad.l+bw,y:yy+barH/2,label:d.label,display:money(v)});});});
  }
 }
 function schedule(){if(!raf)raf=window.requestAnimationFrame(draw);}
 var observer=window.ResizeObserver?new ResizeObserver(schedule):null;if(observer)observer.observe(host);
 canvas.addEventListener('mousemove',function(e){var r=canvas.getBoundingClientRect(),x=e.clientX-r.left,y=e.clientY-r.top,best=null,dist=Infinity;points.forEach(function(p){var d=Math.hypot(x-p.x,y-p.y);if(d<dist){dist=d;best=p;}});if(best&&dist<25){tip.textContent=best.label+' · '+best.display;tip.style.display='block';tip.style.left=Math.max(4,Math.min(width-170,x+12))+'px';tip.style.top=Math.max(4,y-30)+'px';}else tip.style.display='none';});
 canvas.addEventListener('mouseleave',function(){tip.style.display='none';});schedule();
 return{redraw:schedule,destroy:function(){if(observer)observer.disconnect();if(raf)window.cancelAnimationFrame(raf);}};
}

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
        var data=(points||[]).map(function(p){return{label:String(p.date||''),value:Number(p.quantity)||0};});
        if(!data.length)data=[{label:'No movement',value:0}];
        DataChartCanvas(document.getElementById('stock-health-trend-chart'),{type:'line',label:'Stock movement quantity',data:data,color:'#06b6d4'});
        var total=data.reduce(function(s,p){return s+p.value;},0);
        $('#stock-health-trend-chart').append($('<div class="mt-1 small sh-muted">').text('Total vendu sur 30 jours : '+total.toLocaleString()));
    }
    function renderCategoryComparison(rows) {
        var groups={};
        (rows||[]).forEach(function(item){
            var name=String(item.category||item.category_name||'Sans catégorie');
            var qty=Math.max(0,Number(item.stock!=null?item.stock:(item.quantity!=null?item.quantity:item.available_quantity))||0);
            var cost=Number(item.buying_price!=null?item.buying_price:(item.unit_cost!=null?item.unit_cost:item.company_price))||0;
            var retail=Number(item.selling_price_1!=null?item.selling_price_1:(item.selling_price!=null?item.selling_price:0))||0;
            if(!groups[name])groups[name]={label:name,a:0,b:0};
            groups[name].a+=qty*cost;groups[name].b+=qty*retail;
        });
        var data=Object.keys(groups).map(function(k){return groups[k];}).sort(function(a,b){return b.b-a.b;}).slice(0,8);
        if(!data.length)data=[{label:'No categories',a:0,b:0}];
        DataChartCanvas(document.getElementById('stock-health-category-value-chart'),{type:'bars',label:'Purchase cost and retail value by category',data:data});
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
        var groups={};
        (rows||[]).forEach(function(item){
            var name=String(item.category||item.category_name||'Sans catégorie');
            var qty=Math.max(0,Number(item.stock!=null?item.stock:(item.quantity!=null?item.quantity:item.available_quantity))||0);
            groups[name]=(groups[name]||0)+qty;
        });
        var data=Object.keys(groups).map(function(k){return{label:k,value:groups[k]};}).sort(function(a,b){return b.value-a.value;});
        if(!data.length)data=[{label:'No stock',value:0}];
        var total=data.reduce(function(s,p){return s+p.value;},0);
        DataChartCanvas(document.getElementById('stock-health-category-donut'),{type:'donut',label:'Stock units by category',data:data,center:total.toLocaleString(),centerLabel:'UNITS'});
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
        records.filter(function(r){return !q || [r.customer_name,r.phone,r.versement_number,r.sale_key,r.sale_note].join(' ').toLowerCase().indexOf(q)>=0;}).forEach(function(r){
            var tr=$('<tr>'), add=function(v){tr.append($('<td>').text(v==null?'':String(v)));};
            add(r.versement_number); add(new Date(r.created_at||Date.now()).toLocaleString());
            add(r.settled_at ? new Date(r.settled_at).toLocaleString() : '—'); add(r.customer_name); add(r.sale_key); add(r.sale_note || '');
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
        if(!body.children().length) body.append($('<tr>').append($('<td colspan="11" class="text-center text-muted">Aucun versement.</td>')));
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
            sale_note: String(record.sale_note || record.sales_description || record.note || ''),
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
                ...(String(record.sale_note || record.sales_description || record.note || '').trim() ? [{label:'Note',value:String(record.sale_note || record.sales_description || record.note).trim()}] : []),
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
    $(document).on('input','#zakat-gold-gram,#zakat-cash,#zakat-liabilities',function(){PosnicPro.itemreport.calculateZakat();});
    $(document).on('click','#zakat-calculate',function(){PosnicPro.itemreport.calculateZakat();});
    $(document).on('click','#zakat-refresh',function(){PosnicPro.itemreport.loadZakatSnapshot();});
    $(document).on('click','#versements-refresh',load).on('input','#versements-search',render);

    return {load:load,printReceipt:printReceipt};
}());
