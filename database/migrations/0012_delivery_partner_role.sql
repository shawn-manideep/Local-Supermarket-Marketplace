-- Separate commit: PostgreSQL enum additions must commit before use.
ALTER TYPE public.app_role ADD VALUE 'delivery_partner';