CREATE OR REPLACE FUNCTION public.queue_auto_trades_for_users()
 RETURNS TABLE(users_processed integer, trades_queued integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_users_processed integer := 0;
  v_trades_queued integer := 0;
  r_user record;
  r_opp record;
  v_min_profit numeric;
  v_max_profit numeric;
  v_amount numeric;
  v_ex text[];
  v_types text[];
BEGIN
  IF auth.role() != 'service_role' THEN
    RAISE EXCEPTION 'Unauthorized: service role required';
  END IF;

  UPDATE public.auto_trade_queue q
  SET status = th.status,
      completed_at = th.completed_at,
      error_message = th.error_message
  FROM public.trade_history th
  WHERE q.user_id = th.user_id
    AND q.opportunity_id = th.opportunity_id
    AND q.status IN ('processing', 'executing')
    AND th.status IN ('completed', 'failed', 'cancelled');

  UPDATE public.auto_trade_queue
  SET status = 'failed',
      error_message = 'Stuck in processing for > 10 minutes',
      completed_at = now()
  WHERE status IN ('processing', 'executing')
    AND (started_at < now() - interval '10 minutes' OR queued_at < now() - interval '30 minutes');

  FOR r_user IN
    SELECT
      user_id,
      trade_amount,
      max_position_size,
      enabled_exchanges,
      arbitrage_types,
      min_profit_percent,
      max_profit_percent,
      slippage_buffer
    FROM public.user_settings
    WHERE auto_trade = true
  LOOP
    IF NOT public.validate_trade_config(r_user.trade_amount, r_user.max_position_size) THEN
      INSERT INTO public.scanner_logs (user_id, log_type, message, details)
      VALUES (
        r_user.user_id, 'error',
        'Auto-trade skipped: invalid trading configuration',
        jsonb_build_object(
          'trade_amount', r_user.trade_amount,
          'max_position_size', r_user.max_position_size,
          'reason', 'trade_amount must be 1-1,000,000 and <= max_position_size (10-1,000,000)'
        )
      );
      CONTINUE;
    END IF;

    v_users_processed := v_users_processed + 1;
    r_opp := NULL;

    v_min_profit := CASE
      WHEN r_user.min_profit_percent IS NULL THEN NULL
      WHEN r_user.min_profit_percent > 0 AND r_user.min_profit_percent < 0.01 THEN r_user.min_profit_percent * 100
      ELSE r_user.min_profit_percent
    END;

    v_max_profit := CASE
      WHEN r_user.max_profit_percent IS NULL THEN NULL
      WHEN r_user.max_profit_percent > 0 AND r_user.max_profit_percent < 0.01 THEN r_user.max_profit_percent * 100
      ELSE r_user.max_profit_percent
    END;

    v_amount := r_user.trade_amount;
    IF COALESCE(r_user.max_position_size, 0) > 0 THEN
      v_amount := LEAST(v_amount, r_user.max_position_size);
    END IF;

    v_ex := ARRAY(SELECT lower(e::text) FROM unnest(r_user.enabled_exchanges) e);
    v_types := ARRAY(SELECT replace(regexp_replace(lower(t::text), '[-\s]+', '_', 'g'), '_arbitrage', '') FROM unnest(r_user.arbitrage_types) t);

    SELECT o.*
    INTO r_opp
    FROM public.opportunities o
    WHERE o.status = 'active'
      AND o.detected_at > now() - interval '5 minutes'
      AND (v_min_profit IS NULL OR o.profit_percent >= v_min_profit)
      AND (v_max_profit IS NULL OR o.profit_percent <= v_max_profit)
      AND (r_user.slippage_buffer IS NULL OR o.estimated_slippage <= r_user.slippage_buffer)
      AND (
        COALESCE(array_length(v_types, 1), 0) = 0
        OR replace(regexp_replace(lower(COALESCE(o.strategy, '')), '[-\s]+', '_', 'g'), '_arbitrage', '') = ANY (v_types)
      )
      AND (
        COALESCE(array_length(v_ex, 1), 0) = 0
        OR (
          lower(COALESCE(o.exchange1, '')) = ANY (v_ex)
          AND (o.exchange2 IS NULL OR lower(o.exchange2) = ANY (v_ex))
          AND (o.exchange3 IS NULL OR lower(o.exchange3) = ANY (v_ex))
        )
      )
      AND NOT EXISTS (
        SELECT 1
        FROM public.auto_trade_queue q
        WHERE q.user_id = r_user.user_id
          AND q.status IN ('queued', 'processing', 'executing')
      )
      AND NOT EXISTS (
        SELECT 1
        FROM public.trade_history th
        WHERE th.user_id = r_user.user_id
          AND th.status IN ('pending', 'executing')
      )
      AND NOT EXISTS (
        SELECT 1
        FROM public.trade_history th
        WHERE th.user_id = r_user.user_id
          AND th.opportunity_id = o.id
          AND th.created_at > now() - interval '60 seconds'
      )
    ORDER BY o.profit_percent DESC, o.liquidity_score DESC
    LIMIT 1;

    IF FOUND AND r_opp.id IS NOT NULL THEN
      INSERT INTO public.auto_trade_queue (
        user_id, opportunity_id, status, priority, tier_max_amount, actual_trade_amount, queued_at
      ) VALUES (
        r_user.user_id, r_opp.id, 'queued', 10, GREATEST(v_amount, 0), v_amount, now()
      );

      v_trades_queued := v_trades_queued + 1;
    END IF;
  END LOOP;

  RETURN QUERY SELECT v_users_processed, v_trades_queued;
END;
$function$