-- Migration: Update Arbitrage Type Constraints
-- Date: 2025-12-18
-- Description: Expand the 'type' column check to include 'short' and sync with 'signal_type'

-- 1. Update the 'type' check constraint
ALTER TABLE public.arbitrage_opportunities 
DROP CONSTRAINT IF EXISTS arbitrage_opportunities_type_check;

-- Note: In 20251003115535, it might have been named something else or inline.
-- If it was anonymous, we drop it by checking the definition.
-- For safety, we just re-apply the check with the New Allowed Value.
ALTER TABLE public.arbitrage_opportunities
ADD CONSTRAINT arbitrage_opportunities_type_check 
CHECK (type IN ('triangular', 'cross_exchange', 'short'));

-- 2. Ensure signal_type check also supports 'short' (it should, based on previous migration, but let's be sure)
ALTER TABLE public.arbitrage_opportunities
DROP CONSTRAINT IF EXISTS check_signal_type;

ALTER TABLE public.arbitrage_opportunities
ADD CONSTRAINT check_signal_type CHECK (signal_type IN ('arbitrage', 'short', 'none'));

-- 3. Update existing short types if any were mislabeled
UPDATE public.arbitrage_opportunities 
SET signal_type = 'short' 
WHERE type = 'short';
