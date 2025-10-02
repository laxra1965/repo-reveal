-- Add arbitrage type selection and custom pairs to user_settings
ALTER TABLE public.user_settings 
ADD COLUMN IF NOT EXISTS arbitrage_types text[] DEFAULT ARRAY['triangular', 'cross_exchange']::text[],
ADD COLUMN IF NOT EXISTS custom_pairs text[] DEFAULT ARRAY[]::text[];