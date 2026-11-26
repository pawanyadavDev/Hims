import React, { useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';

const inr = (n) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(n);
const day = (d) => new Date(d).toLocaleDateString('en-IN', { dateStyle: 'medium' });
const when = (d) => new Date(d).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
const tabs = [['dispense', 'Dispense'], ['stock', 'Stock'], ['records', 'Patient records']];

let seq = 0;
const nextKey = () => ++seq;

// Pick the inventory medicine that best matches what the doctor typed.
function bestMatch(name, meds) {
  const words = (name || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(Boolean);
  let best = '', top = 0;
  for (const m of meds) {
    const hay = `${m.name} ${m.generic_name || ''} ${m.strength}`.toLowerCase();
    const hits = words.filter((w) => hay.includes(w)).length;
    const score = hits ? hits + (m.stock > 0 ? 0.5 : 0) : 0;
    if (score > top) { top = score; best = m.id; }
  }
  return best;
}

// Suggest a quantity from frequency (e.g. 1-0-1) and duration (e.g. 5 days). The pharmacist can change it.
function suggestQty(freq, dur) {
  const f = (freq || '').match(/\d+/g);
  const d = (dur || '').match(/\d+/);
  if (!f || !d) return 1;
  const mult = /week/i.test(dur) ? 7 : /month/i.test(dur) ? 30 : 1;
  const n = f.reduce((a, b) => a + Number(b), 0) * Number(d[0]) * mult;
  return n > 0 ? n : 1;
}

export default function Pharmacy() {
  const [tab, setTab] = useState('dispense');
  const [medicines, setMedicines] = useState([]);
  const [patients, setPatients] = useState([]);
  const [error, setError] = useState('');

  const loadMeds = () => api('/pharmacy/medicines').then(setMedicines).catch((e) => setError(e.message));
  useEffect(() => { loadMeds(); api('/patients').then(setPatients).catch(() => {}); }, []);

  return (
    <>
      <h2>Pharmacy</h2>
      <div className="tabs" role="tablist">
        {tabs.map(([id, label]) => (
          <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? 'on' : ''} onClick={() => setTab(id)}>{label}</button>
        ))}
      </div>
      {error && <p className="error" role="alert">{error}</p>}
      {tab === 'dispense' && <Dispense medicines={medicines} patients={patients} reload={loadMeds} />}
      {tab === 'stock' && <Stock medicines={medicines} reload={loadMeds} />}
      {tab === 'records' && <Records patients={patients} />}
    </>
  );
}

function Dispense({ medicines, patients, reload }) {
  const [q, setQ] = useState('');
  const [rx, setRx] = useState([]);
  const [cart, setCart] = useState({ patientId: '', consultationId: '', lines: [] });
  const [discount, setDiscount] = useState('');
  const [paid, setPaid] = useState('');
  const [method, setMethod] = useState('cash');
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');

  const loadRx = () => api(`/pharmacy/prescriptions?q=${encodeURIComponent(q)}`).then(setRx).catch((e) => setError(e.message));
  useEffect(() => { loadRx(); }, [q]);

  const medById = useMemo(() => Object.fromEntries(medicines.map((m) => [m.id, m])), [medicines]);
  const lineTotal = (l) => Number(l.qty || 0) * Number(medById[l.medicineId]?.unit_price || 0);
  const subtotal = cart.lines.reduce((s, l) => s + lineTotal(l), 0);
  const total = Math.max(0, Math.round((subtotal - Number(discount || 0)) * 100) / 100);
  const hasRxLines = cart.lines.some((l) => l.prescriptionItemId);

  function addItems(r, items) {
    setError(''); setMsg('');
    if (cart.lines.length && cart.patientId !== r.patient_id)
      return setError('Complete or clear the current cart before adding another patient’s prescription.');
    const fresh = items.filter((it) => !cart.lines.some((l) => l.prescriptionItemId === it.id));
    setCart({
      patientId: r.patient_id,
      consultationId: r.id,
      lines: [...cart.lines, ...fresh.map((it) => ({
        key: nextKey(), prescriptionItemId: it.id, medicineId: bestMatch(it.medicine, medicines),
        qty: suggestQty(it.frequency, it.duration), prescribed: it,
      }))],
    });
  }

  const addWalkIn = () => setCart({ ...cart, lines: [...cart.lines, { key: nextKey(), prescriptionItemId: '', medicineId: '', qty: 1 }] });
  const patchLine = (key, patch) => setCart({ ...cart, lines: cart.lines.map((l) => (l.key === key ? { ...l, ...patch } : l)) });
  const removeLine = (key) => setCart({ ...cart, lines: cart.lines.filter((l) => l.key !== key) });
  const clearCart = () => { setCart({ patientId: '', consultationId: '', lines: [] }); setDiscount(''); setPaid(''); setError(''); };

  async function complete(e) {
    e.preventDefault();
    setError(''); setMsg('');
    if (!cart.patientId) return setError('Select a patient.');
    if (!cart.lines.length || cart.lines.some((l) => !l.medicineId)) return setError('Choose a medicine for every line.');
    try {
      const sale = await api('/pharmacy/sales', {
        method: 'POST',
        body: {
          patientId: cart.patientId, consultationId: cart.consultationId || undefined, method,
          discount: Number(discount || 0), paidAmount: Number(paid || 0),
          items: cart.lines.map((l) => ({ medicineId: l.medicineId, qty: Number(l.qty), prescriptionItemId: l.prescriptionItemId || undefined })),
        },
      });
      clearCart();
      setMsg(`Sale completed. ${inr(sale.total)} billed (${sale.invoice_status}).`);
      reload(); loadRx();
    } catch (err) { setError(err.message); }
  }

  return (
    <>
      <h3>Prescriptions to dispense</h3>
      <input className="search" placeholder="Search by patient, UHID, phone or medicine" value={q} onChange={(e) => setQ(e.target.value)} />
      {rx.map((r) => (
        <article className="note" key={r.id}>
          <header>
            <strong>{r.patient}</strong> <small>{r.uhid}</small> <small>{when(r.created_at)} · {r.doctor}</small>{' '}
            <button className="plain" onClick={() => addItems(r, r.items)}>Add all</button>
          </header>
          <ul>
            {r.items.map((it) => (
              <li key={it.id}>
                {[it.medicine, it.dosage, it.frequency, it.duration].filter(Boolean).join(' · ')}{it.instructions ? ` (${it.instructions})` : ''}{' '}
                <button className="plain" disabled={cart.lines.some((l) => l.prescriptionItemId === it.id)} onClick={() => addItems(r, [it])}>Add</button>
              </li>
            ))}
          </ul>
        </article>
      ))}
      {!rx.length && <p>No prescriptions waiting to be dispensed.</p>}

      <form className="invoice" onSubmit={complete}>
        <h3>Dispensing cart</h3>
        <div className="row">
          <select value={cart.patientId} onChange={(e) => setCart({ ...cart, patientId: e.target.value, consultationId: '' })} disabled={hasRxLines} aria-label="Patient">
            <option value="">Select patient (for walk-in sales)</option>
            {patients.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.uhid})</option>)}
          </select>
          <button type="button" className="plain" onClick={addWalkIn}>Add medicine</button>
          {cart.lines.length > 0 && <button type="button" className="plain" onClick={clearCart}>Clear cart</button>}
        </div>

        {cart.lines.map((l) => {
          const m = medById[l.medicineId];
          const short = m && Number(l.qty) > m.stock;
          return (
            <div key={l.key}>
              <div className="row">
                <select value={l.medicineId} onChange={(e) => patchLine(l.key, { medicineId: e.target.value })} aria-label="Medicine" required>
                  <option value="">Select medicine</option>
                  {medicines.map((x) => <option key={x.id} value={x.id}>{`${x.name} ${x.strength}`.trim()} — {x.stock} in stock — {inr(x.unit_price)}</option>)}
                </select>
                <input type="number" min="1" className="narrow" aria-label="Quantity" value={l.qty} onChange={(e) => patchLine(l.key, { qty: e.target.value })} required />
                <span>{inr(lineTotal(l))}</span>
                <button type="button" className="plain" onClick={() => removeLine(l.key)}>Remove</button>
              </div>
              {l.prescribed && <small>Prescribed: {[l.prescribed.medicine, l.prescribed.dosage, l.prescribed.frequency, l.prescribed.duration].filter(Boolean).join(' · ')}</small>}
              {short && <small className="error"> Only {m.stock} in stock.</small>}
            </div>
          );
        })}
        {!cart.lines.length && <p>Add items from a prescription above, or add a medicine for a walk-in sale.</p>}

        {cart.lines.length > 0 && (
          <div className="row">
            <input type="number" min="0" step="0.01" className="narrow" placeholder="Discount (₹)" aria-label="Discount" value={discount} onChange={(e) => setDiscount(e.target.value)} />
            <select value={method} onChange={(e) => setMethod(e.target.value)} aria-label="Payment method">
              <option value="cash">Cash</option><option value="card">Card</option><option value="upi">UPI</option>
            </select>
            <input type="number" min="0" step="0.01" className="narrow" placeholder="Paid (₹)" aria-label="Amount paid" value={paid} onChange={(e) => setPaid(e.target.value)} />
            <button type="button" className="plain" onClick={() => setPaid(String(total))}>Pay in full</button>
            <span className="totals">Subtotal {inr(subtotal)} · <strong>Total {inr(total)}</strong></span>
            <button className="primary">Complete sale</button>
          </div>
        )}
      </form>
      {msg && <p role="status">{msg}</p>}
      {error && <p className="error" role="alert">{error}</p>}
    </>
  );
}

function Stock({ medicines, reload }) {
  const [filter, setFilter] = useState('');
  const [alerts, setAlerts] = useState({ low: [], expiring: [] });
  const [medForm, setMedForm] = useState({ name: '', genericName: '', form: '', strength: '', unitPrice: '', reorderLevel: 20 });
  const [batch, setBatch] = useState({ medicineId: '', batchNo: '', expiryDate: '', qty: '', purchasePrice: '' });
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');

  const loadAlerts = () => api('/pharmacy/alerts').then(setAlerts).catch((e) => setError(e.message));
  useEffect(() => { loadAlerts(); }, [medicines]);

  const setM = (k) => (e) => setMedForm({ ...medForm, [k]: e.target.value });
  const setB = (k) => (e) => setBatch({ ...batch, [k]: e.target.value });

  async function addMedicine(e) {
    e.preventDefault(); setError(''); setMsg('');
    try {
      await api('/pharmacy/medicines', { method: 'POST', body: medForm });
      setMedForm({ name: '', genericName: '', form: '', strength: '', unitPrice: '', reorderLevel: 20 });
      setMsg('Medicine added. Receive stock below to make it available.'); reload();
    } catch (err) { setError(err.message); }
  }

  async function receive(e) {
    e.preventDefault(); setError(''); setMsg('');
    try {
      await api(`/pharmacy/medicines/${batch.medicineId}/batches`, { method: 'POST', body: { ...batch, qty: Number(batch.qty), purchasePrice: Number(batch.purchasePrice || 0) } });
      setBatch({ medicineId: '', batchNo: '', expiryDate: '', qty: '', purchasePrice: '' });
      setMsg('Stock received.'); reload();
    } catch (err) { setError(err.message); }
  }

  const shown = medicines.filter((m) => `${m.name} ${m.generic_name || ''}`.toLowerCase().includes(filter.toLowerCase()));
  const status = (m) => (m.stock <= 0 ? ['out', 'Out of stock'] : m.stock <= m.reorder_level ? ['low', 'Low'] : ['ok', 'In stock']);

  return (
    <>
      {alerts.low.length > 0 && (
        <p className="callout"><strong>{alerts.low.length} medicine{alerts.low.length > 1 ? 's' : ''} at or below reorder level:</strong>{' '}
          {alerts.low.map((m) => `${`${m.name} ${m.strength}`.trim()} (${m.stock})`).join(', ')}</p>
      )}
      {alerts.expiring.length > 0 && (
        <p className="callout"><strong>Expiring within 60 days:</strong>{' '}
          {alerts.expiring.map((b) => `${`${b.medicine} ${b.strength}`.trim()} batch ${b.batch_no}, ${b.qty_remaining} left, ${day(b.expiry_date)}`).join('; ')}</p>
      )}

      <form className="invoice" onSubmit={addMedicine}>
        <h3>Add medicine</h3>
        <div className="row">
          <input placeholder="Brand or name" value={medForm.name} onChange={setM('name')} required />
          <input placeholder="Generic name" value={medForm.genericName} onChange={setM('genericName')} />
          <input className="narrow" placeholder="Form (Tablet)" value={medForm.form} onChange={setM('form')} />
          <input className="narrow" placeholder="Strength" value={medForm.strength} onChange={setM('strength')} />
          <input type="number" min="0" step="0.01" className="narrow" placeholder="Price (₹)" aria-label="Selling price per unit" value={medForm.unitPrice} onChange={setM('unitPrice')} required />
          <input type="number" min="0" className="narrow" aria-label="Reorder level" title="Reorder level" value={medForm.reorderLevel} onChange={setM('reorderLevel')} />
          <button className="primary">Add medicine</button>
        </div>
      </form>

      <form className="invoice" onSubmit={receive}>
        <h3>Receive stock</h3>
        <div className="row">
          <select value={batch.medicineId} onChange={setB('medicineId')} required aria-label="Medicine">
            <option value="">Select medicine</option>
            {medicines.map((m) => <option key={m.id} value={m.id}>{`${m.name} ${m.strength}`.trim()}</option>)}
          </select>
          <input placeholder="Batch no." value={batch.batchNo} onChange={setB('batchNo')} required />
          <input type="date" aria-label="Expiry date" value={batch.expiryDate} onChange={setB('expiryDate')} required />
          <input type="number" min="1" className="narrow" placeholder="Quantity" value={batch.qty} onChange={setB('qty')} required />
          <input type="number" min="0" step="0.01" className="narrow" placeholder="Cost (₹)" aria-label="Purchase price per unit" value={batch.purchasePrice} onChange={setB('purchasePrice')} />
          <button className="primary">Receive stock</button>
        </div>
      </form>
      {msg && <p role="status">{msg}</p>}
      {error && <p className="error" role="alert">{error}</p>}

      <input className="search" placeholder="Search medicines" value={filter} onChange={(e) => setFilter(e.target.value)} />
      <table>
        <thead><tr><th>Medicine</th><th>Form</th><th>Price</th><th>Stock</th><th>Next expiry</th><th>Status</th></tr></thead>
        <tbody>
          {shown.map((m) => {
            const [cls, label] = status(m);
            return (
              <tr key={m.id}>
                <td>{`${m.name} ${m.strength}`.trim()} {m.generic_name && <small>{m.generic_name}</small>}</td>
                <td>{m.form || '–'}</td><td>{inr(m.unit_price)}</td><td>{m.stock}</td>
                <td>{m.next_expiry ? day(m.next_expiry) : '–'}</td>
                <td><span className={`tag ${cls}`}>{label}</span></td>
              </tr>
            );
          })}
          {!shown.length && <tr><td colSpan="6">No medicines found. Add the first one above.</td></tr>}
        </tbody>
      </table>
    </>
  );
}

function Records({ patients }) {
  const [patientId, setPatientId] = useState('');
  const [sales, setSales] = useState([]);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!patientId) return setSales([]);
    api(`/pharmacy/sales?patientId=${patientId}`).then(setSales).catch((e) => setError(e.message));
  }, [patientId]);

  const billed = sales.reduce((s, x) => s + Number(x.total), 0);
  const due = sales.reduce((s, x) => s + Number(x.total) - Number(x.paid), 0);

  return (
    <>
      <select value={patientId} onChange={(e) => { setError(''); setPatientId(e.target.value); }} aria-label="Patient">
        <option value="">Select patient</option>
        {patients.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.uhid})</option>)}
      </select>
      {error && <p className="error" role="alert">{error}</p>}
      {patientId && (
        <>
          <dl className="stats" style={{ margin: '1.25rem 0' }}>
            <div><dd>{sales.length}</dd><dt>Pharmacy purchases</dt></div>
            <div><dd>{inr(billed)}</dd><dt>Total billed</dt></div>
            <div><dd>{inr(due)}</dd><dt>Balance due</dt></div>
          </dl>
          {sales.map((s) => (
            <article className="note" key={s.id}>
              <header><strong>{when(s.created_at)}</strong> <small>dispensed by {s.dispensed_by || '–'}</small> <span className={`tag ${s.status}`}>{s.status}</span></header>
              <ul>{s.items.map((i, k) => <li key={k}>{`${i.medicine} ${i.strength}`.trim()} × {i.qty} — {inr(i.line_total)}</li>)}</ul>
              <p><small>Subtotal {inr(s.subtotal)}{Number(s.discount) > 0 ? ` · Discount ${inr(s.discount)}` : ''} · Total {inr(s.total)} · Paid {inr(s.paid)}</small></p>
            </article>
          ))}
          {!sales.length && <p>No pharmacy purchases for this patient yet.</p>}
        </>
      )}
      {!patientId && <p>Select a patient to see everything dispensed to them.</p>}
    </>
  );
}
