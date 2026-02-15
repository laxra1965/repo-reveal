-- Fix #1: Replace public read policy on arbitrage_opportunities with user-scoped access
DROP POLICY IF EXISTS "Anyone can view all opportunities" ON public.arbitrage_opportunities;

CREATE POLICY "Users can view their own opportunities"
ON public.arbitrage_opportunities
FOR SELECT
USING (auth.uid() = user_id OR auth.role() = 'service_role');

-- Fix #2: Recreate active_arbitrage_opportunities view with security_invoker
-- This ensures the view respects RLS policies of the underlying table
DROP VIEW IF EXISTS public.active_arbitrage_opportunities;

CREATE VIEW public.active_arbitrage_opportunities
WITH (security_invoker = true) AS
SELECT id,
    user_id,
    base_symbol,
    quote_symbol,
    intermediate_symbol,
    exchange1,
    exchange2,
    exchange3,
    step1_action,
    step1_price,
    step1_amount,
    step2_action,
    step2_price,
    step2_amount,
    step3_action,
    step3_price,
    step3_amount,
    start_amount,
    end_amount,
    profit_amount,
    profit_percent,
    detected_at,
    expires_at,
    step1_volume,
    step2_volume,
    step3_volume,
    estimated_slippage,
    liquidity_score,
    type,
    signal_type,
    arb_factor,
    overpriced_leg,
    price_deviation,
    quality_score,
    is_valid,
    validation_count,
    last_validated_at,
    last_price_check
FROM public.arbitrage_opportunities
WHERE is_valid = true
  AND profit_percent > 0
  AND (last_validated_at IS NULL OR last_validated_at > now() - interval '2 minutes');