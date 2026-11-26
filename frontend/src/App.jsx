import React, { useState } from 'react';
import { session } from './api.js';
import Login from './pages/Login.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Hospitals from './pages/Hospitals.jsx';
import Patients from './pages/Patients.jsx';
import Appointments from './pages/Appointments.jsx';
import OPD from './pages/OPD.jsx';
import IPD from './pages/IPD.jsx';
import Pharmacy from './pages/Pharmacy.jsx';
import Laboratory from './pages/Laboratory.jsx';
import Billing from './pages/Billing.jsx';
import Inventory from './pages/Inventory.jsx';
import Reports from './pages/Reports.jsx';
import Staff from './pages/Staff.jsx';
import Account from './pages/Account.jsx';

const staff = ['hospital_admin', 'doctor', 'receptionist', 'nurse', 'billing', 'pharmacist', 'lab'];

// Each menu item is shown only to the roles that can use it (the API enforces the same rules).
const pages = [
  { id: 'dashboard', label: 'Dashboard', view: Dashboard, roles: [...staff, 'super_admin'] },
  { id: 'hospitals', label: 'Hospitals', view: Hospitals, roles: ['super_admin'] },
  { id: 'patients', label: 'Patients', view: Patients, roles: staff },
  { id: 'appointments', label: 'Appointments', view: Appointments, roles: ['hospital_admin', 'doctor', 'receptionist', 'nurse'] },
  { id: 'opd', label: 'OPD', view: OPD, roles: ['hospital_admin', 'doctor', 'nurse'] },
  { id: 'ipd', label: 'IPD & admission', view: IPD, roles: ['hospital_admin', 'doctor', 'nurse', 'receptionist'] },
  { id: 'lab', label: 'Laboratory', view: Laboratory, roles: ['hospital_admin', 'doctor', 'lab', 'receptionist'] },
  { id: 'pharmacy', label: 'Pharmacy', view: Pharmacy, roles: ['hospital_admin', 'pharmacist'] },
  { id: 'billing', label: 'Billing & payment', view: Billing, roles: ['hospital_admin', 'billing', 'receptionist'] },
  { id: 'inventory', label: 'Inventory', view: Inventory, roles: ['hospital_admin', 'pharmacist', 'nurse', 'lab', 'doctor'] },
  { id: 'reports', label: 'Reports', view: Reports, roles: ['hospital_admin', 'billing'] },
  { id: 'staff', label: 'Staff', view: Staff, roles: ['hospital_admin'] },
  { id: 'account', label: 'My account', view: Account, roles: [...staff, 'super_admin'] },
];

export default function App() {
  const [user, setUser] = useState(session.user);
  const [page, setPage] = useState(session.user?.role === 'super_admin' ? 'hospitals' : 'dashboard');
  if (!user) return <Login onLogin={(u) => { setUser(u); setPage(u.role === 'super_admin' ? 'hospitals' : 'dashboard'); }} />;

  const menu = pages.filter((p) => p.roles.includes(user.role));
  const View = (menu.find((p) => p.id === page) || menu[0]).view;

  return (
    <div className="shell">
      <aside className="side">
        <h1>HIMS</h1>
        <p className="hospital">{user.hospitalName || 'Platform'}</p>
        <nav>
          {menu.map((p) => (
            <button key={p.id} className={p.id === page ? 'on' : ''} onClick={() => setPage(p.id)}>{p.label}</button>
          ))}
        </nav>
        <button className="out" onClick={() => { session.clear(); setUser(null); }}>Sign out ({user.name})</button>
      </aside>
      <main><View user={user} /></main>
    </div>
  );
}
