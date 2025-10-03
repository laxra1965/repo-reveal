-- Add type column to arbitrage_opportunities table to distinguish between triangular and cross-exchange arbitrage
ALTER TABLE public.arbitrage_opportunities 
ADD COLUMN type text NOT NULL DEFAULT 'triangular' CHECK (type IN ('triangular', 'cross_exchange'));