import { Router } from 'express';
import { withTenant } from '../db.js';
import { asyncH, requireRole } from '../middleware/auth.js';

const r = Router();
const staff = ['hospital_admin', 'doctor', 'receptionist', 'nurse', 'billing', 'pharmacist', 'lab'];

r.get('/', requireRole(...staff), asyncH(async (req, res) => {
  const q = `%${req.query.q || ''}%`;
  const rows = await withTenant(req.user.hospitalId, async (c) =>
    (await c.query(
      `SELECT id, uhid, name, gender, dob, phone, created_at FROM patients
       WHERE name ILIKE $1 OR uhid ILIKE $1 OR phone ILIKE $1 ORDER BY created_at DESC LIMIT 100`, [q])).rows);
  res.json(rows);
}));

r.post('/', requireRole('hospital_admin', 'receptionist', 'doctor'), asyncH(async (req, res) => {
  const { name, gender, dob, phone, address } = req.body || {};
  if (!name) return res.status(400).json({ error: 'Patient name is required.' });
  const uhid = 'UH' + Date.now().toString(36).toUpperCase();
  const row = await withTenant(req.user.hospitalId, async (c) => {
    const p = (await c.query(
      `INSERT INTO patients (hospital_id, uhid, name, gender, dob, phone, address)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [req.user.hospitalId, uhid, name, gender || null, dob || null, phone || null, address || null])).rows[0];
    await c.query(`INSERT INTO audit_logs (hospital_id, user_id, action, entity, entity_id) VALUES ($1,$2,'create','patient',$3)`,
      [req.user.hospitalId, req.user.id, p.id]);
    return p;
  });
  res.status(201).json(row);
}));

r.get('/:id', requireRole(...staff), asyncH(async (req, res) => {
  const p = await withTenant(req.user.hospitalId, async (c) =>
    (await c.query('SELECT * FROM patients WHERE id = $1', [req.params.id])).rows[0]);
  p ? res.json(p) : res.status(404).json({ error: 'Patient not found.' });
}));

export default r;
