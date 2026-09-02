DO $$
DECLARE
  f record;
  client_fns text[] := ARRAY[
    'run_my_auto_trade_cycle','admin_run_auto_trade_cycle','reconcile_duplicate_trades',
    'get_auto_trade_status','get_paper_trades_with_exchanges','create_paper_trade_from_opportunity',
    'queue_paper_trades_from_opportunities','is_platform_admin','cleanup_stale_opportunities',
    'validate_trade_config','get_futures_config','has_role'
  ];
  anon_fns text[] := ARRAY['get_public_admin_settings'];
BEGIN
  FOR f IN
    SELECT p.oid::regprocedure AS sig, p.proname
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', f.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', f.sig);

    IF f.proname = ANY (client_fns) THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', f.sig);
    END IF;

    IF f.proname = ANY (anon_fns) THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO anon, authenticated', f.sig);
    END IF;
  END LOOP;
END $$;