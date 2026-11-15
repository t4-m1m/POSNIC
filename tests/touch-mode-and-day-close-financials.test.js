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
  assert.match(report, /\['salary','Paiements salaires'\]/);
  assert.match(report, /salary_payments_total/);
  assert.match(report, /net:gross-expenses-salaryPaymentsTotal/);
  assert.match(report, /worker_name/);
});
