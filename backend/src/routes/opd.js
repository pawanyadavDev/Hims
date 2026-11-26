import { Router } from 'express';
import { withTenant } from '../db.js';
import { asyncH, requireRole } from '../middleware/auth.js';
import { createLabOrder } from '../lib/labOrders.js';

const r = Router();
const clinical = ['hospital_admin', 'doctor', 'nurse'];

// Recent consultations (optionally for one patient), with prescription items.
r.get('/consultations', requireRole(...clinical), asyncH(async (req, res) => {
  const rows = await withTenant(req.user.hospitalId, async (c) =>
    (await c.query(
      `SELECT c.id, c.created_at, c.vitals, c.complaints, c.diagnosis, c.notes, c.follow_up_date,
              p.name AS patient, p.uhid, u.name AS doctor,
              COALESCE((SELECT json_agg(json_build_object('medicine', i.medicine, 'dosage', i.dosage,
                'frequency', i.frequency, 'duration', i.duration, 'instructions', i.instructions))
                FROM prescription_items i WHERE i.consultation_id = c.id), '[]') AS prescription,
              COALESCE((SELECT json_agg(json_build_object('order_no', o.order_no, 'status', o.status, 'tests',
                (SELECT json_agg(json_build_object('name', x.test_name, 'result', x.result_value, 'unit', x.unit, 'flag', x.result_flag) ORDER BY x.test_name)
                 FROM lab_order_items x WHERE x.order_id = o.id))) FROM lab_orders o WHERE o.consultation_id = c.id), '[]') AS lab
       FROM consultations c JOIN patients p ON p.id = c.patient_id JOIN users u ON u.id = c.doctor_id
       WHERE ($1::uuid IS NULL OR c.patient_id = $1) ORDER BY c.created_at DESC LIMIT 50`,
      [req.query.patientId || null])).rows);
  res.json(rows);
}));

// A doctor records a consultation and its prescription in one step.
r.post('/consultations', requireRole('doctor'), asyncH(async (req, res) => {
  const { patientId, appointmentId, vitals, complaints, diagnosis, notes, followUpDate, prescription = [], labTests = [] } = req.body || {};
  if (!patientId) return res.status(400).json({ error: 'Select a patient first.' });
  if (!complaints && !diagnosis) return res.status(400).json({ error: 'Enter complaints or a diagnosis.' });
  const meds = prescription.filter((m) => m.medicine && m.medicine.trim());

  const row = await withTenant(req.user.hospitalId, async (c) => {
    const con = (await c.query(
      `INSERT INTO consultations (hospital_id, patient_id, appointment_id, doctor_id, vitals, complaints, diagnosis, notes, follow_up_date)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [req.user.hospitalId, patientId, appointmentId || null, req.user.id, vitals || {}, complaints || null,
       diagnosis || null, notes || null, followUpDate || null])).rows[0];
    for (const m of meds)
      await c.query(
        `INSERT INTO prescription_items (hospital_id, consultation_id, medicine, dosage, frequency, duration, instructions)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [req.user.hospitalId, con.id, m.medicine.trim(), m.dosage || null, m.frequency || null, m.duration || null, m.instructions || null]);
    if (Array.isArray(labTests) && labTests.length)
      await createLabOrder(c, { hospitalId: req.user.hospitalId, userId: req.user.id, patientId, consultationId: con.id, testIds: labTests });
    if (appointmentId) await c.query(`UPDATE appointments SET status = 'completed' WHERE id = $1`, [appointmentId]);
    await c.query(`INSERT INTO audit_logs (hospital_id, user_id, action, entity, entity_id) VALUES ($1,$2,'create','consultation',$3)`,
      [req.user.hospitalId, req.user.id, con.id]);
    return con;
  });
  res.status(201).json(row);
}));

export default r;
