-- Forward-only product variant model. Existing catalog rows are retained and
-- receive a neutral "Standard 1 pack" sellable variant with their current
-- price, stock, and availability; legacy order lines retain their old price
-- snapshots and receive neutral size snapshots without a variant reference.
CREATE TYPE public.quantity_unit AS ENUM (
  'g',
  'kg',
  'ml',
  'l',
  'piece',
  'pack',
  'dozen'
);--> statement-breakpoint

CREATE TABLE public.product_variants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  name text NOT NULL,
  quantity_value numeric(12, 3) NOT NULL,
  quantity_unit public.quantity_unit NOT NULL,
  price numeric(12, 2) NOT NULL,
  stock_quantity integer NOT NULL DEFAULT 0,
  availability boolean NOT NULL DEFAULT true,
  is_active boolean NOT NULL DEFAULT true,
  sku text,
  external_code text,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT product_variants_quantity_value_positive_check CHECK (quantity_value > 0),
  CONSTRAINT product_variants_price_nonnegative_check CHECK (price >= 0),
  CONSTRAINT product_variants_stock_quantity_nonnegative_check CHECK (stock_quantity >= 0)
);--> statement-breakpoint

CREATE UNIQUE INDEX product_variants_product_id_id_uidx
  ON public.product_variants (product_id, id);--> statement-breakpoint
CREATE UNIQUE INDEX product_variants_product_sku_uidx
  ON public.product_variants (product_id, sku);--> statement-breakpoint
CREATE UNIQUE INDEX product_variants_product_external_code_uidx
  ON public.product_variants (product_id, external_code);--> statement-breakpoint
CREATE INDEX product_variants_product_sort_idx
  ON public.product_variants (product_id, sort_order, id);--> statement-breakpoint
CREATE INDEX product_variants_active_idx
  ON public.product_variants (product_id, is_active, availability);--> statement-breakpoint

-- The existing product-level codes are copied to the default variant to
-- preserve catalog identifiers while allowing multiple variant codes later.
INSERT INTO public.product_variants (
  product_id,
  name,
  quantity_value,
  quantity_unit,
  price,
  stock_quantity,
  availability,
  is_active,
  sku,
  external_code,
  sort_order
)
SELECT
  id,
  'Standard',
  1,
  'pack',
  price,
  stock_quantity,
  availability,
  is_active,
  sku,
  external_code,
  0
FROM public.products;--> statement-breakpoint

ALTER TABLE public.cart_items ADD COLUMN variant_id uuid;--> statement-breakpoint
UPDATE public.cart_items AS cart_line
SET variant_id = variant.id
FROM public.product_variants AS variant
WHERE variant.product_id = cart_line.product_id
  AND variant.name = 'Standard'
  AND variant.sort_order = 0;--> statement-breakpoint
ALTER TABLE public.cart_items ALTER COLUMN variant_id SET NOT NULL;--> statement-breakpoint
DROP INDEX IF EXISTS public.cart_items_cart_product_uidx;--> statement-breakpoint
CREATE UNIQUE INDEX cart_items_cart_variant_uidx
  ON public.cart_items (cart_id, variant_id);--> statement-breakpoint
ALTER TABLE public.cart_items
  ADD CONSTRAINT cart_items_product_variant_fk
  FOREIGN KEY (product_id, variant_id)
  REFERENCES public.product_variants (product_id, id)
  ON DELETE RESTRICT;--> statement-breakpoint
CREATE INDEX cart_items_variant_id_idx ON public.cart_items (variant_id);--> statement-breakpoint

ALTER TABLE public.order_items ADD COLUMN variant_id uuid;--> statement-breakpoint
ALTER TABLE public.order_items
  ADD COLUMN variant_name_snapshot text;--> statement-breakpoint
ALTER TABLE public.order_items
  ADD COLUMN variant_quantity_value_snapshot numeric(12, 3);--> statement-breakpoint
ALTER TABLE public.order_items
  ADD COLUMN variant_quantity_unit_snapshot public.quantity_unit;--> statement-breakpoint
UPDATE public.order_items
SET variant_name_snapshot = 'Standard',
    variant_quantity_value_snapshot = 1,
    variant_quantity_unit_snapshot = 'pack';--> statement-breakpoint
ALTER TABLE public.order_items
  ALTER COLUMN variant_name_snapshot SET NOT NULL,
  ALTER COLUMN variant_quantity_value_snapshot SET NOT NULL,
  ALTER COLUMN variant_quantity_unit_snapshot SET NOT NULL;--> statement-breakpoint
ALTER TABLE public.order_items
  ADD CONSTRAINT order_items_product_variant_fk
  FOREIGN KEY (product_id, variant_id)
  REFERENCES public.product_variants (product_id, id)
  ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE public.order_items
  ADD CONSTRAINT order_items_variant_requires_product_check
  CHECK (variant_id IS NULL OR product_id IS NOT NULL);--> statement-breakpoint
CREATE INDEX order_items_variant_id_idx ON public.order_items (variant_id);--> statement-breakpoint

ALTER TABLE public.product_variants ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY product_variants_vendor_admin_manage
ON public.product_variants FOR ALL
USING (
  public.current_app_role() = 'admin'
  OR (
    public.current_app_role() = 'vendor'
    AND EXISTS (
      SELECT 1 FROM public.products
      WHERE products.id = product_variants.product_id
        AND products.store_id = public.current_store_id()
    )
  )
)
WITH CHECK (
  public.current_app_role() = 'admin'
  OR (
    public.current_app_role() = 'vendor'
    AND EXISTS (
      SELECT 1 FROM public.products
      WHERE products.id = product_variants.product_id
        AND products.store_id = public.current_store_id()
    )
  )
);--> statement-breakpoint
CREATE POLICY product_variants_customer_select
ON public.product_variants FOR SELECT
USING (
  is_active = true
  AND EXISTS (
    SELECT 1
    FROM public.products
    WHERE products.id = product_variants.product_id
      AND products.is_active = true
      AND public.customer_can_access_store(products.store_id)
      AND (
        products.category_id IS NULL
        OR EXISTS (
          SELECT 1
          FROM public.categories
          WHERE categories.id = products.category_id
            AND categories.store_id = products.store_id
            AND categories.is_active = true
        )
      )
  )
);--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.product_variants TO authenticated;--> statement-breakpoint
REVOKE ALL ON TABLE public.product_variants FROM anon;--> statement-breakpoint
REVOKE TRUNCATE, REFERENCES, TRIGGER, MAINTAIN
  ON TABLE public.product_variants FROM anon, authenticated;--> statement-breakpoint

CREATE TRIGGER product_variants_set_updated_at
BEFORE UPDATE ON public.product_variants
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();--> statement-breakpoint
CREATE TRIGGER product_variants_prevent_hard_delete
BEFORE DELETE ON public.product_variants
FOR EACH ROW EXECUTE FUNCTION public.prevent_catalog_hard_delete();--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.prevent_product_variant_product_id_changes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.product_id IS DISTINCT FROM OLD.product_id THEN
    RAISE EXCEPTION 'Variant product ownership is immutable';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.prevent_product_variant_product_id_changes()
  FROM PUBLIC, anon, authenticated;--> statement-breakpoint
CREATE TRIGGER product_variants_product_id_immutable
BEFORE UPDATE OF product_id ON public.product_variants
FOR EACH ROW EXECUTE FUNCTION public.prevent_product_variant_product_id_changes();--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.prevent_order_snapshot_changes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF (
    NEW.subtotal IS DISTINCT FROM OLD.subtotal
    OR NEW.delivery_fee_snapshot IS DISTINCT FROM OLD.delivery_fee_snapshot
    OR NEW.total_amount IS DISTINCT FROM OLD.total_amount
    OR NEW.commission_rate_snapshot IS DISTINCT FROM OLD.commission_rate_snapshot
    OR NEW.commission_amount_snapshot IS DISTINCT FROM OLD.commission_amount_snapshot
    OR NEW.delivery_address_snapshot IS DISTINCT FROM OLD.delivery_address_snapshot
    OR NEW.delivery_contact_name IS DISTINCT FROM OLD.delivery_contact_name
    OR NEW.delivery_contact_phone IS DISTINCT FROM OLD.delivery_contact_phone
  ) THEN
    RAISE EXCEPTION 'Historical order snapshots are immutable';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.prevent_order_item_snapshot_changes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF (
    NEW.product_name_snapshot IS DISTINCT FROM OLD.product_name_snapshot
    OR NEW.product_price_snapshot IS DISTINCT FROM OLD.product_price_snapshot
    OR NEW.variant_name_snapshot IS DISTINCT FROM OLD.variant_name_snapshot
    OR NEW.variant_quantity_value_snapshot IS DISTINCT FROM OLD.variant_quantity_value_snapshot
    OR NEW.variant_quantity_unit_snapshot IS DISTINCT FROM OLD.variant_quantity_unit_snapshot
    OR NEW.quantity IS DISTINCT FROM OLD.quantity
    OR NEW.subtotal IS DISTINCT FROM OLD.subtotal
  ) THEN
    RAISE EXCEPTION 'Historical order item snapshots are immutable';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.prevent_order_item_identity_changes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.order_id IS DISTINCT FROM OLD.order_id
     OR NEW.product_id IS DISTINCT FROM OLD.product_id
     OR NEW.variant_id IS DISTINCT FROM OLD.variant_id THEN
    RAISE EXCEPTION 'Order item identity is immutable';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.prevent_order_snapshot_changes()
  FROM PUBLIC, anon, authenticated;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.prevent_order_item_snapshot_changes()
  FROM PUBLIC, anon, authenticated;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.prevent_order_item_identity_changes()
  FROM PUBLIC, anon, authenticated;--> statement-breakpoint

-- Repeat requests bind a customer's idempotency key to exactly one
-- source-order/address pair and retain the original API response for replay.
CREATE UNIQUE INDEX orders_customer_id_id_uidx
  ON public.orders (customer_id, id);--> statement-breakpoint
CREATE TABLE public.customer_repeat_requests (
  customer_id uuid NOT NULL REFERENCES public.customers(id) ON DELETE RESTRICT,
  idempotency_key uuid NOT NULL,
  source_order_id uuid NOT NULL,
  address_id uuid NOT NULL,
  confirm_store_switch boolean NOT NULL DEFAULT false,
  response jsonb NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT customer_repeat_requests_customer_order_fk
    FOREIGN KEY (customer_id, source_order_id)
    REFERENCES public.orders (customer_id, id)
    ON DELETE RESTRICT
);--> statement-breakpoint
CREATE UNIQUE INDEX customer_repeat_requests_customer_key_uidx
  ON public.customer_repeat_requests (customer_id, idempotency_key);--> statement-breakpoint
CREATE INDEX customer_repeat_requests_source_order_idx
  ON public.customer_repeat_requests (source_order_id);--> statement-breakpoint
ALTER TABLE public.customer_repeat_requests ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY customer_repeat_requests_owner_select
ON public.customer_repeat_requests FOR SELECT
USING (
  customer_id = auth.uid()
  OR public.current_app_role() = 'admin'
);--> statement-breakpoint
GRANT SELECT ON TABLE public.customer_repeat_requests TO authenticated;--> statement-breakpoint
REVOKE ALL ON TABLE public.customer_repeat_requests FROM anon;--> statement-breakpoint
REVOKE INSERT, UPDATE, DELETE ON TABLE public.customer_repeat_requests
  FROM anon, authenticated;--> statement-breakpoint
REVOKE TRUNCATE, REFERENCES, TRIGGER, MAINTAIN
  ON TABLE public.customer_repeat_requests FROM anon, authenticated;--> statement-breakpoint
