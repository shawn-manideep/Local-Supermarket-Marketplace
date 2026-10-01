-- Additive only: existing identities, names, selling values and snapshots are
-- neither mapped nor rewritten. Pack sizes remain store-owned variants.
ALTER TYPE public.quantity_unit ADD VALUE IF NOT EXISTS 'bottle';--> statement-breakpoint
ALTER TYPE public.quantity_unit ADD VALUE IF NOT EXISTS 'box';--> statement-breakpoint
CREATE TABLE public.master_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 120),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);--> statement-breakpoint
CREATE TABLE public.master_products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  master_category_id uuid NOT NULL REFERENCES public.master_categories(id) ON DELETE RESTRICT,
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 200),
  description text,
  image text,
  brand text,
  attributes jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(attributes) = 'object'),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);--> statement-breakpoint
ALTER TABLE public.categories ADD COLUMN master_category_id uuid
  REFERENCES public.master_categories(id) ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE public.products ADD COLUMN master_product_id uuid
  REFERENCES public.master_products(id) ON DELETE RESTRICT;--> statement-breakpoint
CREATE INDEX master_categories_active_name_idx ON public.master_categories(is_active, name);--> statement-breakpoint
CREATE INDEX master_products_category_idx ON public.master_products(master_category_id);--> statement-breakpoint
CREATE INDEX master_products_active_name_idx ON public.master_products(is_active, name);--> statement-breakpoint
CREATE INDEX products_master_product_idx ON public.products(master_product_id);--> statement-breakpoint
-- Intentionally NOT UNIQUE: existing legacy duplicate listings must survive.
CREATE TABLE public.master_mapping_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  previous_master_product_id uuid REFERENCES public.master_products(id) ON DELETE RESTRICT,
  master_product_id uuid NOT NULL REFERENCES public.master_products(id) ON DELETE RESTRICT,
  actor_user_id uuid NOT NULL REFERENCES public.user_profiles(id) ON DELETE RESTRICT,
  reason text NOT NULL CHECK (length(btrim(reason)) > 0),
  created_at timestamptz NOT NULL DEFAULT now()
);--> statement-breakpoint
CREATE INDEX master_mapping_audit_product_idx ON public.master_mapping_audit(product_id, created_at);--> statement-breakpoint
ALTER TABLE public.master_categories ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.master_products ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.master_mapping_audit ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
-- Canonical mutations and audited mapping corrections are API-only. Existing
-- Supabase role/session helpers are unchanged.
REVOKE ALL ON public.master_categories, public.master_products, public.master_mapping_audit FROM PUBLIC, anon, authenticated;--> statement-breakpoint
GRANT SELECT ON public.master_categories, public.master_products, public.master_mapping_audit TO authenticated;--> statement-breakpoint
CREATE POLICY master_categories_authorized_read ON public.master_categories FOR SELECT TO authenticated
USING (public.current_app_role() = 'admin' OR (public.current_app_role() = 'vendor' AND is_active));--> statement-breakpoint
CREATE POLICY master_products_authorized_read ON public.master_products FOR SELECT TO authenticated
USING (public.current_app_role() = 'admin' OR (
  public.current_app_role() = 'vendor' AND is_active AND EXISTS (
    SELECT 1 FROM public.master_categories mc WHERE mc.id = master_category_id AND mc.is_active
  )
));--> statement-breakpoint
CREATE POLICY master_mapping_audit_admin_read ON public.master_mapping_audit FOR SELECT TO authenticated
USING (public.current_app_role() = 'admin');--> statement-breakpoint
CREATE TRIGGER master_categories_set_updated_at BEFORE UPDATE ON public.master_categories
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();--> statement-breakpoint
CREATE TRIGGER master_products_set_updated_at BEFORE UPDATE ON public.master_products
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();--> statement-breakpoint
CREATE TRIGGER master_categories_prevent_hard_delete BEFORE DELETE ON public.master_categories
FOR EACH ROW EXECUTE FUNCTION public.prevent_catalog_hard_delete();--> statement-breakpoint
CREATE TRIGGER master_products_prevent_hard_delete BEFORE DELETE ON public.master_products
FOR EACH ROW EXECUTE FUNCTION public.prevent_catalog_hard_delete();--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.prevent_master_mapping_audit_mutation()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RAISE EXCEPTION 'Master mapping audit records are append-only';
END;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.prevent_master_mapping_audit_mutation() FROM PUBLIC, anon, authenticated;--> statement-breakpoint
CREATE TRIGGER master_mapping_audit_immutable BEFORE UPDATE OR DELETE ON public.master_mapping_audit
FOR EACH ROW EXECUTE FUNCTION public.prevent_master_mapping_audit_mutation();--> statement-breakpoint
-- Do not allow direct authenticated table writes to bypass canonical selection,
-- activation checks or correction auditing. Other legacy column writes continue
-- to follow their existing RLS policies.
CREATE OR REPLACE FUNCTION public.protect_direct_master_listing_changes()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NOT NULL THEN
    IF TG_OP = 'INSERT' THEN
      RAISE EXCEPTION 'New store products must use the authorized Master Catalog API';
    END IF;
    IF NEW.master_product_id IS DISTINCT FROM OLD.master_product_id THEN
      RAISE EXCEPTION 'Master mapping changes must use the audited Admin API';
    END IF;
    IF OLD.master_product_id IS NOT NULL AND (
      NEW.name IS DISTINCT FROM OLD.name OR
      (NOT OLD.is_active AND NEW.is_active)
    ) THEN
      RAISE EXCEPTION 'Canonical identity and listing activation must use the catalog API';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.protect_direct_master_listing_changes() FROM PUBLIC, anon, authenticated;--> statement-breakpoint
CREATE TRIGGER products_protect_master_listing BEFORE INSERT OR UPDATE ON public.products
FOR EACH ROW EXECUTE FUNCTION public.protect_direct_master_listing_changes();--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.protect_direct_master_category_mapping()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NOT NULL THEN
    IF TG_OP = 'INSERT' THEN
      IF NEW.master_category_id IS NOT NULL THEN
        RAISE EXCEPTION 'Master category mapping must use the authorized catalog API';
      END IF;
    ELSIF NEW.master_category_id IS DISTINCT FROM OLD.master_category_id THEN
      RAISE EXCEPTION 'Master category mapping must use the authorized catalog API';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.protect_direct_master_category_mapping() FROM PUBLIC, anon, authenticated;--> statement-breakpoint
CREATE TRIGGER categories_protect_master_mapping BEFORE INSERT OR UPDATE ON public.categories
FOR EACH ROW EXECUTE FUNCTION public.protect_direct_master_category_mapping();--> statement-breakpoint
-- Customers and vendors share the authenticated SQL role. Private columns are
-- therefore read only through the role-checked API, not unrestricted PostgREST
-- projections. RLS continues to protect the permitted direct-read columns.
REVOKE SELECT ON public.products, public.product_variants FROM authenticated;--> statement-breakpoint
GRANT SELECT (id, store_id, category_id, master_product_id, name, description, price, availability, image_url, is_active)
ON public.products TO authenticated;--> statement-breakpoint
GRANT SELECT (id, product_id, name, quantity_value, quantity_unit, price, availability, is_active, sort_order)
ON public.product_variants TO authenticated;