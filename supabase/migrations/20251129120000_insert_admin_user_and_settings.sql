-- Migration: Insert admin user and ensure USDT address
-- Date: 2025-11-29

-- Insert admin user (no-op if exists)
INSERT INTO public.admin_users (user_id)
VALUES ('d2e85bfb-5ad6-40b4-a7da-dc9ce6a6dfdd')
ON CONFLICT (user_id) DO NOTHING;

-- Upsert USDT address in admin_settings
INSERT INTO public.admin_settings (key, value)
VALUES ('usdt_address', 'TQzjbHBa9ckat52PtVn7m2SSEM7dJXQ2uP')
ON CONFLICT (key) DO UPDATE
  SET value = EXCLUDED.value,
      updated_at = now();
