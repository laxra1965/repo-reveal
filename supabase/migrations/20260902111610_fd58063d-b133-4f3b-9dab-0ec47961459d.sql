DROP POLICY IF EXISTS "Authenticated can read scanner_logs" ON public.scanner_logs;

DROP POLICY IF EXISTS "Admins can read all scanner logs" ON public.scanner_logs;
CREATE POLICY "Admins can read all scanner logs"
ON public.scanner_logs FOR SELECT TO authenticated
USING (public.is_platform_admin(auth.uid()));

DROP POLICY IF EXISTS "authenticated_can_receive_broadcasts" ON realtime.messages;
CREATE POLICY "authenticated_can_receive_own_broadcasts"
ON realtime.messages FOR SELECT TO authenticated
USING (
  realtime.topic() LIKE 'public:%'
  OR realtime.topic() = 'user:' || auth.uid()::text
  OR public.is_platform_admin(auth.uid())
);