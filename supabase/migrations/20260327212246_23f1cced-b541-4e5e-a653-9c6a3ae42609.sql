-- Allow admins to INSERT, UPDATE, DELETE subscription_plans
CREATE POLICY "Admins can insert plans"
ON public.subscription_plans
FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (SELECT 1 FROM public.admin_users WHERE admin_users.user_id = auth.uid())
);

CREATE POLICY "Admins can update plans"
ON public.subscription_plans
FOR UPDATE
TO authenticated
USING (
  EXISTS (SELECT 1 FROM public.admin_users WHERE admin_users.user_id = auth.uid())
)
WITH CHECK (
  EXISTS (SELECT 1 FROM public.admin_users WHERE admin_users.user_id = auth.uid())
);

CREATE POLICY "Admins can delete plans"
ON public.subscription_plans
FOR DELETE
TO authenticated
USING (
  EXISTS (SELECT 1 FROM public.admin_users WHERE admin_users.user_id = auth.uid())
);