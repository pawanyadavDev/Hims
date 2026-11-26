import { Router } from 'express';
import { withTenant } from '../db.js';
import { asyncH, requireRole } from '../middleware/auth.js';
import { bad } from '../lib/util.js';

const r = Router();
r.use(requireRole('hospital_admin', 'billing'));

const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || '');

// One call returns everything the Reports screen shows for the chosen date range (inclusive).
r.get('/overview', asyncH(async (req, res) => {
  const today = new Date().toISOString().slice(0, 10);
  const from = isDate(req.query.from) ? req.query.from : new Date(Date.now() - 29 * 864e5).toISOString().slice(0, 10);
  const to = isDate(req.query.to) ? req.query.to : today;
  if (from > to) throw bad('The start date must be on or before the end date.');
  if ((new Date(to) - new Date(from)) / 864e5 > 366) throw bad('Choose a range of one year or less.');
  const range = (col) => `${col} >= $1::date AND ${col} < $2::date + 1`;

  const out = await withTenant(req.user.hospitalId, async (c) => {
    const n = async (sql) => Number((await c.query(sql, [from, to])).rows[0].n);
    const kpis = {
      billed: await n(`SELECT COALESCE(sum(total),0) AS n FROM invoices WHERE ${range('created_at')}`),
      collected: await n(`SELECT COALESCE(sum(amount),0) AS n FROM payments WHERE ${range('paid_at')}`),
      outstanding: await n(`SELECT COALESCE(sum(total - paid),0) AS n FROM invoices WHERE status <> 'paid' AND ${range('created_at')}`),
      newPatients: await n(`SELECT count(*) AS n FROM patients WHERE ${range('created_at')}`),
      consultations: await n(`SELECT count(*) AS n FROM consultations WHERE ${range('created_at')}`),
      appointments: await n(`SELECT count(*) AS n FROM appointments WHERE ${range('scheduled_at')}`),
      admissions: await n(`SELECT count(*) AS n FROM admissions WHERE ${range('admitted_at')}`),
      discharges: await n(`SELECT count(*) AS n FROM admissions WHERE discharged_at IS NOT NULL AND ${range('discharged_at')}`),
      labOrders: await n(`SELECT count(*) AS n FROM lab_orders WHERE status <> 'cancelled' AND ${range('created_at')}`),
      pharmacySales: await n(`SELECT COALESCE(sum(total),0) AS n FROM pharmacy_sales WHERE ${range('created_at')}`),
    };
    const daily = (await c.query(
      `SELECT to_char(d, 'YYYY-MM-DD') AS day, COALESCE(b.billed, 0) AS billed, COALESCE(p.collected, 0) AS collected
       FROM generate_series($1::date, $2::date, interval '1 day') d
       LEFT JOIN (SELECT created_at::date AS day, sum(total) AS billed FROM invoices WHERE ${range('created_at')} GROUP BY 1) b ON b.day = d::date
       LEFT JOIN (SELECT paid_at::date AS day, sum(amount) AS collected FROM payments WHERE ${range('paid_at')} GROUP BY 1) p ON p.day = d::date
       ORDER BY d`, [from, to])).rows;
    const bySource = (await c.query(
      `SELECT CASE WHEN ps.id IS NOT NULL THEN 'Pharmacy' WHEN lo.id IS NOT NULL THEN 'Laboratory' WHEN ad.id IS NOT NULL THEN 'IPD' ELSE 'Other billing' END AS source,
              count(*)::int AS invoices, COALESCE(sum(i.total), 0) AS billed, COALESCE(sum(i.paid), 0) AS collected
       FROM invoices i
       LEFT JOIN pharmacy_sales ps ON ps.invoice_id = i.id
       LEFT JOIN lab_orders lo ON lo.invoice_id = i.id
       LEFT JOIN admissions ad ON ad.invoice_id = i.id
       WHERE ${range('i.created_at')} GROUP BY 1 ORDER BY billed DESC`, [from, to])).rows;
    const doctors = (await c.query(
      `SELECT u.name AS doctor,
              (SELECT count(*) FROM consultations c WHERE c.doctor_id = u.id AND ${range('c.created_at')})::int AS consultations,
              (SELECT count(*) FROM admissions a WHERE a.doctor_id = u.id AND ${range('a.admitted_at')})::int AS admissions
       FROM users u WHERE u.hospital_id = $3 AND u.role = 'doctor' ORDER BY consultations DESC, u.name`, [from, to, req.user.hospitalId])).rows;
    const now = {
      bedsTotal: await n(`SELECT count(*) AS n FROM beds b JOIN wards w ON w.id = b.ward_id WHERE b.is_active AND w.is_active AND $1::date IS NOT NULL AND $2::date IS NOT NULL`),
      bedsOccupied: await n(`SELECT count(*) AS n FROM bed_allocations WHERE to_at IS NULL AND $1::date IS NOT NULL AND $2::date IS NOT NULL`),
      lowStockMedicines: await n(`SELECT count(*) AS n FROM (SELECT m.id FROM medicines m LEFT JOIN medicine_batches b ON b.medicine_id = m.id WHERE m.is_active GROUP BY m.id
          HAVING COALESCE(SUM(b.qty_remaining) FILTER (WHERE b.expiry_date > CURRENT_DATE), 0) <= MIN(m.reorder_level)) t WHERE $1::date IS NOT NULL AND $2::date IS NOT NULL`),
      lowStockItems: await n(`SELECT count(*) AS n FROM inventory_items WHERE is_active AND qty_on_hand <= reorder_level AND $1::date IS NOT NULL AND $2::date IS NOT NULL`),
    };
    return { from, to, kpis, daily, bySource, doctors, now };
  });
  res.json(out);
}));

export default r;
