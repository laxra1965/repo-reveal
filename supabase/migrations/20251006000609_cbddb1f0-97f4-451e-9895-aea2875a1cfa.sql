-- Enable pg_cron extension for scheduled jobs
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;

-- Enable pg_net extension for HTTP requests
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

-- Grant usage to postgres role
GRANT USAGE ON SCHEMA cron TO postgres;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA cron TO postgres;

-- Create a cron job to run arbitrage scanner every 5 minutes for all users with auto_trade enabled
-- This will call the arbitrage-scanner edge function in "auto mode"
SELECT cron.schedule(
  'auto-arbitrage-scanner',
  '*/5 * * * *', -- Every 5 minutes
  $$
  SELECT
    net.http_post(
        url:='https://zupbliefzhnohsoguwuk.supabase.co/functions/v1/arbitrage-scanner',
        headers:='{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inp1cGJsaWVmemhub2hzb2d1d3VrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTQ0MTg5MjksImV4cCI6MjA2OTk5NDkyOX0.onUAdnZILGu2vhjsEDxGqQuhvLfKTwjC3QJPNJcG0n0"}'::jsonb,
        body:='{"mode": "auto", "timestamp": "' || now() || '"}'::jsonb
    ) as request_id;
  $$
);

-- View scheduled jobs
COMMENT ON EXTENSION pg_cron IS 'Cron-based job scheduler for PostgreSQL';
COMMENT ON EXTENSION pg_net IS 'Async HTTP client for PostgreSQL';