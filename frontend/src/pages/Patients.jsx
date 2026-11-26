import React, { useEffect, useState } from 'react';
import { api } from '../api.js';

export default function Patients() {
  const [list, setList] = useState([]);
  const [q, setQ] = useState('');
  const [form, setForm] = useState({ name: '', gender: '', dob: '', phone: '' });
  const [error, setError] = useState('');

  const load = () => api(`/patients?q=${encodeURIComponent(q)}`).then(setList).catch((e) => setError(e.message));
  useEffect(() => { load(); }, [q]);

  async function add(e) {
    e.preventDefault();
    setError('');
    try {
      await api('/patients', { method: 'POST', body: form });
      setForm({ name: '', gender: '', dob: '', phone: '' });
      load();
    } catch (err) { setError(err.message); }
  }
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  return (
    <>
      <h2>Patients</h2>
      <form className="row" onSubmit={add}>
        <input placeholder="Full name" value={form.name} onChange={set('name')} required />
        <select value={form.gender} onChange={set('gender')}>
          <option value="">Gender</option><option>Female</option><option>Male</option><option>Other</option>
        </select>
        <input type="date" aria-label="Date of birth" value={form.dob} onChange={set('dob')} />
        <input placeholder="Phone" value={form.phone} onChange={set('phone')} />
        <button className="primary">Register patient</button>
      </form>
      {error && <p className="error" role="alert">{error}</p>}
      <input className="search" placeholder="Search by name, UHID or phone" value={q} onChange={(e) => setQ(e.target.value)} />
      <table>
        <thead><tr><th>UHID</th><th>Name</th><th>Gender</th><th>Phone</th></tr></thead>
        <tbody>
          {list.map((p) => (<tr key={p.id}><td>{p.uhid}</td><td>{p.name}</td><td>{p.gender || '–'}</td><td>{p.phone || '–'}</td></tr>))}
          {!list.length && <tr><td colSpan="4">No patients yet. Register the first one above.</td></tr>}
        </tbody>
      </table>
    </>
  );
}
