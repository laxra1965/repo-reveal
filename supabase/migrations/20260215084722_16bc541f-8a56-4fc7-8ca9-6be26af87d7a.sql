-- 1. Enable RLS on __pgcron_test (RLS disabled in public)
ALTER TABLE public.__pgcron_test ENABLE ROW LEVEL SECURITY;

-- Restrict access to service role only
CREATE POLICY "Service role only on pgcron_test"
ON public.__pgcron_test
FOR ALL
USING (auth.role() = 'service_role');

-- 2. Enable RLS on scanner_health_metrics
ALTER TABLE public.scanner_health_metrics ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read scanner metrics"
ON public.scanner_health_metrics
FOR SELECT
USING (true);

CREATE POLICY "Service role can manage scanner metrics"
ON public.scanner_health_metrics
FOR ALL
USING (auth.role() = 'service_role');

-- 3. Remove overly permissive public read policy on transactions
DROP POLICY IF EXISTS "Enable read access for all users" ON public.transactions;

-- 4. Remove overly permissive public read policy on user_subscriptions
DROP POLICY IF EXISTS "Enable read access for all users" ON public.user_subscriptions;
