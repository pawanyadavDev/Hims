import React, { useEffect, useState } from 'react';
import { api } from '../api.js';

const blank = { name: '', code: '', adminName: '', adminEmail: '', adminPassword: '' };

export default function Hospitals() {
  const [list, setList] = useState([]);
  const [form, setForm] = useState(blank);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');
  const load = () => api('/hospitals').then(setList).catch((e) => setError(e.message));
  useEffect(() => { load(); }, []);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  async function add(e) {
    e.preventDefault(); setError(''); setMsg('');
    try { await api('/hospitals', { method: 'POST', body: form }); setForm(blank); setMsg('Hospital created. Its admin can sign in now.'); load(); }
    catch (err) { setError(err.message); }
  }
  async function toggle(h) {
    setError('');
    try { await api(`/hospitals/${h.id}`, { method: 'PATCH', body: { isActive: !h.is_active } }); load(); }
    catch (err) { setError(err.message); }
  }

  return (
    <>
      <h2>Hospitals</h2>
      <form className="invoice" onSubmit={add}>
        <h3>Onboard a hospital</h3>
        <div className="row">
          <input placeholder="Hospital name" value={form.name} onChange={set('name')} required />
          <input className="narrow" placeholder="Code" value={form.code} onChange={set('code')} required />
        </div>
        <div className="row">
          <input placeholder="Admin name" value={form.adminName} onChange={set('adminName')} />
          <input type="email" placeholder="Admin email" value={form.adminEmail} onChange={set('adminEmail')} required />
          <input type="password" placeholder="Temporary password (8+ characters)" value={form.adminPassword} onChange={set('adminPassword')} minLength={8} required />
          <button className="primary">Create hospital</button>
        </div>
      </form>
      {msg && <p role="status">{msg}</p>}
      {error && <p className="error" role="alert">{error}</p>}
      <table>
        <thead><tr><th>Hospital</th><th>Code</th><th>Created</th><th>Status</th><th></th></tr></thead>
        <tbody>
          {list.map((h) => (
            <tr key={h.id}>
              <td>{h.name}</td><td>{h.code}</td><td>{new Date(h.created_at).toLocaleDateString('en-IN')}</td>
              <td><span className={`tag ${h.is_active ? 'completed' : 'cancelled'}`}>{h.is_active ? 'Active' : 'Suspended'}</span></td>
              <td><button className="plain" onClick={() => toggle(h)}>{h.is_active ? 'Suspend' : 'Reactivate'}</button></td>
            </tr>
          ))}
          {!list.length && <tr><td colSpan="5">No hospitals yet.</td></tr>}
        </tbody>
      </table>
    </>
  );
}
