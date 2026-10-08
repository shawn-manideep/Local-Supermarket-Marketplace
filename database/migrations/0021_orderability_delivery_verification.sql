-- Preserve accounts that already had catalog access. This is an access exemption,
-- not an assertion that their uploaded identity documents were Admin-reviewed.
UPDATE public.stores s SET documents_required=false
WHERE documents_required AND
  (SELECT count(*) FROM public.vendor_documents d WHERE d.store_id=s.id
   AND d.is_current AND d.document_type IN ('fssai','aadhaar','pan','photo'))=4;

ALTER TABLE public.stores
  ADD COLUMN document_verification_status text NOT NULL DEFAULT 'DRAFT'
    CHECK (document_verification_status IN ('DRAFT','SUBMITTED','APPROVED','REJECTED')),
  ADD COLUMN document_submission_id uuid,
  ADD COLUMN documents_submitted_at timestamptz,
  ADD COLUMN documents_reviewed_at timestamptz,
  ADD COLUMN documents_reviewed_by uuid REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  ADD COLUMN document_rejection_reason text;

ALTER TABLE public.vendor_documents
  ADD COLUMN verification_status text NOT NULL DEFAULT 'DRAFT'
    CHECK (verification_status IN ('DRAFT','SUBMITTED','APPROVED','REJECTED')),
  ADD COLUMN submission_id uuid,
  ADD COLUMN rejection_reason text;

ALTER TABLE public.orders
  ADD COLUMN delivery_mode text NOT NULL DEFAULT 'INSTANT'
    CHECK (delivery_mode IN ('INSTANT','SCHEDULED')),
  ADD COLUMN scheduled_start_at timestamptz,
  ADD COLUMN scheduled_end_at timestamptz,
  ADD CONSTRAINT orders_delivery_snapshot_check CHECK (
    (delivery_mode='INSTANT' AND scheduled_start_at IS NULL AND scheduled_end_at IS NULL)
    OR (delivery_mode='SCHEDULED' AND scheduled_start_at IS NOT NULL
        AND scheduled_end_at IS NOT NULL AND scheduled_end_at>scheduled_start_at));

-- Every hours writer (API, existing profile update or service SQL) participates
-- in the same parent lock as checkout. No second daily-open status is introduced.
CREATE FUNCTION public.lock_store_for_hours_write() RETURNS trigger
LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
  PERFORM 1 FROM public.stores WHERE id=CASE WHEN TG_OP='DELETE' THEN OLD.store_id ELSE NEW.store_id END FOR UPDATE;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER store_hours_orderability_lock BEFORE INSERT OR UPDATE OR DELETE
ON public.store_operating_hours FOR EACH ROW EXECUTE FUNCTION public.lock_store_for_hours_write();

-- These new fields must not widen the pre-existing API-only write boundary.
REVOKE INSERT, UPDATE, DELETE ON public.vendor_documents FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.orders FROM anon, authenticated;
REVOKE UPDATE(document_verification_status,document_submission_id,documents_submitted_at,
  documents_reviewed_at,documents_reviewed_by,document_rejection_reason,documents_required)
ON public.stores FROM anon, authenticated;

CREATE FUNCTION public.protect_document_verification_fields() RETURNS trigger
LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
  IF current_user IN ('anon','authenticated') THEN
    IF TG_OP='INSERT' THEN
      IF NOT NEW.documents_required OR NEW.document_verification_status<>'DRAFT'
         OR NEW.document_submission_id IS NOT NULL OR NEW.documents_reviewed_by IS NOT NULL THEN
        RAISE EXCEPTION 'Document verification is API-only' USING ERRCODE='42501';
      END IF;
    ELSIF ROW(NEW.documents_required,NEW.document_verification_status,NEW.document_submission_id,
        NEW.documents_submitted_at,NEW.documents_reviewed_at,NEW.documents_reviewed_by,NEW.document_rejection_reason)
      IS DISTINCT FROM ROW(OLD.documents_required,OLD.document_verification_status,OLD.document_submission_id,
        OLD.documents_submitted_at,OLD.documents_reviewed_at,OLD.documents_reviewed_by,OLD.document_rejection_reason) THEN
      RAISE EXCEPTION 'Document verification is API-only' USING ERRCODE='42501';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER stores_protect_document_verification BEFORE INSERT OR UPDATE ON public.stores
FOR EACH ROW EXECUTE FUNCTION public.protect_document_verification_fields();
