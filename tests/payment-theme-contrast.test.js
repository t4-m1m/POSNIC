'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const sales = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'modules', 'sales_write.html'), 'utf8');
const receipt = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'static', 'script', 'js', 'core', 'receipt-designer.js'), 'utf8');

test('the redesigned payment page reads the active POSNIC theme tokens', () => {
  const style = sales.match(/<style id="posnic-payment-redesign-styles">([\s\S]*?)<\/style>/);
  assert.ok(style, 'payment redesign stylesheet is present');
  for (const token of ['--theme-card-bg', '--theme-body-bg', '--theme-text-primary', '--theme-text-secondary', '--theme-border-color', '--theme-primary-color']) {
    assert.ok(style[1].includes(token), 'payment page must use ' + token);
  }
  assert.match(style[1], /#tenderpage input#Partial_amount[\s\S]*?background-color:var\(--theme-body-bg/);
  assert.match(style[1], /#infobar-settings-sidebar-tender-details \.cancel-save-hide-show[\s\S]*?background-color:var\(--theme-card-bg/);
  assert.match(style[1], /#tenderpage #payment_id \.btn\.active[\s\S]*?background-color:var\(--posnic-accent-soft/);
});

test('the receipt preparation toast follows the live application theme', () => {
  assert.match(receipt, /background: 'var\(--theme-card-bg, #fff\)'/);
  assert.match(receipt, /color: 'var\(--theme-text-primary, #172b4d\)'/);
  assert.match(receipt, /border: '1px solid var\(--theme-border-color, #d9e2ef\)'/);
});
