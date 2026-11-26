import { Router } from 'express';
import { withTenant } from '../db.js';
import { asyncH, requireRole } from '../middleware/auth.js';

const r = Router();
const billers = ['hospital_admin', 'billing', 'receptionist'];

r.get('/invoices', requireRole(...billers), asyncH(async (req, res) => {
  const rows = await withTenant(req.user.hospitalId, async (c) =>
    (await c.query(
      `SELECT i.id, i.total, i.paid, i.status, i.created_at, p.name AS patient
       FROM invoices i JOIN patients p ON p.id = i.patient_id ORDER BY i.created_at DESC LIMIT 100`)).rows);
  res.json(rows);
}));

r.post('/invoices', requireRole(...billers), asyncH(async (req, res) => {
  const { patientId, items } = req.body || {};
  if (!patientId || !Array.isArray(items) || !items.length) return res.status(400).json({ error: 'Patient and at least one item are required.' });
  const total = items.reduce((s, i) => s + Number(i.qty || 1) * Number(i.unitPrice), 0);
  const inv = await withTenant(req.user.hospitalId, async (c) => {
    const invoice = (await c.query(
      'INSERT INTO invoices (hospital_id, patient_id, total) VALUES ($1,$2,$3) RETURNING *',
      [req.user.hospitalId, patientId, total])).rows[0];
    for (const i of items)
      await c.query('INSERT INTO invoice_items (hospital_id, invoice_id, description, qty, unit_price) VALUES ($1,$2,$3,$4,$5)',
        [req.user.hospitalId, invoice.id, i.description, i.qty || 1, i.unitPrice]);
    return invoice;
  });
  res.status(201).json(inv);
}));

r.post('/invoices/:id/payments', requireRole(...billers), asyncH(async (req, res) => {
  const amount = Number(req.body.amount);
  if (!(amount > 0)) return res.status(400).json({ error: 'Enter a payment amount greater than zero.' });
  const inv = await withTenant(req.user.hospitalId, async (c) => {
    const cur = (await c.query('SELECT * FROM invoices WHERE id = $1 FOR UPDATE', [req.params.id])).rows[0];
    if (!cur) return null;
    const paid = Number(cur.paid) + amount;
    if (paid > Number(cur.total)) throw Object.assign(new Error('Payment is more than the balance due.'), { status: 400 });
    await c.query('INSERT INTO payments (hospital_id, invoice_id, amount, method) VALUES ($1,$2,$3,$4)',
      [req.user.hospitalId, cur.id, amount, req.body.method || 'cash']);
    return (await c.query(
      `UPDATE invoices SET paid = $1, status = CASE WHEN $1 >= total THEN 'paid' ELSE 'partial' END WHERE id = $2 RETURNING *`,
      [paid, cur.id])).rows[0];
  });
  inv ? res.json(inv) : res.status(404).json({ error: 'Invoice not found.' });
}));

export default r;
