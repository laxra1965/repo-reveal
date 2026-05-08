
-- 1. Persist auto-simulate toggle on user_settings
ALTER TABLE public.user_settings
  ADD COLUMN IF NOT EXISTS auto_paper_trade boolean NOT NULL DEFAULT false;

-- 2. Real-money execution approval, controlled by admins via admin_settings
INSERT INTO public.admin_settings (key, value)
VALUES ('real_money_approved', 'false')
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.admin_settings (key, value)
VALUES ('real_money_allowed_exchanges', '[]')
ON CONFLICT (key) DO NOTHING;

-- Ensure admin_settings.key has a unique constraint (required for upserts from the UI)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'admin_settings_key_unique'
  ) THEN
    BEGIN
      ALTER TABLE public.admin_settings
        ADD CONSTRAINT admin_settings_key_unique UNIQUE (key);
    EXCEPTION WHEN duplicate_table OR unique_violation THEN
      NULL;
    END;
  END IF;
END$$;
