
-- 1. Enable RLS on tables that have policies but RLS disabled
ALTER TABLE public.opportunities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.filter_templates ENABLE ROW LEVEL SECURITY;

-- filter_templates: admin-only read/write, service role full access
DROP POLICY IF EXISTS "filter_templates_admin_read" ON public.filter_templates;
CREATE POLICY "filter_templates_admin_read" ON public.filter_templates
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.admin_users WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "filter_templates_service_all" ON public.filter_templates;
CREATE POLICY "filter_templates_service_all" ON public.filter_templates
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- 2. Tighten permissive policies on opportunities
DROP POLICY IF EXISTS "service_role_insert_opportunities" ON public.opportunities;
DROP POLICY IF EXISTS "service_role_update_opportunities" ON public.opportunities;
DROP POLICY IF EXISTS "service_role_delete_opportunities" ON public.opportunities;
DROP POLICY IF EXISTS "service_role_select_opportunities" ON public.opportunities;
DROP POLICY IF EXISTS "Authenticated users can delete opportunities" ON public.opportunities;

-- Keep "Authenticated users can view opportunities" (SELECT, true) — intentional public read
-- Keep "Service role can manage opportunities" (ALL, service_role) — proper service access

-- 3. Tighten permissive policies on opportunity_filters
DROP POLICY IF EXISTS "service_role_insert_filters" ON public.opportunity_filters;
DROP POLICY IF EXISTS "service_role_update_filters" ON public.opportunity_filters;
DROP POLICY IF EXISTS "service_role_delete_filters" ON public.opportunity_filters;
DROP POLICY IF EXISTS "service_role_read_active_filters" ON public.opportunity_filters;

CREATE POLICY "opportunity_filters_service_all" ON public.opportunity_filters
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Allow admin users to manage filters from the dashboard
DROP POLICY IF EXISTS "opportunity_filters_admin_write" ON public.opportunity_filters;
CREATE POLICY "opportunity_filters_admin_write" ON public.opportunity_filters
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.admin_users WHERE user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.admin_users WHERE user_id = auth.uid()));

-- 4. Materialized view should not be exposed via PostgREST
REVOKE ALL ON public.user_trade_statistics FROM anon, authenticated;

-- 5. Set fixed search_path on functions missing it
ALTER FUNCTION public.handle_futures_trades_closure() SET search_path = '';
ALTER FUNCTION public.get_futures_config() SET search_path = '';
ALTER FUNCTION public.is_credentials_encrypted(uuid) SET search_path = '';
ALTER FUNCTION public.get_cached(varchar) SET search_path = '';
ALTER FUNCTION public.set_cache(varchar, jsonb, integer) SET search_path = '';

-- 6. Lock down SECURITY DEFINER functions: revoke from anon/authenticated by default
REVOKE EXECUTE ON FUNCTION public.auto_cleanup_opportunities() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.cleanup_stale_opportunities() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.create_paper_trade_from_opportunity(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.enforce_opportunity_filters() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.enforce_real_money_settings() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.process_pending_auto_trades() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.queue_auto_trades_for_users() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.queue_futures_auto_trades() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.queue_paper_trades_from_opportunities(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.update_updated_at_column() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.handle_futures_trades_closure() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_futures_config() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_cached(varchar) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.set_cache(varchar, jsonb, integer) FROM PUBLIC, anon, authenticated;

-- Re-grant explicitly to service_role for scheduled/internal use
GRANT EXECUTE ON FUNCTION public.auto_cleanup_opportunities() TO service_role;
GRANT EXECUTE ON FUNCTION public.cleanup_stale_opportunities() TO service_role;
GRANT EXECUTE ON FUNCTION public.create_paper_trade_from_opportunity(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.process_pending_auto_trades() TO service_role;
GRANT EXECUTE ON FUNCTION public.queue_auto_trades_for_users() TO service_role;
GRANT EXECUTE ON FUNCTION public.queue_futures_auto_trades() TO service_role;
GRANT EXECUTE ON FUNCTION public.queue_paper_trades_from_opportunities(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_cached(varchar) TO service_role;
GRANT EXECUTE ON FUNCTION public.set_cache(varchar, jsonb, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_futures_config() TO service_role, authenticated;

-- Functions intentionally callable by signed-in users from the frontend
-- (already granted by default to authenticated; ensure they remain executable)
GRANT EXECUTE ON FUNCTION public.get_paper_trades_with_exchanges(uuid, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_paper_trades_with_exchanges(uuid, integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_auto_trade_status() TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_demo_paper_trades(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_credentials_encrypted(uuid) TO authenticated;
