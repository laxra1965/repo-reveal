-- Migration: Performance Tuning
-- Date: 2025-12-29
-- Description: Add missing indexes for scanner_logs and optimization

-- Index for cleanup of old logs (cleanup runs every day)
CREATE INDEX IF NOT EXISTS idx_scanner_logs_created_at
ON public.scanner_logs(created_at);

-- Index for user-specific log clearing and querying
CREATE INDEX IF NOT EXISTS idx_scanner_logs_user_id
ON public.scanner_logs(user_id);

-- Composite index for dashboard queries (often sorts by created_at for a user)
CREATE INDEX IF NOT EXISTS idx_scanner_logs_user_created
ON public.scanner_logs(user_id, created_at DESC);

-- Analyze to update stats
ANALYZE public.scanner_logs;
