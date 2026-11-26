import React, { useState } from 'react';
import { api, session } from '../api.js';

export default function Login({ onLogin }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  async function submit(e) {
    e.preventDefault();
    setError('');
    try {
      const { token, user } = await api('/auth/login', { method: 'POST', body: { email, password } });
      session.save(token, user);
      onLogin(user);
    } catch (err) { setError(err.message); }
  }

  return (
    <div className="login">
      <form onSubmit={submit}>
        <h1>Sign in to HIMS</h1>
        <label>Email<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus /></label>
        <label>Password<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required /></label>
        {error && <p className="error" role="alert">{error}</p>}
        <button className="primary">Sign in</button>
      </form>
    </div>
  );
}
