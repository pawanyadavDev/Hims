import React, { useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';

const inr = (n) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(n);
const when = (d) => new Date(d).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
const tabs = [['worklist', 'Worklist'], ['order', 'New order'], ['tests', 'Tests'], ['reports', 'Patient reports']];
const statusLabel = { ordered: 'Waiting for sample', collected: 'Sample collected', completed: 'Completed', cancelled: 'Cancelled' };
const flagOptions = [['', 'No flag'], ['normal', 'Normal'], ['low', 'Low'], ['high', 'High'], ['abnormal', 'Abnormal']];

// Suggest a flag when the reference range is numeric, e.g. "12 - 16". The technician can override it.
function autoFlag(value, range) {
  const m = (range || '').match(/(-?\d+(?:\.\d+)?)\s*[-–]\s*(-?\d+(?:\.\d+)?)/);
  const v = parseFloat(value);
  if (!m || Number.isNaN(v)) return '';
  return v < parseFloat(m[1]) ? 'low' : v > parseFloat(m[2]) ? 'high' : 'normal';
}

function printReport(o) {
  const w = window.open('', '_blank');
  if (!w) return;
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const rows = o.items.map((i) =>
    `<tr><td>${esc(i.test_name)}</td><td>${esc(i.result_value || 'Pending')} ${esc(i.unit || '')}</td><td>${esc(i.reference_range || '–')}</td><td><b>${esc(i.result_flag && i.result_flag !== 'normal' ? i.result_flag : '')}</b></td></tr>`).join('');
  w.document.write(`<!doctype html><title>Lab report ${esc(o.order_no)}</title>
    <style>body{font:14px system-ui,sans-serif;margin:2rem;color:#16323a}table{width:100%;border-collapse:collapse}th,td{text-align:left;padding:.4rem .5rem;border-bottom:1px solid #ccc}</style>
    <h2>Laboratory report</h2><p><b>${esc(o.patient)}</b> (${esc(o.uhid)})<br>Order ${esc(o.order_no)} · ${esc(when(o.created_at))}<br>Ordered by ${esc(o.ordered_by || '–')}</p>
    <table><tr><th>Test</th><th>Result</th><th>Reference range</th><th>Flag</th></tr>${rows}</table>`);
  w.document.close(); w.focus(); w.print();
}

export default function Laboratory({ user }) {
  const canWork = ['lab', 'hospital_admin'].includes(user.role);
  const [tab, setTab] = useState('worklist');
  const [tests, setTests] = useState([]);
  const [patients, setPatients] = useState([]);

  const loadTests = () => api('/lab/tests').then(setTests).catch(() => {});
  useEffect(() => { loadTests(); api('/patients').then(setPatients).catch(() => {}); }, []);

  return (
    <>
      <h2>Laboratory</h2>
      <div className="tabs" role="tablist">
        {tabs.map(([id, label]) => (
          <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? 'on' : ''} onClick={() => setTab(id)}>{label}</button>
        ))}
      </div>
      {tab === 'worklist' && <Worklist canWork={canWork} />}
      {tab === 'order' && <NewOrder tests={tests} patients={patients} />}
      {tab === 'tests' && <Tests tests={tests} canWork={canWork} reload={loadTests} />}
      {tab === 'reports' && <Reports patients={patients} canWork={canWork} />}
    </>
  );
}

function Worklist({ canWork }) {
  const [orders, setOrders] = useState([]);
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const [error, setError] = useState('');

  const load = () => api(`/lab/orders?status=${status}&q=${encodeURIComponent(q)}`).then(setOrders).catch((e) => setError(e.message));
  useEffect(() => { load(); }, [status, q]);

  return (
    <>
      <div className="row">
        <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
          <option value="">All orders</option>
          {Object.entries(statusLabel).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <input placeholder="Search by patient, UHID or order no." value={q} onChange={(e) => setQ(e.target.value)} style={{ minWidth: 280 }} />
      </div>
      {error && <p className="error" role="alert">{error}</p>}
      {orders.map((o) => <OrderCard key={o.id} o={o} canWork={canWork} reload={load} />)}
      {!orders.length && <p>No lab orders match.</p>}
    </>
  );
}

function OrderCard({ o, canWork, reload }) {
  const [res, setRes] = useState(() => Object.fromEntries(o.items.map((i) => [i.id, { value: i.result_value || '', flag: i.result_flag || '', remarks: i.remarks || '' }])));
  const [collecting, setCollecting] = useState(false);
  const [bill, setBill] = useState({ discount: '', paid: '', method: 'cash' });
  const [error, setError] = useState('');

  const subtotal = o.items.reduce((s, i) => s + Number(i.unit_price), 0);
  const total = Math.max(0, Math.round((subtotal - Number(bill.discount || 0)) * 100) / 100);
  const anyResult = o.items.some((i) => i.result_value);

  const setField = (id, k) => (e) => {
    const v = e.target.value;
    setRes((r) => {
      const cur = { ...r[id], [k]: v };
      if (k === 'value') cur.flag = autoFlag(v, o.items.find((x) => x.id === id).reference_range);
      return { ...r, [id]: cur };
    });
  };

  async function run(fn) {
    setError('');
    try { await fn(); reload(); } catch (err) { setError(err.message); }
  }
  const saveResult = (i) => run(() => api(`/lab/orders/${o.id}/items/${i.id}/result`, { method: 'PATCH', body: { resultValue: res[i.id].value, flag: res[i.id].flag, remarks: res[i.id].remarks } }));
  const collect = () => run(() => api(`/lab/orders/${o.id}/collect`, { method: 'POST', body: { discount: Number(bill.discount || 0), paidAmount: Number(bill.paid || 0), method: bill.method } }));
  const cancel = () => run(() => api(`/lab/orders/${o.id}/cancel`, { method: 'POST' }));

  return (
    <article className="note">
      <header>
        <strong>{o.patient}</strong> <small>{o.uhid}</small> <small>{o.order_no} · {when(o.created_at)} · {o.ordered_by || '–'}</small>
        {o.priority === 'urgent' && <span className="tag booked">Urgent</span>}
        <span className={`tag ${o.status}`}>{statusLabel[o.status]}</span>
        {o.invoice_status && <span className={`tag ${o.invoice_status}`}>Bill {o.invoice_status}</span>}
      </header>
      {o.notes && <p><small>Note: {o.notes}</small></p>}

      {['ordered', 'cancelled'].includes(o.status) ? (
        <ul>{o.items.map((i) => <li key={i.id}>{i.test_name} — {inr(i.unit_price)}</li>)}</ul>
      ) : (
        <table>
          <thead><tr><th>Test</th><th>Result</th><th>Flag</th><th>Reference</th><th>Remarks</th><th></th></tr></thead>
          <tbody>
            {o.items.map((i) => {
              const f = res[i.id];
              return (
                <tr key={i.id}>
                  <td>{i.test_name}</td>
                  <td>{canWork
                    ? <span className="row"><input className="narrow" aria-label={`Result for ${i.test_name}`} value={f.value} onChange={setField(i.id, 'value')} /> {i.unit}</span>
                    : `${i.result_value || 'Pending'} ${i.result_value ? i.unit || '' : ''}`}</td>
                  <td>{canWork
                    ? <select value={f.flag} onChange={setField(i.id, 'flag')} aria-label="Flag">{flagOptions.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
                    : <span className={i.result_flag && i.result_flag !== 'normal' ? 'flag-alert' : ''}>{i.result_flag || '–'}</span>}</td>
                  <td>{i.reference_range || '–'}</td>
                  <td>{canWork ? <input value={f.remarks} onChange={setField(i.id, 'remarks')} aria-label="Remarks" /> : i.remarks || '–'}</td>
                  <td>{canWork && <button className="plain" disabled={!f.value.trim()} onClick={() => saveResult(i)}>{i.status === 'resulted' ? 'Update' : 'Save'}</button>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      <div className="row" style={{ marginTop: '.5rem' }}>
        {o.status === 'ordered' && canWork && <button className="plain" onClick={() => setCollecting(!collecting)}>Collect sample &amp; bill</button>}
        {o.status === 'ordered' && <button className="plain" onClick={cancel}>Cancel order</button>}
        {anyResult && <button className="plain" onClick={() => printReport(o)}>Print report</button>}
      </div>

      {collecting && o.status === 'ordered' && (
        <div className="row">
          <input type="number" min="0" step="0.01" className="narrow" placeholder="Discount (₹)" aria-label="Discount" value={bill.discount} onChange={(e) => setBill({ ...bill, discount: e.target.value })} />
          <select value={bill.method} onChange={(e) => setBill({ ...bill, method: e.target.value })} aria-label="Payment method">
            <option value="cash">Cash</option><option value="card">Card</option><option value="upi">UPI</option>
          </select>
          <input type="number" min="0" step="0.01" className="narrow" placeholder="Paid (₹)" aria-label="Amount paid" value={bill.paid} onChange={(e) => setBill({ ...bill, paid: e.target.value })} />
          <button type="button" className="plain" onClick={() => setBill({ ...bill, paid: String(total) })}>Pay in full</button>
          <span className="totals">Subtotal {inr(subtotal)} · <strong>Total {inr(total)}</strong></span>
          <button className="primary" onClick={collect}>Confirm collection</button>
        </div>
      )}
      {error && <p className="error" role="alert">{error}</p>}
    </article>
  );
}

function NewOrder({ tests, patients }) {
  const [patientId, setPatientId] = useState('');
  const [picked, setPicked] = useState([]);
  const [priority, setPriority] = useState('routine');
  const [notes, setNotes] = useState('');
  const [filter, setFilter] = useState('');
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');

  const shown = tests.filter((t) => `${t.name} ${t.category || ''}`.toLowerCase().includes(filter.toLowerCase()));
  const total = tests.filter((t) => picked.includes(t.id)).reduce((s, t) => s + Number(t.unit_price), 0);
  const toggle = (id) => setPicked(picked.includes(id) ? picked.filter((x) => x !== id) : [...picked, id]);

  async function create(e) {
    e.preventDefault(); setError(''); setMsg('');
    try {
      await api('/lab/orders', { method: 'POST', body: { patientId, testIds: picked, priority, notes } });
      setPatientId(''); setPicked([]); setNotes(''); setPriority('routine');
      setMsg('Order created. It is now in the worklist, waiting for a sample.');
    } catch (err) { setError(err.message); }
  }

  return (
    <form className="invoice" onSubmit={create}>
      <div className="row">
        <select value={patientId} onChange={(e) => setPatientId(e.target.value)} required aria-label="Patient">
          <option value="">Select patient</option>
          {patients.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.uhid})</option>)}
        </select>
        <select value={priority} onChange={(e) => setPriority(e.target.value)} aria-label="Priority">
          <option value="routine">Routine</option><option value="urgent">Urgent</option>
        </select>
        <input placeholder="Search tests" value={filter} onChange={(e) => setFilter(e.target.value)} />
      </div>
      <div className="checks">
        {shown.map((t) => (
          <label key={t.id}><input type="checkbox" checked={picked.includes(t.id)} onChange={() => toggle(t.id)} /> {t.name} <small>{inr(t.unit_price)}</small></label>
        ))}
        {!shown.length && <span>No tests found.</span>}
      </div>
      <input placeholder="Clinical note (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} />
      <div className="row">
        <strong>{picked.length} selected · {inr(total)}</strong>
        <button className="primary" disabled={!picked.length}>Create order</button>
      </div>
      {msg && <p role="status">{msg}</p>}
      {error && <p className="error" role="alert">{error}</p>}
    </form>
  );
}

function Tests({ tests, canWork, reload }) {
  const blank = { name: '', category: '', sampleType: '', unit: '', referenceRange: '', unitPrice: '' };
  const [form, setForm] = useState(blank);
  const [error, setError] = useState('');
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  async function add(e) {
    e.preventDefault(); setError('');
    try { await api('/lab/tests', { method: 'POST', body: form }); setForm(blank); reload(); }
    catch (err) { setError(err.message); }
  }

  return (
    <>
      {canWork && (
        <form className="invoice" onSubmit={add}>
          <h3>Add test</h3>
          <div className="row">
            <input placeholder="Test name" value={form.name} onChange={set('name')} required />
            <input className="narrow" placeholder="Category" value={form.category} onChange={set('category')} />
            <input className="narrow" placeholder="Sample" value={form.sampleType} onChange={set('sampleType')} />
            <input className="narrow" placeholder="Unit" value={form.unit} onChange={set('unit')} />
            <input className="narrow" placeholder="Range (12 - 16)" value={form.referenceRange} onChange={set('referenceRange')} />
            <input type="number" min="0" step="0.01" className="narrow" placeholder="Price (₹)" value={form.unitPrice} onChange={set('unitPrice')} required />
            <button className="primary">Add test</button>
          </div>
          {error && <p className="error" role="alert">{error}</p>}
        </form>
      )}
      <table>
        <thead><tr><th>Test</th><th>Category</th><th>Sample</th><th>Reference range</th><th>Price</th></tr></thead>
        <tbody>
          {tests.map((t) => (
            <tr key={t.id}><td>{t.name}</td><td>{t.category || '–'}</td><td>{t.sample_type || '–'}</td>
              <td>{t.reference_range ? `${t.reference_range} ${t.unit || ''}` : '–'}</td><td>{inr(t.unit_price)}</td></tr>
          ))}
          {!tests.length && <tr><td colSpan="5">No tests in the catalog yet.</td></tr>}
        </tbody>
      </table>
    </>
  );
}

function Reports({ patients, canWork }) {
  const [patientId, setPatientId] = useState('');
  const [orders, setOrders] = useState([]);
  const [error, setError] = useState('');

  const load = () => (patientId ? api(`/lab/orders?patientId=${patientId}`).then(setOrders).catch((e) => setError(e.message)) : setOrders([]));
  useEffect(() => { setError(''); load(); }, [patientId]);

  return (
    <>
      <select value={patientId} onChange={(e) => setPatientId(e.target.value)} aria-label="Patient">
        <option value="">Select patient</option>
        {patients.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.uhid})</option>)}
      </select>
      {error && <p className="error" role="alert">{error}</p>}
      <div style={{ marginTop: '1rem' }}>
        {orders.map((o) => <OrderCard key={o.id} o={o} canWork={canWork} reload={load} />)}
        {patientId && !orders.length && <p>No lab orders for this patient yet.</p>}
        {!patientId && <p>Select a patient to see their lab orders and reports.</p>}
      </div>
    </>
  );
}
