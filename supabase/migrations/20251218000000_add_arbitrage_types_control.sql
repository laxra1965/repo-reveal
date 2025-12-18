-- Migration: Add arbitrage types control
-- Date: 2025-12-18
-- Description: Add arbitrage_types to user_settings and global_arbitrage_types to admin_settings

-- Add arbitrage_types to user_settings
ALTER TABLE public.user_settings 
ADD COLUMN IF NOT EXISTS arbitrage_types TEXT[] DEFAULT ARRAY['triangular', 'cross_exchange'];

-- Add global_arbitrage_types to admin_settings
INSERT INTO public.admin_settings (key, value) 
VALUES ('enabled_arbitrage_types', 'triangular,cross_exchange,short')
ON CONFLICT (key) DO NOTHING;
