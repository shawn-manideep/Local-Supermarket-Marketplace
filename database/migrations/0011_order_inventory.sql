-- No historical snapshots are rewritten. Existing orders default to NONE:
-- they did not deduct inventory and therefore must never restore it.
ALTER TABLE public.orders
  ADD COLUMN inventory_state text NOT NULL DEFAULT 'NONE',
  ADD COLUMN checkout_key uuid,
  ADD COLUMN checkout_cart_id uuid,
  ADD COLUMN checkout_address_id uuid;
--> statement-breakpoint
ALTER TABLE public.orders ADD CONSTRAINT orders_inventory_state_check
  CHECK (inventory_state IN ('NONE', 'DEDUCTED', 'RESTORED'));
--> statement-breakpoint
CREATE UNIQUE INDEX orders_customer_checkout_key_uidx ON public.orders(customer_id, checkout_key);
--> statement-breakpoint
CREATE UNIQUE INDEX orders_checkout_cart_uidx ON public.orders(checkout_cart_id);
--> statement-breakpoint
-- New internal operational fields are not part of public/customer read contracts.
REVOKE SELECT ON public.orders FROM anon, authenticated;
GRANT SELECT (id, customer_id, store_id, status, delivery_type, payment_method,
  subtotal, delivery_fee_snapshot, total_amount, delivery_address_snapshot,
  delivery_contact_name, delivery_contact_phone, created_at, updated_at)
  ON public.orders TO authenticated;
--> statement-breakpoint
CREATE FUNCTION public.protect_order_inventory_identity() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.checkout_key IS DISTINCT FROM OLD.checkout_key
    OR NEW.checkout_cart_id IS DISTINCT FROM OLD.checkout_cart_id
    OR NEW.checkout_address_id IS DISTINCT FROM OLD.checkout_address_id THEN
    RAISE EXCEPTION 'Checkout identity is immutable';
  END IF;
  IF NEW.inventory_state IS DISTINCT FROM OLD.inventory_state
    AND NOT (OLD.inventory_state = 'DEDUCTED' AND NEW.inventory_state = 'RESTORED'
      AND NEW.status IN ('CANCELLED', 'REJECTED')) THEN
    RAISE EXCEPTION 'Invalid order inventory effect';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER orders_inventory_identity BEFORE UPDATE ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.protect_order_inventory_identity();