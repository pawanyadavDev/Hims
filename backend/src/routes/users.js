import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { pool } from '../db.js';
import { asyncH, requireRole } from '../middleware/auth.js';
import { bad } from '../lib/util.js';

const r = Router();
export const STAFF_ROLES = ['hospital_admin', 'doctor', 'receptionist', 'nurse', 'billing', 'lab', 'pharmacist'];
const admin = requireRole('hospital_admin');

// Pickers (e.g. choose a doctor) get a minimal list; the admin's staff screen gets emails and status too.
// users is not under RLS, so every query filters by hospital_id here.
r.get('/', requireRole(...STAFF_ROLES), asyncH(async (req, res) => {
  const full = req.user.role === 'hospital_admin' && req.query.all === '1';
  const { rows } = await pool.query(
    `SELECT id, name, role${full ? ', email, is_active' : ''} FROM users
     WHERE hospital_id = $1 AND ($2::text IS NULL OR role = $2) ${full ? '' : 'AND is_active'} ORDER BY name`,
    [req.user.hospitalId, req.query.role || null]);
  res.json(rows);
}));

r.post('/', admin, asyncH(async (req, res) => {
  const { name, email, password, role } = req.body || {};
  if (!name || !name.trim()) throw bad('Name is required.');
  if (!/^\S+@\S+\.\S+$/.test(email || '')) throw bad('Enter a valid email address.');
  if (!STAFF_ROLES.includes(role)) throw bad('Choose a role.');
  if (!password || password.length < 8) throw bad('Password must be at least 8 characters.');
  try {
    const { rows } = await pool.query(
      `INSERT INTO users (hospital_id, name, email, password_hash, role) VALUES ($1,$2,$3,$4,$5) RETURNING id, name, email, role, is_active`,
      [req.user.hospitalId, name.trim(), email.toLowerCase(), await bcrypt.hash(password, 10), role]);
    res.status(201).json(rows[0]);
  } catch (e) { throw e.code === '23505' ? bad('That email is already in use.', 409) : e; }
}));

// Activate/deactivate, change role, or reset a password.
r.patch('/:id', admin, asyncH(async (req, res) => {
  const { isActive, role, password } = req.body || {};
  if (req.params.id === req.user.id && (isActive === false || (role && role !== req.user.role)))
    throw bad('You cannot deactivate yourself or change your own role.');
  if (role !== undefined && !STAFF_ROLES.includes(role)) throw bad('Choose a valid role.');
  if (password !== undefined && password.length < 8) throw bad('Password must be at least 8 characters.');
  const { rows } = await pool.query(
    `UPDATE users SET is_active = COALESCE($1, is_active), role = COALESCE($2, role), password_hash = COALESCE($3, password_hash)
     WHERE id = $4 AND hospital_id = $5 RETURNING id, name, email, role, is_active`,
    [typeof isActive === 'boolean' ? isActive : null, role || null, password ? await bcrypt.hash(password, 10) : null, req.params.id, req.user.hospitalId]);
  rows[0] ? res.json(rows[0]) : res.status(404).json({ error: 'User not found.' });
}));

export default r;
