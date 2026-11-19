'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

test('touch mode is a persistent opt-in header control with larger targets', () => {
  const header = read('frontend/layouts/header.html');
  const css = read('frontend/static/style/css/custom.css');
  assert.match(header, /id="posnic-touch-mode-toggle"/);
  assert.match(header, /localStorage\.setItem\(key, enabled \? 'true' : 'false'\)/);
  assert.match(header, /posnic-touch-mode/);
  assert.match(css, /\.posnic-touch-mode button[\s\S]*?min-height: var\(--posnic-touch-target\)/);
  assert.match(css, /\.posnic-touch-mode \.product-category[\s\S]*?min-height: 148px/);
});

test('closing Ticket Studio uses theme surfaces while keeping the receipt paper white', () => {
  const daily = read('frontend/modules/dailyReport.html');
  const css = read('frontend/static/style/css/custom.css');
  assert.match(daily, /dc-studio-sidebar\{background:var\(--theme-card-bg/);
  assert.match(css, /#day-close-ticket-tools \.dc-studio-sidebar\s*\{[\s\S]*?background: var\(--theme-card-bg/);
  assert.match(daily, /#day-close-ticket-preview\{[^}]*background:#fff/);
});

test('Ticket Studio includes a salary-payment block and subtracts actual RH payments from net', () => {
  const report = read('frontend/static/script/js/modules/js/report_dailysales.js');
  const controller = read('api/src/controllers/sales.controller.js');
  assert.match(report, /\['salary','Paiements salaires'\]/);
  assert.match(report, /salary_payments_total/);
  assert.match(report, /net:gross-expenses-salaryPaymentsTotal-salaryAdvancesTotal-salaryPrimesTotal/);
  assert.match(report, /worker_name/);
  // The closing ticket must preserve the cashier-entered RH payment note.
  assert.match(controller, /notes: \{ \$ifNull: \['\$notes', ''\] \}/);
  assert.match(report, /row\.notes\?' — '\+String\(row\.notes\)/);
});

test('Price Changing editor uses selected POSNIC theme surfaces instead of light-only fills', () => {
  const price = read('frontend/modules/priceSettings.html');
  assert.match(price, /--ps-surface: var\(--theme-card-bg/);
  assert.match(price, /--ps-success-surface: color-mix/);
  assert.match(price, /background:var\(--theme-input-bg,var\(--ps-surface\)\)/);
  assert.doesNotMatch(price, /background:#e8f5ee !important/);
  assert.doesNotMatch(price, /background:#e9f4ff !important/);
  assert.match(price, /#pricesettings_new \.form-control[\s\S]*?var\(--theme-input-bg/);
});

test('debt collections keep their actual payment method and are not automatically added to cash twice', () => {
  const report = read('frontend/static/script/js/modules/js/report_dailysales.js');
  assert.match(report, /debtPaymentData\.forEach\(function \(debt\)/);
  assert.match(report, /debtMethodLabels\[method\]/);
  assert.match(report, /Mode non enregistré \(dette\)/);
  assert.doesNotMatch(report, /payment_mode: 'Cash', sale_payment: debtPaymentTotal/);
  assert.match(report, /Never add the aggregate again to Cash/);
});

test('cash expected for the day subtracts only cash salary payments and active cash-book expenses', () => {
  const report = read('frontend/static/script/js/modules/js/report_dailysales.js');
  const controller = read('api/src/controllers/sales.controller.js');
  assert.match(report, /salaryCashTotal=salaryPayments\.reduce/);
  assert.match(report, /cashExpected=expensesAvailable\?pay\.cash-debtCashTotal\+deliveryPayoutCashTotal-expenses-salaryCashTotal-salaryAdvanceCashTotal-salaryPrimeCashTotal:null/);
  assert.match(report, /case'cashhand'/);
  assert.match(report, /case'debt':[\s\S]*?debtRows/);
  assert.match(controller, /const cashExpected = roundToTwo\(salesCash \+ deliveryPayoutCash - expensesTotal - salaryCash - advanceCash - primeCash\);/);
  assert.match(controller, /branch_id: branchObjectId,[\s\S]{0,100}is_deleted: \{ \$ne: true \}/);
});
