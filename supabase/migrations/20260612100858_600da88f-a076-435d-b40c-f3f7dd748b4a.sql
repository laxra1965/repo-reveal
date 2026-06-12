GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_subscriptions TO authenticated;
GRANT ALL ON public.user_subscriptions TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.transactions TO authenticated;
GRANT ALL ON public.transactions TO service_role;