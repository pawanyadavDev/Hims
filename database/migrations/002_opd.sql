-- OPD: consultations and prescriptions. Fresh installs run this automatically (see docker-compose.yml).
-- Existing databases:  docker compose exec -T db psql -U postgres -d hims < database/migrations/002_opd.sql

CREATE TABLE consultations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id UUID NOT NULL REFERENCES hospitals(id),
  patient_id UUID NOT NULL REFERENCES patients(id),
  appointment_id UUID REFERENCES appointments(id),
  doctor_id UUID NOT NULL REFERENCES users(id),
  vitals JSONB NOT NULL DEFAULT '{}',          -- {bp, pulse, temp, spo2, weight}
  complaints TEXT,
  diagnosis TEXT,
  notes TEXT,
  follow_up_date DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE prescription_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id UUID NOT NULL REFERENCES hospitals(id),
  consultation_id UUID NOT NULL REFERENCES consultations(id) ON DELETE CASCADE,
  medicine TEXT NOT NULL,
  dosage TEXT,
  frequency TEXT,
  duration TEXT,
  instructions TEXT
);

CREATE INDEX ON consultations (hospital_id, patient_id, created_at DESC);

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['consultations','prescription_items'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format($p$CREATE POLICY tenant_isolation ON %I
      USING (hospital_id = NULLIF(current_setting('app.hospital_id', true), '')::uuid)
      WITH CHECK (hospital_id = NULLIF(current_setting('app.hospital_id', true), '')::uuid)$p$, t);
  END LOOP;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON consultations, prescription_items TO hims_app;
