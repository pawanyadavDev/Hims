import React, { useEffect, useState } from 'react';
import { api } from '../api.js';

const emptyMed = { medicine: '', dosage: '', frequency: '', duration: '', instructions: '' };
const emptyForm = { patientId: '', appointmentId: '', vitals: { bp: '', pulse: '', temp: '', spo2: '', weight: '' }, complaints: '', diagnosis: '', notes: '', followUpDate: '' };
const fmt = (d) => new Date(d).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });

export default function OPD({ user }) {
  const isDoctor = user.role === 'doctor';
  const [queue, setQueue] = useState([]);
  const [history, setHistory] = useState([]);
  const [patients, setPatients] = useState([]);
  const [form, setForm] = useState(emptyForm);
  const [meds, setMeds] = useState([{ ...emptyMed }]);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState('');
  const [tests, setTests] = useState([]);
  const [labPick, setLabPick] = useState([]);
  const [labQ, setLabQ] = useState('');

  const load = () => {
    api('/appointments').then((a) => setQueue(a.filter((x) => ['booked', 'checked_in'].includes(x.status) && x.scheduled_at.slice(0, 10) === new Date().toISOString().slice(0, 10)))).catch(() => {});
    api('/opd/consultations').then(setHistory).catch((e) => setError(e.message));
  };
  useEffect(() => { load(); api('/patients').then(setPatients).catch(() => {}); api('/lab/tests').then(setTests).catch(() => {}); }, []);

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const setVital = (k) => (e) => setForm({ ...form, vitals: { ...form.vitals, [k]: e.target.value } });
  const setMed = (i, k) => (e) => setMeds(meds.map((m, j) => (j === i ? { ...m, [k]: e.target.value } : m)));

  function start(a) { setSaved(''); setForm({ ...emptyForm, patientId: a.patient_id, appointmentId: a.id }); }

  async function save(e) {
    e.preventDefault();
    setError(''); setSaved('');
    try {
      await api('/opd/consultations', { method: 'POST', body: { ...form, followUpDate: form.followUpDate || null, prescription: meds, labTests: labPick } });
      setForm(emptyForm); setMeds([{ ...emptyMed }]); setLabPick([]); setLabQ(''); setSaved('Consultation saved.'); load();
    } catch (err) { setError(err.message); }
  }

  return (
    <>
      <h2>OPD</h2>
      <h3>Today&rsquo;s queue</h3>
      <table>
        <thead><tr><th>Time</th><th>Patient</th><th>Doctor</th><th></th></tr></thead>
        <tbody>
          {queue.map((a) => (
            <tr key={a.id}>
              <td>{fmt(a.scheduled_at)}</td><td>{a.patient} <small>{a.uhid}</small></td><td>{a.doctor || '–'}</td>
              <td>{isDoctor && <button className="plain" onClick={() => start(a)}>Start consultation</button>}</td>
            </tr>
          ))}
          {!queue.length && <tr><td colSpan="4">No patients waiting today.</td></tr>}
        </tbody>
      </table>

      {isDoctor && (
        <form className="invoice" onSubmit={save}>
          <h3>New consultation</h3>
          <select value={form.patientId} onChange={set('patientId')} required aria-label="Patient">
            <option value="">Select patient</option>
            {patients.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.uhid})</option>)}
          </select>
          <div className="row">
            {[['bp', 'BP (mmHg)'], ['pulse', 'Pulse (/min)'], ['temp', 'Temp (°C)'], ['spo2', 'SpO₂ (%)'], ['weight', 'Weight (kg)']].map(([k, ph]) => (
              <input key={k} className="narrow" placeholder={ph} aria-label={ph} value={form.vitals[k]} onChange={setVital(k)} />
            ))}
          </div>
          <textarea placeholder="Complaints" value={form.complaints} onChange={set('complaints')} rows="2" />
          <textarea placeholder="Diagnosis" value={form.diagnosis} onChange={set('diagnosis')} rows="2" />
          <textarea placeholder="Notes" value={form.notes} onChange={set('notes')} rows="2" />
          <h3>Prescription</h3>
          {meds.map((m, i) => (
            <div className="row" key={i}>
              <input placeholder="Medicine" value={m.medicine} onChange={setMed(i, 'medicine')} />
              <input className="narrow" placeholder="Dosage" value={m.dosage} onChange={setMed(i, 'dosage')} />
              <input className="narrow" placeholder="Frequency" value={m.frequency} onChange={setMed(i, 'frequency')} />
              <input className="narrow" placeholder="Duration" value={m.duration} onChange={setMed(i, 'duration')} />
              <input placeholder="Instructions" value={m.instructions} onChange={setMed(i, 'instructions')} />
              {meds.length > 1 && <button type="button" className="plain" onClick={() => setMeds(meds.filter((_, j) => j !== i))}>Remove</button>}
            </div>
          ))}
          <div className="row">
            <button type="button" className="plain" onClick={() => setMeds([...meds, { ...emptyMed }])}>Add medicine</button>
          </div>
          <h3>Lab tests</h3>
          <input className="search" placeholder="Search lab tests to order" value={labQ} onChange={(e) => setLabQ(e.target.value)} />
          <div className="checks">
            {tests.filter((t) => `${t.name} ${t.category || ''}`.toLowerCase().includes(labQ.toLowerCase())).map((t) => (
              <label key={t.id}>
                <input type="checkbox" checked={labPick.includes(t.id)} onChange={() => setLabPick(labPick.includes(t.id) ? labPick.filter((x) => x !== t.id) : [...labPick, t.id])} /> {t.name}
              </label>
            ))}
            {!tests.length && <span>No lab tests in the catalog yet.</span>}
          </div>
          <div className="row">
            <label className="inline">Follow-up on <input type="date" value={form.followUpDate} onChange={set('followUpDate')} /></label>
            <button className="primary">Save consultation</button>
          </div>
          {saved && <p role="status">{saved}</p>}
        </form>
      )}
      {error && <p className="error" role="alert">{error}</p>}

      <h3>Recent consultations</h3>
      {history.map((c) => (
        <article className="note" key={c.id}>
          <header><strong>{c.patient}</strong> <small>{c.uhid}</small> <small>{fmt(c.created_at)} · {c.doctor}</small></header>
          {Object.values(c.vitals || {}).some(Boolean) && (
            <p><small>{Object.entries(c.vitals).filter(([, v]) => v).map(([k, v]) => `${k.toUpperCase()} ${v}`).join(' · ')}</small></p>
          )}
          {c.complaints && <p><b>Complaints:</b> {c.complaints}</p>}
          {c.diagnosis && <p><b>Diagnosis:</b> {c.diagnosis}</p>}
          {c.prescription.length > 0 && (
            <ul>{c.prescription.map((m, i) => <li key={i}>{[m.medicine, m.dosage, m.frequency, m.duration].filter(Boolean).join(' · ')}{m.instructions ? ` (${m.instructions})` : ''}</li>)}</ul>
          )}
          {c.lab && c.lab.map((o) => (
            <p key={o.order_no}><small>Lab {o.order_no} ({o.status}): {(o.tests || []).map((t) => (t.result ? `${t.name} ${t.result}${t.unit ? ' ' + t.unit : ''}${t.flag && t.flag !== 'normal' ? ' (' + t.flag + ')' : ''}` : t.name)).join(', ')}</small></p>
          ))}
          {c.follow_up_date && <p><small>Follow-up: {new Date(c.follow_up_date).toLocaleDateString('en-IN')}</small></p>}
        </article>
      ))}
      {!history.length && <p>No consultations recorded yet.</p>}
    </>
  );
}
