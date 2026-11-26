import React, { useEffect, useState } from 'react';
import { api } from '../api.js';

const inr = (n) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n);
const iso = (d) => d.toISOString().slice(0, 10);

function downloadCsv(name, rows) {
  if (!rows.length) return;
  const cols = Object.keys(rows[0]);
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const csv = [cols.join(','), ...rows.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  a.download = `${name}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

function Chart({ data }) {
  const W = 640, H = 170, pad = 24;
  const max = Math.max(1, ...data.flatMap((d) => [Number(d.billed), Number(d.collected)]));
  const bw = (W - pad * 2) / Math.max(1, data.length);
  const h = (v) => (Number(v) / max) * (H - pad * 2);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Daily amount billed and collected" style={{ width: '100%', background: '#fff', border: '1px solid #d5e0dd', borderRadius: 8 }}>
      {data.map((d, i) => (
        <g key={d.day}>
          <title>{`${d.day}: billed ${inr(d.billed)}, collected ${inr(d.collected)}`}</title>
          <rect x={pad + i * bw} y={H - pad - h(d.billed)} width={Math.max(1, bw * 0.42)} height={h(d.billed)} fill="#b8cfc9" />
          <rect x={pad + i * bw + bw * 0.45} y={H - pad - h(d.collected)} width={Math.max(1, bw * 0.42)} height={h(d.collected)} fill="#1f7a6b" />
        </g>
      ))}
      <text x={pad} y={14} fontSize="11" fill="#4b6865">Daily peak {inr(max)} · light bars: billed · dark bars: collected</text>
      <text x={pad} y={H - 6} fontSize="10" fill="#4b6865">{data[0]?.day}</text>
      <text x={W - pad} y={H - 6} fontSize="10" fill="#4b6865" textAnchor="end">{data[data.length - 1]?.day}</text>
    </svg>
  );
}

export default function Reports() {
  const [from, setFrom] = useState(iso(new Date(Date.now() - 29 * 864e5)));
  const [to, setTo] = useState(iso(new Date()));
  const [d, setD] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    setError('');
    api(`/reports/overview?from=${from}&to=${to}`).then(setD).catch((e) => { setD(null); setError(e.message); });
  }, [from, to]);

  const k = d?.kpis;
  const tiles = k && [
    ['Billed', inr(k.billed)], ['Collected', inr(k.collected)], ['Outstanding', inr(k.outstanding)],
    ['New patients', k.newPatients], ['OPD consultations', k.consultations], ['Appointments', k.appointments],
    ['Admissions', k.admissions], ['Discharges', k.discharges], ['Lab orders', k.labOrders], ['Pharmacy sales', inr(k.pharmacySales)],
  ];
  const occ = d && d.now.bedsTotal ? Math.round((d.now.bedsOccupied / d.now.bedsTotal) * 100) : 0;

  return (
    <>
      <h2>Reports &amp; analytics</h2>
      <div className="row">
        <label className="inline">From <input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} /></label>
        <label className="inline">To <input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} /></label>
      </div>
      {error && <p className="error" role="alert">{error}</p>}
      {d && (
        <>
          <dl className="stats">{tiles.map(([t, v]) => <div key={t}><dd>{v}</dd><dt>{t}</dt></div>)}</dl>

          <h3>Daily billing and collections</h3>
          <Chart data={d.daily} />
          <p><button className="plain" onClick={() => downloadCsv(`revenue-${from}-to-${to}`, d.daily)}>Export CSV</button></p>

          <h3>Revenue by source</h3>
          <table>
            <thead><tr><th>Source</th><th>Invoices</th><th>Billed</th><th>Collected</th></tr></thead>
            <tbody>
              {d.bySource.map((s) => <tr key={s.source}><td>{s.source}</td><td>{s.invoices}</td><td>{inr(s.billed)}</td><td>{inr(s.collected)}</td></tr>)}
              {!d.bySource.length && <tr><td colSpan="4">No invoices in this period.</td></tr>}
            </tbody>
          </table>
          <p><button className="plain" onClick={() => downloadCsv(`revenue-by-source-${from}-to-${to}`, d.bySource)}>Export CSV</button></p>

          <h3>Doctor activity</h3>
          <table>
            <thead><tr><th>Doctor</th><th>OPD consultations</th><th>IPD admissions</th></tr></thead>
            <tbody>
              {d.doctors.map((x) => <tr key={x.doctor}><td>{x.doctor}</td><td>{x.consultations}</td><td>{x.admissions}</td></tr>)}
              {!d.doctors.length && <tr><td colSpan="3">No doctors added yet.</td></tr>}
            </tbody>
          </table>
          <p><button className="plain" onClick={() => downloadCsv(`doctor-activity-${from}-to-${to}`, d.doctors)}>Export CSV</button></p>

          <h3>Right now</h3>
          <dl className="stats">
            <div><dd>{d.now.bedsOccupied} / {d.now.bedsTotal}</dd><dt>Beds occupied ({occ}%)</dt></div>
            <div><dd>{d.now.lowStockMedicines}</dd><dt>Medicines at or below reorder level</dt></div>
            <div><dd>{d.now.lowStockItems}</dd><dt>Supplies at or below reorder level</dt></div>
          </dl>
        </>
      )}
    </>
  );
}
