import React, { useEffect, useState } from 'react';
import { api } from '../api.js';

const roles = [['doctor', 'Doctor'], ['receptionist', 'Receptionist'], ['nurse', 'Nurse'], ['billing', 'Billing'], ['lab', 'Lab technician'], ['pharmacist', 'Pharmacist'], ['hospital_admin', 'Hospital admin']];
const roleName = Object.fromEntries(roles);
const blank = { name: '', email: '', password: '', role: 'doctor' };

export default function Staff({ user }) {
  const [list, setList] = useState([]);
  const [form, setForm] = useState(blank);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');
  const load = () => api('/users?all=1').then(setList).catch((e) => setError(e.message));
  useEffect(() => { load(); }, []);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  async function add(e) {
    e.preventDefault(); setError(''); setMsg('');
    try { await api('/users', { method: 'POST', body: form }); setForm(blank); setMsg('Staff member added.'); load(); }
    catch (err) { setError(err.message); }
  }
  async function patch(id, body, done) {
    setError(''); setMsg('');
    try { await api(`/users/${id}`, { method: 'PATCH', body }); if (done) setMsg(done); load(); }
    catch (err) { setError(err.message); }
  }
  function reset(u) {
    const password = window.prompt(`New password for ${u.name} (at least 8 characters):`);
    if (password) patch(u.id, { password }, `Password reset for ${u.name}.`);
  }

  return (
    <>
      <h2>Staff</h2>
      <form className="invoice" onSubmit={add}>
        <h3>Add staff member</h3>
        <div className="row">
          <input placeholder="Full name" value={form.name} onChange={set('name')} required />
          <input type="email" placeholder="Email" value={form.email} onChange={set('email')} required />
          <input type="password" placeholder="Temporary password" value={form.password} onChange={set('password')} minLength={8} required />
          <select value={form.role} onChange={set('role')} aria-label="Role">{roles.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
          <button className="primary">Add</button>
        </div>
      </form>
      {msg && <p role="status">{msg}</p>}
      {error && <p className="error" role="alert">{error}</p>}
      <table>
        <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Status</th><th></th></tr></thead>
        <tbody>
          {list.map((u) => (
            <tr key={u.id}>
              <td>{u.name}</td><td>{u.email}</td><td>{roleName[u.role] || u.role}</td>
              <td><span className={`tag ${u.is_active ? 'completed' : 'cancelled'}`}>{u.is_active ? 'Active' : 'Inactive'}</span></td>
              <td className="actions">
                {u.id !== user.id && <>
                  <button className="plain" onClick={() => patch(u.id, { isActive: !u.is_active })}>{u.is_active ? 'Deactivate' : 'Activate'}</button>
                  <button className="plain" onClick={() => reset(u)}>Reset password</button>
                </>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
