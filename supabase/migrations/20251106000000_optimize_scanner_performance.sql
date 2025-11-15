-- Migration: Optimize Scanner Performance
-- Date: 2025-11-06
-- Description: Fix opportunity expiry, add indexes, improve cleanup, and optimize queries

-- ============================================================================
-- 1. FIX OPPORTUNITY EXPIRY (Critical Issue)
-- ============================================================================

-- Change default expiry from 24 hours to 60 seconds for arbitrage opportunities
ALTER TABLE public.arbitrage_opportunities 
ALTER COLUMN expires_at SET DEFAULT (now() + interval '60 seconds');

-- Update existing opportunities to expire soon if they're old
UPDATE public.arbitrage_opportunities 
SET expires_at = now() + interval '60 seconds'
WHERE expires_at > now() + interval '5 minutes';

-- ============================================================================
-- 2. ADD PERFORMANCE INDEXES
-- ============================================================================

-- Composite index for active opportunity queries (most common query pattern)
CREATE INDEX IF NOT EXISTS idx_opportunities_active_profit 
ON public.arbitrage_opportunities(expires_at, profit_percent DESC, detected_at DESC)
WHERE expires_at > now();

-- Index for cleanup operations
CREATE INDEX IF NOT EXISTS idx_opportunities_cleanup 
ON public.arbitrage_opportunities(expires_at)
WHERE expires_at < now();

-- Index for signal type filtering
CREATE INDEX IF NOT EXISTS idx_opportunities_signal_type 
ON public.arbitrage_opportunities(signal_type, profit_percent DESC)
WHERE expires_at > now();

-- Partial index for high-profit opportunities (> 0.5%)
CREATE INDEX IF NOT EXISTS idx_opportunities_high_profit 
ON public.arbitrage_opportunities(profit_percent DESC, liquidity_score DESC)
WHERE profit_percent > 0.5 AND expires_at > now();

-- Index for exchange-specific queries
CREATE INDEX IF NOT EXISTS idx_opportunities_exchanges 
ON public.arbitrage_opportunities(exchange1, exchange2, exchange3, expires_at DESC)
WHERE expires_at > now();

-- Covering index for opportunity list display
CREATE INDEX IF NOT EXISTS idx_opportunities_display 
ON public.arbitrage_opportunities(
  expires_at, 
  profit_percent, 
  base_symbol, 
  quote_symbol, 
  intermediate_symbol
)
WHERE expires_at > now();

-- ============================================================================
-- 3. IMPROVE CLEANUP FUNCTIONS
-- ============================================================================

-- Drop old cleanup function
DROP FUNCTION IF EXISTS public.cleanup_expired_opportunities();
DROP FUNCTION IF EXISTS public.cleanup_old_opportunities();

-- Create optimized cleanup function for expired opportunities
CREATE OR REPLACE FUNCTION public.cleanup_expired_opportunities()
RETURNS TABLE(deleted_count INTEGER, execution_time_ms INTEGER) 
LANGUAGE plpgsql
SECURITY DEFINER 
SET search_path = ''
AS $$
DECLARE
  start_time TIMESTAMP;
  end_time TIMESTAMP;
  rows_deleted INTEGER;
BEGIN
  start_time := clock_timestamp();
  
  -- Delete expired opportunities (older than expiry time)
  DELETE FROM public.arbitrage_opportunities 
  WHERE expires_at < now();
  
  GET DIAGNOSTICS rows_deleted = ROW_COUNT;
  
  end_time := clock_timestamp();
  
  RETURN QUERY SELECT 
    rows_deleted,
    EXTRACT(MILLISECONDS FROM (end_time - start_time))::INTEGER;
END;
$$;

-- Create aggressive cleanup function for old opportunities (safety net)
CREATE OR REPLACE FUNCTION public.cleanup_old_opportunities()
RETURNS TABLE(deleted_count INTEGER, execution_time_ms INTEGER)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  start_time TIMESTAMP;
  end_time TIMESTAMP;
  rows_deleted INTEGER;
BEGIN
  start_time := clock_timestamp();
  
  -- Delete opportunities older than 1 hour (safety cleanup)
  DELETE FROM public.arbitrage_opportunities 
  WHERE detected_at < now() - interval '1 hour';
  
  GET DIAGNOSTICS rows_deleted = ROW_COUNT;
  
  end_time := clock_timestamp();
  
  RETURN QUERY SELECT 
    rows_deleted,
    EXTRACT(MILLISECONDS FROM (end_time - start_time))::INTEGER;
END;
$$;

-- Create function to get active opportunities count
CREATE OR REPLACE FUNCTION public.get_active_opportunities_count()
RETURNS INTEGER
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT COUNT(*)::INTEGER 
  FROM public.arbitrage_opportunities 
  WHERE expires_at > now();
$$;

-- ============================================================================
-- 4. ADD OPPORTUNITY STATISTICS VIEW
-- ============================================================================

-- Create materialized view for opportunity statistics
CREATE MATERIALIZED VIEW IF NOT EXISTS public.opportunity_statistics AS
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
  COUNT(*) FILTER (WHERE signal_type = 'arbitrage') as arbitrage_count,
  COUNT(*) FILTER (WHERE signal_type = 'short') as short_signal_count,
  MAX(detected_at) as last_detected
FROM public.arbitrage_opportunities
WHERE expires_at > now()
GROUP BY exchange1, exchange2, exchange3, type;

-- Create index on materialized view
CREATE INDEX IF NOT EXISTS idx_opportunity_stats_exchanges 
ON public.opportunity_statistics(exchange1, exchange2, exchange3);

-- Create function to refresh statistics
CREATE OR REPLACE FUNCTION public.refresh_opportunity_statistics()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  REFRESH MATERIALIZED VIEW CONCURRENTLY public.opportunity_statistics;
$$;

-- ============================================================================
-- 5. ADD SCANNER LOGS RETENTION POLICY
-- ============================================================================

-- Add retention policy for scanner logs (keep only 7 days)
CREATE OR REPLACE FUNCTION public.cleanup_old_scanner_logs()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  DELETE FROM public.scanner_logs 
  WHERE created_at < now() - interval '7 days';
  
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$;

-- ============================================================================
-- 6. ADD TRADE HISTORY INDEXES
-- ============================================================================

-- Index for recent trades
CREATE INDEX IF NOT EXISTS idx_trade_history_recent 
ON public.trade_history(user_id, started_at DESC)
WHERE started_at > now() - interval '30 days';

-- Index for P&L calculations
CREATE INDEX IF NOT EXISTS idx_trade_history_profit 
ON public.trade_history(user_id, actual_profit, completed_at)
WHERE status = 'completed' AND actual_profit IS NOT NULL;

-- ============================================================================
-- 7. UPDATE CRON JOBS
-- ============================================================================

-- Remove old scheduled job if it exists
SELECT cron.unschedule('auto-arbitrage-scanner') 
WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'auto-arbitrage-scanner'
);

-- Remove old cleanup job if it exists
SELECT cron.unschedule('cleanup-expired-opportunities') 
WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'cleanup-expired-opportunities'
);

-- Schedule frequent cleanup every minute (critical for 60-second expiry)
SELECT cron.schedule(
  'cleanup-expired-opportunities-frequent',
  '* * * * *', -- Every minute
  $$SELECT public.cleanup_expired_opportunities()$$
);

-- Schedule safety cleanup every hour
SELECT cron.schedule(
  'cleanup-old-opportunities-hourly',
  '0 * * * *', -- Every hour
  $$SELECT public.cleanup_old_opportunities()$$
);

-- Schedule scanner logs cleanup daily at 2 AM
SELECT cron.schedule(
  'cleanup-scanner-logs-daily',
  '0 2 * * *', -- 2 AM daily
  $$SELECT public.cleanup_old_scanner_logs()$$
);

-- Schedule statistics refresh every 5 minutes
SELECT cron.schedule(
  'refresh-opportunity-stats',
  '*/5 * * * *', -- Every 5 minutes
  $$SELECT public.refresh_opportunity_statistics()$$
);

-- ============================================================================
-- 8. ADD TABLE PARTITIONING FOR ARBITRAGE_OPPORTUNITIES (Optional)
-- ============================================================================

-- Note: Uncomment this section if you have very high volume (>1M rows/day)
-- This creates daily partitions for better performance

/*
-- Create partitioned table
CREATE TABLE public.arbitrage_opportunities_partitioned (
  LIKE public.arbitrage_opportunities INCLUDING ALL
) PARTITION BY RANGE (detected_at);

-- Create partitions for current month
DO $$
DECLARE
  start_date DATE := date_trunc('month', CURRENT_DATE);
  end_date DATE := date_trunc('month', CURRENT_DATE + interval '1 month');
  partition_date DATE;
BEGIN
  partition_date := start_date;
  WHILE partition_date < end_date LOOP
    EXECUTE format(
      'CREATE TABLE IF NOT EXISTS public.arbitrage_opportunities_y%s_m%s_d%s 
       PARTITION OF public.arbitrage_opportunities_partitioned 
       FOR VALUES FROM (%L) TO (%L)',
      EXTRACT(YEAR FROM partition_date),
      LPAD(EXTRACT(MONTH FROM partition_date)::TEXT, 2, '0'),
      LPAD(EXTRACT(DAY FROM partition_date)::TEXT, 2, '0'),
      partition_date,
      partition_date + interval '1 day'
    );
    partition_date := partition_date + interval '1 day';
  END LOOP;
END $$;
*/

-- ============================================================================
-- 9. ADD MONITORING VIEWS
-- ============================================================================

-- Create view for system health monitoring
CREATE OR REPLACE VIEW public.scanner_health_metrics AS
SELECT 
  (SELECT COUNT(*) FROM public.arbitrage_opportunities WHERE expires_at > now()) as active_opportunities,
  (SELECT COUNT(*) FROM public.arbitrage_opportunities WHERE expires_at < now()) as expired_opportunities,
  (SELECT COUNT(*) FROM public.user_settings WHERE auto_trade = true) as auto_trade_users,
  (SELECT COUNT(*) FROM public.scanner_logs WHERE created_at > now() - interval '1 hour') as logs_last_hour,
  (SELECT COUNT(*) FROM public.trade_history WHERE status = 'executing') as trades_in_progress,
  (SELECT MAX(detected_at) FROM public.arbitrage_opportunities) as last_opportunity_detected,
  (SELECT pg_size_pretty(pg_total_relation_size('public.arbitrage_opportunities'))) as opportunities_table_size,
  (SELECT pg_size_pretty(pg_database_size(current_database()))) as total_database_size;

-- Grant access to monitoring view
GRANT SELECT ON public.scanner_health_metrics TO authenticated;

-- ============================================================================
-- 10. ADD COMMENTS FOR DOCUMENTATION
-- ============================================================================

COMMENT ON TABLE public.arbitrage_opportunities IS 
'Stores detected arbitrage opportunities with 60-second expiry. Automatically cleaned up every minute.';

COMMENT ON COLUMN public.arbitrage_opportunities.expires_at IS 
'Opportunity expires 60 seconds after detection. Cleanup runs every minute.';

COMMENT ON FUNCTION public.cleanup_expired_opportunities() IS 
'Removes expired opportunities. Runs every minute via cron. Returns deleted count and execution time.';

COMMENT ON FUNCTION public.cleanup_old_opportunities() IS 
'Safety cleanup for opportunities older than 1 hour. Runs hourly via cron.';

COMMENT ON MATERIALIZED VIEW public.opportunity_statistics IS 
'Aggregated statistics on active opportunities. Refreshed every 5 minutes.';

-- ============================================================================
-- 11. VERIFY MIGRATION SUCCESS
-- ============================================================================

-- Output migration results
DO $$
BEGIN
  RAISE NOTICE '=================================================================';
  RAISE NOTICE 'Migration completed successfully!';
  RAISE NOTICE '=================================================================';
  RAISE NOTICE 'Changes applied:';
  RAISE NOTICE '  ✓ Opportunity expiry changed from 24 hours to 60 seconds';
  RAISE NOTICE '  ✓ Added % performance indexes', (SELECT COUNT(*) FROM pg_indexes WHERE tablename = 'arbitrage_opportunities' AND indexname LIKE 'idx_opportunities_%');
  RAISE NOTICE '  ✓ Created optimized cleanup functions';
  RAISE NOTICE '  ✓ Scheduled automatic cleanup jobs (every minute)';
  RAISE NOTICE '  ✓ Created opportunity statistics view';
  RAISE NOTICE '  ✓ Added health monitoring views';
  RAISE NOTICE '=================================================================';
  RAISE NOTICE 'Active opportunities: %', (SELECT COUNT(*) FROM public.arbitrage_opportunities WHERE expires_at > now());
  RAISE NOTICE 'Expired opportunities to clean: %', (SELECT COUNT(*) FROM public.arbitrage_opportunities WHERE expires_at < now());
  RAISE NOTICE '=================================================================';
END $$;
