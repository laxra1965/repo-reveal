CREATE SCHEMA IF NOT EXISTS browser_scanner_private;
REVOKE ALL ON SCHEMA browser_scanner_private FROM PUBLIC, anon;
GRANT USAGE ON SCHEMA browser_scanner_private TO authenticated;
ALTER FUNCTION public.publish_browser_opportunities(jsonb) SET SCHEMA browser_scanner_private;
CREATE FUNCTION public.publish_browser_opportunities(p_opportunities jsonb)
RETURNS integer LANGUAGE sql SECURITY INVOKER SET search_path = '' AS $$ SELECT browser_scanner_private.publish_browser_opportunities(p_opportunities); $$;
REVOKE ALL ON FUNCTION public.publish_browser_opportunities(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.publish_browser_opportunities(jsonb) TO authenticated;