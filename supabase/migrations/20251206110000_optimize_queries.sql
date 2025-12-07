-- Migration: Query optimizations
-- Date: 2025-12-06
-- Description: Add indexes and materialized views for better performance

-- Composite indexes for frequently queried columns
CREATE INDEX IF NOT EXISTS idx_arbitrage_opp_user_detected 
ON public.arbitrage_opportunities(user_id, detected_at DESC);

CREATE INDEX IF NOT EXISTS idx_arbitrage_opp_profit 
ON public.arbitrage_opportunities(profit_percent DESC) 
WHERE expires_at > now();

CREATE INDEX IF NOT EXISTS idx_trade_history_user_status 
ON public.trade_history(user_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_trade_history_completed 
ON public.trade_history(user_id, completed_at DESC) 
WHERE status = 'completed';

-- Partial index for active trades
CREATE INDEX IF NOT EXISTS idx_trade_history_active 
ON public.trade_history(user_id, status, started_at DESC)
WHERE status IN ('pending', 'executing');

-- Index for scanner logs by type and recency
CREATE INDEX IF NOT EXISTS idx_scanner_logs_type_recent 
ON public.scanner_logs(user_id, log_type, created_at DESC);

-- Materialized view for user dashboard statistics
CREATE MATERIALIZED VIEW IF NOT EXISTS public.user_trade_statistics AS
SELECT 
  user_id,
  COUNT(*) as total_trades,
  COUNT(*) FILTER (WHERE status = 'completed') as completed_trades,
  COUNT(*) FILTER (WHERE status = 'failed') as failed_trades,
  COUNT(*) FILTER (WHERE status IN ('pending', 'executing')) as active_trades,
  AVG(actual_profit) FILTER (WHERE status = 'completed') as avg_profit,
  SUM(actual_profit) FILTER (WHERE status = 'completed') as total_profit,
  MAX(actual_profit) FILTER (WHERE status = 'completed') as best_profit,
  MIN(actual_profit) FILTER (WHERE status = 'completed') as worst_profit,
  ROUND(
    (COUNT(*) FILTER (WHERE status = 'completed')::DECIMAL / NULLIF(COUNT(*), 0)) * 100,
    2
  ) as success_rate,
  MAX(completed_at) FILTER (WHERE status = 'completed') as last_trade_at
FROM public.trade_history
GROUP BY user_id;

-- Create unique index for concurrent refresh
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_trade_stats_user
ON public.user_trade_statistics(user_id);

-- Function to refresh materialized view
CREATE OR REPLACE FUNCTION public.refresh_trade_statistics()
RETURNS VOID AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY public.user_trade_statistics;
END;
$$ LANGUAGE plpgsql;

-- Materialized view for opportunity statistics
CREATE MATERIALIZED VIEW IF NOT EXISTS public.opportunity_statistics AS
SELECT 
  date_trunc('hour', detected_at) as hour,
  COUNT(*) as total_opportunities,
  AVG(profit_percent) as avg_profit_percent,
  MAX(profit_percent) as max_profit_percent,
  COUNT(DISTINCT base_symbol) as unique_base_symbols,
  COUNT(DISTINCT intermediate_symbol) as unique_intermediate_symbols,
  exchange1 as exchange
FROM public.arbitrage_opportunities
WHERE detected_at > now() - INTERVAL '7 days'
GROUP BY date_trunc('hour', detected_at), exchange1;

-- Create index for opportunity statistics
CREATE INDEX IF NOT EXISTS idx_opp_stats_hour
ON public.opportunity_statistics(hour DESC);

-- Function to refresh opportunity statistics
CREATE OR REPLACE FUNCTION public.refresh_opportunity_statistics()
RETURNS VOID AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY public.opportunity_statistics;
END;
$$ LANGUAGE plpgsql;

-- Enable RLS on materialized views
ALTER MATERIALIZED VIEW public.user_trade_statistics OWNER TO postgres;
ALTER MATERIALIZED VIEW public.opportunity_statistics OWNER TO postgres;

-- Grant access to authenticated users
GRANT SELECT ON public.user_trade_statistics TO authenticated;
GRANT SELECT ON public.opportunity_statistics TO authenticated;

-- Schedule automatic refresh (every 5 minutes)
-- Note: This requires pg_cron extension
-- SELECT cron.schedule('refresh-trade-stats', '*/5 * * * *', 'SELECT public.refresh_trade_statistics()');
-- SELECT cron.schedule('refresh-opp-stats', '*/5 * * * *', 'SELECT public.refresh_opportunity_statistics()');

COMMENT ON MATERIALIZED VIEW public.user_trade_statistics IS 
'Aggregated trade statistics per user for dashboard display';

COMMENT ON MATERIALIZED VIEW public.opportunity_statistics IS 
'Aggregated opportunity statistics for analytics and ML training';
