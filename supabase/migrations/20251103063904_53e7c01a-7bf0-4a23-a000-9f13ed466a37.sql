-- Add unique constraint to exchange_credentials to enable proper upserts
ALTER TABLE exchange_credentials 
ADD CONSTRAINT exchange_credentials_user_exchange_unique 
UNIQUE (user_id, exchange);

-- Update existing credentials to set is_connected = true where API keys exist
UPDATE exchange_credentials 
SET is_connected = true 
WHERE api_key IS NOT NULL AND api_key != '';

-- Add unique constraint to arbitrage_opportunities to prevent duplicates
-- Using a combination of user_id, exchange1, exchange2, exchange3, base_symbol, quote_symbol, intermediate_symbol
ALTER TABLE arbitrage_opportunities 
ADD CONSTRAINT arbitrage_opportunities_unique 
UNIQUE (user_id, exchange1, exchange2, exchange3, base_symbol, quote_symbol, intermediate_symbol, type);

-- Create function to cleanup old opportunities (older than 24 hours)
CREATE OR REPLACE FUNCTION cleanup_old_opportunities()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    deleted_count INTEGER;
BEGIN
    DELETE FROM public.arbitrage_opportunities 
    WHERE detected_at < now() - interval '24 hours';
    
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    RETURN deleted_count;
END;
$$;