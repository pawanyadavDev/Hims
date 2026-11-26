import React, { useEffect, useState } from 'react';
import { api } from '../api.js';

const inr = (n) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(n);
const when = (d) => new Date(d).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
const tabs = [['admissions', 'Admissions'], ['beds', 'Bed board'], ['setup', 'Wards & beds']];

function printSummary(d) {
  const w = window.open('', '_blank');
  if (!w) return;
  const a = d.admission;
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const stays = d.stays.map((s) => `<li>${esc(s.ward)} ${esc(s.bed_no)}: ${esc(when(s.from_at))} to ${s.to_at ? esc(when(s.to_at)) : 'now'}</li>`).join('');
  const lines = d.billing.lines.map((l) => `<tr><td>${esc(l.description)}</td><td>${l.qty}</td><td>${esc(inr(l.unit_price))}</td><td>${esc(inr(l.qty * l.unit_price))}</td></tr>`).join('');
  w.document.write(`<!doctype html><title>Discharge summary ${esc(a.admission_no)}</title>
    <style>body{font:14px system-ui,sans-serif;margin:2rem;color:#16323a}table{width:100%;border-collapse:collapse}th,td{text-align:left;padding:.4rem .5rem;border-bottom:1px solid #ccc}</style>
    <h2>Discharge summary</h2><p><b>${esc(a.patient)}</b> (${esc(a.uhid)})<br>Admission ${esc(a.admission_no)} · Doctor ${esc(a.doctor || '–')}<br>
    Admitted ${esc(when(a.admitted_at))}${a.discharged_at ? ` · Discharged ${esc(when(a.discharged_at))}` : ''}</p>
    <p><b>Reason:</b> ${esc(a.reason || '–')}<br><b>Diagnosis:</b> ${esc(a.diagnosis || '–')}</p>
    <p><b>Summary:</b><br>${esc(a.discharge_summary || '–').replace(/\n/g, '<br>')}</p>
    <h3>Bed stays</h3><ul>${stays}</ul><h3>Charges</h3>
    <table><tr><th>Item</th><th>Qty</th><th>Rate</th><th>Amount</th></tr>${lines}</table><p><b>Subtotal ${esc(inr(d.billing.subtotal))}</b></p>`);
  w.document.close(); w.focus(); w.print();
}

export default function IPD({ user }) {
  const [tab, setTab] = useState('admissions');
  const [wards, setWards] = useState([]);
  const [patients, setPatients] = useState([]);
  const [doctors, setDoctors] = useState([]);
  const loadWards = () => api('/ipd/wards').then(setWards).catch(() => {});
  useEffect(() => {
    loadWards();
    api('/patients').then(setPatients).catch(() => {});
    api('/users?role=doctor').then(setDoctors).catch(() => {});
  }, []);
  const freeBeds = wards.flatMap((w) => w.beds.filter((b) => !b.admission_id).map((b) => ({ id: b.id, label: `${w.name} · ${b.bed_no}` })));

  return (
    <>
      <h2>IPD &amp; admission</h2>
      <div className="tabs" role="tablist">
        {tabs.map(([id, label]) => (
          <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? 'on' : ''} onClick={() => setTab(id)}>{label}</button>
        ))}
      </div>
      {tab === 'admissions' && <Admissions patients={patients} doctors={doctors} freeBeds={freeBeds} canDischarge={['doctor', 'hospital_admin'].includes(user.role)} canNote={['doctor', 'nurse', 'hospital_admin'].includes(user.role)} reloadWards={loadWards} />}
      {tab === 'beds' && <BedBoard wards={wards} />}
      {tab === 'setup' && <Setup wards={wards} canSetup={user.role === 'hospital_admin'} reload={loadWards} />}
    </>
  );
}

function Admissions({ patients, doctors, freeBeds, canDischarge, canNote, reloadWards }) {
  const blank = { patientId: '', doctorId: '', bedId: '', reason: '', diagnosis: '' };
  const [list, setList] = useState([]);
  const [status, setStatus] = useState('admitted');
  const [q, setQ] = useState('');
  const [form, setForm] = useState(blank);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');
  const load = () => api(`/ipd/admissions?status=${status}&q=${encodeURIComponent(q)}`).then(setList).catch((e) => setError(e.message));
  useEffect(() => { load(); }, [status, q]);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  async function admit(e) {
    e.preventDefault(); setError(''); setMsg('');
    try { await api('/ipd/admissions', { method: 'POST', body: form }); setForm(blank); setMsg('Patient admitted.'); load(); reloadWards(); }
    catch (err) { setError(err.message); }
  }

  return (
    <>
      <form className="invoice" onSubmit={admit}>
        <h3>Admit a patient</h3>
        <div className="row">
          <select value={form.patientId} onChange={set('patientId')} required aria-label="Patient">
            <option value="">Select patient</option>{patients.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.uhid})</option>)}
          </select>
          <select value={form.doctorId} onChange={set('doctorId')} aria-label="Doctor">
            <option value="">Doctor in charge</option>{doctors.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
          <select value={form.bedId} onChange={set('bedId')} required aria-label="Bed">
            <option value="">Select free bed</option>{freeBeds.map((b) => <option key={b.id} value={b.id}>{b.label}</option>)}
          </select>
        </div>
        <div className="row">
          <input placeholder="Reason for admission" value={form.reason} onChange={set('reason')} />
          <input placeholder="Provisional diagnosis" value={form.diagnosis} onChange={set('diagnosis')} />
          <button className="primary">Admit</button>
        </div>
      </form>
      {msg && <p role="status">{msg}</p>}
      {error && <p className="error" role="alert">{error}</p>}
      <div className="row">
        <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
          <option value="admitted">Currently admitted</option><option value="discharged">Discharged</option><option value="">All</option>
        </select>
        <input placeholder="Search by patient, UHID or admission no." value={q} onChange={(e) => setQ(e.target.value)} style={{ minWidth: 280 }} />
      </div>
      {list.map((a) => <AdmissionCard key={a.id} a={a} freeBeds={freeBeds} canDischarge={canDischarge} canNote={canNote} reload={() => { load(); reloadWards(); }} />)}
      {!list.length && <p>No admissions match.</p>}
    </>
  );
}

function AdmissionCard({ a, freeBeds, canDischarge, canNote, reload }) {
  const [open, setOpen] = useState(false);
  const [d, setD] = useState(null);
  const [error, setError] = useState('');
  const loadDetail = () => api(`/ipd/admissions/${a.id}`).then(setD).catch((e) => setError(e.message));
  useEffect(() => { if (open) loadDetail(); }, [open]);
  const done = () => { loadDetail(); reload(); };
  const admitted = a.status === 'admitted';

  return (
    <article className="note">
      <header>
        <strong>{a.patient}</strong> <small>{a.uhid}</small> <small>{a.admission_no} · admitted {when(a.admitted_at)}{a.doctor ? ` · ${a.doctor}` : ''}</small>
        <span className={`tag ${admitted ? 'checked_in' : 'completed'}`}>{admitted ? `${a.ward} · ${a.bed_no}` : 'Discharged'}</span>
        {a.invoice_status && <span className={`tag ${a.invoice_status}`}>Bill {a.invoice_status}</span>}
        <button className="plain" onClick={() => setOpen(!open)}>{open ? 'Close' : 'Open'}</button>
      </header>
      {(a.reason || a.diagnosis) && <p><small>{[a.reason, a.diagnosis].filter(Boolean).join(' · ')}</small></p>}
      {error && <p className="error" role="alert">{error}</p>}

      {open && d && (
        <>
          <h3>Bed stays</h3>
          <ul>{d.stays.map((s, i) => <li key={i}>{s.ward} {s.bed_no}: {when(s.from_at)} to {s.to_at ? when(s.to_at) : 'now'} ({inr(s.daily_rate)}/day)</li>)}</ul>

          <h3>Care notes</h3>
          {admitted && canNote && <NoteForm id={a.id} done={done} />}
          {d.notes.map((n) => (
            <p key={n.id}><small>{when(n.created_at)} · {n.by || '–'}{Object.values(n.vitals || {}).some(Boolean) ? ` · ${Object.entries(n.vitals).filter(([, v]) => v).map(([k, v]) => `${k.toUpperCase()} ${v}`).join(' · ')}` : ''}</small><br />{n.note}</p>
          ))}
          {!d.notes.length && <p><small>No care notes yet.</small></p>}

          <h3>{admitted ? 'Charges so far' : 'Final bill'}</h3>
          <table>
            <thead><tr><th>Item</th><th>Qty</th><th>Rate</th><th>Amount</th></tr></thead>
            <tbody>{d.billing.lines.map((l, i) => <tr key={i}><td>{l.description}</td><td>{l.qty}</td><td>{inr(l.unit_price)}</td><td>{inr(l.qty * l.unit_price)}</td></tr>)}
              <tr><td colSpan="3"><strong>Subtotal</strong></td><td><strong>{inr(d.billing.subtotal)}</strong></td></tr></tbody>
          </table>
          {admitted && <ChargeForm id={a.id} done={done} />}
          {admitted && <TransferForm id={a.id} freeBeds={freeBeds} done={done} />}
          {admitted && canDischarge && <DischargeForm id={a.id} subtotal={d.billing.subtotal} done={done} />}
          {!admitted && (
            <>
              <h3>Discharge summary</h3>
              <p>{d.admission.discharge_summary}</p>
              <button className="plain" onClick={() => printSummary(d)}>Print summary</button>
            </>
          )}
        </>
      )}
    </article>
  );
}

function useAction(fn, done) {
  const [error, setError] = useState('');
  const run = async (e) => { e?.preventDefault(); setError(''); try { await fn(); done(); } catch (err) { setError(err.message); } };
  return [run, error];
}

function NoteForm({ id, done }) {
  const [f, setF] = useState({ note: '', bp: '', pulse: '', temp: '' });
  const [run, error] = useAction(async () => {
    await api(`/ipd/admissions/${id}/notes`, { method: 'POST', body: { note: f.note, vitals: { bp: f.bp, pulse: f.pulse, temp: f.temp } } });
    setF({ note: '', bp: '', pulse: '', temp: '' });
  }, done);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  return (
    <form className="row" onSubmit={run}>
      <input placeholder="Care note" value={f.note} onChange={set('note')} required style={{ minWidth: 260 }} />
      <input className="narrow" placeholder="BP" value={f.bp} onChange={set('bp')} />
      <input className="narrow" placeholder="Pulse" value={f.pulse} onChange={set('pulse')} />
      <input className="narrow" placeholder="Temp" value={f.temp} onChange={set('temp')} />
      <button className="plain">Add note</button>
      {error && <span className="error" role="alert">{error}</span>}
    </form>
  );
}

function ChargeForm({ id, done }) {
  const [f, setF] = useState({ description: '', qty: 1, unitPrice: '' });
  const [run, error] = useAction(async () => {
    await api(`/ipd/admissions/${id}/charges`, { method: 'POST', body: { ...f, qty: Number(f.qty), unitPrice: Number(f.unitPrice) } });
    setF({ description: '', qty: 1, unitPrice: '' });
  }, done);
  return (
    <form className="row" onSubmit={run}>
      <input placeholder="Extra charge (procedure, consultation…)" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} required style={{ minWidth: 260 }} />
      <input type="number" min="1" className="narrow" aria-label="Quantity" value={f.qty} onChange={(e) => setF({ ...f, qty: e.target.value })} required />
      <input type="number" min="0" step="0.01" className="narrow" placeholder="Price (₹)" value={f.unitPrice} onChange={(e) => setF({ ...f, unitPrice: e.target.value })} required />
      <button className="plain">Add charge</button>
      {error && <span className="error" role="alert">{error}</span>}
    </form>
  );
}

function TransferForm({ id, freeBeds, done }) {
  const [bedId, setBedId] = useState('');
  const [run, error] = useAction(async () => { await api(`/ipd/admissions/${id}/transfer`, { method: 'POST', body: { bedId } }); setBedId(''); }, done);
  return (
    <form className="row" onSubmit={run}>
      <select value={bedId} onChange={(e) => setBedId(e.target.value)} required aria-label="Transfer to bed">
        <option value="">Transfer to bed…</option>{freeBeds.map((b) => <option key={b.id} value={b.id}>{b.label}</option>)}
      </select>
      <button className="plain">Transfer</button>
      {error && <span className="error" role="alert">{error}</span>}
    </form>
  );
}

function DischargeForm({ id, subtotal, done }) {
  const [f, setF] = useState({ summary: '', discount: '', paid: '', method: 'cash' });
  const total = Math.max(0, Math.round((subtotal - Number(f.discount || 0)) * 100) / 100);
  const [run, error] = useAction(() => api(`/ipd/admissions/${id}/discharge`, {
    method: 'POST', body: { summary: f.summary, discount: Number(f.discount || 0), paidAmount: Number(f.paid || 0), method: f.method },
  }), done);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  return (
    <form className="invoice" onSubmit={run}>
      <h3>Discharge</h3>
      <textarea rows="3" placeholder="Discharge summary (condition at discharge, treatment given, advice)" value={f.summary} onChange={set('summary')} required />
      <div className="row">
        <input type="number" min="0" step="0.01" className="narrow" placeholder="Discount (₹)" aria-label="Discount" value={f.discount} onChange={set('discount')} />
        <select value={f.method} onChange={set('method')} aria-label="Payment method"><option value="cash">Cash</option><option value="card">Card</option><option value="upi">UPI</option></select>
        <input type="number" min="0" step="0.01" className="narrow" placeholder="Paid (₹)" aria-label="Amount paid" value={f.paid} onChange={set('paid')} />
        <button type="button" className="plain" onClick={() => setF({ ...f, paid: String(total) })}>Pay in full</button>
        <span className="totals">Estimated total <strong>{inr(total)}</strong></span>
        <button className="primary">Discharge &amp; bill</button>
      </div>
      {error && <p className="error" role="alert">{error}</p>}
    </form>
  );
}

function BedBoard({ wards }) {
  const all = wards.flatMap((w) => w.beds);
  const occupied = all.filter((b) => b.admission_id).length;
  return (
    <>
      <p><strong>{occupied}</strong> of <strong>{all.length}</strong> beds occupied{all.length ? ` (${Math.round((occupied / all.length) * 100)}%)` : ''}.</p>
      {wards.map((w) => (
        <section key={w.id}>
          <h3>{w.name} <small>{w.type} · {inr(w.daily_rate)}/day · {w.beds.filter((b) => b.admission_id).length}/{w.beds.length} occupied</small></h3>
          <div className="beds">
            {w.beds.map((b) => (
              <div key={b.id} className={`bed ${b.admission_id ? 'occ' : ''}`}><strong>{b.bed_no}</strong><small>{b.patient || 'Free'}</small></div>
            ))}
          </div>
        </section>
      ))}
      {!wards.length && <p>No wards yet. An admin can add them under Wards &amp; beds.</p>}
    </>
  );
}

function Setup({ wards, canSetup, reload }) {
  const [ward, setWard] = useState({ name: '', type: 'General', dailyRate: '' });
  const [beds, setBeds] = useState({ wardId: '', prefix: '', start: 1, count: 5 });
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');
  if (!canSetup) return <p>Only a hospital admin can change wards and beds.</p>;

  async function addWard(e) {
    e.preventDefault(); setError(''); setMsg('');
    try { await api('/ipd/wards', { method: 'POST', body: { ...ward, dailyRate: Number(ward.dailyRate) } }); setWard({ name: '', type: 'General', dailyRate: '' }); setMsg('Ward added.'); reload(); }
    catch (err) { setError(err.message); }
  }
  async function addBeds(e) {
    e.preventDefault(); setError(''); setMsg('');
    const bedNos = Array.from({ length: Number(beds.count) }, (_, i) => `${beds.prefix}${Number(beds.start) + i}`);
    try { await api(`/ipd/wards/${beds.wardId}/beds`, { method: 'POST', body: { bedNos } }); setMsg(`${bedNos.length} beds added.`); reload(); }
    catch (err) { setError(err.message); }
  }

  return (
    <>
      <form className="invoice" onSubmit={addWard}>
        <h3>Add ward</h3>
        <div className="row">
          <input placeholder="Ward name" value={ward.name} onChange={(e) => setWard({ ...ward, name: e.target.value })} required />
          <select value={ward.type} onChange={(e) => setWard({ ...ward, type: e.target.value })} aria-label="Ward type">
            {['General', 'ICU', 'Private', 'Semi-private', 'Maternity', 'Pediatric'].map((t) => <option key={t}>{t}</option>)}
          </select>
          <input type="number" min="0" step="0.01" className="narrow" placeholder="Rate / day (₹)" value={ward.dailyRate} onChange={(e) => setWard({ ...ward, dailyRate: e.target.value })} required />
          <button className="primary">Add ward</button>
        </div>
      </form>
      <form className="invoice" onSubmit={addBeds}>
        <h3>Add beds</h3>
        <div className="row">
          <select value={beds.wardId} onChange={(e) => setBeds({ ...beds, wardId: e.target.value })} required aria-label="Ward">
            <option value="">Select ward</option>{wards.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
          </select>
          <input className="narrow" placeholder="Prefix (G)" value={beds.prefix} onChange={(e) => setBeds({ ...beds, prefix: e.target.value })} />
          <input type="number" min="1" className="narrow" aria-label="Start number" value={beds.start} onChange={(e) => setBeds({ ...beds, start: e.target.value })} />
          <input type="number" min="1" max="100" className="narrow" aria-label="How many beds" value={beds.count} onChange={(e) => setBeds({ ...beds, count: e.target.value })} />
          <button className="primary">Add beds</button>
        </div>
        <small>Example: prefix G, start 7, count 3 adds G7, G8, G9.</small>
      </form>
      {msg && <p role="status">{msg}</p>}
      {error && <p className="error" role="alert">{error}</p>}
      <table>
        <thead><tr><th>Ward</th><th>Type</th><th>Rate / day</th><th>Beds</th></tr></thead>
        <tbody>{wards.map((w) => <tr key={w.id}><td>{w.name}</td><td>{w.type}</td><td>{inr(w.daily_rate)}</td><td>{w.beds.length}</td></tr>)}</tbody>
      </table>
    </>
  );
}
