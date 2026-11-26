import { Router } from 'express';
import { withTenant } from '../db.js';
import { asyncH, requireRole } from '../middleware/auth.js';
import { bad, money, refNo } from '../lib/util.js';

const r = Router();
const ipdStaff = requireRole('hospital_admin', 'doctor', 'nurse', 'receptionist');
const clinical = requireRole('hospital_admin', 'doctor', 'nurse');
const discharger = requireRole('hospital_admin', 'doctor');

// Postgres unique indexes guarantee "one open admission per patient" and "one patient per bed".
const friendly = (e) => {
  if (e.code === '23505' && e.constraint === 'one_active_admission_per_patient') return bad('This patient is already admitted.', 409);
  if (e.code === '23505' && e.constraint === 'one_active_allocation_per_bed') return bad('That bed is already occupied.', 409);
  if (e.code === '23505') return bad('That already exists.', 409);
  return e;
};

// Bed billing rule: every full 24 hours in a bed is charged at that ward's daily rate. The final bed is charged
// for at least one day, so a same-day transfer is not billed twice.
export function bedLines(stays, now = new Date()) {
  return stays.map((s, idx) => {
    const end = s.to_at ? new Date(s.to_at) : now;
    const hours = (end - new Date(s.from_at)) / 36e5;
    const last = idx === stays.length - 1;
    const days = last ? Math.max(1, Math.ceil(hours / 24)) : Math.floor(hours / 24);
    return { description: `Bed charges: ${s.ward} ${s.bed_no}`, qty: days, unit_price: Number(s.daily_rate) };
  }).filter((l) => l.qty > 0);
}

const BASE = `SELECT ad.id, ad.admission_no, ad.status, ad.admitted_at, ad.discharged_at, ad.reason, ad.diagnosis, ad.discharge_summary,
    p.id AS patient_id, p.name AS patient, p.uhid, p.gender, p.dob, u.name AS doctor, w.name AS ward, b.bed_no,
    i.status AS invoice_status, i.total AS invoice_total
  FROM admissions ad
  JOIN patients p ON p.id = ad.patient_id
  LEFT JOIN users u ON u.id = ad.doctor_id
  LEFT JOIN bed_allocations al ON al.admission_id = ad.id AND al.to_at IS NULL
  LEFT JOIN beds b ON b.id = al.bed_id
  LEFT JOIN wards w ON w.id = b.ward_id
  LEFT JOIN invoices i ON i.id = ad.invoice_id`;

const staysOf = async (c, admissionId) => (await c.query(
  `SELECT a.from_at, a.to_at, a.daily_rate, b.bed_no, w.name AS ward
   FROM bed_allocations a JOIN beds b ON b.id = a.bed_id JOIN wards w ON w.id = b.ward_id
   WHERE a.admission_id = $1 ORDER BY a.from_at`, [admissionId])).rows;

// ---------- Wards and beds ----------

r.get('/wards', ipdStaff, asyncH(async (req, res) => {
  const rows = await withTenant(req.user.hospitalId, async (c) =>
    (await c.query(
      `SELECT w.id, w.name, w.type, w.daily_rate,
              COALESCE(json_agg(json_build_object('id', b.id, 'bed_no', b.bed_no, 'admission_id', ad.id, 'patient', p.name, 'uhid', p.uhid)
                ORDER BY b.bed_no) FILTER (WHERE b.id IS NOT NULL), '[]') AS beds
       FROM wards w
       LEFT JOIN beds b ON b.ward_id = w.id AND b.is_active
       LEFT JOIN bed_allocations al ON al.bed_id = b.id AND al.to_at IS NULL
       LEFT JOIN admissions ad ON ad.id = al.admission_id
       LEFT JOIN patients p ON p.id = ad.patient_id
       WHERE w.is_active GROUP BY w.id ORDER BY w.name`)).rows);
  res.json(rows);
}));

r.post('/wards', requireRole('hospital_admin'), asyncH(async (req, res) => {
  const { name, type = 'General', dailyRate } = req.body || {};
  if (!name || !name.trim()) throw bad('Ward name is required.');
  if (dailyRate === '' || dailyRate == null || !(Number(dailyRate) >= 0)) throw bad('Enter the daily bed rate.');
  try {
    const row = await withTenant(req.user.hospitalId, async (c) =>
      (await c.query('INSERT INTO wards (hospital_id, name, type, daily_rate) VALUES ($1,$2,$3,$4) RETURNING *',
        [req.user.hospitalId, name.trim(), type, Number(dailyRate)])).rows[0]);
    res.status(201).json(row);
  } catch (e) { throw e.code === '23505' ? bad('A ward with this name already exists.', 409) : e; }
}));

r.post('/wards/:id/beds', requireRole('hospital_admin'), asyncH(async (req, res) => {
  const bedNos = (req.body?.bedNos || []).map((b) => String(b).trim()).filter(Boolean);
  if (!bedNos.length || bedNos.length > 100) throw bad('Enter between 1 and 100 bed numbers.');
  try {
    await withTenant(req.user.hospitalId, async (c) => {
      if (!(await c.query('SELECT 1 FROM wards WHERE id = $1', [req.params.id])).rowCount) throw bad('Ward not found.', 404);
      for (const n of bedNos) await c.query('INSERT INTO beds (hospital_id, ward_id, bed_no) VALUES ($1,$2,$3)', [req.user.hospitalId, req.params.id, n]);
    });
    res.status(201).json({ added: bedNos.length });
  } catch (e) { throw e.code === '23505' ? bad('Some of these bed numbers already exist in this ward.', 409) : e; }
}));

// ---------- Admissions ----------

r.get('/admissions', ipdStaff, asyncH(async (req, res) => {
  const rows = await withTenant(req.user.hospitalId, async (c) =>
    (await c.query(
      `${BASE} WHERE ($1::text IS NULL OR ad.status = $1)
         AND ($2 = '%%' OR p.name ILIKE $2 OR p.uhid ILIKE $2 OR ad.admission_no ILIKE $2)
       ORDER BY ad.admitted_at DESC LIMIT 100`, [req.query.status || null, `%${req.query.q || ''}%`])).rows);
  res.json(rows);
}));

r.get('/admissions/:id', ipdStaff, asyncH(async (req, res) => {
  const out = await withTenant(req.user.hospitalId, async (c) => {
    const admission = (await c.query(`${BASE} WHERE ad.id = $1`, [req.params.id])).rows[0];
    if (!admission) throw bad('Admission not found.', 404);
    const stays = await staysOf(c, admission.id);
    const notes = (await c.query(
      `SELECT n.id, n.note, n.vitals, n.created_at, u.name AS by FROM care_notes n LEFT JOIN users u ON u.id = n.created_by
       WHERE n.admission_id = $1 ORDER BY n.created_at DESC`, [admission.id])).rows;
    const charges = (await c.query(
      'SELECT id, description, qty, unit_price, created_at FROM admission_charges WHERE admission_id = $1 ORDER BY created_at', [admission.id])).rows;
    const lines = [...bedLines(stays), ...charges.map((x) => ({ description: x.description, qty: x.qty, unit_price: Number(x.unit_price) }))];
    const subtotal = money(lines.reduce((s, l) => s + l.qty * l.unit_price, 0));
    return { admission, stays, notes, charges, billing: { lines, subtotal } };
  });
  res.json(out);
}));

r.post('/admissions', ipdStaff, asyncH(async (req, res) => {
  const { patientId, doctorId, bedId, reason, diagnosis } = req.body || {};
  if (!patientId) throw bad('Select a patient.');
  if (!bedId) throw bad('Select a bed.');
  try {
    const row = await withTenant(req.user.hospitalId, async (c) => {
      const hid = req.user.hospitalId;
      if (!(await c.query('SELECT 1 FROM patients WHERE id = $1', [patientId])).rowCount) throw bad('Patient not found.', 404);
      const bed = (await c.query(
        'SELECT b.id, w.daily_rate FROM beds b JOIN wards w ON w.id = b.ward_id WHERE b.id = $1 AND b.is_active AND w.is_active', [bedId])).rows[0];
      if (!bed) throw bad('Bed not found.', 404);
      const adm = (await c.query(
        `INSERT INTO admissions (hospital_id, admission_no, patient_id, doctor_id, reason, diagnosis, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
        [hid, refNo('AD'), patientId, doctorId || null, reason || null, diagnosis || null, req.user.id])).rows[0];
      await c.query('INSERT INTO bed_allocations (hospital_id, admission_id, bed_id, daily_rate) VALUES ($1,$2,$3,$4)', [hid, adm.id, bed.id, bed.daily_rate]);
      await c.query(`INSERT INTO audit_logs (hospital_id, user_id, action, entity, entity_id) VALUES ($1,$2,'admit','admission',$3)`, [hid, req.user.id, adm.id]);
      return adm;
    });
    res.status(201).json(row);
  } catch (e) { throw friendly(e); }
}));

// Lock the admission row and make sure it is still open.
async function openAdmission(c, id) {
  const a = (await c.query('SELECT * FROM admissions WHERE id = $1 FOR UPDATE', [id])).rows[0];
  if (!a) throw bad('Admission not found.', 404);
  if (a.status !== 'admitted') throw bad('This patient has already been discharged.', 409);
  return a;
}

r.post('/admissions/:id/transfer', ipdStaff, asyncH(async (req, res) => {
  const { bedId } = req.body || {};
  if (!bedId) throw bad('Select the new bed.');
  try {
    await withTenant(req.user.hospitalId, async (c) => {
      await openAdmission(c, req.params.id);
      const bed = (await c.query('SELECT b.id, w.daily_rate FROM beds b JOIN wards w ON w.id = b.ward_id WHERE b.id = $1 AND b.is_active AND w.is_active', [bedId])).rows[0];
      if (!bed) throw bad('Bed not found.', 404);
      const cur = (await c.query('SELECT bed_id FROM bed_allocations WHERE admission_id = $1 AND to_at IS NULL', [req.params.id])).rows[0];
      if (cur && cur.bed_id === bedId) throw bad('The patient is already in this bed.');
      await c.query('UPDATE bed_allocations SET to_at = now() WHERE admission_id = $1 AND to_at IS NULL', [req.params.id]);
      await c.query('INSERT INTO bed_allocations (hospital_id, admission_id, bed_id, daily_rate) VALUES ($1,$2,$3,$4)', [req.user.hospitalId, req.params.id, bed.id, bed.daily_rate]);
    });
    res.json({ ok: true });
  } catch (e) { throw friendly(e); }
}));

r.post('/admissions/:id/notes', clinical, asyncH(async (req, res) => {
  const { note, vitals = {} } = req.body || {};
  if (!note || !note.trim()) throw bad('Write a care note.');
  const row = await withTenant(req.user.hospitalId, async (c) => {
    await openAdmission(c, req.params.id);
    return (await c.query(
      'INSERT INTO care_notes (hospital_id, admission_id, note, vitals, created_by) VALUES ($1,$2,$3,$4,$5) RETURNING *',
      [req.user.hospitalId, req.params.id, note.trim(), vitals, req.user.id])).rows[0];
  });
  res.status(201).json(row);
}));

// Extra charges during the stay (procedures, consultations, consumables). They are added to the discharge invoice.
r.post('/admissions/:id/charges', ipdStaff, asyncH(async (req, res) => {
  const { description, qty = 1, unitPrice } = req.body || {};
  if (!description || !description.trim()) throw bad('Describe the charge.');
  if (!Number.isInteger(Number(qty)) || Number(qty) < 1) throw bad('Quantity must be a whole number of at least 1.');
  if (unitPrice === '' || unitPrice == null || !(Number(unitPrice) >= 0)) throw bad('Enter the price.');
  const row = await withTenant(req.user.hospitalId, async (c) => {
    await openAdmission(c, req.params.id);
    return (await c.query(
      'INSERT INTO admission_charges (hospital_id, admission_id, description, qty, unit_price, created_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *',
      [req.user.hospitalId, req.params.id, description.trim(), Number(qty), Number(unitPrice), req.user.id])).rows[0];
  });
  res.status(201).json(row);
}));

// Discharge: closes the bed stay, builds the invoice (bed days + extra charges), optionally takes payment.
r.post('/admissions/:id/discharge', discharger, asyncH(async (req, res) => {
  const { summary, discount = 0, paidAmount = 0, method = 'cash' } = req.body || {};
  const disc = Number(discount) || 0;
  const paid = Number(paidAmount) || 0;
  if (!summary || !summary.trim()) throw bad('Write the discharge summary.');
  if (disc < 0 || paid < 0) throw bad('Discount and payment cannot be negative.');

  const out = await withTenant(req.user.hospitalId, async (c) => {
    const hid = req.user.hospitalId;
    const adm = await openAdmission(c, req.params.id);
    await c.query('UPDATE bed_allocations SET to_at = now() WHERE admission_id = $1 AND to_at IS NULL', [adm.id]);

    const stays = await staysOf(c, adm.id);
    const charges = (await c.query('SELECT description, qty, unit_price FROM admission_charges WHERE admission_id = $1 ORDER BY created_at', [adm.id])).rows;
    const lines = [...bedLines(stays), ...charges.map((x) => ({ description: x.description, qty: x.qty, unit_price: Number(x.unit_price) }))];
    const subtotal = money(lines.reduce((s, l) => s + l.qty * l.unit_price, 0));
    if (disc > subtotal) throw bad('Discount cannot be more than the subtotal.');
    const total = money(subtotal - disc);
    if (paid > total) throw bad('Payment is more than the total due.');
    const status = paid >= total ? 'paid' : paid > 0 ? 'partial' : 'unpaid';

    const inv = (await c.query('INSERT INTO invoices (hospital_id, patient_id, total, paid, status) VALUES ($1,$2,$3,$4,$5) RETURNING id', [hid, adm.patient_id, total, paid, status])).rows[0];
    for (const l of lines)
      await c.query('INSERT INTO invoice_items (hospital_id, invoice_id, description, qty, unit_price) VALUES ($1,$2,$3,$4,$5)', [hid, inv.id, l.description, l.qty, l.unit_price]);
    if (disc > 0)
      await c.query(`INSERT INTO invoice_items (hospital_id, invoice_id, description, qty, unit_price) VALUES ($1,$2,'Discount',1,$3)`, [hid, inv.id, -disc]);
    if (paid > 0)
      await c.query('INSERT INTO payments (hospital_id, invoice_id, amount, method) VALUES ($1,$2,$3,$4)', [hid, inv.id, paid, method]);

    await c.query(`UPDATE admissions SET status = 'discharged', discharged_at = now(), discharge_summary = $1, invoice_id = $2 WHERE id = $3`, [summary.trim(), inv.id, adm.id]);
    await c.query(`INSERT INTO audit_logs (hospital_id, user_id, action, entity, entity_id) VALUES ($1,$2,'discharge','admission',$3)`, [hid, req.user.id, adm.id]);
    return { id: adm.id, total, invoice_status: status };
  });
  res.json(out);
}));

export default r;
