-- Laboratory: test catalog, orders (from OPD or walk-in), sample collection with billing, and results.
-- Requires 002_opd.sql. Fresh installs run this automatically (see docker-compose.yml).
-- Existing databases:  docker compose exec -T db psql -U postgres -d hims < database/migrations/004_lab.sql
-- Note: the OPD screen reads lab orders, so apply this before using OPD on an existing database.

CREATE TABLE lab_tests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id UUID NOT NULL REFERENCES hospitals(id),
  name TEXT NOT NULL,
  category TEXT,
  sample_type TEXT,
  unit TEXT,
  reference_range TEXT,                       -- e.g. "12 - 16" (numeric ranges enable auto-flagging)
  unit_price NUMERIC(12,2) NOT NULL CHECK (unit_price >= 0),
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (hospital_id, name)
);

CREATE TABLE lab_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id UUID NOT NULL REFERENCES hospitals(id),
  order_no TEXT NOT NULL,
  patient_id UUID NOT NULL REFERENCES patients(id),
  consultation_id UUID REFERENCES consultations(id),   -- set when ordered from an OPD consultation
  ordered_by UUID REFERENCES users(id),
  priority TEXT NOT NULL DEFAULT 'routine' CHECK (priority IN ('routine','urgent')),
  status TEXT NOT NULL DEFAULT 'ordered' CHECK (status IN ('ordered','collected','completed','cancelled')),
  notes TEXT,
  invoice_id UUID REFERENCES invoices(id),             -- created when the sample is collected
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  collected_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  UNIQUE (hospital_id, order_no)
);

-- Test name, unit, range and price are copied onto the order, so later catalog changes never alter old reports or bills.
CREATE TABLE lab_order_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id UUID NOT NULL REFERENCES hospitals(id),
  order_id UUID NOT NULL REFERENCES lab_orders(id) ON DELETE CASCADE,
  test_id UUID NOT NULL REFERENCES lab_tests(id),
  test_name TEXT NOT NULL,
  unit TEXT,
  reference_range TEXT,
  unit_price NUMERIC(12,2) NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','resulted')),
  result_value TEXT,
  result_flag TEXT CHECK (result_flag IN ('normal','low','high','abnormal')),
  remarks TEXT,
  resulted_by UUID REFERENCES users(id),
  resulted_at TIMESTAMPTZ
);

CREATE INDEX ON lab_orders (hospital_id, status, created_at DESC);
CREATE INDEX ON lab_orders (hospital_id, patient_id, created_at DESC);
CREATE INDEX ON lab_order_items (order_id);

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['lab_tests','lab_orders','lab_order_items'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format($p$CREATE POLICY tenant_isolation ON %I
      USING (hospital_id = NULLIF(current_setting('app.hospital_id', true), '')::uuid)
      WITH CHECK (hospital_id = NULLIF(current_setting('app.hospital_id', true), '')::uuid)$p$, t);
  END LOOP;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON lab_tests, lab_orders, lab_order_items TO hims_app;
