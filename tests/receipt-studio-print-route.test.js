'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const pixel = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6Z1AAAAAASUVORK5CYII=';

test('saved Receipt Studio sale uses the Windows driver with the saved design and real sale data', async t => {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    url: 'http://localhost/', runScripts: 'outside-only'
  });
  t.after(() => dom.window.close());
  const w = dom.window;
  w.$ = w.jQuery = require('jquery')(w);
  w.PosnicPro = {
    escapeHtml: value => w.$('<i>').text(value == null ? '' : String(value)).html(),
    local: { get: key => key === 'currencySign' ? 'DA ' : '', set: () => {} },
    i18n: { t: (_key, fallback) => fallback },
    resolveReceiptPrinter: () => 'Counter',
    afterPrint: () => {}
  };
  let printedHtml = '', printOptions = null;
  w.electronAPI = {
    diagnostics: { event: () => Promise.resolve() },
    printer: {
      getDefault: async () => ({ name: 'Counter' }),
      print: async (html, options) => {
        printedHtml = html;
        printOptions = options;
        return { success: true };
      }
    }
  };
  w.eval(read('api/src/helpers/sale-payment-summary.js'));
  w.eval(read('api/src/helpers/receipt-design.js'));
  w.eval(read('src/receipt-page-layout.js'));
  w.eval(read('frontend/static/script/js/core/receipt-designer.js'));
  const engine = w.PosnicPro.receiptDesigner;
  const branch = { branch_name: 'My Shop', logo: pixel, print_logoimg: true, footer_print: 'Thank you' };
  const design = engine.defaults(branch);
  const sale = {
    ...branch, receipt_designs: design, sales_id: 'S0000123',
    created_date: '26/10/2026 17:00', receipt_date: '26/10/2026 17:00',
    customer_name: 'Sample Customer',
    items: [{ item_name: 'Test item', item_price: 125, item_quantity: 2, item_unit: 'ea', total_amount: 250 }],
    items_subtotal: 250, items_total: 250, tax: 0, discount: 0, payment_mode: 'Cash'
  };
  const result = await engine.printSale(sale, '80', false, {
    preserveWorkspace: true, propagateFailure: true
  });
  assert.equal(result.success, true);
  assert.equal(printOptions.thermalRaster, false,
    'Receipt Studio HTML must use the Windows printer driver, never raw ESC/POS bytes');
  assert.equal(printOptions.fastReceiptLines, null,
    'a saved Studio layout must not be flattened into text-only fast mode');
  assert.equal(printOptions.forceHtml, true,
    'the Windows driver must receive the rendered Receipt Studio document');
  assert.equal(printOptions.pageSize, '80mm');
  assert.equal(printOptions.silent, true);
  assert.match(printedHtml, /Test item/);
  assert.match(printedHtml, /S0000123/);
  assert.match(printedHtml, /250/);
});

test('V2 Receipt Studio preview, test print and real sale share the saved block renderer', () => {
  const app = read('frontend-v2/core/app.js');
  assert.match(app, /function renderReceiptStudioDocument\(sale,layout\)/);
  assert.match(app, /function buildSaleReceiptHtml\(sale\)\{return renderReceiptStudioDocument\(sale,state\.receiptLayout\);\}/);
  assert.match(app, /html=renderReceiptStudioDocument\(state\.receiptSample,state\.receiptLayout\)/);
  assert.match(app, /thermalRaster:false,fastReceiptLines:null,forceHtml:true/);
  assert.match(app, /designer-undo-receipt/);
  assert.match(app, /designer-redo-receipt/);
});

test('V2 label preview, queued print and fast print use the same positioned label elements', () => {
  const app = read('frontend-v2/core/app.js');
  assert.match(app, /elements\.map\(designerElement\)/);
  assert.match(app, /cfg\.elements\.map\(designerElement\)/);
  assert.match(app, /function designerElement\(e\)/);
  assert.match(app, /transform:rotate\('\+\(Number\(e\.rotation\)\|\|0\)\+'deg\)/);
});


test('Receipt Studio canvas cannot shrink below the selected paper width', () => {
  const app = read('frontend-v2/core/app.js');
  const css = read('frontend-v2/styles/app.css');
  assert.ok(app.includes("min-width:'+state.receiptLayout.width+'mm"));
  assert.ok(css.includes('#receipt-artboard{') && css.includes('min-width:var(--receipt-paper-width,80mm)!important'));
});

test('Label Studio centers the complete sheet inside its scrollable stage', () => {
  const css = read('frontend-v2/styles/app.css');
  assert.ok(css.includes('padding:48px 40px!important'));
  assert.ok(css.includes('zoom:1.65!important'));
});


test('Receipt Studio parses persisted millimetre dimensions and repairs collapsed block geometry', () => {
  const app = read('frontend-v2/core/app.js');
  assert.match(app, /const designerMm=\(value,fallback,min=0,max=2000\)/);
  assert.match(app, /designerMm\(saved\?\.width\?\?remoteLayout\?\.width\?\?r\.paperWidth,80,30,210\)/);
  assert.match(app, /rawW<8\?fallback\.w:rawW/);
  assert.match(app, /rawH<1\.5\?fallback\.h:rawH/);
  assert.ok(app.includes('designerMm(layout.width,80,30,210)'));
});

test('Designer workspaces open at the top and use a smaller label zoom', () => {
  const css = read('frontend-v2/styles/app.css');
  assert.match(css, /align-items:flex-start!important;justify-content:center!important;overflow:auto!important/);
  assert.match(css, /#label-artboard\{zoom:1\.35!important/);
});


test('Designer artboards keep physical width and disable label zoom/cropping in the actual markup', () => {
 const app = read('frontend-v2/core/app.js');
 const css = read('frontend-v2/styles/app.css');
 assert.match(app, /flex:0 0 '\+state\.receiptLayout\.width\+'mm/);
 assert.match(app, /zoom:1;background:/);
 assert.match(css, /#label-artboard\{[\s\S]*?zoom:1!important/);
 assert.match(css, /#receipt-artboard\{[\s\S]*?flex-shrink:0!important/);
});

test('printer test action uses the same active Receipt Studio renderer as the saved design', () => {
  const app = read('frontend-v2/core/app.js');
  assert.match(app, /else if\(action==='test-printer'\)\{await printStudio\('receipt'\);\}/);
  assert.match(app, /const designerPaperPx=width=>\(\{58:220,80:302,112:420,210:595\}/);
});

test('receipt paper has fixed pixel width and both designer stages keep their top edge reachable', () => {
  const app = read('frontend-v2/core/app.js');
  const css = read('frontend-v2/styles/app.css');
  assert.match(app, /width:'\+designerPaperPx\(state\.receiptLayout\.width\)\+'px!important/);
  assert.match(css, /align-items:flex-start!important;overflow:auto!important;min-height:360px!important;padding:36px 24px!important/);
  assert.match(css, /#label-artboard\{[\s\S]*?overflow:visible!important/);
});

test('Receipt Studio does not inject fabricated sales or customer records when no real sale exists', () => {
  const app = read('frontend-v2/core/app.js');
  assert.doesNotMatch(app, /DEMO-0000158|Article de démonstration|Client de démonstration/);
});

test('Label Studio loads the persisted server template and logo when local layout is absent', () => {
  const app = read('frontend-v2/core/app.js');
  assert.match(app, /elements=saved\?\.elements\|\|t\.elements\|\|/);
  assert.match(app, /logoDataUrl:saved\?\.logoDataUrl\|\|t\.logoDataUrl\|\|''/);
  assert.match(app, /logoDataUrl:raw\.logoDataUrl\|\|template\.logoDataUrl\|\|''/);
});


test('Receipt Studio preserves saved Y coordinates and never draws a blue totals outline', () => {
  const app = read('frontend-v2/core/app.js');
  const css = read('frontend-v2/styles/app.css');
  const rendererStart = app.indexOf('function renderReceiptStudioDocument(sale,layout)');
  const rendererEnd = app.indexOf('function refreshReceiptDesignerPreview()', rendererStart);
  const renderer = app.slice(rendererStart, rendererEnd);
  assert.ok(renderer.includes('const totalsTop=oldTotalsTop'));
  assert.ok(renderer.includes('Keep user-placed elements below totals at their saved Y coordinate'));
  assert.doesNotMatch(renderer, /topMm\s*\+=\s*shift/);
  assert.match(css, /#receipt-artboard \.receipt-legacy-totals\{border:0!important;outline:0!important/);
  assert.match(app, /receiptTenderRows\(sale\)\.map\(row=>\(\{name:row\.method,amount:row\.amount\}\)\)/);
  assert.match(app, /if\(!rows\.length\)\{const method=sale\?\.payment_mode/);
});


test('printer settings preview failure is isolated and sidebar footer is viewport anchored', () => {
  const app = read('frontend-v2/core/app.js');
  const css = read('frontend-v2/styles/app.css');
  const settingsStart = app.indexOf('function printerSettings(d)');
  const settingsEnd = app.indexOf('function receiptDesignerElement(e)', settingsStart);
  const settings = app.slice(settingsStart, settingsEnd);
  assert.match(settings, /try\{renderReceiptStudioDocument\(sale,state\.receiptLayout\)/);
  assert.match(settings, /catch\(error\)\{console\.error\('\[Receipt Studio\]/);
  assert.match(css, /\.shell>\.rail>\.rail-bottom\{position:absolute!important;inset:auto 8px 10px 8px!important/);
  assert.match(css, /\.receipt-totals-block>div\{border:0!important/);
  assert.match(css, /\.receipt-totals-block \.receipt-grand-total\{border:0!important/);
});
