CREATE OR REPLACE FUNCTION public.customer_can_access_store(target_store_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.current_app_role() = 'customer'
    AND EXISTS (
      SELECT 1
      FROM public.stores store_record
      JOIN public.store_service_pincodes service ON service.store_id = store_record.id
      JOIN public.customer_addresses address ON address.pincode = service.pincode
      WHERE store_record.id = target_store_id
        AND store_record.status = 'ACTIVE'
        AND address.customer_id = auth.uid()
    );
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.customer_can_access_store(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.customer_can_access_store(uuid) TO authenticated;--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.customer_can_access_service_pincode(target_store_id uuid, target_pincode text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.current_app_role() = 'customer'
    AND EXISTS (
      SELECT 1
      FROM public.stores store_record
      JOIN public.customer_addresses address ON address.customer_id = auth.uid()
      WHERE store_record.id = target_store_id
        AND store_record.status = 'ACTIVE'
        AND address.pincode = target_pincode
    );
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.customer_can_access_service_pincode(uuid, text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.customer_can_access_service_pincode(uuid, text) TO authenticated;--> statement-breakpoint
CREATE POLICY stores_customer_discovery_select ON public.stores FOR SELECT
USING (public.customer_can_access_store(id));--> statement-breakpoint
CREATE POLICY store_service_pincodes_customer_select ON public.store_service_pincodes FOR SELECT
USING (public.customer_can_access_service_pincode(store_id, pincode));--> statement-breakpoint
CREATE POLICY store_operating_hours_customer_select ON public.store_operating_hours FOR SELECT
USING (public.customer_can_access_store(store_id));--> statement-breakpoint
CREATE POLICY categories_customer_select ON public.categories FOR SELECT
USING (is_active = true AND public.customer_can_access_store(store_id));--> statement-breakpoint
CREATE POLICY products_customer_select ON public.products FOR SELECT
USING (
  is_active = true
  AND public.customer_can_access_store(store_id)
  AND (
    category_id IS NULL
    OR EXISTS (SELECT 1 FROM public.categories WHERE categories.id = products.category_id AND categories.store_id = products.store_id AND categories.is_active = true)
  )
);