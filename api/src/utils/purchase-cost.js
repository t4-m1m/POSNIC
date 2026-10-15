'use strict';

const DEFAULT_EXCHANGE_RATE = 280;
const DEFAULT_VAT_RATE = 9;

function settingNumber(value, fallback, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  if (value === undefined || value === null || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) return fallback;
  return parsed;
}

function purchaseSettings(settings = {}) {
  return {
    exchangeRate: settingNumber(settings.purchase_exchange_rate, DEFAULT_EXCHANGE_RATE, { min: 0.000001, max: 1e9 }),
    vatRate: settingNumber(settings.purchase_vat_rate, DEFAULT_VAT_RATE, { min: 0, max: 100 }),
  };
}

/**
 * Convert a supplier's EUR unit price into the purchase cost stored in DZD.
 * VAT is added after currency conversion and all monetary outputs are rounded
 * to cents. Returned inputs make the applied settings auditable per receipt.
 */
function calculatePurchaseCost(eurPrice, settings = {}) {
  const eur = Number(eurPrice);
  if (!Number.isFinite(eur) || eur < 0) throw new TypeError('EUR purchase price must be a finite non-negative number.');
  const { exchangeRate, vatRate } = purchaseSettings(settings);
  const baseDzd = Math.round(eur * exchangeRate * 100) / 100;
  const vatDzd = Math.round(baseDzd * vatRate) / 100;
  const totalDzd = Math.round((baseDzd + vatDzd) * 100) / 100;
  return {
    purchase_price_eur: Math.round(eur * 100) / 100,
    purchase_exchange_rate: exchangeRate,
    purchase_vat_rate: vatRate,
    purchase_base_dzd: baseDzd,
    purchase_vat_dzd: vatDzd,
    purchase_cost_dzd: totalDzd,
  };
}

module.exports = { DEFAULT_EXCHANGE_RATE, DEFAULT_VAT_RATE, purchaseSettings, calculatePurchaseCost };
