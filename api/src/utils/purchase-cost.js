'use strict';

const DEFAULT_EXCHANGE_RATE = 280;
const DEFAULT_EXTRA_COST = 0;

function settingNumber(value, fallback, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  if (value === undefined || value === null || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) return fallback;
  return parsed;
}

function purchaseSettings(settings = {}) {
  return {
    exchangeRate: settingNumber(settings.purchase_exchange_rate, DEFAULT_EXCHANGE_RATE, { min: 0.000001, max: 1e9 }),
    extraCost: settingNumber(settings.purchase_extra_cost_dzd ?? settings.purchase_vat_dzd, DEFAULT_EXTRA_COST, { min: 0, max: 1e9 }),
  };
}

/**
 * Convert a supplier's EUR unit price into the purchase cost stored in DZD.
 * A manually entered fixed extra cost is added after currency conversion.
 * Monetary outputs are rounded to cents.
 */
function calculatePurchaseCost(eurPrice, settings = {}) {
  const eur = Number(eurPrice);
  if (!Number.isFinite(eur) || eur < 0) throw new TypeError('EUR purchase price must be a finite non-negative number.');
  const { exchangeRate, extraCost } = purchaseSettings(settings);
  const baseDzd = Math.round(eur * exchangeRate * 100) / 100;
  const extraCostDzd = Math.round(extraCost * 100) / 100;
  const totalDzd = Math.round((baseDzd + extraCostDzd) * 100) / 100;
  return {
    purchase_price_eur: Math.round(eur * 100) / 100,
    purchase_exchange_rate: exchangeRate,
    purchase_extra_cost_dzd: extraCostDzd,
    purchase_vat_dzd: extraCostDzd,
    purchase_base_dzd: baseDzd,
    purchase_cost_dzd: totalDzd,
  };
}

module.exports = { DEFAULT_EXCHANGE_RATE, DEFAULT_EXTRA_COST, purchaseSettings, calculatePurchaseCost };
