# HIMS – Hospital Information Management System

Multi-tenant hospital platform: **React + Node.js (Express) + PostgreSQL**, run with Docker.
One installation serves many hospitals; each hospital sees only its own data.

## Quick start

```bash
cp .env.example .env          # set strong secrets
# IMPORTANT: the DB role password in database/schema.sql (hims_app) must equal APP_DB_PASSWORD in .env
docker compose up -d --build
docker compose exec backend node src/seed.js     # demo hospital, users and sample data
```

Open http://localhost:8080. All demo users have the password `Password@123`. **Change them immediately** (My account, or Staff > Reset password).

| Login | Role |
|---|---|
| `super@hims.local` | Platform admin (onboard/suspend hospitals) |
| `admin@citycare.local` | Hospital admin |
| `doctor@citycare.local` | Doctor |
| `reception@citycare.local` | Receptionist |
| `nurse@citycare.local` | Nurse |
| `billing@citycare.local` | Billing |
| `pharmacist@citycare.local` | Pharmacist |
| `lab@citycare.local` | Lab technician |

## Modules (all built)

| Module | What it does |
|---|---|
| Hospitals (platform admin) | Onboard a hospital with its first admin, suspend or reactivate |
| Staff (hospital admin) | Add users, assign roles, deactivate, reset passwords |
| Patients | Register with a unique UHID, search |
| Appointments | Book, check in, complete, cancel |
| OPD | Today's queue, vitals, diagnosis, prescription, lab orders, follow-up |
| IPD & admission | Wards and beds, admit, bed board, transfers, care notes, extra charges, discharge summary and bill |
| Laboratory | Test catalog, orders (OPD or walk-in), sample collection and billing, results with flags, printable reports |
| Pharmacy | Dispense OPD prescriptions, batch stock with expiry (earliest first), low-stock and expiry alerts, billing, patient-wise records |
| Billing & payment | Itemised invoices, partial payments. Pharmacy, lab and IPD invoices all appear here |
| Inventory | Hospital supplies, suppliers, purchase orders, issue and stock count, full stock ledger |
| Reports | Billed vs collected, revenue by source, doctor activity, bed occupancy, low stock, CSV export |
| Dashboard | Patients, appointments, inpatients, bed occupancy, pending lab, collections, outstanding |

The menu shows each user only what their role can use, and the API enforces the same rules.

## How multi-tenancy works

- Every tenant table has `hospital_id`; PostgreSQL Row-Level Security limits each query to `app.hospital_id`.
- The API sets it from the user's JWT via `withTenant()` in `backend/src/db.js`, inside a transaction.
- The API connects as `hims_app` (not a superuser), so RLS cannot be bypassed.
- `users` is not under RLS because login looks up by email. Always filter it by `hospital_id` in code.
- Data integrity is enforced in the database too: one open admission per patient, one patient per bed, stock never below zero.

## Billing rules

- Pharmacy sale, lab sample collection and IPD discharge each create a normal invoice (with optional discount and payment).
- **Bed days:** every full 24 hours in a bed is charged at that ward's daily rate (rate copied at allocation time). The final bed is charged at least one day, so a same-day transfer is not billed twice.
- Lab test and medicine prices are copied onto orders and sales, so later price changes never alter past bills.

## Database

`database/schema.sql` plus `database/migrations/002_opd.sql` to `006_inventory.sql`. A fresh install applies them all automatically.
**Upgrading an existing database:** run any migration you have not applied, in order, e.g.
`docker compose exec -T db psql -U postgres -d hims < database/migrations/005_ipd.sql`, then rebuild and re-run the seed script.
Note: OPD needs `004_lab.sql`, and Reports and the Dashboard need `005_ipd.sql` and `006_inventory.sql`.

## API (all under /api/v1)

`/auth` (login, change-password) · `/hospitals` · `/users` · `/patients` · `/appointments` · `/opd/consultations` ·
`/ipd` (wards, beds, admissions, transfer, notes, charges, discharge) · `/lab` (tests, orders, collect, results, cancel) ·
`/pharmacy` (medicines, batches, alerts, prescriptions, sales) · `/billing` (invoices, payments) ·
`/inventory` (items, issue, adjust, suppliers, purchase-orders, movements, alerts) · `/reports/overview` · `/dashboard`

## Local development without Docker

```bash
cd backend && npm install && DATABASE_URL=... JWT_SECRET=... npm run dev
cd frontend && npm install && npm run dev        # http://localhost:5173, proxies /api to :4000
```

## Before going live

- HTTPS in front (Nginx/Caddy with Let's Encrypt), rotate every secret, change the `hims_app` password.
- Automated database backups and a tested restore.
- Add input-validation (e.g. Zod), refresh tokens, 2FA for admins, and automated tests (none are included yet).
- Review compliance: India's DPDP Act, ABDM/ABHA integration, data retention.
- Not included: patient portal, telemedicine, insurance/TPA claims, HR/payroll (see the project document for the roadmap).

## Deploy on Render (demo or small clinic)

1. **PostgreSQL:** Render > New > PostgreSQL (note: the free plan expires after 30 days and has no backups, so use a paid plan for real data). Copy its *Internal Database URL*.
2. **Backend:** New > Web Service > this repo > Language *Docker* > Dockerfile path `./Dockerfile.render` > same region as the database.
   Environment: `DATABASE_URL` (internal URL), `JWT_SECRET` (long random text), `MANAGED_DB=true`, `RUN_SEED=true` (first deploy only), `SEED_PASSWORD` (a strong password for the demo users).
3. **Frontend:** New > Static Site > this repo > Root directory `frontend` > Build `npm install && npm run build` > Publish `dist`.
   Environment: `VITE_API_URL` = the backend's https URL (no trailing slash). Redirects/Rewrites: `/*` to `/index.html` (Rewrite).
4. After the first successful deploy, remove `RUN_SEED` from the backend and redeploy.

The backend applies the database schema by itself on start (`backend/src/migrate.js`) and refuses to start if the database user could bypass row-level security.
