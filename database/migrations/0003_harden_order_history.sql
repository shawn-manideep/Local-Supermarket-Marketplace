-- Phase 8: status history is append-only; snapshots remain API-created and immutable.
CREATE OR REPLACE FUNCTION public.prevent_order_history_mutation()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RAISE EXCEPTION 'Order status history is append-only';
END;
$$;--> statement-breakpoint
CREATE TRIGGER order_status_history_no_update
BEFORE UPDATE OR DELETE ON public.order_status_history
FOR EACH ROW EXECUTE FUNCTION public.prevent_order_history_mutation();--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.prevent_order_identity_changes()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.customer_id IS DISTINCT FROM OLD.customer_id
     OR NEW.store_id IS DISTINCT FROM OLD.store_id THEN
    RAISE EXCEPTION 'Order ownership identity is immutable';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER orders_identity_immutable BEFORE UPDATE ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.prevent_order_identity_changes();--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.prevent_order_item_identity_changes()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.order_id IS DISTINCT FROM OLD.order_id
     OR NEW.product_id IS DISTINCT FROM OLD.product_id THEN
    RAISE EXCEPTION 'Order item identity is immutable';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER order_items_identity_immutable BEFORE UPDATE ON public.order_items
FOR EACH ROW EXECUTE FUNCTION public.prevent_order_item_identity_changes();--> statement-breakpoint
REVOKE INSERT, UPDATE, DELETE ON public.order_status_history FROM anon, authenticated;--> statement-breakpoint
REVOKE INSERT, UPDATE, DELETE ON public.orders FROM anon, authenticated;--> statement-breakpoint
REVOKE INSERT, UPDATE, DELETE ON public.order_items FROM anon, authenticated;--> statement-breakpoint
DROP POLICY IF EXISTS orders_admin_manage ON public.orders;--> statement-breakpoint
ALTER TABLE public.order_status_history ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS order_status_history_customer_vendor_admin_select ON public.order_status_history;
CREATE POLICY order_status_history_customer_vendor_admin_select
ON public.order_status_history FOR SELECT
USING (EXISTS (
  SELECT 1 FROM public.orders
  WHERE orders.id = order_status_history.order_id
    AND (orders.customer_id = auth.uid()
      OR orders.store_id = public.current_store_id()
      OR public.current_app_role() = 'admin')
));--> statement-breakpoint