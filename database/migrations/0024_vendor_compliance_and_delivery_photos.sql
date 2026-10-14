-- Approved development rollout: ALL Vendors need the new compliance review.
-- No identity, store, stock, order, assignment or historical document is deleted.
ALTER TABLE public.stores
  ADD COLUMN latitude numeric(10,7),
  ADD COLUMN longitude numeric(10,7),
  ADD CONSTRAINT stores_coordinates_check CHECK (
    (latitude IS NULL AND longitude IS NULL) OR
    (latitude IS NOT NULL AND longitude IS NOT NULL AND
     latitude BETWEEN -90 AND 90 AND longitude BETWEEN -180 AND 180));
UPDATE public.stores SET documents_required=true WHERE NOT documents_required;

ALTER TABLE public.platform_management_events ADD COLUMN details jsonb NOT NULL DEFAULT '{}';
CREATE TABLE public.vendor_bank_details (
  store_id uuid PRIMARY KEY REFERENCES public.stores(id) ON DELETE RESTRICT,
  account_holder_name text NOT NULL CHECK (length(account_holder_name) BETWEEN 2 AND 120),
  account_number text NOT NULL CHECK (account_number ~ '^[0-9]{6,34}$'),
  ifsc text NOT NULL CHECK (ifsc ~ '^[A-Z]{4}0[A-Z0-9]{6}$'),
  bank_name text NOT NULL CHECK (length(bank_name) BETWEEN 2 AND 120),
  bank_branch text NOT NULL CHECK (length(bank_branch) BETWEEN 2 AND 120),
  vendor_mobile_number text NOT NULL CHECK (vendor_mobile_number ~ '^\+91[6-9][0-9]{9}$'),
  status text NOT NULL DEFAULT 'SUBMITTED' CHECK (status IN ('SUBMITTED','APPROVED','REJECTED')),
  submission_id uuid NOT NULL DEFAULT gen_random_uuid(),
  rejection_reason text,
  submitted_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  reviewed_at timestamptz,
  reviewed_by uuid REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  CHECK ((status='APPROVED' AND reviewed_at IS NOT NULL AND reviewed_by IS NOT NULL)
    OR status<>'APPROVED'),
  CHECK (status<>'REJECTED' OR length(trim(rejection_reason)) BETWEEN 1 AND 1000)
);
ALTER TABLE public.vendor_bank_details ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.vendor_bank_details FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE ON public.vendor_bank_details TO service_role;

ALTER TABLE public.delivery_assignments ADD CONSTRAINT delivery_assignment_photo_identity
  UNIQUE(id,order_id,partner_user_id);
CREATE TABLE public.delivery_pickup_photos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assignment_id uuid NOT NULL UNIQUE,
  order_id uuid NOT NULL,
  partner_user_id uuid NOT NULL,
  object_ref text NOT NULL UNIQUE,
  mime_type text NOT NULL CHECK (mime_type IN ('image/jpeg','image/png')),
  size_bytes integer NOT NULL CHECK (size_bytes BETWEEN 1 AND 5242880),
  captured_at timestamptz NOT NULL,
  uploaded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY(assignment_id,order_id,partner_user_id)
    REFERENCES public.delivery_assignments(id,order_id,partner_user_id) ON DELETE RESTRICT
);
ALTER TABLE public.delivery_pickup_photos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.delivery_pickup_photos FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE ON public.delivery_pickup_photos TO service_role;

-- A single review predicate is shared by catalog access and new-order creation.
-- Previously approved photos are retained, but no longer count as mandatory.
CREATE FUNCTION public.vendor_compliance_approved(target_store uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT EXISTS (
   SELECT 1 FROM public.stores s JOIN public.vendor_bank_details b ON b.store_id=s.id
   WHERE s.id=target_store AND s.status='ACTIVE' AND b.status='APPROVED'
     AND s.document_verification_status='APPROVED'
     AND (SELECT count(*) FROM public.vendor_documents d WHERE d.store_id=s.id
       AND d.is_current AND d.document_type IN ('fssai','aadhaar','pan','labour_license')
       AND d.verification_status='APPROVED'
       AND d.submission_id=s.document_submission_id)=4
 );
$$;
REVOKE ALL ON FUNCTION public.vendor_compliance_approved(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.vendor_compliance_approved(uuid) TO service_role;

-- API-only fee writes also hold for direct authenticated Supabase requests.
CREATE FUNCTION public.protect_admin_store_fees() RETURNS trigger
LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
 IF current_user IN ('anon','authenticated') THEN
   IF (TG_OP='INSERT' AND (NEW.delivery_fee<>0 OR NEW.handling_fee<>0))
      OR (TG_OP='UPDATE' AND ROW(NEW.delivery_fee,NEW.handling_fee)
          IS DISTINCT FROM ROW(OLD.delivery_fee,OLD.handling_fee)) THEN
     RAISE EXCEPTION 'Store fee settings are Admin API-only' USING ERRCODE='42501';
   END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER stores_admin_fees BEFORE INSERT OR UPDATE ON public.stores
FOR EACH ROW EXECUTE FUNCTION public.protect_admin_store_fees();

-- Existing in-flight deliveries are retained; all NEW pickup transitions need a photo.
CREATE FUNCTION public.enforce_pickup_photo() RETURNS trigger
LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
 IF NEW.status='PICKED_UP' AND OLD.status IS DISTINCT FROM 'PICKED_UP'
    AND NOT EXISTS(SELECT 1 FROM public.delivery_pickup_photos p
      WHERE p.assignment_id=NEW.id AND p.order_id=NEW.order_id AND p.partner_user_id=NEW.partner_user_id) THEN
   RAISE EXCEPTION 'A securely saved package photo is required before pickup' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER delivery_requires_pickup_photo BEFORE UPDATE OF status ON public.delivery_assignments
FOR EACH ROW EXECUTE FUNCTION public.enforce_pickup_photo();

-- Vendor profiles (including fees) are read through the role-scoped API DTO.
-- Customer discovery and Admin reads retain their existing RLS policies.
CREATE POLICY vendor_store_read_via_api ON public.stores AS RESTRICTIVE
FOR SELECT TO authenticated USING (public.current_app_role()<>'vendor');
