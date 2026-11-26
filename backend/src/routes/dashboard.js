import { Router } from 'express';
import { withTenant } from '../db.js';
import { asyncH } from '../middleware/auth.js';

const r = Router();

r.get('/', asyncH(async (req, res) => {
  const stats = await withTenant(req.user.hospitalId, async (c) => {
    const one = async (sql) => Number((await c.query(sql)).rows[0].n);
    return {
      patients: await one('SELECT count(*) AS n FROM patients'),
      appointmentsToday: await one('SELECT count(*) AS n FROM appointments WHERE scheduled_at::date = CURRENT_DATE'),
      collectedToday: await one('SELECT COALESCE(sum(amount),0) AS n FROM payments WHERE paid_at::date = CURRENT_DATE'),
      outstanding: await one(`SELECT COALESCE(sum(total - paid),0) AS n FROM invoices WHERE status <> 'paid'`),
      inpatients: await one(`SELECT count(*) AS n FROM admissions WHERE status = 'admitted'`),
      bedsTotal: await one('SELECT count(*) AS n FROM beds b JOIN wards w ON w.id = b.ward_id WHERE b.is_active AND w.is_active'),
      bedsOccupied: await one('SELECT count(*) AS n FROM bed_allocations WHERE to_at IS NULL'),
      pendingLab: await one(`SELECT count(*) AS n FROM lab_orders WHERE status IN ('ordered','collected')`),
    };
  });
  res.json(stats);
}));

export default r;
