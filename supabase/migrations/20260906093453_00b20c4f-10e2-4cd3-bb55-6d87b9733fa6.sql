
-- Allow platform admins to delete opportunities directly
DROP POLICY IF EXISTS "Admins can delete opportunities" ON public.opportunities;
CREATE POLICY "Admins can delete opportunities"
ON public.opportunities
FOR DELETE
TO authenticated
USING (public.is_platform_admin(auth.uid()));

-- Purge: stale (older than 2 minutes) OR not active
CREATE OR REPLACE FUNCTION public.cleanup_stale_opportunities()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  deleted_count integer;
BEGIN
  IF auth.role() <> 'service_role' AND NOT public.is_platform_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Admin required';
  END IF;

  DELETE FROM public.opportunities
  WHERE detected_at < NOW() - INTERVAL '2 minutes'
     OR status IS DISTINCT FROM 'active';

  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$function$;

-- Clean opportunities older than N hours (default 24h)
CREATE OR REPLACE FUNCTION public.cleanup_old_opportunities(p_hours integer DEFAULT 24)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  deleted_count integer;
  v_hours integer := GREATEST(COALESCE(p_hours, 24), 1);
BEGIN
  IF auth.role() <> 'service_role' AND NOT public.is_platform_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Admin required';
  END IF;

  DELETE FROM public.opportunities
  WHERE detected_at < NOW() - (v_hours || ' hours')::interval;

  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$function$;

REVOKE ALL ON FUNCTION public.cleanup_old_opportunities(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cleanup_old_opportunities(integer) TO authenticated, service_role;
