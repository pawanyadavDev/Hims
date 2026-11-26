import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { pool } from '../db.js';
import { asyncH, authenticate } from '../middleware/auth.js';

const r = Router();

r.post('/login', asyncH(async (req, res) => {
  const { email, password } = req.body || {};
  const { rows } = await pool.query(
    `SELECT u.*, h.name AS hospital_name FROM users u
     LEFT JOIN hospitals h ON h.id = u.hospital_id
     WHERE u.email = $1 AND u.is_active AND (h.id IS NULL OR h.is_active)`, [String(email || '').toLowerCase()]);
  const u = rows[0];
  if (!u || !(await bcrypt.compare(password || '', u.password_hash)))
    return res.status(401).json({ error: 'Email or password is incorrect.' });
  const payload = { id: u.id, hospitalId: u.hospital_id, role: u.role, name: u.name };
  const token = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '8h' });
  res.json({ token, user: { ...payload, hospitalName: u.hospital_name } });
}));

r.post('/change-password', authenticate, asyncH(async (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (!newPassword || newPassword.length < 8) return res.status(400).json({ error: 'The new password must be at least 8 characters.' });
  const u = (await pool.query('SELECT password_hash FROM users WHERE id = $1', [req.user.id])).rows[0];
  if (!u || !(await bcrypt.compare(currentPassword || '', u.password_hash)))
    return res.status(400).json({ error: 'The current password is incorrect.' });
  await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [await bcrypt.hash(newPassword, 10), req.user.id]);
  res.json({ ok: true });
}));

export default r;
