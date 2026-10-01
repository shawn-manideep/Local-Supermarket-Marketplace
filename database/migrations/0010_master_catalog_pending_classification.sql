-- Pending classification is represented by a NULL master_category_id.
ALTER TABLE public.master_products ALTER COLUMN master_category_id DROP NOT NULL;--> statement-breakpoint
-- Vendors can discover active pending products, while products assigned to
-- archived categories remain unavailable. Customer roles receive no new read grant.
DROP POLICY master_products_authorized_read ON public.master_products;--> statement-breakpoint
CREATE POLICY master_products_authorized_read ON public.master_products FOR SELECT TO authenticated
USING (public.current_app_role() = 'admin' OR (
  public.current_app_role() = 'vendor' AND is_active AND (
    master_category_id IS NULL OR EXISTS (
      SELECT 1 FROM public.master_categories mc
      WHERE mc.id = master_category_id AND mc.is_active
    )
  )
));