
-- Prevent duplicate open queue rows for the same user
CREATE UNIQUE INDEX IF NOT EXISTS uniq_auto_trade_queue_open_per_user
ON public.auto_trade_queue (user_id)
WHERE status IN ('queued', 'processing', 'executing');

-- Prevent duplicate pending/executing trades for the same user+opportunity
CREATE UNIQUE INDEX IF NOT EXISTS uniq_trade_history_open_per_user_opp
ON public.trade_history (user_id, opportunity_id)
WHERE status IN ('pending', 'executing');
