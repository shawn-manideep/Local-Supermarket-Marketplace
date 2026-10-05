-- Canonical-only Excel import audit. No commerce or identity data is changed.
CREATE TABLE public.catalog_import_events (
  version serial PRIMARY KEY,
  actor_user_id uuid NOT NULL,
  filename text NOT NULL,
  workbook_hash text NOT NULL,
  added integer NOT NULL DEFAULT 0,
  updated integer NOT NULL,
  archived integer NOT NULL,
  unchanged integer NOT NULL,
  result text NOT NULL DEFAULT 'APPLIED',
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT catalog_import_counts_check CHECK (
    added = 0 AND updated >= 0 AND archived >= 0 AND unchanged >= 0
  ),
  CONSTRAINT catalog_import_result_check CHECK (result = 'APPLIED')
);
ALTER TABLE public.catalog_import_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.catalog_import_events FROM PUBLIC, anon, authenticated;
REVOKE ALL ON SEQUENCE public.catalog_import_events_version_seq FROM PUBLIC, anon, authenticated;
-- Application backend is authoritative; public clients have no audit write path.
GRANT SELECT, INSERT ON public.catalog_import_events TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.catalog_import_events_version_seq TO service_role;
