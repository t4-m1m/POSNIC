'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { calculatePurchaseCost, purchaseSettings } = require('../../../src/utils/purchase-cost');

test('purchase cost converts EUR to DZD and adds VAT on top', () => {
  assert.deepEqual(calculatePurchaseCost(10), {
    purchase_price_eur: 10,
    purchase_exchange_rate: 280,
    purchase_vat_rate: 9,
    purchase_base_dzd: 2800,
    purchase_vat_dzd: 252,
    purchase_cost_dzd: 3052,
  });
});

test('purchase cost settings are adjustable and historical calculation records the applied settings', () => {
  assert.deepEqual(calculatePurchaseCost(2.5, { purchase_exchange_rate: 300, purchase_vat_rate: 20 }), {
    purchase_price_eur: 2.5,
    purchase_exchange_rate: 300,
    purchase_vat_rate: 20,
    purchase_base_dzd: 750,
    purchase_vat_dzd: 150,
    purchase_cost_dzd: 900,
  });
});

test('invalid setting values fall back safely and invalid prices are rejected', () => {
  assert.deepEqual(purchaseSettings({ purchase_exchange_rate: -2, purchase_vat_rate: 101 }), { exchangeRate: 280, vatRate: 9 });
  assert.throws(() => calculatePurchaseCost(-1), /non-negative/);
  assert.throws(() => calculatePurchaseCost('nope'), /finite/);
});
