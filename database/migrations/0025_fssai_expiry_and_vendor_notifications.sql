-- Forward-only. No invented expiry dates, document approvals, or historic order alerts.
ALTER TABLE public.vendor_documents ADD COLUMN expiry_date date;
ALTER TABLE public.vendor_documents ADD CONSTRAINT fssai_only_expiry_date
 CHECK (expiry_date IS NULL OR document_type='fssai');

CREATE TABLE public.vendor_notifications (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 store_id uuid NOT NULL REFERENCES public.stores(id),
 kind text NOT NULL CHECK (kind IN ('NEW_ORDER','FSSAI_EXPIRY')),
 dedup_key text NOT NULL UNIQUE,
 message text NOT NULL,
 order_id uuid REFERENCES public.orders(id),
 document_id uuid REFERENCES public.vendor_documents(id),
 expiry_date date,
 milestone text CHECK (milestone IN ('30','7','0')),
 created_at timestamptz NOT NULL DEFAULT now(),
 read_at timestamptz,
 CHECK ((kind='NEW_ORDER' AND order_id IS NOT NULL AND document_id IS NULL AND expiry_date IS NULL AND milestone IS NULL)
     OR (kind='FSSAI_EXPIRY' AND order_id IS NULL AND document_id IS NOT NULL AND expiry_date IS NOT NULL AND milestone IS NOT NULL))
);
CREATE INDEX vendor_notifications_feed ON public.vendor_notifications(store_id,created_at DESC);
ALTER TABLE public.vendor_notifications ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.vendor_notifications FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.vendor_notifications TO service_role;

-- Same transaction as order creation: a rollback can never publish an alert.
CREATE FUNCTION public.notify_vendor_new_order() RETURNS trigger
LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
 INSERT INTO public.vendor_notifications(store_id,kind,dedup_key,message,order_id)
 VALUES(NEW.store_id,'NEW_ORDER','order:'||NEW.id::text,
   'New order '||upper(left(NEW.id::text,8))||' is ready for review.',NEW.id)
 ON CONFLICT(dedup_key) DO NOTHING;
 PERFORM pg_notify('marketplace_portal_events',
   json_build_object('kind','NEW_ORDER','storeId',NEW.store_id)::text);
 RETURN NEW;
END $$;
CREATE TRIGGER orders_vendor_notification AFTER INSERT ON public.orders
FOR EACH ROW WHEN (NEW.status='PLACED') EXECUTE FUNCTION public.notify_vendor_new_order();

-- PostgreSQL delivers NOTIFY only after commit, never after a rolled-back
-- Ready transition or claim. Payloads contain refresh hints, not customer data.
CREATE FUNCTION public.notify_delivery_offers() RETURNS trigger
LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
 PERFORM pg_notify('marketplace_portal_events', '{"kind":"DELIVERY_OFFERS"}');
 RETURN NEW;
END $$;
CREATE TRIGGER orders_delivery_offers AFTER UPDATE OF status ON public.orders
FOR EACH ROW WHEN (OLD.status IS DISTINCT FROM NEW.status)
EXECUTE FUNCTION public.notify_delivery_offers();
CREATE TRIGGER assignments_delivery_offers AFTER INSERT OR UPDATE OF status ON public.delivery_assignments
FOR EACH ROW EXECUTE FUNCTION public.notify_delivery_offers();

-- Missing dates are unknown, not implicitly valid. Expiry takes effect at the
-- beginning of the printed expiry date in India; existing fulfillment is unaffected.
CREATE OR REPLACE FUNCTION public.vendor_compliance_approved(target_store uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT EXISTS (
   SELECT 1 FROM public.stores s JOIN public.vendor_bank_details b ON b.store_id=s.id
   WHERE s.id=target_store AND s.status='ACTIVE' AND b.status='APPROVED'
     AND s.document_verification_status='APPROVED'
     AND (SELECT count(*) FROM public.vendor_documents d WHERE d.store_id=s.id
       AND d.is_current AND d.document_type IN ('fssai','aadhaar','pan','labour_license')
       AND d.verification_status='APPROVED'
       AND d.submission_id=s.document_submission_id)=4
     AND EXISTS(SELECT 1 FROM public.vendor_documents f WHERE f.store_id=s.id
       AND f.is_current AND f.document_type='fssai'
       AND f.expiry_date>(CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')::date)
 );
$$;
REVOKE ALL ON FUNCTION public.vendor_compliance_approved(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.vendor_compliance_approved(uuid) TO service_role;
