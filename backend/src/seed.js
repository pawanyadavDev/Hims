// Usage: docker compose exec backend node src/seed.js   (safe to run again)
import bcrypt from 'bcryptjs';
import { pool, withTenant } from './db.js';

const hash = (p) => bcrypt.hash(p, 10);
const hospital = (await pool.query(
  `INSERT INTO hospitals (name, code) VALUES ('City Care Hospital','citycare')
   ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name RETURNING id`)).rows[0];

const users = [
  [null, 'Platform Admin', 'super@hims.local', 'super_admin'],
  [hospital.id, 'Hospital Admin', 'admin@citycare.local', 'hospital_admin'],
  [hospital.id, 'Dr. Asha Verma', 'doctor@citycare.local', 'doctor'],
  [hospital.id, 'Front Desk', 'reception@citycare.local', 'receptionist'],
  [hospital.id, 'Nisha Nurse', 'nurse@citycare.local', 'nurse'],
  [hospital.id, 'Bilal Billing', 'billing@citycare.local', 'billing'],
  [hospital.id, 'Ravi Pharmacist', 'pharmacist@citycare.local', 'pharmacist'],
  [hospital.id, 'Meera Lab Tech', 'lab@citycare.local', 'lab'],
];
for (const [hid, name, email, role] of users)
  await pool.query(
    `INSERT INTO users (hospital_id, name, email, password_hash, role) VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (email) DO NOTHING`, [hid, name, email, await hash('Password@123'), role]);

// Medicines (Cetirizine starts below its reorder level on purpose).
const meds = [
  ['Paracetamol', 'Paracetamol', 'Tablet', '500 mg', 2, 100, 500, 1.2],
  ['Amoxicillin', 'Amoxicillin', 'Capsule', '500 mg', 9, 60, 300, 6],
  ['Cetirizine', 'Cetirizine', 'Tablet', '10 mg', 3, 50, 40, 1.5],
  ['Omeprazole', 'Omeprazole', 'Capsule', '20 mg', 6, 50, 200, 3.5],
  ['Metformin', 'Metformin', 'Tablet', '500 mg', 3, 80, 400, 1.8],
  ['ORS', 'Oral rehydration salts', 'Sachet', '', 20, 30, 100, 12],
];
const labTests = [
  ['Hemoglobin', 'Hematology', 'Blood', 'g/dL', '12 - 16', 120],
  ['Fasting Blood Sugar', 'Biochemistry', 'Blood', 'mg/dL', '70 - 100', 80],
  ['HbA1c', 'Biochemistry', 'Blood', '%', '4.0 - 5.6', 450],
  ['Serum Creatinine', 'Biochemistry', 'Blood', 'mg/dL', '0.6 - 1.3', 200],
  ['Total Cholesterol', 'Biochemistry', 'Blood', 'mg/dL', '0 - 200', 250],
  ['TSH', 'Hormones', 'Blood', 'µIU/mL', '0.4 - 4.0', 350],
  ['Urine Routine', 'Clinical Pathology', 'Urine', '', 'Normal', 100],
  ['Malaria Antigen', 'Serology', 'Blood', '', 'Negative', 300],
];
const wards = [['General Ward', 'General', 800, 'G', 6], ['ICU', 'ICU', 3500, 'ICU', 3], ['Private Room', 'Private', 2000, 'P', 4]];
const supplies = [
  ['Surgical gloves', 'Consumables', 'box', 20, 120], ['Syringe 5 ml', 'Consumables', 'pcs', 200, 1500],
  ['IV set', 'Consumables', 'pcs', 50, 80], ['Cotton bandage roll', 'Consumables', 'roll', 40, 25],
  ['Face mask', 'Consumables', 'pcs', 300, 2000], ['Bed sheet', 'Linen', 'pcs', 30, 90],
];

await withTenant(hospital.id, async (c) => {
  const hid = hospital.id;
  for (const [name, generic, form, strength, price, reorder, qty, cost] of meds) {
    const m = (await c.query(
      `INSERT INTO medicines (hospital_id, name, generic_name, form, strength, unit_price, reorder_level)
       VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (hospital_id, name, strength) DO NOTHING RETURNING id`,
      [hid, name, generic, form, strength, price, reorder])).rows[0];
    if (m)
      await c.query(
        `INSERT INTO medicine_batches (hospital_id, medicine_id, batch_no, expiry_date, qty_received, qty_remaining, purchase_price)
         VALUES ($1,$2,$3, CURRENT_DATE + INTERVAL '18 months', $4, $4, $5)`, [hid, m.id, `B${name.slice(0, 3).toUpperCase()}01`, qty, cost]);
  }
  for (const [name, category, sample, unit, range, price] of labTests)
    await c.query(
      `INSERT INTO lab_tests (hospital_id, name, category, sample_type, unit, reference_range, unit_price)
       VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (hospital_id, name) DO NOTHING`, [hid, name, category, sample, unit, range, price]);
  for (const [name, type, rate, prefix, count] of wards) {
    const w = (await c.query(
      `INSERT INTO wards (hospital_id, name, type, daily_rate) VALUES ($1,$2,$3,$4)
       ON CONFLICT (hospital_id, name) DO UPDATE SET type = EXCLUDED.type RETURNING id`, [hid, name, type, rate])).rows[0];
    for (let n = 1; n <= count; n++)
      await c.query('INSERT INTO beds (hospital_id, ward_id, bed_no) VALUES ($1,$2,$3) ON CONFLICT (ward_id, bed_no) DO NOTHING', [hid, w.id, `${prefix}${n}`]);
  }
  for (const [name, category, unit, reorder, qty] of supplies) {
    const it = (await c.query(
      `INSERT INTO inventory_items (hospital_id, name, category, unit, reorder_level, qty_on_hand) VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (hospital_id, name) DO NOTHING RETURNING id`, [hid, name, category, unit, reorder, qty])).rows[0];
    if (it) await c.query(`INSERT INTO stock_movements (hospital_id, item_id, change, reason, reference) VALUES ($1,$2,$3,'receipt','Opening stock')`, [hid, it.id, qty]);
  }
  await c.query(`INSERT INTO suppliers (hospital_id, name, phone) VALUES ($1,'MediSupply Co.','+91 98765 43210') ON CONFLICT (hospital_id, name) DO NOTHING`, [hid]);
});

console.log('Seeded. Sign in with admin@citycare.local (or doctor@, reception@, nurse@, billing@, pharmacist@, lab@citycare.local) / Password@123.');
console.log('Platform admin: super@hims.local / Password@123. Change all passwords immediately.');
await pool.end();
