import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { authenticate, requireRole, requireTenant } from './middleware/auth.js';
import auth from './routes/auth.js';
import hospitals from './routes/hospitals.js';
import patients from './routes/patients.js';
import appointments from './routes/appointments.js';
import billing from './routes/billing.js';
import dashboard from './routes/dashboard.js';
import users from './routes/users.js';
import opd from './routes/opd.js';
import pharmacy from './routes/pharmacy.js';
import lab from './routes/lab.js';
import ipd from './routes/ipd.js';
import inventory from './routes/inventory.js';
import reports from './routes/reports.js';

if (!process.env.JWT_SECRET || !process.env.DATABASE_URL) throw new Error('JWT_SECRET and DATABASE_URL must be set.');

const app = express();
app.use(helmet());
app.use(cors());
app.use(express.json({ limit: '1mb' }));

app.get('/api/health', (_req, res) => res.json({ ok: true }));
app.use('/api/v1/auth', rateLimit({ windowMs: 15 * 60 * 1000, max: 50 }), auth);

app.use('/api/v1/hospitals', authenticate, hospitals);
app.use('/api/v1/patients', authenticate, requireTenant, patients);
app.use('/api/v1/appointments', authenticate, requireTenant, appointments);
app.use('/api/v1/users', authenticate, requireTenant, users);
app.use('/api/v1/opd', authenticate, requireTenant, opd);
app.use('/api/v1/pharmacy', authenticate, requireTenant, pharmacy);
app.use('/api/v1/lab', authenticate, requireTenant, lab);
app.use('/api/v1/ipd', authenticate, requireTenant, ipd);
app.use('/api/v1/inventory', authenticate, requireTenant, inventory);
app.use('/api/v1/reports', authenticate, requireTenant, reports);
app.use('/api/v1/billing', authenticate, requireTenant, billing);
app.use('/api/v1/dashboard', authenticate, requireTenant, requireRole('hospital_admin', 'doctor', 'receptionist', 'billing', 'nurse', 'pharmacist', 'lab'), dashboard);

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(err.status || 500).json({ error: err.status ? err.message : 'Something went wrong on our side. Please try again.' });
});

app.listen(process.env.PORT || 4000, () => console.log('HIMS API running'));
