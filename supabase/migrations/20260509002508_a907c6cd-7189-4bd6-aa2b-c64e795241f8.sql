
-- Persist scanner state per user
ALTER TABLE public.user_settings
  ADD COLUMN IF NOT EXISTS is_scanning boolean NOT NULL DEFAULT false;

-- Tighten RLS scope on user_settings (drop old, recreate scoped to authenticated)
DROP POLICY IF EXISTS "Users can manage their own settings" ON public.user_settings;
CREATE POLICY "Users can manage their own settings"
  ON public.user_settings
  FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- admin_settings: ensure SELECT is restricted to authenticated only
DROP POLICY IF EXISTS admin_settings_read ON public.admin_settings;
CREATE POLICY admin_settings_read
  ON public.admin_settings
  FOR SELECT
  TO authenticated
  USING (true);

-- Backend hard-block: a trigger that prevents enabling real-money trading
-- when the allowed-exchanges list is empty.
CREATE OR REPLACE FUNCTION public.enforce_real_money_settings()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_allowed text;
  v_approved text;
BEGIN
  -- When toggling approval ON, require a non-empty allowed-exchanges list
  IF NEW.key = 'real_money_approved' AND lower(coalesce(NEW.value,'false')) = 'true' THEN
    SELECT value INTO v_allowed FROM public.admin_settings
      WHERE key = 'real_money_allowed_exchanges';
    IF v_allowed IS NULL OR v_allowed IN ('', '[]') THEN
      RAISE EXCEPTION 'Cannot enable real-money trading: allowed exchanges list is empty';
    END IF;
  END IF;

  -- When clearing the allowed exchanges to empty, force approval OFF
  IF NEW.key = 'real_money_allowed_exchanges' AND coalesce(NEW.value,'[]') IN ('', '[]') THEN
    SELECT value INTO v_approved FROM public.admin_settings
      WHERE key = 'real_money_approved';
    IF lower(coalesce(v_approved,'false')) = 'true' THEN
      UPDATE public.admin_settings SET value = 'false', updated_at = now()
        WHERE key = 'real_money_approved';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_real_money_settings ON public.admin_settings;
CREATE TRIGGER trg_enforce_real_money_settings
  BEFORE INSERT OR UPDATE ON public.admin_settings
  FOR EACH ROW EXECUTE FUNCTION public.enforce_real_money_settings();
