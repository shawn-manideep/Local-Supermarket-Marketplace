-- Existing stores retain access. Only stores created after this migration
-- inherit the mandatory-document onboarding requirement.
ALTER TABLE public.stores ADD COLUMN documents_required boolean NOT NULL DEFAULT false;
ALTER TABLE public.stores ALTER COLUMN documents_required SET DEFAULT true;
ALTER TABLE public.products ADD COLUMN brand text;
ALTER TABLE public.products ADD COLUMN requested_category_name text;

CREATE TABLE public.vendor_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES public.stores(id) ON DELETE RESTRICT,
  document_type text NOT NULL CHECK (document_type IN
    ('fssai','aadhaar','pan','photo','gst','trade_license','labour_license')),
  object_ref text NOT NULL UNIQUE,
  file_name text NOT NULL CHECK (length(file_name) BETWEEN 1 AND 200),
  mime_type text NOT NULL CHECK (mime_type IN ('application/pdf','image/jpeg','image/png')),
  size_bytes integer NOT NULL CHECK (size_bytes BETWEEN 1 AND 5242880),
  version integer NOT NULL CHECK (version > 0),
  is_current boolean NOT NULL DEFAULT true,
  uploaded_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (store_id, document_type, version)
);
CREATE UNIQUE INDEX vendor_documents_current_type ON public.vendor_documents(store_id,document_type) WHERE is_current;
ALTER TABLE public.vendor_documents ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.vendor_documents FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.vendor_documents TO service_role;
-- API owns all reads and mutations, including private storage authorization.
