-- Phase 11: close default function execution, enforce immutable store scope,
-- remove vendor cart visibility, and support bounded order list queries.

-- Trigger functions are only callable by PostgreSQL trigger execution.  The
-- RLS helpers are the deliberate exception and remain available to sessions.
REVOKE ALL ON FUNCTION public.handle_new_auth_user() FROM PUBLIC, anon, authenticated;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.prevent_vendor_store_identity_changes() FROM PUBLIC, anon, authenticated;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.ensure_vendor_store_owner() FROM PUBLIC, anon, authenticated;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.prevent_catalog_hard_delete() FROM PUBLIC, anon, authenticated;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.prevent_order_snapshot_changes() FROM PUBLIC, anon, authenticated;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.prevent_order_item_snapshot_changes() FROM PUBLIC, anon, authenticated;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.prevent_order_hard_delete() FROM PUBLIC, anon, authenticated;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.prevent_order_history_mutation() FROM PUBLIC, anon, authenticated;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.prevent_order_identity_changes() FROM PUBLIC, anon, authenticated;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.prevent_order_item_identity_changes() FROM PUBLIC, anon, authenticated;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.current_app_role() FROM PUBLIC, anon, authenticated;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.current_app_role() TO authenticated;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.current_store_id() FROM PUBLIC, anon, authenticated;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.current_store_id() TO authenticated;--> statement-breakpoint

-- Vendors must not inspect carts or cart items; customers retain ownership
-- visibility and admins retain their intentional support visibility.
DROP POLICY IF EXISTS carts_customer_select ON public.carts;--> statement-breakpoint
CREATE POLICY carts_customer_select ON public.carts FOR SELECT
USING (customer_id = auth.uid() OR public.current_app_role() = 'admin');--> statement-breakpoint
DROP POLICY IF EXISTS cart_items_customer_select ON public.cart_items;--> statement-breakpoint
CREATE POLICY cart_items_customer_select ON public.cart_items FOR SELECT
USING (EXISTS (
  SELECT 1 FROM public.carts
  WHERE carts.id = cart_items.cart_id
    AND (carts.customer_id = auth.uid() OR public.current_app_role() = 'admin')
));--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.prevent_store_owner_identity_changes()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NEW.owner_user_id IS DISTINCT FROM OLD.owner_user_id THEN
    RAISE EXCEPTION 'Store ownership is immutable';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.prevent_store_owner_identity_changes() FROM PUBLIC, anon, authenticated;--> statement-breakpoint
DROP TRIGGER IF EXISTS stores_owner_user_id_immutable ON public.stores;--> statement-breakpoint
CREATE TRIGGER stores_owner_user_id_immutable
BEFORE UPDATE OF owner_user_id ON public.stores
FOR EACH ROW EXECUTE FUNCTION public.prevent_store_owner_identity_changes();--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.prevent_store_id_changes()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NEW.store_id IS DISTINCT FROM OLD.store_id THEN
    RAISE EXCEPTION 'Store identity is immutable';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.prevent_store_id_changes() FROM PUBLIC, anon, authenticated;--> statement-breakpoint
DROP TRIGGER IF EXISTS store_service_pincodes_store_id_immutable ON public.store_service_pincodes;--> statement-breakpoint
CREATE TRIGGER store_service_pincodes_store_id_immutable
BEFORE UPDATE OF store_id ON public.store_service_pincodes
FOR EACH ROW EXECUTE FUNCTION public.prevent_store_id_changes();--> statement-breakpoint
DROP TRIGGER IF EXISTS store_operating_hours_store_id_immutable ON public.store_operating_hours;--> statement-breakpoint
CREATE TRIGGER store_operating_hours_store_id_immutable
BEFORE UPDATE OF store_id ON public.store_operating_hours
FOR EACH ROW EXECUTE FUNCTION public.prevent_store_id_changes();--> statement-breakpoint
DROP TRIGGER IF EXISTS categories_store_id_immutable ON public.categories;--> statement-breakpoint
CREATE TRIGGER categories_store_id_immutable
BEFORE UPDATE OF store_id ON public.categories
FOR EACH ROW EXECUTE FUNCTION public.prevent_store_id_changes();--> statement-breakpoint
DROP TRIGGER IF EXISTS products_store_id_immutable ON public.products;--> statement-breakpoint
CREATE TRIGGER products_store_id_immutable
BEFORE UPDATE OF store_id ON public.products
FOR EACH ROW EXECUTE FUNCTION public.prevent_store_id_changes();--> statement-breakpoint

CREATE INDEX IF NOT EXISTS orders_customer_newest_idx
ON public.orders (customer_id, created_at DESC, id DESC);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS orders_store_status_newest_idx
ON public.orders (store_id, status, created_at DESC, id DESC);