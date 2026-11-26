import { Router } from 'express';
import { withTenant } from '../db.js';
import { asyncH, requireRole } from '../middleware/auth.js';

const r = Router();
r.use(requireRole('pharmacist', 'hospital_admin'));

const bad = (message, status = 400) => Object.assign(new Error(message), { status });
const money = (n) => Math.round(n * 100) / 100;

// ---------- Medicines and stock ----------

r.get('/medicines', asyncH(async (req, res) => {
  const q = `%${req.query.q || ''}%`;
  const rows = await withTenant(req.user.hospitalId, async (c) =>
    (await c.query(
      `SELECT m.id, m.name, m.generic_name, m.form, m.strength, m.unit_price, m.reorder_level,
              COALESCE(SUM(b.qty_remaining) FILTER (WHERE b.expiry_date > CURRENT_DATE), 0)::int AS stock,
              MIN(b.expiry_date) FILTER (WHERE b.qty_remaining > 0 AND b.expiry_date > CURRENT_DATE) AS next_expiry
       FROM medicines m LEFT JOIN medicine_batches b ON b.medicine_id = m.id
       WHERE m.is_active AND (m.name ILIKE $1 OR m.generic_name ILIKE $1)
       GROUP BY m.id ORDER BY m.name, m.strength LIMIT 300`, [q])).rows);
  res.json(rows);
}));

r.post('/medicines', asyncH(async (req, res) => {
  const { name, genericName, form, strength = '', unitPrice, reorderLevel = 20 } = req.body || {};
  if (!name || !name.trim()) throw bad('Medicine name is required.');
  if (unitPrice === '' || unitPrice == null || !(Number(unitPrice) >= 0)) throw bad('Enter the selling price per unit.');
  try {
    const row = await withTenant(req.user.hospitalId, async (c) =>
      (await c.query(
        `INSERT INTO medicines (hospital_id, name, generic_name, form, strength, unit_price, reorder_level)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
        [req.user.hospitalId, name.trim(), genericName || null, form || null, strength.trim(), Number(unitPrice), Number(reorderLevel) || 0])).rows[0]);
    res.status(201).json(row);
  } catch (e) {
    if (e.code === '23505') throw bad('This medicine and strength already exist.', 409);
    throw e;
  }
}));

// Receive stock: each delivery is its own batch with an expiry date.
r.post('/medicines/:id/batches', asyncH(async (req, res) => {
  const { batchNo, expiryDate, qty, purchasePrice = 0 } = req.body || {};
  const n = Number(qty);
  if (!batchNo || !batchNo.trim() || !expiryDate) throw bad('Batch number and expiry date are required.');
  if (!Number.isInteger(n) || n <= 0) throw bad('Enter a whole-number quantity greater than zero.');
  const row = await withTenant(req.user.hospitalId, async (c) => {
    if (!(await c.query('SELECT 1 FROM medicines WHERE id = $1', [req.params.id])).rowCount) throw bad('Medicine not found.', 404);
    if (!(await c.query('SELECT $1::date > CURRENT_DATE AS ok', [expiryDate])).rows[0].ok) throw bad('This batch is already expired. Check the expiry date.');
    const b = (await c.query(
      `INSERT INTO medicine_batches (hospital_id, medicine_id, batch_no, expiry_date, qty_received, qty_remaining, purchase_price)
       VALUES ($1,$2,$3,$4,$5,$5,$6) RETURNING *`,
      [req.user.hospitalId, req.params.id, batchNo.trim(), expiryDate, n, Number(purchasePrice) || 0])).rows[0];
    await c.query(`INSERT INTO audit_logs (hospital_id, user_id, action, entity, entity_id) VALUES ($1,$2,'receive_stock','medicine_batch',$3)`,
      [req.user.hospitalId, req.user.id, b.id]);
    return b;
  });
  res.status(201).json(row);
}));

// Low stock and batches expiring within 60 days (or already expired with stock left).
r.get('/alerts', asyncH(async (req, res) => {
  const out = await withTenant(req.user.hospitalId, async (c) => ({
    low: (await c.query(
      `SELECT m.id, m.name, m.strength, m.reorder_level,
              COALESCE(SUM(b.qty_remaining) FILTER (WHERE b.expiry_date > CURRENT_DATE), 0)::int AS stock
       FROM medicines m LEFT JOIN medicine_batches b ON b.medicine_id = m.id
       WHERE m.is_active GROUP BY m.id
       HAVING COALESCE(SUM(b.qty_remaining) FILTER (WHERE b.expiry_date > CURRENT_DATE), 0) <= m.reorder_level
       ORDER BY stock, m.name`)).rows,
    expiring: (await c.query(
      `SELECT m.name AS medicine, m.strength, b.batch_no, b.expiry_date, b.qty_remaining
       FROM medicine_batches b JOIN medicines m ON m.id = b.medicine_id
       WHERE b.qty_remaining > 0 AND b.expiry_date <= CURRENT_DATE + 60 ORDER BY b.expiry_date LIMIT 50`)).rows,
  }));
  res.json(out);
}));

// ---------- OPD prescriptions waiting to be dispensed ----------

r.get('/prescriptions', asyncH(async (req, res) => {
  const q = `%${req.query.q || ''}%`;
  const rows = await withTenant(req.user.hospitalId, async (c) =>
    (await c.query(
      `SELECT c.id, c.created_at, c.patient_id, p.name AS patient, p.uhid, u.name AS doctor,
              json_agg(json_build_object('id', i.id, 'medicine', i.medicine, 'dosage', i.dosage,
                'frequency', i.frequency, 'duration', i.duration, 'instructions', i.instructions) ORDER BY i.medicine) AS items
       FROM consultations c
       JOIN patients p ON p.id = c.patient_id
       JOIN users u ON u.id = c.doctor_id
       JOIN prescription_items i ON i.consultation_id = c.id AND i.dispensed_sale_id IS NULL
       WHERE $1 = '%%' OR p.name ILIKE $1 OR p.uhid ILIKE $1 OR p.phone ILIKE $1
          OR EXISTS (SELECT 1 FROM prescription_items x
                     WHERE x.consultation_id = c.id AND x.dispensed_sale_id IS NULL AND x.medicine ILIKE $1)
       GROUP BY c.id, p.id, u.id ORDER BY c.created_at DESC LIMIT 50`, [q])).rows);
  res.json(rows);
}));

// ---------- Dispense and bill ----------
// Stock is taken from the earliest-expiring batches first. The sale creates a normal invoice,
// so it also shows up under Billing & payment. Everything happens in one transaction.

r.post('/sales', asyncH(async (req, res) => {
  const { patientId, consultationId, items, discount = 0, paidAmount = 0, method = 'cash' } = req.body || {};
  if (!patientId) throw bad('Select a patient.');
  if (!Array.isArray(items) || !items.length) throw bad('Add at least one medicine.');
  for (const i of items)
    if (!i.medicineId || !Number.isInteger(Number(i.qty)) || Number(i.qty) < 1) throw bad('Each medicine needs a whole-number quantity of at least 1.');
  const disc = Number(discount) || 0;
  const paid = Number(paidAmount) || 0;
  if (disc < 0 || paid < 0) throw bad('Discount and payment cannot be negative.');

  const result = await withTenant(req.user.hospitalId, async (c) => {
    const hid = req.user.hospitalId;
    if (!(await c.query('SELECT 1 FROM patients WHERE id = $1', [patientId])).rowCount) throw bad('Patient not found.', 404);

    const wanted = new Map();
    for (const i of items) wanted.set(i.medicineId, (wanted.get(i.medicineId) || 0) + Number(i.qty));

    const lines = [];
    let subtotal = 0;
    for (const medicineId of [...wanted.keys()].sort()) {          // fixed lock order avoids deadlocks
      const med = (await c.query('SELECT id, name, strength, unit_price FROM medicines WHERE id = $1 AND is_active', [medicineId])).rows[0];
      if (!med) throw bad('A selected medicine no longer exists.', 404);
      const qty = wanted.get(medicineId);
      let need = qty;
      const batches = (await c.query(
        `SELECT id, qty_remaining FROM medicine_batches
         WHERE medicine_id = $1 AND qty_remaining > 0 AND expiry_date > CURRENT_DATE
         ORDER BY expiry_date, created_at FOR UPDATE`, [medicineId])).rows;
      const allocations = [];
      for (const b of batches) {
        if (need <= 0) break;
        const take = Math.min(need, b.qty_remaining);
        allocations.push({ batchId: b.id, qty: take });
        need -= take;
      }
      if (need > 0) throw bad(`Not enough stock for ${`${med.name} ${med.strength}`.trim()}. Short by ${need}.`);
      lines.push({ med, qty, allocations });
      subtotal = money(subtotal + qty * Number(med.unit_price));
    }
    if (disc > subtotal) throw bad('Discount cannot be more than the subtotal.');
    const total = money(subtotal - disc);
    if (paid > total) throw bad('Payment is more than the total due.');
    const status = paid >= total ? 'paid' : paid > 0 ? 'partial' : 'unpaid';

    const inv = (await c.query(
      'INSERT INTO invoices (hospital_id, patient_id, total, paid, status) VALUES ($1,$2,$3,$4,$5) RETURNING *',
      [hid, patientId, total, paid, status])).rows[0];
    for (const l of lines)
      await c.query('INSERT INTO invoice_items (hospital_id, invoice_id, description, qty, unit_price) VALUES ($1,$2,$3,$4,$5)',
        [hid, inv.id, `${l.med.name} ${l.med.strength}`.trim(), l.qty, l.med.unit_price]);
    if (disc > 0)
      await c.query(`INSERT INTO invoice_items (hospital_id, invoice_id, description, qty, unit_price) VALUES ($1,$2,'Discount',1,$3)`, [hid, inv.id, -disc]);
    if (paid > 0)
      await c.query('INSERT INTO payments (hospital_id, invoice_id, amount, method) VALUES ($1,$2,$3,$4)', [hid, inv.id, paid, method]);

    const sale = (await c.query(
      `INSERT INTO pharmacy_sales (hospital_id, patient_id, consultation_id, invoice_id, subtotal, discount, total, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [hid, patientId, consultationId || null, inv.id, subtotal, disc, total, req.user.id])).rows[0];

    for (const l of lines)
      for (const a of l.allocations) {
        await c.query('UPDATE medicine_batches SET qty_remaining = qty_remaining - $1 WHERE id = $2', [a.qty, a.batchId]);
        await c.query(
          `INSERT INTO pharmacy_sale_items (hospital_id, sale_id, medicine_id, batch_id, qty, unit_price, line_total)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [hid, sale.id, l.med.id, a.batchId, a.qty, l.med.unit_price, money(a.qty * Number(l.med.unit_price))]);
      }

    // Mark the OPD prescription items as dispensed (only for this patient, and only once).
    for (const i of items.filter((x) => x.prescriptionItemId)) {
      const u = await c.query(
        `UPDATE prescription_items pi SET dispensed_sale_id = $1, dispensed_at = now()
         FROM consultations co
         WHERE pi.id = $2 AND pi.consultation_id = co.id AND co.patient_id = $3 AND pi.dispensed_sale_id IS NULL`,
        [sale.id, i.prescriptionItemId, patientId]);
      if (!u.rowCount) throw bad('A prescribed item was already dispensed. Refresh the list and try again.', 409);
    }

    await c.query(`INSERT INTO audit_logs (hospital_id, user_id, action, entity, entity_id) VALUES ($1,$2,'dispense','pharmacy_sale',$3)`, [hid, req.user.id, sale.id]);
    return { ...sale, invoice_status: status, paid };
  });
  res.status(201).json(result);
}));

// Patient-wise pharmacy records (pass patientId to see one patient's history).
r.get('/sales', asyncH(async (req, res) => {
  const rows = await withTenant(req.user.hospitalId, async (c) =>
    (await c.query(
      `SELECT s.id, s.created_at, s.subtotal, s.discount, s.total, i.paid, i.status,
              p.name AS patient, p.uhid, u.name AS dispensed_by,
              COALESCE((SELECT json_agg(t) FROM (
                 SELECT m.name AS medicine, m.strength, SUM(x.qty)::int AS qty, x.unit_price, SUM(x.line_total) AS line_total
                 FROM pharmacy_sale_items x JOIN medicines m ON m.id = x.medicine_id
                 WHERE x.sale_id = s.id GROUP BY m.name, m.strength, x.unit_price ORDER BY m.name) t), '[]') AS items
       FROM pharmacy_sales s
       JOIN patients p ON p.id = s.patient_id
       JOIN invoices i ON i.id = s.invoice_id
       LEFT JOIN users u ON u.id = s.created_by
       WHERE ($1::uuid IS NULL OR s.patient_id = $1)
       ORDER BY s.created_at DESC LIMIT 100`, [req.query.patientId || null])).rows);
  res.json(rows);
}));

export default r;
