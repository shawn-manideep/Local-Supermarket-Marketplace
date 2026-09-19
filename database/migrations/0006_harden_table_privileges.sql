REVOKE TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE
  public.user_profiles,
  public.customers,
  public.customer_addresses,
  public.stores,
  public.store_service_pincodes,
  public.store_operating_hours,
  public.categories,
  public.products,
  public.carts,
  public.cart_items,
  public.orders,
  public.order_items,
  public.order_status_history
FROM anon, authenticated;--> statement-breakpoint

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
REVOKE TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLES
FROM anon, authenticated;