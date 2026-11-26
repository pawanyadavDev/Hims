import React, { useEffect, useState } from 'react';
import { api } from '../api.js';

const inr = (n) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(n);
const when = (d) => new Date(d).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
const tabs = [['items', 'Items'], ['orders', 'Purchase orders'], ['suppliers', 'Suppliers'], ['movements', 'Stock ledger']];

export default function Inventory({ user }) {
  const canManage = ['hospital_admin', 'pharmacist'].includes(user.role);
  const [tab, setTab] = useState('items');
  const [items, setItems] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const loadItems = () => api('/inventory/items').then(setItems).catch(() => {});
  const loadSuppliers = () => api('/inventory/suppliers').then(setSuppliers).catch(() => {});
  useEffect(() => { loadItems(); loadSuppliers(); }, []);

  return (
    <>
      <h2>Inventory</h2>
      <p><small>Hospital supplies and consumables. Medicines are managed under Pharmacy.</small></p>
      <div className="tabs" role="tablist">
        {tabs.map(([id, label]) => (
          <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? 'on' : ''} onClick={() => setTab(id)}>{label}</button>
        ))}
      </div>
      {tab === 'items' && <Items items={items} canManage={canManage} reload={loadItems} />}
      {tab === 'orders' && <Orders items={items} suppliers={suppliers} canManage={canManage} reloadItems={loadItems} />}
      {tab === 'suppliers' && <Suppliers suppliers={suppliers} canManage={canManage} reload={loadSuppliers} />}
      {tab === 'movements' && <Movements items={items} />}
    </>
  );
}

function Items({ items, canManage, reload }) {
  const blank = { name: '', category: '', unit: 'pcs', reorderLevel: 10, openingQty: '' };
  const [form, setForm] = useState(blank);
  const [filter, setFilter] = useState('');
  const [error, setError] = useState('');
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const low = items.filter((i) => i.qty_on_hand <= i.reorder_level);
  const shown = items.filter((i) => `${i.name} ${i.category || ''}`.toLowerCase().includes(filter.toLowerCase()));

  async function add(e) {
    e.preventDefault(); setError('');
    try { await api('/inventory/items', { method: 'POST', body: { ...form, openingQty: Number(form.openingQty || 0), reorderLevel: Number(form.reorderLevel) } }); setForm(blank); reload(); }
    catch (err) { setError(err.message); }
  }

  return (
    <>
      {low.length > 0 && <p className="callout"><strong>{low.length} item{low.length > 1 ? 's' : ''} at or below reorder level:</strong> {low.map((i) => `${i.name} (${i.qty_on_hand} ${i.unit})`).join(', ')}</p>}
      {canManage && (
        <form className="invoice" onSubmit={add}>
          <h3>Add item</h3>
          <div className="row">
            <input placeholder="Item name" value={form.name} onChange={set('name')} required />
            <input className="narrow" placeholder="Category" value={form.category} onChange={set('category')} />
            <input className="narrow" placeholder="Unit" value={form.unit} onChange={set('unit')} />
            <input type="number" min="0" className="narrow" aria-label="Reorder level" title="Reorder level" value={form.reorderLevel} onChange={set('reorderLevel')} />
            <input type="number" min="0" className="narrow" placeholder="Opening qty" value={form.openingQty} onChange={set('openingQty')} />
            <button className="primary">Add item</button>
          </div>
        </form>
      )}
      {error && <p className="error" role="alert">{error}</p>}
      <input className="search" placeholder="Search items" value={filter} onChange={(e) => setFilter(e.target.value)} />
      <table>
        <thead><tr><th>Item</th><th>Category</th><th>In stock</th><th>Status</th><th></th></tr></thead>
        <tbody>
          {shown.map((i) => <ItemRow key={i.id} i={i} canManage={canManage} reload={reload} />)}
          {!shown.length && <tr><td colSpan="5">No items found.</td></tr>}
        </tbody>
      </table>
    </>
  );
}

function ItemRow({ i, canManage, reload }) {
  const [mode, setMode] = useState('');
  const [value, setValue] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const status = i.qty_on_hand <= 0 ? ['out', 'Out of stock'] : i.qty_on_hand <= i.reorder_level ? ['low', 'Low'] : ['ok', 'In stock'];

  async function submit(e) {
    e.preventDefault(); setError('');
    try {
      if (mode === 'issue') await api(`/inventory/items/${i.id}/issue`, { method: 'POST', body: { qty: Number(value), note } });
      else await api(`/inventory/items/${i.id}/adjust`, { method: 'POST', body: { countedQty: Number(value), note } });
      setMode(''); setValue(''); setNote(''); reload();
    } catch (err) { setError(err.message); }
  }

  return (
    <tr>
      <td>{i.name}</td><td>{i.category || '–'}</td><td>{i.qty_on_hand} {i.unit}</td>
      <td><span className={`tag ${status[0]}`}>{status[1]}</span></td>
      <td>
        {!mode ? (
          <span className="actions">
            <button className="plain" onClick={() => setMode('issue')}>Issue</button>
            {canManage && <button className="plain" onClick={() => setMode('adjust')}>Stock count</button>}
          </span>
        ) : (
          <form className="row" onSubmit={submit} style={{ margin: 0 }}>
            <input type="number" min={mode === 'issue' ? 1 : 0} className="narrow" placeholder={mode === 'issue' ? 'Qty to issue' : 'Counted qty'} aria-label="Quantity" value={value} onChange={(e) => setValue(e.target.value)} required autoFocus />
            <input placeholder={mode === 'issue' ? 'To (ward / dept)' : 'Note'} value={note} onChange={(e) => setNote(e.target.value)} />
            <button className="plain">Save</button>
            <button type="button" className="plain" onClick={() => { setMode(''); setError(''); }}>Cancel</button>
            {error && <span className="error" role="alert">{error}</span>}
          </form>
        )}
      </td>
    </tr>
  );
}

function Orders({ items, suppliers, canManage, reloadItems }) {
  const blankLine = { itemId: '', qty: '', unitCost: '' };
  const [orders, setOrders] = useState([]);
  const [supplierId, setSupplierId] = useState('');
  const [lines, setLines] = useState([{ ...blankLine }]);
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');
  const load = () => api('/inventory/purchase-orders').then(setOrders).catch((e) => setError(e.message));
  useEffect(() => { load(); }, []);
  const total = lines.reduce((s, l) => s + Number(l.qty || 0) * Number(l.unitCost || 0), 0);
  const setLine = (idx, k) => (e) => setLines(lines.map((l, i) => (i === idx ? { ...l, [k]: e.target.value } : l)));

  async function create(e) {
    e.preventDefault(); setError('');
    try {
      await api('/inventory/purchase-orders', { method: 'POST', body: { supplierId, notes, items: lines.map((l) => ({ itemId: l.itemId, qty: Number(l.qty), unitCost: Number(l.unitCost) })) } });
      setSupplierId(''); setLines([{ ...blankLine }]); setNotes(''); load();
    } catch (err) { setError(err.message); }
  }
  async function act(id, what) {
    setError('');
    try { await api(`/inventory/purchase-orders/${id}/${what}`, { method: 'POST' }); load(); reloadItems(); }
    catch (err) { setError(err.message); }
  }

  return (
    <>
      {canManage && (
        <form className="invoice" onSubmit={create}>
          <h3>New purchase order</h3>
          <select value={supplierId} onChange={(e) => setSupplierId(e.target.value)} required aria-label="Supplier">
            <option value="">Select supplier</option>{suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          {lines.map((l, idx) => (
            <div className="row" key={idx}>
              <select value={l.itemId} onChange={setLine(idx, 'itemId')} required aria-label="Item">
                <option value="">Select item</option>{items.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
              </select>
              <input type="number" min="1" className="narrow" placeholder="Qty" value={l.qty} onChange={setLine(idx, 'qty')} required />
              <input type="number" min="0" step="0.01" className="narrow" placeholder="Unit cost (₹)" value={l.unitCost} onChange={setLine(idx, 'unitCost')} required />
              {lines.length > 1 && <button type="button" className="plain" onClick={() => setLines(lines.filter((_, i) => i !== idx))}>Remove</button>}
            </div>
          ))}
          <input placeholder="Notes (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} />
          <div className="row">
            <button type="button" className="plain" onClick={() => setLines([...lines, { ...blankLine }])}>Add item</button>
            <strong>Total: {inr(total)}</strong>
            <button className="primary">Create order</button>
          </div>
        </form>
      )}
      {error && <p className="error" role="alert">{error}</p>}
      {orders.map((o) => (
        <article className="note" key={o.id}>
          <header>
            <strong>{o.po_no}</strong> <small>{o.supplier} · {when(o.created_at)}</small>
            <span className={`tag ${o.status === 'received' ? 'completed' : o.status}`}>{o.status}</span>
            <strong>{inr(o.total)}</strong>
            {canManage && o.status === 'ordered' && <>
              <button className="plain" onClick={() => act(o.id, 'receive')}>Mark received</button>
              <button className="plain" onClick={() => act(o.id, 'cancel')}>Cancel</button>
            </>}
          </header>
          <ul>{o.items.map((i, k) => <li key={k}>{i.item} × {i.qty} {i.unit} @ {inr(i.unit_cost)}</li>)}</ul>
          {o.notes && <p><small>{o.notes}</small></p>}
        </article>
      ))}
      {!orders.length && <p>No purchase orders yet.</p>}
    </>
  );
}

function Suppliers({ suppliers, canManage, reload }) {
  const blank = { name: '', phone: '', email: '', address: '' };
  const [form, setForm] = useState(blank);
  const [error, setError] = useState('');
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  async function add(e) {
    e.preventDefault(); setError('');
    try { await api('/inventory/suppliers', { method: 'POST', body: form }); setForm(blank); reload(); }
    catch (err) { setError(err.message); }
  }
  return (
    <>
      {canManage && (
        <form className="invoice" onSubmit={add}>
          <h3>Add supplier</h3>
          <div className="row">
            <input placeholder="Supplier name" value={form.name} onChange={set('name')} required />
            <input className="narrow" placeholder="Phone" value={form.phone} onChange={set('phone')} />
            <input type="email" placeholder="Email" value={form.email} onChange={set('email')} />
            <input placeholder="Address" value={form.address} onChange={set('address')} />
            <button className="primary">Add supplier</button>
          </div>
        </form>
      )}
      {error && <p className="error" role="alert">{error}</p>}
      <table>
        <thead><tr><th>Supplier</th><th>Phone</th><th>Email</th><th>Address</th></tr></thead>
        <tbody>
          {suppliers.map((s) => <tr key={s.id}><td>{s.name}</td><td>{s.phone || '–'}</td><td>{s.email || '–'}</td><td>{s.address || '–'}</td></tr>)}
          {!suppliers.length && <tr><td colSpan="4">No suppliers yet.</td></tr>}
        </tbody>
      </table>
    </>
  );
}

function Movements({ items }) {
  const [rows, setRows] = useState([]);
  const [itemId, setItemId] = useState('');
  const [error, setError] = useState('');
  useEffect(() => { api(`/inventory/movements?itemId=${itemId}`).then(setRows).catch((e) => setError(e.message)); }, [itemId]);
  return (
    <>
      <select value={itemId} onChange={(e) => setItemId(e.target.value)} aria-label="Item">
        <option value="">All items</option>{items.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
      </select>
      {error && <p className="error" role="alert">{error}</p>}
      <table style={{ marginTop: '1rem' }}>
        <thead><tr><th>When</th><th>Item</th><th>Change</th><th>Reason</th><th>Reference / note</th><th>By</th></tr></thead>
        <tbody>
          {rows.map((m) => (
            <tr key={m.id}><td>{when(m.created_at)}</td><td>{m.item}</td>
              <td className={m.change < 0 ? 'flag-alert' : ''}>{m.change > 0 ? '+' : ''}{m.change} {m.unit}</td>
              <td>{m.reason}</td><td>{[m.reference, m.note].filter(Boolean).join(' · ') || '–'}</td><td>{m.by || '–'}</td></tr>
          ))}
          {!rows.length && <tr><td colSpan="6">No stock movements yet.</td></tr>}
        </tbody>
      </table>
    </>
  );
}
