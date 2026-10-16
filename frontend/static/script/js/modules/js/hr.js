/* RH: employee, payroll, advances and overtime ledger. */
(function () {
  'use strict';
  var currentWorkers = [];
  function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]); }); }
  function money(v) { return Number(v || 0).toLocaleString('fr-DZ',{minimumFractionDigits:2,maximumFractionDigits:2}) + ' DA'; }
  function today() {
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function period() { return today().slice(0,7); }
  function request(method,url,data,done) {
    var opts={url:url,data:data};
    var fn=method==='GET'?PosnicPro.get:method==='POST'?PosnicPro.post:PosnicPro.put;
    if(typeof fn!=='function'){notice('Le client API POSNIC est indisponible.','danger');return;}
    var finished=false;
    function success(response){
      if(finished)return;finished=true;
      var payload = response && response.data !== undefined ? response.data : response;
      if (payload && (payload.status === false || payload.type === 'error' || payload.error)) {
        notice(payload.message || (payload.error && payload.error.message) || 'Opération refusée.', 'danger'); return;
      }
      if (payload && payload.status === true && payload.data !== undefined) payload = payload.data;
      done(payload);
    }
    function failure(xhr){
      if(finished)return;finished=true;
      var message=xhr&&xhr.responseJSON&&(xhr.responseJSON.message||(xhr.responseJSON.error&&xhr.responseJSON.error.message));
      notice(message||'Impossible de communiquer avec le serveur RH. Vérifiez votre session et les droits administrateur.','danger');
    }
    try { fn.call(PosnicPro,opts,success,failure); }
    catch(e) { failure({responseJSON:{message:e&&e.message}}); }
  }
  function notice(message,kind) { $('#hr_notice').removeClass('alert-success alert-danger alert-info').addClass('alert-'+(kind||'info')).text(message).show(); }
  function showPanel(which) {
    $('#hr_workers_panel,#hr_payroll_panel,#hr_transactions_panel').hide();
    $('#hr_'+which+'_panel').show();
    $('#hr_new .nav-link').removeClass('active');
    $('#hr_new .nav-link').filter(function(){return $(this).attr('onclick').indexOf("'"+which+"'")>=0;}).addClass('active');
    if(which==='workers')loadWorkers(); else if(which==='payroll')loadPayroll(); else loadTransactions();
  }
  function loadSummary() {
    request('GET','hr/summary',{},function(d){
      $('#hr_stat_workers').text(d.workers||0);
      $('#hr_stat_payroll').text(money(d.monthlyPayroll));
      $('#hr_stat_advances').text(money(d.advances));
    });
  }
  function loadWorkers() {
    $('#hr_workers_rows').html('<tr><td colspan="6">Chargement…</td></tr>');
    request('GET','hr/workers',{},function(d){
      currentWorkers=Array.isArray(d)?d:(d.data||[]);
      var rows=currentWorkers.map(function(w){
        return '<tr><td>'+esc(w.name)+'</td><td>'+esc(w.job_title||'—')+'</td><td>'+money(w.monthly_salary)+'</td><td>'+money(w.hourly_rate)+'</td><td>'+(w.active===false?'<span class="badge badge-secondary">Inactif</span>':'<span class="badge badge-success">Actif</span>')+'</td><td><div class="btn-group btn-group-sm"><button class="btn btn-outline-primary" onclick="PosnicPro.hr.editWorker(\''+esc(w._id)+'\')">Modifier</button><button class="btn btn-outline-secondary dropdown-toggle" data-toggle="dropdown">Mouvement</button><div class="dropdown-menu dropdown-menu-right"><a class="dropdown-item" href="#" onclick="PosnicPro.hr.openTransaction(\''+esc(w._id)+'\',\'advance\');return false">Acompte</a><a class="dropdown-item" href="#" onclick="PosnicPro.hr.openTransaction(\''+esc(w._id)+'\',\'overtime\');return false">Heures supplémentaires</a><a class="dropdown-item" href="#" onclick="PosnicPro.hr.openTransaction(\''+esc(w._id)+'\',\'salary_payment\');return false">Paiement salaire</a><a class="dropdown-item" href="#" onclick="PosnicPro.hr.openTransaction(\''+esc(w._id)+'\',\'adjustment\');return false">Ajustement +</a></div></div></td></tr>';
      }).join('');
      $('#hr_workers_rows').html(rows||'<tr><td colspan="6" class="text-muted">Aucun employé. Ajoutez votre premier employé.</td></tr>');
      var options='<option value="">Tous les employés</option>'+currentWorkers.map(function(w){return '<option value="'+esc(w._id)+'">'+esc(w.name)+'</option>';}).join('');
      $('#hr_tx_worker').html(options);
      loadSummary();
    });
  }
  function loadPayroll() {
    var p=$('#hr_period').val()||period(); $('#hr_period').val(p);
    $('#hr_payroll_rows').html('<tr><td colspan="7">Chargement…</td></tr>');
    request('GET','hr/payroll/'+encodeURIComponent(p),{},function(d){
      var rows=(Array.isArray(d)?d:(d.data||[])).map(function(w){
        return '<tr><td>'+esc(w.name)+'</td><td>'+money(w.monthly_salary)+'</td><td>'+money(w.overtime)+'</td><td>'+money(w.advances)+'</td><td>'+money(w.paid)+'</td><td><strong>'+money(w.remaining)+'</strong></td><td><button class="btn btn-sm btn-primary" onclick="PosnicPro.hr.openTransaction(\''+esc(w._id)+'\',\'salary_payment\',\''+esc(p)+'\')">Payer</button></td></tr>';
      }).join('');
      $('#hr_payroll_rows').html(rows||'<tr><td colspan="7">Aucun salarié actif.</td></tr>');
    });
  }
  function loadTransactions() {
    var data={}; if($('#hr_tx_worker').val())data.worker_id=$('#hr_tx_worker').val();if($('#hr_tx_period').val())data.period=$('#hr_tx_period').val();
    $('#hr_transactions_rows').html('<tr><td colspan="6">Chargement…</td></tr>');
    request('GET','hr/transactions',data,function(d){
      var labels={salary_payment:'Paiement salaire',advance:'Acompte',overtime:'Heures supplémentaires',adjustment:'Ajustement'};
      var rows=(Array.isArray(d)?d:(d.data||[])).map(function(t){
        return '<tr><td>'+esc(String(t.date||'').slice(0,10))+'</td><td>'+esc(t.worker_name)+'</td><td>'+esc(labels[t.type]||t.type)+'</td><td>'+esc(t.period)+'</td><td>'+money(t.amount)+'</td><td>'+esc([t.hours?String(t.hours)+' h':'',t.method||'',t.reference||'',t.notes||''].filter(Boolean).join(' · ')||'—')+'</td></tr>';
      }).join('');
      $('#hr_transactions_rows').html(rows||'<tr><td colspan="6">Aucun mouvement pour ces filtres.</td></tr>');
    });
  }
  PosnicPro.hr={
    showDataTablePage:function(){ $('.page_loader').hide(); $('#hr_new').show(); showPanel('workers'); },
    tab:showPanel,
    refresh:function(){loadWorkers();loadSummary();},
    openWorkerForm:function(w){
      w=w||{};$('#hr_worker_form')[0].reset();$('#hr_worker_id').val(w._id||'');$('#hr_worker_name').val(w.name||'');$('#hr_worker_job').val(w.job_title||'');$('#hr_worker_phone').val(w.phone||'');$('#hr_worker_salary').val(w.monthly_salary||0);$('#hr_worker_rate').val(w.hourly_rate||0);$('#hr_worker_start').val(w.start_date?String(w.start_date).slice(0,10):today());$('#hr_worker_notes').val(w.notes||'');$('#hr_worker_active').prop('checked',w.active!==false);$('#hr_worker_modal').modal('show');
    },
    editWorker:function(id){var w=currentWorkers.find(function(x){return String(x._id)===String(id);});if(w)this.openWorkerForm(w);},
    openTransaction:function(id,type,p){
      var w=currentWorkers.find(function(x){return String(x._id)===String(id);});if(!w){notice('Employé introuvable.','danger');return;}
      var labels={salary_payment:'Paiement du salaire',advance:'Acompte',overtime:'Heures supplémentaires',adjustment:'Ajustement positif'};
      var selectedPeriod = p || period();
      $('#hr_tx_form')[0].reset();$('#hr_tx_type').val(type);$('#hr_tx_worker_id').val(w._id);$('#hr_tx_worker_name').val(w.name);$('#hr_tx_title').text(labels[type]||'Mouvement');$('#hr_tx_date').val(today());$('#hr_tx_period_input').val(selectedPeriod);$('#hr_tx_amount').val('');$('#hr_tx_rate').val(w.hourly_rate||0);$('#hr_tx_amount_wrap').toggle(type!=='overtime');$('#hr_tx_hours_wrap').toggle(type==='overtime');$('#hr_tx_modal').modal('show');
      if (type === 'salary_payment') {
        request('GET', 'hr/payroll/' + encodeURIComponent(selectedPeriod), {}, function (rows) {
          var payrollRows = Array.isArray(rows) ? rows : (rows && Array.isArray(rows.data) ? rows.data : []);
          var current = payrollRows.find(function (row) { return String(row._id) === String(w._id); }) || null;
          // Do not overwrite the amount if the user has already started entering it.
          if (current && $('#hr_tx_modal').hasClass('show') && $('#hr_tx_type').val() === 'salary_payment' &&
              String($('#hr_tx_worker_id').val()) === String(w._id) &&
              $('#hr_tx_period_input').val() === selectedPeriod && $('#hr_tx_amount').val() === '') {
            $('#hr_tx_amount').val(Math.max(0, Number(current.remaining || 0)).toFixed(2));
          }
        });
      }
    },
    loadPayroll:loadPayroll,
    loadTransactions:loadTransactions
  };
  $(document).on('submit','#hr_worker_form',function(e){
    e.preventDefault();
    var id=$('#hr_worker_id').val(),data={name:$('#hr_worker_name').val().trim(),job_title:$('#hr_worker_job').val(),phone:$('#hr_worker_phone').val(),monthly_salary:Number($('#hr_worker_salary').val()),hourly_rate:Number($('#hr_worker_rate').val()||0),start_date:$('#hr_worker_start').val(),notes:$('#hr_worker_notes').val(),active:$('#hr_worker_active').is(':checked')};
    request(id?'PUT':'POST',id?'hr/workers/'+encodeURIComponent(id):'hr/workers',data,function(){ $('#hr_worker_modal').modal('hide');notice('Fiche employé enregistrée.','success');loadWorkers(); });
  });
  $(document).on('submit','#hr_tx_form',function(e){
    e.preventDefault();
    var type=$('#hr_tx_type').val(),data={worker_id:$('#hr_tx_worker_id').val(),type:type,date:$('#hr_tx_date').val(),period:$('#hr_tx_period_input').val(),method:$('#hr_tx_method').val(),reference:$('#hr_tx_reference').val(),notes:$('#hr_tx_notes').val()};
    if(type==='overtime'){data.hours=Number($('#hr_tx_hours').val());data.hourly_rate=Number($('#hr_tx_rate').val());}else data.amount=Number($('#hr_tx_amount').val());
    request('POST','hr/transactions',data,function(){ $('#hr_tx_modal').modal('hide');notice('Mouvement enregistré.','success');loadWorkers();loadPayroll();loadTransactions(); });
  });
  $(document).on('change','#hr_tx_period,#hr_period',function(){if($('#hr_payroll_panel').is(':visible'))loadPayroll();});
  $(document).on('click','a[href="#/hr"]',function(){showPanel('workers');});
  $(function(){ $('#hr_period,#hr_tx_period').val(period()); });
})();
