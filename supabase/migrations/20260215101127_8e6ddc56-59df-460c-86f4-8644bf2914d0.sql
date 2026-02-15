-- Add service role authorization check to queue_auto_trades_for_users
CREATE OR REPLACE FUNCTION public.queue_auto_trades_for_users()
RETURNS TABLE(users_processed integer, trades_queued integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_users_processed INT := 0;
  v_trades_queued INT := 0;
  r_user RECORD;
  r_opp RECORD;
  v_queue_id UUID;
BEGIN
  -- Authorization: only service_role may call this
  IF auth.role() != 'service_role' THEN
    RAISE EXCEPTION 'Unauthorized: service role required';
  END IF;

  FOR r_user IN
    SELECT user_id, trade_amount, min_profit_percent
    FROM public.user_settings
    WHERE auto_trade = true
  LOOP
    v_users_processed := v_users_processed + 1;

    FOR r_opp IN
      SELECT *
      FROM public.arbitrage_opportunities ao
      WHERE ao.user_id = r_user.user_id
      AND ao.expires_at > now()
      AND ao.profit_percent >= COALESCE(r_user.min_profit_percent, 0.05)
      AND NOT EXISTS (
        SELECT 1 FROM public.auto_trade_queue atq
        WHERE atq.user_id = r_user.user_id
        AND atq.status IN ('queued', 'processing', 'executing')
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.trade_history th
        WHERE th.user_id = r_user.user_id
        AND th.base_symbol = ao.base_symbol
        AND th.quote_symbol = ao.quote_symbol
        AND th.intermediate_symbol = ao.intermediate_symbol
        AND th.created_at > now() - INTERVAL '60 seconds'
      )
      ORDER BY ao.profit_percent DESC
      LIMIT 1
    LOOP
      INSERT INTO public.auto_trade_queue (
        user_id, opportunity_id, status, priority, tier_max_amount, actual_trade_amount
      ) VALUES (
        r_user.user_id, r_opp.id, 'queued', 10, 1000, r_user.trade_amount
      ) RETURNING id INTO v_queue_id;
      
      v_trades_queued := v_trades_queued + 1;
    END LOOP;
  END LOOP;

  RETURN QUERY SELECT v_users_processed, v_trades_queued;
END;
$$;

-- Add service role authorization check to process_pending_auto_trades
CREATE OR REPLACE FUNCTION public.process_pending_auto_trades()
RETURNS TABLE(processed integer, succeeded integer, failed integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  trade_record RECORD;
  processed_count INTEGER := 0;
  success_count INTEGER := 0;
  fail_count INTEGER := 0;
BEGIN
  -- Authorization: only service_role may call this
  IF auth.role() != 'service_role' THEN
    RAISE EXCEPTION 'Unauthorized: service role required';
  END IF;

  FOR trade_record IN 
    SELECT 
      atq.id as queue_id, atq.user_id, atq.opportunity_id, atq.actual_trade_amount,
      ao.base_symbol, ao.quote_symbol, ao.intermediate_symbol,
      ao.exchange1, ao.exchange2, ao.exchange3,
      ao.step1_action, ao.step1_price, ao.step2_action, ao.step2_price,
      ao.step3_action, ao.step3_price, ao.profit_percent, ao.start_amount, ao.end_amount
    FROM public.auto_trade_queue atq
    INNER JOIN public.arbitrage_opportunities ao ON ao.id = atq.opportunity_id
    WHERE atq.status = 'queued' AND ao.expires_at > now()
    ORDER BY atq.priority DESC, atq.queued_at
    LIMIT 10
  LOOP
    processed_count := processed_count + 1;
    
    UPDATE public.auto_trade_queue
    SET status = 'processing', started_at = now()
    WHERE id = trade_record.queue_id;
    
    DECLARE
      has_credentials BOOLEAN;
    BEGIN
      SELECT EXISTS(
        SELECT 1 FROM public.exchange_credentials
        WHERE user_id = trade_record.user_id
          AND exchange IN (trade_record.exchange1, trade_record.exchange2, trade_record.exchange3)
          AND is_connected = true
      ) INTO has_credentials;
      
      IF NOT has_credentials THEN
        UPDATE public.auto_trade_queue
        SET status = 'failed', error_message = 'Missing exchange API credentials', completed_at = now()
        WHERE id = trade_record.queue_id;
        fail_count := fail_count + 1;
        CONTINUE;
      END IF;
    END;
    
    DECLARE
      trade_history_id UUID;
    BEGIN
      INSERT INTO public.trade_history (
        user_id, opportunity_id, status, base_symbol, quote_symbol, intermediate_symbol,
        total_steps, completed_steps, start_amount, expected_profit, execution_details
      ) VALUES (
        trade_record.user_id, trade_record.opportunity_id, 'pending',
        trade_record.base_symbol, trade_record.quote_symbol, trade_record.intermediate_symbol,
        3, 0, trade_record.actual_trade_amount,
        (trade_record.actual_trade_amount * trade_record.profit_percent / 100),
        jsonb_build_object(
          'exchange1', trade_record.exchange1, 'exchange2', trade_record.exchange2, 'exchange3', trade_record.exchange3,
          'step1', jsonb_build_object('action', trade_record.step1_action, 'price', trade_record.step1_price),
          'step2', jsonb_build_object('action', trade_record.step2_action, 'price', trade_record.step2_price),
          'step3', jsonb_build_object('action', trade_record.step3_action, 'price', trade_record.step3_price),
          'queued_from', 'auto_trade'
        )
      ) RETURNING id INTO trade_history_id;
      
      INSERT INTO public.scanner_logs (user_id, log_type, message, details) VALUES (
        trade_record.user_id, 'trade', 'Auto-trade queued for execution',
        jsonb_build_object('trade_id', trade_history_id, 'opportunity_id', trade_record.opportunity_id,
          'symbol', trade_record.base_symbol || '/' || trade_record.quote_symbol,
          'amount', trade_record.actual_trade_amount,
          'expected_profit', (trade_record.actual_trade_amount * trade_record.profit_percent / 100))
      );
      
      UPDATE public.auto_trade_queue SET status = 'completed', completed_at = now() WHERE id = trade_record.queue_id;
      success_count := success_count + 1;
      
    EXCEPTION
      WHEN OTHERS THEN
        UPDATE public.auto_trade_queue SET status = 'failed', error_message = SQLERRM, completed_at = now() WHERE id = trade_record.queue_id;
        fail_count := fail_count + 1;
    END;
  END LOOP;
  
  RETURN QUERY SELECT processed_count, success_count, fail_count;
END;
$$;

-- Add service role authorization check to get_auto_trade_status
CREATE OR REPLACE FUNCTION public.get_auto_trade_status()
RETURNS TABLE(total_users_with_auto_trade bigint, queued_trades bigint, processing_trades bigint, trades_last_hour bigint, failed_trades_last_hour bigint, avg_trade_time_seconds numeric)
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    (SELECT COUNT(DISTINCT user_id) FROM public.user_settings WHERE auto_trade = true),
    (SELECT COUNT(*) FROM public.auto_trade_queue WHERE status = 'queued'),
    (SELECT COUNT(*) FROM public.auto_trade_queue WHERE status = 'processing'),
    (SELECT COUNT(*) FROM public.auto_trade_queue WHERE completed_at > now() - interval '1 hour' AND status = 'completed'),
    (SELECT COUNT(*) FROM public.auto_trade_queue WHERE completed_at > now() - interval '1 hour' AND status = 'failed'),
    (SELECT AVG(EXTRACT(EPOCH FROM (completed_at - started_at))) 
     FROM public.auto_trade_queue 
     WHERE status = 'completed' AND completed_at > now() - interval '1 hour')
$$;