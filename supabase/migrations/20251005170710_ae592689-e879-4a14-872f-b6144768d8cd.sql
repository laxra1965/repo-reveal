-- Add signal_type and arb_factor columns to arbitrage_opportunities table
ALTER TABLE public.arbitrage_opportunities 
ADD COLUMN IF NOT EXISTS signal_type text DEFAULT 'arbitrage',
ADD COLUMN IF NOT EXISTS arb_factor numeric(10, 6),
ADD COLUMN IF NOT EXISTS overpriced_leg text,
ADD COLUMN IF NOT EXISTS price_deviation numeric(10, 6);

-- Add check constraint for signal_type
ALTER TABLE public.arbitrage_opportunities
DROP CONSTRAINT IF EXISTS check_signal_type;

ALTER TABLE public.arbitrage_opportunities
ADD CONSTRAINT check_signal_type CHECK (signal_type IN ('arbitrage', 'short', 'none'));

-- Add comment to explain columns
COMMENT ON COLUMN public.arbitrage_opportunities.signal_type IS 'Type of signal: arbitrage (arb_factor > 1.0), short (arb_factor < 1.0), none (arb_factor ~1.0)';
COMMENT ON COLUMN public.arbitrage_opportunities.arb_factor IS 'Arbitrage factor of the cycle (6 decimal places)';
COMMENT ON COLUMN public.arbitrage_opportunities.overpriced_leg IS 'The overpriced leg when signal_type is short';
COMMENT ON COLUMN public.arbitrage_opportunities.price_deviation IS 'Price deviation percentage for the overpriced leg';