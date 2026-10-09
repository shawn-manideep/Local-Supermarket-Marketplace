-- Nullable structured fields leave every legacy address and order snapshot intact.
ALTER TABLE customer_addresses
  ADD COLUMN house_number text,
  ADD COLUMN building_name text,
  ADD COLUMN landmark text,
  ADD COLUMN locality text;
ALTER TABLE customer_addresses ADD CONSTRAINT customer_address_house_number_nonblank
  CHECK (house_number IS NULL OR length(btrim(house_number)) BETWEEN 1 AND 240);
