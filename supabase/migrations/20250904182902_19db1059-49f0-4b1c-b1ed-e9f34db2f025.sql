-- Add indexes for better performance on arbitrage_opportunities table
CREATE INDEX IF NOT EXISTS idx_arbitrage_opportunities_user_id ON public.arbitrage_opportunities(user_id);
CREATE INDEX IF NOT EXISTS idx_arbitrage_opportunities_profit_percent ON public.arbitrage_opportunities(profit_percent DESC);
CREATE INDEX IF NOT EXISTS idx_arbitrage_opportunities_detected_at ON public.arbitrage_opportunities(detected_at DESC);
CREATE INDEX IF NOT EXISTS idx_arbitrage_opportunities_expires_at ON public.arbitrage_opportunities(expires_at);

-- Add indexes for user_settings table
CREATE INDEX IF NOT EXISTS idx_user_settings_user_id ON public.user_settings(user_id);

-- Add indexes for scanner_logs table
CREATE INDEX IF NOT EXISTS idx_scanner_logs_user_id ON public.scanner_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_scanner_logs_created_at ON public.scanner_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_scanner_logs_log_type ON public.scanner_logs(log_type);

-- Add indexes for trade_history table
CREATE INDEX IF NOT EXISTS idx_trade_history_user_id ON public.trade_history(user_id);
CREATE INDEX IF NOT EXISTS idx_trade_history_status ON public.trade_history(status);
CREATE INDEX IF NOT EXISTS idx_trade_history_started_at ON public.trade_history(started_at DESC);

-- Add composite indexes for common queries
CREATE INDEX IF NOT EXISTS idx_arbitrage_opportunities_user_profit ON public.arbitrage_opportunities(user_id, profit_percent DESC, detected_at DESC);
CREATE INDEX IF NOT EXISTS idx_arbitrage_opportunities_active ON public.arbitrage_opportunities(expires_at, user_id) WHERE expires_at > now();

-- Add better indexes on exchange_credentials table
CREATE INDEX IF NOT EXISTS idx_exchange_credentials_user_exchange ON public.exchange_credentials(user_id, exchange);
CREATE INDEX IF NOT EXISTS idx_exchange_credentials_connected ON public.exchange_credentials(user_id, is_connected) WHERE is_connected = true;