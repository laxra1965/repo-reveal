-- Replace hardcoded email checks in transactions policies with admin_users table lookup
DROP POLICY IF EXISTS "Admins can manage all transactions" ON public.transactions;
CREATE POLICY "Admins can manage all transactions"
ON public.transactions
FOR ALL
USING (EXISTS (SELECT 1 FROM public.admin_users WHERE user_id = auth.uid()))
WITH CHECK (EXISTS (SELECT 1 FROM public.admin_users WHERE user_id = auth.uid()));

-- Replace hardcoded email checks in user_subscriptions policies with admin_users table lookup
DROP POLICY IF EXISTS "Admins can manage all subscriptions" ON public.user_subscriptions;
CREATE POLICY "Admins can manage all subscriptions"
ON public.user_subscriptions
FOR ALL
USING (EXISTS (SELECT 1 FROM public.admin_users WHERE user_id = auth.uid()))
WITH CHECK (EXISTS (SELECT 1 FROM public.admin_users WHERE user_id = auth.uid()));