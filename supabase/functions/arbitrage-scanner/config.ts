// Configuration constants for arbitrage scanner

// Configuration Object
export const OPPORTUNITY_CONFIG = {
  deduplication: { enabled: true, keepHighestProfit: true },
  expiry: { baseSeconds: 60, minSeconds: 5, maxSeconds: 30, profitMultiplier: 1.5, liquidityMultiplier: 1.2 },
  quality: { minProfitPercent: 0.75, minLiquidityScore: 50, minVolume: 10, maxResults: 50 },
  database: { batchSize: 50, useUpsert: true, deleteOldFirst: true }
};

// Fixed shared base currencies
export const SHARED_COMMON_BASES = [
  'BTC', 'ETH', 'BNB', 'XRP', 'ADA', 'SOL', 'DOGE', 'MATIC', 'DOT', 'AVAX',
  'SHIB', 'LTC', 'UNI', 'LINK', 'ATOM', 'TON', 'XLM', 'BCH', 'NEAR', 'TRX',
  'FTM', 'ALGO', 'ICP', 'THETA', 'EOS', 'AAVE', 'GRT', 'SAND', 'MANA', 'AXS',
  'CRV', 'RUNE', 'CAKE', 'SUSHI', 'COMP', 'YFI', 'MKR', 'SNX', 'FIL', 'VET',
  'KAVA', 'ZIL', 'ENJ', 'BAT', 'ZRX', 'REN', 'KNC', 'BAND', 'SXP', 'RSR',
  'OGN', 'DENT', 'WIN', 'HOT', 'ANKR', 'COTI', 'CHR', 'MDT', 'STMX', 'DF',
  'ARB', 'OP', 'IMX', 'APE', 'LDO', 'RNDR', 'INJ', 'PEPE', 'WLD', 'SEI',
  'TIA', 'ORDI', 'STX', 'PYTH', 'JUP', 'BLUR', 'WIF', 'BONK', 'FLOKI', 'GALA',
  'USDC', 'DAI', 'FDUSD', 'TUSD', 'BUSD'
];

// Rate limiting configuration
export const RATE_LIMIT_CONFIG = {
  windowMs: 60000,      // 1 minute window
  maxRequests: 20       // Max requests per window
};

// Exchange API configuration
export const EXCHANGE_CONFIG = {
  timeout: 15000,       // 15 second timeout
  defaultType: 'spot',  // Default to spot trading
  minVolume: 100        // Minimum volume filter
};

/**
 * Calculate dynamic opportunity expiry based on profit margin
 * Higher profit = can wait longer (less likely to disappear)
 * @param profitPercent - Profit percentage
 * @returns Expiry time in seconds
 */
export function calculateExpirySeconds(profitPercent: number): number {
  if (profitPercent > 2.0) return 30;  // 30 sec for >2% profit
  if (profitPercent > 1.0) return 20;  // 20 sec for >1% profit
  if (profitPercent > 0.75) return 10; // 10 sec for >0.75% profit
  return 5;                             // 5 sec for marginal profits
}

