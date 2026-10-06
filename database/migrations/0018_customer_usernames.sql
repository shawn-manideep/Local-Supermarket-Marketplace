-- Extend the existing shared username foundation. Existing identities/passwords
-- and every customer/commerce record remain unchanged.
CREATE FUNCTION public.assign_customer_username(account_id uuid, account_email text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE base_name text; candidate text; suffix integer := 0;
BEGIN
  IF EXISTS(SELECT 1 FROM identity_usernames WHERE user_id = account_id) THEN RETURN; END IF;
  base_name := regexp_replace(lower(split_part(coalesce(account_email,''),'@',1)), '[^a-z0-9_]', '_', 'g');
  IF base_name !~ '^[a-z]' THEN base_name := 'c_' || base_name; END IF;
  IF length(base_name) < 3 OR base_name IN
    ('admin','administrator','support','system','api','root','delivery','vendor','customer','login','logout','dashboard')
  THEN base_name := 'user_' || base_name; END IF;
  base_name := left(base_name,30);
  LOOP
    candidate := CASE WHEN suffix=0 THEN base_name
      ELSE left(base_name,30-length(suffix::text)-1) || '_' || suffix::text END;
    PERFORM pg_advisory_xact_lock(hashtextextended('username:' || candidate,0));
    INSERT INTO identity_usernames(user_id,normalized_username)
      VALUES(account_id,candidate) ON CONFLICT DO NOTHING;
    IF FOUND OR EXISTS(SELECT 1 FROM identity_usernames WHERE user_id=account_id) THEN RETURN; END IF;
    suffix := suffix+1;
  END LOOP;
END; $$;
REVOKE ALL ON FUNCTION public.assign_customer_username(uuid,text) FROM PUBLIC, anon, authenticated;

DO $$
DECLARE account record;
BEGIN
  FOR account IN SELECT u.id,u.email FROM auth.users u
    JOIN public.user_profiles p ON p.id=u.id
    JOIN public.customers c ON c.id=p.id
    WHERE p.role='customer'
    ORDER BY u.created_at,u.id
  LOOP
    PERFORM public.assign_customer_username(account.id,account.email);
  END LOOP;
END; $$;

-- Existing Auth shell creation is preserved. Only explicit Customer signups
-- reserve a chosen username. Admin-provisioned partners/vendors are unaffected.
CREATE OR REPLACE FUNCTION public.handle_new_auth_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE requested_username text;
BEGIN
  INSERT INTO public.user_profiles(id,role) VALUES(NEW.id,'customer') ON CONFLICT(id) DO NOTHING;
  INSERT INTO public.customers(id) VALUES(NEW.id) ON CONFLICT(id) DO NOTHING;
  IF NEW.raw_user_meta_data->>'customer_signup' = 'true' THEN
    requested_username := lower(NEW.raw_user_meta_data->>'username');
    IF requested_username IS NULL OR requested_username COLLATE "C" !~ '^[a-z][a-z0-9_]{2,29}$'
      OR requested_username IN
        ('admin','administrator','support','system','api','root','delivery','vendor','customer','login','logout','dashboard')
    THEN RAISE EXCEPTION 'Invalid customer username' USING ERRCODE='23514'; END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended('username:' || requested_username,0));
    INSERT INTO public.identity_usernames(user_id,normalized_username) VALUES(NEW.id,requested_username);
  END IF;
  RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION public.handle_new_auth_user() FROM PUBLIC, anon, authenticated;
