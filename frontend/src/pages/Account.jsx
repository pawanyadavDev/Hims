import React, { useState } from 'react';
import { api } from '../api.js';

export default function Account({ user }) {
  const [f, setF] = useState({ currentPassword: '', newPassword: '' });
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');

  async function submit(e) {
    e.preventDefault(); setError(''); setMsg('');
    try { await api('/auth/change-password', { method: 'POST', body: f }); setF({ currentPassword: '', newPassword: '' }); setMsg('Password changed.'); }
    catch (err) { setError(err.message); }
  }

  return (
    <>
      <h2>My account</h2>
      <p>{user.name} · {user.role.replace('_', ' ')}{user.hospitalName ? ` · ${user.hospitalName}` : ''}</p>
      <form className="invoice" onSubmit={submit} style={{ maxWidth: 420 }}>
        <h3>Change password</h3>
        <input type="password" placeholder="Current password" autoComplete="current-password" value={f.currentPassword} onChange={(e) => setF({ ...f, currentPassword: e.target.value })} required />
        <input type="password" placeholder="New password (8+ characters)" autoComplete="new-password" minLength={8} value={f.newPassword} onChange={(e) => setF({ ...f, newPassword: e.target.value })} required />
        <button className="primary">Change password</button>
        {msg && <p role="status">{msg}</p>}
        {error && <p className="error" role="alert">{error}</p>}
      </form>
    </>
  );
}
