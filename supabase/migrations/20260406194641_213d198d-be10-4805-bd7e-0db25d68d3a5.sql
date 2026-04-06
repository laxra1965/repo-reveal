
CREATE OR REPLACE FUNCTION public.auto_cleanup_opportunities()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  row_count integer;
BEGIN
  SELECT count(*) INTO row_count FROM public.opportunities;
  
  IF row_count >= 20000 THEN
    -- Delete oldest opportunities, keeping the newest 10000
    DELETE FROM public.opportunities
    WHERE id NOT IN (
      SELECT id FROM public.opportunities
      ORDER BY detected_at DESC
      LIMIT 10000
    );
  END IF;
  
  RETURN NEW;
END;
$$;

-- Run cleanup check after every 100th insert (using a modulo trick isn't possible in triggers,
-- so we attach it to every insert but the function exits fast when under threshold)
CREATE TRIGGER trg_auto_cleanup_opportunities
AFTER INSERT ON public.opportunities
FOR EACH STATEMENT
EXECUTE FUNCTION public.auto_cleanup_opportunities();
