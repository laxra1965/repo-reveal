-- Migration: Fix auto trade queuing logic
-- Date: 2025-12-08
-- Description: Update queue_auto_trades_for_users to allow re-entry after cooldown

CREATE OR REPLACE FUNCTION public.queue_auto_trades_for_users()
RETURNS TABLE (users_processed INT, trades_queued INT)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_users_processed INT := 0;
  v_trades_queued INT := 0;
  r_user RECORD;
  r_opp RECORD;
  v_queue_id UUID;
BEGIN
  -- Iterate through users with auto_trade enabled
  FOR r_user IN
    SELECT user_id, trade_amount, min_profit_percent
    FROM public.user_settings
    WHERE auto_trade = true
  LOOP
    v_users_processed := v_users_processed + 1;

    -- Find top opportunity for this user
    -- Must be:
    -- 1. Not expired
    -- 2. Profitable enough
    -- 3. Not already in queue (pending/processing)
    -- 4. Not recently traded (cooldown check)
    FOR r_opp IN
      SELECT *
      FROM public.arbitrage_opportunities ao
      WHERE ao.user_id = r_user.user_id
      AND ao.expires_at > now()
      AND ao.profit_percent >= COALESCE(r_user.min_profit_percent, 0.05)
      -- Ensure we don't queue if there's already an active trade for this user in queue
      AND NOT EXISTS (
        SELECT 1 FROM public.auto_trade_queue atq
        WHERE atq.user_id = r_user.user_id
        AND atq.status IN ('queued', 'processing', 'executing')
      )
      -- Allow re-entry after 60 seconds (1 minute cooldown)
      -- Matches on PATH (symbols + exchanges) rather than just ID, handling ID churn
      AND NOT EXISTS (
        SELECT 1 FROM public.trade_history th
        WHERE th.user_id = r_user.user_id
        AND th.base_symbol = ao.base_symbol
        AND th.quote_symbol = ao.quote_symbol
        AND th.intermediate_symbol = ao.intermediate_symbol
        AND th.exchange1 = ao.exchange1
        AND th.exchange2 = ao.exchange2
        AND th.exchange3 = ao.exchange3
        AND th.created_at > now() - INTERVAL '60 seconds'
      )
      ORDER BY ao.profit_percent DESC
      LIMIT 1
    LOOP
      -- Queue the trade
      INSERT INTO public.auto_trade_queue (
        user_id,
        opportunity_id,
        status,
        priority,
        tier_max_amount,
        actual_trade_amount
      ) VALUES (
        r_user.user_id,
        r_opp.id,
        'queued',
        10, -- High priority
        1000, -- Placeholder, limit checked in execution
        r_user.trade_amount
      )
      RETURNING id INTO v_queue_id;
      
      v_trades_queued := v_trades_queued + 1;
    END LOOP;
  END LOOP;

  RETURN QUERY SELECT v_users_processed, v_trades_queued;
END;
$$;
