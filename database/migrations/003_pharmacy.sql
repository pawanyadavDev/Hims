-- Pharmacy: medicine master, batch-wise stock, sales linked to invoices, and prescription dispensing.
-- Requires 002_opd.sql. Fresh installs run this automatically (see docker-compose.yml).
-- Existing databases:  docker compose exec -T db psql -U postgres -d hims < database/migrations/003_pharmacy.sql

CREATE TABLE medicines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id UUID NOT NULL REFERENCES hospitals(id),
  name TEXT NOT NULL,
  generic_name TEXT,
  form TEXT,                                   -- Tablet, Capsule, Syrup ...
  strength TEXT NOT NULL DEFAULT '',
  unit_price NUMERIC(12,2) NOT NULL CHECK (unit_price >= 0),   -- selling price per unit
  reorder_level INT NOT NULL DEFAULT 20,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (hospital_id, name, strength)
);

CREATE TABLE medicine_batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id UUID NOT NULL REFERENCES hospitals(id),
  medicine_id UUID NOT NULL REFERENCES medicines(id),
  batch_no TEXT NOT NULL,
  expiry_date DATE NOT NULL,
  qty_received INT NOT NULL CHECK (qty_received > 0),
  qty_remaining INT NOT NULL CHECK (qty_remaining >= 0),
  purchase_price NUMERIC(12,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE pharmacy_sales (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id UUID NOT NULL REFERENCES hospitals(id),
  patient_id UUID NOT NULL REFERENCES patients(id),
  consultation_id UUID REFERENCES consultations(id),   -- set when dispensing an OPD prescription
  invoice_id UUID NOT NULL REFERENCES invoices(id),    -- every sale is billed through the normal invoice
  subtotal NUMERIC(12,2) NOT NULL,
  discount NUMERIC(12,2) NOT NULL DEFAULT 0,
  total NUMERIC(12,2) NOT NULL,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE pharmacy_sale_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id UUID NOT NULL REFERENCES hospitals(id),
  sale_id UUID NOT NULL REFERENCES pharmacy_sales(id) ON DELETE CASCADE,
  medicine_id UUID NOT NULL REFERENCES medicines(id),
  batch_id UUID NOT NULL REFERENCES medicine_batches(id),   -- one row per batch used (earliest expiry first)
  qty INT NOT NULL CHECK (qty > 0),
  unit_price NUMERIC(12,2) NOT NULL,
  line_total NUMERIC(12,2) NOT NULL
);

-- Which prescribed items have been handed out, and in which sale.
ALTER TABLE prescription_items
  ADD COLUMN dispensed_sale_id UUID REFERENCES pharmacy_sales(id),
  ADD COLUMN dispensed_at TIMESTAMPTZ;

CREATE INDEX ON medicine_batches (hospital_id, medicine_id, expiry_date);
CREATE INDEX ON pharmacy_sales (hospital_id, patient_id, created_at DESC);
CREATE INDEX ON prescription_items (consultation_id) WHERE dispensed_sale_id IS NULL;

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['medicines','medicine_batches','pharmacy_sales','pharmacy_sale_items'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format($p$CREATE POLICY tenant_isolation ON %I
      USING (hospital_id = NULLIF(current_setting('app.hospital_id', true), '')::uuid)
      WITH CHECK (hospital_id = NULLIF(current_setting('app.hospital_id', true), '')::uuid)$p$, t);
  END LOOP;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON medicines, medicine_batches, pharmacy_sales, pharmacy_sale_items TO hims_app;
