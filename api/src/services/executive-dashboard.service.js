'use strict';

const { GRAPH_ALLOWED_SALE_PROCESSES } = require('../constants/sales.constants');
const round = value => Math.round((Number(value) || 0) * 100) / 100;
const amount = value => {
  if (value && typeof value === 'object') value = value.amount ?? value.value ?? value.total ?? value.$numberDecimal ?? value.$numberLong;
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  let raw = String(value ?? '').trim().replace(/[^0-9,.-]/g, '');
  if (!raw) return 0;
  const dot = raw.lastIndexOf('.'), comma = raw.lastIndexOf(',');
  if (dot >= 0 && comma >= 0) raw = comma > dot ? raw.replace(/\./g, '').replace(',', '.') : raw.replace(/,/g, '');
  else if (comma >= 0) raw = raw.length - comma - 1 <= 2 ? raw.replace(',', '.') : raw.replace(/,/g, '');
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : 0;
};
function parseDate(value) {
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value : null;
  if (value && typeof value === 'object') value = value.$date?.$numberLong ?? value.$date ?? value.$numberLong ?? value;
  if (typeof value === 'number' || (typeof value === 'string' && /^\d{10,13}$/.test(value))) {
    const n = Number(value), date = new Date(Math.abs(n) < 1e12 ? n * 1000 : n);
    return Number.isFinite(date.getTime()) ? date : null;
  }
  const text = String(value ?? '').trim();
  if (!text) return null;
  const dmy = text.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})(?:[ T]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (dmy) return new Date(Number(dmy[3]), Number(dmy[2]) - 1, Number(dmy[1]), Number(dmy[4] || 0), Number(dmy[5] || 0), Number(dmy[6] || 0));
  const date = new Date(text);
  return Number.isFinite(date.getTime()) ? date : null;
}
function dateKey(value, timeZone = 'Africa/Algiers') {
  const date = parseDate(value);
  if (!date) return '';
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  const get = type => parts.find(part => part.type === type)?.value || '';
  return get('year') + '-' + get('month') + '-' + get('day');
}
function reportable(sale) {
  const process = String(sale.sale_process || 'Add');
  const allowed = GRAPH_ALLOWED_SALE_PROCESSES.includes(process) || (process === 'KOT' && sale.payment_status === 'Paid');
  if (!allowed || String(sale.payment_status || '').toLowerCase() === 'cancelled') return false;
  if (sale.versement_checkout && !(sale.versement_settled === true || sale.versement_settled === 'true')) return false;
  return true;
}
function deliverySale(sale) {
  const values = [sale.channel, sale.channel_partner, sale.fulfilment, sale.sale_method, sale.delivery, sale.zrExpress, sale.zr_express, sale.order_type].map(v => String(v ?? '').toLowerCase()).join(' ');
  return sale.isDelivery === true || sale.is_delivery === true || sale.delivery === true || sale.zrExpress === true || /zr|express|livraison|delivery|cod/.test(values);
}
function tenderEntries(sale) {
  const raw = sale.multi_payment || sale.payment_details || sale.payment_breakdown || sale.payments || {};
  const rows = Array.isArray(raw)
    ? raw.map(row => [row.method || row.payment_mode || row.type || row.name, amount(row.amount ?? row.paid ?? row.total)])
    : Object.entries(raw).map(([key, value]) => [key, amount(typeof value === 'object' ? value.amount ?? value.paid ?? value.total : value)]);
  if (!rows.length) {
    const method = sale.payment_mode || sale.payment_method || sale.payment_type || 'cash';
    const total = amount(sale.paid_amount ?? sale.payment_received ?? (String(sale.payment_status).toLowerCase() === 'paid' ? sale.sales_total ?? sale.total : 0));
    if (total > 0) rows.push([method, total]);
  }
  return rows.filter(([method, value]) => method && value > 0);
}
function methodKey(method) {
  const key = String(method || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '');
  if (['cash','especes','espece'].includes(key)) return 'cash';
  if (['tpe','card','carte','creditcard'].includes(key)) return 'tpe';
  if (['baridimob','baridi','wallet','mobilemoney'].includes(key)) return 'baridimob';
  if (['credit','dette','creance'].includes(key)) return 'credit';
  if (['zr','zrexpress','delivery','livraison','cod'].includes(key)) return 'delivery';
  return 'other';
}
function itemId(line) {
  const value = line.item_id || line.item || line.product_id || line.view_item_id;
  return String(value && typeof value === 'object' ? value._id || value.id || value.toString?.() || '' : value || '');
}
function itemCost(line, item) {
  const qty = amount(line.item_quantity ?? line.quantity ?? line.qty ?? 1) || 1;
  const total = line.company_price_total ?? line.total_companyprice ?? line.cost_total;
  if (total !== undefined && total !== null && total !== '') return amount(total);
  const unit = line.company_price ?? line.cost_price ?? line.purchase_price;
  return unit === undefined || unit === null || unit === '' ? null : amount(unit) * qty;
}
function buildExecutiveDashboard(input = {}) {
  const timezone = input.timeZone || 'Africa/Algiers';
  const now = input.now instanceof Date ? input.now : new Date();
  const today = dateKey(now, timezone);
  let start = input.startDate || today, end = input.endDate || today;
  const allSales = (input.sales || []).filter(reportable).map(sale => ({ sale, key: dateKey(sale.date ?? sale.created_date ?? sale.createdAt ?? sale.created_at, timezone) })).filter(x => x.key && x.key <= end);
  let selected = allSales.filter(x => x.key >= start && x.key <= end);
  let fallback = false;
  if (input.period === 'today' && selected.length === 0) {
    const cutoff = new Date(now.getTime() - 29 * 86400000);
    start = dateKey(cutoff, timezone); end = today;
    selected = allSales.filter(x => x.key >= start && x.key <= end);
    fallback = true;
  }
  const previousDays = Math.max(1, Math.round((parseDate(end).getTime() - parseDate(start).getTime()) / 86400000) + 1);
  const prevEndDate = new Date(parseDate(start).getTime() - 86400000);
  const prevStartDate = new Date(prevEndDate.getTime() - (previousDays - 1) * 86400000);
  const prevStart = dateKey(prevStartDate, timezone), prevEnd = dateKey(prevEndDate, timezone);
  const previous = allSales.filter(x => x.key >= prevStart && x.key <= prevEnd);
  const items = input.items || [];
  const itemMap = new Map(items.map(item => [String(item._id), item]));
  const financials = input.financials !== false;
  const channels = input.channel || 'all';
  const inChannel = sale => channels === 'all' || (channels === 'delivery' ? deliverySale(sale) : !deliverySale(sale));
  selected = selected.filter(x => inChannel(x.sale));
  const aggregate = rows => {
    const result = { gross:0, discount:0, returns:0, net:0, cogs:0, cogsKnown:true, cash:0, tpe:0, baridimob:0, credit:0, delivery:0, tickets:0, units:0, sales:[] };
    for (const entry of rows) {
      const sale = entry.sale;
      const gross = amount(sale.items_total ?? sale.sales_sub_total ?? sale.subtotal ?? sale.sales_total ?? sale.total);
      const discount = amount(sale.sale_extra_discount ?? sale.extra_discount ?? sale.discount ?? sale.discount_amount);
      const returns = amount(sale.items_return_total ?? sale.return_total);
      const net = Math.max(0, amount(sale.sales_total ?? sale.total ?? (gross - discount)) - returns);
      result.gross += gross; result.discount += discount; result.returns += returns; result.net += net; result.tickets++;
      const lines = Array.isArray(sale.items) ? sale.items : Array.isArray(sale.itemsale) ? sale.itemsale : [];
      if (sale.total_companyprice !== undefined && sale.total_companyprice !== null && sale.total_companyprice !== '') result.cogs += amount(sale.total_companyprice);
      else for (const line of lines) { const cost = itemCost(line, null); if (cost === null) result.cogsKnown = false; else result.cogs += cost; }
      for (const line of lines) result.units += amount(line.item_quantity ?? line.quantity ?? line.qty ?? 1);
      const isDelivery = deliverySale(sale);
      for (const [method, value] of tenderEntries(sale)) {
        const type = methodKey(method);
        if (type === 'delivery' || (isDelivery && type === 'cash')) result.delivery += value;
        else if (type === 'cash') result.cash += value;
        else if (type === 'tpe') result.tpe += value;
        else if (type === 'baridimob') result.baridimob += value;
        else if (type === 'credit') result.credit += value;
      }
      if (isDelivery && result.delivery === 0) result.delivery += amount(sale.cod_amount ?? sale.delivery_cod ?? sale.sales_total ?? sale.total);
      result.sales.push(sale);
    }
    Object.keys(result).forEach(key => { if (typeof result[key] === 'number') result[key] = round(result[key]); });
    return result;
  };
  const totals = aggregate(selected), prev = aggregate(previous);
  const expenses = (input.expenses || []).filter(row => { const key=dateKey(row.date ?? row.created_date ?? row.createdAt,timezone); return key>=start&&key<=end; }).reduce((sum,row)=>sum+amount(row.amount),0);
  const hrRows = (input.hrTransactions || []).filter(row => { const key=dateKey(row.date ?? row.created_at ?? row.createdAt,timezone); return key>=start&&key<=end && !row.cancelled_at && row.is_cancelled!==true; });
  const salary = hrRows.filter(row=>row.type==='salary_payment').reduce((sum,row)=>sum+amount(row.amount),0);
  const advances = hrRows.filter(row=>row.type==='advance').reduce((sum,row)=>sum+amount(row.amount),0);
  const bonuses = hrRows.filter(row=>/^prime_/.test(String(row.type))).reduce((sum,row)=>sum+amount(row.amount),0);
  const charges = round(expenses+salary+advances+bonuses);
  const netProfit = totals.cogsKnown ? round(totals.net-totals.cogs-charges) : null;
  const previousProfit = prev.cogsKnown ? round(prev.net-prev.cogs) : null;
  const creditCollected = (input.creditPayments || []).concat(input.versements || []).filter(row => { const key=dateKey(row.date ?? row.paid_at ?? row.settled_at ?? row.created_at ?? row.createdAt,timezone); return key>=start&&key<=end; }).reduce((sum,row)=>sum+amount(row.amount ?? row.paid_amount ?? row.settlement?.amount ?? row.settlement_amount),0);
  const outstanding = (input.sales || []).filter(reportable).reduce((sum,sale)=>sum+amount(sale.payment_pending ?? sale.partial_balance ?? sale.customer_balance),0);
  const itemStats = new Map();
  const heat = Array.from({length:7},()=>Array(14).fill(0));
  const hourly = Array(24).fill(0);
  const dayRevenue = new Map();
  const vendors = new Map();
  for (const {sale,key} of selected) {
    dayRevenue.set(key,(dayRevenue.get(key)||0)+Math.max(0,amount(sale.sales_total??sale.total)-amount(sale.items_return_total)));
    const date=parseDate(sale.date??sale.created_date??sale.createdAt); if(date){const weekday=(new Date(date.toLocaleString('en-US',{timeZone:timezone})).getDay()+6)%7,hour=Number(new Intl.DateTimeFormat('en-US',{timeZone:timezone,hour:'2-digit',hourCycle:'h23'}).format(date));if(hour>=9&&hour<=22)heat[weekday][hour-9]+=1;hourly[hour]++;}
    const vendor=String(sale.cashier_name||sale.user_name||sale.created_by||'Non attribué');
    const v=vendors.get(vendor)||{name:vendor,sales:0,tickets:0,returns:0};v.sales+=Math.max(0,amount(sale.sales_total??sale.total)-amount(sale.items_return_total));v.tickets++;v.returns+=amount(sale.items_return_total);vendors.set(vendor,v);
    const lines=Array.isArray(sale.items)?sale.items:Array.isArray(sale.itemsale)?sale.itemsale:[];
    for(const line of lines){const id=itemId(line),item=itemMap.get(id)||{},name=String(line.name||line.item_name||item.name||'Article'),qty=amount(line.quantity??line.item_quantity??1),revenue=amount(line.total??line.total_amount??line.line_total??(amount(line.unit_price??line.item_price)*qty)),cost=itemCost(line,item);const stat=itemStats.get(id||name)||{id,name,brand:item.brand_name||item.brand||item.brand_abbreviation||line.brand_name||'Sans marque',category:item.category_name||line.category_name||'Sans catégorie',units:0,revenue:0,cost:0,costKnown:true,last:key};stat.units+=qty;stat.revenue+=revenue;if(cost===null)stat.costKnown=false;else stat.cost+=cost;if(key>stat.last)stat.last=key;itemStats.set(id||name,stat);}
  }
  const itemRows=[...itemStats.values()].map(row=>({...row,profit:row.costKnown?round(row.revenue-row.cost):null,margin:row.costKnown&&row.revenue?round((row.revenue-row.cost)/row.revenue*100):null}));
  const stock = items.filter(item=>item.item_status!=='instant'&&item.track_inventory!==false);
  const stockValue=stock.reduce((sum,item)=>sum+amount(item.available_quantity)*amount(item.company_price??item.cost_price),0);
  const retailValue=stock.reduce((sum,item)=>sum+amount(item.available_quantity)*amount(item.selling_price),0);
  const lastSaleByItem=new Map(itemRows.map(row=>[row.id,row.last]));
  const dormant=stock.map(item=>{const last=lastSaleByItem.get(String(item._id))||'';const days=last?Math.max(0,Math.floor((parseDate(end)-parseDate(last))/86400000)):999;return {...item,days_since_sale:days,capital:round(amount(item.available_quantity)*amount(item.company_price??item.cost_price))};}).filter(item=>item.days_since_sale>=30&&amount(item.available_quantity)>0).sort((a,b)=>b.capital-a.capital).slice(0,30);
  const days=Math.max(1,previousDays);
  const reorder=stock.map(item=>{const sold=itemRows.find(row=>row.id===String(item._id))?.units||0;const velocity=sold/days,qty=amount(item.available_quantity);return {id:String(item._id),name:item.name,brand:item.brand_name||item.brand||item.brand_abbreviation||'',reference:item.itemid||item.model_reference||item.sku||'',stock:qty,velocity:round(velocity),days_left:velocity?round(qty/velocity):null,suggested_qty:Math.max(0,Math.ceil(velocity*14-qty))};}).filter(row=>row.velocity>0&&row.days_left!==null&&row.days_left<7).sort((a,b)=>a.days_left-b.days_left).slice(0,30);
  const brandMap=new Map(),categoryMap=new Map();
  for(const row of itemRows){for(const [map,key] of [[brandMap,row.brand],[categoryMap,row.category]]){const value=map.get(key)||{name:key,revenue:0,units:0,profit:0,profitKnown:true};value.revenue+=row.revenue;value.units+=row.units;if(row.profit===null)value.profitKnown=false;else value.profit+=row.profit;map.set(key,value);}}
  const brandStats=[...brandMap.values()].map(x=>({...x,revenue:round(x.revenue),profit:x.profitKnown?round(x.profit):null,margin:x.profitKnown&&x.revenue?round(x.profit/x.revenue*100):null})).sort((a,b)=>b.revenue-a.revenue).slice(0,15);
  const categoryStats=[...categoryMap.values()].map(x=>({...x,revenue:round(x.revenue),profit:x.profitKnown?round(x.profit):null,margin:x.profitKnown&&x.revenue?round(x.profit/x.revenue*100):null})).sort((a,b)=>b.revenue-a.revenue).slice(0,15);
  const series=selected.reduce((map,entry)=>{const key=entry.key;const sale=entry.sale;const value=map.get(key)||{date:key,revenue:0,cogs:0,costKnown:true};value.revenue+=Math.max(0,amount(sale.sales_total??sale.total)-amount(sale.items_return_total));if(sale.total_companyprice!==undefined&&sale.total_companyprice!==null)value.cogs+=amount(sale.total_companyprice);else{const lines=Array.isArray(sale.items)?sale.items:Array.isArray(sale.itemsale)?sale.itemsale:[];for(const line of lines){const cost=itemCost(line,null);if(cost===null)value.costKnown=false;else value.cogs+=cost;}}map.set(key,value);return map;},new Map());
  const trend=[...series.values()].sort((a,b)=>a.date.localeCompare(b.date)).map(row=>({...row,revenue:round(row.revenue),profit:row.costKnown?round(row.revenue-row.cogs):null}));
  const totalPayments=totals.cash+totals.tpe+totals.baridimob+totals.credit+totals.delivery;
  const pct=(value,base)=>base?round((value/base-1)*100):null;
  const returnRate=totals.gross?round(totals.returns/totals.gross*100):0;
  const insights=[];
  if(trend.length){const best=trend.reduce((a,b)=>b.revenue>a.revenue?b:a,trend[0]);insights.push({title:'Meilleure journée',text:'Le '+best.date+' est votre meilleure journée sur la période avec '+round(best.revenue).toLocaleString('fr-FR')+' DA de ventes nettes.'});}
  if(brandStats[0])insights.push({title:'Marque leader',text:brandStats[0].name+' arrive en tête avec '+brandStats[0].revenue.toLocaleString('fr-FR')+' DA de chiffre d’affaires.'});
  if(dormant.length)insights.push({title:'Capital dormant',text:dormant.length+' références sont sans vente depuis au moins 30 jours, pour '+round(dormant.reduce((sum,x)=>sum+x.capital,0)).toLocaleString('fr-FR')+' DA immobilisés.'});
  if(reorder.length)insights.push({title:'Réapprovisionnement',text:reorder.length+' articles risquent une rupture en moins de 7 jours.'});
  const result={period:input.period||'today',range:{start,end},fallback,financials,metrics:{netSales:totals.net,tickets:totals.tickets,averageBasket:totals.tickets?round(totals.net/totals.tickets):0,units:totals.units,returns:totals.returns,returnRate, cash:totals.cash,tpe:totals.tpe,baridimob:totals.baridimob,delivery:totals.delivery,deliveryParcels:selected.filter(x=>deliverySale(x.sale)).length,creditOutstanding:round(outstanding),creditCollected:round(creditCollected),expenses:round(expenses),salary:round(salary),advances:round(advances),bonuses:round(bonuses),charges,netProfit,cogs:totals.cogs,cogsKnown:totals.cogsKnown,stockValue:round(stockValue),retailValue:round(retailValue),deadStockCapital:round(dormant.reduce((sum,x)=>sum+x.capital,0)),paymentTotal:round(totalPayments),growth:pct(totals.net,prev.net),profitGrowth:netProfit!==null&&previousProfit!==null?pct(netProfit,previousProfit):null},comparison:{previousStart:prevStart,previousEnd:prevEnd,netSales:prev.net,profit:previousProfit},series:trend,paymentMix:[{key:'cash',label:'Espèces',value:totals.cash},{key:'baridimob',label:'BaridiMob',value:totals.baridimob},{key:'tpe',label:'TPE',value:totals.tpe},{key:'credit',label:'Crédit',value:totals.credit},{key:'delivery',label:'Livraison ZR Express',value:totals.delivery}],brands:brandStats,categories:categoryStats,heatmap:heat,insights,reorder,topItems:itemRows.filter(x=>x.profit!==null).sort((a,b)=>b.profit-a.profit).slice(0,10),dormant:dormant.map(x=>({_id:String(x._id),name:x.name,brand:x.brand_name||x.brand||x.brand_abbreviation||'',reference:x.itemid||x.model_reference||x.sku||'',days:x.days_since_sale,stock:amount(x.available_quantity),capital:x.capital,image:x.image||''})),vendors:[...vendors.values()].map(v=>({...v,averageBasket:v.tickets?round(v.sales/v.tickets):0,returnRate:v.sales?round(v.returns/v.sales*100):0})).sort((a,b)=>b.sales-a.sales),hourly};
  return result;
}
module.exports={amount,parseDate,dateKey,reportable,deliverySale,buildExecutiveDashboard};
