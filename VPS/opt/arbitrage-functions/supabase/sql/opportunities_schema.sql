-- Minimal production schema for standardized arbitrage opportunities

CREATE TABLE IF NOT EXISTS public.opportunities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  detected_at timestamptz NOT NULL DEFAULT now(),
  strategy text NOT NULL, -- 'triangular_arbitrage' | 'cross_exchange'
  path text NOT NULL,     -- e.g. 'USDT→BNB→SOL→USDT'

  exchange1 text,
  exchange2 text,
  exchange3 text,

  pair1 text,
  pair2 text,
  pair3 text,

  profit_percent numeric NOT NULL,
  liquidity_score numeric NOT NULL,
  volume_estimate numeric NOT NULL,
  estimated_slippage numeric NOT NULL DEFAULT 0,

  status text NOT NULL DEFAULT 'active'
);

-- TTL: delete opportunities older than 2 minutes
CREATE OR REPLACE FUNCTION public.cleanup_stale_opportunities()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  deleted_count integer;
BEGIN
  DELETE FROM public.opportunities
  WHERE detected_at < NOW() - INTERVAL '2 minutes';

  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.cleanup_stale_opportunities() TO service_role;

-- Recommended indexes
CREATE INDEX IF NOT EXISTS idx_opportunities_profit
  ON public.opportunities(profit_percent DESC);

CREATE INDEX IF NOT EXISTS idx_opportunities_time
  ON public.opportunities(detected_at DESC);

CREATE INDEX IF NOT EXISTS idx_opportunities_exchange1
  ON public.opportunities(exchange1);

CREATE INDEX IF NOT EXISTS idx_opportunities_exchange2
  ON public.opportunities(exchange2);

CREATE INDEX IF NOT EXISTS idx_opportunities_exchange3
  ON public.opportunities(exchange3);

-- ============================================================================
-- ROW LEVEL SECURITY (RLS) POLICIES
-- ============================================================================

-- Enable RLS on the table
ALTER TABLE public.opportunities ENABLE ROW LEVEL SECURITY;

-- Policy 1: Service role (bot/backend) can insert opportunities
CREATE POLICY IF NOT EXISTS "service_role_insert_opportunities"
ON public.opportunities
FOR INSERT
WITH CHECK (true);

-- Policy 2: Service role can select all opportunities
CREATE POLICY IF NOT EXISTS "service_role_select_opportunities"
ON public.opportunities
FOR SELECT
USING (true);

-- Policy 3: Service role can update (if needed)
CREATE POLICY IF NOT EXISTS "service_role_update_opportunities"
ON public.opportunities
FOR UPDATE
USING (true)
WITH CHECK (true);

-- Policy 4: Service role can delete (for cleanup)
CREATE POLICY IF NOT EXISTS "service_role_delete_opportunities"
ON public.opportunities
FOR DELETE
USING (true);

-- Grant table permissions to service_role
GRANT ALL ON public.opportunities TO service_role;
GRANT USAGE ON SCHEMA public TO service_role;

