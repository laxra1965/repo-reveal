CREATE OR REPLACE FUNCTION public.run_auto_paper_trades_for(p_user_id uuid)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE s record; o record; v_amt numeric; v_n int := 0; v_slip numeric; v_parts text[]; v_ex text[]; v_types text[];
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('auto_paper_' || p_user_id::text));
  SELECT * INTO s FROM public.user_settings WHERE user_id = p_user_id AND auto_paper_trade;
  IF NOT FOUND THEN RETURN 0; END IF;
  IF NOT public.is_platform_admin(p_user_id) AND NOT EXISTS (
    SELECT 1 FROM public.user_subscriptions us WHERE us.user_id = p_user_id AND us.status = 'active' AND us.end_date > now()) THEN RETURN 0; END IF;
  IF s.trade_amount IS NULL OR s.trade_amount <= 0 THEN RETURN 0; END IF;
  v_amt := CASE WHEN s.max_position_size IS NOT NULL AND s.max_position_size > 0 THEN LEAST(s.trade_amount, s.max_position_size) ELSE s.trade_amount END;
  v_ex := ARRAY(SELECT lower(e::text) FROM unnest(s.enabled_exchanges) e);
  v_types := ARRAY(SELECT regexp_replace(replace(lower(t::text),'-','_'), '_arbitrage$', '') FROM unnest(s.arbitrage_types) t);
  FOR o IN
    SELECT op.* FROM public.opportunities op
    WHERE op.status = 'active' AND op.detected_at > now() - interval '5 minutes'
      AND op.profit_percent - 0.3 - coalesce(op.estimated_slippage,0)*100 > 0
      AND (s.min_profit_percent IS NULL OR op.profit_percent >= s.min_profit_percent)
      AND (s.max_profit_percent IS NULL OR op.profit_percent <= s.max_profit_percent)
      AND (s.slippage_buffer IS NULL OR op.estimated_slippage <= s.slippage_buffer)
      AND (coalesce(array_length(v_types,1),0) = 0 OR regexp_replace(replace(lower(op.strategy),'-','_'), '_arbitrage$', '') = ANY (v_types))
      AND (coalesce(array_length(v_ex,1),0) = 0 OR lower(coalesce(op.exchange1,'')) = ANY (v_ex)
           OR lower(coalesce(op.exchange2,'')) = ANY (v_ex) OR lower(coalesce(op.exchange3,'')) = ANY (v_ex))
      AND NOT EXISTS (SELECT 1 FROM public.trade_history th WHERE th.user_id = p_user_id AND th.opportunity_id = op.id)
    ORDER BY op.profit_percent DESC LIMIT 3
  LOOP
    v_parts := regexp_split_to_array(o.path, '\s*(→|>|/|-)\s*');
    v_slip := (random() - 0.5) * 0.002;
    INSERT INTO public.trade_history(user_id, opportunity_id, base_symbol, intermediate_symbol, quote_symbol,
      start_amount, expected_profit, actual_profit, final_amount, status, total_steps, completed_steps,
      started_at, completed_at, execution_details)
    VALUES (p_user_id, o.id, coalesce(v_parts[1],'UNKNOWN'), coalesce(v_parts[2],'UNKNOWN'), coalesce(v_parts[3], v_parts[1], 'UNKNOWN'),
      v_amt, v_amt * o.profit_percent/100, v_amt * o.profit_percent/100 * (1+v_slip), v_amt + v_amt * o.profit_percent/100 * (1+v_slip),
      'completed', 3, 3, now(), now(),
      jsonb_build_object('is_paper_trade', true, 'auto_executed', true, 'source', 'server_paper_trader',
        'configured_trade_amount', s.trade_amount, 'max_position_size', s.max_position_size,
        'exchanges', concat_ws(' / ', o.exchange1, o.exchange2, o.exchange3),
        'log', jsonb_build_array(
          jsonb_build_object('step',1,'success',true,'isPaperTrade',true,'timestamp',now()),
          jsonb_build_object('step',2,'success',true,'isPaperTrade',true,'timestamp',now()),
          jsonb_build_object('step',3,'success',true,'isPaperTrade',true,'timestamp',now()))));
    v_n := v_n + 1;
  END LOOP;
  RETURN v_n;
END $$;
REVOKE ALL ON FUNCTION public.run_auto_paper_trades_for(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.run_auto_paper_trades_for(uuid) TO service_role;