
-- Drop the broken UPDATE policy
DROP POLICY IF EXISTS "admin_settings_update" ON public.admin_settings;

-- Create proper UPDATE policy for admin users
CREATE POLICY "admin_settings_update" ON public.admin_settings
  FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM admin_users WHERE admin_users.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM admin_users WHERE admin_users.user_id = auth.uid()));

-- Add INSERT policy for admin users
CREATE POLICY "admin_settings_insert" ON public.admin_settings
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM admin_users WHERE admin_users.user_id = auth.uid()));
