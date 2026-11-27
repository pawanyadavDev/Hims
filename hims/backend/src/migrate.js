// Applies database/schema.sql and database/migrations/*.sql on a managed database (e.g. Render).
// Does nothing unless MANAGED_DB=true, so local Docker (where Postgres loads the files itself) is unaffected.
// Safe to run on every start: files already applied are skipped. Set RUN_SEED=true to also load demo data.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { pool } from './db.js';

if (process.env.MANAGED_DB !== 'true') {
  console.log('MANAGED_DB is not "true": skipping migrations.');
  await pool.end();
  process.exit(0);
}

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../database');
const files = ['schema.sql', ...fs.readdirSync(path.join(dir, 'migrations')).filter((f) => f.endsWith('.sql')).sort().map((f) => `migrations/${f}`)];
// A managed database does not allow creating the hims_app login role, so those statements are skipped.
// Tenant isolation is enforced by row-level security forced on the owner (007_force_rls.sql).
const strip = (sql) => sql.replace(/^CREATE ROLE hims_app.*$/gm, '').replace(/^GRANT .* TO hims_app;$/gm, '');

await pool.query('CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())');
const done = new Set((await pool.query('SELECT name FROM schema_migrations')).rows.map((r) => r.name));

for (const f of files) {
  if (done.has(f)) continue;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(strip(fs.readFileSync(path.join(dir, f), 'utf8')));
    await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [f]);
    await client.query('COMMIT');
    console.log('Applied', f);
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('Migration failed:', f, '-', e.message);
    process.exit(1);
  } finally {
    client.release();
  }
}
console.log('Database is up to date.');

if (process.env.RUN_SEED === 'true') await import('./seed.js');   // seed.js closes the pool when finished
else await pool.end();
