-- Create enum for trade status
CREATE TYPE public.trade_status AS ENUM ('pending', 'executing', 'completed', 'failed', 'cancelled');

-- Create enum for exchange names
CREATE TYPE public.exchange_name AS ENUM ('binance', 'bybit', 'okx', 'bitget', 'mexc', 'gate', 'htx', 'kucoin', 'bitfinex', 'bingx', 'coinbase', 'upbit', 'cryptocom', 'kraken');

-- Create table for user settings
CREATE TABLE public.user_settings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    refresh_rate INTEGER DEFAULT 5 CHECK (refresh_rate >= 2 AND refresh_rate <= 60),
    trade_amount DECIMAL(10,2) DEFAULT 10.00 CHECK (trade_amount > 0),
    min_profit_percent DECIMAL(5,4) DEFAULT 0.0005 CHECK (min_profit_percent >= 0),
    max_profit_percent DECIMAL(5,2) DEFAULT 50.00 CHECK (max_profit_percent > min_profit_percent),
    filter_profitable BOOLEAN DEFAULT true,
    auto_trade BOOLEAN DEFAULT false,
    enabled_exchanges exchange_name[] DEFAULT ARRAY['binance', 'bybit', 'okx']::exchange_name[],
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    UNIQUE(user_id)
);

-- Create table for exchange API credentials
CREATE TABLE public.exchange_credentials (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    exchange exchange_name NOT NULL,
    api_key TEXT NOT NULL,
    api_secret TEXT NOT NULL,
    test_mode BOOLEAN DEFAULT true,
    is_connected BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    UNIQUE(user_id, exchange)
);

-- Create table for arbitrage opportunities
CREATE TABLE public.arbitrage_opportunities (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    base_symbol TEXT NOT NULL,
    quote_symbol TEXT NOT NULL,
    intermediate_symbol TEXT NOT NULL,
    exchange1 exchange_name NOT NULL,
    exchange2 exchange_name NOT NULL,
    exchange3 exchange_name NOT NULL,
    step1_action TEXT NOT NULL, -- 'BUY' or 'SELL'
    step1_price DECIMAL(20,8) NOT NULL,
    step1_amount DECIMAL(20,8) NOT NULL,
    step2_action TEXT NOT NULL,
    step2_price DECIMAL(20,8) NOT NULL,
    step2_amount DECIMAL(20,8) NOT NULL,
    step3_action TEXT NOT NULL,
    step3_price DECIMAL(20,8) NOT NULL,
    step3_amount DECIMAL(20,8) NOT NULL,
    start_amount DECIMAL(20,8) NOT NULL,
    end_amount DECIMAL(20,8) NOT NULL,
    profit_amount DECIMAL(20,8) NOT NULL,
    profit_percent DECIMAL(8,4) NOT NULL,
    detected_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    expires_at TIMESTAMP WITH TIME ZONE DEFAULT (now() + INTERVAL '30 seconds')
);

-- Create table for trade history
CREATE TABLE public.trade_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    opportunity_id UUID REFERENCES public.arbitrage_opportunities(id),
    status trade_status DEFAULT 'pending',
    base_symbol TEXT NOT NULL,
    quote_symbol TEXT NOT NULL,
    intermediate_symbol TEXT NOT NULL,
    total_steps INTEGER DEFAULT 3,
    completed_steps INTEGER DEFAULT 0,
    start_amount DECIMAL(20,8) NOT NULL,
    final_amount DECIMAL(20,8),
    actual_profit DECIMAL(20,8),
    expected_profit DECIMAL(20,8) NOT NULL,
    execution_details JSONB DEFAULT '{}',
    error_message TEXT,
    started_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    completed_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Create table for scanner logs
CREATE TABLE public.scanner_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    log_type TEXT NOT NULL, -- 'info', 'error', 'warning', 'trade'
    message TEXT NOT NULL,
    details JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Enable RLS on all tables
ALTER TABLE public.user_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.exchange_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.arbitrage_opportunities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trade_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scanner_logs ENABLE ROW LEVEL SECURITY;

-- Create RLS policies
CREATE POLICY "Users can manage their own settings" 
ON public.user_settings 
FOR ALL 
USING (auth.uid() = user_id);

CREATE POLICY "Users can manage their own credentials" 
ON public.exchange_credentials 
FOR ALL 
USING (auth.uid() = user_id);

CREATE POLICY "Users can view their own opportunities" 
ON public.arbitrage_opportunities 
FOR ALL 
USING (auth.uid() = user_id);

CREATE POLICY "Users can view their own trade history" 
ON public.trade_history 
FOR ALL 
USING (auth.uid() = user_id);

CREATE POLICY "Users can view their own logs" 
ON public.scanner_logs 
FOR ALL 
USING (auth.uid() = user_id);

-- Create function to update timestamps
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create triggers for timestamp updates
CREATE TRIGGER update_user_settings_updated_at
    BEFORE UPDATE ON public.user_settings
    FOR EACH ROW
    EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_exchange_credentials_updated_at
    BEFORE UPDATE ON public.exchange_credentials
    FOR EACH ROW
    EXECUTE FUNCTION public.update_updated_at_column();

-- Create indexes for better performance
CREATE INDEX idx_arbitrage_opportunities_user_id ON public.arbitrage_opportunities(user_id);
CREATE INDEX idx_arbitrage_opportunities_expires_at ON public.arbitrage_opportunities(expires_at);
CREATE INDEX idx_trade_history_user_id ON public.trade_history(user_id);
CREATE INDEX idx_trade_history_status ON public.trade_history(status);
CREATE INDEX idx_scanner_logs_user_id ON public.scanner_logs(user_id);
CREATE INDEX idx_scanner_logs_created_at ON public.scanner_logs(created_at);

-- Create function to clean up expired opportunities
CREATE OR REPLACE FUNCTION public.cleanup_expired_opportunities()
RETURNS INTEGER AS $$
DECLARE
    deleted_count INTEGER;
BEGIN
    DELETE FROM public.arbitrage_opportunities 
    WHERE expires_at < now();
    
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;