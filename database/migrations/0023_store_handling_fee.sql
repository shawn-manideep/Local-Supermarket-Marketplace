-- Additive defaults only: no historical totals or snapshots are recalculated.
ALTER TABLE public.stores
  ADD COLUMN handling_fee numeric(12,2) NOT NULL DEFAULT 0
  CHECK (handling_fee >= 0 AND handling_fee <= 1000000);
--> statement-breakpoint
ALTER TABLE public.orders
  ADD COLUMN handling_fee_snapshot numeric(12,2) NOT NULL DEFAULT 0
  CHECK (handling_fee_snapshot >= 0 AND handling_fee_snapshot <= 1000000);
--> statement-breakpoint
CREATE FUNCTION public.protect_order_handling_fee() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.handling_fee_snapshot IS DISTINCT FROM OLD.handling_fee_snapshot THEN
    RAISE EXCEPTION 'Accepted order handling fee is immutable';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER orders_handling_fee_immutable BEFORE UPDATE ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.protect_order_handling_fee();
--> statement-breakpoint
GRANT SELECT (handling_fee_snapshot) ON public.orders TO authenticated;
