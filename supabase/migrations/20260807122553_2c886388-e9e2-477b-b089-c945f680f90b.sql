CREATE OR REPLACE FUNCTION public.create_paper_trade_from_opportunity(p_user_id uuid, p_opp_id uuid)
RETURNS TABLE(status text, message text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_opp RECORD;
  v_symbol TEXT;
  v_entry_price NUMERIC;
  v_quantity NUMERIC;
  v_pnl NUMERIC;
  v_trade_status TEXT;
  v_notional NUMERIC;
  v_trade_amount NUMERIC;
  v_max_position NUMERIC;
BEGIN
  SELECT * INTO v_opp FROM public.opportunities WHERE id = p_opp_id;

  IF v_opp IS NULL THEN
    RETURN QUERY SELECT 'error'::TEXT, 'Opportunity not found'::TEXT;
    RETURN;
  END IF;

  SELECT us.trade_amount, us.max_position_size
    INTO v_trade_amount, v_max_position
  FROM public.user_settings us
  WHERE us.user_id = p_user_id;

  -- Respect the user's configured trade amount (fallback 10 USDT)
  v_notional := COALESCE(NULLIF(v_trade_amount, 0), 10);
  IF COALESCE(v_max_position, 0) > 0 THEN
    v_notional := LEAST(v_notional, v_max_position);
  END IF;
  IF v_notional <= 0 THEN v_notional := 10; END IF;

  v_symbol := COALESCE(v_opp.pair1, 'BTC');

  v_entry_price := (v_opp.volume_estimate * 0.01)::NUMERIC;
  IF v_entry_price IS NULL OR v_entry_price < 100 THEN v_entry_price := 1000; END IF;

  -- Quantity derived from the configured notional
  v_quantity := v_notional / v_entry_price;
  IF v_quantity <= 0 THEN v_quantity := 0.0001; END IF;

  v_pnl := (v_notional * COALESCE(v_opp.profit_percent, 0) / 100)::NUMERIC;

  v_trade_status := CASE WHEN COALESCE(v_opp.profit_percent, 0) > 0 THEN 'CLOSED' ELSE 'FAILED' END;

  INSERT INTO public.paper_trades (
    user_id, symbol, entry_price, quantity, pnl, status, trade_type
  ) VALUES (
    p_user_id, v_symbol, v_entry_price, v_quantity, v_pnl, v_trade_status, 'LONG'
  );

  RETURN QUERY SELECT 'success'::TEXT, 'Paper trade created from opportunity'::TEXT;
END;
$$;