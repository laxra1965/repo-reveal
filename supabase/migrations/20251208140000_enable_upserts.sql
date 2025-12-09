-- Migration: Add unique constraint for upsert
-- Date: 2025-12-08
-- Description: Add unique constraint to arbitrage_opportunities to enable efficient upserts

-- First, remove any potential duplicates to ensure constraint can be applied
DELETE FROM public.arbitrage_opportunities a
USING public.arbitrage_opportunities b
WHERE a.id > b.id
AND a.user_id = b.user_id
AND a.base_symbol = b.base_symbol
AND a.quote_symbol = b.quote_symbol
AND a.intermediate_symbol = b.intermediate_symbol
AND a.exchange1 = b.exchange1
AND a.exchange2 = b.exchange2
AND a.exchange3 = b.exchange3
AND a.type = b.type;

-- Now add the unique constraint
ALTER TABLE public.arbitrage_opportunities
ADD CONSTRAINT arbitrage_opportunities_unique_path 
UNIQUE (user_id, base_symbol, quote_symbol, intermediate_symbol, exchange1, exchange2, exchange3, type);

-- Add enable_ml_filtering to user_settings if not exists (safety check)
ALTER TABLE public.user_settings 
ADD COLUMN IF NOT EXISTS enable_ml_filtering BOOLEAN DEFAULT false;
