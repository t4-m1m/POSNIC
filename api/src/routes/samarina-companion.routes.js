'use strict';
const express = require('express');
const crypto = require('crypto');
const { ObjectId } = require('mongodb');
const { protect } = require('../middleware/auth');
const ItemService = require('../services/item.service');
const ExpenseService = require('../services/expense.service');
const expenseService = new ExpenseService();
const itemService = new ItemService();
const { runWithRequestContext } = require('../utils/request-context');
const router = express.Router();
const hash = value => crypto.createHash('sha256').update(String(value)).digest('hex');
const oid = value => ObjectId.isValid(String(value || '')) ? new ObjectId(String(value)) : null;
const sid = value => value == null ? '' : String(value);
const activeBranchId = req => req.body?.branch_id || req.query?.branch_id || req.tenantContext?.branchId || req.session?.selectedBranchId || req.session?.branch_id || req.user?.branch_id || req.user?.branch?._id || req.user?.default_branch_id || req.user?.branch_access?.[0]?.branch_id;
const fail = (res, status, message) => res.status(status).json({ error: { message } });
function userCanAccessBranch(user, branchId) {
  const target = sid(branchId);
  const role = String(user?.usertype || user?.user_type || user?.role || '').toLowerCase();
  if (['super_admin', 'superadmin', 'super admin'].includes(role)) return true;
  if ([user?.branch_id, user?.branch, user?.default_branch_id].some(value => sid(value?._id || value) === target)) return true;
  return Array.isArray(user?.branch_access) && user.branch_access.some(entry => sid(entry?.branch_id || entry?._id) === target);
}
function requestCanAccessBranch(req, branchId) {
  if (userCanAccessBranch(req.user, branchId)) return true;
  const contextBranch = req.tenantContext?.branchId || req.session?.selectedBranchId || req.session?.branch_id;
  return !!contextBranch && sid(contextBranch) === sid(branchId);
}
const ownerAllowed = user => {
  const role = String(user?.usertype || user?.user_type || user?.role || '').toLowerCase();
  return ['owner','admin','administrator','manager','superadmin','super_admin','super admin'].includes(role) || user?.access?.settings?.write === true || user?.access?.branch?.write === true;
};
const branchFilter = branchId => ({ branch_id: oid(branchId) || branchId });
const licenseFilter = license => license ? { license: oid(license) || license } : {};
const bearer = req => {
  const value = String(req.headers.authorization || '');
  return /^Bearer\s+/i.test(value) ? value.replace(/^Bearer\s+/i, '').trim() : '';
};
async function findBranch(req, branchId) {
  const query = { _id: oid(branchId) || branchId };
  if (req.user?.license) query.license = oid(req.user.license) || req.user.license;
  return req.db.collection('branches').findOne(query);
}

/* Independent one-time Samarina pairing. No Mobile POS pair-code collection,
   token signer, feature switch or mobile-pos route is used. */
router.post('/pair', async (req, res) => {
  try {
    const code = String(req.body?.code || '').replace(/[\s-]/g, '').toUpperCase();
    const deviceId = String(req.body?.deviceId || '').trim();
    if (!/^[A-F0-9]{12}$/.test(code) || !/^[A-Za-z0-9_-]{12,100}$/.test(deviceId)) return fail(res, 400, 'Code ou identifiant de téléphone invalide.');
    const result = await req.db.collection('samarina_companion_pair_codes').findOneAndDelete({ _id: hash(code), expiresAt: { $gt: new Date() } });
    const grant = result?.value || result;
    if (!grant?.userId || !grant?.branchId) return fail(res, 401, 'Code expiré ou déjà utilisé. Générez un nouveau QR code sur le PC.');
    const user = await req.db.collection('users').findOne({ _id: grant.userId, activate: true });
    const branch = await req.db.collection('branches').findOne({ _id: grant.branchId });
    if (!user || !branch || (grant.license && sid(user.license) !== sid(grant.license)) || !userCanAccessBranch(user, grant.branchId)) return fail(res, 403, 'Ce compte ou ce magasin n’est plus autorisé.');
    const token = crypto.randomBytes(36).toString('base64url');
    const expiresAt = new Date(Date.now() + 30 * 86400000);
    await req.db.collection('samarina_companion_sessions').insertOne({
      tokenHash: hash(token), userId: user._id, branchId: grant.branchId,
      license: grant.license || user.license || branch.license || null,
      deviceId, createdAt: new Date(), lastSeenAt: new Date(), expiresAt, revokedAt: null
    });
    return res.json({ token, expiresAt, profile: {
      staffName: user.username || user.name || 'Équipe',
      branchName: branch.branch_name || branch.name || 'Magasin',
      branchId: sid(branch._id), currency: branch.currency || 'DA'
    }});
  } catch (error) {
    console.error('[Samarina Companion] pairing failed:', error);
    return fail(res, 500, 'Impossible de connecter ce téléphone. Réessayez.');
  }
});

/* GET also supplies the CSRF response header used by the following setup POST. */
router.get('/setup/status', protect, async (req, res) => {
  const branchId = activeBranchId(req);
  if (!branchId) return fail(res, 400, 'Sélectionnez un magasin dans POSNIC.');
  const branch = await findBranch(req, branchId);
  if (!branch) return fail(res, 404, 'Magasin introuvable.');
  return res.json({ branch: branch.branch_name || branch.name || 'Magasin', canPair: ownerAllowed(req.user) });
});

/* Desktop setup is protected by the ordinary POSNIC login, but issues its own
   one-use grants and opaque Samarina session tokens. */
router.post('/setup/pairing-code', protect, async (req, res) => {
  try {
    if (!ownerAllowed(req.user)) return fail(res, 403, 'Accès administrateur requis pour jumeler un téléphone.');
    const branchId = activeBranchId(req);
    if (!branchId) return fail(res, 400, 'Sélectionnez d’abord un magasin dans POSNIC.');
    if (!requestCanAccessBranch(req, branchId)) return fail(res, 403, 'Accès à ce magasin refusé.');
    const branch = await findBranch(req, branchId);
    if (!branch) return fail(res, 404, 'Magasin introuvable.');
    const userId = oid(req.user._id || req.user.id);
    if (!userId) return fail(res, 401, 'Session POSNIC invalide.');
    const code = crypto.randomBytes(6).toString('hex').toUpperCase();
    const expiresAt = new Date(Date.now() + 5 * 60000);
    const license = req.user.license || branch.license || null;
    const grants = req.db.collection('samarina_companion_pair_codes');
    await grants.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
    await grants.insertOne({ _id: hash(code), userId, branchId: oid(branchId) || branchId, license: oid(license) || license, createdAt: new Date(), expiresAt });
    const { localAddresses, pairingTargets } = require('../utils/pairing');
    const targets = pairingTargets({ host: req.headers.host, port: process.env.PORT || 5555 }, localAddresses()).targets;
    const qrcode = require('qrcode');
    const pairingQr = await Promise.all(targets.map(async target => {
      const origin = new URL(target.url).origin;
      const api = origin + '/api/samarina/v1';
      const url = new URL('/mobile/', origin);
      url.hash = new URLSearchParams({ server: api, code }).toString();
      return { url: origin, qr: await qrcode.toDataURL(url.toString(), { width: 280, margin: 2 }) };
    }));
    return res.json({ code: code.match(/.{4}/g).join('-'), expiresAt, branch: branch.branch_name || branch.name || 'Magasin', pairingQr });
  } catch (error) {
    console.error('[Samarina Companion] code creation failed:', error);
    return fail(res, 500, 'Impossible de générer le code de connexion.');
  }
});

router.get('/desktop/receiving-queue', protect, async (req, res) => {
  try {
    const branchId = activeBranchId(req);
    if (!branchId) return fail(res, 400, 'Aucun magasin sélectionné.');
    if (!requestCanAccessBranch(req, branchId)) return fail(res, 403, 'Accès à ce magasin refusé.');
    const rows = await req.db.collection('samarina_receiving_queue').find({ branchId: oid(branchId) || branchId, state: 'pending' }).sort({ createdAt: 1 }).limit(250).toArray();
    return res.json({ rows: rows.map(row => ({
      id: sid(row._id), itemId: sid(row.itemId), name: row.name, barcode: row.barcode || '',
      quantity: Number(row.quantity || 0), companyPrice: Number(row.companyPrice || 0),
      tax: Number(row.tax || 0), taxType: row.taxType || 'exclusive',
      availableQuantity: Number(row.availableQuantity || 0), unit: row.unit || 'qty',
      itemid: row.itemid || row.barcode || '', purchaseUnit: row.purchaseUnit || '',
      conversionFactor: Number(row.conversionFactor || 0),
      createdAt: row.createdAt, deviceId: row.deviceId || ''
    })) });
  } catch (error) {
    console.error('[Samarina Companion] desktop queue failed:', error);
    return fail(res, 500, 'Impossible de lire la file de réception.');
  }
});
router.post('/desktop/receiving-queue/:id/ack', protect, async (req, res) => {
  try {
    const branchId = activeBranchId(req), id = oid(req.params.id);
    if (!branchId || !id) return fail(res, 400, 'Référence de réception invalide.');
    if (!requestCanAccessBranch(req, branchId)) return fail(res, 403, 'Accès à ce magasin refusé.');
    await req.db.collection('samarina_receiving_queue').updateOne({ _id: id, branchId: oid(branchId) || branchId, state: 'pending' }, { $set: { state: 'imported', importedAt: new Date() } });
    return res.json({ ok: true });
  } catch (_) { return fail(res, 500, 'Impossible de confirmer la réception.'); }
});

async function companionAuth(req, res, next) {
  try {
    const token = bearer(req);
    if (!token) return fail(res, 401, 'Téléphone non jumelé.');
    const sessions = req.db.collection('samarina_companion_sessions');
    const session = await sessions.findOne({ tokenHash: hash(token), expiresAt: { $gt: new Date() }, revokedAt: null });
    if (!session) return fail(res, 401, 'Session expirée. Reconnectez le téléphone depuis Paramètres.');
    const user = await req.db.collection('users').findOne({ _id: session.userId, activate: true });
    const branch = await req.db.collection('branches').findOne({ _id: session.branchId });
    if (!user || !branch || !userCanAccessBranch(user, session.branchId)) return fail(res, 403, 'Accès au magasin retiré.');
    req.companion = { session, user, branch, branchId: session.branchId };
    req.user = user;
    const activityAt = new Date();
    await sessions.updateOne({ _id: session._id }, { $set: { lastSeenAt: activityAt, expiresAt: new Date(activityAt.getTime() + 30 * 86400000) } });
    return runWithRequestContext({
      currentBranch: session.branchId,
      currentBranchName: branch.branch_name || branch.name || '',
      license: session.license || null,
      loggedUser: user._id,
      loggedUserName: user.username || user.email || user.name || 'Samarina Companion',
    }, next);
  } catch (error) {
    console.error('[Samarina Companion] authentication failed:', error);
    return fail(res, 500, 'Erreur de vérification de la session.');
  }
}
/* Desktop-only queue endpoints: authenticated with the ordinary POSNIC session. */
router.get('/desktop/print-jobs', protect, async (req, res) => {
  try {
    const branchId = activeBranchId(req);
    if (!branchId || !requestCanAccessBranch(req, branchId)) return fail(res, 403, 'Accès au magasin refusé.');
    const rows = await req.db.collection('samarina_companion_print_jobs')
      .find({ branchId: oid(branchId) || branchId, state: 'pending', expiresAt: { $gt: new Date() } })
      .sort({ createdAt: 1 }).limit(20).toArray();
    return res.json({ rows: rows.map(row => ({ id: sid(row._id), itemId: sid(row.itemId), copies: row.copies })) });
  } catch (error) {
    console.error('[Samarina Companion] desktop print queue failed:', error);
    return fail(res, 500, 'Impossible de lire la file d’impression.');
  }
});
router.post('/desktop/print-jobs/:id/ack', protect, async (req, res) => {
  try {
    const branchId = activeBranchId(req), id = oid(req.params.id);
    if (!branchId || !id || !requestCanAccessBranch(req, branchId)) return fail(res, 403, 'Accès au magasin refusé.');
    const state = req.body?.state === 'failed' ? 'failed' : 'printed';
    await req.db.collection('samarina_companion_print_jobs').updateOne(
      { _id: id, branchId: oid(branchId) || branchId, state: 'pending' },
      { $set: { state, completedAt: new Date(), result: String(req.body?.message || '').slice(0, 300) } }
    );
    return res.json({ ok: true });
  } catch (_) { return fail(res, 500, 'Impossible de confirmer l’impression.'); }
});

router.use(companionAuth);

router.get('/bootstrap', (req, res) => {
  const c = req.companion;
  res.set('Cache-Control', 'no-store').json({
    staffName: c.user.username || c.user.name || 'Équipe',
    branchName: c.branch.branch_name || c.branch.name || 'Magasin',
    branchId: sid(c.branchId), currency: c.branch.currency || 'DA',
    role: String(c.user.role || c.user.usertype || '').toLowerCase(),
    isOwner: ownerAllowed(c.user)
  });
});
router.post('/logout', async (req, res) => {
  await req.db.collection('samarina_companion_sessions').updateOne({ _id: req.companion.session._id }, { $set: { revokedAt: new Date() } });
  res.json({ ok: true });
});
router.post('/expenses/quick', async (req, res) => {
  try {
    const amount = Number(req.body?.amount);
    const categories = new Set(['Emballage', 'Transport', 'Fournitures']);
    const category = String(req.body?.category || '');
    const source = req.body?.paymentSource === 'personal' ? 'personal' : 'register';
    const description = String(req.body?.description || ('Dépense mobile · ' + category)).trim().slice(0, 255);
    if (!Number.isFinite(amount) || amount <= 0 || amount > 100000000 || !categories.has(category) || description.length < 3)
      return fail(res, 400, 'Montant, catégorie ou description invalide.');
    const c = req.companion, now = new Date();
    const createdBy = c.user.username || c.user.name || c.user.email || 'Samarina Companion';
    const result = await expenseService.createExpense({
      amount, type: 'debit', date: now, category, recipientname: '', approvedby: '',
      description, branch_id: oid(c.branchId) || c.branchId,
      branch_name: c.branch.branch_name || c.branch.name || '',
      created_by: createdBy, created_by_id: c.user._id || null
    });
    if (!result.status || !result.data) return fail(res, 400, result.message || 'Impossible d’enregistrer la dépense.');
    const expenseId = oid(result.data);
    await req.db.collection('expenses').updateOne(
      { _id: expenseId, branch_id: oid(c.branchId) || c.branchId, license: oid(c.session.license) || c.session.license },
      { $set: { payment_source: source, cash_drawer_impact: source !== 'personal', source_channel: 'samarina_companion' } }
    );
    return res.status(201).json({ ok: true, id: sid(result.data), amount, category, paymentSource: source, date: now });
  } catch (error) {
    console.error('[Samarina Companion] quick expense failed:', error);
    return fail(res, 500, 'Impossible d’enregistrer la dépense.');
  }
});
router.post('/print-jobs', async (req, res) => {
  try {
    const itemId = oid(req.body?.itemId), copies = Number(req.body?.copies);
    if (!itemId || !Number.isInteger(copies) || copies < 1 || copies > 999) return fail(res, 400, 'Article ou quantité d’étiquettes invalide.');
    const c = req.companion;
    const item = await req.db.collection('items').findOne({ _id: itemId, ...branchFilter(c.branchId), ...licenseFilter(c.session.license) }, { projection: { _id: 1 } });
    if (!item) return fail(res, 404, 'Article introuvable dans ce magasin.');
    const now = new Date();
    const result = await req.db.collection('samarina_companion_print_jobs').insertOne({
      itemId, copies, branchId: oid(c.branchId) || c.branchId,
      license: oid(c.session.license) || c.session.license,
      deviceId: c.session.deviceId, staffId: c.user._id,
      state: 'pending', createdAt: now, expiresAt: new Date(now.getTime() + 10 * 60000)
    });
    return res.status(202).json({ ok: true, id: sid(result.insertedId), message: 'Demande envoyée au PC. L’étiquette sera imprimée avec le modèle enregistré.' });
  } catch (error) {
    console.error('[Samarina Companion] label print request failed:', error);
    return fail(res, 500, 'Impossible d’envoyer la demande d’impression.');
  }
});

router.get('/catalogue', async (req, res) => {
  try {
    const q = String(req.query.q || '').trim().slice(0, 100);
    const filter = { ...branchFilter(req.companion.branchId), ...licenseFilter(req.companion.session.license) };
    if (q) {
      const safe = q.replace(/[.*+?^$()|[\]\\]/g, '\\$&');
      filter.$or = [
        { name: { $regex: safe, $options: 'i' } },
        { barcode_id: { $regex: safe, $options: 'i' } },
        { sku: { $regex: safe, $options: 'i' } },
        { itemid: { $regex: safe, $options: 'i' } },
        { variant_value: { $regex: safe, $options: 'i' } },
        { variant_parent_name: { $regex: safe, $options: 'i' } }
      ];
    }
    const rows = await req.db.collection('items').find(filter, { projection: { name: 1, barcode_id: 1, sku: 1, quantity: 1, available_quantity: 1, selling_price: 1, image: 1, track_inventory: 1, brand_abbreviation: 1, variant_group_id: 1, variant_axis: 1, variant_value: 1, variant_parent_name: 1 } }).sort({ name: 1 }).limit(60).toArray();
    res.json({ rows: rows.map(row => ({ id: sid(row._id), name: row.name || row.item_name || 'Article', barcode: row.barcode_id || '', sku: row.sku || row.itemid || '', quantity: Number(row.available_quantity ?? row.quantity ?? 0), price: Number(row.selling_price || 0), image: row.image || '', tracked: row.track_inventory !== false, brand: row.brand_abbreviation || '',
      variantGroupId: sid(row.variant_group_id), variantAxis: row.variant_axis || '',
      variantValue: row.variant_value || '', variantParentName: row.variant_parent_name || ''
    })) });
  } catch (error) {
    console.error('[Samarina Companion] catalogue failed:', error);
    fail(res, 500, 'Impossible de charger le catalogue.');
  }
});

router.post('/items', async (req, res) => {
  try {
    const name = String(req.body?.name || '').trim();
    const price = Number(req.body?.selling_price);
    if (!name || !Number.isFinite(price) || price < 0) return fail(res, 400, 'Nom et prix de vente valides obligatoires.');
    const c = req.companion;
    const photo = String(req.body?.image || '').trim();
    const data = {
      name, selling_price: price, barcode_id: String(req.body?.barcode_id || '').trim(),
      sku_id: String(req.body?.sku || '').trim(), mrp_price: price, company_price: 0,
      available_quantity: 0, track_inventory: req.body?.track_inventory !== false,
      tax: 0, tax_type: 'exclusive', discount_amount: 0, discount_percentage: 0,
      cover_image: photo, image: photo ? [{ name: photo, size: 0, cover: 'yes' }] : [],
      category_name: '', category_id: '', supplier_name: '', supplier_id: ''
    };
    const result = await itemService.addItem({
      data, branchId: c.branchId, licenseId: c.session.license, user: c.user
    });
    if (!result || result.status !== true) return fail(res, 409, result?.message || 'Impossible de créer cet article.');
    return res.status(201).json({ id: result.data?.id || result.data?._id || '', name, selling_price: price, barcode: result.data?.barcode_id || data.barcode_id });
  } catch (error) {
    console.error('[Samarina Companion] item creation failed:', error);
    return fail(res, 500, 'Impossible de créer cet article.');
  }
});
router.get('/items/:id', async (req, res) => {
  try {
    const id = oid(req.params.id);
    if (!id) return fail(res, 400, 'Référence article invalide.');
    const row = await req.db.collection('items').findOne({
      _id: id, ...branchFilter(req.companion.branchId), ...licenseFilter(req.companion.session.license)
    }, { projection: { name: 1, barcode_id: 1, sku: 1, itemid: 1, selling_price: 1, image: 1, quantity: 1, available_quantity: 1, track_inventory: 1 } });
    if (!row) return fail(res, 404, 'Article introuvable.');
    return res.json({ id: sid(row._id), name: row.name || '', barcode: row.barcode_id || '', sku: row.sku || row.itemid || '', selling_price: Number(row.selling_price || 0), image: row.image || '', quantity: Number(row.available_quantity ?? row.quantity ?? 0), track_inventory: row.track_inventory !== false });
  } catch (error) { return fail(res, 500, 'Impossible de charger cet article.'); }
});
router.put('/items/:id', async (req, res) => {
  try {
    const id = oid(req.params.id);
    if (!id) return fail(res, 400, 'Référence article invalide.');
    const c = req.companion;
    const filter = { _id: id, ...branchFilter(c.branchId), ...licenseFilter(c.session.license) };
    const existing = await req.db.collection('items').findOne(filter, { projection: { itemid: 1 } });
    if (!existing) return fail(res, 404, 'Article introuvable dans ce magasin.');
    const set = { updated_date: new Date() };
    if (Object.prototype.hasOwnProperty.call(req.body || {}, 'name')) set.name = String(req.body.name || '').trim();
    if (Object.prototype.hasOwnProperty.call(req.body || {}, 'barcode_id')) {
      const barcode = String(req.body.barcode_id || '').trim();
      if (barcode) {
        const itemBarcodes = require('../utils/item-barcodes');
        const conflict = await itemBarcodes.findConflict(req.db.collection('items'), [barcode], {
          branchId: oid(c.branchId) || c.branchId,
          licenseId: oid(c.session.license) || c.session.license,
          selfId: id
        });
        if (conflict) return fail(res, 409, conflict.message || 'Ce code-barres est déjà attribué.');
      }
      set.barcode_id = barcode;
    }
    if (Object.prototype.hasOwnProperty.call(req.body || {}, 'sku')) {
      const sku = String(req.body.sku || '').trim();
      if (sku) {
        const duplicate = await req.db.collection('items').findOne({
          ...branchFilter(c.branchId), ...licenseFilter(c.session.license),
          itemid: sku, _id: { $ne: id }
        }, { projection: { _id: 1 } });
        if (duplicate) return fail(res, 409, 'Cette référence SKU existe déjà dans ce magasin.');
      }
      set.itemid = sku;
    }
    if (Object.prototype.hasOwnProperty.call(req.body || {}, 'selling_price')) {
      const price = Number(req.body.selling_price);
      if (!Number.isFinite(price) || price < 0) return fail(res, 400, 'Prix invalide.');
      set.selling_price = price;
    }
    if (Object.prototype.hasOwnProperty.call(req.body || {}, 'image')) {
      const image = String(req.body.image || '').trim();
      set.image = image;
      set.multi_image = image ? [{ name: image, size: 0, cover: 'yes' }] : [];
    }
    if (c.user?._id) set.updated_by_id = c.user._id;
    if (c.user?.username || c.user?.name) set.updated_by = c.user.username || c.user.name;
    const result = await req.db.collection('items').updateOne(filter, { $set: set });
    if (!result.matchedCount) return fail(res, 404, 'Article introuvable dans ce magasin.');
    try { require('../sync/nudge').nudgeSyncAgent(); } catch (_) {}
    return res.json({ ok: true });
  } catch (error) {
    console.error('[Samarina Companion] item update failed:', error);
    return fail(res, 500, 'Impossible de modifier cet article.');
  }
});
router.post('/items/photo', (req, res, next) => require('../controllers/items.controller').uploadItemMultiImage(req, res, next));

router.post('/receiving/queue', async (req, res) => {
  try {
    const itemId = oid(req.body?.itemId), quantity = Number(req.body?.quantity);
    if (!itemId || !Number.isFinite(quantity) || quantity <= 0 || quantity > 100000) return fail(res, 400, 'Article ou quantité invalide.');
    const c = req.companion;
    const item = await req.db.collection('items').findOne({ _id: itemId, ...branchFilter(c.branchId), ...licenseFilter(c.session.license) }, {
      projection: { name: 1, barcode_id: 1, itemid: 1, company_price: 1, cost_price: 1, tax: 1, tax_type: 1, quantity: 1, available_quantity: 1, unit: 1, item_unit: 1, purchase_unit: 1, conversion_factor: 1 }
    });
    if (!item) return fail(res, 404, 'Article introuvable dans ce magasin.');
    const entryId = String(req.body?.entryId || '').trim();
    if (!/^[A-Za-z0-9_-]{12,100}$/.test(entryId)) return fail(res, 400, 'Identifiant de scan invalide.');
    const queueCollection = req.db.collection('samarina_receiving_queue');
    await queueCollection.createIndex({ deviceId: 1, entryId: 1 }, { unique: true, partialFilterExpression: { entryId: { $type: 'string' } } });
    const now = new Date();
    const result = await queueCollection.updateOne(
      { deviceId: c.session.deviceId, entryId, branchId: oid(c.branchId) || c.branchId },
      { $setOnInsert: {
        itemId, branchId: oid(c.branchId) || c.branchId, license: oid(c.session.license) || c.session.license,
        name: item.name || 'Article', barcode: item.barcode_id || '', quantity,
        companyPrice: Number(item.company_price || item.cost_price || 0),
        tax: Number(item.tax || 0), taxType: item.tax_type || 'exclusive',
        availableQuantity: Number(item.available_quantity ?? item.quantity ?? 0),
        unit: item.unit || item.item_unit || 'qty', itemid: item.itemid || item.barcode_id || '',
        purchaseUnit: item.purchase_unit || '', conversionFactor: Number(item.conversion_factor || 0),
        deviceId: c.session.deviceId, entryId, state: 'pending', createdAt: now, updatedAt: now, staffId: c.user._id
      } },
      { upsert: true }
    );
    res.json({ ok: true, id: String(result.upsertedId || ''), message: 'Article ajouté à la file de réception.' });
  } catch (error) {
    console.error('[Samarina Companion] receive queue failed:', error);
    fail(res, 500, 'Impossible d’ajouter cet article à la réception.');
  }
});

router.get('/dashboard', async (req, res) => {
  try {
    if (!ownerAllowed(req.companion.user)) return fail(res, 403, 'Tableau de bord réservé au propriétaire ou administrateur.');
    const branchId = oid(req.companion.branchId) || req.companion.branchId;
    const start = new Date(); start.setHours(0, 0, 0, 0);
    const sales = await req.db.collection('sales').find({ branch_id: branchId, $or: [{ created_date: { $gte: start } }, { date: { $gte: start } }] }).limit(5000).toArray();
    const totals = { revenue: 0, cash: 0, electronic: 0, debt: 0, discounts: 0, voids: 0 };
    for (const sale of sales) {
      const state = String(sale.sale_status || sale.status || '').toLowerCase();
      if (state.includes('void') || state.includes('cancel')) { totals.voids++; continue; }
      const saleTotal = Number(sale.sales_total ?? sale.total ?? sale.grand_total ?? 0) || 0;
      totals.revenue += saleTotal;
      const payments = Array.isArray(sale.payments) ? sale.payments : [];
      const paid = payments.reduce((sum, payment) => {
        const method = String(payment.method || '').toLowerCase();
        const amount = Number(payment.amount || 0);
        if (method === 'cash') totals.cash += amount;
        else if (['card','tpe','bank_transfer','baridimob','baridi mob','baridi_mob'].includes(method)) totals.electronic += amount;
        return sum + (method === 'credit' ? 0 : amount);
      }, payments.length ? 0 : (Number(sale.paid_amount ?? sale.amount_paid ?? sale.total_paid ?? 0) || 0));
      if (!payments.length) {
        const method = String(sale.payment_method || sale.payment_mode || '').toLowerCase();
        const paidAmount = Number(sale.paid_amount ?? sale.amount_paid ?? sale.total_paid ?? 0) || 0;
        if (method === 'cash') totals.cash += paidAmount;
        else if (['card','tpe','bank_transfer','baridimob','baridi mob','baridi_mob'].includes(method)) totals.electronic += paidAmount;
      }
      totals.debt += Math.max(0, Number(sale.payment_pending ?? sale.pending ?? (saleTotal - paid)) || 0);
      totals.discounts += Number(sale.discount_amount ?? sale.discount ?? sale.discount_total ?? 0) || 0;
    }
    const items = await req.db.collection('items').countDocuments({ branch_id: branchId });
    const zrSummary = await req.db.collection('zr_deliveries').aggregate([
      { $match: { branch_id: branchId, license: oid(req.companion.session.license) || req.companion.session.license, status: { $nin: ['ANNULEE', 'RETOUR'] } } },
      { $group: { _id: null, count: { $sum: 1 }, cod: { $sum: '$cod_total' } } }
    ]).toArray().catch(() => []);
    const zrExpress = Number(zrSummary[0]?.count || 0);
    const zrCod = Number(zrSummary[0]?.cod || 0);
    res.json({ date: start.toISOString().slice(0,10), currency: req.companion.branch.currency || 'DA', totals, salesCount: sales.length, itemCount: items, zrExpress, zrCod });
  } catch (error) {
    console.error('[Samarina Companion] dashboard failed:', error);
    fail(res, 500, 'Impossible de charger le tableau de bord.');
  }
});

router.get('/dashboard/daily', async (req, res) => {
  try {
    if (!ownerAllowed(req.companion.user)) return fail(res, 403, 'Tableau de bord réservé au propriétaire ou administrateur.');
    const days = Math.min(90, Math.max(1, Number(req.query.days) || 30));
    const start = new Date(); start.setHours(0,0,0,0); start.setDate(start.getDate()-days+1);
    const branchId = oid(req.companion.branchId) || req.companion.branchId;
    const sales = await req.db.collection('sales').find({ branch_id: branchId, $or: [{created_date:{$gte:start}},{date:{$gte:start}}] }).limit(15000).toArray();
    const grouped = new Map();
    for (const sale of sales) {
      const raw = sale.created_date || sale.date || sale.createdAt, date = raw ? new Date(raw) : null;
      if (!date || Number.isNaN(date.getTime())) continue;
      const key = [date.getFullYear(),String(date.getMonth()+1).padStart(2,'0'),String(date.getDate()).padStart(2,'0')].join('-');
      if (!grouped.has(key)) grouped.set(key,{date:key,revenue:0,cash:0,electronic:0,debt:0,discounts:0,salesCount:0,voids:0});
      const day=grouped.get(key),state=String(sale.sale_status||sale.status||'').toLowerCase();
      if(state.includes('void')||state.includes('cancel')){day.voids++;continue;}
      day.salesCount++;
      const total=Number(sale.sales_total??sale.total??sale.grand_total??0)||0;day.revenue+=total;
      const payments=Array.isArray(sale.payments)?sale.payments:[];let paid=0;
      if(payments.length) payments.forEach(p=>{const method=String(p.method||'').toLowerCase(),amount=Number(p.amount||0);if(method==='cash')day.cash+=amount;else if(['card','tpe','bank_transfer','baridimob','baridi mob','baridi_mob'].includes(method))day.electronic+=amount;if(method!=='credit')paid+=amount;});
      else {paid=Number(sale.paid_amount??sale.amount_paid??sale.total_paid??0)||0;const method=String(sale.payment_method||sale.payment_mode||'').toLowerCase();if(method==='cash')day.cash+=paid;else if(['card','tpe','bank_transfer','baridimob','baridi mob','baridi_mob'].includes(method))day.electronic+=paid;}
      day.debt+=Math.max(0,Number(sale.payment_pending??sale.pending??(total-paid))||0);
      day.discounts+=Number(sale.discount_amount??sale.discount??sale.discount_total??0)||0;
    }
    return res.json({days:Array.from(grouped.values()).sort((a,b)=>b.date.localeCompare(a.date)),period:days,currency:req.companion.branch.currency||'DA'});
  } catch(error) { console.error('[Samarina Companion] daily dashboard report failed:',error); return fail(res,500,'Impossible de charger le rapport détaillé par jour.'); }
});

router.get('/owner/settings', async (req, res) => {
  if (!ownerAllowed(req.companion.user)) return fail(res, 403, 'Accès propriétaire requis.');
  const row = await req.db.collection('samarina_companion_settings').findOne({ branchId: oid(req.companion.branchId) || req.companion.branchId }) || {};
  res.json({ ownerPhone: row.ownerPhone || '', autoZReport: row.autoZReport === true });
});
router.put('/owner/settings', async (req, res) => {
  if (!ownerAllowed(req.companion.user)) return fail(res, 403, 'Accès propriétaire requis.');
  const ownerPhone = String(req.body?.ownerPhone || '').trim();
  if (ownerPhone && !/^\+?[0-9 ()-]{8,20}$/.test(ownerPhone)) return fail(res, 400, 'Numéro WhatsApp invalide.');
  await req.db.collection('samarina_companion_settings').updateOne(
    { branchId: oid(req.companion.branchId) || req.companion.branchId },
    { $set: { ownerPhone, autoZReport: req.body?.autoZReport === true, updatedAt: new Date() }, $setOnInsert: { createdAt: new Date() } },
    { upsert: true }
  );
  res.json({ ok: true });
});
router.post('/owner/z-report', async (req, res) => {
  try {
    if (!ownerAllowed(req.companion.user)) return fail(res, 403, 'Accès propriétaire requis.');
    const branchId = req.companion.branchId;
    const config = await req.db.collection('samarina_companion_settings').findOne({ branchId: oid(branchId) || branchId });
    if (!config?.ownerPhone) return fail(res, 400, 'Configurez le numéro WhatsApp du propriétaire dans les paramètres du compagnon.');
    const start = new Date(); start.setHours(0,0,0,0);
    const sales = await req.db.collection('sales').find({ branch_id: oid(branchId) || branchId, $or: [{ created_date: { $gte: start } }, { date: { $gte: start } }] }).limit(5000).toArray();
    const total = sales.reduce((sum, sale) => sum + (Number(sale.sales_total ?? sale.total ?? 0) || 0), 0);
    const branch = req.companion.branch, deviceId = branch.whatsapp_device_id || 'default_device';
    const sent = await require('../services/whatsapp.service').sendMessage(deviceId, branchId, config.ownerPhone,
      'Z-REPORT · ' + (branch.branch_name || branch.name || 'Magasin') + '\nVentes : ' + sales.length +
      '\nChiffre d’affaires : ' + total.toLocaleString('fr-DZ') + ' DA\nDate : ' + new Date().toLocaleString('fr-DZ'));
    if (!sent.status) return fail(res, 503, sent.message || 'Envoi WhatsApp indisponible.');
    res.json({ ok: true, message: 'Rapport Z envoyé au propriétaire.' });
  } catch (error) {
    console.error('[Samarina Companion] Z report failed:', error);
    fail(res, 500, 'Impossible d’envoyer le rapport Z.');
  }
});
module.exports = router;
