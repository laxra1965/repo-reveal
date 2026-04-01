ALTER TABLE public.user_settings 
ADD COLUMN IF NOT EXISTS slippage_buffer numeric DEFAULT 0.5,
ADD COLUMN IF NOT EXISTS max_position_size numeric DEFAULT 1000;