CREATE TABLE public.identity_usernames (
  user_id uuid PRIMARY KEY REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  normalized_username text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT username_format_check CHECK (
    normalized_username COLLATE "C" ~ '^[a-z][a-z0-9_]{2,29}$'
    AND normalized_username = lower(normalized_username)
    AND normalized_username NOT IN ('admin','administrator','support','system','api','root','delivery','vendor','customer','login','logout','dashboard'))
);
--> statement-breakpoint
CREATE FUNCTION public.protect_username_identity() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.user_id IS DISTINCT FROM OLD.user_id OR NEW.normalized_username IS DISTINCT FROM OLD.normalized_username THEN
    RAISE EXCEPTION 'Username identity is immutable';
  END IF;
  RETURN NEW;
END; $$;
--> statement-breakpoint
CREATE TRIGGER username_identity_immutable BEFORE UPDATE ON public.identity_usernames
FOR EACH ROW EXECUTE FUNCTION public.protect_username_identity();
--> statement-breakpoint
CREATE TABLE public.delivery_partner_profiles (
  user_id uuid PRIMARY KEY REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  display_name text NOT NULL CHECK (length(btrim(display_name)) BETWEEN 1 AND 100),
  contact_number text CHECK (contact_number IS NULL OR contact_number ~ '^(\+91)?[6-9][0-9]{9}$'),
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','INACTIVE')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
-- Phase 7 foundation only: no assignment writes, execution, or order transitions.
CREATE TABLE public.delivery_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE RESTRICT,
  partner_user_id uuid NOT NULL REFERENCES public.delivery_partner_profiles(user_id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'ASSIGNED' CHECK (status IN ('PENDING','ASSIGNED','PICKUP_PENDING','OUT_FOR_DELIVERY','DELIVERED','CANCELLED','REJECTED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX delivery_assignments_partner_created_idx ON public.delivery_assignments(partner_user_id, created_at);
--> statement-breakpoint
CREATE FUNCTION public.is_active_delivery_partner() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.delivery_partner_profiles p
    JOIN public.user_profiles u ON u.id = p.user_id
    WHERE p.user_id = auth.uid() AND p.status = 'ACTIVE' AND u.role = 'delivery_partner');
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.is_active_delivery_partner() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_active_delivery_partner() TO authenticated;
--> statement-breakpoint
ALTER TABLE public.identity_usernames ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.delivery_partner_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.delivery_assignments ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON public.identity_usernames, public.delivery_partner_profiles, public.delivery_assignments FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.identity_usernames, public.delivery_partner_profiles TO authenticated;
-- Direct readers do not receive order/customer identities through the foundation.
GRANT SELECT (id, status, created_at, updated_at) ON public.delivery_assignments TO authenticated;
GRANT ALL ON public.identity_usernames, public.delivery_partner_profiles, public.delivery_assignments TO service_role;
--> statement-breakpoint
CREATE POLICY usernames_read_own_or_admin ON public.identity_usernames FOR SELECT TO authenticated
USING (user_id = auth.uid() OR public.current_app_role() = 'admin');
CREATE POLICY partner_profiles_read_own_or_admin ON public.delivery_partner_profiles FOR SELECT TO authenticated
USING ((user_id = auth.uid() AND public.is_active_delivery_partner()) OR public.current_app_role() = 'admin');
CREATE POLICY assignments_read_own_active ON public.delivery_assignments FOR SELECT TO authenticated
USING (partner_user_id = auth.uid() AND public.is_active_delivery_partner());