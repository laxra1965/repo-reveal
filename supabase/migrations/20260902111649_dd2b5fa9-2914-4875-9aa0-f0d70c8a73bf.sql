-- Internal / service-only functions: not callable from the browser at all
REVOKE ALL ON FUNCTION public.process_pending_auto_trades() FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.queue_auto_trades_for_users() FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.queue_futures_auto_trades() FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.run_auto_trade_cycle() FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.log_scheduler_run(text, timestamptz, integer, integer, integer, integer, jsonb) FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.set_cache(character varying, jsonb, integer) FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.get_cached(character varying) FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.create_demo_paper_trades(uuid) FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.is_credentials_encrypted(uuid) FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.handle_new_user() FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.update_updated_at_column() FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.auto_cleanup_opportunities() FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.enforce_opportunity_filters() FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.enforce_real_money_settings() FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.handle_futures_trades_closure() FROM anon, authenticated;

-- Signed-in-user functions: block anonymous callers only
REVOKE ALL ON FUNCTION public.run_my_auto_trade_cycle() FROM anon;
REVOKE ALL ON FUNCTION public.admin_run_auto_trade_cycle() FROM anon;
REVOKE ALL ON FUNCTION public.reconcile_duplicate_trades(boolean) FROM anon;
REVOKE ALL ON FUNCTION public.get_auto_trade_status() FROM anon;
REVOKE ALL ON FUNCTION public.get_paper_trades_with_exchanges(uuid, integer) FROM anon;
REVOKE ALL ON FUNCTION public.get_paper_trades_with_exchanges(uuid, integer, integer) FROM anon;
REVOKE ALL ON FUNCTION public.create_paper_trade_from_opportunity(uuid, uuid) FROM anon;
REVOKE ALL ON FUNCTION public.queue_paper_trades_from_opportunities(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.is_platform_admin(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.cleanup_stale_opportunities() FROM anon;

-- Admin-guard the maintenance cleanup so any signed-in user cannot purge data
CREATE OR REPLACE FUNCTION public.cleanup_stale_opportunities()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  deleted_count integer;
BEGIN
  IF auth.role() <> 'service_role' AND NOT public.is_platform_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Admin required';
  END IF;

  DELETE FROM public.opportunities
  WHERE detected_at < NOW() - INTERVAL '2 minutes';

  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$function$;

REVOKE ALL ON FUNCTION public.cleanup_stale_opportunities() FROM anon;
GRANT EXECUTE ON FUNCTION public.cleanup_stale_opportunities() TO authenticated, service_role;