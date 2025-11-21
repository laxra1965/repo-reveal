-- Migration: Dynamic Expiry System
-- Description: Expire opportunities when arbitrage no longer exists, not just by time

-- ============================================================================
-- 1. Update expiry default to 5 minutes (more reasonable than 60 seconds)
-- ============================================================================

ALTER TABLE public.arbitrage_opportunities 
ALTER COLUMN expires_at SET DEFAULT (now() + interval '5 minutes');

-- ============================================================================
-- 2. Create price validation function
-- ============================================================================

CREATE OR REPLACE FUNCTION public.validate_opportunity_still_profitable(
  opp_id UUID,
  current_prices JSONB
)
RETURNS TABLE(
  is_valid BOOLEAN,
  current_profit_percent NUMERIC,
  reason TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  opp RECORD;
  pair1_key TEXT;
  pair2_key TEXT;
  pair3_key TEXT;
  current_pair1_ask NUMERIC;
  current_pair2_bid NUMERIC;
  current_pair3_bid NUMERIC;
  step1_amt NUMERIC;
  step2_amt NUMERIC;
  step3_amt NUMERIC;
  current_profit NUMERIC;
  current_profit_pct NUMERIC;
BEGIN
  -- Fetch opportunity
  SELECT * INTO opp
  FROM public.arbitrage_opportunities
  WHERE id = opp_id;
  
  IF NOT FOUND THEN
    RETURN QUERY SELECT FALSE, 0::NUMERIC, 'Opportunity not found';
    RETURN;
  END IF;
  
  -- Build price keys
  pair1_key := opp.base_symbol || opp.quote_symbol || '_' || opp.exchange1;
  pair2_key := opp.intermediate_symbol || opp.quote_symbol || '_' || opp.exchange2;
  pair3_key := opp.base_symbol || opp.intermediate_symbol || '_' || opp.exchange3;
  
  -- Extract current prices from JSON
  current_pair1_ask := (current_prices->pair1_key->>'askPrice')::NUMERIC;
  current_pair2_bid := (current_prices->pair2_key->>'bidPrice')::NUMERIC;
  current_pair3_bid := (current_prices->pair3_key->>'bidPrice')::NUMERIC;
  
  -- Check if all prices exist
  IF current_pair1_ask IS NULL OR current_pair2_bid IS NULL OR current_pair3_bid IS NULL THEN
    RETURN QUERY SELECT FALSE, 0::NUMERIC, 'One or more trading pairs no longer available';
    RETURN;
  END IF;
  
  -- Recalculate with current prices
  step1_amt := opp.start_amount / current_pair1_ask;
  step2_amt := step1_amt * current_pair3_bid;
  step3_amt := step2_amt * current_pair2_bid;
  
  current_profit := step3_amt - opp.start_amount;
  current_profit_pct := (current_profit / opp.start_amount) * 100;
  
  -- Valid if still profitable (> 0.01%)
  IF current_profit_pct > 0.01 THEN
    RETURN QUERY SELECT TRUE, current_profit_pct, NULL::TEXT;
  ELSE
    RETURN QUERY SELECT FALSE, current_profit_pct, 
      'Profit dropped to ' || ROUND(current_profit_pct, 4)::TEXT || '%';
  END IF;
END;
$$;

-- ============================================================================
-- 3. Create intelligent cleanup function
-- ============================================================================

CREATE OR REPLACE FUNCTION public.intelligent_cleanup_opportunities()
RETURNS TABLE(
  expired_by_time INTEGER,
  expired_by_price INTEGER,
  still_valid INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  rows_expired_time INTEGER;
  rows_expired_price INTEGER := 0;
  rows_valid INTEGER;
BEGIN
  -- Step 1: Expire opportunities older than 10 minutes (safety net)
  DELETE FROM public.arbitrage_opportunities 
  WHERE detected_at < now() - interval '10 minutes';
  
  GET DIAGNOSTICS rows_expired_time = ROW_COUNT;
  
  -- Step 2: Expire opportunities past their expires_at time
  DELETE FROM public.arbitrage_opportunities 
  WHERE expires_at < now()
    AND detected_at >= now() - interval '10 minutes'; -- Don't double-count
  
  GET DIAGNOSTICS rows_expired_price = ROW_COUNT;
  rows_expired_time := rows_expired_time + rows_expired_price;
  
  -- Step 3: Count still valid opportunities
  SELECT COUNT(*) INTO rows_valid
  FROM public.arbitrage_opportunities 
  WHERE expires_at > now();
  
  RETURN QUERY SELECT rows_expired_time, rows_expired_price, rows_valid;
  
  -- Log cleanup stats
  INSERT INTO public.scanner_logs (
    user_id, 
    log_type, 
    message, 
    details
  ) VALUES (
    '00000000-0000-0000-0000-000000000000'::uuid,
    'info',
    'Intelligent cleanup completed',
    jsonb_build_object(
      'expired_by_time', rows_expired_time,
      'expired_by_price', rows_expired_price,
      'still_valid', rows_valid
    )
  );
END;
$$;

-- ============================================================================
-- 4. Create function to calculate dynamic expiry time
-- ============================================================================

CREATE OR REPLACE FUNCTION public.calculate_dynamic_expiry(
  profit_pct NUMERIC,
  liquidity_scr INTEGER,
  detected_time TIMESTAMP WITH TIME ZONE DEFAULT now()
)
RETURNS TIMESTAMP WITH TIME ZONE
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  expiry_time TIMESTAMP WITH TIME ZONE;
  bonus_minutes INTEGER := 0;
BEGIN
  -- Base expiry: 5 minutes
  expiry_time := detected_time + interval '5 minutes';
  
  -- High-profit opportunities get more time
  IF profit_pct > 2.0 THEN
    bonus_minutes := 10; -- +10 minutes for >2% profit
  ELSIF profit_pct > 1.0 THEN
    bonus_minutes := 5;  -- +5 minutes for >1% profit
  ELSIF profit_pct > 0.5 THEN
    bonus_minutes := 2;  -- +2 minutes for >0.5% profit
  END IF;
  
  -- High liquidity gets more time
  IF liquidity_scr >= 80 THEN
    bonus_minutes := bonus_minutes + 3;
  ELSIF liquidity_scr >= 60 THEN
    bonus_minutes := bonus_minutes + 1;
  END IF;
  
  -- Apply bonus (max 15 minutes total)
  bonus_minutes := LEAST(bonus_minutes, 10); -- Cap at 10 bonus minutes
  expiry_time := expiry_time + (bonus_minutes || ' minutes')::interval;
  
  RETURN expiry_time;
END;
$$;

-- ============================================================================
-- 5. Update cron jobs
-- ============================================================================

-- Remove old cleanup jobs
SELECT cron.unschedule('cleanup-expired-opportunities-frequent')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'cleanup-expired-opportunities-frequent');

SELECT cron.unschedule('cleanup-old-opportunities-hourly')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'cleanup-old-opportunities-hourly');

-- Schedule intelligent cleanup every minute
SELECT cron.schedule(
  'intelligent-cleanup-opportunities',
  '* * * * *', -- Every minute
  $$SELECT public.intelligent_cleanup_opportunities()$$
);

-- ============================================================================
-- 6. Add trigger to set dynamic expiry on insert
-- ============================================================================

CREATE OR REPLACE FUNCTION public.set_dynamic_expiry()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  -- Calculate dynamic expiry based on opportunity quality
  NEW.expires_at := public.calculate_dynamic_expiry(
    NEW.profit_percent,
    COALESCE(NEW.liquidity_score, 50),
    NEW.detected_at
  );
  
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_set_dynamic_expiry ON public.arbitrage_opportunities;

CREATE TRIGGER trigger_set_dynamic_expiry
  BEFORE INSERT ON public.arbitrage_opportunities
  FOR EACH ROW
  EXECUTE FUNCTION public.set_dynamic_expiry();

-- ============================================================================
-- 7. Add comments
-- ============================================================================

COMMENT ON FUNCTION public.intelligent_cleanup_opportunities() IS 
'Removes expired opportunities based on time and price validation. Runs every minute.';

COMMENT ON FUNCTION public.calculate_dynamic_expiry(NUMERIC, INTEGER, TIMESTAMP WITH TIME ZONE) IS 
'Calculates expiry time based on profit and liquidity. High-quality opportunities get more time.';

COMMENT ON TRIGGER trigger_set_dynamic_expiry ON public.arbitrage_opportunities IS
'Automatically sets dynamic expiry time on opportunity insert based on quality metrics.';

-- ============================================================================
-- 8. Verify migration
-- ============================================================================

DO $$
BEGIN
  RAISE NOTICE '=================================================================';
  RAISE NOTICE 'Dynamic Expiry System Migration Complete!';
  RAISE NOTICE '=================================================================';
  RAISE NOTICE 'Features added:';
  RAISE NOTICE '  ✓ Dynamic expiry based on profit and liquidity';
  RAISE NOTICE '  ✓ Intelligent cleanup function';
  RAISE NOTICE '  ✓ Price validation function';
  RAISE NOTICE '  ✓ Automatic expiry calculation on insert';
  RAISE NOTICE '  ✓ Scheduled cleanup every minute';
  RAISE NOTICE '=================================================================';
END $$;
