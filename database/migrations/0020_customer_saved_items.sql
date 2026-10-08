-- Store-specific favorites. No cart, inventory, product or order writes.
CREATE TABLE public.customer_saved_items (
  customer_id uuid NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (customer_id, product_id)
);
CREATE INDEX customer_saved_items_customer_created_idx
  ON public.customer_saved_items(customer_id, created_at DESC);
ALTER TABLE public.customer_saved_items ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.customer_saved_items FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, DELETE ON public.customer_saved_items TO service_role;
