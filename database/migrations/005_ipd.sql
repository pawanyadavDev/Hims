-- IPD: wards and beds, admissions, bed history (for billing), care notes and extra charges.
-- Requires 002_opd.sql. Existing databases:  docker compose exec -T db psql -U postgres -d hims < database/migrations/005_ipd.sql

CREATE TABLE wards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id UUID NOT NULL REFERENCES hospitals(id),
  name TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'General',
  daily_rate NUMERIC(12,2) NOT NULL CHECK (daily_rate >= 0),
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (hospital_id, name)
);

CREATE TABLE beds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id UUID NOT NULL REFERENCES hospitals(id),
  ward_id UUID NOT NULL REFERENCES wards(id),
  bed_no TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  UNIQUE (ward_id, bed_no)
);

CREATE TABLE admissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id UUID NOT NULL REFERENCES hospitals(id),
  admission_no TEXT NOT NULL,
  patient_id UUID NOT NULL REFERENCES patients(id),
  doctor_id UUID REFERENCES users(id),
  reason TEXT,
  diagnosis TEXT,
  status TEXT NOT NULL DEFAULT 'admitted' CHECK (status IN ('admitted','discharged')),
  admitted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  discharged_at TIMESTAMPTZ,
  discharge_summary TEXT,
  invoice_id UUID REFERENCES invoices(id),          -- created at discharge
  created_by UUID REFERENCES users(id),
  UNIQUE (hospital_id, admission_no)
);
-- A patient can have only one open admission.
CREATE UNIQUE INDEX one_active_admission_per_patient ON admissions (patient_id) WHERE status = 'admitted';

-- Every bed a patient has used. The daily rate is copied here so later rate changes do not alter old bills.
CREATE TABLE bed_allocations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id UUID NOT NULL REFERENCES hospitals(id),
  admission_id UUID NOT NULL REFERENCES admissions(id) ON DELETE CASCADE,
  bed_id UUID NOT NULL REFERENCES beds(id),
  daily_rate NUMERIC(12,2) NOT NULL,
  from_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  to_at TIMESTAMPTZ
);
-- A bed can hold only one patient at a time (no double booking, even with simultaneous requests).
CREATE UNIQUE INDEX one_active_allocation_per_bed ON bed_allocations (bed_id) WHERE to_at IS NULL;

CREATE TABLE care_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id UUID NOT NULL REFERENCES hospitals(id),
  admission_id UUID NOT NULL REFERENCES admissions(id) ON DELETE CASCADE,
  note TEXT NOT NULL,
  vitals JSONB NOT NULL DEFAULT '{}',
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE admission_charges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id UUID NOT NULL REFERENCES hospitals(id),
  admission_id UUID NOT NULL REFERENCES admissions(id) ON DELETE CASCADE,
  description TEXT NOT NULL,
  qty INT NOT NULL DEFAULT 1 CHECK (qty > 0),
  unit_price NUMERIC(12,2) NOT NULL CHECK (unit_price >= 0),
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX ON admissions (hospital_id, status, admitted_at DESC);
CREATE INDEX ON bed_allocations (admission_id);
CREATE INDEX ON care_notes (admission_id, created_at DESC);

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['wards','beds','admissions','bed_allocations','care_notes','admission_charges'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format($p$CREATE POLICY tenant_isolation ON %I
      USING (hospital_id = NULLIF(current_setting('app.hospital_id', true), '')::uuid)
      WITH CHECK (hospital_id = NULLIF(current_setting('app.hospital_id', true), '')::uuid)$p$, t);
  END LOOP;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON wards, beds, admissions, bed_allocations, care_notes, admission_charges TO hims_app;
