import React, { useEffect, useState } from 'react';
import { api } from '../api.js';

const fmt = (d) => new Date(d).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
const next = { booked: ['checked_in', 'cancelled'], checked_in: ['completed'], completed: [], cancelled: [] };
const label = { booked: 'Booked', checked_in: 'Checked in', completed: 'Completed', cancelled: 'Cancelled' };

export default function Appointments({ user }) {
  const [list, setList] = useState([]);
  const [patients, setPatients] = useState([]);
  const [doctors, setDoctors] = useState([]);
  const [form, setForm] = useState({ patientId: '', doctorId: '', scheduledAt: '', reason: '' });
  const [error, setError] = useState('');
  const canBook = ['hospital_admin', 'receptionist'].includes(user.role);

  const load = () => api('/appointments').then(setList).catch((e) => setError(e.message));
  useEffect(() => {
    load();
    api('/patients').then(setPatients).catch(() => {});
    api('/users?role=doctor').then(setDoctors).catch(() => {});
  }, []);

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  async function book(e) {
    e.preventDefault();
    setError('');
    try {
      await api('/appointments', { method: 'POST', body: { ...form, scheduledAt: new Date(form.scheduledAt).toISOString() } });
      setForm({ patientId: '', doctorId: '', scheduledAt: '', reason: '' });
      load();
    } catch (err) { setError(err.message); }
  }

  async function move(id, status) {
    setError('');
    try { await api(`/appointments/${id}/status`, { method: 'PATCH', body: { status } }); load(); }
    catch (err) { setError(err.message); }
  }

  return (
    <>
      <h2>Appointments</h2>
      {canBook && (
        <form className="row" onSubmit={book}>
          <select value={form.patientId} onChange={set('patientId')} required aria-label="Patient">
            <option value="">Select patient</option>
            {patients.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.uhid})</option>)}
          </select>
          <select value={form.doctorId} onChange={set('doctorId')} aria-label="Doctor">
            <option value="">Any doctor</option>
            {doctors.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
          <input type="datetime-local" value={form.scheduledAt} onChange={set('scheduledAt')} required aria-label="Date and time" />
          <input placeholder="Reason for visit" value={form.reason} onChange={set('reason')} />
          <button className="primary">Book appointment</button>
        </form>
      )}
      {error && <p className="error" role="alert">{error}</p>}
      <table>
        <thead><tr><th>When</th><th>Patient</th><th>Doctor</th><th>Status</th><th></th></tr></thead>
        <tbody>
          {list.map((a) => (
            <tr key={a.id}>
              <td>{fmt(a.scheduled_at)}</td>
              <td>{a.patient} <small>{a.uhid}</small></td>
              <td>{a.doctor || '–'}</td>
              <td><span className={`tag ${a.status}`}>{label[a.status]}</span></td>
              <td className="actions">
                {next[a.status].map((s) => <button key={s} onClick={() => move(a.id, s)}>{s === 'cancelled' ? 'Cancel' : `Mark ${label[s].toLowerCase()}`}</button>)}
              </td>
            </tr>
          ))}
          {!list.length && <tr><td colSpan="5">No upcoming appointments.</td></tr>}
        </tbody>
      </table>
    </>
  );
}
