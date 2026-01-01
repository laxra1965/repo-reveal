-- Migration: Fix trade_history foreign key to Cascade Delete
-- Date: 2025-12-29
-- Description: Allow deleting opportunities by cascading deletions to trade_history

ALTER TABLE public.trade_history
DROP CONSTRAINT IF EXISTS trade_history_opportunity_id_fkey;

ALTER TABLE public.trade_history
ADD CONSTRAINT trade_history_opportunity_id_fkey
FOREIGN KEY (opportunity_id)
REFERENCES public.arbitrage_opportunities(id)
ON DELETE CASCADE;
