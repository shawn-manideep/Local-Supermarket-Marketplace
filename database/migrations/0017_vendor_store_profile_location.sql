-- Extend the existing canonical store profile. Legacy stores stay valid with
-- unknown address fields; no invented address or operational-data backfill.
ALTER TABLE public.stores
  ADD COLUMN owner_name text,
  ADD COLUMN email text,
  ADD COLUMN address_line_1 text,
  ADD COLUMN address_line_2 text,
  ADD COLUMN locality text,
  ADD COLUMN city text,
  ADD COLUMN state text,
  ADD COLUMN pincode text;

ALTER TABLE public.stores ADD CONSTRAINT stores_physical_pincode_check
  CHECK (pincode IS NULL OR pincode ~ '^[1-9][0-9]{5}$');
-- Existing API-only store write boundaries and store RLS continue to apply.
-- No new tables, roles, username registries, commercial fields or order writes.
