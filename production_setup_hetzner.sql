-- Production Setup for Hetzner Singapore VPS
-- Replace the URLs and API keys with your actual Hetzner VPS URL and Supabase Service Role Key
-- 
-- IMPORTANT: Replace these placeholders:
-- 1. YOUR_HETZNER_FUNCTIONS_URL - Your Hetzner VPS URL (e.g., https://api.yourdomain.com or http://your-ip:8000)
-- 2. YOUR_SERVICE_ROLE_KEY - Your Supabase Service Role Key
-- 3. YOUR_FUNCTIONS_API_KEY - Optional API key for additional security (set in docker/.env as FUNCTIONS_API_KEY)

-- Enable required extensions
-- Note: If these fail with permission errors, please enable them manually 
-- in Supabase Dashboard > Database > Extensions
-- CREATE EXTENSION IF NOT EXISTS pg_cron;
-- CREATE EXTENSION IF NOT EXISTS pg_net;

-- 1. Schedule "Arbitrage Scanner" (Auto Mode) - Runs every minute
-- This finds new opportunities for all users with auto-trade enabled
SELECT cron.schedule(
  'arbitrage-scanner-auto',
  '* * * * *', -- Every minute
  $$
  SELECT net.http_post(
      url:='YOUR_HETZNER_FUNCTIONS_URL/functions/arbitrage-scanner',
      headers:='{"Content-Type": "application/json", "Authorization": "Bearer YOUR_SERVICE_ROLE_KEY", "X-API-Key": "YOUR_FUNCTIONS_API_KEY"}'::jsonb,
      body:='{"mode": "auto"}'::jsonb
  ) as request_id;
  $$
);

-- 2. Schedule "Auto Trade Scheduler" - Runs every minute
-- This queues and processes trades for found opportunities
SELECT cron.schedule(
  'auto-trade-scheduler',
  '* * * * *', -- Every minute
  $$
  SELECT net.http_post(
      url:='YOUR_HETZNER_FUNCTIONS_URL/functions/auto-trade-scheduler',
      headers:='{"Content-Type": "application/json", "Authorization": "Bearer YOUR_SERVICE_ROLE_KEY", "X-API-Key": "YOUR_FUNCTIONS_API_KEY"}'::jsonb,
      body:='{}'::jsonb
  ) as request_id;
  $$
);

-- 3. Schedule "Cleanup" - Runs every hour
SELECT cron.schedule(
  'arbitrage-cleanup',
  '0 * * * *', -- Every hour
  $$
  SELECT net.http_post(
      url:='YOUR_HETZNER_FUNCTIONS_URL/functions/scheduled-arb-scan',
      headers:='{"Content-Type": "application/json", "Authorization": "Bearer YOUR_SERVICE_ROLE_KEY", "X-API-Key": "YOUR_FUNCTIONS_API_KEY"}'::jsonb,
      body:='{}'::jsonb
  ) as request_id;
  $$
);

-- View scheduled jobs
SELECT * FROM cron.job ORDER BY jobname;

-- To unschedule a job (if needed):
-- SELECT cron.unschedule('arbitrage-scanner-auto');
-- SELECT cron.unschedule('auto-trade-scheduler');
-- SELECT cron.unschedule('arbitrage-cleanup');

