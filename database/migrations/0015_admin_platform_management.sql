-- Additive platform-management extension; no identity, commerce or history rewrite.
ALTER TABLE public.customers ADD COLUMN status text NOT NULL DEFAULT 'ACTIVE';
ALTER TABLE public.customers ADD CONSTRAINT customer_access_status_check CHECK (status IN ('ACTIVE','INACTIVE'));
CREATE INDEX customers_status_created_idx ON public.customers(status,created_at DESC);

CREATE TABLE public.platform_management_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Historical actor identity survives independently of account lifecycle.
  actor_user_id uuid NOT NULL,
  action text NOT NULL,
  target_type text NOT NULL CHECK(target_type IN ('store','customer','delivery_partner')),
  target_id uuid NOT NULL,
  previous_status text,
  next_status text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX management_events_target_idx ON public.platform_management_events(target_type,target_id,created_at DESC);
ALTER TABLE public.platform_management_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.platform_management_events FROM anon,authenticated;
GRANT SELECT ON public.platform_management_events TO authenticated;
CREATE POLICY management_events_admin_read ON public.platform_management_events FOR SELECT TO authenticated
USING(public.current_app_role()='admin');

-- Backend-owned audit context is transaction-local. Public roles cannot use
-- these triggers as a way to update status; the existing write boundary stays.
CREATE FUNCTION public.audit_platform_management() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE actor uuid; old_status text; verb text; entity text; target uuid;
BEGIN
  actor := nullif(current_setting('app.admin_actor_id',true),'')::uuid;
  IF actor IS NULL THEN RETURN NEW; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.user_profiles WHERE id=actor AND role='admin') THEN
    RAISE EXCEPTION 'Invalid administrative audit actor';
  END IF;
  IF TG_OP='UPDATE' AND OLD.status IS NOT DISTINCT FROM NEW.status THEN RETURN NEW; END IF;
  old_status := CASE WHEN TG_OP='INSERT' THEN NULL ELSE OLD.status::text END;
  IF TG_TABLE_NAME='stores' THEN
    entity := 'store'; target := NEW.id;
    verb := CASE WHEN NEW.status='ACTIVE' AND OLD.status='PENDING_APPROVAL' THEN 'vendor_approved'
      WHEN NEW.status='ACTIVE' THEN 'vendor_reactivated'
      WHEN NEW.status='SUSPENDED' THEN 'vendor_suspended' ELSE 'vendor_rejected' END;
  ELSIF TG_TABLE_NAME='customers' THEN
    entity := 'customer'; target := NEW.id;
    verb := CASE WHEN NEW.status='ACTIVE' THEN 'customer_reactivated' ELSE 'customer_deactivated' END;
  ELSE
    entity := 'delivery_partner'; target := NEW.user_id;
    verb := CASE WHEN TG_OP='INSERT' THEN 'partner_created'
      WHEN NEW.status='ACTIVE' THEN CASE WHEN EXISTS(
        SELECT 1 FROM public.platform_management_events WHERE target_type='delivery_partner' AND target_id=NEW.user_id AND action='partner_deactivated'
      ) THEN 'partner_reactivated' ELSE 'partner_activated' END
      ELSE 'partner_deactivated' END;
  END IF;
  INSERT INTO public.platform_management_events(actor_user_id,action,target_type,target_id,previous_status,next_status)
  VALUES(actor,verb,entity,target,old_status,NEW.status::text);
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.audit_platform_management() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER stores_management_audit AFTER UPDATE OF status ON public.stores
FOR EACH ROW EXECUTE FUNCTION public.audit_platform_management();
CREATE TRIGGER customers_management_audit AFTER UPDATE OF status ON public.customers
FOR EACH ROW EXECUTE FUNCTION public.audit_platform_management();
CREATE TRIGGER partners_management_audit AFTER INSERT OR UPDATE OF status ON public.delivery_partner_profiles
FOR EACH ROW EXECUTE FUNCTION public.audit_platform_management();

-- Inactive customers lose both API access and their direct, read-only RLS access.
CREATE OR REPLACE FUNCTION public.current_app_role() RETURNS public.app_role
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT p.role FROM public.user_profiles p WHERE p.id=auth.uid()
    AND (p.role<>'customer' OR EXISTS(SELECT 1 FROM public.customers c WHERE c.id=p.id AND c.status='ACTIVE'))
    AND (p.role<>'vendor' OR NOT EXISTS(SELECT 1 FROM public.stores s WHERE s.owner_user_id=p.id AND s.status='SUSPENDED'))
$$;
CREATE OR REPLACE FUNCTION public.current_store_id() RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT id FROM public.stores WHERE owner_user_id=auth.uid() AND status<>'SUSPENDED'
$$;
CREATE POLICY customers_active_gate ON public.customers AS RESTRICTIVE FOR SELECT TO authenticated
USING(public.current_app_role()='admin' OR (id=auth.uid() AND status='ACTIVE'));
CREATE POLICY addresses_active_gate ON public.customer_addresses AS RESTRICTIVE FOR SELECT TO authenticated
USING(public.current_app_role()='admin' OR public.current_app_role()='customer');
CREATE POLICY repeat_active_gate ON public.customer_repeat_requests AS RESTRICTIVE FOR SELECT TO authenticated
USING(public.current_app_role()='admin' OR public.current_app_role()='customer');