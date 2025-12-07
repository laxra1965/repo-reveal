-- Migration: API cache table
-- Date: 2025-12-06
-- Description: Create table for caching API responses

CREATE TABLE IF NOT EXISTS public.api_cache (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cache_key VARCHAR(255) NOT NULL UNIQUE,
  cache_data JSONB NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  hit_count INTEGER DEFAULT 0,
  last_accessed_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Index for cache key lookups
CREATE INDEX IF NOT EXISTS idx_api_cache_key ON public.api_cache(cache_key);

-- Index for expiration cleanup
CREATE INDEX IF NOT EXISTS idx_api_cache_expires ON public.api_cache(expires_at);

-- Index for access patterns
CREATE INDEX IF NOT EXISTS idx_api_cache_accessed ON public.api_cache(last_accessed_at);

-- Function to clean up expired cache entries
CREATE OR REPLACE FUNCTION public.cleanup_expired_cache()
RETURNS INTEGER AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  DELETE FROM public.api_cache 
  WHERE expires_at < now();
  
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

-- Function to get cached data
CREATE OR REPLACE FUNCTION public.get_cached(key VARCHAR(255))
RETURNS JSONB AS $$
DECLARE
  result JSONB;
BEGIN
  -- Get cache entry and update access stats
  UPDATE public.api_cache
  SET 
    hit_count = hit_count + 1,
    last_accessed_at = now()
  WHERE cache_key = key
    AND expires_at > now()
  RETURNING cache_data INTO result;
  
  RETURN result;
END;
$$ LANGUAGE plpgsql;

-- Function to set cache entry
CREATE OR REPLACE FUNCTION public.set_cache(
  key VARCHAR(255),
  data JSONB,
  ttl_seconds INTEGER
)
RETURNS VOID AS $$
BEGIN
  INSERT INTO public.api_cache (cache_key, cache_data, expires_at)
  VALUES (key, data, now() + (ttl_seconds || ' seconds')::INTERVAL)
  ON CONFLICT (cache_key) 
  DO UPDATE SET
    cache_data = EXCLUDED.cache_data,
    expires_at = EXCLUDED.expires_at,
    created_at = now(),
    hit_count = 0,
    last_accessed_at = now();
END;
$$ LANGUAGE plpgsql;

-- Enable RLS
ALTER TABLE public.api_cache ENABLE ROW LEVEL SECURITY;

-- Policy: Service role can do anything
CREATE POLICY "Service role has full access to cache"
ON public.api_cache
FOR ALL
TO service_role
USING (true);

-- Policy: Authenticated users can read cache
CREATE POLICY "Authenticated users can read cache"
ON public.api_cache
FOR SELECT
TO authenticated
USING (true);

-- Schedule automatic cleanup (every hour)
-- Note: This requires pg_cron extension
-- SELECT cron.schedule('cleanup-cache', '0 * * * *', 'SELECT public.cleanup_expired_cache()');

COMMENT ON TABLE public.api_cache IS 'Cache table for API responses with TTL support';
