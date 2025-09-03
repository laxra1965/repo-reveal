-- Add indexes for better query performance on arbitrage_opportunities
CREATE INDEX IF NOT EXISTS idx_arbitrage_opportunities_user_id_expires_at 
ON arbitrage_opportunities(user_id, expires_at DESC);

CREATE INDEX IF NOT EXISTS idx_arbitrage_opportunities_profit_percent 
ON arbitrage_opportunities(profit_percent DESC) WHERE expires_at > NOW();

CREATE INDEX IF NOT EXISTS idx_arbitrage_opportunities_detected_at 
ON arbitrage_opportunities(detected_at DESC);

-- Add volume and depth columns for enhanced analysis
ALTER TABLE arbitrage_opportunities 
ADD COLUMN IF NOT EXISTS step1_volume NUMERIC DEFAULT 0,
ADD COLUMN IF NOT EXISTS step2_volume NUMERIC DEFAULT 0,
ADD COLUMN IF NOT EXISTS step3_volume NUMERIC DEFAULT 0,
ADD COLUMN IF NOT EXISTS estimated_slippage NUMERIC DEFAULT 0,
ADD COLUMN IF NOT EXISTS liquidity_score INTEGER DEFAULT 0;