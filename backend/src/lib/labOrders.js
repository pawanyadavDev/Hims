export const bad = (message, status = 400) => Object.assign(new Error(message), { status });

// Creates a lab order with its test lines. Call inside withTenant (so RLS applies).
// Used by the lab API and by OPD (when a doctor orders tests during a consultation).
export async function createLabOrder(c, { hospitalId, userId, patientId, consultationId = null, testIds, priority = 'routine', notes = null }) {
  const ids = [...new Set(testIds)];
  const tests = (await c.query(
    'SELECT id, name, unit, reference_range, unit_price FROM lab_tests WHERE id = ANY($1::uuid[]) AND is_active', [ids])).rows;
  if (tests.length !== ids.length) throw bad('One of the selected lab tests is no longer available.', 404);

  const orderNo = 'LB' + Date.now().toString(36).toUpperCase() + Math.floor(Math.random() * 36).toString(36).toUpperCase();
  const order = (await c.query(
    `INSERT INTO lab_orders (hospital_id, order_no, patient_id, consultation_id, ordered_by, priority, notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [hospitalId, orderNo, patientId, consultationId, userId, priority, notes || null])).rows[0];
  for (const t of tests)
    await c.query(
      `INSERT INTO lab_order_items (hospital_id, order_id, test_id, test_name, unit, reference_range, unit_price)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [hospitalId, order.id, t.id, t.name, t.unit, t.reference_range, t.unit_price]);
  return order;
}
