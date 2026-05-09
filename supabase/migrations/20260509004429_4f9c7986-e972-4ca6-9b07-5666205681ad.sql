
-- 1. Drop sensitive tables from realtime publication
ALTER PUBLICATION supabase_realtime DROP TABLE public.exchange_credentials;
ALTER PUBLICATION supabase_realtime DROP TABLE public.admin_settings;
ALTER PUBLICATION supabase_realtime DROP TABLE public.transactions;
ALTER PUBLICATION supabase_realtime DROP TABLE public.filter_audit_log;
ALTER PUBLICATION supabase_realtime DROP TABLE public.filter_templates;

-- 2. Restrict admin_users SELECT to self (prevents enumeration of admin IDs)
DROP POLICY IF EXISTS "admin_users_read" ON public.admin_users;
CREATE POLICY "admin_users_read_self" ON public.admin_users
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

-- 3. Restrict admin_settings reads to admin users only
DROP POLICY IF EXISTS "admin_settings_read" ON public.admin_settings;
CREATE POLICY "admin_settings_read_admins" ON public.admin_settings
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.admin_users WHERE user_id = auth.uid()));

-- 4. Public-safe accessor for the few keys the frontend gates need
CREATE OR REPLACE FUNCTION public.get_public_admin_settings()
RETURNS TABLE(key text, value text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT key::text, value::text
  FROM public.admin_settings
  WHERE key IN ('usdt_address', 'real_money_approved', 'real_money_allowed_exchanges');
$$;

REVOKE EXECUTE ON FUNCTION public.get_public_admin_settings() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_admin_settings() TO authenticated, anon;

-- 5. Tighten filter_audit_log policies
DROP POLICY IF EXISTS "admin_read_audit_log" ON public.filter_audit_log;
DROP POLICY IF EXISTS "service_role_insert_audit_log" ON public.filter_audit_log;

CREATE POLICY "filter_audit_log_admin_read" ON public.filter_audit_log
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.admin_users WHERE user_id = auth.uid()));

CREATE POLICY "filter_audit_log_service_insert" ON public.filter_audit_log
  FOR INSERT TO service_role
  WITH CHECK (true);
