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
      AND COALESCE(trade_amount, 0) > 0
  LOOP
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

    SELECT o.*
    INTO r_opp
    FROM public.opportunities o
    WHERE o.status = 'active'
      AND o.detected_at > now() - interval '5 minutes'
      AND (v_min_profit IS NULL OR o.profit_percent >= v_min_profit)
      AND (v_max_profit IS NULL OR o.profit_percent <= v_max_profit)
      AND (r_user.slippage_buffer IS NULL OR o.estimated_slippage <= r_user.slippage_buffer)
      AND (
        COALESCE(array_length(r_user.arbitrage_types, 1), 0) = 0
        OR replace(regexp_replace(lower(COALESCE(o.strategy, '')), '[-\s]+', '_', 'g'), '_arbitrage', '') = ANY (
          ARRAY(
            SELECT replace(regexp_replace(lower(t), '[-\s]+', '_', 'g'), '_arbitrage', '')
            FROM unnest(r_user.arbitrage_types) AS t
          )
        )
      )
      AND (
        COALESCE(array_length(r_user.enabled_exchanges, 1), 0) = 0
        OR (
          lower(COALESCE(o.exchange1, '')) = ANY (r_user.enabled_exchanges)
          AND (o.exchange2 IS NULL OR lower(o.exchange2) = ANY (r_user.enabled_exchanges))
          AND (o.exchange3 IS NULL OR lower(o.exchange3) = ANY (r_user.enabled_exchanges))
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
$function$;

CREATE OR REPLACE FUNCTION public.run_my_auto_trade_cycle()
 RETURNS TABLE(users_processed integer, trades_queued integer, processed integer, succeeded integer, failed integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_started timestamptz := clock_timestamp();
  v_elapsed integer;
  v_users_processed integer := 0;
  v_trades_queued integer := 0;
  v_processed integer := 0;
  v_succeeded integer := 0;
  v_failed integer := 0;
  r_settings record;
  r_opp record;
  queue_record record;
  path_parts text[];
  v_min_profit numeric;
  v_max_profit numeric;
  v_enabled_exchanges text[];
  v_amount numeric;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Login required';
  END IF;

  UPDATE public.auto_trade_queue q
  SET status = th.status,
      completed_at = th.completed_at,
      error_message = th.error_message
  FROM public.trade_history th
  WHERE q.user_id = v_user_id
    AND th.user_id = v_user_id
    AND q.opportunity_id = th.opportunity_id
    AND q.status IN ('processing', 'executing')
    AND th.status IN ('completed', 'failed', 'cancelled');

  UPDATE public.auto_trade_queue
  SET status = 'failed',
      error_message = 'Stuck in processing for > 10 minutes',
      completed_at = now()
  WHERE user_id = v_user_id
    AND status IN ('processing', 'executing')
    AND (started_at < now() - interval '10 minutes' OR queued_at < now() - interval '30 minutes');

  SELECT * INTO r_settings
  FROM public.user_settings
  WHERE user_id = v_user_id
    AND auto_trade = true
    AND COALESCE(trade_amount, 0) > 0;

  IF FOUND THEN
    v_users_processed := 1;
    v_min_profit := CASE
      WHEN r_settings.min_profit_percent IS NULL THEN NULL
      WHEN r_settings.min_profit_percent > 0 AND r_settings.min_profit_percent < 0.01 THEN r_settings.min_profit_percent * 100
      ELSE r_settings.min_profit_percent
    END;
    v_max_profit := CASE
      WHEN r_settings.max_profit_percent IS NULL THEN NULL
      WHEN r_settings.max_profit_percent > 0 AND r_settings.max_profit_percent < 0.01 THEN r_settings.max_profit_percent * 100
      ELSE r_settings.max_profit_percent
    END;
    SELECT ARRAY(SELECT lower(e::text) FROM unnest(r_settings.enabled_exchanges) AS e) INTO v_enabled_exchanges;

    v_amount := r_settings.trade_amount;
    IF COALESCE(r_settings.max_position_size, 0) > 0 THEN
      v_amount := LEAST(v_amount, r_settings.max_position_size);
    END IF;

    SELECT o.* INTO r_opp
    FROM public.opportunities o
    WHERE o.status = 'active'
      AND o.detected_at > now() - interval '5 minutes'
      AND (v_min_profit IS NULL OR o.profit_percent >= v_min_profit)
      AND (v_max_profit IS NULL OR o.profit_percent <= v_max_profit)
      AND (r_settings.slippage_buffer IS NULL OR o.estimated_slippage <= r_settings.slippage_buffer)
      AND (
        COALESCE(array_length(r_settings.arbitrage_types, 1), 0) = 0
        OR replace(regexp_replace(lower(COALESCE(o.strategy, '')), '[-\s]+', '_', 'g'), '_arbitrage', '') = ANY (
          ARRAY(
            SELECT replace(regexp_replace(lower(t), '[-\s]+', '_', 'g'), '_arbitrage', '')
            FROM unnest(r_settings.arbitrage_types) AS t
          )
        )
      )
      AND (
        COALESCE(array_length(v_enabled_exchanges, 1), 0) = 0
        OR (
          lower(COALESCE(o.exchange1, '')) = ANY (v_enabled_exchanges)
          AND (o.exchange2 IS NULL OR lower(o.exchange2) = ANY (v_enabled_exchanges))
          AND (o.exchange3 IS NULL OR lower(o.exchange3) = ANY (v_enabled_exchanges))
        )
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.auto_trade_queue q
        WHERE q.user_id = v_user_id
          AND q.status IN ('queued', 'processing', 'executing')
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.trade_history th
        WHERE th.user_id = v_user_id
          AND th.status IN ('pending', 'executing')
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.trade_history th
        WHERE th.user_id = v_user_id
          AND th.opportunity_id = o.id
          AND th.created_at > now() - interval '60 seconds'
      )
    ORDER BY o.profit_percent DESC, o.liquidity_score DESC
    LIMIT 1;

    IF FOUND AND r_opp.id IS NOT NULL THEN
      INSERT INTO public.auto_trade_queue (
        user_id, opportunity_id, status, priority, tier_max_amount, actual_trade_amount, queued_at
      ) VALUES (
        v_user_id, r_opp.id, 'queued', 10, GREATEST(v_amount, 0), v_amount, now()
      );
      v_trades_queued := 1;
    END IF;
  END IF;

  FOR queue_record IN
    SELECT
      q.id AS queue_id,
      q.user_id,
      q.opportunity_id,
      q.actual_trade_amount,
      o.strategy,
      o.path,
      o.exchange1,
      o.exchange2,
      o.exchange3,
      o.profit_percent,
      o.estimated_slippage,
      o.detected_at
    FROM public.auto_trade_queue q
    INNER JOIN public.opportunities o ON o.id = q.opportunity_id
    WHERE q.user_id = v_user_id
      AND q.status = 'queued'
      AND o.status = 'active'
      AND o.detected_at > now() - interval '5 minutes'
    ORDER BY q.priority DESC, q.queued_at
    LIMIT 20
  LOOP
    v_processed := v_processed + 1;
    UPDATE public.auto_trade_queue SET status = 'processing', started_at = now() WHERE id = queue_record.queue_id;

    BEGIN
      path_parts := regexp_split_to_array(regexp_replace(COALESCE(queue_record.path, ''), '\s*(→|>|/|-)\s*', '|', 'g'), '\|');

      INSERT INTO public.trade_history (
        user_id, opportunity_id, base_symbol, quote_symbol, intermediate_symbol,
        start_amount, expected_profit, status, total_steps, completed_steps, execution_details
      ) VALUES (
        v_user_id,
        queue_record.opportunity_id,
        COALESCE(path_parts[1], 'UNKNOWN'),
        COALESCE(path_parts[3], COALESCE(path_parts[1], 'UNKNOWN')),
        COALESCE(path_parts[2], 'UNKNOWN'),
        queue_record.actual_trade_amount,
        queue_record.actual_trade_amount * (queue_record.profit_percent / 100),
        'pending',
        3,
        0,
        jsonb_build_object(
          'queued_from', 'auto_trade',
          'mode', 'live',
          'manual', true,
          'strategy', queue_record.strategy,
          'exchange1', queue_record.exchange1,
          'exchange2', queue_record.exchange2,
          'exchange3', queue_record.exchange3,
          'configured_trade_amount', queue_record.actual_trade_amount,
          'estimated_slippage', queue_record.estimated_slippage,
          'detected_at', queue_record.detected_at
        )
      );

      UPDATE public.auto_trade_queue SET status = 'completed', completed_at = now() WHERE id = queue_record.queue_id;
      v_succeeded := v_succeeded + 1;
    EXCEPTION WHEN OTHERS THEN
      UPDATE public.auto_trade_queue
      SET status = 'failed', error_message = SQLERRM, completed_at = now()
      WHERE id = queue_record.queue_id;
      v_failed := v_failed + 1;
    END;
  END LOOP;

  v_elapsed := (EXTRACT(EPOCH FROM (clock_timestamp() - v_started)) * 1000)::integer;
  INSERT INTO public.scanner_logs (user_id, log_type, message, details)
  VALUES (
    '00000000-0000-0000-0000-000000000000',
    'scheduler_summary',
    'Manual auto-trade cycle triggered by user RPC',
    jsonb_build_object(
      'manual', true,
      'fallback', 'user_rpc',
      'triggered_by', v_user_id,
      'execution_time_ms', v_elapsed,
      'users_processed', v_users_processed,
      'trades_queued', v_trades_queued,
      'trades_processed', v_processed,
      'trades_executed', v_succeeded,
      'trades_failed', v_failed
    )
  );

  RETURN QUERY SELECT v_users_processed, v_trades_queued, v_processed, v_succeeded, v_failed;
END;
$function$;