import React, { useEffect, useState } from 'react';
import { api } from '../api.js';

const inr = (n) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n);

export default function Dashboard({ user }) {
  const [s, setS] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    if (user.role === 'super_admin') return;
    api('/dashboard').then(setS).catch((e) => setError(e.message));
  }, []);

  if (user.role === 'super_admin') return <p>Signed in as platform admin. Use <strong>Hospitals</strong> to onboard and manage hospitals.</p>;
  if (error) return <p className="error">{error}</p>;
  if (!s) return <p>Loading…</p>;
  const rows = [
    ['Registered patients', s.patients],
    ['Appointments today', s.appointmentsToday],
    ['Inpatients now', s.inpatients],
    ['Beds occupied', `${s.bedsOccupied} / ${s.bedsTotal}`],
    ['Lab orders pending', s.pendingLab],
    ['Collected today', inr(s.collectedToday)],
    ['Outstanding balance', inr(s.outstanding)],
  ];
  return (
    <>
      <h2>Today at {user.hospitalName}</h2>
      <dl className="stats">
        {rows.map(([k, v]) => (<div key={k}><dd>{v}</dd><dt>{k}</dt></div>))}
      </dl>
    </>
  );
}
