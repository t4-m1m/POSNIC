'use strict';

// ─── Mocks ────────────────────────────────────────────────────────────────────
jest.mock('../../../src/services/sale.service');
jest.mock('../../../src/services/sales-history-summary');
jest.mock('../../../src/services/paid-bill-edit', () => ({ amend: jest.fn() }));
jest.mock('../../../src/services/business-checkout-decisions', () => ({
  createCheckoutDecisions: jest.fn(),
}));
jest.mock('../../../src/models/sale.model');
jest.mock('../../../src/services/item.service');
jest.mock('../../../src/repositories/sale.repository');
jest.mock('../../../src/services/base.service', () => ({}));
jest.mock('../../../src/utils/activityLogger', () => ({
  createActivityLog: jest.fn().mockResolvedValue(null),
}));

jest.mock('../../../src/models/base.model', () => {
  const s = {};
  return class MockBaseModel {
    static async getDb() {
      return {};
    }
    static get currentBranch() {
      return s.currentBranch;
    }
    static set currentBranch(v) {
      s.currentBranch = v;
    }
    static get license() {
      return s.license;
    }
    static set license(v) {
      s.license = v;
    }
    static get loggedUser() {
      return s.loggedUser;
    }
    static set loggedUser(v) {
      s.loggedUser = v;
    }
    static get loggedUserName() {
      return s.loggedUserName;
    }
    static set loggedUserName(v) {
      s.loggedUserName = v;
    }
    static get loggedUserDetails() {
      return s.loggedUserDetails;
    }
    static set loggedUserDetails(v) {
      s.loggedUserDetails = v;
    }
  };
});

jest.mock('../../../src/utils/session-filter.util', () => ({
  applySessionFilter: jest.fn().mockResolvedValue({
    start_date: new Date('2025-01-01T00:00:00.000Z'),
    end_date: new Date('2025-12-31T23:59:59.000Z'),
    session_applied: false,
  }),
  applySessionFilterToSalesFilters: jest.fn().mockImplementation((_req, f) => Promise.resolve(f)),
}));

jest.mock('../../../src/helpers/sales.helper', () => ({
  roundToTwo: jest.fn((v) => Math.round((Number(v || 0) + Number.EPSILON) * 100) / 100),
  numberOrZero: jest.fn((v, fb = 0) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : fb;
  }),
  normalizeToMongooseId: jest.fn((v) => v || null),
  resolveBranchId: jest.fn().mockReturnValue('507f1f77bcf86cd799439012'),
  resolveRequestBranchId: jest.fn().mockReturnValue(null),
  parseSaleDate: jest.fn((d) => (d ? new Date(d) : null)),
  normalizeRangeDate: jest.fn((d) => (d ? new Date(d) : null)),
  calculateInstantMetrics: jest.fn().mockReturnValue({ instantItems: [] }),
  normalizeSaleItems: jest.fn((items) => (Array.isArray(items) ? items : [])),
  resolveTimeZonePreference: jest.fn().mockReturnValue('UTC'),
  parseSalesFilters: jest.fn().mockReturnValue({}),
  parseBranchIdsFromRequest: jest.fn().mockReturnValue({ validBranchIds: [], uniqueBranchIds: [] }),
  formatSaleListEntry: jest.fn((doc) => doc),
  formatDateForTimezone: jest.fn((d) => (d ? new Date(d).toISOString().split('T')[0] : '')),
}));

jest.mock('../../../src/utils/helpers', () => ({
  safeJsonParse: jest.fn((v, fb) => {
    try {
      return JSON.parse(v);
    } catch {
      return fb;
    }
  }),
  formatDate: jest.fn((d) => (d ? new Date(d).toISOString() : '')),
  toObjectId: jest.fn((v) => v),
}));

jest.mock('pdfkit', () => {
  const { EventEmitter } = require('events');
  class PDFDocument extends EventEmitter {
    constructor() {
      super();
    }
    registerFont() {
      return this;
    }
    pipe() {
      return this;
    }
    fontSize() {
      return this;
    }
    font() {
      return this;
    }
    text() {
      return this;
    }
    image() {
      return this;
    }
    rect() {
      return this;
    }
    stroke() {
      return this;
    }
    fillAndStroke() {
      return this;
    }
    fillColor() {
      return this;
    }
    moveTo() {
      return this;
    }
    lineTo() {
      return this;
    }
    addPage() {
      return this;
    }
    end() {
      return this;
    }
    get page() {
      return { width: 595, height: 842, margins: { left: 40, right: 40, bottom: 40 } };
    }
  }
  return PDFDocument;
});

jest.mock('nodemailer', () => ({
  createTransport: jest.fn(() => ({ sendMail: jest.fn().mockResolvedValue({ messageId: 'ok' }) })),
}));

jest.mock('../../../src/utils/pdfGenerator', () => ({ generateInvoicePDF: jest.fn() }));

// ─── Load after mocks ─────────────────────────────────────────────────────────
const ctrl = require('../../../src/controllers/sales.controller');
const salesService = require('../../../src/services/sale.service');
const sessionFilterUtil = require('../../../src/utils/session-filter.util');
const { ERROR_MESSAGES, SUCCESS_MESSAGES } = require('../../../src/constants/sales.constants');
const { SALE_STATUS } = require('../../../src/constants');
const salesHelper = require('../../../src/helpers/sales.helper');
const BaseModel = require('../../../src/models/base.model');
const Sale = require('../../../src/models/sale.model');

// ─── Constants ────────────────────────────────────────────────────────────────
const VALID_ID = '507f1f77bcf86cd799439011';
const VALID_BRANCH = '507f1f77bcf86cd799439012';
const VALID_LICENSE = '507f1f77bcf86cd799439013';

// ─── Fixtures ─────────────────────────────────────────────────────────────────
const mockRes = () => {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  res.send = jest.fn().mockReturnValue(res);
  res.setHeader = jest.fn().mockReturnValue(res);
  res.pipe = jest.fn().mockReturnValue(res);
  return res;
};
const mockNext = () => jest.fn();

const adminUser = (ov = {}) => ({
  _id: VALID_ID,
  username: 'admin',
  email: 'admin@test.com',
  name: 'Admin',
  usertype: 'super_admin',
  role: 'super_admin',
  branch_id: VALID_BRANCH,
  license: VALID_LICENSE,
  license_id: VALID_LICENSE,
  access: { sales: { read: true, write: true, delete: true }, report: { read: true } },
  ...ov,
});
const restrictedUser = () => ({
  _id: VALID_ID,
  username: 'user',
  usertype: 'user',
  role: 'user',
  access: { sales: { read: false, write: false, delete: false }, report: { read: false } },
});
const mockReq = (ov = {}) => ({
  body: {},
  params: {},
  query: {},
  headers: {},
  user: adminUser(),
  session: {},
  ...ov,
});

const initService = () => {
  salesService.enrichSaleContext = jest.fn().mockImplementation((ctx) => Promise.resolve(ctx));
  salesService.processSale = jest.fn().mockResolvedValue({
    status: true,
    data: { _id: VALID_ID },
    message: SUCCESS_MESSAGES.SALE_ADDED,
  });
  salesService.getSaleById = jest
    .fn()
    .mockResolvedValue({ _id: VALID_ID, status: 'completed', items: [], sales_id: 'INV-001' });
  salesService.getLegacySaleDetails = jest
    .fn()
    .mockResolvedValue({ status: true, data: { _id: VALID_ID } });
  salesService.listSales = jest
    .fn()
    .mockResolvedValue({ results: [], totalResults: 0, page: 1, limit: 10, totalPages: 1 });
  salesService.deleteSales = jest.fn().mockResolvedValue({ status: true, data: {} });
  salesService.getLatestSales = jest.fn().mockResolvedValue([{ _id: VALID_ID }]);
  salesService.getBranchById = jest
    .fn()
    .mockResolvedValue({ branch_name: 'HQ', time_zone: 'UTC', currency_type: '₹' });
  salesService.getDailySalesReportAggregates = jest.fn().mockResolvedValue({
    productAgg: [],
    paymentAgg: [],
    salesPayments: [],
    taxAgg: [],
    cancellationAgg: [],
  });
  salesService.getDailyReportPdfAggregates = jest
    .fn()
    .mockResolvedValue({ productAgg: [], paymentAgg: [], taxAgg: [], extraDiscountSummary: [] });
  salesService.returnProductReportPage = jest
    .fn()
    .mockResolvedValue({ status: true, list: [], pagination: { total: 0, page: 1, limit: 5 } });
  salesService.returnProductViewPage = jest.fn().mockResolvedValue({ status: true, data: [] });
  salesService.getSalesGraphicalReportData = jest
    .fn()
    .mockResolvedValue([{ month: 'Jan', total: 100 }]);
  salesService.getSalesSummaryReportsData = jest.fn().mockResolvedValue({ total_sales: 500 });
  salesService.getSalesReportsData = jest.fn().mockResolvedValue({ list: [], total: 0 });
  salesService.getInstantSalesReportsData = jest
    .fn()
    .mockResolvedValue({ itemsList: [], total: 0 });
  salesService.getItemSalesReportTableData = jest.fn().mockResolvedValue({ total: 0, list: [] });
  salesService.getCategorySalesReportTableData = jest
    .fn()
    .mockResolvedValue({ total: 0, list: [] });
  salesService.userReportPage = jest.fn().mockResolvedValue({
    status: true,
    list: [{ _id: VALID_ID }],
    pagination: { total: 1, page: 1, limit: 5 },
  });
  salesService.getUserGraphicalReports = jest
    .fn()
    .mockResolvedValue({ status: true, data: {}, message: 'OK' });
  salesService.returnSalesReportPage = jest
    .fn()
    .mockResolvedValue({ status: true, list: [], pagination: { total: 0, page: 1, limit: 5 } });
  salesService.productBasedReportPage = jest
    .fn()
    .mockResolvedValue({ status: true, list: [], pagination: { total: 0, page: 1, limit: 5 } });
  salesService.pendingSalesReportPage = jest
    .fn()
    .mockResolvedValue({ status: true, list: [], pagination: { total: 0, page: 1, limit: 5 } });
  salesService.pendingCustomerReportPage = jest
    .fn()
    .mockResolvedValue({ status: true, list: [], pagination: { total: 0, page: 1, limit: 5 } });
  salesService.taxSalesReportPage = jest
    .fn()
    .mockResolvedValue({ status: true, data: {}, message: 'OK' });
  salesService.paymentSalesTransactionReportPage = jest
    .fn()
    .mockResolvedValue({ status: true, list: [], pagination: { total: 0, page: 1, limit: 5 } });
  salesService.getPaymentSaleTypeReport = jest
    .fn()
    .mockResolvedValue({ status: true, data: {}, message: 'OK' });
  salesService.paymentReturnSalesTranscationReportTable = jest
    .fn()
    .mockResolvedValue({ status: true, list: [], pagination: { total: 0, page: 1, limit: 5 } });
  salesService.getPaymentGraphicalReports = jest
    .fn()
    .mockResolvedValue({ status: true, data: {}, message: 'OK' });
  salesService.returnSalesOrder = jest.fn().mockResolvedValue({ status: true, data: {} });
  salesService.exportSalesOrder = jest
    .fn()
    .mockResolvedValue({ status: true, data: [{ _id: VALID_ID }] });
  salesService.getSalesDataChanges = jest.fn().mockResolvedValue({ status: true, data: {} });
  salesService.getReturnSalesDetails = jest
    .fn()
    .mockResolvedValue({ status: true, data: {}, message: 'OK' });
  salesService.getReturnPrintDetails = jest
    .fn()
    .mockResolvedValue({ status: true, data: {}, message: 'OK' });
  salesService.getSaleForReceipt = jest.fn().mockResolvedValue({
    _id: VALID_ID,
    sales_id: 'INV-001',
    customer_name: 'Test',
    items_total: 100,
    payment_mode: 'Cash',
    date: new Date(),
  });
  salesService.getSaleForCustomerPrint = jest.fn().mockResolvedValue({
    _id: VALID_ID,
    sales_id: 'INV-001',
    items: [],
    customer_name: 'Test',
    branch_id: {},
  });
  salesService.getSaleForPdf = jest
    .fn()
    .mockResolvedValue({ _id: VALID_ID, sales_id: 'INV-001', branch: VALID_BRANCH, items: [] });
  salesService.getTablesWithActiveOrders = jest
    .fn()
    .mockResolvedValue({ status: true, message: 'OK', data: [] });
};

// ═══════════════════════════════════════════════════════════════════════════════
describe('SalesController', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    // Reset shared BaseModel state so stale branch/license from previous tests
    // don't bleed into tests that use null-branch users.
    BaseModel.currentBranch = null;
    BaseModel.license = null;
    BaseModel.loggedUser = null;
    BaseModel.loggedUserName = null;
    BaseModel.loggedUserDetails = null;
    initService();
    // Re-establish helper mock implementations overridden by individual tests
    // (jest.clearAllMocks clears call counts but not mockReturnValue overrides).
    salesHelper.parseSaleDate.mockImplementation((d) => (d ? new Date(d) : null));
    salesHelper.resolveBranchId.mockReturnValue(VALID_BRANCH);
    salesHelper.normalizeSaleItems.mockImplementation((items) =>
      Array.isArray(items) ? items : []
    );
  });

  // ── create ──────────────────────────────────────────────────────────────────
  test('server-built desktop context enables seating despite a payload opt-out', async () => {
    const context = await ctrl.buildSaleContext(mockReq({ body: { seatingProtocol: false } }));
    expect(context.seatingProtocol).toBe(true);
    expect(context.userId).toBe(VALID_ID);
  });

  describe('create', () => {
    test('200 success', async () => {
      const res = mockRes();
      const next = mockNext();
      await ctrl.create(
        mockReq({ body: { items: [{ item_id: VALID_ID, item_quantity: 1 }], sales_total: 100 } }),
        res,
        next
      );
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ type: 'success' }));
    });

    test('returns the existing sale for a repeated billing transaction', async () => {
      Sale.findOne.mockReturnValue({
        lean: jest.fn().mockResolvedValue({
          _id: VALID_ID,
          sales_id: 'SID000123',
          customer_name: 'Customer',
          country_sort: 'IN',
        }),
      });
      const res = mockRes();
      const next = mockNext();
      await ctrl.create(
        mockReq({
          body: {
            billing_transaction_id: 'billing-attempt-1',
            items: [{ item_id: VALID_ID, item_quantity: 1 }],
            sales_total: 100,
          },
        }),
        res,
        next
      );

      expect(salesService.processSale).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'success',
          data: expect.objectContaining({ duplicate: true, sale_number: 'SID000123' }),
        })
      );
    });

    test('400 when service status false', async () => {
      salesService.processSale.mockResolvedValue({
        status: false,
        message: ERROR_MESSAGES.SALES_NOT_ADDED,
        data: null,
      });
      const res = mockRes();
      const next = mockNext();
      await ctrl.create(mockReq({ body: { items: [] } }), res, next);
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' }));
    });

    test('500 when service returns null', async () => {
      salesService.processSale.mockResolvedValue(null);
      const res = mockRes();
      const next = mockNext();
      await ctrl.create(mockReq({ body: {} }), res, next);
      expect(res.status).toHaveBeenCalledWith(500);
    });

    test('next(error) on exception', async () => {
      salesService.processSale.mockRejectedValue(new Error('crash'));
      const res = mockRes();
      const next = mockNext();
      await ctrl.create(mockReq({ body: {} }), res, next);
      expect(next).toHaveBeenCalledWith(expect.any(Error));
    });
  });

  // ── discount manager-approval gate ──────────────────────────────────────────
  describe('create — manual-discount approval gate', () => {
    const { signApproval } = require('../../../src/utils/approval-token.util');
    const cashier = (posOverrides = {}) =>
      adminUser({
        usertype: 'user',
        role: 'user',
        access: {
          sales: { read: true, write: true, delete: true },
          pos: { discount_apply: false, void_sale: false, refund: false, ...posOverrides },
        },
      });
    const discountedBody = (extra = {}) => ({
      items: [{ item_id: VALID_ID, item_quantity: 1, item_discount: 5 }],
      sales_total: 95,
      ...extra,
    });

    test('manual discounts remain available without a manager token', async () => {
      const res = mockRes();
      await ctrl.create(mockReq({ user: cashier(), body: discountedBody() }), res, mockNext());
      expect(res.status).toHaveBeenCalledWith(200);
      expect(salesService.processSale).toHaveBeenCalled();
    });

    test('a supplied remote decision cannot bypass the verified checkout gate', async () => {
      const {
        createCheckoutDecisions,
      } = require('../../../src/services/business-checkout-decisions');
      const gate = jest.fn().mockRejectedValue(
        Object.assign(new Error('cashier_access_denied'), {
          code: 'cashier_access_denied',
          status: 403,
        })
      );
      createCheckoutDecisions.mockReturnValue({ gate });
      const res = mockRes();
      await ctrl.create(
        mockReq({ user: cashier(), body: discountedBody({ business_decision_id: VALID_ID }) }),
        res,
        mockNext()
      );
      expect(gate).toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(403);
      expect(salesService.processSale).not.toHaveBeenCalled();
    });

    test('remote approval passes a server pre-commit hook and preserves a reconciliation response', async () => {
      const {
        createCheckoutDecisions,
      } = require('../../../src/services/business-checkout-decisions');
      const beforeCommit = jest.fn();
      createCheckoutDecisions.mockReturnValue({ gate: jest.fn().mockResolvedValue(beforeCommit) });
      salesService.processSale.mockResolvedValue({
        status: false,
        decisionError: { code: 'decision_reconciliation_required', status: 409 },
      });
      const res = mockRes();
      await ctrl.create(
        mockReq({ user: cashier(), body: discountedBody({ business_decision_id: VALID_ID }) }),
        res,
        mockNext()
      );
      expect(salesService.processSale).toHaveBeenCalledWith(
        expect.any(Object),
        '',
        'Add',
        expect.any(Object),
        { beforeCommit }
      );
      expect(res.status).toHaveBeenCalledWith(409);
      expect(res.json).toHaveBeenCalledWith({
        error: { code: 'decision_reconciliation_required' },
      });
    });

    test('passes with a valid manager-approval token bound to this cashier', async () => {
      const token = signApproval({ action: 'discount_apply', cashier_user_id: VALID_ID });
      const res = mockRes();
      await ctrl.create(
        mockReq({ user: cashier(), body: discountedBody({ approval_token: token }) }),
        res,
        mockNext()
      );
      expect(res.status).toHaveBeenCalledWith(200);
      expect(salesService.processSale).toHaveBeenCalled();
    });

    test('does not require an approval token for a manual discount', async () => {
      const token = signApproval({ action: 'void_sale', cashier_user_id: VALID_ID });
      const res = mockRes();
      await ctrl.create(
        mockReq({ user: cashier(), body: discountedBody({ approval_token: token }) }),
        res,
        mockNext()
      );
      expect(res.status).toHaveBeenCalledWith(200);
      expect(salesService.processSale).toHaveBeenCalled();
    });

    test('no gate when the cashier may apply discounts', async () => {
      const res = mockRes();
      await ctrl.create(
        mockReq({ user: cashier({ discount_apply: true }), body: discountedBody() }),
        res,
        mockNext()
      );
      expect(res.status).toHaveBeenCalledWith(200);
    });

    test('manual discounts are not blocked by the legacy role percentage cap', async () => {
      // 20 off a 100 subtotal = 20%, over the 10% cap.
      const res = mockRes();
      await ctrl.create(
        mockReq({
          user: cashier({ discount_apply: true, discount_max_percent: 10 }),
          body: {
            items: [{ item_id: VALID_ID, item_quantity: 1, item_discount: 20 }],
            sales_sub_total: 100,
            sales_total: 80,
          },
        }),
        res,
        mockNext()
      );
      expect(res.status).toHaveBeenCalledWith(200);
      expect(salesService.processSale).toHaveBeenCalled();
    });

    test('within the role cap passes without approval', async () => {
      const res = mockRes();
      await ctrl.create(
        mockReq({
          user: cashier({ discount_apply: true, discount_max_percent: 10 }),
          body: {
            items: [{ item_id: VALID_ID, item_quantity: 1, item_discount: 5 }],
            sales_sub_total: 100,
            sales_total: 95,
          },
        }),
        res,
        mockNext()
      );
      expect(res.status).toHaveBeenCalledWith(200);
    });

    test('no gate on an undiscounted sale', async () => {
      const res = mockRes();
      await ctrl.create(
        mockReq({
          user: cashier(),
          body: { items: [{ item_id: VALID_ID, item_quantity: 1 }], sales_total: 100 },
        }),
        res,
        mockNext()
      );
      expect(res.status).toHaveBeenCalledWith(200);
    });

    test('fails open for a user with no pos matrix (legacy session)', async () => {
      const res = mockRes();
      await ctrl.create(
        mockReq({
          user: adminUser({ usertype: 'user', role: 'user', access: { sales: { write: true } } }),
          body: discountedBody(),
        }),
        res,
        mockNext()
      );
      expect(res.status).toHaveBeenCalledWith(200);
    });
  });

  // ── update ──────────────────────────────────────────────────────────────────
  describe('update', () => {
    const body = { items: [{ item_id: VALID_ID, item_quantity: 2 }], sales_total: 100 };

    test.each([
      [403, 'Enable payment corrections in Sale settings first.'],
      [403, 'You do not have permission to correct this bill.'],
      [409, 'This bill changed. Reload it before correcting it.'],
      [422, 'Invalid item quantity.'],
    ])('returns correction refusal %s with its actionable message', async (status, message) => {
      salesHelper.normalizeSaleItems.mockReturnValue([{ item_id: VALID_ID }]);
      require('../../../src/services/paid-bill-edit').amend.mockRejectedValueOnce(
        Object.assign(new Error(message), { status })
      );
      const res = mockRes();
      const next = mockNext();
      await ctrl.update(
        mockReq({
          params: { id: VALID_ID },
          body: {
            ...body,
            paid_bill_correction: { reason: 'Wrong method recorded' },
          },
        }),
        res,
        next
      );
      expect(res.status).toHaveBeenCalledWith(status);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message }));
      expect(next).not.toHaveBeenCalled();
      expect(salesService.processSale).not.toHaveBeenCalled();
    });

    test('200 success', async () => {
      salesHelper.normalizeSaleItems.mockReturnValue([{ item_id: VALID_ID }]);
      salesService.processSale.mockResolvedValue({
        status: true,
        data: { _id: VALID_ID },
        message: SUCCESS_MESSAGES.SALE_UPDATED,
      });
      const res = mockRes();
      const next = mockNext();
      await ctrl.update(mockReq({ params: { id: VALID_ID }, body }), res, next);
      expect(res.status).toHaveBeenCalledWith(200);
    });

    test('403 no write permission', async () => {
      const res = mockRes();
      const next = mockNext();
      await ctrl.update(
        mockReq({ params: { id: VALID_ID }, body, user: restrictedUser() }),
        res,
        next
      );
      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ message: ERROR_MESSAGES.UNAUTHORIZED_UPDATE_SALES })
      );
    });

    test('400 empty items array', async () => {
      salesHelper.normalizeSaleItems.mockReturnValue([]);
      const res = mockRes();
      const next = mockNext();
      await ctrl.update(mockReq({ params: { id: VALID_ID }, body: { items: [] } }), res, next);
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ message: ERROR_MESSAGES.AT_LEAST_ONE_VALID_SALE_ITEM_REQUIRED })
      );
    });

    test('400 missing branch context', async () => {
      salesHelper.normalizeSaleItems.mockReturnValue([{ item_id: VALID_ID }]);
      salesHelper.resolveBranchId.mockReturnValue(null);
      const user = adminUser({ branch_id: null, default_branch_id: null });
      const res = mockRes();
      const next = mockNext();
      await ctrl.update(mockReq({ params: { id: VALID_ID }, body, user }), res, next);
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ message: ERROR_MESSAGES.BRANCH_CONTEXT_REQUIRED_UPDATE })
      );
    });

    test('404 sale not found', async () => {
      salesHelper.normalizeSaleItems.mockReturnValue([{ item_id: VALID_ID }]);
      salesService.getSaleById.mockResolvedValue(null);
      const res = mockRes();
      const next = mockNext();
      await ctrl.update(mockReq({ params: { id: VALID_ID }, body }), res, next);
      expect(res.status).toHaveBeenCalledWith(404);
    });

    test('400 when service returns status false', async () => {
      salesHelper.normalizeSaleItems.mockReturnValue([{ item_id: VALID_ID }]);
      salesService.processSale.mockResolvedValue({
        status: false,
        message: ERROR_MESSAGES.SALES_NOT_UPDATED,
        data: null,
      });
      const res = mockRes();
      const next = mockNext();
      await ctrl.update(mockReq({ params: { id: VALID_ID }, body }), res, next);
      expect(res.status).toHaveBeenCalledWith(400);
    });

    test('next(error) on exception', async () => {
      salesHelper.normalizeSaleItems.mockReturnValue([{ item_id: VALID_ID }]);
      salesService.getSaleById.mockRejectedValue(new Error('DB fail'));
      const res = mockRes();
      const next = mockNext();
      await ctrl.update(mockReq({ params: { id: VALID_ID }, body }), res, next);
      expect(next).toHaveBeenCalledWith(expect.any(Error));
    });
  });

  // ── getAll ───────────────────────────────────────────────────────────────────
  describe('getAll', () => {
    test('optional summary receives precisely the same scoped filters as the paginated history', async () => {
      const summary = require('../../../src/services/sales-history-summary');
      summary.mockResolvedValue({ count: 20, cancelled: 0, currencies: [] });
      const res = mockRes();
      await ctrl.getAll(
        mockReq({ query: { include_summary: 'true', ordered_by: 'Asha', page: '2', limit: '5' } }),
        res,
        mockNext()
      );
      expect(summary).toHaveBeenCalledWith(
        expect.anything(),
        salesService.listSales.mock.calls[0][0]
      );
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ summary: expect.objectContaining({ count: 20 }) }),
        })
      );
    });
    test.each([
      ['', 'date:desc,_id:desc'],
      ['date_asc', 'date:asc,_id:asc'],
      ['date_desc', 'date:desc,_id:desc'],
      ['recent', 'created_date:desc,_id:desc'],
      ['updated_desc', 'updated_date:desc,_id:desc'],
      ['total_desc', 'sales_total:desc,_id:desc'],
    ])('sort %s reaches pagination', async (sort, sortBy) => {
      await ctrl.getAll(mockReq({ query: { sort } }), mockRes(), mockNext());
      expect(salesService.listSales).toHaveBeenCalledWith(
        expect.any(Object),
        expect.objectContaining({ sortBy }),
        expect.any(Object)
      );
    });
    test('staff and device filters narrow the existing scoped query', async () => {
      await ctrl.getAll(
        mockReq({
          query: { ordered_by: 'Asha', order_device: 'Kitchen', order_source: 'tableside' },
        }),
        mockRes(),
        mockNext()
      );
      const filter = salesService.listSales.mock.calls[0][0];
      expect(filter.$and).toHaveLength(3);
      expect(JSON.stringify(filter.$and)).toContain('kitchen_actor.name');
      expect(JSON.stringify(filter.$and)).toContain('client.device_id');
    });
    test('200 with paginated list', async () => {
      salesService.listSales.mockResolvedValue({
        results: [{ _id: VALID_ID }],
        totalResults: 1,
        page: 1,
        limit: 10,
        totalPages: 1,
      });
      const res = mockRes();
      const next = mockNext();
      await ctrl.getAll(mockReq({ query: { page: '1', limit: '10' } }), res, next);
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'success', data: expect.objectContaining({ total: 1 }) })
      );
    });

    test('403 no read permission', async () => {
      const res = mockRes();
      const next = mockNext();
      await ctrl.getAll(mockReq({ query: {}, user: restrictedUser() }), res, next);
      expect(res.status).toHaveBeenCalledWith(403);
    });

    test('applies sessionFilterUtil', async () => {
      const res = mockRes();
      const next = mockNext();
      await ctrl.getAll(mockReq({ query: {} }), res, next);
      expect(sessionFilterUtil.applySessionFilterToSalesFilters).toHaveBeenCalled();
    });

    test('returns total=0 for empty results', async () => {
      const res = mockRes();
      const next = mockNext();
      await ctrl.getAll(mockReq({ query: {} }), res, next);
      expect(res.json.mock.calls[0][0].data.total).toBe(0);
    });

    test('next(error) on exception', async () => {
      salesService.listSales.mockRejectedValue(new Error('crash'));
      const res = mockRes();
      const next = mockNext();
      await ctrl.getAll(mockReq({ query: {} }), res, next);
      expect(next).toHaveBeenCalledWith(expect.any(Error));
    });
  });

  // ── getOne ───────────────────────────────────────────────────────────────────
  describe('getOne', () => {
    test('200 with sale data', async () => {
      const res = mockRes();
      const next = mockNext();
      await ctrl.getOne(mockReq({ params: { id: VALID_ID } }), res, next);
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ type: 'success' }));
    });

    test('403 no read permission', async () => {
      const res = mockRes();
      const next = mockNext();
      await ctrl.getOne(mockReq({ params: { id: VALID_ID }, user: restrictedUser() }), res, next);
      expect(res.status).toHaveBeenCalledWith(403);
    });

    test('404 when service returns null', async () => {
      salesService.getLegacySaleDetails.mockResolvedValue(null);
      const res = mockRes();
      const next = mockNext();
      await ctrl.getOne(mockReq({ params: { id: VALID_ID } }), res, next);
      expect(res.status).toHaveBeenCalledWith(404);
    });

    test('404 when service status false', async () => {
      salesService.getLegacySaleDetails.mockResolvedValue({ status: false, data: null });
      const res = mockRes();
      const next = mockNext();
      await ctrl.getOne(mockReq({ params: { id: VALID_ID } }), res, next);
      expect(res.status).toHaveBeenCalledWith(404);
    });
  });

  // ── delete ───────────────────────────────────────────────────────────────────
  describe('delete', () => {
    test.each(['admin', 'owner', 'manager', 'cashier'])(
      'rejects %s even with sale-delete permission and the switch enabled',
      async (role) => {
        const res = mockRes();
        await ctrl.delete(
          mockReq({
            body: { data: [VALID_ID] },
            user: adminUser({ usertype: role, role, access: { sales: { delete: true } } }),
          }),
          res,
          mockNext()
        );
        expect(res.status).toHaveBeenCalledWith(403);
        expect(salesService.deleteSales).not.toHaveBeenCalled();
      }
    );
    beforeEach(() => {
      salesService.getBranchById.mockResolvedValue({
        allow_sale_hard_delete: true,
        module_recyclebin_enable: true,
      });
    });
    test.each([undefined, false, 'false'])(
      'blocks even an admin when hard delete is %s',
      async (setting) => {
        salesService.getBranchById.mockResolvedValue({
          allow_sale_hard_delete: setting,
          module_recyclebin_enable: true,
        });
        const res = mockRes();
        await ctrl.delete(mockReq({ body: { data: [VALID_ID] } }), res, mockNext());
        expect(res.status).toHaveBeenCalledWith(403);
        expect(salesService.deleteSales).not.toHaveBeenCalled();
      }
    );
    test('requires retained Recycle Bin data', async () => {
      salesService.getBranchById.mockResolvedValue({
        allow_sale_hard_delete: true,
        module_recyclebin_enable: false,
      });
      const res = mockRes();
      await ctrl.delete(mockReq({ body: { data: [VALID_ID] } }), res, mockNext());
      expect(res.status).toHaveBeenCalledWith(403);
      expect(salesService.deleteSales).not.toHaveBeenCalled();
    });
    test('200 success', async () => {
      const res = mockRes();
      const next = mockNext();
      await ctrl.delete(mockReq({ body: { data: [VALID_ID] } }), res, next);
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ message: SUCCESS_MESSAGES.SALES_DELETED })
      );
    });

    test('403 no delete permission', async () => {
      const res = mockRes();
      const next = mockNext();
      await ctrl.delete(mockReq({ body: { data: [VALID_ID] }, user: restrictedUser() }), res, next);
      expect(res.status).toHaveBeenCalledWith(403);
    });

    test('400 empty data array', async () => {
      const res = mockRes();
      const next = mockNext();
      await ctrl.delete(mockReq({ body: { data: [] } }), res, next);
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ message: ERROR_MESSAGES.NO_VALID_SALE_IDS_FOR_DELETE })
      );
    });

    test('400 all IDs invalid', async () => {
      const res = mockRes();
      const next = mockNext();
      await ctrl.delete(mockReq({ body: { data: ['invalid-id'] } }), res, next);
      expect(res.status).toHaveBeenCalledWith(400);
    });

    test('404 when service status false', async () => {
      salesService.deleteSales.mockResolvedValue({ status: false, data: null });
      const res = mockRes();
      const next = mockNext();
      await ctrl.delete(mockReq({ body: { data: [VALID_ID] } }), res, next);
      expect(res.status).toHaveBeenCalledWith(404);
    });

    test('500 when service returns null', async () => {
      salesService.deleteSales.mockResolvedValue(null);
      const res = mockRes();
      const next = mockNext();
      await ctrl.delete(mockReq({ body: { data: [VALID_ID] } }), res, next);
      expect(res.status).toHaveBeenCalledWith(500);
    });

    test('parses legacy body.ids field', async () => {
      const res = mockRes();
      const next = mockNext();
      await ctrl.delete(mockReq({ body: { ids: [VALID_ID] } }), res, next);
      expect(salesService.deleteSales).toHaveBeenCalledWith([VALID_ID], expect.any(Object));
      expect(res.status).toHaveBeenCalledWith(200);
    });
  });

  // ── getLatestSales ───────────────────────────────────────────────────────────
  describe('getLatestSales', () => {
    test('200 returns stringified JSON when sales exist', async () => {
      const res = mockRes();
      await ctrl.getLatestSales(mockReq(), res);
      expect(res.status).toHaveBeenCalledWith(200);
      const payload = res.json.mock.calls[0][0];
      expect(payload.type).toBe('success');
      expect(typeof payload.data).toBe('string');
    });

    test('200 with data=0 when no sales', async () => {
      salesService.getLatestSales.mockResolvedValue([]);
      const res = mockRes();
      await ctrl.getLatestSales(mockReq(), res);
      expect(res.json.mock.calls[0][0].data).toBe(0);
    });

    test('403 no write permission', async () => {
      const res = mockRes();
      await ctrl.getLatestSales(mockReq({ user: restrictedUser() }), res);
      expect(res.status).toHaveBeenCalledWith(403);
    });

    test('500 on exception', async () => {
      salesService.getLatestSales.mockRejectedValue(new Error('crash'));
      const res = mockRes();
      await ctrl.getLatestSales(mockReq(), res);
      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json.mock.calls[0][0].type).toBe('error');
    });
  });

  // ── dailySalesReports ─────────────────────────────────────────────────────────
  describe('dailySalesReports', () => {
    const q = {
      branch: VALID_BRANCH,
      type: 'VIEW',
      starting_date: '2025-01-01',
      ending_date: '2025-12-31',
    };

    // dailySalesReports now reads the operational ledgers used by the real
    // closing report. Give tests a complete empty-database adapter by default,
    // while allowing individual tests to override selected collections.
    const emptyCursor = () => ({
      toArray: async () => [],
      project() { return this; },
    });
    const emptyCollection = () => ({
      aggregate: jest.fn(() => emptyCursor()),
      find: jest.fn(() => emptyCursor()),
      countDocuments: jest.fn().mockResolvedValue(1),
    });

    beforeEach(() => {
      const db = { collection: jest.fn(() => emptyCollection()) };
      jest.spyOn(BaseModel, 'getDb').mockResolvedValue(db);
    });

    afterEach(() => {
      if (BaseModel.getDb && BaseModel.getDb.mockRestore) BaseModel.getDb.mockRestore();
      sessionFilterUtil.applySessionFilter.mockReset().mockResolvedValue({
        start_date: new Date('2025-01-01T00:00:00.000Z'),
        end_date: new Date('2025-12-31T23:59:59.000Z'),
        session_applied: false,
      });
    });

    test('200 success', async () => {
      const res = mockRes();
      await ctrl.dailySalesReports(mockReq({ query: q }), res);
      const reportMatch = salesService.getDailySalesReportAggregates.mock.calls[0][0].match;
      expect(reportMatch.$and).toContainEqual(
        require('../../../src/helpers/reportable-sales').reportableSales()
      );
      expect(reportMatch.$and).toContainEqual({ $or: [{ versement_checkout: { $exists: false } }, { versement_settled: true }] });
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ type: 'success' }));
    });

    test('includes item cost, cash-book outflows and RH salary payments in the closing report payload', async () => {
      const dbCollections = {
        credit_payments: { aggregate: jest.fn(() => ({ toArray: async () => [] })) },
        expenses: { aggregate: jest.fn(() => ({ toArray: async () => [{ total: 1250, count: 2 }] })) },
        hr_transactions: { aggregate: jest.fn(() => ({ toArray: async () => [
          { _id: { worker_name: 'Samir', method: 'cash' }, amount: 4000, count: 1 },
          { _id: { worker_name: 'Nadia', method: 'bank' }, amount: 2500, count: 1 },
        ] })) },
      };
      const db = {
        collection: jest.fn((name) => Object.assign(emptyCollection(), dbCollections[name] || {})),
      };
      const dbSpy = jest.spyOn(BaseModel, 'getDb').mockResolvedValue(db);
      salesService.getDailySalesReportAggregates.mockResolvedValue({
        productAgg: [{ subtotal: 1000, totalAmount: 1000, totalQty: 2, totalCompanyPrice: 400 }],
        paymentAgg: [],
        // The controller derives gross profit from the actual sale-payment rows,
        // not productAgg.totalAmount. Keep the sales fixture consistent with the
        // product aggregate so this test exercises a 1,000 sale less 400 COGS.
        salesPayments: [{ sales_total: 1000, total: 1000, items: [] }],
        taxAgg: [], cancellationAgg: [],
      });
      try {
        const res = mockRes();
        await ctrl.dailySalesReports(mockReq({ query: q }), res);
        const data = res.json.mock.calls[0][0].data;
        expect(data.cost_of_goods_total).toBe(400);
        expect(data.gross_profit_total).toBe(600);
        expect(data.product_details[0].product_cost).toBe(400);
        expect(data.expenses_total).toBe(1250);
        expect(data.salary_payments_total).toBe(6500);
        expect(data.salary_payment_details).toEqual([
          { worker_name: 'Samir', method: 'cash', notes: '', amount: 4000, count: 1 },
          { worker_name: 'Nadia', method: 'bank', notes: '', amount: 2500, count: 1 },
        ]);
        expect(dbCollections.hr_transactions.aggregate).toHaveBeenCalled();
      } finally {
        dbSpy.mockRestore();
      }
    });

    test('recognizes a settled F6 sale as revenue but never double-counts it as a normal tender', async () => {
      salesService.getDailySalesReportAggregates.mockResolvedValue({
        productAgg: [{ subtotal: 200, totalAmount: 200, totalQty: 2, totalCompanyPrice: 80 }],
        paymentAgg: [],
        salesPayments: [
          { sales_total: 100, total: 100, payment_mode: 'cash', payment_status: 'Paid', multi_payment: {} },
          { sales_total: 100, total: 100, payment_mode: 'cash', payment_status: 'Paid', multi_payment: {},
            versement_checkout: { initial_amount: 30 }, versement_settled: true },
        ],
        taxAgg: [], cancellationAgg: [],
      });
      const res = mockRes();
      await ctrl.dailySalesReports(mockReq({ query: q }), res);
      const data = res.json.mock.calls[0][0].data;
      expect(data.sales_total).toBe(200);
      expect(data.payment_details.reduce((sum, row) => sum + Number(row.sale_payment || 0), 0)).toBe(100);
    });

    test('posts the complete F6 invoice only on its final settlement day', async () => {
      sessionFilterUtil.applySessionFilter.mockImplementation(async (_req, range) => range);
      const settlementDate = new Date('2025-11-07T10:00:00.000Z');
      const settledVersement = {
        status: 'settled',
        sale_total: 6000,
        initial_amount: 1000,
        initial_recorded_amount: 1000,
        initial_method: 'cash',
        settlement: { amount: 5000, method: 'cash', settled_at: settlementDate },
        settled_at: settlementDate,
      };
      const dbCollections = {
        sale_versements: { find: jest.fn(() => ({
          toArray: async () => [settledVersement],
          project() { return this; },
        })) },
      };
      const db = {
        collection: jest.fn((name) => Object.assign(emptyCollection(), dbCollections[name] || {})),
      };
      BaseModel.getDb.mockResolvedValue(db);
      const settledSale = {
        sales_total: 6000, total: 6000, date: settlementDate,
        payment_mode: 'versement', payment_status: 'Paid',
        versement_checkout: { initial_amount: 1000 }, versement_settled: true,
        items: [],
      };
      salesService.getDailySalesReportAggregates
        .mockResolvedValueOnce({ productAgg: [], paymentAgg: [], salesPayments: [], taxAgg: [], cancellationAgg: [] })
        .mockResolvedValueOnce({ productAgg: [], paymentAgg: [], salesPayments: [settledSale], taxAgg: [], cancellationAgg: [] });

      const depositDay = mockRes();
      await ctrl.dailySalesReports(mockReq({ query: {
        ...q, starting_date: '2025-11-05', ending_date: '2025-11-05',
      } }), depositDay);
      expect(depositDay.json.mock.calls[0][0].data.versement_payment_total).toBe(0);
      expect(depositDay.json.mock.calls[0][0].data.versement_settlement_cash_total).toBe(0);

      const settlementDay = mockRes();
      await ctrl.dailySalesReports(mockReq({ query: {
        ...q, starting_date: '2025-11-07', ending_date: '2025-11-07',
      } }), settlementDay);
      const data = settlementDay.json.mock.calls[0][0].data;
      expect(data.sales_total).toBe(6000);
      expect(data.versement_payment_total).toBe(6000);
      expect(data.versement_settlement_cash_total).toBe(6000);
      expect(data.versement_payment_details).toEqual([
        expect.objectContaining({ payment_mode: 'CASH', amount: 6000 }),
      ]);
    });

    test('counts partial-sale cash on sale day and customer-credit collection only on receipt day', async () => {
      sessionFilterUtil.applySessionFilter.mockImplementation(async (_req, range) => range);
      const saleDate = new Date('2025-11-10T10:00:00.000Z');
      const dbCollections = {
        credit_payments: {
          aggregate: jest.fn()
            .mockReturnValueOnce({ toArray: async () => [] })
            .mockReturnValueOnce({ toArray: async () => [
              { _id: 'cash', amount: 3000, count: 1, invalidAmountCount: 0 },
            ] }),
        },
      };
      const db = {
        collection: jest.fn((name) => Object.assign(emptyCollection(), dbCollections[name] || {})),
      };
      BaseModel.getDb.mockResolvedValue(db);

      const partialSale = {
        sales_total: 5000,
        total: 5000,
        date: saleDate,
        payment_mode: 'cash',
        payment_status: 'Partial',
        paid_amount: 2000,
        payment_pending: 3000,
        payments: [
          { method: 'cash', amount: 2000, date: saleDate },
          { method: 'credit', amount: 3000, date: saleDate },
        ],
        items: [],
      };
      salesService.getDailySalesReportAggregates
        .mockResolvedValueOnce({ productAgg: [], paymentAgg: [], salesPayments: [partialSale], taxAgg: [], cancellationAgg: [] })
        .mockResolvedValueOnce({ productAgg: [], paymentAgg: [], salesPayments: [], taxAgg: [], cancellationAgg: [] });

      const saleDay = mockRes();
      await ctrl.dailySalesReports(mockReq({ query: {
        ...q, starting_date: '2025-11-10', ending_date: '2025-11-10',
      } }), saleDay);
      const saleData = saleDay.json.mock.calls[0][0].data;
      expect(saleData.sales_total).toBe(5000);
      expect(saleData.sales_cash_total).toBe(2000);
      expect(saleData.payment_details).toEqual([
        expect.objectContaining({ payment_mode: 'CASH', sale_payment: 2000 }),
      ]);
      expect(saleData.debt_payment_total).toBe(0);

      const collectionDay = mockRes();
      await ctrl.dailySalesReports(mockReq({ query: {
        ...q, starting_date: '2025-11-12', ending_date: '2025-11-12',
      } }), collectionDay);
      const collectionData = collectionDay.json.mock.calls[0][0].data;
      expect(collectionData.sales_total).toBe(0);
      expect(collectionData.sales_cash_total).toBe(0);
      expect(collectionData.debt_payment_total).toBe(3000);
      expect(collectionData.credit_cash_collections_total).toBe(3000);
    });

    test('403 no report permission', async () => {
      const res = mockRes();
      await ctrl.dailySalesReports(mockReq({ query: q, user: restrictedUser() }), res);
      expect(res.status).toHaveBeenCalledWith(403);
    });

    test('404 branch not found', async () => {
      salesService.getBranchById.mockResolvedValue(null);
      const res = mockRes();
      await ctrl.dailySalesReports(mockReq({ query: q }), res);
      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ message: ERROR_MESSAGES.BRANCH_NOT_FOUND })
      );
    });

    test('400 invalid dates', async () => {
      salesHelper.parseSaleDate.mockReturnValue(null);
      const res = mockRes();
      await ctrl.dailySalesReports(mockReq({ query: { ...q, starting_date: 'bad' } }), res);
      expect(res.status).toHaveBeenCalledWith(400);
    });

    test('uses the same meal window for totals and cancellations', async () => {
      salesService.getBranchById.mockResolvedValue({
        time_zone: 'Asia/Kolkata',
        table_options: 'enable',
      });
      sessionFilterUtil.applySessionFilter.mockImplementation(async (_req, range) => range);
      const res = mockRes();
      await ctrl.dailySalesReports(
        mockReq({
          query: {
            ...q,
            starting_date: '2026-10-01',
            ending_date: '2026-10-01',
            start_time: '12:00',
            end_time: '18:00',
          },
        }),
        res
      );
      expect(res.status).toHaveBeenCalledWith(200);
      const { match, cancellationMatch } =
        salesService.getDailySalesReportAggregates.mock.calls[0][0];
      expect(match.$and[1]).toEqual(cancellationMatch.$and[0]);
      expect(match.$and[1].$or[0].date).toEqual({
        $gte: new Date('2026-10-01T06:30:00Z'),
        $lt: new Date('2026-10-01T12:30:00Z'),
      });
      expect(res.json.mock.calls[0][0].data.branch_details.period_label).toContain('Custom time');
    });

    test('retail branches reject time and meal filters', async () => {
      salesService.getBranchById.mockResolvedValue({ table_options: 'disable' });
      const res = mockRes();
      await ctrl.dailySalesReports(mockReq({ query: { ...q, serving_period: 'lunch' } }), res);
      expect(res.status).toHaveBeenCalledWith(400);
      expect(salesService.getDailySalesReportAggregates).not.toHaveBeenCalled();
    });
    test('reads configured session hours on the server', async () => {
      salesService.getBranchById.mockResolvedValue({
        table_options: 'enable',
        time_zone: 'Asia/Kolkata',
      });
      salesService.getReportServingPeriods.mockResolvedValue([
        { id: 'brunch', name: 'Brunch', hours: { thu: [{ open: 630, close: 810 }] } },
      ]);
      sessionFilterUtil.applySessionFilter.mockImplementation(async (_req, range) => range);
      const res = mockRes();
      await ctrl.dailySalesReports(
        mockReq({
          query: {
            ...q,
            starting_date: '2026-10-01',
            ending_date: '2026-10-01',
            serving_period: 'brunch',
          },
        }),
        res
      );
      expect(res.status).toHaveBeenCalledWith(200);
      const { match } = salesService.getDailySalesReportAggregates.mock.calls[0][0];
      expect(match.$and[1].$or[0].date).toEqual({
        $gte: new Date('2026-10-01T05:00:00Z'),
        $lt: new Date('2026-10-01T08:00:00Z'),
      });
      expect(res.json.mock.calls[0][0].data.branch_details.restaurant_enabled).toBe(true);
    });

    test('applies sessionFilterUtil', async () => {
      const res = mockRes();
      await ctrl.dailySalesReports(mockReq({ query: q }), res);
      expect(sessionFilterUtil.applySessionFilter).toHaveBeenCalled();
    });
  });

  // ── dailyReportPdf ────────────────────────────────────────────────────────────
  describe('dailyReportPdf', () => {
    const q = { branch: VALID_BRANCH, starting_date: '2025-01-01', ending_date: '2025-12-31' };

    test('403 no report permission', async () => {
      const res = mockRes();
      await ctrl.dailyReportPdf(mockReq({ query: q, user: restrictedUser() }), res);
      expect(res.status).toHaveBeenCalledWith(403);
    });

    test('400 invalid dates', async () => {
      salesHelper.parseSaleDate.mockReturnValue(null);
      const res = mockRes();
      await ctrl.dailyReportPdf(mockReq({ query: { ...q, starting_date: 'bad' } }), res);
      expect(res.status).toHaveBeenCalledWith(400);
    });

    test('404 branch not found', async () => {
      salesService.getBranchById.mockResolvedValue(null);
      const res = mockRes();
      await ctrl.dailyReportPdf(mockReq({ query: q }), res);
      expect(res.status).toHaveBeenCalledWith(404);
    });

    test('sets Content-Type header on success', async () => {
      const res = mockRes();
      await ctrl.dailyReportPdf(mockReq({ query: q }), res);
      const reportMatch = salesService.getDailyReportPdfAggregates.mock.calls[0][0].match;
      expect(reportMatch.$and).toContainEqual(
        require('../../../src/helpers/reportable-sales').reportableSales()
      );
      expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'application/pdf');
    });
  });

  // ── returnProductDetails ──────────────────────────────────────────────────────
  describe('returnProductDetails', () => {
    test('200 success', async () => {
      const res = mockRes();
      await ctrl.returnProductDetails(mockReq({ query: { branch: VALID_BRANCH } }), res);
      expect(res.status).toHaveBeenCalledWith(200);
    });

    test('403 no report.read permission', async () => {
      const res = mockRes();
      await ctrl.returnProductDetails(mockReq({ query: {}, user: restrictedUser() }), res);
      expect(res.status).toHaveBeenCalledWith(403);
    });

    test('404 when service status false', async () => {
      salesService.returnProductReportPage.mockResolvedValue({ status: false });
      const res = mockRes();
      await ctrl.returnProductDetails(mockReq({ query: {} }), res);
      expect(res.status).toHaveBeenCalledWith(404);
    });
  });

  // ── returnProductView ─────────────────────────────────────────────────────────
  describe('returnProductView', () => {
    test('200 success', async () => {
      const res = mockRes();
      await ctrl.returnProductView(mockReq({ query: { id: VALID_ID } }), res);
      expect(res.status).toHaveBeenCalledWith(200);
    });

    test('403 no permission', async () => {
      const res = mockRes();
      await ctrl.returnProductView(
        mockReq({ query: { id: VALID_ID }, user: restrictedUser() }),
        res
      );
      expect(res.status).toHaveBeenCalledWith(403);
    });

    test('400 missing id', async () => {
      const res = mockRes();
      await ctrl.returnProductView(mockReq({ query: {} }), res);
      expect(res.status).toHaveBeenCalledWith(400);
    });

    test('404 when service status false', async () => {
      salesService.returnProductViewPage.mockResolvedValue({
        status: false,
        message: 'Not found',
        data: null,
      });
      const res = mockRes();
      await ctrl.returnProductView(mockReq({ query: { id: VALID_ID } }), res);
      expect(res.status).toHaveBeenCalledWith(404);
    });
  });

  // ── salesGraphicalReports ─────────────────────────────────────────────────────
  describe('salesGraphicalReports', () => {
    test('200 success with valid branch', async () => {
      const res = mockRes();
      await ctrl.salesGraphicalReports(
        mockReq({
          query: { branch: VALID_BRANCH, starting_date: '2025-01-01', ending_date: '2025-12-31' },
        }),
        res
      );
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ type: 'success' }));
    });

    test('403 no report permission', async () => {
      const res = mockRes();
      await ctrl.salesGraphicalReports(mockReq({ query: {}, user: restrictedUser() }), res);
      expect(res.status).toHaveBeenCalledWith(403);
    });

    test('400 when no branch provided', async () => {
      salesHelper.resolveBranchId.mockReturnValue(null);
      const res = mockRes();
      await ctrl.salesGraphicalReports(mockReq({ query: {} }), res);
      expect(res.status).toHaveBeenCalledWith(400);
    });

    test('400 when branch ID is invalid', async () => {
      const res = mockRes();
      await ctrl.salesGraphicalReports(mockReq({ query: { branch: 'bad-id' } }), res);
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ message: ERROR_MESSAGES.NO_VALID_BRANCH_IDS_PROVIDED })
      );
    });
  });

  // ── salesSummaryReports ───────────────────────────────────────────────────────
  describe('salesSummaryReports', () => {
    const bCtx = { uniqueBranchIds: [VALID_BRANCH], validBranchIds: [VALID_BRANCH] };

    test('200 success with pre-parsed context', async () => {
      const res = mockRes();
      await ctrl.salesSummaryReports(
        mockReq({
          query: { starting_date: '2025-01-01', ending_date: '2025-12-31' },
          salesSummaryBranchContext: bCtx,
        }),
        res
      );
      expect(res.status).toHaveBeenCalledWith(200);
    });

    test('403 no permission', async () => {
      const res = mockRes();
      await ctrl.salesSummaryReports(mockReq({ query: {}, user: restrictedUser() }), res);
      expect(res.status).toHaveBeenCalledWith(403);
    });

    test('400 no branch IDs when parseBranchIdsFromRequest returns empty', async () => {
      const res = mockRes();
      await ctrl.salesSummaryReports(mockReq({ query: {} }), res);
      expect(res.status).toHaveBeenCalledWith(400);
    });
  });

  // ── salesReports ──────────────────────────────────────────────────────────────
  describe('salesReports', () => {
    test('200 success with pre-parsed filters', async () => {
      const filters = {
        branchObjectIds: [VALID_BRANCH],
        startDate: new Date('2025-01-01'),
        endDate: new Date('2025-12-31'),
      };
      const res = mockRes();
      await ctrl.salesReports(mockReq({ query: {}, salesReportsFilters: filters }), res);
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ type: 'success' }));
      const historyMatch = salesService.getSalesReportsData.mock.calls[0][0].match;
      expect(historyMatch.$and).toContainEqual({ $or: [{ versement_checkout: { $exists: false } }, { versement_settled: true }] });
    });

    test('403 no permission', async () => {
      const res = mockRes();
      await ctrl.salesReports(mockReq({ query: {}, user: restrictedUser() }), res);
      expect(res.status).toHaveBeenCalledWith(403);
    });

    test('400 no branch in query', async () => {
      const res = mockRes();
      await ctrl.salesReports(
        mockReq({ query: { starting_date: '2025-01-01', ending_date: '2025-12-31' } }),
        res
      );
      expect(res.status).toHaveBeenCalledWith(400);
    });

    test('400 no date range in query', async () => {
      const res = mockRes();
      await ctrl.salesReports(mockReq({ query: { branch: VALID_BRANCH } }), res);
      expect(res.status).toHaveBeenCalledWith(400);
    });

    test('500 on service exception', async () => {
      const filters = {
        branchObjectIds: [VALID_BRANCH],
        startDate: new Date('2025-01-01'),
        endDate: new Date('2025-12-31'),
      };
      salesService.getSalesReportsData.mockRejectedValue(new Error('DB crash'));
      const res = mockRes();
      await ctrl.salesReports(mockReq({ query: {}, salesReportsFilters: filters }), res);
      expect(res.status).toHaveBeenCalledWith(500);
    });
  });

  // ── instantSalesReports ───────────────────────────────────────────────────────
  describe('instantSalesReports', () => {
    test('200 success', async () => {
      const res = mockRes();
      await ctrl.instantSalesReports(mockReq({ query: { branch: VALID_BRANCH } }), res);
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ type: 'success' }));
    });

    test('403 no permission', async () => {
      const res = mockRes();
      await ctrl.instantSalesReports(mockReq({ query: {}, user: restrictedUser() }), res);
      expect(res.status).toHaveBeenCalledWith(403);
    });

    test('400 no valid branch', async () => {
      salesHelper.resolveBranchId.mockReturnValue(null);
      const res = mockRes();
      await ctrl.instantSalesReports(mockReq({ query: {} }), res);
      expect(res.status).toHaveBeenCalledWith(400);
    });
  });

  // ── instantSaleDetails ────────────────────────────────────────────────────────
  describe('instantSaleDetails', () => {
    test('200 success', async () => {
      salesHelper.calculateInstantMetrics.mockReturnValue({
        instantItems: [{ _id: VALID_ID, total: 100, item_quantity: 1, item_name: 'Item' }],
      });
      const res = mockRes();
      await ctrl.instantSaleDetails(
        mockReq({ query: { instant_id: VALID_ID, branch: VALID_BRANCH } }),
        res
      );
      expect(res.status).toHaveBeenCalledWith(200);
    });

    test('403 no permission', async () => {
      const res = mockRes();
      await ctrl.instantSaleDetails(mockReq({ query: {}, user: restrictedUser() }), res);
      expect(res.status).toHaveBeenCalledWith(403);
    });

    test('404 sale not found', async () => {
      salesService.getSaleById.mockResolvedValue(null);
      const res = mockRes();
      await ctrl.instantSaleDetails(
        mockReq({ query: { instant_id: VALID_ID, branch: VALID_BRANCH } }),
        res
      );
      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ message: ERROR_MESSAGES.SALE_NOT_FOUND })
      );
    });

    test('400 no valid branch', async () => {
      salesHelper.resolveBranchId.mockReturnValue(null);
      const res = mockRes();
      await ctrl.instantSaleDetails(mockReq({ query: { instant_id: VALID_ID } }), res);
      expect(res.status).toHaveBeenCalledWith(400);
    });
  });

  // ── holdSale ──────────────────────────────────────────────────────────────────
  describe('holdSale', () => {
    const body = { customer_name: 'Walk-in', items: [{ item_id: VALID_ID, item_quantity: 1 }] };

    test('200 success with hold message', async () => {
      const res = mockRes();
      const next = mockNext();
      await ctrl.holdSale(mockReq({ body }), res, next);
      expect(salesService.processSale).toHaveBeenCalledWith(
        expect.anything(),
        '',
        'Hold',
        expect.any(Object)
      );
      expect(res.status).toHaveBeenCalledWith(200);
    });

    test('403 no write permission', async () => {
      const res = mockRes();
      const next = mockNext();
      await ctrl.holdSale(mockReq({ body, user: restrictedUser() }), res, next);
      expect(res.status).toHaveBeenCalledWith(403);
    });

    test('400 missing customer_name', async () => {
      const res = mockRes();
      const next = mockNext();
      await ctrl.holdSale(mockReq({ body: { items: [{ item_id: VALID_ID }] } }), res, next);
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ message: ERROR_MESSAGES.CUSTOMER_NAME_REQUIRED })
      );
    });

    test('400 empty items array', async () => {
      const res = mockRes();
      const next = mockNext();
      await ctrl.holdSale(mockReq({ body: { customer_name: 'Test', items: [] } }), res, next);
      expect(res.status).toHaveBeenCalledWith(400);
    });
  });

  // ── userReportTable ───────────────────────────────────────────────────────────
  describe('userReportTable', () => {
    test('200 success with data', async () => {
      const res = mockRes();
      await ctrl.userReportTable(
        mockReq({
          query: { branch: VALID_BRANCH, starting_date: '2025-01-01', ending_date: '2025-12-31' },
        }),
        res
      );
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ type: 'success' }));
    });

    test('403 no permission', async () => {
      const res = mockRes();
      await ctrl.userReportTable(mockReq({ query: {}, user: restrictedUser() }), res);
      expect(res.status).toHaveBeenCalledWith(403);
    });

    test('200 with empty list on service status false', async () => {
      salesService.userReportPage.mockResolvedValue({ status: false });
      const res = mockRes();
      await ctrl.userReportTable(mockReq({ query: {} }), res);
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json.mock.calls[0][0].data.list).toEqual([]);
    });
  });

  // ── userGraphicalReports ──────────────────────────────────────────────────────
  describe('userGraphicalReports', () => {
    test('200 success', async () => {
      const res = mockRes();
      await ctrl.userGraphicalReports(mockReq({ query: { branch: VALID_BRANCH } }), res);
      expect(res.status).toHaveBeenCalledWith(200);
    });

    test('403 no permission', async () => {
      const res = mockRes();
      await ctrl.userGraphicalReports(mockReq({ query: {}, user: restrictedUser() }), res);
      expect(res.status).toHaveBeenCalledWith(403);
    });

    test('404 when service status false', async () => {
      salesService.getUserGraphicalReports.mockResolvedValue({
        status: false,
        message: 'Not found',
        data: null,
      });
      const res = mockRes();
      await ctrl.userGraphicalReports(mockReq({ query: {} }), res);
      expect(res.status).toHaveBeenCalledWith(404);
    });
  });

  // ── returnSalesReportTable ────────────────────────────────────────────────────
  describe('returnSalesReportTable', () => {
    test('200 success', async () => {
      const res = mockRes();
      await ctrl.returnSalesReportTable(mockReq({ query: { branch: VALID_BRANCH } }), res);
      expect(res.status).toHaveBeenCalledWith(200);
    });

    test('403 no permission', async () => {
      const res = mockRes();
      await ctrl.returnSalesReportTable(mockReq({ query: {}, user: restrictedUser() }), res);
      expect(res.status).toHaveBeenCalledWith(403);
    });

    test('500 on service exception', async () => {
      salesService.returnSalesReportPage.mockRejectedValue(new Error('crash'));
      const res = mockRes();
      await ctrl.returnSalesReportTable(mockReq({ query: {} }), res);
      expect(res.status).toHaveBeenCalledWith(500);
    });
  });

  // ── productBasedReturnDetails ─────────────────────────────────────────────────
  describe('productBasedReturnDetails', () => {
    test('200 success', async () => {
      const res = mockRes();
      await ctrl.productBasedReturnDetails(mockReq({ query: {} }), res);
      expect(res.status).toHaveBeenCalledWith(200);
    });

    test('403 no permission', async () => {
      const res = mockRes();
      await ctrl.productBasedReturnDetails(mockReq({ query: {}, user: restrictedUser() }), res);
      expect(res.status).toHaveBeenCalledWith(403);
    });

    test('404 when service status false', async () => {
      salesService.productBasedReportPage.mockResolvedValue({ status: false });
      const res = mockRes();
      await ctrl.productBasedReturnDetails(mockReq({ query: {} }), res);
      expect(res.status).toHaveBeenCalledWith(404);
    });
  });

  // ── pendingSalesReportTable ───────────────────────────────────────────────────
  describe('pendingSalesReportTable', () => {
    test('200 success', async () => {
      const res = mockRes();
      await ctrl.pendingSalesReportTable(mockReq({ query: { branch: VALID_BRANCH } }), res);
      expect(res.status).toHaveBeenCalledWith(200);
    });

    test('403 no permission', async () => {
      const res = mockRes();
      await ctrl.pendingSalesReportTable(mockReq({ query: {}, user: restrictedUser() }), res);
      expect(res.status).toHaveBeenCalledWith(403);
    });
  });

  // ── pendingCustomerReportTable ────────────────────────────────────────────────
  describe('pendingCustomerReportTable', () => {
    test('200 success', async () => {
      const res = mockRes();
      await ctrl.pendingCustomerReportTable(mockReq({ query: {} }), res);
      expect(res.status).toHaveBeenCalledWith(200);
    });

    test('403 no permission', async () => {
      const res = mockRes();
      await ctrl.pendingCustomerReportTable(mockReq({ query: {}, user: restrictedUser() }), res);
      expect(res.status).toHaveBeenCalledWith(403);
    });
  });

  // ── taxSalesReports ───────────────────────────────────────────────────────────
  describe('taxSalesReports', () => {
    test('200 success', async () => {
      const res = mockRes();
      await ctrl.taxSalesReports(mockReq({ query: {} }), res);
      expect(res.status).toHaveBeenCalledWith(200);
    });

    test('403 no permission', async () => {
      const res = mockRes();
      await ctrl.taxSalesReports(mockReq({ query: {}, user: restrictedUser() }), res);
      expect(res.status).toHaveBeenCalledWith(403);
    });

    test('404 when service status false', async () => {
      salesService.taxSalesReportPage.mockResolvedValue({
        status: false,
        message: 'not found',
        data: null,
      });
      const res = mockRes();
      await ctrl.taxSalesReports(mockReq({ query: {} }), res);
      expect(res.status).toHaveBeenCalledWith(404);
    });
  });

  // ── paymentSalesTranscationReportTable ────────────────────────────────────────
  describe('paymentSalesTranscationReportTable', () => {
    test('200 success', async () => {
      const res = mockRes();
      await ctrl.paymentSalesTranscationReportTable(mockReq({ query: {} }), res);
      expect(res.status).toHaveBeenCalledWith(200);
    });

    test('403 no permission', async () => {
      const res = mockRes();
      await ctrl.paymentSalesTranscationReportTable(
        mockReq({ query: {}, user: restrictedUser() }),
        res
      );
      expect(res.status).toHaveBeenCalledWith(403);
    });
  });

  // ── paymentSaleTypeReport ─────────────────────────────────────────────────────
  describe('paymentSaleTypeReport', () => {
    test('200 success', async () => {
      const res = mockRes();
      await ctrl.paymentSaleTypeReport(mockReq({ query: {} }), res);
      expect(res.status).toHaveBeenCalledWith(200);
    });

    test('403 no permission', async () => {
      const res = mockRes();
      await ctrl.paymentSaleTypeReport(mockReq({ query: {}, user: restrictedUser() }), res);
      expect(res.status).toHaveBeenCalledWith(403);
    });
  });

  // ── paymentGraphicalReports ───────────────────────────────────────────────────
  describe('paymentGraphicalReports', () => {
    test('200 success', async () => {
      const res = mockRes();
      await ctrl.paymentGraphicalReports(mockReq({ query: {} }), res);
      expect(res.status).toHaveBeenCalledWith(200);
    });

    test('403 no permission', async () => {
      const res = mockRes();
      await ctrl.paymentGraphicalReports(mockReq({ query: {}, user: restrictedUser() }), res);
      expect(res.status).toHaveBeenCalledWith(403);
    });

    test('404 when service status false', async () => {
      salesService.getPaymentGraphicalReports.mockResolvedValue({
        status: false,
        message: 'err',
        data: null,
      });
      const res = mockRes();
      await ctrl.paymentGraphicalReports(mockReq({ query: {} }), res);
      expect(res.status).toHaveBeenCalledWith(404);
    });
  });

  // ── returnSales ───────────────────────────────────────────────────────────────
  describe('returnSales', () => {
    test('200 success', async () => {
      const res = mockRes();
      await ctrl.returnSales(mockReq({ body: { sale_id: VALID_ID, return_items: [] } }), res);
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ message: SUCCESS_MESSAGES.RETURN_SALES_UPDATED_SUCCESSFULLY })
      );
    });

    test('403 no sales.write access', async () => {
      const res = mockRes();
      await ctrl.returnSales(mockReq({ body: {}, user: restrictedUser() }), res);
      expect(res.status).toHaveBeenCalledWith(403);
    });

    test('404 when service status false', async () => {
      salesService.returnSalesOrder.mockResolvedValue({ status: false, message: 'Return failed' });
      const res = mockRes();
      await ctrl.returnSales(mockReq({ body: {} }), res);
      expect(res.status).toHaveBeenCalledWith(404);
    });

    test('500 on exception', async () => {
      salesService.returnSalesOrder.mockRejectedValue(new Error('crash'));
      const res = mockRes();
      await ctrl.returnSales(mockReq({ body: {} }), res);
      expect(res.status).toHaveBeenCalledWith(500);
    });
  });

  // ── exportSales ───────────────────────────────────────────────────────────────
  describe('exportSales', () => {
    test('200 success', async () => {
      const res = mockRes();
      await ctrl.exportSales(mockReq({ method: 'POST', body: [VALID_ID] }), res);
      expect(res.status).toHaveBeenCalledWith(200);
    });

    test('403 no sales.read access', async () => {
      const res = mockRes();
      await ctrl.exportSales(
        mockReq({ method: 'POST', body: [VALID_ID], user: restrictedUser() }),
        res
      );
      expect(res.status).toHaveBeenCalledWith(403);
    });

    test('400 no IDs provided', async () => {
      const res = mockRes();
      await ctrl.exportSales(mockReq({ method: 'POST', body: [] }), res);
      expect(res.status).toHaveBeenCalledWith(400);
    });

    test('404 when service status false', async () => {
      salesService.exportSalesOrder.mockResolvedValue({ status: false });
      const res = mockRes();
      await ctrl.exportSales(mockReq({ method: 'POST', body: [VALID_ID] }), res);
      expect(res.status).toHaveBeenCalledWith(404);
    });
  });

  // ── getDataChanges ────────────────────────────────────────────────────────────
  describe('getDataChanges', () => {
    test('200 success type=success', async () => {
      const res = mockRes();
      await ctrl.getDataChanges(mockReq({ query: { from: '2025-01-01' } }), res);
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'success', message: SUCCESS_MESSAGES.CHANGES_RETRIEVED })
      );
    });

    test('200 with type=error when service status false', async () => {
      salesService.getSalesDataChanges.mockResolvedValue({ status: false, data: null });
      const res = mockRes();
      await ctrl.getDataChanges(mockReq({ query: {} }), res);
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json.mock.calls[0][0].type).toBe('error');
    });

    test('500 on exception', async () => {
      salesService.getSalesDataChanges.mockRejectedValue(new Error('crash'));
      const res = mockRes();
      await ctrl.getDataChanges(mockReq({ query: {} }), res);
      expect(res.status).toHaveBeenCalledWith(500);
    });
  });

  // ── getReturnSalesDetails ─────────────────────────────────────────────────────
  describe('getReturnSalesDetails', () => {
    test('200 success', async () => {
      const res = mockRes();
      await ctrl.getReturnSalesDetails(mockReq({ query: { id: VALID_ID } }), res);
      expect(res.status).toHaveBeenCalledWith(200);
    });

    test('403 no sales.read access', async () => {
      const res = mockRes();
      await ctrl.getReturnSalesDetails(
        mockReq({ query: { id: VALID_ID }, user: restrictedUser() }),
        res
      );
      expect(res.status).toHaveBeenCalledWith(403);
    });

    test('404 when service status false', async () => {
      salesService.getReturnSalesDetails.mockResolvedValue({ status: false, message: 'Not found' });
      const res = mockRes();
      await ctrl.getReturnSalesDetails(mockReq({ query: { id: VALID_ID } }), res);
      expect(res.status).toHaveBeenCalledWith(404);
    });
  });

  // ── salesReceipt ──────────────────────────────────────────────────────────────
  describe('salesReceipt', () => {
    test('200 success', async () => {
      const res = mockRes();
      await ctrl.salesReceipt(
        mockReq({ body: { email: 'test@email.com', sale_id: VALID_ID } }),
        res
      );
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ type: 'success' }));
    });

    test('400 invalid email', async () => {
      const res = mockRes();
      await ctrl.salesReceipt(mockReq({ body: { email: 'not-valid', sale_id: VALID_ID } }), res);
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ message: ERROR_MESSAGES.VALID_EMAIL_REQUIRED })
      );
    });

    test('400 no sale_id', async () => {
      const res = mockRes();
      await ctrl.salesReceipt(mockReq({ body: { email: 'test@email.com' } }), res);
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ message: ERROR_MESSAGES.SALE_ID_REQUIRED })
      );
    });

    test('404 sale not found', async () => {
      salesService.getSaleForReceipt.mockResolvedValue(null);
      const res = mockRes();
      await ctrl.salesReceipt(
        mockReq({ body: { email: 'test@email.com', sale_id: VALID_ID } }),
        res
      );
      expect(res.status).toHaveBeenCalledWith(404);
    });
  });

  // ── getCustomerPrint ──────────────────────────────────────────────────────────
  describe('getCustomerPrint', () => {
    test('200 success', async () => {
      const res = mockRes();
      await ctrl.getCustomerPrint(mockReq({ query: { id: VALID_ID } }), res);
      expect(res.status).toHaveBeenCalledWith(200);
    });

    test('400 no sale id', async () => {
      const res = mockRes();
      await ctrl.getCustomerPrint(mockReq({ query: {} }), res);
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ message: ERROR_MESSAGES.SALES_ID_REQUIRED })
      );
    });

    test('404 sale not found', async () => {
      salesService.getSaleForCustomerPrint.mockResolvedValue(null);
      const res = mockRes();
      await ctrl.getCustomerPrint(mockReq({ query: { id: VALID_ID } }), res);
      expect(res.status).toHaveBeenCalledWith(404);
    });
  });

  // ── salesPdf ──────────────────────────────────────────────────────────────────
  describe('salesPdf', () => {
    test('403 no sales.read permission', async () => {
      const res = mockRes();
      await ctrl.salesPdf(mockReq({ query: { id: VALID_ID }, user: restrictedUser() }), res);
      expect(res.status).toHaveBeenCalledWith(403);
    });

    test('400 missing id', async () => {
      const res = mockRes();
      await ctrl.salesPdf(mockReq({ query: {} }), res);
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ message: ERROR_MESSAGES.SALE_ID_IS_REQUIRED })
      );
    });

    test('404 sale not found', async () => {
      salesService.getSaleForPdf.mockResolvedValue(null);
      const res = mockRes();
      await ctrl.salesPdf(mockReq({ query: { id: VALID_ID } }), res);
      expect(res.status).toHaveBeenCalledWith(404);
    });

    test('calls generateInvoicePDF on success', async () => {
      const { generateInvoicePDF } = require('../../../src/utils/pdfGenerator');
      const res = mockRes();
      await ctrl.salesPdf(mockReq({ query: { id: VALID_ID } }), res);
      expect(generateInvoicePDF).toHaveBeenCalled();
    });
  });

  // ── cancel ────────────────────────────────────────────────────────────────────
  describe('cancel', () => {
    test('200 sale cancelled successfully', async () => {
      const res = mockRes();
      await ctrl.cancel(mockReq({ params: { id: VALID_ID } }), res);
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ type: 'success' }));
    });

    test('403 no delete permission', async () => {
      const res = mockRes();
      await ctrl.cancel(mockReq({ params: { id: VALID_ID }, user: restrictedUser() }), res);
      expect(res.status).toHaveBeenCalledWith(403);
    });

    test('404 sale not found', async () => {
      salesService.getSaleById.mockResolvedValue(null);
      const res = mockRes();
      await ctrl.cancel(mockReq({ params: { id: VALID_ID } }), res);
      expect(res.status).toHaveBeenCalledWith(404);
    });

    test('400 sale already cancelled', async () => {
      salesService.getSaleById.mockResolvedValue({
        _id: VALID_ID,
        status: SALE_STATUS.CANCELLED,
        items: [],
      });
      const res = mockRes();
      await ctrl.cancel(mockReq({ params: { id: VALID_ID } }), res);
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'Sale is already cancelled' })
      );
    });
  });

  // ── getTablesWithActiveOrders ─────────────────────────────────────────────────
  describe('getTablesWithActiveOrders', () => {
    test('200 success', async () => {
      const res = mockRes();
      await ctrl.getTablesWithActiveOrders(mockReq({ query: {} }), res);
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ type: 'success' }));
    });

    test('400 when no branch context', async () => {
      salesHelper.resolveBranchId.mockReturnValue(null);
      const user = adminUser({ branch_id: null, branch: null });
      const res = mockRes();
      await ctrl.getTablesWithActiveOrders(mockReq({ query: {}, user }), res);
      expect(res.status).toHaveBeenCalledWith(400);
    });

    test('403 when user has no sales.read permission', async () => {
      const res = mockRes();
      await ctrl.getTablesWithActiveOrders(mockReq({ query: {}, user: restrictedUser() }), res);
      expect(res.status).toHaveBeenCalledWith(403);
    });
  });

  // ── itemSalesReportTable ──────────────────────────────────────────────────────
  describe('itemSalesReportTable', () => {
    test('200 success', async () => {
      const res = mockRes();
      await ctrl.itemSalesReportTable(mockReq({ query: { branch: VALID_BRANCH } }), res);
      expect(res.status).toHaveBeenCalledWith(200);
    });

    test('403 no permission', async () => {
      const res = mockRes();
      await ctrl.itemSalesReportTable(mockReq({ query: {}, user: restrictedUser() }), res);
      expect(res.status).toHaveBeenCalledWith(403);
    });

    test('400 no valid branch', async () => {
      salesHelper.resolveBranchId.mockReturnValue(null);
      const res = mockRes();
      await ctrl.itemSalesReportTable(mockReq({ query: {} }), res);
      expect(res.status).toHaveBeenCalledWith(400);
    });
  });

  // ── categorySalesReportTable ──────────────────────────────────────────────────
  describe('categorySalesReportTable', () => {
    test('200 success', async () => {
      const res = mockRes();
      await ctrl.categorySalesReportTable(mockReq({ query: { branch: VALID_BRANCH } }), res);
      expect(res.status).toHaveBeenCalledWith(200);
    });

    test('403 no permission', async () => {
      const res = mockRes();
      await ctrl.categorySalesReportTable(mockReq({ query: {}, user: restrictedUser() }), res);
      expect(res.status).toHaveBeenCalledWith(403);
    });

    test('400 no valid branch', async () => {
      salesHelper.resolveBranchId.mockReturnValue(null);
      const res = mockRes();
      await ctrl.categorySalesReportTable(mockReq({ query: {} }), res);
      expect(res.status).toHaveBeenCalledWith(400);
    });
  });

  // ── Response format integrity ─────────────────────────────────────────────────
  describe('Response format integrity', () => {
    test('all success responses use type:success not success:true', async () => {
      const res = mockRes();
      const next = mockNext();
      await ctrl.create(mockReq({ body: { items: [], sales_total: 100 } }), res, next);
      const payload = res.json.mock.calls[0][0];
      expect(payload).not.toHaveProperty('success');
      expect(payload).toHaveProperty('type', 'success');
      expect(payload).toHaveProperty('message');
      expect(payload).toHaveProperty('data');
    });

    test('all error responses use type:error not success:false', async () => {
      const res = mockRes();
      const next = mockNext();
      await ctrl.update(
        mockReq({ params: { id: VALID_ID }, body: {}, user: restrictedUser() }),
        res,
        next
      );
      const payload = res.json.mock.calls[0][0];
      expect(payload).not.toHaveProperty('success');
      expect(payload).toHaveProperty('type', 'error');
    });
  });
});

describe('branch serving-period filters', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    salesService.getBranchById.mockResolvedValue({
      license: VALID_LICENSE,
      table_options: 'enable',
      time_zone: 'Asia/Kolkata',
    });
    salesService.getReportServingPeriods.mockResolvedValue([
      { id: 'lunch', name: 'Lunch', hours: { mon: [{ open: 720, close: 930 }] } },
    ]);
  });
  test('options load the explicitly selected branch periods', async () => {
    const res = mockRes();
    await ctrl.servingPeriodOptions(mockReq({ query: { branch: VALID_BRANCH } }), res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(salesService.getReportServingPeriods).toHaveBeenCalledWith({
      branchId: VALID_BRANCH,
      licenseId: VALID_LICENSE,
    });
    expect(res.json.mock.calls[0][0].data.serving_periods[0].id).toBe('lunch');
  });
  test('history dropdown refuses users without sales access', async () => {
    const res = mockRes();
    await ctrl.historyFilterOptions(
      mockReq({ user: restrictedUser(), query: { branch: VALID_BRANCH, field: 'staff' } }),
      res
    );
    expect(res.status).toHaveBeenCalledWith(403);
    expect(salesService.getBranchById).not.toHaveBeenCalled();
  });
  test('history dropdown refuses a different tenant before querying sales', async () => {
    salesService.getBranchById.mockResolvedValue({ license: 'another-license' });
    const res = mockRes();
    await ctrl.historyFilterOptions(
      mockReq({ query: { branch: VALID_BRANCH, field: 'device' } }),
      res
    );
    expect(res.status).toHaveBeenCalledWith(404);
  });
  test('history dropdown refuses a branch outside staff access', async () => {
    const res = mockRes();
    await ctrl.historyFilterOptions(
      mockReq({
        user: adminUser({ branch_access: [{ branch_id: VALID_LICENSE }] }),
        query: { branch: VALID_BRANCH, field: 'staff' },
      }),
      res
    );
    expect(res.status).toHaveBeenCalledWith(403);
    expect(salesService.getBranchById).not.toHaveBeenCalled();
  });
  test('options never expose another license', async () => {
    salesService.getBranchById.mockResolvedValue({
      license: 'another-license',
      table_options: 'enable',
    });
    const res = mockRes();
    await ctrl.servingPeriodOptions(mockReq({ query: { branch: VALID_BRANCH } }), res);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(salesService.getReportServingPeriods).not.toHaveBeenCalled();
  });
  test('inaccessible branch is refused before reading its settings', async () => {
    const res = mockRes();
    await ctrl.servingPeriodOptions(
      mockReq({
        query: { branch: VALID_BRANCH },
        user: adminUser({ branch_access: [{ branch_id: VALID_LICENSE }] }),
      }),
      res
    );
    expect(res.status).toHaveBeenCalledWith(403);
  });
  test('selected period is a real database condition', async () => {
    const match = await ctrl.reportServingMatch(mockReq({ query: { serving_period: 'lunch' } }), [
      VALID_BRANCH,
    ]);
    expect(match[0].$expr.$or.length).toBe(1);
  });
  test('multiple branches cannot silently reuse one branch schedule', async () => {
    await expect(
      ctrl.reportServingMatch(mockReq({ query: { serving_period: 'lunch' } }), [
        VALID_BRANCH,
        VALID_LICENSE,
      ])
    ).rejects.toThrow('Choose one branch');
  });
});

test('qrOrder preserves structured price rejection so a desktop draft can be corrected', async () => {
  const details = { state: 'item_price_mismatch', expected_price: 399, submitted_price: 398 };
  salesService.createOnlineOrder = jest
    .fn()
    .mockResolvedValue({ status: false, message: 'Price changed', data: details });
  const res = mockRes();
  await ctrl.qrOrder({ body: {}, user: adminUser(), get: () => '', headers: {}, socket: {} }, res);
  expect(res.status).toHaveBeenCalledWith(422);
  expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ type: 'error', data: details }));
});
