import { Router } from 'express';
import { withTenant } from '../db.js';
import { asyncH, requireRole } from '../middleware/auth.js';
import { createLabOrder, bad } from '../lib/labOrders.js';

const r = Router();
const money = (n) => Math.round(n * 100) / 100;
const labStaff = requireRole('lab', 'hospital_admin');
const viewers = requireRole('lab', 'hospital_admin', 'doctor');
const orderers = requireRole('lab', 'hospital_admin', 'doctor', 'receptionist');

// ---------- Test catalog ----------

r.get('/tests', orderers, asyncH(async (req, res) => {
  const q = `%${req.query.q || ''}%`;
  const rows = await withTenant(req.user.hospitalId, async (c) =>
    (await c.query(
      `SELECT id, name, category, sample_type, unit, reference_range, unit_price FROM lab_tests
       WHERE is_active AND (name ILIKE $1 OR category ILIKE $1) ORDER BY category NULLS LAST, name LIMIT 300`, [q])).rows);
  res.json(rows);
}));

r.post('/tests', labStaff, asyncH(async (req, res) => {
  const { name, category, sampleType, unit, referenceRange, unitPrice } = req.body || {};
  if (!name || !name.trim()) throw bad('Test name is required.');
  if (unitPrice === '' || unitPrice == null || !(Number(unitPrice) >= 0)) throw bad('Enter the price for this test.');
  try {
    const row = await withTenant(req.user.hospitalId, async (c) =>
      (await c.query(
        `INSERT INTO lab_tests (hospital_id, name, category, sample_type, unit, reference_range, unit_price)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
        [req.user.hospitalId, name.trim(), category || null, sampleType || null, unit || null, referenceRange || null, Number(unitPrice)])).rows[0]);
    res.status(201).json(row);
  } catch (e) {
    if (e.code === '23505') throw bad('A test with this name already exists.', 409);
    throw e;
  }
}));

// ---------- Orders ----------

// Worklist and patient-wise reports: filter by status, patient, or search text.
r.get('/orders', viewers, asyncH(async (req, res) => {
  const q = `%${req.query.q || ''}%`;
  const rows = await withTenant(req.user.hospitalId, async (c) =>
    (await c.query(
      `SELECT o.id, o.order_no, o.status, o.priority, o.notes, o.created_at, o.collected_at, o.completed_at,
              p.id AS patient_id, p.name AS patient, p.uhid, u.name AS ordered_by,
              i.status AS invoice_status, i.total AS invoice_total, i.paid AS invoice_paid,
              COALESCE((SELECT json_agg(json_build_object('id', x.id, 'test_name', x.test_name, 'unit', x.unit,
                'reference_range', x.reference_range, 'unit_price', x.unit_price, 'status', x.status,
                'result_value', x.result_value, 'result_flag', x.result_flag, 'remarks', x.remarks) ORDER BY x.test_name)
                FROM lab_order_items x WHERE x.order_id = o.id), '[]') AS items
       FROM lab_orders o
       JOIN patients p ON p.id = o.patient_id
       LEFT JOIN users u ON u.id = o.ordered_by
       LEFT JOIN invoices i ON i.id = o.invoice_id
       WHERE ($1::uuid IS NULL OR o.patient_id = $1)
         AND ($2::text IS NULL OR o.status = $2)
         AND ($3 = '%%' OR p.name ILIKE $3 OR p.uhid ILIKE $3 OR o.order_no ILIKE $3)
       ORDER BY (o.priority = 'urgent' AND o.status IN ('ordered','collected')) DESC, o.created_at DESC LIMIT 100`,
      [req.query.patientId || null, req.query.status || null, q])).rows);
  res.json(rows);
}));

r.post('/orders', orderers, asyncH(async (req, res) => {
  const { patientId, consultationId, testIds, priority = 'routine', notes } = req.body || {};
  if (!patientId) throw bad('Select a patient.');
  if (!Array.isArray(testIds) || !testIds.length) throw bad('Select at least one test.');
  if (!['routine', 'urgent'].includes(priority)) throw bad('Priority must be routine or urgent.');
  const order = await withTenant(req.user.hospitalId, async (c) => {
    if (!(await c.query('SELECT 1 FROM patients WHERE id = $1', [patientId])).rowCount) throw bad('Patient not found.', 404);
    return createLabOrder(c, { hospitalId: req.user.hospitalId, userId: req.user.id, patientId, consultationId: consultationId || null, testIds, priority, notes });
  });
  res.status(201).json(order);
}));

// Collect the sample and bill: creates the invoice (visible under Billing & payment) and optionally takes payment.
r.post('/orders/:id/collect', labStaff, asyncH(async (req, res) => {
  const { discount = 0, paidAmount = 0, method = 'cash' } = req.body || {};
  const disc = Number(discount) || 0;
  const paid = Number(paidAmount) || 0;
  if (disc < 0 || paid < 0) throw bad('Discount and payment cannot be negative.');

  const out = await withTenant(req.user.hospitalId, async (c) => {
    const hid = req.user.hospitalId;
    const o = (await c.query('SELECT * FROM lab_orders WHERE id = $1 FOR UPDATE', [req.params.id])).rows[0];
    if (!o) throw bad('Order not found.', 404);
    if (o.status !== 'ordered') throw bad('The sample was already collected, or this order was cancelled.', 409);

    const items = (await c.query('SELECT test_name, unit_price FROM lab_order_items WHERE order_id = $1', [o.id])).rows;
    const subtotal = money(items.reduce((s, i) => s + Number(i.unit_price), 0));
    if (disc > subtotal) throw bad('Discount cannot be more than the subtotal.');
    const total = money(subtotal - disc);
    if (paid > total) throw bad('Payment is more than the total due.');
    const status = paid >= total ? 'paid' : paid > 0 ? 'partial' : 'unpaid';

    const inv = (await c.query(
      'INSERT INTO invoices (hospital_id, patient_id, total, paid, status) VALUES ($1,$2,$3,$4,$5) RETURNING *',
      [hid, o.patient_id, total, paid, status])).rows[0];
    for (const i of items)
      await c.query('INSERT INTO invoice_items (hospital_id, invoice_id, description, qty, unit_price) VALUES ($1,$2,$3,1,$4)', [hid, inv.id, i.test_name, i.unit_price]);
    if (disc > 0)
      await c.query(`INSERT INTO invoice_items (hospital_id, invoice_id, description, qty, unit_price) VALUES ($1,$2,'Discount',1,$3)`, [hid, inv.id, -disc]);
    if (paid > 0)
      await c.query('INSERT INTO payments (hospital_id, invoice_id, amount, method) VALUES ($1,$2,$3,$4)', [hid, inv.id, paid, method]);

    await c.query(`UPDATE lab_orders SET status = 'collected', collected_at = now(), invoice_id = $1 WHERE id = $2`, [inv.id, o.id]);
    await c.query(`INSERT INTO audit_logs (hospital_id, user_id, action, entity, entity_id) VALUES ($1,$2,'collect_sample','lab_order',$3)`, [hid, req.user.id, o.id]);
    return { id: o.id, total, invoice_status: status };
  });
  res.json(out);
}));

// Enter or correct one test result. The order completes automatically when every test has a result.
r.patch('/orders/:id/items/:itemId/result', labStaff, asyncH(async (req, res) => {
  const { resultValue, flag = '', remarks } = req.body || {};
  if (!resultValue || !String(resultValue).trim()) throw bad('Enter a result value.');
  if (!['', 'normal', 'low', 'high', 'abnormal'].includes(flag)) throw bad('Choose a valid flag.');

  const out = await withTenant(req.user.hospitalId, async (c) => {
    const o = (await c.query('SELECT status FROM lab_orders WHERE id = $1 FOR UPDATE', [req.params.id])).rows[0];
    if (!o) throw bad('Order not found.', 404);
    if (!['collected', 'completed'].includes(o.status)) throw bad('Collect the sample before entering results.', 409);
    const u = await c.query(
      `UPDATE lab_order_items SET status = 'resulted', result_value = $1, result_flag = $2, remarks = $3, resulted_by = $4, resulted_at = now()
       WHERE id = $5 AND order_id = $6`,
      [String(resultValue).trim(), flag || null, remarks || null, req.user.id, req.params.itemId, req.params.id]);
    if (!u.rowCount) throw bad('Test not found on this order.', 404);
    const pending = Number((await c.query(`SELECT count(*) AS n FROM lab_order_items WHERE order_id = $1 AND status = 'pending'`, [req.params.id])).rows[0].n);
    const status = pending === 0 ? 'completed' : 'collected';
    await c.query(
      `UPDATE lab_orders SET status = $1::text, completed_at = CASE WHEN $1::text = 'completed' THEN COALESCE(completed_at, now()) ELSE NULL END WHERE id = $2`,
      [status, req.params.id]);
    return { status };
  });
  res.json(out);
}));

// Orders can be cancelled until the sample is collected.
r.post('/orders/:id/cancel', viewers, asyncH(async (req, res) => {
  const row = await withTenant(req.user.hospitalId, async (c) =>
    (await c.query(`UPDATE lab_orders SET status = 'cancelled' WHERE id = $1 AND status = 'ordered' RETURNING id`, [req.params.id])).rows[0]);
  if (!row) throw bad('Only orders that are still waiting for a sample can be cancelled.', 409);
  res.json({ id: row.id, status: 'cancelled' });
}));

export default r;
