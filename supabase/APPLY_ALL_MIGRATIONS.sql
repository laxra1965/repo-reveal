-- ============================================
-- COMBINED MIGRATION SCRIPT
-- Apply all new migrations in one go
-- Date: 2025-12-06
-- ============================================

-- ============================================
-- MIGRATION 1: Add Encryption Support
-- File: 20251206000000_add_encryption_to_credentials.sql
-- ============================================

-- Add new encrypted columns
ALTER TABLE public.exchange_credentials
ADD COLUMN IF NOT EXISTS encrypted_api_key TEXT,
ADD COLUMN IF NOT EXISTS encrypted_api_secret TEXT,
ADD COLUMN IF NOT EXISTS encryption_version INTEGER DEFAULT 1,
ADD COLUMN IF NOT EXISTS migration_status TEXT DEFAULT 'pending';

-- Create index for migration status tracking
CREATE INDEX IF NOT EXISTS idx_credentials_migration_status 
ON public.exchange_credentials(migration_status) 
WHERE migration_status != 'completed';

-- Function to check if credentials are encrypted
CREATE OR REPLACE FUNCTION public.is_credentials_encrypted(credential_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.exchange_credentials
    WHERE id = credential_id
    AND encrypted_api_key IS NOT NULL
    AND encrypted_api_secret IS NOT NULL
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Add comments
COMMENT ON COLUMN public.exchange_credentials.encrypted_api_key IS 
'AES-256-GCM encrypted API key. Use encrypt-api-keys edge function to encrypt/decrypt.';

COMMENT ON COLUMN public.exchange_credentials.encrypted_api_secret IS 
'AES-256-GCM encrypted API secret. Use encrypt-api-keys edge function to encrypt/decrypt.';

-- ============================================
-- MIGRATION 2: API Cache Table
-- File: 20251206100000_add_api_cache_table.sql
-- ============================================

CREATE TABLE IF NOT EXISTS public.api_cache (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cache_key VARCHAR(255) NOT NULL UNIQUE,
  cache_data JSONB NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  hit_count INTEGER DEFAULT 0,
  last_accessed_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_api_cache_key ON public.api_cache(cache_key);
CREATE INDEX IF NOT EXISTS idx_api_cache_expires ON public.api_cache(expires_at);

-- Cache helper functions
CREATE OR REPLACE FUNCTION public.get_cached(key VARCHAR(255))
RETURNS JSONB AS $$
DECLARE
  result JSONB;
BEGIN
  UPDATE public.api_cache
  SET hit_count = hit_count + 1, last_accessed_at = now()
  WHERE cache_key = key AND expires_at > now()
  RETURNING cache_data INTO result;
  RETURN result;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION public.set_cache(key VARCHAR(255), data JSONB, ttl_seconds INTEGER)
RETURNS VOID AS $$
BEGIN
  INSERT INTO public.api_cache (cache_key, cache_data, expires_at)
  VALUES (key, data, now() + (ttl_seconds || ' seconds')::INTERVAL)
  ON CONFLICT (cache_key) DO UPDATE SET
    cache_data = EXCLUDED.cache_data,
    expires_at = EXCLUDED.expires_at,
    created_at = now();
END;
$$ LANGUAGE plpgsql;

-- Enable RLS
ALTER TABLE public.api_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role has full access to cache" ON public.api_cache
FOR ALL TO service_role USING (true);

CREATE POLICY "Authenticated users can read cache" ON public.api_cache
FOR SELECT TO authenticated USING (true);

-- ============================================
-- MIGRATION 3: Query Optimizations
-- File: 20251206110000_optimize_queries.sql
-- ============================================

-- Composite indexes
CREATE INDEX IF NOT EXISTS idx_arbitrage_opp_user_detected 
ON public.arbitrage_opportunities(user_id, detected_at DESC);

CREATE INDEX IF NOT EXISTS idx_trade_history_user_status 
ON public.trade_history(user_id, status, created_at DESC);

-- Materialized view for trade statistics
CREATE MATERIALIZED VIEW IF NOT EXISTS public.user_trade_statistics AS
SELECT 
  user_id,
  COUNT(*) as total_trades,
  COUNT(*) FILTER (WHERE status = 'completed') as completed_trades,
  COUNT(*) FILTER (WHERE status = 'failed') as failed_trades,
  AVG(actual_profit) FILTER (WHERE status = 'completed') as avg_profit,
  SUM(actual_profit) FILTER (WHERE status = 'completed') as total_profit,
  ROUND((COUNT(*) FILTER (WHERE status = 'completed')::DECIMAL / NULLIF(COUNT(*), 0)) * 100, 2) as success_rate
FROM public.trade_history
GROUP BY user_id;

CREATE UNIQUE INDEX IF NOT EXISTS idx_user_trade_stats_user
ON public.user_trade_statistics(user_id);

-- ============================================
-- MIGRATION 4: Trade Recovery
-- File: 20251206120000_add_trade_recovery_table.sql
-- ============================================

CREATE TABLE IF NOT EXISTS public.trade_recovery_state (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trade_id UUID NOT NULL REFERENCES public.trade_history(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  current_step INTEGER NOT NULL DEFAULT 0,
  recovery_attempts INTEGER DEFAULT 0,
  recovery_status VARCHAR(50) DEFAULT 'pending',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  UNIQUE(trade_id)
);

CREATE INDEX IF NOT EXISTS idx_trade_recovery_user 
ON public.trade_recovery_state(user_id, recovery_status);

ALTER TABLE public.trade_recovery_state ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own recovery states" ON public.trade_recovery_state
FOR SELECT TO authenticated USING (auth.uid() = user_id);

-- ============================================
-- MIGRATION 5: ML Tables
-- File: 20251206130000_create_ml_tables.sql
-- ============================================

CREATE TABLE IF NOT EXISTS public.ml_features (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  opportunity_id UUID REFERENCES public.arbitrage_opportunities(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  profit_percent DECIMAL(8,4) NOT NULL,
  was_successful BOOLEAN,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.ml_models (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  model_name VARCHAR(100) NOT NULL,
  model_version VARCHAR(50) NOT NULL,
  is_active BOOLEAN DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  UNIQUE(model_name, model_version)
);

CREATE TABLE IF NOT EXISTS public.ml_predictions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  model_id UUID REFERENCES public.ml_models(id),
  opportunity_id UUID REFERENCES public.arbitrage_opportunities(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  predicted_success_probability DECIMAL(5,4) NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.ml_features ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ml_models ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ml_predictions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own ML features" ON public.ml_features
FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE POLICY "Users can view ML models" ON public.ml_models
FOR SELECT TO authenticated USING (true);

CREATE POLICY "Users can view own predictions" ON public.ml_predictions
FOR SELECT TO authenticated USING (auth.uid() = user_id);

-- ============================================
-- POST-MIGRATION: Set Admin USDT Address
-- ============================================
-- IMPORTANT: Replace 'TYourActualUSDTAddressHere' with your real USDT TRC20 address

INSERT INTO public.admin_settings (key, value) 
VALUES ('usdt_address', 'TYourActualUSDTAddressHere')
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;

-- ============================================
-- VERIFICATION QUERIES
-- Run these to verify migrations succeeded
-- ============================================

-- Check new columns in exchange_credentials
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'exchange_credentials' 
  AND column_name IN ('encrypted_api_key', 'encrypted_api_secret', 'encryption_version');

-- Check new tables
SELECT table_name 
FROM information_schema.tables 
WHERE table_schema = 'public' 
  AND table_name IN ('api_cache', 'trade_recovery_state', 'ml_features', 'ml_models', 'ml_predictions');

-- Check materialized view
SELECT matviewname FROM pg_matviews WHERE matviewname = 'user_trade_statistics';

-- Check admin settings
SELECT * FROM public.admin_settings WHERE key = 'usdt_address';

-- ============================================
-- SUCCESS MESSAGE
-- ============================================
SELECT 'All migrations completed successfully! ✅' AS status;
