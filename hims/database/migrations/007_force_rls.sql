-- Managed databases (e.g. Render): the API connects as the database owner. By default an owner skips row-level
-- security, so FORCE makes the tenant isolation policies apply to the owner as well.
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'patients','appointments','invoices','invoice_items','payments',
    'consultations','prescription_items',
    'medicines','medicine_batches','pharmacy_sales','pharmacy_sale_items',
    'lab_tests','lab_orders','lab_order_items',
    'wards','beds','admissions','bed_allocations','care_notes','admission_charges',
    'inventory_items','suppliers','purchase_orders','purchase_order_items','stock_movements'
  ] LOOP
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
  END LOOP;
END $$;
