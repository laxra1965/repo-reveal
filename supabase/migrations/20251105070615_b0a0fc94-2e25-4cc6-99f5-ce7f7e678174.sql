-- Update arbitrage_opportunities to have 24 hour expiry instead of 30 seconds
ALTER TABLE public.arbitrage_opportunities 
ALTER COLUMN expires_at SET DEFAULT (now() + interval '24 hours');