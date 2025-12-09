-- Migration: Add ML filtering setting
-- Date: 2025-12-08
-- Description: Add enable_ml_filtering to user_settings

ALTER TABLE public.user_settings 
ADD COLUMN IF NOT EXISTS enable_ml_filtering BOOLEAN DEFAULT false;
