-- Inventory: hospital consumables and supplies (gloves, syringes, linen ...), suppliers, purchase orders and a stock ledger.
-- Medicines are handled by Pharmacy and are not part of this module.
-- Existing databases:  docker compose exec -T db psql -U postgres -d hims < database/migrations/006_inventory.sql

CREATE TABLE inventory_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id UUID NOT NULL REFERENCES hospitals(id),
  name TEXT NOT NULL,
  category TEXT,
  unit TEXT NOT NULL DEFAULT 'pcs',
  qty_on_hand INT NOT NULL DEFAULT 0 CHECK (qty_on_hand >= 0),
  reorder_level INT NOT NULL DEFAULT 10,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (hospital_id, name)
);

CREATE TABLE suppliers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id UUID NOT NULL REFERENCES hospitals(id),
  name TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  address TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (hospital_id, name)
);

CREATE TABLE purchase_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id UUID NOT NULL REFERENCES hospitals(id),
  po_no TEXT NOT NULL,
  supplier_id UUID NOT NULL REFERENCES suppliers(id),
  status TEXT NOT NULL DEFAULT 'ordered' CHECK (status IN ('ordered','received','cancelled')),
  total NUMERIC(12,2) NOT NULL DEFAULT 0,
  notes TEXT,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  received_at TIMESTAMPTZ,
  UNIQUE (hospital_id, po_no)
);

CREATE TABLE purchase_order_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id UUID NOT NULL REFERENCES hospitals(id),
  po_id UUID NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  item_id UUID NOT NULL REFERENCES inventory_items(id),
  qty INT NOT NULL CHECK (qty > 0),
  unit_cost NUMERIC(12,2) NOT NULL CHECK (unit_cost >= 0)
);

-- Every change to stock is recorded: receipts, issues and stock-count adjustments.
CREATE TABLE stock_movements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id UUID NOT NULL REFERENCES hospitals(id),
  item_id UUID NOT NULL REFERENCES inventory_items(id),
  change INT NOT NULL,
  reason TEXT NOT NULL CHECK (reason IN ('receipt','issue','adjustment')),
  reference TEXT,
  note TEXT,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX ON stock_movements (hospital_id, item_id, created_at DESC);
CREATE INDEX ON purchase_orders (hospital_id, status, created_at DESC);

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['inventory_items','suppliers','purchase_orders','purchase_order_items','stock_movements'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format($p$CREATE POLICY tenant_isolation ON %I
      USING (hospital_id = NULLIF(current_setting('app.hospital_id', true), '')::uuid)
      WITH CHECK (hospital_id = NULLIF(current_setting('app.hospital_id', true), '')::uuid)$p$, t);
  END LOOP;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON inventory_items, suppliers, purchase_orders, purchase_order_items, stock_movements TO hims_app;
