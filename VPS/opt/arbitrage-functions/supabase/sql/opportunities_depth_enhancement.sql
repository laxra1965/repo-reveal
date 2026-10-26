-- ============================================================================
-- OPTIONAL: Depth & Slippage Enhancement Schema
-- Add these columns to capture real-time depth metrics and slippage predictions
-- Safely adds columns with IF NOT EXISTS checks
-- ============================================================================

-- Add depth and slippage metrics columns (only if they don't already exist)
DO $$
BEGIN
  -- Check and add each column individually to avoid conflicts
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='opportunities' AND column_name='liquidity_index') THEN
    ALTER TABLE public.opportunities ADD COLUMN liquidity_index numeric DEFAULT 0;
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='opportunities' AND column_name='spread_bps') THEN
    ALTER TABLE public.opportunities ADD COLUMN spread_bps integer DEFAULT 0;
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='opportunities' AND column_name='depth_levels_bid') THEN
    ALTER TABLE public.opportunities ADD COLUMN depth_levels_bid integer DEFAULT 0;
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='opportunities' AND column_name='depth_levels_ask') THEN
    ALTER TABLE public.opportunities ADD COLUMN depth_levels_ask integer DEFAULT 0;
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='opportunities' AND column_name='slippage_prediction') THEN
    ALTER TABLE public.opportunities ADD COLUMN slippage_prediction jsonb;
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='opportunities' AND column_name='slippage_confidence') THEN
    ALTER TABLE public.opportunities ADD COLUMN slippage_confidence numeric DEFAULT 0;
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='opportunities' AND column_name='slippage_recommendation') THEN
    ALTER TABLE public.opportunities ADD COLUMN slippage_recommendation text;
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='opportunities' AND column_name='estimated_impact_pct') THEN
    ALTER TABLE public.opportunities ADD COLUMN estimated_impact_pct numeric DEFAULT 0;
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='opportunities' AND column_name='bid_ask_imbalance') THEN
    ALTER TABLE public.opportunities ADD COLUMN bid_ask_imbalance numeric DEFAULT 0;
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='opportunities' AND column_name='volatility_5m') THEN
    ALTER TABLE public.opportunities ADD COLUMN volatility_5m numeric DEFAULT 0;
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='opportunities' AND column_name='trade_volume_20_levels') THEN
    ALTER TABLE public.opportunities ADD COLUMN trade_volume_20_levels numeric DEFAULT 0;
  END IF;
END $$;

-- Index on new filtering columns for performance
DO $$
BEGIN
  -- Create indexes only if they don't already exist
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_opportunities_liquidity_index') THEN
    CREATE INDEX idx_opportunities_liquidity_index
      ON public.opportunities(liquidity_index DESC)
      WHERE status = 'active';
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_opportunities_slippage_confidence') THEN
    CREATE INDEX idx_opportunities_slippage_confidence
      ON public.opportunities(slippage_confidence DESC)
      WHERE status = 'active';
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_opportunities_slippage_recommendation') THEN
    CREATE INDEX idx_opportunities_slippage_recommendation
      ON public.opportunities(slippage_recommendation)
      WHERE status = 'active';
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_opportunities_spread_bps') THEN
    CREATE INDEX idx_opportunities_spread_bps
      ON public.opportunities(spread_bps ASC)
      WHERE status = 'active';
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_opportunities_quality') THEN
    CREATE INDEX idx_opportunities_quality
      ON public.opportunities(liquidity_index DESC, slippage_confidence DESC, profit_percent DESC)
      WHERE status = 'active' AND slippage_recommendation = 'EXECUTE';
  END IF;
END $$;

-- ============================================================================
-- OPTIONAL: Trade History Table (for volatility tracking)
-- Stores executed trades to improve slippage prediction accuracy over time
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.trade_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  executed_at timestamptz NOT NULL DEFAULT now(),
  
  pair text NOT NULL,              -- e.g. 'BTCUSDT'
  exchange text NOT NULL,
  price numeric NOT NULL,
  size numeric NOT NULL,
  side text NOT NULL,              -- 'BUY' | 'SELL'
  
  -- Link to opportunity that triggered this trade (optional)
  opportunity_id uuid REFERENCES public.opportunities(id) ON DELETE SET NULL,
  
  -- Execution quality
  actual_slippage numeric,         -- actual vs. predicted
  fees numeric DEFAULT 0,
  net_profit numeric
);

-- Indexes for trade history
CREATE INDEX IF NOT EXISTS idx_trade_history_pair
  ON public.trade_history(pair, executed_at DESC);

CREATE INDEX IF NOT EXISTS idx_trade_history_executed_at
  ON public.trade_history(executed_at DESC);

CREATE INDEX IF NOT EXISTS idx_trade_history_opportunity
  ON public.trade_history(opportunity_id);

-- Grant access to service_role
GRANT ALL ON public.trade_history TO service_role;

-- ============================================================================
-- OPTIONAL: View for High-Quality Opportunities
-- Combines depth metrics with profitability for easy filtering on frontend
-- ============================================================================

CREATE OR REPLACE VIEW public.high_quality_opportunities AS
SELECT
  id,
  detected_at,
  strategy,
  path,
  exchange1,
  exchange2,
  exchange3,
  pair1,
  pair2,
  pair3,
  profit_percent,
  liquidity_index,
  slippage_confidence,
  slippage_recommendation,
  spread_bps,
  estimated_impact_pct,
  
  -- Composite score: (profit * liquidity * confidence) - (slippage impact)
  (
    (COALESCE(profit_percent, 0) / 100.0) *
    COALESCE(liquidity_index, 0) *
    COALESCE(slippage_confidence, 0) -
    (COALESCE(estimated_impact_pct, 0) / 100.0)
  ) AS quality_score,
  
  status,
  EXTRACT(EPOCH FROM (now() - detected_at)) AS age_seconds
FROM public.opportunities
WHERE status = 'active'
  AND slippage_recommendation = 'EXECUTE'
  AND liquidity_index > 0.5
  AND slippage_confidence > 0.6
ORDER BY
  (
    (COALESCE(profit_percent, 0) / 100.0) *
    COALESCE(liquidity_index, 0) *
    COALESCE(slippage_confidence, 0) -
    (COALESCE(estimated_impact_pct, 0) / 100.0)
  ) DESC;

-- Grant view access
GRANT SELECT ON public.high_quality_opportunities TO service_role;

-- ============================================================================
-- REFERENCE: Column Documentation
-- ============================================================================
/*
DEPTH METRICS:
  - liquidity_index (0-1): How good is the liquidity? 
    Combines spread, depth, and volume. Higher = better.
  
  - spread_bps: Bid-ask spread in basis points (0.01% increments)
    Example: 2.5 bps = 0.025% spread
  
  - depth_levels_bid/ask: How many order book levels needed to move price 1%?
    Higher = deeper book = better liquidity

SLIPPAGE PREDICTION:
  - slippage_prediction (JSONB): 
    {
      "total_slippage_bps": 15,
      "total_slippage_pct": 0.15,
      "leg1": { "slippage_bps": 5, "confidence": 0.89 },
      "leg2": { "slippage_bps": 6, "confidence": 0.88 },
      "leg3": { "slippage_bps": 4, "confidence": 0.85 },
      "recommendation": "EXECUTE"
    }
  
  - slippage_confidence (0-1): How confident is prediction?
    Based on order book freshness, depth, and historical volatility
  
  - slippage_recommendation: Trading action recommendation
    EXECUTE = good to trade
    WARN = proceed with caution
    AVOID = don't trade

EXECUTION QUALITY:
  - estimated_impact_pct: Expected price movement from your order
    Calculated from order book depth vs trade size
  
  - bid_ask_imbalance (-1 to 1): Market pressure indicator
    -1 = all sellers (pressure to buy)
     0 = balanced
     1 = all buyers (pressure to sell)

VOLATILITY:
  - volatility_5m: Recent price volatility
    Higher = more uncertainty = higher slippage risk
  
  - trade_volume_20_levels: Total volume in top 20 order book levels
    Higher = more liquidity = lower slippage
*/
