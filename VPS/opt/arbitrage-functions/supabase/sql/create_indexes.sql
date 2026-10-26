-- Performance Indexes for Arbitrage Opportunities
-- Run this after creating the opportunities table

-- Index for filtering by strategy
CREATE INDEX IF NOT EXISTS idx_opportunities_strategy 
  ON public.opportunities(strategy);

-- Index for filtering by status
CREATE INDEX IF NOT EXISTS idx_opportunities_status 
  ON public.opportunities(status);

-- Composite index for strategy + status queries (common filter combination)
CREATE INDEX IF NOT EXISTS idx_opportunities_strategy_status 
  ON public.opportunities(strategy, status);

-- Index for sorting by detected_at (most common sort)
CREATE INDEX IF NOT EXISTS idx_opportunities_detected_at 
  ON public.opportunities(detected_at DESC);

-- Index for sorting by profit_percent
CREATE INDEX IF NOT EXISTS idx_opportunities_profit 
  ON public.opportunities(profit_percent DESC);

-- Composite index for profit filtering + sorting
CREATE INDEX IF NOT EXISTS idx_opportunities_profit_status 
  ON public.opportunities(profit_percent DESC, status);

-- Index for time-range queries (e.g., last N opportunities)
CREATE INDEX IF NOT EXISTS idx_opportunities_detected_status 
  ON public.opportunities(detected_at DESC, status);

-- Index for opportunity duplication detection
CREATE INDEX IF NOT EXISTS idx_opportunities_path_exchanges 
  ON public.opportunities(path, exchange1, exchange2, exchange3);

-- Full table scan optimization for exports
CREATE INDEX IF NOT EXISTS idx_opportunities_detected_id 
  ON public.opportunities(detected_at DESC, id);

-- STATS QUERIES (optional, for monitoring)
-- SELECT schemaname, tablename, indexname, idx_scan, idx_tup_read, idx_tup_fetch
-- FROM pg_stat_user_indexes
-- WHERE tablename = 'opportunities'
-- ORDER BY idx_scan DESC;
