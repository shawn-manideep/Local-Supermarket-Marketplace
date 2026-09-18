DROP POLICY IF EXISTS carts_customer_insert ON public.carts;--> statement-breakpoint
DROP POLICY IF EXISTS carts_customer_update ON public.carts;--> statement-breakpoint
DROP POLICY IF EXISTS carts_customer_delete ON public.carts;--> statement-breakpoint
DROP POLICY IF EXISTS cart_items_customer_manage ON public.cart_items;

-- Customer cart mutations are intentionally API-only. The Express API derives
-- ownership and enforces lifecycle, store, product, stock, and financial rules.
-- Existing customer/vendor/admin SELECT policies remain unchanged.