import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { pool } from '../db.js';
import { asyncH, requireRole } from '../middleware/auth.js';

const r = Router();
r.use(requireRole('super_admin'));

r.get('/', asyncH(async (_req, res) => {
  const { rows } = await pool.query('SELECT id, name, code, is_active, created_at FROM hospitals ORDER BY created_at DESC');
  res.json(rows);
}));

// Onboard a new hospital together with its first admin.
r.post('/', asyncH(async (req, res) => {
  const { name, code, adminName, adminEmail, adminPassword } = req.body || {};
  if (!name || !code || !adminEmail || !adminPassword) return res.status(400).json({ error: 'Name, code, admin email and password are required.' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const h = await client.query('INSERT INTO hospitals (name, code) VALUES ($1,$2) RETURNING *', [name, code.toLowerCase()]);
    await client.query(
      `INSERT INTO users (hospital_id, name, email, password_hash, role) VALUES ($1,$2,$3,$4,'hospital_admin')`,
      [h.rows[0].id, adminName || 'Hospital Admin', adminEmail.toLowerCase(), await bcrypt.hash(adminPassword, 10)]);
    await client.query('COMMIT');
    res.status(201).json(h.rows[0]);
  } catch (e) {
    await client.query('ROLLBACK');
    if (e.code === '23505') return res.status(409).json({ error: 'That hospital code or email is already in use.' });
    throw e;
  } finally { client.release(); }
}));

r.patch('/:id', asyncH(async (req, res) => {
  if (typeof req.body?.isActive !== 'boolean') return res.status(400).json({ error: 'Send isActive as true or false.' });
  const { rows } = await pool.query('UPDATE hospitals SET is_active = $1 WHERE id = $2 RETURNING id, name, code, is_active', [req.body.isActive, req.params.id]);
  rows[0] ? res.json(rows[0]) : res.status(404).json({ error: 'Hospital not found.' });
}));

export default r;
