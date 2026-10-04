-- The Phase 6 foundation has no operational legacy rows. Refuse ambiguous
-- states instead of inventing acceptance timestamps or rewriting history.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM public.delivery_assignments) THEN
    RAISE EXCEPTION 'Delivery foundation must be empty before enabling Phase 7';
  END IF;
END $$;
--> statement-breakpoint
ALTER TABLE public.delivery_assignments
  DROP CONSTRAINT delivery_assignments_status_check,
  ALTER COLUMN status SET DEFAULT 'PENDING',
  ADD COLUMN assigned_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN accepted_at timestamptz,
  ADD COLUMN rejected_at timestamptz,
  ADD COLUMN picked_up_at timestamptz,
  ADD COLUMN delivered_at timestamptz,
  ADD CONSTRAINT delivery_assignment_state CHECK (status IN ('PENDING','ACCEPTED','REJECTED','PICKED_UP','OUT_FOR_DELIVERY','DELIVERED','CANCELLED')),
  ADD CONSTRAINT delivery_assignment_timestamps CHECK (
    (status <> 'REJECTED' OR rejected_at IS NOT NULL)
    AND (status NOT IN ('ACCEPTED','PICKED_UP','OUT_FOR_DELIVERY','DELIVERED') OR accepted_at IS NOT NULL)
    AND (status NOT IN ('PICKED_UP','OUT_FOR_DELIVERY','DELIVERED') OR picked_up_at IS NOT NULL)
    AND (status <> 'DELIVERED' OR delivered_at IS NOT NULL)
    AND (accepted_at IS NULL OR accepted_at >= assigned_at)
    AND (rejected_at IS NULL OR rejected_at >= assigned_at)
    AND (picked_up_at IS NULL OR picked_up_at >= accepted_at)
    AND (delivered_at IS NULL OR delivered_at >= picked_up_at));
--> statement-breakpoint
CREATE UNIQUE INDEX delivery_one_active_assignment ON public.delivery_assignments(order_id)
WHERE status IN ('PENDING','ACCEPTED','PICKED_UP','OUT_FOR_DELIVERY');
CREATE INDEX delivery_assignments_order_time ON public.delivery_assignments(order_id,assigned_at DESC);
--> statement-breakpoint
CREATE FUNCTION public.validate_delivery_partner_identity() RETURNS trigger
LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.user_profiles u WHERE u.id=NEW.partner_user_id AND u.role='delivery_partner') THEN
    RAISE EXCEPTION 'Delivery assignment requires a delivery partner identity' USING ERRCODE='23514';
  END IF;
  IF TG_OP='UPDATE' AND (NEW.order_id IS DISTINCT FROM OLD.order_id OR NEW.partner_user_id IS DISTINCT FROM OLD.partner_user_id) THEN
    RAISE EXCEPTION 'Assignment ownership is immutable' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER delivery_assignment_identity BEFORE INSERT OR UPDATE ON public.delivery_assignments
FOR EACH ROW EXECUTE FUNCTION public.validate_delivery_partner_identity();
--> statement-breakpoint
-- Mutations remain API-only. No direct order/customer joins are granted.
-- Vendors may read minimal assignment metadata only for their own store.
CREATE POLICY assignments_read_own_store ON public.delivery_assignments FOR SELECT TO authenticated
USING (public.current_app_role()='vendor' AND EXISTS (
  SELECT 1 FROM public.orders o JOIN public.stores s ON s.id=o.store_id
  WHERE o.id=delivery_assignments.order_id AND s.owner_user_id=auth.uid()));
GRANT SELECT (assigned_at,accepted_at,rejected_at,picked_up_at,delivered_at) ON public.delivery_assignments TO authenticated;