
-- 1) transactions: explicit INSERT WITH CHECK for owner
DROP POLICY IF EXISTS "Users can insert their own transactions" ON public.transactions;
CREATE POLICY "Users can insert their own transactions"
ON public.transactions
FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = user_id);

-- Tighten the broad ALL policy: replace with explicit owner SELECT/UPDATE only
DROP POLICY IF EXISTS "Users can view their own transactions" ON public.transactions;
CREATE POLICY "Users can view their own transactions"
ON public.transactions
FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

-- 2) opportunity_filters: remove public read, restrict to admins
DROP POLICY IF EXISTS admin_read_filters ON public.opportunity_filters;
CREATE POLICY opportunity_filters_admin_read
ON public.opportunity_filters
FOR SELECT
TO authenticated
USING (EXISTS (SELECT 1 FROM public.admin_users WHERE user_id = auth.uid()));

-- 3) realtime.messages: enable RLS + restrict to authenticated subscribers
ALTER TABLE IF EXISTS realtime.messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "authenticated_can_receive_broadcasts" ON realtime.messages;
CREATE POLICY "authenticated_can_receive_broadcasts"
ON realtime.messages
FOR SELECT
TO authenticated
USING (true);

DROP POLICY IF EXISTS "service_role_full_access_messages" ON realtime.messages;
CREATE POLICY "service_role_full_access_messages"
ON realtime.messages
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

-- 4) Document admin_users provisioning policy via comment (admin INSERT is intentionally false; use service_role)
COMMENT ON POLICY admin_users_insert ON public.admin_users IS
'Admins must be provisioned exclusively via service_role or direct SQL. Client INSERT is intentionally blocked to prevent privilege escalation.';
