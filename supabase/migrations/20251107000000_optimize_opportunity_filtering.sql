-- Migration: Optimize Opportunity Filtering
-- Date: 2025-11-07
-- Description: Add quality_score column and optimize opportunity queries

-- Add quality_score column
ALTER TABLE public.arbitrage_opportunities 
ADD COLUMN IF NOT EXISTS quality_score INTEGER DEFAULT 0;

-- Create index on quality_score for faster sorting
CREATE INDEX IF NOT EXISTS idx_opportunities_quality_score 
ON public.arbitrage_opportunities(quality_score DESC, profit_percent DESC)
WHERE expires_at > now();

-- Update existing opportunities with default quality scores
UPDATE public.arbitrage_opportunities 
SET quality_score = CASE 
  WHEN ABS(profit_percent) >= 1.0 THEN 50
  WHEN ABS(profit_percent) >= 0.5 THEN 35
  WHEN ABS(profit_percent) >= 0.1 THEN 20
  ELSE 10
END
WHERE quality_score = 0;

-- Create function to calculate quality score
CREATE OR REPLACE FUNCTION public.calculate_opportunity_quality_score(
  profit_pct NUMERIC,
  liquidity_scr INTEGER,
  avg_volume NUMERIC
)
RETURNS INTEGER
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  score INTEGER := 0;
BEGIN
  -- Profit scoring (0-50 points)
  IF ABS(profit_pct) >= 1.0 THEN
    score := score + 50;
  ELSIF ABS(profit_pct) >= 0.5 THEN
    score := score + 35;
  ELSIF ABS(profit_pct) >= 0.1 THEN
    score := score + 20;
  END IF;
  
  -- Liquidity scoring (0-30 points)
  IF liquidity_scr >= 80 THEN
    score := score + 30;
  ELSIF liquidity_scr >= 60 THEN
    score := score + 20;
  ELSIF liquidity_scr >= 50 THEN
    score := score + 10;
  END IF;
  
  -- Volume scoring (0-20 points)
  IF avg_volume >= 1000 THEN
    score := score + 20;
  ELSIF avg_volume >= 500 THEN
    score := score + 15;
  ELSIF avg_volume >= 100 THEN
    score := score + 10;
  ELSIF avg_volume >= 50 THEN
    score := score + 5;
  END IF;
  
  RETURN score;
END;
$$;

-- Update statistics view to include quality metrics
DROP MATERIALIZED VIEW IF EXISTS public.opportunity_statistics;

CREATE MATERIALIZED VIEW public.opportunity_statistics AS
SELECT 
  exchange1,
  exchange2,
  exchange3,
  type,
  COUNT(*) as total_opportunities,
  AVG(profit_percent) as avg_profit_percent,
  MAX(profit_percent) as max_profit_percent,
  MIN(profit_percent) as min_profit_percent,
  AVG(liquidity_score) as avg_liquidity_score,
  AVG(quality_score) as avg_quality_score,
  COUNT(*) FILTER (WHERE signal_type = 'arbitrage') as arbitrage_count,
  COUNT(*) FILTER (WHERE signal_type = 'short') as short_signal_count,
  COUNT(*) FILTER (WHERE quality_score >= 50) as excellent_count,
  COUNT(*) FILTER (WHERE quality_score >= 35 AND quality_score < 50) as good_count,
  COUNT(*) FILTER (WHERE quality_score < 35) as fair_count,
  MAX(detected_at) as last_detected
FROM public.arbitrage_opportunities
WHERE expires_at > now()
GROUP BY exchange1, exchange2, exchange3, type;

-- Add comment
COMMENT ON COLUMN public.arbitrage_opportunities.quality_score IS 
'Quality score (0-100): Profit (0-50) + Liquidity (0-30) + Volume (0-20). Higher is better.';
