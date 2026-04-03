
-- Create a trigger function that enforces opportunity_filters before insert
CREATE OR REPLACE FUNCTION public.enforce_opportunity_filters()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  f RECORD;
BEGIN
  FOR f IN
    SELECT * FROM public.opportunity_filters WHERE is_active = true
  LOOP
    -- Check allowed_strategies
    IF f.allowed_strategies IS NOT NULL AND array_length(f.allowed_strategies, 1) > 0 THEN
      IF NOT (NEW.strategy = ANY(f.allowed_strategies)) THEN
        RAISE NOTICE '[FilterTrigger] Blocked strategy "%" (allowed: %)', NEW.strategy, f.allowed_strategies;
        RETURN NULL; -- silently reject
      END IF;
    END IF;

    -- Check min_profit_percent
    IF f.min_profit_percent IS NOT NULL AND NEW.profit_percent < f.min_profit_percent THEN
      RETURN NULL;
    END IF;

    -- Check max_profit_percent
    IF f.max_profit_percent IS NOT NULL AND NEW.profit_percent > f.max_profit_percent THEN
      RETURN NULL;
    END IF;

    -- Check min_volume_estimate
    IF f.min_volume_estimate IS NOT NULL AND NEW.volume_estimate < f.min_volume_estimate THEN
      RETURN NULL;
    END IF;

    -- Check max_estimated_slippage
    IF f.max_estimated_slippage IS NOT NULL AND NEW.estimated_slippage > f.max_estimated_slippage THEN
      RETURN NULL;
    END IF;

    -- Check min_liquidity_score
    IF f.min_liquidity_score IS NOT NULL AND NEW.liquidity_score < f.min_liquidity_score THEN
      RETURN NULL;
    END IF;
  END LOOP;

  RETURN NEW;
END;
$$;

-- Attach the trigger to the opportunities table
CREATE TRIGGER check_opportunity_filters
  BEFORE INSERT ON public.opportunities
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_opportunity_filters();

-- Also clean up existing cross_exchange records that shouldn't be there
DELETE FROM public.opportunities WHERE strategy = 'cross_exchange';
