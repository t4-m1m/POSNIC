'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {parseDate,dateKey,reportable,buildExecutiveDashboard}=require('../../../src/services/executive-dashboard.service');
test('mixed Mongo date formats normalize into local shop days',()=>{assert.ok(parseDate(new Date()));assert.equal(dateKey('27/11/2026','Africa/Algiers'),'2026-11-27');assert.equal(dateKey('2026-11-27','Africa/Algiers'),'2026-11-27');assert.equal(dateKey({$date:{$numberLong:String(Date.UTC(2026,10,27))}},'Africa/Algiers'),'2026-11-27');});
test('unsettled F6 and cancelled tickets are excluded; settled F6 is counted once',()=>{assert.equal(reportable({sale_process:'Add',payment_status:'Paid',versement_checkout:{initial_amount:1000},versement_settled:false}),false);assert.equal(reportable({sale_process:'Add',payment_status:'Paid',versement_checkout:{initial_amount:1000},versement_settled:true}),true);assert.equal(reportable({sale_process:'Add',payment_status:'Cancelled'}),false);});
test('ZR delivery COD is separate from cash drawer',()=>{const d=buildExecutiveDashboard({now:new Date('2026-11-27T12:00:00Z'),period:'today',timeZone:'UTC',sales:[{sale_process:'Add',payment_status:'Paid',date:'2026-11-27',sales_total:10000,multi_payment:{cash:10000}},{sale_process:'Add',payment_status:'Paid',date:'2026-11-27',sales_total:5000,fulfilment:'delivery',multi_payment:{cash:5000}}],items:[],financials:true});assert.equal(d.metrics.cash,10000);assert.equal(d.metrics.delivery,5000);assert.equal(d.metrics.netSales,15000);});
test('empty today falls back to 30 days and calculates profit from saved historical cost',()=>{const d=buildExecutiveDashboard({now:new Date('2026-11-27T12:00:00Z'),period:'today',timeZone:'UTC',sales:[{sale_process:'Add',payment_status:'Paid',date:'2026-11-20',sales_total:2500,total_companyprice:1000}],items:[],financials:true});assert.equal(d.fallback,true);assert.equal(d.metrics.netSales,2500);assert.equal(d.metrics.netProfit,1500);});
test('debt collections remain separate from original sale revenue',()=>{const d=buildExecutiveDashboard({now:new Date('2026-11-27T12:00:00Z'),period:'today',timeZone:'UTC',sales:[{sale_process:'Add',payment_status:'Paid',date:'2026-11-27',sales_total:8000,payment_pending:2000,multi_payment:{cash:6000,credit:2000}}],creditPayments:[{date:'2026-11-27',amount:1000}],items:[],financials:true});assert.equal(d.metrics.netSales,8000);assert.equal(d.metrics.creditCollected,1000);});

test('non-financial roles receive operational analytics without profit or purchase-cost figures',()=>{
 const d=buildExecutiveDashboard({now:new Date('2026-11-27T12:00:00Z'),period:'today',timeZone:'UTC',financials:false,sales:[{sale_process:'Add',payment_status:'Paid',date:'2026-11-27',sales_total:2000,total_companyprice:900,items:[{name:'Veste',quantity:1,company_price:900}]}],items:[]});
 assert.equal(d.financials,false);assert.equal(d.metrics.netProfit,null);assert.equal(d.metrics.cogs,null);assert.equal(d.metrics.stockValue,null);assert.equal(d.topItems[0].profit,null);assert.equal(d.brands[0].profit,null);
});

test('previous-period comparison uses the same selected sales channel',()=>{
 const d=buildExecutiveDashboard({now:new Date('2026-11-27T12:00:00Z'),period:'custom',startDate:'2026-11-27',endDate:'2026-11-27',channel:'delivery',timeZone:'UTC',sales:[
  {sale_process:'Add',payment_status:'Paid',date:'2026-11-26',sales_total:9000,multi_payment:{cash:9000}},
  {sale_process:'Add',payment_status:'Paid',date:'2026-11-26',sales_total:2000,fulfilment:'delivery',multi_payment:{cash:2000}},
  {sale_process:'Add',payment_status:'Paid',date:'2026-11-27',sales_total:4000,fulfilment:'delivery',multi_payment:{cash:4000}},
 ],items:[],financials:true});
 assert.equal(d.comparison.netSales,2000);
 assert.equal(d.metrics.netSales,4000);
 assert.equal(d.metrics.growth,100);
});

test('variant color keys fold accents, whitespace and case consistently',()=>{
 const source=require('fs').readFileSync(require('path').join(__dirname,'../../../../frontend-v2/core/app.js'),'utf8');
 const start=source.indexOf('function normalizeVariantKey(');
 assert.ok(start>=0,'cashier app must expose its normalization implementation');
 const end=source.indexOf(String.fromCharCode(10),start);
 const line=source.slice(start,end);
 const normalize=new Function(line+'; return normalizeVariantKey;')();
 assert.equal(normalize('Vert Émeraude'),'vert emeraude');
 assert.equal(normalize('  BLEU Ciel  '),'bleu ciel');
 assert.equal(normalize('Crème à la rose'),'creme a la rose');
});
