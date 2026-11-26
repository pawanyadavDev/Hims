import React, { useEffect, useState } from 'react';
import { api } from '../api.js';

const inr = (n) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(n);
const blank = { description: '', qty: 1, unitPrice: '' };

export default function Billing() {
  const [invoices, setInvoices] = useState([]);
  const [patients, setPatients] = useState([]);
  const [patientId, setPatientId] = useState('');
  const [items, setItems] = useState([{ ...blank }]);
  const [pay, setPay] = useState({});       // invoiceId -> amount being typed
  const [error, setError] = useState('');

  const load = () => api('/billing/invoices').then(setInvoices).catch((e) => setError(e.message));
  useEffect(() => { load(); api('/patients').then(setPatients).catch(() => {}); }, []);

  const total = items.reduce((s, i) => s + Number(i.qty || 0) * Number(i.unitPrice || 0), 0);
  const setItem = (idx, k) => (e) => setItems(items.map((it, i) => (i === idx ? { ...it, [k]: e.target.value } : it)));

  async function create(e) {
    e.preventDefault();
    setError('');
    try {
      await api('/billing/invoices', { method: 'POST', body: { patientId, items: items.map((i) => ({ ...i, qty: Number(i.qty), unitPrice: Number(i.unitPrice) })) } });
      setPatientId(''); setItems([{ ...blank }]); load();
    } catch (err) { setError(err.message); }
  }

  async function record(id) {
    setError('');
    try {
      await api(`/billing/invoices/${id}/payments`, { method: 'POST', body: { amount: Number(pay[id]) } });
      setPay({ ...pay, [id]: '' }); load();
    } catch (err) { setError(err.message); }
  }

  return (
    <>
      <h2>Billing &amp; payment</h2>
      <form className="invoice" onSubmit={create}>
        <select value={patientId} onChange={(e) => setPatientId(e.target.value)} required aria-label="Patient">
          <option value="">Select patient</option>
          {patients.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.uhid})</option>)}
        </select>
        {items.map((it, idx) => (
          <div className="row" key={idx}>
            <input placeholder="Service or item" value={it.description} onChange={setItem(idx, 'description')} required />
            <input type="number" min="1" className="narrow" aria-label="Quantity" value={it.qty} onChange={setItem(idx, 'qty')} required />
            <input type="number" min="0" step="0.01" className="narrow" placeholder="Price (₹)" value={it.unitPrice} onChange={setItem(idx, 'unitPrice')} required />
            {items.length > 1 && <button type="button" onClick={() => setItems(items.filter((_, i) => i !== idx))}>Remove</button>}
          </div>
        ))}
        <div className="row">
          <button type="button" onClick={() => setItems([...items, { ...blank }])}>Add item</button>
          <strong>Total: {inr(total)}</strong>
          <button className="primary">Create invoice</button>
        </div>
      </form>
      {error && <p className="error" role="alert">{error}</p>}
      <table>
        <thead><tr><th>Date</th><th>Patient</th><th>Total</th><th>Paid</th><th>Status</th><th>Record payment</th></tr></thead>
        <tbody>
          {invoices.map((i) => (
            <tr key={i.id}>
              <td>{new Date(i.created_at).toLocaleDateString('en-IN')}</td>
              <td>{i.patient}</td>
              <td>{inr(i.total)}</td>
              <td>{inr(i.paid)}</td>
              <td><span className={`tag ${i.status}`}>{i.status}</span></td>
              <td>
                {i.status !== 'paid' && (
                  <span className="row">
                    <input type="number" min="1" className="narrow" aria-label="Payment amount" placeholder="₹" value={pay[i.id] || ''} onChange={(e) => setPay({ ...pay, [i.id]: e.target.value })} />
                    <button onClick={() => record(i.id)} disabled={!pay[i.id]}>Pay</button>
                  </span>
                )}
              </td>
            </tr>
          ))}
          {!invoices.length && <tr><td colSpan="6">No invoices yet.</td></tr>}
        </tbody>
      </table>
    </>
  );
}
