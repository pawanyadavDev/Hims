import { Router } from 'express';
import { withTenant } from '../db.js';
import { asyncH, requireRole } from '../middleware/auth.js';

const r = Router();
const staff = ['hospital_admin', 'doctor', 'receptionist', 'nurse'];

r.get('/', requireRole(...staff), asyncH(async (req, res) => {
  const rows = await withTenant(req.user.hospitalId, async (c) =>
    (await c.query(
      `SELECT a.id, a.patient_id, a.scheduled_at, a.status, a.reason, p.name AS patient, p.uhid, u.name AS doctor
       FROM appointments a JOIN patients p ON p.id = a.patient_id LEFT JOIN users u ON u.id = a.doctor_id
       WHERE a.scheduled_at::date >= COALESCE($1::date, CURRENT_DATE) ORDER BY a.scheduled_at LIMIT 200`,
      [req.query.from || null])).rows);
  res.json(rows);
}));

r.post('/', requireRole('hospital_admin', 'receptionist'), asyncH(async (req, res) => {
  const { patientId, doctorId, scheduledAt, reason } = req.body || {};
  if (!patientId || !scheduledAt) return res.status(400).json({ error: 'Patient and appointment time are required.' });
  const row = await withTenant(req.user.hospitalId, async (c) =>
    (await c.query(
      `INSERT INTO appointments (hospital_id, patient_id, doctor_id, scheduled_at, reason)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [req.user.hospitalId, patientId, doctorId || null, scheduledAt, reason || null])).rows[0]);
  res.status(201).json(row);
}));

r.patch('/:id/status', requireRole(...staff), asyncH(async (req, res) => {
  const row = await withTenant(req.user.hospitalId, async (c) =>
    (await c.query('UPDATE appointments SET status = $1 WHERE id = $2 RETURNING *', [req.body.status, req.params.id])).rows[0]);
  row ? res.json(row) : res.status(404).json({ error: 'Appointment not found.' });
}));

export default r;
