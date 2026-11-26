import { Router } from 'express';
import { withTenant } from '../db.js';
import { asyncH, requireRole } from '../middleware/auth.js';
import { bad, money, refNo } from '../lib/util.js';

const r = Router();
const manage = requireRole('hospital_admin', 'pharmacist');
const staff = requireRole('hospital_admin', 'pharmacist', 'nurse', 'lab', 'doctor');

// The only place stock changes: updates the quantity (never below zero) and writes the ledger entry.
async function move(c, { hospitalId, userId, itemId, change, reason, reference = null, note = null }) {
  const row = (await c.query(
    'UPDATE inventory_items SET qty_on_hand = qty_on_hand + $1 WHERE id = $2 AND qty_on_hand + $1 >= 0 RETURNING qty_on_hand', [change, itemId])).rows[0];
  if (!row) throw bad('Not enough stock, or the item was not found.', 409);
  await c.query(
    'INSERT INTO stock_movements (hospital_id, item_id, change, reason, reference, note, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7)',
    [hospitalId, itemId, change, reason, reference, note, userId]);
  return row.qty_on_hand;
}

// ---------- Items ----------

r.get('/items', staff, asyncH(async (req, res) => {
  const q = `%${req.query.q || ''}%`;
  const rows = await withTenant(req.user.hospitalId, async (c) =>
    (await c.query(
      `SELECT id, name, category, unit, qty_on_hand, reorder_level FROM inventory_items
       WHERE is_active AND (name ILIKE $1 OR category ILIKE $1) ORDER BY name LIMIT 300`, [q])).rows);
  res.json(rows);
}));

r.post('/items', manage, asyncH(async (req, res) => {
  const { name, category, unit = 'pcs', reorderLevel = 10, openingQty = 0 } = req.body || {};
  if (!name || !name.trim()) throw bad('Item name is required.');
  const open = Number(openingQty) || 0;
  if (!Number.isInteger(open) || open < 0) throw bad('Opening quantity must be a whole number, zero or more.');
  try {
    const row = await withTenant(req.user.hospitalId, async (c) => {
      const item = (await c.query(
        'INSERT INTO inventory_items (hospital_id, name, category, unit, reorder_level) VALUES ($1,$2,$3,$4,$5) RETURNING *',
        [req.user.hospitalId, name.trim(), category || null, unit || 'pcs', Number(reorderLevel) || 0])).rows[0];
      if (open > 0) item.qty_on_hand = await move(c, { hospitalId: req.user.hospitalId, userId: req.user.id, itemId: item.id, change: open, reason: 'receipt', reference: 'Opening stock' });
      return item;
    });
    res.status(201).json(row);
  } catch (e) { throw e.code === '23505' ? bad('An item with this name already exists.', 409) : e; }
}));

r.post('/items/:id/issue', staff, asyncH(async (req, res) => {
  const qty = Number(req.body?.qty);
  if (!Number.isInteger(qty) || qty <= 0) throw bad('Enter a whole-number quantity greater than zero.');
  const left = await withTenant(req.user.hospitalId, (c) =>
    move(c, { hospitalId: req.user.hospitalId, userId: req.user.id, itemId: req.params.id, change: -qty, reason: 'issue', note: req.body.note }));
  res.json({ qty_on_hand: left });
}));

// Stock count: set the real quantity; the difference is recorded as an adjustment.
r.post('/items/:id/adjust', manage, asyncH(async (req, res) => {
  const counted = Number(req.body?.countedQty);
  if (!Number.isInteger(counted) || counted < 0) throw bad('Enter the counted quantity as a whole number, zero or more.');
  const left = await withTenant(req.user.hospitalId, async (c) => {
    const cur = (await c.query('SELECT qty_on_hand FROM inventory_items WHERE id = $1 FOR UPDATE', [req.params.id])).rows[0];
    if (!cur) throw bad('Item not found.', 404);
    if (counted === cur.qty_on_hand) return cur.qty_on_hand;
    return move(c, { hospitalId: req.user.hospitalId, userId: req.user.id, itemId: req.params.id, change: counted - cur.qty_on_hand, reason: 'adjustment', note: req.body.note || 'Stock count' });
  });
  res.json({ qty_on_hand: left });
}));

r.get('/alerts', staff, asyncH(async (req, res) => {
  const rows = await withTenant(req.user.hospitalId, async (c) =>
    (await c.query('SELECT id, name, unit, qty_on_hand, reorder_level FROM inventory_items WHERE is_active AND qty_on_hand <= reorder_level ORDER BY qty_on_hand, name')).rows);
  res.json(rows);
}));

r.get('/movements', staff, asyncH(async (req, res) => {
  const rows = await withTenant(req.user.hospitalId, async (c) =>
    (await c.query(
      `SELECT m.id, m.created_at, m.change, m.reason, m.reference, m.note, i.name AS item, i.unit, u.name AS by
       FROM stock_movements m JOIN inventory_items i ON i.id = m.item_id LEFT JOIN users u ON u.id = m.created_by
       WHERE ($1::uuid IS NULL OR m.item_id = $1) ORDER BY m.created_at DESC LIMIT 100`, [req.query.itemId || null])).rows);
  res.json(rows);
}));

// ---------- Suppliers ----------

r.get('/suppliers', staff, asyncH(async (req, res) => {
  const rows = await withTenant(req.user.hospitalId, async (c) =>
    (await c.query('SELECT id, name, phone, email, address FROM suppliers WHERE is_active ORDER BY name')).rows);
  res.json(rows);
}));

r.post('/suppliers', manage, asyncH(async (req, res) => {
  const { name, phone, email, address } = req.body || {};
  if (!name || !name.trim()) throw bad('Supplier name is required.');
  try {
    const row = await withTenant(req.user.hospitalId, async (c) =>
      (await c.query('INSERT INTO suppliers (hospital_id, name, phone, email, address) VALUES ($1,$2,$3,$4,$5) RETURNING *',
        [req.user.hospitalId, name.trim(), phone || null, email || null, address || null])).rows[0]);
    res.status(201).json(row);
  } catch (e) { throw e.code === '23505' ? bad('A supplier with this name already exists.', 409) : e; }
}));

// ---------- Purchase orders ----------

r.get('/purchase-orders', staff, asyncH(async (req, res) => {
  const rows = await withTenant(req.user.hospitalId, async (c) =>
    (await c.query(
      `SELECT po.id, po.po_no, po.status, po.total, po.notes, po.created_at, po.received_at, s.name AS supplier,
              COALESCE((SELECT json_agg(json_build_object('item', i.name, 'unit', i.unit, 'qty', x.qty, 'unit_cost', x.unit_cost) ORDER BY i.name)
                FROM purchase_order_items x JOIN inventory_items i ON i.id = x.item_id WHERE x.po_id = po.id), '[]') AS items
       FROM purchase_orders po JOIN suppliers s ON s.id = po.supplier_id ORDER BY po.created_at DESC LIMIT 100`)).rows);
  res.json(rows);
}));

r.post('/purchase-orders', manage, asyncH(async (req, res) => {
  const { supplierId, items, notes } = req.body || {};
  if (!supplierId) throw bad('Select a supplier.');
  if (!Array.isArray(items) || !items.length) throw bad('Add at least one item.');
  for (const i of items)
    if (!i.itemId || !Number.isInteger(Number(i.qty)) || Number(i.qty) < 1 || !(Number(i.unitCost) >= 0) || i.unitCost === '')
      throw bad('Each line needs an item, a whole-number quantity and a unit cost.');
  const total = money(items.reduce((s, i) => s + Number(i.qty) * Number(i.unitCost), 0));
  const row = await withTenant(req.user.hospitalId, async (c) => {
    const hid = req.user.hospitalId;
    if (!(await c.query('SELECT 1 FROM suppliers WHERE id = $1', [supplierId])).rowCount) throw bad('Supplier not found.', 404);
    const po = (await c.query(
      'INSERT INTO purchase_orders (hospital_id, po_no, supplier_id, total, notes, created_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *',
      [hid, refNo('PO'), supplierId, total, notes || null, req.user.id])).rows[0];
    for (const i of items) {
      if (!(await c.query('SELECT 1 FROM inventory_items WHERE id = $1', [i.itemId])).rowCount) throw bad('An item on this order no longer exists.', 404);
      await c.query('INSERT INTO purchase_order_items (hospital_id, po_id, item_id, qty, unit_cost) VALUES ($1,$2,$3,$4,$5)', [hid, po.id, i.itemId, Number(i.qty), Number(i.unitCost)]);
    }
    return po;
  });
  res.status(201).json(row);
}));

// Receiving adds every line to stock and records it in the ledger, all in one step.
r.post('/purchase-orders/:id/receive', manage, asyncH(async (req, res) => {
  await withTenant(req.user.hospitalId, async (c) => {
    const po = (await c.query('SELECT * FROM purchase_orders WHERE id = $1 FOR UPDATE', [req.params.id])).rows[0];
    if (!po) throw bad('Purchase order not found.', 404);
    if (po.status !== 'ordered') throw bad('This order was already received or cancelled.', 409);
    const lines = (await c.query('SELECT item_id, qty FROM purchase_order_items WHERE po_id = $1', [po.id])).rows;
    for (const l of lines)
      await move(c, { hospitalId: req.user.hospitalId, userId: req.user.id, itemId: l.item_id, change: l.qty, reason: 'receipt', reference: po.po_no });
    await c.query(`UPDATE purchase_orders SET status = 'received', received_at = now() WHERE id = $1`, [po.id]);
  });
  res.json({ ok: true });
}));

r.post('/purchase-orders/:id/cancel', manage, asyncH(async (req, res) => {
  const row = await withTenant(req.user.hospitalId, async (c) =>
    (await c.query(`UPDATE purchase_orders SET status = 'cancelled' WHERE id = $1 AND status = 'ordered' RETURNING id`, [req.params.id])).rows[0]);
  if (!row) throw bad('Only orders that are still open can be cancelled.', 409);
  res.json({ ok: true });
}));

export default r;
