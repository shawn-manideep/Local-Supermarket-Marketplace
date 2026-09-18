CREATE EXTENSION IF NOT EXISTS "pgcrypto";--> statement-breakpoint
CREATE TYPE "public"."app_role" AS ENUM('customer', 'vendor', 'admin');--> statement-breakpoint
CREATE TYPE "public"."cart_status" AS ENUM('ACTIVE', 'ABANDONED', 'CONVERTED');--> statement-breakpoint
CREATE TYPE "public"."delivery_type" AS ENUM('vendor_staff', 'platform_partner');--> statement-breakpoint
CREATE TYPE "public"."order_status" AS ENUM('PLACED', 'ACCEPTED', 'PREPARING', 'READY', 'OUT_FOR_DELIVERY', 'DELIVERED', 'REJECTED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."payment_method" AS ENUM('COD');--> statement-breakpoint
CREATE TYPE "public"."store_status" AS ENUM('PENDING_APPROVAL', 'ACTIVE', 'SUSPENDED', 'REJECTED');--> statement-breakpoint
CREATE TABLE "cart_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cart_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "carts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_id" uuid NOT NULL,
	"store_id" uuid NOT NULL,
	"status" "cart_status" DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"name" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customer_addresses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_id" uuid NOT NULL,
	"label" text,
	"recipient_name" text NOT NULL,
	"phone" text NOT NULL,
	"line1" text NOT NULL,
	"line2" text,
	"city" text NOT NULL,
	"state" text NOT NULL,
	"pincode" text NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customers" (
	"id" uuid PRIMARY KEY NOT NULL,
	"full_name" text,
	"phone" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "order_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"product_id" uuid,
	"product_name_snapshot" text NOT NULL,
	"product_price_snapshot" numeric(12, 2) NOT NULL,
	"quantity" integer NOT NULL,
	"subtotal" numeric(12, 2) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "order_status_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"status" "order_status" NOT NULL,
	"note" text,
	"changed_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_id" uuid NOT NULL,
	"store_id" uuid NOT NULL,
	"status" "order_status" DEFAULT 'PLACED' NOT NULL,
	"delivery_type" "delivery_type" DEFAULT 'vendor_staff' NOT NULL,
	"payment_method" "payment_method" DEFAULT 'COD' NOT NULL,
	"subtotal" numeric(12, 2) NOT NULL,
	"delivery_fee_snapshot" numeric(12, 2) NOT NULL,
	"total_amount" numeric(12, 2) NOT NULL,
	"commission_rate_snapshot" numeric(5, 2),
	"commission_amount_snapshot" numeric(12, 2),
	"delivery_address_snapshot" jsonb NOT NULL,
	"delivery_contact_name" text NOT NULL,
	"delivery_contact_phone" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"category_id" uuid,
	"name" text NOT NULL,
	"description" text,
	"sku" text,
	"external_code" text,
	"price" numeric(12, 2) NOT NULL,
	"availability" boolean DEFAULT true NOT NULL,
	"stock_quantity" integer DEFAULT 0 NOT NULL,
	"image_url" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "store_operating_hours" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"day_of_week" integer NOT NULL,
	"opens_at" time,
	"closes_at" time,
	"is_closed" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "store_service_pincodes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"pincode" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stores" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"logo_image_url" text,
	"phone" text,
	"delivery_fee" numeric(12, 2) DEFAULT '0' NOT NULL,
	"minimum_order_value" numeric(12, 2) DEFAULT '0' NOT NULL,
	"commission_rate" numeric(5, 2),
	"status" "store_status" DEFAULT 'PENDING_APPROVAL' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_profiles" (
	"id" uuid PRIMARY KEY NOT NULL,
	"role" "app_role" DEFAULT 'customer' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "cart_items" ADD CONSTRAINT "cart_items_cart_id_carts_id_fk" FOREIGN KEY ("cart_id") REFERENCES "public"."carts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cart_items" ADD CONSTRAINT "cart_items_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "carts" ADD CONSTRAINT "carts_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "carts" ADD CONSTRAINT "carts_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_addresses" ADD CONSTRAINT "customer_addresses_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_id_user_profiles_id_fk" FOREIGN KEY ("id") REFERENCES "public"."user_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_status_history" ADD CONSTRAINT "order_status_history_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_status_history" ADD CONSTRAINT "order_status_history_changed_by_user_profiles_id_fk" FOREIGN KEY ("changed_by") REFERENCES "public"."user_profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "categories_store_id_uidx" ON "categories" USING btree ("store_id","id");--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_store_category_fk" FOREIGN KEY ("store_id","category_id") REFERENCES "public"."categories"("store_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_operating_hours" ADD CONSTRAINT "store_operating_hours_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_service_pincodes" ADD CONSTRAINT "store_service_pincodes_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stores" ADD CONSTRAINT "stores_owner_user_id_user_profiles_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."user_profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "cart_items_cart_product_uidx" ON "cart_items" USING btree ("cart_id","product_id");--> statement-breakpoint
CREATE INDEX "cart_items_product_id_idx" ON "cart_items" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "carts_customer_id_idx" ON "carts" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "carts_store_id_idx" ON "carts" USING btree ("store_id");--> statement-breakpoint
CREATE UNIQUE INDEX "categories_store_name_uidx" ON "categories" USING btree ("store_id","name");--> statement-breakpoint
CREATE INDEX "categories_store_id_idx" ON "categories" USING btree ("store_id");--> statement-breakpoint
CREATE INDEX "customer_addresses_customer_id_idx" ON "customer_addresses" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "order_items_order_id_idx" ON "order_items" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "order_items_product_id_idx" ON "order_items" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "order_status_history_order_id_idx" ON "order_status_history" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "orders_customer_id_idx" ON "orders" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "orders_store_id_idx" ON "orders" USING btree ("store_id");--> statement-breakpoint
CREATE INDEX "orders_status_idx" ON "orders" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "products_store_sku_uidx" ON "products" USING btree ("store_id","sku");--> statement-breakpoint
CREATE UNIQUE INDEX "products_store_external_code_uidx" ON "products" USING btree ("store_id","external_code");--> statement-breakpoint
CREATE INDEX "products_store_id_idx" ON "products" USING btree ("store_id");--> statement-breakpoint
CREATE INDEX "products_category_id_idx" ON "products" USING btree ("category_id");--> statement-breakpoint
CREATE UNIQUE INDEX "store_operating_hours_store_day_uidx" ON "store_operating_hours" USING btree ("store_id","day_of_week");--> statement-breakpoint
CREATE UNIQUE INDEX "store_service_pincodes_store_pincode_uidx" ON "store_service_pincodes" USING btree ("store_id","pincode");--> statement-breakpoint
CREATE INDEX "store_service_pincodes_store_id_idx" ON "store_service_pincodes" USING btree ("store_id");--> statement-breakpoint
CREATE UNIQUE INDEX "stores_owner_user_id_uidx" ON "stores" USING btree ("owner_user_id");--> statement-breakpoint
ALTER TABLE "user_profiles" ADD CONSTRAINT "user_profiles_id_auth_users_fk" FOREIGN KEY ("id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_operating_hours" ADD CONSTRAINT "store_operating_hours_day_of_week_check" CHECK ("store_operating_hours"."day_of_week" BETWEEN 0 AND 6);--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_price_nonnegative_check" CHECK ("products"."price" >= 0);--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_stock_quantity_nonnegative_check" CHECK ("products"."stock_quantity" >= 0);--> statement-breakpoint
ALTER TABLE "stores" ADD CONSTRAINT "stores_delivery_fee_nonnegative_check" CHECK ("stores"."delivery_fee" >= 0);--> statement-breakpoint
ALTER TABLE "stores" ADD CONSTRAINT "stores_minimum_order_value_nonnegative_check" CHECK ("stores"."minimum_order_value" >= 0);--> statement-breakpoint
ALTER TABLE "stores" ADD CONSTRAINT "stores_commission_rate_range_check" CHECK ("stores"."commission_rate" IS NULL OR ("stores"."commission_rate" >= 0 AND "stores"."commission_rate" <= 100));--> statement-breakpoint
ALTER TABLE "cart_items" ADD CONSTRAINT "cart_items_quantity_positive_check" CHECK ("cart_items"."quantity" > 0);--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_quantity_positive_check" CHECK ("order_items"."quantity" > 0);--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER user_profiles_set_updated_at BEFORE UPDATE ON public.user_profiles FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();--> statement-breakpoint
CREATE TRIGGER customers_set_updated_at BEFORE UPDATE ON public.customers FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();--> statement-breakpoint
CREATE TRIGGER customer_addresses_set_updated_at BEFORE UPDATE ON public.customer_addresses FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();--> statement-breakpoint
CREATE TRIGGER stores_set_updated_at BEFORE UPDATE ON public.stores FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();--> statement-breakpoint
CREATE TRIGGER store_operating_hours_set_updated_at BEFORE UPDATE ON public.store_operating_hours FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();--> statement-breakpoint
CREATE TRIGGER categories_set_updated_at BEFORE UPDATE ON public.categories FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();--> statement-breakpoint
CREATE TRIGGER products_set_updated_at BEFORE UPDATE ON public.products FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();--> statement-breakpoint
CREATE TRIGGER carts_set_updated_at BEFORE UPDATE ON public.carts FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();--> statement-breakpoint
CREATE TRIGGER cart_items_set_updated_at BEFORE UPDATE ON public.cart_items FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();--> statement-breakpoint
CREATE TRIGGER orders_set_updated_at BEFORE UPDATE ON public.orders FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.current_app_role()
RETURNS public.app_role
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT role FROM public.user_profiles WHERE id = auth.uid() $$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.current_store_id()
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT id FROM public.stores WHERE owner_user_id = auth.uid() $$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.handle_new_auth_user()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  INSERT INTO public.user_profiles (id, role) VALUES (NEW.id, 'customer') ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.customers (id) VALUES (NEW.id) ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_auth_user();--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.prevent_vendor_store_identity_changes()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF public.current_app_role() = 'vendor'
     AND (
       NEW.owner_user_id IS DISTINCT FROM OLD.owner_user_id
       OR NEW.status IS DISTINCT FROM OLD.status
       OR NEW.commission_rate IS DISTINCT FROM OLD.commission_rate
     ) THEN
    RAISE EXCEPTION 'Vendors cannot change store ownership, approval status, or commission rate';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER stores_protect_vendor_identity BEFORE UPDATE ON public.stores FOR EACH ROW EXECUTE FUNCTION public.prevent_vendor_store_identity_changes();--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.ensure_vendor_store_owner()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.user_profiles
    WHERE id = NEW.owner_user_id AND role = 'vendor'
  ) THEN
    RAISE EXCEPTION 'A store owner must have the vendor role';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER stores_require_vendor_owner
BEFORE INSERT OR UPDATE OF owner_user_id ON public.stores
FOR EACH ROW EXECUTE FUNCTION public.ensure_vendor_store_owner();--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.prevent_catalog_hard_delete()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION 'Catalog entities must be deactivated with is_active=false instead of deleted';
  RETURN OLD;
END;
$$;--> statement-breakpoint
CREATE TRIGGER categories_prevent_hard_delete
BEFORE DELETE ON public.categories
FOR EACH ROW EXECUTE FUNCTION public.prevent_catalog_hard_delete();--> statement-breakpoint
CREATE TRIGGER products_prevent_hard_delete
BEFORE DELETE ON public.products
FOR EACH ROW EXECUTE FUNCTION public.prevent_catalog_hard_delete();--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.prevent_order_snapshot_changes()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
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
CREATE TRIGGER orders_prevent_snapshot_changes
BEFORE UPDATE ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.prevent_order_snapshot_changes();--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.prevent_order_item_snapshot_changes()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF (
    NEW.product_name_snapshot IS DISTINCT FROM OLD.product_name_snapshot
    OR NEW.product_price_snapshot IS DISTINCT FROM OLD.product_price_snapshot
    OR NEW.quantity IS DISTINCT FROM OLD.quantity
    OR NEW.subtotal IS DISTINCT FROM OLD.subtotal
  ) THEN
    RAISE EXCEPTION 'Historical order item snapshots are immutable';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER order_items_prevent_snapshot_changes
BEFORE UPDATE ON public.order_items
FOR EACH ROW EXECUTE FUNCTION public.prevent_order_item_snapshot_changes();--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.prevent_order_hard_delete()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION 'Historical orders cannot be deleted';
  RETURN OLD;
END;
$$;--> statement-breakpoint
CREATE TRIGGER orders_prevent_hard_delete
BEFORE DELETE ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.prevent_order_hard_delete();--> statement-breakpoint
ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.customer_addresses ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.stores ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.store_service_pincodes ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.store_operating_hours ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.carts ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.cart_items ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.order_items ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.order_status_history ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY user_profiles_select_self_or_admin ON public.user_profiles FOR SELECT
USING (id = auth.uid() OR public.current_app_role() = 'admin');--> statement-breakpoint
CREATE POLICY customers_select_self_or_admin ON public.customers FOR SELECT
USING (id = auth.uid() OR public.current_app_role() = 'admin');--> statement-breakpoint
CREATE POLICY customers_update_self ON public.customers FOR UPDATE
USING (id = auth.uid()) WITH CHECK (id = auth.uid());--> statement-breakpoint
CREATE POLICY customer_addresses_customer_access ON public.customer_addresses FOR ALL
USING (customer_id = auth.uid() OR public.current_app_role() = 'admin')
WITH CHECK (customer_id = auth.uid() OR public.current_app_role() = 'admin');--> statement-breakpoint
CREATE POLICY stores_vendor_select ON public.stores FOR SELECT
USING (
  owner_user_id = auth.uid()
  OR public.current_app_role() = 'admin'
  OR (public.current_app_role() = 'vendor' AND id = public.current_store_id())
);--> statement-breakpoint
CREATE POLICY stores_vendor_insert ON public.stores FOR INSERT
WITH CHECK (owner_user_id = auth.uid() AND public.current_app_role() = 'vendor');--> statement-breakpoint
CREATE POLICY stores_vendor_update ON public.stores FOR UPDATE
USING (owner_user_id = auth.uid() OR public.current_app_role() = 'admin')
WITH CHECK (owner_user_id = auth.uid() OR public.current_app_role() = 'admin');--> statement-breakpoint
CREATE POLICY stores_admin_delete ON public.stores FOR DELETE
USING (public.current_app_role() = 'admin');--> statement-breakpoint
CREATE POLICY store_service_pincodes_vendor_access ON public.store_service_pincodes FOR ALL
USING (store_id = public.current_store_id() OR public.current_app_role() = 'admin')
WITH CHECK (store_id = public.current_store_id() OR public.current_app_role() = 'admin');--> statement-breakpoint
CREATE POLICY store_operating_hours_vendor_access ON public.store_operating_hours FOR ALL
USING (store_id = public.current_store_id() OR public.current_app_role() = 'admin')
WITH CHECK (store_id = public.current_store_id() OR public.current_app_role() = 'admin');--> statement-breakpoint
CREATE POLICY categories_vendor_access ON public.categories FOR ALL
USING (store_id = public.current_store_id() OR public.current_app_role() = 'admin')
WITH CHECK (store_id = public.current_store_id() OR public.current_app_role() = 'admin');--> statement-breakpoint
CREATE POLICY products_vendor_access ON public.products FOR ALL
USING (store_id = public.current_store_id() OR public.current_app_role() = 'admin')
WITH CHECK (store_id = public.current_store_id() OR public.current_app_role() = 'admin');--> statement-breakpoint
CREATE POLICY carts_customer_select ON public.carts FOR SELECT
USING (
  customer_id = auth.uid()
  OR store_id = public.current_store_id()
  OR public.current_app_role() = 'admin'
);--> statement-breakpoint
CREATE POLICY carts_customer_insert ON public.carts FOR INSERT
WITH CHECK (customer_id = auth.uid());--> statement-breakpoint
CREATE POLICY carts_customer_update ON public.carts FOR UPDATE
USING (customer_id = auth.uid()) WITH CHECK (customer_id = auth.uid());--> statement-breakpoint
CREATE POLICY carts_customer_delete ON public.carts FOR DELETE
USING (customer_id = auth.uid());--> statement-breakpoint
CREATE POLICY cart_items_customer_select ON public.cart_items FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.carts
    WHERE carts.id = cart_items.cart_id
      AND (
        carts.customer_id = auth.uid()
        OR carts.store_id = public.current_store_id()
        OR public.current_app_role() = 'admin'
      )
  )
);--> statement-breakpoint
CREATE POLICY cart_items_customer_manage ON public.cart_items FOR ALL
USING (
  EXISTS (
    SELECT 1 FROM public.carts
    WHERE carts.id = cart_items.cart_id AND carts.customer_id = auth.uid()
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.carts
    WHERE carts.id = cart_items.cart_id AND carts.customer_id = auth.uid()
  )
);--> statement-breakpoint
CREATE POLICY orders_customer_vendor_admin_select ON public.orders FOR SELECT
USING (
  customer_id = auth.uid()
  OR store_id = public.current_store_id()
  OR public.current_app_role() = 'admin'
);--> statement-breakpoint
CREATE POLICY orders_admin_manage ON public.orders FOR ALL
USING (public.current_app_role() = 'admin')
WITH CHECK (public.current_app_role() = 'admin');--> statement-breakpoint
CREATE POLICY order_items_customer_vendor_admin_select ON public.order_items FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.orders
    WHERE orders.id = order_items.order_id
      AND (
        orders.customer_id = auth.uid()
        OR orders.store_id = public.current_store_id()
        OR public.current_app_role() = 'admin'
      )
  )
);--> statement-breakpoint
CREATE POLICY order_status_history_customer_vendor_admin_select
ON public.order_status_history FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.orders
    WHERE orders.id = order_status_history.order_id
      AND (
        orders.customer_id = auth.uid()
        OR orders.store_id = public.current_store_id()
        OR public.current_app_role() = 'admin'
      )
  )
);--> statement-breakpoint
CREATE UNIQUE INDEX carts_one_active_per_customer_store_uidx
ON public.carts (customer_id, store_id)
WHERE status = 'ACTIVE';--> statement-breakpoint