CREATE OR REPLACE FUNCTION public.publish_browser_opportunities(p_opportunities jsonb)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_uid uuid := auth.uid(); v_item jsonb; v_count integer := 0; v_rows integer; v_exchange text; v_path text; v_ts timestamptz; v_gross numeric; v_volume numeric; v_pairs text[];
BEGIN
 IF v_uid IS NULL THEN RAISE EXCEPTION 'Login required'; END IF;
 IF NOT public.is_platform_admin(v_uid) AND NOT EXISTS (SELECT 1 FROM public.user_subscriptions WHERE user_id=v_uid AND status='active' AND end_date>now()) THEN RAISE EXCEPTION 'Active subscription required'; END IF;
 IF jsonb_typeof(p_opportunities) IS DISTINCT FROM 'array' OR jsonb_array_length(p_opportunities)>100 THEN RAISE EXCEPTION 'Expected at most 100 opportunities'; END IF;
 PERFORM pg_advisory_xact_lock(hashtext('browser-opportunity-publish'));
 FOR v_item IN SELECT value FROM jsonb_array_elements(p_opportunities) LOOP
  v_exchange := v_item->>'exchange'; v_path := v_item->>'path'; v_ts := (v_item->>'detected_at')::timestamptz; v_gross := (v_item->>'gross_percent')::numeric; v_volume := (v_item->>'volume_estimate')::numeric;
  SELECT array_agg(value) INTO v_pairs FROM jsonb_array_elements_text(v_item->'pairs');
  IF v_exchange IS NULL OR v_exchange NOT IN ('binance','bybit','okx') OR v_path IS NULL OR v_path !~ '^USDT > [A-Z0-9]{1,15} > [A-Z0-9]{1,15} > USDT$' OR v_ts IS NULL OR v_ts < now()-interval '15 seconds' OR v_ts>now()+interval '5 seconds' OR v_gross IS NULL OR v_gross<=0.3 OR v_gross>5.3 OR v_volume IS NULL OR v_volume<0 OR v_volume>1000000000 OR cardinality(v_pairs) IS DISTINCT FROM 3 THEN RAISE EXCEPTION 'Invalid browser opportunity'; END IF;
  IF EXISTS (SELECT 1 FROM unnest(v_pairs) p WHERE p !~ '^[A-Z0-9]{1,15}/[A-Z0-9]{1,15}$') THEN RAISE EXCEPTION 'Invalid pair'; END IF;
  INSERT INTO public.opportunities(strategy,path,exchange1,exchange2,exchange3,pair1,pair2,pair3,profit_percent,liquidity_score,volume_estimate,estimated_slippage,detected_at,status)
  SELECT 'triangular',v_path,v_exchange,v_exchange,v_exchange,v_pairs[1],v_pairs[2],v_pairs[3],v_gross,0,v_volume,0,v_ts,'active'
  WHERE NOT EXISTS (SELECT 1 FROM public.opportunities WHERE strategy='triangular' AND path=v_path AND exchange1=v_exchange AND detected_at>=v_ts-interval '15 seconds');
  GET DIAGNOSTICS v_rows=ROW_COUNT; v_count:=v_count+v_rows;
 END LOOP;
 RETURN v_count;
END; $$;
REVOKE ALL ON FUNCTION public.publish_browser_opportunities(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.publish_browser_opportunities(jsonb) TO authenticated;
GRANT SELECT ON public.opportunities, public.trade_history, public.auto_trade_queue TO authenticated;
GRANT ALL ON public.opportunities, public.trade_history, public.auto_trade_queue TO service_role;