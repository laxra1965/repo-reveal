-- Enable required extensions
-- Note: If these fail with permission errors, please enable them manually 
-- in Supabase Dashboard > Database > Extensions
-- CREATE EXTENSION IF NOT EXISTS pg_cron;
-- CREATE EXTENSION IF NOT EXISTS pg_net;

-- Note: You must replace 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inp1cGJsaWVmemhub2hzb2d1d3VrIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1NDQxODkyOSwiZXhwIjoyMDY5OTk0OTI5fQ.Tf2a4mzscA0cmRT4Jrd3_dY3U2pyZ_RWurlHRT200nM' 
-- with your actual Supabase Service Role Key (found in Project Settings > API)

-- 1. Schedule "Arbitrage Scanner" (Auto Mode) - Runs every minute
-- This finds new opportunities for all users with auto-trade enabled
SELECT cron.schedule(
  'arbitrage-scanner-auto',
  '* * * * *', -- Every minute
  $$
  SELECT net.http_post(
      url:='https://zupbliefzhnohsoguwuk.supabase.co/functions/v1/arbitrage-scanner',
      headers:='{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inp1cGJsaWVmemhub2hzb2d1d3VrIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1NDQxODkyOSwiZXhwIjoyMDY5OTk0OTI5fQ.Tf2a4mzscA0cmRT4Jrd3_dY3U2pyZ_RWurlHRT200nM"}',
      body:='{"mode": "auto"}'
  ) as request_id;
  $$
);

-- 2. Schedule "Auto Trade Scheduler" - Runs every 30 seconds
-- This queues and processes trades for found opportunities
SELECT cron.schedule(
  'auto-trade-scheduler',
  '* * * * *',
  $$
  SELECT net.http_post(
      url:='https://zupbliefzhnohsoguwuk.supabase.co/functions/v1/auto-trade-scheduler',
      headers:='{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inp1cGJsaWVmemhub2hzb2d1d3VrIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1NDQxODkyOSwiZXhwIjoyMDY5OTk0OTI5fQ.Tf2a4mzscA0cmRT4Jrd3_dY3U2pyZ_RWurlHRT200nM"}',
      body:='{}'
  ) as request_id;
  $$
);

-- 3. Schedule "Cleanup" - Runs every hour
SELECT cron.schedule(
  'arbitrage-cleanup',
  '0 * * * *', -- Every hour
  $$
  SELECT net.http_post(
      url:='https://zupbliefzhnohsoguwuk.supabase.co/functions/v1/scheduled-arb-scan',
      headers:='{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inp1cGJsaWVmemhub2hzb2d1d3VrIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1NDQxODkyOSwiZXhwIjoyMDY5OTk0OTI5fQ.Tf2a4mzscA0cmRT4Jrd3_dY3U2pyZ_RWurlHRT200nM"}',
      body:='{}'
  ) as request_id;
  $$
);
